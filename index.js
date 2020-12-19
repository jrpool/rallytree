/*
  index.js
  RallyTree main script.
*/

// ########## IMPORTS

// Module to access files.
const fs = require('fs').promises;
// Module to open files or URLs.
const open = require('open');
// Module to keep secrets local.
require('dotenv').config();
// Module to specify custom test-case creation.
let caseData;
try {
  caseData = require('./data/caseData').caseData;
}
catch (error) {
  caseData = {};
}
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
let build = '';
let copyWhat = 'both';
let isError = false;
let iterationRef = '';
let note = '';
let releaseRef = '';
let response = {};
let restAPI = {};
let rootRef = '';
let scheduleState = 'unchanged';
let takerRef = '';
let taskNames = [];
let testFolderRef = '';
let testSetRef = '';
let treeCopyParentRef = '';
let userName = '';
let userRef = '';
let totals = {
  caseChanges: 0,
  caseTotal: 0,
  changes: 0,
  defects: 0,
  fails: 0,
  major: 0,
  minor: 0,
  passes: 0,
  storyChanges: 0,
  storyTotal: 0,
  taskChanges: 0,
  taskTotal: 0,
  total: 0
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
  build = '';
  copyWhat = 'both';
  isError = false;
  iterationRef = '';
  note = '';
  releaseRef = '';
  restAPI = {};
  rootRef = '';
  scheduleState = 'unchanged';
  takerRef = '';
  taskNames = [];
  testFolderRef = '';
  testSetRef = '';
  treeCopyParentRef = '';
  userName = '';
  userRef = '';
  totals = {
    caseChanges: 0,
    caseTotal: 0,
    changes: 0,
    defects: 0,
    fails: 0,
    major: 0,
    minor: 0,
    passes: 0,
    storyChanges: 0,
    storyTotal: 0,
    taskChanges: 0,
    taskTotal: 0,
    total: 0
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
  return '';
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
// Returns the long reference of a member of a collection with a formatted ID.
const getRef = (type, formattedID, context) => {
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
// Returns the long reference of a member of a collection with a name.
const getNameRef = (type, name, context) => {
  if (name.length) {
    return restAPI.query({
      type,
      fetch: '_ref',
      query: queryUtils.where('Name', '=', name)
    })
    .then(
      result => {
        const resultArray = result.Results;
        if (resultArray.length) {
          return resultArray[0]._ref;
        }
        else {
          return err('No such name', `getting reference to ${type} for ${context}`);
        }
      },
      error => err(error, `getting reference to ${type} for ${context}`)
    );
  }
  else {
    err('Empty name', `getting reference to ${type} for ${context}`);
    return Promise.resolve('');
  }
};
// Returns an event-stream message reporting an incremented total.
const eventMsg = (
  eventName, addCount = 1
) => `event: ${eventName}\ndata: ${totals[eventName] += addCount}\n\n`;
// Sends a sequence of event-stream messages reporting incremented totals.
const report = specs => {
  const msgs = [];
  specs.forEach(spec => {
    msgs.push(eventMsg(...spec));
  });
  response.write(msgs.join(''));
};
// Returns a string with its first character lower-cased.
const lc0Of = string => string.length ? `${string[0].toLowerCase()}${string.slice(1)}` : '';
// Gets data on a work item.
const getItemData = (ref, facts, collections) => {
  return restAPI.get({
    ref,
    fetch: facts.concat(collections)
  })
  .then(
    item => {
      const obj = item.Object;
      const data = {};
      // Get the facts, or, if they are objects, references to them.
      facts.forEach(fact => {
        data[lc0Of(fact)] = obj[fact] !== null && typeof obj[fact] === 'object'
          ? obj[fact]._ref
          : obj[fact];
      });
      // Get references to, and sizes of, the collections.
      collections.forEach(collection => {
        data[lc0Of(collection)] = {
          ref: obj[collection]._ref,
          count: obj[collection].Count
        };
      });
      return data;
    },
    error => err(error, `getting data on ${ref}`)
  );
};
// Gets data on a collection.
const getCollectionData = (ref, facts, collections) => {
  return restAPI.get({
    ref,
    fetch: facts.concat(collections)
  })
  .then(
    collection => {
      const members = collection.Object.Results;
      const data = [];
      members.forEach(member => {
        const memberData = {
          ref: member._ref
        };
        // Get the facts, or, if they are objects, references to them.
        facts.forEach(fact => {
          memberData[lc0Of(fact)] = member[fact] !== null && typeof member[fact] === 'object'
            ? member[fact]._ref
            : member[fact];
        });
        // Get references to, and sizes of, the collections.
        collections.forEach(collection => {
          memberData[lc0Of(collection)] = {
            ref: member[collection]._ref,
            count: member[collection].Count
          };
        });
        data.push(memberData);
      });
      return data;
    },
    error => err(error, `getting data on ${ref}`)
  );
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
/*
  Recursively documents as an object in JSON format a tree or subtree of user stories, specifying
  the array of the objects of the root user story and its siblings, the index of the root user
  story’s object in that array, and an array of the objects of the ancestors of the user story.
*/
const docTree = (storyRef, storyArray, index, ancestors) => {
  if (! isError) {
    // Get data on the user story.
    getItemData(storyRef, ['FormattedID', 'Name'], ['Children', 'Tasks', 'TestCases'])
    .then(
      // When the data arrive:
      data => {
        const childCount = data.children.count;
        const taskCount = data.tasks.count;
        const caseCount = data.testCases.count;
        // If the user story has any child user stories and no tasks or test cases):
        if (childCount && ! taskCount && ! caseCount) {
          // Initialize the user story’s object.
          storyArray[index] = {
            formattedID: data.formattedID,
            name: data.name,
            taskCount: 0,
            testCaseCount: 0,
            childCount,
            children: []
          };
          // Get data on its child user stories.
          getCollectionData(data.children.ref, ['DragAndDropRank'], [])
          .then(
            // When the data arrive:
            children => {
              // Sort them by rank.
              children.sort((a, b) => a.dragAndDropRank < b.dragAndDropRank ? -1 : 1);
              const childArray = storyArray[index].children;
              const childAncestors = ancestors.concat(storyArray[index]);
              // Process them in that order.
              for (let i = 0; i < childCount; i++) {
                if (! isError) {
                  const childRef = shorten(
                    'hierarchicalrequirement', 'hierarchicalrequirement', children[i].ref
                  );
                  if (! isError) {
                    docTree(childRef, childArray, i, childAncestors);
                  }
                }
              }
            },
            error => err(error, 'getting data on child user stories for tree documentation')
          );
        }
        // Otherwise, if the user story has no child user stories:
        else if (! childCount) {
          // Initialize the user story’s object.
          storyArray[index] = {
            formattedID: data.formattedID,
            name: data.name,
            taskCount,
            testCaseCount: caseCount,
            childCount: 0
          };
          // Add the user story’s task and test-case counts to its ancestors’.
          ancestors.forEach(ancestor => {
            ancestor.taskCount += taskCount;
            ancestor.testCaseCount += caseCount;
          });
          // Send the documentation to the client if apparently complete.
          outDoc();
        }
        // Otherwise, i.e. if the user story has child user stories and also tasks or test cases:
        else {
          err('Invalid user story', 'documenting user-story tree');
        }
      },
      error => err(error, 'getting data on user story for tree documentation')
    );
  }
};
// Recursively acquires test results from a tree of user stories.
const verdictTree = storyRef => {
  // Get data on the user story.
  getItemData(storyRef, [], ['Children', 'TestCases'])
  .then(
    // When the data arrive:
    data => {
      const childCount = data.children.count;
      const caseCount = data.testCases.count;
      // If the user story has any test cases and no child user stories:
      if (caseCount && ! childCount) {
        // Get data on the test cases.
        getCollectionData(data.testCases.ref, ['LastVerdict'], ['Defects'])
        .then(
          // When the data arrive:
          cases => {
            // Process the test cases in parallel.
            cases.forEach(testCase => {
              if (! isError) {
                const verdict = testCase.lastVerdict;
                const defectsCollection = testCase.defects;
                if (verdict === 'Pass'){
                  report([['total'], ['passes']]);
                }
                else if (verdict === 'Fail') {
                  report([['total'], ['fails']]);
                }
                else if (verdict !== null) {
                  report([['total']]);
                }
                // If the test case has any defects:
                if (defectsCollection.count) {
                  // Get data on the defects.
                  getCollectionData(defectsCollection.ref, ['Severity'], [])
                  .then(
                    // When the data arrive:
                    defects => {
                      report([['defects', defects.length]]);
                      // Process their severities.
                      const severities = defects
                      .map(defect => defect.severity)
                      .reduce((tally, verdict) => {
                        tally[verdict]++;
                        return tally;
                      }, {
                        'Minor Problem': 0,
                        'Major Problem': 0
                      });
                      report([
                        ['major', severities['Major Problem']],
                        ['minor', severities['Minor Problem']]
                      ]);
                    },
                    error => err(error, 'getting data on defects')
                  );
                }
              }
            });
          },
          error => err(error, `getting data on test cases ${data.testCases.ref} for verdicts`)
        );
      }
      /*
        Otherwise, if the user story has any child user stories and
        no test cases (and therefore also no defects):
      */
      else if (childCount && ! caseCount) {
        // Get data on its child user stories.
        getCollectionData(data.children.ref, [], [])
        .then(
          // When the data arrive:
          children => {
            // Process the children in parallel.
            children.forEach(child => {
              if (! isError) {
                const childRef = shorten(
                  'hierarchicalrequirement', 'hierarchicalrequirement', child.ref
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
// Sequentially ensures the ownership of an array of tasks or test cases.
const takeTasksOrCases = (itemType, items) => {
  if (items.length && ! isError) {
    const workItemType = itemType === 'case' ? 'testcase' : 'task';
    // Get a reference to the first item.
    const firstItemRef = shorten(workItemType, workItemType, items[0].ref);
    if (! isError) {
      const firstOwnerRef = items[0].owner ? shorten('user', 'user', items[0].owner) : '';
      if (! isError) {
        // If the current owner of the first item is not the intended owner:
        if (firstOwnerRef !== takerRef) {
          // Change the owner.
          return restAPI.update({
            ref: firstItemRef,
            data: {Owner: takerRef}
          })
          .then(
            // After the owner is changed:
            () => {
              report([['total'], [`${itemType}Total`], ['changes'], [`${itemType}Changes`]]);
              // Process the remaining tasks or test cases.
              return takeTasksOrCases(itemType, items.slice(1));
            },
            error => err(error, `changing ${itemType} owner`)
          );
        }
        // Otherwise, i.e. if the current owner of the first item is the intended owner:
        else {
          report([['total'], [`${itemType}Total`]]);
          // Process the remaining tasks or test cases.
          return takeTasksOrCases(itemType, items.slice(1));
        }
      }
      else {
        return Promise.resolve('');
      }
    }
    else {
      return Promise.resolve('');
    }
  }
  else {
    return Promise.resolve('');
  }
};
// Changes ownerships of the child user stories or the tasks and test cases of a user story.
const takeDescendants = (callback, data) => {
  if (! isError) {
    // If the user story has child user stories and no tasks or test cases:
    if (data.children.count && ! data.tasks.count && ! data.testCases.count) {
      // Get data on the child user stories.
      return getCollectionData(data.children.ref, [], [])
      .then(
        // When the data arrive:
        children => {
          // Process them sequentially.
          return callback(children.map(child => child.ref));
        },
        error => err(error, 'getting data on child user stories for ownership change')
      );
    }
    // Otherwise, if the user story has tasks and test cases and no child user stories:
    else if (data.tasks.count && data.testCases.count && ! data.children.count) {
      // Get data on the tasks.
      return getCollectionData(data.tasks.ref, ['Owner'], [])
      .then(
        // When the data arrive:
        tasks => {
          // Process the tasks.
          return takeTasksOrCases('task', tasks)
          .then(
            // When they have been processed:
            () => {
              // Get data on the test cases.
              return getCollectionData(data.testCases.ref, ['Owner'], [])
              .then(
                // When the data arrive:
                cases => takeTasksOrCases('case', cases),
                error => err(error, 'getting data on test cases for ownership change')
              );
            },
            error => err(error, 'changing owners of tasks')
          );
        },
        error => err(error, 'getting data on tasks before test cases for ownership change')
      );
    }
    // Otherwise, if the user story has tasks and no child user stories or test cases:
    else if (data.tasks.count && ! data.testCases.count && ! data.children.count) {
      // Get data on the tasks.
      return getCollectionData(data.tasks.ref, ['Owner'], [])
      .then(
        // When the data arrive:
        tasks => {
          // Process the tasks.
          return takeTasksOrCases('task', tasks);
        },
        error => err(error, 'getting data on tasks for ownership change')
      );
    }
    // Otherwise, if the user story has no child user stories, tasks, or test cases:
    else if (! data.children.count && ! data.tasks.count && ! data.testCases.count) {
      // Do nothing.
      return Promise.resolve('');
    }
    // Otherwise, i.e. if the user story is invalid:
    else {
      err('Invalid user story', 'changing ownership');
    }
  }
};
// Recursively changes ownerships in a tree or subtree of user stories.
const takeTree = storyRefs => {
  if (storyRefs.length && ! isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! isError) {
      // Get data on the first user story of the specified array.
      return getItemData(firstRef, ['Owner'], ['Children', 'Tasks', 'TestCases'])
      .then(
        // When the data arrive:
        data => {
          const ownerRef = data.owner ? shorten('user', 'user', data.owner) : '';
          if (! isError) {
            // If the user story has no owner or its owner is not the specified one:
            if (ownerRef && ownerRef !== takerRef || ! ownerRef) {
              // Change its owner.
              return restAPI.update({
                ref: firstRef,
                data: {
                  Owner: takerRef
                }
              })
              .then(
                // When the owner has been changed:
                () => {
                  report([['total'], ['changes'], ['storyTotal'], ['storyChanges']]);
                  // Process the user story’s child user stories or its tasks and test cases.
                  return takeDescendants(takeTree, data)
                  .then(
                    // When they have been processed, process the remaining user stories.
                    () => takeTree(storyRefs.slice(1)),
                    error => err(
                      error, 'changing owner of descendants after changing user-story owner'
                    )
                  );
                },
                error => err(error, 'changing owner of user story')
              );
            }
            // Otherwise, i.e. if the user story’s owner does not need to be changed:
            else {
              report([['total'], ['storyTotal']]);
              // Process the user story’s child user stories or its tasks and test cases.
              return takeDescendants(takeTree, data)
              .then(
                () => takeTree(storyRefs.slice(1)),
                error => err(
                  error, 'changing owner of descendants without changing user-story owner'
                )
              );
            }
          }
          else {
            return '';
          }
        },
        error => err(error, 'getting data on user story for ownership change')
      );
    }
    else {
      return Promise.resolve('');
    }
  }
  else {
    return Promise.resolve('');
  }
};
// Recursively sets releases and iterations in a tree or subtree of user stories.
const whenTree = storyRefs => {
  if (storyRefs.length && ! isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! isError) {
      // Get data on the first user story of the specified array.
      return getItemData(firstRef, [], ['Children'])
      .then(
        // When the data arrive:
        data => {
          // If the user story has child user stories, it cannot be scheduled, so:
          if (data.children.count) {
            // Get data on them.
            return getCollectionData(data.children.ref, [], [])
            .then(
              // When the data arrive:
              children => {
                // Process the child user stories sequentially.
                return whenTree(children.map(child => child.ref))
                .then(
                  // After they are processed, process the remaining user stories.
                  () => whenTree(storyRefs.slice(1)),
                  error => err(error, 'scheduling child user stories')
                );
              },
              error => err(
                error, 'getting data on child user stories for scheduling'
              )
            );
          }
          // Otherwise, i.e. if the user story has no child user stories:
          else {
            // Schedule it.
            const schedule = {
              Release: releaseRef,
              Iteration: iterationRef
            };
            if (scheduleState !== 'unchanged') {
              schedule.ScheduleState = scheduleState;
            }
            return restAPI.update({
              ref: firstRef,
              data: schedule
            })
            .then(
              // When the user story has been scheduled:
              () => {
                report([['total']]);
                // Process the remaining user stories.
                return whenTree(storyRefs.slice(1));
              },
              error => err(error, 'scheduling user story')
            );
          }
        },
        error => err(error, 'getting data on user story for scheduling')
      );
    }
    else {
      return Promise.resolve('');
    }
  }
  else {
    return Promise.resolve('');
  }
};
// Sequentially creates tasks with a specified owner and names for a user story.
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
      return getItemData(firstRef, ['Owner'], ['Children'])
      .then(
        // When the data arrive:
        data => {
          // If the user story has any child user stories, it does not need tasks, so:
          if (data.children.count) {
            report([['total']]);
            // Get data on its child user stories.
            return getCollectionData(data.children.ref, [], [])
            .then(
              // When the data arrive:
              children => {
                // Process the children sequentially.
                return taskTree(children.map(child => child.ref))
                .then(
                  // After they are processed, process the remaining user stories.
                  () => taskTree(storyRefs.slice(1)),
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
            // Create them sequentially.
            return createTasks(firstRef, data.owner, taskNames)
            .then(
              // When they have been created:
              () => {
                if (! isError) {
                  report([['total'], ['changes', taskNames.length]]);
                  // Process the remaining user stories sequentially.
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
// Creates a test case.
const createCase = (name, description, owner, storyRef) => {
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
      // Link it to the specified user story.
      const caseRef = shorten('testcase', 'testcase', newCase.Object._ref);
      if (! isError) {
        return restAPI.add({
          ref: storyRef,
          collection: 'TestCases',
          data: [{_ref: caseRef}],
          fetch: ['_ref']
        })
        .then(
          // After it is linked:
          () => {
            // If a test set was specified:
            if (testSetRef) {
              // Link the test case to it.
              return restAPI.add({
                ref: caseRef,
                collection: 'TestSets',
                data: [{_ref: testSetRef}],
                fetch: ['_ref']
              });
            }
            else {
              return '';
            }
          },
          error => err(error, 'linking test case to user story')
        );
      }
      else {
        return '';
      }
    },
    error => err(error, 'creating test case')
  );
};
// Recursively creates test cases for a tree or subtrees of user stories.
const caseTree = storyRefs => {
  if (storyRefs.length && ! isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! isError) {
      // Get data on the first user story of the specified array.
      return getItemData(firstRef, ['Name', 'Description', 'Owner'], ['Children'])
      .then(
        // When the data arrive:
        data => {
          // If the user story has any child user stories, it does not need test cases, so:
          if (data.children.count) {
            report([['total']]);
            // Get data on its child user stories.
            return getCollectionData(data.children.ref, [], [])
            .then(
              // When the data arrive:
              children => {
                // Process the children sequentially.
                return caseTree(children.map(child => child.ref))
                .then(
                  // After they are processed, process the remaining user stories.
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
          // Otherwise the user story needs test cases, so:
          else {
            // Determine whether to create 1 test case with the user-story name or customize.
            const caseNames = caseData ? caseData[data.name] || [data.name] : [data.name];
            // If only 1 test case is to be created:
            if (caseNames.length === 1) {
              // Create and link it.
              return createCase(caseNames[0], data.description, data.owner, firstRef)
              .then(
                // When it has been created:
                () => {
                  report([['total'], ['changes']]);
                  // Process the remaining user stories.
                  return caseTree(storyRefs.slice(1));
                },
                error => err(error, 'creating and linking test case')
              );
            }
            // Otherwise, if 2 test cases are to be created:
            else if (caseNames.length === 2) {
              // Create and link the first test case.
              return createCase(caseNames[0], data.description, data.owner, firstRef)
              .then(
                // When it has been created and linked:
                () => {
                  // Create and link the second test case.
                  return createCase(caseNames[1], data.description, data.owner, firstRef)
                  .then(
                    // When it has been created and linked:
                    () => {
                      report([['total'], ['changes', 2]]);
                      // Process the remaining user stories.
                      return caseTree(storyRefs.slice(1));
                    },
                    error => err(error, 'creating and linking second test case')
                  );
                },
                error => err(error, 'creating and linking first test case')
              );
            }
          }
        },
        error => err(error, 'getting data on user story')
      );
    }
    else {
      return Promise.resolve('');
    }
  }
  else {
    return Promise.resolve('');
  }
};
// Creates a passing test-case result.
const createResult = (caseRef, tester, build, testSet, note) => {
  // Create a passing result.
  return restAPI.create({
    type: 'testcaseresult',
    fetch: ['_ref'],
    data: {
      TestCase: caseRef,
      Build: build,
      Verdict: 'Pass',
      Notes: note,
      Date: new Date(),
      Tester: tester,
      TestSet: testSet
    }
  });
};
// Creates passing results for an array of test cases.
const passCases = (caseRefs, build, note) => {
  if (caseRefs.length && ! isError) {
    const firstRef = shorten('testcase', 'testcase', caseRefs[0]);
    if (! isError) {
      // Get data on the first test case of the specified array.
      return getItemData(firstRef, ['Owner'], ['Results', 'TestSets'])
      .then(
        // When the data arrive:
        data => {
          // If the test case already has results:
          if (data.results.count) {
            // Do not create one.
            report([['total']]);
            // Process the remaining test cases.
            return passCases(caseRefs.slice(1), build, note);
          }
          // Otherwise, if the test case has no results yet but has an owner:
          else if (data.owner) {
            // If the test case is in any test sets:
            if (data.testSets.count) {
              // Get data on the test sets.
              return getCollectionData(data.testSets.ref, [], [])
              .then(
                // When the data arrive:
                testSets => {
                  // Create a passing result for the test case in its first test set.
                  return createResult(firstRef, data.owner, build, testSets[0].ref, note)
                  .then(
                    // When the result has been created:
                    () => {
                      report([['total'], ['changes']]);
                      // Process the remaining test cases.
                      return passCases(caseRefs.slice(1), build, note);
                    },
                    error => err(error, 'creating result in test set')
                  );
                },
                error => err(error, 'getting data on test sets for result creation')
              );
            }
            // Otherwise, i.e. if the test case is not in any test set:
            else {
              // Create a passing result for the test case with the owner as tester.
              return createResult(firstRef, data.owner, build, null, note)
              .then(
                // When the result has been created:
                () => {
                  report([['total'], ['changes']]);
                  // Process the remaining test cases.
                  return passCases(caseRefs.slice(1), build, note);
                },
                error => err(error, 'creating result in no test set')
              );
            }
          }
        },
        error => err(error, 'getting data on test case for result creation')
      );
    }
    else {
      return Promise.resolve('');
    }
  }
  else {
    return Promise.resolve('');
  }
};
// Recursively creates passing test-case results for a tree or subtrees of user stories.
const resultTree = storyRefs => {
  if (storyRefs.length && ! isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! isError) {
      // Get data on the first user story of the specified array.
      return getItemData(firstRef, [], ['Children', 'TestCases'])
      .then(
        // When the data arrive:
        data => {
          // If the user story has any child user stories and no test cases:
          if (data.children.count && ! data.testCases.count) {
            // Get data on its child user stories.
            return getCollectionData(data.children.ref, [], [])
            .then(
              // When the data arrive, process the children sequentially.
              children => {
                return resultTree(children.map(child => child.ref))
                .then(
                  // After they are processed, process the remaining user stories.
                  () => resultTree(storyRefs.slice(1)),
                  error => err(error, 'creating test-case results for child user stories')
                );
              },
              error => err(error,'getting data on child user stories for test-case result creation')
            );
          }
          // Otherwise, if the user story has any test cases and no child user stories:
          else if (data.testCases.count && ! data.children.count) {
            // Get data on its test cases.
            return getCollectionData(data.testCases.ref, [], [])
            .then(
              // When the data arrive:
              cases => {
                // Process the test cases sequentially.
                return passCases(cases.map(testCase => testCase.ref), build, note)
                .then(
                  // After they are processed, process the remaining user stories.
                  () => resultTree(storyRefs.slice(1)),
                  error => err(error, 'creating results for test cases')
                );
              },
              error => err(error, 'getting data on test cases for result creation')
            );
          }
          // Otherwise, if the user story has no child user stories and no test cases:
          else if (! data.children.count && ! data.testCases.count) {
            // Skip it.
            return '';
          }
          // Otherwise, i.e. if the user story has both child user stories and test cases:
          else {
            err('Invalid user story', 'creating test-case results');
            return '';
          }
        },
        error => err(error, 'getting data on user story')
      );
    }
    else {
      return Promise.resolve('');
    }
  }
  else {
    return Promise.resolve('');
  }
};
// Sequentially copies an array of tasks or an array of test cases.
const copyTasksOrCases = (itemType, itemRefs, copyStoryRef) => {
  if (itemRefs.length && ! isError) {
    // Identify and shorten a reference to the first item.
    const workItemType = ['task', 'testcase'][['task', 'case'].indexOf(itemType)];
    if (workItemType) {
      const firstRef = shorten(workItemType, workItemType, itemRefs[0]);
      if (! isError) {
        // Get data on the first item.
        return getItemData(firstRef, ['Name', 'Description', 'Owner', 'DragAndDropRank'], [])
        .then(
          // When the data arrive:
          data => {
            // Copy the item and give it the specified parent.
            return restAPI.create({
              type: workItemType,
              fetch: ['_ref'],
              data: {
                Name: data.name,
                Description: data.description,
                Owner: data.owner,
                DragAndDropRank: data.dragAndDropRank,
                WorkProduct: copyStoryRef
              }
            })
            .then(
              // When the item has been copied:
              () => {
                report([['total'], [`${itemType}Total`]]);
                // Copy the remaining items in the specified array.
                return copyTasksOrCases(itemType, itemRefs.slice(1), copyStoryRef);
              },
              error => err(error, `copying ${itemType} ${firstRef}`)
            );
          },
          error => err(error, `getting data on ${itemType}`)
        );
      }
      else {
        return Promise.resolve('');
      }
    }
    else {
      err('invalid item type', 'copying task or test case');
      return Promise.resolve('');
    }
  }
  else {
    return Promise.resolve('');
  }
};
// Recursively copies a tree or subtrees of user stories.
const copyTree = (storyRefs, copyParentRef) => {
  if (storyRefs.length && ! isError) {
    // Identify and shorten the reference to the first user story.
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! isError) {
      // Get data on the first user story.
      return getItemData(
        firstRef,
        ['Name', 'Description', 'Owner', 'DragAndDropRank'],
        ['Children', 'Tasks', 'TestCases']
      )
      .then(
        // When the data arrive:
        data => {
          // If the user story is the specified parent of the tree copy:
          if (firstRef === treeCopyParentRef) {
            // Quit and report this.
            err('Attempt to copy to itself', 'copying tree');
            return '';
          }
          // Otherwise, if the original has an invalid descendant combination:
          else if (
            data.children.count && (data.tasks.count || data.testCases.count)
            || (data.testCases.count && ! data.tasks.count)
          ) {
            // Quit and report this.
            err(`Invalid user story ${firstRef}`, 'copying tree');
            return '';
          }
          // Otherwise, i.e. if the user story is copiable:
          else {
            // Copy the user story and give it the specified parent.
            return restAPI.create({
              type: 'hierarchicalrequirement',
              fetch: ['_ref'],
              data: {
                Name: data.name,
                Description: data.description,
                Owner: data.owner,
                DragAndDropRank: data.dragAndDropRank,
                Parent: copyParentRef
              }
            })
            .then(
              // When the user story has been copied:
              copy => {
                report([['total'], ['storyTotal']]);
                // Identify and shorten a reference to the copy.
                const copyRef = shorten('userstory', 'hierarchicalrequirement', copy.Object._ref);
                if (! isError) {
                  // If the original has children and no tasks or test cases:
                  if (data.children.count && ! data.tasks.count && ! data.testCases.count) {
                    // Get data on the child user stories.
                    return getCollectionData(data.children.ref, [], [])
                    .then(
                      // When the data arrive:
                      children => {
                        // Copy the child user stories.
                        return copyTree(children.map(child => child.ref), copyRef)
                        .then(
                          // When the child user stories have been copied:
                          () => {
                            // Process the remaining user stories.
                            return copyTree(storyRefs.slice(1), copyParentRef);
                          },
                          error => err(error, 'copying child user stories')
                        );
                      },
                      error => err(error, 'getting data on child user stories')
                    );
                  }
                  /*
                    Otherwise, if the original has no child user stories and has tasks and
                    test cases and they are to be copied:
                  */
                  else if (
                    data.tasks.count
                    && data.testCases.count
                    && copyWhat === 'both'
                    && ! data.children.count
                  ) {
                    // Get data on the tasks.
                    return getCollectionData(data.tasks.ref, [], [])
                    .then(
                      // When the data arrive:
                      tasks => {
                        // Copy the tasks.
                        return copyTasksOrCases('task', tasks.map(task => task.ref), copyRef)
                        .then(
                          // When the tasks have been copied:
                          () => {
                            // Get data on the test cases.
                            return getCollectionData(data.testCases.ref, [], [])
                            .then(
                              // When the data arrive:
                              cases => {
                                // Copy the test cases.
                                return copyTasksOrCases(
                                  'case', cases.map(testCase => testCase.ref), copyRef
                                )
                                .then(
                                  // When the test cases have been copied:
                                  () => {
                                    // Process the remaining user stories.
                                    return copyTree(storyRefs.slice(1), copyParentRef);
                                  },
                                  error => err(error, 'copying test case')
                                );
                              },
                              error => err(error, 'getting data on test cases')
                            );
                          },
                          error => err(error, 'copying task')
                        );
                      },
                      error => err(error, 'getting data on tasks')
                    );
                  }
                  /*
                    Otherwise, if the original has no child user stories and has tasks and they
                    are to be copied:
                  */
                  else if (
                    data.tasks.count
                    && ['tasks', 'both'].includes(copyWhat)
                    && ! data.children.count
                  ) {
                    // Get data on the tasks.
                    return getCollectionData(data.tasks.ref, [], [])
                    .then(
                      // When the data arrive:
                      tasks => {
                        // Copy the tasks.
                        return copyTasksOrCases('task', tasks.map(task => task.ref), copyRef)
                        .then(
                          // When the tasks have been copied:
                          () => {
                            // Process the remaining user stories.
                            return copyTree(storyRefs.slice(1), copyParentRef);
                          },
                          error => err(error, 'copying task')
                        );
                      },
                      error => err(error, 'getting data on tasks')
                    );
                  }
                  // Otherwise, i.e. if the original has nothing other than itself to be copied:
                  else {
                    // Process the remaining user stories.
                    return copyTree(storyRefs.slice(1), copyParentRef);
                  }
                }
              },
              error => err(error, `copying user story ${firstRef}`)
            );
          }
        },
        error => err(error, 'getting data on user story for copying')
      );
    }
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
// Serves the release and iteration report page.
const serveWhenReport = (releaseName, iterationName) => {
  fs.readFile('whenReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('whenReport.js', 'utf8')
      .then(
        jsContent => {
          const newContent = reportPrep(htmlContent, jsContent)
          .replace('__releaseName__', releaseName)
          .replace('__releaseRef__', releaseRef)
          .replace('__iterationName__', iterationName)
          .replace('__iterationRef__', iterationRef)
          .replace('__scheduleState__', scheduleState);
          servePage(newContent, true);
        },
        error => err(error, 'reading whenReport script')
      );
    },
    error => err(error, 'reading whenReport page')
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
// Serves the add-test-case-result report page.
const serveResultReport = () => {
  fs.readFile('resultReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('resultReport.js', 'utf8')
      .then(
        jsContent => {
          const newContent = reportPrep(htmlContent, jsContent);
          servePage(newContent, true);
        },
        error => err(error, 'reading resultReport script')
      );
    },
    error => err(error, 'reading resultReport page')
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
  totals.total = totals.changes = 0;
  serveEventStart();
};
// Serves a test-case-creation report if a test set is specified.
const serveCaseIfSet = (testSetID) => {
  // Get a reference to it.
  getRef('testset', testSetID, 'test-case creation')
  .then(
    ref => {
      if (! isError) {
        testSetRef = shorten('testset', 'testset', ref);
        if (! isError) {
          // Check on the existence of the test set.
          getItemData(testSetRef, [], [])
          .then(
            // When its existence is confirmed:
            () => {
              // Serve a report on test-case creation.
              serveCaseReport();
            },
            error => err(error, 'getting data on test set')
          );
        }
      }
    },
    error => err(error, 'getting reference to test set')
  );
};
// Handles requests, serving the request page and the acknowledgement page.
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
      if (requestURL === '/do.html' || requestURL === '/') {
        // Serves the request page.
        serveDo();
      }
      else if (requestURL === '/style.css') {
        // Serves the stylesheet when a page requests it.
        serveStyles();
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
        takeTree([rootRef]);
      }
      else if (requestURL === '/whentotals' && idle) {
        streamInit();
        whenTree([rootRef]);
      }
      else if (requestURL === '/tasktotals' && idle) {
        streamInit();
        taskTree([rootRef]);
      }
      else if (requestURL === '/casetotals' && idle) {
        streamInit();
        caseTree([rootRef]);
      }
      else if (requestURL === '/resulttotals' && idle) {
        streamInit();
        resultTree([rootRef]);
      }
      else if (requestURL === '/copytotals' && idle) {
        streamInit();
        copyTree([rootRef], treeCopyParentRef);
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
        password,
        rootID,
        op,
        takerName,
        releaseName,
        iterationName,
        parentID,
        sState,
        taskNameString,
        testFolderID,
        testSetID
      } = bodyObject;
      copyWhat = bodyObject.copyWhat;
      build = bodyObject.build;
      note = bodyObject.note;
      RALLY_USERNAME = userName;
      RALLY_PASSWORD = password;
      // Create and configure a Rally API client.
      restAPI = rally({
        user: userName,
        pass: password,
        requestOptions
      });
      // Get a long reference to the root user story.
      getRef('hierarchicalrequirement', rootID, 'tree root')
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
                          error => err(error, 'getting reference to new owner')
                        );
                      }
                      // Otherwise, the new owner will be the user, so:
                      else {
                        takerRef = userRef;
                        // Serve a report identifying the user as new owner.
                        serveTakeReport(userName);
                      }
                    }
                    // Otherwise, if the operation is scheduling:
                    else if (op === 'when') {
                      scheduleState = sState;
                      // Serve a report identifying the release and iteration.
                      getNameRef('release', releaseName, 'scheduling')
                      .then(
                        ref => {
                          if (! isError) {
                            releaseRef = ref;
                            getNameRef('iteration', iterationName, 'scheduling')
                            .then(
                              ref => {
                                if (! isError) {
                                  iterationRef = ref;
                                  serveWhenReport(releaseName, iterationName);
                                }
                              },
                              error => err(error, 'getting reference to iteration')
                            );
                          }
                        },
                        error => err(error, 'getting reference to release')
                      );
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
                        getRef('testfolder', testFolderID, 'test-case creation')
                        .then(
                          ref => {
                            if (! isError) {
                              testFolderRef = shorten('testfolder', 'testfolder', ref);
                              if (! isError) {
                                // Get data on the test folder.
                                getItemData(testFolderRef, [], [])
                                .then(
                                  // When the data arrive:
                                  () => {
                                    // If a test set was specified:
                                    if (testSetID) {
                                      // Verify it and serve a report on test-case creation.
                                      serveCaseIfSet(testSetID);
                                    }
                                    // Otherwise, i.e. if no test set was specified:
                                    else {
                                      // Serve a report on test-case creation.
                                      serveCaseReport();
                                    }
                                  },
                                  error => err(error, 'getting data on test folder')
                                );
                              }
                            }
                          },
                          error => err(error, 'getting reference to test folder')
                        );
                      }
                      // Otherwise, if a test set but no test folder was specified:
                      else if (testSetID) {
                        // Process the test set and serve a report on test-case creation.
                        serveCaseIfSet(testSetID);
                      }
                      // Otherwise, i.e. if neither a test folder nor a test set was specified:
                      else {
                        // Serve a report on test-case creation.
                        serveCaseReport();
                      }
                    }
                    // Otherwise, if the operation is test-case result creation:
                    else if (op === 'result') {
                      // Serve a report on test-case result creation.
                      serveResultReport();
                    }
                    // Otherwise, if the operation is tree copying:
                    else if (op === 'copy') {
                      getRef('hierarchicalrequirement', parentID, 'parent of tree copy')
                      .then(
                        ref => {
                          if (! isError) {
                            treeCopyParentRef = shorten(
                              'userstory', 'hierarchicalrequirement', ref
                            );
                            if (! isError) {
                              // Get data on the parent user story of the copy.
                              getItemData(treeCopyParentRef, [], ['Tasks'])
                              .then(
                                data => {
                                  // When the data arrive:
                                  if (data.tasks.count) {
                                    err(
                                      'Attempt to copy to a user story with tasks', 'copying tree'
                                    );
                                  }
                                  else {
                                    // Copy the tree and give it the specified parent.
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
const port = 3000;
server.listen(port, () => {
  console.log(`Opening index.html. It will link to localhost:${port}.`);
  open('index.html');
});
