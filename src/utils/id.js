const crypto = require('crypto');

function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
}

function generateOpaqueToken(size = 48) {
  return crypto.randomBytes(size).toString('hex');
}

module.exports = {
  generateId,
  generateOpaqueToken,
};
