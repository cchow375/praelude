//! Bounded on-disk cache of screen-resolution score page bitmaps.
//!
//! Two things live here, keyed the same way:
//!
//! * the fitted **first page** of a piece/edition, painted instantly on a piece
//!   switch while the real PDF parses; and
//! * every **page image** produced by [`super::page_image`], which is what keeps
//!   a 38 MP scan from ever being decoded twice.
//!
//! It is never authoritative, never touches the vault, and never touches the
//! database. It lives under the OS app-cache dir and is bounded by BOTH an entry
//! count and a total-byte budget, evicting least-recently-used entries.
//!
//! Key components (edition fingerprint, bucket) arrive from the frontend but are
//! *never* used to build a filesystem path — on-disk file names are pure integers
//! allocated from a persisted counter, so a malicious key cannot escape the cache
//! directory. Components only ever appear inside the JSON index value.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const CACHE_SUBDIR: &str = "score-pages";
/// The pre-v5 first-page-only directory. Removed once, on first use of the new
/// one, so upgrading does not strand a few MB of orphaned snapshots forever.
const LEGACY_CACHE_SUBDIR: &str = "score-first-page";
const INDEX_FILE: &str = "index.json";
/// Bound on total cached snapshots across every piece/edition/page/bucket.
///
/// Now that whole scores are cached page by page, 24 could not even hold one
/// 15-page edition at one zoom bucket. 320 covers Christian's whole library at
/// the fit bucket with room for a second bucket on the pieces he zooms into.
const MAX_ENTRIES: usize = 320;
/// Bound on the bytes this cache occupies. A screen-resolution page is
/// 150–500 KB, so this is roughly 150 pages before the byte budget bites — it is
/// the backstop that keeps a library of colour scans from filling the disk.
const MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024;
/// A fitted, compressed page is well under this; anything larger is rejected so a
/// caller cannot fill the disk through this path.
const MAX_BYTES: usize = 4 * 1024 * 1024;
const MAX_FINGERPRINT_LEN: usize = 256;
const MAX_BUCKET_LEN: usize = 128;

/// One cached snapshot's metadata. Bytes live in a sibling file named `file`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct IndexEntry {
    key: String,
    file: String,
    size: u64,
    /// Logical clock value at last access; larger == more recently used.
    last_used: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Index {
    /// Monotonic logical clock: bumped on every save and load. Doubles as the
    /// unique file-name allocator, so no two snapshots ever share a path.
    clock: u64,
    entries: Vec<IndexEntry>,
}

/// Build the stable cache key. Any `|` in a component is neutralized so distinct
/// tuples can never alias into one key. Purely a lookup string — never a path.
pub fn cache_key(piece_id: i64, edition_fingerprint: &str, page: i64, bucket: &str) -> String {
    let fingerprint = edition_fingerprint.replace('|', "_");
    let bucket = bucket.replace('|', "_");
    format!("p{piece_id}|f{fingerprint}|pg{page}|b{bucket}")
}

fn cache_dir(root: &Path) -> PathBuf {
    root.join(CACHE_SUBDIR)
}

fn index_path(dir: &Path) -> PathBuf {
    dir.join(INDEX_FILE)
}

fn read_index(dir: &Path) -> Index {
    match std::fs::read(index_path(dir)) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => Index::default(),
    }
}

fn write_index(dir: &Path, index: &Index) -> Result<(), String> {
    let serialized =
        serde_json::to_vec(index).map_err(|e| format!("serialize page cache index: {e}"))?;
    // Write to a temp sibling then rename, so a crash mid-write never leaves a
    // half-written index that would drop the whole cache.
    let tmp = index_path(dir).with_extension("json.tmp");
    std::fs::write(&tmp, &serialized).map_err(|e| format!("write page cache index: {e}"))?;
    std::fs::rename(&tmp, index_path(dir)).map_err(|e| format!("commit page cache index: {e}"))
}

/// Validate a fingerprint/bucket pair (defensive bounds on caller-supplied text).
pub fn validate_components(edition_fingerprint: &str, bucket: &str) -> Result<(), String> {
    if edition_fingerprint.is_empty() {
        return Err("page cache: empty edition fingerprint".into());
    }
    if edition_fingerprint.len() > MAX_FINGERPRINT_LEN {
        return Err("page cache: edition fingerprint too long".into());
    }
    if bucket.is_empty() {
        return Err("page cache: empty fit bucket".into());
    }
    if bucket.len() > MAX_BUCKET_LEN {
        return Err("page cache: fit bucket too long".into());
    }
    Ok(())
}

/// Persist a snapshot under `key`. Overwrites an existing entry in place; inserts
/// otherwise, then evicts the least-recently-used entries past `MAX_ENTRIES`.
/// Rejects empty or oversized payloads. An accelerator, so callers treat any
/// error as "not cached" — but the contract here is precise for testing.
pub fn save(root: &Path, key: &str, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("page cache: refusing to store an empty snapshot".into());
    }
    if bytes.len() > MAX_BYTES {
        return Err(format!(
            "page cache: snapshot of {} bytes exceeds the {MAX_BYTES}-byte cap",
            bytes.len()
        ));
    }

    let dir = cache_dir(root);
    let fresh = !dir.exists();
    std::fs::create_dir_all(&dir).map_err(|e| format!("create page cache dir: {e}"))?;
    if fresh {
        // Best-effort: the path is derived entirely from the app cache root, and
        // failing to clear it must never fail a save.
        let _ = std::fs::remove_dir_all(root.join(LEGACY_CACHE_SUBDIR));
    }

    let mut index = read_index(&dir);
    index.clock += 1;
    let clock = index.clock;

    let file_name = if let Some(entry) = index.entries.iter_mut().find(|e| e.key == key) {
        entry.size = bytes.len() as u64;
        entry.last_used = clock;
        entry.file.clone()
    } else {
        // File names are pure counter values — no caller text ever reaches a path.
        let file = format!("e{clock}.img");
        index.entries.push(IndexEntry {
            key: key.to_string(),
            file: file.clone(),
            size: bytes.len() as u64,
            last_used: clock,
        });
        file
    };

    std::fs::write(dir.join(&file_name), bytes)
        .map_err(|e| format!("write page cache snapshot: {e}"))?;

    evict(&dir, &mut index);
    write_index(&dir, &index)
}

/// Load the snapshot bytes for `key`, bumping its recency. Returns an empty `Vec`
/// on a miss (absence is never an error). A stale entry whose file has vanished
/// is pruned and reported as a miss.
pub fn load(root: &Path, key: &str) -> Result<Vec<u8>, String> {
    let dir = cache_dir(root);
    let mut index = read_index(&dir);

    let Some(position) = index.entries.iter().position(|e| e.key == key) else {
        return Ok(Vec::new());
    };

    let file = dir.join(&index.entries[position].file);
    match std::fs::read(&file) {
        Ok(bytes) => {
            index.clock += 1;
            index.entries[position].last_used = index.clock;
            // Recency is best-effort: a failed index write must not fail the read.
            let _ = write_index(&dir, &index);
            Ok(bytes)
        }
        Err(_) => {
            // The file is gone (external cache clear); drop the dangling entry.
            index.entries.remove(position);
            let _ = write_index(&dir, &index);
            Ok(Vec::new())
        }
    }
}

/// Evict least-recently-used entries (and delete their files) until both the
/// entry count and the total-byte budget are satisfied. Archived/removed pieces
/// age out here lazily.
///
/// The byte budget always keeps at least one entry: a single oversized page must
/// still be cacheable, or a big score would thrash forever.
fn evict(dir: &Path, index: &mut Index) {
    let over_budget = |index: &Index| {
        index.entries.len() > MAX_ENTRIES
            || (index.entries.len() > 1
                && index.entries.iter().map(|entry| entry.size).sum::<u64>() > MAX_TOTAL_BYTES)
    };
    while over_budget(index) {
        let Some(victim) = index
            .entries
            .iter()
            .enumerate()
            .min_by_key(|(_, entry)| entry.last_used)
            .map(|(position, _)| position)
        else {
            break;
        };
        let entry = index.entries.remove(victim);
        let _ = std::fs::remove_file(dir.join(&entry.file));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn root() -> TempDir {
        TempDir::new().expect("tempdir")
    }

    #[test]
    fn cache_key_is_stable_and_sanitizes_separators() {
        assert_eq!(
            cache_key(7, "abc", 1, "page-19x15"),
            "p7|fabc|pg1|bpage-19x15"
        );
        // A `|` in a component cannot bleed into the delimiter structure.
        let sneaky = cache_key(7, "a|b", 1, "c|d");
        assert_eq!(sneaky, "p7|fa_b|pg1|bc_d");
    }

    #[test]
    fn save_then_load_round_trips_bytes() {
        let dir = root();
        let key = cache_key(1, "fp", 1, "page-10x10");
        save(dir.path(), &key, b"hello-bitmap").unwrap();
        assert_eq!(load(dir.path(), &key).unwrap(), b"hello-bitmap");
    }

    #[test]
    fn load_is_a_miss_for_an_unknown_key() {
        let dir = root();
        assert!(load(dir.path(), "nope").unwrap().is_empty());
    }

    #[test]
    fn save_rejects_empty_and_oversized_payloads() {
        let dir = root();
        let key = cache_key(1, "fp", 1, "b");
        assert!(save(dir.path(), &key, b"").is_err());
        let too_big = vec![0u8; MAX_BYTES + 1];
        assert!(save(dir.path(), &key, &too_big).is_err());
    }

    #[test]
    fn overwriting_a_key_reuses_its_file_and_does_not_grow() {
        let dir = root();
        let key = cache_key(1, "fp", 1, "b");
        save(dir.path(), &key, b"first").unwrap();
        save(dir.path(), &key, b"second-value").unwrap();
        assert_eq!(load(dir.path(), &key).unwrap(), b"second-value");
        let index = read_index(&cache_dir(dir.path()));
        assert_eq!(index.entries.len(), 1);
    }

    #[test]
    fn eviction_caps_entries_and_drops_the_least_recently_used() {
        let dir = root();
        // Fill to capacity + 1 distinct keys.
        for i in 0..(MAX_ENTRIES + 1) {
            let key = cache_key(i as i64, "fp", 1, "b");
            save(dir.path(), &key, format!("bytes-{i}").as_bytes()).unwrap();
        }
        let index = read_index(&cache_dir(dir.path()));
        assert_eq!(index.entries.len(), MAX_ENTRIES);
        // The very first key (oldest, never touched) was evicted.
        let evicted = cache_key(0, "fp", 1, "b");
        assert!(load(dir.path(), &evicted).unwrap().is_empty());
        // No orphaned snapshot files remain beyond the index + entries.
        let files = std::fs::read_dir(cache_dir(dir.path()))
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".img")
            })
            .count();
        assert_eq!(files, MAX_ENTRIES);
    }

    #[test]
    fn a_whole_multi_page_score_fits_without_evicting_itself() {
        // The regression this bound exists for: at MAX_ENTRIES = 24 a single
        // 15-page edition at two zoom buckets evicted its own first pages.
        let dir = root();
        for page in 1..=15i64 {
            for bucket in ["img-1536", "img-2048"] {
                let key = cache_key(1, "fp", page, bucket);
                save(dir.path(), &key, format!("page-{page}-{bucket}").as_bytes()).unwrap();
            }
        }
        assert_eq!(
            load(dir.path(), &cache_key(1, "fp", 1, "img-1536")).unwrap(),
            b"page-1-img-1536"
        );
        assert_eq!(read_index(&cache_dir(dir.path())).entries.len(), 30);
    }

    #[test]
    fn the_byte_budget_evicts_before_the_entry_count_does() {
        let dir = root();
        // Each entry is 1 MB, so 65 of them exceed the 64 MB budget long before
        // MAX_ENTRIES.
        let payload = vec![7u8; 1024 * 1024];
        for index in 0..70i64 {
            save(dir.path(), &cache_key(index, "fp", 1, "b"), &payload).unwrap();
        }
        let index = read_index(&cache_dir(dir.path()));
        assert!(index.entries.len() < 70, "byte budget never bit");
        let total: u64 = index.entries.iter().map(|entry| entry.size).sum();
        assert!(total <= MAX_TOTAL_BYTES, "{total} bytes cached");
        // The most recent write survived; the oldest did not.
        assert!(!load(dir.path(), &cache_key(69, "fp", 1, "b"))
            .unwrap()
            .is_empty());
        assert!(load(dir.path(), &cache_key(0, "fp", 1, "b"))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_single_oversized_entry_is_still_cacheable() {
        let dir = root();
        // One entry larger than the whole budget would thrash forever if the
        // byte check could evict down to zero.
        let payload = vec![3u8; MAX_BYTES];
        save(dir.path(), &cache_key(1, "fp", 1, "b"), &payload).unwrap();
        assert_eq!(
            load(dir.path(), &cache_key(1, "fp", 1, "b")).unwrap().len(),
            MAX_BYTES
        );
    }

    #[test]
    fn the_pre_v5_first_page_directory_is_cleared_once() {
        let dir = root();
        let legacy = dir.path().join(LEGACY_CACHE_SUBDIR);
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("e1.img"), b"stale").unwrap();

        save(dir.path(), &cache_key(1, "fp", 1, "b"), b"fresh").unwrap();
        assert!(!legacy.exists(), "legacy first-page cache was left behind");

        // A later save must not keep trying to remove a directory the user may
        // have recreated for some other reason.
        std::fs::create_dir_all(&legacy).unwrap();
        save(dir.path(), &cache_key(2, "fp", 1, "b"), b"fresh").unwrap();
        assert!(legacy.exists());
    }

    #[test]
    fn a_recently_loaded_entry_survives_eviction() {
        let dir = root();
        let survivor = cache_key(0, "fp", 1, "b");
        save(dir.path(), &survivor, b"keep-me").unwrap();
        // Fill the rest of the capacity.
        for i in 1..MAX_ENTRIES {
            let key = cache_key(i as i64, "fp", 1, "b");
            save(dir.path(), &key, format!("bytes-{i}").as_bytes()).unwrap();
        }
        // Touch the oldest so it is most-recently used, then push one more in.
        assert_eq!(load(dir.path(), &survivor).unwrap(), b"keep-me");
        let newcomer = cache_key(999, "fp", 1, "b");
        save(dir.path(), &newcomer, b"new").unwrap();

        assert_eq!(load(dir.path(), &survivor).unwrap(), b"keep-me");
        // The now-oldest (key 1) was evicted instead.
        assert!(load(dir.path(), &cache_key(1, "fp", 1, "b"))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_vanished_snapshot_file_is_pruned_and_reads_as_a_miss() {
        let dir = root();
        let key = cache_key(1, "fp", 1, "b");
        save(dir.path(), &key, b"data").unwrap();
        // Simulate an external cache purge of the bytes but not the index.
        let index = read_index(&cache_dir(dir.path()));
        let file = cache_dir(dir.path()).join(&index.entries[0].file);
        std::fs::remove_file(&file).unwrap();

        assert!(load(dir.path(), &key).unwrap().is_empty());
        // The dangling entry was pruned.
        let after = read_index(&cache_dir(dir.path()));
        assert!(after.entries.is_empty());
    }

    #[test]
    fn index_persists_across_calls_like_a_relaunch() {
        let dir = root();
        let key = cache_key(3, "edition-fp", 1, "page-19x15");
        save(dir.path(), &key, b"persisted").unwrap();
        // A fresh read (no shared state) still finds it: this is what makes a
        // relaunch benefit.
        assert_eq!(load(dir.path(), &key).unwrap(), b"persisted");
    }

    #[test]
    fn caller_text_never_escapes_the_cache_directory() {
        let dir = root();
        // A fingerprint/bucket full of traversal + separators must not create a
        // file outside the cache dir; the on-disk name is a pure counter.
        let key = cache_key(1, "../../../etc/passwd", 1, "../../evil|b");
        save(dir.path(), &key, b"safe").unwrap();
        let cache = cache_dir(dir.path());
        for entry in std::fs::read_dir(&cache).unwrap() {
            let path = entry.unwrap().path();
            assert!(path.starts_with(&cache), "escaped: {path:?}");
        }
        assert_eq!(load(dir.path(), &key).unwrap(), b"safe");
    }

    #[test]
    fn validate_components_bounds_caller_text() {
        assert!(validate_components("fp", "page-1x1").is_ok());
        assert!(validate_components("", "b").is_err());
        assert!(validate_components("fp", "").is_err());
        assert!(validate_components(&"x".repeat(MAX_FINGERPRINT_LEN + 1), "b").is_err());
        assert!(validate_components("fp", &"x".repeat(MAX_BUCKET_LEN + 1)).is_err());
    }
}
