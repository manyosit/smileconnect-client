const path = require('path');
const log = require('@manyos/logger').setupLog('SMILEconnect_' + path.basename(__filename));
const { Issuer } = require('openid-client');
const fs = require('fs');

// a token is renewed this many seconds before it expires (at most half of its lifetime)
const EXPIRY_MARGIN = 30;

/**
 * One SSO session per set of credentials: credentials, openid client and token belong together.
 */
class SsoSession {
    constructor(clientId, clientSecret, ssoUrl) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.ssoUrl = ssoUrl;
        this.tokenSet = null;
        this.expiryMargin = 0;
        this.apiClient = null;
        this.pendingSetup = null;
        this.pendingGrant = null;
    }

    // parallel calls share one discovery instead of each asking the identity provider
    async setup() {
        if (this.apiClient) {
            return this.apiClient;
        }
        if (!this.pendingSetup) {
            this.pendingSetup = this.discover().finally(() => {
                this.pendingSetup = null;
            });
        }
        return this.pendingSetup;
    }

    async discover() {
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

    // valid for longer than the margin; a token without expiry stays valid
    tokenIsFresh() {
        if (this.tokenSet == null || !this.tokenSet.access_token) {
            return false;
        }
        if (typeof this.tokenSet.expires_at !== 'number') {
            return true;
        }
        return this.tokenSet.expires_at - Math.floor(Date.now() / 1000) > this.expiryMargin;
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

        if (!this.tokenIsFresh()) {
            // parallel calls share one grant instead of each asking the identity provider
            if (!this.pendingGrant) {
                this.pendingGrant = this.apiClient
                    .grant({
                        grant_type: "client_credentials"
                    })
                    .then(tokenSet => {
                        this.tokenSet = tokenSet;
                        const lifetime = typeof tokenSet.expires_at === 'number'
                            ? tokenSet.expires_at - Math.floor(Date.now() / 1000) : 0;
                        this.expiryMargin = Math.max(0, Math.min(EXPIRY_MARGIN, Math.floor(lifetime / 2)));
                        this.pendingGrant = null;
                    }, error => {
                        this.pendingGrant = null;
                        throw error;
                    });
            }
            await this.pendingGrant;
        }

        if (this.tokenIsFresh()) {
            log.debug('got valid token from cache');
            return this.tokenSet.access_token;
        } else {
            throw ('Could not get token');
        }
    }
}

// Clients with the same credentials share one session (and token), like the module wide token of 1.9.2.
const sessions = new Map();

function getSession(clientId, clientSecret, ssoUrl) {
    const key = JSON.stringify([clientId, clientSecret, ssoUrl]);
    let session = sessions.get(key);
    if (!session) {
        session = new SsoSession(clientId, clientSecret, ssoUrl);
        sessions.set(key, session);
    }
    return session;
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
    defaultSession = getSession(id, secret, ssoUrl);
    return defaultSession.setup();
}

module.exports = {
    getAccessToken,
    setupClient,
    setDefaultSession,
    getSession,
    SsoSession
};
