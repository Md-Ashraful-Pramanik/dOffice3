const { query } = require('../../db/pool');

async function findUserPresence(userId) {
  const result = await query(
    `SELECT user_id, status, custom_text, last_seen_at, updated_at
     FROM user_presence
     WHERE user_id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [userId],
  );
  return result.rows[0] || null;
}

async function upsertUserPresence({ userId, status, customText, lastSeenAt }) {
  const result = await query(
    `INSERT INTO user_presence (user_id, status, custom_text, last_seen_at)
     VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()))
     ON CONFLICT (user_id)
     DO UPDATE SET
       status = EXCLUDED.status,
       custom_text = EXCLUDED.custom_text,
       last_seen_at = EXCLUDED.last_seen_at,
       deleted_at = NULL,
       updated_at = NOW()
     RETURNING user_id, status, custom_text, last_seen_at, updated_at`,
    [userId, status, customText || null, lastSeenAt || null],
  );
  return result.rows[0] || null;
}

async function upsertTypingState({ userId, targetType, targetId, isTyping }) {
  const result = await query(
    `INSERT INTO typing_states (user_id, target_type, target_id, is_typing, expires_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $4 THEN NOW() + INTERVAL '15 seconds' ELSE NULL END)
     ON CONFLICT (user_id, target_type, target_id)
     DO UPDATE SET
       is_typing = EXCLUDED.is_typing,
       expires_at = EXCLUDED.expires_at,
       deleted_at = NULL,
       updated_at = NOW()
     RETURNING user_id, target_type, target_id, is_typing, updated_at`,
    [userId, targetType, targetId, Boolean(isTyping)],
  );
  return result.rows[0] || null;
}

async function upsertReadMarker({ userId, targetType, targetId, lastReadMessageId }) {
  const result = await query(
    `INSERT INTO message_reads (user_id, target_type, target_id, last_read_message_id, read_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, target_type, target_id)
     DO UPDATE SET
       last_read_message_id = EXCLUDED.last_read_message_id,
       read_at = NOW(),
       deleted_at = NULL,
       updated_at = NOW()
     RETURNING user_id, target_type, target_id, last_read_message_id, read_at`,
    [userId, targetType, targetId, lastReadMessageId],
  );
  return result.rows[0] || null;
}

async function upsertVoiceParticipation({ id, channelId, userId }) {
  await query(
    `UPDATE voice_channel_participants
     SET left_at = NOW(), deleted_at = NOW(), updated_at = NOW()
     WHERE channel_id = $1 AND user_id = $2 AND deleted_at IS NULL AND left_at IS NULL`,
    [channelId, userId],
  );
  const result = await query(
    `INSERT INTO voice_channel_participants (id, channel_id, user_id)
     VALUES ($1, $2, $3)
     RETURNING id, channel_id, user_id, joined_at`,
    [id, channelId, userId],
  );
  return result.rows[0] || null;
}

async function leaveVoiceParticipation({ channelId, userId }) {
  const result = await query(
    `UPDATE voice_channel_participants
     SET left_at = NOW(), deleted_at = NOW(), updated_at = NOW()
     WHERE channel_id = $1 AND user_id = $2 AND deleted_at IS NULL AND left_at IS NULL
     RETURNING id, channel_id, user_id, left_at`,
    [channelId, userId],
  );
  return result.rows[0] || null;
}

async function createRtcSignal({ id, callId, fromUserId, targetUserId, signalType, signalPayload }) {
  const result = await query(
    `INSERT INTO rtc_signals (id, call_id, from_user_id, target_user_id, signal_type, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING id, call_id, from_user_id, target_user_id, signal_type, payload, created_at`,
    [id, callId, fromUserId, targetUserId, signalType, JSON.stringify(signalPayload || {})],
  );
  return result.rows[0] || null;
}

async function listChannelMemberUserIds(channelId) {
  const result = await query(
    `SELECT user_id FROM channel_members
     WHERE channel_id = $1 AND deleted_at IS NULL`,
    [channelId],
  );
  return result.rows.map((r) => r.user_id);
}

async function listConversationParticipantUserIds(conversationId) {
  const result = await query(
    `SELECT user_id FROM conversation_participants
     WHERE conversation_id = $1 AND deleted_at IS NULL`,
    [conversationId],
  );
  return result.rows.map((r) => r.user_id);
}

async function listOrgUserIds(orgId) {
  if (!orgId) return [];
  const result = await query(
    `SELECT id FROM users WHERE org_id = $1 AND deleted_at IS NULL`,
    [orgId],
  );
  return result.rows.map((r) => r.id);
}

async function touchUserLastSeen(userId) {
  await query(
    `UPDATE users SET last_seen_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
}

async function expireMessagesDue() {
  const result = await query(
    `UPDATE messages
     SET deleted_at = NOW(), updated_at = NOW()
     WHERE expires_at IS NOT NULL
       AND expires_at <= NOW()
       AND deleted_at IS NULL
     RETURNING id, target_type, target_id`,
  );
  return result.rows;
}

module.exports = {
  findUserPresence,
  upsertUserPresence,
  upsertTypingState,
  upsertReadMarker,
  upsertVoiceParticipation,
  leaveVoiceParticipation,
  createRtcSignal,
  listChannelMemberUserIds,
  listConversationParticipantUserIds,
  listOrgUserIds,
  touchUserLastSeen,
  expireMessagesDue,
};
