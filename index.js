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
let build = '';
let copyParentProject = '';
let copyParentRef = '';
let copyWhat = 'both';
let isError = false;
let iterationRef = '';
let note = '';
let projectRef = '';
let releaseRef = '';
let response = {};
let restAPI = {};
let rootRef = '';
let scheduleState = 'unchanged';
let takerRef = '';
let taskNames = [];
let testFolderRef = '';
let testSetRef = '';
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
  copyParentProject = '';
  copyParentRef = '';
  copyWhat = 'both';
  isError = false;
  iterationRef = '';
  note = '';
  projectRef = '';
  releaseRef = '';
  restAPI = {};
  rootRef = '';
  scheduleState = 'unchanged';
  takerRef = '';
  taskNames = [];
  testFolderRef = '';
  testSetRef = '';
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
              Owner: data.owner,
              DragAndDropRank: data.dragAndDropRank,
              WorkProduct: storyRef
            };
            /*
              If the item is a test case, it will not automatically inherit the project of its
              user story, so specify its project.
            */
            if (workItemType === 'testcase') {
              config.Project = copyParentProject;
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
// Get data or tasks or test cases and copy them.
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
                Parent: parentRef,
                Project: copyParentProject
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
                            return copyTree(storyRefs.slice(1), parentRef);
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
                    // Get data on the tasks and copy them.
                    return getAndCopyTasksOrCases('task', 'tasks', data, copyRef)
                    .then(
                      // When the tasks have been copied:
                      () => {
                        // Get data on the test cases and copy them.
                        return getAndCopyTasksOrCases('case', 'testCases', data, copyRef)
                        .then(
                          // When the test cases have been copied:
                          () => {
                            // Process the remaining user stories.
                            return copyTree(storyRefs.slice(1), parentRef);
                          },
                          error => err(error, 'getting data on test cases and copying them')
                        );
                      },
                      error => err(error, 'getting data on tasks and copying them')
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
                    // Get data on the tasks and copy them.
                    return getAndCopyTasksOrCases('task', 'tasks', data, copyRef)
                    .then(
                      // When the tasks have been copied:
                      () => {
                        // Process the remaining user stories.
                        return copyTree(storyRefs.slice(1), parentRef);
                      },
                      error => err(error, 'getting data on tasks and copying them')
                    );
                  }
                  /*
                    Otherwise, if the original has no child user stories and has test cases and they
                    are to be copied:
                  */
                  else if (
                    data.testCases.count
                    && ['cases', 'both'].includes(copyWhat)
                    && ! data.children.count
                  ) {
                    // Get data on the test cases and copy them.
                    return getAndCopyTasksOrCases('case', 'testCases', data, copyRef)
                    .then(
                      // When the test cases have been copied:
                      () => {
                        // Process the remaining user stories.
                        return copyTree(storyRefs.slice(1), parentRef);
                      },
                      error => err(error, 'getting data on test cases and copying them')
                    );
                  }
                  // Otherwise, i.e. if the original has nothing other than itself to be copied:
                  else {
                    // Process the remaining user stories.
                    return copyTree(storyRefs.slice(1), parentRef);
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
                error => err(error, 'getting data on test cases after tasks for ownership change')
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
    // Otherwise, if the user story has test cases and no child user stories or tasks:
    else if (data.testCases.count && ! data.tasks.count && ! data.children.count) {
      // Get data on the test cases.
      return getCollectionData(data.testCases.ref, ['Owner'], [])
      .then(
        // When the data arrive:
        cases => {
          // Process the test cases.
          return takeTasksOrCases('case', cases);
        },
        error => err(error, 'getting data on test cases for ownership change')
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
      return Promise.resolve('');
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
// Recursively changes project affiliations in a tree or subtree of user stories: original version.
const projectTree = storyRefs => {
  if (storyRefs.length && ! isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! isError) {
      // Get data on the first user story of the specified array.
      return getItemData(firstRef, ['Project'], ['Children'])
      .then(
        // When the data arrive:
        data => {
          const oldProjectRef = data.project ? shorten('project', 'project', data.project) : '';
          if (! isError) {
            // Processes the children of the user story.
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
            // If the user story belongs to no or a non-intended project:
            if (oldProjectRef && oldProjectRef !== projectRef || ! oldProjectRef) {
              // Change its project.
              return restAPI.update({
                ref: firstRef,
                data: {
                  Project: projectRef
                }
              })
              .then(
                // When the project has been changed:
                () => {
                  report([['total'], ['changes']]);
                  // Process its children and the remaining user stories.
                  return processMore();
                },
                error => err(error, 'changing project of user story')
              );
            }
            // Otherwise, i.e. if the user story belongs to the intended project:
            else {
              report([['total']]);
              // Process its children and the remaining user stories.
              return processMore();
            }
          }
          else {
            return '';
          }
        },
        error => err(error, 'getting data on user story for project change')
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
/*
// Recursively changes project affiliations in a tree or subtree of user stories: parallel version.
const projectTreeParallel = storyRefs => {
  if (storyRefs.length && ! isError) {
    // For the root of the tree or of each subtree:
    storyRefs.forEach(storyRef => {
      if (! isError) {
        const shortRef = shorten('userstory', 'hierarchicalrequirement', storyRef);
        if (! isError) {
          // Get data on it.
          getItemData(storyRef, ['Project'], ['Children'])
          .then(
            // When the data arrive:
            data => {
              const oldProjectRef = data.project ? shorten('project', 'project', data.project) : '';
              if (! isError) {
                // Process its children.
                getCollectionData(data.children.ref, [], [])
                .then(
                  children => {
                    projectTreeParallel(children.map(child => child.ref));
                  },
                  error => err(error, 'getting data on children of user story')
                );
                // If the user story belongs to no or a non-intended project:
                if (oldProjectRef && oldProjectRef !== projectRef || ! oldProjectRef) {
                  // Change its project.
                  restAPI.update({
                    ref: storyRef,
                    data: {
                      Project: projectRef
                    }
                  })
                  .then(
                    () => {
                      report([['total'], ['changes']]);
                    },
                    error => err(error, 'changing project of user story')
                  );
                }
                // Otherwise, i.e. if the user story belongs to the intended project:
                else {
                  report([['total']]);
                }
              }
            },
            error => err(error, 'getting data on user story for project change')
          );
        }
      }
    });
  }
};
*/
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
// Recursively sets releases and iterations in a tree or subtree of user stories.
const scheduleTree = storyRefs => {
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
                return scheduleTree(children.map(child => child.ref))
                .then(
                  // After they are processed, process the remaining user stories.
                  () => scheduleTree(storyRefs.slice(1)),
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
                report([['changes']]);
                // Process the remaining user stories.
                return scheduleTree(storyRefs.slice(1));
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
  // Create a test case and set its test-folder property.
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
            // Determine their names.
            const caseNames = caseData ? caseData[data.name] || [data.name] : [data.name];
            // Create and link the test cases.
            return createCases(caseNames, data.description, data.owner, firstRef)
            .then(
              // When they have been created:
              () => {
                report([['total']]);
                // Process the remaining user stories.
                return caseTree(storyRefs.slice(1));
              },
              error => err(error, 'creating and linking test cases')
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
const createPass = (caseRef, tester, build, testSet, note) => {
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
                  return createPass(firstRef, data.owner, build, testSets[0].ref, note)
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
              return createPass(firstRef, data.owner, build, null, note)
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
const passTree = storyRefs => {
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
                return passTree(children.map(child => child.ref))
                .then(
                  // After they are processed, process the remaining user stories.
                  () => passTree(storyRefs.slice(1)),
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
                  () => passTree(storyRefs.slice(1)),
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
    error => err(error, 'reading caseReport page')
  );
};
// Serves the verdict report page.
const serveVerdictReport = () => {
  fs.readFile('verdictReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(jsContent, '/verdicttally', [
            'total', 'passes', 'fails', 'defects', 'major', 'minor', 'error'
          ]);
          const newContent = reportPrep(htmlContent, newJSContent);
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
      );
    },
    error => err(error, 'reading verdictReport page')
  );
};
// Serves the change-owner report page.
const serveTakeReport = takerName => {
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
          .replace('__takerName__', takerName)
          .replace('__takerRef__', takerRef);
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
      );
    },
    error => err(error, 'reading takeReport page')
  );
};
// Serves the change-project report page.
const serveProjectReport = projectName => {
  fs.readFile('projectReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(
            jsContent, '/projecttally', ['total', 'changes', 'error']
          );
          const newContent = reportPrep(htmlContent, newJSContent)
          .replace('__projectName__', projectName)
          .replace('__projectRef__', projectRef);
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
      );
    },
    error => err(error, 'reading projectReport page')
  );
};
// Serves the release and iteration report page.
const serveWhenReport = (releaseName, iterationName) => {
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
          .replace('__releaseName__', releaseName)
          .replace('__releaseRef__', releaseRef)
          .replace('__iterationName__', iterationName)
          .replace('__iterationRef__', iterationRef)
          .replace('__scheduleState__', scheduleState);
          servePage(newContent, true);
        },
        error => err(error, 'reading wheeport script')
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
    error => err(error, 'reading resultReport page')
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
/*
  Returns the long reference of a member of a collection with a project-unique name.
  Release and iteration names are project-unique, not globally unique.
*/
const getProjectNameRef = (type, name, context) => {
  if (name.length) {
    // Identify the root user story’s project.
    return getItemData(rootRef, ['Project'], [])
    .then(
      // When it has been identified, get the reference of the specified member.
      data => restAPI.query({
        type,
        fetch: '_ref',
        query: queryUtils.where('Name', '=', name).and('Project', '=', data.project)
      }),
      error => err(error, 'getting root user story’s project')
    )
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
  else {
    err('Empty name', `getting reference to ${type} for ${context}`);
    return Promise.resolve('');
  }
};
/*
  Returns the short reference to a member of a collection with a globally unique name.
  User and project names are globally unique.
*/
const getGlobalNameRef = (name, type, key) => {
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
      else if (requestURL === '/copytally' && idle) {
        streamInit();
        copyTree([rootRef], copyParentRef);
      }
      else if (requestURL === '/verdicttally' && idle) {
        streamInit();
        verdictTree(rootRef);
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
      userName = bodyObject.userName;
      const {
        cookie,
        iterationName,
        op,
        parentID,
        password,
        projectName,
        releaseName,
        rootID,
        sState,
        takerName,
        taskNameString,
        testFolderID,
        testSetID
      } = bodyObject;
      copyWhat = bodyObject.copyWhat;
      build = bodyObject.build;
      note = bodyObject.note;
      RALLY_USERNAME = userName;
      RALLY_PASSWORD = password;
      // If the form contains a cookie:
      if (cookie.length) {
        // Make every request in this session include it, forcing single-host mode.
        requestOptions.headers.Cookie = cookie.split('\r\n').join('; ');
      }
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
              getGlobalNameRef(userName, 'user', 'UserName')
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
                    // Otherwise, if the operation is verdict acquisition:
                    else if (op === 'verdict') {
                      // Serve a report of the verdicts.
                      serveVerdictReport();
                    }
                    // Otherwise, if the operation is ownership change:
                    else if (op === 'take') {
                      // If an owner other than the user was specified:
                      if (takerName) {
                        // Serve a report identifying the new owner.
                        getGlobalNameRef(takerName, 'user', 'UserName')
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
                    // Otherwise, if the operation is project change:
                    else if (op === 'project') {
                      // Serve a report identifying the new project.
                      getGlobalNameRef(projectName, 'project', 'Name')
                      .then(
                        ref => {
                          if (! isError) {
                            projectRef = ref;
                            serveProjectReport(projectName);
                          }
                        },
                        error => err(error, 'getting reference to new project')
                      );
                    }
                    // Otherwise, if the operation is scheduling:
                    else if (op === 'schedule') {
                      scheduleState = sState;
                      // Get the reference of the named release.
                      getProjectNameRef('release', releaseName, 'scheduling')
                      .then(
                        ref => {
                          if (! isError) {
                            releaseRef = ref;
                            // Get the reference of the named iteration.
                            getProjectNameRef('iteration', iterationName, 'scheduling')
                            .then(
                              ref => {
                                if (! isError) {
                                  iterationRef = ref;
                                  // Serve a report identifying the release and iteration.
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
                    // Otherwise, if the operation is task creation:
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
                    // Otherwise, if the operation is passing-result creation:
                    else if (op === 'pass') {
                      // Serve a report on passing-result creation.
                      servePassReport();
                    }
                    // Otherwise, if the operation is tree copying:
                    else if (op === 'copy') {
                      getRef('hierarchicalrequirement', parentID, 'parent of tree copy')
                      .then(
                        ref => {
                          if (! isError) {
                            copyParentRef = shorten(
                              'userstory', 'hierarchicalrequirement', ref
                            );
                            if (! isError) {
                              // Get data on the parent user story of the copy.
                              getItemData(copyParentRef, ['Project'], ['Tasks'])
                              .then(
                                data => {
                                  // When the data arrive:
                                  if (data.tasks.count) {
                                    err(
                                      'Attempt to copy to a user story with tasks', 'copying tree'
                                    );
                                  }
                                  else {
                                    copyParentProject = data.project;
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
