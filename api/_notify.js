// 매칭 메일: 조가 정해졌는데 아직 알림을 못 받은 조원(group_members.notified_at이 비어 있음)에게 메일 발송
// - 매일 자동 매칭 직후(api/cron-match.js), 23시 추가 발송, 운영자 "지금 매칭 실행"·조원 이동 직후(api/notify-matched.js)에 호출
// - 보낸 사람(그리고 메일을 보낼 수 없는 샘플·테스트 주소)은 notified_at을 기록해 다시 보내지 않음
// - 정해진 시간 안에 다 못 보내면 남은 사람은 다음 호출 때 이어서 보냄
require('../matching.js');
const M = globalThis.SamilMatching;
const { db: realDb, inList } = require('./_db.js');
const { canMail, buildMessage, openSession, mailConfig } = require('./_mail.js');

const CONNECTIONS = 4;          // 동시에 여는 Gmail 연결 수
const CHUNK = 100;              // in.(...) 한 번에 넣는 id 수

function chunks(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

// 연락 담당 안내 (조마다 무작위 1명, DB가 정함)
function contactLine(me, group, mates) {
  if (!group.contact_id) return [];
  if (group.contact_id === me.id) return ['■ 연락 담당: 나! 점심 전에 조원들에게 먼저 연락해 주세요 (조원 이메일은 결과 화면에서 확인)'];
  const c = mates.find(m => m.id === group.contact_id);
  return c ? [`■ 연락 담당: ${M.maskName(c.name)}님이 먼저 연락드릴 거예요`] : [];
}

function composeText({ me, group, mates, deadline, appUrl }) {
  // 조원 이름은 가려서 (최*주), 부문·MBTI 함께
  const mateLine = mates.length
    ? mates.map(m => `${M.maskName(m.name)}(${[m.dept, m.mbti].filter(Boolean).join('·')})`).join(', ')
    : '-';
  return [
    `${me.name}님, 점심 조가 정해졌어요!`,
    '',
    `■ ${group.no}조 · ${group.slot} 시작 · ${mates.length + 1}명`,
    `■ 함께하는 동기: ${mateLine}`,
    ...contactLine(me, group, mates),
    group.locked
      ? '■ 운영자가 확정한 조예요.'
      : `■ 응답 마감: ${M.fmtDateTime(deadline)} — 마감까지 [참석할게요]를 누른 조원끼리만 만나요 (누르지 않으면 자동 취소)`,
    '',
    '아래 주소의 [내 결과 확인하기]에서 이메일과 확인 코드를 넣고',
    '[참석할게요] 또는 [이번 조는 패스]를 눌러 주세요.',
    appUrl,
    '',
    '사정이 생기면 [이번 조는 패스]를 눌러 주세요. 다음 매칭에서 다시 조를 찾아 드려요.',
    '',
    '- 삼일한끼 (발신 전용 메일입니다)'
  ].join('\r\n');
}

async function notifyPending({ appUrl, budgetMs = 45000, db = realDb, connect, now = new Date() } = {}) {
  const started = Date.now();
  const pending = await db('group_members?select=application_id,group_id&notified_at=is.null&order=seq');
  if (!pending.length) return { ok: true, sent: 0, skipped: 0, failed: 0, remaining: 0 };

  const groupIds = [...new Set(pending.map(p => p.group_id))];
  const [groups, allMembers, settingsRows] = await Promise.all([
    Promise.all(chunks(groupIds, CHUNK).map(ids => db(`groups?select=*&id=${inList(ids)}`))).then(r => r.flat()),
    Promise.all(chunks(groupIds, CHUNK).map(ids => db(`group_members?select=application_id,group_id,seq&group_id=${inList(ids)}&order=seq`))).then(r => r.flat()),
    db('settings?id=eq.1&select=cutoff_min,include_past')
  ]);
  const appIds = [...new Set(allMembers.map(m => m.application_id))];
  const apps = (await Promise.all(chunks(appIds, CHUNK).map(ids => db(`applications?select=id,name,email,dept,mbti,sample&id=${inList(ids)}`)))).flat();
  const appById = Object.fromEntries(apps.map(a => [a.id, a]));
  const groupById = Object.fromEntries(groups.map(g => [g.id, g]));
  const settings = { cutoffMin: settingsRows[0] ? settingsRows[0].cutoff_min : 60, includePast: false };

  // 보낼 목록 / 보낼 수 없는 주소(샘플·테스트 도메인)
  const jobs = [], skipped = [];
  for (const p of pending) {
    const me = appById[p.application_id], group = groupById[p.group_id];
    if (!me || !group) continue;
    if (me.sample || !canMail(me.email)) { skipped.push(me.id); continue; }
    const mates = allMembers.filter(m => m.group_id === group.id && m.application_id !== me.id).map(m => appById[m.application_id]).filter(Boolean);
    jobs.push({ id: me.id, email: me.email, subject: `[삼일한끼] 점심 조가 정해졌어요 · ${group.slot}`,
      text: composeText({ me, group, mates, deadline: M.groupDeadline(group, settings), appUrl }) });
  }

  const cfg = mailConfig();
  const sent = [], failed = [];
  let stopped = !cfg;  // 메일 설정이 없으면 보내지 않고 다음 기회로
  if (cfg && jobs.length) {
    const queue = [...jobs];
    const worker = async () => {
      let session = null;
      try {
        while (queue.length && !stopped && Date.now() - started < budgetMs) {
          const job = queue.shift();
          if (!session) session = await openSession({ ...cfg, connect });
          try {
            await session.send(job.email, buildMessage({ from: cfg.user, to: job.email, subject: job.subject, text: job.text }));
            sent.push(job.id);
          } catch (e) {
            if (e.permanent) { failed.push(job.id); continue; }   // 없는 주소 등: 이 사람만 건너뜀
            queue.unshift(job); throw e;                           // 연결·한도 문제: 남은 건 다음 기회에
          }
        }
      } catch (e) {
        console.error('notify', e.message);
        stopped = true;
      } finally {
        if (session) session.close();
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONNECTIONS, jobs.length) }, worker));
  }

  // 보낸 사람 + 보낼 수 없는 사람 → 다시 보내지 않도록 기록
  const done = [...sent, ...skipped, ...failed];
  for (const ids of chunks(done, CHUNK)) {
    await db(`group_members?application_id=${inList(ids)}`, { method: 'PATCH', body: { notified_at: now.toISOString() }, headers: { Prefer: 'return=minimal' } });
  }
  const remaining = jobs.length - sent.length - failed.length;
  return { ok: true, sent: sent.length, skipped: skipped.length, failed: failed.length, remaining, mailConfigured: !!cfg };
}

module.exports = { notifyPending, composeText };
