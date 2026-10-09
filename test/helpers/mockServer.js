const http = require('http');

/**
 * Local mock of SMILEconnect and of the identity provider, on a random port.
 * Nothing leaves the machine.
 *
 * mock.requests         every API request: {method, path, query, headers, body (Buffer), json}
 * mock.tokenRequests    every token request: {clientId, secret}
 * mock.discoveryRequests number of issuer discovery requests
 * mock.handler          function(req) -> {status, body, headers} (body: object/array = JSON, string/Buffer = raw)
 *                       default: 200 {"data":{}}
 */
async function startMock() {
    const mock = {
        requests: [],
        tokenRequests: [],
        discoveryRequests: 0,
        handler: () => ({status: 200, body: {data: {}}}),
        tokenLifetime: 300
    };

    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const url = new URL(req.url, 'http://localhost');
            const raw = Buffer.concat(chunks);

            // identity provider
            if (url.pathname === '/sso/.well-known/openid-configuration') {
                mock.discoveryRequests++;
                return sendJson(res, 200, {
                    issuer: mock.baseUrl + '/sso',
                    token_endpoint: mock.baseUrl + '/sso/token',
                    jwks_uri: mock.baseUrl + '/sso/certs',
                    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post']
                });
            }
            if (url.pathname === '/sso/token') {
                let clientId, secret;
                const auth = req.headers['authorization'];
                if (auth && auth.startsWith('Basic ')) {
                    const parts = Buffer.from(auth.substring(6), 'base64').toString().split(':');
                    clientId = decodeURIComponent(parts[0]);
                    secret = decodeURIComponent(parts.slice(1).join(':'));
                } else {
                    const form = new URLSearchParams(raw.toString());
                    clientId = form.get('client_id');
                    secret = form.get('client_secret');
                }
                mock.tokenRequests.push({clientId, secret});
                return sendJson(res, 200, {
                    access_token: `token-for-${clientId}-${secret}`,
                    token_type: 'Bearer',
                    expires_in: mock.tokenLifetime
                });
            }

            // SMILEconnect API
            const entry = {
                method: req.method,
                path: url.pathname,
                query: Object.fromEntries(url.searchParams.entries()),
                headers: req.headers,
                body: raw,
                json: undefined
            };
            if (raw.length > 0 && (req.headers['content-type'] || '').startsWith('application/json')) {
                try {
                    entry.json = JSON.parse(raw.toString());
                } catch (e) { /* keep undefined */ }
            }
            mock.requests.push(entry);
            const answer = mock.handler(entry) || {};
            const status = answer.status || 200;
            const headers = Object.assign({}, answer.headers);
            let payload = answer.body;
            if (payload === undefined || payload === null) {
                payload = '';
            } else if (typeof payload === 'object' && !Buffer.isBuffer(payload)) {
                payload = JSON.stringify(payload);
                headers['Content-Type'] = headers['Content-Type'] || 'application/json';
            }
            if (answer.destroy) {
                return req.socket.destroy();
            }
            res.writeHead(status, headers);
            res.end(payload);
        });
    });

    function sendJson(res, status, body) {
        res.writeHead(status, {'Content-Type': 'application/json'});
        res.end(JSON.stringify(body));
    }

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    mock.baseUrl = `http://127.0.0.1:${server.address().port}`;
    mock.ssoUrl = mock.baseUrl + '/sso';
    mock.reset = () => {
        mock.requests.length = 0;
        mock.tokenRequests.length = 0;
        mock.discoveryRequests = 0;
        mock.handler = () => ({status: 200, body: {data: {}}});
    };
    mock.last = () => mock.requests[mock.requests.length - 1];
    mock.close = () => new Promise(resolve => server.close(resolve));
    return mock;
}

module.exports = {startMock};
