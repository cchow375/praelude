# v11 — Studio and practice-first glass

Requested by Christian overnight 2026-09-07, with handwritten motivation brief. This is a local-first major release; no approval reply is expected. Preserve all practice data and ship/install only after normal fresh-context, release and data gates.

## Product contract

- Studio replaces the visible Universe. A quiet, scalable architectural room starts with a digital piano and cardboard seat; earned coins buy pianos, seating, shelves, decoration, rooms and accent palettes. Owned items can be equipped freely and survive restart.
- Rank progression represents recorded commitment, never an acoustic assessment. Ten musical rank names, ten divisions per rank. Each division costs 100 XP in rank 1, 150 in rank 2, increasing 50 per rank. Continued Encore ranks after the initial ten preserve progression.
- Ten completed focused minutes = 1 XP. Completed-set milestones in one session reach cumulative bonuses of 1/2/4/6 XP at 3/5/7/10 sets. This interprets the sketch as milestones, not additive repeated claims. Pauses, UI clicks and unfinished sets do not grant milestone rewards. Corrections reconcile evidence; no duplicate grant on refresh/relaunch. Existing retained practice counts under the new formula.
- Each division awards 25 coins. No real money or randomized rewards. Catalog prices and rank locks are explicit, purchases confirmed with price before mutation. Durable wallet, inventory and revision-protected transactions share SQLite; no schema/history rewrite.
- The library is a primary Pieces workspace: cover grid, chosen local artwork, search and sort, folders, rest/restore and existing safe PDF intake/removal. Historical evidence survives resting a piece.
- Today makes returning to practice obvious. Translucent glass belongs on shell and controls; score/music and content stay legible. Large targets, keyboard focus, light/dark/system, reduced motion/transparency and compact layouts remain first-class.
- Local display name is supported. No fake email login, sync, friend presence or leaderboard without a configured service. Accounts/friends remain clearly unbuilt; no credentials are collected.
- Assistant remains off. No music/audio grading. Existing variant and routine contracts are retained.

## Implementation boundaries

Native typed Studio state / evidence projection / atomic catalog operations; separate SVG room, rank path, furnishing shop, practice record and UI modules. CSS variables and inline vector geometry keep artwork crisp and offline without a rendering engine dependency. Avoid expensive continuous animation on an 8 GB M2 machine.

## Reference direction

- Apple Materials / Liquid Glass: https://developer.apple.com/design/human-interface-guidelines/materials and https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass
- Liftoff developer listing: https://apps.apple.com/us/app/liftoff-ranked-gym-workouts/id6448081563 — rank progression, earned shop cosmetics and legible progression. Praelude does not copy proprietary art or gym-performance scores.

## Acceptance / next steps

Adversarial native economy/persistence/correction tests; cover storage validation; full frontend/native/lint/build gates; hands-on browser journeys at desktop and 720×520; fresh-context review of each nontrivial area; native installed UI when permissions permit; exact practice graph preservation, backup and rollback; update living docs, commit and tag. Native microphone/Steinway and Windows acceptance remain separate from this release.
