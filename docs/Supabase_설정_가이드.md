# 삼일한끼 Supabase 설정 가이드 (비개발자용)

Supabase 웹사이트(https://supabase.com/dashboard)에서 **삼일한끼 프로젝트**를 연 상태로 따라 하세요.
전체 10~15분 정도 걸려요.

---

## 1단계. 표와 보안 규칙 만들기

1. 왼쪽 메뉴에서 **SQL Editor**(`>_` 모양 아이콘)를 누릅니다.
2. 위쪽의 **+ New query**(또는 **New SQL snippet**)를 누릅니다.
3. 이 폴더의 `supabase/01_schema.sql` 파일을 메모장으로 열어 **전체 선택(Ctrl+A) → 복사(Ctrl+C)** 합니다.
4. Supabase 편집 칸에 **붙여 넣기(Ctrl+V)** 하고 오른쪽 아래 **Run**(또는 Ctrl+Enter)을 누릅니다.
5. 아래쪽에 **Success. No rows returned** 가 보이면 성공입니다.
   - "destructive operation" 같은 경고 창이 뜨면 **Run this query**를 눌러도 됩니다. (기존 데이터를 지우지 않는 설정이에요)
6. 왼쪽 메뉴 **Table Editor**를 눌러 아래 5개 표가 생겼는지 확인합니다.
   `admins`, `applications`, `group_members`, `groups`, `settings`

## 2단계. 운영자 계정 만들기

1. 왼쪽 메뉴 **Authentication** → **Users** 를 누릅니다.
2. 오른쪽 위 **Add user** → **Create new user** 를 누릅니다.
3. 운영자가 쓸 **이메일**과 **비밀번호**를 입력합니다. (비밀번호는 길고 추측하기 어렵게. 1234 같은 건 안 돼요)
4. **Auto Confirm User** 에 체크하고 **Create user** 를 누릅니다.

## 3단계. 그 계정을 운영자로 등록하기

1. 다시 **SQL Editor → + New query**.
2. `supabase/02_add_admin.sql` 내용을 붙여 넣습니다.
3. `운영자이메일@example.com` 부분을 **2단계에서 만든 이메일**로 바꿉니다. (따옴표 `'`는 그대로 두세요)
4. **Run** → 아래 결과 표에 그 이메일이 한 줄 보이면 성공입니다.
   - 아무것도 안 보이면 이메일 철자가 2단계와 다른 거예요. 고쳐서 다시 Run 하세요.
5. 운영자가 여러 명이면 이메일만 바꿔서 2~3단계를 반복합니다.

## 4단계. 아무나 회원가입 못 하게 막기 (권장)

1. **Authentication** → **Sign In / Providers**(메뉴 이름이 *Providers* 또는 *Settings*일 수도 있어요).
2. **Allow new users to sign up** 을 **끄고** 저장합니다.
3. **Email** 로그인 방식 자체는 **켜 둔 상태**여야 합니다. (운영자가 이메일+비밀번호로 로그인해요)

> 회원가입을 열어 두더라도 `admins` 표에 등록되지 않은 계정은 신청 목록을 볼 수 없어요. 이건 이중 안전장치예요.

## 5단계. 앱에서 확인하기

1. `index.html`을 더블클릭해서 브라우저로 엽니다.
2. **점심 한끼 함께해요!** → 설문 제출 → **6자리 코드**가 나오는지 확인합니다.
3. 처음 화면 → **내 결과 확인하기** → "매칭을 기다리고 있어요"가 나오면 정상입니다.
4. 오른쪽 위 **운영자 콘솔** → 2단계 이메일·비밀번호로 로그인합니다.
5. **샘플 30명 추가** → **지금 매칭 실행** → 조가 만들어지는지 봅니다.
   - 지난 날짜만 남아서 매칭이 안 되면 **지난 시간대도 매칭하기(테스트용)** 를 켜고 **설정 저장** 후 다시 실행하세요.
6. Supabase **Table Editor → groups** 에도 조가 생겼는지 확인합니다.
7. 테스트가 끝나면 운영자 콘솔에서 **응답 전체 삭제**, 테스트 모드도 다시 끄고 **설정 저장**.

---

## 6단계. 매일 22:00 자동 매칭 켜기 (Vercel Cron)

### 6-1. Supabase에 서버 실행 권한 추가
1. **SQL Editor → + New query** 에 `supabase/03_allow_cron.sql` 전체를 붙여 넣고 **Run** → **Success** 확인.
   (01번을 처음 실행하는 새 프로젝트라면 이미 들어 있어서 생략해도 돼요)

### 6-2. Supabase secret key 복사
1. Supabase 왼쪽 아래 **Project Settings**(톱니바퀴) → **API Keys**.
2. **Secret keys** 영역에서 `sb_secret_...` 키 오른쪽 **복사** 버튼을 누릅니다. (키가 없으면 **+ New secret key** 로 하나 만드세요)
   - 이 키는 **Vercel 환경변수 칸에만** 붙여 넣습니다. 다른 곳에 붙여 넣거나 저장하지 마세요.

### 6-3. Vercel 환경변수 2개 넣기
1. Vercel 대시보드 → **samil-hankki** 프로젝트 → 위쪽 **Settings** → 왼쪽 **Environment Variables**.
2. 아래 2개를 하나씩 추가합니다. (Environments는 기본값 그대로, **Sensitive** 켜기 권장)

   | Key | Value |
   |---|---|
   | `SUPABASE_SECRET_KEY` | 6-2에서 복사한 `sb_secret_...` |
   | `CRON_SECRET` | 아무도 못 맞힐 긴 영문·숫자 (30자 이상) |

3. **Save** 후, 위쪽 **Deployments** → 맨 위 배포의 `⋯` → **Redeploy** (환경변수는 다시 배포해야 적용돼요).

### 6-4. 확인
- Vercel 프로젝트 → **Settings → Cron Jobs** 에 `/api/cron-match` · `0 13 * * *` 가 보이면 등록 완료.
  (`0 13 * * *` 은 세계 표준시 13시 = **한국 시간 22시**)
- 다음 날 운영자 콘솔 **자동 매칭 설정 → 마지막 실행** 에 "자동 매칭 …"이 찍혀 있으면 정상.

### 알아 두기
- 무료(Hobby) 플랜은 **22:00~22:59 사이 어느 때** 실행돼요. (정각 보장은 유료 플랜)
- 서버 실행 시각은 22시로 고정이에요. 운영자 콘솔의 **실행 시각**을 바꿔도 서버 시간은 안 바뀌어요.
  (콘솔의 **매일 자동 매칭** 체크를 끄면 서버도 매칭을 건너뜁니다)
- 운영자 콘솔이 열려 있을 때도 같은 기준으로 확인하고, 이미 실행된 회차는 다시 돌리지 않아요.

## 7단계. 확인 코드 이메일 발송 (Gmail)

신청을 마치면 `samilhankki@gmail.com`이 신청자에게 "결과 확인 코드" 메일을 보내요. (화면에도 코드는 그대로 보여요)

1. `samilhankki@gmail.com`으로 로그인 → https://myaccount.google.com/security → **2단계 인증** 사용 설정.
2. https://myaccount.google.com/apppasswords → 앱 이름 `samil-hankki` → **만들기** → 16자리 비밀번호 복사.
3. Vercel → samil-hankki → **Settings → Environments → Production** → Environment Variables에 추가:

   | Key | Value |
   |---|---|
   | `GMAIL_USER` | `samilhankki@gmail.com` |
   | `GMAIL_APP_PASSWORD` | 2번의 16자리 |

4. **Deployments → ⋯ → Redeploy**.
5. 확인: 앱에서 내 이메일로 신청 → 메일이 오는지(스팸함 포함) 확인 → 운영자 콘솔에서 테스트 신청 삭제.

### 매칭 메일 (조가 정해지면 자동 발송)
- 먼저 **SQL Editor**에서 `supabase/04_match_mail.sql`을 실행해야 해요. (발송 기록 칸 추가)
- 보내는 때: 매일 22시 자동 매칭 직후, 23시 추가 발송(못 보낸 사람), 운영자 "지금 매칭 실행"·조원 이동 직후
- 같은 사람에게 두 번 보내지 않아요. 샘플·테스트 주소(example.com 등)에는 보내지 않아요.
- 메일 내용: 조 번호·시간·인원·조원 이름(부문은 공개한 사람만)·응답 마감·결과 확인 주소 (확인 코드는 넣지 않음)

### 알아 두기
- Gmail은 하루 약 500통까지 보낼 수 있어요. 300~400명 신청이면 충분해요.
- 이메일 + 코드가 맞을 때만 발송돼요. 아무나 임의 주소로 메일을 보낼 수 없어요.
- 앱 비밀번호가 새면 https://myaccount.google.com/apppasswords 에서 삭제하고 새로 만든 뒤 Vercel 값을 바꾸세요.
- 사내메일(pwc.com)을 허용하려면 `index.html`의 `EMAIL_DOMAINS`와 `api/send-code.js`의 `EMAIL_DOMAINS`를 **둘 다** 바꿔야 해요.

---

## 꼭 지켜 주세요 (보안)

- 앱 코드에 들어 있는 키는 **publishable key**(`sb_publishable_...`)뿐이에요. 원래 공개돼도 되는 키예요.
- **secret key / service_role key**(`sb_secret_...` 또는 긴 `eyJ...`)는 `index.html`, GitHub, 카톡 어디에도 붙여 넣지 마세요.
  자동 매칭용으로 **Vercel 환경변수**에만 넣습니다. (6단계)
- 운영자 비밀번호를 잊으면 **Authentication → Users** 에서 해당 사용자 `...` 메뉴로 재설정할 수 있어요.

## 바뀐 동작 요약

| 항목 | 예전(데모) | 지금 |
|---|---|---|
| 신청 저장 | 각자 브라우저(localStorage) | Supabase 중앙 저장 |
| 다른 사람 신청 보기 | 같은 기기면 가능 | 불가능 (운영자만) |
| 내 결과 / 참석 / 패스 | 브라우저 안에서 비교 | 이메일 + 6자리 코드가 맞을 때만 서버가 처리 |
| 코드 무작위 대입 | 제한 없음 | 10번 틀리면 15분 잠금 |
| 같은 이메일로 재신청 | 누구나 덮어쓰기 가능 | 그 이메일의 코드를 아는 사람만 (이 기기에 코드가 기억돼 있거나 "내 결과 확인하기"를 한 번 거친 경우) |
| 운영자 입장 | 비밀번호 1234 | Supabase 로그인 + 운영자 등록된 계정 |
| 자동 매칭 | 누구든 앱을 열고 있으면 실행 | 서버(Vercel Cron)가 매일 22시대에 실행 |

## 참고

- 무료 플랜은 **7일 동안 아무 접속이 없으면 프로젝트가 일시 정지**돼요. 대시보드에서 **Restore** 를 누르면 다시 켜져요.
  행사 기간 직전에 한 번 들어가 확인하세요.
- 예전 데모에서 각 브라우저에 저장된 데이터는 Supabase로 옮겨지지 않아요. (테스트 데이터였으므로 그대로 둬도 됩니다)
