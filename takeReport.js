/*
  takeReport.js
  Server-side event client script.

  Makes the web page subscribe to server-side events and update
  one of its elements whenever it receives an event.
*/

const eventSource = new EventSource('/taketotals');
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
const listenForMessages = eventIDs => {
  eventIDs.forEach(eventID => {
    eventSource.addEventListener(eventID, event => {
      handleMessage(event, eventID);
    });
  });
};
document.addEventListener('DOMContentLoaded', () => {
  // Request an event stream and listen for messages on it.
  listenForMessages(
    'total', 'storyTotal', 'taskTotal', 'changes', 'storyChanges', 'taskChanges', 'error'
  );
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
