const crypto = require('crypto');

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

function createSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function verifyPassword(password, hash, salt) {
  return hashPassword(password, salt) === hash;
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

function createApiKey() {
  return `cat_${crypto.randomBytes(24).toString('hex')}`;
}

module.exports = { hashPassword, createSalt, verifyPassword, createToken, hashApiKey, createApiKey };
