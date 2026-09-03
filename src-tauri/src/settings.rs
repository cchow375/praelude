//! Typed public settings boundary.
//!
//! The legacy generic string setting commands remain for internal hooks, but
//! the P6 UI reads and writes only this validated projection. API key values are
//! deliberately absent; only native Keychain/environment presence crosses IPC.

use serde::{Deserialize, Serialize};

use crate::keys::{api_key_status, ApiKeyProvider, ApiKeyStatus};
use crate::store::{Store, DEFAULT_STREAK_THRESHOLD_MINUTES};
use crate::tts::gemini::DEFAULT_VOICE;

const SOUNDS: &[&str] = &["beep", "clave", "cowbell", "rim", "tick", "woodblock"];
const VOICES: &[&str] = &[
    "Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr",
];
const RESERVED_ALIASES: &[&str] = &[
    "done",
    "clean",
    "got it",
    "nailed it",
    "perfect",
    "good",
    "yes",
    "yep",
    "sloppy",
    "rough",
    "shaky",
    "almost",
    "again",
    "nope",
    "no",
    "missed",
    "messed up",
    "failed",
    "stop",
    "start",
    "faster",
    "slower",
    "status",
    "where are we",
    "close the block",
    "end the session",
    "metronome on",
    "metronome off",
];

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
pub struct VerdictAliases {
    pub clean: Vec<String>,
    pub flawed: Vec<String>,
    pub failed: Vec<String>,
}

/// The user-facing bound for `streak.threshold_minutes`: a sane "what is a
/// reasonable daily bar" range. Deliberately NARROWER than
/// [`crate::store::STREAK_THRESHOLD_DEFENSIVE_MAX_MINUTES`], which is the read
/// model's own defensive clamp for callers that never passed through this
/// validation. The two differ for different reasons, so the relationship is
/// pinned at COMPILE time below rather than asserted at runtime (fix-wave S1).
pub const STREAK_THRESHOLD_MAX_MINUTES: u32 = 240;
pub const STT_SETTLE_DEFAULT_MS: u32 = 600;
pub const STT_SETTLE_MIN_MS: u32 = 300;
pub const STT_SETTLE_MAX_MS: u32 = 2_000;

const _: () = assert!(
    STREAK_THRESHOLD_MAX_MINUTES as i64 <= crate::store::STREAK_THRESHOLD_DEFENSIVE_MAX_MINUTES,
    "the Settings UI bound must never exceed streak_summary's defensive clamp ceiling",
);

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SettingsSnapshot {
    pub theme: String,
    pub interface_scale: u16,
    pub tts_provider: String,
    pub tts_voice: String,
    pub brain_provider: String,
    pub assistant_enabled: bool,
    pub wake_word_enabled: bool,
    pub wake_word: String,
    /// Whether command acknowledgements are spoken. Off by default: Christian
    /// asked for the narration to stop ("i dont want the voice to talk when i
    /// say again or restart sets"). Off does not mean silent — the ack chime
    /// still plays, so a command he speaks still answers back.
    pub speak_acks: bool,
    /// Quiet gap used to turn progressive hypotheses into a final transcript.
    pub stt_settle_ms: u32,
    pub metronome_sound: String,
    pub metronome_boost: bool,
    pub metronome_boost_level: u8,
    pub ladder_default_reps: u32,
    pub practice_default_clean_streak: u32,
    pub ladder_bpm_step: u32,
    pub calendar_capacity_minutes: u32,
    pub streak_threshold_minutes: u32,
    pub vault_pieces_dir: String,
    pub hotkeys_enabled: bool,
    pub hotkey_verdict_clean: String,
    pub hotkey_verdict_sloppy: String,
    pub hotkey_verdict_again: String,
    pub verdict_aliases: VerdictAliases,
    /// A1: whether the tempo ladder demotes automatically after consecutive
    /// sloppy reps. Per-set overridable via `IncrementRule.demote_enabled`.
    pub demote_enabled: bool,
    /// A1: consecutive `flawed` reps before the FIRST demotion in a set.
    pub demote_first: u32,
    /// A1: consecutive `flawed` reps before each SUBSEQUENT demotion, once
    /// `demoted_this_set` is true.
    pub demote_repeat: u32,
    pub api_keys: Vec<ApiKeyStatus>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SettingsPatch {
    pub theme: Option<String>,
    pub interface_scale: Option<u16>,
    pub tts_provider: Option<String>,
    pub tts_voice: Option<String>,
    pub brain_provider: Option<String>,
    pub assistant_enabled: Option<bool>,
    pub wake_word_enabled: Option<bool>,
    pub wake_word: Option<String>,
    pub speak_acks: Option<bool>,
    pub stt_settle_ms: Option<u32>,
    pub metronome_sound: Option<String>,
    pub metronome_boost: Option<bool>,
    pub metronome_boost_level: Option<u8>,
    pub ladder_default_reps: Option<u32>,
    pub practice_default_clean_streak: Option<u32>,
    pub ladder_bpm_step: Option<u32>,
    pub calendar_capacity_minutes: Option<u32>,
    pub streak_threshold_minutes: Option<u32>,
    pub vault_pieces_dir: Option<String>,
    pub hotkeys_enabled: Option<bool>,
    pub hotkey_verdict_clean: Option<String>,
    pub hotkey_verdict_sloppy: Option<String>,
    pub hotkey_verdict_again: Option<String>,
    pub verdict_aliases: Option<VerdictAliases>,
    pub demote_enabled: Option<bool>,
    pub demote_first: Option<u32>,
    pub demote_repeat: Option<u32>,
}

pub fn snapshot(store: &Store) -> SettingsSnapshot {
    let wake_word = string(store, "voice.wake_word", "praelude");
    SettingsSnapshot {
        theme: choice(store, "theme", "dark", &["auto", "dark", "light"]),
        interface_scale: integer(store, "ui.interface_scale", 90, 75, 125) as u16,
        tts_provider: choice(store, "tts.provider", "auto", &["auto", "gemini", "say"]),
        tts_voice: choice(store, "tts.voice", DEFAULT_VOICE, VOICES),
        brain_provider: choice(
            store,
            "brain.provider",
            "auto",
            &["auto", "claude", "gemini", "offline"],
        ),
        // Christian explicitly asked for the Assistant OFF by default (2026-08-24):
        // it's "getting in the way" and is a separate project on hold indefinitely.
        // This is a deliberate default flip, not a regression — shipping it on would
        // mean he installs the app and immediately has to go switch it off.
        assistant_enabled: boolean(store, "assistant.enabled", false),
        wake_word_enabled: boolean(store, "voice.wake_word_enabled", false),
        wake_word,
        speak_acks: speak_acks(store),
        stt_settle_ms: stt_settle_ms(store),
        metronome_sound: choice(store, "metronome.sound", "woodblock", SOUNDS),
        metronome_boost: boolean(store, "metronome.boost", false),
        metronome_boost_level: integer(store, "metronome.boost_level", 85, 0, 100) as u8,
        ladder_default_reps: integer(store, "rep.default_reps", 30, 1, 240),
        practice_default_clean_streak: integer(store, "practice.default_clean_streak", 5, 1, 100),
        ladder_bpm_step: integer(store, "rep.bpm_step", 4, 1, 24),
        calendar_capacity_minutes: integer(store, "calendar.daily_capacity_minutes", 60, 1, 1_440),
        streak_threshold_minutes: integer(
            store,
            "streak.threshold_minutes",
            DEFAULT_STREAK_THRESHOLD_MINUTES as u32,
            1,
            STREAK_THRESHOLD_MAX_MINUTES,
        ),
        vault_pieces_dir: string(store, "vault.pieces_dir", ""),
        // A6 verdict hotkeys. Christian's confirmed mapping (2026-08-25):
        // Space = clean, Right-Shift = sloppy, Return = again — "so I don't
        // have to move my hand off the piano". Stored as `KeyboardEvent.code`
        // values, never `key`: `key` is "Shift" for BOTH shift keys, so only
        // `code` can tell the right one from the left.
        hotkeys_enabled: boolean(store, "hotkeys.enabled", true),
        hotkey_verdict_clean: key_code(store, "hotkeys.verdict_clean", "Space"),
        hotkey_verdict_sloppy: key_code(store, "hotkeys.verdict_sloppy", "ShiftRight"),
        hotkey_verdict_again: key_code(store, "hotkeys.verdict_again", "Enter"),
        verdict_aliases: aliases(store),
        // A1 "the punishment": Christian's request for more consequence when
        // the ladder only ever climbed. Sloppy-only by design (Q4) — see
        // `store::practice_v2::project_tempo`.
        demote_enabled: boolean(store, "rep.demote_enabled", true),
        demote_first: integer(store, "rep.demote_first", 3, 2, 10),
        demote_repeat: integer(store, "rep.demote_repeat", 2, 1, 10),
        api_keys: vec![
            api_key_status(ApiKeyProvider::Claude),
            api_key_status(ApiKeyProvider::Gemini),
        ],
    }
}

/// The live value of `voice.speak_acks`, readable without building a whole
/// [`SettingsSnapshot`] — `snapshot` also probes the Keychain for API-key
/// status, which is far too expensive for a flag the voice loop reads at
/// startup. One function so the default cannot drift between the two callers.
pub fn speak_acks(store: &Store) -> bool {
    boolean(store, "voice.speak_acks", false)
}

pub fn stt_settle_ms(store: &Store) -> u32 {
    integer(
        store,
        "stt.settle_ms",
        STT_SETTLE_DEFAULT_MS,
        STT_SETTLE_MIN_MS,
        STT_SETTLE_MAX_MS,
    )
}

pub fn update(store: &Store, patch: SettingsPatch) -> Result<SettingsSnapshot, String> {
    let current = snapshot(store);
    let mut writes = Vec::<(&str, String)>::new();
    if let Some(value) = patch.theme {
        writes.push(("theme", validate_choice(value, &["auto", "dark", "light"])?));
    }
    if let Some(value) = patch.interface_scale {
        writes.push((
            "ui.interface_scale",
            bounded(u32::from(value), 75, 125, "Interface scale")?.to_string(),
        ));
    }
    if let Some(value) = patch.tts_provider {
        writes.push((
            "tts.provider",
            validate_choice(value, &["auto", "gemini", "say"])?,
        ));
    }
    if let Some(value) = patch.tts_voice {
        writes.push(("tts.voice", validate_choice(value, VOICES)?));
    }
    if let Some(value) = patch.brain_provider {
        writes.push((
            "brain.provider",
            validate_choice(value, &["auto", "claude", "gemini", "offline"])?,
        ));
    }
    if let Some(value) = patch.assistant_enabled {
        writes.push(("assistant.enabled", value.to_string()));
    }
    if let Some(value) = patch.wake_word_enabled {
        writes.push(("voice.wake_word_enabled", value.to_string()));
    }
    if let Some(value) = patch.speak_acks {
        writes.push(("voice.speak_acks", value.to_string()));
    }
    if let Some(value) = patch.stt_settle_ms {
        writes.push((
            "stt.settle_ms",
            bounded(
                value,
                STT_SETTLE_MIN_MS,
                STT_SETTLE_MAX_MS,
                "Voice settle delay",
            )?
            .to_string(),
        ));
    }
    if let Some(value) = patch.wake_word {
        writes.push(("voice.wake_word", validate_wake_word(&value)?));
    }
    if let Some(value) = patch.metronome_sound {
        writes.push(("metronome.sound", validate_choice(value, SOUNDS)?));
    }
    if let Some(value) = patch.metronome_boost {
        writes.push(("metronome.boost", value.to_string()));
    }
    if let Some(value) = patch.metronome_boost_level {
        writes.push((
            "metronome.boost_level",
            bounded(u32::from(value), 0, 100, "Boost level")?.to_string(),
        ));
    }
    if let Some(value) = patch.ladder_default_reps {
        writes.push((
            "rep.default_reps",
            bounded(value, 1, 240, "Default reps")?.to_string(),
        ));
    }
    if let Some(value) = patch.practice_default_clean_streak {
        writes.push((
            "practice.default_clean_streak",
            bounded(value, 1, 100, "Clean-streak target")?.to_string(),
        ));
    }
    if let Some(value) = patch.ladder_bpm_step {
        writes.push((
            "rep.bpm_step",
            bounded(value, 1, 24, "BPM step")?.to_string(),
        ));
    }
    if let Some(value) = patch.calendar_capacity_minutes {
        writes.push((
            "calendar.daily_capacity_minutes",
            bounded(value, 1, 1_440, "Calendar capacity")?.to_string(),
        ));
    }
    if let Some(value) = patch.streak_threshold_minutes {
        writes.push((
            "streak.threshold_minutes",
            bounded(value, 1, STREAK_THRESHOLD_MAX_MINUTES, "Streak threshold")?.to_string(),
        ));
    }
    if let Some(value) = patch.vault_pieces_dir {
        let trimmed = value.trim();
        let path = std::path::Path::new(trimmed);
        if trimmed.is_empty() || trimmed.len() > 1_024 || !path.is_absolute() || !path.is_dir() {
            return Err("Pieces folder must be an existing absolute directory.".into());
        }
        writes.push(("vault.pieces_dir", trimmed.to_string()));
    }
    if let Some(value) = patch.hotkeys_enabled {
        writes.push(("hotkeys.enabled", value.to_string()));
    }
    // Validated together, not one at a time: two verdicts sharing one key would
    // make a rep ambiguous, and each field on its own cannot see that.
    let clean = patch.hotkey_verdict_clean.clone();
    let sloppy = patch.hotkey_verdict_sloppy.clone();
    let again = patch.hotkey_verdict_again.clone();
    if clean.is_some() || sloppy.is_some() || again.is_some() {
        let resolved = [
            validate_key_code(clean.unwrap_or_else(|| current.hotkey_verdict_clean.clone()))?,
            validate_key_code(sloppy.unwrap_or_else(|| current.hotkey_verdict_sloppy.clone()))?,
            validate_key_code(again.unwrap_or_else(|| current.hotkey_verdict_again.clone()))?,
        ];
        if resolved[0] == resolved[1] || resolved[0] == resolved[2] || resolved[1] == resolved[2] {
            return Err("Each verdict needs its own key.".into());
        }
        for (key, value) in [
            ("hotkeys.verdict_clean", &resolved[0]),
            ("hotkeys.verdict_sloppy", &resolved[1]),
            ("hotkeys.verdict_again", &resolved[2]),
        ] {
            writes.push((key, value.clone()));
        }
    }
    if let Some(value) = patch.verdict_aliases {
        let aliases = validate_aliases(value)?;
        writes.push((
            "voice.verdict_aliases",
            serde_json::to_string(&aliases).map_err(|_| "Could not encode verdict aliases.")?,
        ));
    }
    if let Some(value) = patch.demote_enabled {
        writes.push(("rep.demote_enabled", value.to_string()));
    }
    if let Some(value) = patch.demote_first {
        writes.push((
            "rep.demote_first",
            bounded(value, 2, 10, "Demote after (first)")?.to_string(),
        ));
    }
    if let Some(value) = patch.demote_repeat {
        writes.push((
            "rep.demote_repeat",
            bounded(value, 1, 10, "Demote after (repeat)")?.to_string(),
        ));
    }
    if writes.is_empty() {
        return Ok(current);
    }
    store
        .set_settings(&writes)
        .map_err(|_| "Could not save settings.".to_string())?;
    Ok(snapshot(store))
}

fn choice(store: &Store, key: &str, fallback: &str, allowed: &[&str]) -> String {
    store
        .get_setting(key)
        .ok()
        .flatten()
        .filter(|value| allowed.contains(&value.as_str()))
        .unwrap_or_else(|| fallback.to_string())
}

fn string(store: &Store, key: &str, fallback: &str) -> String {
    store
        .get_setting(key)
        .ok()
        .flatten()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn boolean(store: &Store, key: &str, fallback: bool) -> bool {
    store
        .get_setting(key)
        .ok()
        .flatten()
        .and_then(|value| match value.as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        })
        .unwrap_or(fallback)
}

fn integer(store: &Store, key: &str, fallback: u32, min: u32, max: u32) -> u32 {
    store
        .get_setting(key)
        .ok()
        .flatten()
        .and_then(|value| value.parse().ok())
        .filter(|value| (min..=max).contains(value))
        .unwrap_or(fallback)
}

/// A stored `KeyboardEvent.code`, falling back when the row is absent or was
/// hand-edited into something no browser would ever emit.
fn key_code(store: &Store, key: &str, fallback: &str) -> String {
    store
        .get_setting(key)
        .ok()
        .flatten()
        .and_then(|value| validate_key_code(value).ok())
        .unwrap_or_else(|| fallback.to_string())
}

/// Every `KeyboardEvent.code` is ASCII alphanumeric — "Space", "ShiftRight",
/// "Enter", "KeyA", "Digit1", "F7". Nothing else may become a live binding.
fn validate_key_code(value: String) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > 24
        || !trimmed
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
    {
        return Err("A hotkey must be a key code such as Space, ShiftRight or Enter.".into());
    }
    Ok(trimmed.to_string())
}

fn validate_choice(value: String, allowed: &[&str]) -> Result<String, String> {
    allowed
        .contains(&value.as_str())
        .then_some(value)
        .ok_or_else(|| "Unsupported setting value.".to_string())
}

fn validate_wake_word(value: &str) -> Result<String, String> {
    let normalized = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    if normalized.is_empty()
        || normalized.chars().count() > 24
        || !normalized.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == ' ' || character == '-'
        })
    {
        return Err("Wake word must be 1–24 letters, numbers, spaces, or hyphens.".into());
    }
    Ok(normalized)
}

fn bounded(value: u32, min: u32, max: u32, label: &str) -> Result<u32, String> {
    (min..=max)
        .contains(&value)
        .then_some(value)
        .ok_or_else(|| format!("{label} must be from {min} to {max}."))
}

fn aliases(store: &Store) -> VerdictAliases {
    store
        .get_setting("voice.verdict_aliases")
        .ok()
        .flatten()
        .and_then(|value| serde_json::from_str(&value).ok())
        .and_then(|value| validate_aliases(value).ok())
        .unwrap_or_default()
}

fn normalize_alias(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn validate_aliases(mut value: VerdictAliases) -> Result<VerdictAliases, String> {
    let mut seen = std::collections::HashSet::<String>::new();
    for group in [&mut value.clean, &mut value.flawed, &mut value.failed] {
        if group.len() > 12 {
            return Err("Each verdict can have at most 12 custom aliases.".into());
        }
        for alias in group.iter_mut() {
            *alias = normalize_alias(alias);
            let words = alias.split_whitespace().count();
            if alias.is_empty()
                || alias.chars().count() > 40
                || !(1..=4).contains(&words)
                || !alias.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, ' ' | '-' | '\'')
                })
            {
                return Err("Aliases must be 1–4 short words using letters, numbers, apostrophes, or hyphens.".into());
            }
            if RESERVED_ALIASES.contains(&alias.as_str()) {
                return Err(format!(
                    "“{alias}” already belongs to the deterministic command grammar."
                ));
            }
            if !seen.insert(alias.clone()) {
                return Err(format!("“{alias}” is assigned to more than one verdict."));
            }
        }
        group.sort();
    }
    Ok(value)
}

pub fn custom_verdict(store: &Store, transcript: &str) -> Option<&'static str> {
    let transcript = normalize_alias(transcript);
    let value = aliases(store);
    if value.clean.contains(&transcript) {
        Some("done")
    } else if value.flawed.contains(&transcript) {
        Some("sloppy")
    } else if value.failed.contains(&transcript) {
        Some("again")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // fix-wave S1: `streak_threshold_minutes` had zero test coverage end to
    // end — the SettingsPanel.tsx submit-patch fix (added alongside the
    // Rust field itself) is correct today but was entirely unguarded:
    // deleting that one line would silently reintroduce an unsavable field
    // and every existing test, Rust and frontend, would stay green.

    #[test]
    fn streak_threshold_minutes_persists_and_reads_back() {
        let store = Store::open(":memory:").unwrap();
        assert_eq!(snapshot(&store).streak_threshold_minutes, 10, "default");
        let saved = update(
            &store,
            SettingsPatch {
                streak_threshold_minutes: Some(25),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(saved.streak_threshold_minutes, 25);
        // Re-reading from a FRESH snapshot call (not the `update` return
        // value) proves the value actually persisted to the setting table
        // rather than only echoing back the patch.
        assert_eq!(snapshot(&store).streak_threshold_minutes, 25);
    }

    #[test]
    fn streak_threshold_minutes_bounds_are_documented_and_consistent() {
        // `settings.rs` bounds the user-facing field to 1..=240 (a sane
        // "what's a reasonable daily bar" UI range); `store::streaks::
        // streak_summary` separately, defensively clamps ANY threshold it is
        // given to 1..=1_440 (a full calendar day) regardless of caller —
        // it is a read model that must stay safe even if invoked with a
        // value that never passed through this settings validation. The two
        // ranges deliberately differ for different reasons; this assertion
        // is the "document why they differ" contract fix-wave S1 asked for:
        // if the UI bound is ever widened past the defensive ceiling, this
        // test catches the drift immediately.
        // The UI-bound-vs-defensive-ceiling relationship is now enforced at
        // COMPILE time by the `const _: () = assert!(..)` beside
        // STREAK_THRESHOLD_MAX_MINUTES, so drift cannot even build. What this
        // test still owns is the runtime half: that the bound is actually
        // applied to a real update() call.
        let store = Store::open(":memory:").unwrap();
        let rejected = update(
            &store,
            SettingsPatch {
                streak_threshold_minutes: Some(241),
                ..Default::default()
            },
        );
        assert!(rejected.is_err(), "241 minutes is outside the UI bound");
    }

    #[test]
    fn verdict_hotkeys_default_to_christians_confirmed_mapping() {
        let store = Store::open(":memory:").unwrap();
        let value = snapshot(&store);
        assert!(value.hotkeys_enabled, "hotkeys ship ON (A6 default)");
        assert_eq!(value.hotkey_verdict_clean, "Space");
        assert_eq!(value.hotkey_verdict_sloppy, "ShiftRight");
        assert_eq!(value.hotkey_verdict_again, "Enter");
    }

    #[test]
    fn a_remapped_verdict_hotkey_persists_and_reads_back() {
        let store = Store::open(":memory:").unwrap();
        let saved = update(
            &store,
            SettingsPatch {
                hotkey_verdict_clean: Some("KeyZ".into()),
                hotkeys_enabled: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(saved.hotkey_verdict_clean, "KeyZ");
        assert!(!saved.hotkeys_enabled);
        // A FRESH snapshot proves it reached the setting table, and that the
        // two untouched bindings were carried through unchanged rather than
        // reset by the partial patch.
        let reread = snapshot(&store);
        assert_eq!(reread.hotkey_verdict_clean, "KeyZ");
        assert_eq!(reread.hotkey_verdict_sloppy, "ShiftRight");
        assert_eq!(reread.hotkey_verdict_again, "Enter");
        assert!(!reread.hotkeys_enabled);
    }

    #[test]
    fn two_verdicts_may_not_share_one_key() {
        let store = Store::open(":memory:").unwrap();
        // "Space" is already clean's binding, so giving it to sloppy would make
        // every press ambiguous.
        assert!(update(
            &store,
            SettingsPatch {
                hotkey_verdict_sloppy: Some("Space".into()),
                ..Default::default()
            }
        )
        .is_err());
        assert_eq!(store.get_setting("hotkeys.verdict_sloppy").unwrap(), None);
    }

    #[test]
    fn a_hotkey_that_is_not_a_key_code_is_rejected_and_never_stored() {
        let store = Store::open(":memory:").unwrap();
        for bad in ["", "   ", "Shift+Space", "⌘", "this-is-far-too-long-a-code"] {
            assert!(
                update(
                    &store,
                    SettingsPatch {
                        hotkey_verdict_again: Some(bad.into()),
                        ..Default::default()
                    }
                )
                .is_err(),
                "{bad:?} is not a KeyboardEvent.code"
            );
        }
        assert_eq!(store.get_setting("hotkeys.verdict_again").unwrap(), None);
        // A junk row already on disk falls back rather than binding nothing.
        store
            .set_setting("hotkeys.verdict_again", "Shift+Space")
            .unwrap();
        assert_eq!(snapshot(&store).hotkey_verdict_again, "Enter");
    }

    #[test]
    fn defaults_and_invalid_stored_values_are_bounded() {
        let store = Store::open(":memory:").unwrap();
        store.set_setting("theme", "neon").unwrap();
        store.set_setting("rep.default_reps", "9999").unwrap();
        let value = snapshot(&store);
        assert_eq!(value.theme, "dark");
        assert_eq!(value.interface_scale, 90);
        assert_eq!(value.ladder_default_reps, 30);
        assert_eq!(value.practice_default_clean_streak, 5);
        assert_eq!(value.ladder_bpm_step, 4);
        assert!(value.demote_enabled, "A1 demotion is on by default");
        assert!(
            !value.speak_acks,
            "spoken acks are OFF by default — Christian asked for the narration to stop"
        );
        assert_eq!(value.stt_settle_ms, STT_SETTLE_DEFAULT_MS);
        assert_eq!(value.demote_first, 3);
        assert_eq!(value.demote_repeat, 2);
        assert!(value
            .api_keys
            .iter()
            .all(|status| matches!(status.source, "keychain" | "environment" | "none")));
    }

    #[test]
    fn demotion_settings_are_bounded() {
        let store = Store::open(":memory:").unwrap();
        store.set_setting("rep.demote_first", "1").unwrap();
        store.set_setting("rep.demote_repeat", "99").unwrap();
        store
            .set_setting("rep.demote_enabled", "not a bool")
            .unwrap();
        let value = snapshot(&store);
        assert_eq!(
            value.demote_first, 3,
            "out-of-range stored value falls back"
        );
        assert_eq!(
            value.demote_repeat, 2,
            "out-of-range stored value falls back"
        );
        assert!(value.demote_enabled, "junk stored value falls back");
    }

    #[test]
    fn speak_acks_falls_back_to_muted() {
        let store = Store::open(":memory:").unwrap();
        store.set_setting("voice.speak_acks", "yes please").unwrap();
        assert!(
            !snapshot(&store).speak_acks,
            "a junk stored value must not un-mute the voice behind his back"
        );
        assert!(!speak_acks(&store));
        store.set_setting("voice.speak_acks", "true").unwrap();
        assert!(speak_acks(&store), "an explicit opt-in is honoured");
    }

    #[test]
    fn stt_settle_delay_is_bounded_persisted_and_defaults_safely() {
        let store = Store::open(":memory:").unwrap();
        assert_eq!(stt_settle_ms(&store), 600);
        store.set_setting("stt.settle_ms", "299").unwrap();
        assert_eq!(stt_settle_ms(&store), 600, "bad disk value falls back");
        let saved = update(
            &store,
            SettingsPatch {
                stt_settle_ms: Some(350),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(saved.stt_settle_ms, 350);
        assert_eq!(stt_settle_ms(&store), 350);
        for invalid in [299, 2_001] {
            assert!(update(
                &store,
                SettingsPatch {
                    stt_settle_ms: Some(invalid),
                    ..Default::default()
                }
            )
            .is_err());
        }
    }

    #[test]
    fn update_validates_then_writes_as_one_typed_projection() {
        let store = Store::open(":memory:").unwrap();
        let result = update(
            &store,
            SettingsPatch {
                theme: Some("dark".into()),
                interface_scale: Some(85),
                wake_word_enabled: Some(true),
                wake_word: Some(" Hey   Coda ".into()),
                ladder_default_reps: Some(40),
                practice_default_clean_streak: Some(7),
                ladder_bpm_step: Some(6),
                calendar_capacity_minutes: Some(90),
                speak_acks: Some(true),
                stt_settle_ms: Some(400),
                demote_enabled: Some(false),
                demote_first: Some(4),
                demote_repeat: Some(3),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(result.theme, "dark");
        assert_eq!(result.interface_scale, 85);
        assert!(result.wake_word_enabled);
        assert_eq!(result.wake_word, "hey coda");
        assert_eq!(result.ladder_default_reps, 40);
        assert_eq!(result.practice_default_clean_streak, 7);
        assert_eq!(result.ladder_bpm_step, 6);
        assert_eq!(result.calendar_capacity_minutes, 90);
        assert!(result.speak_acks, "the patch round-trips through the store");
        assert_eq!(result.stt_settle_ms, 400);
        assert!(!result.demote_enabled);
        assert_eq!(result.demote_first, 4);
        assert_eq!(result.demote_repeat, 3);
    }

    #[test]
    fn one_invalid_value_prevents_every_write() {
        let store = Store::open(":memory:").unwrap();
        assert!(update(
            &store,
            SettingsPatch {
                theme: Some("light".into()),
                ladder_bpm_step: Some(0),
                ..Default::default()
            }
        )
        .is_err());
        assert_eq!(store.get_setting("theme").unwrap(), None);
        assert!(update(
            &store,
            SettingsPatch {
                metronome_boost_level: Some(101),
                ..Default::default()
            }
        )
        .is_err());
        assert_eq!(store.get_setting("metronome.boost_level").unwrap(), None);
        assert!(update(
            &store,
            SettingsPatch {
                interface_scale: Some(50),
                ..Default::default()
            }
        )
        .is_err());
        assert_eq!(store.get_setting("ui.interface_scale").unwrap(), None);
        assert!(update(
            &store,
            SettingsPatch {
                demote_first: Some(1),
                ..Default::default()
            }
        )
        .is_err());
        assert_eq!(store.get_setting("rep.demote_first").unwrap(), None);
        assert!(update(
            &store,
            SettingsPatch {
                demote_repeat: Some(11),
                ..Default::default()
            }
        )
        .is_err());
        assert_eq!(store.get_setting("rep.demote_repeat").unwrap(), None);
    }

    #[test]
    fn aliases_are_normalized_unique_and_cannot_steal_commands() {
        let store = Store::open(":memory:").unwrap();
        let aliases = VerdictAliases {
            clean: vec!["  solid   landing ".into()],
            flawed: vec!["needs polish".into()],
            failed: vec!["reset jump".into()],
        };
        let saved = update(
            &store,
            SettingsPatch {
                verdict_aliases: Some(aliases),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(saved.verdict_aliases.clean, vec!["solid landing"]);
        assert_eq!(custom_verdict(&store, "SOLID   LANDING"), Some("done"));
        assert!(update(
            &store,
            SettingsPatch {
                verdict_aliases: Some(VerdictAliases {
                    clean: vec!["stop".into()],
                    ..Default::default()
                }),
                ..Default::default()
            }
        )
        .is_err());
        assert!(update(
            &store,
            SettingsPatch {
                verdict_aliases: Some(VerdictAliases {
                    clean: vec!["my cue".into()],
                    flawed: vec!["MY CUE".into()],
                    failed: vec![]
                }),
                ..Default::default()
            }
        )
        .is_err());
    }
}
