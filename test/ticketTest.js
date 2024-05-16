const chai = require('chai');
//const chaiHttp = require('chai-http');
const should = chai.should();
const log = require('@manyos/logger').setupLog('dataguard-hs-test');
const sc = require('../index')

function ticketBaseCheck(result) {
    result.should.have.property('data')
    result.data.should.have.property('id')
}

function worklogBaseCheck(worklog) {
    worklog.should.have.property('summary')
}

function worklogsBaseCheck(result) {
    result.should.have.property('data')
    result.data.should.be.an('array')
//    result.data.length.should.gt(0)
    result.data.forEach(item => {
        worklogBaseCheck(item)
    })
}

function ticketTasksBaseCheck(result) {
    result.should.have.property('data')
    result.data.should.be.an('array')
//    result.data.length.should.gt(0)
    result.data.forEach(item => {
        taskBaseCheck(item)
    })
}

function taskBaseCheck(worklog) {
    worklog.should.have.property('id')
}

describe('Ticket Tests', function () {
    let jobId;
    const scOptions = {
        clientId: process.env.CLIENT_ID,
        secret: process.env.CLIENT_SECRET,
        ssoUrl: process.env.SSO_URL,
        smileConnectUrl: process.env.SMILECONNECT_URL
    }

    let smileconnectClient = new sc.SmileconnectClient(scOptions)

    before(function (done) {
        // wait for sso to startup and discover sso details
        setTimeout(function(){
            done();
        }, 1000);
    });

    let allSchema = [];
    this.timeout(5000);

    const incidentId = 'INC000000001401'
    const workOrderId = 'WO0000000001801'
    const alternateClient = 'idm'

    it ('it should read an incident', function (done) {
        this.timeout(5000);
        smileconnectClient.getTicket('incidents', incidentId).then(result => {
            log.debug('result', result)
            ticketBaseCheck(result)
            done();
        }).catch(error => {
            done(error)
        })
    });

    it ('it should mass read an incident', function (done) {
        this.timeout(50000);
        const resultArr = [];
        const ids = [
            "INC000000005801",
            "INC000000005702",
            "INC000000005701",
            "INC000000005603",
            "INC000000005602",
            "INC000000005601",
            "INC000000005501",
            "INC000000005401",
            "INC000000005305",
            "INC000000005304",
            "INC000000005303",
            "INC000000005302",
            "INC000000005301",
            "INC000000005206",
            "INC000000005205",
            "INC000000005204",
            "INC000000005203",
            "INC000000005202",
            "INC000000005201",
            "INC000000005102",
            "INC000000005101",
            "INC000000005002",
            "INC000000005001",
            "INC000000004909",
            "INC000000004908",
            "INC000000004907",
            "INC000000004906",
            "INC000000004905",
            "INC000000004904",
            "INC000000004903",
            "INC000000004902",
            "INC000000004901",
            "INC000000004806",
            "INC000000004805",
            "INC000000004804",
            "INC000000004803",
            "INC000000004802",
            "INC000000004619",
            "INC000000004618",
            "INC000000004617",
            "INC000000004616",
            "INC000000004615",
            "INC000000004614",
            "INC000000004613",
            "INC000000004612",
            "INC000000004611",
            "INC000000004610",
            "INC000000004609",
            "INC000000004608",
            "INC000000004607",
            "INC000000004606",
            "INC000000004605",
            "INC000000004604",
            "INC000000004603",
            "INC000000004602",
            "INC000000004601",
            "INC000000004501",
            "INC000000004424",
            "INC000000004423",
            "INC000000004422",
            "INC000000004421",
            "INC000000004420",
            "INC000000004419",
            "INC000000004418",
            "INC000000004417",
            "INC000000004416",
            "INC000000004415",
            "INC000000004414",
            "INC000000004413",
            "INC000000004412",
            "INC000000004411",
            "INC000000004410",
            "INC000000004409",
            "INC000000004408",
            "INC000000004407",
            "INC000000004406",
            "INC000000004405",
            "INC000000004404",
            "INC000000004403",
            "INC000000004402",
            "INC000000004401",
            "INC000000004301",
            "INC000000004222",
            "INC000000004221",
            "INC000000004220",
            "INC000000004219",
            "INC000000004218",
            "INC000000004217",
            "INC000000004216",
            "INC000000004215",
            "INC000000004214",
            "INC000000004213",
            "INC000000004212",
            "INC000000004211",
            "INC000000004210",
            "INC000000004209",
            "INC000000004208",
            "INC000000004207",
            "INC000000004206",
            "INC000000004205",
            "INC000000004204",
            "INC000000004203",
            "INC000000004202",
            "INC000000004201",
            "INC000000004101",
            "INC000000004004",
            "INC000000004003",
            "INC000000004002",
            "INC000000004001",
            "INC000000003901",
            "INC000000003807",
            "INC000000003806",
            "INC000000003805",
            "INC000000003804",
            "INC000000003803",
            "INC000000003802",
            "INC000000003801",
            "INC000000003714",
            "INC000000003713",
            "INC000000003712",
            "INC000000003711",
            "INC000000003710",
            "INC000000003709",
            "INC000000003708",
            "INC000000003707",
            "INC000000003706",
            "INC000000003705",
            "INC000000003704",
            "INC000000003703",
            "InC000000003702",
            "INC000000003701",
            "INC000000003684",
            "INC000000003683",
            "INC000000003682",
            "INC000000003681",
            "INC000000003680",
            "INC000000003679",
            "INC000000003678",
            "INC000000003677",
            "INC000000003676",
            "INC000000003675",
            "INC000000003674",
            "INC000000003673",
            "INC000000003671",
            "INC000000003670",
            "INC000000003669",
            "INC000000003668",
            "INC000000003667",
            "INC000000003666",
            "INC000000003665",
            "INC000000003664",
            "INC000000003663",
            "INC000000003662",
            "INC000000003661",
            "INC000000003660",
            "INC000000003658",
            "INC000000003656",
            "INC000000003654",
            "INC000000003652",
            "INC000000003651",
            "INC000000003650",
            "INC000000003649",
            "INC000000003648",
            "INC000000003647",
            "INC000000003646",
            "INC000000003645",
            "INC000000003644",
            "INC000000003642",
            "INC000000003641",
            "INC000000003640",
            "INC000000003639",
            "INC000000003638",
            "INC000000003637",
            "INC000000003636",
            "INC000000003635",
            "INC000000003634",
            "INC000000003633",
            "INC000000003632",
            "INC000000003631",
            "INC000000003630",
            "INC000000003629",
            "INC000000003628",
            "INC000000003627",
            "INC000000003626",
            "INC000000003625",
            "INC000000003624",
            "INC000000003623",
            "INC000000003622",
            "INC000000003621",
            "INC000000003620",
            "INC000000003618",
            "INC000000003617",
            "INC000000003615",
            "INC000000003603",
            "INC000000003535",
            "INC000000003533",
            "INC000000003531",
            "INC000000003528",
            "INC000000003527",
            "INC000000003514"
        ];
        for (let i = 0; i<ids.length; i ++) {
            const data = smileconnectClient.getTicket('incidents', ids[i]);
            resultArr.push(data);
        }
        Promise.all(resultArr).then(vals => {
            log.debug('All done');
            vals.forEach(res => {
                log.debug(res.data.id + ' -> ' + res.data.summary);
            });
            done();
        });

    });

    it ('it should create an incident', function (done) {
        const ticketData = {
            data: {
                summary: "New Incident"
            }
        }
        smileconnectClient.createTicket('incidents', ticketData).then(result => {
            log.debug('result', result)
            ticketBaseCheck(result)
            done();
        }).catch(error => {
            done(error)
        })
    });

    it ('it should update an incident', function (done) {
        const ticketData = {
            data: {
                summary: "New Incident Update"
            }
        }
        smileconnectClient.updateTicket('incidents', incidentId, ticketData).then(result => {
            log.debug('result', result)
            ticketBaseCheck(result)
            done();
        }).catch(error => {
            done(error)
        })
    });

    it ('it should read an incident as other client', function (done) {
        smileconnectClient.getTicket('incidents', incidentId, {clientId: alternateClient}).then(result => {
            log.debug('result', result)
            ticketBaseCheck(result)
            done();
        }).catch(error => {
            done(error)
        })
    });

    it ('it should read incident worklogs', function (done) {
        smileconnectClient.getTicketWorklogs('incidents', incidentId).then(result => {
            log.debug('result', result)
            worklogsBaseCheck(result)
            done();
        }).catch(error => {
            done(error)
        })
    });

    it ('it should read a workorder', function (done) {
        smileconnectClient.getTicket('workorders', workOrderId).then(result => {
            log.debug('result', result)
            ticketBaseCheck(result)
            done();
        }).catch(error => {
            done(error)
        })
    });

    it ('it should create a workorder worklog', function (done) {
        const worklogData = {
            data: {
                summary: "New Worklog",
                text: "Some details"
            }
        }
        smileconnectClient.createTicketWorklog('workorders', workOrderId, worklogData).then(result => {
            log.debug('result', result)
            worklogBaseCheck(result.data)
            done();
        }).catch(error => {
            done(error)
        })
    });

    it ('it should read workorder worklogs', function (done) {
        smileconnectClient.getTicketWorklogs('workorders', workOrderId).then(result => {
            log.debug('result', result)
            worklogsBaseCheck(result)
            done();
        }).catch(error => {
            done(error)
        })
    });

    it ('it should read workorder tasks', function (done) {
        smileconnectClient.getTicketTasks('workorders', workOrderId).then(result => {
            log.debug('result', result)
            ticketTasksBaseCheck(result)
            done();
        }).catch(error => {
            done(error)
        })
    });

    it ('it should validate a ci update request', function (done) {
        const updateData = {
            "ciChanges": [
                {
                    "ciId": "OI-54C6AD623D5945DE9B02C3DAD35301D5",
                    "attributes": {
                        "tagNumber": null,
                        "name": "Michel",
                        "wurst": "Brot"
                    }
                },
                {
                    "ciId": "OI-54C6AD623D5945DE9B02C3DAD35301D5d",
                    "attributes": {
                        "tagNumber": null,
                        "name": "Michel"
                    }
                }
            ]
        }
        smileconnectClient.validateCMDBUpdateRequest(updateData).then(result => {
            log.debug('result', result)
            result.should.have.property('validationResult')
            result.validationResult.should.be.an('array')
            done();
        }).catch(error => {
            done(error)
        })
    });
});