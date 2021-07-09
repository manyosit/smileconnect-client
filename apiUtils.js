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

async function doApiRequest(urlString, method, options, data) {
    log.debug('Start API Request')
    //url = process.env.SMILECONNECT_URL + url
    const url = new URL(process.env.SMILECONNECT_URL + urlString);
    //handle options
    if (options) {
        if (options.clientId) {
            url.searchParams.append('clientId', options.clientId)
        }
    }


    
    const token = await ssoUtils.getAccessToken()
    const fetchOptions = getOptions(method, token, {data})
    log.debug('Prepared API Request', url, fetchOptions)
    const fetchResponse = await fetch(url, fetchOptions);
    log.debug('Fetched API Request', url, fetchOptions)
    log.debug('Got Response Code', fetchResponse.status)
    return await fetchResponse.json()
}

module.exports = {
    doApiRequest
}