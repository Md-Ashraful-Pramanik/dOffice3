const { query } = require('../../db/pool');

const USER_FIELDS = `
  SELECT
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
    created_at,
    updated_at,
    last_login_at
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

async function findActiveUserById(userId, db = { query }) {
  const result = await db.query(
    `${USER_FIELDS}
     FROM users
     WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );

  return mapUser(result.rows[0]);
}

async function findUserWithPasswordByEmail(email, db = { query }) {
  const result = await db.query(
    `${USER_FIELDS},
      password_hash
     FROM users
     WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL`,
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

async function emailExists(email, db = { query }) {
  const result = await db.query(
    `SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL LIMIT 1`,
    [email],
  );

  return result.rowCount > 0;
}

async function usernameExists(username, db = { query }) {
  const result = await db.query(
    `SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) AND deleted_at IS NULL LIMIT 1`,
    [username],
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
      status,
      contact_info,
      role_ids
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
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
      created_at,
      updated_at,
      last_login_at`,
    [
      user.id,
      user.username,
      user.email,
      user.passwordHash,
      user.name,
      user.status,
      JSON.stringify(user.contactInfo || {}),
      user.roleIds,
    ],
  );

  return mapUser(result.rows[0]);
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
  createUser,
  updateLastLoginAt,
};
