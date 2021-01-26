// Module to keep secrets local.
require('dotenv').config();
const { ifError } = require('assert');
// Module to make HTTPS requests.
const https = require('https');
// Rally module.
const rally = require('rally');

const options = {
  hostname: 'rally1.rallydev.com',
  port: 443,
  path: '/slm/webservice/v2.0/hierarchicalrequirement/450279445036/children?fetch=Release',
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

const iterate = (cookie, more) => {
  if (more) {
    more--;
    if (cookie.length) {
      options.headers.cookie = cookie.slice(1, 3).concat(cookie[5]);
    }
    else {
      delete options.cookie;
    }
    const request = https.request(options, response => {
      console.log(`statusCode: ${response.statusCode}`);
      const chunks = [];
      response.on('data', chunk => {
        chunks.push(chunk);
      });
      response.on('end', () => {
        const responseObj = JSON.parse(chunks.join());
        console.log(
          `Result count:\n${JSON.stringify(responseObj.QueryResult.TotalResultCount, null, 2)}`
        );
        const receivedCookie = response.headers['set-cookie'];
        if (! cookie.length) {
          cookie = receivedCookie;
        }
        console.log(`Received cookie:\n${JSON.stringify(receivedCookie, null, 2)}`);
        iterate(cookie, more);
      });
    });
    
    request.on('error', error => {
      console.error(error);
    });
    
    request.end();
  }
};
iterate([], 3);