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
let userRef = '';
let takerRef = '';
let taskNames = [];
let rootRef = '';
let treeCopyParentRef = '';
let total = 0;
let changes = 0;
let passes = 0;
let fails = 0;
let idle = false;
let reportServed = false;
let {RALLY_USERNAME, RALLY_PASSWORD} = process.env;
RALLY_USERNAME = RALLY_USERNAME || '';
RALLY_PASSWORD = RALLY_PASSWORD || '';
let tryAgain = false;
const maxTries = 20;
let tries = 0;

// ########## FUNCTIONS

// Reinitialize the global variables, except response.
const reinit = () => {
  isError = false;
  restAPI = {};
  userRef = '';
  takerRef = '';
  taskNames = [];
  rootRef = '';
  treeCopyParentRef = '';
  total = 0;
  changes = 0;
  passes = 0;
  fails = 0;
  idle = false;
  reportServed = false;
  tries = 0;
};
// Processes a thrown error.
const err = (error, context) => {
  let problem;
  // If error is application-defined, remove newlines.
  if (typeof error === 'string') {
    problem = error.replace(/\n/g, ' ');
  }
  // Otherwise, if system-defined:
  else {
    // If HTML-formatted, reduce it to a string.
    problem = error.message.replace(
      /^.+<title>|^.+<Errors>|<\/title>.+$|<\/Errors>.+$/gs, ''
    );
  }
  const msg = `Error ${context}: ${problem}`;
  console.log(msg);
  isError = true;
  // If a report page has been served:
  if (reportServed) {
    // Insert the error message there.
    response.write(`event: error\ndata: ${msg}\n\n`);
    response.end();
  }
  // Otherwise:
  else {
    // Serve an error page containing the error message.
    fs.readFile('error.html', 'utf8')
    .then(
      content => {
        const newContent = content.replace(
          '__errorMessage__', msg
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
const shorten = (type, longRef) => {
  // If it is already a short reference, return it.
  if (/^\/[a-z]+\/\d+$/.test(longRef)) {
    return longRef;
  }
  else {
    // If not, return its short version.
    const num = longRef.replace(/^http.+([/]|%2F)(?=\d+)/, '');
    if (/^\d+$/.test(num)) {
      return `/${type}/${num}`;
    }
    else {
      err(
        `Invalid Rally URL:\nlong ${longRef}\nshort /${type}/${num}`,
        'shortening URL'
      );
      return '';
    }
  }
};
// Increments the total count and sends the new count as an event.
const upTotal = () => {
  response.write(`event: total\ndata: ${++total}\n\n`);
};
/*
  Increments the total count and the change count and sends
  the counts as events.
*/
const upTotals = changeCount => {
  const totalMsg = `event: total\ndata: ${++total}\n\n`;
  changes += changeCount;
  const changeMsg = changeCount
    ? `event: changes\ndata: ${changes}\n\n`
    : '';
  response.write(`${totalMsg}${changeMsg}`);
};
/*
  Increments the total count and the change count and sends
  the counts as events.
*/
const upVerdicts = isPass=> {
  const totalMsg = `event: total\ndata: ${++total}\n\n`;
  let changeMsg;
  if (isPass) {
    passes++;
    changeMsg = `event: passes\ndata: ${passes}\n\n`;
  }
  else {
    fails++;
    changeMsg = `event: fails\ndata: ${fails}\n\n`;
  }
  response.write(`${totalMsg}${changeMsg}`);
};
// Recursively acquires test results from a tree of user stories.
const verdictTree = storyRef => {
  // Get data on the user story.
  restAPI.get({
    ref: storyRef,
    fetch: ['Children', 'TestCases']
  })
  .then(
    storyResult => {
      // When the data arrive:
      const storyObj = storyResult.Object;
      const caseSummary = storyObj.TestCases;
      const caseCount = caseSummary.Count;
      const childrenSummary = storyObj.Children;
      const childCount = childrenSummary.Count;
      // If the user story has any test cases and no child user stories:
      if (caseCount && ! childCount) {
        // Get the data on the test cases.
        restAPI.get({
          ref: caseSummary._ref,
          fetch: ['_ref', 'LastVerdict']
        })
        .then(
          // When the data arrive:
          casesObj => {
            const cases = casesObj.Object.Results;
            // Process the test cases in parallel.
            cases.forEach(caseObj => {
              const verdict = caseObj.LastVerdict;
              if (verdict === 'pass'){
                upVerdicts(true);
              }
              else if (verdict === 'fail') {
                upVerdicts(false);
              }
            });
          },
          error => err(error, 'getting data on test cases')
        );
      }
      /*
        Otherwise, if the user story has any child user stories and
        no test cases:
      */
      else if (childCount && ! caseCount) {
        // Get data on its child user stories.
        restAPI.get({
          ref: childrenSummary._ref,
          fetch: ['_ref']
        })
        .then(
          // When the data arrive, process the children in parallel.
          childrenObj => {
            const children = childrenObj.Object.Results;
            children.forEach(child => {
              if (! isError) {
                const childRef = shorten(
                  'hierarchicalrequirement', child._ref
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
    const taskRef = shorten('task', taskObj._ref);
    if (! isError) {
      const taskOwner = taskObj.Owner;
      const ownerRef = taskOwner ? shorten('user', taskOwner._ref) : '';
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
  restAPI.get({
    ref: storyRef,
    fetch: ['Owner', 'Children', 'Tasks']
  })
  .then(
    storyResult => {
      // When the data arrive:
      const storyObj = storyResult.Object;
      const owner = storyObj.Owner;
      const ownerRef = owner ? shorten('user', storyObj.Owner._ref) : '';
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
      /*
        Wait until the ownership change is complete to prevent
        concurrency errors.
      */
      .then(
        () => {
          upTotals(changeCount);
          // If the user story has any tasks and no child user stories:
          if (taskCount && ! childCount) {
            // Get the data on the tasks.
            restAPI.get({
              ref: tasksSummary._ref,
              fetch: ['_ref', 'Owner']
            })
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
            restAPI.get({
              ref: childrenSummary._ref,
              fetch: ['_ref']
            })
            .then(
              // When the data arrive, process the children in parallel.
              childrenObj => {
                const children = childrenObj.Object.Results;
                children.forEach(child => {
                  if (! isError) {
                    const childRef = shorten(
                      'hierarchicalrequirement', child._ref
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
// Repeatedly tries to create a task for a user story.
const createTask = (storyRef, owner, taskName) => {
  if (! isError) {
    restAPI.create({
      type: 'task',
      fetch: ['_ref'],
      data: {
        Name: taskName,
        WorkProduct: storyRef,
        Owner: owner
      }
    })
    .then(
      () => {
        tries = 0;
      },
      error => {
        if (++tries < maxTries) {
          createTask(storyRef, owner, taskName);
        }
        else {
          err(error, 'creating task');
        }
      }
    );
  }
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
// Recursively creates tasks for a tree of user stories with retries.
const taskTree1 = storyRef => {
  if (! isError) {
    const ref = shorten('hierarchicalrequirement', storyRef);
    if (! isError) {
      // Get data on the user story.
      restAPI.get({
        ref,
        fetch: ['Owner', 'Children']
      })
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
            restAPI.get({
              ref: childrenSummary._ref,
              fetch: ['_ref']
            })
            .then(
              // When the data arrive, process the children in parallel.
              childrenResult => {
                const childRefs = childrenResult.Object.Results.map(
                  child => child._ref
                );
                childRefs.forEach(childRef => {
                  taskTree1(childRef);
                });
              },
              error => err(
                error,
                'getting data on child user stories for task creation'
              )
            );
          }
          // Otherwise the user story needs tasks, so:
          else {
            // Create them in parallel.
            taskNames.forEach(taskName => {
              createTask(ref, owner, taskName);
            });
            if (! isError) {
              upTotals(taskNames.length);
            }
          }
        },
        error => err(
          error, 'getting data on first user story for task creation'
        )
      );
    }
  }
};
// Recursively creates tasks for a tree or subtrees of user stories.
const taskTree = storyRefs => {
  if (storyRefs.length && ! isError) {
    const firstRef = shorten('hierarchicalrequirement', storyRefs[0]);
    if (! isError) {
      // Get data on the first user story of the specified array.
      restAPI.get({
        ref: firstRef,
        fetch: ['Owner', 'Children']
      })
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
            restAPI.get({
              ref: childrenSummary._ref,
              fetch: ['_ref']
            })
            .then(
              /*
                When the data arrive, process the children sequentially
                to prevent concurrency errors.
              */
              childrenResult => {
                const childRefs = childrenResult.Object.Results.map(
                  child => child._ref
                );
                taskTree(childRefs);
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
            createTasks(firstRef, owner, taskNames)
            // When they have been created:
            .then(
              () => {
                if (! isError) {
                  upTotals(taskNames.length);
                  /*
                    Process the rest of the specified user stories
                    sequentially to prevent concurrency errors.
                  */
                  taskTree(storyRefs.slice(1));
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
};
// Repetitively tries to link a test case to a user story.
const linkCase = (testCase, storyRef) => {
  const caseRef = shorten('testcase', testCase.Object._ref);
  if (! isError) {
    restAPI.add({
      ref: storyRef,
      collection: 'TestCases',
      data: [{_ref: caseRef}],
      fetch: ['_ref']
    })
    .then(
      () => {
        upTotals(1);
        tries = 0;
      },
      error => {
        if (++tries < maxTries) {
          linkCase(testCase, storyRef);
        }
        else {
          err(error, 'adding test case to user story');
        }
      }
    );
  }
};
// Recursively creates test cases for a tree of user stories with retries.
const caseTree1 = storyRef => {
  if (! isError) {
    const ref = shorten('hierarchicalrequirement', storyRef);
    if (! isError) {
      // Get data on the user story.
      restAPI.get({
        ref,
        fetch: ['Name', 'Description', 'Owner', 'Children']
      })
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
            restAPI.get({
              ref: childrenSummary._ref,
              fetch: ['_ref']
            })
            .then(
              // When the data arrive, process the children in parallel.
              childrenResult => {
                const childRefs = childrenResult.Object.Results.map(
                  child => child._ref
                );
                childRefs.forEach(childRef => {
                  caseTree1(childRef);
                });
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
            restAPI.create({
              type: 'testcase',
              fetch: ['_ref'],
              data: {
                Name: name,
                Description: description,
                Owner: owner
              }
            })
            .then(
              // After it is created:
              newCase => {
                // Link it to the user story.
                linkCase(newCase, storyRef);
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
};
// Recursively creates test cases for a tree or subtrees of user stories.
const caseTree = storyRefs => {
  if (storyRefs.length && ! isError) {
    const firstRef = shorten('hierarchicalrequirement', storyRefs[0]);
    if (! isError) {
      // Get data on the first user story of the specified array.
      restAPI.get({
        ref: firstRef,
        fetch: ['Name', 'Description', 'Owner', 'Children']
      })
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
            restAPI.get({
              ref: childrenSummary._ref,
              fetch: ['_ref']
            })
            .then(
              /*
                When the data arrive, process the children sequentially to
                prevent concurrency errors.
              */
              childrenResult => {
                const childRefs = childrenResult.Object.Results.map(
                  child => child._ref
                );
                caseTree(childRefs);
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
            restAPI.create({
              type: 'testcase',
              fetch: ['_ref'],
              data: {
                Name: name,
                Description: description,
                Owner: owner
              }
            })
            .then(
              // After it is created:
              newCase => {
                // Link it to the user story.
                const caseRef = shorten('testcase', newCase.Object._ref);
                if (! isError) {
                  restAPI.add({
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
                      caseTree(storyRefs.slice(1));
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
};
// Repetitively tries to copy a user story.
const copyStory = (ref, copyParentRef, name, description, owner) => {
  return restAPI.create({
    type: 'hierarchicalrequirement',
    fetch: ['_ref'],
    data: {
      Name: name,
      Description: description,
      Owner: owner,
      Parent: copyParentRef
    }
  })
  .then(
    copy => {
      upTotal();
      tries = 0;
      return copy;
    },
    error => {
      if (++tries < maxTries) {
        return copyStory(ref, copyParentRef, name, description, owner);
      }
      else {
        err(error, 'copying user story');
        return '';
      }
    }
  );
};
// Recursively copies a tree of user stories with retries.
const copyTree1 = (storyRef, copyParentRef) => {
  if (! isError) {
    const ref = shorten('hierarchicalrequirement', storyRef);
    if (! isError) {
      // Get data on the user story.
      restAPI.get({
        ref,
        fetch: ['Name', 'Description', 'Owner', 'Children']
      })
      .then(
        story => {
          // When the data arrive:
          const storyObj = story.Object;
          const name = storyObj.Name;
          const description = storyObj.Description;
          const owner = storyObj.Owner;
          const childrenSummary = storyObj.Children;
          // If the user story is the specified parent of the tree copy:
          if (ref === treeCopyParentRef) {
            /*
              Quit and report the precondition violation. The parent of
              the copy must be outside the original tree.
            */
            err('Attempt to copy to itself', 'copying tree');
          }
          // Otherwise:
          else {
            // Copy the user story and give it the specified parent.
            copyStory(ref, copyParentRef, name, description, owner)
            .then(
              // When the user story has been copied and linked:
              copy => {
                // If the original has any child user stories:
                if (childrenSummary.Count && ! isError) {
                  const copyRef = copy.Object._ref;
                  // Get data on them.
                  restAPI.get({
                    ref: childrenSummary._ref,
                    fetch: ['_ref']
                  })
                  .then(
                    // When the data arrive, process the children in parallel.
                    childrenResult => {
                      const childRefs = childrenResult.Object.Results.map(
                        child => child._ref
                      );
                      childRefs.forEach(childRef => {
                        copyTree1(childRef, copyRef);
                      });
                    },
                    error => err(
                      error, 'getting data on child user stories for copying'
                    )
                  );
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
};
// Recursively copies a tree or subtrees of user stories.
const copyTree = (storyRefs, copyParentRef) => {
  if (storyRefs.length && ! isError) {
    const firstRef = shorten('hierarchicalrequirement', storyRefs[0]);
    if (! isError) {
      // Get data on the first user story of the specified array.
      restAPI.get({
        ref: firstRef,
        fetch: ['Name', 'Description', 'Owner', 'Children']
      })
      .then(
        storyResult => {
          // When the data arrive:
          const storyObj = storyResult.Object;
          const name = storyObj.Name;
          const description = storyObj.Description;
          const owner = storyObj.Owner;
          const childrenSummary = storyObj.Children;
          // If the user story is the specified parent of the tree copy:
          if (firstRef === treeCopyParentRef) {
            /*
              Quit and report the precondition violation. The parent of
              the copy must be outside the original tree.
            */
            err('Attempt to copy to itself', 'copying tree');
          }
          // Otherwise:
          else {
            // Copy the user story and give it the specified parent.
            restAPI.create({
              type: 'hierarchicalrequirement',
              fetch: ['_ref'],
              data: {
                Name: name,
                Description: description,
                Owner: owner,
                Parent: copyParentRef
              }
            })
            .then(
              // When the user story has been copied and linked:
              copy => {
                upTotal();
                // If the original has any child user stories:
                if (childrenSummary.Count) {
                  const copyRef = copy.Object._ref;
                  // Get data on them.
                  restAPI.get({
                    ref: childrenSummary._ref,
                    fetch: ['_ref']
                  })
                  .then(
                    /*
                      When the data arrive, process the children sequentially
                      to prevent concurrency errors.
                    */
                    childrenResult => {
                      const childRefs = childrenResult.Object.Results.map(
                        child => child._ref
                      );
                      copyTree(childRefs, copyRef);
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
                  copyTree(storyRefs.slice(1), copyParentRef);
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
};
// Gets a reference to a user.
const getUserRef = userName => {
  return restAPI.query({
    type: 'user',
    query: queryUtils.where('UserName', '=', userName)
  })
  .then(
    userRef => shorten('user', userRef.Results[0]._ref),
    error => {
      err(error, 'getting user reference');
      return '';
    }
  );
};
// Serves the introduction page.
const serveIntro = () => {
  fs.readFile('index.html', 'utf8')
  .then(
    content => {
      response.setHeader('Content-Type', 'text/html');
      response.write(content);
      response.end();
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
      response.setHeader('Content-Type', 'text/html');
      response.write(newContent);
      response.end();
    },
    error => err(error, 'reading do page')
  );
};
// Serves the change-owner report page.
const serveVerdictReport = userName => {
  fs.readFile('verdictReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('verdictReport.js', 'utf8')
      .then(
        jsContent => {
          const newContent = htmlContent
          .replace('__script__', jsContent)
          .replace('__rootRef__', rootRef)
          .replace('__userName__', userName)
          .replace('__userRef__', userRef);
          response.setHeader('Content-Type', 'text/html');
          response.write(newContent);
          response.end();
          reportServed = true;
        },
        error => err(error, 'reading verdictReport script')
      );
    },
    error => err(error, 'reading verdictReport page')
  );
};
// Serves the change-owner report page.
const serveTakeReport = (userName, takerName) => {
  fs.readFile('takeReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('takeReport.js', 'utf8')
      .then(
        jsContent => {
          const newContent = htmlContent
          .replace('__script__', jsContent)
          .replace('__rootRef__', rootRef)
          .replace('__takerName__', takerName)
          .replace('__takerRef__', takerRef)
          .replace('__userName__', userName)
          .replace('__userRef__', userRef);
          response.setHeader('Content-Type', 'text/html');
          response.write(newContent);
          response.end();
          reportServed = true;
        },
        error => err(error, 'reading takeReport script')
      );
    },
    error => err(error, 'reading takeReport page')
  );
};
// Serves the add-tasks report page.
const serveTaskReport = userName => {
  fs.readFile('taskReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('taskReport.js', 'utf8')
      .then(
        jsContent => {
          const taskCount = `${taskNames.length} task${
            taskNames.length > 1 ? 's' : ''
          }`;
          const newContent = htmlContent
          .replace('__script__', jsContent)
          .replace('__taskCount__', taskCount)
          .replace('__taskNames__', taskNames.join('\n'))
          .replace('__rootRef__', rootRef)
          .replace('__userName__', userName)
          .replace('__userRef__', userRef);
          response.setHeader('Content-Type', 'text/html');
          response.write(newContent);
          response.end();
          reportServed = true;
        },
        error => err(error, 'reading taskReport script')
      );
    },
    error => err(error, 'reading taskReport page')
  );
};
// Serves the add-test-cases report page.
const serveCaseReport = userName => {
  fs.readFile('caseReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('caseReport.js', 'utf8')
      .then(
        jsContent => {
          const newContent = htmlContent
          .replace('__script__', jsContent)
          .replace('__rootRef__', rootRef)
          .replace('__userName__', userName)
          .replace('__userRef__', userRef);
          response.setHeader('Content-Type', 'text/html');
          response.write(newContent);
          response.end();
          reportServed = true;
        },
        error => err(error, 'reading caseReport script')
      );
    },
    error => err(error, 'reading caseReport page')
  );
};
// Serves the copy report page.
const serveCopyReport = userName => {
  fs.readFile('copyReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('copyReport.js', 'utf8')
      .then(
        jsContent => {
          const newContent = htmlContent
          .replace('__script__', jsContent)
          .replace('__rootRef__', rootRef)
          .replace('__parentRef__', treeCopyParentRef)
          .replace('__userName__', userName)
          .replace('__userRef__', userRef);
          response.setHeader('Content-Type', 'text/html');
          response.write(newContent);
          response.end();
          reportServed = true;
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
// Reinitialize the event-stream variables and start an event stream.
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
        tryAgain ? taskTree1(rootRef) : taskTree([rootRef]);
      }
      else if (requestURL === '/casetotals' && idle) {
        streamInit();
        tryAgain ? caseTree1(rootRef) : caseTree([rootRef]);
      }
      else if (requestURL === '/copytotals' && idle) {
        streamInit();
        tryAgain
          ? copyTree1(rootRef, treeCopyParentRef)
          : copyTree([rootRef], treeCopyParentRef);
      }
    }
    // Otherwise, if the request submits the request form:
    else if (method === 'POST' && requestURL === '/do.html') {
      reinit();
      // Permit an event stream to be started.
      idle = true;
      const bodyObject = parse(Buffer.concat(bodyParts).toString());
      const {
        userName,
        password,
        rootURL,
        op,
        takerName,
        parentURL,
        taskNameString,
        concurrencyMode
      } = bodyObject;
      tryAgain = concurrencyMode === 'try';
      RALLY_USERNAME = userName;
      RALLY_PASSWORD = password;
      rootRef = shorten('hierarchicalrequirement', rootURL);
      // Create and configure a Rally API client.
      if (! isError) {
        restAPI = rally({
          user: userName,
          pass: password,
          requestOptions
        });
        // Get a reference to the user.
        getUserRef(userName)
        .then(
          ref => {
            if (! isError) {
              userRef = ref;
              // If the requested operation is test-result acquisition:
              if (op === 'verdict') {
                // Serve a report of the test results.
                serveVerdictReport(userName);
              }
              // If the requested operation is ownership change:
              else if (op === 'take') {
                // If an owner other than the user was specified:
                if (takerName) {
                  // Serve a report identifying the new owner.
                  getUserRef(takerName)
                  .then(
                    ref => {
                      if (! isError) {
                        takerRef = ref;
                        serveTakeReport(userName, takerName);
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
                  serveTakeReport(userName, userName);
                }
              }
              // Otherwise, if the requested operation is task creaation:
              else if (op === 'task') {
                if (taskNameString.length < 2) {
                  err('Task names invalid', 'creating tasks');
                }
                else {
                  const delimiter = taskNameString[0];
                  taskNames.push(...taskNameString.slice(1).split(delimiter));
                  if (taskNames.every(taskName => taskName.length)) {
                    serveTaskReport(userName);
                  }
                  else {
                    err('Empty task name', 'creating tasks');
                  }
                }
              }
              // Otherwise, if the requested operation is test-case creation:
              else if (op === 'case') {
                serveCaseReport(userName);
              }
              // Otherwise, if the requested operation is tree copying:
              else if (op === 'copy') {
                treeCopyParentRef = shorten('hierarchicalrequirement', parentURL);
                if (! isError) {
                  // Get data on the parent user story of the copy.
                  restAPI.get({
                    ref: treeCopyParentRef,
                    fetch: ['Tasks']
                  })
                  .then(
                    storyResult => {
                      // When the data arrive:
                      const storyObj = storyResult.Object;
                      const tasksSummary = storyObj.Tasks;
                      if (tasksSummary.Count) {
                        err(
                          'Attempt to copy to a user story with tasks',
                          'copying tree'
                        );
                      }
                      else {
                        // Copy the user story and give it the specified parent.
                        serveCopyReport(userName);
                      }
                    },
                    error => err(error, 'getting data on parent of tree copy')
                  );
                }
              }
              else {
                err('Unanticipated request', 'RallyTree');
              }
            }
          },
          error => err(error, 'getting reference to user')
        );
      }
    }
  });
};

// ########## SERVER

const server = http.createServer(requestHandler);
const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Use a web browser to visit localhost:${port}.`);
});
