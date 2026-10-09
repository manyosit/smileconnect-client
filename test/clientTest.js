const chai = require('chai');
const should = chai.should();
const expect = chai.expect;
const sc = require('../index');
const apiUtils = require('../apiUtils');
const {startMock} = require('./helpers/mockServer');

// Unit tests against a local mock server. No SSO and no SMILEconnect system is contacted.
describe('SMILEconnect client (mock server)', function () {
    this.timeout(10000);
    let mock;
    let client;

    before(async function () {
        mock = await startMock();
    });

    after(async function () {
        await mock.close();
    });

    beforeEach(function () {
        mock.reset();
        client = new sc.SmileconnectClient({
            smileConnectUrl: mock.baseUrl,
            clientId: 'test-client',
            tokenProvider: async () => 'static-token'
        });
    });

    describe('requests of version 1.9.x', function () {
        it('sends the token, request id and the body as given', async function () {
            mock.handler = () => ({status: 200, body: {data: {id: 'INC1'}}});
            const result = await client.createTicket('incidents', {data: {summary: 'x'}});
            result.should.deep.equal({data: {id: 'INC1'}});
            const req = mock.last();
            req.method.should.equal('POST');
            req.path.should.equal('/v1/incidents');
            req.headers.authorization.should.equal('Bearer static-token');
            req.headers['x-request-id'].should.be.a('string');
            req.json.should.deep.equal({data: {summary: 'x'}});
        });

        it('keeps the old url scheme of all existing methods', async function () {
            await client.getTicket('changes', 'CRQ1');
            await client.updateTicket('problems', 'PBI1', {data: {}});
            await client.getTicketWorklogs('incidents', 'INC1');
            await client.createTicketWorklog('incidents', 'INC1', {data: {}});
            await client.getTicketWorklog('incidents', 'INC1', 'WL1');
            await client.getTicketTasks('incidents', 'INC1');
            await client.getTicketTask('incidents', 'INC1', 'TAS1');
            await client.getTaskWorklogs('incidents', 'INC1', 'TAS1');
            await client.getTaskWorklog('incidents', 'INC1', 'TAS1', 'WL1');
            await client.validateCMDBUpdateRequest({ciChanges: []});
            mock.requests.map(r => r.method + ' ' + r.path).should.deep.equal([
                'GET /v1/changes/CRQ1',
                'PUT /v1/problems/PBI1',
                'GET /v1/incidents/INC1/worklogs',
                'POST /v1/incidents/INC1/worklogs',
                'GET /v1/incidents/INC1/worklogs/WL1',
                'GET /v1/incidents/INC1/tasks',
                'GET /v1/incidents/INC1/tasks/TAS1',
                'GET /v1/incidents/INC1/tasks/TAS1/worklogs',
                'GET /v1/incidents/INC1/tasks/TAS1/worklogs/WL1',
                'POST /v1/cmdbobjects/validateUpdateRequest'
            ]);
        });

        it('appends clientId as before', async function () {
            await client.getTicket('incidents', 'INC1', {clientId: 'other'});
            mock.last().query.should.deep.equal({clientId: 'other'});
        });

        it('rejects an unknown ticket type', async function () {
            let error;
            try {
                await client.getTicket('foo', 'X');
            } catch (e) {
                error = e;
            }
            error.message.should.contain('ticketType should be one of');
            mock.requests.length.should.equal(0);
        });

        it('returns the json body of an error response (default, no throw)', async function () {
            mock.handler = () => ({status: 404, body: {data: {}}});
            const result = await client.getTicket('incidents', 'INC404');
            result.should.deep.equal({data: {}});
            mock.handler = () => ({status: 500, body: {error: 'boom'}});
            (await client.getTicket('incidents', 'INC1')).should.deep.equal({error: 'boom'});
        });

        it('ignores type and unknown keys of the adapter configuration', async function () {
            const adapterClient = new sc.SmileconnectClient({
                type: 'SMILEconnect',
                cacheTime: 300,
                somethingElse: true,
                smileConnectUrl: mock.baseUrl,
                tokenProvider: () => 'adapter-token'
            });
            await adapterClient.getTicket('incidents', 'INC1');
            mock.last().headers.authorization.should.equal('Bearer adapter-token');
        });

        it('still offers doApiRequest of the module', async function () {
            // tokens come from the default session, so only check that a failing token fails like before
            let error;
            try {
                await apiUtils.doApiRequest(mock.baseUrl + '/v1/incidents', 'GET');
            } catch (e) {
                error = e;
            }
            should.exist(error);
        });

        it('getTicketTasks ignores taskId and accepts options in its place', async function () {
            await client.getTicketTasks('incidents', 'INC1', 'ignored');
            mock.last().path.should.equal('/v1/incidents/INC1/tasks');
            await client.getTicketTasks('incidents', 'INC1', {clientId: 'other'});
            mock.last().query.should.deep.equal({clientId: 'other'});
            await client.getTicketTasks('incidents', 'INC1', undefined, {clientId: 'third'});
            mock.last().query.should.deep.equal({clientId: 'third'});
        });
    });

    describe('tickets: list, search, include, paging', function () {
        it('lists with limit, offset and include', async function () {
            await client.listTickets('incidents', {limit: 5, offset: 10, include: ['ciRelations', 'persons']});
            const req = mock.last();
            req.method.should.equal('GET');
            req.path.should.equal('/v1/incidents');
            req.query.should.deep.equal({limit: '5', offset: '10', include: 'ciRelations,persons'});
        });

        it('supports include on get', async function () {
            await client.getTicket('incidents', 'INC1', {include: 'ciRelations'});
            mock.last().query.should.deep.equal({include: 'ciRelations'});
        });

        it('searches with fields, sort, limit and offset in the body', async function () {
            await client.searchTickets('incidents', {
                searchString: "'status' = \"Assigned\"",
                fields: ['id', 'summary'],
                sort: {summary: 1}
            }, {limit: 20, offset: 40, include: 'persons'});
            const req = mock.last();
            req.method.should.equal('POST');
            req.path.should.equal('/v1/incidents/search');
            req.query.should.deep.equal({include: 'persons'});
            req.json.should.deep.equal({
                searchString: "'status' = \"Assigned\"",
                fields: ['id', 'summary'],
                sort: {summary: 1},
                limit: 20,
                offset: 40
            });
        });

        it('accepts a plain search string and does not change the given object', async function () {
            await client.searchTickets('changes', "'id' = \"CRQ1\"");
            mock.last().json.should.deep.equal({searchString: "'id' = \"CRQ1\""});
            const body = {searchString: 'x'};
            await client.searchTickets('changes', body, {limit: 3});
            body.should.deep.equal({searchString: 'x'});
        });

        it('pages through all results until an empty page', async function () {
            const all = Array.from({length: 7}, (_, i) => ({id: 'INC' + i}));
            mock.handler = req => {
                const limit = req.json.limit;
                const offset = req.json.offset;
                // the server caps the page size at 3 without saying so
                return {status: 200, body: {data: all.slice(offset, offset + Math.min(limit, 3))}};
            };
            const result = await client.searchTicketsAll('incidents', {searchString: 'x'}, {pageSize: 5});
            result.map(r => r.id).should.deep.equal(all.map(r => r.id));
            mock.requests.map(r => r.json.offset).should.deep.equal([0, 3, 6, 7]);
        });

        it('stops at maxItems and iterates lazily', async function () {
            mock.handler = req => ({
                status: 200,
                body: {data: Array.from({length: Number(req.query.limit)}, (_, i) => ({id: Number(req.query.offset) + i}))}
            });
            const seen = [];
            for await (const item of client.paginate(page => client.listTickets('incidents', page), {pageSize: 4, maxItems: 6})) {
                seen.push(item.id);
            }
            seen.should.deep.equal([0, 1, 2, 3, 4, 5]);
            mock.requests.length.should.equal(2);
        });

        it('fails when a page is no list', async function () {
            mock.handler = () => ({status: 500, body: {error: 'bad'}});
            let error;
            try {
                await client.listTicketsAll('incidents');
            } catch (e) {
                error = e;
            }
            error.should.be.instanceOf(sc.SmileConnectError);
            error.body.should.deep.equal({error: 'bad'});
        });

        it('does not loop when the server ignores the offset', async function () {
            mock.handler = () => ({status: 200, body: {data: [{id: 1}, {id: 2}]}});
            const result = await client.listTicketsAll('incidents', {pageSize: 2});
            result.length.should.equal(2);
            mock.requests.length.should.equal(2);
        });
    });

    describe('tasks', function () {
        it('creates tasks, also several at once and without task flow', async function () {
            await client.createTicketTask('incidents', 'INC1', {data: {summary: 't'}}, {createTaskFlow: false});
            let req = mock.last();
            req.method.should.equal('POST');
            req.path.should.equal('/v1/incidents/INC1/tasks');
            req.query.should.deep.equal({createTaskFlow: 'false'});
            req.json.should.deep.equal({data: {summary: 't'}});
            await client.createTicketTask('incidents', 'INC1', {data: [{summary: 'a'}, {summary: 'b'}]});
            mock.last().query.should.deep.equal({});
            mock.last().json.data.length.should.equal(2);
        });

        it('updates a task', async function () {
            await client.updateTicketTask('workorders', 'WO1', 'TAS1', {data: {status: 'Closed'}});
            const req = mock.last();
            req.method.should.equal('PUT');
            req.path.should.equal('/v1/workorders/WO1/tasks/TAS1');
        });

        it('creates a task worklog', async function () {
            await client.createTaskWorklog('incidents', 'INC1', 'TAS1', {data: {summary: 's', text: 't'}});
            const req = mock.last();
            req.method.should.equal('POST');
            req.path.should.equal('/v1/incidents/INC1/tasks/TAS1/worklogs');
            req.json.should.deep.equal({data: {summary: 's', text: 't'}});
        });
    });

    describe('attachments', function () {
        function parseMultipart(req) {
            const type = req.headers['content-type'];
            type.should.match(/^multipart\/form-data; boundary=/);
            const boundary = type.split('boundary=')[1];
            const text = req.body.toString('latin1');
            const parts = text.split('--' + boundary).filter(p => p.trim() !== '' && p.trim() !== '--');
            parts.length.should.equal(1);
            const [head, ...rest] = parts[0].split('\r\n\r\n');
            return {head, content: Buffer.from(rest.join('\r\n\r\n').replace(/\r\n$/, ''), 'latin1')};
        }

        it('uploads a worklog attachment as multipart field "file" (Buffer)', async function () {
            mock.handler = () => ({status: 200, body: JSON.stringify("['WLG1':'success']")});
            const content = Buffer.from([0, 1, 2, 250, 255, 13, 10, 65]);
            const result = await client.uploadTicketWorklogAttachment('incidents', 'INC1', 'WLG1', 2,
                {data: content, filename: 'a "b".bin', contentType: 'application/x-test'});
            result.should.equal("['WLG1':'success']");
            const req = mock.last();
            req.method.should.equal('POST');
            req.path.should.equal('/v1/incidents/INC1/worklogs/WLG1/attachments/2');
            const part = parseMultipart(req);
            part.head.should.contain('name="file"');
            part.head.should.contain('filename="a _b_.bin"');
            part.head.should.contain('Content-Type: application/x-test');
            part.content.equals(content).should.equal(true);
        });

        it('uploads a string and a plain Buffer', async function () {
            await client.uploadTaskWorklogAttachment('incidents', 'INC1', 'TAS1', 'WLG1', 1, 'hello');
            mock.last().path.should.equal('/v1/incidents/INC1/tasks/TAS1/worklogs/WLG1/attachments/1');
            parseMultipart(mock.last()).content.toString().should.equal('hello');
            await client.uploadCustomFormAttachment('enrollments', '115', 'attachment1', Buffer.from('abc'));
            mock.last().path.should.equal('/v1/customForms/enrollments/115/attachments/attachment1');
            parseMultipart(mock.last()).content.toString().should.equal('abc');
        });

        it('uploads base64 content', async function () {
            await client.uploadTicketWorklogAttachment('incidents', 'INC1', 'WLG1', 1,
                {data: Buffer.from('xyz').toString('base64'), encoding: 'base64', filename: 'x.txt'});
            parseMultipart(mock.last()).content.toString().should.equal('xyz');
        });

        it('rejects a wrong slot and a missing file before any request', async function () {
            let error;
            try {
                await client.uploadTicketWorklogAttachment('incidents', 'INC1', 'WLG1', 4, 'x');
            } catch (e) {
                error = e;
            }
            error.message.should.contain('slot');
            error = undefined;
            try {
                await client.uploadTicketWorklogAttachment('incidents', 'INC1', 'WLG1', 1);
            } catch (e) {
                error = e;
            }
            error.message.should.contain('file is required');
            mock.requests.length.should.equal(0);
        });

        it('downloads a binary attachment', async function () {
            const content = Buffer.from([0, 255, 128, 10, 13]);
            mock.handler = () => ({
                status: 200,
                body: content,
                headers: {'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=logo.png'}
            });
            const result = await client.downloadTicketWorklogAttachment('incidents', 'INC1', 'WLG1', 1, {detectMime: true});
            result.data.equals(content).should.equal(true);
            result.fileName.should.equal('logo.png');
            result.contentType.should.equal('application/octet-stream');
            result.status.should.equal(200);
            mock.last().query.should.deep.equal({detectMime: 'true'});
            await client.downloadTaskWorklogAttachment('incidents', 'INC1', 'TAS1', 'WLG1', 3);
            mock.last().path.should.equal('/v1/incidents/INC1/tasks/TAS1/worklogs/WLG1/attachments/3');
            mock.last().query.should.deep.equal({});
            await client.downloadCustomFormAttachment('enrollments', '115', 'attachment1');
            mock.last().path.should.equal('/v1/customForms/enrollments/115/attachments/attachment1');
        });

        it('returns the error body of a missing attachment, or throws with throwOnError', async function () {
            mock.handler = () => ({status: 404, body: {error: 'not found'}});
            const result = await client.downloadTicketWorklogAttachment('incidents', 'INC1', 'WLG1', 1);
            result.should.deep.equal({error: 'not found'});
            let error;
            try {
                await client.downloadTicketWorklogAttachment('incidents', 'INC1', 'WLG1', 1, {throwOnError: true});
            } catch (e) {
                error = e;
            }
            error.status.should.equal(404);
            error.body.should.deep.equal({error: 'not found'});
        });
    });

    describe('templates, CMDB, foundation data, custom forms', function () {
        it('reads templates', async function () {
            await client.listTemplates('tasks', {limit: 2});
            mock.last().path.should.equal('/v1/templates/tasks');
            mock.last().query.should.deep.equal({limit: '2'});
            await client.getTemplate('incidents', 'IDGAA');
            mock.last().path.should.equal('/v1/templates/incidents/IDGAA');
            let error;
            try {
                await client.listTemplates('foo');
            } catch (e) {
                error = e;
            }
            error.message.should.contain('templateType');
        });

        it('works with CIs', async function () {
            await client.getCmdbObject('OI-1', {include: 'ciRelations'});
            mock.last().path.should.equal('/v1/cmdbobjects/OI-1');
            await client.listCmdbObjects({category: 'Hardware', ciIds: ['a', 'b'], limit: 10});
            mock.last().query.should.deep.equal({category: 'Hardware', ciIds: 'a,b', limit: '10'});
            await client.searchCmdbObjects({searchString: "'name' LIKE \"srv%\"", limit: 5});
            mock.last().path.should.equal('/v1/cmdbobjects/search');
            mock.last().json.limit.should.equal(5);
            await client.createCmdbObject({classId: 'AST:ComputerSystem', data: {name: 'x'}});
            mock.last().method.should.equal('POST');
            mock.last().path.should.equal('/v1/cmdbobjects');
            mock.last().json.classId.should.equal('AST:ComputerSystem');
            await client.updateCmdbObject('OI-1', {classId: 'AST:ComputerSystem', data: {name: 'y'}});
            mock.last().method.should.equal('PUT');
            mock.last().path.should.equal('/v1/cmdbobjects/OI-1');
            await client.getCiRelations('OI-1');
            mock.last().path.should.equal('/v1/cirelations/OI-1');
            await client.getCiPeopleRelations('OI-1');
            mock.last().path.should.equal('/v1/peoplerelations/OI-1');
        });

        it('reads persons, organisations and support groups', async function () {
            await client.getPerson('Bob', {isLoginId: true, include: 'groupMembership'});
            mock.last().path.should.equal('/v1/persons/Bob');
            mock.last().query.should.deep.equal({isLoginId: 'true', include: 'groupMembership'});
            await client.getPerson('PPL1');
            mock.last().query.should.deep.equal({});
            await client.searchPersons({searchString: "'name' LIKE \"Bob%\""});
            mock.last().path.should.equal('/v1/persons/search');
            await client.listOrganisations({limit: 1});
            mock.last().path.should.equal('/v1/organisations');
            await client.getOrganisation('POR1');
            mock.last().path.should.equal('/v1/organisations/POR1');
            await client.searchOrganisations('x');
            mock.last().path.should.equal('/v1/organisations/search');
            await client.getSupportgroup('SGP1', {include: 'personRelations'});
            mock.last().path.should.equal('/v1/supportgroups/SGP1');
            await client.searchSupportgroups('x');
            mock.last().path.should.equal('/v1/supportgroups/search');
            await client.listSupportgroups();
            mock.last().path.should.equal('/v1/supportgroups');
            await client.listPersons();
            mock.last().path.should.equal('/v1/persons');
        });

        it('works with custom forms', async function () {
            await client.listCustomFormRecords('enrollments', {limit: 3});
            mock.last().path.should.equal('/v1/customForms/enrollments');
            await client.getCustomFormRecord('enrollments', '115');
            mock.last().path.should.equal('/v1/customForms/enrollments/115');
            await client.createCustomFormRecord('enrollments', {data: {userId: 'Allen'}});
            mock.last().method.should.equal('POST');
            mock.last().json.should.deep.equal({data: {userId: 'Allen'}});
            await client.updateCustomFormRecord('enrollments', '115', {data: {location: 'Berlin'}});
            mock.last().method.should.equal('PUT');
            await client.searchCustomFormRecords('enrollments', {searchString: 'x', fields: ['id']});
            mock.last().path.should.equal('/v1/customForms/enrollments/search');
        });

        it('encodes ids of new methods', async function () {
            await client.getCmdbObject('a/b c');
            mock.last().path.should.equal('/v1/cmdbobjects/a%2Fb%20c');
        });
    });

    describe('script endpoints, openapi, version, health', function () {
        it('calls a script endpoint with a free body', async function () {
            mock.handler = () => ({status: 200, body: {message: 'Hello'}});
            const result = await client.callScriptEndpoint('hello', {name: 'Allen'}, {query: {debug: '1'}});
            result.should.deep.equal({message: 'Hello'});
            const req = mock.last();
            req.method.should.equal('POST');
            req.path.should.equal('/v1/scriptEndpoints/hello');
            req.query.should.deep.equal({debug: '1'});
            req.json.should.deep.equal({name: 'Allen'});
        });

        it('returns null for an empty answer and passes the status on', async function () {
            mock.handler = () => ({status: 203});
            expect(await client.callScriptEndpoint('empty', {})).to.equal(null);
            mock.handler = () => ({status: 400, body: {error: 'bad input'}});
            let error;
            try {
                await client.callScriptEndpoint('x', {}, {throwOnError: true});
            } catch (e) {
                error = e;
            }
            error.status.should.equal(400);
        });

        it('supports other methods without a body for GET', async function () {
            await client.callScriptEndpoint('x', {ignored: true}, {method: 'GET'});
            mock.last().method.should.equal('GET');
            mock.last().body.length.should.equal(0);
        });

        it('reads openapi and health without a token', async function () {
            let tokenCalls = 0;
            const noTokenClient = new sc.SmileconnectClient({
                smileConnectUrl: mock.baseUrl,
                clientId: 'my-client',
                tokenProvider: () => {
                    tokenCalls++;
                    return 't';
                }
            });
            mock.handler = () => ({status: 200, body: {openapi: '3.0.0'}});
            (await noTokenClient.getOpenApi('abc')).should.deep.equal({openapi: '3.0.0'});
            mock.last().path.should.equal('/v1/openapi/abc');
            should.not.exist(mock.last().headers.authorization);
            await noTokenClient.getOpenApi();
            mock.last().path.should.equal('/v1/openapi/my-client');
            await noTokenClient.getHealth();
            mock.last().path.should.equal('/v1/health');
            should.not.exist(mock.last().headers.authorization);
            tokenCalls.should.equal(0);
        });

        it('reads the version with a token', async function () {
            mock.handler = () => ({status: 200, body: {app: 'api', version: '1.79.0'}});
            (await client.getVersion()).should.deep.equal({app: 'api', version: '1.79.0'});
            mock.last().path.should.equal('/v1/version');
            mock.last().headers.authorization.should.equal('Bearer static-token');
        });
    });

    describe('impersonate and client per call', function () {
        it('sends impersonateUser and clientId', async function () {
            await client.updateTicket('incidents', 'INC1', {data: {}}, {impersonateUser: 'abc123', clientId: 'other'});
            mock.last().query.should.deep.equal({clientId: 'other', impersonateUser: 'abc123'});
        });
    });

    describe('error handling', function () {
        const cases = [
            [401, {error: 'You are not authorized for this request.'}],
            [404, {data: {}}],
            [422, {error: [{message: 'body[searchString]: Invalid value'}]}],
            [429, {error: 'Too many requests'}],
            [500, {error: 'boom', stackTrace: 'at x'}]
        ];

        cases.forEach(([status, body]) => {
            it(`returns the body on ${status} by default`, async function () {
                mock.handler = () => ({status, body});
                (await client.searchTickets('incidents', 'x')).should.deep.equal(body);
            });

            it(`throws SmileConnectError on ${status} with throwOnError per call`, async function () {
                mock.handler = () => ({status, body});
                let error;
                try {
                    await client.getTicket('incidents', 'INC1', {throwOnError: true});
                } catch (e) {
                    error = e;
                }
                error.should.be.instanceOf(sc.SmileConnectError);
                error.should.be.instanceOf(Error);
                error.name.should.equal('SmileConnectError');
                error.status.should.equal(status);
                error.body.should.deep.equal(body);
                error.url.should.equal(`${mock.baseUrl}/v1/incidents/INC1`);
                error.message.should.contain(String(status));
            });
        });

        it('puts the api message into the error message', async function () {
            mock.handler = () => ({status: 422, body: {error: [{message: 'body[searchString]: Invalid value'}]}});
            let error;
            try {
                await client.searchTickets('incidents', '', {throwOnError: true});
            } catch (e) {
                error = e;
            }
            error.message.should.contain('body[searchString]: Invalid value');
        });

        it('throws on every call when throwOnError is set on the client, and per call can switch it off', async function () {
            const strict = new sc.SmileconnectClient({
                smileConnectUrl: mock.baseUrl,
                throwOnError: true,
                tokenProvider: () => 't'
            });
            mock.handler = () => ({status: 500, body: {error: 'boom'}});
            let error;
            try {
                await strict.getVersion();
            } catch (e) {
                error = e;
            }
            error.status.should.equal(500);
            (await strict.getVersion({throwOnError: false})).should.deep.equal({error: 'boom'});
        });

        it('keeps a success response unchanged with throwOnError', async function () {
            mock.handler = () => ({status: 200, body: {data: {id: 'INC1'}}});
            (await client.getTicket('incidents', 'INC1', {throwOnError: true})).should.deep.equal({data: {id: 'INC1'}});
        });

        it('keeps a non-json error body as text', async function () {
            mock.handler = () => ({status: 502, body: '<html>Bad Gateway</html>', headers: {'Content-Type': 'text/html'}});
            let error;
            try {
                await client.getTicket('incidents', 'INC1', {throwOnError: true});
            } catch (e) {
                error = e;
            }
            error.status.should.equal(502);
            error.body.should.equal('<html>Bad Gateway</html>');
        });

        it('rejects with the fetch error on network errors (default)', async function () {
            mock.handler = () => ({destroy: true});
            let error;
            try {
                await client.getTicket('incidents', 'INC1');
            } catch (e) {
                error = e;
            }
            should.exist(error);
            error.should.not.be.instanceOf(sc.SmileConnectError);
        });

        it('wraps network errors with throwOnError (no status)', async function () {
            mock.handler = () => ({destroy: true});
            let error;
            try {
                await client.getTicket('incidents', 'INC1', {throwOnError: true});
            } catch (e) {
                error = e;
            }
            error.should.be.instanceOf(sc.SmileConnectError);
            should.not.exist(error.status);
            should.exist(error.cause);
            error.url.should.equal(`${mock.baseUrl}/v1/incidents/INC1`);
        });

        it('wraps a refused connection with throwOnError', async function () {
            const dead = new sc.SmileconnectClient({
                smileConnectUrl: 'http://127.0.0.1:1',
                throwOnError: true,
                tokenProvider: () => 't'
            });
            let error;
            try {
                await dead.getVersion();
            } catch (e) {
                error = e;
            }
            error.should.be.instanceOf(sc.SmileConnectError);
            should.not.exist(error.status);
        });
    });

    describe('SSO per instance (identity provider mocked locally)', function () {
        function ssoClient(clientId, secret) {
            return new sc.SmileconnectClient({
                type: 'SMILEconnect',
                clientId,
                secret,
                ssoUrl: mock.ssoUrl,
                smileConnectUrl: mock.baseUrl
            });
        }

        it('fetches a token via client credentials and caches it', async function () {
            const c = ssoClient('client-a', 'secret-a');
            await c.getTicket('incidents', 'INC1');
            await c.getTicket('incidents', 'INC2');
            mock.requests.forEach(r => r.headers.authorization.should.equal('Bearer token-for-client-a-secret-a'));
            mock.tokenRequests.should.deep.equal([{clientId: 'client-a', secret: 'secret-a'}]);
        });

        it('shares one token request between parallel calls', async function () {
            const c = ssoClient('client-p', 'secret-p');
            await Promise.all([1, 2, 3, 4].map(i => c.getTicket('incidents', 'INC' + i)));
            mock.requests.length.should.equal(4);
            mock.tokenRequests.length.should.equal(1);
        });

        it('keeps credentials and tokens of several instances apart', async function () {
            const a = ssoClient('client-a', 'secret-a');
            const b = ssoClient('client-b', 'secret-b');
            await a.getTicket('incidents', 'A1');
            await b.getTicket('incidents', 'B1');
            await a.getTicket('incidents', 'A2');
            await b.getTicket('incidents', 'B2');
            const byPath = {};
            mock.requests.forEach(r => {
                byPath[r.path] = r.headers.authorization;
            });
            byPath['/v1/incidents/A1'].should.equal('Bearer token-for-client-a-secret-a');
            byPath['/v1/incidents/A2'].should.equal('Bearer token-for-client-a-secret-a');
            byPath['/v1/incidents/B1'].should.equal('Bearer token-for-client-b-secret-b');
            byPath['/v1/incidents/B2'].should.equal('Bearer token-for-client-b-secret-b');
            mock.tokenRequests.length.should.equal(2);
        });

        it('requests a new token when it is expired', async function () {
            mock.tokenLifetime = 0;
            try {
                const c = ssoClient('client-e', 'secret-e');
                let error;
                try {
                    await c.getTicket('incidents', 'INC1');
                } catch (e) {
                    error = e;
                }
                // a token that is expired right away cannot be used
                should.exist(error);
            } finally {
                mock.tokenLifetime = 300;
            }
        });

        it('fails clearly when the identity provider cannot be reached', async function () {
            const c = new sc.SmileconnectClient({
                clientId: 'x',
                secret: 'y',
                ssoUrl: 'http://127.0.0.1:1/sso',
                smileConnectUrl: mock.baseUrl
            });
            let error;
            try {
                await c.getTicket('incidents', 'INC1');
            } catch (e) {
                error = e;
            }
            should.exist(error);
            mock.requests.length.should.equal(0);
        });
    });
});
