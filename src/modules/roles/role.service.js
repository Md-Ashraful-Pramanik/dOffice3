const { AppError, validationError } = require('../../utils/errors');
const { generateId } = require('../../utils/id');
const auditService = require('../audits/audit.service');
const roleRepository = require('./role.repository');
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

async function listRoles(orgId, query, actingUser) {
  await ensureOrgExists(orgId);
  const roles = await roleRepository.findRolesByOrg(orgId, {
    search: query.search,
    type: query.type,
  });
  return { roles, totalCount: roles.length };
}

async function getRole(orgId, roleId, actingUser) {
  await ensureOrgExists(orgId);
  const role = await roleRepository.findRoleByIdAndOrg(roleId, orgId);
  if (!role) throw notFound();
  return { role };
}

async function createRole(orgId, body, actingUser, req) {
  if (!isOrgAdmin(actingUser)) throw forbidden();

  await ensureOrgExists(orgId);

  const { role: data } = body || {};
  const errors = {};

  const name = (data && data.name || '').trim();
  if (!name) errors.name = ["can't be blank"];

  const permissions = data && data.permissions;
  if (!Array.isArray(permissions)) errors.permissions = ['must be an array'];

  if (Object.keys(errors).length) throw validationError(errors);

  // Validate permissions items
  if (permissions) {
    for (const p of permissions) {
      if (!p.module || !p.action || p.allow === undefined) {
        throw validationError({ permissions: ['each item must have module, action, and allow'] });
      }
    }
  }

  const existing = await roleRepository.findRoleByName(name, orgId);
  if (existing) throw validationError({ name: ['has already been taken'] });

  let inheritsFrom = (data && data.inheritsFrom) || null;
  if (inheritsFrom) {
    const parentRole = await roleRepository.findRoleById(inheritsFrom);
    if (!parentRole) throw validationError({ inheritsFrom: ['role not found'] });
  }

  const id = generateId('role');
  const role = await roleRepository.createRole({
    id,
    name,
    description: data.description || null,
    orgId,
    type: 'custom',
    inheritsFrom,
    permissions: permissions || [],
    createdByUserId: actingUser.id,
  });

  await auditService.logAction({
    req,
    userId: actingUser.id,
    action: 'roles.created',
    entityType: 'role',
    entityId: id,
    statusCode: 201,
    metadata: { orgId, name },
  });

  return { role };
}

async function updateRole(orgId, roleId, body, actingUser, req) {
  if (!isOrgAdmin(actingUser)) throw forbidden();

  await ensureOrgExists(orgId);
  const existing = await roleRepository.findRoleByIdAndOrg(roleId, orgId);
  if (!existing) throw notFound();

  if (existing.type === 'system') {
    throw new AppError(403, 'System roles cannot be modified.');
  }

  const { role: data } = body || {};
  const updates = {};

  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) throw validationError({ name: ["can't be blank"] });
    const conflict = await roleRepository.findRoleByName(name, orgId);
    if (conflict && conflict.id !== roleId) throw validationError({ name: ['has already been taken'] });
    updates.name = name;
  }

  if (data.description !== undefined) updates.description = data.description;
  if (data.permissions !== undefined) {
    if (!Array.isArray(data.permissions)) throw validationError({ permissions: ['must be an array'] });
    updates.permissions = data.permissions;
  }
  if (data.inheritsFrom !== undefined) {
    if (data.inheritsFrom) {
      const parentRole = await roleRepository.findRoleById(data.inheritsFrom);
      if (!parentRole) throw validationError({ inheritsFrom: ['role not found'] });
    }
    updates.inheritsFrom = data.inheritsFrom || null;
  }

  const role = await roleRepository.updateRole(roleId, updates);

  await auditService.logAction({
    req,
    userId: actingUser.id,
    action: 'roles.updated',
    entityType: 'role',
    entityId: roleId,
    statusCode: 200,
    metadata: { orgId },
  });

  return { role };
}

async function deleteRole(orgId, roleId, actingUser, req) {
  if (!isOrgAdmin(actingUser)) throw forbidden();

  await ensureOrgExists(orgId);
  const existing = await roleRepository.findRoleByIdAndOrg(roleId, orgId);
  if (!existing) throw notFound();

  if (existing.type === 'system') {
    throw new AppError(403, 'System roles cannot be deleted.');
  }

  await roleRepository.softDeleteRole(roleId);

  await auditService.logAction({
    req,
    userId: actingUser.id,
    action: 'roles.deleted',
    entityType: 'role',
    entityId: roleId,
    statusCode: 204,
    metadata: { orgId },
  });
}

async function assignRoleToUser(userId, body, actingUser, req) {
  if (!isOrgAdmin(actingUser)) throw forbidden();

  const { roleId, orgId } = body || {};
  const errors = {};
  if (!roleId) errors.roleId = ["can't be blank"];
  if (!orgId) errors.orgId = ["can't be blank"];
  if (Object.keys(errors).length) throw validationError(errors);

  // Ensure the target user exists
  const targetUser = await userRepository.findActiveUserById(userId);
  if (!targetUser) throw notFound();

  // Ensure org exists
  await ensureOrgExists(orgId);

  // Ensure role exists
  const role = await roleRepository.findRoleById(roleId);
  if (!role) throw validationError({ roleId: ['role not found'] });

  // Check if already assigned
  const existing = await roleRepository.findAssignment(userId, roleId, orgId);
  if (!existing) {
    const id = generateId('ura');
    await roleRepository.createAssignment({
      id,
      userId,
      roleId,
      orgId,
      assignedByUserId: actingUser.id,
    });
  }

  // Add roleId to user's role_ids if not already present
  const currentRoleIds = targetUser.roleIds || [];
  const updatedRoleIds = currentRoleIds.includes(roleId)
    ? currentRoleIds
    : [...currentRoleIds, roleId];
  const updatedUser = await userRepository.updateUser(userId, { roleIds: updatedRoleIds });
  const userService = require('../users/user.service');

  await auditService.logAction({
    req,
    userId: actingUser.id,
    action: 'users.role_assigned',
    entityType: 'user',
    entityId: userId,
    statusCode: 200,
    metadata: { roleId, orgId },
  });

  return userService.toUserResponse(updatedUser);
}

async function removeRoleFromUser(userId, roleId, actingUser, req) {
  if (!isOrgAdmin(actingUser)) throw forbidden();

  const targetUser = await userRepository.findActiveUserById(userId);
  if (!targetUser) throw notFound();

  const role = await roleRepository.findRoleById(roleId);
  if (!role) throw notFound();

  await roleRepository.softDeleteAssignment(userId, roleId);

  // Remove roleId from user's role_ids
  const refreshedUser = await userRepository.findActiveUserById(userId);
  const currentRoleIds = (refreshedUser && refreshedUser.roleIds) || [];
  const updatedRoleIds = currentRoleIds.filter((id) => id !== roleId);
  const updatedUser = await userRepository.updateUser(userId, { roleIds: updatedRoleIds });
  const userService = require('../users/user.service');

  await auditService.logAction({
    req,
    userId: actingUser.id,
    action: 'users.role_removed',
    entityType: 'user',
    entityId: userId,
    statusCode: 200,
    metadata: { roleId },
  });

  return userService.toUserResponse(updatedUser);
}

module.exports = {
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  assignRoleToUser,
  removeRoleFromUser,
};
