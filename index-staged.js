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

const itemRefs = [];
const itemResults = [];
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

// Gets references to the descendant user stories of a user story.
const getDescendantsOf = (restAPI, storyRef, rootRef) => {
  if (errorMessage) {
    return '';
  }
  else {
    return restAPI.get({
      ref: `${storyRef}/Children`,
      fetch: ['_ref']
    })
    .then(
      childrenRef => {
        const childRefs = childrenRef.Object.Results.map(
          result => result._ref.replace(/^.+v2\.0/, '')
        );
        console.log(`storyRef is ${storyRef};`);
        console.log(`rootRef is ${rootRef};`);
        console.log(`childRefs length is ${childRefs.length}`);
        if (childRefs.length) {
          itemRefs.push(...childRefs);
          childRefs.forEach(childRef => {
            return getDescendantsOf(restAPI, childRef, rootRef);
          });
        }
        else if (storyRef === rootRef) {
          console.log(`getDescendantsOf will return ${itemRefs.length}`);
          return itemRefs.length;
        }
        else {
          return '';
        }
      },
      error => {
        errorMessage = `Error getting children: ${error.message}.`;
        return '';
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
        return owner ? owner._ref : '';
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
// Makes a user the owner of a user story and its descendants.
const setItemsOwner = (restAPI, userRef, itemCount, next) => {
  if (errorMessage) {
    return '';
  }
  else {
    console.log('mark 0');
    itemRefs.forEach(itemRef => {
      if (errorMessage) {
        return '';
      }
      else {
        console.log('mark 1');
        return getOwnerOf(restAPI, itemRef)
        .then(
          ownerRef => {
            if (ownerRef === userRef) {
              console.log('mark 2');
              itemResults.push(Promise.resolve(false));
            }
            else {
              console.log('mark 3');
              setOwnerOf(restAPI, itemRef, userRef);
              itemResults.push(Promise.resolve(true));
            }
            console.log(
              `${itemCount} items, ${itemResults.length} results`
            );
            if (itemResults.length === itemCount) {
              console.log('mark 4');
              next();
            }
          },
          error => {
            console.log('mark 5');
            errorMessage = `Error getting owner: ${error.message}`;
            return '';
          }
        );
      }
    });
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
      const userRef = user.Results[0]._ref;
      return userRef;
    },
    error => {
      errorMessage = `Error getting user: ${error.message}`;
      return '';
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
      const restAPI = rally({
        user: userName,
        pass: bodyObject.password,
        requestOptions
      });
      getUser(restAPI, userName)
      .then(
        userRef => {
          if (errorMessage) {
            serveError(response, errorMessage);
          }
          else {
            const rootRef = bodyObject.rootURL.replace(
              /^.+([/]|%2F)/, '/hierarchicalrequirement/'
            );
            getDescendantsOf(restAPI, rootRef, rootRef)
            .then(
              itemCount => {
                console.log(`itemCount type is ${typeof itemCount}`);
                if (errorMessage) {
                  serveError(response, errorMessage);
                }
                else {
                  setItemsOwner(restAPI, userRef, itemCount, () => {
                    if (errorMessage) {
                      serveError(response, errorMessage);
                    }
                    else {
                      const changeCount = itemResults.filter(
                        result => result
                      ).length;
                      const alreadyCount = itemCount - changeCount;
                      if (itemResults.length !== itemCount) {
                        if (! errorMessage) {
                          errorMessage
                            = 'Error: Not all tree items processed.';
                        }
                        serveError(response, errorMessage);
                      }
                      else {
                        fs.readFile('result.html', 'utf8')
                        .then(
                          content => {
                            const newContent = content.replace(
                              '[[userName]]', bodyObject.userName
                            )
                            .replace('[[rootRef]]', rootRef)
                            .replace('[[itemCount]]', itemCount)
                            .replace('[[alreadyCount]]', alreadyCount)
                            .replace('[[changeCount]]', changeCount);
                            // Reset the items and results.
                            itemRefs.length = itemResults.length = 0;
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
                      }
                    }
                  })
                }
              },
              error => {
                console.log(`Error getting descendants: ${error.message}`);
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
