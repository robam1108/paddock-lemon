-- ============================================================
-- 소식(관계) + 수감자 목록
--   · 관계는 유저가 신청하고, 관리자가 수락해야 '등재된 관계'에 뜬다.
--   · 등재된 관계와 수감자 목록은 로그인한 모든 유저에게 보인다.
--   · 상대(partner)는 body 문자열에 섞어 쓰지 않고 별도 컬럼으로 둔다 —
--     목록에서 "신청자 ↔ 상대"를 바로 보여줘야 하고, 수정 신청 때 상대를
--     고정해야 해서다.
-- 이 파일은 몇 번을 다시 실행해도 안전하다(create if not exists / or replace).
-- ============================================================

create table if not exists public.relations (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  username    text not null,
  body        text not null,
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

alter table public.relations add column if not exists partner text;
alter table public.relations add column if not exists reject_reason text;

-- 가축 지목권·호칭권(05_smuggle.sql) 전용 줄. 'user' 는 지금까지의 심사제 관계다.
-- 'livestock'/'title' 은 심사 없이 바로 approved 로 들어가고, expires_at 이
-- 지나면 app.relation_sweep() 이 실제로 지운다(마킹만 하는 04_trade.sql 의 만료와 다르다).
alter table public.relations add column if not exists kind text not null default 'user';
alter table public.relations drop constraint if exists relations_kind_check;
alter table public.relations add constraint relations_kind_check
  check (kind in ('user', 'livestock', 'title'));
alter table public.relations add column if not exists expires_at timestamptz;

create index if not exists relations_livestock_idx
  on public.relations (partner) where kind = 'livestock';
create index if not exists relations_title_idx
  on public.relations (partner) where kind = 'title';

-- 예전 신청은 상대가 body 앞부분에 "상대 · 설명" 형태로 섞여 있었다.
-- 한 번만 갈라서 partner 로 옮기고, body 는 설명만 남긴다.
update public.relations
   set partner = btrim(split_part(body, '·', 1)),
       body    = btrim(substring(body from position('·' in body) + 1))
 where partner is null
   and body like '%·%';

update public.relations set partner = '' where partner is null;

alter table public.relations alter column partner set default '';
alter table public.relations alter column partner set not null;

-- 클라이언트가 표를 직접 읽고 쓰지 못하게 막는다. 접근은 아래 RPC 로만.
alter table public.relations enable row level security;

-- 가축 지목권이 등재해 두는 기간. 이게 지나면 app.relation_sweep() 이 지운다.
create or replace function app.livestock_days() returns integer
  language sql immutable as $$ select 3 $$;

-- 가축 사슬(주인 → 가축 → 가축 …)에 이어질 수 있는 최대 인원(주인 포함).
-- 3 이면 "주인 → 가축 → 가축" 까지만 된다. public.livestock_use 가 검사한다.
create or replace function app.livestock_chain_max() returns integer
  language sql immutable as $$ select 3 $$;

-- 호칭권이 등재해 두는 기간(가축 지목권과 별개, 시간 단위). 이게 지나면
-- app.relation_sweep() 이 지운다.
create or replace function app.title_hours() returns integer
  language sql immutable as $$ select 24 $$;

-- 기간이 끝난 가축·호칭 관계를 실제로 지운다. cron 이 없는 저장소라, 관계를
-- 읽을 때마다(relations_feed) 불러서 지연 청소한다.
create or replace function app.relation_sweep() returns void
language sql
security definer
set search_path = public
as $$
  delete from public.relations
   where kind in ('livestock', 'title') and expires_at <= now();
$$;

-- -------------------------------------------------------------
-- 한글 조사 도우미. 사용자가 적은 이름·호칭에 맞춰 문장을 짓는다
-- (예: "형준은" vs "수아는", "형님으로" vs "오빠로").
-- -------------------------------------------------------------

-- 마지막 글자의 종성 인덱스(0~27). 한글 음절이 아니면 -1(받침 없음으로 취급).
create or replace function app.ko_jong(p_word text) returns integer
language sql immutable as $$
  select case
    when coalesce(p_word, '') = '' then -1
    when ascii(right(p_word, 1)) between 44032 and 55203
      then (ascii(right(p_word, 1)) - 44032) % 28
    else -1
  end;
$$;

-- 은/는
create or replace function app.ko_eun(p_word text) returns text
language sql immutable as $$
  select case when app.ko_jong(p_word) > 0 then '은' else '는' end;
$$;

-- 을/를
create or replace function app.ko_eul(p_word text) returns text
language sql immutable as $$
  select case when app.ko_jong(p_word) > 0 then '을' else '를' end;
$$;

-- 으로/로 (ㄹ 받침(종성 인덱스 8)은 받침이 있어도 '로'를 쓴다)
create or replace function app.ko_ro(p_word text) returns text
language sql immutable as $$
  select case when app.ko_jong(p_word) > 0 and app.ko_jong(p_word) <> 8
              then '으로' else '로' end;
$$;

-- -------------------------------------------------------------
-- 등재된 소식. 승인된 것은 모두가 보고, 본인은 자기 신청의 상태까지 본다.
-- 가축·호칭 관계(kind in ('livestock','title'))는 항상 맨 위에, 남은 기간과 함께 뜬다.
-- -------------------------------------------------------------
create or replace function public.relations_feed()
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

  perform app.relation_sweep();

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'username', username, 'partner', partner, 'body', body,
           'status', status, 'created_at', created_at,
           'reject_reason', reject_reason,
           'mine', (user_id = v_uid),
           'kind', kind,
           'expires_in', case when expires_at is null then null
                         else greatest(0, extract(epoch from (expires_at - now()))::int)
                         end
         ) order by case when kind = 'user' then 1 else 0 end, created_at desc), '[]'::jsonb)
    into v_out
    from public.relations
   where (status = 'approved' or user_id = v_uid)
     and (expires_at is null or expires_at > now())
     and not exists (
       select 1 from public.profiles h
        where h.hidden and h.username in (public.relations.username, public.relations.partner)
     );

  return v_out;
end;
$$;

-- -------------------------------------------------------------
-- 소식 등록 신청. 관리자 승인 전까지 pending.
-- 같은 폼으로 "수정 신청"도 받는다 — 그때는 클라이언트가 partner 를
-- 이미 등재된 상대로 고정해서 보낸다. 서버는 매번 상대 존재 여부만 다시 본다.
-- -------------------------------------------------------------
drop function if exists public.relation_submit(text);

create or replace function public.relation_submit(p_partner text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text;
  v_partner text := btrim(coalesce(p_partner, ''));
  v_body    text := btrim(coalesce(p_body, ''));
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();
  if v_partner = ''      then raise exception 'NO_PARTNER'; end if;
  if length(v_body) < 2   then raise exception 'TOO_SHORT'; end if;

  select username into v_name from public.profiles where id = v_uid;
  if v_name is null then raise exception 'NO_PROFILE'; end if;
  if v_partner = v_name then raise exception 'CANNOT_RELATE_SELF'; end if;
  if not exists (select 1 from public.profiles where username = v_partner and not hidden) then
    raise exception 'NO_SUCH_PLAYER';
  end if;

  -- 대기 중인 신청이 쌓이지 않도록 1인 3건으로 제한한다.
  if (select count(*) from public.relations
        where user_id = v_uid and status = 'pending') >= 3 then
    raise exception 'TOO_MANY_PENDING';
  end if;

  -- 같은 두 사람 사이엔 심사 중인 신청이 하나만 있을 수 있다.
  -- 누가 신청자였는지는 따지지 않는다. 등재 건이 있으면 수정 신청으로 받는다 —
  -- 수락되면 panel_relation_decide 가 옛 등재를 지운다. 반려된 건은 막지 않는다.
  if exists (
    select 1 from public.relations
     where kind = 'user' and status = 'pending'
       and ((username = v_name and partner = v_partner)
         or (username = v_partner and partner = v_name))
  ) then
    raise exception 'RELATION_EXISTS';
  end if;

  insert into public.relations (user_id, username, partner, body)
  values (v_uid, v_name, v_partner, v_body);

  return public.relations_feed();
end;
$$;

-- -------------------------------------------------------------
-- 신청 삭제. 신청자 본인, 등재된 관계의 상대, 관리자 중 하나면 지울 수 있다.
-- 상대는 등재(approved) 상태에서만 지울 수 있다 — 대기·반려 건은
-- relations_feed 에서 신청자 본인에게만 보이므로 애초에 상대가 알 길이 없다.
-- -------------------------------------------------------------
create or replace function public.relation_delete(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text;
  v_admin boolean;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select username, is_admin into v_name, v_admin
    from public.profiles where id = v_uid;

  -- 가축·호칭 관계는 기간이 끝나야(app.relation_sweep) 사라진다 — 관리자만 직접 지울 수 있다.
  if not coalesce(v_admin, false) then
    if exists (select 1 from public.relations where id = p_id and kind = 'livestock') then
      raise exception 'CANNOT_DELETE_LIVESTOCK';
    end if;
    if exists (select 1 from public.relations where id = p_id and kind = 'title') then
      raise exception 'CANNOT_DELETE_TITLE';
    end if;
  end if;

  delete from public.relations
   where id = p_id
     and (
       user_id = v_uid
       or (status = 'approved' and partner = v_name)
       or coalesce(v_admin, false)
     );
  if not found then raise exception 'NO_RELATION'; end if;

  return public.relations_feed();
end;
$$;

-- -------------------------------------------------------------
-- 수감자 목록 — 존재하는 모든 유저의 이름과 현재 상태 + 관계 탭 상세 보기에
-- 필요한 신상 항목까지 한 번에 준다(왕복을 늘리지 않는다).
--   수용번호는 이름에서 되짚어 만드므로(identity.ts) 여기서는 이름만 준다.
-- -------------------------------------------------------------
create or replace function public.inmate_roster()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_out jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  -- 'flex' 는 문장 배열만 담는다 — 만료 시각·품목 코드는 절대 내보내지 않는다
  -- (그건 본인 화면에서 state_json 의 'flex' 로만 나간다). 중독 낙인은 만료가
  -- 없는 별도 줄로 맨 앞에 오고, 병동에서도 가려지지 않는다. 나머지 과시
  -- 상태는 병동에 있는 동안 통째로 숨긴다.
  select coalesce(jsonb_agg(jsonb_build_object(
           'username',    p.username,
           'avatar_path', p.avatar_path,
           'hp',          p.hp,
           'hp_max',      app.hp_max(),
           'in_ward',     (p.ward_until is not null),
           'cell_id',     p.cell_id,
           'cell',        (select app.cell_label(c.block, c.room)
                              from public.cells c where c.id = p.cell_id),
           'crime',       p.crime,
           'age',         p.age,
           'height_cm',   p.height_cm,
           'weight_kg',   p.weight_kg,
           'bio',         p.bio,
           'livestock_consent', p.livestock_consent,
           'flex',
             -- 중독·금단 문장은 app.addict_lines(02_schema.sql) 하나가 정한다.
             app.addict_lines(p)
             ||
             (case when p.ward_until is not null then '[]'::jsonb else coalesce((
                 select jsonb_agg(
                          -- {giver} 자리는 선물받아 장착했으면 준 사람, 아니면 본인 이름.
                          app.flex_render(
                            case when f.together then coalesce(d.flex_text_with, d.flex_text)
                                 when f.stolen then coalesce(d.flex_text_stolen, d.flex_text)
                                 when f.gifted then d.flex_text_gift
                                 else d.flex_text end,
                            case when f.gifted and not f.stolen and not f.together
                                 then (select g.username from public.profiles g where g.id = f.gift_from)
                                 else p.username end)
                          order by f.started_at)
                   from public.player_flex f
                   join public.item_defs d on d.code = f.item_code
                   -- 겹쳐 장착한 것은 그 수만큼 같은 줄을 낸다.
                   cross join generate_series(1, f.stack)
                  where f.user_id = p.id), '[]'::jsonb) end)
         ) order by p.username), '[]'::jsonb)
    into v_out
    from public.profiles p
   where not p.hidden;

  return v_out;
end;
$$;

-- -------------------------------------------------------------
-- 가축 지목권 사용. 소지품 탭 팝업에서 대상 한 명을 골라 호출한다.
--   · 대상은 신상에서 가축권에 동의(livestock_consent = true)한 사람만.
--   · 이미 누군가의 가축인 사람은(가축인 동안) 다시 지목될 수 없다.
--   · 나를 가축으로 둔 주인은 지목할 수 없다(되갚기 방지).
--   · 가축도 남을 가축으로 둘 수 있고 가축을 여럿 둘 수도 있지만, 한 줄로
--     이어지는 사슬은 app.livestock_chain_max() 명(주인 포함)을 넘을 수 없다.
--     (내 위 주인 단계 + 나 + 대상 + 대상 아래 가장 깊은 가축 단계)로 센다.
-- 심사 없이 바로 approved 로 등재되고, 3일 뒤 app.relation_sweep() 이 지운다.
-- -------------------------------------------------------------
create or replace function public.livestock_use(p_target text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text;
  v_p       public.profiles;
  v_target  text := btrim(coalesce(p_target, ''));
  v_qty     integer;
  v_up      integer;
  v_down    integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  select username into v_name from public.profiles where id = v_uid;
  if v_name is null then raise exception 'NO_PROFILE'; end if;

  perform app.relation_sweep();

  v_p := app.accrue(v_uid);
  if v_p.ward_until is not null then raise exception 'IN_WARD'; end if;

  if v_target = '' then raise exception 'NO_PARTNER'; end if;
  if v_target = v_name then raise exception 'CANNOT_RELATE_SELF'; end if;
  if not exists (select 1 from public.profiles where username = v_target and not hidden) then
    raise exception 'NO_SUCH_PLAYER';
  end if;

  if not exists (
    select 1 from public.profiles
     where username = v_target and livestock_consent is true
  ) then
    raise exception 'NOT_CONSENTED';
  end if;

  -- 등재 시 username = 가축, partner = 주인 으로 넣는다(아래 insert 참고).
  if exists (
    select 1 from public.relations
     where kind = 'livestock' and username = v_target
       and expires_at > now()
  ) then
    raise exception 'ALREADY_LIVESTOCK';
  end if;

  if exists (
    select 1 from public.relations
     where kind = 'livestock' and username = v_name and partner = v_target
       and expires_at > now()
  ) then
    raise exception 'CANNOT_TARGET_OWNER';
  end if;

  -- 사슬 길이 제한. 주인은 한 명뿐이라 위쪽은 한 줄, 아래쪽은 나무 모양이다.
  -- 깊이 가드(d < max)는 혹시 남아 있는 순환에서도 멈추게 한다.
  with recursive up(name, d) as (
    select v_name, 0
    union all
    select r.partner, u.d + 1
      from public.relations r join up u on r.username = u.name
     where r.kind = 'livestock' and r.expires_at > now()
       and u.d < app.livestock_chain_max()
  )
  select max(d) into v_up from up;

  with recursive down(name, d) as (
    select v_target, 0
    union all
    select r.username, w.d + 1
      from public.relations r join down w on r.partner = w.name
     where r.kind = 'livestock' and r.expires_at > now()
       and w.d < app.livestock_chain_max()
  )
  select max(d) into v_down from down;

  if v_up + v_down + 2 > app.livestock_chain_max() then
    raise exception 'LIVESTOCK_CHAIN_FULL';
  end if;

  select qty into v_qty from public.inventories
   where user_id = v_uid and item_code = 'livestock_pass' for update;
  if coalesce(v_qty, 0) < 1 then raise exception 'NOT_ENOUGH_ITEMS'; end if;

  update public.inventories set qty = qty - 1
   where user_id = v_uid and item_code = 'livestock_pass';

  insert into public.relations
    (user_id, username, partner, body, status, decided_at, kind, expires_at)
  values (v_uid, v_target, v_name,
          format('%s%s %s의 가축이다.', v_target, app.ko_eun(v_target), v_name),
          'approved', now(), 'livestock',
          now() + make_interval(days => app.livestock_days()));

  -- 지목자 본인의 동의 철회를 app.livestock_consent_lock_days() 동안 막는다
  -- (02_schema.sql 의 set_profile_details 참고). 대상 쪽에는 찍지 않는다.
  update public.profiles set livestock_used_at = now() where id = v_uid;

  perform app.log(v_uid, 'trade', format('%s 가축 지목', v_target), 0, v_p.coins,
    jsonb_build_object('target', v_target));

  return public.relations_feed();
end;
$$;

-- -------------------------------------------------------------
-- 호칭권 사용. 가축 지목권과 조건이 전부 같다 — 소지품 탭 팝업에서 대상과
-- 원하는 호칭(예: 형님·오빠·주인님)을 함께 골라 호출한다.
--   · 대상은 신상에서 가축권에 동의(livestock_consent = true)한 사람만.
--   · 이미 누군가에게 호칭을 지정당한 사람은(그 동안) 다시 지목될 수 없다
--     — 이 판정은 kind='title' 안에서만 본다. 가축 관계와는 무관하다
--     (이미 내 가축인 사람도 호칭으로 다시 지목할 수 있고, 그 반대도 된다).
--   · 나를 호칭으로 지목해 둔 상대는 지목할 수 없다(되갚기 방지, kind='title' 한정).
-- 심사 없이 바로 approved 로 등재되고, 24시간 뒤 app.relation_sweep() 이 지운다.
-- -------------------------------------------------------------
create or replace function public.title_use(p_target text, p_title text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text;
  v_p       public.profiles;
  v_target  text := btrim(coalesce(p_target, ''));
  v_title   text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  v_qty     integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  select username into v_name from public.profiles where id = v_uid;
  if v_name is null then raise exception 'NO_PROFILE'; end if;

  perform app.relation_sweep();

  v_p := app.accrue(v_uid);
  if v_p.ward_until is not null then raise exception 'IN_WARD'; end if;

  if v_target = '' then raise exception 'NO_PARTNER'; end if;
  if v_target = v_name then raise exception 'CANNOT_RELATE_SELF'; end if;
  if not exists (select 1 from public.profiles where username = v_target and not hidden) then
    raise exception 'NO_SUCH_PLAYER';
  end if;

  if v_title = '' then raise exception 'NO_TITLE'; end if;

  if not exists (
    select 1 from public.profiles
     where username = v_target and livestock_consent is true
  ) then
    raise exception 'NOT_CONSENTED';
  end if;

  -- 등재 시 username = 대상자, partner = 지목자 로 넣는다(아래 insert 참고).
  if exists (
    select 1 from public.relations
     where kind = 'title' and username = v_target
       and expires_at > now()
  ) then
    raise exception 'ALREADY_TITLED';
  end if;

  if exists (
    select 1 from public.relations
     where kind = 'title' and username = v_name and partner = v_target
       and expires_at > now()
  ) then
    raise exception 'CANNOT_TARGET_OWNER';
  end if;

  select qty into v_qty from public.inventories
   where user_id = v_uid and item_code = 'title_pass' for update;
  if coalesce(v_qty, 0) < 1 then raise exception 'NOT_ENOUGH_ITEMS'; end if;

  update public.inventories set qty = qty - 1
   where user_id = v_uid and item_code = 'title_pass';

  insert into public.relations
    (user_id, username, partner, body, status, decided_at, kind, expires_at)
  values (v_uid, v_target, v_name,
          format('%s%s %s%s %s%s 부른다.',
                 v_target, app.ko_eun(v_target),
                 v_name,   app.ko_eul(v_name),
                 v_title,  app.ko_ro(v_title)),
          'approved', now(), 'title',
          now() + make_interval(hours => app.title_hours()));

  -- 지목자 본인의 동의 철회를 app.livestock_consent_lock_days() 동안 막는다
  -- (02_schema.sql 의 set_profile_details 참고) — 가축 지목권과 같은 잠금 타이머를 쓴다.
  -- 대상 쪽에는 찍지 않는다.
  update public.profiles set livestock_used_at = now() where id = v_uid;

  perform app.log(v_uid, 'trade', format('%s 호칭 지정', v_target), 0, v_p.coins,
    jsonb_build_object('target', v_target, 'title', v_title));

  return public.relations_feed();
end;
$$;

-- -------------------------------------------------------------
-- 관리자: 소식 심사 (대기 건을 위로)
-- -------------------------------------------------------------
create or replace function public.panel_relations()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_out jsonb;
begin
  perform app.require_admin();

  -- 빈 표에서도 jsonb_agg 는 NULL 한 행을 돌려줄 뿐 실패하지 않는다.
  -- coalesce 로 그 NULL 을 '[]' 로 바꿔서 클라이언트가 항상 배열을 받게 한다.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'username', username, 'partner', partner, 'body', body,
           'status', status, 'created_at', created_at,
           'reject_reason', reject_reason
         ) order by case when status = 'pending' then 0 else 1 end, created_at desc), '[]'::jsonb)
    into v_out
    from public.relations;

  return v_out;
end;
$$;

drop function if exists public.panel_relation_decide(bigint, boolean);

-- p_reason: 반려할 때만 쓴다 — 관리자가 사유를 적어야 반려할 수 있다.
-- 수락할 때는 이전에 남아 있던 반려 사유가 있어도 지운다.
-- 일반 관계를 수락하면 같은 두 사람(방향 무관) 사이의 옛 등재를 지운다 — 수정 신청이
-- 옛 내용을 대체해 한 쌍에 등재가 하나만 남는다.
create or replace function public.panel_relation_decide(
  p_id bigint, p_approve boolean, p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  r        public.relations;
begin
  perform app.require_admin();

  if not p_approve then
    if v_reason = ''       then raise exception 'NO_REASON'; end if;
    if length(v_reason) > 300 then raise exception 'REASON_TOO_LONG'; end if;
  end if;

  update public.relations
     set status        = case when p_approve then 'approved' else 'rejected' end,
         decided_at     = now(),
         reject_reason  = case when p_approve then null else v_reason end
   where id = p_id
  returning * into r;

  if not found then raise exception 'NO_RELATION'; end if;

  if p_approve and r.kind = 'user' then
    delete from public.relations
     where kind = 'user' and status = 'approved' and id <> r.id
       and ((username = r.username and partner = r.partner)
         or (username = r.partner and partner = r.username));
  end if;

  return public.panel_relations();
end;
$$;

-- 관리자: 목록에서 완전히 삭제 (심사 상태와 무관)
create or replace function public.panel_relation_delete(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
begin
  perform app.require_admin();

  delete from public.relations where id = p_id;
  if not found then raise exception 'NO_RELATION'; end if;

  return public.panel_relations();
end;
$$;

-- -------------------------------------------------------------
-- 권한
-- -------------------------------------------------------------
revoke all on function app.livestock_days()                          from public, anon, authenticated;
revoke all on function app.livestock_chain_max()                     from public, anon, authenticated;
revoke all on function app.relation_sweep()                          from public, anon, authenticated;
revoke all on function app.ko_jong(text)                             from public, anon, authenticated;
revoke all on function app.ko_eun(text)                              from public, anon, authenticated;
revoke all on function app.ko_eul(text)                              from public, anon, authenticated;
revoke all on function app.ko_ro(text)                               from public, anon, authenticated;

revoke all on function public.relations_feed()                       from public;
revoke all on function public.relation_submit(text, text)            from public;
revoke all on function public.relation_delete(bigint)                from public;
revoke all on function public.inmate_roster()                        from public;
revoke all on function public.livestock_use(text)                    from public;
revoke all on function public.title_use(text, text)                  from public;
revoke all on function public.panel_relations()                      from public;
revoke all on function public.panel_relation_decide(bigint, boolean, text) from public;
revoke all on function public.panel_relation_delete(bigint)          from public;

grant execute on function public.relations_feed()                       to authenticated;
grant execute on function public.relation_submit(text, text)            to authenticated;
grant execute on function public.relation_delete(bigint)                to authenticated;
grant execute on function public.inmate_roster()                        to authenticated;
grant execute on function public.livestock_use(text)                    to authenticated;
grant execute on function public.title_use(text, text)                  to authenticated;
grant execute on function public.panel_relations()                      to authenticated;
grant execute on function public.panel_relation_decide(bigint, boolean, text) to authenticated;
grant execute on function public.panel_relation_delete(bigint)          to authenticated;
