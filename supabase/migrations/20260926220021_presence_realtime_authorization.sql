-- Praelude backend: server-enforced "practicing now" presence boundary (spec 5a/5c).
--
-- PresenceService.swift (iOS) subscribes to Supabase Realtime Presence on a per-user topic
-- ("presence:<userID>") and documents its own gap explicitly: "Realtime has no RLS of its own in
-- this project (no realtime.messages authorization policy exists) ... nothing server-side stops an
-- authenticated socket from subscribing to an arbitrary topic ... This is a client-side access
-- boundary, not a server-enforced one." This migration closes that: Supabase Realtime Authorization
-- (https://supabase.com/docs/guides/realtime/authorization) lets a *private* channel's join be
-- gated by RLS policies on realtime.messages, evaluated with the same auth.uid()/request.jwt.claims
-- a normal RLS policy sees. The iOS client is switched to `config.isPrivate = true` on both the
-- publishing and observing channels in the same pass (PresenceService.swift) - a policy here has no
-- effect at all on a non-private channel, so both halves must land together.
--
-- Verified against this project's live schema before writing the predicate below (not assumed):
--   - realtime.messages columns: topic text, extension text, private boolean, payload jsonb, ... -
--     confirmed via information_schema.columns.
--   - realtime.topic() is `language sql stable` (not security definer), body
--     `select nullif(current_setting('realtime.topic', true), '')::text` - confirmed via pg_proc.
--   - realtime.messages already has row level security enabled with zero policies (confirmed via
--     pg_class.relrowsecurity + pg_policy) - the platform ships it RLS-on/default-deny, exactly the
--     "sync_tables/append_only_tables" pattern this schema already uses elsewhere for "only a named,
--     reviewed policy may touch this".
-- Not independently re-verified here (accepted from Supabase's own published authorization guide,
-- which ios/DerivedData/SourcePackages's checked-out supabase-swift SDK links from
-- RealtimeChannelConfig.isPrivate's own doc comment): that Realtime authorizes a subscribe/track
-- attempt by running a query against realtime.messages *inside a transaction it rolls back*, so no
-- row ever needs to actually exist there for a policy to authorize or deny a request; this is
-- consistent with realtime.messages being genuinely near-empty in this project (nothing writes
-- application data through it) while still being the correct place for these policies.
--
-- Piece-title exposure: friend_presence() (20260926220006_social.sql) already gates *that a friend
-- is practicing* behind privacy_presence + friendship + blocks, and returns the raw piece_id (safe on
-- its own - pieces' own RLS is owner-only, so a friend cannot look it up directly). The spec also
-- wants "expose the piece title to friends only when the owner's pieces privacy allows" - a further,
-- separate gate: privacy_currently_working_on is the column that already governs exposing which
-- pieces someone is working on (get_profile_card's currently_working_on_piece_ids branch), so a
-- friend must clear *both* privacy_presence (can they know this person is practicing at all) *and*
-- privacy_currently_working_on (can they know which piece) before a title is ever returned.
-- friend_presence_piece_title() below is deliberately a separate on-demand call, not a
-- friend_presence() response field: the client learns {owner_id, piece_id} either from that table
-- fallback or live from the Realtime presence payload itself (no round trip either way), and only
-- resolves it to a title, privacy-gated, when it actually needs to render one.

-- ---------------------------------------------------------------------------
-- Shared predicate: can the caller receive presence.<owner>'s "practicing now" state at all? Exactly
-- friend_presence()'s own per-row filter, factored out so both the new realtime.messages policies and
-- friend_presence_piece_title() below share one definition rather than drifting apart. SECURITY
-- DEFINER so it is safe to call from a *plain* RLS policy qual (realtime.messages' policies run as
-- the querying role, "authenticated" - the same reason can_view_activity_event/
-- _can_view_social_target are their own authenticated-executable SECURITY DEFINER functions rather
-- than inlining is_friend/is_blocked, which are not independently executable - see
-- supabase/(C) Backend.md correction 5). Like can_view_activity_event, this only ever answers about
-- the caller's own visibility of one target, never an arbitrary pair, so it is not a cross-user leak.
-- ---------------------------------------------------------------------------

create or replace function public.can_receive_presence(p_owner_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select p_owner_id is not null and (
    p_owner_id = auth.uid()
    or (
      public.is_friend(auth.uid(), p_owner_id)
      and not public.is_blocked(auth.uid(), p_owner_id)
      and exists (
        select 1 from public.profiles p
        where p.id = p_owner_id and public._profile_field_visible(p.privacy_presence, p.is_private_account, true)
      )
    )
  );
$$;

revoke all on function public.can_receive_presence(uuid) from public;
grant execute on function public.can_receive_presence(uuid) to authenticated;

-- Parses the owner id out of this app's one presence topic convention ("presence:<uuid>" -
-- PresenceService.swift's `client.channel("presence:\(id.uuidString)")`). Returns null for anything
-- else, which every policy below then trivially denies (can_receive_presence(null) is false;
-- the insert policy's `= auth.uid()` is also false against null).
create or replace function public._presence_topic_owner()
returns uuid
language sql stable set search_path = public, pg_temp
as $$
  select case
    when realtime.topic() like 'presence:%' then nullif(split_part(realtime.topic(), ':', 2), '')::uuid
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- realtime.messages policies (private channels only - see this file's header). Scoped to
-- extension = 'presence' so these never interact with any future broadcast-type private channel
-- this app might add later; this app's presence channels never use broadcast.
-- ---------------------------------------------------------------------------

create policy "presence_topic_select_own_or_friend" on "realtime"."messages"
  for select to authenticated
  using (extension = 'presence' and public.can_receive_presence(public._presence_topic_owner()));

-- Only the topic's own owner may publish (track) presence onto it - prevents any authenticated user
-- from announcing fake presence state on someone else's topic, which set_presence()'s own
-- p_piece_id-ownership check already guards for the table fallback but the Realtime side had no
-- equivalent for at all before this policy.
create policy "presence_topic_insert_own" on "realtime"."messages"
  for insert to authenticated
  with check (extension = 'presence' and public._presence_topic_owner() = auth.uid());

-- ---------------------------------------------------------------------------
-- Piece title, privacy-gated on top of presence visibility - see this file's header.
-- ---------------------------------------------------------------------------

create or replace function public.friend_presence_piece_title(p_owner_id uuid, p_piece_id uuid)
returns text
language sql stable security definer set search_path = public, pg_temp
as $$
  select pc.title
  from public.pieces pc
  join public.profiles pr on pr.id = p_owner_id
  where pc.id = p_piece_id
    and pc.owner_id = p_owner_id
    and public.can_receive_presence(p_owner_id)
    and public._profile_field_visible(pr.privacy_currently_working_on, pr.is_private_account, public.is_friend(auth.uid(), p_owner_id));
$$;

revoke all on function public.friend_presence_piece_title(uuid, uuid) from public;
grant execute on function public.friend_presence_piece_title(uuid, uuid) to authenticated;

comment on function public.friend_presence_piece_title(uuid, uuid) is
  'Resolves a piece_id learned from friend_presence()/the live Realtime presence payload into a '
  'title, only when the caller may see BOTH that this owner is practicing (privacy_presence, '
  'friendship, blocks - can_receive_presence) AND which pieces they work on '
  '(privacy_currently_working_on). Returns null (never an error) when either gate fails, so client '
  'code can render a generic "practicing" state instead of a title with no special-casing.';
