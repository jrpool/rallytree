// Creates passing results for test cases.
const passCases = (op, cases) => {
  const {globals, err, shorten, report, getCollectionData} = op;
  if (cases.length && ! globals.isError) {
    const firstCase = cases[0];
    const firstRef = shorten('testcase', 'testcase', firstCase.ref);
    if (! globals.isError) {
      report([['total']]);
      // If the test case already has results or has no owner:
      if (firstCase.results.count || ! firstCase.owner) {
        // Skip it and process the remaining test cases.
        return passCases(op, cases.slice(1));
      }
      // Otherwise, i.e. if it has no results and has an owner:
      else {
        // Determine which test set, if any, the new result will be in.
        return (firstCase.testSets.count ? (
          getCollectionData(firstCase.testSets.ref, [], [])
          .then(testSets => testSets[0].ref)
        ) : Promise.resolve(null))
        .then(
          // When the test set, if any, has been determined:
          testSet => {
            // Create a passing result for the test case.
            return globals.restAPI.create({
              type: 'testcaseresult',
              fetch: ['_ref'],
              data: {
                TestCase: firstRef,
                Verdict: 'Pass',
                Build: globals.passBuild,
                Notes: globals.passNote,
                Date: new Date(),
                Tester: firstCase.owner,
                TestSet: testSet
              }
            })
            .then(
              // When it has been created:
              () => {
                report([['changes']]);
                // Process the remaining test cases.
                return passCases(op, cases.slice(1));
              },
              error => err(error, 'creating passing result for test case')
            );
          },
          error => err(error,'determining test set for passing result')
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
// Recursively creates passing test-case results for a tree or subtrees of user stories.
const passTree = (op, storyRefs) => {
  const {globals, err, shorten, getItemData, getCollectionData} = op;
  if (storyRefs.length && ! globals.isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! globals.isError) {
      // Get data on the first user story.
      return getItemData(firstRef, [], ['Children', 'TestCases'])
      .then(
        // When the data arrive:
        data => {
          // Get data on the test cases, if any, of the user story.
          return getCollectionData(
            data.testCases.count ? data.testCases.ref : '', ['Owner'], ['Results', 'TestSets']
          )
          .then(
            // When the data arrive:
            cases => {
              // Process the test cases, if any, sequentially.
              return passCases(op, cases)
              .then(
                // After any are processed:
                () => {
                  if (! globals.isError) {
                    // Get data on the child user stories, if any, of the user story.
                    return getCollectionData(data.children.count ? data.children.ref : '', [], [])
                    .then(
                      // When the data, if any, arrive:
                      children => {
                        // Process the child user stories, if any.
                        return passTree(op, children.map(child => child.ref))
                        .then(
                          // When any have been processed, process the remaining user stories.
                          () => passTree(op, storyRefs.slice(1)),
                          error => err(error, 'creating passing results for child user stories')
                        );
                      },
                      error => err(error, 'getting data on child user stories')
                    );
                  }
                  else {
                    return '';
                  }
                },
                error => err(error, 'creating passing results for test cases of user story')
              );
            },
            error => err(error, 'getting data on test cases of user story')
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
exports.passTree = passTree;
