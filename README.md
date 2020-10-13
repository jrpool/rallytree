# rallytree
Automation of Rally work-item tree management.
# Introduction
RallyTree automates some operations on trees of work items in [Rally](https://www.broadcom.com/products/software/agile-development/rally-software). 

# Features
RallyTree can perform these operations on a tree:

## ## Owner change
This feature ensures that each user story and each task in a tree has the desired owner. The user can choose whether to become the new owner or instead to specify another user as the new owner.

## Test-case creation
This feature adds a test case to each test-level user story (i.e. user story with at least 1 task) that doesn’t already have a test case. The new test case is given the same name, description, and owner as its user story. No matter how many tasks a user story has, only 1 test case is created for it.

## Tree-copy creation
This feature copies a tree. The user specifies which user story will be the parent of the root user story of the new tree. Only user stories are copied, not tasks, test cases, or defects. In a copy of a user story, the name, owner, and description are copied from the original.

# Architecture
RallyTree is a `node.js` application that can be installed locally. It creates a web server running on `localhost:3000`.

Once it is running, visiting `localhost:3000` with a web browser gets an informational page, which contains a link to a request page. Filling the form out on the request page and submitting the form makes the server serve a report page. The report page, in turn, automatically submits a new request that causes the server to:

- create a server-sent-event stream
- perform the form’s requested operation on the specified tree
- while processing work items, keep sending new events to the client that update the total(s)

The report page displays the new counts as they arrive from the server.

RallyTree gives instructions to Rally by means of Rally’s [web-services API](https://rally1.rallydev.com/slm/doc/webservice/), using Rally’s `node.js` integration package, [`rally-node`](https://github.com/RallyTools/rally-node).

The core functionality of RallyTree is performed by the functions `takeTree()`, `caseTree()`, and `copyTree()` in the `index.js` file. These functions recursively perform operations on a specified user story and its applicable descendants.

# Asynchronicity

## Design
The Rally operations are asynchronous, so they can, in principle, occur in parallel. For example, if a user story has 6 child user stories, an operation can be requested on each of the 6 children, and Rally can perform those 6 operations in parallel.

In such a case, the exact order of the operations is not forecastable, and it cannot be foreknown which operation will be the last one. Therefore, RallyTree is not designed to (1) process a request and then (2) serve the report page. Instead, it is designed to (1) immediately serve the report page, (2) let the report page request an operation on a tree, (3) perform the operation, and (4) incrementally send new totals to the report page as they are generated. The report page displays the totals and updates them as new totals arrive. When the user sees that a few seconds has passed without the total(s) being updated, the user knows that the process is finished.

# Limitations
Asynchronicity in RallyTree has important limitations. Some theoretically independent operations are not in fact independent. Experimentation reveals that errors can be thrown when:

- A child user story is updated while its parent user story is being updated.
- A test case is linked to a user story while another test case is being created.
- A user story is linked to a parent while another user story is linked to the same parent.

Typically, thrown errors yield irrelevant messages, such as lack of authorization. But sometimes there is an error message pointing to an asynchronicity problem, such as:

```
Error copying user story: Concurrency conflict: [Object has been modified since being read for update in this context] - ConcurrencyConflictException : Modified since read on update : Object Class : com.f4tech.slm.domain.UserStory : ObjectID : 441863343664
```

Broadcom says that `POST` requests are throttled at 24 requests in progress at any time, but that exceeding this limit should merely queue requests, not throw errors.

Because of these limitations, some potentially parallel RallyTree operations are forced to be sequential instead. This makes the fulfillment of a RallyTree request slower than it might otherwise be, in the interest of integrity. Specifically:

- In takeTree(), completion of the ownership change of a user story is awaited before any child user story’s or child task’s ownership is changed. But the user story’s children’s ownerships are then changed in parallel.
- In caseTree(), the child user stories of any user story are processed sequentially.
- In copyTree(), the child user stories of any user story are copied sequentially.

# Installation and usage
To install and use RallyTree:

- Clone it from its temporary repository.
- Make its directory the current directory.
- Install dependencies with npm install.
- Run the application with node index.
- Follow the instructions.

If an error occurs when you are using RallyTree to create test cases, the effect is usually that orphan test cases are created that have not been linked to their user stories. RallyTree can then be run again. Any successfully linked test cases are not recreated, but any test cases that failed to be linked are recreated and linked. After RallyTree runs without error, any surplus orphaned test cases can be deleted in the Rally web interface.
