/*
  script.js
  Server-side event client script.

  This script makes the web page subscribe to server-side events
  and update one of its elements whenever it receives an event.
*/

// ########## GLOBAL VARIABLES

const totalSource = new EventSource('/totals');
let lastTotalTime;

// ########## FUNCTIONS

// Handles a message event.
const totalHandler = event => {
  console.log(JSON.stringify(event, null, 2));
  document.getElementById('changes').textContent = event.changes;
  document.getElementById('total').textContent = event.total;
  lastTotalTime = Date.now();
};

// Listen for message events.
totalSource.onmessage = totalHandler;
// Stop listening after 30 seconds, assuming the job will be complete.
const poller = setInterval(
  () => {
    if (Date.now() - lastTotalTime > 3000) {
      totalSource.close();
      clearInterval(poller);
    }
  },
  1000
);
