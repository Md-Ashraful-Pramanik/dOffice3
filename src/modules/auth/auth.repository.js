const { query } = require('../../db/pool');

function mapSession(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    refreshToken: row.refresh_token,
    userAgent: row.user_agent,
    ip: row.ip,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    revokedAt: row.revoked_at,
  };
}

async function createSession(session, db = { query }) {
  const result = await db.query(
    `INSERT INTO sessions (
      id,
      user_id,
      refresh_token,
      user_agent,
      ip,
      last_active_at
    ) VALUES ($1, $2, $3, $4, $5, NOW())
    RETURNING id, user_id, refresh_token, user_agent, ip, created_at, last_active_at, revoked_at`,
    [session.id, session.userId, session.refreshToken, session.userAgent, session.ip],
  );

  return mapSession(result.rows[0]);
}

async function findActiveSessionById(sessionId, db = { query }) {
  const result = await db.query(
    `SELECT id, user_id, refresh_token, user_agent, ip, created_at, last_active_at, revoked_at
     FROM sessions
     WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId],
  );

  return mapSession(result.rows[0]);
}

async function updateSessionActivity(sessionId, db = { query }) {
  const result = await db.query(
    `UPDATE sessions
     SET last_active_at = NOW()
     WHERE id = $1 AND revoked_at IS NULL
     RETURNING id, user_id, refresh_token, user_agent, ip, created_at, last_active_at, revoked_at`,
    [sessionId],
  );

  return mapSession(result.rows[0]);
}

async function revokeSession(sessionId, db = { query }) {
  const result = await db.query(
    `UPDATE sessions
     SET revoked_at = NOW(), last_active_at = NOW()
     WHERE id = $1 AND revoked_at IS NULL
     RETURNING id, user_id, refresh_token, user_agent, ip, created_at, last_active_at, revoked_at`,
    [sessionId],
  );

  return mapSession(result.rows[0]);
}

module.exports = {
  createSession,
  findActiveSessionById,
  updateSessionActivity,
  revokeSession,
};
