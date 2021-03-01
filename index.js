/*
  index.js
  RallyTree main script.
*/

// ########## IMPORTS

// Module to access files.
const fs = require('fs').promises;
// Module to open files or URLs.
const open = require('open');
// Module to keep secrets local.
require('dotenv').config();
// Module to specify custom test-case creation.
let caseData;
try {
  caseData = require('./data/caseData').caseData;
}
catch (error) {
  caseData = {};
}
// Module to create a web server.
const http = require('http');
// Module to make HTTPS requests.
const https = require('https');
// Module to parse request bodies.
const {parse} = require('querystring');
// Rally module.
const rally = require('rally');

// ########## GLOBAL CONSTANTS

// Time in ms to wait before guessing that documentation is complete.
const docWait = 1500;
const queryUtils = rally.util.query;
// REST API.
const requestOptions = {
  headers: {
    'X-RallyIntegrationName':
    process.env.RALLYINTEGRATIONNAME || 'RallyTree',
    'X-RallyIntegrationVendor':
    process.env.RALLYINTEGRATIONVENDOR || '',
    'X-RallyIntegrationVersion':
    process.env.RALLYINTEGRATIONVERSION || '1.8.1'
  }
};
const scorePriorities = ['None', 'Useful', 'Important', 'Critical'];
const scoreRisks = ['None', 'Low', 'Medium', 'High'];
const totalInit = {
  caseChanges: 0,
  caseTotal: 0,
  changes: 0,
  defects: 0,
  denominator: 0,
  fails: 0,
  folderChanges: 0,
  folderTotal: 0,
  iterationChanges: 0,
  major: 0,
  minor: 0,
  numerator: 0,
  passes: 0,
  projectChanges: 0,
  releaseChanges: 0,
  score: 0,
  scoreVerdicts: 0,
  setChanges: 0,
  setTotal: 0,
  storyChanges: 0,
  storyTotal: 0,
  taskChanges: 0,
  taskTotal: 0,
  total: 0,
  verdicts: 0
};
const totals = Object.assign({}, totalInit);
const globalInit = {
  caseFolderRef: '',
  caseProjectRef: '',
  caseSetRef: '',
  caseTarget: 'all',
  copyIterationRef: '',
  copyOwnerRef: '',
  copyParentRef: '',
  copyParentType: 'hierarchicalrequirement',
  copyProjectRef: '',
  copyReleaseRef: '',
  copyWhat: 'both',
  doc: [],
  docTimeout: 0,
  groupFolderRef: '',
  groupSetRef: '',
  idle: false,
  isError: false,
  passBuild: '',
  passNote: '',
  planHow: 'use',
  projectIterationRef: null,
  projectRef: '',
  projectReleaseRef: null,
  reportServed: false,
  restAPI: {},
  rootRef: '',
  scoreWeights: {
    risk: {},
    priority: {}
  },
  state: {
    story: '',
    task: ''
  },
  takeWhoRef: '',
  taskNames: [],
  userName: '',
  userRef: ''
};
const globals = Object.assign({}, globalInit);

// ########## GLOBAL VARIABLES

let {RALLY_USERNAME, RALLY_PASSWORD} = process.env;
RALLY_USERNAME = RALLY_USERNAME || '';
RALLY_PASSWORD = RALLY_PASSWORD || '';
let response = {};

// ########## FUNCTIONS

// ==== OPERATION UTILITIES ====
// Reinitializes the global variables, except response.
const reinit = () => {
  Object.assign(totals, totalInit);
  Object.assign(globals, globalInit);
};
// Processes a thrown error.
const err = (error, context) => {
  let problem = error;
  // If error is system-defined, convert newlines.
  if (typeof error !== 'string') {
    // Reduce it to a string.
    problem = error.message.replace(
      /^.+<title>|^.+<Errors>|<\/title>.+$|<\/Errors>.+$/gs, ''
    );
  }
  const msg = `Error ${context}: ${problem}`;
  console.log(msg);
  globals.isError = true;
  const pageMsg = msg.replace(/\n/g, '<br>');
  // If a report page has been served:
  if (globals.reportServed) {
    // Insert the error message there.
    response.write(
      `event: error\ndata: ${pageMsg}\n\n`
    );
    response.end();
  }
  // Otherwise:
  else {
    // Serve an error page containing the error message.
    fs.readFile('error.html', 'utf8')
    .then(
      content => {
        const newContent = content.replace(
          '__errorMessage__', pageMsg
        );
        response.setHeader('Content-Type', 'text/html');
        response.write(newContent);
        response.end();
        reinit();
      },
      error => {
        console.log(`Error reading error page: ${error.message}`);
        reinit();
      }
    );
  }
  return '';
};
// Returns the short form of a reference.
const shorten = (readType, writeType, longRef) => {
  if (longRef) {
    // If it is already a short reference, return it.
    const shortTest = new RegExp(`^/${writeType}/\\d+$`);
    if (shortTest.test(longRef)) {
      return longRef;
    }
    // Otherwise, i.e. if it is not yet a short reference:
    else {
      // Return its short version.
      const longReadPrefix = new RegExp(`^http.+(/|%2F)${readType}(/|%2F)(?=\\d+)`);
      const longWritePrefix = new RegExp(`^http.+(/|%2F)${writeType}(/|%2F)(?=\\d+)`);
      const num
        = Number.parseInt(longRef.replace(longReadPrefix, ''))
        || Number.parseInt(longRef.replace(longWritePrefix, ''));
      if (num) {
        return `/${writeType}/${num}`;
      }
      else {
        err(
          `Invalid Rally URL:\nlong ${longRef}\nshort /${writeType}/${num}`,
          'shortening URL'
        );
        return '';
      }
    }
  }
  else {
    return '';
  }
};
// Returns a Promise of a long reference to a collection member.
const getRef = (type, formattedID, context) => {
  if (formattedID) {
    const numericID = formattedID.replace(/^[A-Za-z]+/, '');
    if (/^\d+$/.test(numericID)) {
      return globals.restAPI.query({
        type,
        fetch: '_ref',
        query: queryUtils.where('FormattedID', '=', numericID)
      })
      .then(
        result => {
          const resultArray = result.Results;
          if (resultArray.length) {
            return resultArray[0]._ref;
          }
          else {
            return err('No such ID', `getting reference to ${type} for ${context}`);
          }
        },
        error => err(error, `getting reference to ${type} for ${context}`)
      );
    }
    else {
      err('Invalid ID', `getting reference to ${type} for ${context}`);
      return Promise.resolve('');
    }
  }
  else {
    return Promise.resolve('');
  }
};
// Returns an event-stream message reporting an incremented total.
const eventMsg = (
  eventName, addCount = 1
) => `event: ${eventName}\ndata: ${totals[eventName] += addCount}\n\n`;
// Sends a sequence of event-stream messages reporting incremented totals.
const report = specs => {
  const msgs = [];
  specs.forEach(spec => {
    msgs.push(eventMsg(...spec));
  });
  response.write(msgs.join(''));
};
// Returns a string with its first character lower-cased.
const lc0Of = string => string.length ? `${string[0].toLowerCase()}${string.slice(1)}` : '';
// Returns a Promise of data on a work item.
const getItemData = (ref, facts, collections) => {
  if (ref) {
    // Get data on the facts and collections of the specified item.
    return globals.restAPI.get({
      ref,
      fetch: facts.concat(collections)
    })
    .then(
      // When the data arrive:
      item => {
        const obj = item.Object;
        // Initialize an object of data, to contain a property for each fact and collection.
        const data = {};
        // Add the fact properties with string values: value if a string or reference if an object.
        facts.forEach(fact => {
          data[lc0Of(fact)] = obj[fact] !== null && typeof obj[fact] === 'object'
            ? obj[fact]._ref
            : obj[fact];
        });
        // Add the collection properties with object values having reference and count properties.
        collections.forEach(collection => {
          data[lc0Of(collection)] = {
            ref: obj[collection]._ref,
            count: obj[collection].Count
          };
        });
        // Return the object.
        return data;
      },
      error => err(error, `getting data on ${ref}`)
    );
  }
  else {
    return Promise.resolve({});
  }
};
// Returns a Promise of data, i.e. an array of member objects, on a collection.
const getCollectionData = (ref, facts, collections) => {
  if (ref) {
    // Get data on the facts and collections of the members of the specified collection.
    return globals.restAPI.get({
      ref,
      fetch: facts.concat(collections)
    })
    .then(
      // When the data arrive:
      collection => {
        const members = collection.Object.Results;
        // Initialize an array of data.
        const data = [];
        // For each member of the collection:
        members.forEach(member => {
          // Initialize an object of member data with property “ref”, a long reference to it.
          const memberData = {
            ref: member._ref
          };
          /*
            Add fact properties to the object. Each has the dromedary-case fact name as its key
            and the fact’s value if a string or a reference to the fact if an object as its value.
          */
          facts.forEach(fact => {
            memberData[lc0Of(fact)] = member[fact] !== null && typeof member[fact] === 'object'
              ? member[fact]._ref
              : member[fact];
          });
          /*
            Add collection properties to the object. Each has the dromedary-case collection name
            as its key and an object with “ref” and “count” properties as its value.
          */
          collections.forEach(collection => {
            memberData[lc0Of(collection)] = {
              ref: member[collection]._ref,
              count: member[collection].Count
            };
          });
          // Add the member object to the array.
          data.push(memberData);
        });
        // Return the array.
        return data;
      },
      error => err(error, `getting data on ${ref}`)
    );
  }
  else {
    return Promise.resolve([]);
  }
};
// ==== REQUEST-PROCESSING UTILITIES ====
// Serves a page.
const servePage = (content, isReport) => {
  response.setHeader('Content-Type', 'text/html');
  response.write(content);
  response.end();
  if (isReport) {
    globals.reportServed = true;
  }
};
// Serves the request page.
const serveDo = () => {
  // Options for a server-identifying erroneous request.
  const options = {
    hostname: 'rally1.rallydev.com',
    port: 443,
    path: '/slm/webservice/v2.0/user/1',
    method: 'GET',
    auth: `${process.env.RALLY_USERNAME}:${process.env.RALLY_PASSWORD}`,
    headers: {
      'X-RallyIntegrationName':
      process.env.RALLYINTEGRATIONNAME || 'RallyTree',
      'X-RallyIntegrationVendor':
      process.env.RALLYINTEGRATIONVENDOR || '',
      'X-RallyIntegrationVersion':
      process.env.RALLYINTEGRATIONVERSION || '1.0.4'
    }
  };
  // Make the request.
  const request = https.request(options, response => {
    const chunks = [];
    response.on('data', chunk => {
      chunks.push(chunk);
    });
    // When the response is complete:
    response.on('end', () => {
      // Get its cookie.
      const cookieHeader = response.headers['set-cookie'];
      const neededCookies = [];
      // If it exists:
      if (cookieHeader.length) {
        // Remove all but the needed ones.
        neededCookies.push(...cookieHeader.filter(
          cookie => cookie.startsWith('JSESSIONID') || cookie.startsWith('SUB')
        ));
      }
      // Insert data into the form on the request page.
      fs.readFile('do.html', 'utf8')
      .then(
        htmlContent => {
          const newContent = htmlContent
          .replace(/__storyPrefix__/g, process.env.storyPrefix || '')
          .replace('__scoreRiskMin__', process.env.scoreRiskMin || '0')
          .replace('__scoreRiskMax__', process.env.scoreRiskMax || '3')
          .replace('__scorePriorityMin__', process.env.scorePriorityMin || '0')
          .replace('__scorePriorityMax__', process.env.scorePriorityMax || '3')
          .replace('__userName__', RALLY_USERNAME)
          .replace('__password__', RALLY_PASSWORD)
          .replace('__cookie__', neededCookies.join('\r\n'));
          // Serve the page.
          servePage(newContent, false);
        },
        error => err(error, 'reading do page')
      );
    });
  });
  request.on('error', error => {
    err(error, 'requesting a server identification');
  });
  request.end();
};
// Interpolates universal content into a report.
const reportPrep = (content, jsContent) => {
  return content
  .replace('__script__', jsContent)
  .replace('__rootRef__', globals.rootRef)
  .replace('__userName__', globals.userName)
  .replace('__userRef__', globals.userRef);
};
// Interpolates operation-specific content into the report script.
const reportScriptPrep = (content, eventSource, events) => {
  return content
  .replace('__eventSource__', eventSource)
  .replace(
    'let __events__', `let __events__ = [${events.map(event => '\'' + event + '\'').join(', ')}]`
  );
};
// Serves the change-project report page.
const serveProjectReport = (projectWhich, projectRelease, projectIteration) => {
  fs.readFile('projectReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(jsContent, '/projecttally', [
            'total',
            'storyTotal',
            'caseTotal',
            'changes',
            'projectChanges',
            'releaseChanges',
            'iterationChanges',
            'error'
          ]);
          const newContent = reportPrep(htmlContent, newJSContent)
          .replace('__projectWhich__', projectWhich)
          .replace('__projectRef__', globals.projectRef)
          .replace('__projectRelease__', projectRelease)
          .replace('__projectIteration__', projectIteration);
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
      );
    },
    error => err(error, 'reading projectReport page')
  );
};
// Serves the schedule-state report page.
const serveScheduleReport = () => {
  fs.readFile('scheduleReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(
            jsContent,
            '/scheduletally',
            ['total', 'changes', 'storyTotal', 'storyChanges', 'taskTotal', 'taskChanges', 'error']
          );
          const newContent = reportPrep(htmlContent, newJSContent)
          .replace('__scheduleState__', globals.state.story);
          servePage(newContent, true);
        },
        error => err(error, 'reading scheduleReport script')
      );
    },
    error => err(error, 'reading scheduleReport page')
  );
};
// Serves the add-tasks report page.
const serveTaskReport = () => {
  fs.readFile('taskReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(
            jsContent, '/tasktally', ['total', 'changes', 'error']
          );
          const taskCount = `${globals.taskNames.length} task${
            globals.taskNames.length > 1 ? 's' : ''
          }`;
          const newContent = reportPrep(htmlContent, newJSContent)
          .replace('__taskCount__', taskCount)
          .replace('__taskNames__', globals.taskNames.join('\n'));
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
      );
    },
    error => err(error, 'reading taskReport page')
  );
};
// Serves the add-test-cases report page.
const serveCaseReport = () => {
  fs.readFile('caseReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(
            jsContent, '/casetally', ['total', 'changes', 'error']
          );
          const newContent = reportPrep(htmlContent, newJSContent);
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
      );
    },
    error => err(error, 'reading caseReport page')
  );
};
// Serves the group-test-case report page.
const serveGroupReport = () => {
  fs.readFile('groupReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(
            jsContent, '/grouptally', ['total', 'changes', 'folderChanges', 'setChanges']
          );
          const newContent = reportPrep(htmlContent, newJSContent);
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
      );
    },
    error => err(error, 'reading groupReport page')
  );
};
// Serves the pass-test-case report page.
const servePassReport = () => {
  fs.readFile('passReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(
            jsContent, '/passtally', ['total', 'changes']
          );
          const newContent = reportPrep(htmlContent, newJSContent);
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
      );
    },
    error => err(error, 'reading passReport page')
  );
};
// Serves the planification report page.
const servePlanReport = () => {
  fs.readFile('planReport.html', 'utf8')
  .then(
    htmlContent => {
      const newHTMLContent = htmlContent.replace(
        '__planHow__', globals.planHow === 'use' ? 'linked to' : 'copied into'
      );
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(
            jsContent, '/plantally', ['planRoot', 'storyChanges', 'caseChanges', 'error']
          );
          const newContent = reportPrep(newHTMLContent, newJSContent);
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
      );
    },
    error => err(error, 'reading planReport page')
  );
};
// Serves the documentation report page.
const serveDocReport = () => {
  fs.readFile('docReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(jsContent, '/doc', ['doc', 'error']);
          const newContent = reportPrep(htmlContent, newJSContent);
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
      );
    },
    error => err(error, 'reading docReport page')
  );
};
// Serves the stylesheet.
const serveStyles = () => {
  fs.readFile('style.css', 'utf8')
  .then(
    content => {
      response.setHeader('Content-Type', 'text/css');
      response.write(content);
      response.end();
    },
    error => err(error, 'reading stylesheet')
  );
};
// Serves the site icon.
const serveIcon = () => {
  fs.readFile('favicon.ico')
  .then(
    content => {
      response.setHeader('Content-Type', 'image/x-icon');
      response.write(content, 'binary');
      response.end();
    },
    error => err(error, 'reading site icon')
  );
};
// Prepares to serve an event stream.
const serveEventStart = () => {
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Connection', 'keep-alive');
};
// Reinitializes the event-stream variables and starts an event stream.
const streamInit = () => {
  globals.idle = false;
  totals.total = totals.changes = 0;
  serveEventStart();
};
/*
  Returns the long reference of a member of a collection with a project-unique name.
  Release and iteration names are project-unique, not globally unique.
*/
const getProjectNameRef = (projectRef, type, name, context) => {
  // If a nonblank name has been specified:
  if (name.length) {
    /*
      Get a reference to the specified member of the specified collection of the
      specified project.
    */
    return globals.restAPI.query({
      type,
      fetch: '_ref',
      query: queryUtils.where('Name', '=', name).and('Project', '=', projectRef)
    })
    .then(
      result => {
        const resultArray = result.Results;
        // If the member exists:
        if (resultArray.length) {
          // Return its reference.
          return resultArray[0]._ref;
        }
        else {
          return err('No such name', `getting reference to ${type} for ${context}`);
        }
      },
      error => err(error, `getting reference to ${type} for ${context}`)
    );
  }
  // Otherwise, i.e. if a blank name has been specified:
  else {
    // Return blank.
    return Promise.resolve('');
  }
};
/*
  Returns the short reference to a member of a collection with a globally unique name.
  User and project names are globally unique.
*/
const getGlobalNameRef = (name, type, key) => {
  if (name) {
    return globals.restAPI.query({
      type,
      query: queryUtils.where(key, '=', name)
    })
    .then(
      result => {
        const resultArray = result.Results;
        if (resultArray.length) {
          return shorten(type, type, resultArray[0]._ref);
        }
        else {
          err(`No such ${type}`, `getting reference to ${type}`);
          return '';
        }
      },
      error => {
        err(error, `getting reference to ${type}`);
        return '';
      }
    );
  }
  else {
    return Promise.resolve('');
  }
};
// Assigns values to global variables for handling POST requests.
const setGlobals = rootID => {
  // Get a long reference to the root user story.
  return getRef('hierarchicalrequirement', rootID, 'tree root')
  .then(
    // When it arrives:
    ref => {
      if (ref) {
        if (! globals.isError) {
          // Set its global variable.
          globals.rootRef = shorten('userstory', 'hierarchicalrequirement', ref);
          if (! globals.isError) {
            // Get a reference to the user.
            return getGlobalNameRef(globals.userName, 'user', 'UserName')
            .then(
              // When it arrives:
              ref => {
                if (! globals.isError) {
                  // Set its global variable.
                  globals.userRef = ref;
                  return '';
                }
              },
              error => err(error, 'getting reference to user')
            );
          }
          else {
            return '';
          }
        }
        else {
          return '';
        }
      }
      else {
        return '';
      }
    },
    error => err(error, 'getting reference to root user story')
  );
};
// Sets the global state variable.
const setState = scheduleState => {
  globals.state.story = scheduleState;
  if (globals.state.story === 'Needs Definition') {
    globals.state.task = 'Defined';
  }
  else if (globals.state.story === 'Accepted') {
    globals.state.task = 'Completed';
  }
  else {
    globals.state.task = globals.state.story;
  }
};
// Handles requests, serving the request page and the acknowledgement page.
const requestHandler = (request, res) => {
  response = res;
  const {method} = request;
  const bodyParts = [];
  request.on('error', err => {
    console.error(err);
  })
  .on('data', chunk => {
    bodyParts.push(chunk);
  })
  .on('end', () => {
    const requestURL = request.url;
    const op = {
      caseData,
      docWait,
      err,
      fs,
      getCollectionData,
      getGlobalNameRef,
      getProjectNameRef,
      getItemData,
      getRef,
      globals,
      report,
      reportPrep,
      reportScriptPrep,
      response,
      scorePriorities,
      scoreRisks,
      servePage,
      setState,
      shorten,
      totals
    };
    // METHOD GET: If the request requests a resource:
    if (method === 'GET') {
      // If the requested resource is a file, serve it.
      if (requestURL === '/do.html') {
        // Serves the request page (in a new tab, per the link to this URL).
        serveDo();
      }
      else if (requestURL === '/style.css') {
        // Serves the stylesheet when a page requests it.
        serveStyles();
      }
      else if (requestURL === '/favicon.ico') {
        // Serves the site icon when a page requests it.
        serveIcon();
      }
      /*
        Otherwise, if the requested resource is an event stream, start it
        and prevent any others from being started.
      */
      else if (requestURL === '/copytally' && globals.idle) {
        streamInit();
        const {copyTree} = require('./copyTree');
        copyTree(
          op,
          [globals.rootRef],
          globals.copyParentType === 'hierarchicalrequirement' ? 'story' : 'feature',
          globals.copyParentRef
        );
      }
      else if (requestURL === '/scoretally' && globals.idle) {
        streamInit();
        const {scoreTree} = require('./scoreTree');
        scoreTree(op, globals.rootRef);
      }
      else if (requestURL === '/taketally' && globals.idle) {
        streamInit();
        const {takeTree} = require('./takeTree');
        takeTree(op, [globals.rootRef]);
      }
      else if (requestURL === '/projecttally' && globals.idle) {
        streamInit();
        const {projectTree} = require('./projectTree');
        projectTree(op, [globals.rootRef]);
      }
      else if (requestURL === '/scheduletally' && globals.idle) {
        streamInit();
        const {scheduleTree} = require('./scheduleTree');
        scheduleTree(op, [globals.rootRef]);
      }
      else if (requestURL === '/tasktally' && globals.idle) {
        streamInit();
        const {taskTree} = require('./taskTree');
        taskTree(op, [globals.rootRef]);
      }
      else if (requestURL === '/casetally' && globals.idle) {
        streamInit();
        const {caseTree} = require('./caseTree');
        caseTree(op, [globals.rootRef]);
      }
      else if (requestURL === '/grouptally' && globals.idle) {
        streamInit();
        const {groupTree} = require('./groupTree');
        groupTree(op, [globals.rootRef]);
      }
      else if (requestURL === '/passtally' && globals.idle) {
        streamInit();
        const {passTree} = require('./passTree');
        passTree(op, [globals.rootRef]);
      }
      else if (requestURL === '/plantally' && globals.idle) {
        streamInit();
        const {planTree} = require('./planTree');
        planTree(op, [globals.rootRef], '');
      }
      else if (requestURL === '/doc' && globals.idle) {
        streamInit();
        const {docTree} = require('./docTree');
        docTree(op, globals.rootRef, globals.doc, 0, []);
      }
    }
    // METHOD POST: Otherwise, if the request submits the request form:
    else if (method === 'POST' && requestURL === '/do.html') {
      reinit();
      // Permit an event stream to be started.
      globals.idle = true;
      const bodyObject = parse(Buffer.concat(bodyParts).toString());
      const {cookie, doOp, password, rootID} = bodyObject;
      globals.userName = bodyObject.userName;
      RALLY_USERNAME = globals.userName;
      RALLY_PASSWORD = password;
      // If the user has not deleted the content of the cookie field:
      if (cookie.length) {
        // Make every request in the session include the cookie, forcing single-host mode.
        requestOptions.headers.Cookie = cookie.split('\r\n').join('; ');
      }
      // Create and configure a Rally API client.
      globals.restAPI = rally({
        user: globals.userName,
        pass: password,
        requestOptions
      });
      // Get a long reference to the root user story.
      setGlobals(rootID)
      .then(
        () => {
          if (globals.isError) {
            return '';
          }
          // OP COPYING
          else if (doOp === 'copy') {
            const {copyHandle} = require('./copyTree');
            copyHandle(op, bodyObject);
          }
          // OP SCORING
          else if (doOp === 'score') {
            const {scoreHandle} = require('./scoreTree');
            scoreHandle(op, bodyObject);
          }
          // OP OWNERSHIP CHANGE
          else if (doOp === 'take') {
            const {takeHandle} = require('./takeTree');
            takeHandle(op, bodyObject);
          }
          // OP PROJECT CHANGE
          else if (doOp === 'project') {
            const {projectWhich, projectRelease, projectIteration} = bodyObject;
            // Get a reference to the named project.
            getGlobalNameRef(projectWhich, 'project', 'Name')
            .then(
              // When it arrives:
              ref => {
                if (! globals.isError) {
                  // Set its global variable.
                  globals.projectRef = ref;
                  // Get a reference to the named release.
                  getProjectNameRef(globals.projectRef, 'release', projectRelease, 'project change')
                  .then(
                    // When it arrives:
                    ref => {
                      if (! globals.isError) {
                        // Set its global variable.
                        globals.projectReleaseRef = ref || null;
                        // Get a reference to the named iteration.
                        getProjectNameRef(
                          globals.projectRef, 'iteration', projectIteration, 'project change'
                        )
                        .then(
                          // When it arrives:
                          ref => {
                            if (! globals.isError) {
                              // Set its global variable.
                              globals.projectIterationRef = ref || null;
                              // Serve a report identifying the project, release, and iteration.
                              serveProjectReport(projectWhich, projectRelease, projectIteration);
                            }
                          },
                          error => err(error, 'getting reference to iteration')
                        );
                      }
                    },
                    error => err(error, 'getting reference to release')
                  );
                }
              },
              error => err(error, 'getting reference to new project')
            );
          }
          // OP SCHEDULING
          else if (doOp === 'schedule') {
            // Set the global state variable.
            setState(bodyObject.scheduleState);
            // Serve a report.
            serveScheduleReport();
          }
          // OP TASK CREATION
          else if (doOp === 'task') {
            const {taskName} = bodyObject;
            if (taskName.length < 2) {
              err('Task name(s) missing', 'creating tasks');
            }
            else {
              const delimiter = taskName[0];
              globals.taskNames.push(...taskName.slice(1).split(delimiter));
              for (let i = 0; i < globals.taskNames.length; i++) {
                globals.taskNames[i] = globals.taskNames[i].trim();
              }
              if (globals.taskNames.every(taskName => taskName.length)) {
                serveTaskReport();
              }
              else {
                err('Empty task name(s)', 'creating tasks');
              }
            }
          }
          // OP TEST-CASE CREATION
          else if (doOp === 'case') {
            globals.caseTarget = bodyObject.caseTarget;
            const {caseFolder, caseSet, caseProject} = bodyObject;
            // Get a reference to the project, if specified.
            getGlobalNameRef(caseProject, 'project', 'Name')
            .then(
              // When the reference, if any, arrives:
              ref => {
                if (! globals.isError) {
                  // Set its global variable.
                  globals.caseProjectRef = shorten('project', 'project', ref);
                  if (! globals.isError) {
                    // Get a reference to the test folder, if specified.
                    getRef('testfolder', caseFolder, 'test-case creation')
                    .then(
                      // When the reference, if any, arrives:
                      ref => {
                        if (! globals.isError) {
                          // Set its global variable.
                          globals.caseFolderRef = shorten('testfolder', 'testfolder', ref);
                          if (! globals.isError) {
                            // Get a reference to the test set, if specified.
                            getRef('testset', caseSet, 'test-case creation')
                            .then(
                              // When the reference, if any, arrives:
                              ref => {
                                if (! globals.isError) {
                                  // Set its global variable.
                                  globals.caseSetRef = shorten('testset', 'testset', ref);
                                  // Serve a report on test-case creation.
                                  serveCaseReport();
                                }
                              },
                              error => err(error, 'getting reference to test set')
                            );
                          }
                        }
                      },
                      error => err(error, 'getting reference to test folder')
                    );
                  }
                }
              },
              error => err(error, 'getting reference to project')
            );
          }
          // OP TEST-CASE GROUPING
          else if (doOp === 'group') {
            const {groupFolder, groupSet} = bodyObject;
            if (! groupFolder && ! groupSet) {
              err('Test folder and test set both missing', 'grouping test cases');
            }
            else {
              // Get a reference to the test folder, if specified.
              getRef('testfolder', groupFolder, 'test-case grouping')
              .then(
                // When the reference, if any, arrives:
                ref => {
                  if (! globals.isError) {
                    // Set its global variable.
                    globals.groupFolderRef = shorten('testfolder', 'testfolder', ref);
                    if (! globals.isError) {
                      // Get a reference to the test set, if specified.
                      getRef('testset', groupSet, 'test-case grouping')
                      .then(
                        // When the reference, if any, arrives:
                        ref => {
                          if (! globals.isError) {
                            // Set its global variable.
                            globals.groupSetRef = shorten('testset', 'testset', ref);
                            // Serve a report on test-case creation.
                            serveGroupReport();
                          }
                        },
                        error => err(error, 'getting reference to test set')
                      );
                    }
                  }
                },
                error => err(error, 'getting reference to test folder')
              );
            }
          }
          // OP PASSING
          else if (doOp === 'pass') {
            globals.passBuild = bodyObject.passBuild;
            if (! globals.passBuild) {
              err('Build blank', 'passing test cases');
            }
            else {
              globals.passNote = bodyObject.passNote;
              // Serve a report on passing-result creation.
              servePassReport();
            }
          }
          // OP PLANIFICATION
          else if (doOp === 'plan') {
            globals.planHow = bodyObject.planHow;
            // Planify the tree.
            servePlanReport();
          }
          // OP DOCUMENTATION
          else if (doOp === 'doc') {
            // Serve a report of the tree documentation.
            serveDocReport();
          }
          else {
            err('Unknown operation', 'RallyTree');
          }
        },
        error => err(error, 'setting global variables')
      );
    }
    else {
      err('Unanticipated request', 'RallyTree');
    }
  });
};

// ########## SERVER

const server = http.createServer(requestHandler);
const port = 3000;
server.listen(port, () => {
  console.log(`Opening index.html. It will link to localhost:${port}.`);
  open('index.html');
});
