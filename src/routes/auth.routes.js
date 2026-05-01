const express = require('express');
const authController = require('../modules/auth/auth.controller');
const authenticate = require('../middlewares/authenticate');

const router = express.Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/logout', authenticate, authController.logout);

module.exports = router;
