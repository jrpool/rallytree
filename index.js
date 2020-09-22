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
let userNameX = process.env.RALLY_USERNAME;
let passwordX = process.env.RALLY_PASSWORD;
// Counts.
let itemCount = alreadyCount = changeCount = 0;
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
    console.log(storyRef);
    if (errorMessage) {
        return Promise.resolve('');
    }
    else {
        console.log(`storyRef is ${storyRef}`);
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
const setOwnerOf = (restAPI, userRef, storyRef) => {
    if (! errorMessage) {
        restAPI.update({
            ref: storyRef,
            data: {Owner: userRef}
        });
        // Increment the count of owner changes.
        changeCount++;
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
                // Increment the count of found items.
                itemCount += childRefs.length;
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
                else if (ownerRef !== userRef) {
                    setOwnerOf(restAPI, userRef, storyRef);
                }
                else {
                    alreadyCount++;
                }
                return getChildrenOf(restAPI, storyRef)
                .then(
                    children => {
                        if (! errorMessage) {
                            children.forEach(childRef => {
                                setOwnerOfTreeOf(restAPI, userRef, childRef);
                            });
                        }
                        return '';
                    },
                    error => {
                        errorMessage = `Error setting owner of children: ${
                            error.message
                        }.`;
                        return '';
                    }
                )
            },
            error => {
                errorMessage = `Error getting root owner: ${error.message}.`;
            }
        )
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
    const {headers, method} = request;
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
                                    fs.readFile('result.html', 'utf8')
                                    .then(
                                        content => {
                                            const newContent = content.replace(
                                                '[[userName]]', bodyObject.userName
                                            )
                                            .replace(
                                                '[[rootURL]]', bodyObject.rootURL
                                            )
                                            .replace(
                                                '[[itemCount]]', itemCount
                                            )
                                            .replace(
                                                '[[alreadyCount]]', alreadyCount
                                            )
                                            .replace(
                                                '[[changeCount]]', changeCount
                                            );
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
