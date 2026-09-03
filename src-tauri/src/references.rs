//! Explicit reference-recording handoff.
//!
//! Praelude does not scrape, download, autoplay, or accept arbitrary URLs.
//! The only operation is opening a fixed Spotify or YouTube search URL whose
//! query is derived from one canonical piece and percent-encoded byte by byte.

use serde::{Deserialize, Serialize};

use crate::platform;
use crate::store::Store;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReferenceProvider {
    Spotify,
    Youtube,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ReferenceOpenResult {
    pub provider: ReferenceProvider,
    pub url: String,
    pub opened: bool,
}

pub fn open_reference(
    store: &Store,
    piece_id: i64,
    provider: ReferenceProvider,
) -> Result<ReferenceOpenResult, String> {
    let piece = store
        .get_piece(piece_id)
        .map_err(|_| "Could not read that piece.".to_string())?
        .ok_or_else(|| "Pick an existing piece before opening a reference search.".to_string())?;
    let query = reference_query(&piece.title, piece.composer.as_deref());
    let url = search_url(provider, &query);
    open_fixed_url(&url)?;
    Ok(ReferenceOpenResult {
        provider,
        url,
        opened: true,
    })
}

fn reference_query(title: &str, composer: Option<&str>) -> String {
    let composer = composer.unwrap_or_default().trim();
    if composer.is_empty() {
        format!("{} piano recording", title.trim())
    } else {
        format!("{} {} piano recording", composer, title.trim())
    }
}

fn search_url(provider: ReferenceProvider, query: &str) -> String {
    let encoded = percent_encode(query);
    match provider {
        ReferenceProvider::Spotify => format!("https://open.spotify.com/search/{encoded}"),
        ReferenceProvider::Youtube => {
            format!("https://www.youtube.com/results?search_query={encoded}")
        }
    }
}

fn percent_encode(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn open_fixed_url(url: &str) -> Result<(), String> {
    if !(url.starts_with("https://open.spotify.com/search/")
        || url.starts_with("https://www.youtube.com/results?search_query="))
    {
        return Err("Reference URL was not on the fixed allowlist.".into());
    }
    platform::open_https(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_origins_and_utf8_query_are_encoded_without_shell_text() {
        let query = reference_query("Étude Op. 10 #4 & coda", Some("Chopin / Frédéric"));
        let encoded = percent_encode(&query);
        assert!(encoded.contains("%C3%89") || encoded.contains("%C3%A9"));
        assert!(encoded.contains("%26"));
        assert!(encoded.contains("%2F"));
        assert!(!encoded.contains(' '));
        assert_eq!(
            search_url(ReferenceProvider::Spotify, "A&B"),
            "https://open.spotify.com/search/A%26B"
        );
        assert_eq!(
            search_url(ReferenceProvider::Youtube, "A&B"),
            "https://www.youtube.com/results?search_query=A%26B"
        );
    }

    #[test]
    fn empty_composer_does_not_create_a_blank_prefix() {
        assert_eq!(reference_query("Scherzo", None), "Scherzo piano recording");
        assert_eq!(
            reference_query("Scherzo", Some("  ")),
            "Scherzo piano recording"
        );
    }

    #[test]
    fn percent_encoder_handles_every_byte_without_plus_or_interpolation() {
        let encoded = percent_encode("x;$(touch /tmp/no)\ny");
        assert_eq!(encoded, "x%3B%24%28touch%20%2Ftmp%2Fno%29%0Ay");
        assert!(!encoded.contains('+'));
    }
}
