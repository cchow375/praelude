-- Praelude backend: extensions, enums, and helper functions shared by every later migration.
-- See supabase/(C) Backend.md and supabase/(C) Sync Protocol.md for the full design rationale.

-- gen_random_uuid() is built into Postgres 17 core; no pgcrypto/uuid-ossp extension needed.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.profile_visibility as enum ('public', 'friends', 'only_me');
create type public.age_bracket as enum ('under_13', '13_to_17', '18_plus');
create type public.ink_layer as enum ('mine', 'teacher', 'performance');
create type public.friendship_status as enum ('pending', 'accepted', 'declined');
create type public.report_status as enum ('open', 'actioned', 'dismissed');
create type public.studio_member_role as enum ('owner', 'member');

-- ---------------------------------------------------------------------------
-- Generic bookkeeping trigger: bump updated_at on every UPDATE unless the
-- statement already set it explicitly to something newer than what is stored
-- (sync writers always set updated_at themselves; this is the fallback for
-- ordinary dashboard/PostgREST edits that don't).
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  if new.updated_at is null or new.updated_at <= old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger: keeps updated_at monotonic without fighting a caller that already advanced it.';

-- Social-graph helpers (is_blocked/is_friend) live in 20260926220006_social.sql,
-- immediately after the friendships/blocks tables they read - CREATE FUNCTION
-- validates referenced relations eagerly against the catalog on this project,
-- so they cannot be declared before their tables exist.

-- ---------------------------------------------------------------------------
-- Offensive-word filter (spec 5c: usernames, notes, comments).
-- This is deliberately a small, admin-extensible starter list rather than an
-- exhaustive slur/profanity corpus baked into a public repo - see
-- supabase/(C) Backend.md for why, and expand it via ordinary INSERTs before
-- relying on it for a real launch.
-- ---------------------------------------------------------------------------

create table public.blocked_words (
  word text primary key
);

alter table public.blocked_words enable row level security;
-- No policies: this table is never read or written through the API (not even
-- by authenticated users) - only the SECURITY DEFINER function below and a
-- service/dashboard admin touch it directly.

insert into public.blocked_words (word) values
  ('anal'), ('anus'), ('arse'), ('ass'), ('asshole'), ('bastard'), ('bitch'),
  ('bollocks'), ('bugger'), ('bullshit'), ('cock'), ('crap'), ('cunt'), ('damn'),
  ('dick'), ('dickhead'), ('douchebag'), ('fag'), ('faggot'), ('fuck'), ('fucker'),
  ('fucking'), ('goddamn'), ('hell'), ('jackass'), ('motherfucker'), ('nigger'),
  ('nigga'), ('piss'), ('prick'), ('pussy'), ('retard'), ('shit'), ('slut'),
  ('twat'), ('wanker'), ('whore')
on conflict do nothing;

create or replace function public.contains_blocked_word(p_text text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.blocked_words w
    where p_text ~* ('(?<![a-z0-9])' || w.word || '(?![a-z0-9])')
  );
$$;

revoke all on function public.contains_blocked_word(text) from public;
grant execute on function public.contains_blocked_word(text) to authenticated, anon;

comment on function public.contains_blocked_word(text) is
  'Case-insensitive whole-word match against public.blocked_words. Used by CHECK-style triggers on '
  'profiles.username, notes.text, comments.body, note_replies.body. Starter list only - extend it '
  '(insert into public.blocked_words) with a proper moderation wordlist before relying on it.';

-- ---------------------------------------------------------------------------
-- Sync-table catalogs, populated by the migrations that create each table.
-- Used by the generic sync_upsert/sync_append RPCs (see 20260926220005) as an
-- allow-list so a client-supplied table name can never reach dynamic SQL
-- un-vetted.
-- ---------------------------------------------------------------------------

create table public.sync_tables (
  table_name text primary key,
  conflict_column text not null default 'id'
);

create table public.append_only_tables (
  table_name text primary key
);

comment on table public.sync_tables is
  'Allow-list of tables the generic sync_upsert() RPC may touch, plus which column is the upsert '
  'conflict target (''id'' for ordinary rows, ''owner_id'' for the two per-user settings singletons).';
comment on table public.append_only_tables is
  'Allow-list of tables the generic sync_append() RPC may touch (event logs: never updated or deleted '
  'after insert, except via the two narrow dedicated RPCs documented in supabase/(C) Sync Protocol.md).';
