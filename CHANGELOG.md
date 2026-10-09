# Changelog

## 1.10.0

Covers the current SMILEconnect API. Backwards compatible: every call that works with 1.9.x works unchanged and returns the same result. New behaviour is opt-in.

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
- With `throwOnError`, token errors are thrown as `SmileConnectError`, too.
- Credentials and token belong to the client instance. Several clients with different credentials in one process no longer share (and overwrite) one token. Parallel calls share one token request.
- `getTicketTasks`: the parameter `taskId` was never used. It is still accepted (calls stay valid) and ignored; options may also be given as third parameter.
- Integration tests (`test/ticketTest.js`) only run when `CLIENT_ID`, `CLIENT_SECRET`, `SSO_URL` and `SMILECONNECT_URL` are set. `npm test` runs without a `.env`.

### Tests

- New unit tests against a local mock server (SMILEconnect API and identity provider), including 401, 404, 422, 429, 500, network errors and two instances with different credentials.

### Dependencies

- No new dependencies. Multipart bodies are built by the client itself.

### Notes

- Methods need a matching api version, see the README.
- `callScriptEndpoint`: the api answers `POST` only.
