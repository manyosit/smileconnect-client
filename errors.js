/**
 * Error thrown for failed API calls when `throwOnError` is enabled.
 *
 * status: HTTP status code (undefined for network errors)
 * body:   parsed JSON body of the response (or the raw text if it is not JSON)
 * url:    the requested URL
 */
class SmileConnectError extends Error {
    constructor(message, details) {
        super(message);
        const d = details || {};
        this.name = 'SmileConnectError';
        this.status = d.status;
        this.body = d.body;
        this.url = d.url;
        this.method = d.method;
        if (d.code) {
            this.code = d.code;
        }
        if (d.cause) {
            this.cause = d.cause;
        }
    }
}

function errorMessageFromBody(body) {
    if (body === null || body === undefined) {
        return undefined;
    }
    if (typeof body === 'string') {
        return body.length > 200 ? body.substring(0, 200) + '...' : body;
    }
    const err = body.error !== undefined ? body.error : body;
    if (typeof err === 'string') {
        return err;
    }
    if (Array.isArray(err)) {
        return err.map(e => (e && e.message) || String(e)).join('; ');
    }
    try {
        return JSON.stringify(err);
    } catch (e) {
        return undefined;
    }
}

module.exports = {
    SmileConnectError,
    errorMessageFromBody
};
