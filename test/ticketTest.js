const chai = require('chai');
//const chaiHttp = require('chai-http');
const should = chai.should();
const log = require('@manyos/logger').setupLog('dataguard-hs-test');
const app = require('../index')

describe('Ticket Tests', function () {
    let jobId;
    before(function (done) {
        setTimeout(function(){
            done();
        }, 500);
    });

    let allSchema = [];
    this.timeout(5000);

    it ('it should read an incident', function (done) {
        app.getIncident('INC000000001401').then(result => {
            log.debug('result', result)
            result.should.have.property('data')
            result.data.should.have.property('id')
            done();
        })

    });

    it ('it should read a workorder', function (done) {
        app.getWorkOrder('WO0000000001801').then(result => {
            log.debug('result', result)
            result.should.have.property('data')
            result.data.should.have.property('id')
            done();
        })

    });
});