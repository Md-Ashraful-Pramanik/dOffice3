const { query } = require('../../db/pool');

function mapRole(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    orgId: row.org_id,
    inheritsFrom: row.inherits_from,
    permissions: row.permissions || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findRolesByOrg(orgId, { search, type } = {}) {
  const conditions = ['r.org_id = $1', 'r.deleted_at IS NULL'];
  const params = [orgId];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`r.name ILIKE $${params.length}`);
  }

  if (type) {
    params.push(type);
    conditions.push(`r.type = $${params.length}`);
  }

  const sql = `
    SELECT * FROM roles r
    WHERE ${conditions.join(' AND ')}
    ORDER BY r.created_at ASC
  `;

  const result = await query(sql, params);
  return result.rows.map(mapRole);
}

async function findRoleById(roleId) {
  const result = await query(
    'SELECT * FROM roles WHERE id = $1 AND deleted_at IS NULL',
    [roleId],
  );
  return mapRole(result.rows[0]);
}

async function findRoleByIdAndOrg(roleId, orgId) {
  const result = await query(
    'SELECT * FROM roles WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL',
    [roleId, orgId],
  );
  return mapRole(result.rows[0]);
}

async function findRoleByName(name, orgId) {
  const result = await query(
    'SELECT * FROM roles WHERE LOWER(name) = LOWER($1) AND org_id = $2 AND deleted_at IS NULL',
    [name, orgId],
  );
  return mapRole(result.rows[0]);
}

async function createRole({ id, name, description, orgId, type, inheritsFrom, permissions, createdByUserId }) {
  const result = await query(
    `INSERT INTO roles (id, name, description, org_id, type, inherits_from, permissions, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [id, name, description || null, orgId, type || 'custom', inheritsFrom || null, JSON.stringify(permissions || []), createdByUserId || null],
  );
  return mapRole(result.rows[0]);
}

async function updateRole(roleId, { name, description, permissions, inheritsFrom }) {
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
  if (permissions !== undefined) {
    params.push(JSON.stringify(permissions));
    sets.push(`permissions = $${params.length}`);
  }
  if (inheritsFrom !== undefined) {
    params.push(inheritsFrom);
    sets.push(`inherits_from = $${params.length}`);
  }

  params.push(roleId);
  const result = await query(
    `UPDATE roles SET ${sets.join(', ')} WHERE id = $${params.length} AND deleted_at IS NULL RETURNING *`,
    params,
  );
  return mapRole(result.rows[0]);
}

async function softDeleteRole(roleId) {
  await query(
    'UPDATE roles SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
    [roleId],
  );
}

// User-role assignments

async function findAssignmentsForUser(userId) {
  const result = await query(
    'SELECT * FROM user_role_assignments WHERE user_id = $1 AND deleted_at IS NULL',
    [userId],
  );
  return result.rows;
}

async function findAssignment(userId, roleId, orgId) {
  const result = await query(
    'SELECT * FROM user_role_assignments WHERE user_id = $1 AND role_id = $2 AND org_id = $3 AND deleted_at IS NULL',
    [userId, roleId, orgId],
  );
  return result.rows[0] || null;
}

async function createAssignment({ id, userId, roleId, orgId, assignedByUserId }) {
  await query(
    `INSERT INTO user_role_assignments (id, user_id, role_id, org_id, assigned_by_user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, userId, roleId, orgId, assignedByUserId || null],
  );
}

async function softDeleteAssignment(userId, roleId) {
  await query(
    'UPDATE user_role_assignments SET deleted_at = NOW() WHERE user_id = $1 AND role_id = $2 AND deleted_at IS NULL',
    [userId, roleId],
  );
}

async function getUserRoleIds(userId) {
  const result = await query(
    'SELECT role_id FROM user_role_assignments WHERE user_id = $1 AND deleted_at IS NULL',
    [userId],
  );
  return result.rows.map((r) => r.role_id);
}

module.exports = {
  findRolesByOrg,
  findRoleById,
  findRoleByIdAndOrg,
  findRoleByName,
  createRole,
  updateRole,
  softDeleteRole,
  findAssignmentsForUser,
  findAssignment,
  createAssignment,
  softDeleteAssignment,
  getUserRoleIds,
};
