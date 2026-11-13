// 공용 fetch 헬퍼. 쿠키(JWT)는 브라우저가 자동으로 보낸다.
async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || '요청 실패');
    err.status = res.status;
    err.code = data.error;
    throw err;
  }
  return data;
}

/** 프로필 사진 업로드/삭제 (본문은 이미지 바이트) */
async function sendAvatar(blob) {
  const res = await fetch('/api/avatar', { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || '사진을 올리지 못했습니다.');
  return data;
}
async function removeAvatar() {
  const res = await fetch('/api/avatar', { method: 'DELETE', credentials: 'same-origin' });
  if (!res.ok) throw new Error('되돌리지 못했습니다.');
}

/** 로그인 필요 페이지에서 호출. 미로그인이면 로그인 페이지로 이동. */
async function requireLogin() {
  try {
    return (await api('/api/auth/me')).user;
  } catch {
    location.href = '/login.html';
    return new Promise(() => {});
  }
}
