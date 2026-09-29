-- Praelude backend: two findings from `supabase db advisors` run after 20260926220020/20260926220021
-- (the same "run advisors after every migration that adds a table, policy or function" discipline
-- supabase/(C) Backend.md already documents), neither reachable before those two landed:
--
-- 1. auth_rls_initplan (WARN): presence_topic_insert_own compared `_presence_topic_owner() =
--    auth.uid()` directly - auth.uid() re-evaluates per row instead of once per statement. Every
--    other policy in this schema already wraps it as `(select auth.uid())` (see e.g.
--    20260926220011_advisor_fixes.sql's studio policies); this one is fixed to match. Policies can't
--    be ALTERed in place for their qual/check, so this drops and recreates it - CREATE POLICY IF NOT
--    EXISTS doesn't exist either, so DROP POLICY IF EXISTS first makes this safely re-runnable.
-- 2. unindexed_foreign_keys (INFO x2): milestone_events.piece_id/passage_id (added
--    20260926220020_milestone_events_add_piece_passage.sql) had no covering index, unlike every other
--    FK in this schema (20260926220012_more_indexes.sql already did this pass once for everything
--    that predated it).

drop policy if exists "presence_topic_insert_own" on "realtime"."messages";
create policy "presence_topic_insert_own" on "realtime"."messages"
  for insert to authenticated
  with check (extension = 'presence' and public._presence_topic_owner() = (select auth.uid()));

create index if not exists milestone_events_piece_id_idx on public.milestone_events (piece_id);
create index if not exists milestone_events_passage_id_idx on public.milestone_events (passage_id);
