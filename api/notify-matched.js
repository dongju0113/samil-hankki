// 매칭 메일 발송 주소
// - 운영자 콘솔: "지금 매칭 실행"·조원 이동 직후, 운영자 로그인 토큰으로 POST (남은 사람이 있으면 화면이 반복 호출)
// - Vercel Cron: 23시(KST) 추가 발송 (자동 매칭 때 시간 안에 다 못 보낸 사람)
const { notifyPending } = require('./_notify.js');
const { isAdminToken } = require('./_db.js');

async function handler(req, res, deps = {}) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const isCron = !!process.env.CRON_SECRET && token === process.env.CRON_SECRET;
  if (!isCron) {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
    if (!await (deps.isAdminToken || isAdminToken)(token)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  if (!process.env.SUPABASE_SECRET_KEY) return res.status(500).json({ ok: false, error: 'SUPABASE_SECRET_KEY 환경변수가 없어요' });
  try {
    const appUrl = `https://${req.headers['x-forwarded-host'] || req.headers.host || 'samil-hankki261005.vercel.app'}`;
    const result = await (deps.notifyPending || notifyPending)({ appUrl, db: deps.db, connect: deps.connect, budgetMs: deps.budgetMs });
    return res.status(200).json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

module.exports = (req, res) => handler(req, res);
module.exports.handler = handler;
