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

        it('module functions use the instance created last, like in 1.9.x', async function () {
            const ssoUtils = require('../ssoUtils');
            new sc.SmileconnectClient({
                clientId: 'module-client',
                secret: 'module-secret',
                ssoUrl: mock.ssoUrl,
                smileConnectUrl: mock.baseUrl
            });
            (await ssoUtils.getAccessToken()).should.equal('token-for-module-client-module-secret');
            mock.handler = () => ({status: 200, body: {data: {id: 'INC1'}}});
            const result = await apiUtils.doApiRequest(mock.baseUrl + '/v1/incidents/INC1', 'GET', {clientId: 'x'});
            result.should.deep.equal({data: {id: 'INC1'}});
            mock.last().headers.authorization.should.equal('Bearer token-for-module-client-module-secret');
            mock.last().query.should.deep.equal({clientId: 'x'});
            // a second instance takes over the module functions, the first keeps its own token
            const second = new sc.SmileconnectClient({
                clientId: 'second', secret: 's2', ssoUrl: mock.ssoUrl, smileConnectUrl: mock.baseUrl
            });
            (await ssoUtils.getAccessToken()).should.equal('token-for-second-s2');
            await second.getTicket('incidents', 'INC2');
            mock.last().headers.authorization.should.equal('Bearer token-for-second-s2');
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

        it('does not loop when the server ignores the offset, and says so', async function () {
            mock.handler = () => ({status: 200, body: {data: [{id: 1}, {id: 2}]}});
            let error;
            try {
                await client.listTicketsAll('incidents', {pageSize: 2});
            } catch (e) {
                error = e;
            }
            error.should.be.instanceOf(sc.SmileConnectError);
            error.message.should.contain('ignore the offset');
            mock.requests.length.should.equal(2);
        });

        it('does not stop early when records look alike', async function () {
            // only a non-unique field: page 1 and 2 start with the same record
            const all = Array.from({length: 30}, (_, i) => ({status: i < 15 ? 'Assigned' : 'Closed' + i}));
            mock.handler = req => ({status: 200, body: {data: all.slice(req.json.offset, req.json.offset + req.json.limit)}});
            const result = await client.searchTicketsAll('incidents', {searchString: 'x', fields: ['status']}, {pageSize: 10});
            result.should.deep.equal(all);
        });

        it('maxItems 0 returns nothing', async function () {
            const result = await client.listTicketsAll('incidents', {maxItems: 0});
            result.should.deep.equal([]);
            mock.requests.length.should.equal(0);
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

        it('returns status and error of a missing attachment (no data), or throws with throwOnError', async function () {
            mock.handler = () => ({status: 404, body: {error: 'not found'}});
            const result = await client.downloadTicketWorklogAttachment('incidents', 'INC1', 'WLG1', 1);
            result.should.deep.equal({status: 404, error: 'not found', body: {error: 'not found'}});
            // a body that has a data key must not look like a file
            mock.handler = () => ({status: 404, body: {data: {}}});
            const empty = await client.downloadTicketWorklogAttachment('incidents', 'INC1', 'WLG1', 2);
            should.not.exist(empty.data);
            empty.status.should.equal(404);
            empty.error.should.be.a('string');
            mock.handler = () => ({status: 404, body: {error: 'not found'}});
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

    describe('review fixes', function () {
        it('throwOnError wraps token errors, default keeps them', async function () {
            const failing = new sc.SmileconnectClient({
                smileConnectUrl: mock.baseUrl,
                tokenProvider: () => {
                    throw 'SSO Client not ready. Cannot get token';
                }
            });
            let error;
            try {
                await failing.getVersion();
            } catch (e) {
                error = e;
            }
            error.should.equal('SSO Client not ready. Cannot get token');
            error = undefined;
            try {
                await failing.getVersion({throwOnError: true});
            } catch (e) {
                error = e;
            }
            error.should.be.instanceOf(sc.SmileConnectError);
            should.not.exist(error.status);
            error.cause.should.equal('SSO Client not ready. Cannot get token');
            error.message.should.contain('SSO Client not ready');
            mock.requests.length.should.equal(0);
        });

        it('throwOnError wraps an unreachable identity provider', async function () {
            const c = new sc.SmileconnectClient({
                clientId: 'x', secret: 'y', ssoUrl: 'http://127.0.0.1:1/sso', smileConnectUrl: mock.baseUrl, throwOnError: true
            });
            let error;
            try {
                await c.getVersion();
            } catch (e) {
                error = e;
            }
            error.should.be.instanceOf(sc.SmileConnectError);
            should.not.exist(error.status);
        });

        it('flags the error so that scripts in a sandbox can check it without instanceof', async function () {
            mock.handler = () => ({status: 404, body: {data: {}}});
            let error;
            try {
                await client.getTicket('incidents', 'X', {throwOnError: true});
            } catch (e) {
                error = e;
            }
            error.name.should.equal('SmileConnectError');
            error.isSmileConnectError.should.equal(true);
        });

        it('*All methods let the page values win over limit/offset of the body', async function () {
            const all = Array.from({length: 7}, (_, i) => ({id: i}));
            mock.handler = req => ({status: 200, body: {data: all.slice(req.json.offset, req.json.offset + req.json.limit)}});
            const result = await client.searchTicketsAll('incidents',
                {searchString: 'x', limit: 5, offset: 3, fields: ['id']}, {pageSize: 4});
            result.length.should.equal(7);
            mock.requests.map(r => [r.json.limit, r.json.offset]).should.deep.equal([[4, 0], [4, 4], [4, 7]]);
            mock.requests[0].json.fields.should.deep.equal(['id']);
        });

        it('removes line breaks from the content type of a part', async function () {
            await client.uploadTicketWorklogAttachment('incidents', 'INC1', 'WLG1', 1,
                {data: 'x', filename: 'a\r\nb.txt', contentType: 'text/plain\r\nX-Evil: 1'});
            const text = mock.last().body.toString('latin1');
            text.should.contain('Content-Type: text/plainX-Evil: 1\r\n\r\n');
            text.should.not.contain('\r\nX-Evil: 1');
            text.should.contain('filename="a__b.txt"');
        });

        it('getOpenApi without any client id fails clearly', async function () {
            const noId = new sc.SmileconnectClient({smileConnectUrl: mock.baseUrl, tokenProvider: () => 't'});
            let error;
            try {
                await noId.getOpenApi();
            } catch (e) {
                error = e;
            }
            error.message.should.contain('clientId');
            mock.requests.length.should.equal(0);
        });

        describe('file name of a download', function () {
            async function nameFor(disposition) {
                mock.handler = () => ({status: 200, body: Buffer.from('x'), headers: {'Content-Disposition': disposition}});
                return (await client.downloadTicketWorklogAttachment('incidents', 'INC1', 'WLG1', 1)).fileName;
            }

            it('keeps ; inside a quoted name', async function () {
                (await nameFor('attachment; filename="a;b.txt"')).should.equal('a;b.txt');
            });

            it('does not decode plain names', async function () {
                (await nameFor('attachment; filename="100%25 done.txt"')).should.equal('100%25 done.txt');
                (await nameFor('attachment; filename=plain.txt')).should.equal('plain.txt');
                (await nameFor('attachment; filename="bad%zz.txt"')).should.equal('bad%zz.txt');
            });

            it('prefers filename* (RFC 5987) and decodes it', async function () {
                (await nameFor("attachment; filename=\"fallback.txt\"; filename*=UTF-8''%C3%BCber%20uns.txt")).should.equal('über uns.txt');
                (await nameFor("attachment; filename*=UTF-8''a%3Bb.txt; filename=\"x.txt\"")).should.equal('a;b.txt');
            });
        });

        it('sends non-UTF-8 bytes and CRLF in a file exactly', async function () {
            const content = Buffer.from([0xff, 0xfe, 0x00, 0x0d, 0x0a, 0x2d, 0x2d, 0x80, 0xc3, 0x28, 0x0d, 0x0a, 0x0d, 0x0a]);
            await client.uploadTicketWorklogAttachment('incidents', 'INC1', 'WLG1', 1, {data: content, filename: 'b.bin'});
            const req = mock.last();
            const boundary = req.headers['content-type'].split('boundary=')[1];
            const start = req.body.indexOf(Buffer.from('\r\n\r\n')) + 4;
            const end = req.body.lastIndexOf(Buffer.from('\r\n--' + boundary + '--\r\n'));
            req.body.slice(start, end).equals(content).should.equal(true);
        });
    });

    describe('review fixes 2', function () {
        async function rejection(promise) {
            try {
                await promise;
            } catch (e) {
                return e;
            }
            throw new Error('expected a rejection');
        }

        it('fails without a request when the token provider returns no token', async function () {
            for (const token of [undefined, null, '']) {
                const noToken = new sc.SmileconnectClient({smileConnectUrl: mock.baseUrl, tokenProvider: () => token});
                const error = await rejection(noToken.getVersion());
                error.message.should.contain('no access token');
                const wrapped = await rejection(noToken.getVersion({throwOnError: true}));
                wrapped.should.be.instanceOf(sc.SmileConnectError);
                wrapped.message.should.contain('no access token');
            }
            mock.requests.length.should.equal(0);
        });

        it('resolves an empty answer (204) to null, with and without throwOnError', async function () {
            mock.handler = () => ({status: 204});
            expect(await client.updateCmdbObject('OI-1', {data: {}})).to.equal(null);
            expect(await client.updateCmdbObject('OI-1', {data: {}}, {throwOnError: true})).to.equal(null);
            expect(await client.updateTicket('incidents', 'INC1', {data: {}})).to.equal(null);
        });

        it('a 2xx answer that is no JSON rejects (FetchError as in 1.9.2, SmileConnectError with throwOnError)', async function () {
            mock.handler = () => ({status: 200, body: '<html>login</html>', headers: {'Content-Type': 'text/html'}});
            const error = await rejection(client.getTicket('incidents', 'INC1'));
            error.name.should.equal('FetchError');
            error.type.should.equal('invalid-json');
            const wrapped = await rejection(client.getTicket('incidents', 'INC1', {throwOnError: true}));
            wrapped.should.be.instanceOf(sc.SmileConnectError);
            wrapped.status.should.equal(200);
            wrapped.body.should.equal('<html>login</html>');
            wrapped.message.should.contain('without JSON');
            // script endpoints may answer text, but an HTML page is no answer of the API
            const html = await rejection(client.callScriptEndpoint('x', {}, {throwOnError: true}));
            html.should.be.instanceOf(sc.SmileConnectError);
            mock.handler = () => ({status: 200, body: 'plain answer', headers: {'Content-Type': 'text/plain'}});
            (await client.callScriptEndpoint('x', {}, {throwOnError: true})).should.equal('plain answer');
        });

        it('returns only a plain file name from Content-Disposition', async function () {
            async function nameFor(disposition) {
                mock.handler = () => ({status: 200, body: Buffer.from('x'), headers: {'Content-Disposition': disposition}});
                return (await client.downloadTicketWorklogAttachment('incidents', 'INC1', 'WLG1', 1)).fileName;
            }
            (await nameFor("attachment; filename*=UTF-8''..%2F..%2F.ssh%2Fauthorized_keys")).should.equal('authorized_keys');
            (await nameFor('attachment; filename="..\\\\..\\\\evil.txt"')).should.equal('evil.txt');
            (await nameFor('attachment; filename="/etc/passwd"')).should.equal('passwd');
            (await nameFor('attachment; filename="C:evil.txt"')).should.equal('C_evil.txt');
            expect(await nameFor('attachment; filename=".."')).to.equal(undefined);
            expect(await nameFor("attachment; filename*=UTF-8''..%2F")).to.equal(undefined);
        });

        it('sends non-ASCII file names as UTF-8 plus filename*, and no path', async function () {
            await client.uploadTicketWorklogAttachment('incidents', 'INC1', 'WLG1', 1, {data: 'x', filename: "Übersicht (1).pdf"});
            const head = mock.last().body.toString('utf8');
            head.should.contain(`filename="Übersicht (1).pdf"; filename*=UTF-8''%C3%9Cbersicht%20%281%29.pdf\r\n`);
            await client.uploadTicketWorklogAttachment('incidents', 'INC1', 'WLG1', 1, {data: 'x', filename: 'C:\\temp\\a.txt'});
            const ascii = mock.last().body.toString('utf8');
            ascii.should.contain('filename="a.txt"\r\n');
            ascii.should.not.contain('filename*');
        });

        it('encodes ids of the methods of 1.9.x, too', async function () {
            await client.getTicket('incidents', 'a/b?c#d');
            await client.getTicketTask('incidents', 'INC1', '../persons/X');
            await client.getTaskWorklog('incidents', 'INC1', 'TAS1', 'W L');
            mock.requests.map(r => r.path).should.deep.equal([
                '/v1/incidents/a%2Fb%3Fc%23d',
                '/v1/incidents/INC1/tasks/..%2Fpersons%2FX',
                '/v1/incidents/INC1/tasks/TAS1/worklogs/W%20L'
            ]);
            mock.requests.forEach(r => r.query.should.deep.equal({}));
        });

        it('sends false, 0 and an empty string as script endpoint body', async function () {
            for (const body of [false, 0, '']) {
                await client.callScriptEndpoint('x', body);
                mock.last().body.toString().should.equal(JSON.stringify(body));
            }
            await client.callScriptEndpoint('x');
            mock.last().body.length.should.equal(0);
        });

        it('getOpenApi takes options as first parameter', async function () {
            mock.handler = () => ({status: 200, body: {openapi: '3.0.0'}});
            (await client.getOpenApi({throwOnError: true})).should.deep.equal({openapi: '3.0.0'});
            mock.last().path.should.equal('/v1/openapi/test-client');
        });
    });

    describe('review fixes 3', function () {
        async function rejection(promise) {
            try {
                await promise;
            } catch (e) {
                return e;
            }
            throw new Error('expected a rejection');
        }

        it('refuses the ids "", "." and ".." before any request', async function () {
            const calls = [
                () => client.getTicket('incidents', ''),
                () => client.getTicket('incidents', '.'),
                () => client.updateTicketTask('incidents', 'INC1', '..', {data: {status: 'Closed'}}),
                () => client.createTaskWorklog('incidents', 'INC1', '..', {data: {}}),
                () => client.uploadTaskWorklogAttachment('incidents', 'INC1', '..', 'WLG1', 1, 'x'),
                () => client.updateCustomFormRecord('..', '..', {data: {}}),
                () => client.callScriptEndpoint('.', {})
            ];
            for (const call of calls) {
                (await rejection(call())).message.should.contain('invalid id');
            }
            mock.requests.length.should.equal(0);
            // dots inside an id are fine
            await client.getTicket('incidents', 'a..b');
            mock.last().path.should.equal('/v1/incidents/a..b');
        });

        it('an error status with an empty body rejects as in 1.9.2, or throws with throwOnError', async function () {
            for (const status of [401, 500, 503]) {
                mock.handler = () => ({status});
                const error = await rejection(client.updateTicket('incidents', 'INC1', {data: {}}));
                error.name.should.equal('FetchError');
                error.type.should.equal('invalid-json');
                const wrapped = await rejection(client.updateTicket('incidents', 'INC1', {data: {}}, {throwOnError: true}));
                wrapped.should.be.instanceOf(sc.SmileConnectError);
                wrapped.status.should.equal(status);
                expect(wrapped.body).to.equal(null);
                // also where text answers are allowed
                (await rejection(client.callScriptEndpoint('x', {}))).name.should.equal('FetchError');
            }
        });

        it('uploads: text only counts as success with a 2xx status and when it is no HTML page', async function () {
            const upload = opts => client.uploadTicketWorklogAttachment('incidents', 'INC1', 'WLG1', 1, 'x', opts);
            mock.handler = () => ({status: 200, body: '<html><body>Please log in</body></html>', headers: {'Content-Type': 'text/html'}});
            (await rejection(upload({throwOnError: true}))).should.be.instanceOf(sc.SmileConnectError);
            (await rejection(upload())).name.should.equal('FetchError');
            mock.handler = () => ({status: 502, body: '<html>Bad Gateway</html>', headers: {'Content-Type': 'text/html'}});
            (await rejection(upload())).name.should.equal('FetchError');
            (await rejection(upload({throwOnError: true}))).status.should.equal(502);
            mock.handler = () => ({status: 413, body: 'Request Entity Too Large', headers: {'Content-Type': 'text/plain'}});
            (await rejection(upload())).name.should.equal('FetchError');
            mock.handler = () => ({status: 200, body: "['WLG1':'success']", headers: {'Content-Type': 'text/plain'}});
            (await upload()).should.equal("['WLG1':'success']");
            mock.handler = () => ({status: 400, body: {error: 'no file'}});
            (await upload()).should.deep.equal({error: 'no file'});
        });

        it('sends falsy bodies only to script endpoints and never a body with GET', async function () {
            // the module functions use the session of the instance created last
            new sc.SmileconnectClient({clientId: 'module-falsy', secret: 's', ssoUrl: mock.ssoUrl, smileConnectUrl: mock.baseUrl});
            await apiUtils.doApiRequest(mock.baseUrl + '/v1/version', 'GET', {}, '');
            mock.last().body.length.should.equal(0);
            await apiUtils.doApiRequest(mock.baseUrl + '/v1/version', 'GET', {}, {a: 1});
            mock.last().body.length.should.equal(0);
            await client.updateTicket('incidents', 'INC1', false);
            mock.last().body.length.should.equal(0);
            await client.createTicket('incidents', 0);
            mock.last().body.length.should.equal(0);
            await client.callScriptEndpoint('x', 0);
            mock.last().body.toString().should.equal('0');
        });

        it('takes paging values given as strings, and refuses values that are no numbers', async function () {
            const all = Array.from({length: 40}, (_, i) => ({id: i}));
            mock.handler = req => {
                const offset = Number(req.query.offset);
                return {status: 200, body: {data: all.slice(offset, offset + Number(req.query.limit))}};
            };
            const result = await client.listTicketsAll('incidents', {offset: '10', pageSize: '5', maxItems: '12'});
            result.map(r => r.id).should.deep.equal(all.slice(10, 22).map(r => r.id));
            mock.requests.map(r => r.query.offset).should.deep.equal(['10', '15', '20']);
            mock.reset();
            for (const paging of [{offset: 'abc'}, {pageSize: 0}, {maxItems: -1}, {pageSize: 2.5}]) {
                (await rejection(client.listTicketsAll('incidents', paging))).message.should.match(/must be a whole number/);
            }
            mock.requests.length.should.equal(0);
        });

        it('keeps the reason when the identity provider cannot be reached', async function () {
            const c = new sc.SmileconnectClient({
                clientId: 'unreachable', secret: 'y', ssoUrl: 'http://127.0.0.1:1/sso', smileConnectUrl: mock.baseUrl
            });
            // default: the error of 1.9.2
            (await rejection(c.getVersion())).should.equal('SSO Client not ready. Cannot get token');
            const error = await rejection(c.getVersion({throwOnError: true}));
            error.should.be.instanceOf(sc.SmileConnectError);
            error.cause.should.be.instanceOf(Error);
            error.code.should.equal('ECONNREFUSED');
            error.message.should.contain('SSO Client not ready');
            error.message.should.contain('discover');
        });

        it('keeps the reason when the identity provider refuses the grant', async function () {
            mock.tokenError = {status: 401, body: {error: 'invalid_client', error_description: 'bad secret'}};
            const c = new sc.SmileconnectClient({
                clientId: 'refused', secret: 'wrong', ssoUrl: mock.ssoUrl, smileConnectUrl: mock.baseUrl
            });
            const error = await rejection(c.getVersion({throwOnError: true}));
            error.should.be.instanceOf(sc.SmileConnectError);
            error.cause.error.should.equal('invalid_client');
            error.message.should.contain('invalid_client');
            mock.requests.length.should.equal(0);
        });

        describe('file name of a download', function () {
            async function nameFor(disposition) {
                mock.handler = () => ({status: 200, body: Buffer.from('x'), headers: {'Content-Disposition': disposition}});
                return (await client.downloadTicketWorklogAttachment('incidents', 'INC1', 'WLG1', 1)).fileName;
            }

            it('replaces C1 and bidi control characters', async function () {
                (await nameFor("attachment; filename*=UTF-8''invoice%C2%85%E2%80%AEfdp.exe")).should.equal('invoice__fdp.exe');
                (await nameFor("attachment; filename*=UTF-8''a%E2%81%A6b%E2%80%8Fc.txt")).should.equal('a_b_c.txt');
            });

            it('decodes filename* in ISO-8859-1', async function () {
                (await nameFor("attachment; filename*=iso-8859-1'de'%E4rger.txt")).should.equal('ärger.txt');
            });

            it('parses a long header quickly', async function () {
                const start = Date.now();
                await nameFor('attachment; filename*=' + ' '.repeat(16000) + 'x');
                (Date.now() - start).should.be.below(100);
            });
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

        it('shares discovery between parallel calls right after the constructor', async function () {
            const c = ssoClient('client-d', 'secret-d');
            await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(i => c.getTicket('incidents', 'INC' + i)));
            mock.discoveryRequests.should.equal(1);
            mock.tokenRequests.length.should.equal(1);
        });

        it('keeps credentials and tokens of several instances apart', async function () {
            const a = ssoClient('client-k', 'secret-k');
            const b = ssoClient('client-l', 'secret-l');
            await a.getTicket('incidents', 'A1');
            await b.getTicket('incidents', 'B1');
            await a.getTicket('incidents', 'A2');
            await b.getTicket('incidents', 'B2');
            const byPath = {};
            mock.requests.forEach(r => {
                byPath[r.path] = r.headers.authorization;
            });
            byPath['/v1/incidents/A1'].should.equal('Bearer token-for-client-k-secret-k');
            byPath['/v1/incidents/A2'].should.equal('Bearer token-for-client-k-secret-k');
            byPath['/v1/incidents/B1'].should.equal('Bearer token-for-client-l-secret-l');
            byPath['/v1/incidents/B2'].should.equal('Bearer token-for-client-l-secret-l');
            mock.tokenRequests.length.should.equal(2);
        });

        it('instances with the same credentials share one token, like the module wide token of 1.9.2', async function () {
            for (let i = 0; i < 5; i++) {
                await ssoClient('client-s', 'secret-s').getTicket('incidents', 'INC' + i);
            }
            mock.discoveryRequests.should.equal(1);
            mock.tokenRequests.length.should.equal(1);
            // a different secret is a different session
            await ssoClient('client-s', 'other-secret').getTicket('incidents', 'X');
            mock.tokenRequests.length.should.equal(2);
        });

        it('requests a new token when it is expired or about to expire', async function () {
            const c = ssoClient('client-e', 'secret-e');
            await c.getTicket('incidents', 'INC1');
            await c.getTicket('incidents', 'INC2');
            mock.tokenRequests.length.should.equal(1);
            const now = Math.floor(Date.now() / 1000);
            // still valid for 10 seconds: within the margin, renewed before it can expire in flight
            c.sso.tokenSet.expires_at = now + 10;
            await c.getTicket('incidents', 'INC3');
            mock.tokenRequests.length.should.equal(2);
            // expired
            c.sso.tokenSet.expires_at = now - 1;
            await c.getTicket('incidents', 'INC4');
            mock.tokenRequests.length.should.equal(3);
            mock.requests.forEach(r => r.headers.authorization.should.equal('Bearer token-for-client-e-secret-e'));
            // the new token is used from now on
            await c.getTicket('incidents', 'INC5');
            mock.tokenRequests.length.should.equal(3);
        });

        it('fails when the identity provider issues a token that is already expired', async function () {
            mock.tokenLifetime = 0;
            try {
                const c = ssoClient('client-z', 'secret-z');
                let error;
                try {
                    await c.getTicket('incidents', 'INC1');
                } catch (e) {
                    error = e;
                }
                error.should.equal('Could not get token');
                mock.requests.length.should.equal(0);
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
