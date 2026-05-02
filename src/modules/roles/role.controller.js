const asyncHandler = require('../../utils/async-handler');
const auditService = require('../audits/audit.service');
const roleService = require('./role.service');

async function logFailure(req, action, entityType, entityId, error, metadata = {}) {
  if (!error || !error.statusCode) return;
  await auditService.logAction({
    req,
    userId: req.auth && req.auth.user ? req.auth.user.id : null,
    action,
    entityType,
    entityId,
    statusCode: error.statusCode,
    metadata: { message: error.message, details: error.details || {}, ...metadata },
  });
}

const listRoles = asyncHandler(async (req, res) => {
  const result = await roleService.listRoles(req.params.orgId, req.query, req.auth.user);
  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'roles.listed',
    entityType: 'organization',
    entityId: req.params.orgId,
    statusCode: 200,
    metadata: { totalCount: result.totalCount },
  });
  res.status(200).json(result);
});

const getRole = asyncHandler(async (req, res) => {
  const result = await roleService.getRole(req.params.orgId, req.params.roleId, req.auth.user);
  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'roles.viewed',
    entityType: 'role',
    entityId: req.params.roleId,
    statusCode: 200,
    metadata: { orgId: req.params.orgId },
  });
  res.status(200).json(result);
});

const createRole = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await roleService.createRole(req.params.orgId, req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'roles.create_failed', 'organization', req.params.orgId, error);
    throw error;
  }
  res.status(201).json(result);
});

const updateRole = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await roleService.updateRole(req.params.orgId, req.params.roleId, req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'roles.update_failed', 'role', req.params.roleId, error);
    throw error;
  }
  res.status(200).json(result);
});

const deleteRole = asyncHandler(async (req, res) => {
  try {
    await roleService.deleteRole(req.params.orgId, req.params.roleId, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'roles.delete_failed', 'role', req.params.roleId, error);
    throw error;
  }
  res.status(204).end();
});

const assignRoleToUser = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await roleService.assignRoleToUser(req.params.userId, req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'users.role_assign_failed', 'user', req.params.userId, error);
    throw error;
  }
  res.status(200).json(result);
});

const removeRoleFromUser = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await roleService.removeRoleFromUser(req.params.userId, req.params.roleId, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'users.role_remove_failed', 'user', req.params.userId, error);
    throw error;
  }
  res.status(200).json(result);
});

module.exports = {
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  assignRoleToUser,
  removeRoleFromUser,
};
