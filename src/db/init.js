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
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'root',
      status TEXT NOT NULL DEFAULT 'active',
      logo TEXT,
      parent_id TEXT REFERENCES organizations(id),
      depth INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      merged_into_org_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS organizations_code_lower_unique_idx
    ON organizations ((LOWER(code)))
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS organizations_parent_id_idx
    ON organizations (parent_id)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS organizations_status_idx
    ON organizations (status)
    WHERE deleted_at IS NULL;
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
    CREATE INDEX IF NOT EXISTS users_org_id_idx
    ON users (org_id)
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

  await query(`
    CREATE TABLE IF NOT EXISTS organization_relationships (
      id TEXT PRIMARY KEY,
      source_org_id TEXT NOT NULL REFERENCES organizations(id),
      target_org_id TEXT NOT NULL REFERENCES organizations(id),
      type TEXT NOT NULL,
      description TEXT,
      shared_modules TEXT[] NOT NULL DEFAULT '{}',
      created_by_user_id TEXT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ,
      CONSTRAINT organization_relationships_distinct_orgs_chk CHECK (source_org_id <> target_org_id)
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS organization_relationships_source_org_idx
    ON organization_relationships (source_org_id)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS organization_relationships_target_org_idx
    ON organization_relationships (target_org_id)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS organization_relationships_active_pair_type_unique_idx
    ON organization_relationships (
      LEAST(source_org_id, target_org_id),
      GREATEST(source_org_id, target_org_id),
      LOWER(type)
    )
    WHERE deleted_at IS NULL;
  `);
}

module.exports = {
  initializeDatabase,
};
