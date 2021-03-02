// Serves the add-tasks report page.
const serveTaskReport = op => {
  const {
    err,
    fs,
    globals,
    reportPrep,
    reportScriptPrep,
    servePage
  } = op;
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
// Handles task-creation requests.
const taskHandle = (op, bodyObject) => {
  const {err, globals} = op;
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
};
// Sequentially creates tasks for a user story.
const createTasks = (op, storyRef, owner, names) => {
  const {globals, err} = op;
  if (names.length && ! globals.isError) {
    // Create a task with the first name.
    return globals.restAPI.create({
      type: 'task',
      fetch: ['_ref'],
      data: {
        Name: names[0],
        WorkProduct: storyRef,
        Owner: owner
      }
    })
    .then(
      // When it has been created, create tasks with the remaining names.
      () => createTasks(op, storyRef, owner, names.slice(1)),
      error => err(error, 'creating task')
    );
  }
  else {
    return Promise.resolve('');
  }
};
// Recursively creates tasks for a tree or subtrees of user stories.
const taskTree = (op, storyRefs) => {
  const {globals, err, shorten, report, getItemData, getCollectionData} = op;
  if (storyRefs.length && ! globals.isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! globals.isError) {
      // Get data on the first user story.
      return getItemData(firstRef, ['Owner'], ['Children'])
      .then(
        // When the data arrive:
        data => {
          // If the user story has any child user stories:
          if (data.children.count) {
            report([['total']]);
            // Get data on them.
            return getCollectionData(data.children.ref, [], [])
            .then(
              // When the data arrive:
              children => {
                // Process the child user stories sequentially.
                return taskTree(op, children.map(child => child.ref))
                .then(
                  // After they are processed, process the remaining user stories.
                  () => taskTree(op, storyRefs.slice(1)),
                  error => err(error, 'creating tasks for child user stories')
                );
              },
              error => err(error, 'getting data on child user stories')
            );
          }
          // Otherwise, i.e. if the user story has no child user stories:
          else {
            // Create tasks for the user story sequentially.
            return createTasks(op, firstRef, data.owner, globals.taskNames)
            .then(
              // When they have been created:
              () => {
                if (! globals.isError) {
                  report([['total'], ['changes', globals.taskNames.length]]);
                  // Process the remaining user stories sequentially.
                  return taskTree(op, storyRefs.slice(1));
                }
              },
              error => err(error, 'creating tasks')
            );
          }
        },
        error => err(
          error, 'getting data on user story'
        )
      );
    }
  }
  else {
    return Promise.resolve('');
  }
};
exports.taskHandle = taskHandle;
exports.taskTree = taskTree;
