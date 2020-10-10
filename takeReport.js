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
  // Request an event stream.
  eventSource = new EventSource('/taketotals');
  // Listen for message events.
  eventSource.addEventListener('total', event => {
    messageHandler(event, 'total');
  });
  eventSource.addEventListener('changes', event => {
    messageHandler(event, 'changes');
  });
  // Stop listening after 10 idle seconds, assuming the job complete.
  const poller = setInterval(
    () => {
      if (lastEventTime && Date.now() - lastEventTime > 10000) {
        eventSource.close();
        clearInterval(poller);
      }
    },
    2000
  );
}, {once: true});
