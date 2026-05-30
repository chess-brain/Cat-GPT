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
const deepThinkReplyToggle = document.getElementById('deepThinkReplyToggle');
const webSearchReplyToggle = document.getElementById('webSearchReplyToggle');
const deepThinkReplyInput = document.getElementById('deepThinkReplyInput');
const webSearchReplyInput = document.getElementById('webSearchReplyInput');
const adminUserName = document.getElementById('adminUserName');
const adminLogoutBtn = document.getElementById('adminLogoutBtn');
const apiKeyNameInput = document.getElementById('apiKeyNameInput');
const createApiKeyBtn = document.getElementById('createApiKeyBtn');
const apiKeyList = document.getElementById('apiKeyList');
const analysisQueryInput = document.getElementById('analysisQueryInput');
const analysisSearchBtn = document.getElementById('analysisSearchBtn');
const analysisResults = document.getElementById('analysisResults');
const analysisSource = document.getElementById('analysisSource');
const analysisGoogleLink = document.getElementById('analysisGoogleLink');
const analysisBingLink = document.getElementById('analysisBingLink');
const analysisBaiduLink = document.getElementById('analysisBaiduLink');

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

function normalizeMessageText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function renderWithStructuredBlocks(text) {
  const source = String(text || '');
  const tokenMap = {};
  let tokenIndex = 0;

  const converted = source.replace(/\[(DEEP_THINK|WEB_SEARCH)\]\n?([\s\S]*?)\[\/\1\]/g, (_, type, body) => {
    const token = `__BLOCK_TOKEN_${tokenIndex++}__`;
    const blockTitle = type === 'DEEP_THINK' ? '深度思考' : '联网搜索';
    const blockClass = type === 'DEEP_THINK' ? 'deep-think' : 'web-search';
    tokenMap[token] = `
      <div class="assistant-structured-block ${blockClass}">
        <div class="assistant-structured-title">${blockTitle}</div>
        <div class="assistant-structured-body">${renderMarkdown(body)}</div>
      </div>
    `;
    return token;
  });

  let html = renderMarkdown(converted);
  Object.entries(tokenMap).forEach(([token, blockHtml]) => {
    html = html.replace(token, blockHtml);
  });
  return html;
}

function renderMarkdown(text) {
  let html = escapeHtml(String(text || ''));
  const codeBlocks = [];

  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const token = `__CODE_BLOCK_${codeBlocks.length}__`;
    const className = lang ? ` class="language-${lang}"` : '';
    codeBlocks.push(`<pre><code${className}>${code.trim()}</code></pre>`);
    return token;
  });

  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/^\> (.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  html = html.replace(/(?:^|\n)([-*] .+(?:\n[-*] .+)*)/g, (match) => {
    const items = match.trim().split('\n').map(line => `<li>${line.replace(/^[-*]\s+/, '')}</li>`).join('');
    return `\n<ul>${items}</ul>`;
  });

  html = html.replace(/(?:^|\n)(\d+\. .+(?:\n\d+\. .+)*)/g, (match) => {
    const items = match.trim().split('\n').map(line => `<li>${line.replace(/^\d+\.\s+/, '')}</li>`).join('');
    return `\n<ol>${items}</ol>`;
  });

  const paragraphs = html.split(/\n{2,}/).map(block => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    if (/^<(h1|h2|h3|ul|ol|pre|blockquote|div)/.test(trimmed)) return trimmed;
    return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
  });

  html = paragraphs.filter(Boolean).join('');
  codeBlocks.forEach((code, idx) => {
    html = html.replace(`__CODE_BLOCK_${idx}__`, code);
  });
  return html;
}

function setAnalysisLinks(query) {
  const q = encodeURIComponent(query || '');
  analysisGoogleLink.href = `https://www.google.com/search?q=${q}`;
  analysisBingLink.href = `https://www.bing.com/search?q=${q}`;
  analysisBaiduLink.href = `https://www.baidu.com/s?wd=${q}`;
}

function getLatestUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user' && normalizeMessageText(messages[i].content)) {
      return messages[i];
    }
  }
  return null;
}

async function searchForAnalysis(rawQuery, { auto = false } = {}) {
  const query = normalizeMessageText(rawQuery);
  if (!query) return;
  analysisQueryInput.value = query;
  setAnalysisLinks(query);
  analysisSearchBtn.disabled = true;
  analysisSource.textContent = auto ? '自动分析中...' : '搜索中...';

  try {
    const res = await fetch(`/api/admin/search?q=${encodeURIComponent(query)}`, {
      headers: { 'X-Admin-Token': adminToken }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '搜索失败');

    const results = Array.isArray(data.results) ? data.results : [];
    analysisResults.innerHTML = '';
    if (!results.length) {
      analysisResults.innerHTML = '<div class="analysis-empty">未返回可解析结果，可点击上方搜索引擎链接继续分析。</div>';
    } else {
      results.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'analysis-result-item';
        row.innerHTML = `
          <a href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title || item.url || '未命名结果')}</a>
          <div class="analysis-result-snippet">${escapeHtml(item.snippet || '无摘要')}</div>
        `;
        analysisResults.appendChild(row);
      });
    }
    analysisSource.textContent = `结果 ${results.length} 条`;
  } catch (err) {
    analysisResults.innerHTML = `<div class="analysis-empty">${escapeHtml(err.message || '搜索失败，请稍后重试')}</div>`;
    analysisSource.textContent = '搜索失败';
  } finally {
    analysisSearchBtn.disabled = false;
  }
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
setAnalysisLinks('');

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
    searchForAnalysis(message.content, { auto: true });

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
  currentSessionName.textContent = session?.name || '未命名会话';
  adminActions.classList.remove('hidden');
  replyArea.classList.remove('hidden');

  adminMessages.innerHTML = '';
  messages.forEach(msg => appendAdminMessage(msg));

  const pending = messages.filter(m => m.role === 'user' && m.status === 'pending');
  pendingReplyToId = pending.length > 0 ? pending[pending.length - 1].id : null;
  const latestUserMessage = getLatestUserMessage(messages);
  if (latestUserMessage) {
    searchForAnalysis(latestUserMessage.content, { auto: true });
  }

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
    <div class="admin-msg-bubble">${renderWithStructuredBlocks(msg.content)}</div>
    <div class="admin-msg-meta">${msg.role === 'user' ? '用户' : 'AI（你）'} · ${time}${statusLabel}</div>
  `;

  adminMessages.appendChild(div);
  adminMessages.scrollTop = adminMessages.scrollHeight;
}

function sendReply() {
  const content = normalizeMessageText(replyInput.value);
  const allowByBlock = deepThinkReplyToggle.checked || webSearchReplyToggle.checked;
  if ((!content && !allowByBlock) || !currentSessionId) return;

  replyBtn.disabled = true;

  socket.emit('admin:reply', {
    sessionId: currentSessionId,
    content,
    replyToId: pendingReplyToId,
    simulateTyping: simulateTyping.checked,
    typingDelay: parseInt(typingDelay.value, 10) || 1500,
    useDeepThink: deepThinkReplyToggle.checked,
    deepThinkText: deepThinkReplyInput.value,
    useWebSearch: webSearchReplyToggle.checked,
    webSearchText: webSearchReplyInput.value
  });

  replyInput.value = '';
  deepThinkReplyInput.value = '';
  webSearchReplyInput.value = '';
  deepThinkReplyToggle.checked = false;
  webSearchReplyToggle.checked = false;
  deepThinkReplyInput.classList.add('hidden');
  webSearchReplyInput.classList.add('hidden');
  pendingReplyToId = null;
  updateReplyBtnState();

  setTimeout(updateReplyBtnState, 500);
}

function updateReplyBtnState() {
  const hasContent = !!normalizeMessageText(replyInput.value);
  const hasBlock = deepThinkReplyToggle.checked || webSearchReplyToggle.checked;
  replyBtn.disabled = !(hasContent || hasBlock);
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
  div.textContent = text == null ? '' : String(text);
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
  updateReplyBtnState();
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
    updateReplyBtnState();
    replyInput.focus();
  });
});

deepThinkReplyToggle.addEventListener('change', () => {
  deepThinkReplyInput.classList.toggle('hidden', !deepThinkReplyToggle.checked);
  if (deepThinkReplyToggle.checked) deepThinkReplyInput.focus();
  updateReplyBtnState();
});

webSearchReplyToggle.addEventListener('change', () => {
  webSearchReplyInput.classList.toggle('hidden', !webSearchReplyToggle.checked);
  if (webSearchReplyToggle.checked) webSearchReplyInput.focus();
  updateReplyBtnState();
});

analysisSearchBtn.addEventListener('click', () => searchForAnalysis(analysisQueryInput.value));
analysisQueryInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    searchForAnalysis(analysisQueryInput.value);
  }
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

updateReplyBtnState();
