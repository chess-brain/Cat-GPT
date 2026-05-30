const adminToken = localStorage.getItem('adminToken');
const userToken = localStorage.getItem('authToken');
const apiKeyNameInput = document.getElementById('apiKeyNameInput');
const createApiKeyBtn = document.getElementById('createApiKeyBtn');
const apiKeyList = document.getElementById('apiKeyList');
const apiKeyStatus = document.getElementById('apiKeyStatus');

let currentScope = 'anon';

function fmt(ts) {
  const d = new Date(ts);
  return d.toLocaleString('zh-CN');
}

function adminHeaders() {
  return {
    'X-Admin-Token': adminToken,
    'Content-Type': 'application/json'
  };
}

function userHeaders() {
  return {
    Authorization: `Bearer ${userToken}`,
    'Content-Type': 'application/json'
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function setStatus(text) {
  apiKeyStatus.textContent = text;
}

function renderKeys(keys) {
  apiKeyList.innerHTML = '';
  if (!keys.length) {
    apiKeyList.innerHTML = '<div class="api-key-item"><span class="api-key-item-meta">暂无 API Key</span></div>';
    return;
  }

  keys.forEach((key) => {
    const item = document.createElement('div');
    const status = key.revoked_at ? '已吊销' : '可用';
    item.className = 'api-key-item';
    item.innerHTML = `
      <div>
        <div><strong>${escapeHtml(key.name)}</strong> <code>${key.key_prefix}...</code></div>
        <div class="api-key-item-meta">${status} · 创建 ${fmt(key.created_at)}${key.last_used_at ? ` · 最近使用 ${fmt(key.last_used_at)}` : ''}</div>
      </div>
      ${key.revoked_at ? '' : '<button type="button">吊销</button>'}
    `;

    const btn = item.querySelector('button');
    if (btn) {
      btn.addEventListener('click', async () => {
        if (!confirm(`确认吊销 API Key「${key.name}」？`)) return;
        let res;
        if (currentScope === 'user') {
          res = await fetch(`/api/my/api-keys/${key.id}`, {
            method: 'DELETE',
            headers: userHeaders()
          });
        } else {
          res = await fetch(`/api/admin/api-keys/${key.id}`, {
            method: 'DELETE',
            headers: adminHeaders()
          });
        }
        if (!res.ok) {
          setStatus('吊销失败，请检查权限状态');
          return;
        }
        setStatus('API Key 已吊销');
        await loadKeys();
      });
    }
    apiKeyList.appendChild(item);
  });
}

async function loadKeys() {
  if (userToken) {
    const userRes = await fetch('/api/my/api-keys', { headers: userHeaders() });
    if (userRes.ok) {
      const data = await userRes.json();
      currentScope = 'user';
      setStatus('已登录用户：正在管理“我的 API Keys”。');
      renderKeys(data.keys || []);
      return;
    }
  }

  if (adminToken) {
    const adminRes = await fetch('/api/admin/api-keys', { headers: adminHeaders() });
    if (adminRes.ok) {
      const data = await adminRes.json();
      currentScope = 'admin';
      setStatus('已登录管理员：正在管理全量 API Keys。');
      renderKeys(data.keys || []);
      return;
    }
  }

  currentScope = 'anon';
  setStatus('未登录：可直接创建 API Key，但无法查看/吊销列表。');
  apiKeyList.innerHTML = '';
}

createApiKeyBtn.addEventListener('click', async () => {
  const name = apiKeyNameInput.value.trim();
  if (!name) return;
  createApiKeyBtn.disabled = true;
  try {
    let res;
    if (currentScope === 'user') {
      res = await fetch('/api/my/api-keys', {
        method: 'POST',
        headers: userHeaders(),
        body: JSON.stringify({ name })
      });
    } else {
      res = await fetch('/api/admin/api-keys', {
        method: 'POST',
        headers: currentScope === 'admin' ? adminHeaders() : { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
    }
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error || '创建失败');
      return;
    }
    apiKeyNameInput.value = '';
    await navigator.clipboard.writeText(data.key);
    setStatus('创建成功，完整 API Key 已复制到剪贴板（仅显示一次）');
    await loadKeys();
  } catch (_) {
    setStatus('创建失败，请稍后重试');
  } finally {
    createApiKeyBtn.disabled = false;
  }
});

loadKeys();
