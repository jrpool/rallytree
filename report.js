/*
  report.js
  Server-side event client script.

  Makes the web page subscribe to server-side events and update
  one of its elements whenever it receives an event.
*/

let eventSource;
let lastEventTime;
let __events__;
// Handles a message event.
const handleMessage = (event, type) => {
  const data = event.data;
  if (data) {
    document.getElementById(type).innerHTML = data;
    lastEventTime = Date.now();
  }
};
// Listens for message events.
const listenForMessages = (source, eventIDs) => {
  eventIDs.forEach(eventID => {
    source.addEventListener(eventID, event => {
      handleMessage(event, eventID);
    });
  });
};
// After the DOM has loaded:
document.addEventListener('DOMContentLoaded', () => {
  // Start timing.
  const startTime = Date.now();
  // Request an event stream and listen for messages on it.
  eventSource = new EventSource('__eventSource__');
  listenForMessages(eventSource, __events__);
  // Stop listening after 20 idle seconds, assuming the job complete.
  const poller = setInterval(
    () => {
      if (lastEventTime && Date.now() - lastEventTime > 20000) {
        eventSource.close();
        clearInterval(poller);
        // Report the elapsed time in the browser console.
        console.log(`Elapsed time: ${Math.round((Date.now() - startTime - 20000) / 1000)} sec.`);
      }
    },
    1000
  );
}, {once: true});
