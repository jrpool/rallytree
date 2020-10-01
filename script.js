/*
  script.js
  Server-side event client script.

  This script makes the web page subscribe to server-side events.
*/

// ########## GLOBAL VARIABLES

const totalSource = new EventSource('/totals');
console.log('EventSource created');
const tallySpan = document.getElementById('tally');

// ########## FUNCTIONS

// Handles a message event.
const totalHandler = event => {
  tallySpan.textContent = JSON.parse(event.data).total;
};
// Listens for message events.
totalSource.addEventListener('total', totalHandler);
