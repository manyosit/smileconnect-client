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
    let smileconnectClient = new sc.SmileconnectClient(process.env.CLIENT_ID, process.env.CLIENT_SECRET)

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

    it ('it should read an incident', function (done) {
        smileconnectClient.getTicket('incidents', incidentId).then(result => {
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
});