const socket = io();

const loginScreen = document.getElementById('loginScreen');
const adminApp = document.getElementById('adminApp');
const usernameInput = document.getElementById('usernameInput');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
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

let currentSessionId = null;
let sessions = [];
let pendingReplyToId = null;

function login() {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  socket.emit('admin:auth', { username, password }, (res) => {
    if (res.success) {
      loginScreen.classList.add('hidden');
      adminApp.classList.remove('hidden');
      loginError.style.display = 'none';
    } else {
      loginError.style.display = 'block';
    }
  });
}

loginBtn.addEventListener('click', login);
passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});
usernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') passwordInput.focus();
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

socket.on('admin:reply_sent', ({ sessionId, sessions: list, pendingCount }) => {
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
    item.dataset.id = session.id;

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

  div.innerHTML = `
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
    document.title = `(${count}) 管理后台 - AI 聊天`;
  } else {
    pendingBadge.classList.add('hidden');
    document.title = '管理后台 - AI 聊天';
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
