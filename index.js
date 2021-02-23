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
  setChanges: 0,
  setTotal: 0,
  storyChanges: 0,
  storyTotal: 0,
  taskChanges: 0,
  taskTotal: 0,
  total: 0
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
        // Initialize an object of data.
        const data = {};
        // Add the item’s facts or, if objects, references to them.
        facts.forEach(fact => {
          data[lc0Of(fact)] = obj[fact] !== null && typeof obj[fact] === 'object'
            ? obj[fact]._ref
            : obj[fact];
        });
        // Add references to and the sizes of the item’s collections.
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
    return Promise.resolve('');
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
const copyItems = (itemType, itemRefs, storyRef) => {
  if (itemRefs.length && ! globals.isError) {
    // Identify and shorten a reference to the first item.
    const workItemType = ['task', 'testcase'][['task', 'case'].indexOf(itemType)];
    if (workItemType) {
      const firstRef = shorten(workItemType, workItemType, itemRefs[0]);
      if (! globals.isError) {
        // Get data on the first item.
        return getItemData(firstRef, ['Name', 'Description', 'Owner', 'DragAndDropRank'], [])
        .then(
          // When the data arrive:
          data => {
            // Specify properties for the copy.
            const config = {
              Name: data.name,
              Description: data.description,
              Owner: globals.copyOwnerRef || data.owner,
              DragAndDropRank: data.dragAndDropRank,
              WorkProduct: storyRef
            };
            // If the item is a task and a state has been specified, apply it.
            if (itemType === 'task' && globals.state.task) {
              config.State = globals.state.task;
            }
            /*
              If the item is a test case, it will not automatically inherit the project of its
              user story, so specify its project.
            */
            if (itemType === 'case') {
              config.Project = globals.copyProjectRef;
            }
            // Copy the item.
            return globals.restAPI.create({
              type: workItemType,
              fetch: ['_ref'],
              data: config
            })
            .then(
              // When the item has been copied:
              () => {
                report([['total'], [`${itemType}Total`]]);
                // Copy the remaining items.
                return copyItems(itemType, itemRefs.slice(1), storyRef);
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
      return Promise.resolve(err('invalid item type', 'copying task or test case'));
    }
  }
  else {
    return Promise.resolve('');
  }
};
// Gets data on items (tasks or test cases) and copies them.
const getAndCopyItems = (itemType, itemsType, collectionType, data, copyRef) => {
  // If the original has any specified items and they are to be copied:
  if (
    data[collectionType].count
    && [itemsType, 'both'].includes(globals.copyWhat)
  ) {
    // Get data on the items.
    return getCollectionData(data[collectionType].ref, [], [])
    .then(
      // When the data arrive:
      items => {
        // Copy the items.
        return copyItems(itemType, items.map(item => item.ref), copyRef);
      },
      error => err(error, `getting data on ${collectionType}`)
    );
  }
  else {
    return Promise.resolve('');
  }
};
// Recursively copies a tree or subtrees.
const copyTree = (storyRefs, parentType, parentRef) => {
  if (storyRefs.length && ! globals.isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! globals.isError) {
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
          if (firstRef === globals.copyParentRef) {
            // Quit and report this.
            err('Attempt to copy to itself', 'copying tree');
            return '';
          }
          // Otherwise, i.e. if the user story is copiable:
          else {
            // Specify the properties of its copy.
            const properties = {
              Name: data.name,
              Description: data.description,
              Owner: globals.copyOwnerRef || data.owner,
              DragAndDropRank: data.dragAndDropRank,
              Project: globals.copyProjectRef
            };
            properties[parentType === 'story' ? 'Parent' : 'PortfolioItem'] = parentRef;
            if (globals.copyReleaseRef) {
              properties.Release = globals.copyReleaseRef;
            }
            if (globals.copyIterationRef) {
              properties.Iteration = globals.copyIterationRef;
            }
            // The schedule state will be set but may be overridden by task inference.
            if (globals.state.story) {
              properties.ScheduleState = globals.state.story;
            }
            // Copy the user story.
            return globals.restAPI.create({
              type: 'hierarchicalrequirement',
              fetch: ['_ref'],
              data: properties
            })
            .then(
              // When it has been copied:
              copy => {
                report([['total'], ['storyTotal']]);
                const copyRef = shorten('userstory', 'hierarchicalrequirement', copy.Object._ref);
                if (! globals.isError) {
                  // Get data on any test cases and copy them, if required.
                  return getAndCopyItems('case', 'cases', 'testCases', data, copyRef)
                  .then(
                    // When any test cases have been copied:
                    () => {
                      // Get data on any tasks and copy them, if required.
                      return getAndCopyItems('task', 'tasks', 'tasks', data, copyRef)
                      .then(
                        // When any tasks have been copied:
                        () => {
                          // Get data on the child user stories of the user story.
                          return getCollectionData(data.children.ref, [], [])
                          .then(
                            // When the data arrive:
                            children => {
                              // Process the child user stories, if any.
                              return copyTree(
                                children ? children.map(child => child.ref) : [], 'story', copyRef
                              )
                              .then(
                                // When any have been processed:
                                () => {
                                  // Process the remaining user stories.
                                  return copyTree(storyRefs.slice(1), 'story', parentRef);
                                },
                                error => err(error,'processing child user stories')
                              );
                            },
                            error => err(error,'getting data on child user stories')
                          );
                        },
                        error => err(error, 'copying tasks')
                      );
                    },
                    error => err(error, 'copying test cases')
                  );
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
// ==== SCORING OPERATION ====
// Recursively acquires test results from a tree of user stories.
const scoreTree = storyRef => {
  // Get data on the user story.
  getItemData(storyRef, [], ['Children', 'TestCases'])
  .then(
    // When the data arrive:
    data => {
      if (data && ! globals.isError) {
        // Get data on the test cases of the user story, if any.
        getCollectionData(
          data.testCases.count ? data.testCases.ref : '',
          ['LastVerdict', 'Risk', 'Priority'],
          ['Defects']
        )
        .then(
          // When the data, if any, arrive:
          cases => {
            // Process the test cases in parallel.
            cases.forEach(testCase => {
              if (! globals.isError) {
                const verdict = testCase.lastVerdict;
                const riskWeight = globals.scoreWeights.risk[testCase.risk];
                const priorityWeight = globals.scoreWeights.priority[testCase.priority];
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
        // Get data on the child user stories of the user story, if any.
        getCollectionData(data.children.count ? data.children.ref : [], [])
        .then(
          // When the data, if any, arrive:
          children => {
            // Process the children in parallel.
            children.forEach(child => {
              if (! globals.isError) {
                const childRef = shorten(
                  'hierarchicalrequirement', 'hierarchicalrequirement', child.ref
                );
                if (! globals.isError) {
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
// ==== OWNERSHIP CHANGE OPERATION ====
// Sequentially ensures the ownership of an array of work items (tasks or test cases).
const takeItems = (longItemType, shortItemType, items) => {
  // If there are any items:
  if (items.length) {
    const firstRef = shorten(longItemType, longItemType, items[0].ref);
    if (! globals.isError) {
      const owner = items[0].owner;
      const ownerRef = owner ? shorten('user', 'user', owner) : '';
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
              report([['total'], [`${shortItemType}Total`], [`${shortItemType}Changes`]]);
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
          const ownerRef = data.owner ? shorten('user', 'user', data.owner) : '';
          if (! globals.isError) {
            // Change the owner of the user story if necessary.
            const ownerWrong = ownerRef && ownerRef !== globals.takeWhoRef || ! ownerRef;
            if (ownerWrong) {
              report([['changes'], ['storyChanges']]);
            }
            return ownerWrong ? globals.restAPI.update({
              ref: firstRef,
              data: {
                Owner: globals.takeWhoRef
              }
            }) : Promise.resolve('')
            .then(
              // When any change has been made:
              () => {
                // Get data on the test cases of the user story.
                return getCollectionData(data.testCases.ref, ['Owner'], [])
                .then(
                  // When the data arrive:
                  cases => {
                    // Change the owner of any of them if necessary.
                    return takeItems('testcase', 'case', cases)
                    .then(
                      // When any changes have been made:
                      () => {
                        // Get data on the tasks of the user story.
                        return getCollectionData(data.tasks.ref, ['Owner'], [])
                        .then(
                          // When the data arrive:
                          tasks => {
                            // Change the owner of any of them if necessary.
                            return takeItems('task', 'task', tasks)
                            .then(
                              // When any changes have been made:
                              () => {
                                // Process any child user stories of the user story.
                                return takeTree(
                                  data.children.count ? data.children.map(child => child.ref) : []
                                )
                                .then(
                                  // When they have been processed:
                                  () => {
                                    // Process the remaining user stories.
                                    return takeTree(storyRefs.slice(1));
                                  },
                                  error => err(error, 'changing owner of child user stories')
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
/*
  Recursively changes project affiliations and optionally releases and/or iterations of
  user stories, and project affiliations of test cases, in a tree or subtree.
*/
const projectTree = storyRefs => {
  if (storyRefs.length && ! globals.isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! globals.isError) {
      // Get data on the first user story of the specified array.
      return getItemData(firstRef, ['Project', 'Release', 'Iteration'], ['Children', 'TestCases'])
      .then(
        // When the data arrive:
        data => {
          const oldProjectRef = data.project ? shorten('project', 'project', data.project) : '';
          if (! globals.isError) {
            // FUNCTION DEFINITION START
            // Processes an array of test cases.
            const processCases = caseRefs => {
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
                      return processCases(caseRefs.slice(1));
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
            // FUNCTION DEFINITION END
            // FUNCTION DEFINITION START
            // Processes the children of the user story and the remaining user stories.
            const processMore = () => {
              // Get data on the user story’s test cases.
              return getCollectionData(data.testCases.ref, ['Project'], [])
              .then(
                // When the data arrive:
                cases => {
                  cases.length && report([['total', cases.length]]);
                  // Process sequentially the test cases needing a project change.
                  return processCases(
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
            };
            // FUNCTION DEFINITION END
            // Initialize a configuration object for an update to the user story.
            const config = {};
            // Initialize an array of events reportable for the user story.
            const events = [['total']];
            // If the user story’s project needs to be changed:
            if (oldProjectRef && oldProjectRef !== globals.projectRef || ! oldProjectRef) {
              // Add project to the configuration and events.
              config.Project = globals.projectRef;
              events.push(['changes'], ['projectChanges']);
            }
            // If the user story’s release needs to be changed:
            if (data.release !== globals.projectReleaseRef && ! data.children.count) {
              // Add release to the configuration and events.
              config.Release = globals.projectReleaseRef;
              events.push(['changes'], ['releaseChanges']);
            }
            // If the user story’s iteration needs to be changed:
            if (data.iteration !== globals.projectIterationRef && ! data.children.count) {
              // Add iteration to the configuration and events.
              config.Iteration = globals.projectIterationRef;
              events.push(['changes'], ['iterationChanges']);
            }
            // If the user story needs to be updated:
            if (events.length > 1) {
              // Update it.
              return globals.restAPI.update({
                ref: firstRef,
                data: config
              })
              .then(
                // When it has been updated:
                () => {
                  report(events);
                  // Process its test cases and child user stories and the remaining user stories.
                  return processMore();
                },
                error => err(error, 'changing project of user story')
              );
            }
            // Otherwise, i.e. if the user story does not need to be updated:
            else {
              report(events);
              // Process its test cases and child user stories and the remaining user stories.
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
// ==== SCHEDULE-STATE CHANGE OPERATION ====
// Recursively sets the states of an array of tasks.
const scheduleTasks = taskRefs => {
  if (taskRefs.length && ! globals.isError) {
    const firstRef = shorten('task', 'task', taskRefs[0]);
    if (! globals.isError) {
      // Get data on the first task.
      return getItemData(firstRef, ['State'], [])
      .then(
        // When the data arrive:
        data => {
          // If the task already has the specified state:
          if (data.state === globals.state.task) {
            report([['total'], ['taskTotal']]);
            // Set the states of the remaining tasks.
            return scheduleTasks(taskRefs.slice(1));
          }
          // Otherwise, i.e. if the task does not have the specified state:
          else {
            // Change the task’s state.
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
                // Set the states of the remaining tasks.
                return scheduleTasks(taskRefs.slice(1));
              },
              error => err(error, 'changing state of task')
            );
          }
        },
        error => err(error, 'getting data on task')
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
                // When any changes have been made:
                () => {
                  // Get data on the child user stories of the user story, if any.
                  return getCollectionData(data.children.ref, [], [])
                  .then(
                    // When the data arrive:
                    children => {
                      // Process the child user stories.
                      return scheduleTree(children.length ? children.map(child => child.ref) : [])
                      .then(
                        // When any child user stories have been processed:
                        () => {
                          // Process the remaining user stories.
                          return scheduleTree(storyRefs.slice(1));
                        }
                      )
                    }
                  )
                }
              )
            }
          )
          // If the user story has child user stories, and therefore has no tasks:
          if (data.children.count) {
            report([['total'], ['storyTotal']]);
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
          // Otherwise, if the user story has tasks, and therefore has no child user stories:
          else if (data.tasks.count) {
            report([['total'], ['storyTotal']]);
            // Get data on the tasks.
            return getCollectionData(data.tasks.ref, [], [])
            .then(
              // When the data arrive:
              tasks => {
                // Change the states of the tasks.
                return scheduleTasks(tasks.map(task => task.ref))
                .then(
                  // When they have been changed:
                  () => {
                    // Set the schedule states of the remaining user stories.
                    return scheduleTree(storyRefs.slice(1));
                  },
                  error => err(error, 'changing states of tasks')
                );
              },
              error => err(error, 'getting data on tasks')
            );
          }
          // Otherwise, i.e. if the user story has no child user stories and no tasks:
          else {
            // If it needs a schedule-state change:
            if (data.scheduleState !== globals.state.story) {
              // Perform it.
              return globals.restAPI.update({
                ref: firstRef,
                data: {
                  ScheduleState: globals.state.story
                }
              })
              .then(
                // When its schedule state has been changed:
                () => {
                  report([['total'], ['storyTotal'], ['changes'], ['storyChanges']]);
                  // Process the remaining user stories.
                  return scheduleTree(storyRefs.slice(1));
                },
                error => err(error, 'changing schedule state of user story')
              );
            }
            // Otherwise, i.e. if the user story does not need a schedule-state change:
            else {
              report([['total'], ['storyTotal']]);
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
// ==== TASK-CREATION OPERATION ====
// Sequentially creates tasks with a specified owner and names for a user story.
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
          error, 'getting data on first user story for task creation'
        )
      );
    }
  }
  else {
    return Promise.resolve('');
  }
};
// ==== TEST-CASE CREATION OPERATION ====
// Creates a test case.
const createCase = (name, description, owner, projectRef, storyRef) => {
  // Create a test case.
  return globals.restAPI.create({
    type: 'testcase',
    fetch: ['_ref'],
    data: {
      Name: name,
      Description: description,
      Owner: owner,
      Project: projectRef,
      TestFolder: globals.caseFolderRef || null
    }
  })
  .then(
    // After it is created:
    newCase => {
      // Link it to the specified user story.
      const caseRef = shorten('testcase', 'testcase', newCase.Object._ref);
      if (! globals.isError) {
        return globals.restAPI.add({
          ref: storyRef,
          collection: 'TestCases',
          data: [{_ref: caseRef}],
          fetch: ['_ref']
        })
        .then(
          // After it is linked:
          () => {
            // If a test set was specified:
            if (globals.caseSetRef) {
              // Link the test case to it.
              return globals.restAPI.add({
                ref: caseRef,
                collection: 'TestSets',
                data: [{_ref: globals.caseSetRef}],
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
const createCases = (names, description, owner, projectRef, storyRef) => {
  if (names.length) {
    // Create the first test case.
    return createCase(names[0], description, owner, projectRef, storyRef)
    .then(
      // When it has been created:
      () => {
        report([['changes']]);
        // Create the remaining test cases.
        return createCases(names.slice(1), description, owner, projectRef, storyRef);
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
  if (storyRefs.length && ! globals.isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! globals.isError) {
      // Get data on the first user story of the specified array.
      return getItemData(firstRef, ['Name', 'Description', 'Owner', 'Project'], ['Children'])
      .then(
        // When the data arrive:
        data => {
          report([['total']]);
          // If the user story is a leaf or all user stories are to get test cases:
          if (globals.caseTarget === 'all' || ! data.children.count) {
            // Determine the default or customized names of the test cases.
            const names = caseData ? caseData[data.name] || [data.name] : [data.name];
            // Determine the default or customized project of the test cases.
            const projectRef = globals.caseProjectRef || data.project;
            // Create the test cases.
            return createCases(names, data.description, data.owner, projectRef, firstRef)
            .then(
              // When they have been created:
              () => {
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
// ==== TEST-CASE GROUPING OPERATION ====
// Groups test cases.
const groupCases = caseRefs => {
  if (caseRefs.length && ! globals.isError) {
    const firstRef = shorten('testcase', 'testcase', caseRefs[0]);
    if (! globals.isError) {
      // Get data on the first test case of the specified array.
      return getItemData(firstRef, ['TestFolder'], ['TestSets'])
      .then(
        // When the data arrive:
        data => {
          report([['total']]);
          const folderRef = shorten('testfolder', 'testfolder', data.testFolder);
          // If a test folder has been specified and the test case is not in it:
          if (globals.groupFolderRef && folderRef !== globals.groupFolderRef) {
            // Link the test case to the test folder.
            return globals.restAPI.update({
              ref: firstRef,
              data: {
                TestFolder: globals.groupFolderRef
              }
            })
            .then(
              // When the test case has been linked:
              () => {
                report([['changes'], ['folderChanges']]);
                // If a test set has been specified:
                if (globals.groupSetRef) {
                  // If the test case is in any test sets:
                  if (data.testSets.count) {
                    // Get data on the test sets.
                    return getCollectionData(data.testSets.ref, [], [])
                    .then(
                      // When the data arrive:
                      testSets => {
                        // If the test case is not in the specified test set:
                        if (
                          ! testSets.map(
                            testSet => shorten('testset', 'testset', testSet.ref)
                          ).includes(globals.groupSetRef)
                        ) {
                          // Link the test case to it.
                          return globals.restAPI.add({
                            ref: firstRef,
                            collection: 'TestSets',
                            data: [{_ref: globals.groupSetRef}],
                            fetch: ['_ref']
                          })
                          .then(
                            // When the test case has been linked:
                            () => {
                              report([['changes'], ['setChanges']]);
                              // Group the remaining test cases.
                              return groupCases(caseRefs.slice(1));
                            }
                          );
                        }
                      },
                      error => err(error, 'getting data on test sets')
                    );
                  }
                  // Otherwise, i.e. if the test case is in no test sets:
                  else {
                    // Link the test case to the specified test set.
                    return globals.restAPI.add({
                      ref: firstRef,
                      collection: 'TestSets',
                      data: [{_ref: globals.groupSetRef}],
                      fetch: ['_ref']
                    })
                    .then(
                      // When the test case has been linked:
                      () => {
                        report([['changes'], ['setChanges']]);
                        // Group the remaining test cases.
                        return groupCases(caseRefs.slice(1));
                      }
                    );
                  }
                }
              },
              error => err(error, 'setting test folder of test case')
            );
          }
          // Otherwise, i.e. if the test case is not to be grouped in a test folder:
          else {
            // If a test set has been specified:
            if (globals.groupSetRef) {
              // If the test case is in any test sets:
              if (data.testSets.count) {
                // Get data on the test sets.
                return getCollectionData(data.testSets.ref, [], [])
                .then(
                  // When the data arrive:
                  testSets => {
                    // If the test case is not in the specified test set:
                    if (
                      ! testSets.map(
                        testSet => shorten('testset', 'testset', testSet.ref)
                      ).includes(globals.groupSetRef)
                    ) {
                      // Link the test case to it.
                      return globals.restAPI.add({
                        ref: firstRef,
                        collection: 'TestSets',
                        data: [{_ref: globals.groupSetRef}],
                        fetch: ['_ref']
                      })
                      .then(
                        () => {
                          report([['changes'], ['setChanges']]);
                        }
                      );
                    }
                  },
                  error => err(error, 'getting data on test sets')
                );
              }
              // Otherwise, i.e. if the test case is in no test sets:
              else {
                // Link the test case to the specified test set.
                return globals.restAPI.add({
                  ref: firstRef,
                  collection: 'TestSets',
                  data: [{_ref: globals.groupSetRef}],
                  fetch: ['_ref']
                })
                .then(
                  () => {
                    report([['changes'], ['setChanges']]);
                  }
                );
              }
            }
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
            return getCollectionData(data.testCases.ref, [], [])
            .then(
              // When the data arrive:
              cases => {
                // Process the test cases sequentially.
                return groupCases(cases.map(testCase => testCase.ref))
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
// Creates a passing test-case result.
const createPass = (caseRef, tester, testSet) => {
  const data = {
    TestCase: caseRef,
    Verdict: 'Pass',
    Build: globals.passBuild,
    Notes: globals.passNote,
    Date: new Date(),
    Tester: tester,
    TestSet: testSet
  };
  // Create a passing result.
  return globals.restAPI.create({
    type: 'testcaseresult',
    fetch: ['_ref'],
    data
  });
};
// Creates passing results for test cases.
const passCases = caseRefs => {
  if (caseRefs.length && ! globals.isError) {
    const firstRef = shorten('testcase', 'testcase', caseRefs[0]);
    if (! globals.isError) {
      // Get data on the first test case of the specified array.
      return getItemData(firstRef, ['Owner'], ['Results', 'TestSets'])
      .then(
        // When the data arrive:
        data => {
          report([['total']]);
          // If the test case already has results:
          if (data.results.count) {
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
                      report([['changes']]);
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
                  report([['changes']]);
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
                    if (! globals.isError) {
                      // Process child user stories and the remaining user stories.
                      return passChildrenAndSiblings();
                    }
                    else {
                      return '';
                    }
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
// ==== PLANIFICATION OPERATION ====
// Sequentially planifies an array of test cases.
const planCases = (caseRefs, folderRef) => {
  if (caseRefs.length && ! globals.isError) {
    // Identify and shorten a reference to the first test case.
    const firstRef = shorten('testcase', 'testcase', caseRefs[0]);
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
            return planCases(caseRefs.slice(1), folderRef);
          },
          error => err(error, `linking test case ${firstRef} to test folder`)
        );
      }
      // Otherwise, i.e. if test cases are to be copied into test folders:
      else {
        // Get data on the test case.
        return getItemData(
          firstRef,
          ['Name', 'Description', 'Owner', 'DragAndDropRank', 'Risk', 'Priority', 'Project'],
          []
        )
        .then(
          // When the data arrive:
          data => {
            // Copy the test case into the test folder.
            return globals.restAPI.create({
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
                // Copy the remaining test cases.
                return planCases(caseRefs.slice(1), folderRef);
              },
              error => err(error, `copying test case ${firstRef}`)
            );
          },
          error => err(error, 'getting data on test case')
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
// Get data on test cases and planify them.
const getAndPlanCases = (data, folderRef) => {
  // Get data on the test cases.
  return getCollectionData(data.testCases.ref, [], [])
  .then(
    // When the data arrive:
    cases => {
      // Process the test cases.
      return planCases(cases.map(testCase => testCase.ref), folderRef);
    },
    error => err(error, 'getting data on test cases')
  );
};
// Recursively planifies a tree or subtrees of user stories.
const planTree = (storyRefs, parentRef) => {
  if (storyRefs.length && ! globals.isError) {
    // Identify and shorten the reference to the first user story.
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! globals.isError) {
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
            // When the user story has been planified:
            folder => {
              // If the test folder is the root, report its formatted ID.
              if (! parentRef) {
                response.write(`event: planRoot\ndata: ${folder.Object.FormattedID}\n\n`);
              }
              report([['storyChanges']]);
              // Identify a short reference to the test folder.
              const folderRef = shorten('testfolder', 'testfolder', folder.Object._ref);
              if (! globals.isError) {
                // FUNCTION DEFINITION START
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
                // FUNCTION DEFINITION END
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
  Recursively documents as an object in JSON format a tree or subtree of user stories, specifying
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
              storyArray[index].featureParent = data ? data.formattedID : '';
            }
          );
          getItemData(data.parent, ['FormattedID'], [])
          .then(
            data => {
              storyArray[index].storyParent = data ? data.formattedID : '';
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
          const newJSContent = reportScriptPrep(
            jsContent,
            '/projecttally',
            ['total', 'changes', 'projectChanges', 'releaseChanges', 'iterationChanges', 'error']
          );
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
      else if (requestURL === '/copytally' && globals.idle) {
        streamInit();
        copyTree(
          [globals.rootRef],
          globals.copyParentType === 'hierarchicalrequirement' ? 'story' : 'feature',
          globals.copyParentRef
        );
      }
      else if (requestURL === '/scoretally' && globals.idle) {
        streamInit();
        scoreTree(globals.rootRef);
      }
      else if (requestURL === '/taketally' && globals.idle) {
        streamInit();
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
    // Otherwise, if the request submits the request form:
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
      // Assigns values to global variables for handling POST requests.
      const setGlobals = () => {
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
              return err('Root ID missing', 'submitting request');
            }
          },
          error => err(error, 'getting reference to root user story')
        );
      };
      // Get a long reference to the root user story.
      setGlobals()
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
                              // When it or blank arrives:
                              ref => {
                                if (! globals.isError) {
                                  // Set its global variable.
                                  globals.copyProjectRef = ref || data.project;
                                  // Get a reference to the specified owner, if any.
                                  getGlobalNameRef(bodyObject.copyOwner, 'user', 'UserName')
                                  .then(
                                    // When it or blank arrives:
                                    ref => {
                                      if (! globals.isError) {
                                        // Set its global variable.
                                        globals.copyOwnerRef = ref;
                                        // Get a reference to the specified release, if any.
                                        getProjectNameRef(
                                          globals.copyProjectRef, 'release', bodyObject.copyRelease, 'copy'
                                        )
                                        .then(
                                          // When it or blank arrives:
                                          ref => {
                                            if (! globals.isError) {
                                              // Set its global variable.
                                              globals.copyReleaseRef = ref;
                                              // Get a reference to the specified iteration, if any.
                                              getProjectNameRef(
                                                globals.copyProjectRef, 'iteration', bodyObject.copyIteration, 'copy'
                                              )
                                              .then(
                                                // When it or blank arrives:
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
              // When the reference or blank arrives:
              ref => {
                if (! globals.isError) {
                  // Set its global variable.
                  globals.caseProjectRef = ref ? shorten('project', 'project', ref) : '';
                  if (! globals.isError) {
                    // Get a reference to the test folder, if specified.
                    getRef('testfolder', caseFolder, 'test-case creation')
                    .then(
                      // When the reference or blank arrives:
                      ref => {
                        if (! globals.isError) {
                          // Set its global variable.
                          globals.caseFolderRef = ref ? shorten('testfolder', 'testfolder', ref) : '';
                          if (! globals.isError) {
                            // Get a reference to the test set, if specified.
                            getRef('testset', caseSet, 'test-case creation')
                            .then(
                              // When the reference or blank arrives:
                              ref => {
                                if (! globals.isError) {
                                  // Set its global variable.
                                  globals.caseSetRef = ref ? shorten('testset', 'testset', ref) : '';
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
                // When the reference or blank arrives:
                ref => {
                  if (! globals.isError) {
                    // Set its global variable.
                    globals.groupFolderRef = ref ? shorten('testfolder', 'testfolder', ref) : '';
                    if (! globals.isError) {
                      // Get a reference to the test set, if specified.
                      getRef('testset', groupSet, 'test-case grouping')
                      .then(
                        // When the reference or blank arrives:
                        ref => {
                          if (! globals.isError) {
                            // Set its global variable.
                            globals.groupSetRef = ref ? shorten('testset', 'testset', ref) : '';
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
