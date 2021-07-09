const path = require('path');
const log = require('@manyos/logger').setupLog('SMILEconnect_' + path.basename(__filename));
const { Issuer } = require('openid-client');
const fs = require('fs');
let tokenSet = null;
let apiClient = null;

function getAccessToken() {
    log.debug('get sso token');
    return new Promise((resolve, reject) => {
        //todo check if refresh token is expired
        if (tokenSet == null || tokenSet == undefined || tokenSet.expired() === true) {
            log.debug('start grant', apiClient);
            apiClient
                .grant({
                    grant_type: "client_credentials"
                })
                .then(newToken => {
                    log.debug('got tokenset after grant', newToken);
                    tokenSet = newToken;
                    resolve(tokenSet.access_token);
                });
        } else if (tokenSet.expired() === true) {
            log.debug('refresh token');
            apiClient.refresh(tokenSet).then(newToken => {
                log.debug('got tokenset after refresh', newToken);
                tokenSet = newToken;
                resolve(tokenSet.access_token);
            }).catch( error => {
                //try another grant if expired
                apiClient
                    .grant({
                        grant_type: "client_credentials"
                    })
                    .then(newToken => {
                        log.debug('got tokenset after grant', newToken);
                        tokenSet = newToken;
                        resolve(tokenSet.access_token);
                    });
            });
        } else if (tokenSet != null && tokenSet != undefined && tokenSet.expired() === false) {
            log.debug('got valid token from cache', tokenSet);
            resolve(tokenSet.access_token);
        } else {
            reject('Could not get token');
        }
    });
}

function setupClient(id, secret) {
    if (process.env.ISAPI_SSO_MANUAL==='TRUE') {
        const rawdata = fs.readFileSync('conf/ssoManualConfig.json');
        const manualConfig = JSON.parse(rawdata);

        const ssoIssuer = new Issuer(manualConfig);
        const client = new ssoIssuer.Client({
            client_id: id,
            client_secret: secret
        }); // => Client
        apiClient = client;
    } else {
        Issuer.discover(process.env.SSO_URL) // => Promise
            .then(function (ssoIssuer) {
                log.debug('Discovered issuer %s %O', ssoIssuer.issuer, ssoIssuer.metadata);
                const client = new ssoIssuer.Client({
                    client_id: id,
                    client_secret: secret
                }); // => Client
                apiClient = client;
            });
    }
}

module.exports = {
    getAccessToken,
    setupClient
};