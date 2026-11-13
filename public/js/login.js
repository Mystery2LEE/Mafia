let mode = 'login';
const $ = (id) => document.getElementById(id);

function setMode(m) {
  mode = m;
  $('tab-login').classList.toggle('active', m === 'login');
  $('tab-register').classList.toggle('active', m === 'register');
  $('nick-row').classList.toggle('hidden', m === 'login');
  $('nickname').required = m === 'register';
  $('password').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('submit').textContent = m === 'login' ? '로그인' : '가입하기';
  $('msg').textContent = '';
}

$('tab-login').onclick = () => setMode('login');
$('tab-register').onclick = () => setMode('register');

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('submit').disabled = true;
  $('msg').textContent = '';
  try {
    const body = { username: $('username').value.trim(), password: $('password').value };
    if (mode === 'register') body.nickname = $('nickname').value.trim();
    await api(mode === 'login' ? '/api/auth/login' : '/api/auth/register', body);
    location.href = '/lobby.html';
  } catch (err) {
    $('msg').textContent = err.message;
  } finally {
    $('submit').disabled = false;
  }
});

// 이미 로그인되어 있으면 바로 로비로
api('/api/auth/me').then(() => { location.href = '/lobby.html'; }).catch(() => {});
