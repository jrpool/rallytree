// Import the module to access files.
const fs = require('fs').promises;
// Import the module to keep secrets local.
require('dotenv').config();
// Import the module to create a web server.
const http = require('http');
// Function to handle requests.
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
        const bodyString = Buffer.concat(body).toString();
        request.setHeader('Content-Type', 'text/html');
        if (method === 'get') {
            fs.readFile('index.html', 'utf8')
            .then(content => {
                response.write(content);
                response.end();
            })
        }
        else {
            response.write(
                `<html lang="en-US">
                <title>
                Response
                </title>
                <body>
                <p>Not a GET request.</p>
                </body>
                </html>`
            );
            response.end();
        }
    });
};
// Create the server.
const server = http.createServer(requestHandler);
// Configure the server.
const port = process.env.PORT;
// Start the server.
server.listen(port, () => {
    console.log(`Server listening at localhost:${port}.`);
});
const myName = process.env.RALLY_USERNAME;
console.log(`The .env file says I am ${myName}`);
// Import the Rally module.
const rally = require('rally');
const queryUtils = rally.util.query;
// Temporary initialization of the root of the tree.
const mainRootOID = '435404235956';
const mainRootRef = `/HierarchicalRequirement/${mainRootOID}`;
// Initialize the request options.
const requestOptions = {
    headers: {
        'X-RallyIntegrationName': process.env.RALLYINTEGRATIONNAME,
        'X-RallyIntegrationVendor': process.env.RALLYINTEGRATIONVENDOR,
        'X-RallyIntegrationVersion': process.env.RALLYINTEGRATIONVERSION
    }
};
/*
    Create a Rally REST API instance, using the .env user and pw
    (and not an API key).
*/
const restAPI = rally({
    requestOptions
});
// Function to return my ref.
const getMe = () => {
    return restAPI.query({
        type: 'user',
        query: queryUtils.where('UserName', '=', myName)
    })
    .then(
        me => {
            const myRef = me.Results[0]._ref;
            console.log(`My ref is ${myRef}.`);
            return myRef;
        },
        error => {
            console.log(error.message);
        }
    );
};
/*
    Function to return a reference to the owner of the specified
    user story.
*/
const getOwnerOf = storyRef => {
    return restAPI.get({
        ref: storyRef,
        fetch: ['Owner']
    })
    .then(
        result => {
            const owner = result.Object.Owner;
            if (owner) {
                const ownerRef = owner._ref;
                console.log(`The owner of\n${storyRef}\nis ${ownerRef}.`);
                return ownerRef;
            }
            else {
                console.log(`${storyRef} has no owner.`);
                return '';
            }
        },
        error => {
            console.log(`Error getting user story’s owner: ${error.message}.`);
        }
    );
};
/*
    Function to make the specified user the owner of the specified
    user story.
*/
const setOwnerOf = (userRef, storyRef) => {
    restAPI.update({
        ref: storyRef,
        data: {Owner: userRef}
    });
    console.log(`Changing owner of\n${storyRef}\nto\n${userRef}.`);
};
/*
    Function to return references to the child user stories of
    the specified user story.
*/
const getChildrenOf = storyRef => {
    return restAPI.get({
        ref: `${storyRef}/Children`,
        fetch: ['_ref']
    })
    .then(
        childrenRef => {
            const childRefs = childrenRef.Object.Results.map(
                result => result._ref
            );
            console.log(
                `Children of\n${storyRef}\nare:\n${
                    JSON.stringify(childRefs, null, 2)
                }`
            );
            return childRefs;
        },
        error => {
            console.log(`Error getting children: ${error.message}.`);
        }
    );
};
/*
    Function to make the specified user the owner of the (sub)tree
    rooted at the specified user story.
*/
const setOwnerOfTreeOf = (userRef, storyRef) => {
    getOwnerOf(storyRef)
    .then(
        ownerRef => {
            if (ownerRef !== userRef) {
                setOwnerOf(userRef, storyRef);
            }
            else {
                console.log(`I already own\n${storyRef}.`);
            }
            getChildrenOf(storyRef)
            .then(
                children => {
                    children.forEach(childRef => {
                        setOwnerOfTreeOf(userRef, childRef);
                    })
                },
                error => {
                    throw `Error setting owner of children: ${error.message}.`;
                }
            )
        },
        error => {
            console.log(`Error getting root owner: ${error.message}.`);
        }
    )
};
// Make me the owner of the tree of the specified user story.
// setOwnerOfTreeOf(myRef, mainRootRef);
// getOwnerOf(mainRootShortRef);
/*
getMe()
.then(me => {
    setOwnerOfTreeOf(me, mainRootRef)
});
*/
/*

// Function to get a reference to a named user.
const getUserRef = userName => {
    return restAPI.query({
        type: 'user',
        query: queryUtils.where('UserName', '=', userName)
    })
    .then(
        user => user.Results[0]._ref,
        error => {
            throw `Error getting user reference: ${error.message}.`;
        }
    );
};

/*
    Function to make the specified user the owner of the (sub)tree rooted
    at the specified user story.

const ownTreeOf = (rootOID, userRef) => {
    console.log(`(Sub)tree root is ${rootOID}.`);
    const rootRef = `/hierarchicalrequirement/${rootOID}`;
    /*
        Function to make the specified user the owner of the members
        of the specified collection of children.
    
    restAPI.get({
        ref: rootRef,
        fetch: ['Owner', 'Children']
    })
    .then(
        root=> {
            const rootObject = root.Object;
            const oldOwner = rootObject.Owner;
            const oldOwnerName = oldOwner._refObjectName;
            const oldOwnerRef = oldOwner._ref;
            console.log(`Old owner ref is ${oldOwnerRef}.`);
            if (oldOwnerRef.endsWith(myRef)) {
                console.log(`I already own ${rootOID}`);
            }
            else {
                console.log(
                    `Owner of ${rootOID} will change from ${oldOwnerName} to me.`
                );
                restAPI.update({
                    ref: rootRef,
                    data: {
                        Owner: myRef
                    }
                })
                .then(
                    result => {
                        console.log(`I have become owner of ${rootOID}.`);
                        const childrenMeta = rootObject.Children;
                        const childrenRef = childrenMeta._ref;
                    },
                    error => {
                        console.log(`Error changing ${rootOID} owner: ${error.message}`);
                    }
                )
            }
        },
        error => {
            console.log(`Error getting ${rootOID} owner: ${error.message}`);
        }
    )
};
// Make me the owner of the whole tree rooted at the specified user story.
restAPI.query({
    type: 'user',
    query: queryUtils.where('UserName', '=', process.env.RALLY_USERNAME)
})
.then(
    me => {
        const myOID = me.Results[0]._ref.replace(/^.+[/]/, '');
        const myRef = `/user/${myOID}`;
        console.log(`myRef is ${myRef}.`);
        ownTreeOf(mainRootOID, myRef);
    },
    error => {
        console.log(`Error getting me: ${error.message}`);
    }
);
/*
const myRef = '/user';
const qs = {
    query: `(UserName = ${process.env.RALLY_USERNAME})`
};
console.log(`My ref is ${myRef}`);
// const refUtils = rally.util.ref;
restAPI.get({
    ref: myRef,
    fetch: [],
    requestOptions: {
        qs
    }
})
.then(
    me => {console.log(JSON.stringify(me, null, 2))},
    error => {console.log(error.message)}
);
const rootRef = '/HierarchicalRequirement/411765582904';
const authorizedRef = `${rootRef}?key=${process.env.rallyKey}`;
console.log(`Root user-story ref: ${rootRef}`);
.then(me => {
    console.log(`My Object ID is ${JSON.stringify(me.Object, null, 2)}`);
    restAPI.get({
        ref: rootRef,
        fetch: ['DirectChildrenCount', 'Owner'],
        requestOptions
    })
    .then(rootStory => {
        const owner = rootStory.Object.Owner;
        const ownerName = owner.DisplayName;
        console.log(`Current owner: ${owner._refObjectName}`);
        console.log(`Count of its children: ${rootStory.Object.DirectChildrenCount}`);
    },
    error => {
        console.log(error.message);
    })
});
*/
