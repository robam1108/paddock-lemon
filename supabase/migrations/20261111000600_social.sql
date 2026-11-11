-- social — 친구 · 피드백 · 프로필 사진/정보
--
-- 여기 정의된 함수의 몸통은 저장소 전체에서 이 파일에만 있다(같은 함수가 두 곳에 보이면 버그다).

set check_function_bodies = false;

-- ════════ 테이블 ════════

CREATE TABLE public.petition_messages (
    id bigint NOT NULL,
    petition_id bigint NOT NULL,
    author_id uuid NOT NULL,
    is_admin_reply boolean DEFAULT false NOT NULL,
    body text NOT NULL,
    image_path text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.petition_messages ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.petition_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.petitions (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    username text NOT NULL,
    subject text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_message_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT petitions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'answered'::text, 'closed'::text])))
);

ALTER TABLE public.petitions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.petitions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.relations (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    username text NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    partner text DEFAULT ''::text NOT NULL,
    reject_reason text,
    kind text DEFAULT 'user'::text NOT NULL,
    expires_at timestamp with time zone,
    CONSTRAINT relations_kind_check CHECK ((kind = 'user'::text)),
    CONSTRAINT relations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);

ALTER TABLE public.relations ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.relations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY public.petition_messages
    ADD CONSTRAINT petition_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.petitions
    ADD CONSTRAINT petitions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.relations
    ADD CONSTRAINT relations_pkey PRIMARY KEY (id);

CREATE INDEX petition_messages_thread_idx ON public.petition_messages USING btree (petition_id, created_at);

CREATE INDEX petitions_status_idx ON public.petitions USING btree (status, last_message_at DESC);

CREATE INDEX petitions_user_idx ON public.petitions USING btree (user_id, last_message_at DESC);

ALTER TABLE ONLY public.petition_messages
    ADD CONSTRAINT petition_messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.petition_messages
    ADD CONSTRAINT petition_messages_petition_id_fkey FOREIGN KEY (petition_id) REFERENCES public.petitions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.petitions
    ADD CONSTRAINT petitions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.relations
    ADD CONSTRAINT relations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.petition_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.petitions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.relations ENABLE ROW LEVEL SECURITY;

-- ════════ 함수 ════════

CREATE FUNCTION app.can_read_petition_photo(p_name text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

CREATE FUNCTION app.is_petition_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

CREATE FUNCTION app.own_petition_photo(p_uid uuid, p_path text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
  select p_path is null or exists (
    select 1 from storage.objects
     where bucket_id = 'petitions' and name = p_path and owner_id = p_uid::text
  );
$$;

CREATE FUNCTION public.player_roster() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_out jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  -- 'flex' 는 문장 배열만 담는다 — 만료 시각·품목 코드는 절대 내보내지 않는다
  -- (그건 본인 화면에서 state_json 의 'flex' 로만 나간다). 프로필 표시는
  -- 휴식 중인 동안 통째로 숨긴다.
  select coalesce(jsonb_agg(jsonb_build_object(
           'username',    p.username,
           'avatar_path', p.avatar_path,
           'hp',          p.hp,
           'hp_max',      app.hp_max(),
           'in_ward',     (p.ward_until is not null),
           'status_message', p.status_message,
           'age',         p.age,
           'height_cm',   p.height_cm,
           'weight_kg',   p.weight_kg,
           'bio',         p.bio,
           'flex',
             (case when p.ward_until is not null then '[]'::jsonb else coalesce((
                 select jsonb_agg(
                          -- {giver} 자리는 선물받아 장착했으면 준 사람, 아니면 본인 이름.
                          app.flex_render(
                            case when f.together then coalesce(d.flex_text_with, d.flex_text)
                                 when f.gifted then d.flex_text_gift
                                 else d.flex_text end,
                            case when f.gifted and not f.together
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

CREATE FUNCTION public.petition_create(p_subject text, p_body text, p_image_path text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

  -- 처리되지 않은 피드백이 쌓이지 않도록 1인 3건(open+answered)으로 제한한다.
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

CREATE FUNCTION public.petition_list() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

CREATE FUNCTION public.petition_reply(p_id bigint, p_body text, p_image_path text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

CREATE FUNCTION public.petition_thread(p_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

CREATE FUNCTION public.relation_delete(p_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_name  text;
  v_admin boolean;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select username, is_admin into v_name, v_admin
    from public.profiles where id = v_uid;

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

CREATE FUNCTION public.relation_submit(p_partner text, p_body text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

CREATE FUNCTION public.relations_feed() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

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

CREATE FUNCTION public.set_avatar_path(p_path text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_p   public.profiles;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  if p_path is not null and (storage.foldername(p_path))[1] is distinct from v_uid::text then
    raise exception 'INVALID_PATH';
  end if;

  update public.profiles set avatar_path = p_path
   where id = v_uid
  returning * into v_p;

  return app.state_json(v_p);
end;
$$;

CREATE FUNCTION public.set_profile_details(p_status_message text, p_age integer, p_height_cm numeric, p_weight_kg numeric, p_bio text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_p     public.profiles;
  v_status text := nullif(btrim(coalesce(p_status_message, '')), '');
  v_bio    text := nullif(btrim(coalesce(p_bio, '')), '');
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_status is not null and length(v_status) > 40 then raise exception 'INVALID_DETAIL'; end if;
  if v_bio is not null and length(v_bio) > 300 then raise exception 'INVALID_DETAIL'; end if;
  if p_age is not null and p_age not between 1 and 120 then raise exception 'INVALID_DETAIL'; end if;
  if p_height_cm is not null and p_height_cm not between 50 and 250 then raise exception 'INVALID_DETAIL'; end if;
  if p_weight_kg is not null and p_weight_kg not between 20 and 300 then raise exception 'INVALID_DETAIL'; end if;

  update public.profiles
     set status_message = v_status,
         age            = p_age,
         height_cm      = round(p_height_cm, 1),
         weight_kg      = round(p_weight_kg, 1),
         bio            = v_bio
   where id = v_uid
  returning * into v_p;

  return app.state_json(v_p);
end;
$$;

-- ════════ 권한 ════════

REVOKE ALL ON FUNCTION app.can_read_petition_photo(p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION app.can_read_petition_photo(p_name text) TO authenticated;

REVOKE ALL ON FUNCTION app.is_petition_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION app.is_petition_admin() TO authenticated;

REVOKE ALL ON FUNCTION public.player_roster() FROM PUBLIC;
GRANT ALL ON FUNCTION public.player_roster() TO anon;
GRANT ALL ON FUNCTION public.player_roster() TO authenticated;
GRANT ALL ON FUNCTION public.player_roster() TO service_role;

REVOKE ALL ON FUNCTION public.petition_create(p_subject text, p_body text, p_image_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.petition_create(p_subject text, p_body text, p_image_path text) TO anon;
GRANT ALL ON FUNCTION public.petition_create(p_subject text, p_body text, p_image_path text) TO authenticated;
GRANT ALL ON FUNCTION public.petition_create(p_subject text, p_body text, p_image_path text) TO service_role;

REVOKE ALL ON FUNCTION public.petition_list() FROM PUBLIC;
GRANT ALL ON FUNCTION public.petition_list() TO anon;
GRANT ALL ON FUNCTION public.petition_list() TO authenticated;
GRANT ALL ON FUNCTION public.petition_list() TO service_role;

REVOKE ALL ON FUNCTION public.petition_reply(p_id bigint, p_body text, p_image_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.petition_reply(p_id bigint, p_body text, p_image_path text) TO anon;
GRANT ALL ON FUNCTION public.petition_reply(p_id bigint, p_body text, p_image_path text) TO authenticated;
GRANT ALL ON FUNCTION public.petition_reply(p_id bigint, p_body text, p_image_path text) TO service_role;

REVOKE ALL ON FUNCTION public.petition_thread(p_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.petition_thread(p_id bigint) TO anon;
GRANT ALL ON FUNCTION public.petition_thread(p_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.petition_thread(p_id bigint) TO service_role;

REVOKE ALL ON FUNCTION public.relation_delete(p_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.relation_delete(p_id bigint) TO anon;
GRANT ALL ON FUNCTION public.relation_delete(p_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.relation_delete(p_id bigint) TO service_role;

REVOKE ALL ON FUNCTION public.relation_submit(p_partner text, p_body text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.relation_submit(p_partner text, p_body text) TO anon;
GRANT ALL ON FUNCTION public.relation_submit(p_partner text, p_body text) TO authenticated;
GRANT ALL ON FUNCTION public.relation_submit(p_partner text, p_body text) TO service_role;

REVOKE ALL ON FUNCTION public.relations_feed() FROM PUBLIC;
GRANT ALL ON FUNCTION public.relations_feed() TO anon;
GRANT ALL ON FUNCTION public.relations_feed() TO authenticated;
GRANT ALL ON FUNCTION public.relations_feed() TO service_role;

REVOKE ALL ON FUNCTION public.set_avatar_path(p_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_avatar_path(p_path text) TO anon;
GRANT ALL ON FUNCTION public.set_avatar_path(p_path text) TO authenticated;
GRANT ALL ON FUNCTION public.set_avatar_path(p_path text) TO service_role;

REVOKE ALL ON FUNCTION public.set_profile_details(p_status_message text, p_age integer, p_height_cm numeric, p_weight_kg numeric, p_bio text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_profile_details(p_status_message text, p_age integer, p_height_cm numeric, p_weight_kg numeric, p_bio text) TO anon;
GRANT ALL ON FUNCTION public.set_profile_details(p_status_message text, p_age integer, p_height_cm numeric, p_weight_kg numeric, p_bio text) TO authenticated;
GRANT ALL ON FUNCTION public.set_profile_details(p_status_message text, p_age integer, p_height_cm numeric, p_weight_kg numeric, p_bio text) TO service_role;

GRANT ALL ON TABLE public.petition_messages TO anon;
GRANT ALL ON TABLE public.petition_messages TO authenticated;
GRANT ALL ON TABLE public.petition_messages TO service_role;

GRANT ALL ON SEQUENCE public.petition_messages_id_seq TO anon;
GRANT ALL ON SEQUENCE public.petition_messages_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.petition_messages_id_seq TO service_role;

GRANT ALL ON TABLE public.petitions TO anon;
GRANT ALL ON TABLE public.petitions TO authenticated;
GRANT ALL ON TABLE public.petitions TO service_role;

GRANT ALL ON SEQUENCE public.petitions_id_seq TO anon;
GRANT ALL ON SEQUENCE public.petitions_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.petitions_id_seq TO service_role;

GRANT ALL ON TABLE public.relations TO anon;
GRANT ALL ON TABLE public.relations TO authenticated;
GRANT ALL ON TABLE public.relations TO service_role;

GRANT ALL ON SEQUENCE public.relations_id_seq TO anon;
GRANT ALL ON SEQUENCE public.relations_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.relations_id_seq TO service_role;
