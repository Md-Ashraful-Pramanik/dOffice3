const asyncHandler = require('../../utils/async-handler');
const auditService = require('../audits/audit.service');
const channelService = require('./channel.service');

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

const listChannels = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await channelService.listChannels(req.query, req.auth.user, req.params.orgId);
  } catch (error) {
    await logFailure(req, 'channels.list_failed', 'organization', req.params.orgId, error);
    throw error;
  }
  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'channels.listed',
    entityType: 'organization',
    entityId: req.params.orgId,
    statusCode: 200,
    metadata: { count: result.channels.length, totalCount: result.totalCount },
  });
  res.status(200).json(result);
});

const getChannel = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await channelService.getChannel(req.params.channelId, req.auth.user);
  } catch (error) {
    await logFailure(req, 'channels.get_failed', 'channel', req.params.channelId, error);
    throw error;
  }
  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'channels.viewed',
    entityType: 'channel',
    entityId: req.params.channelId,
    statusCode: 200,
    metadata: { channelId: req.params.channelId },
  });
  res.status(200).json(result);
});

const createChannel = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await channelService.createChannel(req.params.orgId, req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'channels.create_failed', 'organization', req.params.orgId, error);
    throw error;
  }
  res.status(201).json(result);
});

const updateChannel = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await channelService.updateChannel(req.params.channelId, req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'channels.update_failed', 'channel', req.params.channelId, error);
    throw error;
  }
  res.status(200).json(result);
});

const deleteChannel = asyncHandler(async (req, res) => {
  await channelService.deleteChannel(req.params.channelId, req.auth.user, req);
  res.status(204).end();
});

const joinChannel = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await channelService.joinChannel(req.params.channelId, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'channel.join_failed', 'channel', req.params.channelId, error);
    throw error;
  }
  res.status(200).json(result);
});

const leaveChannel = asyncHandler(async (req, res) => {
  await channelService.leaveChannel(req.params.channelId, req.auth.user, req);
  res.status(204).end();
});

const inviteToChannel = asyncHandler(async (req, res) => {
  const result = await channelService.inviteToChannel(req.params.channelId, req.body, req.auth.user, req);
  res.status(200).json(result);
});

const removeMember = asyncHandler(async (req, res) => {
  await channelService.removeMember(req.params.channelId, req.params.userId, req.auth.user, req);
  res.status(204).end();
});

const listMembers = asyncHandler(async (req, res) => {
  const result = await channelService.listMembers(req.params.channelId, req.query, req.auth.user);
  res.status(200).json(result);
});

const setMemberRole = asyncHandler(async (req, res) => {
  const result = await channelService.setMemberRole(
    req.params.channelId,
    req.params.userId,
    req.body,
    req.auth.user,
    req,
  );
  res.status(200).json(result);
});

const listCategories = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await channelService.listCategories(req.params.orgId, req.query);
  } catch (error) {
    await logFailure(req, 'channel_categories.list_failed', 'organization', req.params.orgId, error);
    throw error;
  }
  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'channel_categories.listed',
    entityType: 'organization',
    entityId: req.params.orgId,
    statusCode: 200,
    metadata: { count: result.categories.length },
  });
  res.status(200).json(result);
});

const createCategory = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await channelService.createCategory(req.params.orgId, req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'channel_categories.create_failed', 'organization', req.params.orgId, error);
    throw error;
  }
  res.status(201).json(result);
});

const updateCategory = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await channelService.updateCategory(
      req.params.orgId,
      req.params.categoryId,
      req.body,
      req.auth.user,
      req,
    );
  } catch (error) {
    await logFailure(req, 'channel_categories.update_failed', 'channel_category', req.params.categoryId, error, {
      orgId: req.params.orgId,
    });
    throw error;
  }
  res.status(200).json(result);
});

const deleteCategory = asyncHandler(async (req, res) => {
  await channelService.deleteCategory(req.params.orgId, req.params.categoryId, req.auth.user, req);
  res.status(204).end();
});

const reorderCategories = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await channelService.reorderCategories(req.params.orgId, req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'channel_categories.reorder_failed', 'organization', req.params.orgId, error, {
      orgId: req.params.orgId,
    });
    throw error;
  }
  res.status(200).json(result);
});

module.exports = {
  listChannels,
  getChannel,
  createChannel,
  updateChannel,
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
