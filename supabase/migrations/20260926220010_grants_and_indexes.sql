-- Praelude backend: closing grants and the indexes every RLS policy/incremental sync pull needs.

-- ---------------------------------------------------------------------------
-- Grants hardening.
--
-- 1. anon gets zero access to every application table. Nothing in this schema is meant to be usable
--    before signing in (no public profile browsing, no public leaderboard) - every policy in this
--    schema was already written `to authenticated` only, so anon already has no RLS-granted rows,
--    but an explicit revoke closes the table-privilege layer underneath RLS too (defense in depth:
--    correct even if a future policy is accidentally written without a `to` clause, which defaults
--    to PUBLIC).
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all procedures in schema public from anon;
-- Apply the same default to whatever the *next* migration creates, not just what already exists.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;

-- ---------------------------------------------------------------------------
-- 2. Internal helper functions (leading underscore) default to PUBLIC execute, like every Postgres
--    function - most are harmless to call directly (pure boolean logic, or read only what the
--    caller could already infer), but _profile_stats(p_owner uuid) is a real leak: called directly
--    with an arbitrary uuid, it returns full stats for *any* user with no privacy/friendship/block
--    check at all (that check lives in get_profile_card, its only intended caller). Revoking direct
--    execute doesn't affect get_profile_card itself: a SECURITY DEFINER function's internal calls
--    run as its owner (postgres), which always implicitly has execute on its own functions.
-- ---------------------------------------------------------------------------

revoke all on function public._profile_stats(uuid) from public, authenticated;
revoke all on function public._profile_field_visible(public.profile_visibility, boolean, boolean) from public, authenticated;
revoke all on function public._can_view_social_target(text, uuid) from public, authenticated;
revoke all on function public._enforce_owned_piece_passage() from public, authenticated;
-- These two are PROCEDURES (CALL, not SELECT), which need the "ON PROCEDURE" form of REVOKE - they
-- were never callable as a privilege-escalation path anyway (not SECURITY DEFINER, so their DDL runs
-- as the caller, and an authenticated role lacks ALTER TABLE/CREATE POLICY privilege regardless);
-- this is hygiene, not a fix for a reachable bug.
revoke all on procedure public._setup_owner_table(text, text) from public, authenticated;
revoke all on procedure public._setup_append_only_table(text) from public, authenticated;
revoke all on function public._week_start(timestamptz) from public, authenticated;

-- ---------------------------------------------------------------------------
-- Indexes. Postgres does not index a foreign-key column automatically (only PRIMARY KEY/UNIQUE), so
-- every owner_id/piece_id/passage_id FK in this schema was, until this migration, backed by nothing
-- but a sequential scan - for owner_id specifically, that means every single RLS-filtered query
-- against these tables. (owner_id, updated_at) is the composite the client's own documented
-- incremental-pull pattern needs (supabase/(C) Sync Protocol.md: "owner_id = auth.uid() and
-- updated_at > last_sync_at"); append-only tables get the same shape keyed by their own event-date
-- column instead.
-- ---------------------------------------------------------------------------

-- Library sync tables (owner_id, updated_at).
create index instruments_owner_updated_idx on public.instruments (owner_id, updated_at);
create index pieces_owner_updated_idx on public.pieces (owner_id, updated_at);
create index passages_owner_updated_idx on public.passages (owner_id, updated_at);
create index ink_strokes_owner_updated_idx on public.ink_strokes (owner_id, updated_at);
create index tags_owner_updated_idx on public.tags (owner_id, updated_at);
create index folders_owner_updated_idx on public.folders (owner_id, updated_at);
create index setlists_owner_updated_idx on public.setlists (owner_id, updated_at);
create index bookmarks_owner_updated_idx on public.bookmarks (owner_id, updated_at);
create index page_edits_owner_updated_idx on public.page_edits (owner_id, updated_at);
create index score_links_owner_updated_idx on public.score_links (owner_id, updated_at);
create index annotations_owner_updated_idx on public.annotations (owner_id, updated_at);
create index warmup_exercises_owner_updated_idx on public.warmup_exercises (owner_id, updated_at);
create index audio_recordings_owner_updated_idx on public.audio_recordings (owner_id, updated_at);
create index notebook_entries_owner_updated_idx on public.notebook_entries (owner_id, updated_at);
create index practice_goals_owner_updated_idx on public.practice_goals (owner_id, updated_at);
create index practice_routines_owner_updated_idx on public.practice_routines (owner_id, updated_at);
create index practice_sessions_owner_updated_idx on public.practice_sessions (owner_id, updated_at);
create index sets_owner_updated_idx on public.sets (owner_id, updated_at);

-- Append-only log tables (owner_id, <own event-date column>).
create index attempts_owner_date_idx on public.attempts (owner_id, date);
create index rule_events_owner_fired_idx on public.rule_events (owner_id, fired_at);
create index reward_ledger_owner_date_idx on public.reward_ledger (owner_id, date);
create index badges_owner_earned_idx on public.badges (owner_id, earned_at);
create index milestone_events_owner_date_idx on public.milestone_events (owner_id, date);
create index cold_grades_owner_date_idx on public.cold_grades (owner_id, date);
create index break_point_taps_owner_date_idx on public.break_point_taps (owner_id, date);

-- Hot foreign-key lookups a real screen queries directly (already owner_id-scoped by RLS, but the
-- second predicate still needs its own index - "owner_id, updated_at" doesn't help "which passages
-- does piece X have").
create index passages_piece_idx on public.passages (piece_id);
create index ink_strokes_piece_page_layer_idx on public.ink_strokes (piece_id, page, layer);
create index bookmarks_piece_idx on public.bookmarks (piece_id);
create index page_edits_piece_idx on public.page_edits (piece_id);
create index score_links_piece_idx on public.score_links (piece_id);
create index annotations_piece_idx on public.annotations (piece_id);
create index notebook_entries_piece_idx on public.notebook_entries (piece_id);
create index practice_sessions_piece_idx on public.practice_sessions (piece_id);
create index sets_piece_idx on public.sets (piece_id);
create index sets_passage_idx on public.sets (passage_id);
create index sets_session_idx on public.sets (session_id);
create index attempts_set_idx on public.attempts (set_id);
create index cold_grades_passage_idx on public.cold_grades (passage_id);
create index break_point_taps_passage_idx on public.break_point_taps (passage_id);
create index audio_recordings_passage_idx on public.audio_recordings (passage_id);
create index pieces_instrument_idx on public.pieces (instrument_id);
