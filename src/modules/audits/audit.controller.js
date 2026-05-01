const asyncHandler = require('../../utils/async-handler');
const auditService = require('./audit.service');

const getAudits = asyncHandler(async (req, res) => {
  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'audits.listed',
    entityType: 'audit',
    entityId: req.auth.user.id,
    statusCode: 200,
  });

  const result = await auditService.listUserAudits(req.auth.user.id);
  res.status(200).json(result);
});

module.exports = {
  getAudits,
};
