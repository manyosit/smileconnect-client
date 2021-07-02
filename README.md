# smileconnect-client

A client for our BMC ITSM API SMILEconnect. Use this to easily access your BMC ITSM Suite via nodejs or as reference implementation of a SMILEconnect client.

Contribution via Pull Request is welcome.

Usage:

## Initialization

```javascript
const SMILEconnect = require('@manyos/smileconnect')
```

## Read Ticket

```javascript
const ticket = await SMILEconnect.getTicket('incidents', 'INC000000001401')
```

## Read TicketWorklogs
```javascript
const ticket = await SMILEconnect.getTicketWorklogs('incidents', 'INC000000001401')
```

## Read TicketWorklog
```javascript
const ticket = await SMILEconnect.getTicketWorklog('incidents', 'INC000000001401', 'CWL000000001601')
```

## Read TicketTasks
```javascript
const ticket = await SMILEconnect.getTicketTasks('incidents', 'INC000000001401')
```

## Read TicketTask

```javascript
const ticket = await SMILEconnect.getTicketTask('incidents', 'INC000000001401', 'TAS000000046217')
```

## Read TicketTask Worklogs
```javascript
const ticket = await SMILEconnect.getTaskWorklogs('incidents', 'INC000000001401', 'TAS000000046217')
```

## Read TicketTask Worklog
```javascript
const ticket = await SMILEconnect.getTaskWorklog('incidents', 'INC000000001401', 'TAS000000046217', 'CWL000000001601')
```