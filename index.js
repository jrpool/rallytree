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
// Module to make HTTPS requests.
const https = require('https');
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
let caseFolderRef = '';
let caseSetRef = '';
let caseTarget = 'all';
let copyIterationRef = '';
let copyOwnerRef = '';
let copyParentRef = '';
let copyProjectRef = '';
let copyReleaseRef = '';
let copyState;
let copyWhat = 'both';
let isError = false;
let passBuild = '';
let passNote = '';
let projectIterationRef = '';
let projectRef = '';
let projectReleaseRef = '';
let response = {};
let restAPI = {};
let rootRef = '';
let scheduleState = '';
let scorePriorities = ['None', 'Useful', 'Important', 'Critical'];
let scoreRisks = ['None', 'Low', 'Medium', 'High'];
let scoreWeights = {
  risk: {},
  priority: {}
};
let takeWhoRef = '';
let taskNames = [];
let userName = '';
let userRef = '';
let totals = {
  caseChanges: 0,
  caseTotal: 0,
  changes: 0,
  defects: 0,
  denominator: 0,
  fails: 0,
  major: 0,
  minor: 0,
  numerator: 0,
  passes: 0,
  score: 0,
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
  caseFolderRef = '';
  caseSetRef = '';
  caseTarget = 'all';
  copyIterationRef = '';
  copyOwnerRef = '';
  copyParentRef = '';
  copyProjectRef = '';
  copyReleaseRef = '';
  copyState= '';
  copyWhat = 'both';
  isError = false;
  passBuild = '';
  passNote = '';
  projectIterationRef = '';
  projectRef = '';
  projectReleaseRef = '';
  restAPI = {};
  rootRef = '';
  scheduleState = '';
  scorePriorities = ['None', 'Useful', 'Important', 'Critical'];
  scoreRisks = ['None', 'Low', 'Medium', 'High'];
  scoreWeights = {
    risk: {},
    priority: {}
  };
  takeWhoRef = '';
  taskNames = [];
  userName = '';
  userRef = '';
  totals = {
    caseChanges: 0,
    caseTotal: 0,
    changes: 0,
    defects: 0,
    denominator: 0,
    fails: 0,
    major: 0,
    minor: 0,
    numerator: 0,
    passes: 0,
    score: 0,
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
// Sequentially copies an array of tasks or an array of test cases.
const copyTasksOrCases = (itemType, itemRefs, storyRef) => {
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
            // Specify properties for the copy.
            const config = {
              Name: data.name,
              Description: data.description,
              Owner: copyOwnerRef || data.owner,
              DragAndDropRank: data.dragAndDropRank,
              WorkProduct: storyRef
            };
            /*
              If the item is a test case, it will not automatically inherit the project of its
              user story, so specify its project.
            */
            if (workItemType === 'testcase') {
              config.Project = copyProjectRef;
            }
            return restAPI.create({
              type: workItemType,
              fetch: ['_ref'],
              data: config
            })
            .then(
              // When the item has been copied:
              () => {
                report([['total'], [`${itemType}Total`]]);
                // Copy the remaining items in the specified array.
                return copyTasksOrCases(itemType, itemRefs.slice(1), storyRef);
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
// Get data on tasks or test cases and copy them.
const getAndCopyTasksOrCases = (itemType, collectionType, data, copyRef) => {
  // Get data on the tasks or test cases.
  return getCollectionData(data[collectionType].ref, [], [])
  .then(
    // When the data arrive:
    items => {
      // Copy the tasks or test cases.
      return copyTasksOrCases(itemType, items.map(item => item.ref), copyRef);
    },
    error => err(error, `getting data on ${collectionType}`)
  );
};
// Recursively copies a tree or subtrees of user stories.
const copyTree = (storyRefs, parentRef) => {
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
          if (firstRef === copyParentRef) {
            // Quit and report this.
            err('Attempt to copy to itself', 'copying tree');
            return '';
          }
          // Otherwise, i.e. if the user story is copiable:
          else {
            const properties = {
              Name: data.name,
              Description: data.description,
              Owner: copyOwnerRef || data.owner,
              DragAndDropRank: data.dragAndDropRank,
              Parent: parentRef,
              Project: copyProjectRef
            };
            if (copyReleaseRef) {
              properties.Release = copyReleaseRef;
            }
            if (copyIterationRef) {
              properties.Iteration = copyIterationRef;
            }
            if (copyState) {
              properties.ScheduleState = copyState;
            }
            // Copy the user story.
            return restAPI.create({
              type: 'hierarchicalrequirement',
              fetch: ['_ref'],
              data: properties
            })
            .then(
              // When the user story has been copied:
              copy => {
                report([['total'], ['storyTotal']]);
                // Identify a short reference to the copy.
                const copyRef = shorten('userstory', 'hierarchicalrequirement', copy.Object._ref);
                if (! isError) {
                  // Copies child user stories and remaining user stories.
                  const copyChildrenAndSiblings = () => {
                    // If the original has any child user stories:
                    if (data.children.count) {
                      // Get data on them.
                      return getCollectionData(data.children.ref, [], [])
                      .then(
                        // When the data arrive:
                        children => {
                          // Process the child user stories.
                          return copyTree(children.map(child => child.ref), copyRef)
                          .then(
                            // When they have been processed:
                            () => {
                              // Process the remaining user stories.
                              return copyTree(storyRefs.slice(1), parentRef);
                            },
                            error => err(error,'processing child user stories')
                          );
                        },
                        error => err(error,'getting data on child user stories')
                      );
                    }
                    else {
                      // Process the remaining user stories.
                      return copyTree(storyRefs.slice(1), parentRef);
                    }
                  };
                  // If the original has test cases and they are to be copied:
                  if (
                    data.testCases.count
                    && ['cases', 'both'].includes(copyWhat)
                  ) {
                    // Get data on the test cases and copy them.
                    return getAndCopyTasksOrCases('case', 'testCases', data, copyRef)
                    .then(
                      // When the test cases have been copied:
                      () => {
                        // if the original has tasks and they are to be copied:
                        if (data.tasks.count && ['tasks', 'both'].includes(copyWhat)) {
                          // Get data on the tasks and copy them.
                          return getAndCopyTasksOrCases('task', 'tasks', data, copyRef)
                          .then(
                            // When the tasks have been copied:
                            () => {
                            /*
                              It cannot have child user stories. Process the remaining user stories.
                            */
                              return copyTree(storyRefs.slice(1), parentRef);
                            },
                            error => err(error, 'copying tasks')
                          );
                        }
                        /*
                          Otherwise, i.e. if the original has no tasks or tasks are not to
                          be copied:
                        */
                        else {
                          // Copy any of its child user stories and the remaining user stories.
                          return copyChildrenAndSiblings();
                        }
                      },
                      error => err(error, 'copying test cases')
                    );
                  }
                  /*
                    Otherwise, i.e. if the original has no test cases or test cases are not
                    to be copied:
                  */
                  else {
                    // If the original has tasks and they are to be copied:
                    if (
                      data.tasks.count
                      && ['tasks', 'both'].includes(copyWhat)
                    ) {
                      // Get data on the tasks and copy them.
                      return getAndCopyTasksOrCases('task', 'tasks', data, copyRef)
                      .then(
                        // When the tasks have been copied:
                        () => {
                          // It cannot have child user stories. Process the remaining user stories.
                          return copyTree(storyRefs.slice(1), parentRef);
                        },
                        error => err(error, 'copying tasks')
                      );
                    }
                    /*
                      Otherwise, i.e. if the original has no tasks or tasks are not to
                      be copied:
                    */
                    else {
                      // Copy any of its child user stories and the remaining user stories.
                      return copyChildrenAndSiblings();
                    }
                  }
                }
                else {
                  return '';
                }
              },
              error => err(error, 'copying user story')
            );
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
// Recursively acquires test results from a tree of user stories.
const scoreTree = storyRef => {
  // Get data on the user story.
  getItemData(storyRef, [], ['Children', 'TestCases'])
  .then(
    // When the data arrive:
    data => {
      const childCount = data.children.count;
      const caseCount = data.testCases.count;
      // If the user story has test cases:
      if (caseCount) {
        // Get data on them.
        getCollectionData(data.testCases.ref, ['LastVerdict', 'Risk', 'Priority'], ['Defects'])
        .then(
          // When the data arrive:
          cases => {
            // Process the test cases in parallel.
            cases.forEach(testCase => {
              if (! isError) {
                const verdict = testCase.lastVerdict;
                const riskWeight = scoreWeights.risk[testCase.risk];
                const priorityWeight = scoreWeights.priority[testCase.priority];
                const weight = Number.parseInt(riskWeight) + Number.parseInt(priorityWeight);
                const defectsCollection = testCase.defects;
                let newNumerator;
                if (verdict === 'Pass') {
                  newNumerator = totals.numerator + weight;
                  report([
                    ['total'],
                    ['passes'],
                    [
                      'score',
                      Math.round(
                        newNumerator ? 100 * newNumerator / (totals.denominator + weight) : 0
                      ) - totals.score
                    ],
                    ['numerator', weight],
                    ['denominator', weight]
                  ]);
                }
                else if (verdict === 'Fail') {
                  newNumerator = totals.numerator;
                  report([
                    ['total'],
                    ['fails'],
                    [
                      'score',
                      Math.round(
                        newNumerator ? 100 * newNumerator / (totals.denominator + weight) : 0
                      ) - totals.score
                    ],
                    ['denominator', weight]
                  ]);
                }
                else if (verdict !== null) {
                  report([['total']]);
                }
                // If the test case has any defects:
                /*
                  NOTICE: this condition was liberalized temporarily in February 2021 because of a
                  Rally bug that reports all defect counts as 0.
                */
                if (defectsCollection.count >= 0) {
                  // Get data on the defects.
                  getCollectionData(defectsCollection.ref, ['Severity'], [])
                  .then(
                    // When the data arrive:
                    defects => {
                      // Notify user if 
                      if (defects.length) {
                        if (defectsCollection.count) {
                          console.log(
                            'Rally defect-count bug has been corrected! Revise scoreTree().'
                          );
                        }
                        else {
                          console.log('Rally defect-count bug not yet corrected!');
                        }
                      }
                      report([['defects', defects.length]]);
                      // Process their severities.
                      const severities = defects
                      .map(defect => defect.severity)
                      .reduce((tally, score) => {
                        tally[score]++;
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
              else {
                return;
              }
            });
          },
          error => err(error, `getting data on test cases ${data.testCases.ref}`)
        );
      }
      // If the user story has child user stories:
      if (childCount) {
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
                  scoreTree(childRef);
                }
              }
            });
          },
          error => err(error, 'getting data on child user stories')
        );
      }
    },
    error => err(error, 'getting data on user story')
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
        if (firstOwnerRef !== takeWhoRef) {
          // Change the owner.
          return restAPI.update({
            ref: firstItemRef,
            data: {Owner: takeWhoRef}
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
            /*
              Changes the owner of the test cases and tasks or child user stories of the user story
              and the remaining user stories.
              OUTER FUNCTION DEFINITION START
            */
            const takeDescendantsAndSiblings = () => {
              if (! isError) {
                /*
                  Changes the owner of the tasks or child user stories of the user story and the
                  remaining user stories.
                  INNER FUNCTION DEFINITION START
                */
                const takeTasksOrChildrenAndSiblings = () => {
                  // If the user story has tasks:
                  if (data.tasks.count) {
                    // Get data on them.
                    return getCollectionData(data.tasks.ref, ['Owner'], [])
                    .then(
                      // When the data arrive, process the tasks.
                      tasks => takeTasksOrCases('task', tasks)
                      .then(
                        /*
                          The user story has no children. When the tasks have been
                          processed, process the remaining user stories.
                        */
                        () => takeTree(storyRefs.slice(1)),
                        error => err(error, 'changing owner of tasks')
                      ),
                      error => err(error, 'getting data on tasks')
                    );
                  }
                  // Otherwise, i.e. if the user story has no tasks:
                  else {
                    // If the user story has child user stories:
                    if (data.children.count) {
                      // Get data on them.
                      return getCollectionData(data.children.ref, [], [])
                      .then(
                        // When the data arrive:
                        children => {
                          // Process the child user stories sequentially.
                          return takeTree(children.map(child => child.ref))
                          .then(
                            /*
                              When they have been processed, process the remaining
                              user stories.
                            */
                            () => takeTree(storyRefs.slice(1)),
                            error => err(error, 'Changing owner of child user stories')
                          );
                        },
                        error => err(
                          error, 'getting data on child user stories for ownership change'
                        )
                      );
                    }
                    // Otherwise, i.e. if the user story has no child user stories:
                    else {
                      // Process the remaining user stories.
                      return takeTree(storyRefs.slice(1));
                    }
                  }
                };
                // INNER FUNCTION DEFINITION END
                // If the user story has test cases:
                if (data.testCases.count) {
                  // Get data on them.
                  return getCollectionData(data.testCases.ref, ['Owner'], [])
                  .then(
                    // When the data arrive, process the test cases.
                    cases => takeTasksOrCases('case', cases)
                    .then(
                      /*
                        When they have been processed, process the tasks or child user stories
                        of the user story and the remaining user stories.
                      */
                      () => takeTasksOrChildrenAndSiblings(),
                      error => err(error, 'changing owner of test cases')
                    ),
                    error => err(error, 'getting data on test cases')
                  );
                }
                // Otherwise, i.e. if the user story has no test cases:
                else {
                  /*
                    Process the tasks or child user stories of the user story and the remaining
                    user stories.
                  */
                  return takeTasksOrChildrenAndSiblings();
                }
              }
              else {
                return '';
              }
            };
            // OUTER FUNCTION DEFINITION END
            // If the user story has no owner or its owner is not the specified one:
            if (ownerRef && ownerRef !== takeWhoRef || ! ownerRef) {
              // Change the owner of the user story.
              return restAPI.update({
                ref: firstRef,
                data: {
                  Owner: takeWhoRef
                }
              })
              .then(
                // When the owner has been changed:
                () => {
                  report([['total'], ['changes'], ['storyTotal'], ['storyChanges']]);
                  /*
                    Process the user story’s test cases and tasks or child user stories, and
                    the remaining user stories.
                  */
                  return takeDescendantsAndSiblings();
                },
                error => err(error, 'changing owner of user story')
              );
            }
            // Otherwise, i.e. if the user story’s owner does not need to be changed:
            else {
              report([['total'], ['storyTotal']]);
              /*
                Process the user story’s test cases and tasks or child user stories, and the
                remaining user stories.
              */
              return takeDescendantsAndSiblings();
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
// Recursively changes project affiliations in a tree or subtree of user stories.
const projectTree = storyRefs => {
  if (storyRefs.length && ! isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! isError) {
      // Get data on the first user story of the specified array.
      return getItemData(firstRef, ['Project', 'Release', 'Iteration'], ['Children'])
      .then(
        // When the data arrive:
        data => {
          const oldProjectRef = data.project ? shorten('project', 'project', data.project) : '';
          if (! isError) {
            // Processes the children of the user story. FUNCTION DEFINITION START
            const processMore = () => {
              // Get data on the user story’s child user stories.
              return getCollectionData(data.children.ref, [], [])
              .then(
                // When the data arrive:
                children => {
                  // Process the children sequentially.
                  return projectTree(children.map(child => child.ref))
                  .then(
                    // When they have been processed, process the remaining user stories.
                    () => projectTree(storyRefs.slice(1)),
                    error => err(error, 'changing project of children of user story')
                  );
                },
                error => err(error, 'getting data on children of user story')
              );
            };
            // FUNCTION DEFINITION END
            // Initialize a configuration object for an update to the user story.
            const config = {};
            // Initialize an array of reportable events.
            const events = [['total'], ['changes']];
            // If the user story belongs to no or a non-intended project:
            if (oldProjectRef && oldProjectRef !== projectRef || ! oldProjectRef) {
              // Add project to the object and array.
              config.Project = projectRef;
              events.push(['projectChanges']);
            }
            // If a release is specified and differs from the user story’s:
            if (projectReleaseRef && projectReleaseRef !== data.release) {
              // Add release to the object and array.
              config.Release = projectReleaseRef;
              events.push(['releaseChanges']);
            }
            // If an iteration is specified and differs from the user story’s:
            if (projectIterationRef && projectIterationRef !== data.iteration) {
              // Add iteration to the object and array.
              config.Iteration = projectIterationRef;
              events.push(['iterationChanges']);
            }
            // If the user story needs to be updated:
            if (events.length > 2) {
              // Update it.
              return restAPI.update({
                ref: firstRef,
                data: config
              })
              .then(
                // When it has been updated:
                () => {
                  report(events);
                  // Process its child user stories and the remaining user stories.
                  return processMore();
                },
                error => err(error, 'changing project, release, and/or iteration of user story')
              );
            }
            // Otherwise, i.e. if the user story does not need to be updated:
            else {
              // Process its child user stories and the remaining user stories.
              return processMore();
            }
          }
          else {
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
// Returns the count of schedulable user stories.
const schedulableCount = storyRefs => {
  if (storyRefs.length && ! isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! isError) {
      // Get data on the first user story of the specified array.
      return getItemData(firstRef, [], ['Children'])
      .then(
        // When the data arrive:
        data => {
          // If the user story has child user stories:
          if (data.children.count) {
            // Get data on them.
            return getCollectionData(data.children.ref, [], [])
            .then(
              // When the data arrive:
              children => {
                // Process the child user stories sequentially.
                return schedulableCount(children.map(child => child.ref))
                .then(
                  // After they are processed, process the remaining user stories.
                  () => schedulableCount(storyRefs.slice(1)),
                  error => err(error, 'counting child user stories for schedulable count')
                );
              },
              error => err(error, 'getting data on child user stories for schedulable count')
            );
          }
          // Otherwise, i.e. if the user story has no child user stories:
          else {
            report([['total']]);
            // Process the remaining user stories.
            return schedulableCount(storyRefs.slice(1));
          }
        },
        error => err(error, 'getting data on first user story for schedulable count')
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
// Recursively sets the schedule state in a tree or subtree of user stories.
const scheduleTree = storyRefs => {
  if (storyRefs.length && ! isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! isError) {
      // Get data on the first user story of the specified array.
      return getItemData(firstRef, ['ScheduleState'], ['Children'])
      .then(
        // When the data arrive:
        data => {
          // If the user story has child user stories, its schedule state cannot be set, so:
          if (data.children.count) {
            // Get data on them.
            return getCollectionData(data.children.ref, [], [])
            .then(
              // When the data arrive:
              children => {
                // Process the child user stories sequentially.
                return scheduleTree(children.map(child => child.ref))
                .then(
                  // After they are processed, process the remaining user stories.
                  () => scheduleTree(storyRefs.slice(1)),
                  error => err(error, 'changing schedule state of child user stories')
                );
              },
              error => err(
                error, 'getting data on child user stories'
              )
            );
          }
          // Otherwise, i.e. if the user story has no child user stories:
          else {
            // If it needs a schedule-state change:
            if (data.scheduleState !== scheduleState) {
            // Perform it.
              return restAPI.update({
                ref: firstRef,
                data: {
                  ScheduleState: scheduleState
                }
              })
              .then(
                // When its schedule state has been changed:
                () => {
                  report([['changes']]);
                  // Process the remaining user stories.
                  return scheduleTree(storyRefs.slice(1));
                },
                error => err(error, 'changing schedule state of user story')
              );
            }
            // Otherwise, i.e. if the user story does not need a schedule-state change:
            else {
              // Process the remaining user stories.
              return scheduleTree(storyRefs.slice(1));
            }
          }
        },
        error => err(error, 'getting data on user story for schedule-state change')
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
    // Create a task with the first name.
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
      // When it has been created, create tasks with the remaining names.
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
  // Create a test case and set its test-folder property.
  return restAPI.create({
    type: 'testcase',
    fetch: ['_ref'],
    data: {
      Name: name,
      Description: description,
      Owner: owner,
      TestFolder: caseFolderRef || null
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
            if (caseSetRef) {
              // Link the test case to it.
              return restAPI.add({
                ref: caseRef,
                collection: 'TestSets',
                data: [{_ref: caseSetRef}],
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
// Creates test cases.
const createCases = (names, description, owner, storyRef) => {
  if (names.length) {
    // Create the first test case.
    return createCase(names[0], description, owner, storyRef)
    .then(
      // When it has been created, create the rest of the test cases.
      () => {
        report([['changes']]);
        return createCases(names.slice(1), description, owner, storyRef);
      },
      error => err(error, 'creating and linking test case')
    );
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
      return getItemData(firstRef, ['Name', 'Description', 'Owner'], ['Children'])
      .then(
        // When the data arrive:
        data => {
          // If the user story is a leaf or all user stories are to get test cases:
          if (caseTarget === 'all' || ! data.children.count) {
            // Determine the default or customized names of the test cases.
            const caseNames = caseData ? caseData[data.name] || [data.name] : [data.name];
            // Create the test cases.
            return createCases(caseNames, data.description, data.owner, firstRef)
            .then(
              // When they have been created:
              () => {
                report([['total']]);
                // If the user story has child user stories:
                if (data.children.count) {
                  // Get data on them.
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
                    error => err(error, 'getting data on child user stories')
                  );
                }
                // Otherwise, i.e. if the user story has no child user stories:
                else {
                  // Process the remaining user stories.
                  return caseTree(storyRefs.slice(1));
                }
              },
              error => err(error, 'creating test cases')
            );
          }
          // Otherwise, i.e. if the user story has child user stories and is not to get test cases:
          else {
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
              error => err(error, 'getting data on child user stories')
            );
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
const createPass = (caseRef, tester, testSet) => {
  const data = {
    TestCase: caseRef,
    Score: 'Pass',
    Build: passBuild,
    Notes: passNote,
    Date: new Date(),
    Tester: tester,
    TestSet: testSet
  };
  // Create a passing result.
  return restAPI.create({
    type: 'testcaseresult',
    fetch: ['_ref'],
    data
  });
};
// Creates passing results for test cases.
const passCases = caseRefs => {
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
            return passCases(caseRefs.slice(1));
          }
          /*
            Otherwise, if the test case has no results yet but has an owner, it is eligible
            for passing-result creation, so:
          */
          else if (data.owner) {
            // If the test case is in any test sets:
            if (data.testSets.count) {
              // Get data on the test sets.
              return getCollectionData(data.testSets.ref, [], [])
              .then(
                // When the data arrive:
                testSets => {
                  // Create a passing result for the test case in its first test set.
                  return createPass(firstRef, data.owner, testSets[0].ref)
                  .then(
                    // When the result has been created:
                    () => {
                      report([['total'], ['changes']]);
                      // Process the remaining test cases.
                      return passCases(caseRefs.slice(1));
                    },
                    error => err(error, 'creating passing result in test set')
                  );
                },
                error => err(error, 'getting data on test sets')
              );
            }
            // Otherwise, i.e. if the test case is not in any test set:
            else {
              // Create a passing result for the test case.
              return createPass(firstRef, data.owner, null)
              .then(
                // When the result has been created:
                () => {
                  report([['total'], ['changes']]);
                  // Process the remaining test cases.
                  return passCases(caseRefs.slice(1));
                },
                error => err(error, 'creating passing result in no test set')
              );
            }
          }
          // Otherwise, i.e. if the test case has no results and no owner:
          else {
            // Process the remaining test cases.
            return passCases(caseRefs.slice(1));
          }
        },
        error => err(error, 'getting data on test case')
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
const passTree = storyRefs => {
  if (storyRefs.length && ! isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! isError) {
      // Get data on the first user story of the specified array.
      return getItemData(firstRef, [], ['Children', 'TestCases'])
      .then(
        // When the data arrive:
        data => {
          // Processes child user stories and remaining user stories. FUNCTION DEFINITION START
          const passChildrenAndSiblings = () => {
            // If the user story has child user stories:
            if (data.children.count) {
              // Get data on them.
              return getCollectionData(data.children.ref, [], [])
              .then(
                // When the data arrive:
                children => {
                  // Process the child user stories.
                  return passTree(children.map(child => child.ref))
                  .then(
                    // After they are processed, process the remaining user stories.
                    () => passTree(storyRefs.slice(1)),
                    error => err(error, 'creating passing results for child user stories')
                  );
                },
                error => err(error, 'getting data on child user stories')
              );
            }
            // Otherwise, i.e. if the user story has no child user stories:
            else {
              // Process the remaining user stories.
              return passTree(storyRefs.slice(1));
            }      
          };
          // FUNCTION DEFINITION END
          // If the user story has test cases:
          if (data.testCases.count) {
            // Get data on them.
            return getCollectionData(data.testCases.ref, [], [])
            .then(
              // When the data arrive:
              cases => {
                // Process the test cases sequentially.
                return passCases(cases.map(testCase => testCase.ref))
                .then(
                  // After they are processed:
                  () => {
                    // Process child user stories and the remaining user stories.
                    return passChildrenAndSiblings();
                  },
                  error => err(error, 'creating passing results')
                );
              },
              error => err(error, 'getting data on test cases')
            );
          }
          // Otherwise, i.e. if the user story has no test cases:
          else {
            // Process child user stories and the remaining user stories.
            return passChildrenAndSiblings();
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
// Sequentially planifies an array of tasks or an array of test cases.
const planCases = (caseRefs, folderRef) => {
  if (caseRefs.length && ! isError) {
    // Identify and shorten a reference to the first test case.
    const firstRef = shorten('testcase', 'testcase', caseRefs[0]);
    if (! isError) {
      // Get data on the first test case.
      return getItemData(
        firstRef,
        ['Name', 'Description', 'Owner', 'DragAndDropRank', 'Risk', 'Priority', 'Project'],
        []
      )
      .then(
        // When the data arrive:
        data => {
          // Copy the test case.
          return restAPI.create({
            type: 'testcase',
            fetch: ['_ref'],
            data: {
              Name: data.name,
              Description: data.description,
              Owner: data.owner,
              DragAndDropRank: data.dragAndDropRank,
              Risk: data.risk,
              Priority: data.priority,
              Project: data.project,
              TestFolder: folderRef
            }
          })
          .then(
            // When the test case has been copied:
            () => {
              report([['caseChanges']]);
              // Copy the remaining test cases in the specified array.
              return planCases(caseRefs.slice(1), folderRef);
            },
            error => err(error, `copying test case ${firstRef}`)
          );
        },
        error => err(error, 'getting data on test case')
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
// Get data on test cases and planify them.
const getAndPlanCases = (data, folderRef) => {
  // Get data on the tasks or test cases.
  return getCollectionData(data.testCases.ref, [], [])
  .then(
    // When the data arrive:
    cases => {
      // Copy the tasks or test cases.
      return planCases(cases.map(testCase => testCase.ref), folderRef);
    },
    error => err(error, 'getting data on test cases')
  );
};
// Recursively planifies a tree or subtrees of user stories.
const planTree = (storyRefs, parentRef) => {
  if (storyRefs.length && ! isError) {
    // Identify and shorten the reference to the first user story.
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! isError) {
      // Get data on the first user story.
      return getItemData(
        firstRef,
        ['Name', 'Description', 'Project'],
        ['Children', 'TestCases']
      )
      .then(
        // When the data arrive:
        data => {
          const properties = {
            Name: data.name,
            Description: data.description,
            Project: data.project
          };
          if (parentRef) {
            properties.Parent = parentRef;
          }
          // Create a test folder, with the specified parent if any.
          return restAPI.create({
            type: 'testfolder',
            fetch: ['FormattedID'],
            data: properties
          })
          .then(
            // When the user story has been planified:
            folder => {
              // If the test folder is the root, report its formatted ID.
              if (! parentRef) {
                response.write(`event: planRoot\ndata: ${folder.Object.FormattedID}\n\n`);
              }
              report([['storyChanges']]);
              // Identify a short reference to the test folder.
              const folderRef = shorten('testfolder', 'testfolder', folder.Object._ref);
              if (! isError) {
                // Planifies child user stories and remaining user stories.
                const planChildrenAndSiblings = () => {
                  // If the user story has any child user stories:
                  if (data.children.count) {
                    // Get data on them.
                    return getCollectionData(data.children.ref, [], [])
                    .then(
                      // When the data arrive:
                      children => {
                        // Process the child user stories.
                        return planTree(children.map(child => child.ref), folderRef)
                        .then(
                          // When they have been processed:
                          () => {
                            // Process the remaining user stories.
                            return planTree(storyRefs.slice(1), parentRef);
                          },
                          error => err(
                            error,
                            'processing child user stories'
                          )
                        );
                      },
                      error => err(error, 'getting data on child user stories')
                    );
                  }
                  // Otherwise, i.e. if the user story has no child user stories:
                  else {
                    // Process the remaining user stories.
                    return planTree(storyRefs.slice(1), parentRef);
                  }
                };
                // If the original has test cases:
                if (data.testCases.count) {
                  // Get data on them and planify them.
                  return getAndPlanCases(data, folderRef)
                  .then(
                    // When the test cases have been planified:
                    () => {
                      // Process any child user stories of the original and remaining user stories.
                      return planChildrenAndSiblings();
                    },
                    error => err(error, 'getting data on test cases and planifying them')
                  );
                }
                // Otherwise, i.e. if the original has no test cases:
                else {
                  // Process any of its child user stories and the remaining user stories.
                  return planChildrenAndSiblings();
                }
              }
              else {
                return '';
              }
            },
            error => err(error, 'planifying user story')
          );
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
        // Count its test cases, tasks, and child user stories.
        const childCount = data.children.count;
        const taskCount = data.tasks.count;
        const caseCount = data.testCases.count;
        // Initialize the user story’s object.
        storyArray[index] = {
          formattedID: data.formattedID,
          name: data.name,
          taskCount,
          caseCount,
          childCount,
          children: []
        };
        // Add the user story’s task and test-case counts to its ancestors’.
        ancestors.forEach(ancestor => {
          ancestor.taskCount += taskCount;
          ancestor.caseCount += caseCount;
        });
        // If the user story has child user stories:
        if (childCount) {
          // Get data on them.
          getCollectionData(data.children.ref, ['DragAndDropRank'], [])
          .then(
            // When the data arrive:
            children => {
              // Sort the child user stories by rank.
              children.sort((a, b) => a.dragAndDropRank < b.dragAndDropRank ? -1 : 1);
              const childArray = storyArray[index].children;
              const childAncestors = ancestors.concat(storyArray[index]);
              // Process them in parallel, in that order.
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
            error => err(error, 'getting data on child user stories')
          );
        }
        // Send the documentation to the client if apparently complete.
        outDoc();
      },
      error => err(error, 'getting data on user story')
    );
  }
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
  // Options for a server-identifying erroneous request.
  const options = {
    hostname: 'rally1.rallydev.com',
    port: 443,
    path: '/slm/webservice/v2.0/user/1',
    method: 'GET',
    auth: `${process.env.RALLY_USERNAME}:${process.env.RALLY_PASSWORD}`,
    headers: {
      'X-RallyIntegrationName':
      process.env.RALLYINTEGRATIONNAME || 'RallyTree',
      'X-RallyIntegrationVendor':
      process.env.RALLYINTEGRATIONVENDOR || '',
      'X-RallyIntegrationVersion':
      process.env.RALLYINTEGRATIONVERSION || '1.0.4'
    }
  };
  // Make the request.
  const request = https.request(options, response => {
    const chunks = [];
    response.on('data', chunk => {
      chunks.push(chunk);
    });
    // When the response is complete:
    response.on('end', () => {
      // Get its cookie.
      const cookieHeader = response.headers['set-cookie'];
      const neededCookies = [];
      // If it exists:
      if (cookieHeader.length) {
        // Remove all but the needed ones.
        neededCookies.push(...cookieHeader.filter(
          cookie => cookie.startsWith('JSESSIONID') || cookie.startsWith('SUB')
        ));
      }
      // Insert data into the form on the request page.
      fs.readFile('do.html', 'utf8')
      .then(
        htmlContent => {
          const newContent = htmlContent
          .replace(/__storyPrefix__/g, process.env.storyPrefix || '')
          .replace('__scoreRiskMin__', process.env.scoreRiskMin || '0')
          .replace('__scoreRiskMax__', process.env.scoreRiskMax || '3')
          .replace('__scorePriorityMin__', process.env.scorePriorityMin || '0')
          .replace('__scorePriorityMax__', process.env.scorePriorityMax || '3')
          .replace('__userName__', RALLY_USERNAME)
          .replace('__password__', RALLY_PASSWORD)
          .replace('__cookie__', neededCookies.join('\r\n'));
          // Serve the page.
          servePage(newContent, false);
        },
        error => err(error, 'reading do page')
      );
    });
  });
  request.on('error', error => {
    err(error, 'requesting a server identification');
  });
  request.end();
};
// Interpolates universal content into a report.
const reportPrep = (content, jsContent) => {
  return content
  .replace('__script__', jsContent)
  .replace('__rootRef__', rootRef)
  .replace('__userName__', userName)
  .replace('__userRef__', userRef);
};
// Interpolates operation-specific content into the report script.
const reportScriptPrep = (content, eventSource, events) => {
  return content
  .replace('__eventSource__', eventSource)
  .replace(
    'let __events__', `let __events__ = [${events.map(event => '\'' + event + '\'').join(', ')}]`
  );
};
// Serves the copy report page.
const serveCopyReport = () => {
  fs.readFile('copyReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(
            jsContent, '/copytally', ['total', 'storyTotal', 'taskTotal', 'caseTotal', 'error']
          );
          const newContent = reportPrep(htmlContent, newJSContent)
          .replace('__parentRef__', copyParentRef);
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
      );
    },
    error => err(error, 'reading copyReport page')
  );
};
// Serves the score report page.
const serveScoreReport = () => {
  fs.readFile('scoreReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(jsContent, '/scoretally', [
            'total',
            'passes',
            'fails',
            'defects',
            'major',
            'minor',
            'score',
            'numerator',
            'denominator',
            'error'
          ]);
          const newContent = reportPrep(htmlContent, newJSContent)
          .replace('__riskMin__', scoreWeights.risk[scoreRisks[0]])
          .replace('__priorityMin__', scoreWeights.priority[scorePriorities[0]])
          .replace('__riskMax__', scoreWeights.risk[scoreRisks.slice(-1)])
          .replace('__priorityMax__', scoreWeights.priority[scorePriorities.slice(-1)]);
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
      );
    },
    error => err(error, 'reading scoreReport page')
  );
};
// Serves the change-owner report page.
const serveTakeReport = name => {
  fs.readFile('takeReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(jsContent, '/taketally', [
            'total',
            'storyTotal',
            'taskTotal',
            'caseTotal',
            'changes',
            'storyChanges',
            'taskChanges',
            'caseChanges',
            'error'
          ]);
          const newContent = reportPrep(htmlContent, newJSContent)
          .replace('__takeWhoName__', name)
          .replace('__takeWhoRef__', takeWhoRef);
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
      );
    },
    error => err(error, 'reading takeReport page')
  );
};
// Serves the change-project report page.
const serveProjectReport = (projectWhich, projectRelease, projectIteration) => {
  fs.readFile('projectReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(
            jsContent,
            '/projecttally',
            [
              'total', 'changes', 'projectChanges', 'releaseChanges', 'iterationChanges', 'error'
            ]
          );
          const newContent = reportPrep(htmlContent, newJSContent)
          .replace('__projectWhich__', projectWhich)
          .replace('__projectRef__', projectRef)
          .replace('__projectRelease__', projectRelease)
          .replace('__projectIteration__', projectIteration);
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
      );
    },
    error => err(error, 'reading projectReport page')
  );
};
// Serves the schedule-state report page.
const serveScheduleReport = () => {
  fs.readFile('scheduleReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(
            jsContent, '/scheduletally', ['total', 'changes', 'error']
          );
          const newContent = reportPrep(htmlContent, newJSContent)
          .replace('__scheduleState__', scheduleState);
          servePage(newContent, true);
        },
        error => err(error, 'reading scheduleReport script')
      );
    },
    error => err(error, 'reading scheduleReport page')
  );
};
// Serves the add-tasks report page.
const serveTaskReport = () => {
  fs.readFile('taskReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(
            jsContent, '/tasktally', ['total', 'changes', 'error']
          );
          const taskCount = `${taskNames.length} task${
            taskNames.length > 1 ? 's' : ''
          }`;
          const newContent = reportPrep(htmlContent, newJSContent)
          .replace('__taskCount__', taskCount)
          .replace('__taskNames__', taskNames.join('\n'));
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
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
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(
            jsContent, '/casetally', ['total', 'changes', 'error']
          );
          const newContent = reportPrep(htmlContent, newJSContent);
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
      );
    },
    error => err(error, 'reading caseReport page')
  );
};
// Serves the pass-test-case report page.
const servePassReport = () => {
  fs.readFile('passReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(
            jsContent, '/passtally', ['total', 'changes']
          );
          const newContent = reportPrep(htmlContent, newJSContent);
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
      );
    },
    error => err(error, 'reading passReport page')
  );
};
// Serves the planification report page.
const servePlanReport = () => {
  fs.readFile('planReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(
            jsContent, '/plantally', ['planRoot', 'storyChanges', 'caseChanges', 'error']
          );
          const newContent = reportPrep(htmlContent, newJSContent);
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
      );
    },
    error => err(error, 'reading planReport page')
  );
};
// Serves the documentation report page.
const serveDocReport = () => {
  fs.readFile('docReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(
            jsContent, '/doc', ['doc', 'error']
          );
          const newContent = reportPrep(htmlContent, newJSContent);
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
      );
    },
    error => err(error, 'reading docReport page')
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
        caseSetRef = shorten('testset', 'testset', ref);
        if (! isError) {
          // Check on the existence of the test set.
          getItemData(caseSetRef, [], [])
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
/*
  Returns the long reference of a member of a collection with a project-unique name.
  Release and iteration names are project-unique, not globally unique.
*/
const getProjectNameRef = (projectRef, type, name, context) => {
  // If a nonblank name has been specified:
  if (name.length) {
    /*
      Get a reference to the specified member of the specified collection of the
      specified project.
    */
    restAPI.query({
      type,
      fetch: '_ref',
      query: queryUtils.where('Name', '=', name).and('Project', '=', projectRef)
    })
    .then(
      result => {
        const resultArray = result.Results;
        // If the member exists:
        if (resultArray.length) {
          // Return its reference.
          return resultArray[0]._ref;
        }
        else {
          return err('No such name', `getting reference to ${type} for ${context}`);
        }
      },
      error => err(error, `getting reference to ${type} for ${context}`)
    );
  }
  // Otherwise, i.e. if a blank name has been specified:
  else {
    // Return blank.
    return Promise.resolve('');
  }
};
/*
  Returns the short reference to a member of a collection with a globally unique name.
  User and project names are globally unique.
*/
const getGlobalNameRef = (name, type, key) => {
  if (name) {
    return restAPI.query({
      type,
      query: queryUtils.where(key, '=', name)
    })
    .then(
      result => {
        const resultArray = result.Results;
        if (resultArray.length) {
          return shorten(type, type, resultArray[0]._ref);
        }
        else {
          err(`No such ${type}`, `getting reference to ${type}`);
          return '';
        }
      },
      error => {
        err(error, `getting reference to ${type}`);
        return '';
      }
    );
  }
  else {
    return Promise.resolve('');
  }
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
      if (requestURL === '/do.html') {
        // Serves the request page (in a new tab, per the link to this URL).
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
      else if (requestURL === '/copytally' && idle) {
        streamInit();
        copyTree([rootRef], copyParentRef);
      }
      else if (requestURL === '/scoretally' && idle) {
        streamInit();
        scoreTree(rootRef);
      }
      else if (requestURL === '/taketally' && idle) {
        streamInit();
        takeTree([rootRef]);
      }
      else if (requestURL === '/projecttally' && idle) {
        streamInit();
        projectTree([rootRef]);
      }
      else if (requestURL === '/scheduletally' && idle) {
        streamInit();
        schedulableCount([rootRef]).then(() => scheduleTree([rootRef]));
      }
      else if (requestURL === '/tasktally' && idle) {
        streamInit();
        taskTree([rootRef]);
      }
      else if (requestURL === '/casetally' && idle) {
        streamInit();
        caseTree([rootRef]);
      }
      else if (requestURL === '/passtally' && idle) {
        streamInit();
        passTree([rootRef]);
      }
      else if (requestURL === '/plantally' && idle) {
        streamInit();
        planTree([rootRef], '');
      }
      else if (requestURL === '/doc' && idle) {
        streamInit();
        docTree(rootRef, doc, 0, []);
      }
    }
    // Otherwise, if the request submits the request form:
    else if (method === 'POST' && requestURL === '/do.html') {
      reinit();
      // Permit an event stream to be started.
      idle = true;
      const bodyObject = parse(Buffer.concat(bodyParts).toString());
      const {cookie, op, password, rootID} = bodyObject;
      userName = bodyObject.userName;
      RALLY_USERNAME = userName;
      RALLY_PASSWORD = password;
      // If the user has not deleted the content of the cookie field:
      if (cookie.length) {
        // Make every request in the session include the cookie, forcing single-host mode.
        requestOptions.headers.Cookie = cookie.split('\r\n').join('; ');
      }
      // Create and configure a Rally API client.
      restAPI = rally({
        user: userName,
        pass: password,
        requestOptions
      });
      // Assigns values to global variables for handling POST requests.
      const setGlobals = () => {
        // Get a long reference to the root user story.
        return getRef('hierarchicalrequirement', rootID, 'tree root')
        .then(
          // When it arrives:
          ref => {
            if (! isError) {
            // Set its global variable.
              rootRef = shorten('userstory', 'hierarchicalrequirement', ref);
              if (! isError) {
                // Get a reference to the user.
                return getGlobalNameRef(userName, 'user', 'UserName')
                .then(
                  // When it arrives:
                  ref => {
                    // Set its global variable.
                    userRef = ref;
                    return '';
                  },
                  error => err(error, 'getting reference to user')
                );
              }
              else {
                return '';
              }
            }
            else {
              return '';
            }
          },
          error => err(error, 'getting reference to root user story')
        );
      };
      // Get a long reference to the root user story.
      setGlobals()
      .then(
        () => {
          if (isError) {
            return '';
          }
          // OP COPYING
          else if (op === 'copy') {
            // Set the operation’s global variables.
            copyState = bodyObject.copyState;
            copyWhat = bodyObject.copyWhat;
            // Get a reference to the copy parent.
            getRef('hierarchicalrequirement', bodyObject.copyParent, 'parent of tree copy')
            .then(
              // When it arrives:
              ref => {
                // Set its global variable. 
                copyParentRef = shorten('userstory', 'hierarchicalrequirement', ref);
                if (! isError) {
                  // Get data on the copy parent.
                  getItemData(copyParentRef, ['Project'], ['Tasks'])
                  .then(
                    // When the data arrive:
                    data => {
                      // If the copy parent has tasks:
                      if (data.tasks.count) {
                        // Reject the request.
                        err('Attempt to copy to a user story with tasks', 'copying tree');
                      }
                      // Otherwise, i.e. if the copy parent has no tasks:
                      else {
                        // Get a reference to the specified project, if any.
                        getGlobalNameRef(bodyObject.copyProject, 'project', 'Project')
                        .then(
                          // When it or blank arrives:
                          ref => {
                            // Set its global variable.
                            copyProjectRef = ref || data.project;
                            // Get a reference to the specified owner, if any.
                            getGlobalNameRef(bodyObject.copyOwner, 'user', 'UserName')
                            .then(
                              // When it or blank arrives:
                              ref => {
                                // Set its global variable.
                                copyOwnerRef = ref;
                                // Get a reference to the specified release, if any.
                                getProjectNameRef(
                                  copyProjectRef, 'release', bodyObject.copyRelease, 'copy'
                                )
                                .then(
                                  // When it or blank arrives:
                                  ref => {
                                    // Set its global variable.
                                    copyReleaseRef = ref;
                                    // Get a reference to the specified iteration, if any.
                                    getProjectNameRef(
                                      copyProjectRef, 'iteration', bodyObject.copyIteration, 'copy'
                                    )
                                    .then(
                                      // When it or blank arrives:
                                      ref => {
                                        // Set its global variable.
                                        copyIterationRef = ref;
                                        // Copy the tree.
                                        serveCopyReport();
                                      },
                                      error => err(error, 'getting reference to iteration')
                                    );
                                  },
                                  error => err(error, 'getting reference to release')
                                );
                              },
                              error => err(error, 'getting reference to owner')
                            );
                          },
                          error => err(error, 'getting reference to project')
                        );
                      }
                    },
                    error => err(error, 'getting data on copy parent')
                  );
                }
              },
              error => err(error, 'getting reference to copy parent')
            );
          }
          // OP SCORING
          else if (op === 'score') {
            // Checks for weight errors.
            const validateWeights = (name, min, max) => {
              const context = 'retrieving score';
              const minNumber = Number.parseInt(min);
              const maxNumber = Number.parseInt(max);
              if (Number.isNaN(minNumber) || Number.isNaN(maxNumber)) {
                err(`Nonnumeric ${name} weight`, context);
              }
              else if (minNumber < 0 || maxNumber < 0) {
                err(`Negative ${name} weight`, context);
              }
              else if (maxNumber < minNumber) {
                err(`Maximum ${name} weight smaller than minimum`, context);
              }
            };
            // Sets the score weights.
            const setScoreWeights = (key, values, min, max) => {
              const minNumber = Number.parseInt(min, 10);
              scoreWeights[key] = {};
              for (let i = 0; i < values.length; i++) {
                scoreWeights[key][values[i]]
                  = minNumber
                  + i * (Number.parseInt(max, 10) - minNumber) / (values.length - 1);
              }
            };
            const {scoreRiskMin, scoreRiskMax, scorePriorityMin, scorePriorityMax} = bodyObject;
            // Validate the weights.
            validateWeights('risk', scoreRiskMin, scoreRiskMax);
            if (! isError) {
              validateWeights('priority', scorePriorityMin, scorePriorityMax);
              if (! isError) {
                // Set the score weights.
                setScoreWeights('risk', scoreRisks, scoreRiskMin, scoreRiskMax);
                setScoreWeights('priority', scorePriorities, scorePriorityMin, scorePriorityMax);
                // Serve a report of the scores.
                serveScoreReport();
              }
            }
          }
          // OP OWNERSHIP CHANGE
          else if (op === 'take') {
            const {takeWho} = bodyObject;
            // If an owner other than the user was specified:
            if (takeWho) {
              // Serve a report identifying the new owner.
              getGlobalNameRef(takeWho, 'user', 'UserName')
              .then(
                ref => {
                  if (! isError) {
                    takeWhoRef = ref;
                    serveTakeReport(takeWho);
                  }
                },
                error => err(error, 'getting reference to new owner')
              );
            }
            // Otherwise, the new owner will be the user, so:
            else {
              takeWhoRef = userRef;
              // Serve a report identifying the user as new owner.
              serveTakeReport(userName);
            }
          }
          // OP PROJECT CHANGE
          else if (op === 'project') {
            const {projectWhich, projectRelease, projectIteration} = bodyObject;
            // Get a reference to the named project.
            getGlobalNameRef(projectWhich, 'project', 'Name')
            .then(
              // When it arrives:
              ref => {
                // Set its global variable.
                projectRef = ref;
                // Get a reference to the named release.
                getProjectNameRef(ref, 'release', projectRelease, 'project change')
                .then(
                  // When it arrives:
                  ref => {
                    // Set its global variable.
                    projectReleaseRef = ref;
                    // Get a reference to the named iteration.
                    getProjectNameRef(rootRef, 'iteration', projectIteration, 'scheduling')
                    .then(
                      // When it arrives:
                      ref => {
                        // Set its global variable.
                        projectIterationRef = ref;
                        // Serve a report identifying the project, release, and iteration.
                        serveProjectReport(projectWhich, projectRelease, projectIteration);
                      },
                      error => err(error, 'getting reference to iteration')
                    );
                  },
                  error => err(error, 'getting reference to release')
                );
              },
              error => err(error, 'getting reference to new project')
            );
          }
          // OP SCHEDULING
          else if (op === 'schedule') {
            // Set the global schedule-state variable.
            scheduleState = bodyObject.scheduleState;
            // Serve a report.
            serveScheduleReport();
          }
          // OP TASK CREATION
          else if (op === 'task') {
            const {taskName} = bodyObject;
            if (taskName.length < 2) {
              err('Task names invalid', 'creating tasks');
            }
            else {
              const delimiter = taskName[0];
              taskNames.push(...taskName.slice(1).split(delimiter));
              if (taskNames.every(taskName => taskName.length)) {
                serveTaskReport();
              }
              else {
                err('Empty task name', 'creating tasks');
              }
            }
          }
          // OP TEST-CASE CREATION
          else if (op === 'case') {
            caseTarget = bodyObject.caseTarget;
            const {caseFolder, caseSet} = bodyObject;
            // If a test folder was specified:
            if (caseFolder) {
              getRef('testfolder', caseFolder, 'test-case creation')
              .then(
                ref => {
                  if (! isError) {
                    caseFolderRef = shorten('testfolder', 'testfolder', ref);
                    if (! isError) {
                      // Get data on the test folder.
                      getItemData(caseFolderRef, [], [])
                      .then(
                        // When the data arrive:
                        () => {
                          // If a test set was specified:
                          if (caseSet) {
                            // Verify it and serve a report on test-case creation.
                            serveCaseIfSet(caseSet);
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
            else if (caseSet) {
              // Process the test set and serve a report on test-case creation.
              serveCaseIfSet(caseSet);
            }
            // Otherwise, i.e. if neither a test folder nor a test set was specified:
            else {
              // Serve a report on test-case creation.
              serveCaseReport();
            }
          }
          // OP PASSING
          else if (op === 'pass') {
            if (! passBuild) {
              err('Build blank', 'passing test cases');
            }
            else {
              passBuild = bodyObject.passBuild;
              passNote = bodyObject.passNote;
              // Serve a report on passing-result creation.
              servePassReport();
            }
          }
          // OP PLANIFICITATION
          else if (op === 'plan') {
            // Planify the tree.
            servePlanReport();
          }
          // OP DOCUMENTATION
          else if (op === 'doc') {
            // Serve a report of the tree documentation.
            serveDocReport();
          }
          else {
            err('Unknown operation', 'RallyTree');
          }
        },
        error => err(error, 'setting global variables')
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
