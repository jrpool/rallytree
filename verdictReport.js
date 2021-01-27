/*
  verdictReport.js
  Server-side event client script.

  Makes the web page subscribe to server-side events and update
  one of its elements whenever it receives an event.
*/

let eventSource;
let lastEventTime;
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
  console.log('Timing started in browser.');
  // Request an event stream and listen for messages on it.
  eventSource = new EventSource('/verdicttotals');
  listenForMessages(
    eventSource, ['total', 'passes', 'fails', 'defects', 'major', 'minor', 'error']
  );
  // Stop listening after 10 idle seconds, assuming the job complete.
  const poller = setInterval(
    () => {
      if (lastEventTime && Date.now() - lastEventTime > 10000) {
        eventSource.close();
        clearInterval(poller);
        // Report the elapsed time.
        console.log(`Elapsed time: ${Math.round((Date.now() - startTime - 10000) / 1000)} sec.`);
      }
    },
    2000
  );
}, {once: true});
