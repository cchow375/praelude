//! Secret resolution. Currently just the Gemini API key.
//!
//! The key is resolved from the macOS Keychain first, then a `GEMINI_API_KEY`
//! environment-variable fallback (handy for dev / CI). **The key value is never
//! logged** — only its presence/absence is ever reported.

use std::io::Write;
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};

/// Keychain generic-password service + account the key is stored under
/// (`security add-generic-password -s codakiller -a gemini -w <key>`).
const KEYCHAIN_SERVICE: &str = "codakiller";
const KEYCHAIN_ACCOUNT: &str = "gemini";
const ENV_VAR: &str = "GEMINI_API_KEY";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ApiKeyProvider {
    Claude,
    Gemini,
}

impl ApiKeyProvider {
    fn account(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Gemini => "gemini",
        }
    }

    fn env_name(self) -> &'static str {
        match self {
            Self::Claude => "ANTHROPIC_API_KEY",
            Self::Gemini => "GEMINI_API_KEY",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ApiKeyStatus {
    pub provider: ApiKeyProvider,
    pub configured: bool,
    pub source: &'static str,
}

/// Return the Gemini API key, or `None` if neither source has one.
///
/// Order: (1) macOS Keychain via `security find-generic-password -s codakiller
/// -a gemini -w`; (2) the `GEMINI_API_KEY` env var. A blank value from either
/// source is treated as absent.
pub fn gemini_key() -> Option<String> {
    if let Some(k) = keychain_key(KEYCHAIN_ACCOUNT) {
        return Some(k);
    }
    env_key()
}

/// Read the key from the login Keychain. Returns `None` if the item is missing,
/// `security` is unavailable, or the value is blank. Never logs the value.
fn keychain_key(account: &str) -> Option<String> {
    let output = Command::new("security")
        .args([
            "find-generic-password",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            account,
            "-w",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None; // item not found (exit 44) or other error
    }
    let key = String::from_utf8_lossy(&output.stdout).trim().to_string();
    non_empty(key)
}

pub fn api_key_status(provider: ApiKeyProvider) -> ApiKeyStatus {
    let keychain = keychain_has_key(provider.account());
    let environment = std::env::var(provider.env_name())
        .ok()
        .is_some_and(|value| !value.trim().is_empty());
    ApiKeyStatus {
        provider,
        configured: keychain || environment,
        source: if keychain {
            "keychain"
        } else if environment {
            "environment"
        } else {
            "none"
        },
    }
}

/// Check Keychain presence without asking `security` to return the secret.
fn keychain_has_key(account: &str) -> bool {
    Command::new("/usr/bin/security")
        .args([
            "find-generic-password",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            account,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

/// Store a key without putting its value in process arguments. Passing `-w` as
/// the final `security` argument makes the tool read the password from stdin.
pub fn save_api_key(provider: ApiKeyProvider, raw_key: &str) -> Result<ApiKeyStatus, String> {
    let key = raw_key.trim();
    if !(8..=512).contains(&key.len()) || key.chars().any(char::is_control) {
        return Err("API key must be 8–512 printable characters.".into());
    }
    let mut child = Command::new("/usr/bin/security")
        .args([
            "add-generic-password",
            "-U",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            provider.account(),
            "-w",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Could not open macOS Keychain.".to_string())?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not write to macOS Keychain.".to_string())?;
    stdin
        .write_all(key.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .map_err(|_| "Could not write to macOS Keychain.".to_string())?;
    drop(stdin);
    let status = child
        .wait()
        .map_err(|_| "Could not confirm the macOS Keychain write.".to_string())?;
    if !status.success() {
        return Err("macOS Keychain rejected the API key write.".into());
    }
    Ok(api_key_status(provider))
}

pub fn clear_api_key(provider: ApiKeyProvider) -> Result<ApiKeyStatus, String> {
    let status = Command::new("/usr/bin/security")
        .args([
            "delete-generic-password",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            provider.account(),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| "Could not open macOS Keychain.".to_string())?;
    // Exit 44 means no matching item, which already satisfies Clear.
    if !status.success() && status.code() != Some(44) {
        return Err("macOS Keychain rejected the API key removal.".into());
    }
    Ok(api_key_status(provider))
}

/// Read the key from the environment. Blank => absent.
fn env_key() -> Option<String> {
    std::env::var(ENV_VAR).ok().and_then(non_empty)
}

fn non_empty(s: String) -> Option<String> {
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_empty_filters_blanks() {
        assert_eq!(non_empty(String::new()), None);
        assert_eq!(non_empty("abc".into()), Some("abc".into()));
    }

    // Documents the resolution order without asserting a concrete value (the
    // Keychain item is machine-specific). Just proves the call does not panic and
    // returns an Option.
    #[test]
    fn gemini_key_returns_without_panicking() {
        let _ = gemini_key();
    }

    #[test]
    fn provider_metadata_never_contains_a_secret() {
        assert_eq!(ApiKeyProvider::Claude.account(), "claude");
        assert_eq!(ApiKeyProvider::Claude.env_name(), "ANTHROPIC_API_KEY");
        assert_eq!(ApiKeyProvider::Gemini.account(), "gemini");
        assert_eq!(ApiKeyProvider::Gemini.env_name(), "GEMINI_API_KEY");
    }

    #[test]
    fn status_is_presence_only() {
        let status = api_key_status(ApiKeyProvider::Gemini);
        assert!(matches!(status.source, "keychain" | "environment" | "none"));
    }
}
