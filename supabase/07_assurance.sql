-- =====================================================================
-- 삼일한끼 Supabase 설정 (7) — 소속 부문 이름 변경: Audit → Assurance
-- 01~06을 이미 실행한 프로젝트에서 실행하세요. (01을 처음 실행하는 새 프로젝트라면 필요 없어요)
-- SQL Editor > New query 에 전체를 붙여 넣고 [Run]. 여러 번 실행해도 안전합니다.
-- =====================================================================

-- 이미 저장된 신청: 소속 부문과 원하는 조원 부문을 새 이름으로
update public.applications set dept = 'Assurance' where dept = 'Audit';
update public.applications set want_depts = array_replace(want_depts, 'Audit', 'Assurance') where 'Audit' = any(want_depts);

-- 신청 저장 함수: Assurance만 받고, 예전 화면이 보낸 Audit은 Assurance로 바꿔 저장
-- 신청 저장. 새 이메일이면 6자리 코드를 발급하고,
-- 이미 신청한 이메일이면 기존 코드가 맞을 때만 내용을 바꾸고 기존 조에서 빠짐(다시 매칭 대기)
create or replace function public.submit_application(p_form jsonb, p_code text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_email     text := lower(trim(coalesce(p_form->>'email', '')));
  v_name      text := trim(coalesce(p_form->>'name', ''));
  v_birth     text := trim(coalesce(p_form->>'birth_year', ''));
  v_gender    text := coalesce(p_form->>'gender', '');
  v_dept      text := coalesce(p_form->>'dept', '');
  v_mbti      text := upper(trim(coalesce(p_form->>'mbti', '')));
  v_slots     text[] := public._txt_arr(p_form->'slots');
  v_sizes     text[] := public._txt_arr(p_form->'group_sizes');
  v_want_g    text[] := public._txt_arr(p_form->'want_genders');
  v_want_d    text[] := public._txt_arr(p_form->'want_depts');
  a           public.applications;
  v           jsonb;
  v_code      text;
  v_bytes     bytea;
  v_old_group uuid;
begin
  -- 부문 이름 변경(Audit → Assurance): 예전 화면에서 보낸 값도 새 이름으로 저장
  v_dept := case when v_dept = 'Audit' then 'Assurance' else v_dept end;
  v_want_d := array_replace(v_want_d, 'Audit', 'Assurance');

  -- 기본 검증 (화면 검증과 같은 기준 + 비정상 요청 차단)
  if length(p_form::text) > 6000
     or v_email !~ '^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]+$'
     or length(v_name) not between 1 and 30
     or v_birth !~ '^(19|20)\d{2}$'
     or v_gender not in ('남성', '여성')
     or v_dept not in ('Assurance', 'Tax', 'Deal', 'AX')
     or v_mbti !~ '^[EI][SN][TF][JP]$'
     or coalesce(array_length(v_slots, 1), 0) = 0
     or exists (select 1 from unnest(v_slots) s where s !~ '^\d+/\d+\(.\) \d{2}:\d{2}$')
     or coalesce(array_length(v_sizes, 1), 0) = 0 or not (v_sizes <@ array['2명', '3~4명', '5명~'])
     or coalesce(array_length(v_want_g, 1), 0) = 0 or not (v_want_g <@ array['남성', '여성', '상관없음'])
     or coalesce(array_length(v_want_d, 1), 0) = 0 or not (v_want_d <@ array['Assurance', 'Tax', 'Deal', 'AX', '상관없음'])
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into a from public.applications where email = v_email;

  if found then
    if coalesce(trim(p_code), '') = '' then
      return jsonb_build_object('ok', false, 'reason', 'exists');
    end if;
    v := public._verify_applicant(v_email, p_code);
    if v->>'status' <> 'ok' then
      return jsonb_build_object('ok', false, 'reason', case when v->>'status' = 'locked' then 'locked' else 'exists' end);
    end if;

    update public.applications set
      name = v_name, birth_year = v_birth, gender = v_gender, dept = v_dept, dept_open = true,
      mbti = v_mbti, want_genders = v_want_g, want_depts = v_want_d,
      group_sizes = v_sizes, slots = v_slots, created_at = now()
    where id = a.id;

    -- 새 조건으로 다시 매칭되도록 기존 조에서 빠짐 (빈 조는 삭제)
    delete from public.group_members where application_id = a.id returning group_id into v_old_group;
    if v_old_group is not null
       and not exists (select 1 from public.group_members where group_id = v_old_group) then
      delete from public.groups where id = v_old_group;
    end if;

    return jsonb_build_object('ok', true, 'code', a.code);
  end if;

  -- 새 신청: 6자리 확인 코드 발급
  v_bytes := extensions.gen_random_bytes(3);
  v_code := ((get_byte(v_bytes, 0) * 65536 + get_byte(v_bytes, 1) * 256 + get_byte(v_bytes, 2)) % 900000 + 100000)::text;

  begin
    insert into public.applications (
      email, code, name, birth_year, gender, dept, dept_open, mbti, want_genders, want_depts, group_sizes, slots
    ) values (
      v_email, v_code, v_name, v_birth, v_gender, v_dept, true, v_mbti, v_want_g, v_want_d, v_sizes, v_slots
    );
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'exists');
  end;

  return jsonb_build_object('ok', true, 'code', v_code);
end;
$$;

-- 결과 확인: Audit으로 남은 신청 수 (0이면 성공)
select count(*) as audit_남은_신청 from public.applications where dept = 'Audit' or 'Audit' = any(want_depts);
