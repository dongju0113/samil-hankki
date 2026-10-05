// 전체 검사: node tests/run-all.cjs  (처음 한 번은 tests 폴더에서 npm install 필요 — SQL 검사용)
const { execFileSync } = require('child_process')
const fs = require('fs'), path = require('path'), vm = require('vm')
const root = path.join(__dirname, '..')
let failed = 0

function step(name, fn) {
  console.log(`\n▶ ${name}`)
  try { fn(); } catch (e) { failed++; console.log(`  ✗ ${name} 실패`); if (e.stdout) process.stdout.write(e.stdout.toString()); else console.log('  ' + e.message) }
}
const run = file => process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, file)], { cwd: root }).toString())

step('문법 검사 (index.html 스크립트, matching.js, api/*.js)', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  new vm.Script(html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>')), { filename: 'index.html' })
  for (const f of ['matching.js', ...fs.readdirSync(path.join(root, 'api')).map(f => 'api/' + f)]) {
    execFileSync(process.execPath, ['--check', path.join(root, f)])
  }
  console.log('  ✓ 문법 오류 없음')
})
step('보안: 비밀 키가 코드에 없는지', () => {
  const files = ['index.html', 'matching.js', ...fs.readdirSync(path.join(root, 'api')).map(f => 'api/' + f)]
  const leaked = files.filter(f => /sb_secret_[A-Za-z0-9_-]{10,}|service_role"?\s*:\s*"?eyJ/.test(fs.readFileSync(path.join(root, f), 'utf8')))
  if (leaked.length) throw new Error('비밀 키 의심: ' + leaked.join(', '))
  console.log('  ✓ secret key 없음')
})
step('매칭 규칙', () => run('matching.test.cjs'))
step('자동 매칭 서버 함수', () => run('cron.test.cjs'))
step('메일 발송 서버 함수', () => run('mail.test.cjs'))
step('백업 데모 가짜 저장소', () => run('demo.test.cjs'))
step('Supabase SQL (RLS·함수)', () => {
  if (!fs.existsSync(path.join(__dirname, 'node_modules', '@electric-sql'))) throw new Error('tests 폴더에서 먼저 npm install 하세요')
  run('sql.test.mjs')
})

console.log(failed ? `\n❌ ${failed}개 검사 실패 — 커밋/push 하지 마세요` : '\n✅ 전체 통과')
process.exit(failed ? 1 : 0)
