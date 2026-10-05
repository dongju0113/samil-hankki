# 심사용 백업 데모(Claude Artifact) 만들기
#   python artifact/build.py   →  artifact/samil-hankki-demo.html
# index.html + matching.js + artifact/demo-backend.js 를 한 파일로 합친다. 화면 코드는 그대로 재사용하고,
# Supabase·서버·메일 부분만 브라우저 안 가짜 저장소(demo-backend.js)로 바뀐다.
# 앱을 고친 뒤 이 스크립트를 다시 돌리고 Artifact를 다시 게시하면 백업 데모도 최신이 된다.
import pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
html = (ROOT / 'index.html').read_text(encoding='utf-8')
matching = (ROOT / 'matching.js').read_text(encoding='utf-8')
backend = (ROOT / 'artifact' / 'demo-backend.js').read_text(encoding='utf-8')
LIVE = 'https://samil-hankki261005.vercel.app'


def take(pattern, text):
    m = re.search(pattern, text, re.S)
    assert m, pattern
    return m


head = take(r'<head>(.*)</head>', html).group(1)
body_m = take(r'<body([^>]*)>(.*)</body>', html)
body_attrs, body = body_m.group(1), body_m.group(2)

# Artifact가 문서 뼈대(doctype·charset·viewport)를 붙여 주므로 중복 제거
head = re.sub(r'\s*<meta charset[^>]*>', '', head)
head = re.sub(r'\s*<meta name="viewport"[^>]*>', '', head)
head = re.sub(r'<title>.*?</title>', '<title>삼일한끼</title>', head)
# Supabase CDN 대신 가짜 저장소, matching.js는 안에 포함
head = re.sub(r'\s*<!-- Supabase \(CDN\) -->\s*<script src="https://cdn\.jsdelivr\.net/npm/@supabase/supabase-js@2"></script>', '', head)
head = head.replace('<script src="matching.js"></script>',
                    '<script>\n' + matching + '\n</script>\n  <!-- 백업 데모: Supabase 대신 브라우저 안 가짜 저장소 -->\n  <script>\n' + backend + '\n</script>')
assert 'supabase-js' not in head and 'src="matching.js"' not in head

banner = f'''
  <!-- 백업 데모 안내 -->
  <aside id="demoBanner" class="w-full max-w-[640px] mx-auto mb-6 rounded-2xl border border-pwc-border bg-white/90 shadow-pwc px-4 py-3 space-y-2" aria-label="백업 데모 안내">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="apple-caption-strong text-ink"><span class="px-1.5 py-0.5 mr-1 rounded text-[10px] font-bold bg-pwc-orange text-white align-middle">백업 데모</span> 심사용 체험 버전</p>
      <button type="button" id="demoResetBtn" class="apple-fine-print font-semibold text-muted hover:text-pwc-orange underline">데모 처음 상태로</button>
    </div>
    <p class="apple-fine-print text-muted leading-relaxed">화면과 매칭 규칙은 실제 서비스와 같아요. 데이터는 이 브라우저에만 임시 저장되고, 이메일은 보내지 않아요.
      실제 서비스: <a class="text-pwc-orange font-semibold underline break-all" href="{LIVE}" target="_blank" rel="noopener">{LIVE.replace('https://', '')}</a></p>
    <div class="flex flex-wrap gap-2">
      <button type="button" id="demoTryResult" class="apple-press px-3 py-1.5 rounded-full bg-pwc-soft border border-pwc-border apple-fine-print font-semibold text-ink hover:border-pwc-orange">매칭 결과 바로 보기 · demo@example.com / 123456</button>
      <span class="px-3 py-1.5 rounded-full border border-hairline apple-fine-print text-muted">운영자 콘솔: 아무 이메일·비밀번호로 로그인</span>
    </div>
    <p class="apple-fine-print text-muted">2026 Discover 바이브코딩 D-4조 과제 작품이며, 삼일회계법인의 공식 서비스가 아니에요.</p>
  </aside>
'''

demo_script = '''
  <script>
    // ===== 백업 데모 전용 =====
    // 메일 발송 대신 안내 문구만 (실제 서비스는 api/send-code.js가 발송)
    window.sendCodeEmail = function (email) {
      const el = document.getElementById('mailStatus');
      el.className = 'apple-fine-print text-muted';
      el.innerText = '📧 실제 서비스에서는 이 코드가 ' + email + '로 메일 발송돼요. (데모에서는 보내지 않아요)';
    };
    document.getElementById('demoTryResult').addEventListener('click', () => {
      try { localStorage.setItem(MY_KEY, JSON.stringify({ email: SamilDemo.DEMO_EMAIL, code: SamilDemo.DEMO_CODE })); } catch (e) {}
      goToStep(7);
      document.getElementById('resultEmail').value = SamilDemo.DEMO_EMAIL;
      document.getElementById('resultCode').value = SamilDemo.DEMO_CODE;
      lookupResult();
    });
    document.getElementById('demoResetBtn').addEventListener('click', async () => {
      if (!await openDialog({ title: '데모 처음 상태로', message: '이 브라우저에서 입력한 신청과 변경 내용을 지우고 샘플 데이터로 되돌릴까요?', okText: '되돌리기', danger: true })) return;
      SamilDemo.reset();
      if (isAdmin) await exitAdmin(); else goHome();
      await loadSettings(); updateLandingNote();
      showToast('샘플 데이터로 되돌렸어요.');
    });
  </script>
'''

out = (head.strip() + '\n'
       + f'<div{body_attrs}>\n' + banner + body.strip() + '\n</div>\n'
       + demo_script)
dest = ROOT / 'artifact' / 'samil-hankki-demo.html'
dest.write_text(out, encoding='utf-8', newline='\n')
print(f'{dest.relative_to(ROOT)}  ({len(out.encode("utf-8")) // 1024} KB)')
