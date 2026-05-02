const asyncHandler = require('../../utils/async-handler');
const auditService = require('../audits/audit.service');
const teamService = require('./team.service');

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

const listTeams = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await teamService.listTeams(req.params.orgId, req.query, req.auth.user);
  } catch (error) {
    await logFailure(req, 'teams.list_failed', 'organization', req.params.orgId, error);
    throw error;
  }
  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'teams.listed',
    entityType: 'organization',
    entityId: req.params.orgId,
    statusCode: 200,
    metadata: { totalCount: result.totalCount },
  });
  res.status(200).json(result);
});

const getTeam = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await teamService.getTeam(req.params.orgId, req.params.teamId, req.auth.user);
  } catch (error) {
    await logFailure(req, 'teams.get_failed', 'team', req.params.teamId, error, { orgId: req.params.orgId });
    throw error;
  }
  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'teams.viewed',
    entityType: 'team',
    entityId: req.params.teamId,
    statusCode: 200,
    metadata: { orgId: req.params.orgId },
  });
  res.status(200).json(result);
});

const createTeam = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await teamService.createTeam(req.params.orgId, req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'teams.create_failed', 'organization', req.params.orgId, error);
    throw error;
  }
  res.status(201).json(result);
});

const updateTeam = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await teamService.updateTeam(req.params.orgId, req.params.teamId, req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'teams.update_failed', 'team', req.params.teamId, error);
    throw error;
  }
  res.status(200).json(result);
});

const deleteTeam = asyncHandler(async (req, res) => {
  try {
    await teamService.deleteTeam(req.params.orgId, req.params.teamId, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'teams.delete_failed', 'team', req.params.teamId, error);
    throw error;
  }
  res.status(204).end();
});

const addMembers = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await teamService.addMembers(req.params.orgId, req.params.teamId, req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'teams.add_members_failed', 'team', req.params.teamId, error);
    throw error;
  }
  res.status(200).json(result);
});

const removeMember = asyncHandler(async (req, res) => {
  try {
    await teamService.removeMember(req.params.orgId, req.params.teamId, req.params.userId, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'teams.remove_member_failed', 'team', req.params.teamId, error);
    throw error;
  }
  res.status(204).end();
});

module.exports = {
  listTeams,
  getTeam,
  createTeam,
  updateTeam,
  deleteTeam,
  addMembers,
  removeMember,
};
