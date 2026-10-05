-- =====================================================================
-- 삼일한끼 Supabase 설정 (4) — 매칭 메일 발송 기록
-- 01~03을 이미 실행한 프로젝트에서 실행하세요. (01을 처음 실행하는 새 프로젝트라면 필요 없어요)
-- SQL Editor > New query 에 전체를 붙여 넣고 [Run]. 여러 번 실행해도 안전합니다.
-- =====================================================================

-- 매칭 메일 발송 시각 (비어 있으면 아직 안 보냄)
alter table public.group_members add column if not exists notified_at timestamptz;

-- 이 기능 전에 이미 짜인 조원에게는 갑자기 메일이 가지 않도록 "보낸 것"으로 처리
update public.group_members set notified_at = now() where notified_at is null;

-- 결과 확인: 아직 메일을 안 받은 조원 수 (0이면 정상)
select count(*) as 메일_대기_조원 from public.group_members where notified_at is null;
