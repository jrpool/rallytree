/*
  script.js
  Server-side event client script.

  This script makes the web page subscribe to server-side events
  and update one of its elements whenever it receives an event.
*/

let eventSource;
let lastEventTime;
// Handles a message event.
const messageHandler = (event, type) => {
  const data = event.data;
  if (data) {
    document.getElementById(type).textContent = event.data;
    lastEventTime = Date.now();
  }
};
document.addEventListener('DOMContentLoaded', () => {
  eventSource = new EventSource('/totals');
  // Listen for message events.
  eventSource.addEventListener('total', event => {
    messageHandler(event, 'total');
  });
  eventSource.addEventListener('changes', event => {
    messageHandler(event, 'changes');
  });
  // Stop listening after 3 seconds idling, assuming the job will be complete.
  const poller = setInterval(
    () => {
      if (lastEventTime && Date.now() - lastEventTime > 3000) {
        eventSource.close();
        clearInterval(poller);
      }
    },
    1000
  );
}, {once: true});
