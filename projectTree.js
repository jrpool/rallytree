// Recursively changes project affiliations of an array of test cases.
const projectCases = (op, caseRefs) => {
  const {globals, err, shorten, report} = op;
  if (caseRefs.length) {
    // Change the project of the first test case.
    const firstRef = shorten('testcase', 'testcase', caseRefs[0]);
    if (! globals.isError) {
      return globals.restAPI.update({
        ref: firstRef,
        data: {
          Project: globals.projectRef
        }
      })
      .then(
        // When it has been changed:
        () => {
          report([['changes'], ['projectChanges']]);
          // Change the projects of the remaining test cases.
          return projectCases(op, caseRefs.slice(1));
        },
        error => err(error, 'changing project of test case')
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
/*
  Recursively changes project affiliations and optionally releases and/or iterations of
  user stories, and project affiliations of test cases, in a tree or subtree.
*/
const projectTree = (op, storyRefs) => {
  const {globals, err, shorten, report, getItemData, getCollectionData} = op;
  if (storyRefs.length && ! globals.isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! globals.isError) {
      // Get data on the first user story.
      return getItemData(firstRef, ['Project', 'Release', 'Iteration'], ['Children', 'TestCases'])
      .then(
        // When the data arrive:
        data => {
          const oldProjectRef = shorten('project', 'project', data.project);
          if (! globals.isError) {
            // Initialize a configuration object for an update to the user story.
            const config = {};
            // Initialize an array of events reportable for the user story.
            const events = [['total'], ['storyTotal']];
            // Add necessary events to the configuration and array.
            if (oldProjectRef && oldProjectRef !== globals.projectRef || ! oldProjectRef) {
              config.Project = globals.projectRef;
              events.push(['changes'], ['projectChanges']);
            }
            if (data.release !== globals.projectReleaseRef && ! data.children.count) {
              config.Release = globals.projectReleaseRef;
              events.push(['changes'], ['releaseChanges']);
            }
            if (data.iteration !== globals.projectIterationRef && ! data.children.count) {
              config.Iteration = globals.projectIterationRef;
              events.push(['changes'], ['iterationChanges']);
            }
            // Update the user story if necessary.
            return (events.length > 1 ? globals.restAPI.update({
              ref: firstRef,
              data: config
            }) : Promise.resolve(''))
            .then(
              // When the update, if any, has been made:
              () => {
                events.length > 1 && report(events);
                // Get data on the user story’s test cases, if any.
                return getCollectionData(
                  data.testCases.count ? data.testCases.ref : '', ['Project'], []
                )
                .then(
                  // When the data, if any, arrive:
                  cases => {
                    cases.length && report([['total', cases.length], ['caseTotal', cases.length]]);
                    // Process sequentially the test cases needing a project change.
                    return projectCases(
                      op, cases.filter(
                        testCase => shorten('project', 'project', testCase.project) !== globals.projectRef
                      )
                      .map(testCase => testCase.ref)
                    )
                    .then(
                      // When they have been processed:
                      () => {
                        // Get data on the user story’s child user stories.
                        return getCollectionData(data.children.ref, [], [])
                        .then(
                          // When the data arrive:
                          children => {
                            // Process the children sequentially.
                            return projectTree(op, children.map(child => child.ref))
                            .then(
                              // When they have been processed, process the remaining user stories.
                              () => projectTree(op, storyRefs.slice(1)),
                              error => err(error, 'changing project of children of user story')
                            );
                          },
                          error => err(error, 'getting data on children of user story')
                        );
                      },
                      error => err(error, 'changing projects of test cases')
                    );
                  },
                  error => err(error, 'getting data on test cases')
                );
              },
              error => err(error, 'changing project of user story')
            );
          }
          else {
            return '';
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
exports.projectTree = projectTree;
