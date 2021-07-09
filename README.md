# smileconnect-client

A client for our BMC ITSM API SMILEconnect. Use this to easily access your BMC ITSM Suite via nodejs or as reference implementation of a SMILEconnect client.

Read more about SMILEconnect: https://manyos.it

Contribution via Pull Request is welcome.

Usage:

## Initialization

```javascript
const sc = require('@manyos/smileconnect')

const SMILEconnect = new sc.SmileconnectClient(process.env.CLIENT_ID, process.env.CLIENT_SECRET)
```

## Read Ticket

```javascript
const ticket = await SMILEconnect.getTicket('incidents', 'INC000000001401')
```

## Read TicketWorklogs
```javascript
const worklogs = await SMILEconnect.getTicketWorklogs('incidents', 'INC000000001401')
```

## Read TicketWorklog
```javascript
const worklog = await SMILEconnect.getTicketWorklog('incidents', 'INC000000001401', 'CWL000000001601')
```

## Read TicketTasks
```javascript
const tasks = await SMILEconnect.getTicketTasks('incidents', 'INC000000001401')
```

## Read TicketTask

```javascript
const task = await SMILEconnect.getTicketTask('incidents', 'INC000000001401', 'TAS000000046217')
```

## Read TicketTask Worklogs
```javascript
const worklogs = await SMILEconnect.getTaskWorklogs('incidents', 'INC000000001401', 'TAS000000046217')
```

## Read TicketTask Worklog
```javascript
const worklog = await SMILEconnect.getTaskWorklog('incidents', 'INC000000001401', 'TAS000000046217', 'CWL000000001601')
```