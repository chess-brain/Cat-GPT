const token = localStorage.getItem('authToken');
const authUser = JSON.parse(localStorage.getItem('authUser') || 'null');

if (localStorage.getItem('adminToken')) {
  window.location.href = '/console';
} else if (!token || !authUser) {
  window.location.href = '/login';
}

const socket = io();

const messagesInner = document.getElementById('messagesInner');
const welcomeScreen = document.getElementById('welcomeScreen');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const chatMessages = document.getElementById('chatMessages');
const chatHistory = document.getElementById('chatHistory');
const newChatBtn = document.getElementById('newChatBtn');
const userName = document.getElementById('userName');
const userAvatar = document.getElementById('userAvatar');
const logoutBtn = document.getElementById('logoutBtn');
const modelSelector = document.getElementById('modelSelector');
const modelDropdown = document.getElementById('modelDropdown');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const deepThinkToggle = document.getElementById('deepThinkToggle');
const webSearchToggle = document.getElementById('webSearchToggle');
const connectStatus = document.getElementById('connectStatus');

let sessionId = localStorage.getItem('currentChatId');
let typingEl = null;
let isStreaming = false;
let chats = [];
let pendingReplies = 0;
let pendingToolHints = [];
const messageModes = {
  deepThink: false,
  webSearch: false
};
const avatarStorageKey = `userAvatar:${authUser.id || authUser.username}`;

function normalizeMessageText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

userName.textContent = authUser.displayName || authUser.username;
updateUserAvatar();

function authHeaders() {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function loadChats() {
  try {
    const res = await fetch('/api/chats', { headers: authHeaders() });
    if (res.status === 401) {
      localStorage.removeItem('authToken');
      localStorage.removeItem('authUser');
      window.location.href = '/login';
      return;
    }
    const data = await res.json();
    chats = data.chats;
    renderChatHistory();

    if (!sessionId && chats.length > 0) {
      sessionId = chats[0].id;
      localStorage.setItem('currentChatId', sessionId);
    }

    if (sessionId) {
      joinSession(sessionId);
    } else {
      createNewChat();
    }
  } catch {
    createNewChat();
  }
}

function renderChatHistory() {
  chatHistory.innerHTML = '';
  chats.forEach(chat => {
    const preview = (chat.last_message || '').trim();
    const previewText = preview
      ? `${preview.slice(0, 24)}${preview.length > 24 ? '...' : ''}`
      : '暂无消息';
    const timeText = formatChatTime(chat.last_active || chat.created_at || Date.now());
    const item = document.createElement('div');
    item.className = `history-item${chat.id === sessionId ? ' active' : ''}`;
    item.innerHTML = `
      <div class="history-item-main">
        <div class="history-item-title-row">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
          <span>${escapeHtml(chat.title || '新对话')}</span>
        </div>
        <div class="history-item-meta-row">
          <span class="history-item-preview">${escapeHtml(previewText)}</span>
          <span class="history-item-time">${timeText}</span>
        </div>
      </div>
      <div class="history-item-actions">
        <button class="history-action-btn" data-action="rename" title="重命名">✎</button>
        <button class="history-action-btn danger" data-action="delete" title="删除">🗑</button>
      </div>
    `;
    item.addEventListener('click', (e) => {
      const action = e.target.closest('.history-action-btn')?.dataset.action;
      if (action === 'rename') {
        e.stopPropagation();
        renameChat(chat);
        return;
      }
      if (action === 'delete') {
        e.stopPropagation();
        deleteChat(chat);
        return;
      }
      switchChat(chat.id);
    });
    chatHistory.appendChild(item);
  });
}

async function createNewChat() {
  const res = await fetch('/api/chats', { method: 'POST', headers: authHeaders() });
  const data = await res.json();
  sessionId = data.chat.id;
  localStorage.setItem('currentChatId', sessionId);
  chats.unshift(data.chat);
  renderChatHistory();
  pendingReplies = 0;
  updateConnectStatus();
  clearMessages();
  joinSession(sessionId);
}

function switchChat(id) {
  if (id === sessionId) return;
  sessionId = id;
  localStorage.setItem('currentChatId', sessionId);
  clearPendingToolHints();
  renderChatHistory();
  pendingReplies = 0;
  updateConnectStatus();
  clearMessages();
  joinSession(id);
  sidebar.classList.remove('open');
}

function joinSession(id) {
  socket.emit('user:join', { sessionId: id, token });
}

function clearMessages() {
  clearPendingToolHints();
  messagesInner.innerHTML = '';
  const welcome = document.createElement('div');
  welcome.className = 'welcome-screen';
  welcome.id = 'welcomeScreen';
  welcome.innerHTML = `
    <h2>今天有什么可以帮您的？</h2>
    <div class="suggestions">
      <button class="suggestion-btn" data-text="帮我写一封专业的商务邮件">
        <span class="suggestion-icon">✉️</span><span>写一封商务邮件</span>
      </button>
      <button class="suggestion-btn" data-text="用简单的方式解释相对论">
        <span class="suggestion-icon">🔬</span><span>解释相对论</span>
      </button>
      <button class="suggestion-btn" data-text="给我一份一周的健康饮食计划">
        <span class="suggestion-icon">🥗</span><span>健康饮食计划</span>
      </button>
      <button class="suggestion-btn" data-text="帮我调试这段 Python 代码中的 bug">
        <span class="suggestion-icon">💻</span><span>调试 Python 代码</span>
      </button>
    </div>
  `;
  messagesInner.appendChild(welcome);
  bindSuggestions();
}

socket.on('user:auth_error', () => {
  localStorage.removeItem('authToken');
  window.location.href = '/login';
});

socket.on('user:history', ({ messages }) => {
  pendingReplies = 0;
  clearPendingToolHints();
  updateConnectStatus();
  if (messages.length > 0) {
    hideWelcome();
    messages.forEach(msg => appendMessage(msg.role, msg.content, false, msg.options));
    scrollToBottom();
  }
});

socket.on('user:message:sent', (msg) => {
  appendMessage('user', msg.content, true, msg.options);
  touchChatSession(msg.content);
  showPendingToolHints(msg.options);
  updateConnectStatus();
});

socket.on('user:reply', (msg) => {
  removeTypingIndicator();
  pendingReplies = Math.max(0, pendingReplies - 1);
  clearPendingToolHints();
  touchChatSession(msg.content);
  updateConnectStatus();
  if (msg.stream) {
    streamMessage(msg.content, msg.streamSpeed || 25);
  } else {
    appendMessage('assistant', msg.content);
  }
});

socket.on('user:typing', ({ typing }) => {
  if (typing && !isStreaming) showTypingIndicator();
  else if (!typing) removeTypingIndicator();
});

socket.on('user:cleared', () => {
  pendingReplies = 0;
  updateConnectStatus();
  clearMessages();
});

socket.on('user:chat_updated', ({ sessionId: sid, title }) => {
  const chat = chats.find(c => c.id === sid);
  if (chat) {
    chat.title = title;
    renderChatHistory();
  }
});

function hideWelcome() {
  const w = document.getElementById('welcomeScreen');
  if (w) w.remove();
}

function formatChatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  if (diff < 60000) return '刚刚';
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function touchChatSession(lastMessage) {
  const index = chats.findIndex(c => c.id === sessionId);
  if (index < 0) return;
  const chat = chats[index];
  chat.last_active = Date.now();
  chat.last_message = normalizeMessageText(lastMessage || '') || chat.last_message || '';
  if (index > 0) {
    chats.splice(index, 1);
    chats.unshift(chat);
  }
  renderChatHistory();
}

function clearPendingToolHints() {
  pendingToolHints.forEach(el => el.remove());
  pendingToolHints = [];
}

function showPendingToolHints(options) {
  clearPendingToolHints();
  const tasks = [];
  if (options?.deepThink) tasks.push('正在深度思考');
  if (options?.webSearch) tasks.push('正在联网搜索');
  if (!tasks.length) return;

  tasks.forEach((text) => {
    const row = document.createElement('div');
    row.className = 'message-row assistant tool-hint-row';
    row.innerHTML = `
      <div class="message-row-inner">
        <div class="message-avatar">
          <svg width="20" height="20" viewBox="0 0 41 41" fill="none"><path d="M37.5 18.5c0-1.5-.5-3-1.5-4.2L30 6.8c-1.2-1.2-2.7-1.8-4.2-1.8s-3 .6-4.2 1.8L3.5 24.1c-1.2 1.2-1.8 2.7-1.8 4.2s.6 3 1.8 4.2l6 6c1.2 1.2 2.7 1.8 4.2 1.8s3-.6 4.2-1.8L37.5 26.9c1.2-1.2 1.8-2.7 1.8-4.2s-.6-3-1.8-4.2z" fill="currentColor"/></svg>
        </div>
        <div class="message-body">
          <div class="tool-hint-pill">${text}<span class="tool-hint-dots"></span></div>
        </div>
      </div>
    `;
    messagesInner.appendChild(row);
    pendingToolHints.push(row);
  });
  scrollToBottom();
}

function appendMessage(role, content, animate = true, options = null) {
  hideWelcome();

  const row = document.createElement('div');
  row.className = `message-row ${role}`;
  if (!animate) row.style.animation = 'none';

  const inner = document.createElement('div');
  inner.className = 'message-row-inner';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  if (role === 'user') {
    avatar.textContent = getCurrentAvatar();
  } else {
    avatar.innerHTML = `<svg width="20" height="20" viewBox="0 0 41 41" fill="none"><path d="M37.5 18.5c0-1.5-.5-3-1.5-4.2L30 6.8c-1.2-1.2-2.7-1.8-4.2-1.8s-3 .6-4.2 1.8L3.5 24.1c-1.2 1.2-1.8 2.7-1.8 4.2s.6 3 1.8 4.2l6 6c1.2 1.2 2.7 1.8 4.2 1.8s3-.6 4.2-1.8L37.5 26.9c1.2-1.2 1.8-2.7 1.8-4.2s-.6-3-1.8-4.2z" fill="currentColor"/></svg>`;
  }

  const body = document.createElement('div');
  body.className = 'message-body';

  const contentEl = document.createElement('div');
  contentEl.className = 'message-content';
  contentEl.innerHTML = renderWithStructuredBlocks(content);

  if (role === 'user' && options && (options.deepThink || options.webSearch)) {
    const modeBar = document.createElement('div');
    modeBar.className = 'admin-msg-modes';
    if (options.deepThink) {
      modeBar.innerHTML += '<span class="admin-mode-badge deep">深度思考</span>';
    }
    if (options.webSearch) {
      modeBar.innerHTML += '<span class="admin-mode-badge web">联网搜索</span>';
    }
    body.appendChild(modeBar);
  }

  if (role === 'assistant') {
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    actions.innerHTML = `
      <button class="msg-action-btn" title="复制" onclick="copyText(this)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
      </button>
    `;
    body.appendChild(contentEl);
    body.appendChild(actions);
  } else {
    body.appendChild(contentEl);
  }

  inner.appendChild(avatar);
  inner.appendChild(body);
  row.appendChild(inner);
  messagesInner.appendChild(row);
  scrollToBottom();
}

function streamMessage(content, speed) {
  hideWelcome();
  isStreaming = true;

  const row = document.createElement('div');
  row.className = 'message-row assistant';

  const inner = document.createElement('div');
  inner.className = 'message-row-inner';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.innerHTML = `<svg width="20" height="20" viewBox="0 0 41 41" fill="none"><path d="M37.5 18.5c0-1.5-.5-3-1.5-4.2L30 6.8c-1.2-1.2-2.7-1.8-4.2-1.8s-3 .6-4.2 1.8L3.5 24.1c-1.2 1.2-1.8 2.7-1.8 4.2s.6 3 1.8 4.2l6 6c1.2 1.2 2.7 1.8 4.2 1.8s3-.6 4.2-1.8L37.5 26.9c1.2-1.2 1.8-2.7 1.8-4.2s-.6-3-1.8-4.2z" fill="currentColor"/></svg>`;

  const body = document.createElement('div');
  body.className = 'message-body';
  const contentEl = document.createElement('div');
  contentEl.className = 'message-content';
  const cursor = document.createElement('span');
  cursor.className = 'stream-cursor';

  body.appendChild(contentEl);
  inner.appendChild(avatar);
  inner.appendChild(body);
  row.appendChild(inner);
  messagesInner.appendChild(row);

  let i = 0;
  const plain = content;

  function tick() {
    if (i < plain.length) {
      const chunk = plain.slice(0, i + 1);
      contentEl.innerHTML = renderWithStructuredBlocks(chunk);
      contentEl.appendChild(cursor);
      i += Math.random() > 0.7 ? 2 : 1;
      scrollToBottom();
      setTimeout(tick, speed + Math.random() * 15);
    } else {
      contentEl.innerHTML = renderWithStructuredBlocks(content);
      const actions = document.createElement('div');
      actions.className = 'message-actions';
      actions.innerHTML = `
        <button class="msg-action-btn" title="复制" onclick="copyText(this)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        </button>
      `;
      body.appendChild(actions);
      isStreaming = false;
      scrollToBottom();
    }
  }

  tick();
}

window.copyText = function(btn) {
  const content = btn.closest('.message-body').querySelector('.message-content').innerText;
  navigator.clipboard.writeText(content);
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>';
  setTimeout(() => {
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
  }, 2000);
};

function showTypingIndicator() {
  if (typingEl || isStreaming) return;
  hideWelcome();

  typingEl = document.createElement('div');
  typingEl.className = 'message-row assistant typing-indicator';
  typingEl.innerHTML = `
    <div class="message-row-inner">
      <div class="message-avatar">
        <svg width="20" height="20" viewBox="0 0 41 41" fill="none"><path d="M37.5 18.5c0-1.5-.5-3-1.5-4.2L30 6.8c-1.2-1.2-2.7-1.8-4.2-1.8s-3 .6-4.2 1.8L3.5 24.1c-1.2 1.2-1.8 2.7-1.8 4.2s.6 3 1.8 4.2l6 6c1.2 1.2 2.7 1.8 4.2 1.8s3-.6 4.2-1.8L37.5 26.9c1.2-1.2 1.8-2.7 1.8-4.2s-.6-3-1.8-4.2z" fill="currentColor"/></svg>
      </div>
      <div class="typing-dots"><span></span><span></span><span></span></div>
    </div>
  `;
  messagesInner.appendChild(typingEl);
  scrollToBottom();
}

function removeTypingIndicator() {
  if (typingEl) {
    typingEl.remove();
    typingEl = null;
  }
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
  html = html.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/^\> (.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

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
    if (/^<(h1|h2|h3|ul|ol|pre|blockquote|div|hr)/.test(trimmed)) return trimmed;
    return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
  });

  html = paragraphs.filter(Boolean).join('');
  codeBlocks.forEach((code, idx) => {
    html = html.replace(`__CODE_BLOCK_${idx}__`, code);
  });

  return html;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendMessage() {
  const content = normalizeMessageText(messageInput.value);
  if (!content || isStreaming) return;
  const options = { ...messageModes };
  socket.emit('user:message', { content, options });
  pendingReplies += 1;
  updateConnectStatus();
  messageInput.value = '';
  messageInput.style.height = 'auto';
  updateSendBtn();
}

function updateSendBtn() {
  const hasText = !!normalizeMessageText(messageInput.value);
  sendBtn.disabled = !hasText || isStreaming;
  sendBtn.classList.toggle('active', hasText && !isStreaming);
}

function bindSuggestions() {
  document.querySelectorAll('.suggestion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      messageInput.value = btn.dataset.text;
      updateSendBtn();
      sendMessage();
    });
  });
}

function updateConnectStatus() {
  if (pendingReplies > 0) {
    connectStatus.textContent = pendingReplies > 1 ? `连接中... (${pendingReplies})` : '连接中...';
    connectStatus.classList.remove('hidden');
  } else {
    connectStatus.classList.add('hidden');
  }
}

function toggleMode(modeKey, buttonEl) {
  messageModes[modeKey] = !messageModes[modeKey];
  buttonEl.classList.toggle('active', messageModes[modeKey]);
}

function getCurrentAvatar() {
  return localStorage.getItem(avatarStorageKey) || (authUser.displayName || authUser.username)[0].toUpperCase();
}

function updateUserAvatar() {
  const avatar = getCurrentAvatar();
  userAvatar.textContent = avatar;
  userAvatar.title = '点击修改头像';
}

async function renameChat(chat) {
  const input = prompt('请输入新的对话名称：', chat.title || '新对话');
  const title = input?.trim();
  if (!title) return;

  try {
    const res = await fetch(`/api/chats/${chat.id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ title })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '重命名失败');
    chat.title = data.chat.title;
    renderChatHistory();
  } catch (err) {
    alert(err.message || '重命名失败');
  }
}

async function deleteChat(chat) {
  if (!confirm(`确定删除对话「${chat.title || '新对话'}」吗？`)) return;

  try {
    const res = await fetch(`/api/chats/${chat.id}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '删除失败');

    chats = chats.filter(c => c.id !== chat.id);
    if (sessionId === chat.id) {
      sessionId = chats[0]?.id || null;
      if (sessionId) {
        localStorage.setItem('currentChatId', sessionId);
      } else {
        localStorage.removeItem('currentChatId');
      }
      renderChatHistory();
      if (sessionId) {
        clearMessages();
        joinSession(sessionId);
      } else {
        await createNewChat();
      }
    } else {
      renderChatHistory();
    }
  } catch (err) {
    alert(err.message || '删除失败');
  }
}

messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
  updateSendBtn();
});

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);
newChatBtn.addEventListener('click', createNewChat);
deepThinkToggle.addEventListener('click', () => toggleMode('deepThink', deepThinkToggle));
webSearchToggle.addEventListener('click', () => toggleMode('webSearch', webSearchToggle));
userAvatar.addEventListener('click', () => {
  const input = prompt('输入新的头像（建议 1 个 emoji 或字母）：', getCurrentAvatar());
  if (!input) return;
  const avatar = input.trim().slice(0, 2);
  if (!avatar) return;
  localStorage.setItem(avatarStorageKey, avatar);
  updateUserAvatar();
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST', headers: authHeaders() });
  localStorage.removeItem('authToken');
  localStorage.removeItem('authUser');
  localStorage.removeItem('currentChatId');
  window.location.href = '/login';
});

modelSelector.addEventListener('click', (e) => {
  e.stopPropagation();
  modelDropdown.classList.toggle('hidden');
});

document.addEventListener('click', () => modelDropdown.classList.add('hidden'));

document.querySelectorAll('.model-option').forEach(opt => {
  opt.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.model-option').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    modelDropdown.classList.add('hidden');
  });
});

function toggleSidebar() {
  if (window.innerWidth <= 768) {
    sidebar.classList.toggle('open');
    return;
  }
  sidebar.classList.toggle('collapsed');
}

sidebarToggle.addEventListener('click', toggleSidebar);
mobileMenuBtn.addEventListener('click', toggleSidebar);

bindSuggestions();
loadChats();
