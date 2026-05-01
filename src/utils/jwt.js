const jwt = require('jsonwebtoken');
const config = require('../config/env');

function signAccessToken(payload) {
  return jwt.sign(payload, config.auth.jwtSecret, {
    expiresIn: config.auth.jwtExpiresIn,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.auth.jwtSecret);
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
};
