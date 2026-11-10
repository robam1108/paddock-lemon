-- =============================================================
--  MINI CASINO - 진정함 (수용자 진정 · 관리자 문의)
--
--  실행 순서: 02_schema.sql -> 03_pvp.sql -> 04_trade.sql -> 06_relations.sql ->
--             07_petitions.sql -> 08_admin.sql -> 09_avatar.sql
--
--  "이의를 접수하지 않는다"(rules.ts)는 게임 판정에 대한 공식 문구다.
--  진정함은 그와 별개로 시설이 형식적으로 열어 둔 창구다.
--
--  흐름
--    1) 수감자가 진정을 접수한다               -> open
--    2) 관리자가 답변을 단다                    -> answered
--    3) 본인이 답변 뒤 다시 글을 올리면          -> open (재확인 필요)
--    4) 관리자가 종결한다                       -> closed (답변 없이도 가능)
--
--  접근 통제
--    본인 또는 관리자만 볼 수 있다. 그 외 유저는 존재 자체를 알 수 없어야
--    하므로 "없음"과 "권한 없음"을 같은 예외(NO_PETITION)로 합친다.
--    이 파일도 몇 번을 다시 실행해도 안전하다(create if not exists / or replace).
--
--  관리자 익명화
--    답변자가 관리자면 author_id 를 절대 클라이언트로 내보내지 않는다.
--    대신 작성 시점의 is_admin_reply 스냅샷만 보고 고정 문구 "관리자"로
--    치환해서 돌려준다 — 유저용/관리자용 조회가 petition_thread() 하나를
--    같이 쓰므로 마스킹이 갈라질 일이 없다.
-- =============================================================

create table if not exists public.petitions (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  username         text not null,
  subject          text not null,
  status           text not null default 'open'
                   check (status in ('open', 'answered', 'closed')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now()
);

create index if not exists petitions_user_idx   on public.petitions (user_id, last_message_at desc);
create index if not exists petitions_status_idx on public.petitions (status, last_message_at desc);

create table if not exists public.petition_messages (
  id              bigint generated always as identity primary key,
  petition_id     bigint not null references public.petitions(id) on delete cascade,
  author_id       uuid not null references auth.users(id) on delete cascade,
  -- 작성 시점의 관리자 여부 스냅샷. 이후 권한이 바뀌어도 표시는 그대로다.
  is_admin_reply  boolean not null default false,
  body            text not null,
  -- petitions 버킷 안의 경로. 메시지당 한 장, 없으면 null.
  image_path      text,
  created_at      timestamptz not null default now()
);

alter table public.petition_messages add column if not exists image_path text;

create index if not exists petition_messages_thread_idx
  on public.petition_messages (petition_id, created_at);

-- 클라이언트가 표를 직접 읽고 쓰지 못하게 막는다. 접근은 아래 RPC 로만.
alter table public.petitions         enable row level security;
alter table public.petition_messages enable row level security;
-- 정책 없음: petition_* / panel_petition_* 함수로만 접근한다.

-- -------------------------------------------------------------
-- 첨부 사진 버킷. avatars 와 달리 비공개다 — "본인과 관리자만 볼 수
-- 있다"는 진정함 문구 그대로 첨부에도 적용해야 하므로 서명 URL로만
-- 읽는다. 경로에 uid 폴더를 쓰지 않는다(<uuid>.jpg 뿐) — 관리자 답변
-- 사진 경로에 관리자 uid 가 찍히면 petition_thread() 가 지키는 관리자
-- 익명성이 깨진다. 그래서 "내가 올린 파일인지"는 storage.objects.owner_id
-- 로, "내가 읽어도 되는 파일인지"는 아래 can_read_petition_photo() 로
-- 각각 따로 확인한다.
-- -------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('petitions', 'petitions', false)
on conflict (id) do nothing;

update storage.buckets
   set public = false,
       file_size_limit = 2097152, -- 2MB
       allowed_mime_types = array['image/jpeg', 'image/webp', 'image/png']
 where id = 'petitions';

drop policy if exists "petition photos uploaded by owner" on storage.objects;
create policy "petition photos uploaded by owner"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'petitions');

-- petition_messages 는 RLS 정책이 없어(위 참고) 이 정책 안에서 직접
-- 조회할 수 없다. 그래서 읽기 판정은 security definer 함수로 뺀다.
create or replace function app.can_read_petition_photo(p_name text)
returns boolean
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean;
begin
  if v_uid is null then return false; end if;

  select is_admin into v_admin from public.profiles where id = v_uid;
  if coalesce(v_admin, false) then return true; end if;

  return exists (
    select 1
      from public.petition_messages m
      join public.petitions p on p.id = m.petition_id
     where m.image_path = p_name and p.user_id = v_uid
  );
end;
$$;

revoke all on function app.can_read_petition_photo(text) from public;
grant execute on function app.can_read_petition_photo(text) to authenticated;

drop policy if exists "petition photos read by owner or admin" on storage.objects;
create policy "petition photos read by owner or admin"
  on storage.objects for select to authenticated
  using (bucket_id = 'petitions' and app.can_read_petition_photo(name));

-- 지우기. Supabase 는 storage.objects 를 SQL 로 직접 지우는 것을 막는다
-- (storage.protect_delete) — 파일은 클라이언트가 Storage API 로 지운다.
-- 올린 본인(접수 실패 시 정리)과 관리자(종결 진정 삭제)만 지울 수 있다.
create or replace function app.is_petition_admin()
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

revoke all on function app.is_petition_admin() from public;
grant execute on function app.is_petition_admin() to authenticated;

drop policy if exists "petition photos deleted by owner or admin" on storage.objects;
create policy "petition photos deleted by owner or admin"
  on storage.objects for delete to authenticated
  using (bucket_id = 'petitions'
         and (owner_id = auth.uid()::text or app.is_petition_admin()));

-- -------------------------------------------------------------
-- 내 진정 목록
-- -------------------------------------------------------------
create or replace function public.petition_list()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'subject', subject, 'status', status,
           'created_at', created_at, 'last_message_at', last_message_at
         ) order by last_message_at desc), '[]'::jsonb)
    into v_out
    from public.petitions
   where user_id = v_uid;

  return v_out;
end;
$$;

-- -------------------------------------------------------------
-- 사진 소유권 확인 — 방금 내가 올린 파일이 맞는지만 본다.
-- 경로에 uid 가 없으므로 storage.objects.owner_id 로 대조한다.
-- -------------------------------------------------------------
create or replace function app.own_petition_photo(p_uid uuid, p_path text)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select p_path is null or exists (
    select 1 from storage.objects
     where bucket_id = 'petitions' and name = p_path and owner_id = p_uid::text
  );
$$;

-- -------------------------------------------------------------
-- 진정 접수 — 첫 글을 같이 남긴다.
-- -------------------------------------------------------------
drop function if exists public.petition_create(text, text);

create or replace function public.petition_create(
  p_subject text, p_body text, p_image_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text;
  v_subject text := btrim(coalesce(p_subject, ''));
  v_body    text := btrim(coalesce(p_body, ''));
  v_id      bigint;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if length(v_subject) < 2  then raise exception 'SUBJECT_TOO_SHORT'; end if;
  if length(v_subject) > 60 then raise exception 'SUBJECT_TOO_LONG';  end if;
  if length(v_body) < 2     then raise exception 'TOO_SHORT'; end if;
  if length(v_body) > 500   then raise exception 'BODY_TOO_LONG'; end if;
  if not app.own_petition_photo(v_uid, p_image_path) then
    raise exception 'INVALID_PATH';
  end if;

  select username into v_name from public.profiles where id = v_uid;
  if v_name is null then raise exception 'NO_PROFILE'; end if;

  -- 처리되지 않은 진정이 쌓이지 않도록 1인 3건(open+answered)으로 제한한다.
  if (select count(*) from public.petitions
        where user_id = v_uid and status in ('open', 'answered')) >= 3 then
    raise exception 'TOO_MANY_OPEN';
  end if;

  insert into public.petitions (user_id, username, subject)
  values (v_uid, v_name, v_subject)
  returning id into v_id;

  insert into public.petition_messages (petition_id, author_id, is_admin_reply, body, image_path)
  values (v_id, v_uid, false, v_body, p_image_path);

  return public.petition_list();
end;
$$;

-- -------------------------------------------------------------
-- 진정 상세 + 전체 답변. 본인 또는 관리자만 볼 수 있다.
-- 유저용/관리자용 조회가 이 함수 하나를 같이 쓴다.
-- -------------------------------------------------------------
create or replace function public.petition_thread(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean;
  p       public.petitions;
  v_msgs  jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select is_admin into v_admin from public.profiles where id = v_uid;

  select * into p from public.petitions where id = p_id;
  -- 존재하지 않을 때와 권한 없을 때를 같은 예외로 합친다 — 존재 자체를 숨긴다.
  if not found or (p.user_id <> v_uid and not coalesce(v_admin, false)) then
    raise exception 'NO_PETITION';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'created_at', m.created_at,
           'author', case when m.is_admin_reply then '관리자' else p.username end,
           'is_admin_reply', m.is_admin_reply,
           'body', m.body,
           'image_path', m.image_path
         ) order by m.created_at), '[]'::jsonb)
    into v_msgs
    from public.petition_messages m
   where m.petition_id = p.id;

  return jsonb_build_object(
    'id', p.id, 'subject', p.subject, 'status', p.status,
    'created_at', p.created_at, 'username', p.username,
    'messages', v_msgs
  );
end;
$$;

-- -------------------------------------------------------------
-- 답변 등록. 본인 또는 관리자만 쓸 수 있다.
-- -------------------------------------------------------------
drop function if exists public.petition_reply(bigint, text);

create or replace function public.petition_reply(
  p_id bigint, p_body text, p_image_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean;
  v_body  text := btrim(coalesce(p_body, ''));
  p       public.petitions;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if length(v_body) < 2   then raise exception 'TOO_SHORT'; end if;
  if length(v_body) > 500 then raise exception 'BODY_TOO_LONG'; end if;
  if not app.own_petition_photo(v_uid, p_image_path) then
    raise exception 'INVALID_PATH';
  end if;

  select is_admin into v_admin from public.profiles where id = v_uid;
  v_admin := coalesce(v_admin, false);

  select * into p from public.petitions where id = p_id for update;
  if not found or (p.user_id <> v_uid and not v_admin) then
    raise exception 'NO_PETITION';
  end if;
  if p.status = 'closed' then raise exception 'PETITION_CLOSED'; end if;

  insert into public.petition_messages (petition_id, author_id, is_admin_reply, body, image_path)
  values (p.id, v_uid, v_admin, v_body, p_image_path);

  update public.petitions
     set status = case
                     when v_admin then 'answered'
                     when status = 'answered' then 'open'
                     else status
                   end,
         updated_at = now(),
         last_message_at = now()
   where id = p.id;

  return public.petition_thread(p.id);
end;
$$;

-- -------------------------------------------------------------
-- 관리자: 전체 진정 목록 (미답변을 위로)
-- -------------------------------------------------------------
create or replace function public.panel_petitions()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_out jsonb;
begin
  perform app.require_admin();

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'username', username, 'subject', subject,
           'status', status, 'created_at', created_at,
           'last_message_at', last_message_at
         ) order by case when status = 'open' then 0
                          when status = 'answered' then 1
                          else 2 end, last_message_at desc), '[]'::jsonb)
    into v_out
    from public.petitions;

  return v_out;
end;
$$;

-- 관리자: 종결 처리 (답변 없이도 닫을 수 있다)
create or replace function public.panel_petition_close(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
begin
  perform app.require_admin();

  update public.petitions
     set status = 'closed', updated_at = now()
   where id = p_id;
  if not found then raise exception 'NO_PETITION'; end if;

  return public.panel_petitions();
end;
$$;

-- 관리자: 종결된 진정 삭제 — petition_messages 는 petitions 의 FK
-- on delete cascade 로 같이 사라진다. 첨부 사진은 SQL 로 지울 수 없어
-- (storage.protect_delete) 경로만 image_paths 로 돌려주고, 클라이언트가
-- Storage API 로 지운다. 반환: {petitions: panel_petitions(), image_paths: [...]}
create or replace function public.panel_petition_delete(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_status text;
  v_paths  jsonb;
begin
  perform app.require_admin();

  select status into v_status from public.petitions where id = p_id;
  if v_status is null then raise exception 'NO_PETITION'; end if;
  if v_status <> 'closed' then raise exception 'PETITION_NOT_CLOSED'; end if;

  select coalesce(jsonb_agg(image_path), '[]'::jsonb) into v_paths
    from public.petition_messages
   where petition_id = p_id and image_path is not null;

  delete from public.petitions where id = p_id;

  return jsonb_build_object('petitions', public.panel_petitions(),
                            'image_paths', v_paths);
end;
$$;

-- -------------------------------------------------------------
-- 권한
-- -------------------------------------------------------------
revoke all on function public.petition_list()                          from public;
revoke all on function public.petition_create(text, text, text)        from public;
revoke all on function public.petition_thread(bigint)                   from public;
revoke all on function public.petition_reply(bigint, text, text)       from public;
revoke all on function public.panel_petitions()                        from public;
revoke all on function public.panel_petition_close(bigint)             from public;
revoke all on function public.panel_petition_delete(bigint)            from public;

grant execute on function public.petition_list()                          to authenticated;
grant execute on function public.petition_create(text, text, text)        to authenticated;
grant execute on function public.petition_thread(bigint)                   to authenticated;
grant execute on function public.petition_reply(bigint, text, text)       to authenticated;
grant execute on function public.panel_petitions()                        to authenticated;
grant execute on function public.panel_petition_close(bigint)             to authenticated;
grant execute on function public.panel_petition_delete(bigint)            to authenticated;
