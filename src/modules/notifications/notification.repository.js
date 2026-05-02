const { query } = require('../../db/pool');

const DEFAULT_PREFERENCES = {
  email: {
    mentions: true,
    directMessages: true,
    channelActivity: false,
  },
  push: {
    mentions: true,
    directMessages: true,
    channelActivity: true,
  },
  inApp: {
    mentions: true,
    directMessages: true,
    channelActivity: true,
  },
  muteChannels: [],
  doNotDisturb: {
    enabled: false,
    from: '22:00',
    to: '08:00',
    timezone: 'UTC',
  },
};

function mapNotification(row) {
  if (!row) return null;

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    read: Boolean(row.read_at),
    createdAt: row.created_at,
  };
}

async function createNotification(input, db = { query }) {
  const result = await db.query(
    `INSERT INTO notifications (
      id,
      user_id,
      type,
      title,
      body,
      link
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *`,
    [
      input.id,
      input.userId,
      input.type,
      input.title,
      input.body || null,
      input.link || null,
    ],
  );

  return mapNotification(result.rows[0]);
}

async function listNotifications(userId, { unread, type, limit, offset }, db = { query }) {
  const params = [userId];
  const filters = ['user_id = $1', 'deleted_at IS NULL'];

  if (unread === true) {
    filters.push('read_at IS NULL');
  }

  if (type) {
    params.push(type);
    filters.push(`type = $${params.length}`);
  }

  const where = filters.join(' AND ');

  const countResult = await db.query(
    `SELECT COUNT(*)::INT AS total
     FROM notifications
     WHERE ${where}`,
    params,
  );

  const unreadCountResult = await db.query(
    `SELECT COUNT(*)::INT AS total
     FROM notifications
     WHERE user_id = $1
       AND deleted_at IS NULL
       AND read_at IS NULL`,
    [userId],
  );

  params.push(limit, offset);

  const listResult = await db.query(
    `SELECT *
     FROM notifications
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params,
  );

  return {
    notifications: listResult.rows.map(mapNotification),
    totalCount: countResult.rows[0].total,
    unreadCount: unreadCountResult.rows[0].total,
  };
}

async function markNotificationRead(notificationId, userId, db = { query }) {
  const result = await db.query(
    `UPDATE notifications
     SET read_at = COALESCE(read_at, NOW()),
         updated_at = NOW()
     WHERE id = $1
       AND user_id = $2
       AND deleted_at IS NULL`,
    [notificationId, userId],
  );

  return result.rowCount;
}

async function markAllNotificationsRead(userId, db = { query }) {
  await db.query(
    `UPDATE notifications
     SET read_at = COALESCE(read_at, NOW()),
         updated_at = NOW()
     WHERE user_id = $1
       AND deleted_at IS NULL
       AND read_at IS NULL`,
    [userId],
  );
}

async function findNotificationPreferences(userId, db = { query }) {
  const result = await db.query(
    `SELECT preferences
     FROM notification_preferences
     WHERE user_id = $1
       AND deleted_at IS NULL`,
    [userId],
  );

  return result.rows[0] ? result.rows[0].preferences : null;
}

async function upsertNotificationPreferences(userId, preferences, db = { query }) {
  const result = await db.query(
    `INSERT INTO notification_preferences (user_id, preferences)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (user_id)
     DO UPDATE SET
       preferences = EXCLUDED.preferences,
       updated_at = NOW(),
       deleted_at = NULL
     RETURNING preferences`,
    [userId, JSON.stringify(preferences)],
  );

  return result.rows[0].preferences;
}

module.exports = {
  DEFAULT_PREFERENCES,
  createNotification,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  findNotificationPreferences,
  upsertNotificationPreferences,
};
