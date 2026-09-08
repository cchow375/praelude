# Praelude v10.0.5 — practice bar

Status: source verification in progress; installed app remains v10.0.4.

Requested: shrink passage identity, show Start set / Goal (practice focus) / Metronome / starting and target tempo / Variants / Settings, and eliminate overlap in ordinary windows. No schema change.

The existing set state and Rust submission contract remain authoritative. Total plays keeps its fixed-tempo semantics; non-tempo goals can opt into a metronome. Passage tools remains reachable in the identity. Responsive width is measured from the Score workspace; no CSS containment changes fixed-dialog positioning.

Focused frontend: 116 tests passed. TypeScript and production build passed before final release gating. Fresh-context review caught active-notice grid placement and fixed-dialog containment risks; both corrected before release.

Next steps: complete rendered responsive/interaction verification, full release gates, backup and rollback, install, exact data audit and native launch/UI verification.
