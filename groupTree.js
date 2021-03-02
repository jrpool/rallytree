// Serves the group-test-case report page.
const serveGroupReport = op => {
  const {err, fs, reportPrep, reportScriptPrep, servePage} = op;
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
// Handles task-creation requests.
const groupHandle = (op, bodyObject) => {
  const {err, getRef, globals, shorten} = op;
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
                  serveGroupReport(op);
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
};
// Groups test cases.
const groupCases = (op, cases) => {
  const {globals, err, shorten, report, getCollectionData} = op;
  if (cases.length && ! globals.isError) {
    const firstCase = cases[0];
    const firstRef = shorten('testcase', 'testcase', firstCase.ref);
    if (! globals.isError) {
      report([['total']]);
      const folderRef = shorten('testfolder', 'testfolder', firstCase.testFolder);
      // Determine what test-folder and test-set groupings are already known to be needed.
      const needsFolder = globals.groupFolderRef && folderRef !== globals.groupFolderRef;
      let needsSet = globals.groupSetRef && ! firstCase.testSets.count;
      // If the need for a test-set grouping is still unknown, get data to determine it.
      return (globals.groupSetRef && firstCase.testSets.count ? getCollectionData(
        firstCase.testSets.ref, [], []
      ) : Promise.resolve([]))
      .then(
        // When the data, if needed, arrive:
        sets => {
          // Update the need for a test-set grouping if necessary.
          if (sets.length && ! sets.map(
            set => shorten('testset','testset', set.ref).includes(globals.groupSetRef)
          )) {
            needsSet = true;
          }
          // Group the test case into a test folder if necessary.
          return (
            needsFolder ? globals.restAPI.update({
              ref: firstRef,
              data: {
                TestFolder: globals.groupFolderRef
              }
            }) : Promise.resolve('')
          )
          .then(
            // When the test-folder grouping, if any, has been made:
            () => {
              // Group the test case into a test set if necessary.
              return (
                needsSet ? globals.restAPI.add({
                  ref: firstRef,
                  collection: 'TestSets',
                  data: [{_ref: globals.groupSetRef}],
                  fetch: ['_ref']
                }) : Promise.resolve('')
              )
              .then(
                // When the test-set grouping, if any, has been made:
                () => {
                  if (needsFolder) {
                    report([['changes'], ['folderChanges']]);
                  }
                  if (needsSet) {
                    report([['changes'], ['setChanges']]);
                  }
                  // Process the remaining test cases.
                  return groupCases(op, cases.slice(1));
                },
                error => err(error, 'grouping test case into test set')
              );
            },
            error => err(error, 'grouping test case into test folder')
          );
        },
        error => err(error, 'getting initial data on grouping need')
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
// Recursively groups test cases in a tree or subtrees of user stories.
const groupTree = (op, storyRefs) => {
  const {globals, err, shorten, getItemData, getCollectionData} = op;
  if (storyRefs.length && ! globals.isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! globals.isError) {
      // Get data on the first user story of the specified array.
      return getItemData(firstRef, [], ['Children', 'TestCases'])
      .then(
        // When the data arrive:
        data => {
          // FUNCTION DEFINITION START
          // Processes child user stories and remaining user stories.
          const groupChildrenAndSiblings = () => {
            // If the user story has child user stories:
            if (data.children.count) {
              // Get data on them.
              return getCollectionData(data.children.ref, [], [])
              .then(
                // When the data arrive:
                children => {
                  // Process the child user stories.
                  return groupTree(op, children.map(child => child.ref))
                  .then(
                    // After they are processed, process the remaining user stories.
                    () => groupTree(op, storyRefs.slice(1)),
                    error => err(error, 'grouping test cases of child user stories')
                  );
                },
                error => err(error, 'getting data on child user stories')
              );
            }
            // Otherwise, i.e. if the user story has no child user stories:
            else {
              // Process the remaining user stories.
              return groupTree(op, storyRefs.slice(1));
            }      
          };
          // FUNCTION DEFINITION END
          // If the user story has test cases:
          if (data.testCases.count) {
            // Get data on them.
            return getCollectionData(data.testCases.ref, ['TestFolder'], ['TestSets'])
            .then(
              // When the data arrive:
              cases => {
                // Process the test cases sequentially.
                return groupCases(op, cases)
                .then(
                  // After they are processed:
                  () => {
                    if (! globals.isError) {
                      // Process child user stories and the remaining user stories.
                      return groupChildrenAndSiblings();
                    }
                    else {
                      return '';
                    }
                  },
                  error => err(error, 'grouping test cases')
                );
              },
              error => err(error, 'getting data on test cases')
            );
          }
          // Otherwise, i.e. if the user story has no test cases:
          else {
            // Process child user stories and the remaining user stories.
            return groupChildrenAndSiblings();
          }
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
exports.groupHandle = groupHandle;
exports.groupTree = groupTree;
