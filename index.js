const path = require('path');
const log = require('@manyos/logger').setupLog('SMILEconnect_' + path.basename(__filename));
const apiUtils = require('./apiUtils')
const allowedTicketTypes = ['incidents', 'changes', 'workorders', 'problems']
const allowedTemplateTypes = allowedTicketTypes.concat(['tasks'])
const ssoUtils = require('./ssoUtils')
const { SmileConnectError } = require('./errors')

// Path segment of an id. '', '.' and '..' are refused: the URL would drop or resolve them
// (also encoded as %2e) and address another resource, e.g. the ticket instead of its task.
function enc(id) {
    const value = String(id);
    if (value === '' || value === '.' || value === '..') {
        throw new Error(`invalid id "${value}": an id must not be empty, "." or ".."`);
    }
    return encodeURIComponent(value);
}

function checkTicketType(ticketType) {
    if (!allowedTicketTypes.includes(ticketType)) {
        throw new Error(`ticketType should be one of ${allowedTicketTypes.toString()}`)
    }
}

function checkSlot(slot) {
    if (![1, 2, 3, '1', '2', '3'].includes(slot)) {
        throw new Error('attachment slot should be 1, 2 or 3')
    }
}

// Options that only steer the client and never go over the wire.
function withoutPaging(options) {
    const copy = Object.assign({}, options);
    delete copy.limit;
    delete copy.offset;
    return copy;
}

// Search body: a plain string is the searchString. limit/offset of the options go into the body.
function prepareSearch(searchBody, options) {
    const body = typeof searchBody === 'string' ? {searchString: searchBody} : Object.assign({}, searchBody);
    const opts = options || {};
    if (opts.limit !== undefined && opts.limit !== null && body.limit === undefined) {
        body.limit = opts.limit;
    }
    if (opts.offset !== undefined && opts.offset !== null && body.offset === undefined) {
        body.offset = opts.offset;
    }
    return {body, options: withoutPaging(opts)};
}

// Paging values may come as strings (scripts, configuration): '10' + 5 must not become '105'.
function pagingNumber(value, name, fallback, min) {
    if (value === undefined || value === null) {
        return fallback;
    }
    const number = Number(value);
    if (!(Number.isInteger(number) || number === Infinity) || number < min) {
        throw new Error(`${name} must be a whole number >= ${min}, got ${value}`);
    }
    return number;
}

function encodeRfc5987(value) {
    return encodeURIComponent(value).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function buildMultipart(file, fieldName) {
    let data = file;
    let filename = 'file';
    let contentType = 'application/octet-stream';
    if (file && typeof file === 'object' && file.data !== undefined && typeof file.byteLength !== 'number') {
        data = file.data;
        filename = file.filename || filename;
        contentType = file.contentType ? String(file.contentType).replace(/[\r\n]/g, '') : contentType;
        if (typeof data === 'string' && file.encoding) {
            data = Buffer.from(data, file.encoding);
        }
    }
    if (typeof data === 'string') {
        data = Buffer.from(data, 'utf8');
    } else if (data === undefined || data === null) {
        throw new Error('file is required: pass a Buffer, a string or {data, filename, contentType}')
    } else {
        data = Buffer.from(data);
    }
    const boundary = '----smileconnect' + Date.now().toString(16) + Math.random().toString(16).substring(2);
    // a file name, not a path; quotes and control characters would break the header
    const safeName = (String(filename).split(/[\\/]/).pop() || 'file').replace(/[\x00-\x1f\x7f"]/g, '_');
    let disposition = `form-data; name="${fieldName}"; filename="${safeName}"`;
    if (/[^\x20-\x7e]/.test(safeName)) {
        // filename as raw UTF-8 like a browser sends it, filename* for parsers that read filename as latin1
        disposition += `; filename*=UTF-8''${encodeRfc5987(safeName)}`;
    }
    const head = `--${boundary}\r\nContent-Disposition: ${disposition}\r\nContent-Type: ${contentType}\r\n\r\n`;
    const tail = `\r\n--${boundary}--\r\n`;
    return {
        contentType: `multipart/form-data; boundary=${boundary}`,
        data: Buffer.concat([Buffer.from(head, 'utf8'), data, Buffer.from(tail, 'utf8')])
    };
}

class SmileconnectClient {
    params = {}
    constructor(params) {
        this.params = params;
        if (params && typeof params.tokenProvider === 'function') {
            // own token source (e.g. a token you already have): no SSO discovery needed
            this.getToken = () => Promise.resolve(params.tokenProvider());
        } else {
            // instances with the same credentials share session and token, other credentials get their own
            this.sso = ssoUtils.getSession(params.clientId, params.secret, params.ssoUrl);
            // as in 1.9.x: module functions (ssoUtils.getAccessToken, apiUtils.doApiRequest) use the last created instance
            ssoUtils.setDefaultSession(this.sso);
            this.sso.setup().catch(error => log.error('SSO setup failed', error));
            this.getToken = () => this.sso.getAccessToken();
            this.tokenErrorCause = () => this.sso.setupError;
        }
    }

    /**
     * Central request. path starts with /v1/...
     * opts: {data, rawBody, bodyAsIs, auth, response}
     */
    _request(method, requestPath, options, opts) {
        const o = opts || {};
        let throwOnError = this.params && this.params.throwOnError === true;
        if (options && options.throwOnError !== undefined) {
            throwOnError = options.throwOnError === true;
        }
        return apiUtils.request({
            url: `${this.params.smileConnectUrl}${requestPath}`,
            method,
            options,
            data: o.data,
            rawBody: o.rawBody,
            bodyAsIs: o.bodyAsIs,
            auth: o.auth,
            response: o.response,
            getToken: this.getToken,
            tokenErrorCause: this.tokenErrorCause,
            throwOnError
        });
    }

    // ---------------------------------------------------------------- tickets

    async getTicket(ticketType, ticketId, options) {
        checkTicketType(ticketType)
        log.debug('get ticket', ticketId)
        const response = await this._request('GET', `/v1/${ticketType}/${enc(ticketId)}`, options);
        log.debug('got ticket', response)
        return response
    }

    async createTicket(ticketType, data, options) {
        checkTicketType(ticketType)
        log.debug('create ticket')
        const response = await this._request('POST', `/v1/${ticketType}`, options, {data});
        log.debug('created ticket', response)
        return response
    }

    async updateTicket(ticketType, ticketId, data, options) {
        checkTicketType(ticketType)
        log.debug('update ticket')
        const response = await this._request('PUT', `/v1/${ticketType}/${enc(ticketId)}`, options, {data});
        log.debug('updated ticket', response)
        return response
    }

    /** GET /v1/{ticketType}: list without filter. options: limit, offset, include */
    async listTickets(ticketType, options) {
        checkTicketType(ticketType)
        return this._request('GET', `/v1/${ticketType}`, options)
    }

    /**
     * POST /v1/{ticketType}/search
     * searchBody: {searchString, fields, sort, limit, offset} or just the searchString
     * options: include (query), limit/offset (used if not in the body)
     */
    async searchTickets(ticketType, searchBody, options) {
        checkTicketType(ticketType)
        const search = prepareSearch(searchBody, options)
        return this._request('POST', `/v1/${ticketType}/search`, search.options, {data: search.body})
    }

    /**
     * Searches page by page and returns all records as an array (see paginate).
     * limit/offset in the search body are ignored here; use options.pageSize, options.maxItems, options.offset.
     */
    async searchTicketsAll(ticketType, searchBody, options) {
        checkTicketType(ticketType)
        const opts = Object.assign({}, options);
        const paging = {pageSize: opts.pageSize, maxItems: opts.maxItems, offset: opts.offset};
        delete opts.pageSize;
        delete opts.maxItems;
        // the page values win: limit and offset of the search body are removed
        const body = typeof searchBody === 'string' ? {searchString: searchBody} : Object.assign({}, searchBody);
        delete body.limit;
        delete body.offset;
        return this.fetchAll(page => this.searchTickets(ticketType, body, Object.assign({}, opts, page)), paging)
    }

    /** Lists page by page and returns all records as an array (see paginate). */
    async listTicketsAll(ticketType, options) {
        checkTicketType(ticketType)
        const opts = Object.assign({}, options);
        const paging = {pageSize: opts.pageSize, maxItems: opts.maxItems, offset: opts.offset};
        delete opts.pageSize;
        delete opts.maxItems;
        return this.fetchAll(page => this.listTickets(ticketType, Object.assign({}, opts, page)), paging)
    }

    /**
     * Async iterator over all records of a paged call.
     * pageFn({limit, offset}) must return a response with a `data` array (any list or search method).
     * Stops at the first empty page, because the server may cap the limit without saying so.
     * Throws if a page is the same as the one before (the endpoint ignores the offset).
     * paging: {pageSize = 100, maxItems = unlimited, offset = 0}
     */
    async * paginate(pageFn, paging) {
        const p = paging || {};
        const pageSize = pagingNumber(p.pageSize, 'pageSize', 100, 1);
        const maxItems = pagingNumber(p.maxItems, 'maxItems', Infinity, 0);
        let offset = pagingNumber(p.offset, 'offset', 0, 0);
        let count = 0;
        let lastPage;
        while (count < maxItems) {
            const limit = Math.min(pageSize, maxItems - count);
            const page = await pageFn({limit, offset});
            if (!page || !Array.isArray(page.data)) {
                throw new SmileConnectError('Unexpected response while paging: no data array', {body: page});
            }
            if (page.data.length === 0) {
                return;
            }
            // guard against endpoints that ignore the offset. The whole page is compared, so records
            // that look alike (e.g. fields: ['status']) do not end the paging; stopping silently would lose data.
            const pageJson = JSON.stringify(page.data);
            if (pageJson === lastPage) {
                throw new SmileConnectError(`Paging stopped: the page at offset ${offset} is the same as the page before, ` +
                    'the endpoint seems to ignore the offset. Add a unique field (e.g. id) to fields or set maxItems.', {body: page});
            }
            lastPage = pageJson;
            for (const item of page.data) {
                yield item;
                count++;
                if (count >= maxItems) {
                    return;
                }
            }
            offset += page.data.length;
        }
    }

    /** Like paginate, but returns all records as an array. */
    async fetchAll(pageFn, paging) {
        const all = [];
        for await (const item of this.paginate(pageFn, paging)) {
            all.push(item);
        }
        return all;
    }

    // --------------------------------------------------------------- worklogs

    async getTicketWorklogs(ticketType, ticketId, options) {
        checkTicketType(ticketType)
        log.debug('get ticket worklogs', ticketId)
        const response = await this._request('GET', `/v1/${ticketType}/${enc(ticketId)}/worklogs`, options);
        log.debug('got ticket worklogs', response)
        return response
    }

    async createTicketWorklog(ticketType, ticketId, data, options) {
        checkTicketType(ticketType)
        log.debug('create ticket worklogs', ticketId)
        const response = await this._request('POST', `/v1/${ticketType}/${enc(ticketId)}/worklogs`, options, {data});
        log.debug('created ticket worklogs', response)
        return response
    }

    async getTicketWorklog(ticketType, ticketId, worklogId, options) {
        checkTicketType(ticketType)
        log.debug('get ticket worklog', ticketId)
        const response = await this._request('GET', `/v1/${ticketType}/${enc(ticketId)}/worklogs/${enc(worklogId)}`, options);
        log.debug('got ticket worklog', response)
        return response
    }

    // ------------------------------------------------------------------ tasks

    /**
     * The parameter taskId is not used (it never was). It is kept so that calls of version 1.9.x
     * stay valid; options can also be passed as third parameter.
     */
    async getTicketTasks(ticketType, ticketId, taskId, options) {
        checkTicketType(ticketType)
        if (options === undefined && taskId !== null && typeof taskId === 'object') {
            options = taskId;
        }
        log.debug('get tasks', ticketId)
        const response = await this._request('GET', `/v1/${ticketType}/${enc(ticketId)}/tasks`, options);
        log.debug('got tasks', response)
        return response
    }

    async getTicketTask(ticketType, ticketId, taskId, options) {
        checkTicketType(ticketType)
        log.debug('get task', ticketId)
        const response = await this._request('GET', `/v1/${ticketType}/${enc(ticketId)}/tasks/${enc(taskId)}`, options);
        log.debug('got task', response)
        return response
    }

    /** body: {data: {...}} or {data: [{...}, {...}]} for several tasks. options.createTaskFlow = false skips the task flow. */
    async createTicketTask(ticketType, ticketId, body, options) {
        checkTicketType(ticketType)
        const opts = Object.assign({}, options);
        if (opts.createTaskFlow === false) {
            opts.query = Object.assign({}, opts.query, {createTaskFlow: 'false'});
        }
        return this._request('POST', `/v1/${ticketType}/${enc(ticketId)}/tasks`, opts, {data: body})
    }

    async updateTicketTask(ticketType, ticketId, taskId, body, options) {
        checkTicketType(ticketType)
        return this._request('PUT', `/v1/${ticketType}/${enc(ticketId)}/tasks/${enc(taskId)}`, options, {data: body})
    }

    async getTaskWorklogs(ticketType, ticketId, taskId, options) {
        checkTicketType(ticketType)
        log.debug('get task worklogs', ticketId)
        const response = await this._request('GET', `/v1/${ticketType}/${enc(ticketId)}/tasks/${enc(taskId)}/worklogs`, options);
        log.debug('got task worklogs', response)
        return response
    }

    async getTaskWorklog(ticketType, ticketId, taskId, worklogId, options) {
        checkTicketType(ticketType)
        log.debug('get task worklog', ticketId)
        const response = await this._request('GET', `/v1/${ticketType}/${enc(ticketId)}/tasks/${enc(taskId)}/worklogs/${enc(worklogId)}`, options);
        log.debug('got task worklog', response)
        return response
    }

    /** body: {data: {summary (1-100 chars), text}} */
    async createTaskWorklog(ticketType, ticketId, taskId, body, options) {
        checkTicketType(ticketType)
        return this._request('POST', `/v1/${ticketType}/${enc(ticketId)}/tasks/${enc(taskId)}/worklogs`, options, {data: body})
    }

    // ------------------------------------------------------------ attachments

    /** file: Buffer, string, or {data, filename, contentType, encoding}. slot: 1, 2 or 3 */
    async uploadTicketWorklogAttachment(ticketType, ticketId, worklogId, slot, file, options) {
        checkTicketType(ticketType)
        checkSlot(slot)
        return this._request('POST', `/v1/${ticketType}/${enc(ticketId)}/worklogs/${enc(worklogId)}/attachments/${slot}`, options,
            {rawBody: buildMultipart(file, 'file'), response: 'lenient'})
    }

    /** Resolves to {data: Buffer, fileName, contentType, status}. options.detectMime = true asks for the real content type. */
    async downloadTicketWorklogAttachment(ticketType, ticketId, worklogId, slot, options) {
        checkTicketType(ticketType)
        checkSlot(slot)
        return this._request('GET', `/v1/${ticketType}/${enc(ticketId)}/worklogs/${enc(worklogId)}/attachments/${slot}`,
            this._detectMime(options), {response: 'binary'})
    }

    async uploadTaskWorklogAttachment(ticketType, ticketId, taskId, worklogId, slot, file, options) {
        checkTicketType(ticketType)
        checkSlot(slot)
        return this._request('POST', `/v1/${ticketType}/${enc(ticketId)}/tasks/${enc(taskId)}/worklogs/${enc(worklogId)}/attachments/${slot}`, options,
            {rawBody: buildMultipart(file, 'file'), response: 'lenient'})
    }

    async downloadTaskWorklogAttachment(ticketType, ticketId, taskId, worklogId, slot, options) {
        checkTicketType(ticketType)
        checkSlot(slot)
        return this._request('GET', `/v1/${ticketType}/${enc(ticketId)}/tasks/${enc(taskId)}/worklogs/${enc(worklogId)}/attachments/${slot}`,
            this._detectMime(options), {response: 'binary'})
    }

    async uploadCustomFormAttachment(alias, recordId, attachmentAlias, file, options) {
        return this._request('POST', `/v1/customForms/${enc(alias)}/${enc(recordId)}/attachments/${enc(attachmentAlias)}`, options,
            {rawBody: buildMultipart(file, 'file'), response: 'lenient'})
    }

    async downloadCustomFormAttachment(alias, recordId, attachmentAlias, options) {
        return this._request('GET', `/v1/customForms/${enc(alias)}/${enc(recordId)}/attachments/${enc(attachmentAlias)}`,
            this._detectMime(options), {response: 'binary'})
    }

    _detectMime(options) {
        const opts = Object.assign({}, options);
        if (opts.detectMime === true) {
            opts.query = Object.assign({}, opts.query, {detectMime: 'true'});
        }
        return opts;
    }

    // -------------------------------------------------------------- templates

    /** type: incidents, problems, changes, workorders or tasks. options: limit, offset, include */
    async listTemplates(templateType, options) {
        this._checkTemplateType(templateType)
        return this._request('GET', `/v1/templates/${templateType}`, options)
    }

    async getTemplate(templateType, templateId, options) {
        this._checkTemplateType(templateType)
        return this._request('GET', `/v1/templates/${templateType}/${enc(templateId)}`, options)
    }

    _checkTemplateType(templateType) {
        if (!allowedTemplateTypes.includes(templateType)) {
            throw new Error(`templateType should be one of ${allowedTemplateTypes.toString()}`)
        }
    }

    // ------------------------------------------------------------------- CMDB

    async validateCMDBUpdateRequest(data, options) {
        log.debug('validate data')
        const response = await this._request('POST', '/v1/cmdbobjects/validateUpdateRequest', options, {data});
        log.debug('data validated', response)
        return response
    }

    /** options: limit, offset, include, category, ciIds (array or comma separated string) */
    async listCmdbObjects(options) {
        const opts = Object.assign({}, options);
        const query = Object.assign({}, opts.query);
        if (opts.category) {
            query.category = opts.category;
        }
        if (opts.ciIds) {
            query.ciIds = Array.isArray(opts.ciIds) ? opts.ciIds.join(',') : opts.ciIds;
        }
        opts.query = query;
        return this._request('GET', '/v1/cmdbobjects', opts)
    }

    async getCmdbObject(ciId, options) {
        return this._request('GET', `/v1/cmdbobjects/${enc(ciId)}`, options)
    }

    async searchCmdbObjects(searchBody, options) {
        const search = prepareSearch(searchBody, options)
        return this._request('POST', '/v1/cmdbobjects/search', search.options, {data: search.body})
    }

    /** body: {classId, data: {...}} */
    async createCmdbObject(body, options) {
        return this._request('POST', '/v1/cmdbobjects', options, {data: body})
    }

    /** body: {classId, data: {...}} (without classId the base form is updated) */
    async updateCmdbObject(ciId, body, options) {
        return this._request('PUT', `/v1/cmdbobjects/${enc(ciId)}`, options, {data: body})
    }

    /** GET /v1/cirelations/{id}: resolves to {data: [...]} */
    async getCiRelations(ciId, options) {
        return this._request('GET', `/v1/cirelations/${enc(ciId)}`, options)
    }

    /** GET /v1/peoplerelations/{id}: resolves to {data: {personRelations, supportGroupRelations, organisationRelations}} */
    async getCiPeopleRelations(ciId, options) {
        return this._request('GET', `/v1/peoplerelations/${enc(ciId)}`, options)
    }

    // ---------------------------------------------------------- foundation data

    /** options.isLoginId = true looks the person up by login instead of person id */
    async getPerson(personId, options) {
        const opts = Object.assign({}, options);
        if (opts.isLoginId === true) {
            opts.query = Object.assign({}, opts.query, {isLoginId: 'true'});
        }
        return this._request('GET', `/v1/persons/${enc(personId)}`, opts)
    }

    async listPersons(options) {
        return this._request('GET', '/v1/persons', options)
    }

    async searchPersons(searchBody, options) {
        const search = prepareSearch(searchBody, options)
        return this._request('POST', '/v1/persons/search', search.options, {data: search.body})
    }

    async getOrganisation(organisationId, options) {
        return this._request('GET', `/v1/organisations/${enc(organisationId)}`, options)
    }

    async listOrganisations(options) {
        return this._request('GET', '/v1/organisations', options)
    }

    async searchOrganisations(searchBody, options) {
        const search = prepareSearch(searchBody, options)
        return this._request('POST', '/v1/organisations/search', search.options, {data: search.body})
    }

    async getSupportgroup(supportgroupId, options) {
        return this._request('GET', `/v1/supportgroups/${enc(supportgroupId)}`, options)
    }

    async listSupportgroups(options) {
        return this._request('GET', '/v1/supportgroups', options)
    }

    async searchSupportgroups(searchBody, options) {
        const search = prepareSearch(searchBody, options)
        return this._request('POST', '/v1/supportgroups/search', search.options, {data: search.body})
    }

    // ------------------------------------------------------------ custom forms

    async listCustomFormRecords(alias, options) {
        return this._request('GET', `/v1/customForms/${enc(alias)}`, options)
    }

    async getCustomFormRecord(alias, recordId, options) {
        return this._request('GET', `/v1/customForms/${enc(alias)}/${enc(recordId)}`, options)
    }

    /** body: {data: {...}} */
    async createCustomFormRecord(alias, body, options) {
        return this._request('POST', `/v1/customForms/${enc(alias)}`, options, {data: body})
    }

    /** body: {data: {...}} */
    async updateCustomFormRecord(alias, recordId, body, options) {
        return this._request('PUT', `/v1/customForms/${enc(alias)}/${enc(recordId)}`, options, {data: body})
    }

    async searchCustomFormRecords(alias, searchBody, options) {
        const search = prepareSearch(searchBody, options)
        return this._request('POST', `/v1/customForms/${enc(alias)}/search`, search.options, {data: search.body})
    }

    // --------------------------------------------------------- script endpoints

    /**
     * Calls /v1/scriptEndpoints/{name}. The body is sent as it is (no data envelope is added).
     * The API answers POST only; options.method exists for forward compatibility.
     * An empty answer body resolves to null.
     */
    async callScriptEndpoint(name, body, options) {
        const opts = Object.assign({}, options);
        const method = (opts.method || 'POST').toUpperCase();
        delete opts.method;
        const hasBody = method !== 'GET' && method !== 'HEAD';
        return this._request(method, `/v1/scriptEndpoints/${enc(name)}`, opts,
            {data: hasBody ? body : undefined, bodyAsIs: true, response: 'lenient'})
    }

    // ------------------------------------------------------------------- misc

    /** GET /v1/openapi/{clientId}: no token needed. Defaults to the clientId of this client. */
    async getOpenApi(clientId, options) {
        if (options === undefined && clientId !== null && typeof clientId === 'object') {
            options = clientId;
            clientId = undefined;
        }
        const id = clientId || this.params.clientId;
        if (!id) {
            throw new Error('getOpenApi needs a clientId: pass it as parameter or set clientId in the configuration')
        }
        return this._request('GET', `/v1/openapi/${enc(id)}`, options, {auth: false})
    }

    /** GET /v1/version: {app, version}. Needs api >= 1.79.0 */
    async getVersion(options) {
        return this._request('GET', '/v1/version', options)
    }

    /** GET /v1/health: no token needed */
    async getHealth(options) {
        return this._request('GET', '/v1/health', options, {auth: false})
    }
}

module.exports = {
    SmileconnectClient,
    SmileConnectError
};
