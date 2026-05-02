const { AppError, validationError } = require('../../utils/errors');
const { generateId } = require('../../utils/id');
const auditService = require('../audits/audit.service');
const delegationRepository = require('./delegation.repository');
const userRepository = require('../users/user.repository');

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

async function listDelegations(userId, queryParams, actingUser) {
  // Only self or admin may view
  if (actingUser.id !== userId && !isOrgAdmin(actingUser)) throw forbidden();

  const targetUser = await userRepository.findActiveUserById(userId);
  if (!targetUser) throw notFound();

  const delegations = await delegationRepository.findDelegationsByUser(userId, {
    status: queryParams.status,
  });

  return { delegations, totalCount: delegations.length };
}

async function createDelegation(userId, body, actingUser, req) {
  // Only self may create
  if (actingUser.id !== userId) throw forbidden();

  const targetUser = await userRepository.findActiveUserById(userId);
  if (!targetUser) throw notFound();

  const { delegation: data } = body || {};
  const errors = {};

  if (!data || !data.delegateUserId) errors.delegateUserId = ["can't be blank"];
  if (!data || !data.startDate) errors.startDate = ["can't be blank"];
  if (!data || !data.endDate) errors.endDate = ["can't be blank"];

  if (Object.keys(errors).length) throw validationError(errors);

  // Validate delegate user exists
  const delegateUser = await userRepository.findActiveUserById(data.delegateUserId);
  if (!delegateUser) throw validationError({ delegateUserId: ['user not found'] });

  if (data.delegateUserId === userId) {
    throw validationError({ delegateUserId: ['cannot delegate to yourself'] });
  }

  const startDate = new Date(data.startDate);
  const endDate = new Date(data.endDate);

  if (isNaN(startDate.getTime())) throw validationError({ startDate: ['is invalid'] });
  if (isNaN(endDate.getTime())) throw validationError({ endDate: ['is invalid'] });
  if (endDate <= startDate) throw validationError({ endDate: ['must be after start date'] });

  const id = generateId('del');
  const delegation = await delegationRepository.createDelegation({
    id,
    delegatorUserId: userId,
    delegateUserId: data.delegateUserId,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    reason: data.reason || null,
    scope: data.scope || {},
  });

  await auditService.logAction({
    req,
    userId: actingUser.id,
    action: 'delegations.created',
    entityType: 'delegation',
    entityId: id,
    statusCode: 201,
    metadata: { delegateUserId: data.delegateUserId },
  });

  return { delegation };
}

async function revokeDelegation(userId, delegationId, actingUser, req) {
  // self or admin may revoke
  if (actingUser.id !== userId && !isOrgAdmin(actingUser)) throw forbidden();

  const targetUser = await userRepository.findActiveUserById(userId);
  if (!targetUser) throw notFound();

  const delegation = await delegationRepository.findDelegationByIdAndUser(delegationId, userId);
  if (!delegation) throw notFound();

  await delegationRepository.softDeleteDelegation(delegationId);

  await auditService.logAction({
    req,
    userId: actingUser.id,
    action: 'delegations.revoked',
    entityType: 'delegation',
    entityId: delegationId,
    statusCode: 204,
  });
}

module.exports = {
  listDelegations,
  createDelegation,
  revokeDelegation,
};
