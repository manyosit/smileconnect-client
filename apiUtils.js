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
    } else if (body) {
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
            return decodeURIComponent(value);
        } catch (e) {
            return value;
        }
    }
    // quoted name may contain ; and \" ; unquoted ends at ;
    const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/i.exec(disposition);
    if (!plain) {
        return undefined;
    }
    if (plain[1] !== undefined) {
        return plain[1].replace(/\\(.)/g, '$1');
    }
    return plain[2].trim();
}

/**
 * Generic request used by the client.
 * spec: {url, method, options, data, rawBody, getToken, auth, throwOnError, response}
 *  - auth=false: no token (health, openapi)
 *  - response: 'json' (default), 'lenient' (empty body allowed) or 'binary' (file download)
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
    if (mode === 'json' && !throwOnError) {
        // behaviour of version 1.9.2
        return await fetchResponse.json()
    }

    let result;
    let body;
    try {
        if (mode === 'binary') {
            const buffer = await fetchResponse.buffer();
            if (fetchResponse.ok) {
                result = {
                    data: buffer,
                    fileName: fileNameFromHeaders(fetchResponse.headers),
                    contentType: fetchResponse.headers.get('content-type'),
                    status: fetchResponse.status
                };
            } else {
                body = parseBody(buffer.toString('utf8'));
            }
        } else {
            body = parseBody(await fetchResponse.text());
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

    if (!fetchResponse.ok && throwOnError) {
        const detail = errorMessageFromBody(body);
        throw new SmileConnectError(
            `SMILEconnect API error ${fetchResponse.status} on ${spec.method} ${url}` + (detail ? `: ${detail}` : ''),
            {status: fetchResponse.status, body, url: url.toString(), method: spec.method}
        );
    }
    return result !== undefined ? result : body;
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
