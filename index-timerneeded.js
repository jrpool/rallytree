/*
  index.js
  RallyTree script.

  This script serves a web page with a form for submission of a RallyTree request to make the user the owner of all work items in a tree. When a request is submitted, the script processes it and reports the results on another web page.

  Strategy:

    1. Compile an “agenda” of Promises, one per work item in the tree, that will each acquire a status. If the work item already has the intended owner, the status of its Promise will become “resolved”. If not, its status will become “rejected”.

    2. When the Promises are all settled, i.e. they all have statuses, change the item owners to the current user for work items whose Promises have the “rejected” status.
*/

// ########## IMPORTS

// Module to access files.
const fs = require('fs').promises;
// Module to keep secrets local.
require('dotenv').config();
const { count } = require('console');
// Module to create a web server.
const http = require('http');
const { resolve } = require('path');
// Module to parse request bodies.
const {parse} = require('querystring');
// Rally module.
const rally = require('rally');

// ########## GLOBAL VARIABLES

// Counts.
const counts = {
  item: 0,
  already: 0,
  change: 0
};
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
/*
  Array to be populated with one Promise object per work item in the tree.
  They will acquire status resolved if the owner of the work item is OK,
  or rejected if it needs to be changed.
*/
const agenda = [];

// ########## FUNCTIONS

// Creates an error message and returns an empty string.
const err = (error, context) => {
  errorMessage = `Error ${context}: ${error.message}`;
  return '';
};
// Shortens a long reference.
const shorten = (type, longRef) => longRef.replace(
  /^http.+([/]|%2F)/, `/${type}/`
);
// Populates the agenda.
const getAgenda = (restAPI, storyRef, userRef) => {
  restAPI.get({
    ref: shorten('hierarchicalrequirement', storyRef),
    fetch: ['Owner', 'Children', 'Tasks']
  })
  .then(
    storyResult => {
      const storyObj = storyResult.Object;
      const storyRef = storyObj._ref;
      const ownerRef = storyObj.Owner._ref;
      const tasksSummary = storyObj.Tasks;
      const childrenSummary = storyObj.Children;
      // Add a Promise object to agenda for the user story.
      agenda.push(new Promise((resolve, reject) => {
        if (shorten('user', ownerRef) === userRef) {
          resolve(storyRef)
          .then(
            () => {
              counts.already++;
            },
            () => {
              counts.change++;
            }
          );
        }
        else {
          reject(storyRef)
          .then(
            () => {
              counts.already++;
            },
            () => {
              counts.change++;
            }
          );
        }
      }));
      // Add Promise objects to agenda for the tasks of the user story.
      if (tasksSummary.Count) {
        restAPI.get({
          ref: tasksSummary._ref,
          fetch: ['_ref', 'Owner']
        })
        .then(
          tasksObj => {
            const tasks = tasksObj.Object.Results;
            tasks.forEach(task => {
              const taskRef = shorten('task', task._ref);
              const taskOwnerRef = shorten('user', task.Owner._ref);
              agenda.push(new Promise((resolve, reject) => {
                if (taskOwnerRef === userRef) {
                  resolve(taskRef)
                  .then(
                    () => {
                      counts.already++;
                    },
                    () => {
                      counts.change++;
                    }
                  );
                }
                else {
                  reject(taskRef)
                  .then(
                    () => {
                      counts.already++;
                    },
                    () => {
                      counts.change++;
                    }
                  );
                }
              }));
            });
          },
          error => err(error, 'getting data on tasks')
        );
      }
      if (childrenSummary.Count) {
        restAPI.get({
          ref: childrenSummary._ref,
          fetch: ['_ref']
        })
        .then(
          childrenObj => {
            const children = childrenObj.Object.Results;
            children.forEach(child => {
              getAgenda(restAPI, child._ref, userRef);
            });
          },
          error => err(error, 'getting data on children')
        );
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
// Processes the agenda.
const doAgenda = (restAPI, promises, userRef) => {
  counts.item = promises.length;
  agenda.forEach(item => {
    const status = item.status;
    if (status === 'resolved') {
      counts.already++;
    }
    else if (status === 'rejected') {
      counts.change++;
      restAPI.update({
        ref: item.reason,
        data: {Owner: userRef}
      });
    }
  });
};
// Serves the error page.
const serveError = (response, errorMessage) => {
  fs.readFile('error.html', 'utf8')
  .then(
    content => {
      const newContent = content.replace(
        '[[errorMessage]]', errorMessage
      );
      response.setHeader('Content-Type', 'text/html');
      response.write(newContent);
      response.end();
    },
    error => {
      console.log(`Error reading error page: ${error.message}`);
    }
  );
};
// Serves the report page.
const serveReport =(userName, rootRef, response) => {
  fs.readFile('report.html', 'utf8')
  .then(
    content => {
      const newContent = content.replace('[[userName]]', userName)
      .replace('[[rootRef]]', rootRef)
      .replace('[[itemCount]]', counts.item)
      .replace('[[alreadyCount]]', counts.already)
      .replace('[[changeCount]]', counts.change);
      // Reset the results.
      counts.item = counts.already = counts.change = 0;
      agenda.length = 0;
      response.setHeader('Content-Type', 'text/html');
      response.write(newContent);
      response.end();
    },
    error => err(error, 'reading result page')
  );
};
// Handles requests, serving the home page and the report page.
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
    if (method === 'GET') {
      if (request.url === '/style.css') {
        fs.readFile('style.css', 'utf8')
        .then(
          content => {
            response.setHeader('Content-Type', 'text/css');
            response.write(content);
            response.end();
          },
          error => {
            console.log(`Error reading stylesheet: ${error.message}`);
          }
        );
      }
      else {
        fs.readFile('index.html', 'utf8')
        .then(
          content => {
            response.setHeader('Content-Type', 'text/html');
            response.write(content);
            response.end();
          },
          error => {
            console.log(`Error reading home page: ${error.message}`);
          }
        );
      }
    }
    else if (method === 'POST') {
      const bodyObject = parse(Buffer.concat(body).toString());
      const userName = bodyObject.userName;
      const rootRef = shorten(
        'hierarchicalrequirement', bodyObject.rootURL
      );
      const restAPI = rally({
        user: userName,
        pass: bodyObject.password,
        requestOptions
      });
      getUserRef(restAPI, userName)
      .then(
        userRef => {
          if (errorMessage) {
            serveError(response, errorMessage);
          }
          else {
            getAgenda(restAPI, rootRef, userRef);
            Promise.allSettled(agenda)
            .then(results => {
              doAgenda(restAPI, results, userRef);
              serveReport(userName, rootRef, response);
            }, error => err(error, 'getting settlements'));
          }
        },
        error => err(error, 'getting reference to user')
      );
    }
  });
};

// ########## SERVER

const server = http.createServer(requestHandler);
const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server listening at localhost:${port}.`);
});
