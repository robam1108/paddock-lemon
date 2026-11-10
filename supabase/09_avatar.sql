-- ============================================================
--  신원표 사진
--
--  실제 사진 파일은 Storage 버킷(avatars)에 들어가고, profiles 에는
--  그 파일 경로(text) 한 줄만 남는다. 원본을 DB 행에 밀어 넣지 않는 이유:
--    - Storage 는 바이너리 전용이라 테이블/백업/인덱스가 커지지 않는다.
--    - 클라이언트가 사진을 132:152 비율로 미리 잘라 작은 JPEG로 압축해
--      올리므로(AvatarCropper.tsx), 버킷에 쌓이는 파일 자체도 몇십 KB다.
--    - 프로필 조회(get_my_state 등)가 매번 사진 바이트를 실어 나르지 않는다.
--
--  경로는 항상 "<uid>/avatar.jpg" 형태로 고정한다. 사용자마다 파일이 하나뿐이라
--  다시 올리면 그냥 덮어쓴다(upsert). 파일 이름 자체가 소유권 증명이라
--  storage.objects 정책은 "폴더명이 내 uid 와 같을 때만" 쓰고 지울 수 있게 한다.
--
--  실행 순서: 02_schema.sql -> ... -> 09_avatar.sql (profiles.avatar_path 와
--  app.state_json 의 avatar_path 필드는 02_schema.sql 쪽에 있다)
--
--  이 파일은 몇 번을 다시 실행해도 안전하다.
-- ============================================================

-- -------------------------------------------------------------
-- 버킷: 공개 읽기(사진이라 굳이 서명 URL을 쓸 이유가 없다),
-- 업로드 용량과 형식은 버킷 단에서도 한 번 더 막아 둔다.
-- (클라이언트는 이미 잘라서 훨씬 작게 올리지만, 우회 업로드에 대비한 상한선)
-- -------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

update storage.buckets
   set public = true,
       file_size_limit = 1048576, -- 1MB
       allowed_mime_types = array['image/jpeg', 'image/webp', 'image/png']
 where id = 'avatars';

drop policy if exists "avatar files are publicly readable" on storage.objects;
create policy "avatar files are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "users upload their own avatar" on storage.objects;
create policy "users upload their own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users replace their own avatar" on storage.objects;
create policy "users replace their own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users delete their own avatar" on storage.objects;
create policy "users delete their own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- -------------------------------------------------------------
-- profiles.avatar_path 는 profiles 의 다른 컬럼들과 마찬가지로
-- 클라이언트가 테이블을 직접 못 건드리므로, 이 RPC로만 바꿀 수 있다.
-- 업로드 자체는 위 storage 정책이 이미 소유권을 검증하므로, 여기서는
-- 경로가 호출자 자신의 폴더인지만 한 번 더 확인한다.
-- -------------------------------------------------------------
create or replace function public.set_avatar_path(p_path text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
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

revoke all on function public.set_avatar_path(text) from public;
grant execute on function public.set_avatar_path(text) to authenticated;
