# @manyos/smileconnect-client

A Node.js client for the BMC ITSM API SMILEconnect. Use it to access your BMC ITSM Suite from Node.js, or as a reference implementation of a SMILEconnect client.

Read more about SMILEconnect: https://manyos.it. API guide: https://smileconnect.manyosdocs.de

Contribution via pull request is welcome. Changes: see [CHANGELOG.md](CHANGELOG.md).

## Installation

```bash
npm install @manyos/smileconnect-client
```

## Initialization

The client logs in with the *client credentials* flow of your OpenID Connect server, caches the token and requests a new one shortly before it expires. Clients with the same credentials share one token (also when you create a new client per call); clients with different credentials in one process keep their tokens apart.

```javascript
const { SmileconnectClient, SmileConnectError } = require('@manyos/smileconnect-client')

const smileconnect = new SmileconnectClient({
    clientId: process.env.CLIENT_ID,             // client id in the identity provider (and in SMILEconnect)
    secret: process.env.CLIENT_SECRET,
    ssoUrl: process.env.SSO_URL,                 // e.g. https://sso.example.com/realms/smile
    smileConnectUrl: process.env.SMILECONNECT_URL, // e.g. https://smileconnect.example.com
    throwOnError: false                          // optional, see "Error handling"
})
```

If you already have a token (or fetch it yourself), pass `tokenProvider` instead of `clientId`, `secret` and `ssoUrl`. The function may be async and is called before every request. If it returns no token (`undefined`, `null`, `''`), the call fails without sending a request:

```javascript
const smileconnect = new SmileconnectClient({
    smileConnectUrl: 'https://smileconnect.example.com',
    tokenProvider: async () => myTokenCache.get()
})
```

Unknown keys in the configuration (for example `type` in an adapter configuration of SMILEconnect) are ignored.

## Conventions

* **Bodies.** Methods that write take the body exactly as the API expects it, including the envelope: `{ data: { ... } }`. The client adds nothing. Script endpoints take any body.
* **Results.** Every method resolves to the parsed JSON answer of the API (`{ data, included, links }`), `null` if a success answer has no body (for example 204). Attachment downloads resolve to `{ data: Buffer, fileName, contentType, status }`.
* **Options.** The last parameter of every method is an optional `options` object:

| Option | Effect |
|---|---|
| `clientId` | act as another client (only for master clients of SMILEconnect) |
| `impersonateUser` | run with the permissions of this Remedy user (needs the client option `allowDynamicImpersonate`) |
| `include` | related objects, string (`'ciRelations,persons'`) or array |
| `limit`, `offset` | paging of lists and searches |
| `query` | object with additional query parameters |
| `throwOnError` | throw instead of returning the error body, see below |

* **Ticket types** are `'incidents'`, `'changes'`, `'workorders'` and `'problems'`; templates also accept `'tasks'`.
* **Search.** `searchString` is a Remedy qualification with the API names of your client in single quotes, see [Querying data](https://smileconnect.manyosdocs.de). Where a search takes a body you may pass the search string alone.

The attributes (`id`, `summary`, ...) are those of *your* client. The specification of your client is available with `getOpenApi()`.

## Error handling

By default (as in 1.9.x) a call resolves to the JSON body of the answer, also when the API answered with an error status (for example `{ error: '...' }` or `{ data: {} }` for 404). A network error, an answer that is no JSON (for example the HTML page of a proxy) and an error status without body reject with the error of `node-fetch`.

With `throwOnError: true`, on the client or per call (a per-call value wins), every HTTP status of 400 and above rejects with a `SmileConnectError`:

```javascript
try {
    const ticket = await smileconnect.getTicket('incidents', 'INC000000000217', { throwOnError: true })
} catch (error) {
    if (error instanceof SmileConnectError) {
        console.error(error.status)  // 404; undefined for network errors
        console.error(error.body)    // parsed JSON body of the answer ({ data: {} }, { error: '...' }) or the raw text
        console.error(error.url)     // https://smileconnect.example.com/v1/incidents/INC000000000217
        console.error(error.message)
    } else {
        throw error
    }
}
```

With `throwOnError`, network errors (connection refused, reset, DNS) and token errors (identity provider not reachable, grant refused) are also a `SmileConnectError`, without `status`, with the original error as `error.cause`. A success status with a body that is no JSON (for example the login page of a proxy or SSO gateway) is a `SmileConnectError` with that `status` and the text as `body`.

**In scripts in a sandbox (vm2), for example SMILEconnect scripts:** `error instanceof SmileConnectError` does not work across the sandbox boundary. Check `error.isSmileConnectError === true` (or `error.name === 'SmileConnectError'`) instead.

Status codes of the API: 400 malformed request (for example no file in an upload), 401 no valid token or no client configuration, 403 not allowed to change this object, 404 not found or outside the client's basequery, 422 validation failed, 429 rate limit, 500 Remedy refused the request or a script failed.

## Tickets

```javascript
// read, with related objects
const ticket = await smileconnect.getTicket('incidents', 'INC000000000217', { include: 'ciRelations,persons' })

// create (use "template" to fill in defaults, see Templates)
const created = await smileconnect.createTicket('incidents', {
    data: { summary: 'New Incident', detailedDescription: 'Here are the details', vendorTicketId: 'MON-88213' }
})

// update
await smileconnect.updateTicket('incidents', 'INC000000000217', { data: { status: 'Resolved', resolution: 'Restarted.' } })

// list everything the client may see (no filter, no sorting)
const list = await smileconnect.listTickets('incidents', { limit: 50, offset: 0 })

// search: filter, choose attributes, sort, page
const found = await smileconnect.searchTickets('incidents', {
    searchString: "'status' = \"Assigned\" AND 'priority' = \"High\"",
    fields: ['id', 'summary', 'status'],
    sort: { summary: 1 },
    limit: 50,
    offset: 0
}, { include: 'persons' })
```

### Paging

The API caps `limit` silently (client and installation limits). The helpers therefore advance by the number of records received and stop at the first empty page (one extra request). Sort by a stable attribute while paging. If a page is exactly the same as the page before, the helpers throw a `SmileConnectError` instead of looping (the endpoint seems to ignore `offset`); with `fields` that are not unique this can happen for real data, so include a unique field such as `id`. `pageSize`, `maxItems` and `offset` may also be numeric strings.

```javascript
// all records as an array; pageSize defaults to 100, maxItems is optional
const all = await smileconnect.searchTicketsAll('incidents', {
    searchString: "'status' = \"Assigned\"", fields: ['id', 'summary'], sort: { id: 1 }
}, { pageSize: 200, maxItems: 5000 })

// one record at a time
for await (const incident of smileconnect.paginate(page => smileconnect.listTickets('incidents', page), { pageSize: 100 })) {
    console.log(incident.id)
}

// any other list or search method works the same way
const persons = await smileconnect.fetchAll(page => smileconnect.searchPersons({ searchString: "'name' LIKE \"Bob%\"" }, page))
```

`listTicketsAll(ticketType, options)` is the same for plain lists. In the `*All` methods the page values win: a `limit` or `offset` in the search body is ignored; use `pageSize`, `maxItems` and `offset` in the options. `paginate` and `fetchAll` take any function that gets `{ limit, offset }` and returns a response with a `data` array.

## Worklogs

```javascript
const worklogs = await smileconnect.getTicketWorklogs('incidents', 'INC000000000217')
const worklog = await smileconnect.getTicketWorklog('incidents', 'INC000000000217', 'WLG000000000533')
const newWorklog = await smileconnect.createTicketWorklog('incidents', 'INC000000000217', {
    data: { summary: 'Implementation update', text: 'Almost done.', isPublic: true }
})
```

## Tasks

```javascript
const tasks = await smileconnect.getTicketTasks('incidents', 'INC000000001401')
const task = await smileconnect.getTicketTask('incidents', 'INC000000001401', 'TAS000000046217')

// create one task, or several with an array in data; createTaskFlow: false skips the task flow
await smileconnect.createTicketTask('incidents', 'INC000000001401', { data: { summary: 'Check the disk' } })
await smileconnect.createTicketTask('incidents', 'INC000000001401', { data: [{ summary: 'A' }, { summary: 'B' }] }, { createTaskFlow: false })

await smileconnect.updateTicketTask('incidents', 'INC000000001401', 'TAS000000046217', { data: { status: 'Closed' } })

const taskWorklogs = await smileconnect.getTaskWorklogs('incidents', 'INC000000001401', 'TAS000000046217')
const taskWorklog = await smileconnect.getTaskWorklog('incidents', 'INC000000001401', 'TAS000000046217', 'WLG000000001601')
// summary (1 to 100 characters) and text are required
await smileconnect.createTaskWorklog('incidents', 'INC000000001401', 'TAS000000046217', {
    data: { summary: 'Done', text: 'Disk replaced.' }
})
```

`getTicketTasks(ticketType, ticketId, taskId, options)` has an unused parameter `taskId` that is kept for compatibility. Pass `undefined` for it, or give the options in its place.

## Attachments

A worklog has three attachment slots (1 to 3). Files are sent as `multipart/form-data` in the field `file`. A file is a `Buffer`, a string, or an object `{ data, filename, contentType }` (`data` as Buffer or string; `encoding: 'base64'` decodes a base64 string). Files are limited by `MAX_FILESIZE` of the installation (default 5 MB; larger uploads get HTTP 413). An upload resolves to the answer of the API, which may be text; an error status, or an HTML page instead of an answer, is handled as in every other method.

```javascript
const fs = require('fs')
const path = require('path')

await smileconnect.uploadTicketWorklogAttachment('incidents', 'INC000000000217', 'WLG000000001240', 1, {
    data: fs.readFileSync('screenshot.png'), filename: 'screenshot.png', contentType: 'image/png'
})

const file = await smileconnect.downloadTicketWorklogAttachment('incidents', 'INC000000000217', 'WLG000000001240', 1, { detectMime: true })
if (file.data) {   // file = { data: Buffer, fileName, contentType, status }
    fs.writeFileSync(path.join(downloadDir, file.fileName || 'attachment'), file.data)
} else {           // file = { status, error, body }
    console.error('download failed', file.status, file.error)
}

// worklogs of tasks
await smileconnect.uploadTaskWorklogAttachment('incidents', 'INC1', 'TAS1', 'WLG1', 1, Buffer.from('hello'))
await smileconnect.downloadTaskWorklogAttachment('incidents', 'INC1', 'TAS1', 'WLG1', 1)

// attachment fields of custom forms
await smileconnect.uploadCustomFormAttachment('enrollments', '000000000000115', 'attachment1', Buffer.from('hello'))
await smileconnect.downloadCustomFormAttachment('enrollments', '000000000000115', 'attachment1')
```

`detectMime: true` makes the API return the real content type; without it the type is `application/octet-stream`. If the download fails (for example an empty slot) the result is `{ status, error, body }` without `data` (`error` is the message, `body` the error body of the API), or a `SmileConnectError` with `throwOnError`.

`fileName` comes from the `Content-Disposition` header of the answer, that is from whoever uploaded the file. It is reduced to a plain file name (no directories; `:`, control characters and bidi controls such as U+202E replaced) and is `undefined` if nothing is left. Still join it to a directory of your choice instead of using it as a path.

The `filename` of an upload is sent without directories. Names with characters outside ASCII are sent as UTF-8 (like a browser does) plus `filename*` (RFC 5987).

## Templates

```javascript
const templates = await smileconnect.listTemplates('incidents', { limit: 20 })   // also 'tasks'
const template = await smileconnect.getTemplate('incidents', 'IDGAA5V0GHTMAASQ0000000001')
// use it on create
await smileconnect.createTicket('incidents', { data: { template: template.data.id, summary: 'Printer offline' } })
```

## Configuration items

```javascript
const ci = await smileconnect.getCmdbObject('AGGarserver000PMIYWAPL1SMUB5AZ', { include: 'ciRelations' })
const cis = await smileconnect.listCmdbObjects({ category: 'Hardware', ciIds: ['AGG1', 'AGG2'], limit: 100 })
const hits = await smileconnect.searchCmdbObjects({ searchString: "'name' LIKE \"srv-db-%\"", fields: ['id', 'name'], limit: 100 })
const newCi = await smileconnect.createCmdbObject({ classId: 'AST:ComputerSystem', data: { name: 'srv-app-07' } })
await smileconnect.updateCmdbObject('AGGarserver000PMIYWAPL1SMUB5AZ', { classId: 'AST:ComputerSystem', data: { assetlifecycleStatus: 'Deployed' } })

// dry run of an update: which CIs can be reached, how attributes are mapped. Nothing is written.
await smileconnect.validateCMDBUpdateRequest({ ciChanges: [{ ciId: 'AGG1', attributes: { assetlifecycleStatus: 'Deployed' } }] })

// relations
const ciRelations = await smileconnect.getCiRelations('AGGarserver000PMIYWAPL1SMUB5AZ')          // { data: [...] }
const peopleRelations = await smileconnect.getCiPeopleRelations('AGGarserver000PMIYWAPL1SMUB5AZ') // { data: { personRelations, supportGroupRelations, organisationRelations } }
```

A CI outside the basequery of the client is answered with 404 (403 on update).

## Persons, organisations, support groups

```javascript
const person = await smileconnect.getPerson('PPL000000000014', { include: 'groupMembership' })
const byLogin = await smileconnect.getPerson('Bob', { isLoginId: true })
const people = await smileconnect.searchPersons({ searchString: "'name' LIKE \"Bob%\"", limit: 10 })
const persons = await smileconnect.listPersons({ limit: 100 })

const organisation = await smileconnect.getOrganisation('POR000000000012', { include: 'personRelations' })
const organisations = await smileconnect.searchOrganisations("'company' = \"Calbro Services\"")
const group = await smileconnect.getSupportgroup('SGP000000000011', { include: 'personRelations' })
const groups = await smileconnect.searchSupportgroups({ searchString: "'supportGroup' LIKE \"Service%\"" })
// also listOrganisations(options), listSupportgroups(options)
```

## Custom forms

`alias` is the alias of the custom form in the field catalog.

```javascript
const records = await smileconnect.listCustomFormRecords('enrollments', { limit: 20 })
const record = await smileconnect.getCustomFormRecord('enrollments', '000000000000115')
await smileconnect.createCustomFormRecord('enrollments', { data: { userId: 'Allen', classTitle: 'Intro to Remedy' } })
await smileconnect.updateCustomFormRecord('enrollments', '000000000000115', { data: { location: 'Berlin' } })
const found = await smileconnect.searchCustomFormRecords('enrollments', { searchString: "'userId' = \"Allen\"", fields: ['id', 'classTitle'] })
```

## Script endpoints

The body is sent as it is (no `data` envelope unless the endpoint wants one), also `false`, `0` or `''`; without a body (or with `null`) nothing is sent. The answer is exactly what the script returns (also text), `null` if the script returns nothing. An HTML page is not taken as answer (it comes from a proxy or gateway). The API answers `POST` only; `options.method` exists for the case that this changes.

```javascript
const answer = await smileconnect.callScriptEndpoint('hello', { name: 'Allen' })
```

## OpenAPI, version, health

```javascript
const spec = await smileconnect.getOpenApi()            // specification of your own client (needs clientId in the configuration); no token needed
const other = await smileconnect.getOpenApi('other-client')
const strict = await smileconnect.getOpenApi({ throwOnError: true })  // options without a clientId
const version = await smileconnect.getVersion()         // { app: 'api', version: '1.79.0' }
const health = await smileconnect.getHealth()           // { status: 'ok' }, no token needed
```

## Minimum api version

Most methods work with any current api. These need a minimum version:

| Method | Needs api |
|---|---|
| `getVersion` | 1.79.0 |
| `getCiRelations`, `getCiPeopleRelations`; attachments of custom forms | 1.77.1 |
| `detectMime` on attachment downloads | 1.73.0 |
| `callScriptEndpoint` | 1.71.1 |
| custom form methods | 1.47.0 |
| `impersonateUser` (on updates) | 1.57.0 (on reads 1.40.0) |

The `include` parameter and the `/search` endpoints depend on the version of your api too. If a call answers 404, check the version with `getVersion()` (an older api has no such endpoint) and your client configuration. Which objects and attributes a call may use is decided by the configuration of your client.

## Tests

```bash
npm test
```

runs the unit tests against a local mock server; no SMILEconnect system and no identity provider are contacted. The integration tests in `test/ticketTest.js` run against a real system only if `CLIENT_ID`, `CLIENT_SECRET`, `SSO_URL` and `SMILECONNECT_URL` are set, otherwise they are skipped.

## License

MIT
