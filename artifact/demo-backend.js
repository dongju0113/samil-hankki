// 심사용 백업 데모(Claude Artifact)에서 Supabase 대신 쓰는 가짜 저장소
// - index.html이 부르는 supabase.createClient(...) 와 같은 모양으로 동작해서, 화면 코드는 그대로 재사용
// - 데이터는 보는 사람 브라우저에만 임시 저장 (서버·메일 없음)
// - 규칙은 supabase/01_schema.sql의 함수들과 같게 맞춤 (신청·내 결과·참석·패스·운영자 저장)
(function (root) {
  const M = root.SamilMatching;
  const KEY = 'samil-hankki-demo-v1';
  const DEMO_EMAIL = 'demo@example.com';
  const DEMO_CODE = '123456';
  const clone = x => JSON.parse(JSON.stringify(x));
  const nowIso = () => new Date().toISOString();
  const uid = () => (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const todayKst = () => M.dayWindow()[0];

  let state, session = null;

  // ===== 샘플 데이터 (오늘부터 2주 일정표 기준으로 매번 새로 만듦) =====
  function seed() {
    const st = {
      seededFor: todayKst(), seq: 0,
      settings: { id: 1, auto_on: true, match_time: '22:00', cutoff_min: 60, include_past: false, anchor: nowIso(),
        next_no: 1, last_run_at: null, last_auto_run_at: null, last_run_summary: '' },
      applications: [], groups: [], members: []
    };
    const days = M.dayWindow().slice(1).filter(d => !/(토|일)/.test(d)); // 내일부터 평일
    const T = M.timeSlots15Min;
    const depts = ['Audit', 'Tax', 'Deal', 'AX'];
    const names = ['이세무', '박재무', '최디지털', '정감사', '강어드바이저', '윤컨설팅', '한동기', '조시니어', '임매니저', '오회계', '서밸류', '문리스크'];
    const interests = ['헬스·러닝', '골프', '독서', '영화·OTT', '국내여행', '해외여행', '맛집 탐방', '카페·디저트', '외국어', '재테크·부동산', '전시·공연', '게임'];
    const foods = ['한식', '일식', '중식', '아시안', '양식', '분식', '샐러드', '고기'];
    const sizeSets = [['3~4명'], ['3~4명', '5명~'], ['2명', '3~4명'], ['3~4명']];
    const pri = [['관심사'], ['다른 부문'], ['관심사', '다른 부문'], ['나이대'], ['음식 취향'], []];
    const pick = (arr, k, s) => { const out = []; while (out.length < k) { const v = arr[(s * 7919 + 13) % arr.length]; if (!out.includes(v)) out.push(v); s++; } return out; };
    const add = (o) => {
      const row = Object.assign({
        id: uid(), birth_year: '', gender: '응답 안 함', dept_open: true, allergy: '', budget: '무관', food_categories: [],
        spicy: '보통', group_sizes: ['3~4명'], vibe: '둘 다 좋아요', favorite_thing: '', priority: [], avoid: [],
        sample: true, created_at: nowIso()
      }, o);
      st.applications.push(row);
      return row;
    };

    // 체험용 신청자 + 이미 짜인 1조 (내 결과 화면을 바로 볼 수 있게)
    const firstSlot = `${days[0]} 12:00`;
    const me = add({ email: DEMO_EMAIL, code: DEMO_CODE, name: '김삼일', birth_year: '1999', dept: 'Audit',
      slots: [firstSlot, `${days[0]} 12:15`], food_categories: ['한식', '일식'], interests: ['맛집 탐방', '헬스·러닝', '해외여행'],
      favorite_thing: '주말 러닝 크루', priority: ['관심사', '다른 부문'], sample: false });
    const mates = [
      add({ email: 'mate1@example.com', code: '482913', name: '이세무', birth_year: '1998', dept: 'Tax', slots: [firstSlot], food_categories: ['한식'], interests: ['맛집 탐방', '골프', '독서'], favorite_thing: '을지로 노포 탐방' }),
      add({ email: 'mate2@example.com', code: '730145', name: '박재무', birth_year: '2000', dept: 'Deal', dept_open: false, slots: [firstSlot, `${days[1]} 12:00`], food_categories: ['일식'], interests: ['헬스·러닝', '해외여행', '외국어'] }),
      add({ email: 'mate3@example.com', code: '264508', name: '최디지털', birth_year: '1997', dept: 'AX', slots: [firstSlot], food_categories: ['한식', '아시안'], interests: ['맛집 탐방', '게임', '영화·OTT'], favorite_thing: '요즘 보는 드라마' })
    ];
    const g1 = { id: uid(), no: st.settings.next_no++, slot: firstSlot, locked: false, created_at: nowIso() };
    st.groups.push(g1);
    [me, ...mates].forEach((m, i) => st.members.push({ application_id: m.id, group_id: g1.id, response: i === 1 || i === 3 ? 'yes' : 'pending', added_at: nowIso(), seq: ++st.seq }));

    // 나머지 샘플 20명: 평일 2~3일, 연속된 3~4칸
    for (let i = 1; i <= 20; i++) {
      const ds = pick(days.slice(0, 8), 2 + (i % 2), i * 3);
      const start = i % 3;
      add({
        email: `sample${i}@example.com`, code: String(100000 + ((i * 7919) % 900000)),
        name: names[i % names.length] + (Math.floor(i / names.length) + 1), birth_year: String(1993 + (i % 10)),
        dept: depts[i % depts.length], dept_open: i % 3 !== 0,
        slots: ds.flatMap(d => T.slice(start, start + 3 + (i % 2)).map(t => `${d} ${t}`)),
        budget: ['무관', '1~1.5만원', '1만원 이하'][i % 3], food_categories: pick(foods, 2, i * 5), spicy: ['보통', '약하게', '맵게'][i % 3],
        group_sizes: sizeSets[i % sizeSets.length], vibe: ['둘 다 좋아요', '차분하게 대화', '활기차게 대화'][i % 3],
        interests: pick(interests, 3, i * 11), priority: pri[i % pri.length]
      });
    }
    state = st;
    // 지난밤 자동 매칭이 돌았던 것처럼 나머지를 실제 매칭 규칙으로 편성 (몇 명은 대기로 남음)
    const r = M.computeMatching({ responses: st.applications.map(toMatch), groups: groupsForMatch(), settings: settingsCamel(), now: new Date(), source: 'auto' });
    saveMatching(r.newGroups.slice(0, Math.max(1, r.newGroups.length - 1)), [], r.summary.replace(/새 조 \d+개.*/, '데모 샘플 편성'), true);
    return st;
  }

  function load() {
    try {
      const raw = root.localStorage.getItem(KEY);
      if (raw) { const st = JSON.parse(raw); if (st && st.seededFor === todayKst()) return st; }
    } catch (e) { /* 저장소를 못 쓰는 환경이면 메모리로만 */ }
    return null;
  }
  function save() { try { root.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 메모리로만 유지 */ } }
  function reset() { try { root.localStorage.removeItem(KEY); } catch (e) {} seed(); save(); }

  // ===== 변환 도우미 =====
  function settingsCamel() {
    const s = state.settings;
    return { autoOn: s.auto_on, time: s.match_time, cutoffMin: s.cutoff_min, includePast: s.include_past, anchor: s.anchor };
  }
  function toMatch(r) {
    return { id: r.id, name: r.name, dept: r.dept, birthYear: r.birth_year, slots: r.slots || [], budget: r.budget,
      foodCategories: r.food_categories || [], spicy: r.spicy, groupSizes: r.group_sizes || [], vibe: r.vibe,
      interests: r.interests || [], priority: r.priority || [], avoid: r.avoid || [] };
  }
  function groupsForMatch() {
    return state.groups.map(g => {
      const ms = state.members.filter(m => m.group_id === g.id).sort((a, b) => a.seq - b.seq);
      return { id: g.id, slot: g.slot, locked: g.locked, memberIds: ms.map(m => m.application_id),
        responses: Object.fromEntries(ms.map(m => [m.application_id, m.response])) };
    });
  }
  const appById = id => state.applications.find(a => a.id === id);
  const memberOf = id => state.members.find(m => m.application_id === id);
  const groupById = id => state.groups.find(g => g.id === id);
  function removeMember(appId) {
    const m = memberOf(appId); if (!m) return null;
    state.members = state.members.filter(x => x !== m);
    return m.group_id;
  }
  function dropIfEmpty(gid) {
    if (gid && !state.members.some(m => m.group_id === gid)) state.groups = state.groups.filter(g => g.id !== gid);
  }
  function deadlinePassed(g) { return M.isDeadlinePassed({ slot: g.slot }, settingsCamel()); }
  function saveMatching(newGroups, joins, summary, auto) {
    let n = 0;
    (newGroups || []).forEach(ng => {
      const g = { id: uid(), no: state.settings.next_no++, slot: ng.slot, locked: false, created_at: nowIso() };
      state.groups.push(g); n++;
      ng.memberIds.forEach(id => {
        if (memberOf(id)) throw new Error('이미 조가 있는 신청자예요.');
        state.members.push({ application_id: id, group_id: g.id, response: 'pending', added_at: nowIso(), seq: ++state.seq });
      });
    });
    (joins || []).forEach(j => {
      if (memberOf(j.memberId)) throw new Error('이미 조가 있는 신청자예요.');
      state.members.push({ application_id: j.memberId, group_id: j.groupId, response: 'pending', added_at: nowIso(), seq: ++state.seq });
    });
    state.settings.last_run_at = nowIso();
    if (auto) state.settings.last_auto_run_at = nowIso();
    state.settings.last_run_summary = summary || '';
    return n;
  }
  function verify(email, code) {
    const a = state.applications.find(x => x.email === String(email || '').trim().toLowerCase());
    return a && a.code === String(code || '').trim() ? a : null;
  }

  // ===== 서버 함수(RPC) — supabase/01_schema.sql과 같은 규칙 =====
  const rpcs = {
    submit_application({ p_form, p_code }) {
      const f = p_form || {};
      const email = String(f.email || '').trim().toLowerCase();
      const slots = f.slots || [], ints = f.interests || [];
      if (!/^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]+$/.test(email) || !String(f.name || '').trim() || !slots.length || !ints.length || ints.length > 3)
        return { ok: false, reason: 'invalid' };
      const fields = {
        name: String(f.name).trim(), birth_year: f.birth_year || '', gender: f.gender || '응답 안 함', dept: f.dept || '',
        dept_open: !!f.dept_open, slots, allergy: f.allergy || '', budget: f.budget || '무관', food_categories: f.food_categories || [],
        spicy: f.spicy || '보통', group_sizes: f.group_sizes || [], vibe: f.vibe || '둘 다 좋아요', interests: ints,
        favorite_thing: f.favorite_thing || '', priority: f.priority || [], created_at: nowIso()
      };
      const prev = state.applications.find(a => a.email === email);
      if (prev) {
        if (!p_code || p_code !== prev.code) return { ok: false, reason: 'exists' };
        Object.assign(prev, fields);
        dropIfEmpty(removeMember(prev.id));   // 새 조건으로 다시 매칭 대기
        return { ok: true, code: prev.code };
      }
      let code;
      do { code = String(100000 + Math.floor(Math.random() * 900000)); } while (state.applications.some(a => a.code === code));
      state.applications.push(Object.assign({ id: uid(), email, code, avoid: [], sample: false }, fields));
      return { ok: true, code };
    },
    get_my_result({ p_email, p_code }) {
      const a = verify(p_email, p_code);
      if (!a) return { ok: false, locked: false };
      const m = memberOf(a.id), g = m && groupById(m.group_id);
      let group = null;
      if (g) {
        const ms = state.members.filter(x => x.group_id === g.id).sort((x, y) => x.seq - y.seq);
        const apps = ms.map(x => appById(x.application_id));
        group = { id: g.id, no: g.no, slot: g.slot, locked: g.locked, deptCount: new Set(apps.map(p => p.dept)).size,
          members: ms.map((x, i) => ({ id: apps[i].id, name: apps[i].name, email: apps[i].email, deptOpen: apps[i].dept_open,
            dept: apps[i].dept_open ? apps[i].dept : '', interests: apps[i].interests, favoriteThing: apps[i].favorite_thing, response: x.response })) };
      }
      return { ok: true, me: { id: a.id, name: a.name, email: a.email, slots: a.slots, createdAt: a.created_at }, group };
    },
    respond_attend({ p_email, p_code }) {
      const a = verify(p_email, p_code); if (!a) return { ok: false, reason: 'wrong' };
      const m = memberOf(a.id), g = m && groupById(m.group_id);
      if (!g) return { ok: false, reason: 'no_group' };
      if (g.locked || deadlinePassed(g)) return { ok: false, reason: 'closed' };
      m.response = 'yes';
      return { ok: true };
    },
    respond_pass({ p_email, p_code }) {
      const a = verify(p_email, p_code); if (!a) return { ok: false, reason: 'wrong' };
      const m = memberOf(a.id), g = m && groupById(m.group_id);
      if (!g) return { ok: false, reason: 'no_group' };
      if (g.locked || deadlinePassed(g)) return { ok: false, reason: 'closed' };
      const others = state.members.filter(x => x.group_id === g.id && x.application_id !== a.id).map(x => x.application_id);
      a.avoid = [...new Set([...(a.avoid || []), ...others])];
      removeMember(a.id);
      if (state.members.filter(x => x.group_id === g.id).length < 2) {
        state.members = state.members.filter(x => x.group_id !== g.id);
        state.groups = state.groups.filter(x => x.id !== g.id);
      }
      return { ok: true };
    },
    is_admin() { return !!session; },
    admin_save_matching({ p_groups, p_joins, p_summary, p_auto }) { requireAdmin(); return saveMatching(p_groups, p_joins, p_summary, p_auto); },
    admin_move_member({ p_app, p_target }) {
      requireAdmin();
      dropIfEmpty(removeMember(p_app));
      if (p_target) state.members.push({ application_id: p_app, group_id: p_target, response: 'pending', added_at: nowIso(), seq: ++state.seq });
      return null;
    },
    admin_clear({ p_applications }) {
      requireAdmin();
      state.groups = []; state.members = [];
      if (p_applications) state.applications = [];
      state.settings.next_no = 1; state.settings.last_run_summary = '';
      return null;
    }
  };
  function requireAdmin() { if (!session) throw new Error('운영자만 실행할 수 있어요.'); }

  // ===== 표 조회·수정 (운영자 화면이 쓰는 모양만) =====
  const tables = {
    settings: () => [state.settings],
    applications: () => state.applications,
    groups: () => state.groups,
    group_members: () => state.members
  };
  function execQuery(q) {
    if (q.table !== 'settings' && !session) return { data: null, error: { code: '42501', message: 'permission denied' } }; // RLS 흉내
    const list = tables[q.table]();
    const match = r => q.filters.every(([c, v]) => r[c] === v);
    if (q.op === 'insert') {
      const rows = [].concat(q.payload).map(r => Object.assign({ id: uid(), avoid: [], created_at: nowIso(), gender: '응답 안 함', allergy: '', favorite_thing: '' }, r));
      for (const r of rows) if (state.applications.some(a => a.email === r.email)) return { data: null, error: { message: '이미 있는 이메일이에요: ' + r.email } };
      state.applications.push(...rows); save();
      return { data: null, error: null };
    }
    if (q.op === 'update') { list.filter(match).forEach(r => Object.assign(r, q.payload)); save(); return { data: null, error: null }; }
    if (q.op === 'delete') {
      const gone = new Set(list.filter(match).map(r => r.id));
      if (q.table === 'groups') { state.groups = state.groups.filter(g => !gone.has(g.id)); state.members = state.members.filter(m => !gone.has(m.group_id)); }
      save();
      return { data: null, error: null };
    }
    let rows = clone(list.filter(match));
    if (q.orderBy) rows.sort((a, b) => (a[q.orderBy] > b[q.orderBy] ? 1 : a[q.orderBy] < b[q.orderBy] ? -1 : 0) * (q.asc ? 1 : -1));
    if (q.single) {
      if (!rows.length && q.single === 'single') return { data: null, error: { message: 'not found' } };
      return { data: rows[0] || null, error: null };
    }
    return { data: rows, error: null };
  }
  function from(table) {
    const q = { table, op: 'select', filters: [], orderBy: null, asc: true, payload: null, single: null };
    const b = {
      select() { return b; },
      eq(c, v) { q.filters.push([c, v]); return b; },
      order(c, o) { q.orderBy = c; q.asc = !(o && o.ascending === false); return b; },
      single() { q.single = 'single'; return b; },
      maybeSingle() { q.single = 'maybe'; return b; },
      insert(rows) { q.op = 'insert'; q.payload = rows; return b; },
      update(p) { q.op = 'update'; q.payload = p; return b; },
      delete() { q.op = 'delete'; return b; },
      then(ok, fail) { return delay().then(() => execQuery(q)).then(ok, fail); }
    };
    return b;
  }
  const delay = () => new Promise(r => setTimeout(r, 120)); // 실제 서버처럼 아주 잠깐 기다림

  const client = {
    from,
    async rpc(name, args) {
      await delay();
      try {
        const data = rpcs[name](args || {});
        save();
        return { data, error: null };
      } catch (e) { return { data: null, error: { message: e.message } }; }
    },
    auth: {
      async getSession() { return { data: { session } }; },
      async signInWithPassword({ email, password }) {
        await delay();
        if (!email || !password) return { data: null, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } };
        session = { user: { email } };
        return { data: { session }, error: null };
      },
      async signOut() { session = null; return { error: null }; }
    }
  };

  state = load() || (seed(), save(), state);
  root.supabase = { createClient: () => client };
  root.SamilDemo = { DEMO_EMAIL, DEMO_CODE, reset, _state: () => state, _client: client };
})(typeof window !== 'undefined' ? window : globalThis);
