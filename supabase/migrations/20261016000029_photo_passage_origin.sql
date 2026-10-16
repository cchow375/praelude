-- Photo passages remain ordinary private PDFs plus normal passage regions. Their origin is
-- synchronized explicitly, independent of local filenames, folder labels and folder identities.
-- Nullable/no default preserves existing rows; older clients omit the column and cannot erase it.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.pieces add column if not exists is_photo_passage boolean;
comment on column public.pieces.is_photo_passage is
  'True for a cropped-photo passage card; false for an ordinary score; null for legacy/unpublished origin.';
notify pgrst, 'reload schema';
commit;
