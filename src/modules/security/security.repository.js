const { query, withTransaction } = require('../../db/pool');

function mapDevice(row, currentSessionId = null) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    identityKeyFingerprint: row.identity_key_fingerprint,
    lastSeen: row.last_seen_at,
    current: row.session_id != null && row.session_id === currentSessionId,
    sessionId: row.session_id,
  };
}

function mapKeyBundle(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    deviceId: row.device_id,
    identityKey: row.identity_key,
    signedPreKey: row.signed_pre_key || {},
    oneTimePreKeys: Array.isArray(row.one_time_pre_keys) ? row.one_time_pre_keys : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findDeviceBySession(userId, sessionId, db = { query }) {
  const result = await db.query(
    `SELECT *
     FROM user_devices
     WHERE user_id = $1
       AND session_id = $2
       AND deleted_at IS NULL`,
    [userId, sessionId],
  );

  return result.rows[0] || null;
}

async function createDevice(input, db = { query }) {
  const result = await db.query(
    `INSERT INTO user_devices (
      id,
      user_id,
      session_id,
      name,
      identity_key_fingerprint,
      last_seen_at
    ) VALUES ($1, $2, $3, $4, $5, NOW())
    RETURNING *`,
    [input.id, input.userId, input.sessionId || null, input.name, input.identityKeyFingerprint || null],
  );

  return result.rows[0] || null;
}

async function updateDevice(deviceId, input, db = { query }) {
  const fields = ['updated_at = NOW()', 'last_seen_at = NOW()'];
  const params = [deviceId];

  if (Object.prototype.hasOwnProperty.call(input, 'name')) {
    params.push(input.name);
    fields.push(`name = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(input, 'identityKeyFingerprint')) {
    params.push(input.identityKeyFingerprint);
    fields.push(`identity_key_fingerprint = $${params.length}`);
  }

  const result = await db.query(
    `UPDATE user_devices
     SET ${fields.join(', ')}
     WHERE id = $1
       AND deleted_at IS NULL
     RETURNING *`,
    params,
  );

  return result.rows[0] || null;
}

async function ensureDevice(input, db = { query }) {
  const existing = await findDeviceBySession(input.userId, input.sessionId, db);

  if (existing) {
    return updateDevice(existing.id, {
      name: input.name,
      identityKeyFingerprint: input.identityKeyFingerprint,
    }, db);
  }

  return createDevice(input, db);
}

async function listDevicesByUser(userId, db = { query }) {
  const result = await db.query(
    `SELECT *
     FROM user_devices
     WHERE user_id = $1
       AND deleted_at IS NULL
     ORDER BY last_seen_at DESC, created_at DESC`,
    [userId],
  );

  return result.rows;
}

async function findDeviceByIdForUser(deviceId, userId, db = { query }) {
  const result = await db.query(
    `SELECT *
     FROM user_devices
     WHERE id = $1
       AND user_id = $2
       AND deleted_at IS NULL`,
    [deviceId, userId],
  );

  return result.rows[0] || null;
}

async function softDeleteDevice(deviceId, userId, db = { query }) {
  const result = await db.query(
    `UPDATE user_devices
     SET deleted_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
       AND user_id = $2
       AND deleted_at IS NULL
     RETURNING *`,
    [deviceId, userId],
  );

  return result.rows[0] || null;
}

async function upsertKeyBundle(input, db = { query }) {
  const existing = await db.query(
    `SELECT id
     FROM user_key_bundles
     WHERE user_id = $1
       AND device_id = $2
       AND deleted_at IS NULL
     LIMIT 1`,
    [input.userId, input.deviceId],
  );

  if (existing.rowCount > 0) {
    const result = await db.query(
      `UPDATE user_key_bundles
       SET identity_key = $3,
           signed_pre_key = $4::jsonb,
           one_time_pre_keys = $5::jsonb,
           updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
         AND deleted_at IS NULL
       RETURNING *`,
      [
        existing.rows[0].id,
        input.userId,
        input.identityKey,
        JSON.stringify(input.signedPreKey),
        JSON.stringify(input.oneTimePreKeys),
      ],
    );

    return mapKeyBundle(result.rows[0]);
  }

  const result = await db.query(
    `INSERT INTO user_key_bundles (
      id,
      user_id,
      device_id,
      identity_key,
      signed_pre_key,
      one_time_pre_keys
    ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
    RETURNING *`,
    [
      input.id,
      input.userId,
      input.deviceId,
      input.identityKey,
      JSON.stringify(input.signedPreKey),
      JSON.stringify(input.oneTimePreKeys),
    ],
  );

  return mapKeyBundle(result.rows[0]);
}

async function findKeyBundleForUser(userId, deviceId, db = { query }) {
  const params = [userId];
  const filters = ['user_id = $1', 'deleted_at IS NULL'];

  if (deviceId) {
    params.push(deviceId);
    filters.push(`device_id = $${params.length}`);
  }

  const result = await db.query(
    `SELECT *
     FROM user_key_bundles
     WHERE ${filters.join(' AND ')}
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
    params,
  );

  return mapKeyBundle(result.rows[0]);
}

async function consumeKeyBundleOneTimeKey(bundleId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `SELECT *
       FROM user_key_bundles
       WHERE id = $1
         AND deleted_at IS NULL
       FOR UPDATE`,
      [bundleId],
    );

    if (result.rowCount === 0) {
      return null;
    }

    const row = result.rows[0];
    const oneTimePreKeys = Array.isArray(row.one_time_pre_keys) ? row.one_time_pre_keys : [];
    const consumed = oneTimePreKeys.length > 0 ? oneTimePreKeys[0] : null;
    const remaining = oneTimePreKeys.length > 0 ? oneTimePreKeys.slice(1) : [];

    await client.query(
      `UPDATE user_key_bundles
       SET one_time_pre_keys = $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [bundleId, JSON.stringify(remaining)],
    );

    return {
      bundle: mapKeyBundle({ ...row, one_time_pre_keys: remaining }),
      consumed,
    };
  });
}

async function listBundlesByUser(userId, db = { query }) {
  const result = await db.query(
    `SELECT *
     FROM user_key_bundles
     WHERE user_id = $1
       AND deleted_at IS NULL
     ORDER BY updated_at DESC, created_at DESC`,
    [userId],
  );

  return result.rows.map(mapKeyBundle);
}

module.exports = {
  mapDevice,
  mapKeyBundle,
  ensureDevice,
  listDevicesByUser,
  findDeviceByIdForUser,
  softDeleteDevice,
  upsertKeyBundle,
  findKeyBundleForUser,
  consumeKeyBundleOneTimeKey,
  listBundlesByUser,
};
