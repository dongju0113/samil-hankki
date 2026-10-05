// 매칭 규칙(matching.js) 핵심 동작 검사
require('../matching.js')
const M = globalThis.SamilMatching
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m) }

const now = new Date('2026-10-05T03:00:00Z') // 한국 시간 10/5(월) 12:00
const settings = { autoOn: true, time: '22:00', cutoffMin: 60, includePast: false }
const person = (id, slots, extra = {}) => ({ id, name: id, dept: 'Audit', birthYear: '1995', slots, budget: '무관', foodCategories: ['한식'],
  spicy: '보통', groupSizes: ['3~4명'], vibe: '둘 다 좋아요', interests: ['독서'], priority: [], avoid: [], ...extra })

// 일정표: 오늘부터 2주, 한국 시간 기준
const days = M.dayWindow(now)
ok(days.length === 14 && days[0] === '10/5(월)' && days[13] === '10/18(일)', '일정표 = 오늘부터 14일 ' + days[0] + '~' + days[13])
ok(M.dayWindow(new Date('2026-10-05T15:00:00Z'))[0] === '10/6(화)', '한국 시간 자정에 날짜가 넘어감')
ok(M.slotDate('10/7(수) 12:00').toISOString() === '2026-10-07T03:00:00.000Z', '"10/7(수) 12:00" = 한국 시간 정오')

// 같은 칸을 고른 4명 → 한 조
let r = M.computeMatching({ responses: ['a', 'b', 'c', 'd'].map(id => person(id, ['10/7(수) 12:00'])), groups: [], settings, now })
ok(r.newGroups.length === 1 && r.newGroups[0].memberIds.length === 4, '같은 시간 4명 → 1개 조')

// 이미 지난 칸·마감(60분 전) 지난 칸은 매칭 안 함
r = M.computeMatching({ responses: ['a', 'b', 'c'].map(id => person(id, ['10/5(월) 12:30'])), groups: [], settings, now })
ok(r.newGroups.length === 0, '마감(점심 60분 전) 지난 칸은 매칭 안 함')

// 이미 조가 있는 사람은 건드리지 않음
r = M.computeMatching({ responses: ['a', 'b', 'c'].map(id => person(id, ['10/8(목) 12:00'])),
  groups: [{ id: 'G1', slot: '10/8(목) 12:00', locked: true, memberIds: ['a', 'b'], responses: {} }], settings, now })
ok(r.newGroups.length === 0 && r.joins.length === 0, '강제 확정된 조는 그대로, 혼자 남은 사람은 대기')

// 패스했던 조원과는 다시 묶이지 않음 (8명이 4명씩 두 조로 나뉠 때)
// ※ 남는 사람을 기존 조에 붙이는 단계는 avoid를 보지 않음 (원래 규칙 그대로. 예: 6명이면 남은 2명이 a 조에 합류할 수 있음)
const eight = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id => person(id, ['10/9(금) 12:00'], { groupSizes: ['3~4명'] }))
eight[0].avoid = ['b', 'c']
r = M.computeMatching({ responses: eight, groups: [], settings, now })
const withA = r.newGroups.find(g => g.memberIds.includes('a'))
ok(withA && !withA.memberIds.includes('b') && !withA.memberIds.includes('c'), '패스했던 조원(b, c)과 다른 조')

// 우선 조건: 관심사 가중치
const pool = [
  person('me', ['10/12(월) 12:00'], { interests: ['골프'], priority: ['관심사'], groupSizes: ['2명'] }),
  person('x', ['10/12(월) 12:00'], { interests: ['게임'], groupSizes: ['2명'] }),
  person('y', ['10/12(월) 12:00'], { interests: ['골프'], groupSizes: ['2명'] })
]
r = M.computeMatching({ responses: pool, groups: [], settings, now })
const mine = r.newGroups.find(g => g.memberIds.includes('me'))
ok(mine && mine.memberIds.includes('y'), '관심사 우선 → 관심사 같은 사람과 묶임')

ok(/^수동 매칭 10\/5\(월\) 12:00 · /.test(r.summary), '요약 문구 한국 시간 표기: ' + r.summary)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
