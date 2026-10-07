// 삼일한끼 매칭 규칙 — 화면(index.html)과 서버 자동 매칭(api/cron-match.js)이 이 파일 하나를 같이 씁니다.
// 매칭 규칙을 바꾸려면 이 파일만 고치면 돼요.
(function (root) {
  const DAYS_SHOWN = 7;               // 일정표: 오늘 포함 7일
  // 점심 시작 시간 (30분 간격). 예전 15분 단위로 받은 신청(11:45 등)도 매칭에는 그대로 쓰임
  const timeSlots = ['11:30', '12:00', '12:30', '13:00'];
  const EVENT_YEAR = 2026;           // 날짜 표기("10/7(수)")에 연도가 없어 이 연도로 계산. supabase/01_schema.sql의 _slot_ts와 같게 유지
  const KST_MS = 9 * 60 * 60000;     // 시간 계산은 항상 한국 시간 기준 (서버는 UTC로 돌기 때문)

  const sid = x => String(x);

  // ===== MBTI 궁합표 =====
  const MBTI_TYPES = ['ISTJ', 'ISFJ', 'INFJ', 'INTJ', 'ISTP', 'ISFP', 'INFP', 'INTP', 'ESTP', 'ESFP', 'ENFP', 'ENTP', 'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ'];
  // 두 MBTI의 궁합 점수(0~100). 팀에서 정한 궁합표 (2026-10-06). 표에 없는 조합은 MBTI_DEFAULT
  const MBTI_TABLE = {
    ISTJ: { ISTJ: 86, ISFJ: 88, INFJ: 73, INTJ: 71, ISTP: 91, ISFP: 93, INFP: 78, INTP: 76, ESTP: 98, ESFP: 100, ENFP: 85, ENTP: 83, ESTJ: 93, ESFJ: 95, ENFJ: 80, ENTJ: 78 },
    ISFJ: { ISTJ: 88, ISFJ: 86, INFJ: 71, INTJ: 73, ISTP: 93, ISFP: 91, INFP: 76, INTP: 78, ESTP: 100, ESFP: 98, ENFP: 83, ENTP: 85, ESTJ: 95, ESFJ: 93, ENFJ: 78, ENTJ: 80 },
    INFJ: { ISTJ: 73, ISFJ: 71, INFJ: 86, INTJ: 88, ISTP: 78, ISFP: 76, INFP: 91, INTP: 93, ESTP: 85, ESFP: 83, ENFP: 98, ENTP: 100, ESTJ: 80, ESFJ: 78, ENFJ: 93, ENTJ: 95 },
    INTJ: { ISTJ: 71, ISFJ: 73, INFJ: 88, INTJ: 86, ISTP: 76, ISFP: 78, INFP: 93, INTP: 91, ESTP: 83, ESFP: 85, ENFP: 100, ENTP: 98, ESTJ: 78, ESFJ: 80, ENFJ: 95, ENTJ: 93 },
    ISTP: { ISTJ: 91, ISFJ: 93, INFJ: 78, INTJ: 76, ISTP: 86, ISFP: 88, INFP: 73, INTP: 71, ESTP: 93, ESFP: 95, ENFP: 80, ENTP: 78, ESTJ: 98, ESFJ: 100, ENFJ: 85, ENTJ: 83 },
    ISFP: { ISTJ: 93, ISFJ: 91, INFJ: 76, INTJ: 78, ISTP: 88, ISFP: 86, INFP: 71, INTP: 73, ESTP: 95, ESFP: 93, ENFP: 78, ENTP: 80, ESTJ: 100, ESFJ: 98, ENFJ: 83, ENTJ: 85 },
    INFP: { ISTJ: 78, ISFJ: 76, INFJ: 91, INTJ: 93, ISTP: 73, ISFP: 71, INFP: 86, INTP: 88, ESTP: 80, ESFP: 78, ENFP: 93, ENTP: 95, ESTJ: 85, ESFJ: 83, ENFJ: 98, ENTJ: 100 },
    INTP: { ISTJ: 76, ISFJ: 78, INFJ: 93, INTJ: 91, ISTP: 71, ISFP: 73, INFP: 88, INTP: 86, ESTP: 78, ESFP: 80, ENFP: 95, ENTP: 93, ESTJ: 83, ESFJ: 85, ENFJ: 100, ENTJ: 98 },
    ESTP: { ISTJ: 98, ISFJ: 100, INFJ: 85, INTJ: 83, ISTP: 93, ISFP: 95, INFP: 80, INTP: 78, ESTP: 86, ESFP: 88, ENFP: 73, ENTP: 71, ESTJ: 91, ESFJ: 93, ENFJ: 78, ENTJ: 76 },
    ESFP: { ISTJ: 100, ISFJ: 98, INFJ: 83, INTJ: 85, ISTP: 95, ISFP: 93, INFP: 78, INTP: 80, ESTP: 88, ESFP: 86, ENFP: 71, ENTP: 73, ESTJ: 93, ESFJ: 91, ENFJ: 76, ENTJ: 78 },
    ENFP: { ISTJ: 85, ISFJ: 83, INFJ: 98, INTJ: 100, ISTP: 80, ISFP: 78, INFP: 93, INTP: 95, ESTP: 73, ESFP: 71, ENFP: 86, ENTP: 88, ESTJ: 78, ESFJ: 76, ENFJ: 91, ENTJ: 93 },
    ENTP: { ISTJ: 83, ISFJ: 85, INFJ: 100, INTJ: 98, ISTP: 78, ISFP: 80, INFP: 95, INTP: 93, ESTP: 71, ESFP: 73, ENFP: 88, ENTP: 86, ESTJ: 76, ESFJ: 78, ENFJ: 93, ENTJ: 91 },
    ESTJ: { ISTJ: 93, ISFJ: 95, INFJ: 80, INTJ: 78, ISTP: 98, ISFP: 100, INFP: 85, INTP: 83, ESTP: 91, ESFP: 93, ENFP: 78, ENTP: 76, ESTJ: 86, ESFJ: 88, ENFJ: 73, ENTJ: 71 },
    ESFJ: { ISTJ: 95, ISFJ: 93, INFJ: 78, INTJ: 80, ISTP: 100, ISFP: 98, INFP: 83, INTP: 85, ESTP: 93, ESFP: 91, ENFP: 76, ENTP: 78, ESTJ: 88, ESFJ: 86, ENFJ: 71, ENTJ: 73 },
    ENFJ: { ISTJ: 80, ISFJ: 78, INFJ: 93, INTJ: 95, ISTP: 85, ISFP: 83, INFP: 98, INTP: 100, ESTP: 78, ESFP: 76, ENFP: 91, ENTP: 93, ESTJ: 73, ESFJ: 71, ENFJ: 86, ENTJ: 88 },
    ENTJ: { ISTJ: 78, ISFJ: 80, INFJ: 95, INTJ: 93, ISTP: 83, ISFP: 85, INFP: 100, INTP: 98, ESTP: 76, ESFP: 78, ENFP: 93, ENTP: 91, ESTJ: 71, ESFJ: 73, ENFJ: 88, ENTJ: 86 }
  };
  const MBTI_DEFAULT = 50;
  function mbtiScore(a, b) {
    const v = (MBTI_TABLE[a] && MBTI_TABLE[a][b] != null) ? MBTI_TABLE[a][b]
      : (MBTI_TABLE[b] && MBTI_TABLE[b][a] != null) ? MBTI_TABLE[b][a] : MBTI_DEFAULT;
    return Math.max(0, Math.min(100, Number(v)));
  }
  // 조원 MBTI들의 평균 궁합 (모든 두 사람 쌍의 평균, 반올림). MBTI가 2명 미만이면 null
  function mbtiAverage(list) {
    const xs = list.filter(x => MBTI_TYPES.includes(x));
    let sum = 0, n = 0;
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) { sum += mbtiScore(xs[i], xs[j]); n++; }
    return n ? Math.round(sum / n) : null;
  }

  // 결과 화면·메일용 이름 가리기: 최동주 → 최*주, 김철 → 김*, 남궁민수 → 남**수
  function maskName(name) {
    const c = [...String(name || '')];
    if (c.length <= 1) return c.join('');
    if (c.length === 2) return c[0] + '*';
    return c[0] + '*'.repeat(c.length - 2) + c[c.length - 1];
  }

  // ===== 날짜·시간 =====
  // 일정표에 보여 줄 날짜: 한국 시간 기준 오늘부터 DAYS_SHOWN일. 예) ['10/5(월)', '10/6(화)', ...]
  function dayWindow(now = new Date(), days = DAYS_SHOWN) {
    const k = new Date(now.getTime() + KST_MS);
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + i));
      return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${'일월화수목금토'[d.getUTCDay()]})`;
    });
  }
  // 시간순 정렬 기준
  function slotKeyOrder(s) { return slotDate(s).getTime(); }
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
  // 응답 마감까지 [참석할게요]를 누른 조원끼리만 만남 (누르지 않으면 자동 취소)
  //  - 운영자 강제 확정: 조원 전체 확정
  //  - 마감 전: 조원 모두 참석을 누르면 바로 확정
  //  - 마감 후: 참석 2명 이상이면 그 사람들끼리 확정, 1명 이하면 조 취소
  function isConfirmed(g, settings, now = new Date()) {
    if (g.locked) return true;
    if (isDeadlinePassed(g, settings, now)) return yesCount(g) >= 2;
    return g.memberIds.length >= 2 && yesCount(g) === g.memberIds.length;
  }
  function isCancelled(g, settings, now = new Date()) {
    return !g.locked && isDeadlinePassed(g, settings, now) && yesCount(g) < 2;
  }
  // 마감이 지나 이 조에서 풀려난 사람 (참석을 안 누른 사람, 취소된 조의 전원) → 다시 매칭 대상
  function releasedIds(g, settings, now = new Date()) {
    if (g.locked || !isDeadlinePassed(g, settings, now)) return [];
    return isCancelled(g, settings, now) ? g.memberIds.map(sid) : g.memberIds.filter(id => responseOf(g, id) !== 'yes').map(sid);
  }

  // ===== 희망 인원 =====
  // 2명 / 3~4명 / 5~6명 (여러 개 선택 가능, 최대 6명). '5명~'은 예전에 받던 값
  const MAX_GROUP = 6;
  const SIZE_OPTIONS = { '2명': [2], '3~4명': [3, 4], '5~6명': [5, 6], '5명~': [5, 6] };
  const SIZE_ORDER = [4, 3, 6, 5, 2];   // 여러 크기가 가능하면 이 순서로 시도
  const SIZE_PENALTY = 25;              // 희망과 1명 차이 날 때마다 깎는 점수 (남은 사람을 묶을 때만 사용)
  function allowedSizes(r) {
    const set = new Set((r.groupSizes || []).flatMap(o => SIZE_OPTIONS[o] || []));
    return set.size ? set : new Set([3, 4]);
  }
  function sizeOk(size, r) { return allowedSizes(r).has(size); }
  function sizeGap(size, r) { return Math.min(...[...allowedSizes(r)].map(s => Math.abs(s - size))); }

  // ===== 매칭 점수 =====
  // 두 사람의 궁합 = MBTI 50점 + 성별 25점 + 부문 25점 (최대 100점)
  //  - MBTI: 궁합표 점수(0~100)의 절반
  //  - 성별: 내가 원하는 성별에 상대가 맞으면 12.5점 + 상대가 원하는 성별에 내가 맞으면 12.5점
  //  - 부문: 같은 방식 ("상관없음"을 고르면 누구든 맞는 것으로)
  //  - 패스했던 조원과도 다시 만날 수 있음 (제한 없음)
  const wants = (list, v) => !list || !list.length || list.includes('상관없음') || list.includes(v);
  function pairScore(a, b) {
    return mbtiScore(a.mbti, b.mbti) * 0.5
      + (wants(a.wantGenders, b.gender) ? 12.5 : 0) + (wants(b.wantGenders, a.gender) ? 12.5 : 0)
      + (wants(a.wantDepts, b.dept) ? 12.5 : 0) + (wants(b.wantDepts, a.dept) ? 12.5 : 0);
  }
  function groupScore(group, c) { return group.reduce((sum, m) => sum + pairScore(m, c), 0); }

  // ===== 한 시간 칸 안에서 조 나누기 =====
  // strict: 모든 조원의 희망 인원에 맞는 크기로만 묶음
  // 완화(strict=false): 남은 사람끼리, 희망 인원에 가장 가까운 크기로 묶음
  function splitPool(pool, strict) {
    pool = [...pool];
    const groups = [], left = [];
    while (pool.length >= 2) {
      const seed = pool.shift();   // 가능한 칸이 적은 사람 먼저
      const sizes = strict
        ? SIZE_ORDER.filter(s => sizeOk(s, seed) && s <= pool.length + 1)
        : Array.from({ length: Math.min(pool.length + 1, MAX_GROUP) - 1 }, (_, i) => i + 2)
            .sort((a, b) => sizeGap(a, seed) - sizeGap(b, seed) || b - a);
      let made = null;
      for (const size of sizes) {
        const cands = strict ? pool.filter(c => sizeOk(size, c)) : [...pool];
        if (cands.length < size - 1) continue;
        const g = [seed];
        while (g.length < size) {
          const fit = c => groupScore(g, c) - (strict ? 0 : sizeGap(size, c) * SIZE_PENALTY);
          cands.sort((a, b) => fit(b) - fit(a));
          g.push(cands.shift());
        }
        made = g;
        break;
      }
      if (made) {
        groups.push(made);
        made.slice(1).forEach(m => pool.splice(pool.indexOf(m), 1));
      } else left.push(seed);
    }
    left.push(...pool);
    // 남은 사람: 같은 칸에 만든 조 중, 한 명 늘어나도 모든 조원의 희망 인원에 맞는 곳에 합류
    if (strict) {
      for (const r of [...left]) {
        const cand = groups
          .filter(g => g.length < MAX_GROUP && [...g, r].every(m => sizeOk(g.length + 1, m)))
          .sort((a, b) => groupScore(b, r) - groupScore(a, r))[0];
        if (cand) { cand.push(r); left.splice(left.indexOf(r), 1); }
      }
    }
    return groups;
  }

  // ===== 매칭 실행: 아직 조가 없는 사람만 대상 (이미 편성된 조는 건드리지 않음) =====
  // responses: 신청 목록, groups: 기존 조 [{ id, slot, locked, memberIds, responses }]
  // 반환: 저장할 새 조 / 기존 조 합류 / 실행 요약. 입력값은 바꾸지 않음
  // 순서: ① 희망 인원을 지켜서 새 조 → ② 희망 인원이 맞는 기존 조에 합류 → ③ 그래도 남은 사람끼리 희망에 가장 가깝게
  function computeMatching({ responses, groups, settings, now = new Date(), source = 'manual' }) {
    const byId = Object.fromEntries(responses.map(r => [sid(r.id), r]));
    const allGroups = groups.map(g => ({ ...g, memberIds: [...g.memberIds] }));
    const sizeBefore = Object.fromEntries(allGroups.map(g => [g.id, g.memberIds.length]));
    const membersOf = g => g.memberIds.map(id => byId[sid(id)]).filter(Boolean);
    const released = new Set(allGroups.flatMap(g => releasedIds(g, settings, now)));
    const assigned = new Set(allGroups.flatMap(g => g.memberIds.map(sid)).filter(id => !released.has(id)));
    const unassigned = new Set(responses.filter(r => !assigned.has(sid(r.id))).map(r => sid(r.id)));
    const before = unassigned.size;
    const openOf = r => openSlotsOf(r, settings, now);
    // 신청자들이 고른 칸 중 아직 마감 전인 칸을 시간순으로 (일정표가 하루씩 밀려도 예전에 고른 칸까지 처리)
    const allSlots = [...new Set(responses.flatMap(r => r.slots || []))]
      .filter(s => isSlotOpen(s, settings, now))
      .sort((a, b) => slotKeyOrder(a) - slotKeyOrder(b));
    const formed = [];

    const formPass = strict => {
      const used = new Set();
      while (true) {
        let best = null, bestPool = [];
        allSlots.forEach(slot => {
          if (used.has(slot)) return;
          const pool = [...unassigned].map(id => byId[id]).filter(r => openOf(r).includes(slot));
          if (pool.length > bestPool.length) { best = slot; bestPool = pool; }
        });
        if (!best || bestPool.length < 2) break;
        used.add(best);
        const pool = bestPool.sort((a, b) => openOf(a).length - openOf(b).length);   // 가능한 칸이 적은 사람 먼저
        splitPool(pool, strict).forEach(g => {
          g.forEach(m => unassigned.delete(sid(m.id)));
          formed.push({ slot: best, members: g });
        });
      }
    };

    formPass(true);
    // 기존 조에 합류: 마감 전·미확정 조 중 시간이 맞고, 한 명 늘어나도 모든 조원의 희망 인원에 맞는 곳
    [...unassigned].forEach(id => {
      const r = byId[id];
      const cand = allGroups
        .filter(g => !g.locked && !isDeadlinePassed(g, settings, now) && !isConfirmed(g, settings, now)
          && g.memberIds.length >= 2 && g.memberIds.length < MAX_GROUP && openOf(r).includes(g.slot)
          && [...membersOf(g), r].every(m => sizeOk(g.memberIds.length + 1, m)))
        .sort((a, b) => groupScore(membersOf(b), r) - groupScore(membersOf(a), r))[0];
      if (cand) { cand.memberIds.push(r.id); unassigned.delete(id); }
    });
    formPass(false);

    // 새로 만든 조 (번호는 저장할 때 이어서 발급)
    formed.sort((a, b) => slotKeyOrder(a.slot) - slotKeyOrder(b.slot)).forEach((f, i) => {
      allGroups.push({ id: 'new' + i, isNew: true, slot: f.slot, memberIds: f.members.map(m => m.id), locked: false, responses: {} });
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
    dayWindow, timeSlots, EVENT_YEAR, sid, MBTI_TYPES, MBTI_TABLE, mbtiScore, mbtiAverage, maskName, pairScore,
    slotKeyOrder, slotDate, fmtDateTime, lastScheduledBefore, isSlotOpen, openSlotsOf, sizeOk, allowedSizes,
    groupDeadline, isDeadlinePassed, responseOf, yesCount, isConfirmed, isCancelled, releasedIds, computeMatching
  };
})(typeof window !== 'undefined' ? window : globalThis);
