// 서버 함수용 Supabase 접근 (secret key 사용 → RLS를 넘어 전체 조회·수정). 브라우저로는 절대 안 내려감
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lhanlpwjqrthrrpunryw.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_jGLrXnDwh_Aye8uMoR64ZA_dOKlWX2g';

async function db(path, { method = 'GET', body, headers = {} } = {}) {
  const key = process.env.SUPABASE_SECRET_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers },
    body: body && JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// 로그인한 운영자인지 확인 (브라우저가 보낸 로그인 토큰으로 is_admin 호출)
async function isAdminToken(token) {
  if (!token) return false;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: 'POST',
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}'
  });
  if (!res.ok) return false;
  return (await res.json()) === true;
}

// PostgREST in.(...) 필터용
const inList = ids => `in.(${ids.map(encodeURIComponent).join(',')})`;

module.exports = { db, isAdminToken, inList, SUPABASE_URL };
