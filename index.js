/*
  index.js
  RallyTree script.
  This script serves a web page with a form for submission of a RallyTree
  request. When a request is submitted, the script processes it and
  reports the results on another web page.
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
let rootRef = '';
// Records of completion.
const done = [];

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

// Gets a reference to a user.
const getUserRef = (restAPI, userName) => {
  return restAPI.query({
    type: 'user',
    query: queryUtils.where('UserName', '=', userName)
  })
  .then(
    user => user.Results[0]._ref,
    error => err(error, 'getting user')
  );
};
// Gets data about the owner, children, and tasks of a user story.
const getDataOf = (restAPI, storyRef) => {
  if (errorMessage) {
    return Promise.reject('');
  }
  else {
    return restAPI.get({
      ref: storyRef,
      fetch: ['Owner', 'Children', 'Tasks']
    })
    .catch(error => err(error, 'getting user story’s data'));
  }
};
// Makes a user the owner of a work item.
const setOwnerOf = (restAPI, type, itemRef, ownerRef, userRef) => {
  if (! errorMessage) {
    if (shorten(type, ownerRef) === userRef) {
      counts.already++;
    }
    else {
      restAPI.update({
        ref: itemRef,
        data: {Owner: userRef}
      })
      .then(
        () => ++counts.change,
        error => err(error, 'setting owner')
      );
    }
  }
};
// Makes a user the owner of the (sub)tree rooted at a user story.
const setOwnerOfTreeOf = (restAPI, storyRef, userRef) => {
  return errorMessage ||
  getDataOf(restAPI, storyRef)
  .then(
    resultObj => {
      if (! errorMessage) {
        setOwnerOf(
          restAPI,
          'hierarchicalrequirement',
          storyRef,
          resultObj.ownerRef,
          userRef
        );
        const storyObj = resultObj.Object;
        const taskCount = storyObj.Tasks.Count;
        if (taskCount) {
          counts.item += taskCount;
          restAPI.get({
            ref: storyObj.Tasks._ref,
            fetch: ['_ref', 'Owner']
          })
          .then(
            tasksObj => {
              const tasks = tasksObj.Object.Results;
              tasks.forEach(task => {
                setOwnerOf(
                  restAPI, 'task', task._ref, task.Owner._ref, userRef
                );
                done.push('');
              });
            },
            error => err(error, 'getting data of tasks')
          );
        }
        const childCount = storyObj.Children.count;
        if (childCount) {
          counts.item += childCount;
          restAPI.get({
            ref: storyObj.Children._ref,
            fetch: ['_ref', 'Owner']
          })
          .then(
            children => {
              children.forEach(child => {
                const childObj = child.Object;
                const childRef = childObj._ref;
                const childOwnerRef = childObj.Owner._ref;
                setOwnerOf(
                  restAPI,
                  'hierarchicalrequirement',
                  childRef,
                  childOwnerRef,
                  userRef
                );
                setOwnerOfTreeOf(restAPI, childRef, childOwnerRef, userRef);
              });
            },
            error => err(error, 'getting children of user story')
          );
        }
        done.push('');
        if (storyRef === rootRef) {
          return '';
        }
      }
    },
    error => err(error, `getting data of ${storyRef}`)
  );
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
      console.log(
        `Error reading error page: ${error.message}`
      );
    }
  );
};
// Handles requests.
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
            rootRef = bodyObject.rootURL.replace(
              /^.+([/]|%2F)/, '/hierarchicalrequirement/'
            );
            counts.item++;
            setOwnerOfTreeOf(restAPI, rootRef, userRef)
            .then(
              () => {
                if (errorMessage) {
                  serveError(response, errorMessage);
                }
                else {
                  // Await completion of all executions of setOwnerOfTreeOf.
                  Promise.all(done)
                  .then(
                    () => {
                      fs.readFile('result.html', 'utf8')
                      .then(
                        content => {
                          console.log(
                            `Item count ends at ${counts.item}`
                          );
                          console.log(
                            `Already count ends at ${
                              counts.already
                            }`
                          );
                          console.log(
                            `Change count ends at ${counts.change}`
                          );
                          const newContent = content.replace(
                            '[[userName]]', bodyObject.userName
                          )
                          .replace(
                            '[[rootRef]]', rootRef
                          )
                          .replace(
                            '[[itemCount]]', counts.item
                          )
                          .replace(
                            '[[alreadyCount]]', counts.already
                          )
                          .replace(
                            '[[changeCount]]', counts.change
                          );
                          // Reset the counts.
                          counts.item = counts.already = counts.change = 0;
                          response.setHeader(
                            'Content-Type', 'text/html'
                          );
                          response.write(newContent);
                          response.end();
                        },
                        error => {
                          console.log(
                            `Error reading result page: ${
                              error.message
                            }`
                          );
                        }
                      );
                    },
                    error => {
                      console.log(`Error resolving promises: ${error.message}`);
                    }
                  );
                }
              },
              error => {
                console.log(
                  `Error changing owner: ${error.message}`
                );
              }
            );
          }
        },
        error => {
          console.log(`Error getting user: ${error.message}`);
        }
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
