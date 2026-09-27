-- Praelude backend: the remaining `unindexed_foreign_keys` (INFO, 15 findings) from the same
-- `supabase db advisors` run - foreign keys added across 20260926220006/20260926220009 that
-- 20260926220010's index pass (written against an earlier state of the schema) didn't yet cover.

create index activity_events_passage_idx on public.activity_events (passage_id);
create index activity_events_piece_idx on public.activity_events (piece_id);
create index comments_owner_idx on public.comments (owner_id);
create index folders_parent_folder_idx on public.folders (parent_folder_id);
create index invite_codes_owner_idx on public.invite_codes (owner_id);
create index note_replies_owner_idx on public.note_replies (owner_id);
create index notes_piece_idx on public.notes (piece_id);
create index passages_parent_passage_idx on public.passages (parent_passage_id);
create index practice_goals_piece_idx on public.practice_goals (piece_id);
create index presence_piece_idx on public.presence (piece_id);
create index rule_events_passage_idx on public.rule_events (passage_id);
create index rule_events_piece_idx on public.rule_events (piece_id);
create index studio_goals_created_by_idx on public.studio_goals (created_by);
create index studios_created_by_idx on public.studios (created_by);
create index warmup_exercises_custom_from_passage_idx on public.warmup_exercises (custom_from_passage_id);
