const asyncHandler = require('../../utils/async-handler');
const userService = require('./user.service');
const auditService = require('../audits/audit.service');

async function logFailure(req, action, entityType, entityId, error, metadata = {}) {
  if (!error || !error.statusCode) {
    return;
  }

  await auditService.logAction({
    req,
    userId: req.auth && req.auth.user ? req.auth.user.id : null,
    action,
    entityType,
    entityId,
    statusCode: error.statusCode,
    metadata: {
      message: error.message,
      details: error.details || {},
      ...metadata,
    },
  });
}

const getCurrentUser = asyncHandler(async (req, res) => {
  const user = await userService.getCurrentUser(req.auth.user.id);

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'user.me.viewed',
    entityType: 'user',
    entityId: req.auth.user.id,
    statusCode: 200,
  });

  res.status(200).json(
    userService.toUserResponse(user, {
      token: req.token,
      refreshToken: req.auth.session.refreshToken,
    }),
  );
});

const updateCurrentUser = asyncHandler(async (req, res) => {
  let result;

  try {
    result = await userService.updateCurrentUser(req.auth, req.body, req);
  } catch (error) {
    await logFailure(req, 'user.update_failed', 'user', req.auth.user.id, error);
    throw error;
  }

  res.status(200).json(
    userService.toUserResponse(result, {
      token: req.token,
      refreshToken: req.auth.session.refreshToken,
    }),
  );
});

const listOrganizationUsers = asyncHandler(async (req, res) => {
  let result;

  try {
    result = await userService.listOrganizationUsers(req.params.orgId, req.query, req.auth.user);
  } catch (error) {
    await logFailure(req, 'users.list_failed', 'organization', req.params.orgId, error, {
      orgId: req.params.orgId,
      query: req.query,
    });
    throw error;
  }

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'users.listed',
    entityType: 'organization',
    entityId: req.params.orgId,
    statusCode: 200,
    metadata: {
      orgId: req.params.orgId,
      limit: result.limit,
      offset: result.offset,
      totalCount: result.totalCount,
    },
  });

  res.status(200).json(result);
});

const getUserProfile = asyncHandler(async (req, res) => {
  let result;

  try {
    result = await userService.getUserProfile(req.params.userId, req.auth.user);
  } catch (error) {
    await logFailure(req, 'user.profile_view_failed', 'user', req.params.userId, error);
    throw error;
  }

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'user.profile_viewed',
    entityType: 'user',
    entityId: req.params.userId,
    statusCode: 200,
  });

  res.status(200).json(result);
});

const createOrganizationUser = asyncHandler(async (req, res) => {
  let result;

  try {
    result = await userService.createOrganizationUser(req.params.orgId, req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'users.create_failed', 'organization', req.params.orgId, error, {
      orgId: req.params.orgId,
    });
    throw error;
  }

  res.status(201).json(result);
});

const updateUserByAdmin = asyncHandler(async (req, res) => {
  let result;

  try {
    result = await userService.updateUserByAdmin(req.params.userId, req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'users.update_failed', 'user', req.params.userId, error);
    throw error;
  }

  res.status(200).json(result);
});

const deactivateUser = asyncHandler(async (req, res) => {
  let result;

  try {
    result = await userService.deactivateUser(req.params.userId, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'users.deactivate_failed', 'user', req.params.userId, error);
    throw error;
  }

  res.status(200).json(result);
});

const reactivateUser = asyncHandler(async (req, res) => {
  let result;

  try {
    result = await userService.reactivateUser(req.params.userId, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'users.reactivate_failed', 'user', req.params.userId, error);
    throw error;
  }

  res.status(200).json(result);
});

const deleteUser = asyncHandler(async (req, res) => {
  try {
    await userService.deleteUser(req.params.userId, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'users.delete_failed', 'user', req.params.userId, error);
    throw error;
  }

  res.status(204).send();
});

const getDirectory = asyncHandler(async (req, res) => {
  let result;

  try {
    result = await userService.getDirectory(req.params.orgId, req.query, req.auth.user);
  } catch (error) {
    await logFailure(req, 'directory.list_failed', 'organization', req.params.orgId, error, {
      orgId: req.params.orgId,
      query: req.query,
    });
    throw error;
  }

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'directory.listed',
    entityType: 'organization',
    entityId: req.params.orgId,
    statusCode: 200,
    metadata: {
      orgId: req.params.orgId,
      limit: result.limit,
      offset: result.offset,
      totalCount: result.totalCount,
    },
  });

  res.status(200).json(result);
});

const getOrgChart = asyncHandler(async (req, res) => {
  let result;

  try {
    result = await userService.getOrgChart(req.params.orgId, req.auth.user);
  } catch (error) {
    await logFailure(req, 'orgchart.view_failed', 'organization', req.params.orgId, error, {
      orgId: req.params.orgId,
    });
    throw error;
  }

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'orgchart.viewed',
    entityType: 'organization',
    entityId: req.params.orgId,
    statusCode: 200,
  });

  res.status(200).json(result);
});

const listCurrentUserSessions = asyncHandler(async (req, res) => {
  const result = await userService.listCurrentUserSessions(req.auth);

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'sessions.listed',
    entityType: 'session',
    entityId: req.auth.session.id,
    statusCode: 200,
    metadata: {
      totalCount: result.sessions.length,
    },
  });

  res.status(200).json(result);
});

const revokeCurrentUserSession = asyncHandler(async (req, res) => {
  try {
    await userService.revokeCurrentUserSession(req.params.sessionId, req.auth, req);
  } catch (error) {
    await logFailure(req, 'sessions.revoke_failed', 'session', req.params.sessionId, error);
    throw error;
  }

  res.status(204).send();
});

const revokeOtherSessions = asyncHandler(async (req, res) => {
  try {
    await userService.revokeOtherSessions(req.auth, req);
  } catch (error) {
    await logFailure(req, 'sessions.revoke_others_failed', 'session', req.auth.session.id, error);
    throw error;
  }

  res.status(204).send();
});

module.exports = {
  getCurrentUser,
  updateCurrentUser,
  listOrganizationUsers,
  getUserProfile,
  createOrganizationUser,
  updateUserByAdmin,
  deactivateUser,
  reactivateUser,
  deleteUser,
  getDirectory,
  getOrgChart,
  listCurrentUserSessions,
  revokeCurrentUserSession,
  revokeOtherSessions,
};
