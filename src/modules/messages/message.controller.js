const asyncHandler = require('../../utils/async-handler');
const auditService = require('../audits/audit.service');
const messageService = require('./message.service');

async function logFailure(req, action, entityType, entityId, error, metadata = {}) {
  if (!error || !error.statusCode) return;

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

const listConversations = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await messageService.listConversations(req.query, req.auth.user);
  } catch (error) {
    await logFailure(req, 'conversations.list_failed', 'user', req.auth.user.id, error);
    throw error;
  }

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'conversations.listed',
    entityType: 'user',
    entityId: req.auth.user.id,
    statusCode: 200,
    metadata: { totalCount: result.totalCount, limit: result.limit, offset: result.offset },
  });

  res.status(200).json(result);
});

const getConversation = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await messageService.getConversation(req.params.conversationId, req.auth.user);
  } catch (error) {
    await logFailure(req, 'conversations.get_failed', 'conversation', req.params.conversationId, error);
    throw error;
  }

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'conversations.viewed',
    entityType: 'conversation',
    entityId: req.params.conversationId,
    statusCode: 200,
  });

  res.status(200).json(result);
});

const createConversation = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await messageService.createConversation(req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'conversations.create_failed', 'user', req.auth.user.id, error);
    throw error;
  }

  res.status(201).json(result);
});

const addConversationParticipants = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await messageService.addConversationParticipants(
      req.params.conversationId,
      req.body,
      req.auth.user,
      req,
    );
  } catch (error) {
    await logFailure(req, 'conversations.participants_add_failed', 'conversation', req.params.conversationId, error);
    throw error;
  }

  res.status(200).json(result);
});

const removeConversationParticipant = asyncHandler(async (req, res) => {
  try {
    await messageService.removeConversationParticipant(
      req.params.conversationId,
      req.params.userId,
      req.auth.user,
      req,
    );
  } catch (error) {
    await logFailure(req, 'conversations.participant_remove_failed', 'conversation', req.params.conversationId, error, {
      targetUserId: req.params.userId,
    });
    throw error;
  }

  res.status(204).end();
});

const listChannelMessages = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await messageService.listChannelMessages(req.params.channelId, req.query, req.auth.user);
  } catch (error) {
    await logFailure(req, 'messages.list_channel_failed', 'channel', req.params.channelId, error);
    throw error;
  }

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'messages.channel_listed',
    entityType: 'channel',
    entityId: req.params.channelId,
    statusCode: 200,
    metadata: {
      count: result.messages.length,
      hasMore: result.hasMore,
      limit: req.query.limit,
      before: req.query.before,
      after: req.query.after,
    },
  });

  res.status(200).json(result);
});

const listConversationMessages = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await messageService.listConversationMessages(req.params.conversationId, req.query, req.auth.user);
  } catch (error) {
    await logFailure(req, 'messages.list_conversation_failed', 'conversation', req.params.conversationId, error);
    throw error;
  }

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'messages.conversation_listed',
    entityType: 'conversation',
    entityId: req.params.conversationId,
    statusCode: 200,
    metadata: {
      count: result.messages.length,
      hasMore: result.hasMore,
      limit: req.query.limit,
      before: req.query.before,
      after: req.query.after,
    },
  });

  res.status(200).json(result);
});

const sendChannelMessage = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await messageService.sendChannelMessage(req.params.channelId, req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'messages.create_channel_failed', 'channel', req.params.channelId, error);
    throw error;
  }

  res.status(201).json(result);
});

const sendConversationMessage = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await messageService.sendConversationMessage(req.params.conversationId, req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'messages.create_conversation_failed', 'conversation', req.params.conversationId, error);
    throw error;
  }

  res.status(201).json(result);
});

const getMessage = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await messageService.getMessage(req.params.messageId, req.auth.user);
  } catch (error) {
    await logFailure(req, 'messages.get_failed', 'message', req.params.messageId, error);
    throw error;
  }

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'messages.viewed',
    entityType: 'message',
    entityId: req.params.messageId,
    statusCode: 200,
  });

  res.status(200).json(result);
});

const updateMessage = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await messageService.updateMessage(req.params.messageId, req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'messages.update_failed', 'message', req.params.messageId, error);
    throw error;
  }

  res.status(200).json(result);
});

const deleteMessage = asyncHandler(async (req, res) => {
  try {
    await messageService.deleteMessage(req.params.messageId, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'messages.delete_failed', 'message', req.params.messageId, error);
    throw error;
  }

  res.status(204).end();
});

const getMessageEdits = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await messageService.getMessageEdits(req.params.messageId, req.auth.user);
  } catch (error) {
    await logFailure(req, 'messages.edits_list_failed', 'message', req.params.messageId, error);
    throw error;
  }

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'messages.edits_listed',
    entityType: 'message',
    entityId: req.params.messageId,
    statusCode: 200,
    metadata: { count: result.edits.length },
  });

  res.status(200).json(result);
});

const getThread = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await messageService.getThread(req.params.messageId, req.query, req.auth.user);
  } catch (error) {
    await logFailure(req, 'messages.thread_list_failed', 'message', req.params.messageId, error);
    throw error;
  }

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'messages.thread_listed',
    entityType: 'message',
    entityId: req.params.messageId,
    statusCode: 200,
    metadata: {
      count: result.messages.length,
      hasMore: result.hasMore,
      limit: req.query.limit,
      offset: req.query.offset,
    },
  });

  res.status(200).json(result);
});

const postThreadReply = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await messageService.postThreadReply(req.params.messageId, req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'messages.thread_reply_failed', 'message', req.params.messageId, error);
    throw error;
  }

  res.status(201).json(result);
});

const addReaction = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await messageService.addReaction(req.params.messageId, req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'messages.reaction_add_failed', 'message', req.params.messageId, error);
    throw error;
  }

  res.status(200).json(result);
});

const removeReaction = asyncHandler(async (req, res) => {
  try {
    await messageService.removeReaction(req.params.messageId, req.params.emoji, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'messages.reaction_remove_failed', 'message', req.params.messageId, error, {
      emoji: req.params.emoji,
    });
    throw error;
  }

  res.status(204).end();
});

const listChannelPins = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await messageService.listChannelPins(req.params.channelId, req.auth.user);
  } catch (error) {
    await logFailure(req, 'messages.pins_list_failed', 'channel', req.params.channelId, error);
    throw error;
  }

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'messages.pins_listed',
    entityType: 'channel',
    entityId: req.params.channelId,
    statusCode: 200,
    metadata: { count: result.messages.length },
  });

  res.status(200).json(result);
});

const pinMessage = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await messageService.pinMessage(req.params.messageId, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'messages.pin_failed', 'message', req.params.messageId, error);
    throw error;
  }

  res.status(200).json(result);
});

const unpinMessage = asyncHandler(async (req, res) => {
  try {
    await messageService.unpinMessage(req.params.messageId, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'messages.unpin_failed', 'message', req.params.messageId, error);
    throw error;
  }

  res.status(204).end();
});

const listBookmarks = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await messageService.listBookmarks(req.query, req.auth.user);
  } catch (error) {
    await logFailure(req, 'messages.bookmarks_list_failed', 'user', req.auth.user.id, error);
    throw error;
  }

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'messages.bookmarks_listed',
    entityType: 'user',
    entityId: req.auth.user.id,
    statusCode: 200,
    metadata: {
      count: result.messages.length,
      hasMore: result.hasMore,
      limit: req.query.limit,
      offset: req.query.offset,
    },
  });

  res.status(200).json(result);
});

const addBookmark = asyncHandler(async (req, res) => {
  try {
    await messageService.addBookmark(req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'messages.bookmark_add_failed', 'user', req.auth.user.id, error);
    throw error;
  }

  res.status(201).end();
});

const removeBookmark = asyncHandler(async (req, res) => {
  try {
    await messageService.removeBookmark(req.params.messageId, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'messages.bookmark_remove_failed', 'message', req.params.messageId, error);
    throw error;
  }

  res.status(204).end();
});

const createPoll = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await messageService.createPoll(req.params.channelId, req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'polls.create_failed', 'channel', req.params.channelId, error);
    throw error;
  }

  res.status(201).json(result);
});

const votePoll = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await messageService.votePoll(req.params.pollId, req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'polls.vote_failed', 'poll', req.params.pollId, error);
    throw error;
  }

  res.status(200).json(result);
});

const getPoll = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await messageService.getPoll(req.params.pollId, req.auth.user);
  } catch (error) {
    await logFailure(req, 'polls.get_failed', 'poll', req.params.pollId, error);
    throw error;
  }

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'polls.viewed',
    entityType: 'poll',
    entityId: req.params.pollId,
    statusCode: 200,
  });

  res.status(200).json(result);
});

const searchMessages = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await messageService.searchMessages(req.query, req.auth.user);
  } catch (error) {
    await logFailure(req, 'messages.search_failed', 'user', req.auth.user.id, error);
    throw error;
  }

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'messages.searched',
    entityType: 'user',
    entityId: req.auth.user.id,
    statusCode: 200,
    metadata: {
      count: result.messages.length,
      hasMore: result.hasMore,
      limit: req.query.limit,
      offset: req.query.offset,
      query: req.query.q,
    },
  });

  res.status(200).json(result);
});

module.exports = {
  listConversations,
  getConversation,
  createConversation,
  addConversationParticipants,
  removeConversationParticipant,
  listChannelMessages,
  listConversationMessages,
  sendChannelMessage,
  sendConversationMessage,
  getMessage,
  updateMessage,
  deleteMessage,
  getMessageEdits,
  getThread,
  postThreadReply,
  addReaction,
  removeReaction,
  listChannelPins,
  pinMessage,
  unpinMessage,
  listBookmarks,
  addBookmark,
  removeBookmark,
  createPoll,
  votePoll,
  getPoll,
  searchMessages,
};
