const { AppError, validationError } = require('../../utils/errors');
const { generateId } = require('../../utils/id');
const auditService = require('../audits/audit.service');
const teamRepository = require('./team.repository');
const userRepository = require('../users/user.repository');
const organizationRepository = require('../organizations/organization.repository');

const FORBIDDEN_MESSAGE = 'You do not have permission to perform this action.';
const NOT_FOUND_MESSAGE = 'Resource not found.';
const SUPER_ADMIN_ROLES = new Set(['super_admin', 'role_super_admin']);
const ORG_ADMIN_ROLES = new Set(['org_admin', 'role_org_admin']);

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function isSuperAdmin(user) {
  return (user.roleIds || []).some((r) => SUPER_ADMIN_ROLES.has(normalizeRole(r)));
}

function isOrgAdmin(user) {
  return isSuperAdmin(user)
    || (user.roleIds || []).some((r) => ORG_ADMIN_ROLES.has(normalizeRole(r)));
}

function forbidden() {
  return new AppError(403, FORBIDDEN_MESSAGE);
}

function notFound() {
  return new AppError(404, NOT_FOUND_MESSAGE);
}

async function ensureOrgExists(orgId) {
  const org = await organizationRepository.findOrganizationById(orgId);
  if (!org || org.deletedAt) throw notFound();
  return org;
}

function buildTeamResponse(row, members) {
  const team = teamRepository.mapTeam(row, members);
  return { team };
}

async function listTeams(orgId, queryParams, actingUser) {
  await ensureOrgExists(orgId);

  const limit = Math.max(1, Math.min(100, parseInt(queryParams.limit, 10) || 20));
  const offset = Math.max(0, parseInt(queryParams.offset, 10) || 0);

  const { rows, totalCount } = await teamRepository.findTeamsByOrg(orgId, {
    search: queryParams.search,
    type: queryParams.type,
    limit,
    offset,
  });

  const teams = rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    memberCount: Number(row.member_count || 0),
  }));

  return { teams, totalCount, limit, offset };
}

async function getTeam(orgId, teamId, actingUser) {
  await ensureOrgExists(orgId);
  const row = await teamRepository.findTeamByIdAndOrg(teamId, orgId);
  if (!row) throw notFound();
  const members = await teamRepository.findTeamMembersByTeamId(teamId);
  return buildTeamResponse(row, members);
}

async function createTeam(orgId, body, actingUser, req) {
  if (!isOrgAdmin(actingUser)) throw forbidden();
  await ensureOrgExists(orgId);

  const { team: data } = body || {};
  const errors = {};

  const name = (data && data.name || '').trim();
  if (!name) errors.name = ["can't be blank"];

  if (Object.keys(errors).length) throw validationError(errors);

  const existing = await teamRepository.findTeamByName(name, orgId);
  if (existing) throw validationError({ name: ['has already been taken'] });

  const id = generateId('team');
  const type = (data.type === 'dynamic') ? 'dynamic' : 'static';
  const memberIds = Array.isArray(data.memberIds) ? data.memberIds : [];

  const row = await teamRepository.createTeam({
    id,
    name,
    description: data.description || null,
    type,
    orgId,
    permissionOverrides: data.permissionOverrides || [],
    dynamicFilter: data.dynamicFilter || {},
    createdByUserId: actingUser.id,
  });

  // Add initial members for static teams
  if (type === 'static') {
    for (const userId of memberIds) {
      const user = await userRepository.findActiveUserById(userId);
      if (user) {
        const memberId = generateId('tm');
        await teamRepository.addTeamMember({ id: memberId, teamId: id, userId, addedByUserId: actingUser.id });
      }
    }
  }

  await auditService.logAction({
    req,
    userId: actingUser.id,
    action: 'teams.created',
    entityType: 'team',
    entityId: id,
    statusCode: 201,
    metadata: { orgId, name },
  });

  const members = await teamRepository.findTeamMembersByTeamId(id);
  // Refresh the row to get the correct member_count
  const refreshedRow = await teamRepository.findTeamByIdAndOrg(id, orgId);
  return buildTeamResponse(refreshedRow, members);
}

async function updateTeam(orgId, teamId, body, actingUser, req) {
  if (!isOrgAdmin(actingUser)) throw forbidden();
  await ensureOrgExists(orgId);

  const row = await teamRepository.findTeamByIdAndOrg(teamId, orgId);
  if (!row) throw notFound();

  const { team: data } = body || {};
  const updates = {};

  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) throw validationError({ name: ["can't be blank"] });
    const conflict = await teamRepository.findTeamByName(name, orgId);
    if (conflict && conflict.id !== teamId) throw validationError({ name: ['has already been taken'] });
    updates.name = name;
  }
  if (data.description !== undefined) updates.description = data.description;
  if (data.permissionOverrides !== undefined) updates.permissionOverrides = data.permissionOverrides;
  if (data.dynamicFilter !== undefined) updates.dynamicFilter = data.dynamicFilter;

  const updatedRow = await teamRepository.updateTeam(teamId, updates);

  await auditService.logAction({
    req,
    userId: actingUser.id,
    action: 'teams.updated',
    entityType: 'team',
    entityId: teamId,
    statusCode: 200,
    metadata: { orgId },
  });

  const members = await teamRepository.findTeamMembersByTeamId(teamId);
  const refreshedRow = await teamRepository.findTeamByIdAndOrg(teamId, orgId);
  return buildTeamResponse(refreshedRow, members);
}

async function deleteTeam(orgId, teamId, actingUser, req) {
  if (!isOrgAdmin(actingUser)) throw forbidden();
  await ensureOrgExists(orgId);

  const row = await teamRepository.findTeamByIdAndOrg(teamId, orgId);
  if (!row) throw notFound();

  await teamRepository.softDeleteTeam(teamId);

  await auditService.logAction({
    req,
    userId: actingUser.id,
    action: 'teams.deleted',
    entityType: 'team',
    entityId: teamId,
    statusCode: 204,
    metadata: { orgId },
  });
}

async function addMembers(orgId, teamId, body, actingUser, req) {
  if (!isOrgAdmin(actingUser)) throw forbidden();
  await ensureOrgExists(orgId);

  const row = await teamRepository.findTeamByIdAndOrg(teamId, orgId);
  if (!row) throw notFound();

  const { userIds } = body || {};
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw validationError({ userIds: ["can't be blank"] });
  }

  for (const userId of userIds) {
    const user = await userRepository.findActiveUserById(userId);
    if (user) {
      const existing = await teamRepository.findTeamMember(teamId, userId);
      if (!existing) {
        const memberId = generateId('tm');
        await teamRepository.addTeamMember({ id: memberId, teamId, userId, addedByUserId: actingUser.id });
      }
    }
  }

  await auditService.logAction({
    req,
    userId: actingUser.id,
    action: 'teams.members_added',
    entityType: 'team',
    entityId: teamId,
    statusCode: 200,
    metadata: { orgId, userIds },
  });

  const members = await teamRepository.findTeamMembersByTeamId(teamId);
  const refreshedRow = await teamRepository.findTeamByIdAndOrg(teamId, orgId);
  return buildTeamResponse(refreshedRow, members);
}

async function removeMember(orgId, teamId, userId, actingUser, req) {
  if (!isOrgAdmin(actingUser)) throw forbidden();
  await ensureOrgExists(orgId);

  const row = await teamRepository.findTeamByIdAndOrg(teamId, orgId);
  if (!row) throw notFound();

  const member = await teamRepository.findTeamMember(teamId, userId);
  if (!member) throw notFound();

  await teamRepository.removeTeamMember(teamId, userId);

  await auditService.logAction({
    req,
    userId: actingUser.id,
    action: 'teams.member_removed',
    entityType: 'team',
    entityId: teamId,
    statusCode: 204,
    metadata: { orgId, userId },
  });
}

module.exports = {
  listTeams,
  getTeam,
  createTeam,
  updateTeam,
  deleteTeam,
  addMembers,
  removeMember,
};
