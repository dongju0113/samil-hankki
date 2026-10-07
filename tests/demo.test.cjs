// 심사용 백업 데모의 가짜 저장소(artifact/demo-backend.js)가 실제 서버 규칙대로 동작하는지 검사
const fs = require('fs'), path = require('path'), vm = require('vm')
const root = path.join(__dirname, '..')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m) }

const store = {}
const win = { localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v) }, removeItem: k => { delete store[k] } },
  setTimeout, crypto: require('crypto'), console }
win.window = win
vm.createContext(win)
vm.runInContext(fs.readFileSync(path.join(root, 'matching.js'), 'utf8'), win)
vm.runInContext(fs.readFileSync(path.join(root, 'artifact/demo-backend.js'), 'utf8'), win)
const sb = win.supabase.createClient('x', 'y')
const { DEMO_EMAIL, DEMO_CODE } = win.SamilDemo

;(async () => {
  let r = await sb.rpc('get_my_result', { p_email: DEMO_EMAIL, p_code: DEMO_CODE })
  ok(r.data.ok && r.data.group && r.data.group.members.length === 4, '체험 계정 → 이미 짜인 조(4명) 바로 확인')
  ok(r.data.group.members.some(m => m.name === '이*무') && r.data.group.members.some(m => m.name === '김삼일'), '조원 이름은 가림(이*무), 내 이름은 그대로')
  ok(r.data.group.members.every(m => m.mbti && m.gender && m.birthYear && m.dept && m.email), '조원 정보: MBTI·성별·출생연도·부문·이메일')
  ok(typeof (await sb.rpc('get_waiting_count')).data === 'number', '매칭 대기 인원')
  ok(r.data.group.contactId === r.data.me.id, '체험 계정이 연락 담당으로 시작')
  ok(r.data.me.mbti && r.data.me.birthYear && r.data.me.wantDepts && r.data.me.groupSizes, '내 결과에 내가 입력한 정보 전체 (정보 수정용)')
  ok((await sb.rpc('get_my_result', { p_email: DEMO_EMAIL, p_code: '000000' })).data.ok === false, '틀린 코드 거부')
  ok((await sb.from('applications').select('*')).error, '로그인 전에는 신청 목록 조회 불가 (RLS 흉내)')

  const form = { email: 'judge@example.com', name: '심사위원', birth_year: '1999', gender: '여성', dept: 'Assurance', mbti: 'INTJ', want_genders: ['상관없음'], want_depts: ['Tax'], slots: [r.data.group.slot], group_sizes: ['3~4명'] }
  ok((await sb.rpc('submit_application', { p_form: { ...form, mbti: 'XXXX' }, p_code: null })).data.reason === 'invalid', 'MBTI가 이상하면 거부')
  const sub = (await sb.rpc('submit_application', { p_form: form, p_code: null })).data
  ok(sub.ok && /^\d{6}$/.test(sub.code), '새 신청 → 6자리 코드')
  ok((await sb.rpc('submit_application', { p_form: form, p_code: null })).data.reason === 'exists', '같은 이메일 코드 없이 재신청 → 거부')

  ok((await sb.rpc('respond_attend', { p_email: DEMO_EMAIL, p_code: DEMO_CODE })).data.ok, '참석 응답')
  ok((await sb.rpc('respond_pass', { p_email: DEMO_EMAIL, p_code: DEMO_CODE })).data.ok, '패스 응답')
  r = await sb.rpc('get_my_result', { p_email: DEMO_EMAIL, p_code: DEMO_CODE })
  ok(r.data.ok && r.data.group === null, '패스 후 매칭 대기')
  const st0 = win.SamilDemo._state()
  ok(st0.groups.every(g => st0.members.some(m => m.group_id === g.id && m.application_id === g.contact_id)), '모든 조의 연락 담당은 그 조의 조원 (담당이 패스하면 다시 지목)')

  await sb.auth.signInWithPassword({ email: 'admin@demo', password: 'x' })
  ok((await sb.rpc('is_admin')).data === true, '운영자 로그인 (데모)')
  const apps = (await sb.from('applications').select('*').order('created_at', { ascending: false })).data
  const groups = (await sb.from('groups').select('*').order('no')).data
  ok(apps.length >= 25 && groups.length >= 2, `샘플 신청 ${apps.length}명 · 조 ${groups.length}개`)
  const st = (await sb.from('settings').select('*').eq('id', 1).single()).data
  ok(st.match_time === '22:00' && st.last_run_summary, '설정·마지막 실행 기록 있음')

  // 운영자 화면과 같은 계산으로 매칭 실행 → 저장
  const members = (await sb.from('group_members').select('*').order('seq')).data
  const M = win.SamilMatching
  const gm = groups.map(g => ({ id: g.id, slot: g.slot, locked: g.locked, memberIds: members.filter(m => m.group_id === g.id).map(m => m.application_id), responses: {} }))
  const res = M.computeMatching({ responses: apps.map(a => ({ id: a.id, slots: a.slots, groupSizes: a.group_sizes, interests: a.interests, foodCategories: a.food_categories, avoid: a.avoid, priority: a.priority, dept: a.dept })), groups: gm,
    settings: { cutoffMin: 60, includePast: false }, now: new Date() })
  const saved = await sb.rpc('admin_save_matching', { p_groups: res.newGroups, p_joins: res.joins, p_summary: res.summary, p_auto: false })
  ok(!saved.error, '지금 매칭 실행 결과 저장')

  ok(!(await sb.from('groups').update({ locked: true }).eq('id', groups[0].id)).error, '강제 확정')
  ok(!(await sb.from('groups').delete().eq('id', groups[0].id)).error, '조 해체')
  ok(!(await sb.rpc('admin_clear', { p_applications: false })).error && (await sb.from('groups').select('*')).data.length === 0, '편성 초기화')

  win.SamilDemo.reset()
  r = await sb.rpc('get_my_result', { p_email: DEMO_EMAIL, p_code: DEMO_CODE })
  ok(r.data.group && r.data.group.members.length === 4, '데모 처음 상태로 되돌리기')

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
