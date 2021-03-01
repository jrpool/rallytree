// Serves the schedule-state report page.
const serveScheduleReport = op => {
  const {
    err,
    fs,
    globals,
    reportPrep,
    reportScriptPrep,
    servePage
  } = op;
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
// Handles project change requests.
const scheduleHandle = (op, bodyObject) => {
  const {setState} = op;
  // Set the global state variable.
  setState(bodyObject.scheduleState);
  // Serve a report.
  serveScheduleReport(op);
};
  // Recursively sets the states of an array of tasks.
const scheduleTasks = (op, tasks) => {
  const {globals, err, shorten, report} = op;
  if (tasks.length && ! globals.isError) {
    const firstTask = tasks[0];
    const firstRef = shorten('task', 'task', firstTask.ref);
    if (! globals.isError) {
      // If the task’s state needs to be changed:
      if (firstTask.state !== globals.state.task) {
        // Change it.
        return globals.restAPI.update({
          ref: firstRef,
          data: {
            State: globals.state.task
          }
        })
        .then(
          // When it has been changed:
          () => {
            report([['total'], ['taskTotal'], ['changes'], ['taskChanges']]);
            // Process the remaining tasks.
            return scheduleTasks(op, tasks.slice(1));
          },
          error => err(error, 'changing state of task')
        );
      }
      // Otherwise, i.e. if the task’s state does not need to be changed:
      else {
        report([['total'], ['taskTotal']]);
        // Process the remaining tasks.
        return scheduleTasks(op, tasks.slice(1));
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
// Recursively sets the schedule state in a tree or subtree of user stories.
const scheduleTree = (op, storyRefs) => {
  const {globals, err, shorten, report, getItemData, getCollectionData} = op;
  if (storyRefs.length && ! globals.isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! globals.isError) {
      // Get data on the first user story.
      return getItemData(firstRef, ['ScheduleState'], ['Children', 'Tasks'])
      .then(
        // When the data arrive:
        data => {
          report([['total'], ['storyTotal']]);
          // Change the schedule state of the user story if necessary.
          const changeNeeded = ! data.children.count
            && ! data.tasks.count
            && data.scheduleState !== globals.state.story;
          return (changeNeeded ? globals.restAPI.update({
            ref: firstRef,
            data: {
              ScheduleState: globals.state.story
            }
          }) : Promise.resolve(''))
          .then(
            // When the change, if any, has been made:
            () => {
              changeNeeded && report([['changes'], ['storyChanges']]);
              // Get data on the tasks of the user story, if any.
              return getCollectionData(data.tasks.ref, ['State'], [])
              .then(
                // When the data arrive:
                tasks => {
                  // Change the states of any tasks, if necessary.
                  return scheduleTasks(op, tasks)
                  .then(
                    // When the changes, if any, have been made:
                    () => {
                      // Get data on the child user stories of the user story, if any.
                      return getCollectionData(data.children.ref, [], [])
                      .then(
                        // When the data arrive:
                        children => {
                          // Process the child user stories.
                          return scheduleTree(
                            op, children.length ? children.map(child => child.ref) : []
                          )
                          .then(
                            /*
                              When the child user stories, if any, have been processed, process
                              the remaining user stories.
                            */
                            () => scheduleTree(op, storyRefs.slice(1)),
                            error => err(error, 'changing schedule states of child user stories')
                          );
                        },
                        error => err(error, 'getting data on child user stories')
                      );
                    },
                    error => err(error, 'changing states of tasks')
                  );
                },
                error => err(error, 'getting data on tasks')
              );
            }
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
exports.scheduleHandle = scheduleHandle;
exports.scheduleTree = scheduleTree;
