//! Bounded user artwork, kept in the local DB so moving an original image is harmless.
use std::{collections::HashMap, io::Cursor, sync::Arc};

use base64::{engine::general_purpose::STANDARD, Engine};
use tauri::State;

use crate::store::Store;

const PREFIX: &str = "data:image/jpeg;base64,";
const MAX_DATA_LENGTH: usize = 245_760;
const MAX_BATCH: usize = 48;

fn validate_cover(value: &str) -> Result<(), String> {
    if value.len() > MAX_DATA_LENGTH {
        return Err("Cover image is too large. Choose another image.".into());
    }
    let encoded = value
        .strip_prefix(PREFIX)
        .ok_or("Cover must be a JPEG thumbnail.")?;
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "Cover image is not valid base64.")?;
    let mut decoder = jpeg_decoder::Decoder::new(Cursor::new(bytes));
    decoder
        .read_info()
        .map_err(|_| "Cover image is not a readable JPEG.")?;
    let info = decoder.info().ok_or("Cover image has no dimensions.")?;
    if info.width == 0 || info.height == 0 || info.width > 480 || info.height > 480 {
        return Err("Cover images must be at most 480 × 480 pixels.".into());
    }
    decoder
        .decode()
        .map_err(|_| "Cover image is incomplete or damaged.")?;
    Ok(())
}

fn covers_get(ids: &[i64], store: &Store) -> Result<HashMap<i64, String>, String> {
    if ids.len() > MAX_BATCH || ids.iter().any(|id| *id <= 0) {
        return Err("Request up to 48 valid piece covers at a time.".into());
    }
    let mut covers = HashMap::new();
    for id in ids {
        if let Some(value) = store
            .get_setting(&format!("pieces.cover.{id}"))
            .map_err(|e| e.to_string())?
        {
            if value.starts_with(PREFIX) && value.len() <= MAX_DATA_LENGTH {
                covers.insert(*id, value);
            }
        }
    }
    Ok(covers)
}

fn cover_set(id: i64, data_url: Option<&str>, store: &Store) -> Result<(), String> {
    if id <= 0 || store.get_piece(id).map_err(|e| e.to_string())?.is_none() {
        return Err("This piece is no longer in your library.".into());
    }
    if let Some(value) = data_url {
        validate_cover(value)?;
    }
    store
        .set_setting(&format!("pieces.cover.{id}"), data_url.unwrap_or(""))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn piece_covers_get(
    ids: Vec<i64>,
    store: State<'_, Arc<Store>>,
) -> Result<HashMap<i64, String>, String> {
    covers_get(&ids, &store)
}

#[tauri::command]
pub fn piece_cover_set(
    id: i64,
    data_url: Option<String>,
    store: State<'_, Arc<Store>>,
) -> Result<(), String> {
    cover_set(id, data_url.as_deref(), &store)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jpeg(width: u16, height: u16) -> String {
        let mut bytes = Vec::new();
        jpeg_encoder::Encoder::new(&mut bytes, 75)
            .encode(
                &vec![127; usize::from(width) * usize::from(height) * 3],
                width,
                height,
                jpeg_encoder::ColorType::Rgb,
            )
            .unwrap();
        format!("{PREFIX}{}", STANDARD.encode(bytes))
    }

    #[test]
    fn validates_image_content_dimensions_and_budget() {
        assert!(validate_cover(&jpeg(480, 480)).is_ok());
        assert!(validate_cover(&jpeg(481, 10)).is_err());
        assert!(validate_cover("data:image/svg+xml;base64,PHN2Zz4=").is_err());
        assert!(validate_cover(&format!("{PREFIX}{}", STANDARD.encode(b"not an image"))).is_err());
        assert!(validate_cover(&"x".repeat(MAX_DATA_LENGTH + 1)).is_err());
    }

    #[test]
    fn rejected_artwork_never_replaces_the_previous_cover() {
        let store = Store::open(":memory:").unwrap();
        store.exec_for_test(
            "INSERT INTO piece(id,title,folder_path) VALUES(1,'Etude','/fixture/etude')",
        );
        let original = jpeg(48, 48);
        cover_set(1, Some(&original), &store).unwrap();
        for rejected in [jpeg(10, 481), format!("{PREFIX}@@@"), PREFIX.to_string()] {
            assert!(cover_set(1, Some(&rejected), &store).is_err());
            assert_eq!(covers_get(&[1], &store).unwrap().get(&1), Some(&original));
        }
        assert!(store.get_piece(1).unwrap().is_some());
    }

    #[test]
    fn artwork_survives_reopen_and_reset_preserves_piece() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("covers.db");
        let expected = jpeg(24, 24);
        {
            let store = Store::open(&path).unwrap();
            store.exec_for_test(
                "INSERT INTO piece(id,title,folder_path) VALUES(1,'Etude','/fixture/etude')",
            );
            cover_set(1, Some(&expected), &store).unwrap();
            assert!(cover_set(999, Some(&expected), &store).is_err());
        }
        let store = Store::open(&path).unwrap();
        assert_eq!(covers_get(&[1], &store).unwrap().get(&1), Some(&expected));
        cover_set(1, None, &store).unwrap();
        assert!(covers_get(&[1], &store).unwrap().is_empty());
        assert!(store.get_piece(1).unwrap().is_some());
        assert!(covers_get(&vec![1; MAX_BATCH + 1], &store).is_err());
        assert!(covers_get(&[-1], &store).is_err());
    }
}
