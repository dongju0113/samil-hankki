// 매일 22:00(한국 시간)에 Vercel Cron이 호출하는 자동 매칭 서버 함수
// - 규칙은 화면과 같은 matching.js를 사용
// - Vercel 환경변수 필요: SUPABASE_SECRET_KEY (Supabase secret key), CRON_SECRET (아무 긴 문자열)
// - secret key는 이 서버 함수 안에서만 쓰이고 브라우저로는 절대 내려가지 않아요
require('../matching.js');
const M = globalThis.SamilMatching;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lhanlpwjqrthrrpunryw.supabase.co';

async function db(path, { method = 'GET', body } = {}) {
  const key = process.env.SUPABASE_SECRET_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function fromDbApp(r) {
  return {
    id: r.id, name: r.name, dept: r.dept, birthYear: r.birth_year, slots: r.slots || [],
    budget: r.budget, foodCategories: r.food_categories || [], spicy: r.spicy, groupSizes: r.group_sizes || [],
    vibe: r.vibe, interests: r.interests || [], priority: r.priority || [], avoid: r.avoid || []
  };
}

module.exports = async (req, res) => {
  // Vercel Cron은 Authorization: Bearer <CRON_SECRET> 을 붙여서 호출함. 그 외 호출은 거부
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  if (!process.env.SUPABASE_SECRET_KEY) {
    return res.status(500).json({ ok: false, error: 'SUPABASE_SECRET_KEY 환경변수가 없어요' });
  }
  const force = req.query && req.query.force === '1'; // 테스트용 즉시 실행 (수동 매칭으로 기록)

  try {
    const now = new Date();
    const [s] = await db('settings?id=eq.1&select=*');
    const settings = { autoOn: s.auto_on, time: s.match_time, cutoffMin: s.cutoff_min, includePast: s.include_past, anchor: s.anchor };

    if (!force) {
      if (!settings.autoOn) return res.status(200).json({ ok: true, skipped: '자동 매칭 꺼짐' });
      // 운영자 콘솔에서 이미 실행했거나, 설정을 방금 바꿨으면 건너뜀 (화면의 checkAutoMatch와 같은 기준)
      const due = M.lastScheduledBefore(settings.time, now);
      const since = Math.max(new Date(settings.anchor).getTime(), s.last_auto_run_at ? new Date(s.last_auto_run_at).getTime() : 0);
      if (due.getTime() <= since) return res.status(200).json({ ok: true, skipped: '이번 회차는 이미 실행됨' });
    }

    const [apps, groups, members] = await Promise.all([
      db('applications?select=*&order=created_at.desc'),
      db('groups?select=*&order=no'),
      db('group_members?select=*&order=seq')
    ]);
    const byGroup = Object.fromEntries(groups.map(g => [g.id, { id: g.id, slot: g.slot, locked: g.locked, memberIds: [], responses: {} }]));
    members.forEach(m => {
      const g = byGroup[m.group_id]; if (!g) return;
      g.memberIds.push(m.application_id);
      g.responses[m.application_id] = m.response;
    });

    const source = force ? 'manual' : 'auto';
    const result = M.computeMatching({ responses: apps.map(fromDbApp), groups: Object.values(byGroup), settings, now, source });
    await db('rpc/admin_save_matching', {
      method: 'POST',
      body: { p_groups: result.newGroups, p_joins: result.joins, p_summary: result.summary, p_auto: source === 'auto' }
    });
    return res.status(200).json({ ok: true, summary: result.summary });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};
