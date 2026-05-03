const { WebSocketServer } = require('ws');
const { verifyAccessToken } = require('../utils/jwt');
const { generateId } = require('../utils/id');
const authRepository = require('../modules/auth/auth.repository');
const userRepository = require('../modules/users/user.repository');
const channelRepository = require('../modules/channels/channel.repository');
const messageRepository = require('../modules/messages/message.repository');
const realtimeRepository = require('../modules/realtime/realtime.repository');
const auditRepository = require('../modules/audits/audit.repository');

let websocketServer = null;
let expirationSweepTimer = null;
const socketsByUserId = new Map();

const SOCKET_TARGET_TYPES = new Set(['channel', 'conversation']);
const PRESENCE_STATUSES = new Set(['online', 'away', 'busy', 'offline']);
const RTC_SIGNAL_TYPES = new Set(['offer', 'answer', 'ice-candidate']);
const MESSAGE_EXPIRATION_SWEEP_MS = Number(process.env.MESSAGE_EXPIRATION_SWEEP_MS || 15000);

let messageServiceRef = null;
function getMessageService() {
  if (!messageServiceRef) {
    messageServiceRef = require('../modules/messages/message.service');
  }
  return messageServiceRef;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function createError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeRequiredString(value, fieldName) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw createError(422, `${fieldName} is required.`);
  return normalized;
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s || null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTargetType(value) {
  const normalized = normalizeRequiredString(value, 'targetType').toLowerCase();
  if (!SOCKET_TARGET_TYPES.has(normalized)) throw createError(422, 'targetType is invalid.');
  return normalized;
}

function getTokenFromRequest(request) {
  try {
    const url = new URL(request.url, 'http://localhost');
    const token = url.searchParams.get('token');
    return typeof token === 'string' && token.trim() ? token.trim() : null;
  } catch (_) {
    return null;
  }
}

function addSocket(userId, socket) {
  if (!socketsByUserId.has(userId)) socketsByUserId.set(userId, new Set());
  socketsByUserId.get(userId).add(socket);
}

function removeSocket(userId, socket) {
  const sockets = socketsByUserId.get(userId);
  if (!sockets) return;
  sockets.delete(socket);
  if (!sockets.size) socketsByUserId.delete(userId);
}

function sendEvent(socket, event, data) {
  if (!socket || socket.readyState !== 1) return Promise.resolve(false);
  return new Promise((resolve) => {
    socket.send(JSON.stringify({ event, data }), (err) => resolve(!err));
  });
}

function sendSocketError(socket, error, requestedEvent = null) {
  let status = Number.isInteger(error?.status) ? error.status : 500;
  let message = error?.message || 'An unexpected error occurred. Please try again.';
  if (error?.code === '23505' || error?.code === '23503') {
    status = 422;
    message = 'Validation error.';
  }
  sendEvent(socket, 'error', {
    status,
    message,
    ...(requestedEvent ? { event: requestedEvent } : {}),
  });
}

function toPresenceEventData(userId, presenceRow) {
  return {
    userId,
    status: presenceRow?.status || 'offline',
    customText: presenceRow?.custom_text || '',
    lastSeen: presenceRow?.last_seen_at || new Date().toISOString(),
  };
}

// ── target access & audience ──────────────────────────────────────────────────

async function assertTargetAccess(authUser, targetType, targetId) {
  if (targetType === 'channel') {
    const channel = await channelRepository.findChannelById(targetId);
    if (!channel) throw createError(404, 'Resource not found.');
    if (channel.type === 'private') {
      const membership = await channelRepository.findMembership(targetId, authUser.id);
      if (!membership) throw createError(403, 'You do not have permission to perform this action.');
    }
    return { kind: 'channel', channel };
  }

  const participant = await messageRepository.findConversationParticipant(targetId, authUser.id);
  if (!participant) throw createError(403, 'You do not have permission to perform this action.');
  const conversation = await messageRepository.findConversationById(targetId);
  if (!conversation) throw createError(404, 'Resource not found.');
  return { kind: 'conversation', conversation };
}

async function resolveTargetAudience(targetType, targetId, fallbackOrgId = null) {
  if (targetType === 'channel') {
    return realtimeRepository.listChannelMemberUserIds(targetId);
  }
  const ids = await realtimeRepository.listConversationParticipantUserIds(targetId);
  if (ids.length) return [...new Set(ids)];
  if (!fallbackOrgId) return [];
  return realtimeRepository.listOrgUserIds(fallbackOrgId);
}

// ── audit ─────────────────────────────────────────────────────────────────────

async function recordSocketAudit(socket, action, metadata = {}) {
  try {
    await auditRepository.createAudit({
      id: generateId('audit'),
      userId: socket.auth?.user?.id || null,
      action,
      entityType: 'websocket',
      entityId: null,
      method: 'WS',
      path: '/ws',
      statusCode: 200,
      ip: null,
      userAgent: 'websocket',
      metadata: { sessionId: socket.auth?.session?.id || null, ...metadata },
    });
  } catch (_) {
    // ignore audit failures in WS flows
  }
}

// ── presence ──────────────────────────────────────────────────────────────────

async function resolveConnectedPresence(userId) {
  const existing = await realtimeRepository.findUserPresence(userId);
  return realtimeRepository.upsertUserPresence({
    userId,
    status: existing?.status === 'offline' ? 'online' : (existing?.status || 'online'),
    customText: existing?.custom_text || null,
    lastSeenAt: new Date().toISOString(),
  });
}

async function resolveDisconnectedPresence(userId) {
  const existing = await realtimeRepository.findUserPresence(userId);
  return realtimeRepository.upsertUserPresence({
    userId,
    status: 'offline',
    customText: existing?.custom_text || null,
    lastSeenAt: new Date().toISOString(),
  });
}

// ── event handlers ────────────────────────────────────────────────────────────

async function handleSendMessage(socket, payload) {
  if (!isPlainObject(payload)) throw createError(422, 'data is invalid.');

  const targetType = normalizeTargetType(payload.targetType);
  const targetId = normalizeRequiredString(payload.targetId, 'targetId');
  const body = normalizeRequiredString(payload.body, 'body');

  if (payload.attachments !== undefined && !Array.isArray(payload.attachments)) {
    throw createError(422, 'attachments is invalid.');
  }
  if (payload.mentions !== undefined && !Array.isArray(payload.mentions)) {
    throw createError(422, 'mentions is invalid.');
  }

  const messageBody = {
    message: {
      body,
      format: normalizeOptionalString(payload.format) || 'plaintext',
      clientMsgId: normalizeOptionalString(payload.clientMsgId),
      replyTo: normalizeOptionalString(payload.replyTo),
      attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
      mentions: Array.isArray(payload.mentions) ? payload.mentions : [],
    },
  };

  const fakeReq = {
    method: 'WS',
    originalUrl: '/ws',
    ip: null,
    get: () => 'websocket',
    auth: socket.auth,
  };

  const messageService = getMessageService();
  const response = targetType === 'channel'
    ? await messageService.sendChannelMessage(targetId, messageBody, socket.auth.user, fakeReq)
    : await messageService.sendConversationMessage(targetId, messageBody, socket.auth.user, fakeReq);

  if (!response?.message?.id) throw createError(500, 'An unexpected error occurred. Please try again.');

  await recordSocketAudit(socket, 'ws.message.send', {
    targetType,
    targetId,
    messageId: response.message.id,
  });
}

async function handleTypingEvent(socket, payload, isTyping) {
  const targetType = normalizeTargetType(payload?.targetType);
  const targetId = normalizeRequiredString(payload?.targetId, 'targetId');
  await assertTargetAccess(socket.auth.user, targetType, targetId);

  await realtimeRepository.upsertTypingState({
    userId: socket.auth.user.id,
    targetType,
    targetId,
    isTyping,
  });

  const audience = await resolveTargetAudience(targetType, targetId, socket.auth.user.orgId);
  const filtered = audience.filter((uid) => uid !== socket.auth.user.id);
  await broadcastToUsers(filtered, 'typing:update', {
    targetType,
    targetId,
    userId: socket.auth.user.id,
    username: socket.auth.user.username,
    isTyping,
  });

  await recordSocketAudit(socket, isTyping ? 'ws.typing.start' : 'ws.typing.stop', { targetType, targetId });
}

async function handleMarkRead(socket, payload) {
  const targetType = normalizeTargetType(payload?.targetType);
  const targetId = normalizeRequiredString(payload?.targetId, 'targetId');
  const lastReadMessageId = normalizeRequiredString(payload?.lastReadMessageId, 'lastReadMessageId');

  const message = await messageRepository.findMessageById(lastReadMessageId);
  if (!message) throw createError(404, 'Resource not found.');

  if (message.target_type !== targetType || message.target_id !== targetId) {
    throw createError(422, 'lastReadMessageId must belong to the same target.');
  }

  await assertTargetAccess(socket.auth.user, targetType, targetId);
  await realtimeRepository.upsertReadMarker({
    userId: socket.auth.user.id,
    targetType,
    targetId,
    lastReadMessageId,
  });

  await recordSocketAudit(socket, 'ws.read.mark', { targetType, targetId, lastReadMessageId });
}

async function handlePresenceSet(socket, payload) {
  const status = normalizeRequiredString(payload?.status, 'status').toLowerCase();
  if (!PRESENCE_STATUSES.has(status)) throw createError(422, 'status is invalid.');
  const customText = normalizeOptionalString(payload?.customText);

  const updatedPresence = await realtimeRepository.upsertUserPresence({
    userId: socket.auth.user.id,
    status,
    customText,
    lastSeenAt: new Date().toISOString(),
  });
  socket.auth.presence = updatedPresence;

  const audience = await realtimeRepository.listOrgUserIds(socket.auth.user.orgId);
  await broadcastToUsers(audience, 'presence:update', toPresenceEventData(socket.auth.user.id, updatedPresence));
  await recordSocketAudit(socket, 'ws.presence.set', { status });
}

async function handleVoiceJoin(socket, payload) {
  const channelId = normalizeRequiredString(payload?.channelId, 'channelId');
  await assertTargetAccess(socket.auth.user, 'channel', channelId);
  await realtimeRepository.upsertVoiceParticipation({
    id: generateId('voice'),
    channelId,
    userId: socket.auth.user.id,
  });
  await recordSocketAudit(socket, 'ws.voice.join', { channelId });
}

async function handleVoiceLeave(socket, payload) {
  const channelId = normalizeRequiredString(payload?.channelId, 'channelId');
  await assertTargetAccess(socket.auth.user, 'channel', channelId);
  await realtimeRepository.leaveVoiceParticipation({ channelId, userId: socket.auth.user.id });
  await recordSocketAudit(socket, 'ws.voice.leave', { channelId });
}

async function handleRtcSignal(socket, payload) {
  const callId = normalizeRequiredString(payload?.callId, 'callId');
  const targetUserId = normalizeRequiredString(payload?.targetUserId, 'targetUserId');
  const signalType = normalizeRequiredString(payload?.signalType, 'signalType').toLowerCase();
  if (!RTC_SIGNAL_TYPES.has(signalType)) throw createError(422, 'signalType is invalid.');

  const signalPayload = isPlainObject(payload?.payload) ? payload.payload : null;
  if (!signalPayload) throw createError(422, 'payload is invalid.');

  await realtimeRepository.createRtcSignal({
    id: generateId('rtcsig'),
    callId,
    fromUserId: socket.auth.user.id,
    targetUserId,
    signalType,
    signalPayload,
  });

  await broadcastToUsers([targetUserId], 'rtc:signal', {
    callId,
    fromUserId: socket.auth.user.id,
    targetUserId,
    signalType,
    payload: signalPayload,
  });

  await recordSocketAudit(socket, 'ws.rtc.signal', { callId, targetUserId, signalType });
}

async function handleSocketEvent(socket, payload) {
  const event = payload?.event;
  if (!event || typeof event !== 'string') throw createError(422, 'event is required.');
  const data = payload?.data || {};

  if (event === 'ping') {
    sendEvent(socket, 'pong', { now: new Date().toISOString() });
    return;
  }
  if (event === 'message:send') { await handleSendMessage(socket, data); return; }
  if (event === 'typing:start') { await handleTypingEvent(socket, data, true); return; }
  if (event === 'typing:stop') { await handleTypingEvent(socket, data, false); return; }
  if (event === 'read:mark') { await handleMarkRead(socket, data); return; }
  if (event === 'presence:set') { await handlePresenceSet(socket, data); return; }
  if (event === 'voice:join') { await handleVoiceJoin(socket, data); return; }
  if (event === 'voice:leave') { await handleVoiceLeave(socket, data); return; }
  if (event === 'rtc:signal') { await handleRtcSignal(socket, data); return; }
  throw createError(422, 'Unsupported WebSocket event.');
}

// ── expiration sweep ──────────────────────────────────────────────────────────

async function sweepExpiredMessagesAndBroadcast() {
  const expired = await realtimeRepository.expireMessagesDue();
  for (const message of expired) {
    if (message.target_type !== 'conversation') continue;
    const audience = await resolveTargetAudience('conversation', message.target_id);
    await broadcastToUsers(audience, 'message:expired', {
      id: message.id,
      conversationId: message.target_id,
    });
  }
}

// ── authentication ────────────────────────────────────────────────────────────

async function authenticateSocket(request) {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  try {
    const decoded = verifyAccessToken(token);
    if (!decoded?.sub || !decoded?.sessionId) return null;
    const session = await authRepository.findActiveSessionById(decoded.sessionId);
    if (!session) return null;
    const user = await userRepository.findActiveUserById(decoded.sub);
    if (!user || user.status !== 'active') return null;
    return { token, session, user };
  } catch (_) {
    return null;
  }
}

// ── connection handler ────────────────────────────────────────────────────────

async function handleConnection(socket, request) {
  const auth = await authenticateSocket(request);
  if (!auth) {
    socket.close(1008, 'Unauthorized');
    return;
  }

  socket.auth = auth;
  addSocket(auth.user.id, socket);

  const [, presence] = await Promise.all([
    authRepository.updateSessionActivity(auth.session.id),
    resolveConnectedPresence(auth.user.id),
  ]);
  await realtimeRepository.touchUserLastSeen(auth.user.id);
  socket.auth.presence = presence;

  const presenceAudience = await realtimeRepository.listOrgUserIds(auth.user.orgId);
  await broadcastToUsers(presenceAudience, 'presence:update', toPresenceEventData(auth.user.id, presence));

  sendEvent(socket, 'connected', {
    userId: auth.user.id,
    sessionId: auth.session.id,
    serverTime: new Date().toISOString(),
  });

  socket.on('message', async (rawBuffer) => {
    let requestedEvent = null;
    try {
      const payload = JSON.parse(String(rawBuffer || ''));
      requestedEvent = typeof payload?.event === 'string' ? payload.event : null;
      await handleSocketEvent(socket, payload);
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendSocketError(socket, createError(422, 'Invalid WebSocket payload.'));
        return;
      }
      sendSocketError(socket, error, requestedEvent);
    }
  });

  socket.on('close', () => {
    removeSocket(auth.user.id, socket);
    if (!socketsByUserId.has(auth.user.id)) {
      Promise.all([
        resolveDisconnectedPresence(auth.user.id),
        realtimeRepository.touchUserLastSeen(auth.user.id),
      ]).then(async ([presence]) => {
        const audience = await realtimeRepository.listOrgUserIds(auth.user.orgId);
        await broadcastToUsers(audience, 'presence:update', toPresenceEventData(auth.user.id, presence));
      }).catch(() => {});
    }
  });
}

// ── broadcast ─────────────────────────────────────────────────────────────────

async function broadcastToUsers(userIds = [], event, data) {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean))];
  const deliveries = [];
  uniqueIds.forEach((userId) => {
    const sockets = socketsByUserId.get(userId);
    if (!sockets) return;
    sockets.forEach((socket) => {
      deliveries.push(sendEvent(socket, event, data));
    });
  });
  await Promise.all(deliveries);
}

// ── server init ───────────────────────────────────────────────────────────────

function initializeWebSocketServer(server) {
  if (websocketServer) return websocketServer;

  websocketServer = new WebSocketServer({ server, path: '/ws' });

  websocketServer.on('connection', (socket, request) => {
    handleConnection(socket, request).catch(() => {
      socket.close(1011, 'Unable to initialize connection');
    });
  });

  if (!expirationSweepTimer) {
    expirationSweepTimer = setInterval(() => {
      sweepExpiredMessagesAndBroadcast().catch(() => {});
    }, MESSAGE_EXPIRATION_SWEEP_MS);
    if (typeof expirationSweepTimer.unref === 'function') expirationSweepTimer.unref();
  }

  websocketServer.on('close', () => {
    if (expirationSweepTimer) {
      clearInterval(expirationSweepTimer);
      expirationSweepTimer = null;
    }
  });

  return websocketServer;
}

module.exports = {
  initializeWebSocketServer,
  broadcastToUsers,
};
