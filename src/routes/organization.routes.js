const express = require('express');
const authenticate = require('../middlewares/authenticate');
const organizationController = require('../modules/organizations/organization.controller');

const router = express.Router();

router.get('/organizations', authenticate, organizationController.listOrganizations);
router.get('/organizations/tree', authenticate, organizationController.getOrganizationTree);
router.get('/organizations/:orgId', authenticate, organizationController.getOrganization);
router.post('/organizations', authenticate, organizationController.createOrganization);
router.post('/organizations/merge', authenticate, organizationController.mergeOrganizations);
router.post('/organizations/:orgId/children', authenticate, organizationController.createChildOrganization);
router.put('/organizations/:orgId', authenticate, organizationController.updateOrganization);
router.post('/organizations/:orgId/move', authenticate, organizationController.moveOrganization);
router.post('/organizations/:orgId/clone', authenticate, organizationController.cloneOrganization);
router.post('/organizations/:orgId/archive', authenticate, organizationController.archiveOrganization);
router.post('/organizations/:orgId/restore', authenticate, organizationController.restoreOrganization);
router.delete('/organizations/:orgId', authenticate, organizationController.deleteOrganization);

module.exports = router;
