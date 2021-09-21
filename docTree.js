// Serves the documentation report page.
const serveDocReport = op => {
  const {err, fs, reportPrep, reportScriptPrep, servePage} = op;
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
// Handles task-creation requests.
const docHandle = op => {
  // Serve a report of the tree documentation.
  serveDocReport(op);
};
  /*
  Sends the tree documentation as an event if enough time has passed since the last update.
  Otherwise, stops the event from the last update, if any, from being sent.
*/
const outDoc = op => {
  const {globals, docWait, response} = op;
  // If an event is scheduled:
  if (globals.docTimeout) {
    // Unschedule it.
    clearTimeout(globals.docTimeout);
  }
  // Schedule an event to be sent after docWait ms.
  globals.docTimeout = setTimeout(
    () => {
      const docJSON = JSON.stringify(globals.doc[0], null, 2).replace(
        /\n/g, '<br>'
      );
      response.write(`event: doc\ndata: ${docJSON}\n\n`);
    },
    docWait
  );
};
/*
  Recursively documents as a JSON object a tree or subtree of user stories, specifying
  the array of the objects of the root user story and its siblings, the index of the root user
  story’s object in that array, and an array of the objects of the ancestors of the user story.
*/
const docTree = (op, storyRef, storyArray, index, ancestors) => {
  const {globals, err, shorten, getItemData, getCollectionData} = op;
  if (! globals.isError) {
    // Get data on the user story.
    getItemData(
      storyRef,
      ['FormattedID', 'Name', 'Parent', 'PortfolioItem'],
      ['Children', 'Tasks', 'TestCases']
    )
    .then(
      // When the data arrive:
      data => {
        // Count its test cases, tasks, and child user stories.
        const childCount = data.children.count;
        const taskCount = data.tasks.count;
        const caseCount = data.testCases.count;
        // Initialize the user story’s object.
        storyArray[index] = {
          formattedID: data.formattedID,
          name: data.name,
          featureParent: '',
          storyParent: '',
          taskCount,
          caseCount,
          childCount,
          children: []
        };
        // If the user story is the root, add root properties to its object.
        if (! ancestors.length) {
          getItemData(data.portfolioItem, ['FormattedID'], [])
          .then(
            data => {
              storyArray[index].featureParent = data.formattedID || '';
            }
          );
          getItemData(data.parent, ['FormattedID'], [])
          .then(
            data => {
              storyArray[index].storyParent = data.formattedID || '';
            }
          );
        }
        else {
          delete storyArray[index].featureParent;
          delete storyArray[index].storyParent;
        }
        // Add the user story’s task and test-case counts to its ancestors’.
        ancestors.forEach(ancestor => {
          ancestor.taskCount += taskCount;
          ancestor.caseCount += caseCount;
        });
        // Report progress in the console if requested.
        if (globals.debug) {
          console.log(`Processing ${data.formattedID}`);
        }
        // If the user story has child user stories:
        if (childCount) {
          // Get data on them.
          getCollectionData(data.children.ref, ['DragAndDropRank'], [])
          .then(
            // When the data arrive:
            children => {
              // Sort the child user stories by rank.
              children.sort((a, b) => a.dragAndDropRank < b.dragAndDropRank ? -1 : 1);
              const childArray = storyArray[index].children;
              const childAncestors = ancestors.concat(storyArray[index]);
              // Process them in parallel, in that order.
              for (let i = 0; i < childCount; i++) {
                if (! globals.isError) {
                  const childRef = shorten(
                    'hierarchicalrequirement', 'hierarchicalrequirement', children[i].ref
                  );
                  if (! globals.isError) {
                    docTree(op, childRef, childArray, i, childAncestors);
                  }
                }
              }
            },
            error => err(error, 'getting data on child user stories')
          );
        }
        // Send the documentation, after it is apparently complete, to the client.
        outDoc(op);
      },
      error => err(error, 'getting data on user story')
    );
  }
};
exports.docHandle = docHandle;
exports.docTree = docTree;
