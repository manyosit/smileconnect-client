const path = require('path');
const log = require('@manyos/logger').setupLog('SMILEconnect_' + path.basename(__filename));
const apiUtils = require('./apiUtils')
const allowedTicketTypes = ['incidents', 'changes', 'workorders', 'problems']
const ssoUtils = require('./ssoUtils')

class SmileconnectClient {
    params = {}
    constructor(params) {
        this.params = params;
        ssoUtils.setupClient(params.clientId, params.secret, params.ssoUrl);
    }

    async getTicket(ticketType, ticketId, options) {
        if (!allowedTicketTypes.includes(ticketType)) {
            throw new Error(`ticketType should be one of ${allowedTicketTypes.toString()}`)
        }
        log.debug('get ticket', ticketId)
        const response = await apiUtils.doApiRequest(`${this.params.smileConnectUrl}/v1/${ticketType}/${ticketId}`, 'GET', options);
        log.debug('got ticket', response)
        return response
    }

    async getTicketWorklogs(ticketType, ticketId, options) {
        if (!allowedTicketTypes.includes(ticketType)) {
            throw new Error(`ticketType should be one of ${allowedTicketTypes.toString()}`)
        }
        log.debug('get ticket worklogs', ticketId)
        const response = await apiUtils.doApiRequest(`${this.params.smileConnectUrl}/v1/${ticketType}/${ticketId}/worklogs`, 'GET', options);
        log.debug('got ticket worklogs', response)
        return response
    }

    async getTicketWorklog(ticketType, ticketId, worklogId, options) {
        if (!allowedTicketTypes.includes(ticketType)) {
            throw new Error(`ticketType should be one of ${allowedTicketTypes.toString()}`)
        }
        log.debug('get ticket worklog', ticketId)
        const response = await apiUtils.doApiRequest(`${this.params.smileConnectUrl}/v1/${ticketType}/${ticketId}/worklogs/${worklogId}`, 'GET', options);
        log.debug('got ticket worklog', response)
        return response
    }

    async getTicketTasks(ticketType, ticketId, taskId, options) {
        if (!allowedTicketTypes.includes(ticketType)) {
            throw new Error(`ticketType should be one of ${allowedTicketTypes.toString()}`)
        }
        log.debug('get tasks', ticketId)
        const response = await apiUtils.doApiRequest(`${this.params.smileConnectUrl}/v1/${ticketType}/${ticketId}/tasks`, 'GET', options);
        log.debug('got tasks', response)
        return response
    }

    async getTicketTask(ticketType, ticketId, taskId, options) {
        if (!allowedTicketTypes.includes(ticketType)) {
            throw new Error(`ticketType should be one of ${allowedTicketTypes.toString()}`)
        }
        log.debug('get task', ticketId)
        const response = await apiUtils.doApiRequest(`${this.params.smileConnectUrl}/v1/${ticketType}/${ticketId}/tasks/${taskId}`, 'GET', options);
        log.debug('got task', response)
        return response
    }

    async getTaskWorklogs(ticketType, ticketId, taskId, options) {
        if (!allowedTicketTypes.includes(ticketType)) {
            throw new Error(`ticketType should be one of ${allowedTicketTypes.toString()}`)
        }
        log.debug('get task worklogs', ticketId)
        const response = await apiUtils.doApiRequest(`${this.params.smileConnectUrl}/v1/${ticketType}/${ticketId}/tasks/${taskId}/worklogs`, 'GET', options);
        log.debug('got task worklogs', response)
        return response
    }

    async getTaskWorklog(ticketType, ticketId, taskId, worklogId, options) {
        if (!allowedTicketTypes.includes(ticketType)) {
            throw new Error(`ticketType should be one of ${allowedTicketTypes.toString()}`)
        }
        log.debug('get task worklog', ticketId)
        const response = await apiUtils.doApiRequest(`${this.params.smileConnectUrl}/v1/${ticketType}/${ticketId}/tasks/${taskId}/worklogs/${worklogId}`, 'GET', options);
        log.debug('got task worklog', response)
        return response
    }
}

module.exports = {
    SmileconnectClient
};