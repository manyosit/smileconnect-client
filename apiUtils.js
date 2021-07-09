const path = require('path');
const log = require('@manyos/logger').setupLog('SMILEconnect_' + path.basename(__filename));
const ssoUtils = require('./ssoUtils')
const fetch = require('node-fetch')
const http = require('https');
const httpAgent = new http.Agent();
httpAgent.maxSockets = 5;

function getOptions(method, token, body) {
    const options = {
        method: method,
        mode: 'cors',
        cache: 'no-cache',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        }
    };
    return options;
}

async function doApiRequest(url, method, data) {

    log.debug('Start API Request')
    url = process.env.SMILECONNECT_URL + url
    const token = await ssoUtils.getAccessToken()
    const options = getOptions(method, token, {data})
    log.debug('Prepared API Request', url, options)
    const fetchResponse = await fetch(url, options);
    log.debug('Fetched API Request', url, options)
    log.debug('Got Response Code', fetchResponse.status)
    return await fetchResponse.json()
}

module.exports = {
    doApiRequest
}