const express = require('express');
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const auditRoutes = require('./audit.routes');
const organizationRoutes = require('./organization.routes');
const auditService = require('../modules/audits/audit.service');
const asyncHandler = require('../utils/async-handler');

const router = express.Router();
const legacyRouter = express.Router();

router.get(
  '/hello',
  asyncHandler(async (req, res) => {
    await auditService.logAction({
      req,
      userId: null,
      action: 'hello.viewed',
      entityType: 'system',
      entityId: 'hello',
      statusCode: 200,
      metadata: { anonymous: true },
    });

    res.status(200).send('Hello world');
  }),
);

router.use('/api/v1/auth', authRoutes);
router.use('/api/v1', userRoutes);
router.use('/api/v1', organizationRoutes);
router.use('/api/v1', auditRoutes);
legacyRouter.use('/api', auditRoutes);

module.exports = {
  router,
  legacyRouter,
};
