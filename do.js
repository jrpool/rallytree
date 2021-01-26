// Module to keep secrets local.
require('dotenv').config();
// Module to make HTTPS requests.
const https = require('https');
// Request options
const options = {
  hostname: 'rally1.rallydev.com',
  port: 443,
  path: '/slm/webservice/v2.0/user/1',
  method: 'GET',
  auth: `${process.env.RALLY_USERNAME}:${process.env.RALLY_PASSWORD}`,
  headers: {
    'X-RallyIntegrationName':
    process.env.RALLYINTEGRATIONNAME || 'RallyTree',
    'X-RallyIntegrationVendor':
    process.env.RALLYINTEGRATIONVENDOR || '',
    'X-RallyIntegrationVersion':
    process.env.RALLYINTEGRATIONVERSION || '1.0.4'
  }
};
// Make an erroneous request in order to get a cookie identifying the server.
const request = https.request(options, response => {
  console.log('Request made.');
  response.on('end', () => {
    const receivedCookie = response.headers['set-cookie'];
    console.log(`Received cookie:\n${JSON.stringify(receivedCookie, null, 2)}`);
  });
});
request.on('error', error => {
  console.error(error);
});
request.end();
