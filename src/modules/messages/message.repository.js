const { query, withTransaction } = require('../../db/pool');
const { generateId } = require('../../utils/id');

function mapConversationParticipant(row) {
  return {
    userId: row.user_id,
    username: row.username,
    name: row.name,
    avatar: row.avatar,
  };
}

function mapMessageSender(row) {
  return {
    id: row.sender_id,
    username: row.sender_username,
    name: row.sender_name,
    avatar: row.sender_avatar,
  };
}

function mapReaction(rows) {
  const grouped = new Map();

  for (const row of rows) {
    if (!grouped.has(row.emoji)) {
      grouped.set(row.emoji, {
        emoji: row.emoji,
        count: 0,
        users: [],
      });
    }

    const current = grouped.get(row.emoji);
    current.count += 1;
    current.users.push(row.user_id);
  }

  return [...grouped.values()];
}

function mapMessageRow(row, reactions = [], threadReplyCount = 0) {
  return {
    id: row.id,
    body: row.body,
    format: row.format,
    sender: mapMessageSender(row),
    targetType: row.target_type,
    targetId: row.target_id,
    threadParentId: row.thread_parent_id,
    threadReplyCount,
    replyTo: row.reply_to,
    attachments: row.attachments || [],
    mentions: row.mentions || [],
    encryption: row.encryption || {},
    reactions,
    pinned: row.pinned,
    edited: row.edited,
    editedAt: row.edited_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findConversationById(conversationId, db = { query }) {
  const result = await db.query(
    `SELECT c.*
     FROM conversations c
     WHERE c.id = $1
       AND c.deleted_at IS NULL`,
    [conversationId],
  );

  return result.rows[0] || null;
}

async function listConversationsForUser({ userId, type, search, limit, offset }, db = { query }) {
  const params = [userId];
  const filters = [
    `EXISTS (
      SELECT 1
      FROM conversation_participants cp
      WHERE cp.conversation_id = c.id
        AND cp.user_id = $1
        AND cp.deleted_at IS NULL
    )`,
    'c.deleted_at IS NULL',
  ];

  if (type) {
    params.push(type);
    filters.push(`c.type = $${params.length}`);
  }

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    filters.push(`(
      LOWER(COALESCE(c.name, '')) LIKE $${params.length}
      OR EXISTS (
        SELECT 1
        FROM conversation_participants cp2
        JOIN users u2 ON u2.id = cp2.user_id
        WHERE cp2.conversation_id = c.id
          AND cp2.deleted_at IS NULL
          AND u2.deleted_at IS NULL
          AND (
            LOWER(COALESCE(u2.name, '')) LIKE $${params.length}
            OR LOWER(COALESCE(u2.username, '')) LIKE $${params.length}
          )
      )
    )`);
  }

  const whereClause = filters.join(' AND ');

  const countResult = await db.query(
    `SELECT COUNT(*)::INT AS total
     FROM conversations c
     WHERE ${whereClause}`,
    params,
  );

  const totalCount = countResult.rows[0].total;

  params.push(limit, offset);
  const listResult = await db.query(
    `SELECT c.*
     FROM conversations c
     WHERE ${whereClause}
     ORDER BY c.updated_at DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params,
  );

  return {
    conversations: listResult.rows,
    totalCount,
  };
}

async function listConversationParticipants(conversationId, db = { query }) {
  const result = await db.query(
    `SELECT cp.user_id, u.username, u.name, u.avatar
     FROM conversation_participants cp
     JOIN users u ON u.id = cp.user_id
     WHERE cp.conversation_id = $1
       AND cp.deleted_at IS NULL
       AND u.deleted_at IS NULL
     ORDER BY cp.joined_at ASC`,
    [conversationId],
  );

  return result.rows.map(mapConversationParticipant);
}

async function findConversationParticipant(conversationId, userId, db = { query }) {
  const result = await db.query(
    `SELECT *
     FROM conversation_participants
     WHERE conversation_id = $1
       AND user_id = $2
       AND deleted_at IS NULL`,
    [conversationId, userId],
  );

  return result.rows[0] || null;
}

async function createConversation(input) {
  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO conversations (id, type, name, created_by_user_id, e2ee, disappearing_timer)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.id,
        input.type,
        input.name || null,
        input.createdByUserId,
        input.e2ee || false,
        input.disappearingTimer || 0,
      ],
    );

    for (const participant of input.participants) {
      await client.query(
        `INSERT INTO conversation_participants (id, conversation_id, user_id, is_admin)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (conversation_id, user_id)
         WHERE deleted_at IS NULL
         DO NOTHING`,
        [participant.id, input.id, participant.userId, participant.isAdmin === true],
      );
    }

    const created = await findConversationById(input.id, client);
    return created;
  });
}

async function softDeleteConversationParticipant(conversationId, userId, db = { query }) {
  await db.query(
    `UPDATE conversation_participants
     SET deleted_at = NOW(),
         updated_at = NOW()
     WHERE conversation_id = $1
       AND user_id = $2
       AND deleted_at IS NULL`,
    [conversationId, userId],
  );
}

async function upsertConversationParticipant(input, db = { query }) {
  const existingDeleted = await db.query(
    `SELECT id
     FROM conversation_participants
     WHERE conversation_id = $1
       AND user_id = $2
       AND deleted_at IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1`,
    [input.conversationId, input.userId],
  );

  if (existingDeleted.rowCount > 0) {
    await db.query(
      `UPDATE conversation_participants
       SET deleted_at = NULL,
           is_admin = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [existingDeleted.rows[0].id, input.isAdmin === true],
    );
    return;
  }

  await db.query(
    `INSERT INTO conversation_participants (id, conversation_id, user_id, is_admin)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (conversation_id, user_id)
     WHERE deleted_at IS NULL
     DO NOTHING`,
    [input.id, input.conversationId, input.userId, input.isAdmin === true],
  );
}

async function findExistingDmConversationBetweenUsers(userA, userB, db = { query }) {
  const result = await db.query(
    `SELECT c.id
     FROM conversations c
     JOIN conversation_participants cp1
       ON cp1.conversation_id = c.id
      AND cp1.user_id = $1
      AND cp1.deleted_at IS NULL
     JOIN conversation_participants cp2
       ON cp2.conversation_id = c.id
      AND cp2.user_id = $2
      AND cp2.deleted_at IS NULL
     WHERE c.type = 'dm'
       AND c.deleted_at IS NULL
       AND (
         SELECT COUNT(*)
         FROM conversation_participants cp
         WHERE cp.conversation_id = c.id
           AND cp.deleted_at IS NULL
       ) = 2
     LIMIT 1`,
    [userA, userB],
  );

  return result.rows[0] ? result.rows[0].id : null;
}

async function findChannelById(channelId, db = { query }) {
  const result = await db.query(
    `SELECT *
     FROM channels
     WHERE id = $1
       AND deleted_at IS NULL`,
    [channelId],
  );

  return result.rows[0] || null;
}

async function findChannelMembership(channelId, userId, db = { query }) {
  const result = await db.query(
    `SELECT *
     FROM channel_members
     WHERE channel_id = $1
       AND user_id = $2
       AND deleted_at IS NULL`,
    [channelId, userId],
  );

  return result.rows[0] || null;
}

async function findMessageById(messageId, db = { query }) {
  const result = await db.query(
    `SELECT m.*,
            u.username AS sender_username,
            u.name AS sender_name,
            u.avatar AS sender_avatar
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.id = $1
       AND m.deleted_at IS NULL
       AND u.deleted_at IS NULL`,
    [messageId],
  );

  return result.rows[0] || null;
}

async function countThreadReplies(messageId, db = { query }) {
  const result = await db.query(
    `SELECT COUNT(*)::INT AS count
     FROM messages
     WHERE thread_parent_id = $1
       AND deleted_at IS NULL`,
    [messageId],
  );

  return result.rows[0].count;
}

async function listMessagesByTarget({ targetType, targetId, before, after, limit }, db = { query }) {
  const params = [targetType, targetId];
  const filters = [
    'm.target_type = $1',
    'm.target_id = $2',
    'm.deleted_at IS NULL',
  ];

  if (before) {
    params.push(before);
    filters.push(`m.created_at < COALESCE((SELECT created_at FROM messages WHERE id = $${params.length}), NOW() + INTERVAL '1 second')`);
  }

  if (after) {
    params.push(after);
    filters.push(`m.created_at > COALESCE((SELECT created_at FROM messages WHERE id = $${params.length}), to_timestamp(0))`);
  }

  params.push(limit + 1);

  const result = await db.query(
    `SELECT m.*,
            u.username AS sender_username,
            u.name AS sender_name,
            u.avatar AS sender_avatar
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE ${filters.join(' AND ')}
     ORDER BY m.created_at DESC
     LIMIT $${params.length}`,
    params,
  );

  return result.rows;
}

async function createMessage(input, db = { query }) {
  await db.query(
    `INSERT INTO messages (
      id,
      body,
      format,
      sender_id,
      target_type,
      target_id,
      thread_parent_id,
      reply_to,
      attachments,
      mentions,
      encryption
    ) VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      $9::jsonb,
      $10,
      $11::jsonb
    )`,
    [
      input.id,
      input.body,
      input.format,
      input.senderId,
      input.targetType,
      input.targetId,
      input.threadParentId || null,
      input.replyTo || null,
      JSON.stringify(input.attachments || []),
      input.mentions || [],
      JSON.stringify(input.encryption || {}),
    ],
  );

  await db.query(
    `UPDATE conversations
     SET updated_at = NOW()
     WHERE id = $1
       AND deleted_at IS NULL`,
    [input.targetType === 'conversation' ? input.targetId : null],
  );

  const row = await findMessageById(input.id, db);
  return row;
}

async function addMessageEdit(input, db = { query }) {
  await db.query(
    `INSERT INTO message_edits (id, message_id, body, edited_by_user_id)
     VALUES ($1, $2, $3, $4)`,
    [input.id, input.messageId, input.body, input.editedByUserId],
  );
}

async function updateMessageBody(messageId, body, db = { query }) {
  await db.query(
    `UPDATE messages
     SET body = $2,
         edited = TRUE,
         edited_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
       AND deleted_at IS NULL`,
    [messageId, body],
  );
}

async function softDeleteMessage(messageId, db = { query }) {
  await db.query(
    `UPDATE messages
     SET deleted_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
       AND deleted_at IS NULL`,
    [messageId],
  );
}

async function listMessageEdits(messageId, db = { query }) {
  const result = await db.query(
    `SELECT body, edited_at
     FROM message_edits
     WHERE message_id = $1
     ORDER BY edited_at ASC`,
    [messageId],
  );

  return result.rows.map((row) => ({
    body: row.body,
    editedAt: row.edited_at,
  }));
}

async function listThreadMessages({ messageId, limit, offset }, db = { query }) {
  const result = await db.query(
    `SELECT m.*,
            u.username AS sender_username,
            u.name AS sender_name,
            u.avatar AS sender_avatar
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.thread_parent_id = $1
       AND m.deleted_at IS NULL
     ORDER BY m.created_at ASC
     LIMIT $2 OFFSET $3`,
    [messageId, limit, offset],
  );

  return result.rows;
}

async function addReaction(input, db = { query }) {
  await db.query(
    `INSERT INTO message_reactions (id, message_id, user_id, emoji)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (message_id, user_id, emoji)
     WHERE deleted_at IS NULL
     DO NOTHING`,
    [input.id, input.messageId, input.userId, input.emoji],
  );

  await db.query(
    `UPDATE message_reactions
     SET deleted_at = NULL
     WHERE message_id = $1
       AND user_id = $2
       AND emoji = $3
       AND deleted_at IS NOT NULL`,
    [input.messageId, input.userId, input.emoji],
  );
}

async function removeReaction(messageId, userId, emoji, db = { query }) {
  await db.query(
    `UPDATE message_reactions
     SET deleted_at = NOW()
     WHERE message_id = $1
       AND user_id = $2
       AND emoji = $3
       AND deleted_at IS NULL`,
    [messageId, userId, emoji],
  );
}

async function listMessageReactions(messageId, db = { query }) {
  const result = await db.query(
    `SELECT emoji, user_id
     FROM message_reactions
     WHERE message_id = $1
       AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [messageId],
  );

  return mapReaction(result.rows);
}

async function listPinnedMessages(channelId, db = { query }) {
  const result = await db.query(
    `SELECT m.*,
            u.username AS sender_username,
            u.name AS sender_name,
            u.avatar AS sender_avatar
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.target_type = 'channel'
       AND m.target_id = $1
       AND m.pinned = TRUE
       AND m.deleted_at IS NULL
     ORDER BY m.pinned_at DESC NULLS LAST, m.created_at DESC`,
    [channelId],
  );

  return result.rows;
}

async function pinMessage(messageId, userId, db = { query }) {
  await db.query(
    `UPDATE messages
     SET pinned = TRUE,
         pinned_at = NOW(),
         pinned_by_user_id = $2,
         updated_at = NOW()
     WHERE id = $1
       AND deleted_at IS NULL`,
    [messageId, userId],
  );
}

async function unpinMessage(messageId, db = { query }) {
  await db.query(
    `UPDATE messages
     SET pinned = FALSE,
         pinned_at = NULL,
         pinned_by_user_id = NULL,
         updated_at = NOW()
     WHERE id = $1
       AND deleted_at IS NULL`,
    [messageId],
  );
}

async function listBookmarks(userId, { limit, offset }, db = { query }) {
  const result = await db.query(
    `SELECT m.*,
            u.username AS sender_username,
            u.name AS sender_name,
            u.avatar AS sender_avatar
     FROM message_bookmarks mb
     JOIN messages m ON m.id = mb.message_id AND m.deleted_at IS NULL
     JOIN users u ON u.id = m.sender_id AND u.deleted_at IS NULL
     WHERE mb.user_id = $1
       AND mb.deleted_at IS NULL
     ORDER BY mb.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );

  return result.rows;
}

async function addBookmark(input, db = { query }) {
  await db.query(
    `INSERT INTO message_bookmarks (id, user_id, message_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, message_id)
     WHERE deleted_at IS NULL
     DO NOTHING`,
    [input.id, input.userId, input.messageId],
  );

  await db.query(
    `UPDATE message_bookmarks
     SET deleted_at = NULL
     WHERE user_id = $1
       AND message_id = $2
       AND deleted_at IS NOT NULL`,
    [input.userId, input.messageId],
  );
}

async function removeBookmark(userId, messageId, db = { query }) {
  await db.query(
    `UPDATE message_bookmarks
     SET deleted_at = NOW()
     WHERE user_id = $1
       AND message_id = $2
       AND deleted_at IS NULL`,
    [userId, messageId],
  );
}

async function createPoll(input) {
  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO polls (
        id,
        channel_id,
        message_id,
        question,
        multiple_choice,
        anonymous,
        expires_at,
        created_by_user_id
      ) VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8
      )`,
      [
        input.id,
        input.channelId,
        input.messageId || null,
        input.question,
        input.multipleChoice === true,
        input.anonymous === true,
        input.expiresAt || null,
        input.createdByUserId,
      ],
    );

    for (const option of input.options) {
      await client.query(
        `INSERT INTO poll_options (id, poll_id, option_index, text)
         VALUES ($1, $2, $3, $4)`,
        [option.id, input.id, option.index, option.text],
      );
    }

    const poll = await findPollById(input.id, client);
    return poll;
  });
}

async function findPollById(pollId, db = { query }) {
  const pollResult = await db.query(
    `SELECT p.*
     FROM polls p
     WHERE p.id = $1
       AND p.deleted_at IS NULL`,
    [pollId],
  );

  if (pollResult.rowCount === 0) {
    return null;
  }

  const poll = pollResult.rows[0];

  const optionsResult = await db.query(
    `SELECT po.option_index, po.text,
            COALESCE(v.vote_count, 0)::INT AS votes
     FROM poll_options po
     LEFT JOIN (
       SELECT option_index, COUNT(*)::INT AS vote_count
       FROM poll_votes
       WHERE poll_id = $1
         AND deleted_at IS NULL
       GROUP BY option_index
     ) v ON v.option_index = po.option_index
     WHERE po.poll_id = $1
       AND po.deleted_at IS NULL
     ORDER BY po.option_index ASC`,
    [pollId],
  );

  const totalVotes = optionsResult.rows.reduce((acc, option) => acc + Number(option.votes), 0);

  return {
    id: poll.id,
    channelId: poll.channel_id,
    messageId: poll.message_id,
    question: poll.question,
    options: optionsResult.rows.map((row) => ({
      index: Number(row.option_index),
      text: row.text,
      votes: Number(row.votes),
    })),
    totalVotes,
    multipleChoice: poll.multiple_choice,
    anonymous: poll.anonymous,
    expiresAt: poll.expires_at,
    createdBy: poll.created_by_user_id,
    createdAt: poll.created_at,
  };
}

async function votePoll({ pollId, userId, optionIndex }, db = { query }) {
  return withTransaction(async (client) => {
    const pollResult = await client.query(
      `SELECT *
       FROM polls
       WHERE id = $1
         AND deleted_at IS NULL`,
      [pollId],
    );

    if (pollResult.rowCount === 0) {
      return null;
    }

    const poll = pollResult.rows[0];

    if (!poll.multiple_choice) {
      await client.query(
        `UPDATE poll_votes
         SET deleted_at = NOW()
         WHERE poll_id = $1
           AND user_id = $2
           AND deleted_at IS NULL`,
        [pollId, userId],
      );
    }

    await client.query(
      `INSERT INTO poll_votes (id, poll_id, option_index, user_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (poll_id, user_id, option_index)
       WHERE deleted_at IS NULL
       DO NOTHING`,
      [generateId('pv'), pollId, optionIndex, userId],
    );

    await client.query(
      `UPDATE poll_votes
       SET deleted_at = NULL
       WHERE poll_id = $1
         AND user_id = $2
         AND option_index = $3
         AND deleted_at IS NOT NULL`,
      [pollId, userId, optionIndex],
    );

    return findPollById(pollId, client);
  });
}

async function searchMessages(input, db = { query }) {
  const params = [];
  const filters = ['m.deleted_at IS NULL'];

  if (input.channelId) {
    params.push('channel');
    params.push(input.channelId);
    filters.push(`m.target_type = $${params.length - 1}`);
    filters.push(`m.target_id = $${params.length}`);
  }

  if (input.conversationId) {
    params.push('conversation');
    params.push(input.conversationId);
    filters.push(`m.target_type = $${params.length - 1}`);
    filters.push(`m.target_id = $${params.length}`);
  }

  if (input.senderId) {
    params.push(input.senderId);
    filters.push(`m.sender_id = $${params.length}`);
  }

  if (input.from) {
    params.push(input.from);
    filters.push(`m.created_at >= $${params.length}`);
  }

  if (input.to) {
    params.push(input.to);
    filters.push(`m.created_at <= $${params.length}`);
  }

  if (input.hasAttachment === true) {
    filters.push(`jsonb_array_length(COALESCE(m.attachments, '[]'::jsonb)) > 0`);
  }

  if (input.hasLink === true) {
    filters.push(`m.body ~* 'https?://[^\\s]+'`);
  }

  if (input.isPinned === true) {
    filters.push('m.pinned = TRUE');
  }

  if (input.q) {
    params.push(`%${input.q.toLowerCase()}%`);
    filters.push(`LOWER(m.body) LIKE $${params.length}`);
  }

  params.push(input.limit, input.offset);

  const result = await db.query(
    `SELECT m.*,
            u.username AS sender_username,
            u.name AS sender_name,
            u.avatar AS sender_avatar
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE ${filters.join(' AND ')}
     ORDER BY m.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return result.rows;
}

module.exports = {
  mapMessageRow,
  findConversationById,
  listConversationsForUser,
  listConversationParticipants,
  findConversationParticipant,
  createConversation,
  softDeleteConversationParticipant,
  upsertConversationParticipant,
  findExistingDmConversationBetweenUsers,
  findChannelById,
  findChannelMembership,
  findMessageById,
  countThreadReplies,
  listMessagesByTarget,
  createMessage,
  addMessageEdit,
  updateMessageBody,
  softDeleteMessage,
  listMessageEdits,
  listThreadMessages,
  addReaction,
  removeReaction,
  listMessageReactions,
  listPinnedMessages,
  pinMessage,
  unpinMessage,
  listBookmarks,
  addBookmark,
  removeBookmark,
  createPoll,
  findPollById,
  votePoll,
  searchMessages,
};
