// 매칭 규칙(matching.js) 핵심 동작 검사 — MBTI 50% · 성별 25% · 부문 25%
require('../matching.js')
const M = globalThis.SamilMatching
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m) }

const now = new Date('2026-10-05T03:00:00Z') // 한국 시간 10/5(월) 12:00
const settings = { autoOn: true, time: '22:00', cutoffMin: 60, includePast: false }
const person = (id, slots, extra = {}) => ({ id, name: id, dept: 'Audit', gender: '남성', birthYear: '1998', mbti: 'ENFP', slots,
  groupSizes: ['3~4명'], wantGenders: ['상관없음'], wantDepts: ['상관없음'], avoid: [], ...extra })

// 일정표: 오늘 포함 7일, 한국 시간 기준
const days = M.dayWindow(now)
ok(days.length === 7 && days[0] === '10/5(월)' && days[6] === '10/11(일)', '일정표 = 오늘 포함 7일 ' + days[0] + '~' + days[6])
ok(M.dayWindow(new Date('2026-10-05T15:00:00Z'))[0] === '10/6(화)', '한국 시간 자정에 날짜가 넘어감')
ok(M.slotDate('10/7(수) 12:00').toISOString() === '2026-10-07T03:00:00.000Z', '"10/7(수) 12:00" = 한국 시간 정오')

// 이름 가리기
ok(M.maskName('최동주') === '최*주' && M.maskName('김철') === '김*' && M.maskName('남궁민수') === '남**수' && M.maskName('A') === 'A', '이름 가리기: 최*주 · 김* · 남**수')

// 점수: MBTI 50 + 성별 25 + 부문 25
const a = person('a', [], { gender: '남성', dept: 'Audit', wantGenders: ['여성'], wantDepts: ['Tax'] })
const b = person('b', [], { gender: '여성', dept: 'Tax', wantGenders: ['남성'], wantDepts: ['Audit'] })
ok(M.pairScore(a, b) === 43 + 50, `ENFP끼리 궁합 86점의 절반 43 + 서로 원하는 성별·부문 50 → 93점 (${M.pairScore(a, b)})`)
const c = person('c', [], { gender: '남성', dept: 'Audit', wantGenders: ['남성'], wantDepts: ['Audit'] })
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
  person('me', ['10/9(금) 12:00'], { ...two, dept: 'Audit', wantDepts: ['Tax'] }),
  person('d1', ['10/9(금) 12:00'], { ...two, dept: 'Deal', wantDepts: ['Deal'] }),
  person('t1', ['10/9(금) 12:00'], { ...two, dept: 'Tax', wantDepts: ['Audit'] }),
  person('d2', ['10/9(금) 12:00'], { ...two, dept: 'Deal', wantDepts: ['Deal'] })
], groups: [], settings, now })
mine = r.newGroups.find(g => g.memberIds.includes('me'))
ok(mine && mine.memberIds.includes('t1'), '원하는 부문(Tax) 반영 → Tax 조원과 묶임')

// 패스했던 조원과는 다시 묶이지 않음 (8명이 4명씩 두 조로 나뉠 때)
const eight = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id => person(id, ['10/9(금) 12:00']))
eight[0].avoid = ['b', 'c']
r = M.computeMatching({ responses: eight, groups: [], settings, now })
const withA = r.newGroups.find(g => g.memberIds.includes('a'))
ok(withA && !withA.memberIds.includes('b') && !withA.memberIds.includes('c'), '패스했던 조원(b, c)과 다른 조')

ok(/^수동 매칭 10\/5\(월\) 12:00 · /.test(r.summary), '요약 문구 한국 시간 표기: ' + r.summary)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
