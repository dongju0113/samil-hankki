-- =====================================================================
-- 삼일한끼 Supabase 설정 (6) — 조마다 연락 담당 1명 (무작위)
-- 01~05를 이미 실행한 프로젝트에서 실행하세요. (01을 처음 실행하는 새 프로젝트라면 필요 없어요)
-- SQL Editor > New query 에 전체를 붙여 넣고 [Run]. 여러 번 실행해도 안전합니다.
-- =====================================================================

-- 조마다 연락 담당 1명 (무작위). 조원이 바뀔 때마다 자동으로 확인:
--  - 담당이 없거나, 담당이 조에서 빠졌으면(패스·이동·재신청) 남은 조원 중 무작위로 다시 지목
--  - 새 조는 조원을 한 번에 넣은 뒤 지목하므로 조원 전체 중 무작위
alter table public.groups add column if not exists contact_id uuid;

create or replace function public._ensure_contact(p_group uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.groups g
     set contact_id = (select m.application_id from public.group_members m
                        where m.group_id = p_group order by random() limit 1)
   where g.id = p_group
     and (g.contact_id is null
          or not exists (select 1 from public.group_members m
                          where m.group_id = p_group and m.application_id = g.contact_id));
$$;

create or replace function public._group_contact_stmt()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_gid uuid;
begin
  for v_gid in select distinct group_id from changed loop
    perform public._ensure_contact(v_gid);
  end loop;
  return null;
end;
$$;

drop trigger if exists group_members_contact_ins on public.group_members;
create trigger group_members_contact_ins
  after insert on public.group_members
  referencing new table as changed
  for each statement execute function public._group_contact_stmt();

drop trigger if exists group_members_contact_del on public.group_members;
create trigger group_members_contact_del
  after delete on public.group_members
  referencing old table as changed
  for each statement execute function public._group_contact_stmt();

revoke execute on function public._ensure_contact(uuid), public._group_contact_stmt() from public, anon, authenticated;

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
               'id', g.id, 'no', g.no, 'slot', g.slot, 'locked', g.locked, 'contactId', g.contact_id, 'members', v_members) end
  );
end;
$$;

-- 이미 있는 조에도 연락 담당 지목
select public._ensure_contact(id) from public.groups;

-- 결과 확인: 연락 담당이 없는 조 수 (0이면 성공)
select count(*) as 연락담당_없는_조 from public.groups where contact_id is null;
