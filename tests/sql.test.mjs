import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import fs from 'fs'
const db = new PGlite({ extensions: { pgcrypto } })
// supabase/*.sql을 메모리 속 Postgres(PGlite)에 실행해 RLS·함수 동작을 검사
const PROJ = new URL('../supabase/', import.meta.url)
const schema = fs.readFileSync(new URL('01_schema.sql', PROJ), 'utf8')
const addAdmin = fs.readFileSync(new URL('02_add_admin.sql', PROJ), 'utf8').replace(/lower\('[^']*'\)/, "lower('admin@test.com')")
// Supabase 흉내: 역할, auth 스키마, extensions 스키마
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema extensions; create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  grant usage on schema public, auth, extensions to anon, authenticated, service_role;
  grant all on all tables in schema public to service_role;
  grant execute on function auth.uid() to anon, authenticated;
  insert into auth.users (email) values ('admin@test.com'), ('notadmin@test.com');
`)
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m) }
const q = async (sql, p) => (await db.query(sql, p)).rows
const tryq = async (sql, p) => { try { return { rows: await q(sql, p) } } catch (e) { return { err: e.message } } }
const as = async (role, sub = '', claimRole = role) => { await db.exec(`reset role; select set_config('request.jwt.sub', '${sub}', false); select set_config('request.jwt.claims', '{"role":"${claimRole}"}', false); set role ${role};`) }
const r = async (sql, p) => (await q(sql, p))[0].r

await db.exec(schema); await db.exec(schema)
console.log('schema x2 OK'); await db.exec(addAdmin)
const [{ id: adminId }] = await q(`select id from auth.users where email='admin@test.com'`)
const [{ id: userId }] = await q(`select id from auth.users where email='notadmin@test.com'`)

const form = (email, extra = {}) => JSON.stringify({ email, name: '홍길동', birth_year: '1998', gender: '응답 안 함', dept: 'Audit', dept_open: true,
  slots: ['10/7(수) 12:00', '10/8(목) 12:00'], budget: '무관', food_categories: ['한식'], spicy: '보통', group_sizes: ['3~4명'], vibe: '둘 다 좋아요',
  interests: ['독서'], favorite_thing: '', priority: ['관심사'], allergy: '', ...extra })
const submit = (f, code = null) => r(`select public.submit_application($1::jsonb, $2) r`, [f, code])

console.log('\n[신청자 anon]')
await as('anon')
const r1 = await submit(form('A@Naver.com'))
ok(r1.ok && /^\d{6}$/.test(r1.code), 'A 신청 → 6자리 코드 ' + r1.code)
const rB = await submit(form('b@gmail.com', { dept: 'Tax', dept_open: false, interests: ['독서', '골프'] }))
const rC = await submit(form('c@gmail.com', { dept: 'Deal' }))
ok((await submit(form('a@naver.com'))).reason === 'exists', '같은 이메일 코드 없이 재신청 → exists')
ok((await submit(form('a@naver.com'), '000000')).reason === 'exists', '같은 이메일 틀린 코드 → exists')
ok((await submit(form('bad'))).reason === 'invalid', '잘못된 이메일 → invalid')
ok((await submit(form('d@gmail.com', { slots: [] }))).reason === 'invalid', '시간 0칸 → invalid')
for (const t of ['applications', 'groups', 'group_members', 'admins']) ok(!!(await tryq(`select * from public.${t}`)).err, `anon ${t} 직접 읽기 차단`)
ok(!!(await tryq(`insert into public.applications (email, code, name) values ('x@x.com','123456','x')`)).err, 'anon 직접 insert 차단')
ok(!!(await tryq(`select public.admin_clear(true)`)).err, 'anon admin_clear 실행 차단')
ok(!!(await tryq(`select public._verify_applicant('a@naver.com','1')`)).err, 'anon 내부 함수 실행 차단')
ok((await q(`select match_time from public.settings`))[0].match_time === '22:00', 'anon settings 읽기 가능')
await tryq(`update public.settings set match_time='01:00'`)
await as('authenticated', adminId)
ok((await q(`select match_time from public.settings`))[0].match_time === '22:00', 'anon settings 수정 불가')
await as('anon')
let res = await r(`select public.get_my_result('a@naver.com', $1) r`, [r1.code])
ok(res.ok && res.group === null && res.me.name === '홍길동', '내 결과(조 없음) 조회')
ok((await r(`select public.get_my_result('a@naver.com', '111111') r`)).ok === false, '틀린 코드 → 실패')

console.log('\n[운영자 아닌 로그인 계정]')
await as('authenticated', userId)
ok((await r(`select public.is_admin() r`)) === false, 'is_admin = false')
ok((await q(`select count(*)::int n from public.applications`))[0].n === 0, '신청 목록 0건으로 보임')
ok(!!(await tryq(`select public.admin_clear(true)`)).err, 'admin_clear 거부')

console.log('\n[운영자]')
await as('authenticated', adminId)
const apps = await q(`select id, email from public.applications order by email`)
ok(apps.length === 3, '전체 신청 3건 조회')
const id = e => apps.find(a => a.email === e).id
const save = (groups, joins = []) => r(`select public.admin_save_matching($1::jsonb, $2::jsonb, '테스트', false) r`, [JSON.stringify(groups), JSON.stringify(joins)])
ok((await save([{ slot: '10/7(수) 12:00', memberIds: [id('a@naver.com'), id('b@gmail.com')] }])) === 1, '매칭 저장 → 새 조 1개')
const g = (await q(`select * from public.groups`))[0]
await save([], [{ groupId: g.id, memberId: id('c@gmail.com') }])
ok(g.no === 1 && (await q(`select next_no from public.settings`))[0].next_no === 2, '조 번호 1, next_no 2 (합류만 있으면 번호 안 늘어남)')
ok((await q(`select array_agg(m.email order by gm.seq) e from public.group_members gm join public.applications m on m.id=gm.application_id`))[0].e.join() === 'a@naver.com,b@gmail.com,c@gmail.com', '조원 순서 유지 + 기존 조 합류')
ok(!!(await tryq(`select public.admin_save_matching($1::jsonb, '[]', 'x', false)`, [JSON.stringify([{ slot: '10/8(목) 12:00', memberIds: [id('a@naver.com')] }])])).err, '이미 조가 있는 사람 중복 배정 차단')
ok((await q(`update public.settings set include_past = true where id = 1 returning include_past`))[0].include_past === true, '설정 수정(테스트 모드 켬)')

console.log('\n[신청자: 결과·참석·패스]')
await as('anon')
res = await r(`select public.get_my_result('a@naver.com', $1) r`, [r1.code])
ok(res.group && res.group.no === 1 && res.group.members.length === 3, '내 조 조회 (3명)')
const bm = res.group.members.find(m => m.email === 'b@gmail.com')
ok(bm.dept === '' && res.group.deptCount === 3, '비공개 부문은 숨김, 부문 수는 3')
ok(!JSON.stringify(res).includes(rB.code) && !JSON.stringify(res).includes(rC.code), '다른 조원 확인 코드 노출 없음')
ok((await r(`select public.respond_attend('a@naver.com', $1) r`, [r1.code])).ok, 'A 참석')
ok((await r(`select public.respond_attend('b@gmail.com', '000000') r`)).ok === false, '틀린 코드로 참석 거부')
ok((await r(`select public.respond_pass('c@gmail.com', $1) r`, [rC.code])).ok, 'C 패스')
await as('authenticated', adminId)
ok((await q(`select avoid from public.applications where email='c@gmail.com'`))[0].avoid.length === 2, 'C의 avoid에 A, B 기록')
ok((await q(`select count(*)::int n from public.group_members`))[0].n === 2, '조에 2명 남음')
ok((await q(`select response from public.group_members where application_id=$1`, [id('a@naver.com')]))[0].response === 'yes', 'A 응답=yes')
await as('anon')
ok((await r(`select public.respond_pass('b@gmail.com', $1) r`, [rB.code])).ok, 'B 패스 → 1명 남음')
await as('authenticated', adminId)
ok((await q(`select count(*)::int n from public.groups`))[0].n === 0, '1명 남은 조는 해체되어 A도 대기')

console.log('\n[재신청 / 마감 / 잠금]')
await q(`update public.settings set include_past = false where id = 1`)
await save([{ slot: '10/1(목) 12:00', memberIds: [id('a@naver.com'), id('b@gmail.com')] }])
await save([{ slot: '12/30(수) 12:00', memberIds: [id('c@gmail.com')] }])
await as('anon')
ok((await r(`select public.respond_attend('a@naver.com', $1) r`, [r1.code])).reason === 'closed', '마감 지난 조 → 참석 거부(closed)')
ok((await r(`select public.respond_attend('c@gmail.com', $1) r`, [rC.code])).ok, '마감 전 조 → 참석 OK')
const re = await submit(form('a@naver.com', { name: '홍길동2' }), r1.code)
ok(re.ok && re.code === r1.code, '맞는 코드로 재신청 → 코드 유지')
await as('authenticated', adminId)
ok((await q(`select count(*)::int n from public.group_members where application_id=$1`, [id('a@naver.com')]))[0].n === 0, '재신청 시 기존 조에서 빠짐')
ok((await q(`select avoid from public.applications where email='c@gmail.com'`))[0].avoid.length === 2, 'avoid 유지')
await as('anon')
let last
for (let i = 0; i < 10; i++) last = await r(`select public.get_my_result('b@gmail.com', '000000') r`)
ok(last.locked === true, '10번 틀리면 잠금')
ok((await r(`select public.get_my_result('b@gmail.com', $1) r`, [rB.code])).locked === true, '잠금 중에는 맞는 코드도 거부')

console.log('\n[운영자 이동/초기화]')
await as('authenticated', adminId)
await q(`select public.admin_clear(false)`)
await save([{ slot: '10/8(목) 12:00', memberIds: [id('a@naver.com')] }])
const gid = (await q(`select id from public.groups where slot='10/8(목) 12:00'`))[0].id
await q(`select public.admin_move_member($1, $2)`, [id('c@gmail.com'), gid])
ok((await q(`select count(*)::int n from public.group_members where group_id=$1`, [gid]))[0].n === 2, '조원 이동(넣기)')
await q(`select public.admin_move_member($1, null)`, [id('a@naver.com')]); await q(`select public.admin_move_member($1, null)`, [id('c@gmail.com')])
ok((await q(`select count(*)::int n from public.groups where id=$1`, [gid]))[0].n === 0, '빈 조 자동 삭제')
await q(`select public.admin_clear(false)`)
ok((await q(`select count(*)::int n from public.applications`))[0].n === 3 && (await q(`select next_no from public.settings`))[0].next_no === 1, '편성 초기화(신청 유지)')
await q(`select public.admin_clear(true)`)
ok((await q(`select count(*)::int n from public.applications`))[0].n === 0, '응답 전체 삭제')


console.log('\n[서버 자동 매칭 service_role]')
await db.exec(`reset role;`); await db.exec(fs.readFileSync(new URL('03_allow_cron.sql', PROJ), 'utf8')); console.log('  03 재실행 OK')
await db.exec(`reset role; grant all on all tables in schema public to service_role;`)
await as('anon')
await submit(form('s@gmail.com'))
await as('service_role', '', 'service_role')
const sid2 = (await q(`select id from public.applications where email='s@gmail.com'`))[0].id
ok((await r(`select public.admin_save_matching($1::jsonb, '[]', '자동 테스트', true) r`, [JSON.stringify([{ slot: '10/9(금) 12:00', memberIds: [sid2] }])])) === 1, 'service_role로 매칭 저장 가능')
ok((await q(`select last_auto_run_at is not null as v from public.settings`))[0].v, '자동 실행 시각 기록')
await as('authenticated', userId, 'authenticated')
ok(!!(await tryq(`select public.admin_save_matching('[]', '[]', 'x', true)`)).err, '운영자 아닌 계정은 여전히 거부')
await as('anon', '', 'anon')
ok(!!(await tryq(`select public.admin_save_matching('[]', '[]', 'x', true)`)).err, 'anon은 여전히 거부')
await as('anon', '', 'service_role')
ok(!!(await tryq(`select public.admin_save_matching('[]', '[]', 'x', true)`)).err, 'anon이 claim만 위조해도 실행 권한 없음')
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
