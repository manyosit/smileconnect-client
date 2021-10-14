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
    worklog.should.have.property('worklogId')
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
        }, 500);
    });

    let allSchema = [];
    this.timeout(5000);

    const incidentId = 'INC000000001401'
    const workOrderId = 'WO0000000001801'
    const alternateClient = 'idm'

    it ('it should read an incident', function (done) {
        smileconnectClient.getTicket('incidents', incidentId).then(result => {
            log.debug('result', result)
            ticketBaseCheck(result)
            done();
        }).catch(error => {
            done(error)
        })
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