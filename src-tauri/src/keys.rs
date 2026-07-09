//! Secret resolution. Currently just the Gemini API key.
//!
//! The key is resolved from the macOS Keychain first, then a `GEMINI_API_KEY`
//! environment-variable fallback (handy for dev / CI). **The key value is never
//! logged** — only its presence/absence is ever reported.

use std::process::Command;

/// Keychain generic-password service + account the key is stored under
/// (`security add-generic-password -s codakiller -a gemini -w <key>`).
const KEYCHAIN_SERVICE: &str = "codakiller";
const KEYCHAIN_ACCOUNT: &str = "gemini";
const ENV_VAR: &str = "GEMINI_API_KEY";

/// Return the Gemini API key, or `None` if neither source has one.
///
/// Order: (1) macOS Keychain via `security find-generic-password -s codakiller
/// -a gemini -w`; (2) the `GEMINI_API_KEY` env var. A blank value from either
/// source is treated as absent.
pub fn gemini_key() -> Option<String> {
    if let Some(k) = keychain_key() {
        return Some(k);
    }
    env_key()
}

/// Read the key from the login Keychain. Returns `None` if the item is missing,
/// `security` is unavailable, or the value is blank. Never logs the value.
fn keychain_key() -> Option<String> {
    let output = Command::new("security")
        .args([
            "find-generic-password",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            KEYCHAIN_ACCOUNT,
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
}
