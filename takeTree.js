// Serves the change-owner report page.
const serveTakeReport = (op, name) => {
  const {
    err,
    fs,
    globals,
    reportPrep,
    reportScriptPrep,
    servePage
  } = op;
  fs.readFile('takeReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(jsContent, '/taketally', [
            'total',
            'storyTotal',
            'taskTotal',
            'caseTotal',
            'changes',
            'storyChanges',
            'taskChanges',
            'caseChanges',
            'error'
          ]);
          const newContent = reportPrep(htmlContent, newJSContent)
          .replace('__takeWhoName__', name)
          .replace('__takeWhoRef__', globals.takeWhoRef);
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
      );
    },
    error => err(error, 'reading takeReport page')
  );
};
// Handles ownership change requests.
const takeHandle = (op, bodyObject) => {
  const {
    err,
    getGlobalNameRef,
    globals
  } = op;
  const {takeWho} = bodyObject;
  // If an owner other than the user was specified:
  if (takeWho) {
    // Serve a report identifying the new owner.
    getGlobalNameRef(takeWho, 'user', 'UserName')
    .then(
      ref => {
        if (! globals.isError) {
          globals.takeWhoRef = ref;
          serveTakeReport(op, takeWho);
        }
      },
      error => err(error, 'getting reference to new owner')
    );
  }
  // Otherwise, the new owner will be the user, so:
  else {
    globals.takeWhoRef = globals.userRef;
    // Serve a report identifying the user as new owner.
    serveTakeReport(op, globals.userName);
  }
};
// Sequentially ensures the ownership of an array of work items (tasks or test cases).
const takeItems = (op, longItemType, shortItemType, items) => {
  const {globals, err, shorten, report} = op;
  // If there are any items:
  if (items.length) {
    const firstItem = items[0];
    const firstRef = shorten(longItemType, longItemType, firstItem.ref);
    if (! globals.isError) {
      const owner = firstItem.owner;
      const ownerRef = shorten('user', 'user', owner);
      if (! globals.isError) {
        // If the ownership of the item needs to be changed:
        if (ownerRef !== globals.takeWhoRef) {
          // Change it.
          return globals.restAPI.update({
            ref: firstRef,
            data: {Owner: globals.takeWhoRef}
          })
          .then(
            // When it has been changed:
            () => {
              report(
                [['total'], ['changes'], [`${shortItemType}Total`], [`${shortItemType}Changes`]]
              );
              // Process the remaining items.
              return takeItems(op, longItemType, shortItemType, items.slice(1));
            },
            error => err(error, `changing ${longItemType} ownership`)
          );
        }
        // Otherwise, i.e. if the ownership of the item does not need to be changed:
        else {
          report([['total'], [`${shortItemType}Total`]]);
          // Process the remaining items.
          return takeItems(op, longItemType, shortItemType, items.slice(1));
        }
      }
      else {
        return Promise.resolve('');
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
// Recursively changes ownerships in a tree or subtree of user stories.
const takeTree = (op, storyRefs) => {
  const {globals, err, shorten, report, getItemData, getCollectionData} = op;
  if (storyRefs.length && ! globals.isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! globals.isError) {
      // Get data on the first user story.
      return getItemData(firstRef, ['Owner'], ['Children', 'Tasks', 'TestCases'])
      .then(
        // When the data arrive:
        data => {
          report([['total'], ['storyTotal']]);
          const ownerRef = shorten('user', 'user', data.owner);
          if (! globals.isError) {
            // Change the owner of the user story if necessary.
            const ownerWrong = ownerRef && ownerRef !== globals.takeWhoRef || ! ownerRef;
            if (ownerWrong) {
              report([['changes'], ['storyChanges']]);
            }
            return (ownerWrong ? globals.restAPI.update({
              ref: firstRef,
              data: {
                Owner: globals.takeWhoRef
              }
            }) : Promise.resolve(''))
            .then(
              // When the change, if any, has been made:
              () => {
                // Get data on the test cases, if any, of the user story.
                return getCollectionData(
                  data.testCases.count ? data.testCases.ref : '', ['Owner'], []
                )
                .then(
                  // When the data, if any, arrive:
                  cases => {
                    // Change the owner of any of them if necessary.
                    return takeItems(op, 'testcase', 'case', cases)
                    .then(
                      // When the changes, if any, have been made:
                      () => {
                        // Get data on the tasks of the user story.
                        return getCollectionData(
                          data.tasks.count ? data.tasks.ref : '', ['Owner'], []
                        )
                        .then(
                          // When the data, if any, arrive:
                          tasks => {
                            // Change the owner of any of them if necessary.
                            return takeItems(op, 'task', 'task', tasks)
                            .then(
                              // When the changes, if any, have been made:
                              () => {
                                // Get references to the child user stories of the user story.
                                return getCollectionData(
                                  data.children.count ? data.children.ref : '', [], []
                                )
                                .then(
                                  // When the references, if any, arrive:
                                  children => {
                                    // Process the child user stories, if any.
                                    return takeTree(op, children.map(child => child.ref))
                                    .then(
                                      /*
                                        When any have been processed, process the remaining user
                                        stories.
                                      */
                                      () => takeTree(op, storyRefs.slice(1)),
                                      error => err(error, 'changing owner of child user stories')
                                    );
                                  },
                                  error => err(error, 'getting references to child user stories')
                                );
                              },
                              error => err(error, 'changing owner of tasks')
                            );
                          },
                          error => err(error, 'getting data on tasks')
                        );
                      },
                      error => err(error, 'changing owner of test cases')
                    );
                  },
                  error => err(error, 'getting data on test cases')
                );
              },
              error => err(error, 'changing owner of user story')
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
exports.takeHandle = takeHandle;
exports.takeTree = takeTree;
