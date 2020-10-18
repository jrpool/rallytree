# rallytree
Automation of Rally work-item tree management.
# Introduction
RallyTree automates some operations on trees of work items in [Rally](https://www.broadcom.com/products/software/agile-development/rally-software). 

# Features
RallyTree can perform these operations on a tree:

## Owner change
This feature ensures that each user story and each task in a tree has the desired owner. You can choose whether to become the new owner or instead to specify another user as the new owner.

## Task creation
This feature adds tasks to each of a tree&rsquo;s user stories that have no child user stories. You can choose how many tasks to add to each user story and give a name to each task.

## Test-case creation
This feature adds a test case to each of a tree&rsquo;s user stories that have no child user stories. The new test case is given the same name, description, and owner as its user story.

## Tree-copy creation
This feature copies a tree. You designate an existing user story as the parent of the root user story of the new tree. That parent must not have any tasks and must not be in the tree that you are copying. Only user stories are copied, not tasks, test cases, or defects. In a copy of a user story, the name, owner, and description are copied from the original.

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

When operations are performed in parallel, the order of the operations is not forecastable, and it cannot be foreknown which operation will be the last one. Therefore, RallyTree is not designed to (1) process a request and then (2) serve the report page after it is finished. Instead, it is designed to (1) immediately serve the report page, (2) let the report page request an operation on a tree, (3) perform the operation, and (4) incrementally send new totals to the report page as they are generated. The report page displays the totals and updates them as new totals arrive. When the user sees that a few seconds has passed without the total(s) being updated, the user knows that the process is finished.

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

Because of these limitations, RallyTree performs operations in parallel when it can, but makes operations sequential when necessary in order to avoid concurrency conflicts. Specifically:

- In `takeTree()`, completion of the ownership change of a user story is awaited before any child user story’s or task’s ownership is changed. But the ownership changes of all of the child user stories or tasks of any user story are performed in parallel.
- In all the operations except ownership change, the child user stories of any user story are processed sequentially.
- In `taskTree()`, if you have more than 1 task added to each user story, they are added sequentially.

The sequential performance of operations makes RallyTree slower than it would be if Rally guaranteed transactional integrity. Speed increases may be possible by means of techniques suggested by Broadcom in its above-cited knowledge-base article.

# Installation and usage
To install and use RallyTree:

- Clone it.
- Make its directory the current directory.
- Install dependencies with `npm install`.
- Run the application with `node index`.
- Follow the instructions.
