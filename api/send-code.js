// 신청 완료 후 확인 코드를 신청자 이메일로 보내는 서버 함수 (Gmail SMTP, 추가 설치 없음)
// - 이메일 + 코드가 Supabase에서 맞을 때만 발송 (아무나 임의 주소로 메일을 못 보내게)
// - Vercel 환경변수 필요: GMAIL_USER (samilhankki@gmail.com), GMAIL_APP_PASSWORD (Google 앱 비밀번호 16자리)
const tls = require('tls');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lhanlpwjqrthrrpunryw.supabase.co';
// 브라우저에 공개된 것과 같은 publishable key (코드 확인 함수만 호출)
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_jGLrXnDwh_Aye8uMoR64ZA_dOKlWX2g';
// index.html의 EMAIL_DOMAINS와 같게 유지
const EMAIL_DOMAINS = ['naver.com', 'gmail.com'];

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

const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const wrap76 = s => s.replace(/.{1,76}/g, '$&\r\n');

function buildMessage({ from, to, subject, text }) {
  return [
    `From: =?UTF-8?B?${b64('삼일한끼')}?= <${from}>`,
    `To: <${to}>`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@samil-hankki>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(text))
  ].join('\r\n');
}

// 최소 SMTP 클라이언트: smtp.gmail.com:465 (TLS) → EHLO → AUTH PLAIN → MAIL/RCPT/DATA → QUIT
function smtpSend({ user, pass, to, message, connect }) {
  return new Promise((resolve, reject) => {
    const socket = connect
      ? connect()
      : tls.connect({ host: 'smtp.gmail.com', port: 465, servername: 'smtp.gmail.com' });
    socket.setTimeout(15000, () => { socket.destroy(); reject(new Error('SMTP timeout')); });
    socket.on('error', reject);

    let buf = '';
    const waiters = [];
    socket.on('data', chunk => {
      buf += chunk.toString('utf8');
      let idx;
      // 여러 줄 응답("250-...")은 마지막 줄("250 ...")까지 모아서 처리
      while ((idx = buf.search(/^\d{3} .*\r\n/m)) !== -1) {
        const end = buf.indexOf('\r\n', idx) + 2;
        const reply = buf.slice(0, end);
        buf = buf.slice(end);
        const w = waiters.shift();
        if (w) w(reply);
      }
    });
    const read = () => new Promise(r => waiters.push(r));
    const expect = async (codes, cmd) => {
      if (cmd !== undefined) socket.write(cmd + '\r\n');
      const reply = await read();
      const lines = reply.trim().split('\r\n');
      const code = Number(lines[lines.length - 1].slice(0, 3));
      if (!codes.includes(code)) throw new Error(`SMTP ${cmd ? cmd.split(' ')[0] : 'greeting'} → ${reply.trim()}`);
      return reply;
    };

    (async () => {
      await expect([220]);
      await expect([250], 'EHLO samil-hankki.vercel.app');
      await expect([235], 'AUTH PLAIN ' + Buffer.from(`\0${user}\0${pass}`).toString('base64'));
      await expect([250], `MAIL FROM:<${user}>`);
      await expect([250, 251], `RCPT TO:<${to}>`);
      await expect([354], 'DATA');
      // 본문 줄이 "."로 시작하면 ".."로 (SMTP 규칙)
      await expect([250], message.replace(/\r\n\./g, '\r\n..') + '\r\n.');
      socket.write('QUIT\r\n');
      socket.end();
    })().then(resolve, err => { socket.destroy(); reject(err); });
  });
}

async function handler(req, res, deps = {}) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const user = process.env.GMAIL_USER;
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');
  if (!user || !pass) return res.status(500).json({ ok: false, error: 'mail not configured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const email = String((body && body.email) || '').trim().toLowerCase();
  const code = String((body && body.code) || '').trim();
  if (!/^[a-z0-9._-]+@[a-z0-9.-]+$/.test(email) || !EMAIL_DOMAINS.includes(email.split('@')[1]) || !/^\d{6}$/.test(code)) {
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
      '매일 밤 22시에 아직 조가 없는 신청자끼리 자동으로 조를 짜 드려요.',
      '결과는 아래 주소의 [내 결과 확인하기]에서 이메일과 위 코드를 넣으면 볼 수 있어요.',
      appUrl,
      '',
      '같은 이메일로 다시 신청해도 코드는 그대로예요.',
      '본인이 신청하지 않았다면 이 메일은 무시해 주세요.',
      '',
      '- 삼일한끼 (발신 전용 메일입니다)'
    ].join('\r\n');
    const message = buildMessage({ from: user, to: email, subject: `[삼일한끼] 결과 확인 코드 ${code}`, text });
    await (deps.smtpSend || smtpSend)({ user, pass, to: email, message, connect: deps.connect });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'send failed' });
  }
}

module.exports = (req, res) => handler(req, res);
module.exports.handler = handler;
module.exports.smtpSend = smtpSend;
