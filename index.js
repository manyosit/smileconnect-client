const path = require('path');
const log = require('@manyos/logger').setupLog('SMILEconnect_' + path.basename(__filename));
const apiUtils = require('./apiUtils')

async function getIncident(incidentId) {
    log.debug('get incident', incidentId)
    const response = await apiUtils.doApiRequest(`/v1/incidents/${incidentId}`, 'GET');
    log.debug('got incident', response)
    return response
}

async function getWorkOrder(workOrderId) {
    log.debug('get workOrder', workOrderId)
    const response = await apiUtils.doApiRequest(`/v1/workorders/${workOrderId}`, 'GET');
    log.debug('got workOrder', response)
    return response
}

module.exports = {
    getIncident, getWorkOrder
}