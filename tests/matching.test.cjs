// 매칭 규칙(matching.js) 핵심 동작 검사 — MBTI 50% · 성별 25% · 부문 25%
require('../matching.js')
const M = globalThis.SamilMatching
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m) }

const now = new Date('2026-10-05T03:00:00Z') // 한국 시간 10/5(월) 12:00
const settings = { autoOn: true, time: '22:00', cutoffMin: 60, includePast: false }
const person = (id, slots, extra = {}) => ({ id, name: id, dept: 'Assurance', gender: '남성', birthYear: '1998', mbti: 'ENFP', slots,
  groupSizes: ['3~4명'], wantGenders: ['상관없음'], wantDepts: ['상관없음'], avoid: [], ...extra })

// 일정표: 오늘 포함 7일, 한국 시간 기준
const days = M.dayWindow(now)
ok(days.length === 7 && days[0] === '10/5(월)' && days[6] === '10/11(일)', '일정표 = 오늘 포함 7일 ' + days[0] + '~' + days[6])
ok(M.dayWindow(new Date('2026-10-05T15:00:00Z'))[0] === '10/6(화)', '한국 시간 자정에 날짜가 넘어감')
ok(M.slotDate('10/7(수) 12:00').toISOString() === '2026-10-07T03:00:00.000Z', '"10/7(수) 12:00" = 한국 시간 정오')

// 이름 가리기
ok(M.maskName('최동주') === '최*주' && M.maskName('김철') === '김*' && M.maskName('남궁민수') === '남**수' && M.maskName('A') === 'A', '이름 가리기: 최*주 · 김* · 남**수')

// 점수: MBTI 50 + 성별 25 + 부문 25
const a = person('a', [], { gender: '남성', dept: 'Assurance', wantGenders: ['여성'], wantDepts: ['Tax'] })
const b = person('b', [], { gender: '여성', dept: 'Tax', wantGenders: ['남성'], wantDepts: ['Assurance'] })
ok(M.pairScore(a, b) === 43 + 50, `ENFP끼리 궁합 86점의 절반 43 + 서로 원하는 성별·부문 50 → 93점 (${M.pairScore(a, b)})`)
const c = person('c', [], { gender: '남성', dept: 'Assurance', wantGenders: ['남성'], wantDepts: ['Assurance'] })
ok(M.pairScore(a, c) === 43 + 12.5 + 12.5, `a는 c가 안 맞고 c는 a가 맞음 → 성별 12.5 + 부문 12.5 + MBTI 43 (${M.pairScore(a, c)})`)
ok(M.pairScore(person('x', []), person('y', [])) === 93, '"상관없음"끼리는 성별·부문 만점')
ok(M.mbtiScore('INFP', 'ENTJ') === 100 && M.mbtiScore('ESFP', 'ISTJ') === 100 && M.mbtiScore('ESFP', 'ENFP') === 71, '팀 궁합표 반영 (INFP-ENTJ 100, ESFP-ENFP 71)')
ok(M.pairScore(person('x', [], { mbti: 'INFP' }), person('y', [], { mbti: 'ENTJ' })) === 100, '최고 궁합 + 성별·부문 만점 → 100점')
const T = M.MBTI_TYPES
ok(T.every(x => T.every(y => M.mbtiScore(x, y) === M.mbtiScore(y, x))) && T.length === 16, '궁합표 16×16, 순서 바꿔도 같음')
ok(M.mbtiAverage(['ENFP', 'INTJ', 'ISTJ']) === 85 && M.mbtiAverage(['ENFP']) === null, 'MBTI 평균 궁합 (100·85·71 → 85)')
// MBTI가 갈리는 상황: 다른 조건이 같으면 궁합 높은 사람과 묶임
let rr = M.computeMatching({ responses: [
  person('me', ['10/9(금) 12:00'], { groupSizes: ['2명'], mbti: 'INFP' }),
  person('lo', ['10/9(금) 12:00'], { groupSizes: ['2명'], mbti: 'ISFP' }),
  person('hi', ['10/9(금) 12:00'], { groupSizes: ['2명'], mbti: 'ENTJ' }),
  person('zz', ['10/9(금) 12:00'], { groupSizes: ['2명'], mbti: 'ISFP' })
], groups: [], settings, now })
ok(rr.newGroups.find(g => g.memberIds.includes('me')).memberIds.includes('hi'), 'MBTI 궁합 높은 사람(ENTJ)과 묶임')

// 같은 칸을 고른 4명 → 한 조
let r = M.computeMatching({ responses: ['a', 'b', 'c', 'd'].map(id => person(id, ['10/7(수) 12:00'])), groups: [], settings, now })
ok(r.newGroups.length === 1 && r.newGroups[0].memberIds.length === 4, '같은 시간 4명 → 1개 조')

// 마감(60분 전) 지난 칸은 매칭 안 함
r = M.computeMatching({ responses: ['a', 'b', 'c'].map(id => person(id, ['10/5(월) 12:30'])), groups: [], settings, now })
ok(r.newGroups.length === 0, '마감(점심 60분 전) 지난 칸은 매칭 안 함')

// 이미 조가 있는 사람은 건드리지 않음
r = M.computeMatching({ responses: ['a', 'b', 'c'].map(id => person(id, ['10/8(목) 12:00'])),
  groups: [{ id: 'G1', slot: '10/8(목) 12:00', locked: true, memberIds: ['a', 'b'], responses: {} }], settings, now })
ok(r.newGroups.length === 0 && r.joins.length === 0, '강제 확정된 조는 그대로, 혼자 남은 사람은 대기')

// 원하는 성별: 여성만 원하는 사람은 여성과 묶임 (2명 조)
const two = { groupSizes: ['2명'] }
r = M.computeMatching({ responses: [
  person('me', ['10/9(금) 12:00'], { ...two, gender: '여성', wantGenders: ['여성'] }),
  person('m1', ['10/9(금) 12:00'], { ...two, gender: '남성', wantGenders: ['여성'] }),
  person('f1', ['10/9(금) 12:00'], { ...two, gender: '여성', wantGenders: ['여성'] }),
  person('m2', ['10/9(금) 12:00'], { ...two, gender: '남성', wantGenders: ['남성'] })
], groups: [], settings, now })
let mine = r.newGroups.find(g => g.memberIds.includes('me'))
ok(mine && mine.memberIds.includes('f1'), '원하는 성별(여성) 반영 → 여성 조원과 묶임')

// 원하는 부문: Tax를 원하면 Tax와 묶임
r = M.computeMatching({ responses: [
  person('me', ['10/9(금) 12:00'], { ...two, dept: 'Assurance', wantDepts: ['Tax'] }),
  person('d1', ['10/9(금) 12:00'], { ...two, dept: 'Deal', wantDepts: ['Deal'] }),
  person('t1', ['10/9(금) 12:00'], { ...two, dept: 'Tax', wantDepts: ['Assurance'] }),
  person('d2', ['10/9(금) 12:00'], { ...two, dept: 'Deal', wantDepts: ['Deal'] })
], groups: [], settings, now })
mine = r.newGroups.find(g => g.memberIds.includes('me'))
ok(mine && mine.memberIds.includes('t1'), '원하는 부문(Tax) 반영 → Tax 조원과 묶임')

// 패스해도 같은 사람과 다시 만날 수 있음 (제한 없음)
r = M.computeMatching({ responses: [person('a', ['10/9(금) 12:00'], { avoid: ['b'] }), person('b', ['10/9(금) 12:00'])], groups: [], settings, now })
ok(r.newGroups.length === 1 && r.newGroups[0].memberIds.join() === 'a,b', '패스했던 조원과도 다시 묶일 수 있음')

// ===== 희망 인원 =====
const S1 = ['10/7(수) 12:00'], TWO = ['10/7(수) 12:00', '10/8(목) 12:00']
const groupsOf = rr => rr.newGroups.map(g => g.memberIds.join('+'))
r = M.computeMatching({ responses: [person('t1', S1), person('t2', S1)], groups: [], settings, now })
ok(groupsOf(r).join() === 't1+t2', '시간 한 칸만 고른 2명(3~4명 희망)도 매칭됨 → 2명 조 (희망에 가장 가까운 크기)')
r = M.computeMatching({ responses: [person('x', S1, { groupSizes: ['2명'] }), person('y', S1, { groupSizes: ['2명'] }), person('z', S1)], groups: [], settings, now })
ok(groupsOf(r).join() === 'x+y', '2명 희망 2명 + 3~4명 희망 1명 → 2명 조만 (3명으로 늘리지 않음)')
r = M.computeMatching({ responses: [person('me', S1), ...['a', 'b', 'c', 'd'].map(i => person(i, TWO))], groups: [], settings, now })
ok(r.newGroups.every(g => g.memberIds.length <= 4), '모두 3~4명 희망이면 5명 조를 만들지 않음: ' + groupsOf(r).join(' | '))
r = M.computeMatching({ responses: 'abcdefg'.split('').map(i => person(i, S1)), groups: [], settings, now })
ok(groupsOf(r).map(x => x.split('+').length).sort().join() === '3,4', '3~4명 희망 7명 → 4명 + 3명')
r = M.computeMatching({ responses: 'abcdef'.split('').map(i => person(i, S1, { groupSizes: ['5~6명'] })), groups: [], settings, now })
ok(groupsOf(r).length === 1 && r.newGroups[0].memberIds.length === 6, '5~6명 희망 6명 → 6명 조')
r = M.computeMatching({ responses: 'abcdefgh'.split('').map(i => person(i, S1, { groupSizes: ['5~6명'] })), groups: [], settings, now })
ok(r.newGroups.every(g => g.memberIds.length <= 6), '한 조는 최대 6명')
ok(M.sizeOk(6, person('o', [], { groupSizes: ['5명~'] })), "예전 값 '5명~'은 5~6명으로 처리")
// 기존 조 합류: 한 명 늘어나도 모든 조원 희망에 맞을 때만
const G2 = { id: 'G2', slot: '10/7(수) 12:00', locked: false, memberIds: ['p', 'q'], responses: {} }
r = M.computeMatching({ responses: [person('p', S1, { groupSizes: ['2명'] }), person('q', S1, { groupSizes: ['2명'] }), person('n', S1)], groups: [G2], settings, now })
ok(r.joins.length === 0, '2명 희망 조에는 세 번째 사람을 넣지 않음')
r = M.computeMatching({ responses: [person('p', S1), person('q', S1), person('n', S1)], groups: [G2], settings, now })
ok(r.joins.length === 1 && r.joins[0].memberId === 'n', '3~4명 희망 2명 조에는 합류 가능 → 3명')

// ===== 응답 마감 규칙: [참석]을 누른 사람끼리만 =====
const late = new Date('2026-10-07T02:30:00Z')   // 10/7 11:30 (12:00 조의 마감 11:00이 지남)
const g4 = { id: 'G4', slot: '10/7(수) 12:00', locked: false, memberIds: ['a', 'b', 'c', 'd'], responses: { a: 'yes', b: 'yes' } }
ok(!M.isConfirmed(g4, settings, now) && M.isConfirmed(g4, settings, late), '마감 전엔 미확정, 마감 후 참석 2명 → 확정')
ok(M.releasedIds(g4, settings, late).join() === 'c,d', '마감 후 참석 안 누른 c, d는 자동 취소(다시 매칭 대상)')
const g1y = { ...g4, responses: { a: 'yes' } }
ok(M.isCancelled(g1y, settings, late) && M.releasedIds(g1y, settings, late).length === 4, '참석 1명뿐이면 조 취소 → 4명 모두 다시 매칭 대상')
ok(M.releasedIds({ ...g1y, locked: true }, settings, late).length === 0, '운영자 강제 확정 조는 그대로')
ok(M.releasedIds(g4, settings, now).length === 0, '마감 전에는 아무도 풀려나지 않음')
r = M.computeMatching({ responses: ['a', 'b', 'c', 'd'].map(i => person(i, ['10/7(수) 12:00', '10/8(목) 12:00'])), groups: [g4], settings, now: late })
ok(r.newGroups.length === 1 && r.newGroups[0].memberIds.sort().join() === 'c,d' && r.newGroups[0].slot === '10/8(목) 12:00', '자동 취소된 c, d는 다른 시간(10/8)에 다시 매칭')

ok(/^수동 매칭 10\/7\(수\) 11:30 · 새 조 1개/.test(r.summary), '요약 문구 한국 시간 표기: ' + r.summary)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
