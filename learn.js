// ########## GLOBAL VARIABLES

const items = ['a', 'b', 'cat', 'doggie'];
const results = [];
const processed = [];

// ########## FUNCTIONS

/*
  Adds an item to the 'processed' array.
  Creates and returns a Promise object with no properties.
  Depending on the length of the item, in 5 seconds the
  Promise object will acquire one of these pairs of properties:
    status: 'fulfilled', value: specified by the 'resolve' function
    status: 'rejected', reason: specified by the 'reject' function
*/

const banLength = item => {
  processed.push(item);
  console.log(`processed has become ${processed}`);
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (item.length > 1) {
        reject(`Item ${item} too long`);
      }
      else {
        resolve(`Item ${item} OK`);
      }
    }, 5000);
  });
};

/*
  Executes 'banLength' for all the items.
  Adds the Promise object that it returns to the 'results' array.
*/

items.forEach(item => {
  console.log(`Running banLength on ${item}`);
  results.push(banLength(item));
});

// Describes the results immediately after creation.
results.forEach(result => {
  console.log(`\nResult type: ${result}`);
  console.log(JSON.stringify(result, null, 2));
  for (const prop in result) {
    console.log(`Result property ${prop} is ${result[prop]}`);
  }
});

/*
  Awaits acquisition of enough properties by the Promise objects
  to decide whether they are all fulfilled, i.e. either of:
    'fulfilled' values of all their 'status' properties
    'rejected' value of any 1 'status' property
  Then reports outcome.
*/

Promise.all(results)
.then(
  values => {
    console.log(`\nPromise.all: fulfilled with ${JSON.stringify(values)}`);
  },
  reasons => {
    console.log(`\nPromise.all: rejected with ${JSON.stringify(reasons)}`);
  }
);

/*
  Awaits acquisition of 'status' values by all the Promise objects
  and reports all their 'status' and either 'value' or 'reason'
  property values.
*/

Promise.allSettled(results)
.then(
  settlements => {
    console.log(
      `\nPromise.allSettled: settled with ${
        JSON.stringify(settlements, null, 2)
      }`
    );
  }
);
