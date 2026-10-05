// Gmail SMTP 발송 공용 모듈 (추가 설치 없음). 파일 이름이 _로 시작해서 Vercel 주소로는 열리지 않음
// - 한 번 로그인한 연결로 여러 통을 보낼 수 있음 (매칭 메일 대량 발송용)
const tls = require('tls');

// index.html의 EMAIL_DOMAINS와 같게 유지 (이 도메인으로만 메일 발송)
const EMAIL_DOMAINS = ['naver.com', 'gmail.com'];
const canMail = email => EMAIL_DOMAINS.includes(String(email || '').split('@')[1]);

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

// SMTP 연결 열기: smtp.gmail.com:465(TLS) → EHLO → AUTH PLAIN
// 반환: { send(to, message), close() }
// send 실패 시 오류의 permanent=true 이면 그 주소만 문제(잘못된 주소 등), 아니면 연결·한도 문제
async function openSession({ user, pass, connect }) {
  const socket = connect
    ? connect()
    : tls.connect({ host: 'smtp.gmail.com', port: 465, servername: 'smtp.gmail.com' });
  let buf = '', failed = null;
  const waiters = [];
  socket.setTimeout(20000, () => { failed = new Error('SMTP timeout'); socket.destroy(); waiters.splice(0).forEach(w => w(null)); });
  socket.on('error', e => { failed = e; waiters.splice(0).forEach(w => w(null)); });
  socket.on('close', () => { failed = failed || new Error('SMTP closed'); waiters.splice(0).forEach(w => w(null)); });
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
  const read = () => failed ? Promise.resolve(null) : new Promise(r => waiters.push(r));
  const expect = async (codes, cmd) => {
    if (cmd !== undefined) { if (failed) throw failed; socket.write(cmd + '\r\n'); }
    const reply = await read();
    if (reply === null) throw failed || new Error('SMTP closed');
    const lines = reply.trim().split('\r\n');
    const last = lines[lines.length - 1];
    const code = Number(last.slice(0, 3));
    if (!codes.includes(code)) {
      const err = new Error(`SMTP ${cmd ? cmd.split(' ')[0] : 'greeting'} → ${last}`);
      err.code = code;
      return Promise.reject(err);
    }
    return reply;
  };

  try {
    await expect([220]);
    await expect([250], 'EHLO samil-hankki.vercel.app');
    await expect([235], 'AUTH PLAIN ' + Buffer.from(`\0${user}\0${pass}`).toString('base64'));
  } catch (e) { socket.destroy(); throw e; }

  return {
    async send(to, message) {
      await expect([250], `MAIL FROM:<${user}>`);
      try {
        await expect([250, 251], `RCPT TO:<${to}>`);
      } catch (e) {
        // 받는 주소만 거절(550 5.1.1 없는 주소 등) → 이 주소는 건너뜀. 한도 초과(5.4.5 등)·임시 오류는 전체 중단
        if (e.code >= 550 && !/5\.4\.5|5\.7\.0|daily|limit/i.test(e.message)) {
          await expect([250], 'RSET').catch(() => {});
          e.permanent = true;
        }
        throw e;
      }
      await expect([354], 'DATA');
      // 본문 줄이 "."로 시작하면 ".."로 (SMTP 규칙)
      await expect([250], message.replace(/\r\n\./g, '\r\n..') + '\r\n.');
    },
    close() {
      try { if (!failed) socket.write('QUIT\r\n'); socket.end(); } catch (e) {}
    }
  };
}

function mailConfig() {
  const user = process.env.GMAIL_USER;
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');
  return user && pass ? { user, pass } : null;
}

module.exports = { EMAIL_DOMAINS, canMail, buildMessage, openSession, mailConfig };
