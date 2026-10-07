// 확인 코드 메일 서버 함수(api/send-code.js)를 가짜 SMTP 서버(Gmail 응답 흉내)로 검사
const net = require('net')
const mod = require('../api/send-code.js')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m) }

function fakeSmtp({ authOk = true } = {}) {
  const log = { cmds: [], data: '' }
  const server = net.createServer(sock => {
    let buf = '', inData = false
    sock.write('220 smtp.gmail.com ESMTP ready\r\n')
    sock.on('data', d => {
      buf += d.toString('utf8')
      let i
      while (true) {
        if (inData) {
          i = buf.indexOf('\r\n.\r\n'); if (i === -1) return
          log.data = buf.slice(0, i); buf = buf.slice(i + 5); inData = false
          sock.write('250 2.0.0 OK queued\r\n'); continue
        }
        i = buf.indexOf('\r\n'); if (i === -1) return
        const line = buf.slice(0, i); buf = buf.slice(i + 2); log.cmds.push(line)
        const cmd = line.split(' ')[0].toUpperCase()
        // 여러 줄 응답 + 한 번에 나눠 보내기
        if (cmd === 'EHLO') { sock.write('250-smtp.gmail.com at your service\r\n250-SIZE 35882577\r\n'); setTimeout(() => sock.write('250-AUTH LOGIN PLAIN\r\n250 SMTPUTF8\r\n'), 20) }
        else if (cmd === 'AUTH') sock.write(authOk ? '235 2.7.0 Accepted\r\n' : '535-5.7.8 Username and Password not accepted.\r\n535 5.7.8 BadCredentials\r\n')
        else if (cmd === 'MAIL' || cmd === 'RCPT') sock.write('250 2.1.0 OK\r\n')
        else if (cmd === 'DATA') { sock.write('354 Go ahead\r\n'); inData = true }
        else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end() }
      }
    })
  })
  return new Promise(r => server.listen(0, () => r({ server, log, port: server.address().port })))
}
function call(body, deps, method = 'POST') {
  return new Promise(resolve => {
    const res = { code: 0, status(c) { this.code = c; return this }, json(b) { resolve({ code: this.code, body: b }) } }
    mod.handler({ method, body, headers: { host: 'samil-hankki261005.vercel.app' } }, res, deps)
  })
}

;(async () => {
  process.env.GMAIL_USER = 'samilhankki@gmail.com'
  process.env.GMAIL_APP_PASSWORD = 'abcd efgh ijkl mnop'
  const verifyOk = async (e, c) => (c === '123456' ? { name: '홍길동', email: e, birthYear: '1999', gender: '남성', dept: 'Tax', mbti: 'ENFP', wantGenders: ['상관없음'], wantDepts: ['Assurance', 'Deal'], groupSizes: ['3~4명'], slots: ['10/8(목) 12:15', '10/8(목) 12:00', '10/7(수) 11:30'] } : null)

  let f = await fakeSmtp()
  let r = await call({ email: 'Hong@Naver.com', code: '123456' }, { verify: verifyOk, connect: () => net.connect(f.port) })
  ok(r.code === 200 && r.body.ok, '정상 발송 → 200')
  const auth = f.log.cmds.find(c => c.startsWith('AUTH PLAIN'))
  ok(Buffer.from(auth.split(' ')[2], 'base64').toString() === '\0samilhankki@gmail.com\0abcdefghijklmnop', '앱 비밀번호 띄어쓰기 제거 후 로그인')
  ok(f.log.cmds.includes('RCPT TO:<hong@naver.com>'), '받는 사람 = 신청 이메일(소문자)')
  const [head, bodyB64] = f.log.data.split('\r\n\r\n')
  const subj = head.match(/Subject: =\?UTF-8\?B\?(.+)\?=/)[1]
  ok(Buffer.from(subj, 'base64').toString() === '[삼일한끼] 결과 확인 코드 123456', '한글 제목 정상')
  const text = Buffer.from(bodyB64.replace(/\r\n/g, ''), 'base64').toString()
  ok(text.includes('홍길동님') && text.includes('123456') && text.includes('https://samil-hankki261005.vercel.app'), '본문에 이름·코드·앱 주소')
  ok(['■ 내가 입력한 정보', '이메일: hong@naver.com', '출생연도: 1999년생', '성별: 남성', '소속 부문: Tax', 'MBTI: ENFP', '원하는 조원 성별: 상관없음', '원하는 조원 부문: Assurance, Deal', '희망 인원: 3~4명', '가능한 시간: 10/7(수) 11:30 · 10/8(목) 12:00, 12:15'].every(x => text.includes(x)), '확인 메일에 내가 입력한 정보 전체 (시간은 날짜별로 정리)')
  ok(!text.includes('22시'), '22시 표현 없음')
  f.server.close()

  f = await fakeSmtp()
  r = await call({ email: 'hong@naver.com', code: '999999' }, { verify: verifyOk, connect: () => net.connect(f.port) })
  ok(r.code === 403 && f.log.cmds.length === 0, '코드 틀리면 403, 메일 서버 접속도 안 함')
  r = await call({ email: 'hong@evil.com', code: '123456' }, { verify: verifyOk })
  ok(r.code === 400, '허용되지 않은 도메인 → 400')
  r = await call({ email: 'hong@naver.com', code: '12' }, { verify: verifyOk })
  ok(r.code === 400, '코드 형식 오류 → 400')
  r = await call({}, {}, 'GET')
  ok(r.code === 405, 'GET 요청 거부')
  f.server.close()

  f = await fakeSmtp({ authOk: false })
  r = await call({ email: 'hong@naver.com', code: '123456' }, { verify: verifyOk, connect: () => net.connect(f.port) })
  ok(r.code === 500 && r.body.error === 'gmail_login' && !JSON.stringify(r.body).includes('abcd'), 'Gmail 로그인 실패 → 500 gmail_login (비밀번호 노출 없음)')
  f.server.close()

  delete process.env.GMAIL_APP_PASSWORD
  r = await call({ email: 'hong@naver.com', code: '123456' }, { verify: verifyOk })
  ok(r.code === 500 && r.body.error === 'mail not configured', '환경변수 없으면 500')

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
