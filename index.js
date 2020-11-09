/*
  index.js
  RallyTree main script.
*/

// ########## IMPORTS

// Module to access files.
const fs = require('fs').promises;
// Module to keep secrets local.
require('dotenv').config();
// Module to create a web server.
const http = require('http');
// Module to parse request bodies.
const {parse} = require('querystring');
// Rally module.
const rally = require('rally');

// ########## GLOBAL VARIABLES

const queryUtils = rally.util.query;
// REST API.
const requestOptions = {
  headers: {
    'X-RallyIntegrationName':
    process.env.RALLYINTEGRATIONNAME || 'RallyTree',
    'X-RallyIntegrationVendor':
    process.env.RALLYINTEGRATIONVENDOR || '',
    'X-RallyIntegrationVersion':
    process.env.RALLYINTEGRATIONVERSION || '1.0.4'
  }
};
let isError = false;
let restAPI = {};
let response = {};
let userName = '';
let userRef = '';
let takerRef = '';
let taskNames = [];
let rootRef = '';
let treeCopyParentRef = '';
let testFolderRef = '';
let totals = {
  total: 0,
  changes: 0,
  passes: 0,
  fails: 0,
  defects: 0,
  major: 0,
  minor: 0
};
let doc = [];
let docTimeout = 0;
let idle = false;
let reportServed = false;
let {RALLY_USERNAME, RALLY_PASSWORD} = process.env;
RALLY_USERNAME = RALLY_USERNAME || '';
RALLY_PASSWORD = RALLY_PASSWORD || '';
const docWait = 1500;

// ########## FUNCTIONS

// Reinitialize the global variables, except response.
const reinit = () => {
  isError = false;
  restAPI = {};
  userName = '';
  userRef = '';
  takerRef = '';
  taskNames = [];
  rootRef = '';
  treeCopyParentRef = '';
  testFolderRef = '';
  totals = {
    total: 0,
    changes: 0,
    passes: 0,
    fails: 0,
    defects: 0,
    major: 0,
    minor: 0
  };
  doc = [];
  docTimeout = 0;
  idle = false;
  reportServed = false;
};
// Processes a thrown error.
const err = (error, context) => {
  let problem = error;
  // If error is system-defined, convert newlines.
  if (typeof error !== 'string') {
    // Reduce it to a string.
    problem = error.message.replace(
      /^.+<title>|^.+<Errors>|<\/title>.+$|<\/Errors>.+$/gs, ''
    );
  }
  const msg = `Error ${context}: ${problem}`;
  console.log(msg);
  isError = true;
  const pageMsg = msg.replace(/\n/g, '<br>');
  // If a report page has been served:
  if (reportServed) {
    // Insert the error message there.
    response.write(
      `event: error\ndata: ${pageMsg}\n\n`
    );
    response.end();
  }
  // Otherwise:
  else {
    // Serve an error page containing the error message.
    fs.readFile('error.html', 'utf8')
    .then(
      content => {
        const newContent = content.replace(
          '__errorMessage__', pageMsg
        );
        response.setHeader('Content-Type', 'text/html');
        response.write(newContent);
        response.end();
        reinit();
      },
      error => {
        console.log(`Error reading error page: ${error.message}`);
        reinit();
      }
    );
  }
};
// Shortens a long reference.
const shorten = (readType, writeType, longRef) => {
  // If it is already a short reference, return it.
  const shortTest = new RegExp(`^/${writeType}/\\d+$`);
  if (shortTest.test(longRef)) {
    return longRef;
  }
  else {
    // If not, return its short version.
    const longReadPrefix = new RegExp(`^http.+(/|%2F)${readType}(/|%2F)(?=\\d+)`);
    const longWritePrefix = new RegExp(`^http.+(/|%2F)${writeType}(/|%2F)(?=\\d+)`);
    const num
      = Number.parseInt(longRef.replace(longReadPrefix, ''))
      || Number.parseInt(longRef.replace(longWritePrefix, ''));
    if (num) {
      return `/${writeType}/${num}`;
    }
    else {
      err(
        `Invalid Rally URL:\nlong ${longRef}\nshort /${writeType}/${num}`,
        'shortening URL'
      );
      return '';
    }
  }
};
// Returns the long reference of a member of a collection.
const getRefOf = (type, formattedID, context) => {
  const numericID = formattedID.replace(/^[A-Za-z]+/, '');
  if (/^\d+$/.test(numericID)) {
    return restAPI.query({
      type,
      fetch: '_ref',
      query: queryUtils.where('FormattedID', '=', numericID)
    })
    .then(
      result => {
        const resultArray = result.Results;
        if (resultArray.length) {
          return resultArray[0]._ref;
        }
        else {
          err('No such ID', `getting reference to ${type} for ${context}`);
          return '';
        }
      },
      error => err(error, `getting reference to ${type} for ${context}`)
    );
  }
  else {
    err('Invalid ID', `getting reference to ${type} for ${context}`);
    return Promise.resolve('');
  }
};
// Increments a total count and sends the new count as an event.
const upTotal = event => {
  response.write(`event: ${event}\ndata: ${++totals[event]}\n\n`);
};
/*
  Increments the total count and the change count and sends
  the counts as events.
*/
const upTotals = changeCount => {
  const totalMsg = `event: total\ndata: ${++totals.total}\n\n`;
  totals.changes += changeCount;
  const changeMsg = changeCount
    ? `event: changes\ndata: ${totals.changes}\n\n`
    : '';
  response.write(`${totalMsg}${changeMsg}`);
};
/*
  Increments the total count and the applicable verdict count
  and sends the counts as events.
*/
const upVerdicts = isPass=> {
  const totalMsg = `event: total\ndata: ${++totals.total}\n\n`;
  let changeMsg;
  if (isPass) {
    totals.passes++;
    changeMsg = `event: passes\ndata: ${totals.passes}\n\n`;
  }
  else {
    totals.fails++;
    changeMsg = `event: fails\ndata: ${totals.fails}\n\n`;
  }
  response.write(`${totalMsg}${changeMsg}`);
};
// Increments the defect count.
const upDefects = count => {
  totals.defects += count;
  response.write(`event: defects\ndata: ${totals.defects}\n\n`);
};
// Gets data on a work item.
const getData = (ref, fetch) => {
  return restAPI.get({
    ref,
    fetch
  });
};
// Sends the tree documentation as an event.
const outDoc = () => {
  if (docTimeout) {
    clearTimeout(docTimeout);
  }
  docTimeout = setTimeout(
    () => {
      const docJSON = JSON.stringify(doc[0], null, 2).replace(
        /\n/g, '<br>'
      );
      response.write(`event: doc\ndata: ${docJSON}\n\n`);
    },
    docWait
  );
};
// Recursively documents a tree or subtree of user stories.
const docTree = (storyRef, storyArray, index, ancestors) => {
  // Get data on the root user story.
  getData(storyRef, ['Name', 'DragAndDropRank', 'Children', 'TestCases'])
  .then(
    storyResult => {
      // When the data arrive:
      const storyObj = storyResult.Object;
      const name = storyObj.Name;
      const childrenSummary = storyObj.Children;
      const childCount = childrenSummary.Count;
      const casesSummary = storyObj.TestCases;
      let ownCaseCount = casesSummary.Count;
      // If the user story has any child user stories (and therefore no test cases):
      if (childCount) {
        // Document the user story as an object with initialized data.
        storyArray[index] = {
          name,
          caseCount: 0,
          children: []
        };
        // Get data on its child user stories.
        getData(childrenSummary._ref, ['_ref', 'DragAndDropRank'])
        .then(
          // When the data arrive:
          childrenObj => {
            // Create an array of the children in rank order.
            const children = Array.from(childrenObj.Object.Results);
            children.sort((a, b) => a.DragAndDropRank < b.DragAndDropRank ? -1 : 1);
            const childArray = storyArray[index].children;
            for (let i = 0; i < children.length; i++) {
              if (! isError) {
                const childRef = shorten(
                  'hierarchicalrequirement', 'hierarchicalrequirement', children[i]._ref
                );
                if (! isError) {
                  docTree(
                    childRef, childArray, i, ancestors.concat(storyArray[index])
                  );
                }
              }
            }
          },
          error => err(error, 'getting data on child user stories for tree documentation')
        );
      }
      // Otherwise, i.e. if the user story has no child user stories:
      else {
        // Document the user story as an object without a children array.
        storyArray[index] = {
          name,
          caseCount: ownCaseCount
        };
        // Add the user story’s test-case count to its ancestors’.
        ancestors.forEach(ancestor => {
          ancestor.caseCount += ownCaseCount;
        });
        // Send the documentation to the client if apparently complete.
        outDoc();
      }
    },
    error => err(error, 'getting data on user story for tree documentation')
  );
};
// Recursively acquires test results from a tree of user stories.
const verdictTree = storyRef => {
  // Get data on the user story.
  getData(storyRef, ['Children', 'TestCases', 'Defects'])
  .then(
    storyResult => {
      // When the data arrive:
      const storyObj = storyResult.Object;
      const caseSummary = storyObj.TestCases;
      const caseCount = caseSummary.Count;
      const defectSummary = storyObj.Defects;
      const defectCount = defectSummary.Count;
      const childrenSummary = storyObj.Children;
      const childCount = childrenSummary.Count;
      // If the user story has any test cases and no child user stories:
      if (caseCount && ! childCount) {
        // Get the data on the test cases.
        getData(caseSummary._ref, ['_ref', 'LastVerdict'])
        .then(
          // When the data arrive:
          casesObj => {
            const cases = casesObj.Object.Results;
            // Process the test cases in parallel.
            cases.forEach(caseObj => {
              const verdict = caseObj.LastVerdict;
              if (verdict === 'Pass'){
                upVerdicts(true);
              }
              else if (verdict === 'Fail') {
                upVerdicts(false);
              }
            });
          },
          error => err(error, 'getting data on test cases')
        );
        // Add the user story’s defect count to the defect count.
        upDefects(defectCount);
        // Get data on the defects.
        getData(defectSummary._ref, ['Severity'])
        .then(
          // When the data arrive, report the severities of the defects.
          defectsObj => {
            const defects = defectsObj.Object.Results;
            defects.forEach(defect => {
              const severity = defect.Severity;
              if (severity === 'Major Problem') {
                upTotal('major');
              }
              else if (severity === 'Minor Problem') {
                upTotal('minor');
              }
            });
          },
          error => err(error, 'getting data on defects')
        );
      }
      /*
        Otherwise, if the user story has any child user stories and
        no test cases (and therefore also no defects):
      */
      else if (childCount && ! caseCount) {
        // Get data on its child user stories.
        getData(childrenSummary._ref, ['_ref'])
        .then(
          // When the data arrive, process the children in parallel.
          childrenObj => {
            const children = childrenObj.Object.Results;
            children.forEach(child => {
              if (! isError) {
                const childRef = shorten(
                  'hierarchicalrequirement', 'hierarchicalrequirement', child._ref
                );
                if (! isError) {
                  verdictTree(childRef);
                }
              }
            });
          },
          error => err(
            error,
            'getting data on child user stories for test-result acquisition'
          )
        );
      }
      /*
        Otherwise, if the user story has both child user stories
        and test cases:
      */
      else if (childCount && caseCount) {
        // Stop and report this as a precondition violation.
        err(
          'User story with both children and test cases',
          'test-result acquisition'
        );
      }
    },
    error => err(
      error, 'getting data on user story for test-result acquisition'
    )
  );
};
// Change the ownership of a task.
const takeTask = taskObj => {
  if (! isError) {
    const taskRef = shorten('task', 'task', taskObj._ref);
    if (! isError) {
      const taskOwner = taskObj.Owner;
      const ownerRef = taskOwner ? shorten('user', 'user', taskOwner._ref) : '';
      if (! isError) {
        if (ownerRef !== takerRef) {
          restAPI.update({
            ref: taskRef,
            data: {Owner: takerRef}
          })
          .then(
            () => {
              upTotals(1);
            },
            error => err(error, 'changing the owner')
          );
        }
        else {
          upTotals(0);
        }
      }
    }
  }
};
// Recursively changes ownerships in a tree of user stories.
const takeTree = storyRef => {
  // Get data on the user story.
  getData(storyRef, ['Owner', 'Children', 'Tasks'])
  .then(
    // When the data arrive:
    storyResult => {
      const storyObj = storyResult.Object;
      const owner = storyObj.Owner;
      const ownerRef = owner ? shorten('user', 'user', storyObj.Owner._ref) : '';
      const tasksSummary = storyObj.Tasks;
      const taskCount = tasksSummary.Count;
      const childrenSummary = storyObj.Children;
      const childCount = childrenSummary.Count;
      const changeCount = ownerRef === takerRef ? 0 : 1;
      // Ensure that the specified user owns the user story.
      restAPI.update({
        ref: storyRef,
        data: changeCount ? {Owner: takerRef} : {}
      })
      // When the ownership change is complete:
      .then(
        () => {
          upTotals(changeCount);
          // If the user story has any tasks and no child user stories:
          if (taskCount && ! childCount) {
            // Get the data on the tasks.
            getData(tasksSummary._ref, ['_ref', 'Owner'])
            .then(
              // When the data arrive:
              tasksObj => {
                const tasks = tasksObj.Object.Results;
                // Process the tasks in parallel.
                tasks.forEach(taskObj => {
                  takeTask(taskObj);
                });
              },
              error => err(error, 'getting data on tasks')
            );
          }
          /*
            Otherwise, if the user story has any child user stories and
            no tasks:
          */
          else if (childCount && ! taskCount) {
            // Get data on its child user stories.
            getData(childrenSummary._ref, ['_ref'])
            .then(
              // When the data arrive, process the children in parallel.
              childrenObj => {
                const children = childrenObj.Object.Results;
                children.forEach(child => {
                  if (! isError) {
                    const childRef = shorten(
                      'hierarchicalrequirement',
                      'hierarchicalrequirement',
                      child._ref
                    );
                    if (! isError) {
                      takeTree(childRef);
                    }
                  }
                });
              },
              error => err(
                error,
                'getting data on child user stories for ownership change'
              )
            );
          }
          /*
            Otherwise, if the user story has both child user stories
            and tasks:
          */
          else if (childCount && taskCount) {
            // Stop and report this as a precondition violation.
            err(
              'User story with both children and tasks',
              'ownership changes'
            );
          }
        },
        error => err(error, 'changing user-story owner')
      );
    },
    error => err(
      error, 'getting data on user story for ownership changes'
    )
  );
};
// Sequentially creates tasks for a user story.
const createTasks = (storyRef, owner, names) => {
  if (names.length && ! isError) {
    return restAPI.create({
      type: 'task',
      fetch: ['_ref'],
      data: {
        Name: names[0],
        WorkProduct: storyRef,
        Owner: owner
      }
    })
    .then(
      () => createTasks(storyRef, owner, names.slice(1)),
      error => err(error, 'creating task')
    );
  }
  else {
    return Promise.resolve('');
  }
};
// Recursively creates tasks for a tree or subtrees of user stories.
const taskTree = storyRefs => {
  if (storyRefs.length && ! isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! isError) {
      // Get data on the first user story of the specified array.
      return getData(firstRef, ['Owner', 'Children'])
      .then(
        storyResult => {
          // When the data arrive:
          const storyObj = storyResult.Object;
          const owner = storyObj.Owner;
          const childrenSummary = storyObj.Children;
          /*
            If the user story has any child user stories, it does not
            need tasks, so:
          */
          if (childrenSummary.Count) {
            upTotals(0);
            // Get data on its child user stories.
            return getData(childrenSummary._ref, ['_ref'])
            .then(
              /*
                When the data arrive, process the children sequentially
                to prevent concurrency errors.
              */
              childrenResult => {
                const childRefs = childrenResult.Object.Results.map(
                  child => child._ref
                );
                return taskTree(childRefs)
                .then(
                  () => {
                    /*
                      Process the rest of the specified user stories
                      sequentially to prevent concurrency errors.
                    */
                    return taskTree(storyRefs.slice(1));
                  },
                  error => err(error, 'creating tasks for child user stories')
                );
              },
              error => err(
                error,
                'getting data on child user stories for task creation'
              )
            );
          }
          // Otherwise the user story needs tasks, so:
          else {
            // Create them sequentially to prevent concurrency errors.
            return createTasks(firstRef, owner, taskNames)
            // When they have been created:
            .then(
              () => {
                if (! isError) {
                  upTotals(taskNames.length);
                  /*
                    Process the rest of the specified user stories
                    sequentially to prevent concurrency errors.
                  */
                  return taskTree(storyRefs.slice(1));
                }
              },
              error => err(error, 'creating tasks')
            );
          }
        },
        error => err(
          error, 'getting data on first user story for task creation'
        )
      );
    }
  }
  else {
    return Promise.resolve('');
  }
};
// Recursively creates test cases for a tree or subtrees of user stories.
const caseTree = storyRefs => {
  if (storyRefs.length && ! isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! isError) {
      // Get data on the first user story of the specified array.
      return getData(firstRef, ['Name', 'Description', 'Owner', 'Children'])
      .then(
        storyResult => {
          // When the data arrive:
          const storyObj = storyResult.Object;
          const name = storyObj.Name;
          const description = storyObj.Description;
          const owner = storyObj.Owner;
          const childrenSummary = storyObj.Children;
          /*
            If the user story has any child user stories, it does not
            need a test case, so:
          */
          if (childrenSummary.Count) {
            upTotals(0);
            // Get data on its child user stories.
            return getData(childrenSummary._ref, ['_ref'])
            .then(
              /*
                When the data arrive, process the children sequentially to
                prevent concurrency errors.
              */
              childrenResult => {
                const childRefs = childrenResult.Object.Results.map(
                  child => child._ref
                );
                return caseTree(childRefs)
                .then(
                  () => caseTree(storyRefs.slice(1)),
                  error => err(error, 'creating test cases for child user stories')
                );
              },
              error => err(
                error,
                'getting data on child user stories for test-case creation'
              )
            );
          }
          // Otherwise the user story needs a test case, so:
          else {
            // Create a test case.
            return restAPI.create({
              type: 'testcase',
              fetch: ['_ref'],
              data: {
                Name: name,
                Description: description,
                Owner: owner,
                TestFolder: testFolderRef || null
              }
            })
            .then(
              // After it is created:
              newCase => {
                // Link it to the user story.
                const caseRef = shorten('testcase', 'testcase', newCase.Object._ref);
                if (! isError) {
                  return restAPI.add({
                    ref: firstRef,
                    collection: 'TestCases',
                    data: [{_ref: caseRef}],
                    fetch: ['_ref']
                  })
                  .then(
                    // After it is linked:
                    () => {
                      upTotals(1);
                      /*
                        Process the rest of the specified user stories
                        sequentially to prevent concurrency errors.
                      */
                      return caseTree(storyRefs.slice(1));
                    },
                    error => err(error, 'adding test case to user story')
                  );
                }
              },
              error => err(error, 'creating test case')
            );
          }
        },
        error => err(
          error, 'getting data on user story for test-case creation'
        )
      );
    }
  }
  else {
    return Promise.resolve('');
  }
};
// Recursively copies a tree or subtrees of user stories.
const copyTree = (storyData, copyParentRef) => {
  if (storyData.length && ! isError) {
    // Identify the reference on the first user story.
    const firstData = storyData[0];
    // Identify and shorten the reference to that user story.
    const firstRef = shorten('userstory', 'hierarchicalrequirement', firstData[0]);
    if (! isError) {
      // Get data on the first user story of the specified array.
      return getData(
        firstRef, ['Name', 'Description', 'Owner', 'DragAndDropRank', 'Children']
      )
      .then(
        storyResult => {
          // When the data arrive:
          const storyObj = storyResult.Object;
          const name = storyObj.Name;
          const description = storyObj.Description;
          const owner = storyObj.Owner;
          const rank = storyObj.DragAndDropRank;
          const childrenSummary = storyObj.Children;
          // If the user story is the specified parent of the tree copy:
          if (firstRef === treeCopyParentRef) {
            /*
              Quit and report the precondition violation. The parent of
              the copy must be outside the original tree.
            */
            err('Attempt to copy to itself', 'copying tree');
            return '';
          }
          // Otherwise:
          else {
            // Copy the user story and give it the specified parent.
            return restAPI.create({
              type: 'hierarchicalrequirement',
              fetch: ['_ref'],
              data: {
                Name: name,
                Description: description,
                Owner: owner,
                DragAndDropRank: rank,
                Parent: copyParentRef
              }
            })
            .then(
              // When the user story has been copied and linked:
              copy => {
                upTotal('total');
                // If the original has any child user stories:
                if (childrenSummary.Count) {
                  const copyRef = copy.Object._ref;
                  // Get data on them.
                  return getData(childrenSummary._ref, ['_ref', 'DragAndDropRank'])
                  .then(
                    // When the data arrive, process the children sequentially.
                    childrenResult => {
                      const childData = childrenResult.Object.Results.map(
                        child => [child._ref, child.DragAndDropRank]
                      );
                      return copyTree(childData, copyRef)
                      .then(
                        () => copyTree(storyData.slice(1), copyParentRef),
                        error => err(error, 'copying child user stories')
                      );
                    },
                    error => err(
                      error, 'getting data on child user stories for copying'
                    )
                  );
                }
                // Otherwise:
                else {
                  /*
                    Process the rest of the specified user stories
                    sequentially to prevent concurrency errors.
                  */
                  return copyTree(storyData.slice(1), copyParentRef);
                }
              },
              error => err(error, 'copying user story')
            );
          }
        },
        error => err(error, 'getting data on user story to copy')
      );
    }
  }
  else {
    return Promise.resolve('');
  }
};
// Gets a short reference to a user.
const getUserRef = name => {
  return restAPI.query({
    type: 'user',
    query: queryUtils.where('UserName', '=', name)
  })
  .then(
    result => {
      const resultArray = result.Results;
      if (resultArray.length) {
        return shorten('user', 'user', resultArray[0]._ref);
      }
      else {
        err('No such user', 'getting reference to user');
        return '';
      }
    },
    error => {
      err(error, 'getting reference to user');
      return '';
    }
  );
};
// Serves a page.
const servePage = (content, isReport) => {
  response.setHeader('Content-Type', 'text/html');
  response.write(content);
  response.end();
  if (isReport) {
    reportServed = true;
  }
};
// Serves the introduction page.
const serveIntro = () => {
  fs.readFile('index.html', 'utf8')
  .then(
    content => {
      servePage(content, false);
    },
    error => err(error, 'reading intro page')
  );
};
// Serves the request page.
const serveDo = () => {
  fs.readFile('do.html', 'utf8')
  .then(
    content => {
      const newContent = content
      .replace('__userName__', RALLY_USERNAME)
      .replace('__password__', RALLY_PASSWORD);
      servePage(newContent, false);
    },
    error => err(error, 'reading do page')
  );
};
// Interpolates universal content into a report.
const reportPrep = (content, jsContent) => {
  return content
  .replace('__script__', jsContent)
  .replace('__rootRef__', rootRef)
  .replace('__userName__', userName)
  .replace('__userRef__', userRef);
};
// Serves the change-owner report page.
const serveDocReport = () => {
  fs.readFile('docReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('docReport.js', 'utf8')
      .then(
        jsContent => {
          const newContent = reportPrep(htmlContent, jsContent);
          servePage(newContent, true);
        },
        error => err(error, 'reading docReport script')
      );
    },
    error => err(error, 'reading docReport page')
  );
};
// Serves the change-owner report page.
const serveVerdictReport = () => {
  fs.readFile('verdictReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('verdictReport.js', 'utf8')
      .then(
        jsContent => {
          const newContent = reportPrep(htmlContent, jsContent);
          servePage(newContent, true);
        },
        error => err(error, 'reading verdictReport script')
      );
    },
    error => err(error, 'reading verdictReport page')
  );
};
// Serves the change-owner report page.
const serveTakeReport = (takerName) => {
  fs.readFile('takeReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('takeReport.js', 'utf8')
      .then(
        jsContent => {
          const newContent = reportPrep(htmlContent, jsContent)
          .replace('__takerName__', takerName)
          .replace('__takerRef__', takerRef);
          servePage(newContent, true);
        },
        error => err(error, 'reading takeReport script')
      );
    },
    error => err(error, 'reading takeReport page')
  );
};
// Serves the add-tasks report page.
const serveTaskReport = () => {
  fs.readFile('taskReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('taskReport.js', 'utf8')
      .then(
        jsContent => {
          const taskCount = `${taskNames.length} task${
            taskNames.length > 1 ? 's' : ''
          }`;
          const newContent = reportPrep(htmlContent, jsContent)
          .replace('__taskCount__', taskCount)
          .replace('__taskNames__', taskNames.join('\n'));
          servePage(newContent, true);
        },
        error => err(error, 'reading taskReport script')
      );
    },
    error => err(error, 'reading taskReport page')
  );
};
// Serves the add-test-cases report page.
const serveCaseReport = () => {
  fs.readFile('caseReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('caseReport.js', 'utf8')
      .then(
        jsContent => {
          const newContent = reportPrep(htmlContent, jsContent);
          servePage(newContent, true);
        },
        error => err(error, 'reading caseReport script')
      );
    },
    error => err(error, 'reading caseReport page')
  );
};
// Serves the copy report page.
const serveCopyReport = () => {
  fs.readFile('copyReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('copyReport.js', 'utf8')
      .then(
        jsContent => {
          const newContent = reportPrep(htmlContent, jsContent)
          .replace('__parentRef__', treeCopyParentRef);
          servePage(newContent, true);
        },
        error => err(error, 'reading caseReport script')
      );
    },
    error => err(error, 'reading caseReport page')
  );
};
// Serves the stylesheet.
const serveStyles = () => {
  fs.readFile('style.css', 'utf8')
  .then(
    content => {
      response.setHeader('Content-Type', 'text/css');
      response.write(content);
      response.end();
    },
    error => err(error, 'reading stylesheet')
  );
};
// Serves an image.
const servePNG = src => {
  fs.readFile(src.replace(/^\//, ''))
  .then(
    content => {
      response.setHeader('Content-Type', 'image/png');
      response.write(content, 'binary');
      response.end();
    },
    error =>  err(error, 'reading PNG image')
  );
};
// Serves the site icon.
const serveIcon = () => {
  fs.readFile('favicon.ico')
  .then(
    content => {
      response.setHeader('Content-Type', 'image/x-icon');
      response.write(content, 'binary');
      response.end();
    },
    error => err(error, 'reading site icon')
  );
};
// Prepares to serve an event stream.
const serveEventStart = () => {
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Connection', 'keep-alive');
};
// Reinitializes the event-stream variables and starts an event stream.
const streamInit = () => {
  idle = false;
  total = changes = 0;
  serveEventStart();
};
/*
  Handles requests, serving the home page, the request page, and the
  acknowledgement page.
*/
const requestHandler = (request, res) => {
  response = res;
  const {method} = request;
  const bodyParts = [];
  request.on('error', err => {
    console.error(err);
  })
  .on('data', chunk => {
    bodyParts.push(chunk);
  })
  .on('end', () => {
    const requestURL = request.url;
    // If the request requests a resource:
    if (method === 'GET') {
      // If the requested resource is a file, serve it.
      if (requestURL === '/' || requestURL === '/index.html') {
        // Serves the introduction page.
        serveIntro();
      }
      else if (requestURL === '/do.html') {
        // Serves the request page.
        serveDo();
      }
      else if (requestURL === '/style.css') {
        // Serves the stylesheet when the home page requests it.
        serveStyles();
      }
      else if (requestURL.endsWith('.png')) {
        // Serves a PNG image when a page requests it.
        servePNG(requestURL);
      }
      else if (requestURL === '/favicon.ico') {
        // Serves the site icon when a page requests it.
        serveIcon();
      }
      /*
        Otherwise, if the requested resource is an event stream, start it
        and prevent any others from being started.
      */
      else if (requestURL === '/doc' && idle) {
        streamInit();
        docTree(rootRef, doc, 0, []);
      }
      else if (requestURL === '/verdicttotals' && idle) {
        streamInit();
        verdictTree(rootRef);
      }
      else if (requestURL === '/taketotals' && idle) {
        streamInit();
        takeTree(rootRef);
      }
      else if (requestURL === '/tasktotals' && idle) {
        streamInit();
        taskTree([rootRef]);
      }
      else if (requestURL === '/casetotals' && idle) {
        streamInit();
        caseTree([rootRef]);
      }
      else if (requestURL === '/copytotals' && idle) {
        streamInit();
        copyTree([[rootRef, 1]], treeCopyParentRef);
      }
    }
    // Otherwise, if the request submits the request form:
    else if (method === 'POST' && requestURL === '/do.html') {
      reinit();
      // Permit an event stream to be started.
      idle = true;
      const bodyObject = parse(Buffer.concat(bodyParts).toString());
      userName = bodyObject.userName;
      const {
        password, rootID, op, takerName, parentID, taskNameString, testFolderID
      } = bodyObject;
      RALLY_USERNAME = userName;
      RALLY_PASSWORD = password;
      // Create and configure a Rally API client.
      restAPI = rally({
        user: userName,
        pass: password,
        requestOptions
      });
      // Get a long reference to the root user story.
      getRefOf('hierarchicalrequirement', rootID, 'tree root')
      .then(
        // When it arrives:
        ref => {
          if (! isError) {
            rootRef = shorten('userstory', 'hierarchicalrequirement', ref);
            if (! isError) {
              // Get a reference to the user.
              getUserRef(userName)
              .then(
                // When it arrives:
                ref => {
                  if (! isError) {
                    userRef = ref;
                    // If the requested operation is tree documentation:
                    if (op === 'doc') {
                      // Serve a report of the tree documentation.
                      serveDocReport();
                    }
                    // Otherwise, if the operation is test-result acquisition:
                    else if (op === 'verdict') {
                      // Serve a report of the test results.
                      serveVerdictReport();
                    }
                    // Otherwise, if the operation is ownership change:
                    else if (op === 'take') {
                      // If an owner other than the user was specified:
                      if (takerName) {
                        // Serve a report identifying the new owner.
                        getUserRef(takerName)
                        .then(
                          ref => {
                            if (! isError) {
                              takerRef = ref;
                              serveTakeReport(takerName);
                            }
                          },
                          error => err(
                            error, 'getting reference to new owner'
                          )
                        );
                      }
                      // Otherwise, the new owner will be the user, so:
                      else {
                        takerRef = userRef;
                        // Serve a report identifying the user as new owner.
                        serveTakeReport(userName);
                      }
                    }
                    // Otherwise, if the operation is task creaation:
                    else if (op === 'task') {
                      if (taskNameString.length < 2) {
                        err('Task names invalid', 'creating tasks');
                      }
                      else {
                        const delimiter = taskNameString[0];
                        taskNames.push(...taskNameString.slice(1).split(delimiter));
                        if (taskNames.every(taskName => taskName.length)) {
                          serveTaskReport();
                        }
                        else {
                          err('Empty task name', 'creating tasks');
                        }
                      }
                    }
                    // Otherwise, if the operation is test-case creation:
                    else if (op === 'case') {
                      // If a test folder was specified:
                      if (testFolderID) {
                        getRefOf('testfolder', testFolderID, 'test-case creation')
                        .then(
                          ref => {
                            if (! isError) {
                              testFolderRef = shorten('testfolder', 'testfolder', ref);
                              if (! isError) {
                                // Get data on the test folder.
                                getData(testFolderRef, ['_ref'])
                                .then(
                                  () => {
                                    // Serve a report on test-case creation.
                                    serveCaseReport();
                                  },
                                  error => err(error, 'getting data on test folder')
                                );
                              }
                            }
                          },
                          error => err(error, 'getting reference to test folder')
                        );
                      }
                      // Otherwise, i.e. if no test folder was specified:
                      else {
                        // Serve a report on test-case creation.
                        serveCaseReport();
                      }
                    }
                    // Otherwise, if the operation is tree copying:
                    else if (op === 'copy') {
                      getRefOf('hierarchicalrequirement', parentID, 'parent of tree copy')
                      .then(
                        ref => {
                          if (! isError) {
                            treeCopyParentRef = shorten(
                              'userstory', 'hierarchicalrequirement', ref
                            );
                            if (! isError) {
                              // Get data on the parent user story of the copy.
                              getData(treeCopyParentRef, ['Tasks'])
                              .then(
                                storyResult => {
                                  // When the data arrive:
                                  const storyObj = storyResult.Object;
                                  const tasksSummary = storyObj.Tasks;
                                  if (tasksSummary.Count) {
                                    err(
                                      'Attempt to copy to a user story with tasks', 'copying tree'
                                    );
                                  }
                                  else {
                                    // Copy the user story and give it the specified parent.
                                    serveCopyReport();
                                  }
                                },
                                error => err(
                                  error, 'getting data on parent of tree copy'
                                )
                              );
                            }
                          }
                        },
                        error => err(
                          error, 'getting reference to parent of tree copy'
                        )
                      );
                    }
                    else {
                      err('Unknown operation', 'RallyTree');
                    }
                  }
                },
                error => err(error, 'getting reference to user')
              );
            }
          }
        },
        error => err(error, 'getting long reference to root user story')
      );
    }
    else {
      err('Unanticipated request', 'RallyTree');
    }
  });
};

// ########## SERVER

const server = http.createServer(requestHandler);
const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Use a web browser to visit localhost:${port}.`);
});
