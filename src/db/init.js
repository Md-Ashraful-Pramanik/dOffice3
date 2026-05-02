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
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS location TEXT;
  `);

  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS skills TEXT[] NOT NULL DEFAULT '{}';
  `);

  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS manager_user_id TEXT REFERENCES users(id);
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
    CREATE UNIQUE INDEX IF NOT EXISTS users_employee_id_lower_unique_idx
    ON users ((LOWER(employee_id)))
    WHERE deleted_at IS NULL AND employee_id IS NOT NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS users_status_idx
    ON users (status)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS users_manager_user_id_idx
    ON users (manager_user_id)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS users_location_idx
    ON users (location)
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

  // Roles
  await query(`
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'custom',
      org_id TEXT REFERENCES organizations(id),
      inherits_from TEXT REFERENCES roles(id),
      permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by_user_id TEXT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS roles_name_org_unique_idx
    ON roles (LOWER(name), COALESCE(org_id, ''))
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS roles_org_id_idx
    ON roles (org_id)
    WHERE deleted_at IS NULL;
  `);

  // User-role assignments
  await query(`
    CREATE TABLE IF NOT EXISTS user_role_assignments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      role_id TEXT NOT NULL REFERENCES roles(id),
      org_id TEXT NOT NULL REFERENCES organizations(id),
      assigned_by_user_id TEXT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS user_role_assignments_unique_active_idx
    ON user_role_assignments (user_id, role_id, org_id)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS user_role_assignments_user_id_idx
    ON user_role_assignments (user_id)
    WHERE deleted_at IS NULL;
  `);

  // Teams
  await query(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'static',
      org_id TEXT NOT NULL REFERENCES organizations(id),
      permission_overrides JSONB NOT NULL DEFAULT '[]'::jsonb,
      dynamic_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by_user_id TEXT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS teams_name_org_unique_idx
    ON teams (LOWER(name), org_id)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS teams_org_id_idx
    ON teams (org_id)
    WHERE deleted_at IS NULL;
  `);

  // Team members
  await query(`
    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      added_by_user_id TEXT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS team_members_unique_active_idx
    ON team_members (team_id, user_id)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS team_members_team_id_idx
    ON team_members (team_id)
    WHERE deleted_at IS NULL;
  `);

  // Delegations
  await query(`
    CREATE TABLE IF NOT EXISTS delegations (
      id TEXT PRIMARY KEY,
      delegator_user_id TEXT NOT NULL REFERENCES users(id),
      delegate_user_id TEXT NOT NULL REFERENCES users(id),
      start_date TIMESTAMPTZ NOT NULL,
      end_date TIMESTAMPTZ NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      scope JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS delegations_delegator_user_id_idx
    ON delegations (delegator_user_id)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS delegations_delegate_user_id_idx
    ON delegations (delegate_user_id)
    WHERE deleted_at IS NULL;
  `);

  // Channel categories
  await query(`
    CREATE TABLE IF NOT EXISTS channel_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      position INTEGER NOT NULL DEFAULT 0,
      created_by_user_id TEXT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS channel_categories_name_org_unique_idx
    ON channel_categories (LOWER(name), org_id)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS channel_categories_org_id_idx
    ON channel_categories (org_id)
    WHERE deleted_at IS NULL;
  `);

  // Channels
  await query(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'public',
      description TEXT,
      topic TEXT,
      category_id TEXT REFERENCES channel_categories(id),
      org_id TEXT NOT NULL REFERENCES organizations(id),
      e2ee BOOLEAN NOT NULL DEFAULT FALSE,
      slow_mode_interval INTEGER NOT NULL DEFAULT 0,
      created_by_user_id TEXT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS channels_name_org_unique_idx
    ON channels (LOWER(name), org_id)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS channels_org_id_idx
    ON channels (org_id)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS channels_category_id_idx
    ON channels (category_id)
    WHERE deleted_at IS NULL;
  `);

  // Channel members
  await query(`
    CREATE TABLE IF NOT EXISTS channel_members (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL DEFAULT 'member',
      added_by_user_id TEXT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS channel_members_unique_active_idx
    ON channel_members (channel_id, user_id)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS channel_members_channel_id_idx
    ON channel_members (channel_id)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS channel_members_user_id_idx
    ON channel_members (user_id)
    WHERE deleted_at IS NULL;
  `);
}

module.exports = {
  initializeDatabase,
};
