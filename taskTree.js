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
      () => createTasks(storyRef, owner, names.slice(1)),
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
                return taskTree(children.map(child => child.ref))
                .then(
                  // After they are processed, process the remaining user stories.
                  () => taskTree(storyRefs.slice(1)),
                  error => err(error, 'creating tasks for child user stories')
                );
              },
              error => err(error, 'getting data on child user stories')
            );
          }
          // Otherwise, i.e. if the user story has no child user stories:
          else {
            // Create tasks for the user story sequentially.
            return createTasks(firstRef, data.owner, globals.taskNames)
            .then(
              // When they have been created:
              () => {
                if (! globals.isError) {
                  report([['total'], ['changes', globals.taskNames.length]]);
                  // Process the remaining user stories sequentially.
                  return taskTree(storyRefs.slice(1));
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
exports.taskTree = taskTree;
