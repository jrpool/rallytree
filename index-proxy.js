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

const newItemRefs = new Set();
const doneItemRefs = [];
let alreadyCount = 0;
let changeCount = 0;
let errorMessage = '';
let restAPI;
let userRef = '';
const queryUtils = rally.util.query;
// REST API.
const requestOptions = {
  headers: {
    'X-RallyIntegrationName': process.env.RALLYINTEGRATIONNAME || 'RallyTree',
    'X-RallyIntegrationVendor': process.env.RALLYINTEGRATIONVENDOR || '',
    'X-RallyIntegrationVersion': process.env.RALLYINTEGRATIONVERSION || '1.0'
  }
};
let tempRootRef = '';
let tempBodyObject = {};
let tempResponse;
let tempStarted = false;

// ########## FUNCTIONS

// Reduces a full reference to a relative reference.
const reduceRef = fullRef => fullRef.replace(/^.+v2\.0/, '');
/*
  Gets references to the child user stories of a user story,
  adds them to the set of new item references, and moves the
  parent to the array of processed items.
*/
const addChildrenOf = (restAPI, parentRef) => {
  if (! errorMessage) {
    restAPI.get({
      ref: `${parentRef}/Children`,
      fetch: ['_ref']
    })
    .then(
      childrenRef => {
        childrenRef.Object.Results.map(
          result => reduceRef(result._ref)
        ).forEach(ref => {
          console.log(`Adding child ${ref}`);
          newItemRefs.add(ref);
        });
      },
      error => {
        errorMessage = `Error adding children: ${error.message}`;
      }
    )
    .then(
      () => {
        console.log(`Moving parent ${parentRef}`);
        moveItem(parentRef);
      },
      error => {
        errorMessage = `Error adding children: ${error.message}`;
      }
    );
  }
};
// Gets a reference to the owner of a user story.
const getOwnerOf = (restAPI, storyRef) => {
  if (errorMessage) {
    return;
  }
  else {
    return restAPI.get({
      ref: storyRef,
      fetch: ['Owner']
    })
    .then(
      result => {
        const owner = result.Object.Owner;
        return owner ? reduceRef(owner._ref) : '';
      },
      error => {
        errorMessage = `Error getting user story’s owner: ${error.message}.`;
        return '';
      }
    );
  }
};
// Makes a user the owner of a user story.
const setOwnerOf = (restAPI, storyRef, userRef) => {
  restAPI.update({
    ref: storyRef,
    data: {Owner: userRef}
  })
  .catch(
    error => {
      errorMessage = `Error setting owner: ${error.message}`;
    }
  );
};
/*
  Moves an item from the set of new items to the array of
  processed items.
*/
const moveItem = storyRef => {
  doneItemRefs.push(storyRef);
  newItemRefs.delete(storyRef);
};
// Processes the first new item.
const processFirstItem = (restAPI, userRef) => {
  if (errorMessage) {
    return;
  }
  else {
    const newItems = newItemRefs.values();
    if (newItems.length) {
      const firstNewItem = newItems[0];
      getOwnerOf(firstNewItem)
      .then(
        ownerRef => {
          if (ownerRef !== userRef) {
            setOwnerOf(restAPI, firstNewItem, userRef);
            changeCount++;
          }
          else {
            alreadyCount++;
          }
          addChildrenOf(restAPI, firstNewItem);
          // Temporary substitute for proxy.
          setTimeout(() => {
            moveItem(firstNewItem);
          }, 2000);
        },
        error => {
          errorMessage = `Error getting item owner: ${error.message}`;
        }
      );
    }
  }
};
// Gets a reference to a user.
const getUser = (restAPI, userName) => {
  return restAPI.query({
    type: 'user',
    query: queryUtils.where('UserName', '=', userName)
  })
  .then(
    user => {
      const userRef = reduceRef(user.Results[0]._ref);
      return userRef;
    },
    error => {
      errorMessage = `Error getting user: ${error.message}`;
      return '';
    }
  );
};
// Serves the report page.
const serveReport = (rootRef, bodyObject, response) => {
  fs.readFile('result.html', 'utf8')
  .then(
    content => {
      const itemCount = doneItemRefs.length;
      const newContent = content.replace(
        '[[userName]]', bodyObject.userName
      )
      .replace('[[rootRef]]', rootRef)
      .replace('[[itemCount]]', itemCount)
      .replace('[[alreadyCount]]', alreadyCount)
      .replace('[[changeCount]]', changeCount);
      // Reset the items and results.
      newItemRefs.length = doneItemRefs.length = 0;
      response.setHeader(
        'Content-Type', 'text/html'
      );
      response.write(newContent);
      response.end();
    },
    error => {
      console.log(`Error reading result page: ${error.message}`);
    }
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
      restAPI = rally({
        user: userName,
        pass: bodyObject.password,
        requestOptions
      });
      getUser(restAPI, userName)
      .then(
        ref => {
          if (errorMessage) {
            serveError(response, errorMessage);
          }
          else {
            userRef = ref;
            const rootRef = bodyObject.rootURL.replace(
              /^.+([/]|%2F)/, '/hierarchicalrequirement/'
            );
            newItemRefs.add(rootRef);
            processFirstItem(restAPI, userRef);
            tempStarted = true;
            tempRootRef = rootRef;
            tempBodyObject = bodyObject;
            tempResponse = response;
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

/*
  Listens for the addition of done items (temporary substitute
  for proxy).
*/
let lastDoneCount = 0;
setInterval(() => {
  if (tempStarted) {
    if (doneItemRefs.length > lastDoneCount) {
      lastDoneCount = doneItemRefs.length;
      processFirstItem();
    }
    else {
      clearInterval();
    }
  }
}, 3000);
serveReport(tempRootRef, tempBodyObject, tempResponse);
