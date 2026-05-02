const { query, withTransaction } = require('../../db/pool');

// ── helpers ──────────────────────────────────────────────────────────────────

function mapChannel(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description,
    topic: row.topic,
    categoryId: row.category_id,
    orgId: row.org_id,
    memberCount: row.member_count != null ? Number(row.member_count) : 0,
    e2ee: row.e2ee,
    slowModeInterval: row.slow_mode_interval,
    createdBy: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCategory(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    orgId: row.org_id,
    position: row.position,
    channelCount: row.channel_count != null ? Number(row.channel_count) : 0,
  };
}

function mapMember(row) {
  if (!row) return null;
  return {
    id: row.user_id,
    username: row.username,
    name: row.name,
    email: row.email,
    avatar: row.avatar,
    channelRole: row.role,
    joinedAt: row.created_at,
  };
}

const CHANNEL_SELECT = `
  SELECT
    c.id, c.name, c.type, c.description, c.topic, c.category_id, c.org_id,
    c.e2ee, c.slow_mode_interval, c.created_by_user_id, c.created_at, c.updated_at,
    COALESCE(mc.cnt, 0)::INT AS member_count
  FROM channels c
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::INT AS cnt
    FROM channel_members cm
    WHERE cm.channel_id = c.id AND cm.deleted_at IS NULL
  ) mc ON TRUE
`;

// ── channels ─────────────────────────────────────────────────────────────────

async function findChannelById(id) {
  const { rows } = await query(
    `${CHANNEL_SELECT} WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [id],
  );
  return mapChannel(rows[0]);
}

async function listChannels({ orgId, search, type, categoryId, joinedUserId, limit, offset }) {
  const conditions = ['c.org_id = $1', 'c.deleted_at IS NULL'];
  const params = [orgId];

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(`LOWER(c.name) LIKE $${params.length}`);
  }

  if (type) {
    params.push(type);
    conditions.push(`c.type = $${params.length}`);
  }

  if (categoryId) {
    params.push(categoryId);
    conditions.push(`c.category_id = $${params.length}`);
  }

  if (joinedUserId) {
    params.push(joinedUserId);
    conditions.push(`
      EXISTS (
        SELECT 1 FROM channel_members cm
        WHERE cm.channel_id = c.id AND cm.user_id = $${params.length} AND cm.deleted_at IS NULL
      )
    `);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const countResult = await query(
    `SELECT COUNT(*)::INT AS total FROM channels c ${where}`,
    params,
  );

  const totalCount = countResult.rows[0].total;

  params.push(limit, offset);
  const { rows } = await query(
    `${CHANNEL_SELECT} ${where} ORDER BY c.name ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { channels: rows.map(mapChannel), totalCount };
}

async function createChannel({ id, name, type, description, topic, categoryId, orgId, e2ee, createdByUserId }) {
  const { rows } = await query(
    `INSERT INTO channels (id, name, type, description, topic, category_id, org_id, e2ee, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [id, name, type, description || null, topic || null, categoryId || null, orgId, e2ee || false, createdByUserId],
  );
  return findChannelById(rows[0].id);
}

async function updateChannel(id, updates) {
  const setClauses = [];
  const params = [];

  const fields = {
    name: 'name',
    description: 'description',
    topic: 'topic',
    category_id: 'category_id',
    type: 'type',
    slow_mode_interval: 'slow_mode_interval',
  };

  for (const [jsKey, dbCol] of Object.entries(fields)) {
    if (Object.prototype.hasOwnProperty.call(updates, jsKey)) {
      params.push(updates[jsKey]);
      setClauses.push(`${dbCol} = $${params.length}`);
    }
  }

  if (setClauses.length === 0) return findChannelById(id);

  setClauses.push('updated_at = NOW()');
  params.push(id);

  await query(
    `UPDATE channels SET ${setClauses.join(', ')} WHERE id = $${params.length} AND deleted_at IS NULL`,
    params,
  );

  return findChannelById(id);
}

async function softDeleteChannel(id) {
  await query(
    `UPDATE channels SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
}

async function setChannelSlowMode(channelId, intervalSeconds) {
  await query(
    `UPDATE channels
     SET slow_mode_interval = $2,
         updated_at = NOW()
     WHERE id = $1
       AND deleted_at IS NULL`,
    [channelId, intervalSeconds],
  );

  return findChannelById(channelId);
}

// ── channel members ───────────────────────────────────────────────────────────

async function findMembership(channelId, userId) {
  const { rows } = await query(
    `SELECT * FROM channel_members WHERE channel_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [channelId, userId],
  );
  return rows[0] || null;
}

async function addMember({ id, channelId, userId, role, addedByUserId }) {
  await query(
    `INSERT INTO channel_members (id, channel_id, user_id, role, added_by_user_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    [id, channelId, userId, role || 'member', addedByUserId || null],
  );
}

async function removeMember(channelId, userId) {
  await query(
    `UPDATE channel_members SET deleted_at = NOW()
     WHERE channel_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [channelId, userId],
  );
}

async function setMemberRole(channelId, userId, role) {
  await query(
    `UPDATE channel_members SET role = $3, updated_at = NOW()
     WHERE channel_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [channelId, userId, role],
  );
}

async function listMembers({ channelId, search, role, limit, offset }) {
  const conditions = ['cm.channel_id = $1', 'cm.deleted_at IS NULL', 'u.deleted_at IS NULL'];
  const params = [channelId];

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(`(LOWER(u.username) LIKE $${params.length} OR LOWER(u.name) LIKE $${params.length})`);
  }

  if (role) {
    params.push(role);
    conditions.push(`cm.role = $${params.length}`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const countResult = await query(
    `SELECT COUNT(*)::INT AS total
     FROM channel_members cm
     JOIN users u ON u.id = cm.user_id
     ${where}`,
    params,
  );

  const totalCount = countResult.rows[0].total;

  params.push(limit, offset);
  const { rows } = await query(
    `SELECT u.id AS user_id, u.username, u.name, u.email, u.avatar, cm.role, cm.created_at
     FROM channel_members cm
     JOIN users u ON u.id = cm.user_id
     ${where}
     ORDER BY u.username ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { members: rows.map(mapMember), totalCount };
}

async function countAdmins(channelId) {
  const { rows } = await query(
    `SELECT COUNT(*)::INT AS cnt FROM channel_members
     WHERE channel_id = $1 AND role = 'admin' AND deleted_at IS NULL`,
    [channelId],
  );
  return rows[0].cnt;
}

// ── channel categories ────────────────────────────────────────────────────────

async function findCategoryById(id) {
  const { rows } = await query(
    `SELECT cc.*,
       COALESCE(ch_cnt.cnt, 0)::INT AS channel_count
     FROM channel_categories cc
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::INT AS cnt
       FROM channels c
       WHERE c.category_id = cc.id AND c.deleted_at IS NULL
     ) ch_cnt ON TRUE
     WHERE cc.id = $1 AND cc.deleted_at IS NULL`,
    [id],
  );
  return mapCategory(rows[0]);
}

async function listCategories(orgId) {
  const { rows } = await query(
    `SELECT cc.*,
       COALESCE(ch_cnt.cnt, 0)::INT AS channel_count
     FROM channel_categories cc
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::INT AS cnt
       FROM channels c
       WHERE c.category_id = cc.id AND c.deleted_at IS NULL
     ) ch_cnt ON TRUE
     WHERE cc.org_id = $1 AND cc.deleted_at IS NULL
     ORDER BY cc.position ASC, cc.name ASC`,
    [orgId],
  );
  return rows.map(mapCategory);
}

async function createCategory({ id, name, orgId, position, createdByUserId }) {
  const { rows } = await query(
    `INSERT INTO channel_categories (id, name, org_id, position, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [id, name, orgId, position != null ? position : 0, createdByUserId],
  );
  return findCategoryById(rows[0].id);
}

async function updateCategory(id, updates) {
  const setClauses = [];
  const params = [];

  if (updates.name !== undefined) {
    params.push(updates.name);
    setClauses.push(`name = $${params.length}`);
  }

  if (updates.position !== undefined) {
    params.push(updates.position);
    setClauses.push(`position = $${params.length}`);
  }

  if (setClauses.length === 0) return findCategoryById(id);

  setClauses.push('updated_at = NOW()');
  params.push(id);

  await query(
    `UPDATE channel_categories SET ${setClauses.join(', ')} WHERE id = $${params.length} AND deleted_at IS NULL`,
    params,
  );

  return findCategoryById(id);
}

async function softDeleteCategory(id) {
  await query(
    `UPDATE channel_categories SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
}

async function reorderCategories(orgId, orderedIds) {
  await withTransaction(async (client) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(
        `UPDATE channel_categories SET position = $1, updated_at = NOW()
         WHERE id = $2 AND org_id = $3 AND deleted_at IS NULL`,
        [i, orderedIds[i], orgId],
      );
    }
  });
}

async function findCategoryByNameAndOrg(name, orgId) {
  const { rows } = await query(
    `SELECT id FROM channel_categories WHERE LOWER(name) = LOWER($1) AND org_id = $2 AND deleted_at IS NULL`,
    [name, orgId],
  );
  return rows[0] || null;
}

async function findChannelByNameAndOrg(name, orgId) {
  const { rows } = await query(
    `SELECT id FROM channels WHERE LOWER(name) = LOWER($1) AND org_id = $2 AND deleted_at IS NULL`,
    [name, orgId],
  );
  return rows[0] || null;
}

module.exports = {
  findChannelById,
  listChannels,
  createChannel,
  updateChannel,
  setChannelSlowMode,
  softDeleteChannel,
  findMembership,
  addMember,
  removeMember,
  setMemberRole,
  listMembers,
  countAdmins,
  findCategoryById,
  listCategories,
  createCategory,
  updateCategory,
  softDeleteCategory,
  reorderCategories,
  findCategoryByNameAndOrg,
  findChannelByNameAndOrg,
};
