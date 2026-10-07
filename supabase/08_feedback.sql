-- =====================================================================
-- 삼일한끼 Supabase 설정 (8) — 2026-10-07 피드백 반영
--  · 희망 인원: 2명 / 3~4명 / 5~6명 (예전 '5명~' → '5~6명')
--  · 응답 마감까지 [참석]을 누른 조원끼리만 만남. 안 누른 사람·취소된 조의 조원은 다음 매칭 대상
--  · 내 결과에 내가 입력한 정보 전체 (정보 수정, 확인 메일용)
-- 01~07을 이미 실행한 프로젝트에서 실행하세요. SQL Editor > New query 에 전체를 붙여 넣고 [Run]. 여러 번 실행해도 안전합니다.
-- =====================================================================

update public.applications set group_sizes = array_replace(group_sizes, '5명~', '5~6명') where '5명~' = any(group_sizes);

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
  -- 희망 인원 '5명~'(예전 값) → '5~6명'
  v_sizes := array_replace(v_sizes, '5명~', '5~6명');

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
     or coalesce(array_length(v_sizes, 1), 0) = 0 or not (v_sizes <@ array['2명', '3~4명', '5~6명'])
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
                             'birthYear', a.birth_year, 'gender', a.gender, 'dept', a.dept, 'mbti', a.mbti,
                             'wantGenders', to_jsonb(a.want_genders), 'wantDepts', to_jsonb(a.want_depts),
                             'groupSizes', to_jsonb(a.group_sizes),
                             'slots', to_jsonb(a.slots), 'createdAt', a.created_at),
    'group', case when g.id is null then null else jsonb_build_object(
               'id', g.id, 'no', g.no, 'slot', g.slot, 'locked', g.locked, 'contactId', g.contact_id, 'members', v_members) end
  );
end;
$$;

-- 응답 마감이 지난 조에서 풀려난 조원인지: 참석을 안 눌렀거나, 참석이 2명 미만이라 조가 취소됨 (운영자 강제 확정 조는 제외)
create or replace function public._is_released(p_app uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members gm join public.groups g on g.id = gm.group_id
     where gm.application_id = p_app and not g.locked and public._deadline_passed(g.slot)
       and (gm.response <> 'yes'
            or (select count(*) from public.group_members x where x.group_id = g.id and x.response = 'yes') < 2));
$$;

-- 실시간 매칭 대기 인원: 아직 조가 없고(또는 마감 후 풀려났고), 마감 전인 시간을 하나 이상 고른 신청자 수 (숫자만 공개)
create or replace function public.get_waiting_count()
returns int
language sql stable security definer set search_path = ''
as $$
  select count(*)::int
    from public.applications a
   where (not exists (select 1 from public.group_members gm where gm.application_id = a.id) or public._is_released(a.id))
     and exists (
       select 1 from unnest(a.slots) as s(slot), public.settings st
        where st.id = 1
          and (st.include_past or public._slot_ts(s.slot) - make_interval(mins => st.cutoff_min) > now()));
$$;

-- 매칭 결과 저장: 새 조(조 번호는 여기서 이어서 발급) + 기존 조 합류 + 실행 기록
-- 운영자 콘솔(로그인한 운영자) 또는 서버 자동 매칭(Vercel Cron, secret key = service_role)만 실행 가능
create or replace function public.admin_save_matching(
  p_groups jsonb, p_joins jsonb, p_summary text, p_auto boolean default false)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_no   int;
  v_new  int := 0;
  g      jsonb;
  j      jsonb;
  v_gid  uuid;
begin
  if not (public.is_admin()
          or coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'role' = 'service_role') then
    raise exception '운영자만 실행할 수 있어요.';
  end if;
  select next_no into v_no from public.settings where id = 1 for update;

  for g in select * from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) loop
    insert into public.groups (no, slot) values (v_no, g->>'slot') returning id into v_gid;
    v_no := v_no + 1;
    v_new := v_new + 1;
    -- 응답 마감이 지나 풀려난 사람은 예전 조에서 빼고 새 조에 넣음
    delete from public.group_members gm
     where gm.application_id in (select x::uuid from jsonb_array_elements_text(g->'memberIds') as x)
       and public._is_released(gm.application_id);
    insert into public.group_members (group_id, application_id)
      select v_gid, t.x::uuid
        from jsonb_array_elements_text(g->'memberIds') with ordinality as t(x, i)
       order by t.i;
  end loop;

  for j in select * from jsonb_array_elements(coalesce(p_joins, '[]'::jsonb)) loop
    delete from public.group_members gm
     where gm.application_id = (j->>'memberId')::uuid and public._is_released(gm.application_id);
    insert into public.group_members (group_id, application_id)
      values ((j->>'groupId')::uuid, (j->>'memberId')::uuid);
  end loop;

  update public.settings set
    next_no = v_no,
    last_run_at = now(),
    last_auto_run_at = case when p_auto then now() else last_auto_run_at end,
    last_run_summary = coalesce(p_summary, '')
  where id = 1;
  return v_new;
end;
$$;

revoke execute on function public._is_released(uuid) from public, anon, authenticated;
grant execute on function public.get_waiting_count() to anon, authenticated;

-- 결과 확인: 예전 '5명~'으로 남은 신청 수 (0이면 성공)
select count(*) as 예전_인원값_남음 from public.applications where '5명~' = any(group_sizes);
