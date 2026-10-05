-- =====================================================================
-- 삼일한끼 Supabase 설정 (2/2) — 운영자 등록
-- 먼저 Authentication > Users 에서 운영자 계정을 만든 뒤,
-- 아래 이메일을 그 계정 이메일로 바꿔서 SQL Editor에서 [Run]
-- 운영자를 더 추가하려면 이메일만 바꿔서 다시 실행하면 됩니다.
-- =====================================================================

insert into public.admins (user_id)
select id from auth.users where email = lower('samilhankki@gmail.com')
on conflict (user_id) do nothing;

-- 결과 확인: 등록된 운영자 목록이 보이면 성공
select u.email, a.created_at
  from public.admins a join auth.users u on u.id = a.user_id;
