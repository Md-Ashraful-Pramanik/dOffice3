const asyncHandler = require('../../utils/async-handler');
const { toUserResponse } = require('./user.service');
const auditService = require('../audits/audit.service');

const getCurrentUser = asyncHandler(async (req, res) => {
  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'user.me.viewed',
    entityType: 'user',
    entityId: req.auth.user.id,
    statusCode: 200,
  });

  res.status(200).json(
    toUserResponse(req.auth.user, {
      token: req.token,
      refreshToken: req.auth.session.refreshToken,
    }),
  );
});

module.exports = {
  getCurrentUser,
};
