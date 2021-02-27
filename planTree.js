// Sequentially planifies an array of test cases.
const planCases = (op, cases, folderRef) => {
  const {globals, err, shorten, report} = op;
  if (cases.length && ! globals.isError) {
    const firstCase = cases[0];
    const firstRef = shorten('testcase', 'testcase', firstCase.ref);
    if (! globals.isError) {
      // If existing test cases are to be linked to test folders:
      if (globals.planHow === 'use') {
        // Link the test case to the specified test folder.
        return globals.restAPI.update({
          ref: firstRef,
          data: {
            TestFolder: folderRef
          }
        })
        .then(
          // When it has been linked:
          () => {
            report([['caseChanges']]);
            // Link the remaining test cases.
            return planCases(cases.slice(1), folderRef);
          },
          error => err(error, `linking test case ${firstRef} to test folder`)
        );
      }
      // Otherwise, i.e. if test cases are to be copied into test folders:
      else {
        // Copy the test case into the test folder.
        return globals.restAPI.create({
          type: 'testcase',
          fetch: ['_ref'],
          data: {
            Name: firstCase.name,
            Description: firstCase.description,
            Owner: firstCase.owner,
            DragAndDropRank: firstCase.dragAndDropRank,
            Risk: firstCase.risk,
            Priority: firstCase.priority,
            Project: firstCase.project,
            TestFolder: folderRef
          }
        })
        .then(
          // When the test case has been copied:
          () => {
            report([['caseChanges']]);
            // Copy the remaining test cases.
            return planCases(cases.slice(1), folderRef);
          },
          error => err(error, `copying test case ${firstRef}`)
        );
      }
    }
    else {
      return Promise.resolve('');
    }
  }
  else {
    return Promise.resolve('');
  }
};
// Recursively planifies a tree or subtrees of user stories.
const planTree = (op, storyRefs, parentRef) => {
  const {globals, err, shorten, report, getItemData, getCollectionData} = op;
  if (storyRefs.length && ! globals.isError) {
    // Identify and shorten the reference to the first user story.
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! globals.isError) {
      // Get data on the first user story.
      return getItemData(
        firstRef, ['Name', 'Description', 'Project'], ['Children', 'TestCases']
      )
      .then(
        // When the data arrive:
        data => {
          // Define the options for creation of a corresponding test folder.
          const properties = {
            Name: data.name,
            Description: data.description,
            Project: data.project
          };
          // 
          if (parentRef) {
            properties.Parent = parentRef;
          }
          // Create a test folder, with the specified parent if not the root.
          return globals.restAPI.create({
            type: 'testfolder',
            fetch: ['FormattedID'],
            data: properties
          })
          .then(
            // When the test folder has been created:
            folder => {
              // If the test folder is the root, report its formatted ID.
              if (! parentRef) {
                response.write(`event: planRoot\ndata: ${folder.Object.FormattedID}\n\n`);
              }
              report([['storyChanges']]);
              const folderRef = shorten('testfolder', 'testfolder', folder.Object._ref);
              if (! globals.isError) {
                // Determine the required case facts.
                const requiredFacts = globals.planHow === 'use' ? [
                  'Name', 'Description', 'Owner', 'DragAndDropRank', 'Risk', 'Priority', 'Project'
                ] : [];
                // Get data on the test cases, if any, of the user story.
                return getCollectionData(
                  data.testCases.count ? data.testCases.ref : '', requiredFacts, []
                )
                .then(
                  // When the data, if any, arrive:
                  cases => {
                    // Process any test cases.
                    return planCases(cases, folderRef)
                    .then(
                      // When the test cases, if any, have been processed:
                      () => {
                        // Get data on the child user stories, if any, of the user story.
                        return getCollectionData(
                          data.children.count ? data.children.ref : '', [], []
                        )
                        .then(
                          // When the data, if any, arrive:
                          children => {
                            // Process the child user stories, if any.
                            return planTree(children.map(child => child.ref), folderRef)
                            .then(
                              /*
                                When the child user stories, if any, have been processed, process
                                the remaining user stories.
                              */
                              () => planTree(storyRefs.slice(1), parentRef),
                              error => err(error, 'planifying child user stories')
                            );
                          },
                          error => err(error, 'getting data on child user stories')
                        );
                      },
                      error => err(error, 'planifying test cases of user story')
                    );
                  },
                  error => err(error, 'getting data on test cases of user story')
                );
              }
              else {
                return '';
              }
            },
            error => err(error, 'planifying user story')
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
exports.planTree = planTree;
