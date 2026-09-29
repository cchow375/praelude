-- Praelude backend: ink_strokes was missing fingerprint, so a second device could never save
-- edits to ink it received through sync.
--
-- InkStroke.fingerprint (ios/Praelude/Core/Ink.swift) is the stable, PencilKit-serializer-
-- independent identity `PracticeStore.replaceInk` diffs by (fingerprint ?? data) when deciding
-- whether a stroke is unchanged, new, or removed. InkStrokeSyncRow (ios/Praelude/Core/SyncDTO.swift)
-- did not carry it at all, and jsonb_populate_record silently drops any JSON key with no matching
-- column (it does not error) — so even after the client starts sending fingerprint, without this
-- column the value would be accepted and quietly discarded on every push, and every pulled row
-- would still decode with fingerprint = nil. A pulled row with no fingerprint diffs by its raw
-- data bytes instead, which a re-split of the very same, untouched stroke on the pulling device
-- never reproduces (two independent PKDrawing constructions from identical stroke content never
-- serialize to equal bytes) — so every synced stroke looked "changed" on the pulling device's next
-- save, and the freshly computed replacement id (deterministic in the fingerprint, which both
-- devices agree on) collided with the row just tombstoned in the same transaction, failing the
-- library's stroke-uniqueness check outright.
--
-- Nullable: a row written by the whole-page compatibility shim (`saveDrawing`) never computes a
-- fingerprint, and existing rows already synced under the old shape have none either. Adding a
-- nullable column to an existing table is safe regardless of how many rows already exist. Not
-- applied against the live project by this change (no DB password/CLI access in this environment,
-- per ios/(C) Audit.md) — apply in filename order per "(C) Backend.md" before this fix takes
-- effect server-side.

alter table public.ink_strokes
  add column if not exists fingerprint bytea;

comment on column public.ink_strokes.fingerprint is
  'InkStroke.fingerprint (Core), hex-encoded like data (see "(C) Sync Protocol.md" §3). Added '
  '20260926220023; missing from the original table definition, which broke sync entirely for a '
  'second device saving ink it had pulled.';
