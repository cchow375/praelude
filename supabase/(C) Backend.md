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

| File                                                   | Contents                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260926220001_extensions_and_helpers`                | Enums used across later files, `set_updated_at()`, the offensive-word filter (`blocked_words`/`contains_blocked_word`), the `sync_tables`/`append_only_tables` allow-lists                                                                                                            |
| `20260926220002_profiles`                              | `profiles` (spec §4c), per-field privacy, the minor-clamping safety trigger, auto-provisioning on signup                                                                                                                                                                              |
| `20260926220003_library_sync_tables`                   | Every schema3 collection except the append-only logs, `instruments` (§6), the `_setup_owner_table` procedure                                                                                                                                                                          |
| `20260926220004_logs_sync_tables`                      | The append-only logs, `_setup_append_only_table`                                                                                                                                                                                                                                      |
| `20260926220005_sync_rpc`                              | `sync_upsert`/`sync_append`/`sync_update_last_page`/`sync_undo_attempt`                                                                                                                                                                                                               |
| `20260926220006_social`                                | Corrections to 1–5 (below), then all of spec §5: friendships, blocks, profile cards, activity feed, notes, presence, studios, invites, contact discovery                                                                                                                              |
| `20260926220007_moderation_and_leaderboard`            | `reports` (the moderation queue), `leaderboard_friends()`                                                                                                                                                                                                                             |
| `20260926220008_storage_buckets`                       | The four buckets and their `storage.objects` policies                                                                                                                                                                                                                                 |
| `20260926220009_account_deletion`                      | `delete_my_account()`, and un-cascading a studio away from its members                                                                                                                                                                                                                |
| `20260926220010_grants_and_indexes`                    | anon lockdown, closing a stats leak, indexing every FK (as it existed at that point)                                                                                                                                                                                                  |
| `20260926220011_advisor_fixes`                         | Full remediation of a `supabase db advisors` run: see below                                                                                                                                                                                                                           |
| `20260926220012_more_indexes`                          | The FK indexes advisors found that `010` predated                                                                                                                                                                                                                                     |
| `20260926220013_fix_respond_friend_request`            | Enum-cast bug fix — see "Corrections found while writing the tests" below                                                                                                                                                                                                             |
| `20260926220014_grant_friend_block_helpers`            | Superseded by `018` (see correction 5 below) — kept as-is, not edited, matching how `011` corrects `010` rather than rewriting it                                                                                                                                                     |
| `20260926220015_fix_enforce_owned_piece_passage`       | `notes` insert crash fix — see below                                                                                                                                                                                                                                                  |
| `20260926220016_grant_studio_membership_helpers`       | `is_studio_member`/`is_studio_owner` grants — see below                                                                                                                                                                                                                               |
| `20260926220017_fix_delete_my_account_storage`         | `delete_my_account()` storage fix + new client contract — see below                                                                                                                                                                                                                   |
| `20260926220018_revert_unneeded_friend_block_grants`   | Reverts part of `014`, fixes a `search_path` finding — see below                                                                                                                                                                                                                      |
| `20260926220019_fix_note_target_privacy`               | `_can_view_social_target`'s `note` branch now honors `privacy_notes` (`friend_notes()` already did) - closes a gap where a friend could still reply to/react to/comment on/see media for a note whose owner had set `privacy_notes = 'onlyMe'`                                        |
| `20260926220020_milestone_events_add_piece_passage`    | Adds `piece_id`/`passage_id` to `milestone_events` - the original table was two Core-side columns short (`MilestoneEvent.pieceID`/`passageID`), caught before this pass's client wiring of that table ever depended on it                                                             |
| `20260926220021_presence_realtime_authorization`       | Server-enforced "practicing now" boundary: `realtime.messages` RLS (Supabase Realtime Authorization) restricted to the topic's own owner or an eligible friend (`can_receive_presence`/`_presence_topic_owner`), plus `friend_presence_piece_title()` - see "Presence", revised below |
| `20260926220022_advisor_fixes_presence_and_milestones` | `supabase db advisors` run after `020`/`021`: `auth_rls_initplan` on `presence_topic_insert_own` (wrap `auth.uid()` in `select`), `unindexed_foreign_keys` on the two new `milestone_events` columns                                                                                  |

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

## Corrections found while writing the tests (after `20260926220012`)

The WIP this track continued also included migrations 1–12 and both docs, already reviewed once (see
above) — but untested against the hosted project beyond `db advisors`. Writing `supabase/tests/`
(below) exercised every RPC as an actual impersonated caller for the first time, and found five more
real bugs, none of them reachable by `db advisors` (they're runtime/permission failures, not lint
findings) — each is its own migration (`20260926220013`–`20260926220018`):

1. **`respond_friend_request` could never accept or decline anything.** `set status = case when
p_accept then 'accepted' else 'declined' end` fails with "column is of type friendship_status but
   expression is of type text" — a bare `CASE` over two string literals resolves to `text`, which
   (unlike a single literal) doesn't implicitly cast to an enum column on assignment. Fixed with an
   explicit `::public.friendship_status` cast. The one call site with this exact pattern; checked.
2. **Every `notes` insert crashed**, with `record "new" has no field "passage_id"`.
   `_enforce_owned_piece_passage()` (shared by `activity_events_ownership` and `notes_ownership`)
   unconditionally read `new.passage_id`, a column `activity_events` has and `notes` never did. Fixed
   to read it via `to_jsonb(new) ->> 'passage_id'` instead, the same way `enforce_no_blocked_words()`
   already handles running across differently-shaped tables (`(select ... )::uuid` is `null`, not an
   error, when the column doesn't exist).
3. **`is_studio_member`/`is_studio_owner` were never granted to `authenticated`**, so every query
   against `studios`/`studio_members`/`studio_goals` failed outright — both are read from inside a
   plain RLS policy `USING` clause, which runs as the querying role, not as `postgres`. Granted.
4. **`delete_my_account()` could never succeed.** `delete from storage.objects ...` always failed:
   `protect_delete()`, a platform-level trigger, blocks _every_ direct `DELETE` against
   `storage.objects`, even from a `SECURITY DEFINER` function — "Use the Storage API instead," with no
   SQL-level workaround. New contract: **the client deletes its own objects in all four buckets via
   the Storage API before calling `delete_my_account()`** (the `*_delete_own` policies from
   `20260926220008` already make that possible today); the function now checks first and raises a
   named, actionable error if anything remains, instead of either crashing or silently orphaning
   files. iOS client track: sequence account deletion as storage-delete-per-bucket, then this RPC.
5. **A false start, corrected within the same pass**: `is_friend`/`is_blocked` looked like they had
   the same missing-grant problem as (3) above (this project's own early test called them directly and
   got "permission denied"), so `20260926220014` granted them too. Checking every real call site
   (`grep` across every migration, not assumed) showed that was wrong — both are only ever called from
   _inside_ another `SECURITY DEFINER` function, which always runs as that function's owner regardless
   of the caller's own grants, exactly the reasoning `20260926220011` already used for
   `_profile_stats`/`_profile_field_visible`/`_week_start` (and correctly didn't extend to
   `is_friend`/`is_blocked` when it revoked them). `20260926220018` reverted the grant; the test was
   fixed to check friendship state through the `friendships` table instead (already self-scoped and
   selectable), which is what a real client would do anyway. `supabase/tests/01` now has a check
   (01.16/01.17) encoding this exact contract — which helpers must be `authenticated`-executable
   (read from a plain policy/trigger: `is_studio_member`, `is_studio_owner`, `can_view_activity_event`,
   `_can_view_social_target`) and which must not (called only from inside another definer function:
   `is_friend`, `is_blocked`, `_profile_stats`, `_profile_field_visible`) — so this class of mistake,
   in either direction, fails a test instead of needing to be rediscovered.

`20260926220018` also fixed a `function_search_path_mutable` finding `db advisors` raised against
`20260926220015`'s replacement `_enforce_owned_piece_passage()`: it carried forward the original's
missing `set search_path`, the one function in this schema that still lacked it.

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
`set_presence()`. The live blinking-dot behavior runs over **Supabase Realtime Presence** on a
per-user channel (`presence:<owner_id>`, tracking `{isPracticing, pieceID}` — `PresenceService.swift`)
— that's what makes it feel instant, and it needs no schema of its own beyond `realtime.messages`'
own authorization policies (below). `friend_presence()` reads the table for whoever isn't currently on
the Realtime channel (they backgrounded the app, their socket dropped, etc.), and already treats a
stale `is_practicing = true` older than two minutes as false, so a force-quit without a final
`set_presence(false)` doesn't show someone as "practicing" forever.

**Revised in `20260926220021`: the Realtime side is now server-enforced, not client-side-only.**
The iOS client marks both its own and every friend's presence channel `isPrivate = true` (Supabase
Realtime Authorization), which routes every subscribe/track attempt through two new
`realtime.messages` RLS policies: `presence_topic_select_own_or_friend` (receive) calls
`can_receive_presence(owner_id)` — the same self-or-accepted-non-blocked-friend-with-visible-
`privacy_presence` predicate `friend_presence()` already used, factored into a shared, `authenticated`-
executable `SECURITY DEFINER` function per this file's own "Design" section — and
`presence_topic_insert_own` (track/publish) restricts to the topic's own owner, so nothing can
announce fake presence on someone else's topic either. `_presence_topic_owner()` parses the app's one
topic convention (`presence:<uuid>`) out of `realtime.topic()`. Before this, any authenticated socket
could subscribe to any `presence:<uuid>` topic it could guess or learn — documented as a known,
deliberate gap by `PresenceService.swift`'s own doc comment at the time; closed here, not merely
re-documented.

**Piece-title exposure is a further, separate gate.** `friend_presence()`/the live channel payload
both expose only a raw `piece_id` (harmless on its own — `pieces`' RLS is owner-only, so a friend
can't look it up directly). `friend_presence_piece_title(p_owner_id, p_piece_id)` is the
privacy-checked way to resolve it to a title: it requires `can_receive_presence(p_owner_id)` **and**
`privacy_currently_working_on` (the same field that already gates `currently_working_on_piece_ids` in
`get_profile_card()`) to both allow it, and verifies `p_piece_id` actually belongs to `p_owner_id`
before returning anything — a mismatched id returns `null`, never another piece's real title. Returns
`null` rather than raising, on any denial, so client code can always fall back to a generic
"Practicing" label instead of treating a privacy denial as an error.

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
and confirming all of them, not asserted from memory. `delete_my_account()` therefore only ever has to
issue one statement itself, `delete from auth.users where id = auth.uid()`; GoTrue's own internal
tables (identities, sessions, refresh tokens, MFA factors, …) already cascade from `auth.users` the
same way the platform's own admin "delete user" does, and so does every table in this schema.

**Storage is the one exception, and it is the client's job, not this function's** (revised in
`20260926220017` — see correction 4 above for why the original direct-delete design couldn't work:
`storage.objects` has no FK to `auth.users`, and the platform blocks a direct SQL `DELETE` against it
outright, full stop, from any role). **iOS client track: before calling `delete_my_account()`, delete
the caller's own objects in all four buckets via the Storage API** (`avatars/{uid}/…`,
`scores/{uid}/…`, `recordings/{uid}/…`, `note-media/{uid}/…` — the `*_delete_own` policies from
`20260926220008` already allow this today). `delete_my_account()` checks first and raises a clear,
named error (`errcode 55000`) if anything remains under the caller's prefix in any bucket, rather than
either crashing (the old behavior) or silently leaving orphaned files.

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

Run after `20260926220018`: 56 findings, all expected/by design (see the git history of this doc for
that exact breakdown). **Re-run after `20260926220022`** (this pass's own migrations: `019`–`022`,
closing the two real findings they introduced along the way — `auth_rls_initplan` on
`presence_topic_insert_own`, `unindexed_foreign_keys` on `milestone_events`' two new columns, both
fixed in `022` itself, not just documented): 60 findings remain, all expected/by design —

- `unused_index` (18, INFO): every index in this schema is new, on tables with next to no query
  traffic yet (a handful of rolled-back test rows) — 16 from before this pass, plus the two new
  `milestone_events` FK indexes `022` added. Nothing to remove; re-check once real traffic exists.
- `rls_enabled_no_policy` (3, INFO): the intentional `sync_tables`/`append_only_tables`/
  `blocked_words` lockdown (RLS on, zero policies, so only a migration running as `postgres` can touch
  them — see correction 1 above for why that matters). `realtime.messages` is not in this list: it now
  has two real policies (`021`), which is the point.
- `authenticated_security_definer_function_executable` (37, WARN): this schema's entire public RPC
  surface. Each one is `SECURITY DEFINER` specifically so it can do a controlled cross-user
  read/write RLS alone can't express (see "Design" below); being `authenticated`-executable is the
  point, not an oversight, and every one either self-scopes via `auth.uid()` internally or validates
  its explicit target parameter (friendship/block/ownership) before returning or mutating anything.
  35 from before this pass, plus `can_receive_presence`/`friend_presence_piece_title` (`021`) — both
  the same "only ever answers about the caller's own visibility of one target" shape as
  `can_view_activity_event`, not a cross-user leak.
- `auth_db_connections_absolute` (1, INFO): a generic platform suggestion (percentage- vs
  absolute-based Auth server connection allocation) unrelated to this schema; left as a project-level
  ops decision, out of scope for this track.
- `auth_leaked_password_protection` (1, WARN): still not reachable with this project's CLI version
  (unchanged from the note above) — needs the Dashboard or a Management API endpoint `supabase config`
  doesn't wrap.

Re-run this after any future migration that adds a table, policy or function.

## Tests

`supabase/tests/` proves spec §5c's isolation requirement — "user A cannot read/write user B's
private data through any table/view/RPC/storage" — against the **hosted** project (no local Postgres,
no DB password): `set local role authenticated` + `request.jwt.claims` impersonation inside a
transaction, using two throwaway users created through the real public signup endpoint (not inserted
into `auth.users` directly — that would skip `handle_new_auth_user` and risk testing against a user
shape the app never actually produces). See `supabase/tests/run.sh`'s own header for exact setup
steps (creating the throwaway users, the `email_sent` rate limit gotcha) and usage.

| File                                         | Proves                                                                                                                                                                                                                                                                                                                                                         | Destructive?      |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `01_rls_policy_coverage.sql`                 | Every owner-scoped table has exactly the right three policies and no delete policy; storage buckets aren't public; the authenticated-grant contract for every internal helper (see correction 5)                                                                                                                                                               | No (read-only)    |
| `02_owner_isolation_and_sync_rpc.sql`        | Direct SELECT/UPDATE/DELETE and `sync_upsert`'s ownership guard all actually hold at runtime (`tags`, `pieces`, `ink_strokes`)                                                                                                                                                                                                                                 | No (rolled back)  |
| `03_social_privacy_blocks_notes_storage.sql` | Profile privacy tiers + the private-account clamp, friend requests, blocks, avatar visibility, leaderboard opt-out, notes' 24h expiry, private replies, all four storage buckets' policies, reports, studio membership                                                                                                                                         | No (rolled back)  |
| `04_account_deletion.sql`                    | `delete_my_account()` refuses to run with leftover storage (rolled back), then really deletes an account end-to-end and touches nothing belonging to anyone else                                                                                                                                                                                               | **Yes** — commits |
| `05_presence_and_note_privacy.sql`           | `20260926220019`/`20260926220021`: `privacy_notes` honored by note replies (and, via the same shared function, reactions/comments/note-media); `can_receive_presence`/`_presence_topic_owner`/`friend_presence_piece_title` — self, friend, tightened-privacy, blocked, stranger, and real-ownership-checked cases; the two `realtime.messages` policies' text | No (rolled back)  |

Re-run the whole suite after any migration that touches RLS, a grant, or one of these RPCs.
