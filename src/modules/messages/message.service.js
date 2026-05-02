const { AppError, validationError } = require('../../utils/errors');
const { generateId } = require('../../utils/id');
const auditService = require('../audits/audit.service');
const messageRepository = require('./message.repository');

const FORBIDDEN_MESSAGE = 'You do not have permission to perform this action.';
const NOT_FOUND_MESSAGE = 'Resource not found.';
const CONVERSATION_TYPES = new Set(['dm', 'group']);
const MESSAGE_FORMATS = new Set(['plaintext', 'markdown', 'encrypted']);

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

function parsePositiveInt(value, fallback, min = 0, max = null) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) return fallback;
  if (max != null && n > max) return max;
  return n;
}

function normalizeParticipantIds(ids = []) {
  const normalized = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !id.trim()) {
      throw validationError({ participantIds: 'participantIds must contain valid user ids.' });
    }
    normalized.push(id.trim());
  }
  return [...new Set(normalized)];
}

async function hydrateConversation(conversationId) {
  const conversation = await messageRepository.findConversationById(conversationId);
  if (!conversation) return null;

  const participants = await messageRepository.listConversationParticipants(conversationId);
  const messages = await messageRepository.listMessagesByTarget({
    targetType: 'conversation',
    targetId: conversationId,
    limit: 1,
  });

  let lastMessage = null;
  if (messages.length > 0) {
    const latest = messages[0];
    lastMessage = {
      id: latest.id,
      body: latest.body,
      senderId: latest.sender_id,
      createdAt: latest.created_at,
    };
  }

  return {
    id: conversation.id,
    type: conversation.type,
    name: conversation.name,
    participants,
    e2ee: conversation.e2ee,
    disappearingTimer: conversation.disappearing_timer,
    lastMessage,
    createdAt: conversation.created_at,
    updatedAt: conversation.updated_at,
  };
}

async function ensureConversationParticipant(conversationId, userId) {
  const participant = await messageRepository.findConversationParticipant(conversationId, userId);
  if (!participant) throw forbidden();
  return participant;
}

async function ensureChannelAccess(channelId, user) {
  const channel = await messageRepository.findChannelById(channelId);
  if (!channel) throw notFound();

  const membership = await messageRepository.findChannelMembership(channelId, user.id);
  if (channel.type === 'private' && !membership && !isOrgAdmin(user)) {
    throw forbidden();
  }

  return { channel, membership };
}

async function ensureMessageAccess(messageId, user) {
  const message = await messageRepository.findMessageById(messageId);
  if (!message) throw notFound();

  if (message.target_type === 'channel') {
    await ensureChannelAccess(message.target_id, user);
  } else if (message.target_type === 'conversation') {
    await ensureConversationParticipant(message.target_id, user.id);
  } else {
    throw notFound();
  }

  return message;
}

async function toMessageResponse(messageRow) {
  const reactions = await messageRepository.listMessageReactions(messageRow.id);
  const threadReplyCount = await messageRepository.countThreadReplies(messageRow.id);
  return messageRepository.mapMessageRow(messageRow, reactions, threadReplyCount);
}

function validateMessagePayload(body) {
  const data = (body && body.message) || {};
  const errors = {};

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw validationError({ message: 'message must be an object.' });
  }

  if (typeof data.body !== 'string' || !data.body.trim()) {
    errors.body = 'Body is required.';
  }

  if (data.format !== undefined) {
    const format = String(data.format).trim();
    if (!MESSAGE_FORMATS.has(format)) {
      errors.format = 'Format must be one of: plaintext, markdown, encrypted.';
    }
  }

  if (data.attachments !== undefined && !Array.isArray(data.attachments)) {
    errors.attachments = 'attachments must be an array.';
  }

  if (data.mentions !== undefined && !Array.isArray(data.mentions)) {
    errors.mentions = 'mentions must be an array.';
  }

  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }

  return {
    body: data.body.trim(),
    format: data.format ? String(data.format).trim() : 'plaintext',
    attachments: Array.isArray(data.attachments) ? data.attachments : [],
    mentions: Array.isArray(data.mentions) ? [...new Set(data.mentions)] : [],
    replyTo: data.replyTo || null,
    encryption: data.encryption && typeof data.encryption === 'object' ? data.encryption : {},
  };
}

async function listConversations(query, user) {
  const limit = parsePositiveInt(query.limit, 30, 1);
  const offset = parsePositiveInt(query.offset, 0, 0);

  if (query.type && !CONVERSATION_TYPES.has(query.type)) {
    throw validationError({ type: 'type must be dm or group.' });
  }

  const result = await messageRepository.listConversationsForUser({
    userId: user.id,
    type: query.type,
    search: query.search,
    limit,
    offset,
  });

  const conversations = [];
  for (const row of result.conversations) {
    const hydrated = await hydrateConversation(row.id);
    if (hydrated) conversations.push(hydrated);
  }

  return {
    conversations,
    totalCount: result.totalCount,
    limit,
    offset,
  };
}

async function getConversation(conversationId, user) {
  await ensureConversationParticipant(conversationId, user.id);
  const conversation = await hydrateConversation(conversationId);
  if (!conversation) throw notFound();
  return { conversation };
}

async function createConversation(body, user, req) {
  const data = (body && body.conversation) || {};
  const errors = {};

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw validationError({ conversation: 'conversation must be an object.' });
  }

  if (!data.type || !CONVERSATION_TYPES.has(String(data.type))) {
    errors.type = 'type must be dm or group.';
  }

  if (!Array.isArray(data.participantIds) || data.participantIds.length === 0) {
    errors.participantIds = 'participantIds is required.';
  }

  if (Object.keys(errors).length > 0) throw validationError(errors);

  const participantIds = normalizeParticipantIds(data.participantIds).filter((id) => id !== user.id);

  if (String(data.type) === 'dm') {
    if (participantIds.length !== 1) {
      throw validationError({ participantIds: 'DM requires exactly one other participant.' });
    }

    const existingId = await messageRepository.findExistingDmConversationBetweenUsers(user.id, participantIds[0]);
    if (existingId) {
      const existing = await hydrateConversation(existingId);

      await auditService.logAction({
        req,
        userId: user.id,
        action: 'conversations.created',
        entityType: 'conversation',
        entityId: existingId,
        statusCode: 201,
        metadata: {
          type: 'dm',
          participantCount: existing && Array.isArray(existing.participants) ? existing.participants.length : 2,
          resolvedToExisting: true,
        },
      });

      return { conversation: existing };
    }
  }

  if (String(data.type) === 'group' && participantIds.length === 0) {
    throw validationError({ participantIds: 'Group conversation requires at least one participant.' });
  }

  const conversationId = generateId('conv');
  const participants = [
    {
      id: generateId('cp'),
      userId: user.id,
      isAdmin: true,
    },
    ...participantIds.map((participantId) => ({
      id: generateId('cp'),
      userId: participantId,
      isAdmin: false,
    })),
  ];

  await messageRepository.createConversation({
    id: conversationId,
    type: String(data.type),
    name: data.name ? String(data.name).trim() : null,
    createdByUserId: user.id,
    e2ee: data.e2ee === true,
    disappearingTimer: parsePositiveInt(data.disappearingTimer, 0, 0),
    participants,
  });

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'conversations.created',
    entityType: 'conversation',
    entityId: conversationId,
    statusCode: 201,
    metadata: { type: data.type, participantCount: participants.length },
  });

  return {
    conversation: await hydrateConversation(conversationId),
  };
}

async function addConversationParticipants(conversationId, body, user, req) {
  const conversation = await messageRepository.findConversationById(conversationId);
  if (!conversation) throw notFound();

  if (conversation.type !== 'group') {
    throw validationError({ conversation: 'Only group conversations support participant management.' });
  }

  const actorParticipant = await ensureConversationParticipant(conversationId, user.id);
  if (!actorParticipant.is_admin && conversation.created_by_user_id !== user.id) {
    throw forbidden();
  }

  const userIds = body && Array.isArray(body.userIds) ? body.userIds : null;
  if (!userIds || userIds.length === 0) {
    throw validationError({ userIds: 'userIds is required.' });
  }

  const normalized = normalizeParticipantIds(userIds);

  for (const targetUserId of normalized) {
    await messageRepository.upsertConversationParticipant({
      id: generateId('cp'),
      conversationId,
      userId: targetUserId,
      isAdmin: false,
    });
  }

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'conversations.participants_added',
    entityType: 'conversation',
    entityId: conversationId,
    statusCode: 200,
    metadata: { userIds: normalized },
  });

  return {
    conversation: await hydrateConversation(conversationId),
  };
}

async function removeConversationParticipant(conversationId, targetUserId, user, req) {
  const conversation = await messageRepository.findConversationById(conversationId);
  if (!conversation) throw notFound();

  if (conversation.type !== 'group') {
    throw validationError({ conversation: 'Only group conversations support participant management.' });
  }

  const actorParticipant = await ensureConversationParticipant(conversationId, user.id);
  if (!actorParticipant.is_admin && conversation.created_by_user_id !== user.id) {
    throw forbidden();
  }

  const participant = await messageRepository.findConversationParticipant(conversationId, targetUserId);
  if (!participant) throw notFound();

  await messageRepository.softDeleteConversationParticipant(conversationId, targetUserId);

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'conversations.participant_removed',
    entityType: 'conversation',
    entityId: conversationId,
    statusCode: 204,
    metadata: { targetUserId },
  });
}

async function listChannelMessages(channelId, query, user) {
  await ensureChannelAccess(channelId, user);

  const limit = parsePositiveInt(query.limit, 50, 1, 100);
  const rows = await messageRepository.listMessagesByTarget({
    targetType: 'channel',
    targetId: channelId,
    before: query.before,
    after: query.after,
    limit,
  });

  const hasMore = rows.length > limit;
  const selected = hasMore ? rows.slice(0, limit) : rows;

  const messages = [];
  for (const row of selected) {
    messages.push(await toMessageResponse(row));
  }

  return { messages, hasMore };
}

async function listConversationMessages(conversationId, query, user) {
  await ensureConversationParticipant(conversationId, user.id);

  const limit = parsePositiveInt(query.limit, 50, 1, 100);
  const rows = await messageRepository.listMessagesByTarget({
    targetType: 'conversation',
    targetId: conversationId,
    before: query.before,
    after: query.after,
    limit,
  });

  const hasMore = rows.length > limit;
  const selected = hasMore ? rows.slice(0, limit) : rows;

  const messages = [];
  for (const row of selected) {
    messages.push(await toMessageResponse(row));
  }

  return { messages, hasMore };
}

async function sendChannelMessage(channelId, body, user, req) {
  await ensureChannelAccess(channelId, user);
  const payload = validateMessagePayload(body);

  const id = generateId('msg');
  await messageRepository.createMessage({
    id,
    body: payload.body,
    format: payload.format,
    senderId: user.id,
    targetType: 'channel',
    targetId: channelId,
    threadParentId: payload.replyTo,
    replyTo: payload.replyTo,
    attachments: payload.attachments,
    mentions: payload.mentions,
    encryption: payload.encryption,
  });

  const row = await messageRepository.findMessageById(id);

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'messages.created',
    entityType: 'message',
    entityId: id,
    statusCode: 201,
    metadata: { targetType: 'channel', targetId: channelId },
  });

  return {
    message: await toMessageResponse(row),
  };
}

async function sendConversationMessage(conversationId, body, user, req) {
  await ensureConversationParticipant(conversationId, user.id);
  const payload = validateMessagePayload(body);

  const id = generateId('msg');
  await messageRepository.createMessage({
    id,
    body: payload.body,
    format: payload.format,
    senderId: user.id,
    targetType: 'conversation',
    targetId: conversationId,
    threadParentId: payload.replyTo,
    replyTo: payload.replyTo,
    attachments: payload.attachments,
    mentions: payload.mentions,
    encryption: payload.encryption,
  });

  const row = await messageRepository.findMessageById(id);

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'messages.created',
    entityType: 'message',
    entityId: id,
    statusCode: 201,
    metadata: { targetType: 'conversation', targetId: conversationId },
  });

  return {
    message: await toMessageResponse(row),
  };
}

async function getMessage(messageId, user) {
  const row = await ensureMessageAccess(messageId, user);
  return { message: await toMessageResponse(row) };
}

async function updateMessage(messageId, body, user, req) {
  const current = await ensureMessageAccess(messageId, user);

  if (current.sender_id !== user.id) {
    throw forbidden();
  }

  const data = (body && body.message) || {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw validationError({ message: 'message must be an object.' });
  }

  if (typeof data.body !== 'string' || !data.body.trim()) {
    throw validationError({ body: 'Body is required.' });
  }

  await messageRepository.addMessageEdit({
    id: generateId('medit'),
    messageId,
    body: current.body,
    editedByUserId: user.id,
  });

  await messageRepository.updateMessageBody(messageId, data.body.trim());
  const updated = await messageRepository.findMessageById(messageId);

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'messages.updated',
    entityType: 'message',
    entityId: messageId,
    statusCode: 200,
  });

  return { message: await toMessageResponse(updated) };
}

async function deleteMessage(messageId, user, req) {
  const message = await ensureMessageAccess(messageId, user);

  let canDelete = message.sender_id === user.id;

  if (!canDelete && message.target_type === 'channel') {
    const { membership } = await ensureChannelAccess(message.target_id, user);
    canDelete = isOrgAdmin(user) || (membership && ['admin', 'moderator'].includes(membership.role));
  }

  if (!canDelete && message.target_type === 'conversation') {
    const participant = await ensureConversationParticipant(message.target_id, user.id);
    canDelete = participant.is_admin === true;
  }

  if (!canDelete) throw forbidden();

  await messageRepository.softDeleteMessage(messageId);

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'messages.deleted',
    entityType: 'message',
    entityId: messageId,
    statusCode: 204,
  });
}

async function getMessageEdits(messageId, user) {
  await ensureMessageAccess(messageId, user);
  const edits = await messageRepository.listMessageEdits(messageId);
  return { edits };
}

async function getThread(messageId, query, user) {
  const parent = await ensureMessageAccess(messageId, user);
  const limit = parsePositiveInt(query.limit, 50, 1, 100);
  const offset = parsePositiveInt(query.offset, 0, 0);

  const rows = await messageRepository.listThreadMessages({
    messageId,
    limit,
    offset,
  });

  const messages = [];
  for (const row of rows) {
    messages.push(await toMessageResponse(row));
  }

  return {
    messages,
    hasMore: rows.length === limit,
    parentId: parent.id,
  };
}

async function postThreadReply(messageId, body, user, req) {
  const parent = await ensureMessageAccess(messageId, user);
  const payload = validateMessagePayload(body);

  const id = generateId('msg');
  await messageRepository.createMessage({
    id,
    body: payload.body,
    format: payload.format,
    senderId: user.id,
    targetType: parent.target_type,
    targetId: parent.target_id,
    threadParentId: messageId,
    replyTo: messageId,
    attachments: payload.attachments,
    mentions: payload.mentions,
    encryption: payload.encryption,
  });

  const row = await messageRepository.findMessageById(id);

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'messages.thread_reply_created',
    entityType: 'message',
    entityId: id,
    statusCode: 201,
    metadata: { threadParentId: messageId },
  });

  return { message: await toMessageResponse(row) };
}

async function addReaction(messageId, body, user, req) {
  await ensureMessageAccess(messageId, user);

  const emoji = body && typeof body.emoji === 'string' ? body.emoji.trim() : '';
  if (!emoji) throw validationError({ emoji: 'emoji is required.' });

  await messageRepository.addReaction({
    id: generateId('react'),
    messageId,
    userId: user.id,
    emoji,
  });

  const reactions = await messageRepository.listMessageReactions(messageId);

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'messages.reaction_added',
    entityType: 'message',
    entityId: messageId,
    statusCode: 200,
    metadata: { emoji },
  });

  return { reactions };
}

async function removeReaction(messageId, emoji, user, req) {
  await ensureMessageAccess(messageId, user);

  if (!emoji || !String(emoji).trim()) {
    throw validationError({ emoji: 'emoji is required.' });
  }

  await messageRepository.removeReaction(messageId, user.id, String(emoji).trim());

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'messages.reaction_removed',
    entityType: 'message',
    entityId: messageId,
    statusCode: 204,
    metadata: { emoji },
  });
}

async function listChannelPins(channelId, user) {
  await ensureChannelAccess(channelId, user);

  const rows = await messageRepository.listPinnedMessages(channelId);
  const messages = [];
  for (const row of rows) {
    messages.push(await toMessageResponse(row));
  }

  return {
    messages,
    hasMore: false,
  };
}

async function pinMessage(messageId, user, req) {
  const message = await ensureMessageAccess(messageId, user);

  if (message.target_type !== 'channel') {
    throw validationError({ message: 'Only channel messages can be pinned.' });
  }

  const { membership } = await ensureChannelAccess(message.target_id, user);
  const allowed = isOrgAdmin(user) || (membership && ['admin', 'moderator'].includes(membership.role));
  if (!allowed) throw forbidden();

  await messageRepository.pinMessage(messageId, user.id);
  const updated = await messageRepository.findMessageById(messageId);

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'messages.pinned',
    entityType: 'message',
    entityId: messageId,
    statusCode: 200,
  });

  return { message: await toMessageResponse(updated) };
}

async function unpinMessage(messageId, user, req) {
  const message = await ensureMessageAccess(messageId, user);

  if (message.target_type !== 'channel') {
    throw validationError({ message: 'Only channel messages can be unpinned.' });
  }

  const { membership } = await ensureChannelAccess(message.target_id, user);
  const allowed = isOrgAdmin(user) || (membership && ['admin', 'moderator'].includes(membership.role));
  if (!allowed) throw forbidden();

  await messageRepository.unpinMessage(messageId);

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'messages.unpinned',
    entityType: 'message',
    entityId: messageId,
    statusCode: 204,
  });
}

async function listBookmarks(query, user) {
  const limit = parsePositiveInt(query.limit, 30, 1);
  const offset = parsePositiveInt(query.offset, 0, 0);

  const rows = await messageRepository.listBookmarks(user.id, { limit, offset });
  const messages = [];
  for (const row of rows) {
    messages.push(await toMessageResponse(row));
  }

  return {
    messages,
    hasMore: rows.length === limit,
  };
}

async function addBookmark(body, user, req) {
  const messageId = body && typeof body.messageId === 'string' ? body.messageId.trim() : '';
  if (!messageId) throw validationError({ messageId: 'messageId is required.' });

  await ensureMessageAccess(messageId, user);

  await messageRepository.addBookmark({
    id: generateId('bkmk'),
    userId: user.id,
    messageId,
  });

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'messages.bookmarked',
    entityType: 'message',
    entityId: messageId,
    statusCode: 201,
  });
}

async function removeBookmark(messageId, user, req) {
  await messageRepository.removeBookmark(user.id, messageId);

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'messages.bookmark_removed',
    entityType: 'message',
    entityId: messageId,
    statusCode: 204,
  });
}

async function createPoll(channelId, body, user, req) {
  await ensureChannelAccess(channelId, user);

  const data = (body && body.poll) || {};
  const errors = {};

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw validationError({ poll: 'poll must be an object.' });
  }

  if (typeof data.question !== 'string' || !data.question.trim()) {
    errors.question = 'question is required.';
  }

  if (!Array.isArray(data.options) || data.options.length < 2) {
    errors.options = 'options must contain at least two values.';
  }

  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }

  const pollId = generateId('poll');
  const messageId = generateId('msg');

  await messageRepository.createMessage({
    id: messageId,
    body: data.question.trim(),
    format: 'plaintext',
    senderId: user.id,
    targetType: 'channel',
    targetId: channelId,
    attachments: [],
    mentions: [],
    encryption: {},
  });

  await messageRepository.createPoll({
    id: pollId,
    channelId,
    messageId,
    question: data.question.trim(),
    options: data.options.map((option, index) => ({
      id: generateId('popt'),
      index,
      text: String(option),
    })),
    multipleChoice: data.multipleChoice === true,
    anonymous: data.anonymous === true,
    expiresAt: data.expiresAt || null,
    createdByUserId: user.id,
  });

  const poll = await messageRepository.findPollById(pollId);

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'polls.created',
    entityType: 'poll',
    entityId: pollId,
    statusCode: 201,
    metadata: { channelId },
  });

  return { poll };
}

async function votePoll(pollId, body, user, req) {
  const optionIndex = Number(body && body.optionIndex);
  if (!Number.isInteger(optionIndex) || optionIndex < 0) {
    throw validationError({ optionIndex: 'optionIndex must be a non-negative integer.' });
  }

  const poll = await messageRepository.findPollById(pollId);
  if (!poll) throw notFound();

  if (poll.expiresAt && new Date(poll.expiresAt).getTime() < Date.now()) {
    throw new AppError(403, 'Poll has expired.');
  }

  await ensureChannelAccess(poll.channelId, user);

  const optionExists = poll.options.some((option) => option.index === optionIndex);
  if (!optionExists) {
    throw validationError({ optionIndex: 'optionIndex is invalid.' });
  }

  const updated = await messageRepository.votePoll({
    pollId,
    userId: user.id,
    optionIndex,
  });

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'polls.voted',
    entityType: 'poll',
    entityId: pollId,
    statusCode: 200,
    metadata: { optionIndex },
  });

  return { poll: updated };
}

async function getPoll(pollId, user) {
  const poll = await messageRepository.findPollById(pollId);
  if (!poll) throw notFound();

  await ensureChannelAccess(poll.channelId, user);
  return { poll };
}

async function searchMessages(query, user) {
  const limit = parsePositiveInt(query.limit, 20, 1, 100);
  const offset = parsePositiveInt(query.offset, 0, 0);

  const input = {
    q: query.q,
    channelId: query.channelId,
    conversationId: query.conversationId,
    senderId: query.senderId,
    from: query.from,
    to: query.to,
    hasAttachment: query.hasAttachment === 'true',
    hasLink: query.hasLink === 'true',
    isPinned: query.isPinned === 'true',
    limit,
    offset,
  };

  if (input.channelId && input.conversationId) {
    throw validationError({ scope: 'channelId and conversationId cannot be used together.' });
  }

  if (input.channelId) {
    await ensureChannelAccess(input.channelId, user);
  }

  if (input.conversationId) {
    const conversation = await messageRepository.findConversationById(input.conversationId);
    if (!conversation) throw notFound();
    if (conversation.e2ee) {
      throw new AppError(403, 'Search is unavailable for E2EE conversations on the server.');
    }
    await ensureConversationParticipant(input.conversationId, user.id);
  }

  const rows = await messageRepository.searchMessages(input);

  const filtered = [];
  for (const row of rows) {
    if (row.target_type === 'channel') {
      try {
        await ensureChannelAccess(row.target_id, user);
      } catch (_) {
        continue;
      }
    }

    if (row.target_type === 'conversation') {
      try {
        await ensureConversationParticipant(row.target_id, user.id);
      } catch (_) {
        continue;
      }
    }

    filtered.push(await toMessageResponse(row));
  }

  return {
    messages: filtered,
    hasMore: filtered.length === limit,
  };
}

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
