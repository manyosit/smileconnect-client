# Changelog

## 1.10.0

Covers the current SMILEconnect API. Backwards compatible: calls that work with 1.9.x work unchanged and return the same result; the exceptions are edge cases listed under "Changed" (ids with special characters, success answers without body, bodies on GET). New behaviour is opt-in.

### Added

- Tickets: `listTickets`, `searchTickets` (`fields`, `sort`, `limit`, `offset`, `include`), paging helpers `paginate`, `fetchAll`, `searchTicketsAll`, `listTicketsAll`. `include` also works on `getTicket` and every other read via the options.
- Tasks: `createTicketTask` (one or several, optional `createTaskFlow: false`), `updateTicketTask`, `createTaskWorklog`.
- Attachments: `uploadTicketWorklogAttachment`, `downloadTicketWorklogAttachment`, `uploadTaskWorklogAttachment`, `downloadTaskWorklogAttachment`, `uploadCustomFormAttachment`, `downloadCustomFormAttachment`. Uploads take a `Buffer`, a string or `{data, filename, contentType}`; no stream and no file path needed.
- Templates: `listTemplates`, `getTemplate`.
- Configuration items: `getCmdbObject`, `listCmdbObjects`, `searchCmdbObjects`, `createCmdbObject`, `updateCmdbObject`, `getCiRelations`, `getCiPeopleRelations`.
- Foundation data: `getPerson` (also by login), `listPersons`, `searchPersons`, same for organisations and support groups.
- Custom forms: `listCustomFormRecords`, `getCustomFormRecord`, `createCustomFormRecord`, `updateCustomFormRecord`, `searchCustomFormRecords`.
- `callScriptEndpoint`, `getOpenApi`, `getVersion`, `getHealth`.
- Per call options: `impersonateUser`, `include`, `limit`, `offset`, `query` (extra query parameters), next to `clientId`.
- Error handling (opt-in): `throwOnError: true` on the client or per call throws a `SmileConnectError` with `status`, `body`, `url` for HTTP errors (and for network errors, without `status`). Without it the JSON body is returned as before.
- `tokenProvider` constructor option: your own function that returns an access token, instead of the built-in SSO client credentials flow.
- `SmileConnectError` is exported. It carries `isSmileConnectError = true` for checks across a vm2 sandbox boundary (where `instanceof` fails).

### Changed

- As in 1.9.x, the instance created last also sets the session behind the module functions `ssoUtils.getAccessToken()` and `apiUtils.doApiRequest()`; the methods of an instance always use its own session.
- With `throwOnError`, token errors are thrown as `SmileConnectError`, too, with the reason as `cause` (for example why the issuer discovery failed, with its `code` such as `ECONNREFUSED`). Without `throwOnError` the token error is thrown as in 1.9.x.
- Credentials and token belong to the session of a set of credentials. Several clients with different credentials in one process no longer share (and overwrite) one token; clients with the same credentials share one token, as in 1.9.x (also when a client is created per call). Parallel calls share one issuer discovery and one token request.
- The token is renewed shortly before it expires (30 seconds, at most half of its lifetime), so it cannot expire while a request is on its way.
- Ids in the path are URL encoded in all methods, also in those of 1.9.x (`getTicket`, `updateTicket`, worklogs, tasks). Normal ids are not changed; an id with `/`, `?`, `#` or `%` now addresses that id instead of another path or query. The ids `''`, `'.'` and `'..'` are refused with an error before a request is sent, because the URL would drop or resolve them and address another resource.
- A success answer without body (for example 204) resolves to `null`; 1.9.x rejected with `invalid json response body`. An error status without body, and any answer that is no JSON, still rejects with the `FetchError` of `node-fetch`.
- No body is sent with `GET` or `HEAD` (1.9.x passed it to `node-fetch`, which rejects such a request).
- `getTicketTasks`: the parameter `taskId` was never used. It is still accepted (calls stay valid) and ignored; options may also be given as third parameter.
- Integration tests (`test/ticketTest.js`) only run when `CLIENT_ID`, `CLIENT_SECRET`, `SSO_URL` and `SMILECONNECT_URL` are set. `npm test` runs without a `.env`.

### Behaviour of the new methods

- Paging helpers throw a `SmileConnectError` if a page is the same as the page before (the endpoint ignores the offset), instead of stopping silently. `maxItems: 0` returns no records. `pageSize`, `maxItems` and `offset` may be numbers or numeric strings; other values throw before a request.
- A failed attachment download resolves to `{ status, error, body }` (no `data`), so that it cannot be mistaken for a file.
- `fileName` of a download is a plain file name: no directories; `:`, control characters (C0, C1) and bidi controls replaced. `filename*` in ISO-8859-1 is decoded.
- Upload file names are sent without directories; names outside ASCII are sent as UTF-8 plus `filename*` (RFC 5987).
- A `tokenProvider` that returns no token makes the call fail before a request is sent.
- With `throwOnError`, a success status whose body is no JSON throws a `SmileConnectError`. Script endpoints and uploads may answer text, but only with a success status and never an HTML page; otherwise they behave like every other method.
- `callScriptEndpoint` sends `false`, `0` and `''` as body; all other methods send a body only if it is truthy, as in 1.9.x.
- `getOpenApi(options)` accepts the options as first parameter.

### Tests

- New unit tests against a local mock server (SMILEconnect API and identity provider), including 401, 404, 422, 429, 500, network errors and two instances with different credentials.

### Dependencies

- No new dependencies. Multipart bodies are built by the client itself.

### Notes

- Methods need a matching api version, see the README.
- `callScriptEndpoint`: the api answers `POST` only.
