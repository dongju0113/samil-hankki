// 삼일한끼 매칭 규칙 — 화면(index.html)과 서버 자동 매칭(api/cron-match.js)이 이 파일 하나를 같이 씁니다.
// 매칭 규칙을 바꾸려면 이 파일만 고치면 돼요.
(function (root) {
  const fullWeekDays = [
    '10/5(월)', '10/6(화)', '10/7(수)', '10/8(목)', '10/9(금)', '10/10(토)', '10/11(일)',
    '10/12(월)', '10/13(화)', '10/14(수)', '10/15(목)', '10/16(금)', '10/17(토)', '10/18(일)'
  ];
  const timeSlots15Min = ['11:30', '11:45', '12:00', '12:15', '12:30', '12:45', '13:00'];
  const EVENT_YEAR = 2026;           // supabase/01_schema.sql의 _slot_ts와 같게 유지
  const KST_MS = 9 * 60 * 60000;     // 시간 계산은 항상 한국 시간 기준 (서버는 UTC로 돌기 때문)

  const sid = x => String(x);

  // ===== 날짜·시간 =====
  function slotKeyOrder(s) {
    const [d, t] = s.split(' ');
    return fullWeekDays.indexOf(d) * 100 + timeSlots15Min.indexOf(t);
  }
  function slotDate(slot) {
    // "10/7(수) 12:00" → 2026-10-07 12:00 (한국 시간)
    const m = slot.match(/^(\d+)\/(\d+)\(.\) (\d+):(\d+)$/);
    return m ? new Date(Date.UTC(EVENT_YEAR, +m[1] - 1, +m[2], +m[3], +m[4]) - KST_MS) : new Date(0);
  }
  function fmtDateTime(d) {
    const k = new Date(d.getTime() + KST_MS);
    const p = n => String(n).padStart(2, '0');
    return `${k.getUTCMonth() + 1}/${k.getUTCDate()}(${'일월화수목금토'[k.getUTCDay()]}) ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
  }
  // 가장 최근에 지나간 "매일 HH:MM(한국 시간)" 시각
  function lastScheduledBefore(time, now) {
    const [h, m] = (time || '22:00').split(':').map(Number);
    const k = new Date(now.getTime() + KST_MS);
    let due = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), h, m) - KST_MS;
    if (due > now.getTime()) due -= 24 * 60 * 60000;
    return new Date(due);
  }
  function isSlotOpen(slot, settings, now = new Date()) {
    if (settings.includePast) return true;
    return slotDate(slot) - now >= (Number(settings.cutoffMin) || 0) * 60000;
  }
  function openSlotsOf(r, settings, now = new Date()) { return (r.slots || []).filter(s => isSlotOpen(s, settings, now)); }

  // ===== 조 상태 =====
  // 응답 마감 = 점심 시작 N분 전 (테스트 모드에서는 마감 없음)
  function groupDeadline(g, settings) { return new Date(slotDate(g.slot).getTime() - (Number(settings.cutoffMin) || 0) * 60000); }
  function isDeadlinePassed(g, settings, now = new Date()) { return !settings.includePast && now >= groupDeadline(g, settings); }
  function responseOf(g, id) { return (g.responses || {})[sid(id)] || 'pending'; }
  function yesCount(g) { return g.memberIds.filter(id => responseOf(g, id) === 'yes').length; }
  // 확정: 운영자 강제 확정 / 전원 참석 / 마감이 지남(무응답은 참석으로 간주)
  function isConfirmed(g, settings) {
    return g.locked || (g.memberIds.length >= 2 && yesCount(g) === g.memberIds.length) || isDeadlinePassed(g, settings);
  }

  // ===== 매칭 점수 =====
  function sizeOk(size, r) {
    const g = r.groupSizes || [];
    if (size <= 2) return g.includes('2명');
    if (size <= 4) return g.includes('3~4명');
    return g.includes('5명~');
  }
  function desiredSize(r) {
    const g = r.groupSizes || [];
    if (g.includes('3~4명')) return 4;
    if (g.includes('5명~')) return 5;
    return 2;
  }
  function shared(a, b) { return a.filter(x => b.includes(x)); }
  function pairScore(a, b) {
    const si = shared(a.interests || [], b.interests || []).length;
    const sf = shared(a.foodCategories || [], b.foodCategories || []).length;
    let s = si * 2 + sf;
    if ((a.avoid || []).includes(sid(b.id)) || (b.avoid || []).includes(sid(a.id))) s -= 100; // 패스했던 조원은 피함
    if (a.budget === b.budget || a.budget === '무관' || b.budget === '무관') s += 1;
    if (a.vibe === b.vibe || a.vibe === '둘 다 좋아요' || b.vibe === '둘 다 좋아요') s += 1;
    if (a.spicy === b.spicy) s += 0.5;
    [[a, b], [b, a]].forEach(([me, other]) => (me.priority || []).forEach((p, idx) => {
      const w = idx === 0 ? 4 : 3; // 먼저 고른 조건에 더 큰 가중치
      if (p === '관심사') s += si * w;
      if (p === '음식 취향') s += sf * w;
      if (p === '다른 부문' && me.dept !== other.dept) s += w;
      if (p === '같은 부문' && me.dept === other.dept) s += w;
      if (p === '나이대' && me.birthYear && other.birthYear && Math.abs(me.birthYear - other.birthYear) <= 3) s += w;
    }));
    return s;
  }
  function groupScore(group, c) { return group.reduce((sum, m) => sum + pairScore(m, c), 0); }

  // ===== 매칭 실행: 아직 조가 없는 사람만 대상 (이미 편성된 조는 건드리지 않음) =====
  // responses: 신청 목록, groups: 기존 조 [{ id, slot, locked, memberIds, responses }]
  // 반환: 저장할 새 조 / 기존 조 합류 / 실행 요약. 입력값은 바꾸지 않음
  function computeMatching({ responses, groups, settings, now = new Date(), source = 'manual' }) {
    const byId = Object.fromEntries(responses.map(r => [sid(r.id), r]));
    const allGroups = groups.map(g => ({ ...g, memberIds: [...g.memberIds] }));
    const sizeBefore = Object.fromEntries(allGroups.map(g => [g.id, g.memberIds.length]));
    const membersOf = g => g.memberIds.map(id => byId[sid(id)]).filter(Boolean);
    const assigned = new Set(allGroups.flatMap(g => g.memberIds.map(sid)));
    const unassigned = new Set(responses.filter(r => !assigned.has(sid(r.id))).map(r => sid(r.id)));
    const before = unassigned.size;
    const openOf = r => openSlotsOf(r, settings, now);
    const allSlots = fullWeekDays.flatMap(d => timeSlots15Min.map(t => `${d} ${t}`)).filter(s => isSlotOpen(s, settings, now));
    const formed = [];

    // 1차: 3명 이상 모이는 칸 → 2차: 2명 이상 모이는 칸
    for (const minPool of [3, 2]) {
      const used = new Set();
      while (true) {
        let best = null, bestPool = [];
        allSlots.forEach(slot => {
          if (used.has(slot)) return;
          const pool = [...unassigned].map(id => byId[id]).filter(r => openOf(r).includes(slot));
          if (pool.length > bestPool.length) { best = slot; bestPool = pool; }
        });
        if (!best || bestPool.length < minPool) break;
        used.add(best);

        const pool = bestPool.sort((a, b) => openOf(a).length - openOf(b).length); // 가능한 칸이 적은 사람 먼저
        const slotGroups = [];
        while (pool.length >= 2) {
          const seed = pool.shift();
          let size = Math.min(desiredSize(seed), pool.length + 1);
          if (size < 3 && !sizeOk(2, seed)) {
            if (slotGroups.length) { pool.unshift(seed); break; }
            if (pool.length + 1 < 3) { pool.unshift(seed); break; }
            size = 3;
          }
          const g = [seed];
          while (g.length < size && pool.length) {
            const fit = c => groupScore(g, c) + (sizeOk(size, c) ? 0 : -8);
            pool.sort((a, b) => fit(b) - fit(a));
            g.push(pool.shift());
          }
          slotGroups.push(g);
        }
        pool.forEach(r => {
          const cand = slotGroups.filter(g => g.length < 6 && g.length >= 2).sort((a, b) => groupScore(b, r) - groupScore(a, r))[0];
          if (cand) cand.push(r);
        });
        slotGroups.forEach(g => { g.forEach(m => unassigned.delete(sid(m.id))); formed.push({ slot: best, members: g }); });
      }
    }

    // 새로 만든 조 (번호는 저장할 때 이어서 발급)
    formed.sort((a, b) => slotKeyOrder(a.slot) - slotKeyOrder(b.slot)).forEach((f, i) => {
      allGroups.push({ id: 'new' + i, isNew: true, slot: f.slot, memberIds: f.members.map(m => m.id), locked: false, responses: {} });
    });

    // 그래도 남은 사람: 확정되지 않은 기존 조 중 시간이 맞고 자리가 있는 곳에 합류
    [...unassigned].forEach(id => {
      const r = byId[id];
      const cand = allGroups
        .filter(g => !isConfirmed(g, settings) && g.memberIds.length >= 2 && g.memberIds.length < 6 && openOf(r).includes(g.slot))
        .sort((a, b) => groupScore(membersOf(b), r) - groupScore(membersOf(a), r))[0];
      if (cand) { cand.memberIds.push(r.id); unassigned.delete(id); }
    });

    const matched = before - unassigned.size;
    return {
      newGroups: allGroups.filter(g => g.isNew).map(g => ({ slot: g.slot, memberIds: g.memberIds.map(sid) })),
      joins: allGroups.filter(g => !g.isNew)
        .flatMap(g => g.memberIds.slice(sizeBefore[g.id]).map(m => ({ groupId: g.id, memberId: sid(m) }))),
      before,
      summary: `${source === 'auto' ? '자동' : '수동'} 매칭 ${fmtDateTime(now)} · 새 조 ${formed.length}개 · ${matched}명 배정 · 대기 ${unassigned.size}명`
    };
  }

  root.SamilMatching = {
    fullWeekDays, timeSlots15Min, EVENT_YEAR, sid,
    slotKeyOrder, slotDate, fmtDateTime, lastScheduledBefore, isSlotOpen, openSlotsOf,
    groupDeadline, isDeadlinePassed, responseOf, yesCount, isConfirmed, computeMatching
  };
})(typeof window !== 'undefined' ? window : globalThis);
