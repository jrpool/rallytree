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

// User’s Rally user name and password.
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
// Subtree results.
const subtreeResults = [];

// ########## FUNCTIONS

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
// Gets a reference to the owner of a user story.
const getOwnerOf = (restAPI, storyRef) => {
  if (errorMessage) {
    return Promise.resolve('');
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
        errorMessage = `Error getting user story’s owner: ${
          error.message
        }.`;
        return '';
      }
    );
  }
};
// Makes a user the owner of a user story.
const setOwnerOf = (restAPI, storyRef, ownerRef, userRef) => {
  if (ownerRef === userRef) {
    // Increment the count of items already owned.
    counts.already++;
    console.log(`Already count has become ${counts.already}`);
    return Promise.resolve(counts.already);
  }
  else {
    return restAPI.update({
      ref: storyRef,
      data: {Owner: userRef}
    })
    .then(
      () => {
        // Increment the count of ownership changes.
        counts.change++;
        console.log(`Change count has become ${counts.change}`);
        return counts.change;
      },
      error => {
        errorMessage = `Error setting owner: ${error.message}`;
        return '';
      }
    );
  }
};
// Gets references to the child user stories of a user story.
const getChildrenOf = (restAPI, storyRef) => {
  if (errorMessage) {
    return Promise.resolve('');
  }
  else {
    return restAPI.get({
      ref: `${storyRef}/Children`,
      fetch: ['_ref']
    })
    .then(
      childrenRef => {
        const childRefs = childrenRef.Object.Results.map(
          result => result._ref
        );
        return childRefs;
      },
      error => {
        errorMessage = `Error getting children: ${error.message}.`;
        return '';
      }
    );
  }
};
// Makes a user the owner of the (sub)tree rooted at a user story.
const setOwnerOfTreeOf = (restAPI, userRef, storyRef) => {
  if (errorMessage) {
    return Promise.resolve('');
  }
  else {
    return getOwnerOf(restAPI, storyRef)
    .then(
      ownerRef => {
        if (errorMessage) {
          return '';
        }
        else {
          return setOwnerOf(restAPI, storyRef, ownerRef, userRef)
          .then(count => {
            if (errorMessage) {
              return Promise.resolve('');
            }
            else {
              return getChildrenOf(restAPI, storyRef)
              .then(childRefs => {
                if (errorMessage) {
                  return Promise.resolve('');
                }
                else {
                  // Increment the count of found items.
                  counts.item += childRefs.length;
                  console.log(
                    `Item count has jumped to ${counts.item}`
                  );
                  childRefs.forEach(childRef => {
                    subtreeResults.push(
                      setOwnerOfTreeOf(restAPI, userRef, childRef)
                    );
                  });
                  return count;
                }
              });
            }
          });
        }
      }
    );
  }
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
            setOwnerOfTreeOf(restAPI, userRef, rootRef)
            .then(
              () => {
                if (errorMessage) {
                  serveError(response, errorMessage);
                }
                else {
                  // Increment item count by 1 for root.
                  counts.item++;
                  // Await completion of all executions of setOwnerOfTreeOf.
                  Promise.all(subtreeResults)
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
