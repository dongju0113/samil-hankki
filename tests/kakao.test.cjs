// 안드로이드 카카오톡 내장 브라우저 → 외부 브라우저로 다시 열기 검사 (index.html 맨 위 스크립트)
const fs = require('fs'), path = require('path'), vm = require('vm')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m) }

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
const m = html.match(/<script>\s*(\/\/ 안드로이드 카카오톡[\s\S]*?)<\/script>/)
ok(!!m && html.indexOf(m[0]) < html.indexOf('cdn.tailwindcss.com'), '다른 스크립트보다 먼저 실행 (화면을 그리기 전에 넘어감)')

const URL_NOW = 'https://samil-hankki261005.vercel.app/'
function run(ua) {
  const ctx = { navigator: { userAgent: ua }, location: { href: URL_NOW }, encodeURIComponent }
  ctx.window = ctx
  vm.createContext(ctx); vm.runInContext(m[1], ctx)
  return { kakaoAndroid: ctx.IS_KAKAO_ANDROID, href: ctx.location.href }
}
const UA = {
  kakaoAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.81 Mobile Safari/537.36;KAKAOTALK 2410520',
  kakaoIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.9.0',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  samsungInternet: 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
}
let r = run(UA.kakaoAndroid)
ok(r.kakaoAndroid && r.href === 'kakaotalk://web/openExternal?url=' + encodeURIComponent(URL_NOW), '갤럭시 카카오톡 → 외부 브라우저로 다시 열기')
for (const k of ['kakaoIphone', 'chromeAndroid', 'samsungInternet', 'iphoneSafari']) {
  r = run(UA[k])
  ok(!r.kakaoAndroid && r.href === URL_NOW, `${k} → 그대로 (넘어가지 않음)`)
}
ok(/id="kakaoBanner"[^>]*hidden/.test(html) && html.includes("document.getElementById('kakaoBanner').hidden = !window.IS_KAKAO_ANDROID"), '안내 띠는 안드로이드 카카오톡에서만 보임')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
