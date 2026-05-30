const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'chat.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    display_name TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT DEFAULT '访客',
    created_at INTEGER NOT NULL,
    last_active INTEGER NOT NULL,
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT DEFAULT 'sent',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(last_active DESC);
  CREATE INDEX IF NOT EXISTS idx_tokens_user ON auth_tokens(user_id);

  CREATE TABLE IF NOT EXISTS email_codes (
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_email_codes ON email_codes(email, expires_at DESC);

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_user_id TEXT,
    key_hash TEXT UNIQUE NOT NULL,
    key_prefix TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at INTEGER,
    FOREIGN KEY (owner_user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

  CREATE TABLE IF NOT EXISTS api_sessions (
    session_id TEXT PRIMARY KEY,
    api_key_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
  );

  CREATE INDEX IF NOT EXISTS idx_api_sessions_key ON api_sessions(api_key_id);
`);

const migrations = [
  'ALTER TABLE sessions ADD COLUMN user_id TEXT',
  'ALTER TABLE sessions ADD COLUMN title TEXT DEFAULT \'新对话\'',
  'ALTER TABLE api_keys ADD COLUMN owner_user_id TEXT'
];

migrations.forEach(sql => {
  try { db.exec(sql); } catch (_) {}
});

try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)');
} catch (_) {}

module.exports = {
  db,

  createUser(id, email, username, passwordHash, salt, displayName) {
    const now = Date.now();
    db.prepare(
      'INSERT INTO users (id, email, username, password_hash, salt, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, email, username, passwordHash, salt, displayName || username, now);
    return this.getUserById(id);
  },

  getUserById(id) {
    return db.prepare('SELECT id, email, username, display_name, created_at FROM users WHERE id = ?').get(id);
  },

  getUserByEmail(email) {
    return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  },

  getUserByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  },

  createToken(token, userId, expiresAt) {
    db.prepare('INSERT INTO auth_tokens (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  },

  getTokenUser(token) {
    const row = db.prepare(
      'SELECT t.user_id, t.expires_at, u.id, u.email, u.username, u.display_name FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ?'
    ).get(token);
    if (!row || row.expires_at < Date.now()) return null;
    return { id: row.id, email: row.email, username: row.username, display_name: row.display_name };
  },

  deleteToken(token) {
    db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(token);
  },

  createSession(id, userId, name = '访客', title = '新对话') {
    const now = Date.now();
    db.prepare(
      'INSERT INTO sessions (id, user_id, name, title, created_at, last_active) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, userId, name, title, now, now);
    return this.getSession(id);
  },

  getSession(id) {
    return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  },

  getUserSessions(userId) {
    return db.prepare(`
      SELECT s.*,
        (SELECT content FROM messages m WHERE m.session_id = s.id ORDER BY m.created_at DESC LIMIT 1) as last_message
      FROM sessions s
      WHERE s.user_id = ?
      ORDER BY s.last_active DESC
    `).all(userId);
  },

  getUserSession(userId, sessionId) {
    return db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
  },

  updateSessionActivity(id) {
    db.prepare('UPDATE sessions SET last_active = ? WHERE id = ?').run(Date.now(), id);
  },

  updateSessionName(id, name) {
    db.prepare('UPDATE sessions SET name = ? WHERE id = ?').run(name, id);
  },

  updateSessionUserId(id, userId) {
    db.prepare('UPDATE sessions SET user_id = ? WHERE id = ?').run(userId, id);
  },

  updateSessionTitle(id, title) {
    db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, id);
  },

  getAllSessions() {
    return db.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id AND m.role = 'user' AND m.status = 'pending') as pending_count,
        (SELECT content FROM messages m WHERE m.session_id = s.id ORDER BY m.created_at DESC LIMIT 1) as last_message
      FROM sessions s
      ORDER BY s.last_active DESC
    `).all();
  },

  addMessage(id, sessionId, role, content, status = 'sent') {
    const now = Date.now();
    db.prepare(
      'INSERT INTO messages (id, session_id, role, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, sessionId, role, content, status, now);
    this.updateSessionActivity(sessionId);

    if (role === 'user') {
      const title = content.trim().substring(0, 30) + (content.length > 30 ? '...' : '');
      const session = this.getSession(sessionId);
      if (session && (!session.title || session.title === '新对话')) {
        this.updateSessionTitle(sessionId, title);
      }
    }

    return this.getMessage(id);
  },

  getMessage(id) {
    return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  },

  getMessages(sessionId) {
    return db.prepare(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC'
    ).all(sessionId);
  },

  updateMessageStatus(id, status) {
    db.prepare('UPDATE messages SET status = ? WHERE id = ?').run(status, id);
    return this.getMessage(id);
  },

  getPendingCount() {
    return db.prepare(
      "SELECT COUNT(*) as count FROM messages WHERE role = 'user' AND status = 'pending'"
    ).get().count;
  },

  deleteSession(id) {
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  },

  renameUserSession(userId, sessionId, title) {
    const result = db.prepare(
      'UPDATE sessions SET title = ? WHERE id = ? AND user_id = ?'
    ).run(title, sessionId, userId);
    return result.changes > 0;
  },

  deleteUserSession(userId, sessionId) {
    const owned = this.getUserSession(userId, sessionId);
    if (!owned) return false;
    this.deleteSession(sessionId);
    return true;
  },

  clearSessionMessages(id) {
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(id);
    this.updateSessionTitle(id, '新对话');
  },

  saveEmailCode(email, code, expiresAt) {
    const now = Date.now();
    db.prepare('DELETE FROM email_codes WHERE email = ?').run(email);
    db.prepare('INSERT INTO email_codes (email, code, expires_at, created_at) VALUES (?, ?, ?, ?)').run(email, code, expiresAt, now);
  },

  getLatestEmailCode(email) {
    return db.prepare('SELECT * FROM email_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1').get(email);
  },

  deleteEmailCodes(email) {
    db.prepare('DELETE FROM email_codes WHERE email = ?').run(email);
  },

  getRecentCodeCount(email, sinceMs) {
    return db.prepare('SELECT COUNT(*) as count FROM email_codes WHERE email = ? AND created_at > ?').get(email, sinceMs).count;
  },

  createApiKey(id, name, keyHash, keyPrefix, ownerUserId = null) {
    const now = Date.now();
    db.prepare(
      'INSERT INTO api_keys (id, name, owner_user_id, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, name, ownerUserId, keyHash, keyPrefix, now);
    return this.getApiKeyById(id);
  },

  getApiKeyById(id) {
    return db.prepare(
      'SELECT id, name, owner_user_id, key_prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE id = ?'
    ).get(id);
  },

  getApiKeys() {
    return db.prepare(
      'SELECT id, name, owner_user_id, key_prefix, created_at, last_used_at, revoked_at FROM api_keys ORDER BY created_at DESC'
    ).all();
  },

  getApiKeysByUser(userId) {
    return db.prepare(
      'SELECT id, name, owner_user_id, key_prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE owner_user_id = ? ORDER BY created_at DESC'
    ).all(userId);
  },

  getApiKeyByHash(hash) {
    return db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL').get(hash);
  },

  touchApiKeyUsage(id) {
    db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(Date.now(), id);
  },

  revokeApiKey(id) {
    const result = db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(Date.now(), id);
    return result.changes > 0;
  },

  revokeApiKeyByUser(id, userId) {
    const result = db.prepare(
      'UPDATE api_keys SET revoked_at = ? WHERE id = ? AND owner_user_id = ? AND revoked_at IS NULL'
    ).run(Date.now(), id, userId);
    return result.changes > 0;
  },

  bindApiSession(sessionId, apiKeyId) {
    db.prepare(
      'INSERT OR REPLACE INTO api_sessions (session_id, api_key_id, created_at) VALUES (?, ?, ?)'
    ).run(sessionId, apiKeyId, Date.now());
  },

  isApiSessionOwnedByKey(sessionId, apiKeyId) {
    const row = db.prepare('SELECT session_id FROM api_sessions WHERE session_id = ? AND api_key_id = ?').get(sessionId, apiKeyId);
    return !!row;
  }
};
