// 매칭 메일(api/_notify.js, api/notify-matched.js)을 가짜 Supabase + 가짜 Gmail(SMTP)로 검사
const net = require('net')
const { notifyPending } = require('../api/_notify.js')
const endpoint = require('../api/notify-matched.js')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m) }

// ===== 가짜 Gmail =====
function fakeSmtp({ authOk = true, reject = [] } = {}) {
  const log = { mails: [], sessions: 0 }
  const server = net.createServer(sock => {
    log.sessions++
    let buf = '', inData = false, rcpt = null
    sock.write('220 ready\r\n')
    sock.on('data', d => {
      buf += d.toString('utf8')
      while (true) {
        if (inData) {
          const i = buf.indexOf('\r\n.\r\n'); if (i === -1) return
          log.mails.push({ to: rcpt, data: buf.slice(0, i) }); buf = buf.slice(i + 5); inData = false
          sock.write('250 OK\r\n'); continue
        }
        const i = buf.indexOf('\r\n'); if (i === -1) return
        const line = buf.slice(0, i); buf = buf.slice(i + 2)
        const cmd = line.split(' ')[0].toUpperCase()
        if (cmd === 'EHLO') sock.write('250-hi\r\n250 AUTH PLAIN\r\n')
        else if (cmd === 'AUTH') sock.write(authOk ? '235 OK\r\n' : '535 5.7.8 BadCredentials\r\n')
        else if (cmd === 'MAIL' || cmd === 'RSET') sock.write('250 OK\r\n')
        else if (cmd === 'RCPT') { rcpt = line.match(/<(.+)>/)[1]; sock.write(reject.includes(rcpt) ? '550 5.1.1 no such user\r\n' : '250 OK\r\n') }
        else if (cmd === 'DATA') { sock.write('354 go\r\n'); inData = true }
        else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end() }
      }
    })
  })
  return new Promise(r => server.listen(0, () => r({ server, log, connect: () => net.connect(server.address().port) })))
}
const decode = data => {
  const [head, body] = data.split('\r\n\r\n')
  return { subject: Buffer.from(head.match(/Subject: =\?UTF-8\?B\?(.+)\?=/)[1], 'base64').toString(), text: Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString() }
}

// ===== 가짜 Supabase (서버 함수가 쓰는 REST 경로만) =====
function fakeDb() {
  const st = {
    settings: [{ id: 1, cutoff_min: 60, include_past: false }],
    groups: [
      { id: 'g1', no: 1, slot: '10/7(수) 12:00', locked: false, contact_id: 'b' },
      { id: 'g2', no: 2, slot: '10/8(목) 12:30', locked: true }
    ],
    applications: [
      { id: 'a', name: '김삼일', email: 'kim@naver.com', dept: 'Audit', dept_open: true, sample: false },
      { id: 'b', name: '이세무', email: 'lee@gmail.com', dept: 'Tax', mbti: 'INFP', sample: false },
      { id: 'c', name: '샘플일', email: 'sample1@example.com', dept: 'Deal', mbti: 'ESTJ', sample: true },
      { id: 'd', name: '박재무', email: 'park@naver.com', dept: 'AX', dept_open: true, sample: false },
      { id: 'e', name: '최디지털', email: 'choi@gmail.com', dept: 'AX', dept_open: true, sample: false }
    ],
    group_members: [
      { application_id: 'a', group_id: 'g1', seq: 1, notified_at: null },
      { application_id: 'b', group_id: 'g1', seq: 2, notified_at: null },
      { application_id: 'c', group_id: 'g1', seq: 3, notified_at: null },
      { application_id: 'd', group_id: 'g2', seq: 4, notified_at: '2026-10-04T13:00:00Z' },
      { application_id: 'e', group_id: 'g2', seq: 5, notified_at: '2026-10-04T13:00:00Z' }
    ]
  }
  const parseIn = v => decodeURIComponent(v).replace(/^in\.\(|\)$/g, '').split(',')
  const db = async (path, { method = 'GET', body } = {}) => {
    const [table, qs] = path.split('?')
    const params = Object.fromEntries(qs.split('&').map(p => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)] }))
    let rows = st[table]
    for (const [k, v] of Object.entries(params)) {
      if (k === 'select' || k === 'order') continue
      if (v === 'is.null') rows = rows.filter(r => r[k] == null)
      else if (v.startsWith('eq.')) rows = rows.filter(r => String(r[k]) === v.slice(3))
      else if (v.startsWith('in.')) { const ids = parseIn(v); rows = rows.filter(r => ids.includes(r[k])) }
    }
    if (method === 'PATCH') { rows.forEach(r => Object.assign(r, body)); return null }
    if (params.order === 'seq') rows = [...rows].sort((x, y) => x.seq - y.seq)
    return JSON.parse(JSON.stringify(rows))
  }
  return { st, db }
}
const notified = st => st.group_members.filter(m => m.notified_at && !m.notified_at.startsWith('2026-10-04')).map(m => m.application_id).sort().join(',')

;(async () => {
  process.env.GMAIL_USER = 'samilhankki@gmail.com'
  process.env.GMAIL_APP_PASSWORD = 'abcd efgh ijkl mnop'
  const appUrl = 'https://samil-hankki261005.vercel.app'

  // 1) 정상 발송
  let f = await fakeSmtp(), d = fakeDb()
  let r = await notifyPending({ appUrl, db: d.db, connect: f.connect })
  ok(r.sent === 2 && r.skipped === 1 && r.remaining === 0, `새로 조가 정해진 2명 발송, 샘플 1명 건너뜀 (${JSON.stringify(r)})`)
  ok(f.log.mails.map(m => m.to).sort().join() === 'kim@naver.com,lee@gmail.com', '받는 사람 = 신청 이메일')
  ok(notified(d.st) === 'a,b,c', '보낸 사람·샘플은 발송 기록, 이미 받은 조(2조)는 그대로')
  const kim = decode(f.log.mails.find(m => m.to === 'kim@naver.com').data)
  ok(kim.subject === '[삼일한끼] 점심 조가 정해졌어요 · 10/7(수) 12:00', '제목: ' + kim.subject)
  ok(kim.text.includes('김삼일님') && kim.text.includes('1조 · 10/7(수) 12:00 시작 · 3명') && kim.text.includes(appUrl), '본문: 이름·조·시간·인원·앱 주소')
  ok(kim.text.includes('이*무(Tax·INFP)') && kim.text.includes('샘*일(Deal·ESTJ)') && !kim.text.includes('이세무'), '조원 이름은 가리고(이*무) 부문·MBTI 표시')
  ok(kim.text.includes('응답 마감: 10/7(수) 11:00'), '응답 마감 = 점심 60분 전 (한국 시간)')
  ok(kim.text.includes('■ 연락 담당: 이*무님이 먼저 연락드릴 거예요'), '연락 담당 안내 (다른 사람이 담당)')
  const lee = decode(f.log.mails.find(m => m.to === 'lee@gmail.com').data)
  ok(lee.text.includes('■ 연락 담당: 나! 점심 전에 조원들에게 먼저 연락해 주세요'), '연락 담당 안내 (내가 담당)')
  ok(!kim.text.includes('확인 코드:'), '확인 코드는 메일에 넣지 않음')

  // 2) 다시 실행 → 보낼 사람 없음
  r = await notifyPending({ appUrl, db: d.db, connect: f.connect })
  ok(r.sent === 0 && f.log.mails.length === 2, '같은 사람에게 두 번 보내지 않음')
  f.server.close()

  // 3) 시간 초과 → 남겨 두고 다음 기회에
  f = await fakeSmtp(); d = fakeDb()
  r = await notifyPending({ appUrl, db: d.db, connect: f.connect, budgetMs: -1 })
  ok(r.sent === 0 && r.remaining === 2 && notified(d.st) === 'c', '시간 안에 못 보내면 남은 사람은 기록 안 함(다음에 이어서)')
  f.server.close()

  // 4) Gmail 로그인 실패 → 아무도 기록 안 함
  f = await fakeSmtp({ authOk: false }); d = fakeDb()
  r = await notifyPending({ appUrl, db: d.db, connect: f.connect })
  ok(r.sent === 0 && r.remaining === 2 && notified(d.st) === 'c', 'Gmail 로그인 실패 → 다음 기회에 다시')
  f.server.close()

  // 5) 없는 주소 → 그 사람만 건너뛰고 나머지는 발송
  f = await fakeSmtp({ reject: ['lee@gmail.com'] }); d = fakeDb()
  r = await notifyPending({ appUrl, db: d.db, connect: f.connect })
  ok(r.sent === 1 && r.failed === 1 && notified(d.st) === 'a,b,c', '없는 주소는 건너뛰고(재발송 안 함) 나머지 발송')
  f.server.close()

  // 6) 메일 설정 없음 → 보내지 않고 남겨 둠
  delete process.env.GMAIL_APP_PASSWORD
  d = fakeDb()
  r = await notifyPending({ appUrl, db: d.db })
  ok(r.sent === 0 && r.remaining === 2 && r.mailConfigured === false, '메일 설정이 없으면 남겨 둠')
  process.env.GMAIL_APP_PASSWORD = 'abcd efgh ijkl mnop'

  // 7) 발송 주소 권한
  process.env.CRON_SECRET = 'cron-secret'
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_fake'
  const call = (method, auth, deps) => new Promise(resolve => {
    const res = { code: 0, status(c) { this.code = c; return this }, json(b) { resolve({ code: this.code, body: b }) } }
    endpoint.handler({ method, headers: { authorization: auth, host: 'samil-hankki261005.vercel.app' } }, res, deps)
  })
  const stub = { notifyPending: async () => ({ ok: true, sent: 0, remaining: 0 }), isAdminToken: async t => t === 'admin-token' }
  ok((await call('POST', undefined, stub)).code === 401, '로그인 없이 호출 → 401')
  ok((await call('POST', 'Bearer user-token', stub)).code === 401, '운영자 아닌 계정 → 401')
  ok((await call('POST', 'Bearer admin-token', stub)).code === 200, '운영자 로그인 → 발송')
  ok((await call('GET', 'Bearer cron-secret', stub)).code === 200, 'Vercel Cron(23시 추가 발송) → 발송')
  ok((await call('GET', 'Bearer admin-token', stub)).code === 405, '운영자도 GET은 거부')

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
