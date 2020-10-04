/*
  script.js
  Server-side event client script.

  This script makes the web page subscribe to server-side events
  and update one of its elements whenever it receives an event.
*/

// ########## GLOBAL VARIABLES
let totalSource;
document.addEventListener('DOMContentLoaded', () => {
  totalSource = new EventSource('/totals');
});
// const totalSource = new EventSource('/totals');
let lastTotalTime;

// ########## FUNCTIONS

// Handles a message event.
const totalHandler = event => {
  document.getElementById('total').textContent = event.data;
  lastTotalTime = Date.now();
};

// Listen for message events.
totalSource.onmessage = totalHandler;
// Stop listening after 3 seconds idling, assuming the job will be complete.
console.log('About to create poller.');
const poller = setInterval(
  () => {
    console.log('Server-sent event source being polled.');
    if (lastTotalTime && Date.now() - lastTotalTime > 3000) {
      totalSource.close();
      console.log('Server-sent event source closed.');
      clearInterval(poller);
    }
  },
  1000
);
