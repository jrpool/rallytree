/*
  index.js
  RallyTree script.

  This script serves a web page with a form for submission of a RallyTree request to make a user the owner of all work items in a tree. When a request is submitted, the script fulfills and acknowledges it.
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
    'X-RallyIntegrationName': process.env.RALLYINTEGRATIONNAME || 'RallyTree',
    'X-RallyIntegrationVendor': process.env.RALLYINTEGRATIONVENDOR || '',
    'X-RallyIntegrationVersion': process.env.RALLYINTEGRATIONVERSION || '1.0'
  }
};
let isError = false;
let restAPI = {};
let response = {};
let userRef = '';
let takerRef = '';
let taskNames = [];
let rootRef = '';
let parentRef = '';
let total = 0;
let changes = 0;
let idle = false;
let {RALLY_USERNAME, RALLY_PASSWORD} = process.env;
RALLY_USERNAME = RALLY_USERNAME || '';
RALLY_PASSWORD = RALLY_PASSWORD || '';

// ########## FUNCTIONS

// Reinitialize the global variables, except response.
const reinit = () => {
  isError = false;
  restAPI = {};
  userRef = '';
  takerRef = '';
  taskNames = [];
  rootRef = '';
  parentRef = '';
  total = 0;
  changes = 0;
  idle = false;
};
// Processes a thrown error.
const err = (error, context) => {
  const problem = (typeof error) === 'string' ? error : error.message;
  const msg = `Error ${context}: ${problem}`;
  console.log(msg);
  isError = true;
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
};
// Shortens a long reference.
const shorten = (type, longRef) => {
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
};
// Increments the total count and sends the new count as an event.
const upTotal = () => {
  response.write(`event: total\ndata: ${++total}\n\n`);
};
// Increments the total count and the change count and sends the counts as events.
const upTotals = changeCount => {
  const totalMsg = `event: total\ndata: ${++total}\n\n`;
  changes += changeCount;
  const changeMsg = changeCount ? `event: changes\ndata: ${++changes}\n\n` : '';
  response.write(`${totalMsg}${changeMsg}`);
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
              upTotals(1, response);
            },
            error => err(error, 'changing the owner')
          );
        }
        else {
          upTotals(0, response);
        }
      }
    }
  }
};
/*
  Recursively processes ownership changes on a user story and its child
  user stories.
*/
const takeTree = storyRef => {
  // Get data on the user story.
  restAPI.get({
    ref: storyRef,
    fetch: ['Owner', 'Children', 'Tasks']
  })
  .then(
    storyResult => {
      const storyObj = storyResult.Object;
      const storyOwner = storyObj.Owner;
      const ownerRef = storyOwner ? shorten('user', storyObj.Owner._ref) : '';
      const tasksSummary = storyObj.Tasks;
      const taskCount = tasksSummary.Count;
      const childrenSummary = storyObj.Children;
      const childCount = childrenSummary.Count;
      const changeCount = ownerRef === takerRef ? 0 : 1;
      // Make the specified user the owner of the user story, if not already.
      restAPI.update({
        ref: storyRef,
        data: changeCount ? {Owner: takerRef} : {}
      })
      // Wait until the ownership change is complete to prevent concurrency errors.
      .then(
        () => {
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
                // Ensure that the specified user owns them.
                tasks.forEach(taskObj => {
                  takeTask(taskObj);
                });
              },
              error => err(error, 'getting data on tasks')
            );
          }
          // Otherwise, if the user story has any child user stories and no tasks:
          else if (childCount && ! taskCount) {
            // Get the data on the child user stories.
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
              error => err(error, 'getting data on children')
            );
          }
          else if (childCount && taskCount) {
            err('User story with both children and tasks', 'ownership changes');
          }
        },
        error => err(error, 'changing user-story owner')
      );
    },
    error => err(error, 'getting data on user story for ownership changes')
  );
};
// Sequentially perform an operation on work items.
const iterate = (operation, workItems, itemType, context, otherRef) => {
  if (workItems.length && ! isError) {
    const firstRef = shorten(
      itemType, workItems[0]._ref
    );
    if (! isError) {
      operation(firstRef, otherRef)
      .then(
        () => iterate(operation, workItems.slice(1), itemType, context),
        error => err(error, context)
      );
    }
  }
};
// Creates a task for a user story.
const createTask = (storyRef, owner, name) => {
  // Create the task.
  return restAPI.create({
    type: 'task',
    fetch: ['_ref'],
    data: {
      Name: name,
      Owner: owner
    }
  })
  .then(
    task => {
      // After it is created, link it to the user story.
      const taskRef = shorten('task', task.Object._ref);
      if (! isError) {
        restAPI.add({
          ref: storyRef,
          collection: 'Tasks',
          data: [{_ref: taskRef}],
          fetch: ['_ref']
        });
      }
    },
    error => err(error, 'creating task')
  );
};
// Sequentially create tasks for a user story.
const createTasks = (storyRef, owner, names) => {
  if (names.length && ! isError) {
    createTask(storyRef, owner, names[0])
    .then(
      () => createTasks(storyRef, owner, names.slice(1)),
      error => err(error, 'calling createTask to create task')
    );
  }
};
/*
  Recursively checks a user story and its descendant user stories and,
  where one has no child user stories, creates tasks for it.
*/
const taskTree = storyRef => {
  // Get data on the user story.
  restAPI.get({
    ref: storyRef,
    fetch: ['Name', 'Owner', 'Children']
  })
  .then(
    storyResult => {
      // When the data arrive:
      const storyObj = storyResult.Object;
      const childrenSummary = storyObj.Children;
      const owner = storyObj.Owner;
      /*
        If the user story has any child user stories, it does not need
        tasks, so:
      */
      if (childrenSummary.Count) {
        upTotals(0);
        // Get data on its child user stories.
        return restAPI.get({
          ref: childrenSummary._ref,
          fetch: ['_ref']
        })
        .then(
          /*
            When the data arrive, process the children sequentially to
            prevent concurrency errors.
          */
          childrenResult => {
            const children = childrenResult.Object.Results;
            iterate(
              taskTree, children, 'hierarchicalrequirement', 'creating tasks in tree'
            );
          },
          error => err(error, 'getting data on child user stories')
        );
      }
      // Otherwise the user story needs tasks, so:
      else {
        // Create them sequentially, to prevent concurrency errors.
        createTasks(storyRef, owner, taskNames);
        if (! isError) {
          upTotals(taskNames.length);
        }
      }
    },
    error => err(error, 'getting data on user story')
  );
};
/*
  Recursively checks a user story and its descendant user stories and,
  where one has no child user stories, creates a test case for it.
*/
const caseTree = storyRef => {
  // Get data on the user story.
  restAPI.get({
    ref: storyRef,
    fetch: [
      'Name',
      'Description',
      'Owner',
      'Children',
      'Tasks',
      'TestCases'
    ]
  })
  .then(
    storyResult => {
      const storyObj = storyResult.Object;
      const childrenSummary = storyObj.Children;
      const name = storyObj.Name;
      const description = storyObj.Description;
      const owner = storyObj.Owner;
      /*
        If the user story has any child user stories, assume it does not
        need a test case and:
      */
      if (childrenSummary.Count) {
        upTotals(0);
        // Get their data.
        return restAPI.get({
          ref: childrenSummary._ref,
          fetch: ['_ref']
        })
        .then(
          /*
            When the data arrive, process the children sequentially to
            prevent concurrency errors.
          */
          childrenResult => {
            const children = childrenResult.Object.Results;
            iterate(
              caseTree,
              children,
              'hierarchicalrequirement',
              'creating test cases in tree'
            );
          },
          error => err(error, 'getting data on child user stories')
        );
      }
      // Otherwise:
      else {
        // Create a test case.
        return restAPI.create({
          type: 'testcase',
          fetch: ['_ref'],
          data: {
            Name: name,
            Description: description,
            Owner: owner
          }
        })
        .then(
          newCase => {
            // After it is created, link it to the user story.
            const caseRef = shorten('testcase', newCase.Object._ref);
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
                },
                error => err(error, 'adding test case to user story')
              );
            }
          },
          error => err(error, 'creating test case')
        );
      }
    },
    error => err(error, 'getting data on user story')
  );
};
/*
  Recursively copies a user story and its descendant user stories and
  makes the new tree a child of an existing user story.
*/
const copyTree = (storyRef, parentRef) => {
  // Get data on the user story.
  restAPI.get({
    ref: storyRef,
    fetch: ['Name', 'Description', 'Owner', 'Children']
  })
  .then(
    storyResult => {
      /*
        When the data arrive, copy the user story and give it the specified
        parent.
      */
      const storyObj = storyResult.Object;
      const childrenRef = storyObj.Children._ref;
      restAPI.create({
        type: 'hierarchicalrequirement',
        fetch: ['_ref'],
        data: {
          Name: storyObj.Name,
          Description: storyObj.Description,
          Owner: storyObj.Owner,
          Parent: parentRef
        }
      })
      .then(
        copyResult => {
          /*
            When the user story has been copied and linked, get data on
            its children.
          */
          upTotal();
          const ref = copyResult.Object._ref;
          restAPI.get({
            ref: childrenRef,
            fetch: ['_ref']
          })
          .then(
            /*
              When the data arrive, process the children sequentially to
              prevent concurrency errors.
            */
            childrenResult => {
              const children = childrenResult.Object.Results;
              iterate(
                copyTree, children, 'hierarchicalrequirement', 'copying tree', ref
              );
            },
            error => err(error, 'getting data on children')
          );
        },
        error => err(error, 'copying user story')
      );
    },
    error => err(error, 'getting data on user story to copy')
  );
};
// Gets a reference to a user.
const getUserRef = userName => {
  return restAPI.query({
    type: 'user',
    query: queryUtils.where('UserName', '=', userName)
  })
  .then(
    userRef => shorten('user', userRef.Results[0]._ref),
    error => err(error, 'getting user reference')
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
          const taskCount = `${taskNames.length} task${taskNames.length > 1 ? 's' : ''}`;
          const newContent = htmlContent
          .replace('__script__', jsContent)
          .replace('__taskCount', taskCount)
          .replace('__taskNames__', taskNames.join('\n'))
          .replace('__rootRef__', rootRef)
          .replace('__userName__', userName)
          .replace('__userRef__', userRef);
          response.setHeader('Content-Type', 'text/html');
          response.write(newContent);
          response.end();
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
          .replace('__parentRef__', parentRef)
          .replace('__userName__', userName)
          .replace('__userRef__', userRef);
          response.setHeader('Content-Type', 'text/html');
          response.write(newContent);
          response.end();
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
        Otherwise, if the requested resource is an event stream, start it and
        prevent any others from being started.
      */
      else if (requestURL === '/taketotals' && idle) {
        streamInit();
        takeTree(rootRef);
      }
      else if (requestURL === '/tasktotals' && idle) {
        streamInit();
        taskTree(restAPI, rootRef, response);
      }
      else if (requestURL === '/casetotals' && idle) {
        streamInit();
        caseTree(restAPI, rootRef, response);
      }
      else if (requestURL === '/copytotals' && idle) {
        streamInit();
        copyTree(restAPI, rootRef, parentRef, response);
      }
    }
    // Otherwise, if the request submits the request form:
    else if (method === 'POST' && requestURL === '/do.html') {
      reinit();
      // Permit an event stream to be started.
      idle = true;
      const bodyObject = parse(Buffer.concat(bodyParts).toString());
      const {
        userName, password, rootURL, op, takerName, parentURL, taskNameString
      } = bodyObject;
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
        // If the requested operation is ownership change:
        if (op === 'take') {
          // If an owner other than the user was specified:
          if (takerName) {
            getUserRef(takerName)
            .then(
              ref => {
                takerRef = ref;
                getUserRef(userName)
                .then(
                  ref => {
                    userRef = ref;
                    serveTakeReport(userName, takerName);
                  },
                  error => err(error, 'getting reference to user for owner change')
                );
              },
              error => err(error, 'getting reference to new owner')
            );
          }
          // Otherwise, the new owner will be the user.
          else {
            getUserRef(userName)
            .then(
              ref => {
                // If the username is valid (otherwise its type is object):
                if (! isError) {
                  takerRef = userRef = ref;
                  serveTakeReport(userName, userName);
                }
              },
              error => err(error, 'getting reference to user as new owner')
            );
          }
        }
        /*
          Otherwise, if the requested operation is task creaation and at least
          1 task name was specified:
        */
        else if (op === 'task' && taskNameString.length > 1) {
          const delimiter = taskNameString[0];
          taskNames.push(...taskNameString.slice(1).split(delimiter));
          if (taskNames.every(taskName => taskName.length)) {
            serveTaskReport(userName);
          }
          else {
            err('empty task name', 'creating tasks');
          }
        }
        // Otherwise, if the requested operation is test-case creation:
        else if (op === 'case') {
          serveCaseReport(userName);
        }
        // Otherwise, if the requested operation is tree copying:
        else if (op === 'copy') {
          parentRef = shorten('hierarchicalrequirement', parentURL);
          if (! isError) {
            serveCopyReport(userName);
          }
        }
        else {
          err('Invalid request', 'request-form submission');
        }
      }
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
