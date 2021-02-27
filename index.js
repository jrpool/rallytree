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

// ########## GLOBAL CONSTANTS

// Time in ms to wait before guessing that documentation is complete.
const docWait = 1500;
const queryUtils = rally.util.query;
// REST API.
const requestOptions = {
  headers: {
    'X-RallyIntegrationName':
    process.env.RALLYINTEGRATIONNAME || 'RallyTree',
    'X-RallyIntegrationVendor':
    process.env.RALLYINTEGRATIONVENDOR || '',
    'X-RallyIntegrationVersion':
    process.env.RALLYINTEGRATIONVERSION || '1.8.1'
  }
};
const scorePriorities = ['None', 'Useful', 'Important', 'Critical'];
const scoreRisks = ['None', 'Low', 'Medium', 'High'];
const totalInit = {
  caseChanges: 0,
  caseTotal: 0,
  changes: 0,
  defects: 0,
  denominator: 0,
  fails: 0,
  folderChanges: 0,
  folderTotal: 0,
  iterationChanges: 0,
  major: 0,
  minor: 0,
  numerator: 0,
  passes: 0,
  projectChanges: 0,
  releaseChanges: 0,
  score: 0,
  scoreVerdicts: 0,
  setChanges: 0,
  setTotal: 0,
  storyChanges: 0,
  storyTotal: 0,
  taskChanges: 0,
  taskTotal: 0,
  total: 0,
  verdicts: 0
};
const totals = Object.assign({}, totalInit);
const globalInit = {
  caseFolderRef: '',
  caseProjectRef: '',
  caseSetRef: '',
  caseTarget: 'all',
  copyIterationRef: '',
  copyOwnerRef: '',
  copyParentRef: '',
  copyParentType: 'hierarchicalrequirement',
  copyProjectRef: '',
  copyReleaseRef: '',
  copyWhat: 'both',
  doc: [],
  docTimeout: 0,
  groupFolderRef: '',
  groupSetRef: '',
  idle: false,
  isError: false,
  passBuild: '',
  passNote: '',
  planHow: 'use',
  projectIterationRef: null,
  projectRef: '',
  projectReleaseRef: null,
  reportServed: false,
  restAPI: {},
  rootRef: '',
  scoreWeights: {
    risk: {},
    priority: {}
  },
  state: {
    story: '',
    task: ''
  },
  takeWhoRef: '',
  taskNames: [],
  userName: '',
  userRef: ''
};
const globals = Object.assign({}, globalInit);

// ########## GLOBAL VARIABLES

let {RALLY_USERNAME, RALLY_PASSWORD} = process.env;
RALLY_USERNAME = RALLY_USERNAME || '';
RALLY_PASSWORD = RALLY_PASSWORD || '';
let response = {};

// ########## FUNCTIONS

// ==== OPERATION UTILITIES ====
// Reinitializes the global variables, except response.
const reinit = () => {
  Object.assign(totals, totalInit);
  Object.assign(globals, globalInit);
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
  globals.isError = true;
  const pageMsg = msg.replace(/\n/g, '<br>');
  // If a report page has been served:
  if (globals.reportServed) {
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
// Returns the short form of a reference.
const shorten = (readType, writeType, longRef) => {
  if (longRef) {
    // If it is already a short reference, return it.
    const shortTest = new RegExp(`^/${writeType}/\\d+$`);
    if (shortTest.test(longRef)) {
      return longRef;
    }
    // Otherwise, i.e. if it is not yet a short reference:
    else {
      // Return its short version.
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
  }
  else {
    return '';
  }
};
// Returns a Promise of a long reference to a collection member.
const getRef = (type, formattedID, context) => {
  if (formattedID) {
    const numericID = formattedID.replace(/^[A-Za-z]+/, '');
    if (/^\d+$/.test(numericID)) {
      return globals.restAPI.query({
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
            return err('No such ID', `getting reference to ${type} for ${context}`);
          }
        },
        error => err(error, `getting reference to ${type} for ${context}`)
      );
    }
    else {
      err('Invalid ID', `getting reference to ${type} for ${context}`);
      return Promise.resolve('');
    }
  }
  else {
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
// Returns a Promise of data on a work item.
const getItemData = (ref, facts, collections) => {
  if (ref) {
    // Get data on the facts and collections of the specified item.
    return globals.restAPI.get({
      ref,
      fetch: facts.concat(collections)
    })
    .then(
      // When the data arrive:
      item => {
        const obj = item.Object;
        // Initialize an object of data, to contain a property for each fact and collection.
        const data = {};
        // Add the fact properties with string values: value if a string or reference if an object.
        facts.forEach(fact => {
          data[lc0Of(fact)] = obj[fact] !== null && typeof obj[fact] === 'object'
            ? obj[fact]._ref
            : obj[fact];
        });
        // Add the collection properties with object values having reference and count properties.
        collections.forEach(collection => {
          data[lc0Of(collection)] = {
            ref: obj[collection]._ref,
            count: obj[collection].Count
          };
        });
        // Return the object.
        return data;
      },
      error => err(error, `getting data on ${ref}`)
    );
  }
  else {
    return Promise.resolve({});
  }
};
// Returns a Promise of data, i.e. an array of member objects, on a collection.
const getCollectionData = (ref, facts, collections) => {
  if (ref) {
    // Get data on the facts and collections of the members of the specified collection.
    return globals.restAPI.get({
      ref,
      fetch: facts.concat(collections)
    })
    .then(
      // When the data arrive:
      collection => {
        const members = collection.Object.Results;
        // Initialize an array of data.
        const data = [];
        // For each member of the collection:
        members.forEach(member => {
          // Initialize an object of member data with property “ref”, a long reference to it.
          const memberData = {
            ref: member._ref
          };
          /*
            Add fact properties to the object. Each has the dromedary-case fact name as its key
            and the fact’s value if a string or a reference to the fact if an object as its value.
          */
          facts.forEach(fact => {
            memberData[lc0Of(fact)] = member[fact] !== null && typeof member[fact] === 'object'
              ? member[fact]._ref
              : member[fact];
          });
          /*
            Add collection properties to the object. Each has the dromedary-case collection name
            as its key and an object with “ref” and “count” properties as its value.
          */
          collections.forEach(collection => {
            memberData[lc0Of(collection)] = {
              ref: member[collection]._ref,
              count: member[collection].Count
            };
          });
          // Add the member object to the array.
          data.push(memberData);
        });
        // Return the array.
        return data;
      },
      error => err(error, `getting data on ${ref}`)
    );
  }
  else {
    return Promise.resolve([]);
  }
};
// ==== COPY OPERATION ====
// Sequentially copies an array of items (tasks or test cases).
// ==== OWNERSHIP CHANGE OPERATION ====
// Sequentially ensures the ownership of an array of work items (tasks or test cases).
const takeItems = (longItemType, shortItemType, items) => {
  // If there are any items:
  if (items.length) {
    const firstItem = items[0];
    const firstRef = shorten(longItemType, longItemType, firstItem.ref);
    if (! globals.isError) {
      const owner = firstItem.owner;
      const ownerRef = shorten('user', 'user', owner);
      if (! globals.isError) {
        // If the ownership of the item needs to be changed:
        if (ownerRef !== globals.takeWhoRef) {
          // Change it.
          return globals.restAPI.update({
            ref: firstRef,
            data: {Owner: globals.takeWhoRef}
          })
          .then(
            // When it has been changed:
            () => {
              report(
                [['total'], ['changes'], [`${shortItemType}Total`], [`${shortItemType}Changes`]]
              );
              // Process the remaining items.
              return takeItems(longItemType, shortItemType, items.slice(1));
            },
            error => err(error, `changing ${longItemType} ownership`)
          );
        }
        // Otherwise, i.e. if the ownership of the item does not need to be changed:
        else {
          report([['total'], [`${shortItemType}Total`]]);
          // Process the remaining items.
          return takeItems(longItemType, shortItemType, items.slice(1));
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
  if (storyRefs.length && ! globals.isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! globals.isError) {
      // Get data on the first user story.
      return getItemData(firstRef, ['Owner'], ['Children', 'Tasks', 'TestCases'])
      .then(
        // When the data arrive:
        data => {
          report([['total'], ['storyTotal']]);
          const ownerRef = shorten('user', 'user', data.owner);
          if (! globals.isError) {
            // Change the owner of the user story if necessary.
            const ownerWrong = ownerRef && ownerRef !== globals.takeWhoRef || ! ownerRef;
            if (ownerWrong) {
              report([['changes'], ['storyChanges']]);
            }
            return (ownerWrong ? globals.restAPI.update({
              ref: firstRef,
              data: {
                Owner: globals.takeWhoRef
              }
            }) : Promise.resolve(''))
            .then(
              // When the change, if any, has been made:
              () => {
                // Get data on the test cases, if any, of the user story.
                return getCollectionData(
                  data.testCases.count ? data.testCases.ref : '', ['Owner'], []
                )
                .then(
                  // When the data, if any, arrive:
                  cases => {
                    // Change the owner of any of them if necessary.
                    return takeItems('testcase', 'case', cases)
                    .then(
                      // When the changes, if any, have been made:
                      () => {
                        // Get data on the tasks of the user story.
                        return getCollectionData(
                          data.tasks.count ? data.tasks.ref : '', ['Owner'], []
                        )
                        .then(
                          // When the data, if any, arrive:
                          tasks => {
                            // Change the owner of any of them if necessary.
                            return takeItems('task', 'task', tasks)
                            .then(
                              // When the changes, if any, have been made:
                              () => {
                                // Get references to the child user stories of the user story.
                                return getCollectionData(
                                  data.children.count ? data.children.ref : '', [], []
                                )
                                .then(
                                  // When the references, if any, arrive:
                                  children => {
                                    // Process the child user stories, if any.
                                    return takeTree(children.map(child => child.ref))
                                    .then(
                                      /*
                                        When any have been processed, process the remaining user
                                        stories.
                                      */
                                      () => takeTree(storyRefs.slice(1)),
                                      error => err(error, 'changing owner of child user stories')
                                    );
                                  },
                                  error => err(error, 'getting references to child user stories')
                                );
                              },
                              error => err(error, 'changing owner of tasks')
                            );
                          },
                          error => err(error, 'getting data on tasks')
                        );
                      },
                      error => err(error, 'changing owner of test cases')
                    );
                  },
                  error => err(error, 'getting data on test cases')
                );
              },
              error => err(error, 'changing owner of user story')
            );
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
// ==== PROJECT CHANGE OPERATION ====
// Recursively changes project affiliations of an array of test cases.
const projectCases = caseRefs => {
  if (caseRefs.length) {
    // Change the project of the first test case.
    const firstRef = shorten('testcase', 'testcase', caseRefs[0]);
    if (! globals.isError) {
      return globals.restAPI.update({
        ref: firstRef,
        data: {
          Project: globals.projectRef
        }
      })
      .then(
        // When it has been changed:
        () => {
          report([['changes'], ['projectChanges']]);
          // Change the projects of the remaining test cases.
          return projectCases(caseRefs.slice(1));
        },
        error => err(error, 'changing project of test case')
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
  Recursively changes project affiliations and optionally releases and/or iterations of
  user stories, and project affiliations of test cases, in a tree or subtree.
*/
const projectTree = storyRefs => {
  if (storyRefs.length && ! globals.isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! globals.isError) {
      // Get data on the first user story.
      return getItemData(firstRef, ['Project', 'Release', 'Iteration'], ['Children', 'TestCases'])
      .then(
        // When the data arrive:
        data => {
          const oldProjectRef = shorten('project', 'project', data.project);
          if (! globals.isError) {
            // Initialize a configuration object for an update to the user story.
            const config = {};
            // Initialize an array of events reportable for the user story.
            const events = [['total'], ['storyTotal']];
            // Add necessary events to the configuration and array.
            if (oldProjectRef && oldProjectRef !== globals.projectRef || ! oldProjectRef) {
              config.Project = globals.projectRef;
              events.push(['changes'], ['projectChanges']);
            }
            if (data.release !== globals.projectReleaseRef && ! data.children.count) {
              config.Release = globals.projectReleaseRef;
              events.push(['changes'], ['releaseChanges']);
            }
            if (data.iteration !== globals.projectIterationRef && ! data.children.count) {
              config.Iteration = globals.projectIterationRef;
              events.push(['changes'], ['iterationChanges']);
            }
            // Update the user story if necessary.
            return (events.length > 1 ? globals.restAPI.update({
              ref: firstRef,
              data: config
            }) : Promise.resolve(''))
            .then(
              // When the update, if any, has been made:
              () => {
                events.length > 1 && report(events);
                // Get data on the user story’s test cases, if any.
                return getCollectionData(
                  data.testCases.count ? data.testCases.ref : '', ['Project'], []
                )
                .then(
                  // When the data, if any, arrive:
                  cases => {
                    cases.length && report([['total', cases.length], ['caseTotal', cases.length]]);
                    // Process sequentially the test cases needing a project change.
                    return projectCases(
                      cases.filter(
                        testCase => shorten('project', 'project', testCase.project) !== globals.projectRef
                      )
                      .map(testCase => testCase.ref)
                    )
                    .then(
                      // When they have been processed:
                      () => {
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
                      },
                      error => err(error, 'changing projects of test cases')
                    );
                  },
                  error => err(error, 'getting data on test cases')
                );
              },
              error => err(error, 'changing project of user story')
            );
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
// ==== SCHEDULE-STATE CHANGE OPERATION ====
// Recursively sets the states of an array of tasks.
const scheduleTasks = tasks => {
  if (tasks.length && ! globals.isError) {
    const firstTask = tasks[0];
    const firstRef = shorten('task', 'task', firstTask.ref);
    if (! globals.isError) {
      // If the task’s state needs to be changed:
      if (firstTask.state !== globals.state.task) {
        // Change it.
        return globals.restAPI.update({
          ref: firstRef,
          data: {
            State: globals.state.task
          }
        })
        .then(
          // When it has been changed:
          () => {
            report([['total'], ['taskTotal'], ['changes'], ['taskChanges']]);
            // Process the remaining tasks.
            return scheduleTasks(tasks.slice(1));
          },
          error => err(error, 'changing state of task')
        );
      }
      // Otherwise, i.e. if the task’s state does not need to be changed:
      else {
        report([['total'], ['taskTotal']]);
        // Process the remaining tasks.
        return scheduleTasks(tasks.slice(1));
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
// Recursively sets the schedule state in a tree or subtree of user stories.
const scheduleTree = storyRefs => {
  if (storyRefs.length && ! globals.isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! globals.isError) {
      // Get data on the first user story of the specified array.
      return getItemData(firstRef, ['ScheduleState'], ['Children', 'Tasks'])
      .then(
        // When the data arrive:
        data => {
          report([['total'], ['storyTotal']]);
          // Get data on the tasks of the user story, if any.
          return getCollectionData(data.tasks.ref, ['State'], [])
          .then(
            // When the data arrive:
            tasks => {
              // Change the states of any tasks, if necessary.
              return scheduleTasks(tasks)
              .then(
                // When the changes, if any, have been made:
                () => {
                  // Get data on the child user stories of the user story, if any.
                  return getCollectionData(data.children.ref, [], [])
                  .then(
                    // When the data arrive:
                    children => {
                      // Process the child user stories.
                      return scheduleTree(children.length ? children.map(child => child.ref) : [])
                      .then(
                        /*
                          When the child user stories, if any, have been processed, process
                          the remaining user stories.
                        */
                        () => scheduleTree(storyRefs.slice(1)),
                        error => err(error, 'changing schedule states of child user stories')
                      );
                    },
                    error => err(error, 'getting data on child user stories')
                  );
                },
                error => err(error, 'changing states of tasks')
              );
            },
            error => err(error, 'getting data on tasks')
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
// ==== TASK-CREATION OPERATION ====
// Sequentially creates tasks for a user story.
const createTasks = (storyRef, owner, names) => {
  if (names.length && ! globals.isError) {
    // Create a task with the first name.
    return globals.restAPI.create({
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
  if (storyRefs.length && ! globals.isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! globals.isError) {
      // Get data on the first user story.
      return getItemData(firstRef, ['Owner'], ['Children'])
      .then(
        // When the data arrive:
        data => {
          // If the user story has any child user stories:
          if (data.children.count) {
            report([['total']]);
            // Get data on them.
            return getCollectionData(data.children.ref, [], [])
            .then(
              // When the data arrive:
              children => {
                // Process the child user stories sequentially.
                return taskTree(children.map(child => child.ref))
                .then(
                  // After they are processed, process the remaining user stories.
                  () => taskTree(storyRefs.slice(1)),
                  error => err(error, 'creating tasks for child user stories')
                );
              },
              error => err(error, 'getting data on child user stories')
            );
          }
          // Otherwise, i.e. if the user story has no child user stories:
          else {
            // Create tasks for the user story sequentially.
            return createTasks(firstRef, data.owner, globals.taskNames)
            .then(
              // When they have been created:
              () => {
                if (! globals.isError) {
                  report([['total'], ['changes', globals.taskNames.length]]);
                  // Process the remaining user stories sequentially.
                  return taskTree(storyRefs.slice(1));
                }
              },
              error => err(error, 'creating tasks')
            );
          }
        },
        error => err(
          error, 'getting data on user story'
        )
      );
    }
  }
  else {
    return Promise.resolve('');
  }
};
// ==== TEST-CASE CREATION OPERATION ====
// Creates test cases.
const createCases = (names, description, owner, projectRef, storyRef) => {
  if (names.length && ! globals.isError) {
    // Create the first test case.
    return globals.restAPI.create({
      type: 'testcase',
      fetch: ['_ref'],
      data: {
        Name: names[0],
        Description: description,
        Owner: owner,
        Project: projectRef,
        TestFolder: globals.caseFolderRef || null
      }
    })
    .then(
      // After it has been created:
      newCase => {
        // Add it to the specified user story’s test cases.
        const caseRef = shorten('testcase', 'testcase', newCase.Object._ref);
        if (! globals.isError) {
          return globals.restAPI.add({
            ref: storyRef,
            collection: 'TestCases',
            data: [{_ref: caseRef}],
            fetch: ['_ref']
          })
          .then(
            // After it has been added:
            () => {
              // Add it to the specified test set, if any.
              return (
                globals.caseSetRef ? globals.restAPI.add({
                  ref: caseRef,
                  collection: 'TestSets',
                  data: [{_ref: globals.caseSetRef}],
                  fetch: ['_ref']
                }) : Promise.resolve('')
              )
              .then(
                // After it may have been added:
                () => {
                  report([['changes']]);
                  // Create the remaining test cases.
                  return createCases(names.slice(1), description, owner, projectRef, storyRef);
                },
                error => err(error, 'adding test case to test set')
              );
            },
            error => err(error, 'adding test case to test cases of user story')
          );
        }
        else {
          return '';
        }
      },
      error => err(error, 'creating test case')
    );
  }
  else {
    return Promise.resolve('');
  }
};
// Recursively creates test cases for a tree or subtrees of user stories.
const caseTree = storyRefs => {
  if (storyRefs.length && ! globals.isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! globals.isError) {
      // Get data on the first user story.
      return getItemData(firstRef, ['Name', 'Description', 'Owner', 'Project'], ['Children'])
      .then(
        // When the data arrive:
        data => {
          report([['total']]);
          // Determine the names and project of the test cases to be created, if any.
          let names = [];
          let projectRef = '';
          if (globals.caseTarget === 'all' || ! data.children.count) {
            names = caseData ? caseData[data.name] || [data.name] : [data.name];
            projectRef = globals.caseProjectRef || data.project;
          }
          // Create the test cases, if any.
          return createCases(names, data.description, data.owner, projectRef, firstRef)
          .then(
            // When any have been created:
            () => {
              // Get data on any child user stories.
              return getCollectionData(data.children.count ? data.children.ref : '', [], [])
              .then(
                // When the data, if any, arrive:
                children => {
                  // Process any children sequentially.
                  return caseTree(children.length ? children.map(child => child.ref) : [])
                  .then(
                    // After any are processed, process the remaining user stories.
                    () => caseTree(storyRefs.slice(1)),
                    error => err(error, 'creating test cases for child user stories')
                  );
                },
                error => err(error, 'getting data on child user stories')
              );
            },
            error => err(error, 'creating test cases')
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
// ==== TEST-CASE GROUPING OPERATION ====
// Groups test cases.
const groupCases = cases => {
  if (cases.length && ! globals.isError) {
    const firstCase = cases[0];
    const firstRef = shorten('testcase', 'testcase', firstCase.ref);
    if (! globals.isError) {
      report([['total']]);
      const folderRef = shorten('testfolder', 'testfolder', firstCase.testFolder);
      // Determine what test-folder and test-set groupings are already known to be needed.
      const needsFolder = globals.groupFolderRef && folderRef !== globals.groupFolderRef;
      let needsSet = globals.groupSetRef && ! firstCase.testSets.count;
      // If the need for a test-set grouping is still unknown, get data to determine it.
      return (globals.groupSetRef && firstCase.testSets.count ? getCollectionData(
        firstCase.testSets.ref, [], []
      ) : Promise.resolve([]))
      .then(
        // When the data, if needed, arrive:
        sets => {
          // Update the need for a test-set grouping if necessary.
          if (sets.length && ! sets.map(
            set => shorten('testset','testset', set.ref).includes(globals.groupSetRef)
          )) {
            needsSet = true;
          }
          // Group the test case into a test folder if necessary.
          return (
            needsFolder ? globals.restAPI.update({
              ref: firstRef,
              data: {
                TestFolder: globals.groupFolderRef
              }
            }) : Promise.resolve('')
          )
          .then(
            // When the test-folder grouping, if any, has been made:
            () => {
              // Group the test case into a test set if necessary.
              return (
                needsSet ? globals.restAPI.add({
                  ref: firstRef,
                  collection: 'TestSets',
                  data: [{_ref: globals.groupSetRef}],
                  fetch: ['_ref']
                }) : Promise.resolve('')
              )
              .then(
                // When the test-set grouping, if any, has been made:
                () => {
                  if (needsFolder) {
                    report([['changes'], ['folderChanges']]);
                  }
                  if (needsSet) {
                    report([['changes'], ['setChanges']]);
                  }
                  // Process the remaining test cases.
                  return groupCases(cases.slice(1));
                },
                error => err(error, 'grouping test case into test set')
              );
            },
            error => err(error, 'grouping test case into test folder')
          );
        },
        error => err(error, 'getting initial data on grouping need')
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
// Recursively groups test cases in a tree or subtrees of user stories.
const groupTree = storyRefs => {
  if (storyRefs.length && ! globals.isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! globals.isError) {
      // Get data on the first user story of the specified array.
      return getItemData(firstRef, [], ['Children', 'TestCases'])
      .then(
        // When the data arrive:
        data => {
          // FUNCTION DEFINITION START
          // Processes child user stories and remaining user stories.
          const groupChildrenAndSiblings = () => {
            // If the user story has child user stories:
            if (data.children.count) {
              // Get data on them.
              return getCollectionData(data.children.ref, [], [])
              .then(
                // When the data arrive:
                children => {
                  // Process the child user stories.
                  return groupTree(children.map(child => child.ref))
                  .then(
                    // After they are processed, process the remaining user stories.
                    () => groupTree(storyRefs.slice(1)),
                    error => err(error, 'grouping test cases of child user stories')
                  );
                },
                error => err(error, 'getting data on child user stories')
              );
            }
            // Otherwise, i.e. if the user story has no child user stories:
            else {
              // Process the remaining user stories.
              return groupTree(storyRefs.slice(1));
            }      
          };
          // FUNCTION DEFINITION END
          // If the user story has test cases:
          if (data.testCases.count) {
            // Get data on them.
            return getCollectionData(data.testCases.ref, ['TestFolder'], ['TestSets'])
            .then(
              // When the data arrive:
              cases => {
                // Process the test cases sequentially.
                return groupCases(cases)
                .then(
                  // After they are processed:
                  () => {
                    if (! globals.isError) {
                      // Process child user stories and the remaining user stories.
                      return groupChildrenAndSiblings();
                    }
                    else {
                      return '';
                    }
                  },
                  error => err(error, 'grouping test cases')
                );
              },
              error => err(error, 'getting data on test cases')
            );
          }
          // Otherwise, i.e. if the user story has no test cases:
          else {
            // Process child user stories and the remaining user stories.
            return groupChildrenAndSiblings();
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
// ==== PASSING-RESULT CREATION OPERATION ====
// Creates passing results for test cases.
const passCases = cases => {
  if (cases.length && ! globals.isError) {
    const firstCase = cases[0];
    const firstRef = shorten('testcase', 'testcase', firstCase.ref);
    if (! globals.isError) {
      report([['total']]);
      // If the test case already has results or has no owner:
      if (firstCase.results.count || ! firstCase.owner) {
        // Skip it and process the remaining test cases.
        return passCases(cases.slice(1));
      }
      // Otherwise, i.e. if it has no results and has an owner:
      else {
        // Determine which test set, if any, the new result will be in.
        return (firstCase.testSets.count ? (
          getCollectionData(firstCase.testSets.ref, [], [])
          .then(testSets => testSets[0].ref)
        ) : Promise.resolve(null))
        .then(
          // When the test set, if any, has been determined:
          testSet => {
            // Create a passing result for the test case.
            return globals.restAPI.create({
              type: 'testcaseresult',
              fetch: ['_ref'],
              data: {
                TestCase: firstRef,
                Verdict: 'Pass',
                Build: globals.passBuild,
                Notes: globals.passNote,
                Date: new Date(),
                Tester: firstCase.owner,
                TestSet: testSet
              }
            })
            .then(
              // When it has been created:
              () => {
                report([['changes']]);
                // Process the remaining test cases.
                return passCases(cases.slice(1));
              },
              error => err(error, 'creating passing result for test case')
            );
          },
          error => err(error,'determining test set for passing result')
        );
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
// Recursively creates passing test-case results for a tree or subtrees of user stories.
const passTree = storyRefs => {
  if (storyRefs.length && ! globals.isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! globals.isError) {
      // Get data on the first user story.
      return getItemData(firstRef, [], ['Children', 'TestCases'])
      .then(
        // When the data arrive:
        data => {
          // Get data on the test cases, if any, of the user story.
          return getCollectionData(
            data.testCases.count ? data.testCases.ref : '', ['Owner'], ['Results', 'TestSets']
          )
          .then(
            // When the data arrive:
            cases => {
              // Process the test cases, if any, sequentially.
              return passCases(cases)
              .then(
                // After any are processed:
                () => {
                  if (! globals.isError) {
                    // Get data on the child user stories, if any, of the user story.
                    return getCollectionData(data.children.count ? data.children.ref : '', [], [])
                    .then(
                      // When the data, if any, arrive:
                      children => {
                        // Process the child user stories, if any.
                        return passTree(children.map(child => child.ref))
                        .then(
                          // When any have been processed, process the remaining user stories.
                          () => passTree(storyRefs.slice(1)),
                          error => err(error, 'creating passing results for child user stories')
                        );
                      },
                      error => err(error, 'getting data on child user stories')
                    );
                  }
                  else {
                    return '';
                  }
                },
                error => err(error, 'creating passing results for test cases of user story')
              );
            },
            error => err(error, 'getting data on test cases of user story')
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
// ==== PLANIFICATION OPERATION ====
// Sequentially planifies an array of test cases.
const planCases = (cases, folderRef) => {
  if (cases.length && ! globals.isError) {
    const firstCase = cases[0];
    const firstRef = shorten('testcase', 'testcase', firstCase.ref);
    if (! globals.isError) {
      // If existing test cases are to be linked to test folders:
      if (globals.planHow === 'use') {
        // Link the test case to the specified test folder.
        return globals.restAPI.update({
          ref: firstRef,
          data: {
            TestFolder: folderRef
          }
        })
        .then(
          // When it has been linked:
          () => {
            report([['caseChanges']]);
            // Link the remaining test cases.
            return planCases(cases.slice(1), folderRef);
          },
          error => err(error, `linking test case ${firstRef} to test folder`)
        );
      }
      // Otherwise, i.e. if test cases are to be copied into test folders:
      else {
        // Copy the test case into the test folder.
        return globals.restAPI.create({
          type: 'testcase',
          fetch: ['_ref'],
          data: {
            Name: firstCase.name,
            Description: firstCase.description,
            Owner: firstCase.owner,
            DragAndDropRank: firstCase.dragAndDropRank,
            Risk: firstCase.risk,
            Priority: firstCase.priority,
            Project: firstCase.project,
            TestFolder: folderRef
          }
        })
        .then(
          // When the test case has been copied:
          () => {
            report([['caseChanges']]);
            // Copy the remaining test cases.
            return planCases(cases.slice(1), folderRef);
          },
          error => err(error, `copying test case ${firstRef}`)
        );
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
// Recursively planifies a tree or subtrees of user stories.
const planTree = (storyRefs, parentRef) => {
  if (storyRefs.length && ! globals.isError) {
    // Identify and shorten the reference to the first user story.
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! globals.isError) {
      // Get data on the first user story.
      return getItemData(
        firstRef, ['Name', 'Description', 'Project'], ['Children', 'TestCases']
      )
      .then(
        // When the data arrive:
        data => {
          // Define the options for creation of a corresponding test folder.
          const properties = {
            Name: data.name,
            Description: data.description,
            Project: data.project
          };
          // 
          if (parentRef) {
            properties.Parent = parentRef;
          }
          // Create a test folder, with the specified parent if not the root.
          return globals.restAPI.create({
            type: 'testfolder',
            fetch: ['FormattedID'],
            data: properties
          })
          .then(
            // When the test folder has been created:
            folder => {
              // If the test folder is the root, report its formatted ID.
              if (! parentRef) {
                response.write(`event: planRoot\ndata: ${folder.Object.FormattedID}\n\n`);
              }
              report([['storyChanges']]);
              const folderRef = shorten('testfolder', 'testfolder', folder.Object._ref);
              if (! globals.isError) {
                // Determine the required case facts.
                const requiredFacts = globals.planHow === 'use' ? [
                  'Name', 'Description', 'Owner', 'DragAndDropRank', 'Risk', 'Priority', 'Project'
                ] : [];
                // Get data on the test cases, if any, of the user story.
                return getCollectionData(
                  data.testCases.count ? data.testCases.ref : '', requiredFacts, []
                )
                .then(
                  // When the data, if any, arrive:
                  cases => {
                    // Process any test cases.
                    return planCases(cases, folderRef)
                    .then(
                      // When the test cases, if any, have been processed:
                      () => {
                        // Get data on the child user stories, if any, of the user story.
                        return getCollectionData(
                          data.children.count ? data.children.ref : '', [], []
                        )
                        .then(
                          // When the data, if any, arrive:
                          children => {
                            // Process the child user stories, if any.
                            return planTree(children.map(child => child.ref), folderRef)
                            .then(
                              /*
                                When the child user stories, if any, have been processed, process
                                the remaining user stories.
                              */
                              () => planTree(storyRefs.slice(1), parentRef),
                              error => err(error, 'planifying child user stories')
                            );
                          },
                          error => err(error, 'getting data on child user stories')
                        );
                      },
                      error => err(error, 'planifying test cases of user story')
                    );
                  },
                  error => err(error, 'getting data on test cases of user story')
                );
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
// ==== DOCUMENTATION OPERATION ====
/*
  Sends the tree documentation as an event if enough time has passed since the last update.
  Otherwise, stops the event from the last update, if any, from being sent.
*/
const outDoc = () => {
  // If an event is scheduled:
  if (globals.docTimeout) {
    // Unschedule it.
    clearTimeout(globals.docTimeout);
  }
  // Schedule an event to be sent after docWait ms.
  globals.docTimeout = setTimeout(
    () => {
      const docJSON = JSON.stringify(globals.doc[0], null, 2).replace(
        /\n/g, '<br>'
      );
      response.write(`event: doc\ndata: ${docJSON}\n\n`);
    },
    docWait
  );
};
/*
  Recursively documents as a JSON object a tree or subtree of user stories, specifying
  the array of the objects of the root user story and its siblings, the index of the root user
  story’s object in that array, and an array of the objects of the ancestors of the user story.
*/
const docTree = (storyRef, storyArray, index, ancestors) => {
  if (! globals.isError) {
    // Get data on the user story.
    getItemData(
      storyRef,
      ['FormattedID', 'Name', 'Parent', 'PortfolioItem'],
      ['Children', 'Tasks', 'TestCases']
    )
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
          featureParent: '',
          storyParent: '',
          taskCount,
          caseCount,
          childCount,
          children: []
        };
        // If the user story is the root, add root properties to its object.
        if (! ancestors.length) {
          getItemData(data.portfolioItem, ['FormattedID'], [])
          .then(
            data => {
              storyArray[index].featureParent = data.formattedID || '';
            }
          );
          getItemData(data.parent, ['FormattedID'], [])
          .then(
            data => {
              storyArray[index].storyParent = data.formattedID || '';
            }
          );
        }
        else {
          delete storyArray[index].featureParent;
          delete storyArray[index].storyParent;
        }
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
                if (! globals.isError) {
                  const childRef = shorten(
                    'hierarchicalrequirement', 'hierarchicalrequirement', children[i].ref
                  );
                  if (! globals.isError) {
                    docTree(childRef, childArray, i, childAncestors);
                  }
                }
              }
            },
            error => err(error, 'getting data on child user stories')
          );
        }
        // Send the documentation, after it is apparently complete, to the client.
        outDoc();
      },
      error => err(error, 'getting data on user story')
    );
  }
};
// ==== REQUEST-PROCESSING UTILITIES ====
// Serves a page.
const servePage = (content, isReport) => {
  response.setHeader('Content-Type', 'text/html');
  response.write(content);
  response.end();
  if (isReport) {
    globals.reportServed = true;
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
  .replace('__rootRef__', globals.rootRef)
  .replace('__userName__', globals.userName)
  .replace('__userRef__', globals.userRef);
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
          .replace('__parentRef__', globals.copyParentRef);
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
            'verdicts',
            'scoreVerdicts',
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
          .replace('__riskMin__', globals.scoreWeights.risk[scoreRisks[0]])
          .replace('__priorityMin__', globals.scoreWeights.priority[scorePriorities[0]])
          .replace('__riskMax__', globals.scoreWeights.risk[scoreRisks.slice(-1)])
          .replace('__priorityMax__', globals.scoreWeights.priority[scorePriorities.slice(-1)]);
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
          .replace('__takeWhoRef__', globals.takeWhoRef);
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
          const newJSContent = reportScriptPrep(jsContent, '/projecttally', [
            'total',
            'storyTotal',
            'caseTotal',
            'changes',
            'projectChanges',
            'releaseChanges',
            'iterationChanges',
            'error'
          ]);
          const newContent = reportPrep(htmlContent, newJSContent)
          .replace('__projectWhich__', projectWhich)
          .replace('__projectRef__', globals.projectRef)
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
            jsContent,
            '/scheduletally',
            ['total', 'changes', 'storyTotal', 'storyChanges', 'taskTotal', 'taskChanges', 'error']
          );
          const newContent = reportPrep(htmlContent, newJSContent)
          .replace('__scheduleState__', globals.state.story);
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
          const taskCount = `${globals.taskNames.length} task${
            globals.taskNames.length > 1 ? 's' : ''
          }`;
          const newContent = reportPrep(htmlContent, newJSContent)
          .replace('__taskCount__', taskCount)
          .replace('__taskNames__', globals.taskNames.join('\n'));
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
// Serves the group-test-case report page.
const serveGroupReport = () => {
  fs.readFile('groupReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(
            jsContent, '/grouptally', ['total', 'changes', 'folderChanges', 'setChanges']
          );
          const newContent = reportPrep(htmlContent, newJSContent);
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
      );
    },
    error => err(error, 'reading groupReport page')
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
      const newHTMLContent = htmlContent.replace(
        '__planHow__', globals.planHow === 'use' ? 'linked to' : 'copied into'
      );
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(
            jsContent, '/plantally', ['planRoot', 'storyChanges', 'caseChanges', 'error']
          );
          const newContent = reportPrep(newHTMLContent, newJSContent);
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
          const newJSContent = reportScriptPrep(jsContent, '/doc', ['doc', 'error']);
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
  globals.idle = false;
  totals.total = totals.changes = 0;
  serveEventStart();
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
    return globals.restAPI.query({
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
    return globals.restAPI.query({
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
// Assigns values to global variables for handling POST requests.
const setGlobals = rootID => {
  // Get a long reference to the root user story.
  return getRef('hierarchicalrequirement', rootID, 'tree root')
  .then(
    // When it arrives:
    ref => {
      if (ref) {
        if (! globals.isError) {
          // Set its global variable.
          globals.rootRef = shorten('userstory', 'hierarchicalrequirement', ref);
          if (! globals.isError) {
            // Get a reference to the user.
            return getGlobalNameRef(globals.userName, 'user', 'UserName')
            .then(
              // When it arrives:
              ref => {
                if (! globals.isError) {
                  // Set its global variable.
                  globals.userRef = ref;
                  return '';
                }
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
      }
      else {
        return '';
      }
    },
    error => err(error, 'getting reference to root user story')
  );
};
// Sets the global state variable.
const setState = scheduleState => {
  globals.state.story = scheduleState;
  if (globals.state.story === 'Needs Definition') {
    globals.state.task = 'Defined';
  }
  else if (globals.state.story === 'Accepted') {
    globals.state.task = 'Completed';
  }
  else {
    globals.state.task = globals.state.story;
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
    const op = {globals, totals, err, shorten, report, getItemData, getCollectionData};
    // METHOD GET: If the request requests a resource:
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
      else if (requestURL === '/copytally' && globals.idle) {
        streamInit();
        const {copyTree} = require('./copyTree');
        copyTree(
          op,
          [globals.rootRef],
          globals.copyParentType === 'hierarchicalrequirement' ? 'story' : 'feature',
          globals.copyParentRef
        );
      }
      else if (requestURL === '/scoretally' && globals.idle) {
        streamInit();
        const {scoreTree} = require('./scoreTree');
        scoreTree(op, globals.rootRef);
      }
      else if (requestURL === '/taketally' && globals.idle) {
        streamInit();
        const {takeTree} = require('./takeTree');
        takeTree([globals.rootRef]);
      }
      else if (requestURL === '/projecttally' && globals.idle) {
        streamInit();
        projectTree([globals.rootRef]);
      }
      else if (requestURL === '/scheduletally' && globals.idle) {
        streamInit();
        scheduleTree([globals.rootRef]);
      }
      else if (requestURL === '/tasktally' && globals.idle) {
        streamInit();
        taskTree([globals.rootRef]);
      }
      else if (requestURL === '/casetally' && globals.idle) {
        streamInit();
        caseTree([globals.rootRef]);
      }
      else if (requestURL === '/grouptally' && globals.idle) {
        streamInit();
        groupTree([globals.rootRef]);
      }
      else if (requestURL === '/passtally' && globals.idle) {
        streamInit();
        passTree([globals.rootRef]);
      }
      else if (requestURL === '/plantally' && globals.idle) {
        streamInit();
        planTree([globals.rootRef], '');
      }
      else if (requestURL === '/doc' && globals.idle) {
        streamInit();
        docTree(globals.rootRef, globals.doc, 0, []);
      }
    }
    // METHOD POST: Otherwise, if the request submits the request form:
    else if (method === 'POST' && requestURL === '/do.html') {
      reinit();
      // Permit an event stream to be started.
      globals.idle = true;
      const bodyObject = parse(Buffer.concat(bodyParts).toString());
      const {cookie, op, password, rootID} = bodyObject;
      globals.userName = bodyObject.userName;
      RALLY_USERNAME = globals.userName;
      RALLY_PASSWORD = password;
      // If the user has not deleted the content of the cookie field:
      if (cookie.length) {
        // Make every request in the session include the cookie, forcing single-host mode.
        requestOptions.headers.Cookie = cookie.split('\r\n').join('; ');
      }
      // Create and configure a Rally API client.
      globals.restAPI = rally({
        user: globals.userName,
        pass: password,
        requestOptions
      });
      // Get a long reference to the root user story.
      setGlobals(rootID)
      .then(
        () => {
          if (globals.isError) {
            return '';
          }
          // OP COPYING
          else if (op === 'copy') {
            // Set the operation’s global variables.
            setState(bodyObject.copyState);
            globals.copyWhat = bodyObject.copyWhat;
            let copyParentReadType = 'userstory';
            if (bodyObject.copyParentType === 'feature') {
              globals.copyParentType = 'portfolioitem';
              copyParentReadType = 'portfolioitem/feature';
            }
            // Get a reference to the copy parent.
            getRef(globals.copyParentType, bodyObject.copyParent, 'parent of tree copy')
            .then(
              // When it arrives:
              ref => {
                if (! globals.isError) {
                  if (ref) {
                    // Set its global variable. 
                    globals.copyParentRef = shorten(copyParentReadType, globals.copyParentType, ref);
                    if (! globals.isError) {
                      // Get data on the copy parent.
                      getItemData(
                        globals.copyParentRef,
                        ['Project'],
                        globals.copyParentType === 'hierarchicalrequirement' ? ['Tasks'] : []
                      )
                      .then(
                        // When the data arrive:
                        data => {
                          // If the copy parent has tasks:
                          if (globals.copyParentType === 'hierarchicalrequirement' && data.tasks.count) {
                            // Reject the request.
                            err('Attempt to copy to a user story with tasks', 'copying tree');
                          }
                          // Otherwise, i.e. if the copy parent has no tasks:
                          else {
                            // Get a reference to the specified project, if any.
                            getGlobalNameRef(bodyObject.copyProject, 'project', 'Name')
                            .then(
                              // When any arrives:
                              ref => {
                                if (! globals.isError) {
                                  // Set its global variable.
                                  globals.copyProjectRef = ref || data.project;
                                  // Get a reference to the specified owner, if any.
                                  getGlobalNameRef(bodyObject.copyOwner, 'user', 'UserName')
                                  .then(
                                    // When any arrives:
                                    ref => {
                                      if (! globals.isError) {
                                        // Set its global variable.
                                        globals.copyOwnerRef = ref;
                                        // Get a reference to the specified release, if any.
                                        getProjectNameRef(
                                          globals.copyProjectRef, 'release', bodyObject.copyRelease, 'copy'
                                        )
                                        .then(
                                          // When any arrives:
                                          ref => {
                                            if (! globals.isError) {
                                              // Set its global variable.
                                              globals.copyReleaseRef = ref;
                                              // Get a reference to the specified iteration, if any.
                                              getProjectNameRef(
                                                globals.copyProjectRef, 'iteration', bodyObject.copyIteration, 'copy'
                                              )
                                              .then(
                                                // When any arrives:
                                                ref => {
                                                  if (! globals.isError) {
                                                    // Set its global variable.
                                                    globals.copyIterationRef = ref;
                                                    // Copy the tree.
                                                    serveCopyReport();
                                                  }
                                                },
                                                error => err(error, 'getting reference to iteration')
                                              );
                                            }
                                          },
                                          error => err(error, 'getting reference to release')
                                        );
                                      }
                                    },
                                    error => err(error, 'getting reference to owner')
                                  );
                                }
                              },
                              error => err(error, 'getting reference to project')
                            );
                          }
                        },
                        error => err(error, 'getting data on copy parent')
                      );
                    }
                  }
                  else {
                    err('Missing copy-parent ID', 'submitting request');
                  }
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
              globals.scoreWeights[key] = {};
              for (let i = 0; i < values.length; i++) {
                globals.scoreWeights[key][values[i]]
                  = minNumber
                  + i * (Number.parseInt(max, 10) - minNumber) / (values.length - 1);
              }
            };
            const {scoreRiskMin, scoreRiskMax, scorePriorityMin, scorePriorityMax} = bodyObject;
            // Validate the weights.
            validateWeights('risk', scoreRiskMin, scoreRiskMax);
            if (! globals.isError) {
              validateWeights('priority', scorePriorityMin, scorePriorityMax);
              if (! globals.isError) {
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
                  if (! globals.isError) {
                    globals.takeWhoRef = ref;
                    serveTakeReport(takeWho);
                  }
                },
                error => err(error, 'getting reference to new owner')
              );
            }
            // Otherwise, the new owner will be the user, so:
            else {
              globals.takeWhoRef = globals.userRef;
              // Serve a report identifying the user as new owner.
              serveTakeReport(globals.userName);
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
                if (! globals.isError) {
                  // Set its global variable.
                  globals.projectRef = ref;
                  // Get a reference to the named release.
                  getProjectNameRef(globals.projectRef, 'release', projectRelease, 'project change')
                  .then(
                    // When it arrives:
                    ref => {
                      if (! globals.isError) {
                        // Set its global variable.
                        globals.projectReleaseRef = ref || null;
                        // Get a reference to the named iteration.
                        getProjectNameRef(globals.projectRef, 'iteration', projectIteration, 'project change')
                        .then(
                          // When it arrives:
                          ref => {
                            if (! globals.isError) {
                              // Set its global variable.
                              globals.projectIterationRef = ref || null;
                              // Serve a report identifying the project, release, and iteration.
                              serveProjectReport(projectWhich, projectRelease, projectIteration);
                            }
                          },
                          error => err(error, 'getting reference to iteration')
                        );
                      }
                    },
                    error => err(error, 'getting reference to release')
                  );
                }
              },
              error => err(error, 'getting reference to new project')
            );
          }
          // OP SCHEDULING
          else if (op === 'schedule') {
            // Set the global state variable.
            setState(bodyObject.scheduleState);
            // Serve a report.
            serveScheduleReport();
          }
          // OP TASK CREATION
          else if (op === 'task') {
            const {taskName} = bodyObject;
            if (taskName.length < 2) {
              err('Task name(s) missing', 'creating tasks');
            }
            else {
              const delimiter = taskName[0];
              globals.taskNames.push(...taskName.slice(1).split(delimiter));
              for (let i = 0; i < globals.taskNames.length; i++) {
                globals.taskNames[i] = globals.taskNames[i].trim();
              }
              if (globals.taskNames.every(taskName => taskName.length)) {
                serveTaskReport();
              }
              else {
                err('Empty task name(s)', 'creating tasks');
              }
            }
          }
          // OP TEST-CASE CREATION
          else if (op === 'case') {
            globals.caseTarget = bodyObject.caseTarget;
            const {caseFolder, caseSet, caseProject} = bodyObject;
            // Get a reference to the project, if specified.
            getGlobalNameRef(caseProject, 'project', 'Name')
            .then(
              // When the reference, if any, arrives:
              ref => {
                if (! globals.isError) {
                  // Set its global variable.
                  globals.caseProjectRef = shorten('project', 'project', ref);
                  if (! globals.isError) {
                    // Get a reference to the test folder, if specified.
                    getRef('testfolder', caseFolder, 'test-case creation')
                    .then(
                      // When the reference, if any, arrives:
                      ref => {
                        if (! globals.isError) {
                          // Set its global variable.
                          globals.caseFolderRef = shorten('testfolder', 'testfolder', ref);
                          if (! globals.isError) {
                            // Get a reference to the test set, if specified.
                            getRef('testset', caseSet, 'test-case creation')
                            .then(
                              // When the reference, if any, arrives:
                              ref => {
                                if (! globals.isError) {
                                  // Set its global variable.
                                  globals.caseSetRef = shorten('testset', 'testset', ref);
                                  // Serve a report on test-case creation.
                                  serveCaseReport();
                                }
                              },
                              error => err(error, 'getting reference to test set')
                            );
                          }
                        }
                      },
                      error => err(error, 'getting reference to test folder')
                    );
                  }
                }
              },
              error => err(error, 'getting reference to project')
            );
          }
          // OP TEST-CASE GROUPING
          else if (op === 'group') {
            const {groupFolder, groupSet} = bodyObject;
            if (! groupFolder && ! groupSet) {
              err('Test folder and test set both missing', 'grouping test cases');
            }
            else {
              // Get a reference to the test folder, if specified.
              getRef('testfolder', groupFolder, 'test-case grouping')
              .then(
                // When the reference, if any, arrives:
                ref => {
                  if (! globals.isError) {
                    // Set its global variable.
                    globals.groupFolderRef = shorten('testfolder', 'testfolder', ref);
                    if (! globals.isError) {
                      // Get a reference to the test set, if specified.
                      getRef('testset', groupSet, 'test-case grouping')
                      .then(
                        // When the reference, if any, arrives:
                        ref => {
                          if (! globals.isError) {
                            // Set its global variable.
                            globals.groupSetRef = shorten('testset', 'testset', ref);
                            // Serve a report on test-case creation.
                            serveGroupReport();
                          }
                        },
                        error => err(error, 'getting reference to test set')
                      );
                    }
                  }
                },
                error => err(error, 'getting reference to test folder')
              );
            }
          }
          // OP PASSING
          else if (op === 'pass') {
            globals.passBuild = bodyObject.passBuild;
            if (! globals.passBuild) {
              err('Build blank', 'passing test cases');
            }
            else {
              globals.passNote = bodyObject.passNote;
              // Serve a report on passing-result creation.
              servePassReport();
            }
          }
          // OP PLANIFICATION
          else if (op === 'plan') {
            globals.planHow = bodyObject.planHow;
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
