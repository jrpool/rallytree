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
const { timeStamp } = require('console');
// const { count } = require('console');
// Module to create a web server.
const http = require('http');
// const { resolve } = require('path');
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
let rootRef = '';
let total = 0;
let changes = 0;
let busy = false;

// ########## FUNCTIONS

// Creates and logs an error message.
const err = (error, context) => {
  errorMessage = `Error ${context}: ${error.message}`;
  userRef = '';
  rootRef = '';
  total = 0;
  busy = false;
  return '';
};
// Shortens a long reference.
const shorten = (type, longRef) => {
  const num = longRef.replace(/^http.+([/]|%2F)/, '');
  if (/^\d+$/.test(num)) {
    return `/${type}/${num}`;
  }
  else {
    errorMessage = 'Invalid Rally URL';
    return '';
  }
};
// Recursively processes a user story and its child user stories.
const doStory = (restAPI, storyRef, userRef, response) => {
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
      const upTotal = isChange => {
        total++;
        if (isChange) {
          changes++;
        }
        const msg = `total: ${total}\nchanges: ${changes}\n\n`;
        console.log(`Sending message ${msg}`);
        response.write(msg);
      };
      // Make the user the owner of the user story, if not already.
      if (ownerRef !== userRef) {
        restAPI.update({
          ref: storyRef,
          data: {Owner: userRef}
        });
        upTotal(true);
      }
      else {
        upTotal(false);
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
                upTotal(true);
              }
              else {
                upTotal(false);
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
              doStory(restAPI, childRef, userRef, response);
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
// Serves the acknowledgement page.
const serveAck = (userName, userRef, rootRef, response) => {
  fs.readFile('ack.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('script.js', 'utf8')
      .then(
        jsContent => {
          const newContent = htmlContent
          .replace('__script__', jsContent)
          .replace('__userName__', userName)
          .replace('__userRef__', userRef)
          .replace('__rootRef__', rootRef);
          response.setHeader('Content-Type', 'text/html');
          response.write(newContent);
          response.end();
        },
        error => err(error, 'reading script')
      );
    },
    error => err(error, 'reading acknowledgement page')
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
    const requestURL = request.url;
    if (method === 'GET') {
      if (requestURL === '/') {
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
      else if (requestURL === '/style.css') {
        // Serve the stylesheet when the home page requests it.
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
      else if (requestURL === '/totals' && busy) {
        response.setHeader('Content-Type', 'text/event-stream');
        response.setHeader('Cache-Control', 'no-cache');
        response.setHeader('Connection', 'keep-alive');
        doStory(restAPI, rootRef, userRef, response);
        setTimeout(() => {
          busy = false;
          response.end();
          total = 0;
        }, 5000);
      }
    }
    else if (method === 'POST' && requestURL === '/') {
      busy = true;
      const bodyObject = parse(Buffer.concat(body).toString());
      const userName = bodyObject.userName;
      rootRef = shorten(
        'hierarchicalrequirement', bodyObject.rootURL
      );
      if (rootRef) {
        restAPI = rally({
          user: userName,
          pass: bodyObject.password,
          requestOptions
        });
        getUserRef(restAPI, userName)
        .then(
          ref => {
            if (errorMessage) {
              serveError(response);
            }
            else {
              userRef = ref;
              serveAck(userName, userRef, rootRef, response);
            }
          },
          error => err(error, 'getting reference to user')
        );
      }
      else {
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
