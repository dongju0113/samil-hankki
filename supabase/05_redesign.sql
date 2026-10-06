-- =====================================================================
-- 삼일한끼 Supabase 설정 (5) — 2026-10-06 개편
--  · 신청 항목: MBTI, 원하는 조원 성별·부문 추가 / 출생연도·성별 필수 / 관심사·음식 등 삭제
--  · 매칭 결과: 조원 이름 가리기(최*주), 조원 정보(출생연도·성별·부문·MBTI·이메일) 표시
--  · 실시간 매칭 대기 인원 함수
-- 01~04를 이미 실행한 프로젝트에서 실행하세요. (01을 처음 실행하는 새 프로젝트라면 필요 없어요)
-- SQL Editor > New query 에 전체를 붙여 넣고 [Run]. 여러 번 실행해도 안전합니다.
-- =====================================================================

-- 2026-10-06 개편: MBTI·원하는 조원 성별/부문 (관심사·음식 등 예전 칸은 남겨 두되 쓰지 않음)
alter table public.applications add column if not exists mbti text not null default '';
alter table public.applications add column if not exists want_genders text[] not null default '{}';
alter table public.applications add column if not exists want_depts text[] not null default '{}';

-- 이름 가리기: 최동주 → 최*주, 김철 → 김*, 남궁민수 → 남**수 (matching.js의 maskName과 같은 규칙)
create or replace function public._mask_name(p text)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when char_length(coalesce(p, '')) <= 1 then coalesce(p, '')
    when char_length(p) = 2 then left(p, 1) || '*'
    else left(p, 1) || repeat('*', char_length(p) - 2) || right(p, 1)
  end;
$$;

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
  -- 기본 검증 (화면 검증과 같은 기준 + 비정상 요청 차단)
  if length(p_form::text) > 6000
     or v_email !~ '^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]+$'
     or length(v_name) not between 1 and 30
     or v_birth !~ '^(19|20)\d{2}$'
     or v_gender not in ('남성', '여성')
     or v_dept not in ('Audit', 'Tax', 'Deal', 'AX')
     or v_mbti !~ '^[EI][SN][TF][JP]$'
     or coalesce(array_length(v_slots, 1), 0) = 0
     or exists (select 1 from unnest(v_slots) s where s !~ '^\d+/\d+\(.\) \d{2}:\d{2}$')
     or coalesce(array_length(v_sizes, 1), 0) = 0 or not (v_sizes <@ array['2명', '3~4명', '5명~'])
     or coalesce(array_length(v_want_g, 1), 0) = 0 or not (v_want_g <@ array['남성', '여성', '상관없음'])
     or coalesce(array_length(v_want_d, 1), 0) = 0 or not (v_want_d <@ array['Audit', 'Tax', 'Deal', 'AX', '상관없음'])
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

-- 내 결과: 이메일 + 코드가 맞을 때만 "내 정보 + 내 조"만 돌려줌 (전체 목록은 절대 안 내려감)
-- 조원 이름은 가려서(최*주) 보냄. 내 이름만 그대로
create or replace function public.get_my_result(p_email text, p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v          jsonb;
  a          public.applications;
  g          public.groups;
  v_members  jsonb;
begin
  v := public._verify_applicant(p_email, p_code);
  if v->>'status' <> 'ok' then
    return jsonb_build_object('ok', false, 'locked', v->>'status' = 'locked');
  end if;

  select * into a from public.applications where id = (v->>'id')::uuid;
  select gr.* into g from public.groups gr
    join public.group_members gm on gm.group_id = gr.id
   where gm.application_id = a.id;

  if g.id is not null then
    select jsonb_agg(jsonb_build_object(
             'id', m.id,
             'name', case when m.id = a.id then m.name else public._mask_name(m.name) end,
             'email', m.email,
             'dept', m.dept,
             'gender', m.gender,
             'birthYear', m.birth_year,
             'mbti', m.mbti,
             'response', gm.response
           ) order by gm.seq)
      into v_members
      from public.group_members gm
      join public.applications m on m.id = gm.application_id
     where gm.group_id = g.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'me', jsonb_build_object('id', a.id, 'name', a.name, 'email', a.email,
                             'slots', to_jsonb(a.slots), 'createdAt', a.created_at),
    'group', case when g.id is null then null else jsonb_build_object(
               'id', g.id, 'no', g.no, 'slot', g.slot, 'locked', g.locked, 'members', v_members) end
  );
end;
$$;

-- 실시간 매칭 대기 인원: 아직 조가 없고, 마감 전인 시간을 하나 이상 고른 신청자 수 (숫자만 공개)
create or replace function public.get_waiting_count()
returns int
language sql stable security definer set search_path = ''
as $$
  select count(*)::int
    from public.applications a
   where not exists (select 1 from public.group_members gm where gm.application_id = a.id)
     and exists (
       select 1 from unnest(a.slots) as s(slot), public.settings st
        where st.id = 1
          and (st.include_past or public._slot_ts(s.slot) - make_interval(mins => st.cutoff_min) > now()));
$$;

revoke execute on function public._mask_name(text), public.get_waiting_count() from public, anon, authenticated;
grant execute on function public.get_waiting_count() to anon, authenticated;

-- 결과 확인: 지금 매칭 대기 인원 (숫자가 나오면 성공)
select public.get_waiting_count() as 매칭_대기_인원;
