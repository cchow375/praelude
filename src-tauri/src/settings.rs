//! Typed public settings boundary.
//!
//! The legacy generic string setting commands remain for internal hooks, but
//! the P6 UI reads and writes only this validated projection. API key values are
//! deliberately absent; only native Keychain/environment presence crosses IPC.

use serde::{Deserialize, Serialize};

use crate::keys::{api_key_status, ApiKeyProvider, ApiKeyStatus};
use crate::store::Store;

const SOUNDS: &[&str] = &["beep", "clave", "cowbell", "rim", "tick", "woodblock"];
const VOICES: &[&str] = &[
    "Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr",
];
const DEFAULT_KNOWLEDGE_DIR: &str =
    "/Users/c3/Desktop/christian's universe/Piano Practice/Knowledge and Resources";
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

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SettingsSnapshot {
    pub theme: String,
    pub interface_scale: u16,
    pub tts_provider: String,
    pub tts_voice: String,
    pub brain_provider: String,
    pub knowledge_dir: String,
    pub share_retrieved_knowledge: bool,
    pub wake_word_enabled: bool,
    pub wake_word: String,
    pub metronome_sound: String,
    pub metronome_boost: bool,
    pub metronome_boost_level: u8,
    pub ladder_default_reps: u32,
    pub practice_default_clean_streak: u32,
    pub ladder_bpm_step: u32,
    pub calendar_capacity_minutes: u32,
    pub vault_pieces_dir: String,
    pub verdict_aliases: VerdictAliases,
    pub api_keys: Vec<ApiKeyStatus>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SettingsPatch {
    pub theme: Option<String>,
    pub interface_scale: Option<u16>,
    pub tts_provider: Option<String>,
    pub tts_voice: Option<String>,
    pub brain_provider: Option<String>,
    pub knowledge_dir: Option<String>,
    pub share_retrieved_knowledge: Option<bool>,
    pub wake_word_enabled: Option<bool>,
    pub wake_word: Option<String>,
    pub metronome_sound: Option<String>,
    pub metronome_boost: Option<bool>,
    pub metronome_boost_level: Option<u8>,
    pub ladder_default_reps: Option<u32>,
    pub practice_default_clean_streak: Option<u32>,
    pub ladder_bpm_step: Option<u32>,
    pub calendar_capacity_minutes: Option<u32>,
    pub vault_pieces_dir: Option<String>,
    pub verdict_aliases: Option<VerdictAliases>,
}

pub fn snapshot(store: &Store) -> SettingsSnapshot {
    let wake_word = string(store, "voice.wake_word", "coda");
    SettingsSnapshot {
        theme: choice(store, "theme", "auto", &["auto", "dark", "light"]),
        interface_scale: integer(store, "ui.interface_scale", 90, 75, 125) as u16,
        tts_provider: choice(store, "tts.provider", "auto", &["auto", "gemini", "say"]),
        tts_voice: choice(store, "tts.voice", "Kore", VOICES),
        brain_provider: choice(
            store,
            "brain.provider",
            "auto",
            &["auto", "claude", "gemini", "offline"],
        ),
        knowledge_dir: string(store, "brain.knowledge_dir", DEFAULT_KNOWLEDGE_DIR),
        // Christian explicitly requested that the selected local-book passages
        // ground Claude/Gemini. Only the retrieved, bounded excerpts cross the
        // provider boundary; the corpus itself is never uploaded or bundled.
        share_retrieved_knowledge: boolean(store, "brain.share_retrieved_knowledge", true),
        wake_word_enabled: boolean(store, "voice.wake_word_enabled", false),
        wake_word,
        metronome_sound: choice(store, "metronome.sound", "woodblock", SOUNDS),
        metronome_boost: boolean(store, "metronome.boost", false),
        metronome_boost_level: integer(store, "metronome.boost_level", 85, 0, 100) as u8,
        ladder_default_reps: integer(store, "rep.default_reps", 30, 1, 240),
        practice_default_clean_streak: integer(store, "practice.default_clean_streak", 5, 1, 100),
        ladder_bpm_step: integer(store, "rep.bpm_step", 4, 1, 24),
        calendar_capacity_minutes: integer(store, "calendar.daily_capacity_minutes", 60, 1, 1_440),
        vault_pieces_dir: string(
            store,
            "vault.pieces_dir",
            "/Users/c3/Desktop/christian's universe/Piano Practice/Pieces",
        ),
        verdict_aliases: aliases(store),
        api_keys: vec![
            api_key_status(ApiKeyProvider::Claude),
            api_key_status(ApiKeyProvider::Gemini),
        ],
    }
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
    if let Some(value) = patch.knowledge_dir {
        let trimmed = value.trim();
        let path = std::path::Path::new(trimmed);
        if trimmed.is_empty() || trimmed.len() > 1_024 || !path.is_absolute() || !path.is_dir() {
            return Err("Knowledge folder must be an existing absolute directory.".into());
        }
        writes.push(("brain.knowledge_dir", trimmed.to_string()));
    }
    if let Some(value) = patch.share_retrieved_knowledge {
        writes.push(("brain.share_retrieved_knowledge", value.to_string()));
    }
    if let Some(value) = patch.wake_word_enabled {
        writes.push(("voice.wake_word_enabled", value.to_string()));
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
    if let Some(value) = patch.vault_pieces_dir {
        let trimmed = value.trim();
        let path = std::path::Path::new(trimmed);
        if trimmed.is_empty() || trimmed.len() > 1_024 || !path.is_absolute() || !path.is_dir() {
            return Err("Pieces folder must be an existing absolute directory.".into());
        }
        writes.push(("vault.pieces_dir", trimmed.to_string()));
    }
    if let Some(value) = patch.verdict_aliases {
        let aliases = validate_aliases(value)?;
        writes.push((
            "voice.verdict_aliases",
            serde_json::to_string(&aliases).map_err(|_| "Could not encode verdict aliases.")?,
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

    #[test]
    fn defaults_and_invalid_stored_values_are_bounded() {
        let store = Store::open(":memory:").unwrap();
        store.set_setting("theme", "neon").unwrap();
        store.set_setting("rep.default_reps", "9999").unwrap();
        let value = snapshot(&store);
        assert_eq!(value.theme, "auto");
        assert_eq!(value.interface_scale, 90);
        assert_eq!(value.knowledge_dir, DEFAULT_KNOWLEDGE_DIR);
        assert!(value.share_retrieved_knowledge);
        assert_eq!(value.ladder_default_reps, 30);
        assert_eq!(value.practice_default_clean_streak, 5);
        assert_eq!(value.ladder_bpm_step, 4);
        assert!(value
            .api_keys
            .iter()
            .all(|status| matches!(status.source, "keychain" | "environment" | "none")));
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
