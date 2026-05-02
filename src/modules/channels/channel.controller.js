const asyncHandler = require('../../utils/async-handler');
const channelService = require('./channel.service');

const listChannels = asyncHandler(async (req, res) => {
  const result = await channelService.listChannels(req.query, req.auth.user, req.params.orgId);
  res.status(200).json(result);
});

const getChannel = asyncHandler(async (req, res) => {
  const result = await channelService.getChannel(req.params.channelId, req.auth.user);
  res.status(200).json(result);
});

const createChannel = asyncHandler(async (req, res) => {
  const result = await channelService.createChannel(req.params.orgId, req.body, req.auth.user, req);
  res.status(201).json(result);
});

const updateChannel = asyncHandler(async (req, res) => {
  const result = await channelService.updateChannel(req.params.channelId, req.body, req.auth.user, req);
  res.status(200).json(result);
});

const deleteChannel = asyncHandler(async (req, res) => {
  await channelService.deleteChannel(req.params.channelId, req.auth.user, req);
  res.status(204).end();
});

const joinChannel = asyncHandler(async (req, res) => {
  const result = await channelService.joinChannel(req.params.channelId, req.auth.user, req);
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
  const result = await channelService.listCategories(req.params.orgId);
  res.status(200).json(result);
});

const createCategory = asyncHandler(async (req, res) => {
  const result = await channelService.createCategory(req.params.orgId, req.body, req.auth.user, req);
  res.status(201).json(result);
});

const updateCategory = asyncHandler(async (req, res) => {
  const result = await channelService.updateCategory(
    req.params.orgId,
    req.params.categoryId,
    req.body,
    req.auth.user,
    req,
  );
  res.status(200).json(result);
});

const deleteCategory = asyncHandler(async (req, res) => {
  await channelService.deleteCategory(req.params.orgId, req.params.categoryId, req.auth.user, req);
  res.status(204).end();
});

const reorderCategories = asyncHandler(async (req, res) => {
  const result = await channelService.reorderCategories(req.params.orgId, req.body, req.auth.user, req);
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
