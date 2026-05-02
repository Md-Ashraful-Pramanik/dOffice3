const { query } = require('../../db/pool');

function mapTeam(row, members = []) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    orgId: row.org_id,
    permissionOverrides: row.permission_overrides || [],
    dynamicFilter: row.dynamic_filter || {},
    memberCount: row.member_count !== undefined ? Number(row.member_count) : members.length,
    members,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMember(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    username: row.username,
    name: row.name,
    avatar: row.avatar,
  };
}

async function findTeamsByOrg(orgId, { search, type, limit = 20, offset = 0 } = {}) {
  const conditions = ['t.org_id = $1', 't.deleted_at IS NULL'];
  const params = [orgId];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`t.name ILIKE $${params.length}`);
  }
  if (type) {
    params.push(type);
    conditions.push(`t.type = $${params.length}`);
  }

  const countResult = await query(
    `SELECT COUNT(*)::int AS total FROM teams t WHERE ${conditions.join(' AND ')}`,
    params,
  );
  const totalCount = countResult.rows[0].total;

  params.push(limit);
  params.push(offset);
  const sql = `
    SELECT t.*,
      (SELECT COUNT(*)::int FROM team_members tm WHERE tm.team_id = t.id AND tm.deleted_at IS NULL) AS member_count
    FROM teams t
    WHERE ${conditions.join(' AND ')}
    ORDER BY t.created_at ASC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;

  const result = await query(sql, params);
  return { rows: result.rows, totalCount };
}

async function findTeamById(teamId) {
  const result = await query(
    `SELECT t.*,
       (SELECT COUNT(*)::int FROM team_members tm WHERE tm.team_id = t.id AND tm.deleted_at IS NULL) AS member_count
     FROM teams t
     WHERE t.id = $1 AND t.deleted_at IS NULL`,
    [teamId],
  );
  return result.rows[0] || null;
}

async function findTeamByIdAndOrg(teamId, orgId) {
  const result = await query(
    `SELECT t.*,
       (SELECT COUNT(*)::int FROM team_members tm WHERE tm.team_id = t.id AND tm.deleted_at IS NULL) AS member_count
     FROM teams t
     WHERE t.id = $1 AND t.org_id = $2 AND t.deleted_at IS NULL`,
    [teamId, orgId],
  );
  return result.rows[0] || null;
}

async function findTeamMembersByTeamId(teamId) {
  const result = await query(
    `SELECT tm.user_id, u.username, u.name, u.avatar
     FROM team_members tm
     JOIN users u ON u.id = tm.user_id AND u.deleted_at IS NULL
     WHERE tm.team_id = $1 AND tm.deleted_at IS NULL`,
    [teamId],
  );
  return result.rows.map(mapMember);
}

async function findTeamByName(name, orgId) {
  const result = await query(
    'SELECT * FROM teams WHERE LOWER(name) = LOWER($1) AND org_id = $2 AND deleted_at IS NULL',
    [name, orgId],
  );
  return result.rows[0] || null;
}

async function createTeam({ id, name, description, type, orgId, permissionOverrides, dynamicFilter, createdByUserId }) {
  const result = await query(
    `INSERT INTO teams (id, name, description, type, org_id, permission_overrides, dynamic_filter, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [id, name, description || null, type || 'static', orgId,
      JSON.stringify(permissionOverrides || []), JSON.stringify(dynamicFilter || {}), createdByUserId || null],
  );
  return result.rows[0];
}

async function updateTeam(teamId, { name, description, permissionOverrides, dynamicFilter }) {
  const sets = ['updated_at = NOW()'];
  const params = [];

  if (name !== undefined) {
    params.push(name);
    sets.push(`name = $${params.length}`);
  }
  if (description !== undefined) {
    params.push(description);
    sets.push(`description = $${params.length}`);
  }
  if (permissionOverrides !== undefined) {
    params.push(JSON.stringify(permissionOverrides));
    sets.push(`permission_overrides = $${params.length}`);
  }
  if (dynamicFilter !== undefined) {
    params.push(JSON.stringify(dynamicFilter));
    sets.push(`dynamic_filter = $${params.length}`);
  }

  params.push(teamId);
  const result = await query(
    `UPDATE teams SET ${sets.join(', ')} WHERE id = $${params.length} AND deleted_at IS NULL RETURNING *`,
    params,
  );
  return result.rows[0] || null;
}

async function softDeleteTeam(teamId) {
  await query('UPDATE teams SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL', [teamId]);
}

async function findTeamMember(teamId, userId) {
  const result = await query(
    'SELECT * FROM team_members WHERE team_id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [teamId, userId],
  );
  return result.rows[0] || null;
}

async function addTeamMember({ id, teamId, userId, addedByUserId }) {
  await query(
    'INSERT INTO team_members (id, team_id, user_id, added_by_user_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
    [id, teamId, userId, addedByUserId || null],
  );
}

async function removeTeamMember(teamId, userId) {
  await query(
    'UPDATE team_members SET deleted_at = NOW() WHERE team_id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [teamId, userId],
  );
}

module.exports = {
  findTeamsByOrg,
  findTeamById,
  findTeamByIdAndOrg,
  findTeamMembersByTeamId,
  findTeamByName,
  createTeam,
  updateTeam,
  softDeleteTeam,
  findTeamMember,
  addTeamMember,
  removeTeamMember,
  mapTeam,
};
