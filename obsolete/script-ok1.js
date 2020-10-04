/*
  script.js
  Server-side event client script.

  This script makes the web page subscribe to server-side events
  and update one of its elements whenever it receives an event.
*/

let totalSource;
document.addEventListener('DOMContentLoaded', () => {
  eventSource = new EventSource('/totals');
});
let lastTotalTime;

// Handles a message event.
const totalHandler = event => {
  document.getElementById('total').textContent = event.data;
  lastTotalTime = Date.now();
};

// Listen for message events.
eventSource.onmessage = totalHandler;
// Stop listening after 3 seconds idling, assuming the job will be complete.
console.log('About to create poller.');
const poller = setInterval(
  () => {
    console.log('Server-sent event source being polled.');
    if (lastTotalTime && Date.now() - lastTotalTime > 3000) {
      eventSource.close();
      console.log('Server-sent event source closed.');
      clearInterval(poller);
    }
  },
  1000
);
