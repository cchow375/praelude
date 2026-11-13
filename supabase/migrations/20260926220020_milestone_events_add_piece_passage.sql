-- Praelude backend: milestone_events was missing piece_id/passage_id.
--
-- Core's MilestoneEvent (ios/Praelude/Core/Rewards.swift) carries optional pieceID/passageID "so a
-- later scan for 'has this already been celebrated' can match by stable id instead of by detail
-- text". The original milestone_events table (20260926220004_logs_sync_tables.sql) only had
-- id/kind/date/detail - two real Core-side columns short. sync_append's jsonb_populate_record
-- silently drops any JSON key with no matching column (it does not error), so pushing a
-- MilestoneEventSyncRow with piece_id/passage_id set would have appeared to succeed while quietly
-- losing that association forever, on the very first sync of this table. Caught here, before any
-- client depended on it (this migration lands in the same pass that first wires this table at all -
-- see ios/Praelude/Core/SyncDTO2.swift, ios/Praelude/Services/SyncCoordinator.swift).
--
-- Nullable and on delete cascade, matching every other optional piece/passage reference in this
-- schema (e.g. rule_events.piece_id/passage_id, notebook_entries.piece_id). Append-only: adding a
-- nullable column to an existing table is safe regardless of how many rows already exist (none did -
-- this table had never been pushed to before this pass).

alter table public.milestone_events
  add column if not exists piece_id uuid references public.pieces (id) on delete cascade,
  add column if not exists passage_id uuid references public.passages (id) on delete cascade;

comment on column public.milestone_events.piece_id is
  'MilestoneEvent.pieceID (Core) - which piece/passage-readiness milestone this is, if any. Added '
  '20260926220020; missing from the original table definition.';
comment on column public.milestone_events.passage_id is
  'MilestoneEvent.passageID (Core). See piece_id''s comment.';
