# Praelude repository entry point

Read [`docs/project/AGENTS.md`](docs/project/AGENTS.md) before doing any work. It is the binding
project operating manual mirrored from the editable Obsidian vault. Then read:

- [`docs/project/(C) Praelude Command Center.md`](docs/project/%28C%29%20Praelude%20Command%20Center.md)
- [`docs/project/Praelude.md`](docs/project/Praelude.md)
- [`NOTES.md`](NOTES.md)
- [`docs/NEW_MAC_SETUP.md`](docs/NEW_MAC_SETUP.md) when this is a new checkout
- [`docs/qa/v11.1.0/README.md`](docs/qa/v11.1.0/README.md) for the latest release evidence

This private repository is the complete development handoff. On the original Mac, the editable
vault is `~/Desktop/christian's universe/Piano Practice/Praelude`; after every required vault
update, run `npm run docs:sync` and `npm run docs:check` and commit the mirror. On a Mac without
that vault, the checked-in mirror is the binding fallback. Reconcile any mirror edits back to the
vault before a future sync.

Praelude v11.1.0 / schema 21 is the current installed release boundary. Visible branding is
Praelude. Preserve `com.christian.codakiller`, `codakiller.db`, the legacy Keychain service and
durable storage keys as compatibility contracts unless a migration is explicitly designed and
verified.

Git never contains Christian's live database, score library, media, Keychain secrets, installed
app or rollback/release archives. A fresh clone is accepted for development; moving the personal
practice environment between Mac usernames/paths remains a separate unverified migration because
stored file paths may be absolute.

Standing install preference and all release/data-safety gates are in the mirrored manual. Ordinary
development commands must not be confused with `npm run release:mac`, which can replace the
installed app.
