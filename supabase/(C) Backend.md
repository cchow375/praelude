# (C) Backend — Supabase project `zotswpjyvmhnxdyibnnz`

What this track built (spec §4a/§4b server side, §5 data model, §5c moderation), how to operate it,
and what's still open. The client-facing half of this (RPC contracts, field-by-field wire format) is
`supabase/(C) Sync Protocol.md`; read that alongside this one.

## Applying migrations

The DB password isn't available to this repo. Every migration in `supabase/migrations/` was applied
with the Management API, in order, one file at a time:

```
supabase db query --linked --project-ref zotswpjyvmhnxdyibnnz -f supabase/migrations/<file>.sql
```

There is no `supabase_migrations.schema_migrations` tracking table (that's a `db push`/direct-
connection feature; verified it doesn't exist on this project). Applying is not idempotent file-by-
file — `create table`/`create type` fail on a second run — but each file _as a whole_ runs in one
transaction (verified: a mid-file error left zero side effects, confirmed by re-querying afterward),
so a broken file can be fixed and safely re-run from scratch. Keep using this same command for every
future migration, in filename order; do not run `supabase db push` against this project (it wants
the DB password) or `supabase link --password`.

## What's in each migration

| File                                        | Contents                                                                                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260926220001_extensions_and_helpers`     | Enums used across later files, `set_updated_at()`, the offensive-word filter (`blocked_words`/`contains_blocked_word`), the `sync_tables`/`append_only_tables` allow-lists |
| `20260926220002_profiles`                   | `profiles` (spec §4c), per-field privacy, the minor-clamping safety trigger, auto-provisioning on signup                                                                   |
| `20260926220003_library_sync_tables`        | Every schema3 collection except the append-only logs, `instruments` (§6), the `_setup_owner_table` procedure                                                               |
| `20260926220004_logs_sync_tables`           | The append-only logs, `_setup_append_only_table`                                                                                                                           |
| `20260926220005_sync_rpc`                   | `sync_upsert`/`sync_append`/`sync_update_last_page`/`sync_undo_attempt`                                                                                                    |
| `20260926220006_social`                     | Corrections to 1–5 (below), then all of spec §5: friendships, blocks, profile cards, activity feed, notes, presence, studios, invites, contact discovery                   |
| `20260926220007_moderation_and_leaderboard` | `reports` (the moderation queue), `leaderboard_friends()`                                                                                                                  |
| `20260926220008_storage_buckets`            | The four buckets and their `storage.objects` policies                                                                                                                      |
| `20260926220009_account_deletion`           | `delete_my_account()`, and un-cascading a studio away from its members                                                                                                     |
| `20260926220010_grants_and_indexes`         | anon lockdown, closing a stats leak, indexing every FK (as it existed at that point)                                                                                       |
| `20260926220011_advisor_fixes`              | Full remediation of a `supabase db advisors` run: see below                                                                                                                |
| `20260926220012_more_indexes`               | The FK indexes advisors found that `010` predated                                                                                                                          |

## Corrections found in review (in `20260926220006`, before anything depended on them)

The WIP this track continued had already built migrations 1–5 in a previous session; before adding
to them, this pass reviewed them critically rather than building on top unquestioned, and found four
real issues, all fixed in `20260926220006`'s preamble:

1. **`sync_tables`/`append_only_tables` had RLS enabled but _zero_ policies were ever declared as
   deliberately absent in code — they were simply missing entirely.** Supabase exposes every
   public-schema table over PostgREST by default; without RLS, any authenticated caller could insert
   a row of their own choosing into either allow-list and hand that table name to
   `sync_upsert`/`sync_append`. Fixed to match `blocked_words`'s existing pattern: RLS on, no
   policies, so only a migration (running as `postgres`) can touch them.
2. **Four enum labels were snake_case** (`performance_ready`, `plucked_strings`, `lesson_note`,
   `lesson_prep`, `only_me`) **when Core's actual Swift raw value is camelCase** (verified, not
   guessed — see the sync protocol doc). Renamed in place with `ALTER TYPE ... RENAME VALUE` before
   any client could have written the wrong ones.
3. **`sets.tempo_step`'s default didn't match `TempoStep`'s real Codable shape** (also verified
   empirically rather than assumed).
4. **`sets.goal`/`sets.basis` had no check constraint at all**, unlike every other enum-shaped column
   in the schema.

The single biggest design fix, in `20260926220005` (before `20260926220006` touched anything else):
**`sync_upsert`/`sync_update_last_page` decided "does this write win" with a `SELECT` that ran before
the `INSERT`/`UPDATE`.** Two concurrent calls for the same row could both read the same stale
snapshot, both pass the staleness check, and then apply in commit order rather than timestamp order
— silently losing whichever edit committed second even though it might have been the newer one. Both
now make that decision inside the same atomic statement (`ON CONFLICT ... DO UPDATE ... WHERE
stored.updated_at <= excluded.updated_at`), so Postgres's own row lock serializes concurrent callers
correctly: the second one re-evaluates the `WHERE` against the first one's already-committed row, not
a snapshot from before either of them ran.

## Design: cross-user reads go through named functions, not scattered policies

`profiles`' own RLS is self-only (`id = auth.uid()`); every other viewer's read goes through
`get_profile_card()`. Every table added for spec §5 follows the same shape: the base table's RLS
only ever lets a user see **their own** rows directly, and every cross-user read (a friend's card, a
friend's activity feed, who reacted to a post, a friend's notes, presence, shared repertoire) is a
named `SECURITY DEFINER` function that manually checks friendship/blocks/privacy and returns a
redacted projection. The alternative — cross-user `USING` clauses scattered across policies — would
duplicate the same friendship/block/privacy logic in more places and be harder to audit as one thing.
The one deliberate exception is `note_replies`: "private replies" (visible only to the note's owner
and that specific replier, never other repliers) is exactly what a row-filtering RLS policy expresses
well, so it stays a plain policy rather than a function.

**Private-account clamp** (`get_profile_card`, `can_view_avatar`): a field marked `'public'` is only
actually shown to a non-friend when the account itself is _not_ private. A private account clamps its
own `'public'`-flagged fields down to `'friends'` in practice. This isn't spelled out mechanically in
the spec, but follows from "conservative defaults" — otherwise "private account" would mean nothing
for whichever fields happen to default to `'public'` (name, username, photo).

## Presence: table + Realtime, not table alone

`public.presence` (spec §5a "practicing now") is a **fallback / last-known-state** store, written by
`set_presence()`. The live blinking-dot behavior is meant to run over **Supabase Realtime Presence**
on a per-user channel (e.g. `presence:practicing`, tracking `{owner_id, is_practicing, piece_id}`) —
that's what makes it feel instant, and it needs no schema of its own. `friend_presence()` reads the
table for whoever isn't currently on the Realtime channel (they backgrounded the app, their socket
dropped, etc.), and already treats a stale `is_practicing = true` older than two minutes as false, so
a force-quit without a final `set_presence(false)` doesn't show someone as "practicing" forever. The
iOS integration track owns wiring up the Realtime side; this track built the fallback and the shape
the client should reconcile against.

## Contact discovery: a known limitation, not an oversight

`discoverable_contact_hashes`/`uploaded_contact_hashes` do a plain hash join, not a private-set-
intersection protocol. Both sides opt in explicitly (a user only appears as a suggestion once they've
written a hash identifying themself; a user only sees suggestions once they've uploaded hashes of
their own contacts), and the raw phone/email never reaches the server — but a phone number's SHA-256
hash is brute-forceable from a small search space (a determined party with a full number range and
compute could reverse a hash back to a number), which a proper PSI protocol would close. Documented
here as a deliberate v1 scope call, not something missed.

## Offensive-word filter

`blocked_words`/`contains_blocked_word()` is a small, admin-extensible starter list (~35 entries),
not an exhaustive corpus — deliberately: baking a large slur/profanity list into a **public** repo is
its own bad idea (it becomes a lookup table for exactly the words this feature exists to catch, and a
public repo is a poor place to maintain something that needs regular, careful curation). Extend it
with ordinary `insert into blocked_words (word) values (...)` — no code change needed — before
relying on it for a real launch. It gates `profiles.username` (own trigger, plus the minor-clamp
logic), `notes.text`, `comments.body`, `note_replies.body` (the shared `enforce_no_blocked_words()`
trigger, parameterized by column name via `TG_ARGV`).

## Moderation queue and developer contact

`reports` **is** the moderation queue (`report_status`: open/actioned/dismissed is the queue state).
`target_type = 'developer_contact'` (with `target_id null`) doubles as the spec's separately-named
"developer contact" channel — one table, not two. No admin role or panel exists in this schema (out
of scope for this track): resolving a report is currently a `service_role`-only operation (bypasses
RLS entirely), worked from the Studio SQL editor or a future admin tool. A reporter can still see
their own report's status via the ordinary self-select policy.

## Account deletion: the cascade audit

Every `owner_id`/`id`/`created_by`/`member_id`/etc. reference to `auth.users` in every migration in
this directory is `on delete cascade` — checked by `grep -n "references auth.users" supabase/migrations/*.sql`
and confirming all of them, not asserted from memory. `delete_my_account()` therefore only needs to
handle the one thing that _doesn't_ cascade automatically (`storage.objects` has no FK to
`auth.users` at all) before deleting the `auth.users` row itself; GoTrue's own internal tables
(identities, sessions, refresh tokens, MFA factors, …) already cascade from `auth.users` the same way
the platform's own admin "delete user" does.

The one deliberate non-cascade: `studios.created_by`/`studio_goals.created_by` are `on delete set
null`, not cascade. A studio is shared data — if it cascaded, one member (its creator) deleting their
account would destroy the whole studio, its membership and every shared goal for every _other_
member too. It survives instead, at the cost of a known gap: if the sole owner-role member leaves,
the studio has no remaining owner and (with no ownership-transfer RPC yet) can't have members
added or removed going forward — existing members keep full read access and can still add goals
regardless.

## Auth configuration

`config.toml`'s `[auth]` section (already applied via `supabase config push` before this track
started): `site_url`/`additional_redirect_urls` point at `praelude://auth-callback` (spec §4b custom
URL scheme — no Associated Domains/universal links, which need a paid Apple entitlement this project
doesn't have). Email+password and magic link (`auth.email.enable_signup`) are on;
`auth.external.apple.enabled = false` (no Sign in with Apple — same paid-entitlement constraint).
`auth.sms.twilio` is deliberately left **undeclared** rather than `enabled = false`: the hosted
project already had a real Twilio account configured before this track touched it, and `config push`
only touches keys the file declares — declaring the table at all, even to leave it "disabled", would
have pushed a blank `account_sid` over the working one. Verified via `supabase config diff`, which
still shows only that one line (`auth.sms.twilio.enabled`) as the sole remaining difference between
this repo's `config.toml` and the live project, and confirms nothing else has drifted.

**Not yet done, and not reachable with this project's current CLI**: "Leaked Password Protection"
(checks new passwords against HaveIBeenPwned), flagged by `supabase db advisors`. It isn't part of
this CLI version's `config.toml` schema for the `auth` scope (confirmed via `supabase config diff`,
which lists every key it does and doesn't manage for this project and shows nothing password-
breach-related in either list) — enabling it needs either the Dashboard's Auth settings directly or a
Management API endpoint the CLI doesn't yet wrap. Left as a follow-up rather than reached for through
an unsupported call.

## iOS-side config

`ios/Praelude/Config/SupabaseConfig.swift` holds the project URL and the **publishable** key only
(`sb_publishable_...` — Supabase's current key format; the legacy JWT-style `anon` key still works
too but publishable is what new projects are meant to use going forward). Never the `secret`/legacy
`service_role` key. Read via `supabase projects api-keys` (no `--reveal`), which is safe for the
publishable key — **note for whoever next runs that command on this project**: without `--reveal`,
the _legacy_ `service_role` key still prints in full (only the newer `sb_secret_...`-format key is
redacted); the anon/publishable keys are the only ones that ever belong in this repo regardless of
what the terminal shows.

## Running the security/performance advisors

```
supabase db advisors --linked --project-ref zotswpjyvmhnxdyibnnz --type all --level info
```

Run after `20260926220012`: 104 findings remain, all expected/by design —
`unused_index` (67, INFO: every index in this schema is new, on tables with no query traffic yet;
nothing to remove), `rls_enabled_no_policy` (3, INFO: the intentional `sync_tables`/
`append_only_tables`/`blocked_words` lockdown), `authenticated_security_definer_function_executable`
(33, WARN: this schema's entire public RPC surface — each one checked by hand against this run's
output to confirm it either self-scopes via `auth.uid()` implicitly or validates its explicit target
parameter internally before returning/mutating anything), and the one leaked-password-protection
item above. Re-run this after any future migration that adds a table, policy or function.

## Tests

`supabase/tests/` — see that directory's own notes for how they're run (two throwaway users via the
public signup endpoint, impersonated with `set local role authenticated` + `request.jwt.claims`
inside a transaction that's rolled back, per the standard pattern for testing RLS without a
persistent second account).
