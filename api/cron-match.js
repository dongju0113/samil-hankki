// 매일 22:00(한국 시간)에 Vercel Cron이 호출하는 자동 매칭 서버 함수
// - 규칙은 화면과 같은 matching.js를 사용
// - 매칭 직후 새로 조가 정해진 사람에게 매칭 메일 발송 (api/_notify.js)
// - Vercel 환경변수 필요: SUPABASE_SECRET_KEY (Supabase secret key), CRON_SECRET (아무 긴 문자열)
// - secret key는 이 서버 함수 안에서만 쓰이고 브라우저로는 절대 내려가지 않아요
require('../matching.js');
const M = globalThis.SamilMatching;
const { db: realDb } = require('./_db.js');
const { notifyPending: realNotify } = require('./_notify.js');

function fromDbApp(r) {
  return {
    id: r.id, name: r.name, dept: r.dept, gender: r.gender, birthYear: r.birth_year, mbti: r.mbti || '',
    wantGenders: r.want_genders || [], wantDepts: r.want_depts || [], groupSizes: r.group_sizes || [],
    slots: r.slots || [], avoid: r.avoid || []
  };
}

async function handler(req, res, deps = {}) {
  const db = deps.db || realDb;
  const notifyPending = deps.notifyPending || realNotify;
  // Vercel Cron은 Authorization: Bearer <CRON_SECRET> 을 붙여서 호출함. 그 외 호출은 거부
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  if (!process.env.SUPABASE_SECRET_KEY) {
    return res.status(500).json({ ok: false, error: 'SUPABASE_SECRET_KEY 환경변수가 없어요' });
  }
  const force = req.query && req.query.force === '1'; // 테스트용 즉시 실행 (수동 매칭으로 기록)
  const appUrl = `https://${req.headers['x-forwarded-host'] || req.headers.host || 'samil-hankki261005.vercel.app'}`;
  const started = Date.now();
  // 매칭 메일: 실패해도 매칭 결과는 이미 저장됨 (남은 사람은 23시 추가 발송·운영자 콘솔에서 이어서)
  const mail = () => notifyPending({ appUrl, budgetMs: Math.max(5000, 50000 - (Date.now() - started)) })
    .catch(e => ({ ok: false, error: String(e.message || e) }));

  try {
    const now = new Date();
    const [s] = await db('settings?id=eq.1&select=*');
    const settings = { autoOn: s.auto_on, time: s.match_time, cutoffMin: s.cutoff_min, includePast: s.include_past, anchor: s.anchor };

    if (!force) {
      if (!settings.autoOn) return res.status(200).json({ ok: true, skipped: '자동 매칭 꺼짐', mail: await mail() });
      // 운영자 콘솔에서 이미 실행했거나, 설정을 방금 바꿨으면 건너뜀 (화면의 checkAutoMatch와 같은 기준)
      const due = M.lastScheduledBefore(settings.time, now);
      const since = Math.max(new Date(settings.anchor).getTime(), s.last_auto_run_at ? new Date(s.last_auto_run_at).getTime() : 0);
      if (due.getTime() <= since) return res.status(200).json({ ok: true, skipped: '이번 회차는 이미 실행됨', mail: await mail() });
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
    return res.status(200).json({ ok: true, summary: result.summary, mail: await mail() });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

module.exports = (req, res) => handler(req, res);
module.exports.handler = handler;
