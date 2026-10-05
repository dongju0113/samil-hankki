// 신청 완료 후 확인 코드를 신청자 이메일로 보내는 서버 함수 (Gmail SMTP, 추가 설치 없음)
// - 이메일 + 코드가 Supabase에서 맞을 때만 발송 (아무나 임의 주소로 메일을 못 보내게)
// - Vercel 환경변수 필요: GMAIL_USER (samilhankki@gmail.com), GMAIL_APP_PASSWORD (Google 앱 비밀번호 16자리)
const { canMail, buildMessage, openSession, mailConfig } = require('./_mail.js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lhanlpwjqrthrrpunryw.supabase.co';
// 브라우저에 공개된 것과 같은 publishable key (코드 확인 함수만 호출)
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_jGLrXnDwh_Aye8uMoR64ZA_dOKlWX2g';

// 이메일 + 코드 확인 (get_my_result: 맞을 때만 내 이름을 돌려줌)
async function verify(email, code) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_my_result`, {
    method: 'POST',
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_email: email, p_code: code })
  });
  if (!res.ok) throw new Error(`verify ${res.status}`);
  const data = await res.json();
  return data && data.ok ? data.me : null;
}

async function handler(req, res, deps = {}) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const cfg = mailConfig();
  if (!cfg) return res.status(500).json({ ok: false, error: 'mail not configured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const email = String((body && body.email) || '').trim().toLowerCase();
  const code = String((body && body.code) || '').trim();
  if (!/^[a-z0-9._-]+@[a-z0-9.-]+$/.test(email) || !canMail(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ ok: false, error: 'invalid' });
  }

  try {
    const me = await (deps.verify || verify)(email, code);
    if (!me) return res.status(403).json({ ok: false, error: 'not verified' });

    const appUrl = `https://${req.headers['x-forwarded-host'] || req.headers.host || 'samil-hankki261005.vercel.app'}`;
    const text = [
      `${me.name}님, 삼일한끼 점심 신청이 완료됐어요!`,
      '',
      `■ 결과 확인 코드: ${code}`,
      '',
      '매일 밤 22시에 아직 조가 없는 신청자끼리 자동으로 조를 짜 드려요. 조가 정해지면 메일로도 알려 드려요.',
      '결과는 아래 주소의 [내 결과 확인하기]에서 이메일과 위 코드를 넣으면 볼 수 있어요.',
      appUrl,
      '',
      '같은 이메일로 다시 신청해도 코드는 그대로예요.',
      '본인이 신청하지 않았다면 이 메일은 무시해 주세요.',
      '',
      '- 삼일한끼 (발신 전용 메일입니다)'
    ].join('\r\n');
    const message = buildMessage({ from: cfg.user, to: email, subject: `[삼일한끼] 결과 확인 코드 ${code}`, text });
    const session = await openSession({ ...cfg, connect: deps.connect });
    try { await session.send(email, message); } finally { session.close(); }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'send failed' });
  }
}

module.exports = (req, res) => handler(req, res);
module.exports.handler = handler;
