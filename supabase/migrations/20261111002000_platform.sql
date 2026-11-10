-- platform — 앞 마이그레이션의 함수를 Supabase 쪽(Auth · Storage · pg_cron)에 연결한다.
--
-- 여기에는 함수 몸통이 없다. 트리거 · 버킷 · 스토리지 정책 · 예약 작업만 둔다.

-- ── Auth: 계정이 만들어지면 profiles 행을 같이 만든다 ─────────────────
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Storage: 프로필 사진(공개 읽기) ───────────────────────────────────
-- 업로드 용량과 형식은 버킷 단에서도 한 번 더 막는다
-- (클라이언트는 이미 잘라서 훨씬 작게 올리지만, 우회 업로드에 대비한 상한선).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "avatar files are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "users upload their own avatar"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "users replace their own avatar"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "users delete their own avatar"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── Storage: 피드백 첨부 사진(비공개) ─────────────────────────────────
-- 읽기 판정은 security definer 함수(app.can_read_petition_photo)로 한다 —
-- petition_messages 에 RLS 정책이 없어 정책 안에서 직접 조회할 수 없기 때문이다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('petitions', 'petitions', false, 2097152, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "petition photos uploaded by owner"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'petitions');

create policy "petition photos read by owner or admin"
  on storage.objects for select to authenticated
  using (bucket_id = 'petitions' and app.can_read_petition_photo(name));

-- Supabase 는 storage.objects 를 SQL 로 직접 지우는 것을 막는다 — 파일은
-- 클라이언트가 Storage API 로 지운다. 올린 본인과 관리자만 지울 수 있다.
create policy "petition photos deleted by owner or admin"
  on storage.objects for delete to authenticated
  using (bucket_id = 'petitions' and (owner_id = auth.uid()::text or app.is_petition_admin()));

-- ── pg_cron: 예약 작업 ────────────────────────────────────────────────
-- 시각은 UTC 기준이다(show timezone = UTC).
create extension if not exists pg_cron;

-- 룸 주간 재배치: 일 21:05 UTC = 월 06:05 KST.
-- 정각이 아니라 5분 뒤인 이유: 일찍 튀면 app.cell_week_kst() 가 아직 지난주를
-- 가리켜 그 주 재배치를 통째로 건너뛰게 된다.
select cron.schedule('cell-rotate-weekly', '5 21 * * 0', 'select app.cell_rotate();');

-- 경마 정산: 출발(10:00 · 22:00 KST = 01:00 · 13:00 UTC) 1분 뒤.
-- 정산은 화면이 열릴 때 lazy 로도 돌므로(app.race_ensure), 예약이 늦어도 결과는 같다.
select cron.schedule('race-settle', '1 1,13 * * *', 'select app.race_settle_due();');
