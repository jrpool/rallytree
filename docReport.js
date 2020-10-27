/*
  docReport.js
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
    document.getElementById(type).textContent = event.data.replace(
      /<br>/g, '\n'
    );
    lastEventTime = Date.now();
  }
};
document.addEventListener('DOMContentLoaded', () => {
  // Request an event stream.
  eventSource = new EventSource('/doc');
  // Listen for message events.
  eventSource.addEventListener('doc', event => {
    messageHandler(event, 'doc');
  });
  eventSource.addEventListener('error', event => {
    messageHandler(event, 'error');
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