const express = require('express');
const authenticate = require('../middlewares/authenticate');
const userController = require('../modules/users/user.controller');

const router = express.Router();

router.get('/user', authenticate, userController.getCurrentUser);
router.put('/user', authenticate, userController.updateCurrentUser);
router.get('/organizations/:orgId/users', authenticate, userController.listOrganizationUsers);
router.get('/users/:userId', authenticate, userController.getUserProfile);
router.post('/organizations/:orgId/users', authenticate, userController.createOrganizationUser);
router.put('/users/:userId', authenticate, userController.updateUserByAdmin);
router.post('/users/:userId/deactivate', authenticate, userController.deactivateUser);
router.post('/users/:userId/reactivate', authenticate, userController.reactivateUser);
router.delete('/users/:userId', authenticate, userController.deleteUser);
router.get('/organizations/:orgId/directory', authenticate, userController.getDirectory);
router.get('/organizations/:orgId/orgchart', authenticate, userController.getOrgChart);
router.get('/user/sessions', authenticate, userController.listCurrentUserSessions);
router.delete('/user/sessions/:sessionId', authenticate, userController.revokeCurrentUserSession);
router.post('/user/sessions/revoke-others', authenticate, userController.revokeOtherSessions);

module.exports = router;
