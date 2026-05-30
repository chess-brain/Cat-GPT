const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const store = require('./db');
const { hashPassword, createSalt, verifyPassword, createToken, hashApiKey, createApiKey } = require('./auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin114514';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'bing520@@HUA';
const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const adminSockets = new Set();
const sessionSockets = new Map();
const adminTokens = new Map();

function normalizeMessageText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(input) {
  return decodeHtmlEntities(input.replace(/<[^>]+>/g, '')).trim();
}

function extractDuckDuckGoResults(html) {
  const blocks = html.match(/<div class="result__body">[\s\S]*?<\/div>\s*<\/div>/g) || [];
  const results = [];
  for (const block of blocks) {
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    let url = titleMatch[1];
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try { url = decodeURIComponent(uddg[1]); } catch (_) {}
    }
    results.push({
      title: stripHtml(titleMatch[2]),
      url,
      snippet: snippetMatch ? stripHtml(snippetMatch[1]) : ''
    });
    if (results.length >= 8) break;
  }
  return results;
}

function buildAssistantReplyContent(baseText, blocks = {}) {
  const base = normalizeMessageText(baseText);
  const deepThinkText = normalizeMessageText(blocks.deepThinkText || '');
  const webSearchText = normalizeMessageText(blocks.webSearchText || '');
  const useDeepThink = !!blocks.useDeepThink;
  const useWebSearch = !!blocks.useWebSearch;

  const chunks = [base];
  if (useDeepThink) {
    chunks.push(`[DEEP_THINK]\n${deepThinkText || '（已启用深度思考，但未填写具体内容）'}\n[/DEEP_THINK]`);
  }
  if (useWebSearch) {
    chunks.push(`[WEB_SEARCH]\n${webSearchText || '（已启用联网搜索，但未填写具体内容）'}\n[/WEB_SEARCH]`);
  }
  return chunks.filter(Boolean).join('\n\n');
}

function getUserFromToken(token) {
  if (!token) return null;
  return store.getTokenUser(token);
}

function isValidAdminToken(token) {
  if (!token) return false;
  const expires = adminTokens.get(token);
  if (!expires || expires < Date.now()) {
    adminTokens.delete(token);
    return false;
  }
  return true;
}

function createAdminToken() {
  const token = createToken();
  adminTokens.set(token, Date.now() + TOKEN_TTL);
  return token;
}

function broadcastToAdmins(event, data) {
  adminSockets.forEach(socketId => {
    io.to(socketId).emit(event, data);
  });
}

function getSessionListPayload() {
  return {
    sessions: store.getAllSessions(),
    pendingCount: store.getPendingCount()
  };
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.display_name
  };
}

function getUserFromAuthHeader(req) {
  return getUserFromToken(req.headers.authorization?.replace('Bearer ', ''));
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!isValidAdminToken(token)) return res.status(401).json({ error: '未登录' });
  next();
}

function requireUser(req, res, next) {
  const user = getUserFromAuthHeader(req);
  if (!user) return res.status(401).json({ error: '未登录' });
  req.user = user;
  next();
}

function getApiKeyFromRequest(req) {
  const header = req.headers.authorization || '';
  const direct = req.headers['x-api-key'];
  const raw = direct || (header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!raw) return null;
  return store.getApiKeyByHash(hashApiKey(raw.trim()));
}

function requireApiKey(req, res, next) {
  const apiKey = getApiKeyFromRequest(req);
  if (!apiKey) return res.status(401).json({ error: '无效 API Key' });
  req.apiKey = apiKey;
  store.touchApiKeyUsage(apiKey.id);
  next();
}

app.post('/api/register', (req, res) => {
  const { email, username, password, displayName } = req.body;
  if (!email?.trim() || !username?.trim() || !password) {
    return res.status(400).json({ error: '请填写所有必填项' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少 6 位' });
  }
  if (store.getUserByEmail(email.trim())) {
    return res.status(400).json({ error: '该邮箱已被注册' });
  }
  if (store.getUserByUsername(username.trim())) {
    return res.status(400).json({ error: '该用户名已被占用' });
  }

  const salt = createSalt();
  const passwordHash = hashPassword(password, salt);
  const userId = uuidv4();
  const user = store.createUser(userId, email.trim(), username.trim(), passwordHash, salt, displayName?.trim());

  const token = createToken();
  store.createToken(token, userId, Date.now() + TOKEN_TTL);

  res.json({ role: 'user', token, user: sanitizeUser(user) });
});

app.post('/api/login', (req, res) => {
  const { account, password } = req.body;
  if (!account?.trim() || !password) {
    return res.status(400).json({ error: '请输入账号和密码' });
  }

  const accountTrim = account.trim();

  if (accountTrim === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const adminToken = createAdminToken();
    return res.json({
      role: 'admin',
      adminToken,
      user: { username: ADMIN_USERNAME, displayName: '管理员' }
    });
  }

  const user = store.getUserByEmail(accountTrim) || store.getUserByUsername(accountTrim);
  if (!user || !verifyPassword(password, user.password_hash, user.salt)) {
    return res.status(401).json({ error: '账号或密码错误' });
  }

  const token = createToken();
  store.createToken(token, user.id, Date.now() + TOKEN_TTL);

  res.json({ role: 'user', token, user: sanitizeUser(user) });
});

app.post('/api/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) store.deleteToken(token);
  const adminToken = req.headers['x-admin-token'];
  if (adminToken) adminTokens.delete(adminToken);
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  const user = getUserFromToken(req.headers.authorization?.replace('Bearer ', ''));
  if (!user) return res.status(401).json({ error: '未登录' });
  res.json({ user: sanitizeUser(user) });
});

app.get('/api/admin/me', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!isValidAdminToken(token)) return res.status(401).json({ error: '未登录' });
  res.json({ user: { username: ADMIN_USERNAME, displayName: '管理员' } });
});

app.get('/api/admin/search', requireAdmin, async (req, res) => {
  const query = normalizeMessageText(req.query.q);
  if (!query) return res.status(400).json({ error: 'q 不能为空' });
  if (query.length > 200) return res.status(400).json({ error: 'q 过长' });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (CatGPT Admin Search)' }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(502).json({ error: '搜索服务暂不可用' });
    }

    const html = await response.text();
    const results = extractDuckDuckGoResults(html);
    return res.json({ query, results });
  } catch (err) {
    clearTimeout(timeout);
    return res.status(502).json({
      error: '搜索失败',
      detail: err?.name === 'AbortError' ? '请求超时' : '网络异常'
    });
  }
});

app.get('/api/admin/api-keys', requireAdmin, (req, res) => {
  res.json({ keys: store.getApiKeys() });
});

app.post('/api/admin/api-keys', requireAdmin, (req, res) => {
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ error: '请输入密钥名称' });

  const apiKey = createApiKey();
  const keyId = uuidv4();
  const row = store.createApiKey(keyId, name, hashApiKey(apiKey), apiKey.slice(0, 10));
  res.json({ key: apiKey, item: row });
});

app.delete('/api/admin/api-keys/:id', requireAdmin, (req, res) => {
  const ok = store.revokeApiKey(req.params.id);
  if (!ok) return res.status(404).json({ error: 'API Key 不存在或已吊销' });
  res.json({ success: true });
});

app.get('/api/my/api-keys', requireUser, (req, res) => {
  res.json({ keys: store.getApiKeysByUser(req.user.id) });
});

app.post('/api/my/api-keys', requireUser, (req, res) => {
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ error: '请输入密钥名称' });

  const apiKey = createApiKey();
  const keyId = uuidv4();
  const row = store.createApiKey(
    keyId,
    name,
    hashApiKey(apiKey),
    apiKey.slice(0, 10),
    req.user.id
  );
  res.json({ key: apiKey, item: row });
});

app.delete('/api/my/api-keys/:id', requireUser, (req, res) => {
  const ok = store.revokeApiKeyByUser(req.params.id, req.user.id);
  if (!ok) return res.status(404).json({ error: 'API Key 不存在或无权限' });
  res.json({ success: true });
});

app.get('/api/chats', (req, res) => {
  const user = getUserFromAuthHeader(req);
  if (!user) return res.status(401).json({ error: '未登录' });
  res.json({ chats: store.getUserSessions(user.id) });
});

app.post('/api/chats', (req, res) => {
  const user = getUserFromAuthHeader(req);
  if (!user) return res.status(401).json({ error: '未登录' });

  const sessionId = uuidv4();
  const session = store.createSession(sessionId, user.id, user.display_name || user.username);
  res.json({ chat: session });
});

app.patch('/api/chats/:id', (req, res) => {
  const user = getUserFromAuthHeader(req);
  if (!user) return res.status(401).json({ error: '未登录' });

  const title = req.body.title?.trim();
  if (!title) return res.status(400).json({ error: '名称不能为空' });
  if (title.length > 60) return res.status(400).json({ error: '名称不能超过 60 个字符' });

  const updated = store.renameUserSession(user.id, req.params.id, title);
  if (!updated) return res.status(404).json({ error: '对话不存在' });

  res.json({ success: true, chat: store.getSession(req.params.id) });
});

app.delete('/api/chats/:id', (req, res) => {
  const user = getUserFromAuthHeader(req);
  if (!user) return res.status(401).json({ error: '未登录' });

  const deleted = store.deleteUserSession(user.id, req.params.id);
  if (!deleted) return res.status(404).json({ error: '对话不存在' });

  res.json({ success: true });
});

app.post('/api/v1/messages', requireApiKey, (req, res) => {
  const content = normalizeMessageText(req.body.content);
  if (!content) return res.status(400).json({ error: 'content 不能为空' });

  const options = {
    deepThink: !!req.body.deepThink,
    webSearch: !!req.body.webSearch
  };

  let sessionId = req.body.sessionId;
  if (sessionId) {
    const owned = store.isApiSessionOwnedByKey(sessionId, req.apiKey.id);
    if (!owned) return res.status(403).json({ error: '无权访问该 session' });
  } else {
    sessionId = uuidv4();
    store.createSession(sessionId, null, `API:${req.apiKey.name || 'client'}`, 'API 对话');
    store.bindApiSession(sessionId, req.apiKey.id);
  }

  const msg = store.addMessage(uuidv4(), sessionId, 'user', content, 'pending');

  broadcastToAdmins('admin:new_message', {
    sessionId,
    message: { ...msg, options },
    ...getSessionListPayload()
  });

  res.json({
    id: msg.id,
    sessionId,
    status: 'queued',
    createdAt: msg.created_at
  });
});

app.get('/api/v1/messages', requireApiKey, (req, res) => {
  const sessionId = req.query.sessionId;
  if (!sessionId) return res.status(400).json({ error: 'sessionId 必填' });

  const owned = store.isApiSessionOwnedByKey(sessionId, req.apiKey.id);
  if (!owned) return res.status(403).json({ error: '无权访问该 session' });

  const all = store.getMessages(sessionId);
  const pendingCount = store.getPendingUserMessageCountBySession(sessionId);
  const items = all.map(m => ({
    id: m.id,
    role: m.role,
    content: m.content,
    status: m.status,
    createdAt: m.created_at
  }));

  res.json({
    sessionId,
    pending: pendingCount > 0,
    pendingCount,
    messages: items
  });
});

io.on('connection', (socket) => {
  socket.on('user:join', ({ sessionId, token }) => {
    const user = getUserFromToken(token);
    if (!user) {
      socket.emit('user:auth_error', { error: '请先登录' });
      return;
    }

    let session = store.getSession(sessionId);
    if (!session) {
      session = store.createSession(sessionId, user.id, user.display_name || user.username);
    } else if (session.user_id && session.user_id !== user.id) {
      socket.emit('user:auth_error', { error: '无权访问此对话' });
      return;
    } else if (!session.user_id) {
      store.updateSessionUserId(sessionId, user.id);
      store.updateSessionName(sessionId, user.display_name || user.username);
      session = store.getSession(sessionId);
    }

    socket.sessionId = sessionId;
    socket.userId = user.id;
    socket.role = 'user';
    sessionSockets.set(sessionId, socket.id);
    socket.join(`session:${sessionId}`);

    const messages = store.getMessages(sessionId).filter(m => m.status !== 'pending' || m.role === 'user');
    socket.emit('user:history', {
      session,
      messages: messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at
      }))
    });

    broadcastToAdmins('admin:sessions', getSessionListPayload());
  });

  socket.on('user:message', ({ content, options }) => {
    const sessionId = socket.sessionId;
    const normalizedContent = normalizeMessageText(content);
    if (!sessionId || !normalizedContent) return;
    const normalizedOptions = {
      deepThink: !!options?.deepThink,
      webSearch: !!options?.webSearch
    };

    const msg = store.addMessage(uuidv4(), sessionId, 'user', normalizedContent, 'pending');

    socket.emit('user:message:sent', {
      id: msg.id,
      role: 'user',
      content: msg.content,
      createdAt: msg.created_at,
      options: normalizedOptions
    });

    socket.emit('user:chat_updated', {
      sessionId,
      title: store.getSession(sessionId).title
    });

    broadcastToAdmins('admin:new_message', {
      sessionId,
      message: {
        ...msg,
        options: normalizedOptions
      },
      ...getSessionListPayload()
    });
  });

  socket.on('admin:auth', ({ token }, callback) => {
    if (isValidAdminToken(token)) {
      socket.role = 'admin';
      socket.adminToken = token;
      adminSockets.add(socket.id);
      callback({ success: true });
      socket.emit('admin:sessions', getSessionListPayload());
    } else {
      callback({ success: false, error: '登录已过期，请重新登录' });
    }
  });

  socket.on('admin:get_session', ({ sessionId }) => {
    if (socket.role !== 'admin') return;
    const session = store.getSession(sessionId);
    const messages = store.getMessages(sessionId);
    socket.emit('admin:session_data', { session, messages });
  });

  socket.on('admin:typing', ({ sessionId, typing }) => {
    if (socket.role !== 'admin') return;
    io.to(`session:${sessionId}`).emit('user:typing', { typing });
  });

  socket.on('admin:reply', ({ sessionId, content, replyToId, simulateTyping = true, typingDelay = 1500, streamSpeed = 25, useDeepThink = false, deepThinkText = '', useWebSearch = false, webSearchText = '' }) => {
    if (socket.role !== 'admin') return;
    const hasBaseContent = !!normalizeMessageText(content);
    if (!hasBaseContent && !useDeepThink && !useWebSearch) return;

    if (replyToId) {
      store.updateMessageStatus(replyToId, 'answered');
    }

    const pendingMessages = store.getMessages(sessionId).filter(
      m => m.role === 'user' && m.status === 'pending'
    );
    pendingMessages.forEach(m => store.updateMessageStatus(m.id, 'answered'));

    const fullContent = buildAssistantReplyContent(content, {
      useDeepThink,
      deepThinkText,
      useWebSearch,
      webSearchText
    });
    const msgId = uuidv4();

    const sendReply = () => {
      const msg = store.addMessage(msgId, sessionId, 'assistant', fullContent, 'sent');

      io.to(`session:${sessionId}`).emit('user:reply', {
        id: msg.id,
        role: 'assistant',
        content: msg.content,
        createdAt: msg.created_at,
        stream: true,
        streamSpeed
      });

      io.to(`session:${sessionId}`).emit('user:typing', { typing: false });

      broadcastToAdmins('admin:reply_sent', {
        sessionId,
        message: msg,
        ...getSessionListPayload()
      });

      socket.emit('admin:session_data', {
        session: store.getSession(sessionId),
        messages: store.getMessages(sessionId)
      });
    };

    if (simulateTyping) {
      io.to(`session:${sessionId}`).emit('user:typing', { typing: true });
      setTimeout(sendReply, typingDelay);
    } else {
      sendReply();
    }
  });

  socket.on('admin:rename_session', ({ sessionId, name }) => {
    if (socket.role !== 'admin') return;
    store.updateSessionName(sessionId, name);
    broadcastToAdmins('admin:sessions', getSessionListPayload());
    socket.emit('admin:session_data', {
      session: store.getSession(sessionId),
      messages: store.getMessages(sessionId)
    });
  });

  socket.on('admin:delete_session', ({ sessionId }) => {
    if (socket.role !== 'admin') return;
    store.deleteSession(sessionId);
    sessionSockets.delete(sessionId);
    broadcastToAdmins('admin:sessions', getSessionListPayload());
  });

  socket.on('admin:clear_messages', ({ sessionId }) => {
    if (socket.role !== 'admin') return;
    store.clearSessionMessages(sessionId);
    socket.emit('admin:session_data', {
      session: store.getSession(sessionId),
      messages: []
    });
    io.to(`session:${sessionId}`).emit('user:cleared');
    broadcastToAdmins('admin:sessions', getSessionListPayload());
  });

  socket.on('disconnect', () => {
    if (socket.role === 'admin') {
      adminSockets.delete(socket.id);
    }
    if (socket.sessionId && sessionSockets.get(socket.sessionId) === socket.id) {
      sessionSockets.delete(socket.sessionId);
    }
  });
});

app.get('/console', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'console.html'));
});

app.get('/api', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'api.html'));
});

app.get('/admin', (req, res) => {
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

server.listen(PORT, () => {
  console.log(`\n  服务已启动`);
  console.log(`  入口: http://localhost:${PORT}/login`);
  console.log(`  聊天: http://localhost:${PORT}\n`);
});
