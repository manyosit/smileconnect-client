const path = require('path');
const log = require('@manyos/logger').setupLog('SMILEconnect_' + path.basename(__filename));
const ssoUtils = require('./ssoUtils')
const fetch = require('node-fetch')
const http = require('https');
const httpAgent = new http.Agent();
const { v4 } = require('uuid');
const { SmileConnectError, errorMessageFromBody } = require('./errors');

httpAgent.maxSockets = 5;

function getOptions(method, token, body, rawBody, bodyAsIs) {
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
    } else if (method !== 'GET' && method !== 'HEAD') {
        // bodyAsIs: false, 0 and '' are bodies, too (script endpoints); otherwise as in 1.9.2
        const hasBody = bodyAsIs ? body !== undefined && body !== null : !!body;
        if (hasBody) {
            options.body = JSON.stringify(body)
        }
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
// without ':' (drive letters, alternate data streams), control characters (C0, C1) and bidi controls
// (they can make 'invoice\u202Efdp.exe' look like 'invoiceexe.pdf').
function safeFileName(name) {
    const base = String(name).split(/[\\/]/).pop()
        .replace(/[\x00-\x1f\x7f-\x9f:\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '_').trim();
    return base === '' || base === '.' || base === '..' ? undefined : base;
}

// value of filename* (RFC 5987): UTF-8 or ISO-8859-1, percent encoded
function decodeExtValue(charset, value) {
    if (/^iso-8859-1$/i.test(charset)) {
        return value.replace(/%([0-9a-f]{2})/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
    }
    try {
        return decodeURIComponent(value);
    } catch (e) {
        return value;
    }
}

function fileNameFromHeaders(headers) {
    const disposition = headers.get('content-disposition');
    if (!disposition) {
        return undefined;
    }
    // filename* (RFC 5987, percent encoded) wins over filename
    // the charset has no whitespace, so that a long run of spaces cannot make the match slow
    const extended = /filename\*\s*=\s*([^'\s;]*)'[^']*'("[^"]*"|[^;]*)/i.exec(disposition);
    if (extended) {
        const value = extended[2].trim().replace(/^"|"$/g, '');
        return safeFileName(decodeExtValue(extended[1], value));
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

// code of a network error, also inside an AggregateError (Issuer.discover tries several urls;
// the aggregate-error package is iterable, the built-in one has an errors array)
function errorCode(error) {
    if (!error || typeof error !== 'object') {
        return undefined;
    }
    if (error.code) {
        return error.code;
    }
    let inner = [];
    if (Array.isArray(error.errors)) {
        inner = error.errors;
    } else if (typeof error[Symbol.iterator] === 'function') {
        inner = Array.from(error);
    }
    const first = inner.find(e => e && e.code);
    return first ? first.code : undefined;
}

// an HTML page (proxy, login, gateway) is never an answer of the API
function looksLikeHtml(text) {
    return /^\s*<(!doctype\s+html|html[\s>])/i.test(text);
}

/**
 * Generic request used by the client.
 * spec: {url, method, options, data, rawBody, bodyAsIs, getToken, tokenErrorCause, auth, throwOnError, response}
 *  - auth=false: no token (health, openapi)
 *  - bodyAsIs: send false, 0 and '' as body (otherwise only truthy bodies are sent, as in 1.9.2)
 *  - tokenErrorCause: function that returns the reason behind a token error thrown as string
 *  - response: 'json' (default), 'lenient' (a success answer may be text) or 'binary' (file download).
 *    An empty success body resolves to null in every mode but 'binary'.
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
                // the SSO session throws a plain string (as in 1.9.2) and keeps the reason separately
                const reason = typeof error === 'string' && spec.tokenErrorCause ? spec.tokenErrorCause() : undefined;
                const cause = reason || error;
                const message = (error && error.message ? error.message : String(error)) +
                    (reason && reason.message ? ` (${reason.message})` : '');
                throw new SmileConnectError(`SMILEconnect could not get a token for ${spec.method} ${url}: ${message}`, {
                    url: url.toString(),
                    method: spec.method,
                    code: errorCode(cause),
                    cause
                });
            }
            throw error;
        }
    }
    const fetchOptions = getOptions(spec.method, token, spec.data, spec.rawBody, spec.bodyAsIs === true)
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
    } else {
        let parseError;
        if (text === '') {
            // e.g. 204: the call worked, there is just nothing to return
            body = null;
            if (!fetchResponse.ok) {
                parseError = new SyntaxError('Unexpected end of JSON input');
            }
        } else {
            try {
                body = JSON.parse(text);
            } catch (error) {
                body = text;
                // script endpoints and uploads may answer text on success
                if (mode !== 'lenient' || !fetchResponse.ok || looksLikeHtml(text)) {
                    parseError = error;
                }
            }
        }
        if (parseError) {
            if (!throwOnError) {
                // behaviour of version 1.9.2 (fetchResponse.json())
                throw new fetch.FetchError(`invalid json response body at ${fetchResponse.url} reason: ${parseError.message}`, 'invalid-json');
            }
            if (fetchResponse.ok) {
                // e.g. the login page of a proxy: no API answer, although the status says so
                throw new SmileConnectError(
                    `SMILEconnect API answered ${fetchResponse.status} without JSON on ${spec.method} ${url}: ${errorMessageFromBody(text)}`,
                    {status: fetchResponse.status, body: text, url: url.toString(), method: spec.method}
                );
            }
            // an error status throws below, with the text as body
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
