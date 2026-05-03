const { AppError, validationError } = require('../../utils/errors');
const { generateId } = require('../../utils/id');
const { query } = require('../../db/pool');
const auditService = require('../audits/audit.service');
const channelRepository = require('./channel.repository');
const userRepository = require('../users/user.repository');
const realtimeRepository = require('../realtime/realtime.repository');

let _ws = null;
function getWebSocket() {
  if (!_ws) {
    try { _ws = require('../../realtime/websocket'); } catch (_) {}
  }
  return _ws;
}

const CHANNEL_TYPES = new Set(['public', 'private', 'announcement', 'cross-org']);
const CHANNEL_MEMBER_ROLES = new Set(['admin', 'moderator', 'member']);
const CHANNEL_UPDATE_FIELDS = new Set(['name', 'description', 'topic', 'categoryId', 'type']);
const CHANNEL_INVITE_PERMISSION_ACTIONS = new Set(['moderate', 'invite', 'invite_user', 'invite_member']);

const FORBIDDEN_MESSAGE = 'You do not have permission to perform this action.';
const NOT_FOUND_MESSAGE = 'Resource not found.';

function forbidden() {
  return new AppError(403, FORBIDDEN_MESSAGE);
}

function notFound() {
  return new AppError(404, NOT_FOUND_MESSAGE);
}

function isSuperAdmin(user) {
  return (user.roleIds || []).some((r) => ['super_admin', 'role_super_admin'].includes(String(r).toLowerCase()));
}

function isOrgAdmin(user) {
  return isSuperAdmin(user) || (user.roleIds || []).some((r) => ['org_admin', 'role_org_admin'].includes(String(r).toLowerCase()));
}

function parsePositiveInt(value, fallback, min = 0) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) return fallback;
  return n;
}

function validatePaginationQuery(query) {
  const errors = {};

  if (query.limit !== undefined) {
    const n = Number(query.limit);
    if (!Number.isInteger(n) || n < 1) errors.limit = 'Must be a positive integer.';
  }

  if (query.offset !== undefined) {
    const n = Number(query.offset);
    if (!Number.isInteger(n) || n < 0) errors.offset = 'Must be a non-negative integer.';
  }

  if (Object.keys(errors).length > 0) throw validationError(errors);
}

function normalizePermission(value) {
  return String(value || '').trim().toLowerCase();
}

function hasInvitePermissionEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const moduleName = normalizePermission(entry.module);
  const actionName = normalizePermission(entry.action);
  return moduleName === 'messaging' && CHANNEL_INVITE_PERMISSION_ACTIONS.has(actionName) && entry.allow === true;
}

async function hasElevatedInvitePermission(userId, orgId) {
  const rolePermissionsResult = await query(
    `SELECT r.permissions
     FROM user_role_assignments ura
     JOIN roles r ON r.id = ura.role_id
     WHERE ura.user_id = $1
       AND ura.org_id = $2
       AND ura.deleted_at IS NULL
       AND r.deleted_at IS NULL`,
    [userId, orgId],
  );

  for (const row of rolePermissionsResult.rows) {
    const permissions = Array.isArray(row.permissions) ? row.permissions : [];
    if (permissions.some(hasInvitePermissionEntry)) {
      return true;
    }
  }

  const teamOverridesResult = await query(
    `SELECT t.permission_overrides
     FROM team_members tm
     JOIN teams t ON t.id = tm.team_id
     WHERE tm.user_id = $1
       AND tm.deleted_at IS NULL
       AND t.org_id = $2
       AND t.deleted_at IS NULL`,
    [userId, orgId],
  );

  for (const row of teamOverridesResult.rows) {
    const overrides = Array.isArray(row.permission_overrides) ? row.permission_overrides : [];
    if (overrides.some(hasInvitePermissionEntry)) {
      return true;
    }
  }

  return false;
}

// ── channels ──────────────────────────────────────────────────────────────────

async function listChannels(rawQuery, user, orgId) {
  validatePaginationQuery(rawQuery);

  const limit = parsePositiveInt(rawQuery.limit, 50, 1);
  const offset = parsePositiveInt(rawQuery.offset, 0, 0);

  const joined = rawQuery.joined === 'true' ? user.id : null;

  const result = await channelRepository.listChannels({
    orgId,
    search: rawQuery.search,
    type: rawQuery.type,
    categoryId: rawQuery.categoryId,
    joinedUserId: joined,
    limit,
    offset,
  });

  // If not admin, filter out private channels the user is not a member of
  const filteredChannels = [];
  for (const ch of result.channels) {
    if (ch.type === 'private' && !isOrgAdmin(user)) {
      const membership = await channelRepository.findMembership(ch.id, user.id);
      if (!membership) continue;
    }
    filteredChannels.push(ch);
  }

  return {
    channels: filteredChannels,
    totalCount: result.totalCount,
    limit,
    offset,
  };
}

async function getChannel(channelId, user) {
  const channel = await channelRepository.findChannelById(channelId);
  if (!channel) throw notFound();

  if (channel.type === 'private' && !isOrgAdmin(user)) {
    const membership = await channelRepository.findMembership(channelId, user.id);
    if (!membership) throw forbidden();
  }

  return { channel };
}

async function createChannel(orgId, body, user, req) {
  const data = (body && body.channel) || {};
  const errors = {};

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const type = typeof data.type === 'string' ? data.type.trim() : '';

  if (!name) errors.name = 'Name is required.';
  if (!type) {
    errors.type = 'Type is required.';
  } else if (!CHANNEL_TYPES.has(type)) {
    errors.type = `Type must be one of: ${[...CHANNEL_TYPES].join(', ')}.`;
  }

  if (Object.keys(errors).length > 0) throw validationError(errors);

  const existing = await channelRepository.findChannelByNameAndOrg(name, orgId);
  if (existing) throw validationError({ name: 'A channel with this name already exists in the organization.' });

  if (data.categoryId) {
    const cat = await channelRepository.findCategoryById(data.categoryId);
    if (!cat || cat.orgId !== orgId) throw validationError({ categoryId: 'Category not found.' });
  }

  const id = generateId('ch');
  const channel = await channelRepository.createChannel({
    id,
    name,
    type,
    description: data.description,
    topic: data.topic,
    categoryId: data.categoryId || null,
    orgId,
    e2ee: type === 'private' ? (data.e2ee === true) : false,
    createdByUserId: user.id,
  });

  // Add creator as admin member
  await channelRepository.addMember({
    id: generateId('chm'),
    channelId: id,
    userId: user.id,
    role: 'admin',
    addedByUserId: user.id,
  });

  // Add explicit members for private channels
  if (type === 'private' && Array.isArray(data.memberIds)) {
    for (const memberId of data.memberIds) {
      if (memberId !== user.id) {
        await channelRepository.addMember({
          id: generateId('chm'),
          channelId: id,
          userId: memberId,
          role: 'member',
          addedByUserId: user.id,
        });
      }
    }
  }

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'channel.created',
    entityType: 'channel',
    entityId: id,
    statusCode: 201,
    metadata: { name, type, orgId },
  });

  const fresh = await channelRepository.findChannelById(id);
  return { channel: fresh };
}

async function updateChannel(channelId, body, user, req) {
  const channel = await channelRepository.findChannelById(channelId);
  if (!channel) throw notFound();

  // Must be channel admin or org admin
  const membership = await channelRepository.findMembership(channelId, user.id);
  if (!isOrgAdmin(user) && (!membership || membership.role !== 'admin')) throw forbidden();

  const data = (body && body.channel) || {};
  const errors = {};

  for (const key of Object.keys(body || {})) {
    if (key !== 'channel') {
      errors[key] = ['is not allowed'];
    }
  }

  if (body && body.channel !== undefined && (!body.channel || typeof body.channel !== 'object' || Array.isArray(body.channel))) {
    errors.channel = ['must be an object'];
  }

  for (const key of Object.keys(data)) {
    if (!CHANNEL_UPDATE_FIELDS.has(key)) {
      errors[key] = ['is not allowed'];
    }
  }

  const updates = {};

  if (data.name !== undefined) {
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) { errors.name = 'Name cannot be empty.'; }
    else {
      const existing = await channelRepository.findChannelByNameAndOrg(name, channel.orgId);
      if (existing && existing.id !== channelId) errors.name = 'A channel with this name already exists.';
      else updates.name = name;
    }
  }

  if (data.description !== undefined) updates.description = data.description;
  if (data.topic !== undefined) updates.topic = data.topic;

  if (data.categoryId !== undefined) {
    if (data.categoryId === null) {
      updates.category_id = null;
    } else {
      const cat = await channelRepository.findCategoryById(data.categoryId);
      if (!cat || cat.orgId !== channel.orgId) {
        errors.categoryId = 'Category not found.';
      } else {
        updates.category_id = data.categoryId;
      }
    }
  }

  if (data.type !== undefined) {
    if (!CHANNEL_TYPES.has(data.type)) {
      errors.type = `Type must be one of: ${[...CHANNEL_TYPES].join(', ')}.`;
    } else {
      updates.type = data.type;
    }
  }

  if (Object.keys(errors).length > 0) throw validationError(errors);

  const updated = await channelRepository.updateChannel(channelId, updates);

  const ws = getWebSocket();
  if (ws) {
    realtimeRepository.listChannelMemberUserIds(channelId)
      .then((audience) => ws.broadcastToUsers(audience, 'channel:updated', {
        channelId,
        changes: updates,
        updatedBy: user.id,
      }))
      .catch(() => {});
  }

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'channel.updated',
    entityType: 'channel',
    entityId: channelId,
    statusCode: 200,
    metadata: { fields: Object.keys(updates) },
  });

  return { channel: updated };
}

async function deleteChannel(channelId, user, req) {
  const channel = await channelRepository.findChannelById(channelId);
  if (!channel) throw notFound();

  const membership = await channelRepository.findMembership(channelId, user.id);
  if (!isOrgAdmin(user) && (!membership || membership.role !== 'admin')) throw forbidden();

  await channelRepository.softDeleteChannel(channelId);

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'channel.deleted',
    entityType: 'channel',
    entityId: channelId,
    statusCode: 204,
  });
}

async function setSlowMode(channelId, body, user, req) {
  const channel = await channelRepository.findChannelById(channelId);
  if (!channel) throw notFound();

  const membership = await channelRepository.findMembership(channelId, user.id);
  if (!isOrgAdmin(user) && (!membership || membership.role !== 'admin')) throw forbidden();

  const intervalSeconds = Number(body && body.intervalSeconds);
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 0) {
    throw validationError({ intervalSeconds: 'intervalSeconds must be an integer greater than or equal to 0.' });
  }

  const updated = await channelRepository.setChannelSlowMode(channelId, intervalSeconds);

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'channel.slow_mode_updated',
    entityType: 'channel',
    entityId: channelId,
    statusCode: 200,
    metadata: { intervalSeconds },
  });

  return { channel: updated };
}

async function joinChannel(channelId, user, req) {
  const channel = await channelRepository.findChannelById(channelId);
  if (!channel) throw notFound();

  const existing = await channelRepository.findMembership(channelId, user.id);

  if (channel.type === 'private' && !existing) {
    throw new AppError(403, 'Only users who are invited can join private channels.');
  }

  if (channel.type !== 'public' && channel.type !== 'private') {
    throw new AppError(403, 'Only public channels can be joined directly.');
  }

  if (!existing) {
    await channelRepository.addMember({
      id: generateId('chm'),
      channelId,
      userId: user.id,
      role: 'member',
      addedByUserId: user.id,
    });

    const ws = getWebSocket();
    if (ws) {
      realtimeRepository.listChannelMemberUserIds(channelId)
        .then((audience) => ws.broadcastToUsers(audience, 'channel:member_joined', {
          channelId,
          userId: user.id,
          username: user.username,
        }))
        .catch(() => {});
    }
  }

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'channel.joined',
    entityType: 'channel',
    entityId: channelId,
    statusCode: 200,
  });

  return { channel: await channelRepository.findChannelById(channelId) };
}

async function leaveChannel(channelId, user, req) {
  const channel = await channelRepository.findChannelById(channelId);
  if (!channel) throw notFound();

  const membership = await channelRepository.findMembership(channelId, user.id);
  if (!membership) throw validationError({ membership: 'You are not a member of this channel.' });

  // Prevent last admin from leaving
  if (membership.role === 'admin') {
    const adminCount = await channelRepository.countAdmins(channelId);
    if (adminCount <= 1) {
      throw validationError({ membership: 'Cannot leave: you are the last admin. Transfer admin role first.' });
    }
  }

  await channelRepository.removeMember(channelId, user.id);

  const ws = getWebSocket();
  if (ws) {
    realtimeRepository.listChannelMemberUserIds(channelId)
      .then((audience) => ws.broadcastToUsers([...audience, user.id], 'channel:member_left', {
        channelId,
        userId: user.id,
        username: user.username,
      }))
      .catch(() => {});
  }

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'channel.left',
    entityType: 'channel',
    entityId: channelId,
    statusCode: 204,
  });
}

async function inviteToChannel(channelId, body, user, req) {
  const channel = await channelRepository.findChannelById(channelId);
  if (!channel) throw notFound();

  const membership = await channelRepository.findMembership(channelId, user.id);
  if (!membership && !isOrgAdmin(user)) throw forbidden();

  if (!isOrgAdmin(user) && membership && membership.role !== 'admin' && channel.type === 'private') {
    const canInviteToPrivate = await hasElevatedInvitePermission(user.id, channel.orgId);
    if (!canInviteToPrivate) throw forbidden();
  }

  const userIds = body && Array.isArray(body.userIds) ? body.userIds : null;
  if (!userIds || userIds.length === 0) throw validationError({ userIds: 'userIds is required.' });

  const normalizedUserIds = [];
  for (const uid of userIds) {
    if (typeof uid !== 'string' || !uid.trim()) {
      throw validationError({ userIds: 'userIds must contain valid user ids.' });
    }
    normalizedUserIds.push(uid.trim());
  }

  const uniqueUserIds = [...new Set(normalizedUserIds)];
  if (uniqueUserIds.length !== normalizedUserIds.length) {
    throw validationError({ userIds: 'userIds must not contain duplicate values.' });
  }

  const alreadyMembers = [];
  for (const uid of uniqueUserIds) {
    const existing = await channelRepository.findMembership(channelId, uid);
    if (existing) alreadyMembers.push(uid);
  }

  if (alreadyMembers.length > 0) {
    throw validationError({ userIds: 'One or more users are already members of this channel.' });
  }

  for (const uid of uniqueUserIds) {
    await channelRepository.addMember({
      id: generateId('chm'),
      channelId,
      userId: uid,
      role: 'member',
      addedByUserId: user.id,
    });
  }

  const ws = getWebSocket();
  if (ws) {
    for (const uid of uniqueUserIds) {
      const invitedUser = await userRepository.findActiveUserById(uid);
      if (!invitedUser) continue;
      realtimeRepository.listChannelMemberUserIds(channelId)
        .then((audience) => ws.broadcastToUsers(audience, 'channel:member_joined', {
          channelId,
          userId: uid,
          username: invitedUser.username,
        }))
        .catch(() => {});
    }
  }

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'channel.invited',
    entityType: 'channel',
    entityId: channelId,
    statusCode: 200,
    metadata: { userIds: uniqueUserIds },
  });

  return { channel: await channelRepository.findChannelById(channelId) };
}

async function removeMember(channelId, targetUserId, user, req) {
  const channel = await channelRepository.findChannelById(channelId);
  if (!channel) throw notFound();

  const membership = await channelRepository.findMembership(channelId, user.id);
  if (!isOrgAdmin(user) && (!membership || membership.role !== 'admin')) throw forbidden();

  const targetMembership = await channelRepository.findMembership(channelId, targetUserId);
  if (!targetMembership) throw notFound();

  const targetUser = await userRepository.findActiveUserById(targetUserId);
  await channelRepository.removeMember(channelId, targetUserId);

  const ws = getWebSocket();
  if (ws) {
    realtimeRepository.listChannelMemberUserIds(channelId)
      .then((audience) => ws.broadcastToUsers([...audience, targetUserId], 'channel:member_left', {
        channelId,
        userId: targetUserId,
        username: targetUser?.username || targetUserId,
      }))
      .catch(() => {});
  }

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'channel.member_removed',
    entityType: 'channel',
    entityId: channelId,
    statusCode: 204,
    metadata: { targetUserId },
  });
}

async function listMembers(channelId, rawQuery, user) {
  const channel = await channelRepository.findChannelById(channelId);
  if (!channel) throw notFound();

  if (channel.type === 'private' && !isOrgAdmin(user)) {
    const membership = await channelRepository.findMembership(channelId, user.id);
    if (!membership) throw forbidden();
  }

  validatePaginationQuery(rawQuery);
  const limit = parsePositiveInt(rawQuery.limit, 50, 1);
  const offset = parsePositiveInt(rawQuery.offset, 0, 0);

  const result = await channelRepository.listMembers({
    channelId,
    search: rawQuery.search,
    role: rawQuery.role,
    limit,
    offset,
  });

  return {
    users: result.members,
    totalCount: result.totalCount,
    limit,
    offset,
  };
}

async function setMemberRole(channelId, targetUserId, body, user, req) {
  const channel = await channelRepository.findChannelById(channelId);
  if (!channel) throw notFound();

  const membership = await channelRepository.findMembership(channelId, user.id);
  if (!isOrgAdmin(user) && (!membership || membership.role !== 'admin')) throw forbidden();

  const role = body && body.role;
  if (!role || !CHANNEL_MEMBER_ROLES.has(role)) {
    throw validationError({ role: `Role must be one of: ${[...CHANNEL_MEMBER_ROLES].join(', ')}.` });
  }

  const targetMembership = await channelRepository.findMembership(channelId, targetUserId);
  if (!targetMembership) throw notFound();

  await channelRepository.setMemberRole(channelId, targetUserId, role);

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'channel.member_role_updated',
    entityType: 'channel',
    entityId: channelId,
    statusCode: 200,
    metadata: { targetUserId, role },
  });

  return {
    member: {
      userId: targetUserId,
      channelId,
      role,
    },
  };
}

// ── channel categories ────────────────────────────────────────────────────────

async function listCategories(orgId, rawQuery = {}) {
  validatePaginationQuery(rawQuery);
  const categories = await channelRepository.listCategories(orgId);
  return { categories };
}

async function createCategory(orgId, body, user, req) {
  if (!isOrgAdmin(user)) throw forbidden();

  const data = (body && body.category) || {};
  const errors = {};

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) errors.name = 'Name is required.';

  if (Object.keys(errors).length > 0) throw validationError(errors);

  const existing = await channelRepository.findCategoryByNameAndOrg(name, orgId);
  if (existing) throw validationError({ name: 'A category with this name already exists.' });

  const id = generateId('cat');
  const category = await channelRepository.createCategory({
    id,
    name,
    orgId,
    position: data.position != null ? Number(data.position) : 0,
    createdByUserId: user.id,
  });

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'channel_category.created',
    entityType: 'channel_category',
    entityId: id,
    statusCode: 201,
    metadata: { name, orgId },
  });

  return { category };
}

async function updateCategory(orgId, categoryId, body, user, req) {
  if (!isOrgAdmin(user)) throw forbidden();

  const cat = await channelRepository.findCategoryById(categoryId);
  if (!cat || cat.orgId !== orgId) throw notFound();

  const data = (body && body.category) || {};
  const updates = {};

  if (data.name !== undefined) {
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) throw validationError({ name: 'Name cannot be empty.' });
    const existing = await channelRepository.findCategoryByNameAndOrg(name, orgId);
    if (existing && existing.id !== categoryId) throw validationError({ name: 'A category with this name already exists.' });
    updates.name = name;
  }

  if (data.position !== undefined) {
    updates.position = Number(data.position);
  }

  const updated = await channelRepository.updateCategory(categoryId, updates);

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'channel_category.updated',
    entityType: 'channel_category',
    entityId: categoryId,
    statusCode: 200,
  });

  return { category: updated };
}

async function deleteCategory(orgId, categoryId, user, req) {
  if (!isOrgAdmin(user)) throw forbidden();

  const cat = await channelRepository.findCategoryById(categoryId);
  if (!cat || cat.orgId !== orgId) throw notFound();

  await channelRepository.softDeleteCategory(categoryId);

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'channel_category.deleted',
    entityType: 'channel_category',
    entityId: categoryId,
    statusCode: 204,
  });
}

async function reorderCategories(orgId, body, user, req) {
  if (!isOrgAdmin(user)) throw forbidden();

  const order = body && Array.isArray(body.order) ? body.order : null;
  if (!order) throw validationError({ order: 'order is required and must be an array.' });

  if (order.some((id) => typeof id !== 'string' || !id.trim())) {
    throw validationError({ order: 'order must contain valid category ids.' });
  }

  const existingCategories = await channelRepository.listCategories(orgId);
  const existingIds = existingCategories.map((category) => category.id);

  const uniqueOrderedIds = new Set(order);
  if (uniqueOrderedIds.size !== order.length) {
    throw validationError({ order: 'order must contain each category id exactly once.' });
  }

  if (order.length !== existingIds.length) {
    throw validationError({ order: 'order must contain all categories in the organization.' });
  }

  const existingIdSet = new Set(existingIds);
  const hasUnknownId = order.some((id) => !existingIdSet.has(id));
  if (hasUnknownId) {
    throw validationError({ order: 'order contains one or more invalid category ids.' });
  }

  await channelRepository.reorderCategories(orgId, order);

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'channel_categories.reordered',
    entityType: 'channel_category',
    entityId: orgId,
    statusCode: 200,
    metadata: { order },
  });

  const categories = await channelRepository.listCategories(orgId);
  return { categories };
}

module.exports = {
  listChannels,
  getChannel,
  createChannel,
  updateChannel,
  setSlowMode,
  deleteChannel,
  joinChannel,
  leaveChannel,
  inviteToChannel,
  removeMember,
  listMembers,
  setMemberRole,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
};
