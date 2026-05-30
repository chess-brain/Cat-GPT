const adminToken = localStorage.getItem('adminToken');
const adminUser = JSON.parse(localStorage.getItem('adminUser') || 'null');

if (!adminToken) {
  window.location.href = '/login';
}

const socket = io();

const sessionList = document.getElementById('sessionList');
const pendingBadge = document.getElementById('pendingBadge');
const adminMessages = document.getElementById('adminMessages');
const currentSessionName = document.getElementById('currentSessionName');
const adminActions = document.getElementById('adminActions');
const replyArea = document.getElementById('replyArea');
const replyInput = document.getElementById('replyInput');
const replyBtn = document.getElementById('replyBtn');
const simulateTyping = document.getElementById('simulateTyping');
const typingDelay = document.getElementById('typingDelay');
const adminUserName = document.getElementById('adminUserName');
const adminLogoutBtn = document.getElementById('adminLogoutBtn');
const apiKeyNameInput = document.getElementById('apiKeyNameInput');
const createApiKeyBtn = document.getElementById('createApiKeyBtn');
const apiKeyList = document.getElementById('apiKeyList');

let currentSessionId = null;
let sessions = [];
let pendingReplyToId = null;

if (adminUser) {
  adminUserName.textContent = adminUser.displayName || adminUser.username;
}

function adminHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Admin-Token': adminToken
  };
}

function authenticate() {
  socket.emit('admin:auth', { token: adminToken }, (res) => {
    if (!res.success) {
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminUser');
      window.location.href = '/login';
    }
  });
}

socket.on('connect', authenticate);
loadApiKeys();

adminLogoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', {
    method: 'POST',
    headers: { 'X-Admin-Token': adminToken }
  });
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminUser');
  window.location.href = '/login';
});

async function loadApiKeys() {
  try {
    const res = await fetch('/api/admin/api-keys', { headers: adminHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    renderApiKeyList(data.keys || []);
  } catch (_) {}
}

function renderApiKeyList(keys) {
  apiKeyList.innerHTML = '';
  if (!keys.length) {
    apiKeyList.innerHTML = '<div class="api-key-item"><span class="api-key-item-meta">暂无 API Key</span></div>';
    return;
  }

  keys.forEach((k) => {
    const item = document.createElement('div');
    item.className = 'api-key-item';
    const status = k.revoked_at ? '已吊销' : '可用';
    item.innerHTML = `
      <div>
        <div><strong>${escapeHtml(k.name)}</strong> <code>${k.key_prefix}...</code></div>
        <div class="api-key-item-meta">${status} · 创建于 ${formatTime(k.created_at)}</div>
      </div>
      ${k.revoked_at ? '' : `<button data-revoke="${k.id}">吊销</button>`}
    `;
    const btn = item.querySelector('button[data-revoke]');
    if (btn) {
      btn.addEventListener('click', async () => {
        if (!confirm(`确认吊销 API Key「${k.name}」？`)) return;
        await fetch(`/api/admin/api-keys/${k.id}`, {
          method: 'DELETE',
          headers: adminHeaders()
        });
        loadApiKeys();
      });
    }
    apiKeyList.appendChild(item);
  });
}

createApiKeyBtn.addEventListener('click', async () => {
  const name = apiKeyNameInput.value.trim();
  if (!name) return;
  createApiKeyBtn.disabled = true;
  try {
    const res = await fetch('/api/admin/api-keys', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || '创建失败');
      return;
    }
    apiKeyNameInput.value = '';
    await navigator.clipboard.writeText(data.key);
    alert(`API Key 已创建并复制到剪贴板（仅显示一次）:\n${data.key}`);
    loadApiKeys();
  } catch (_) {
    alert('创建失败');
  } finally {
    createApiKeyBtn.disabled = false;
  }
});

socket.on('admin:sessions', ({ sessions: list, pendingCount }) => {
  sessions = list;
  renderSessionList();
  updatePendingBadge(pendingCount);
});

socket.on('admin:new_message', ({ sessionId, message, sessions: list, pendingCount }) => {
  sessions = list;
  renderSessionList();
  updatePendingBadge(pendingCount);

  if (sessionId === currentSessionId) {
    appendAdminMessage(message);
    pendingReplyToId = message.id;
    replyArea.classList.remove('hidden');
    replyInput.focus();

    if (Notification.permission === 'granted') {
      new Notification('新消息', { body: message.content.substring(0, 100) });
    }
  }

  playNotificationSound();
});

socket.on('admin:reply_sent', ({ sessions: list, pendingCount }) => {
  sessions = list;
  renderSessionList();
  updatePendingBadge(pendingCount);
});

socket.on('admin:session_data', ({ session, messages }) => {
  currentSessionName.textContent = session.name;
  adminActions.classList.remove('hidden');
  replyArea.classList.remove('hidden');

  adminMessages.innerHTML = '';
  messages.forEach(msg => appendAdminMessage(msg));

  const pending = messages.filter(m => m.role === 'user' && m.status === 'pending');
  pendingReplyToId = pending.length > 0 ? pending[pending.length - 1].id : null;

  adminMessages.scrollTop = adminMessages.scrollHeight;
});

function renderSessionList() {
  sessionList.innerHTML = '';

  if (sessions.length === 0) {
    sessionList.innerHTML = '<div class="empty-state" style="padding:20px"><p>暂无会话</p></div>';
    return;
  }

  sessions.forEach(session => {
    const item = document.createElement('div');
    item.className = `session-item${session.id === currentSessionId ? ' active' : ''}`;

    const time = formatTime(session.last_active);
    const preview = session.last_message
      ? session.last_message.substring(0, 40) + (session.last_message.length > 40 ? '...' : '')
      : '暂无消息';

    item.innerHTML = `
      <div class="session-item-name">
        ${session.pending_count > 0 ? '<span class="session-pending-dot"></span>' : ''}
        ${escapeHtml(session.name)}
      </div>
      <div class="session-item-preview">${escapeHtml(preview)}</div>
      <div class="session-item-time">${time}</div>
    `;

    item.addEventListener('click', () => selectSession(session.id));
    sessionList.appendChild(item);
  });
}

function selectSession(id) {
  currentSessionId = id;
  renderSessionList();
  socket.emit('admin:get_session', { sessionId: id });
}

function appendAdminMessage(msg) {
  const div = document.createElement('div');
  div.className = `admin-msg ${msg.role}${msg.status === 'pending' ? ' pending' : ''}`;

  const time = formatTime(msg.created_at);
  const statusLabel = msg.status === 'pending' ? ' · 待回复' : '';
  const modeBadges = [];
  if (msg.options?.deepThink) modeBadges.push('<span class="admin-mode-badge deep">深度思考</span>');
  if (msg.options?.webSearch) modeBadges.push('<span class="admin-mode-badge web">联网搜索</span>');

  div.innerHTML = `
    ${modeBadges.length ? `<div class="admin-msg-modes">${modeBadges.join('')}</div>` : ''}
    <div class="admin-msg-bubble">${escapeHtml(msg.content)}</div>
    <div class="admin-msg-meta">${msg.role === 'user' ? '用户' : 'AI（你）'} · ${time}${statusLabel}</div>
  `;

  adminMessages.appendChild(div);
  adminMessages.scrollTop = adminMessages.scrollHeight;
}

function sendReply() {
  const content = replyInput.value.trim();
  if (!content || !currentSessionId) return;

  replyBtn.disabled = true;

  socket.emit('admin:reply', {
    sessionId: currentSessionId,
    content,
    replyToId: pendingReplyToId,
    simulateTyping: simulateTyping.checked,
    typingDelay: parseInt(typingDelay.value) || 1500
  });

  replyInput.value = '';
  pendingReplyToId = null;
  replyBtn.disabled = true;

  setTimeout(() => { replyBtn.disabled = !replyInput.value.trim(); }, 500);
}

function updatePendingBadge(count) {
  if (count > 0) {
    pendingBadge.textContent = count;
    pendingBadge.classList.remove('hidden');
    document.title = `(${count}) 控制台 - CatGPT`;
  } else {
    pendingBadge.classList.add('hidden');
    document.title = '控制台 - CatGPT';
  }
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    gain.gain.value = 0.1;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.stop(ctx.currentTime + 0.3);
  } catch (_) {}
}

replyInput.addEventListener('input', () => {
  replyBtn.disabled = !replyInput.value.trim();
});

replyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendReply();
  }
});

replyBtn.addEventListener('click', sendReply);

document.querySelectorAll('.quick-reply-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    replyInput.value = btn.dataset.text;
    replyBtn.disabled = false;
    replyInput.focus();
  });
});

document.getElementById('renameBtn').addEventListener('click', () => {
  if (!currentSessionId) return;
  const name = prompt('输入新的会话名称：');
  if (name?.trim()) {
    socket.emit('admin:rename_session', { sessionId: currentSessionId, name: name.trim() });
  }
});

document.getElementById('clearBtn').addEventListener('click', () => {
  if (!currentSessionId) return;
  if (confirm('确定清空此会话的所有消息？')) {
    socket.emit('admin:clear_messages', { sessionId: currentSessionId });
  }
});

document.getElementById('deleteBtn').addEventListener('click', () => {
  if (!currentSessionId) return;
  if (confirm('确定删除此会话？此操作不可撤销。')) {
    socket.emit('admin:delete_session', { sessionId: currentSessionId });
    currentSessionId = null;
    adminMessages.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💬</div><p>从左侧选择一个会话开始回复</p></div>';
    replyArea.classList.add('hidden');
    adminActions.classList.add('hidden');
    currentSessionName.textContent = '选择一个会话';
  }
});

if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}
