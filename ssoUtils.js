const path = require('path');
const log = require('@manyos/logger').setupLog('SMILEconnect_' + path.basename(__filename));
const { Issuer } = require('openid-client');
const fs = require('fs');

/**
 * One SSO session per client instance: credentials, openid client and token belong together.
 */
class SsoSession {
    constructor(clientId, clientSecret, ssoUrl) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.ssoUrl = ssoUrl;
        this.tokenSet = null;
        this.apiClient = null;
        this.pendingGrant = null;
    }

    async setup() {
        if (process.env.ISAPI_SSO_MANUAL === 'TRUE') {
            const rawdata = fs.readFileSync('conf/ssoManualConfig.json');
            const manualConfig = JSON.parse(rawdata);

            const ssoIssuer = new Issuer(manualConfig);
            this.apiClient = new ssoIssuer.Client({
                client_id: this.clientId,
                client_secret: this.clientSecret
            });
        } else {
            try {
                const ssoIssuer = await Issuer.discover(this.ssoUrl) // => Promise
                log.debug('Discovered issuer %s %O', ssoIssuer.issuer, ssoIssuer.metadata);
                this.apiClient = new ssoIssuer.Client({
                    client_id: this.clientId,
                    client_secret: this.clientSecret
                });
            } catch (error) {
                log.error("Can't discover issuer", error)
            }
        }
        return this.apiClient;
    }

    async getAccessToken() {
        log.debug('get sso token');
        if (!this.apiClient) {
            log.debug('SSO Client not ready. Try to reconnect in SMILEConnect Adapter');
            await this.setup();
        }

        if (!this.apiClient) {
            throw ('SSO Client not ready. Cannot get token');
        }

        if (this.tokenSet == null || this.tokenSet.expired() === true) {
            // parallel calls share one grant instead of each asking the identity provider
            if (!this.pendingGrant) {
                this.pendingGrant = this.apiClient
                    .grant({
                        grant_type: "client_credentials"
                    })
                    .then(tokenSet => {
                        this.tokenSet = tokenSet;
                        this.pendingGrant = null;
                    }, error => {
                        this.pendingGrant = null;
                        throw error;
                    });
            }
            await this.pendingGrant;
        }

        if (this.tokenSet != null && this.tokenSet.expired() === false) {
            log.debug('got valid token from cache');
            return this.tokenSet.access_token;
        } else {
            throw ('Could not get token');
        }
    }
}

// Module level API of version 1.9.2, backed by one shared default session.
let defaultSession = new SsoSession();

async function getAccessToken() {
    return defaultSession.getAccessToken();
}

// Makes the given session the one behind the module functions (like setupClient of 1.9.2:
// the instance created last wins, but only for these module functions).
function setDefaultSession(session) {
    defaultSession = session;
}

async function setupClient(id, secret, ssoUrl) {
    defaultSession = new SsoSession(id, secret, ssoUrl);
    return defaultSession.setup();
}

module.exports = {
    getAccessToken,
    setupClient,
    setDefaultSession,
    SsoSession
};
