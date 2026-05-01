const { query } = require('./pool');

async function initializeDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      employee_id TEXT,
      designation TEXT,
      department TEXT,
      bio TEXT,
      avatar TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      contact_info JSONB NOT NULL DEFAULT '{}'::jsonb,
      org_id TEXT,
      role_ids TEXT[] NOT NULL DEFAULT '{}',
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique_idx
    ON users ((LOWER(email)))
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique_idx
    ON users ((LOWER(username)))
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      refresh_token TEXT NOT NULL UNIQUE,
      user_agent TEXT,
      ip TEXT,
      last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx
    ON sessions (user_id);
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS audits (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status_code INTEGER,
      ip TEXT,
      user_agent TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS audits_user_id_created_at_idx
    ON audits (user_id, created_at DESC);
  `);
}

module.exports = {
  initializeDatabase,
};
