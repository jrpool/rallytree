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

let errorMessage = '';
const queryUtils = rally.util.query;
// REST API.
const requestOptions = {
  headers: {
    'X-RallyIntegrationName': process.env.RALLYINTEGRATIONNAME || 'RallyTree',
    'X-RallyIntegrationVendor': process.env.RALLYINTEGRATIONVENDOR || '',
    'X-RallyIntegrationVersion': process.env.RALLYINTEGRATIONVERSION || '1.0'
  }
};
let restAPI;
let userRef = '';
let takerRef = '';
let rootRef = '';
let total = 0;
let changes = 0;
let idle = false;

// ########## FUNCTIONS

// Creates and logs an error message.
const err = (error, context) => {
  errorMessage = `Error ${context}: ${error.message}`;
  // userRef = takerRef = rootRef = '';
  // total = changes = 0;
  // busy = false;
  console.log(errorMessage);
  return '';
};
// Shortens a long reference.
const shorten = (type, longRef) => {
  const num = longRef.replace(/^http.+([/]|%2F)(?=\d+)/, '');
  if (/^\d+/.test(num)) {
    return `/${type}/${num}`;
  }
  else {
    errorMessage = `Invalid Rally URL: ${longRef} shortened to /${type}/${num}`;
    return '';
  }
};
// Increments the total(s) and sends the new total(s) as events.
const upTotal = (isChange, response) => {
  const totalMsg = `event: total\ndata: ${++total}\n\n`;
  let changeMsg = '';
  if (isChange){
    changeMsg = `event: changes\ndata: ${++changes}\n\n`;
  }
  response.write(`${totalMsg}${changeMsg}`);
};
/*
  Recursively processes ownership changes on a user story and its child
  user stories.
*/
const takeTree = (restAPI, storyRef, response) => {
  // Get data on the user story.
  return restAPI.get({
    ref: storyRef,
    fetch: ['Owner', 'Children', 'Tasks']
  })
  .then(
    storyResult => {
      const storyObj = storyResult.Object;
      const storyOwner = storyObj.Owner;
      const ownerRef = storyOwner ? shorten('user', storyObj.Owner._ref) : '';
      const tasksSummary = storyObj.Tasks;
      const childrenSummary = storyObj.Children;
      // Make the specified user the owner of the user story, if not already.
      const isChange = ownerRef !== takerRef;
      upTotal(isChange, response);
      restAPI.update({
        ref: storyRef,
        data: isChange ? {Owner: takerRef} : {}
      })
      /*
        Wait until the ownership change is complete. Otherwise, Rally will
        reject changes to the descendants of the user story while it is
        being modified, causing erratic failures.
      */
      .then(
        () => {
          if (tasksSummary.Count) {
            // Get their data.
            restAPI.get({
              ref: tasksSummary._ref,
              fetch: ['_ref', 'Owner']
            })
            .then(
              // Make the specified user the owner of each, if not already.
              tasksObj => {
                const tasks = tasksObj.Object.Results;
                // If the user story has any tasks:
                tasks.forEach(taskObj => {
                  if (! errorMessage) {
                    const taskRef = shorten('task', taskObj._ref);
                    const taskOwner = taskObj.Owner;
                    const ownerRef = taskOwner
                      ? shorten('user', taskOwner._ref)
                      : '';
                    const isChange = ownerRef !== takerRef;
                    upTotal(isChange, response);
                    if (errorMessage) {
                      serveError(response);
                      return;
                    }
                    if (isChange) {
                      restAPI.update({
                        ref: taskRef,
                        data: {Owner: takerRef}
                      })
                      .catch(error => err(error, 'changing the owner'));
                    }
                  }
                });
              },
              error => err(error, 'getting data on tasks')
            );
          }
          // If the user story has any child user stories:
          if (childrenSummary.Count) {
            // Get their data.
            restAPI.get({
              ref: childrenSummary._ref,
              fetch: ['_ref']
            })
            .then(
              // Process each.
              childrenObj => {
                const children = childrenObj.Object.Results;
                children.forEach(child => {
                  if (! errorMessage) {
                    const childRef = shorten(
                      'hierarchicalrequirement', child._ref
                    );
                    if (errorMessage) {
                      serveError(response);
                      return;
                    }
                    takeTree(restAPI, childRef, response);
                  }
                });
              },
              error => err(error, 'getting data on children')
            );
          }
          return '';
        },
        error => err(error, 'changing user-story owner')
      );
    },
    error => err(error, 'getting data on user story')
  );
};
/*
  Recursively checks a user story and its child user stories and,
  where one is a test-level user story missing a test case, creates
  it.
*/
const caseTree = (restAPI, storyRef, response) => {
  // Get data on the user story.
  return restAPI.get({
    ref: storyRef,
    fetch: ['Children', 'Tasks', 'TestCases']
  })
  .then(
    storyResult => {
      const storyObj = storyResult.Object;
      const tasksSummary = storyObj.Tasks;
      const casesSummary = storyObj.TestCases;
      const childrenSummary = storyObj.Children;
      /*
        If the user story has any child user stories, assume it
        does not need a test case and:
      */
      if (childrenSummary.Count) {
        // Get their data.
        restAPI.get({
          ref: childrenSummary._ref,
          fetch: ['_ref']
        })
        .then(
          // After the data have been fetched, process each child.
          childrenObj => {
            const children = childrenObj.Object.Results;
            children.forEach(child => {
              if (! errorMessage) {
                const childRef = shorten(
                  'hierarchicalrequirement', child._ref
                );
                caseTree(restAPI, childRef, response);
              }
            });
          },
          error => err(error, 'getting data on children')
        );
      }
      // Otherwise, if the user story needs a test case:
      else if (tasksSummary.Count && ! casesSummary.Count) {
        const casesRef = shorten(
          'hierarchicalrequirement', casesSummary._ref
        ).toLowerCase();
        if (errorMessage) {
          serveError(response);
          return;
        }
        // Create a test case.
        upTotal(true, response);
        restAPI.create({
          type: 'testcase',
          fetch: ['_ref'],
          data: {
            Name: 'Test Case X'
          }
        })
        .then(
          newCase => {
            // After it is created, link it to the user story.
            const caseRef = shorten('testcase', newCase.Object._ref);
            console.log(`Created ${caseRef}`);
            if (errorMessage) {
              serveError(response);
              return;
            }
            console.log(
              `Linking case\n${caseRef}\nto collection\n${casesRef}`
            );
            restAPI.add({
              ref: storyRef,
              collection: 'TestCases',
              data: [{_ref: caseRef}],
              fetch: ['_ref']
            })
            .then(
              ref => {
                console.log(`Added ${ref} to ${storyRef}`);
                return;
              },
              error => err(error, 'adding test case to user story')
            );
          },
          error => err(error, 'creating test case')
        );
      }
      /*
        Otherwise, i.e. if the user story has no children but does
        not need a test case:
      */
      else {
        upTotal(false, response);
      }
    },
    error => err(error, 'getting data on user story')
  );
};
// Gets a reference to a user.
const getUserRef = (restAPI, userName) => {
  return restAPI.query({
    type: 'user',
    query: queryUtils.where('UserName', '=', userName)
  })
  .then(
    userRef => shorten('user', userRef.Results[0]._ref),
    error => err(error, 'getting user')
  );
};
// Serves the introduction page.
const serveIntro = response => {
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
const serveDo = response => {
  fs.readFile('do.html', 'utf8')
  .then(
    content => {
      const {RALLY_USERNAME, RALLY_PASSWORD} = process.env;
      const newContent = content
      .replace('__userName__', RALLY_USERNAME || '')
      .replace('__password__', RALLY_PASSWORD || '');
      response.setHeader('Content-Type', 'text/html');
      response.write(newContent);
      response.end();
    },
    error => err(error, 'reading do page')
  );
};
// Serves the acknowledgement page.
const serveTakeReport = (userName, takerName, response) => {
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
// Serves the acknowledgement page.
const serveCaseReport = (userName, response) => {
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
// Serves the stylesheet.
const serveStyles = response => {
  fs.readFile('style.css', 'utf8')
  .then(
    content => {
      response.setHeader('Content-Type', 'text/css');
      response.write(content);
      response.end();
    },
    error => {
      err(error, 'reading stylesheet');
    }
  );
};
// Serves the error page.
const serveError = response => {
  fs.readFile('error.html', 'utf8')
  .then(
    content => {
      const newContent = content.replace(
        '__errorMessage__', errorMessage
      );
      response.setHeader('Content-Type', 'text/html');
      response.write(newContent);
      response.end();
      errorMessage = '';
    },
    error => {
      err(error, 'reading error page');
    }
  );
};
// Serves an image.
const servePNG = (src, response) => {
  fs.readFile(src.replace(/^\//, ''))
  .then(
    content => {
      response.setHeader('Content-Type', 'image/png');
      response.write(content, 'binary');
      response.end();
    },
    error => {
      err(error, 'reading PNG image');
    }
  );
};
// Serves the site icon.
const serveIcon = response => {
  fs.readFile('favicon.ico')
  .then(
    content => {
      response.setHeader('Content-Type', 'image/x-icon');
      response.write(content, 'binary');
      response.end();
    },
    error => {
      err(error, 'reading site icon');
    }
  );
};
// Prepares to serves the event stream.
const serveEventStart = response => {
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Connection', 'keep-alive');
};
// Handles requests, serving the home page and the acknowledgement page.
const requestHandler = (request, response) => {
  const {method} = request;
  const body = [];
  request.on('error', err => {
    console.error(err);
  })
  .on('data', chunk => {
    body.push(chunk);
  })
  .on('end', () => {
    const requestURL = request.url;
    if (method === 'GET') {
      if (requestURL === '/' || requestURL === '/index.html') {
        // Serves the introduction page.
        serveIntro(response);
      }
      else if (requestURL === '/do.html') {
        // Serves the request page.
        serveDo(response);
      }
      else if (requestURL === '/style.css') {
        // Serves the stylesheet when the home page requests it.
        serveStyles(response);
      }
      else if (requestURL.endsWith('.png')) {
        // Serves a PNG image when a page requests it.
        servePNG(requestURL, response);
      }
      else if (requestURL === '/favicon.ico') {
        // Serves the site icon when a page requests it.
        serveIcon(response);
      }
      else if (requestURL === '/taketotals' && idle) {
        /*
          Serves the event stream, performs the operation, and reports
          the events when a page first requests this. After the server
          closes the connection, the client may periodically request
          '/taketotals' again. Prevents response to those requests by
          setting idle to false.
        */
        idle = false;
        total = changes = 0;
        serveEventStart(response);
        takeTree(restAPI, rootRef, response);
      }
      else if (requestURL === '/casetotals' && idle) {
        /*
          Serves the event stream, performs the operation, and reports
          the events when a page first requests this. After the server
          closes the connection, the client may periodically request
          '/casetotals' again. Prevents response to those requests by
          setting idle to false.
        */
        idle = false;
        total = changes = 0;
        serveEventStart(response);
        caseTree(restAPI, rootRef, response);
      }
    }
    else if (method === 'POST' && requestURL === '/do.html') {
      // Enables a server response to the next /taketotals request.
      idle = true;
      const bodyObject = parse(Buffer.concat(body).toString());
      const {userName, password, rootURL, op, takerName} = bodyObject;
      rootRef = shorten('hierarchicalrequirement', rootURL);
      if (errorMessage) {
        serveError(response);
        return;
      }
      if (rootRef) {
        restAPI = rally({
          user: userName,
          pass: password,
          requestOptions
        });
        if (op === 'take') {
          if (takerName) {
            getUserRef(restAPI, takerName)
            .then(
              ref => {
                if (errorMessage) {
                  serveError(response);
                }
                else {
                  takerRef = ref;
                  getUserRef(restAPI, userName)
                  .then(
                    ref => {
                      if (errorMessage) {
                        serveError(response);
                      }
                      else {
                        userRef = ref;
                        serveTakeReport(userName, takerName, response);
                      }
                    },
                    error => err(error, 'getting reference to user')
                  );
                }
              },
              error => err(error, 'getting reference to new owner')
            );
          }
          else {
            getUserRef(restAPI, userName)
            .then(
              ref => {
                if (errorMessage) {
                  serveError(response);
                }
                else {
                  takerRef = userRef = ref;
                  serveTakeReport(userName, userName, response);
                }
              },
              error => err(error, 'getting reference to user')
            );
          }
        }
        else if (op === 'case') {
          serveCaseReport(userName, response);
        }
      }
      else {
        errorMessage = 'Tree root not specified.';
        serveError(response);
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
