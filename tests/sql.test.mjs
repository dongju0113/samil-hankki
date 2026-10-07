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

const form = (email, extra = {}) => JSON.stringify({ email, name: '홍길동', birth_year: '1998', gender: '남성', dept: 'Assurance', mbti: 'ENFP',
  want_genders: ['상관없음'], want_depts: ['Tax', 'Deal'], slots: ['12/28(월) 12:00', '12/29(화) 12:00'], group_sizes: ['3~4명'], ...extra })
const submit = (f, code = null) => r(`select public.submit_application($1::jsonb, $2) r`, [f, code])

console.log('\n[신청자 anon]')
await as('anon')
const r1 = await submit(form('A@Naver.com'))
ok(r1.ok && /^\d{6}$/.test(r1.code), 'A 신청 → 6자리 코드 ' + r1.code)
const rB = await submit(form('b@gmail.com', { name: '이세무', dept: 'Tax', gender: '여성', mbti: 'INFP' }))
const rC = await submit(form('c@gmail.com', { dept: 'Deal' }))
ok((await submit(form('a@naver.com'))).reason === 'exists', '같은 이메일 코드 없이 재신청 → exists')
ok((await submit(form('a@naver.com'), '000000')).reason === 'exists', '같은 이메일 틀린 코드 → exists')
ok((await submit(form('bad'))).reason === 'invalid', '잘못된 이메일 → invalid')
ok((await submit(form('d@gmail.com', { slots: [] }))).reason === 'invalid', '시간 0칸 → invalid')
for (const [bad, why] of [[{ mbti: 'XXXX' }, 'MBTI 이상'], [{ gender: '응답 안 함' }, '성별 미선택'], [{ birth_year: '' }, '출생연도 미선택'],
  [{ want_genders: [] }, '원하는 성별 없음'], [{ want_depts: ['영업'] }, '없는 부문'], [{ dept: '' }, '부문 없음'], [{ group_sizes: ['10명'] }, '없는 인원']])
  ok((await submit(form('e@gmail.com', bad))).reason === 'invalid', `${why} → invalid`)
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
await db.exec(`reset role; update public.settings set include_past = true where id = 1;`); await as('anon')
ok((await r(`select public.get_waiting_count() r`)) === 3, '신청자(anon)도 매칭 대기 인원(숫자만) 조회 가능: 3명')
await db.exec(`reset role; update public.settings set include_past = false where id = 1;`); await as('anon')
const pastOnly = await submit(form('past@gmail.com', { slots: ['10/1(목) 12:00'] }))
ok(pastOnly.ok && (await r(`select public.get_waiting_count() r`)) === 3, '마감 지난 시간만 고른 사람은 대기 인원에서 제외 (4명 중 3명)')
await db.exec(`reset role; delete from public.applications where email = 'past@gmail.com';`); await as('anon')
ok(!!(await tryq(`select public._mask_name('홍길동')`)).err, 'anon 내부 함수(_mask_name) 실행 차단')

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
ok((await save([{ slot: '12/28(월) 12:00', memberIds: [id('a@naver.com'), id('b@gmail.com')] }])) === 1, '매칭 저장 → 새 조 1개')
const g = (await q(`select * from public.groups`))[0]
await save([], [{ groupId: g.id, memberId: id('c@gmail.com') }])
ok(g.no === 1 && (await q(`select next_no from public.settings`))[0].next_no === 2, '조 번호 1, next_no 2 (합류만 있으면 번호 안 늘어남)')
ok((await q(`select array_agg(m.email order by gm.seq) e from public.group_members gm join public.applications m on m.id=gm.application_id`))[0].e.join() === 'a@naver.com,b@gmail.com,c@gmail.com', '조원 순서 유지 + 기존 조 합류')
ok(!!(await tryq(`select public.admin_save_matching($1::jsonb, '[]', 'x', false)`, [JSON.stringify([{ slot: '12/29(화) 12:00', memberIds: [id('a@naver.com')] }])])).err, '이미 조가 있는 사람 중복 배정 차단')
ok((await q(`update public.settings set include_past = true where id = 1 returning include_past`))[0].include_past === true, '설정 수정(테스트 모드 켬)')

console.log('\n[신청자: 결과·참석·패스]')
await as('anon')
res = await r(`select public.get_my_result('a@naver.com', $1) r`, [r1.code])
ok(res.group && res.group.no === 1 && res.group.members.length === 3, '내 조 조회 (3명)')
const bm = res.group.members.find(m => m.email === 'b@gmail.com')
ok(bm.name === '이*무' && res.group.members.find(m => m.email === 'a@naver.com').name === '홍길동', '조원 이름은 가림(이*무), 내 이름은 그대로')
ok(bm.dept === 'Tax' && bm.mbti === 'INFP' && bm.gender === '여성' && bm.birthYear === '1998', '조원 정보: 부문·MBTI·성별·출생연도')
ok(!JSON.stringify(res).includes('이세무'), '조원 실명은 브라우저로 안 내려감')
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
await save([{ slot: '12/29(화) 12:00', memberIds: [id('a@naver.com')] }])
const gid = (await q(`select id from public.groups where slot='12/29(화) 12:00'`))[0].id
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
ok((await q(`select count(*)::int n from information_schema.columns where table_name='group_members' and column_name='notified_at'`))[0].n === 1, '매칭 메일 발송 기록 칸(notified_at) 있음')
await db.exec(`reset role;`); await db.exec(fs.readFileSync(new URL('04_match_mail.sql', PROJ), 'utf8')); await db.exec(fs.readFileSync(new URL('04_match_mail.sql', PROJ), 'utf8'))
ok((await q(`select count(*)::int n from public.group_members where notified_at is null`))[0].n === 0, '04 실행: 기존 조원은 발송한 것으로 처리 (두 번 실행해도 OK)')
await db.exec(`reset role;`); await db.exec(fs.readFileSync(new URL('05_redesign.sql', PROJ), 'utf8')); await db.exec(fs.readFileSync(new URL('05_redesign.sql', PROJ), 'utf8'))
ok((await q(`select public._mask_name('최동주') a, public._mask_name('김철') b, public._mask_name('남궁민수') c`))[0].a === '최*주', '05 실행(두 번 OK) + 이름 가리기 최*주')
await db.exec(`reset role; grant all on all tables in schema public to service_role;`)
await as('anon')
await submit(form('s@gmail.com'))
await as('service_role', '', 'service_role')
const sid2 = (await q(`select id from public.applications where email='s@gmail.com'`))[0].id
ok((await r(`select public.admin_save_matching($1::jsonb, '[]', '자동 테스트', true) r`, [JSON.stringify([{ slot: '12/30(수) 12:00', memberIds: [sid2] }])])) === 1, 'service_role로 매칭 저장 가능')
ok((await q(`select last_auto_run_at is not null as v from public.settings`))[0].v, '자동 실행 시각 기록')
await as('authenticated', userId, 'authenticated')
ok(!!(await tryq(`select public.admin_save_matching('[]', '[]', 'x', true)`)).err, '운영자 아닌 계정은 여전히 거부')
await as('anon', '', 'anon')
ok(!!(await tryq(`select public.admin_save_matching('[]', '[]', 'x', true)`)).err, 'anon은 여전히 거부')
await as('anon', '', 'service_role')
ok(!!(await tryq(`select public.admin_save_matching('[]', '[]', 'x', true)`)).err, 'anon이 claim만 위조해도 실행 권한 없음')

console.log('\n[조 연락 담당]')
await db.exec(`reset role;`); await db.exec(fs.readFileSync(new URL('06_contact.sql', PROJ), 'utf8')); await db.exec(fs.readFileSync(new URL('06_contact.sql', PROJ), 'utf8'))
console.log('  06 두 번 실행 OK')
await db.exec(`reset role; delete from public.groups where true; delete from public.applications where true;`)
await as('anon')
for (const n of ['p1', 'p2', 'p3', 'p4', 'p5']) { await submit(form(`${n}@gmail.com`, { name: n })) }
await db.exec(`reset role;`)
const ids = (await q(`select id, email from public.applications order by email`)).map(x => x.id)
await as('authenticated', adminId)
const contactOf = async cgid => (await q(`select contact_id from public.groups where id = $1`, [cgid]))[0].contact_id
const firsts = new Set()
for (let k = 0; k < 12; k++) {
  await q(`select public.admin_clear(false)`)
  await q(`select public.admin_save_matching($1::jsonb, '[]', 'x', false)`, [JSON.stringify([{ slot: '12/30(수) 12:00', memberIds: ids.slice(0, 4) }])])
  firsts.add(await contactOf((await q(`select id from public.groups`))[0].id))
}
ok([...firsts].every(c => ids.slice(0, 4).includes(c)), '연락 담당은 항상 그 조의 조원')
ok(firsts.size > 1, `무작위로 지목 (12번 중 서로 다른 담당 ${firsts.size}명)`)
const cgid = (await q(`select id from public.groups`))[0].id
const c0 = await contactOf(cgid)
await q(`select public.admin_save_matching('[]', $1::jsonb, 'x', false)`, [JSON.stringify([{ groupId: cgid, memberId: ids[4] }])])
ok((await contactOf(cgid)) === c0, '새 조원이 합류해도 담당은 그대로')
await q(`select public.admin_move_member($1, null)`, [c0])
const c1 = await contactOf(cgid)
ok(!!c1 && c1 !== c0 && (await q(`select count(*)::int n from public.group_members where group_id = $1 and application_id = $2`, [cgid, c1]))[0].n === 1, '담당이 조에서 빠지면 남은 조원 중 다시 지목')
await db.exec(`reset role;`)
const c1row = (await q(`select email, code from public.applications where id = $1`, [c1]))[0]
await as('anon')
const res2 = await r(`select public.get_my_result($1, $2) r`, [c1row.email, c1row.code])
ok(res2.group.contactId === c1, '결과 조회에 연락 담당(contactId) 포함')
ok((await r(`select public.respond_pass($1, $2) r`, [c1row.email, c1row.code])).ok, '담당이 패스')
await as('authenticated', adminId)
const c2 = await contactOf(cgid)
ok(!!c2 && c2 !== c1, '담당이 패스하면 남은 조원 중 다시 지목')
await as('anon')
ok(!!(await tryq(`select public._ensure_contact($1)`, [cgid])).err, 'anon 내부 함수(_ensure_contact) 실행 차단')

console.log('\n[부문 이름 Audit → Assurance]')
await db.exec(`reset role; delete from public.groups where true; delete from public.applications where true;`)
await db.exec(`reset role; insert into public.applications (email, code, name, dept, want_depts) values ('old@gmail.com', '123456', '예전', 'Audit', '{Audit,Tax}');`)
await db.exec(fs.readFileSync(new URL('07_assurance.sql', PROJ), 'utf8')); await db.exec(fs.readFileSync(new URL('07_assurance.sql', PROJ), 'utf8'))
const old = (await q(`select dept, want_depts from public.applications where email = 'old@gmail.com'`))[0]
ok(old.dept === 'Assurance' && old.want_depts.join() === 'Assurance,Tax', '07 실행(두 번 OK): 기존 신청 Audit → Assurance')
await as('anon')
ok((await submit(form('new1@gmail.com', { dept: 'Assurance', want_depts: ['Assurance'] }))).ok, 'Assurance로 신청 가능')
ok((await submit(form('new2@gmail.com', { dept: 'Audit', want_depts: ['Audit', 'Deal'] }))).ok, '예전 화면이 보낸 Audit도 신청은 성공')
await db.exec(`reset role;`)
const n2 = (await q(`select dept, want_depts from public.applications where email = 'new2@gmail.com'`))[0]
ok(n2.dept === 'Assurance' && n2.want_depts.join() === 'Assurance,Deal', '…Audit은 Assurance로 바꿔 저장')
await as('anon')
ok((await submit(form('new3@gmail.com', { dept: '영업' }))).reason === 'invalid', '없는 부문은 거부')

console.log('\n[08: 희망 인원 5~6명 · 내 정보 · 응답 마감 후 자동 취소]')
await db.exec(`reset role; delete from public.groups where true; delete from public.applications where true;`)
await db.exec(`reset role; insert into public.applications (email, code, name, group_sizes) values ('legacy@gmail.com', '111111', '예전', '{5명~,2명}');`)
await db.exec(fs.readFileSync(new URL('08_feedback.sql', PROJ), 'utf8')); await db.exec(fs.readFileSync(new URL('08_feedback.sql', PROJ), 'utf8'))
ok((await q(`select group_sizes from public.applications where email = 'legacy@gmail.com'`))[0].group_sizes.join() === '5~6명,2명', "08 실행(두 번 OK): 예전 '5명~' → '5~6명'")
await as('anon')
ok((await submit(form('s56@gmail.com', { group_sizes: ['5~6명'] }))).ok, '5~6명으로 신청 가능')
ok((await submit(form('s5p@gmail.com', { group_sizes: ['5명~'] }))).ok, "예전 화면의 '5명~'도 신청 성공")
await db.exec(`reset role;`)
ok((await q(`select group_sizes from public.applications where email = 's5p@gmail.com'`))[0].group_sizes.join() === '5~6명', "…'5~6명'으로 저장")
await as('anon')
ok((await submit(form('s10@gmail.com', { group_sizes: ['10명'] }))).reason === 'invalid', '없는 인원은 거부')
const pa = await submit(form('pa@gmail.com', { name: '가나', mbti: 'INTJ', want_depts: ['Tax'] }))
const pb = await submit(form('pb@gmail.com', { name: '나다' }))
const pc = await submit(form('pc@gmail.com', { name: '다라' }))
const meInfo = (await r(`select public.get_my_result('pa@gmail.com', $1) r`, [pa.code])).me
ok(meInfo.mbti === 'INTJ' && meInfo.birthYear === '1998' && meInfo.gender === '남성' && meInfo.dept === 'Assurance'
  && meInfo.wantDepts.join() === 'Tax' && meInfo.groupSizes.join() === '3~4명' && meInfo.slots.length === 2, '내 결과에 내가 입력한 정보 전체 (정보 수정·확인 메일용)')
await db.exec(`reset role;`)
const pid = async e => (await q(`select id from public.applications where email = $1`, [e]))[0].id
const [ida, idb, idc] = [await pid('pa@gmail.com'), await pid('pb@gmail.com'), await pid('pc@gmail.com')]
// 이미 지난 10/1 12:00 조 (응답 마감 지남): 가나·나다 참석, 다라 미응답
await as('authenticated', adminId)
await q(`select public.admin_save_matching($1::jsonb, '[]', 'x', false)`, [JSON.stringify([{ slot: '10/1(목) 12:00', memberIds: [ida, idb, idc] }])])
await db.exec(`reset role;`)
await q(`update public.group_members set response = 'yes' where application_id in ($1, $2)`, [ida, idb])
const rel = async id => (await q(`select public._is_released($1) v`, [id]))[0].v
ok(!(await rel(ida)) && (await rel(idc)), '마감 후: 참석한 가나는 그대로, 미응답 다라는 자동 취소')
await as('anon')
ok((await r(`select public.get_waiting_count() r`)) >= 1, '자동 취소된 다라는 매칭 대기 인원에 포함')
await as('authenticated', adminId)
ok(!(await tryq(`select public.admin_save_matching($1::jsonb, '[]', 'x', false)`, [JSON.stringify([{ slot: '12/29(화) 12:00', memberIds: [idc, await pid('s56@gmail.com')] }])])).err, '자동 취소된 다라를 새 조에 넣을 수 있음')
await db.exec(`reset role;`)
ok((await q(`select count(*)::int n from public.group_members gm join public.groups g on g.id = gm.group_id where gm.application_id = $1 and g.slot = '12/29(화) 12:00'`, [idc]))[0].n === 1, '…다라는 새 조로 옮겨짐')
ok((await q(`select count(*)::int n from public.group_members gm join public.groups g on g.id = gm.group_id where g.slot = '10/1(목) 12:00'`))[0].n === 2, '…예전 조에는 참석한 2명만 남음')
await as('authenticated', adminId)
ok(!!(await tryq(`select public.admin_save_matching($1::jsonb, '[]', 'x', false)`, [JSON.stringify([{ slot: '12/29(화) 12:00', memberIds: [ida, idb] }])])).err, '참석해서 확정된 사람은 다른 조에 중복 배정 안 됨')
await as('anon')
ok(!!(await tryq(`select public._is_released($1)`, [ida])).err, 'anon 내부 함수(_is_released) 실행 차단')
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
