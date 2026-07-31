//! Range-capable serving of one piece's PDF edition over the `ckscore://`
//! custom URI scheme.
//!
//! Why this exists: `score::pdf_bytes` reads a whole edition into a `Vec<u8>`
//! and ships every byte across IPC. Christian's real editions are image scans
//! (8.6 MB for the Barber Pas de Deux), so the webview paid for an 8.6 MB
//! transfer plus a second 8.6 MB copy in JS before PDF.js saw a single object.
//! Serving the same file over a URI scheme that honours `Range` lets PDF.js ask
//! for the xref and just the objects page 1 needs.
//!
//! Security: a request carries a piece id and an *edition id*, never a
//! filesystem path. The edition id is resolved through exactly the same
//! `resolve_edition` re-discovery that `pdf_bytes` uses — a fresh directory
//! scan of the piece folder whose results are matched by id — so a traversal
//! attempt like `../../etc/passwd` simply fails to match and 404s.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use tauri::http::{header, Response, StatusCode};

use crate::store::Store;

/// The scheme this module answers on. On macOS/Linux the webview addresses it
/// as `ckscore://localhost/<piece>/<edition>`; on Windows the same handler is
/// reached at `http://ckscore.localhost/<piece>/<edition>`. Either way only the
/// path reaches [`respond`].
pub const SCHEME: &str = "ckscore";

/// What a `Range:` header asked for, already validated against the file length.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Span {
    /// No (or an unparseable) `Range` header: answer 200 with the whole file.
    Full,
    /// A satisfiable single range, inclusive on both ends.
    Partial { start: u64, end: u64 },
    /// Syntactically a range, but outside the file: answer 416.
    Unsatisfiable,
}

/// Parse a single-range `Range: bytes=…` header against a known length.
///
/// Deliberately narrow: only `bytes=` with one range. Multi-range requests
/// (`bytes=0-9,20-29`) would need a multipart body no PDF reader asks for, so
/// they degrade to a full 200 rather than a wrong 206.
pub fn parse_range(value: &str, len: u64) -> Span {
    let Some(spec) = value.trim().strip_prefix("bytes=") else {
        return Span::Full;
    };
    let spec = spec.trim();
    if spec.contains(',') {
        return Span::Full;
    }
    let Some((first, last)) = spec.split_once('-') else {
        return Span::Full;
    };
    let (first, last) = (first.trim(), last.trim());

    // Suffix form `bytes=-500`: the LAST 500 bytes. PDF.js does not send these,
    // but the xref-at-the-end shape makes them the obvious thing for a future
    // caller to try, and a wrong answer here would be silent corruption.
    if first.is_empty() {
        let Ok(suffix) = last.parse::<u64>() else {
            return Span::Full;
        };
        if suffix == 0 || len == 0 {
            return Span::Unsatisfiable;
        }
        return Span::Partial {
            start: len.saturating_sub(suffix),
            end: len - 1,
        };
    }

    let Ok(start) = first.parse::<u64>() else {
        return Span::Full;
    };
    if start >= len {
        return Span::Unsatisfiable;
    }
    let end = if last.is_empty() {
        len - 1
    } else {
        match last.parse::<u64>() {
            // An end past EOF is clamped, per RFC 9110: a client that asks for
            // more than exists still gets what exists.
            Ok(end) => end.min(len - 1),
            Err(_) => return Span::Full,
        }
    };
    if end < start {
        return Span::Unsatisfiable;
    }
    Span::Partial { start, end }
}

/// Read exactly `[start, start + len)` by seeking — never by reading the whole
/// file and slicing it. The buffer is sized to the span, so serving 64 KB of an
/// 8.6 MB scan allocates 64 KB.
pub fn read_span(path: &Path, start: u64, len: u64) -> std::io::Result<Vec<u8>> {
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let mut buffer = Vec::with_capacity(len.min(1 << 20) as usize);
    file.take(len).read_to_end(&mut buffer)?;
    Ok(buffer)
}

/// Split `/{piece_id}/{edition_id}` out of a request path. The edition id is
/// percent-encoded by the frontend because real ids contain `/` and spaces
/// (`score/(C) Ekier_Draft.pdf`).
pub fn parse_target(path: &str) -> Option<(i64, String)> {
    let rest = path.strip_prefix('/')?;
    let (piece, edition) = rest.split_once('/')?;
    let piece_id: i64 = piece.parse().ok()?;
    let edition_id = percent_decode(edition)?;
    if edition_id.is_empty() {
        return None;
    }
    Some((piece_id, edition_id))
}

/// Minimal percent-decoder for one path segment. Returns `None` on malformed
/// escapes or non-UTF-8 output rather than lossily inventing a path.
fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = bytes.get(index + 1..index + 3)?;
            let hex = std::str::from_utf8(hex).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn base(origin: &str) -> tauri::http::response::Builder {
    Response::builder()
        // The scheme is process-local: only this app's webview can address it,
        // and nothing on the network can reach it. `*` keeps the handler
        // independent of the per-platform webview origin (`tauri://localhost`
        // on macOS, `http://tauri.localhost` on Windows).
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
        .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range")
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "Content-Range, Content-Length, Accept-Ranges",
        )
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store")
}

fn fail(origin: &str, status: StatusCode, message: &str) -> Response<Vec<u8>> {
    base(origin)
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain")
        .body(message.as_bytes().to_vec())
        .expect("static error response is well formed")
}

/// Build the response for one `ckscore://` request.
///
/// Pure apart from the filesystem read, and takes no Tauri app handle, so the
/// whole contract — status codes, `Content-Range`, traversal refusal — is unit
/// testable without a running webview.
pub fn respond(store: &Store, path: &str, range: Option<&str>, origin: &str) -> Response<Vec<u8>> {
    let Some((piece_id, edition_id)) = parse_target(path) else {
        return fail(origin, StatusCode::BAD_REQUEST, "malformed score request");
    };

    // The one and only security gate, shared verbatim with `score::pdf_bytes`.
    let edition = match super::resolve_edition(store, piece_id, &edition_id) {
        Ok(edition) => edition,
        Err(message) => return fail(origin, StatusCode::NOT_FOUND, &message),
    };

    let len = match std::fs::metadata(&edition.path) {
        Ok(metadata) => metadata.len(),
        Err(e) => {
            return fail(
                origin,
                StatusCode::NOT_FOUND,
                &format!("stat PDF edition: {e}"),
            )
        }
    };

    let span = range.map_or(Span::Full, |value| parse_range(value, len));
    match span {
        Span::Unsatisfiable => base(origin)
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{len}"))
            .body(Vec::new())
            .expect("static 416 response is well formed"),
        Span::Full => match read_span(&edition.path, 0, len) {
            Ok(body) => base(origin)
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/pdf")
                .header(header::CONTENT_LENGTH, body.len())
                .body(body)
                .expect("full response is well formed"),
            Err(e) => fail(
                origin,
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("read PDF edition: {e}"),
            ),
        },
        Span::Partial { start, end } => {
            let count = end - start + 1;
            match read_span(&edition.path, start, count) {
                Ok(body) => {
                    // Report what we actually read: a file truncated between the
                    // stat and the read must not claim bytes it did not send.
                    let last = start + body.len() as u64 - 1;
                    base(origin)
                        .status(StatusCode::PARTIAL_CONTENT)
                        .header(header::CONTENT_TYPE, "application/pdf")
                        .header(header::CONTENT_LENGTH, body.len())
                        .header(header::CONTENT_RANGE, format!("bytes {start}-{last}/{len}"))
                        .body(body)
                        .expect("partial response is well formed")
                }
                Err(e) => fail(
                    origin,
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &format!("read PDF edition range: {e}"),
                ),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::model::ScanPiece;
    use std::fs;
    use tempfile::TempDir;

    const BODY: &[u8] = b"0123456789abcdef";
    const ORIGIN: &str = "*";

    fn fixture() -> (TempDir, Store, i64) {
        let td = TempDir::new().unwrap();
        let piece = td.path().join("Chopin - Scherzo");
        fs::create_dir_all(piece.join("score")).unwrap();
        fs::write(piece.join("score/(C) Ekier_Draft.pdf"), BODY).unwrap();
        let store = Store::open(":memory:").unwrap();
        let id = store
            .upsert_piece(&ScanPiece {
                folder_path: piece.to_string_lossy().into_owned(),
                title: "Scherzo".into(),
                composer: Some("Chopin".into()),
                xml_path: None,
                pdf_path: Some(piece.join("score/(C) Ekier_Draft.pdf")),
            })
            .unwrap();
        (td, store, id)
    }

    fn url(piece_id: i64, edition_id: &str) -> String {
        let mut encoded = String::from("/");
        encoded.push_str(&piece_id.to_string());
        encoded.push('/');
        for byte in edition_id.bytes() {
            match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    encoded.push(byte as char)
                }
                _ => encoded.push_str(&format!("%{byte:02X}")),
            }
        }
        encoded
    }

    fn header_of(response: &Response<Vec<u8>>, name: header::HeaderName) -> Option<String> {
        response
            .headers()
            .get(name)
            .map(|value| value.to_str().unwrap().to_string())
    }

    #[test]
    fn no_range_serves_the_whole_edition_as_200() {
        let (_td, store, id) = fixture();
        let response = respond(&store, &url(id, "score/(C) Ekier_Draft.pdf"), None, ORIGIN);
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body(), BODY);
        assert_eq!(
            header_of(&response, header::ACCEPT_RANGES).as_deref(),
            Some("bytes")
        );
        assert_eq!(
            header_of(&response, header::CONTENT_LENGTH).as_deref(),
            Some("16")
        );
        assert_eq!(
            header_of(&response, header::CONTENT_TYPE).as_deref(),
            Some("application/pdf")
        );
        assert!(header_of(&response, header::CONTENT_RANGE).is_none());
    }

    #[test]
    fn a_mid_file_range_serves_206_with_exact_content_range() {
        let (_td, store, id) = fixture();
        let response = respond(
            &store,
            &url(id, "score/(C) Ekier_Draft.pdf"),
            Some("bytes=4-9"),
            ORIGIN,
        );
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.body(), b"456789");
        assert_eq!(
            header_of(&response, header::CONTENT_RANGE).as_deref(),
            Some("bytes 4-9/16")
        );
        assert_eq!(
            header_of(&response, header::CONTENT_LENGTH).as_deref(),
            Some("6")
        );
    }

    #[test]
    fn an_open_ended_range_runs_to_eof() {
        let (_td, store, id) = fixture();
        let response = respond(
            &store,
            &url(id, "score/(C) Ekier_Draft.pdf"),
            Some("bytes=10-"),
            ORIGIN,
        );
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.body(), b"abcdef");
        assert_eq!(
            header_of(&response, header::CONTENT_RANGE).as_deref(),
            Some("bytes 10-15/16")
        );
    }

    #[test]
    fn a_suffix_range_serves_the_tail() {
        let (_td, store, id) = fixture();
        let response = respond(
            &store,
            &url(id, "score/(C) Ekier_Draft.pdf"),
            Some("bytes=-4"),
            ORIGIN,
        );
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.body(), b"cdef");
        assert_eq!(
            header_of(&response, header::CONTENT_RANGE).as_deref(),
            Some("bytes 12-15/16")
        );
    }

    #[test]
    fn an_out_of_bounds_range_answers_416_without_panicking() {
        let (_td, store, id) = fixture();
        for value in ["bytes=100-200", "bytes=16-", "bytes=9-4", "bytes=-0"] {
            let response = respond(
                &store,
                &url(id, "score/(C) Ekier_Draft.pdf"),
                Some(value),
                ORIGIN,
            );
            assert_eq!(
                response.status(),
                StatusCode::RANGE_NOT_SATISFIABLE,
                "range {value}"
            );
            assert!(response.body().is_empty(), "range {value}");
            assert_eq!(
                header_of(&response, header::CONTENT_RANGE).as_deref(),
                Some("bytes */16"),
                "range {value}"
            );
        }
    }

    #[test]
    fn an_end_past_eof_is_clamped_rather_than_refused() {
        let (_td, store, id) = fixture();
        let response = respond(
            &store,
            &url(id, "score/(C) Ekier_Draft.pdf"),
            Some("bytes=12-999999"),
            ORIGIN,
        );
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.body(), b"cdef");
        assert_eq!(
            header_of(&response, header::CONTENT_RANGE).as_deref(),
            Some("bytes 12-15/16")
        );
    }

    #[test]
    fn a_garbage_or_multipart_range_degrades_to_the_full_body() {
        let (_td, store, id) = fixture();
        for value in ["cheese", "bytes=abc-def", "bytes=0-3,8-11", ""] {
            let response = respond(
                &store,
                &url(id, "score/(C) Ekier_Draft.pdf"),
                Some(value),
                ORIGIN,
            );
            assert_eq!(response.status(), StatusCode::OK, "range {value:?}");
            assert_eq!(response.body(), BODY, "range {value:?}");
        }
    }

    #[test]
    fn a_traversal_attempt_is_refused_and_leaks_nothing() {
        let (td, store, id) = fixture();
        fs::write(td.path().join("outside.pdf"), b"secret").unwrap();
        for attempt in [
            "../../etc/passwd",
            "../outside.pdf",
            "/etc/passwd",
            "score/../../outside.pdf",
        ] {
            let response = respond(&store, &url(id, attempt), None, ORIGIN);
            assert_eq!(
                response.status(),
                StatusCode::NOT_FOUND,
                "attempt {attempt}"
            );
            assert!(
                !response.body().windows(6).any(|w| w == b"secret"),
                "attempt {attempt} leaked file contents"
            );
        }
        // The un-encoded shape (raw slashes in the path) must fail too: it is
        // read as a *different* edition id, which still never matches.
        let raw = respond(&store, &format!("/{id}/../../etc/passwd"), None, ORIGIN);
        assert_eq!(raw.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn an_edition_from_another_piece_is_refused() {
        let (td, store, id) = fixture();
        let other = td.path().join("Other - Piece");
        fs::create_dir_all(other.join("score")).unwrap();
        fs::write(other.join("score/Secret.pdf"), b"other-piece").unwrap();
        let other_id = store
            .upsert_piece(&ScanPiece {
                folder_path: other.to_string_lossy().into_owned(),
                title: "Other".into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        let response = respond(&store, &url(id, "score/Secret.pdf"), None, ORIGIN);
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        // …while the piece that really owns it still serves it.
        let owner = respond(&store, &url(other_id, "score/Secret.pdf"), None, ORIGIN);
        assert_eq!(owner.status(), StatusCode::OK);
        assert_eq!(owner.body(), b"other-piece");
    }

    #[test]
    fn a_malformed_target_is_a_400_not_a_panic() {
        let (_td, store, _id) = fixture();
        for path in ["", "/", "/12", "/notanumber/score/a.pdf", "/1/", "/1/%zz"] {
            let response = respond(&store, path, None, ORIGIN);
            assert_eq!(response.status(), StatusCode::BAD_REQUEST, "path {path:?}");
        }
    }

    #[test]
    fn parse_target_decodes_real_edition_ids() {
        assert_eq!(
            parse_target("/7/score%2F(C)%20Ekier_Draft.pdf"),
            Some((7, "score/(C) Ekier_Draft.pdf".to_string()))
        );
        assert_eq!(
            parse_target("/7/Root%20edition.pdf"),
            Some((7, "Root edition.pdf".to_string()))
        );
    }

    #[test]
    fn an_edition_id_resolves_whether_or_not_the_webview_decoded_its_slashes() {
        // The frontend percent-encodes the id into one segment, but we cannot
        // prove WKWebView hands `%2F` through untouched. Everything after the
        // piece id is the edition id either way, so both spellings must work.
        let (_td, store, id) = fixture();
        let encoded = respond(&store, &url(id, "score/(C) Ekier_Draft.pdf"), None, ORIGIN);
        let decoded = respond(
            &store,
            &format!("/{id}/score/(C)%20Ekier_Draft.pdf"),
            None,
            ORIGIN,
        );
        assert_eq!(encoded.status(), StatusCode::OK);
        assert_eq!(decoded.status(), StatusCode::OK);
        assert_eq!(encoded.body(), decoded.body());
    }

    #[test]
    fn read_span_seeks_instead_of_reading_the_whole_file() {
        let td = TempDir::new().unwrap();
        let path = td.path().join("big.bin");
        fs::write(&path, vec![7u8; 4 * 1024 * 1024]).unwrap();
        let span = read_span(&path, 4 * 1024 * 1024 - 8, 64).unwrap();
        // Bounded by EOF, not by the requested count.
        assert_eq!(span.len(), 8);
        assert!(span.iter().all(|byte| *byte == 7));
    }

    #[test]
    fn parse_range_handles_the_shapes_pdfjs_sends() {
        assert_eq!(
            parse_range("bytes=0-65535", 8_638_377),
            Span::Partial {
                start: 0,
                end: 65_535
            }
        );
        assert_eq!(
            parse_range("bytes=8572841-8638376", 8_638_377),
            Span::Partial {
                start: 8_572_841,
                end: 8_638_376
            }
        );
        assert_eq!(
            parse_range("bytes=0-0", 1),
            Span::Partial { start: 0, end: 0 }
        );
        assert_eq!(parse_range("bytes=0-", 0), Span::Unsatisfiable);
        assert_eq!(parse_range("BYTES=0-1", 16), Span::Full);
    }

    /// Real wall clock on a real image scan: the `ckscore://` handler serving
    /// PDF.js's opening 64 KB range against `score::pdf_bytes` reading the whole
    /// edition. `#[ignore]`d because it needs a file from Christian's vault:
    ///
    /// ```text
    /// SCORE_BENCH_PDF="$HOME/Desktop/christian's universe/Piano Practice/Pieces/Chamber Pieces Tanglewood/Christian_C_Barber_Pas_de_Deux_Primo.pdf" \
    ///   cargo test --lib score::serve::tests::bench -- --ignored --nocapture
    /// ```
    ///
    /// The real file is COPIED into a temp piece folder first; the vault is only
    /// ever read.
    #[test]
    #[ignore = "needs a real multi-megabyte edition via SCORE_BENCH_PDF"]
    fn bench_range_versus_whole_file() {
        use std::time::Instant;

        let Ok(source) = std::env::var("SCORE_BENCH_PDF") else {
            println!("skipped: set SCORE_BENCH_PDF to a real edition");
            return;
        };
        let source = std::path::PathBuf::from(source);
        let td = TempDir::new().unwrap();
        let piece = td.path().join("Bench - Piece");
        fs::create_dir_all(piece.join("score")).unwrap();
        let target = piece.join("score/edition.pdf");
        fs::copy(&source, &target).unwrap();
        let size = fs::metadata(&target).unwrap().len();

        let store = Store::open(":memory:").unwrap();
        let id = store
            .upsert_piece(&ScanPiece {
                folder_path: piece.to_string_lossy().into_owned(),
                title: "Bench".into(),
                composer: None,
                xml_path: None,
                pdf_path: Some(target.clone()),
            })
            .unwrap();
        let path = url(id, "score/edition.pdf");

        // Warm the page cache for BOTH strategies so this measures the strategy,
        // not who paid for the first disk read.
        for _ in 0..3 {
            let _ = super::super::pdf_bytes(&store, id, "score/edition.pdf").unwrap();
            let _ = respond(&store, &path, Some("bytes=0-65535"), ORIGIN);
        }

        const RUNS: u32 = 15;
        let mut whole = Vec::new();
        let mut first_range = Vec::new();
        let mut tail_range = Vec::new();
        for _ in 0..RUNS {
            let t = Instant::now();
            let bytes = super::super::pdf_bytes(&store, id, "score/edition.pdf").unwrap();
            whole.push(t.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(bytes.len() as u64, size);

            let t = Instant::now();
            let head = respond(&store, &path, Some("bytes=0-65535"), ORIGIN);
            first_range.push(t.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(head.status(), StatusCode::PARTIAL_CONTENT);
            assert_eq!(head.body().len(), 65_536);

            // The xref lives at the end; this is the second thing PDF.js asks for.
            let t = Instant::now();
            let tail = respond(&store, &path, Some("bytes=-65536"), ORIGIN);
            tail_range.push(t.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(tail.status(), StatusCode::PARTIAL_CONTENT);
        }

        let stat = |mut values: Vec<f64>| {
            values.sort_by(|a, b| a.partial_cmp(b).unwrap());
            (values[0], values[values.len() / 2])
        };
        let (whole_min, whole_med) = stat(whole);
        let (head_min, head_med) = stat(first_range);
        let (tail_min, tail_med) = stat(tail_range);
        println!("--- ckscore range vs whole-file read ---");
        println!("file                  {} ({size} bytes)", source.display());
        println!("runs                  {RUNS} (after 3 warm-ups)");
        println!("pdf_bytes  whole file  min {whole_min:8.3} ms   median {whole_med:8.3} ms");
        println!("respond    head 64 KB  min {head_min:8.3} ms   median {head_med:8.3} ms");
        println!("respond    tail 64 KB  min {tail_min:8.3} ms   median {tail_med:8.3} ms");
        println!(
            "speedup    head          {:.1}x (median)",
            whole_med / head_med
        );
    }
}
