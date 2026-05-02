const { query } = require('../../db/pool');

const USER_FIELDS = `
  SELECT
    u.id,
    u.username,
    u.email,
    u.name,
    u.employee_id,
    u.designation,
    u.department,
    u.bio,
    u.avatar,
    u.status,
    u.contact_info,
    u.org_id,
    u.role_ids,
    u.location,
    u.skills,
    u.manager_user_id,
    u.created_at,
    u.updated_at,
    u.last_login_at
`;

function mapUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    name: row.name,
    employeeId: row.employee_id,
    designation: row.designation,
    department: row.department,
    bio: row.bio,
    avatar: row.avatar,
    status: row.status,
    contactInfo: row.contact_info || {},
    orgId: row.org_id,
    roleIds: row.role_ids || [],
    location: row.location,
    skills: row.skills || [],
    managerUserId: row.manager_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

function buildUserSearchClause(searchMode, parameterIndex) {
  if (searchMode === 'directory') {
    return `(
      COALESCE(u.name, '') ILIKE $${parameterIndex}
      OR COALESCE(u.username, '') ILIKE $${parameterIndex}
      OR COALESCE(u.designation, '') ILIKE $${parameterIndex}
      OR COALESCE(u.department, '') ILIKE $${parameterIndex}
      OR EXISTS (
        SELECT 1
        FROM unnest(COALESCE(u.skills, '{}'::text[])) AS skill
        WHERE skill ILIKE $${parameterIndex}
      )
    )`;
  }

  return `(
    COALESCE(u.name, '') ILIKE $${parameterIndex}
    OR COALESCE(u.username, '') ILIKE $${parameterIndex}
    OR COALESCE(u.email, '') ILIKE $${parameterIndex}
    OR COALESCE(u.employee_id, '') ILIKE $${parameterIndex}
  )`;
}

function buildUserFilters(filters = {}) {
  const clauses = ['u.deleted_at IS NULL'];
  const params = [];

  if (Array.isArray(filters.organizationIds)) {
    if (filters.organizationIds.length === 0) {
      return { clauses, params, isEmpty: true };
    }

    params.push(filters.organizationIds);
    clauses.push(`u.org_id = ANY($${params.length})`);
  }

  if (Array.isArray(filters.userIds)) {
    if (filters.userIds.length === 0) {
      return { clauses, params, isEmpty: true };
    }

    params.push(filters.userIds);
    clauses.push(`u.id = ANY($${params.length})`);
  }

  if (filters.search) {
    params.push(`%${filters.search}%`);
    clauses.push(buildUserSearchClause(filters.searchMode, params.length));
  }

  if (filters.status) {
    params.push(filters.status);
    clauses.push(`u.status = $${params.length}`);
  }

  if (Array.isArray(filters.statuses) && filters.statuses.length > 0) {
    params.push(filters.statuses);
    clauses.push(`u.status = ANY($${params.length})`);
  }

  if (filters.department) {
    params.push(`%${filters.department}%`);
    clauses.push(`COALESCE(u.department, '') ILIKE $${params.length}`);
  }

  if (filters.designation) {
    params.push(`%${filters.designation}%`);
    clauses.push(`COALESCE(u.designation, '') ILIKE $${params.length}`);
  }

  if (filters.location) {
    params.push(`%${filters.location}%`);
    clauses.push(`COALESCE(u.location, '') ILIKE $${params.length}`);
  }

  if (filters.roleId) {
    params.push(filters.roleId);
    clauses.push(`EXISTS (
      SELECT 1
      FROM unnest(COALESCE(u.role_ids, '{}'::text[])) AS role_id
      WHERE LOWER(role_id) = LOWER($${params.length})
    )`);
  }

  if (filters.skill) {
    params.push(`%${filters.skill}%`);
    clauses.push(`EXISTS (
      SELECT 1
      FROM unnest(COALESCE(u.skills, '{}'::text[])) AS skill
      WHERE skill ILIKE $${params.length}
    )`);
  }

  if (filters.managerUserId) {
    params.push(filters.managerUserId);
    clauses.push(`u.manager_user_id = $${params.length}`);
  }

  return {
    clauses,
    params,
    isEmpty: false,
  };
}

async function findActiveUserById(userId, db = { query }) {
  const result = await db.query(
    `${USER_FIELDS}
     FROM users u
     WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId],
  );

  return mapUser(result.rows[0]);
}

async function findUserWithPasswordByEmail(email, db = { query }) {
  const result = await db.query(
    `${USER_FIELDS},
      u.password_hash
     FROM users u
     WHERE LOWER(u.email) = LOWER($1) AND u.deleted_at IS NULL`,
    [email],
  );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    ...mapUser(row),
    passwordHash: row.password_hash,
  };
}

async function countActiveUsers(db = { query }) {
  const result = await db.query(
    `SELECT COUNT(*)::INT AS count FROM users WHERE deleted_at IS NULL`,
  );

  return result.rows[0].count;
}

async function emailExists(email, db = { query }, options = {}) {
  const params = [email];
  const clauses = ['LOWER(email) = LOWER($1)', 'deleted_at IS NULL'];

  if (options.excludeId) {
    params.push(options.excludeId);
    clauses.push(`id <> $${params.length}`);
  }

  const result = await db.query(
    `SELECT 1 FROM users WHERE ${clauses.join(' AND ')} LIMIT 1`,
    params,
  );

  return result.rowCount > 0;
}

async function usernameExists(username, db = { query }, options = {}) {
  const params = [username];
  const clauses = ['LOWER(username) = LOWER($1)', 'deleted_at IS NULL'];

  if (options.excludeId) {
    params.push(options.excludeId);
    clauses.push(`id <> $${params.length}`);
  }

  const result = await db.query(
    `SELECT 1 FROM users WHERE ${clauses.join(' AND ')} LIMIT 1`,
    params,
  );

  return result.rowCount > 0;
}

async function employeeIdExists(employeeId, db = { query }, options = {}) {
  if (!employeeId) {
    return false;
  }

  const params = [employeeId];
  const clauses = ['LOWER(employee_id) = LOWER($1)', 'deleted_at IS NULL'];

  if (options.excludeId) {
    params.push(options.excludeId);
    clauses.push(`id <> $${params.length}`);
  }

  const result = await db.query(
    `SELECT 1 FROM users WHERE ${clauses.join(' AND ')} LIMIT 1`,
    params,
  );

  return result.rowCount > 0;
}

async function createUser(user, db = { query }) {
  const result = await db.query(
    `INSERT INTO users (
      id,
      username,
      email,
      password_hash,
      name,
      employee_id,
      designation,
      department,
      bio,
      avatar,
      status,
      contact_info,
      org_id,
      role_ids,
      location,
      skills,
      manager_user_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17
    )
    RETURNING
      id,
      username,
      email,
      name,
      employee_id,
      designation,
      department,
      bio,
      avatar,
      status,
      contact_info,
      org_id,
      role_ids,
      location,
      skills,
      manager_user_id,
      created_at,
      updated_at,
      last_login_at`,
    [
      user.id,
      user.username,
      user.email,
      user.passwordHash,
      user.name,
      user.employeeId || null,
      user.designation || null,
      user.department || null,
      user.bio || null,
      user.avatar || null,
      user.status,
      JSON.stringify(user.contactInfo || {}),
      user.orgId || null,
      user.roleIds || [],
      user.location || null,
      user.skills || [],
      user.managerUserId || null,
    ],
  );

  return mapUser(result.rows[0]);
}

async function updateUser(userId, changes, db = { query }) {
  const fields = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(changes, 'username')) {
    params.push(changes.username);
    fields.push(`username = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'email')) {
    params.push(changes.email);
    fields.push(`email = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'passwordHash')) {
    params.push(changes.passwordHash);
    fields.push(`password_hash = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'name')) {
    params.push(changes.name);
    fields.push(`name = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'employeeId')) {
    params.push(changes.employeeId);
    fields.push(`employee_id = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'designation')) {
    params.push(changes.designation);
    fields.push(`designation = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'department')) {
    params.push(changes.department);
    fields.push(`department = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'bio')) {
    params.push(changes.bio);
    fields.push(`bio = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'avatar')) {
    params.push(changes.avatar);
    fields.push(`avatar = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'status')) {
    params.push(changes.status);
    fields.push(`status = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'contactInfo')) {
    params.push(JSON.stringify(changes.contactInfo || {}));
    fields.push(`contact_info = $${params.length}::jsonb`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'orgId')) {
    params.push(changes.orgId);
    fields.push(`org_id = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'roleIds')) {
    params.push(changes.roleIds || []);
    fields.push(`role_ids = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'location')) {
    params.push(changes.location);
    fields.push(`location = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'skills')) {
    params.push(changes.skills || []);
    fields.push(`skills = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'managerUserId')) {
    params.push(changes.managerUserId);
    fields.push(`manager_user_id = $${params.length}`);
  }

  if (fields.length === 0) {
    return findActiveUserById(userId, db);
  }

  params.push(userId);
  const result = await db.query(
    `UPDATE users
     SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length} AND deleted_at IS NULL
     RETURNING
      id,
      username,
      email,
      name,
      employee_id,
      designation,
      department,
      bio,
      avatar,
      status,
      contact_info,
      org_id,
      role_ids,
      location,
      skills,
      manager_user_id,
      created_at,
      updated_at,
      last_login_at`,
    params,
  );

  return mapUser(result.rows[0]);
}

async function listUsers(filters = {}, db = { query }) {
  const { clauses, params, isEmpty } = buildUserFilters(filters);

  if (isEmpty) {
    return {
      users: [],
      totalCount: 0,
    };
  }

  const countResult = await db.query(
    `SELECT COUNT(*)::INT AS count FROM users u WHERE ${clauses.join(' AND ')}`,
    params,
  );

  const listParams = [...params];
  let paginationClause = '';

  if (Number.isInteger(filters.limit)) {
    listParams.push(filters.limit);
    paginationClause += ` LIMIT $${listParams.length}`;
  }

  if (Number.isInteger(filters.offset)) {
    listParams.push(filters.offset);
    paginationClause += ` OFFSET $${listParams.length}`;
  }

  const result = await db.query(
    `${USER_FIELDS}
     FROM users u
     WHERE ${clauses.join(' AND ')}
     ORDER BY COALESCE(u.name, u.username) ASC, u.created_at ASC, u.id ASC${paginationClause}`,
    listParams,
  );

  return {
    users: result.rows.map(mapUser),
    totalCount: countResult.rows[0].count,
  };
}

async function softDeleteUser(userId, db = { query }) {
  const result = await db.query(
    `UPDATE users
     SET status = 'deactivated',
         deleted_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );

  return result.rowCount > 0;
}

async function updateLastLoginAt(userId, db = { query }) {
  const result = await db.query(
    `UPDATE users
     SET last_login_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING
      id,
      username,
      email,
      name,
      employee_id,
      designation,
      department,
      bio,
      avatar,
      status,
      contact_info,
      org_id,
      role_ids,
      location,
      skills,
      manager_user_id,
      created_at,
      updated_at,
      last_login_at`,
    [userId],
  );

  return mapUser(result.rows[0]);
}

module.exports = {
  mapUser,
  findActiveUserById,
  findUserWithPasswordByEmail,
  countActiveUsers,
  emailExists,
  usernameExists,
  employeeIdExists,
  createUser,
  updateUser,
  listUsers,
  softDeleteUser,
  updateLastLoginAt,
};
