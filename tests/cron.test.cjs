// 자동 매칭 서버 함수(api/cron-match.js)를 가짜 Supabase(fetch 가로채기)로 검사
const handler = require('../api/cron-match.js')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m) }

function fakeDb(settings, apps) {
  const calls = []
  global.fetch = async (url, opt) => {
    calls.push({ url, opt })
    const path = url.split('/rest/v1/')[1]
    let body = '[]'
    if (path.startsWith('settings')) body = JSON.stringify([settings])
    else if (path.startsWith('applications')) body = JSON.stringify(apps)
    else if (path.startsWith('rpc/admin_save_matching')) body = '1'
    return { ok: true, status: 200, text: async () => body }
  }
  return calls
}
function call(headers = {}, query = {}) {
  return new Promise(resolve => {
    const res = { code: 0, status(c) { this.code = c; return this }, json(b) { resolve({ code: this.code, body: b }) } }
    handler({ headers, query }, res)
  })
}
const app = (i, slots) => ({ id: 'a' + i, name: 'p' + i, dept: 'Audit', birth_year: '1995', slots, budget: '무관', food_categories: ['한식'],
  spicy: '보통', group_sizes: ['3~4명'], vibe: '둘 다 좋아요', interests: ['독서'], priority: [], avoid: [] })

;(async () => {
  process.env.CRON_SECRET = 'test-secret'
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_fake'
  const base = { auto_on: true, match_time: '22:00', cutoff_min: 60, include_past: false, anchor: '2026-01-01T00:00:00Z', last_auto_run_at: null }
  const apps = [1, 2, 3, 4].map(i => app(i, ['10/16(금) 12:00']))

  fakeDb(base, apps)
  ok((await call({})).code === 401, '비밀값 없이 호출 → 401 거부')
  ok((await call({ authorization: 'Bearer wrong' })).code === 401, '틀린 비밀값 → 401 거부')

  let calls = fakeDb(base, apps)
  let r = await call({ authorization: 'Bearer test-secret' })
  const save = calls.find(c => c.url.includes('rpc/admin_save_matching'))
  const body = save && JSON.parse(save.opt.body)
  ok(r.code === 200 && r.body.ok, '정상 호출 → 200 ' + (r.body.summary || r.body.error))
  ok(body && body.p_auto === true && body.p_groups.length === 1 && body.p_groups[0].memberIds.length === 4, '4명 → 1개 조 저장 요청(자동)')
  ok(save.opt.headers.apikey === 'sb_secret_fake', 'secret key는 서버 요청 헤더에만 사용')

  calls = fakeDb({ ...base, last_auto_run_at: new Date().toISOString() }, apps)
  r = await call({ authorization: 'Bearer test-secret' })
  ok(r.body.skipped && !calls.some(c => c.url.includes('rpc/')), '이미 실행된 회차 → 건너뜀 ' + r.body.skipped)

  calls = fakeDb({ ...base, auto_on: false }, apps)
  r = await call({ authorization: 'Bearer test-secret' })
  ok(r.body.skipped === '자동 매칭 꺼짐', '자동 매칭 꺼짐 → 건너뜀')

  calls = fakeDb({ ...base, auto_on: false }, apps)
  r = await call({ authorization: 'Bearer test-secret' }, { force: '1' })
  const fb = JSON.parse(calls.find(c => c.url.includes('rpc/')).opt.body)
  ok(r.body.ok && fb.p_auto === false && r.body.summary.startsWith('수동'), 'force=1 → 즉시 실행(수동 기록)')

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
