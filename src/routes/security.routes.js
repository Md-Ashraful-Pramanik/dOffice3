const express = require('express');
const authenticate = require('../middlewares/authenticate');
const securityController = require('../modules/security/security.controller');

const router = express.Router();

router.post('/user/keys', authenticate, securityController.uploadPreKeyBundle);
router.get('/users/:userId/keys', authenticate, securityController.getUserPreKeyBundle);
router.get('/user/devices', authenticate, securityController.listCurrentUserDevices);
router.delete('/user/devices/:deviceId', authenticate, securityController.removeCurrentUserDevice);
router.get('/users/:userId/keys/fingerprint', authenticate, securityController.getUserKeyFingerprint);

module.exports = router;
