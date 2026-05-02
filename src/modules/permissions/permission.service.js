const { AppError } = require('../../utils/errors');
const auditService = require('../audits/audit.service');
const roleRepository = require('../roles/role.repository');
const userRepository = require('../users/user.repository');
const { query } = require('../../db/pool');

const PERMISSION_CATALOG = {
  organizations: ['create', 'read', 'update', 'delete', 'archive', 'move', 'merge', 'clone'],
  users: ['create', 'read', 'update', 'delete', 'deactivate', 'assign_role'],
  messaging: ['create_channel', 'delete_channel', 'send_message', 'delete_message', 'pin_message', 'moderate'],
  tasks: ['create_project', 'delete_project', 'create_task', 'assign_task', 'delete_task', 'manage_sprint'],
};

const SUPER_ADMIN_ROLES = new Set(['super_admin', 'role_super_admin']);
const ORG_ADMIN_ROLES = new Set(['org_admin', 'role_org_admin']);

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function isSuperAdmin(user) {
  return (user.roleIds || []).some((r) => SUPER_ADMIN_ROLES.has(normalizeRole(r)));
}

function isOrgAdmin(user) {
  return isSuperAdmin(user)
    || (user.roleIds || []).some((r) => ORG_ADMIN_ROLES.has(normalizeRole(r)));
}

async function listPermissions(actingUser, req) {
  await auditService.logAction({
    req,
    userId: actingUser.id,
    action: 'permissions.listed',
    entityType: 'system',
    entityId: null,
    statusCode: 200,
  });

  return { permissions: PERMISSION_CATALOG };
}

async function getEffectivePermissions(userId, queryParams, actingUser, req) {
  const notFound = () => new AppError(404, 'Resource not found.');
  const forbidden = () => new AppError(403, 'You do not have permission to perform this action.');

  if (actingUser.id !== userId && !isOrgAdmin(actingUser)) throw forbidden();

  const targetUser = await userRepository.findActiveUserById(userId);
  if (!targetUser) throw notFound();

  const orgId = queryParams.orgId || targetUser.orgId;
  const computed = [];

  // Gather role assignments for the user (optionally scoped to orgId)
  let roleAssignments;
  if (orgId) {
    const result = await query(
      'SELECT role_id FROM user_role_assignments WHERE user_id = $1 AND org_id = $2 AND deleted_at IS NULL',
      [userId, orgId],
    );
    roleAssignments = result.rows.map((r) => r.role_id);
  } else {
    roleAssignments = await roleRepository.getUserRoleIds(userId);
  }

  // Load permissions from each role
  for (const roleId of roleAssignments) {
    const role = await roleRepository.findRoleById(roleId);
    if (!role) continue;
    for (const perm of (role.permissions || [])) {
      computed.push({
        module: perm.module,
        action: perm.action,
        allow: perm.allow,
        source: `role:${roleId}`,
      });
    }
  }

  // Load team-level permission overrides for the user in the org
  if (orgId) {
    const teamMemberRows = await query(
      `SELECT tm.team_id FROM team_members tm
       JOIN teams t ON t.id = tm.team_id AND t.org_id = $2 AND t.deleted_at IS NULL
       WHERE tm.user_id = $1 AND tm.deleted_at IS NULL`,
      [userId, orgId],
    );

    for (const row of teamMemberRows.rows) {
      const teamRow = await query(
        'SELECT permission_overrides FROM teams WHERE id = $1 AND deleted_at IS NULL',
        [row.team_id],
      );
      if (!teamRow.rows[0]) continue;
      const overrides = teamRow.rows[0].permission_overrides || [];
      for (const perm of overrides) {
        computed.push({
          module: perm.module,
          action: perm.action,
          allow: perm.allow,
          source: `team:${row.team_id}`,
        });
      }
    }
  }

  await auditService.logAction({
    req,
    userId: actingUser.id,
    action: 'permissions.effective_viewed',
    entityType: 'user',
    entityId: userId,
    statusCode: 200,
    metadata: { orgId: orgId || null },
  });

  return {
    effectivePermissions: {
      userId,
      orgId: orgId || null,
      computed,
    },
  };
}

module.exports = {
  listPermissions,
  getEffectivePermissions,
};
