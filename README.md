# rallytree
Automation of Rally work-item tree management.

# Introduction
RallyTree automates some operations on trees of work items in [Rally](https://www.broadcom.com/products/software/agile-development/rally-software). 

# Features
RallyTree can perform these operations on a tree:

## Documentation
This feature produces a JSON representation of a tree of user stories.

## Test-result acquisition
This feature reports a tally of the last test-case verdicts and defects in a tree.

## Owner change
This feature ensures that each user story, task, and test case in a tree has the desired owner. You can choose whether to become the new owner or instead to specify another user as the new owner.

## Task creation
This feature adds tasks to each of a tree&rsquo;s user stories that have no child user stories. You can choose how many tasks to add to each user story and give a name to each task.

## Test-case creation
This feature adds test cases to a tree&rsquo;s user stories that have no child user stories. Generally, each such user story acquires one test case, to which it gives its name, description, and owner. However, you can customize the counts and names of created test cases. You can also specify a test folder and/or a test set that the test cases will all belong to.

## Test-case result creation
This feature creates a passing result for each test case in a tree if the test case has no result. The test-case owner is considered the tester.

## Tree-copy creation
This feature copies a tree. You designate an existing user story as the parent of the root user story of the new tree. That parent must not have any tasks and must not be in the tree that you are copying. User stories and, optionally, their tasks, or tasks and test cases, are copied. Defects are not copied. In a copy of a user story task, or test case, the name, owner, and description are copied from the original.

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

When operations are performed in parallel, the order of the operations is not forecastable, and it cannot be foreknown which operation will be the last one. Therefore, RallyTree is not designed to (1) process a request and then (2) serve the report page after it is fulfilled. Instead, RallyTree is designed to (1) immediately serve the report page, (2) let the report page request an operation on a tree, (3) perform the operation, and (4) incrementally send new totals to the report page as they are generated. The report page displays the totals and updates them as new totals arrive. When the user sees that a few seconds has passed without the total(s) being updated, the user knows that the process is finished.

## Limitations
Asynchronicity in RallyTree has limitations. Some theoretically independent operations are not in fact independent. Errors can be thrown, for example, when:

- A child user story is updated while its parent user story is being updated.
- A test case is linked to a user story while another test case is being created.
- A user story is linked to a parent while another user story is linked to the same parent.

These are concurrency conflicts. The errors that they throw are sometimes irrelevant, such as

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

The `retry` branch of this project implements the error-trapping adaptation as an option choosable by the user. The `pause` branch implements it with a 1-second wait between tries. In both cases, up to 30 tries are permitted. However, testing shows that this accommodation often fails. Therefore, the `master` branch does not offer this accommodation option. Development on the `retry` and `pause` branches stopped as of version 1.1.0.

RallyTree does not yet implement the single-host accommodation.

Concurrency errors have not occurred in the first two operations (documentation and test-result acquisition), where the Rally data are read but not modified. Those operations are performed in parallel whenever possible.

# Installation and usage
To install and use RallyTree:

- Clone it.
- Make its directory the current directory.
- Install dependencies with `npm install`.
- Run the application with `node index`.
- Follow the instructions.

# Support
Please report bugs, comments, feature suggestions, and questions to Jonathan Pool (jonathan.pool@cvshealth.com).
