const path = require('path');
const log = require('@manyos/logger').setupLog('SMILEconnect_' + path.basename(__filename));
const { Issuer, errors} = require('openid-client');
const fs = require('fs');
let tokenSet = null;
let apiClient = null;
let clientId, clientSecret, clientSsoUrl = null;

async function getAccessToken() {
    log.debug('get sso token');
    if (!apiClient) {
        log.debug('SSO Client not ready. Try to reconnect in SMILEConnect Adapter');
        await setupClientInt();
    }

    //todo check if refresh token is expired
    if (!apiClient) {
        throw ('SSO Client not ready. Cannot get token');
    } else {
        if (tokenSet == null || tokenSet.expired() === true) {
            log.debug('start grant', apiClient);
            tokenSet = await apiClient
                .grant({
                    grant_type: "client_credentials"
                });
        } else if (tokenSet.expired() === true) {
            log.debug('refresh token');
            let newToken
            try {
                newToken = await apiClient.refresh(tokenSet);
                log.debug('got tokenset after refresh', newToken);
                tokenSet = newToken;
            } catch(error) {
                //try another grant if expired
                newToken = await apiClient
                    .grant({
                        grant_type: "client_credentials"
                    });
                log.debug('got tokenset after grant', newToken);
                tokenSet = newToken;
            }
        }

        if (tokenSet != null && tokenSet.expired() === false) {
            log.debug('got valid token from cache', tokenSet);
            return tokenSet.access_token;
        } else {
            throw ('Could not get token');
        }
    }
}

async function setupClient(id, secret, ssoUrl) {
    clientId = id;
    clientSecret = secret;
    clientSsoUrl = ssoUrl;
    return setupClientInt()
}

async function setupClientInt() {

    if (process.env.ISAPI_SSO_MANUAL==='TRUE') {
        const rawdata = fs.readFileSync('conf/ssoManualConfig.json');
        const manualConfig = JSON.parse(rawdata);

        const ssoIssuer = new Issuer(manualConfig);
        const client = new ssoIssuer.Client({
            client_id: clientId,
            client_secret: clientSecret
        }); // => Client
        apiClient = client;
    } else {
        try {
            const ssoIssuer = await Issuer.discover(clientSsoUrl) // => Promise
            log.debug('Discovered issuer %s %O', ssoIssuer.issuer, ssoIssuer.metadata);
            const client = new ssoIssuer.Client({
                client_id: clientId,
                client_secret: clientSecret
            }); // => Client
            apiClient = client;
        } catch (error) {
            log.error ("Can't discover issuer", error)
        }
    }
    return apiClient;
}

module.exports = {
    getAccessToken,
    setupClient
};
