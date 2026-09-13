# Git-backed project manual

This directory is a curated mirror of the living Praelude documents from the original Obsidian
vault. It makes the private Git repository sufficient to resume development on another Mac.

Included:

- the binding project `AGENTS.md`;
- the portable project summary and Command Center;
- Roadmap, Flaws, Changelog, installed-app tutorial and Motivation; and
- every Markdown version record.

The four bannered v2/reference documents and `PianoCoach/` Markdown are included as clearly
historical lineage because the operating manual and old Roadmap refer to the lessons they record.
They are evidence, never a current implementation or UI template.

Excluded on purpose:

- SQLite backups and all practice history;
- score PDFs, output files, photos and cover art;
- non-Markdown legacy assets and obsolete scratch notes; and
- credentials, Keychain data, app bundles and release archives.

On the original Mac, edit the vault documents first, obey their update protocol, then run:

```bash
npm run docs:sync
npm run docs:check
```

On a Mac without the vault, treat the checked-in mirror as the working project context. If living
docs are changed there, port the same edits back to the vault before the next mirror sync so they
are not overwritten.
