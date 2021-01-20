# rallytree
Automation of Rally work-item tree management.

# Introduction
RallyTree automates some operations on trees of work items in [Rally](https://www.broadcom.com/products/software/agile-development/rally-software). 

# Features
RallyTree can perform these operations on a tree:

## Tree-copy creation
This feature copies a tree. You designate an existing user story as the parent of the root user story of the new tree. That parent must not have any tasks and must not be in the tree that you are copying. Only user stories, optionally with their tasks and/or test cases, are copied, but not defects. In a copy of a user story, task, or test case, the name, owner, rank, and description are copied from the original.

## Test-result acquisition
This feature tallies the passing and failing results of the last runs of all the test cases, and the counts of defects, major defects, and minor defects, in a tree.

## Owner change
This feature ensures that each user story, task, and test case in a tree has the desired owner. You can choose whether to become the new owner or instead to specify another user as the new owner.

## Project change
This feature ensures that each user story in a tree belongs to the desired project. Changing the project of a user story also makes its tasks and test cases belong to the same project. (In the rare case in which a user story already belongs to the desired project, but it has any tasks or test cases belonging to no or other projects, their project affiliations will not be changed.) Because each change of a user story’s project can trigger multiple automatic changes by Rally, this operation tends to be slower than the others. You may need to wait up to about 15 seconds before concluding that the operation has finished.

## Scheduling
This feature assigns a release, an iteration, and optionally a schedule state to each schedulable user story in a tree. A user story is schedulable if it has no child user stories.

## Task creation
This feature adds tasks to each user story with no child user stories in a tree. You can choose how many tasks to add to each user story and give a name to each task.

## Test-case creation
This feature adds test cases to a tree’s user stories that have no child user stories. Generally, each such user story acquires one test case, to which it gives its name, description, and owner. However, the counts and names of test cases can be customized. You can also specify a test folder and/or a test set that the test cases will all belong to.

## Result creation
This feature creates passing results for all test cases of user stories in a tree, except for test cases that already have results or that have no owner. If a test case is in any test sets, the result is defined as belonging to the first of those test sets. You can specify a build and a note to be applied to all of the new results. Whoever is the owner of the test case is defined as the tester of the result.

## Documentation
This feature produces a JSON representation of a tree of user stories.

# Customization

## Test-case creation
To customize test-case creation, maintain a file named `caseData.js` in a top-level directory named `data` in your local repository. In that file, define a variable named `caseData` as follows:

```javascript
exports.caseData = {
  'User story name 0': [
    'Test case name 0',
    'Test case name 1',
    'Test case name 2'
  ],
  'User story name 1':[
    'Test case name 1'
  ]
};
```

The `caseData` object can have any user-story names as property keys. For each such key, you may specify 1 or more test-case names. If any user story has that name and is eligible for test-case creation (i.e. has no child user stories), RallyTree will create test cases with those names for that user story. For any eligible user story whose name is not in `caseData`, RallyTree will create only 1 test case, and it will have the same name as the user story.

# Architecture
RallyTree is a `node.js` application that can be installed locally. It creates a web server running on `localhost:3000`.

Once it is running, visiting `localhost:3000` with a web browser gets an informational page, which contains a link to a request page. Filling the form out on the request page and submitting the form makes the server serve a report page. The report page, in turn, submits a new request that causes the server to:

- create a server-sent-event stream
- perform the form’s requested operation on the specified tree
- while processing work items, keep sending new events to the client that update the total(s)

The report page displays the new counts as they arrive from the server.

If an error occurs, including an error arising from your request form being improperly completed, an error message is displayed on the report page.

RallyTree gives instructions to Rally by means of Rally’s [web-services API](https://rally1.rallydev.com/slm/doc/webservice/), using Rally’s `node.js` integration package, [`rally-node`](https://github.com/RallyTools/rally-node).

The core functionality of RallyTree is performed by the functions `takeTree()`, `taskTree()`, `caseTree()`, and `copyTree()` in the `index.js` file. These functions recursively perform operations on a specified user story and its applicable descendants.

# Asynchronicity

## Design
The Rally operations are asynchronous, so operations on sets of work items can, in principle, occur in parallel. For example, if a user story has 6 child user stories, an operation can be requested on each of the 6 children, and Rally can perform those 6 operations in parallel.

When operations are performed in parallel, the order of the operations is not forecastable, and it cannot be foreknown which operation will be the last one. Therefore, RallyTree is not designed to (1) process a request and then (2) serve the report page after it is fulfilled. Instead, RallyTree is designed to (1) immediately serve the report page, (2) let the report page request an operation on a tree, (3) perform the operation, and (4) incrementally send new totals to the report page as they occur. The report page displays the totals and updates them as new totals arrive. When the user sees that a few seconds has passed without the total(s) being updated, the user knows that the process is finished. Rally takes enough time for dependency processing and synchronization that you should wait until about 15 seconds has passed without any updates, before you conclude that an operation has ended.

The documentation operation differs from the others in this respect. Its output can be voluminous. Updating it on every increment would annoy users and slow the result. Therefore, this operation outputs a result only if no subsequent result emerges within 1.5 seconds. Under normal conditions, there is only one (final) output from the documentation operation.

## Limitations
Asynchronicity in RallyTree has limitations. Some theoretically independent operations are not in fact independent. Errors can be thrown, for example, when:

- A child user story is updated while its parent user story is being updated.
- A test case is linked to a user story while another test case is being created.
- A user story is linked to a parent while another user story is linked to the same parent.

These are concurrency conflicts. The errors that they throw are sometimes misleading, such as

```
Not authorized to perform action: Invalid key
```

In other cases they correctly point to asynchronicity problems, such as

```
Error copying user story: Concurrency conflict:
[Object has been modified since being read for update in this context]
```

[According to Broadcom](https://community.broadcom.com/enterprisesoftware/communities/community-home/digestviewer/viewthread?GroupId=2437&MessageKey=a41c7c1b-f37b-4eb3-9647-b8d518341f86&CommunityKey=f303f769-8d4c-44d9-924c-3845bba6444e&tab=digestviewer&ReturnUrl=%2Fenterprisesoftware%2Fcommunities%2Fcommunity-home%2Fdigestviewer%3FCommunityKey%3Df303f769-8d4c-44d9-924c-3845bba6444e), truly independent requests can be made at any rate without causing errors, because they are queued if they arrive faster than the 24-requests-at-once limit.

But [Broadcom acknowledges](https://knowledge.broadcom.com/external/article?articleId=77114) that interdependent requests will throw concurrency-conflict errors if they are made too rapidly in succession.

## Adaptation

RallyTree adapts to these limitations by performing operations in parallel when this is reliable, but sequentially when not.

In the above-cited knowledge-base article, Broadcom also suggests other adaptations, including:

- trapping errors and retrying operations until they succeed
- restricting all requests to a single host in its server cluster

There are three branches of the `rallytree` project:

- `master`: the main and default branch, documented here.
- `retry`: a branch that offers two alternative adaptations on the creation operations (task, test-case, and tree-copy). In addition to the sequential adaptation described above, this branch offers a trap-and-retry adaptation. The application tries a step up to 30 times before giving up.
- `pause`: a branch identical to `retry`, except that it that waits 1 second between tries.

Testing shows that the optional adaptations in the `retry` and `pause` branches often fail. Therefore, the `master` branch implements only the sequential adaptation.

The `retry` and `pause` branches contain the features of version 1.1.0. All features introduced in more recent versions are available only in the `master` branch.

RallyTree does not yet implement the single-host accommodation.

Concurrency errors have not occurred in the test-result-acquisition operation, where the Rally data are read but not modified. Those operations are performed in parallel whenever possible. This observation should also apply to the documentation operation, but in fact concurrency conflicts occur when it is performed in parallel.

# Installation and usage
To install and use RallyTree:

- Clone it.
- Make its directory the current directory.
- Install dependencies with `npm install`.
- If you want your Rally username and Rally password to be automatically filled in on the request form, create a file named .env in the current directory and populate that file with these two lines (replacing the placeholders with your actual email address and password):

   - RALLY_USERNAME=xxx@yyy.zzz
   - RALLY_PASSWORD=xyzxyzxyz

- Run the application with `node index`. This opens the introduction page in your default web browser.
- Follow the instructions to specify the operation you want performed.

# Support
Please report bugs, comments, feature suggestions, and questions to Jonathan Pool (jonathan.pool@cvshealth.com).

# Version notes

Version 1.4.3 liberalizes the validity criteria of the ownership-change operation. The operation previously treated user stories with test cases and no tasks as invalid. This version treats them as valid.

Version 1.4.2 adds an option to the copy operation: copying user stories and test cases, but not tasks. This version also corrects a bug in version 1.4.1 that mislocated copied work items.

Version 1.4.1 makes all user stories, tasks, and test cases in a tree copy inherit the project affiliation of the user story designated as the parent of the copy root. Previously they were affiliated with the user’s default project. This change is believed to fit the most common use cases, but, if necessary, the project affiliation of the items in the tree copy can be changed with the project-change operation.

Version 1.4.0 adds the project-change operation.

Version 1.3.9 adds to the scheduling report a count of the schedulable user stories. This allows you to check for the possibility that the scheduling operation prematurely stops and, if so, to redo the operation. Such premature stops and thrown errors are observed occasionally. Because they are not consistent, it is surmised that they arise from connection terminations or synchronization failures by the Rally servers.

Version 1.3.8 reorders the operations on the request page, placing the copy operation first (as the default) and the documentation operation last. Previously documentation was first and copying was last. This change fulfills a request from users based on which operation they most often and least often use.

Version 1.3.7 makes the implementation of the test-case-creation operation conform to the documentation. Previously the operation was incapable of creating more than 2 custom test cases per user story. In this version, the operation can create arbitrarily many test cases per user story.

Version 1.3.6 corrects a defect in the logic of the scheduling operation. The operation previously assumed that release and iteration formatted IDs are globally unique, although in fact they are only project-unique. Multiple projects can have a release named “2021.PI4”, for example. Specifying a release or iteration could cause RallyTree to find one in a different project, and then Rally would refuse to assign it to a user story.

Version 1.3.5 further generalizes the schedule-state property, adding “Completed” as an option.

Version 1.3.4 generalizes the option in the scheduling operation to set a schedule state. Instead of only “Defined”, you can now choose to set the schedule state to “In-Progress”, if you set it at all.

Version 1.3.3 adds the ownership restriction to the creation of test-case results. This permits the user to exclude test cases that have not been considered because somebody else will run them, by making those test cases ownerless before creating results. (This handles the case in which successive testers make themselves owners of test cases they will test. The operation will need to be made more configurable in order to handle the case in which a tree’s test cases are given multiple owners in advance and only one owner’s test cases need results created.)

Version 1.3.2 corrects a defect by using the `open` package to make the opening of the introduction page cross-platform.

Version 1.3.1 adds to the scheduling operation the option to put each scheduled user story into the “Defined” schedule state.

Version 1.3.0 adds the scheduling operation.

Version 1.2.4 removes the service of the introduction page from Node. Rather than serving the page, the application spawns a shell that opens the page with the default browser. This eliminates concurrency errors that occasionally arose when the application attempted to serve the PNG file on the introduction page and prunes some functions from the `index.js` file.

Version 1.2.3 changes how the tester of a created result is defined. Originally the current user was made the tester. In this version, the owner of the test case is made the tester.

Version 1.2.2 makes the ownership-change operation sequential. It was originally performed in parallel, but concurrency conflicts occasionally occurred.

Version 1.2.1 changes the rule for recognizing a defect during test-result acquisition. In previous versions defects were discovered when they belonged to user stories. However, current CVS Health practice attaches defects only to test cases, not to the user stories that the test cases are attached to. Version 1.2.1 recognizes defects according to this rule. In addition, version 1.2.1 embodies a pervasive refactoring of the code.

Version 1.2.0 adds the result-creation operation.

Version 1.1.9 adds customization to test-case creation.

Version 1.1.8 adds test cases to the work-item types that the user may choose to copy.

Version 1.1.7 adds tasks to the work-item types that are subject to ownership change.

Version 1.1.6 adds task counts to the tree-documentation report.

Version 1.1.5 makes the report of ownership changes more detailed, itemizing the changes by work-item type.

Version 1.1.4 offers the option to include tasks when copying a tree.

Version 1.1.3 offers the option to identify a test set and associate each new test case with it.

Version 1.1.2 adds test-case counts to the tree-documentation report, and adds tallies of defect severities to the test-result report.

Version 1.1.1 adds rank to the properties of a user story that are copied from the original, when a tree is copied. This makes the user stories of the copy appear in the same order as the originals when the tree display is ordered by rank.

Version 1.1.0 (in the `master` branch) removes the “retry” accommodation, improves the diagnostic specificity of error messages, and makes the request page more compact.

Version 1.0.9 changes the method by which the user specifies a user story or test folder. Previously the user entered a URL, which could vary in format and become very long. Now the user enters a formatted ID, such as “US379495” or “TF5775”.

Version 1.0.8 adds the ability to make new test cases belong to a specified test folder.

Version 1.0.7 makes two improvements over version 1.0.6:

- The URL of a user story no longer needs to have its basic minimal format. It can now also be one of the longer URLs associated with a user story, such as when the user story is displayed in a filtered search output.
- A defect in the application logic that caused some user stories to be overlooked has been corrected.
