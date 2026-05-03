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

  // Conversations
  await query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT,
      created_by_user_id TEXT REFERENCES users(id),
      e2ee BOOLEAN NOT NULL DEFAULT FALSE,
      disappearing_timer INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS conversations_type_idx
    ON conversations (type)
    WHERE deleted_at IS NULL;
  `);

  // Conversation participants
  await query(`
    CREATE TABLE IF NOT EXISTS conversation_participants (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS conversation_participants_unique_active_idx
    ON conversation_participants (conversation_id, user_id)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS conversation_participants_user_idx
    ON conversation_participants (user_id)
    WHERE deleted_at IS NULL;
  `);

  // Messages
  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'plaintext',
      sender_id TEXT NOT NULL REFERENCES users(id),
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      thread_parent_id TEXT REFERENCES messages(id),
      reply_to TEXT REFERENCES messages(id),
      attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
      mentions TEXT[] NOT NULL DEFAULT '{}',
      encryption JSONB NOT NULL DEFAULT '{}'::jsonb,
      pinned BOOLEAN NOT NULL DEFAULT FALSE,
      pinned_at TIMESTAMPTZ,
      pinned_by_user_id TEXT REFERENCES users(id),
      edited BOOLEAN NOT NULL DEFAULT FALSE,
      edited_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS messages_target_idx
    ON messages (target_type, target_id, created_at DESC)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS messages_thread_parent_idx
    ON messages (thread_parent_id, created_at ASC)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS messages_sender_idx
    ON messages (sender_id, created_at DESC)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS messages_pinned_idx
    ON messages (target_id, pinned, created_at DESC)
    WHERE deleted_at IS NULL;
  `);

  // Message edits
  await query(`
    CREATE TABLE IF NOT EXISTS message_edits (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id),
      body TEXT NOT NULL,
      edited_by_user_id TEXT NOT NULL REFERENCES users(id),
      edited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS message_edits_message_id_idx
    ON message_edits (message_id, edited_at ASC);
  `);

  // Message reactions
  await query(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS message_reactions_unique_active_idx
    ON message_reactions (message_id, user_id, emoji)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS message_reactions_message_idx
    ON message_reactions (message_id)
    WHERE deleted_at IS NULL;
  `);

  // Message bookmarks
  await query(`
    CREATE TABLE IF NOT EXISTS message_bookmarks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      message_id TEXT NOT NULL REFERENCES messages(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS message_bookmarks_unique_active_idx
    ON message_bookmarks (user_id, message_id)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS message_bookmarks_user_idx
    ON message_bookmarks (user_id, created_at DESC)
    WHERE deleted_at IS NULL;
  `);

  // Polls
  await query(`
    CREATE TABLE IF NOT EXISTS polls (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id),
      message_id TEXT REFERENCES messages(id),
      question TEXT NOT NULL,
      multiple_choice BOOLEAN NOT NULL DEFAULT FALSE,
      anonymous BOOLEAN NOT NULL DEFAULT FALSE,
      expires_at TIMESTAMPTZ,
      created_by_user_id TEXT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS polls_channel_idx
    ON polls (channel_id, created_at DESC)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS poll_options (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL REFERENCES polls(id),
      option_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS poll_options_unique_idx
    ON poll_options (poll_id, option_index)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS poll_votes (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL REFERENCES polls(id),
      option_index INTEGER NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS poll_votes_unique_active_idx
    ON poll_votes (poll_id, user_id, option_index)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS poll_votes_poll_idx
    ON poll_votes (poll_id)
    WHERE deleted_at IS NULL;
  `);

  // Message moderation reports
  await query(`
    CREATE TABLE IF NOT EXISTS message_reports (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id),
      org_id TEXT NOT NULL REFERENCES organizations(id),
      reported_by_user_id TEXT NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL,
      details TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      resolution_action TEXT,
      resolution_notes TEXT,
      resolved_by_user_id TEXT REFERENCES users(id),
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS message_reports_org_status_created_idx
    ON message_reports (org_id, status, created_at DESC)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS message_reports_message_id_idx
    ON message_reports (message_id)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS message_reports_reported_by_idx
    ON message_reports (reported_by_user_id, created_at DESC)
    WHERE deleted_at IS NULL;
  `);

  // File storage
  await query(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size BIGINT NOT NULL,
      content BYTEA NOT NULL,
      uploaded_by_user_id TEXT NOT NULL REFERENCES users(id),
      org_id TEXT NOT NULL REFERENCES organizations(id),
      context TEXT NOT NULL,
      context_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS files_org_created_idx
    ON files (org_id, created_at DESC)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS files_uploaded_by_idx
    ON files (uploaded_by_user_id, created_at DESC)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS files_context_idx
    ON files (context, context_id)
    WHERE deleted_at IS NULL;
  `);

  // E2EE devices and keys
  await query(`
    CREATE TABLE IF NOT EXISTS user_devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      session_id TEXT REFERENCES sessions(id),
      name TEXT NOT NULL,
      identity_key_fingerprint TEXT,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS user_devices_session_unique_active_idx
    ON user_devices (session_id)
    WHERE deleted_at IS NULL AND session_id IS NOT NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS user_devices_user_last_seen_idx
    ON user_devices (user_id, last_seen_at DESC)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS user_key_bundles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      device_id TEXT NOT NULL REFERENCES user_devices(id),
      identity_key TEXT NOT NULL,
      signed_pre_key JSONB NOT NULL,
      one_time_pre_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS user_key_bundles_user_device_unique_active_idx
    ON user_key_bundles (user_id, device_id)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS user_key_bundles_user_created_idx
    ON user_key_bundles (user_id, created_at DESC)
    WHERE deleted_at IS NULL;
  `);

  // Notifications
  await query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      link TEXT,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS notifications_user_created_idx
    ON notifications (user_id, created_at DESC)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS notifications_user_read_idx
    ON notifications (user_id, read_at)
    WHERE deleted_at IS NULL;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      preferences JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  // Realtime: column additions
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;`);
  await query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;`);
  await query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_msg_id TEXT;`);

  await query(`
    CREATE INDEX IF NOT EXISTS messages_expires_at_idx
    ON messages (expires_at)
    WHERE deleted_at IS NULL AND expires_at IS NOT NULL;
  `);

  // Realtime: user presence
  await query(`
    CREATE TABLE IF NOT EXISTS user_presence (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'online',
      custom_text TEXT,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  // Realtime: typing states
  await query(`
    CREATE TABLE IF NOT EXISTS typing_states (
      user_id TEXT NOT NULL REFERENCES users(id),
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      is_typing BOOLEAN NOT NULL DEFAULT FALSE,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ,
      PRIMARY KEY (user_id, target_type, target_id)
    );
  `);

  // Realtime: read markers
  await query(`
    CREATE TABLE IF NOT EXISTS message_reads (
      user_id TEXT NOT NULL REFERENCES users(id),
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      last_read_message_id TEXT NOT NULL REFERENCES messages(id),
      read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ,
      PRIMARY KEY (user_id, target_type, target_id)
    );
  `);

  // Realtime: voice channel participants
  await query(`
    CREATE TABLE IF NOT EXISTS voice_channel_participants (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      left_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS voice_participants_channel_idx
    ON voice_channel_participants (channel_id)
    WHERE deleted_at IS NULL;
  `);

  // Realtime: WebRTC signals
  await query(`
    CREATE TABLE IF NOT EXISTS rtc_signals (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL,
      from_user_id TEXT NOT NULL REFERENCES users(id),
      target_user_id TEXT NOT NULL REFERENCES users(id),
      signal_type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS rtc_signals_call_idx
    ON rtc_signals (call_id, created_at DESC);
  `);
}

module.exports = {
  initializeDatabase,
};
