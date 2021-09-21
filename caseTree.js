// Serves the add-test-cases report page.
const serveCaseReport = op => {
  const {err, fs, reportPrep, reportScriptPrep, servePage} = op;
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
// Handles task-creation requests.
const caseHandle = (op, bodyObject) => {
  const {err, getGlobalNameRef, getRef, globals, shorten} = op;
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
                        serveCaseReport(op);
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
};
// Creates test cases.
const createCases = (op, names, description, owner, projectRef, storyRef) => {
  const {globals, err, shorten, report} = op;
  if (names.length && ! globals.isError) {
    // Create the first test case.
    return globals.restAPI.create({
      type: 'testcase',
      fetch: ['_ref'],
      data: {
        Name: names[0],
        Description: description,
        Owner: owner,
        Project: projectRef,
        TestFolder: globals.caseFolderRef || null
      }
    })
    .then(
      // After it has been created:
      newCase => {
        // Add it to the specified user story’s test cases.
        const caseRef = shorten('testcase', 'testcase', newCase.Object._ref);
        if (! globals.isError) {
          return globals.restAPI.add({
            ref: storyRef,
            collection: 'TestCases',
            data: [{_ref: caseRef}],
            fetch: ['_ref']
          })
          .then(
            // After it has been added:
            () => {
              // Add it to the specified test set, if any.
              return (
                globals.caseSetRef ? globals.restAPI.add({
                  ref: caseRef,
                  collection: 'TestSets',
                  data: [{_ref: globals.caseSetRef}],
                  fetch: ['_ref']
                }) : Promise.resolve('')
              )
              .then(
                // After it may have been added:
                () => {
                  report([['changes']]);
                  // Create the remaining test cases.
                  return createCases(op, names.slice(1), description, owner, projectRef, storyRef);
                },
                error => err(error, 'adding test case to test set')
              );
            },
            error => err(error, 'adding test case to test cases of user story')
          );
        }
        else {
          return '';
        }
      },
      error => err(error, 'creating test case')
    );
  }
  else {
    return Promise.resolve('');
  }
};
// Recursively creates test cases for a tree or subtrees of user stories.
const caseTree = (op, storyRefs) => {
  const {globals, caseNames, err, shorten, report, getItemData, getCollectionData} = op;
  if (storyRefs.length && ! globals.isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! globals.isError) {
      // Get data on the first user story.
      return getItemData(
        firstRef, ['FormattedID', 'Name', 'Description', 'Owner', 'Project'], ['Children']
      )
      .then(
        // When the data arrive:
        data => {
          report([['total']]);
          // Determine the names and project of the test cases to be created, if any.
          let names = [];
          let projectRef = '';
          if (globals.caseTarget === 'all' || ! data.children.count) {
            names = caseNames ? caseNames[data.name] || [data.name] : [data.name];
            projectRef = globals.caseProjectRef || data.project;
          }
          // Report progress in the console if requested.
          if (globals.debug) {
            console.log(`Processing ${data.formattedID}`);
          }
          // Create the test cases, if any.
          return createCases(op, names, data.description, data.owner, projectRef, firstRef)
          .then(
            // When any have been created:
            () => {
              // Get data on any child user stories.
              return getCollectionData(data.children.count ? data.children.ref : '', [], [])
              .then(
                // When the data, if any, arrive:
                children => {
                  // Process any children sequentially.
                  return caseTree(op, children.length ? children.map(child => child.ref) : [])
                  .then(
                    // After any are processed, process the remaining user stories.
                    () => caseTree(op, storyRefs.slice(1)),
                    error => err(error, 'creating test cases for child user stories')
                  );
                },
                error => err(error, 'getting data on child user stories')
              );
            },
            error => err(error, 'creating test cases')
          );
        },
        error => err(error, 'getting data on user story')
      );
    }
    else {
      return Promise.resolve('');
    }
  }
  else {
    return Promise.resolve('');
  }
};
exports.caseHandle = caseHandle;
exports.caseTree = caseTree;
