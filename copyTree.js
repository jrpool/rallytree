// Copies an array of items (tasks or test cases).
const copyItems = (op, itemType, items, storyRef) => {
  const {globals,  err, shorten, report} = op;
  if (items.length && ! globals.isError) {
    const workItemType = ['task', 'testcase'][['task', 'case'].indexOf(itemType)];
    if (workItemType) {
      const firstItem = items[0];
      const firstRef = shorten(workItemType, workItemType, firstItem.ref);
      if (! globals.isError) {
        // Specify properties for the copy of the first item.
        const config = {
          Name: firstItem.name,
          Description: firstItem.description,
          Owner: globals.copyOwnerRef || firstItem.owner,
          DragAndDropRank: firstItem.dragAndDropRank,
          WorkProduct: storyRef
        };
        // If the item is a task and a state has been specified, apply it.
        if (itemType === 'task' && globals.state.task) {
          config.State = globals.state.task;
        }
        // If the item is a test case and thus does not inherit a project, specify one.
        if (itemType === 'case') {
          config.Project = globals.copyProjectRef;
        }
        // Copy the item.
        return globals.restAPI.create({
          type: workItemType,
          fetch: ['_ref'],
          data: config
        })
        .then(
          // When the item has been copied:
          () => {
            report([['total'], [`${itemType}Total`]]);
            // Copy the remaining items.
            return copyItems(op, itemType, items.slice(1), storyRef);
          },
          error => err(error, `copying ${itemType} ${firstRef}`)
        );
      }
      else {
        return Promise.resolve('');
      }
    }
    else {
      return Promise.resolve(err('invalid item type', `copying ${itemType}`));
    }
  }
  else {
    return Promise.resolve('');
  }
};
// Gets data on items (tasks or test cases) and copies them.
const getAndCopyItems = (op, itemType, itemsType, collectionType, data, copyRef) => {
  const {globals, err, getCollectionData} = op;
  // If the original has any specified items and they are to be copied:
  if (
    data[collectionType].count
    && [itemsType, 'both'].includes(globals.copyWhat)
  ) {
    // Get data on the items.
    return getCollectionData(
      data[collectionType].ref, ['Name', 'Description', 'Owner', 'DragAndDropRank'], []
    )
    .then(
      // When the data arrive:
      items => {
        // Copy the items.
        return copyItems(op, itemType, items, copyRef);
      },
      error => err(error, `getting data on ${collectionType}`)
    );
  }
  else {
    return Promise.resolve('');
  }
};
// Recursively copies a tree or subtrees.
const copyTree = (op, storyRefs, parentType, parentRef) => {
  const {globals, err, shorten, report, getItemData, getCollectionData} = op;
  if (storyRefs.length && ! globals.isError) {
    const firstRef = shorten('userstory', 'hierarchicalrequirement', storyRefs[0]);
    if (! globals.isError) {
      // Get data on the first user story.
      return getItemData(
        firstRef,
        ['Name', 'Description', 'Owner', 'DragAndDropRank'],
        ['Children', 'Tasks', 'TestCases']
      )
      .then(
        // When the data arrive:
        data => {
          // If the user story is the specified parent of the tree copy:
          if (firstRef === globals.copyParentRef) {
            // Quit and report this.
            err('Attempt to copy to itself', 'copying tree');
            return '';
          }
          // Otherwise, i.e. if the user story is copiable:
          else {
            // Specify the properties of its copy.
            const properties = {
              Name: data.name,
              Description: data.description,
              Owner: globals.copyOwnerRef || data.owner,
              DragAndDropRank: data.dragAndDropRank,
              Project: globals.copyProjectRef
            };
            properties[parentType === 'story' ? 'Parent' : 'PortfolioItem'] = parentRef;
            if (globals.copyReleaseRef) {
              properties.Release = globals.copyReleaseRef;
            }
            if (globals.copyIterationRef) {
              properties.Iteration = globals.copyIterationRef;
            }
            // The schedule state will be set but may be overridden by task inference.
            if (globals.state.story) {
              properties.ScheduleState = globals.state.story;
            }
            // Copy the user story.
            return globals.restAPI.create({
              type: 'hierarchicalrequirement',
              fetch: ['_ref'],
              data: properties
            })
            .then(
              // When it has been copied:
              copy => {
                report([['total'], ['storyTotal']]);
                const copyRef = shorten('userstory', 'hierarchicalrequirement', copy.Object._ref);
                if (! globals.isError) {
                  // Get data on any test cases and copy them, if required.
                  return getAndCopyItems(op, 'case', 'cases', 'testCases', data, copyRef)
                  .then(
                    // When the test cases, if any, have been copied:
                    () => {
                      // Get data on any tasks and copy them, if required.
                      return getAndCopyItems(op, 'task', 'tasks', 'tasks', data, copyRef)
                      .then(
                        // When the tasks, if any, have been copied:
                        () => {
                          // Get data on the child user stories of the user story.
                          return getCollectionData(data.children.ref, [], [])
                          .then(
                            // When the data arrive:
                            children => {
                              // Process the child user stories, if any.
                              return copyTree(
                                op,
                                children.length ? children.map(child => child.ref) : [],
                                'story',
                                copyRef
                              )
                              .then(
                                // When any have been processed:
                                () => {
                                  // Process the remaining user stories.
                                  return copyTree(op, storyRefs.slice(1), 'story', parentRef);
                                },
                                error => err(error,'processing child user stories')
                              );
                            },
                            error => err(error,'getting data on child user stories')
                          );
                        },
                        error => err(error, 'copying tasks')
                      );
                    },
                    error => err(error, 'copying test cases')
                  );
                }
                else {
                  return '';
                }
              },
              error => err(error, 'copying user story')
            );
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
exports.copyTree = copyTree;