# 삼일한끼 — Claude 작업 규칙

2026 삼일회계법인 신입 연수 점심 매칭 웹앱. 사용자는 비개발자이므로 설명은 한국어로 쉽게, 직접 할 일은 단계별로 안내한다.

## 작업 흐름 (항상 이 순서, 사용자가 따로 말하지 않아도 자동으로)
1. 수정한다.
2. `node tests/run-all.cjs` 로 전체 검사한다. (처음이면 `tests` 폴더에서 `npm install` 먼저)
3. **전체 통과일 때만** 커밋하고 `git push origin main` 한다. push하면 Vercel이 실제 사이트에 바로 배포된다.
   - 실패하면 커밋·push하지 말고, 고치거나 사용자에게 무엇이 왜 실패했는지 알린다.
   - 새 기능·버그 수정에는 `tests/`에 검사를 함께 추가한다.
4. 화면·매칭 규칙을 바꿨다면 `python artifact/build.py`로 백업 데모도 다시 만들어 커밋하고, Artifact를 같은 주소로 재게시한다.
5. push 뒤 1~2분 기다려 https://samil-hankki261005.vercel.app 에서 바뀐 부분이 실제로 동작하는지 확인하고 결과를 알린다.
6. `supabase/*.sql`을 바꿨다면, 이미 운영 중인 DB용으로 바뀐 부분만 담은 새 번호 파일(예: `04_....sql`)을 만들고 **push 전에** 사용자에게 SQL Editor 실행을 요청한다. (DB가 먼저 바뀌어야 새 코드가 동작)

## 지켜야 할 것
- 앱은 빌드 도구 없는 HTML 한 파일(`index.html`) + CDN `<script>` 구조. React·Vite·npm 빌드로 바꾸지 않는다. (`tests/package.json`은 검사용일 뿐)
- `matching.js`를 바꾸면 `index.html`의 `<script src="matching.js?v=날짜">` 버전도 올린다 (브라우저가 예전 파일을 쓰지 않게).
- 매칭 규칙은 `matching.js` 하나에만 있다. 화면(`index.html`)과 서버(`api/cron-match.js`)가 같이 쓴다. 규칙을 바꾸려면 사용자 확인을 먼저 받는다.
- 브라우저 코드에는 Supabase **publishable key만**. secret key·Gmail 앱 비밀번호는 Vercel 환경변수에만 있고, 코드·GitHub·채팅에 절대 넣지 않는다.
- 신청자는 표를 직접 읽거나 쓸 수 없다(RLS). 신청자 기능은 `submit_application` / `get_my_result` / `respond_attend` / `respond_pass` 함수로만.
- 시간 계산은 항상 한국 시간(KST) 기준. 서버(Vercel)는 UTC로 돈다.
- 커밋 작성자는 `dongju0113`. GitHub 저장소 `dongju0113/samil-hankki`(**공개** — 개인정보·키를 절대 커밋하지 않는다. 팀원 chayunho, rmfls1269 초대됨).

## 구조
| 파일 | 역할 |
|---|---|
| `index.html` | 화면 전체 (시작 페이지, 신청 2단계, 신청 완료, 내 결과, 운영자 콘솔) |
| `matching.js` | 매칭 규칙·날짜 계산 (오늘 포함 7일 × 점심 시작 4칸, 희망 인원, MBTI 궁합표, 응답 마감 규칙) |
| `api/cron-match.js` | 매일 22시(KST) 자동 매칭. `vercel.json`의 cron `0 13 * * *`(UTC) |
| `api/send-code.js` | 신청 완료 시 확인 코드 메일 발송 (samilhankki@gmail.com, Gmail SMTP) |
| `api/notify-matched.js`, `api/_notify.js` | 매칭 메일: 새로 조가 정해진 사람에게 발송. 자동 매칭 직후·23시 추가 발송(cron `0 14 * * *`)·운영자 매칭/조원 이동 직후. `group_members.notified_at`으로 중복 방지 |
| `api/_mail.js`, `api/_db.js` | 서버 함수 공용 (Gmail SMTP, secret key로 Supabase 접근). `_`로 시작해 주소로는 안 열림 |
| `supabase/01~08_*.sql` | 표·RLS·함수. 사용자가 Supabase SQL Editor에서 직접 실행 |
| `docs/` | 프로젝트 현황, Supabase·Vercel·Gmail 설정 가이드 |
| `tests/` | 전체 검사 (`node tests/run-all.cjs`) |
| `artifact/` | 심사용 백업 데모. `python artifact/build.py`로 `samil-hankki-demo.html` 생성 → 같은 파일을 Artifact로 재게시 (https://claude.ai/artifact/PW8QAT9sBa15ZRtxDW2mmR) |

## Vercel 환경변수 (Production)
`SUPABASE_SECRET_KEY`, `CRON_SECRET`, `GMAIL_USER`, `GMAIL_APP_PASSWORD` — 값은 Vercel에만 있다.
