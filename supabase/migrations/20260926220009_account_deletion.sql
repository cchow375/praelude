-- Praelude backend: in-app account deletion (spec 4b: "removes all data+storage").

-- ---------------------------------------------------------------------------
-- Correction to the previous migration, found in this review pass: studios.created_by and
-- studio_goals.created_by were both `on delete cascade`, meaning deleting the studio's *creator's*
-- account would destroy the whole studio - its membership and every shared goal - for every other
-- member too. "Never lose user data" (spec 0) is framed around a deleting user's own data; it should
-- not extend to silently destroying a shared object other people are still using. Both become
-- `on delete set null` instead: the studio and its goals survive, with an unknown/former creator.
-- A studio whose sole owner-role member deletes their account has no remaining owner (this schema
-- has no ownership-transfer RPC yet) - a documented gap, not data loss; existing members keep their
-- membership, goals and read access regardless.
-- ---------------------------------------------------------------------------

alter table public.studios drop constraint studios_created_by_fkey;
alter table public.studios add constraint studios_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;
alter table public.studios alter column created_by drop not null;

alter table public.studio_goals drop constraint studio_goals_created_by_fkey;
alter table public.studio_goals add constraint studio_goals_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;
alter table public.studio_goals alter column created_by drop not null;

-- ---------------------------------------------------------------------------
-- delete_my_account (spec 4b): every public-schema table in this schema references auth.users(id)
-- with `on delete cascade` (verified by grep across every migration, not just asserted), so removing
-- the auth.users row is sufficient to remove every row this user owns or authored, everywhere -
-- library data, social data, reports they filed, everything. GoTrue's own internal tables
-- (identities, sessions, refresh_tokens, mfa factors, ...) already cascade from auth.users the same
-- way (it is how the platform's own admin "delete user" works). The only thing that does *not*
-- cascade automatically is storage: storage.objects has no FK to auth.users at all, so it is cleared
-- explicitly first, by object path prefix, before the user row goes.
-- ---------------------------------------------------------------------------

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'delete_my_account: must be called as an authenticated user' using errcode = '42501';
  end if;

  delete from storage.objects
   where bucket_id in ('avatars', 'scores', 'recordings', 'note-media')
     and (storage.foldername(name))[1] = v_uid::text;

  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account() is
  'Deletes every row and storage object owned by the caller, then the caller''s own auth.users row. '
  'Irreversible. See supabase/(C) Backend.md for the cascade audit and supabase/tests for the proof '
  'that it is complete.';
