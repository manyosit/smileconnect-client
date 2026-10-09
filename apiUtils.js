const path = require('path');
const log = require('@manyos/logger').setupLog('SMILEconnect_' + path.basename(__filename));
const ssoUtils = require('./ssoUtils')
const fetch = require('node-fetch')
const http = require('https');
const httpAgent = new http.Agent();
const { v4 } = require('uuid');
const { SmileConnectError, errorMessageFromBody } = require('./errors');

httpAgent.maxSockets = 5;

function getOptions(method, token, body, rawBody) {
    const requestId = v4();
    const options = {
        method: method,
        mode: 'cors',
        cache: 'no-cache',
        headers: {
            'Content-Type': 'application/json',
            'X-Request-Id': requestId
        }
    };
    if (token) {
        options.headers['Authorization'] = 'Bearer ' + token;
    }
    if (rawBody) {
        options.headers['Content-Type'] = rawBody.contentType;
        options.body = rawBody.data;
    } else if (body !== undefined && body !== null) {
        // false, 0 and '' are bodies, too
        options.body = JSON.stringify(body)
    }
    return options;
}

function applyQuery(url, options) {
    if (!options) {
        return;
    }
    if (options.clientId) {
        url.searchParams.append('clientId', options.clientId)
    }
    if (options.impersonateUser) {
        url.searchParams.append('impersonateUser', options.impersonateUser)
    }
    if (options.include) {
        const include = Array.isArray(options.include) ? options.include.join(',') : options.include;
        url.searchParams.append('include', include)
    }
    if (options.limit !== undefined && options.limit !== null) {
        url.searchParams.append('limit', options.limit)
    }
    if (options.offset !== undefined && options.offset !== null) {
        url.searchParams.append('offset', options.offset)
    }
    if (options.query) {
        Object.keys(options.query).forEach(key => {
            const value = options.query[key];
            if (value !== undefined && value !== null) {
                url.searchParams.append(key, value)
            }
        })
    }
}

function parseBody(text) {
    if (text === undefined || text === null || text === '') {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        return text;
    }
}

// The name comes from the server and is meant to be used as a file name: only the last path segment,
// without ':' (drive letters, alternate data streams) and control characters.
function safeFileName(name) {
    const base = String(name).split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f:]/g, '_').trim();
    return base === '' || base === '.' || base === '..' ? undefined : base;
}

function fileNameFromHeaders(headers) {
    const disposition = headers.get('content-disposition');
    if (!disposition) {
        return undefined;
    }
    // filename* (RFC 5987, percent encoded) wins over filename
    const extended = /filename\*\s*=\s*([^']*)'[^']*'("[^"]*"|[^;]*)/i.exec(disposition);
    if (extended) {
        const value = extended[2].trim().replace(/^"|"$/g, '');
        try {
            return safeFileName(decodeURIComponent(value));
        } catch (e) {
            return safeFileName(value);
        }
    }
    // quoted name may contain ; and \" ; unquoted ends at ;
    const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/i.exec(disposition);
    if (!plain) {
        return undefined;
    }
    if (plain[1] !== undefined) {
        return safeFileName(plain[1].replace(/\\(.)/g, '$1'));
    }
    return safeFileName(plain[2].trim());
}

/**
 * Generic request used by the client.
 * spec: {url, method, options, data, rawBody, getToken, auth, throwOnError, response}
 *  - auth=false: no token (health, openapi)
 *  - response: 'json' (default), 'lenient' (text that is no JSON allowed) or 'binary' (file download).
 *    An empty body resolves to null in every mode but 'binary'.
 */
async function request(spec) {
    const options = spec.options;
    const throwOnError = spec.throwOnError === true;
    const url = new URL(spec.url);
    applyQuery(url, options);

    let token;
    if (spec.auth !== false) {
        try {
            token = await spec.getToken();
            if (!token) {
                // a request without Authorization would only come back as 401 and hide the cause
                throw new Error(`no access token: the token source returned ${token === '' ? 'an empty string' : String(token)}`);
            }
        } catch (error) {
            if (throwOnError) {
                const message = error && error.message ? error.message : String(error);
                throw new SmileConnectError(`SMILEconnect could not get a token for ${spec.method} ${url}: ${message}`, {
                    url: url.toString(),
                    method: spec.method,
                    code: error && error.code,
                    cause: error
                });
            }
            throw error;
        }
    }
    const fetchOptions = getOptions(spec.method, token, spec.data, spec.rawBody)
    log.debug('Prepared API Request', url.toString())

    let fetchResponse;
    try {
        fetchResponse = await fetch(url, fetchOptions);
    } catch (error) {
        if (throwOnError) {
            throw new SmileConnectError(`SMILEconnect request ${spec.method} ${url} failed: ${error.message}`, {
                url: url.toString(),
                method: spec.method,
                code: error.code,
                cause: error
            });
        }
        throw error;
    }
    log.debug('Got Response Code', fetchResponse.status)

    const mode = spec.response || 'json';
    let buffer;
    let text;
    try {
        if (mode === 'binary') {
            buffer = await fetchResponse.buffer();
        } else {
            text = await fetchResponse.text();
        }
    } catch (error) {
        if (throwOnError) {
            throw new SmileConnectError(`SMILEconnect request ${spec.method} ${url} failed: ${error.message}`, {
                status: fetchResponse.status,
                url: url.toString(),
                method: spec.method,
                code: error.code,
                cause: error
            });
        }
        throw error;
    }

    let body;
    if (mode === 'binary') {
        if (fetchResponse.ok) {
            return {
                data: buffer,
                fileName: fileNameFromHeaders(fetchResponse.headers),
                contentType: fetchResponse.headers.get('content-type'),
                status: fetchResponse.status
            };
        }
        body = parseBody(buffer.toString('utf8'));
    } else if (text === '') {
        // e.g. 204: the call worked, there is just nothing to return
        body = null;
    } else {
        try {
            body = JSON.parse(text);
        } catch (error) {
            if (mode === 'json' && !throwOnError) {
                // behaviour of version 1.9.2 (fetchResponse.json())
                throw new fetch.FetchError(`invalid json response body at ${fetchResponse.url} reason: ${error.message}`, 'invalid-json');
            }
            if (mode === 'json' && fetchResponse.ok) {
                // e.g. the login page of a proxy: no API answer, although the status says so
                throw new SmileConnectError(
                    `SMILEconnect API answered ${fetchResponse.status} without JSON on ${spec.method} ${url}: ${errorMessageFromBody(text)}`,
                    {status: fetchResponse.status, body: text, url: url.toString(), method: spec.method}
                );
            }
            body = text;
        }
    }

    if (!fetchResponse.ok) {
        const detail = errorMessageFromBody(body);
        if (throwOnError) {
            throw new SmileConnectError(
                `SMILEconnect API error ${fetchResponse.status} on ${spec.method} ${url}` + (detail ? `: ${detail}` : ''),
                {status: fetchResponse.status, body, url: url.toString(), method: spec.method}
            );
        }
        if (mode === 'binary') {
            // no data key, so that a failed download cannot be mistaken for a file
            return {status: fetchResponse.status, error: detail || `HTTP ${fetchResponse.status}`, body};
        }
    }
    return body;
}

// Function of version 1.9.2, still available.
async function doApiRequest(urlString, method, options, data) {
    log.debug('Start API Request')
    return request({
        url: urlString,
        method,
        options,
        data,
        getToken: ssoUtils.getAccessToken,
        throwOnError: !!(options && options.throwOnError === true)
    });
}

module.exports = {
    doApiRequest,
    request
}
