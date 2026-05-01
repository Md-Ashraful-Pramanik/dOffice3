const express = require('express');
const authenticate = require('../middlewares/authenticate');
const auditController = require('../modules/audits/audit.controller');

const router = express.Router();

router.get('/audits', authenticate, auditController.getAudits);

module.exports = router;
