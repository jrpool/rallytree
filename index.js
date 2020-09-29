/*
  index.js
  RallyTree script.

  This script serves a web page with a form for submission of a RallyTree request to make the user the owner of all work items in a tree. When a request is submitted, the script fulfills and acknowledges it.
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

// ########## FUNCTIONS

// Creates and logs an error message.
const err = (error, context) => {
  errorMessage = `Error ${context}: ${error.message}`;
  console.log(errorMessage);
};
// Shortens a long reference.
const shorten = (type, longRef) => longRef.replace(
  /^http.+([/]|%2F)/, `/${type}/`
);
// Recursively processes a user story and its child user stories.
const doStory = (restAPI, storyRef, userRef) => {
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
      // Make the user the owner of the user story, if not already.
      if (ownerRef !== userRef) {
        restAPI.update({
          ref: storyRef,
          data: {Owner: userRef}
        });
      }
      // If the user story has any tasks:
      if (tasksSummary.Count) {
        // Get their data.
        restAPI.get({
          ref: tasksSummary._ref,
          fetch: ['_ref', 'Owner']
        })
        .then(
          // Make the user the owner of each, if not already.
          tasksObj => {
            const tasks = tasksObj.Object.Results;
            tasks.forEach(taskObj => {
              const taskRef = shorten('task', taskObj._ref);
              const taskOwner = taskObj.Owner;
              const ownerRef = taskOwner ? shorten('user', taskOwner._ref) : '';
              if (ownerRef !== userRef) {
                restAPI.update({
                  ref: taskRef,
                  data: {Owner: userRef}
                });
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
              const childRef = shorten('hierarchicalrequirement', child._ref);
              doStory(restAPI, childRef, userRef);
            });
          },
          error => err(error, 'getting data on children')
        );
      }
      return '';
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
      err(error, 'reading error page');
    }
  );
};
// Serves the acknowledgement page.
const serveAck = (userName, rootRef, response) => {
  fs.readFile('ack.html', 'utf8')
  .then(
    content => {
      const newContent = content.replace('[[userName]]', userName)
      .replace('[[rootRef]]', rootRef);
      response.setHeader('Content-Type', 'text/html');
      response.write(newContent);
      response.end();
    },
    error => err(error, 'reading result page')
  );
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
    if (method === 'GET') {
      // Serve the stylesheet when the home page requests it.
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
        // Serve the home page.
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
            doStory(restAPI, rootRef, userRef);
            serveAck(userName, rootRef, response);
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
  console.log(`Use a web browser to visit localhost:${port}.`);
});
