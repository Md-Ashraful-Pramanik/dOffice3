const express = require('express');
const authenticate = require('../middlewares/authenticate');
const userController = require('../modules/users/user.controller');

const router = express.Router();

router.get('/user', authenticate, userController.getCurrentUser);

module.exports = router;
