const asyncHandler = require('../../utils/async-handler');
const permissionService = require('./permission.service');

const listPermissions = asyncHandler(async (req, res) => {
  const result = await permissionService.listPermissions(req.auth.user, req);
  res.status(200).json(result);
});

const getEffectivePermissions = asyncHandler(async (req, res) => {
  const result = await permissionService.getEffectivePermissions(
    req.params.userId,
    req.query,
    req.auth.user,
    req,
  );
  res.status(200).json(result);
});

module.exports = {
  listPermissions,
  getEffectivePermissions,
};
