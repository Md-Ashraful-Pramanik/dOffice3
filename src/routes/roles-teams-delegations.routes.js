const express = require('express');
const authenticate = require('../middlewares/authenticate');
const roleController = require('../modules/roles/role.controller');
const teamController = require('../modules/teams/team.controller');
const delegationController = require('../modules/delegations/delegation.controller');
const permissionController = require('../modules/permissions/permission.controller');

const router = express.Router();

// Roles
router.get('/organizations/:orgId/roles', authenticate, roleController.listRoles);
router.get('/organizations/:orgId/roles/:roleId', authenticate, roleController.getRole);
router.post('/organizations/:orgId/roles', authenticate, roleController.createRole);
router.put('/organizations/:orgId/roles/:roleId', authenticate, roleController.updateRole);
router.delete('/organizations/:orgId/roles/:roleId', authenticate, roleController.deleteRole);

// User role assignments
router.post('/users/:userId/roles', authenticate, roleController.assignRoleToUser);
router.delete('/users/:userId/roles/:roleId', authenticate, roleController.removeRoleFromUser);

// Permissions
router.get('/permissions', authenticate, permissionController.listPermissions);
router.get('/users/:userId/permissions', authenticate, permissionController.getEffectivePermissions);

// Teams
router.get('/organizations/:orgId/teams', authenticate, teamController.listTeams);
router.get('/organizations/:orgId/teams/:teamId', authenticate, teamController.getTeam);
router.post('/organizations/:orgId/teams', authenticate, teamController.createTeam);
router.put('/organizations/:orgId/teams/:teamId', authenticate, teamController.updateTeam);
router.delete('/organizations/:orgId/teams/:teamId', authenticate, teamController.deleteTeam);
router.post('/organizations/:orgId/teams/:teamId/members', authenticate, teamController.addMembers);
router.delete('/organizations/:orgId/teams/:teamId/members/:userId', authenticate, teamController.removeMember);

// Delegations
router.get('/users/:userId/delegations', authenticate, delegationController.listDelegations);
router.post('/users/:userId/delegations', authenticate, delegationController.createDelegation);
router.delete('/users/:userId/delegations/:delegationId', authenticate, delegationController.revokeDelegation);

module.exports = router;
