let isRegister = false;

const authTitle = document.getElementById('authTitle');
const authSubtitle = document.getElementById('authSubtitle');
const authForm = document.getElementById('authForm');
const authError = document.getElementById('authError');
const switchMode = document.getElementById('switchMode');
const switchText = document.getElementById('switchText');
const emailGroup = document.getElementById('emailGroup');
const usernameGroup = document.getElementById('usernameGroup');
const displayNameGroup = document.getElementById('displayNameGroup');
const accountInput = document.getElementById('account');
const emailInput = document.getElementById('email');

if (localStorage.getItem('adminToken')) {
  window.location.href = '/console';
} else if (localStorage.getItem('authToken')) {
  window.location.href = '/';
}

function setMode(register) {
  isRegister = register;
  authError.textContent = '';

  if (register) {
    authTitle.textContent = '创建账户';
    authSubtitle.textContent = '注册以开始使用 CatGPT';
    emailGroup.style.display = '';
    usernameGroup.style.display = '';
    displayNameGroup.style.display = '';
    emailInput.style.display = '';
    accountInput.style.display = 'none';
    switchText.textContent = '已有账户？';
    switchMode.textContent = '登录';
    document.getElementById('authSubmit').textContent = '创建账户';
    document.getElementById('password').autocomplete = 'new-password';
  } else {
    authTitle.textContent = '欢迎回来';
    authSubtitle.textContent = '登录您的账户以继续';
    emailGroup.style.display = 'none';
    usernameGroup.style.display = 'none';
    displayNameGroup.style.display = 'none';
    emailInput.style.display = 'none';
    accountInput.style.display = '';
    switchText.textContent = '还没有账户？';
    switchMode.textContent = '创建账户';
    document.getElementById('authSubmit').textContent = '继续';
    document.getElementById('password').autocomplete = 'current-password';
  }
}

switchMode.addEventListener('click', (e) => {
  e.preventDefault();
  setMode(!isRegister);
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';

  const password = document.getElementById('password').value;
  const submitBtn = document.getElementById('authSubmit');
  submitBtn.disabled = true;
  submitBtn.textContent = '请稍候...';

  try {
    let res;
    if (isRegister) {
      res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailInput.value,
          username: document.getElementById('username').value,
          password,
          displayName: document.getElementById('displayName').value
        })
      });
    } else {
      res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: accountInput.value,
          password
        })
      });
    }

    const data = await res.json();
    if (!res.ok) {
      authError.textContent = data.error || '操作失败';
      return;
    }

    if (data.role === 'admin') {
      localStorage.removeItem('authToken');
      localStorage.removeItem('authUser');
      localStorage.setItem('adminToken', data.adminToken);
      localStorage.setItem('adminUser', JSON.stringify(data.user));
      window.location.href = '/console';
    } else {
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminUser');
      localStorage.setItem('authToken', data.token);
      localStorage.setItem('authUser', JSON.stringify(data.user));
      window.location.href = '/';
    }
  } catch {
    authError.textContent = '网络错误，请重试';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = isRegister ? '创建账户' : '继续';
  }
});

setMode(false);
