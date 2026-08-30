//! Read-only retrieval over Christian's four local piano-practice books.
//!
//! The copyrighted source books stay outside the application bundle.  This
//! module accepts a user-selected directory, opens only four exact Markdown
//! filenames directly beneath it, strips conversion HTML, chunks by heading
//! and paragraph, and caches an in-memory lexical index keyed by file metadata.
//! Provider prompts receive only the small set of retrieved chunks.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use super::Citation;

const MAX_BOOK_BYTES: u64 = 5 * 1024 * 1024;
const MAX_CORPUS_BYTES: u64 = 12 * 1024 * 1024;
const MAX_CHUNK_CHARS: usize = 3_200;
const MAX_HIT_BODY_CHARS: usize = 2_600;
const DEFAULT_HITS: usize = 6;

/// The manifest file that lists every corpus book. It lives directly beneath
/// the knowledge directory. When it is absent, retrieval bootstraps it from the
/// four historical built-ins so Christian's existing setup keeps working with no
/// action on his part.
const MANIFEST_NAME: &str = "books.json";
/// Removed books are moved here, never hard-deleted.
const TRASH_DIR: &str = ".trash";

/// What kind of book a manifest entry is. Serialized to the frontend Books
/// panel in kebab-case (`practice-method`, `composer-life`, `interpretation`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BookKind {
    PracticeMethod,
    ComposerLife,
    Interpretation,
}

/// One data-driven corpus book. Replaces the former hardcoded `BookSpec`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BookEntry {
    pub id: String,
    pub file_name: String,
    pub title: String,
    pub author: String,
    pub kind: BookKind,
    #[serde(default)]
    pub visual_dependency: bool,
}

/// The on-disk `books.json` shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Manifest {
    books: Vec<BookEntry>,
}

/// The four historical books, preserving their exact ids and visual-dependency
/// flags. Used to bootstrap a missing manifest.
#[cfg(test)]
fn builtin_books() -> Vec<BookEntry> {
    vec![
        BookEntry {
            id: "roskell-complete-pianist".into(),
            file_name: "the-complete-pianist.md".into(),
            title: "The Complete Pianist".into(),
            author: "Penelope Roskell".into(),
            kind: BookKind::PracticeMethod,
            // Technique descriptions sometimes depend on photographs, diagrams,
            // or notated exercises in the matching PDF.
            visual_dependency: true,
        },
        BookEntry {
            id: "gebrian-learn-faster".into(),
            file_name: "learn-faster-perform-better.md".into(),
            title: "Learn Faster, Perform Better".into(),
            author: "Molly Gebrian".into(),
            kind: BookKind::PracticeMethod,
            visual_dependency: false,
        },
        BookEntry {
            id: "breth-effective-practicing".into(),
            file_name: "the-piano-students-guide-to-effective-practicing.md".into(),
            title: "The Piano Student's Guide to Effective Practicing".into(),
            author: "Nancy O'Neill Breth".into(),
            kind: BookKind::PracticeMethod,
            visual_dependency: true,
        },
        BookEntry {
            id: "gieseking-leimer-technique".into(),
            file_name: "gieseking-leimer-piano-technique.md".into(),
            title: "Piano Technique".into(),
            author: "Walter Gieseking and Karl Leimer".into(),
            // This historical pedagogy includes score examples and should be
            // treated as one perspective, not a universal modern evidence claim.
            kind: BookKind::Interpretation,
            visual_dependency: true,
        },
    ]
}

/// Load the manifest, bootstrapping it from the built-ins when absent. A
/// bootstrap write is best-effort: if the directory is not writable retrieval
/// still proceeds from the in-memory built-ins rather than failing.
fn load_manifest(root: &Path) -> Result<Vec<BookEntry>, String> {
    let path = root.join(MANIFEST_NAME);
    match fs::read_to_string(&path) {
        Ok(raw) => {
            let manifest: Manifest = serde_json::from_str(&raw)
                .map_err(|_| "books.json manifest is not valid JSON".to_string())?;
            Ok(manifest.books)
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {
            let books = builtin_books();
            let _ = write_manifest(root, &books);
            Ok(books)
        }
        Err(_) => Err("books.json manifest is unreadable".to_string()),
    }
}

fn write_manifest(root: &Path, books: &[BookEntry]) -> Result<(), String> {
    let manifest = Manifest {
        books: books.to_vec(),
    };
    let json = serde_json::to_string_pretty(&manifest)
        .map_err(|_| "Could not serialize books.json".to_string())?;
    fs::write(root.join(MANIFEST_NAME), json)
        .map_err(|_| "Could not write books.json into the knowledge folder".to_string())
}

/// Absolute + real + directory. Shared by every path that touches the knowledge
/// folder so the "escapes the knowledge folder" guarantee has a single anchor.
fn validated_root(dir: &Path) -> Result<PathBuf, String> {
    if !dir.is_absolute() {
        return Err("Knowledge folder must be an absolute directory".into());
    }
    let root = dir
        .canonicalize()
        .map_err(|_| "Knowledge folder is missing or unreadable".to_string())?;
    if !root.is_dir() {
        return Err("Knowledge path is not a directory".into());
    }
    Ok(root)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CorpusStatus {
    Ready,
    Partial,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CorpusHit {
    pub id: String,
    pub source_id: String,
    pub title: String,
    pub author: String,
    pub heading: String,
    pub locator: String,
    pub body: String,
    pub visual_dependency: bool,
    #[serde(skip)]
    pub score: f64,
}

impl CorpusHit {
    pub fn citation(&self) -> Citation {
        Citation {
            source_id: self.id.clone(),
            label: format!("{} — {}", self.author, self.title),
            excerpt: format!("{} · {}", self.locator, excerpt(&self.body, 260)),
            // Local filesystem paths deliberately never cross IPC. The UI can
            // still inspect the bounded excerpt and exact heading locator.
            url: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CorpusSearch {
    pub status: CorpusStatus,
    pub hits: Vec<CorpusHit>,
    pub indexed_sources: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct FileFingerprint {
    name: String,
    len: u64,
    modified_nanos: u128,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct CorpusFingerprint {
    root: PathBuf,
    // The manifest's own size + mtime, so a books.json edit that does not change
    // any book file (a retitle, a kind change) still busts the cache.
    manifest_len: u64,
    manifest_modified_nanos: u128,
    files: Vec<FileFingerprint>,
}

#[derive(Debug, Clone)]
struct Chunk {
    id: String,
    source_id: String,
    title: String,
    author: String,
    heading: String,
    line_start: usize,
    line_end: usize,
    body: String,
    visual_dependency: bool,
    terms: HashMap<String, usize>,
    len: usize,
}

#[derive(Debug)]
struct CachedCorpus {
    fingerprint: CorpusFingerprint,
    chunks: Vec<Chunk>,
    document_frequency: HashMap<String, usize>,
    average_len: f64,
    manifest_len: usize,
    indexed_sources: Vec<String>,
    warnings: Vec<String>,
}

static CACHE: OnceLock<Mutex<HashMap<PathBuf, Arc<CachedCorpus>>>> = OnceLock::new();

/// Search the external corpus. Every filesystem error degrades into an honest
/// status/warning rather than making the Brain unusable.
pub fn search(dir: &Path, query: &str, limit: usize) -> CorpusSearch {
    match load_cached(dir) {
        Ok(corpus) => {
            let hits = corpus.retrieve(query, limit.clamp(4, DEFAULT_HITS));
            CorpusSearch {
                status: if corpus.indexed_sources.is_empty() {
                    CorpusStatus::Unavailable
                } else if corpus.indexed_sources.len() == corpus.manifest_len {
                    CorpusStatus::Ready
                } else {
                    CorpusStatus::Partial
                },
                hits,
                indexed_sources: corpus.indexed_sources.clone(),
                warnings: corpus.warnings.clone(),
            }
        }
        Err(message) => CorpusSearch {
            status: CorpusStatus::Unavailable,
            hits: Vec::new(),
            indexed_sources: Vec::new(),
            warnings: vec![message],
        },
    }
}

fn load_cached(dir: &Path) -> Result<Arc<CachedCorpus>, String> {
    let root = validated_root(dir)?;
    let books = load_manifest(&root)?;
    let fingerprint = fingerprint(&root, &books)?;
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(cached) = cache
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(&root)
        .filter(|cached| cached.fingerprint == fingerprint)
        .cloned()
    {
        return Ok(cached);
    }

    let built = Arc::new(build(&books, fingerprint)?);
    cache
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(root, built.clone());
    Ok(built)
}

fn manifest_signature(root: &Path) -> (u64, u128) {
    match fs::symlink_metadata(root.join(MANIFEST_NAME)) {
        Ok(metadata) => (metadata.len(), modified_nanos(&metadata)),
        Err(_) => (0, 0),
    }
}

fn modified_nanos(metadata: &fs::Metadata) -> u128 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_nanos())
}

fn fingerprint(root: &Path, books: &[BookEntry]) -> Result<CorpusFingerprint, String> {
    let (manifest_len, manifest_modified_nanos) = manifest_signature(root);
    let mut total = 0_u64;
    let mut files = Vec::new();
    for book in books {
        // A malformed manifest file name is skipped, never joined blindly: the
        // book is simply treated as unavailable.
        if !is_safe_file_name(&book.file_name) {
            continue;
        }
        let path = root.join(&book.file_name);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            continue;
        }
        let canonical = path
            .canonicalize()
            .map_err(|_| format!("Could not validate {}", book.file_name))?;
        if canonical.parent() != Some(root) {
            return Err(format!("{} escapes the knowledge folder", book.file_name));
        }
        if metadata.len() > MAX_BOOK_BYTES {
            return Err(format!("{} exceeds the 5 MB text limit", book.file_name));
        }
        total = total.saturating_add(metadata.len());
        if total > MAX_CORPUS_BYTES {
            return Err("Knowledge corpus exceeds the 12 MB text limit".into());
        }
        files.push(FileFingerprint {
            name: book.file_name.clone(),
            len: metadata.len(),
            modified_nanos: modified_nanos(&metadata),
        });
    }
    Ok(CorpusFingerprint {
        root: root.to_path_buf(),
        manifest_len,
        manifest_modified_nanos,
        files,
    })
}

fn build(books: &[BookEntry], fingerprint: CorpusFingerprint) -> Result<CachedCorpus, String> {
    let manifest_len = books.len();
    let mut chunks = Vec::new();
    let mut indexed_sources = Vec::new();
    let mut warnings = Vec::new();
    for book in books {
        let path = fingerprint.root.join(&book.file_name);
        if !fingerprint
            .files
            .iter()
            .any(|file| file.name == book.file_name)
        {
            warnings.push(format!("{} was not indexed", book.title));
            continue;
        }
        let raw = fs::read_to_string(&path)
            .map_err(|_| format!("{} is not readable UTF-8 text", book.file_name))?;
        let mut book_chunks = chunk_book(book, &raw);
        if book_chunks.is_empty() {
            warnings.push(format!("{} contained no usable text", book.title));
        } else {
            indexed_sources.push(format!("{} — {}", book.author, book.title));
            chunks.append(&mut book_chunks);
        }
    }

    let mut document_frequency = HashMap::<String, usize>::new();
    for chunk in &chunks {
        for term in chunk.terms.keys() {
            *document_frequency.entry(term.clone()).or_default() += 1;
        }
    }
    let average_len = if chunks.is_empty() {
        1.0
    } else {
        chunks.iter().map(|chunk| chunk.len).sum::<usize>() as f64 / chunks.len() as f64
    };
    Ok(CachedCorpus {
        fingerprint,
        chunks,
        document_frequency,
        average_len,
        manifest_len,
        indexed_sources,
        warnings,
    })
}

impl CachedCorpus {
    fn retrieve(&self, query: &str, limit: usize) -> Vec<CorpusHit> {
        if self.chunks.is_empty() {
            return Vec::new();
        }
        let query_terms = expanded_terms(query);
        if query_terms.is_empty() {
            return Vec::new();
        }
        let query_set = query_terms.iter().cloned().collect::<HashSet<_>>();
        let corpus_len = self.chunks.len() as f64;
        let priorities = source_priorities(query);
        let mut scored = self
            .chunks
            .iter()
            .filter_map(|chunk| {
                let mut score = 0.0;
                for term in &query_terms {
                    let Some(tf) = chunk.terms.get(term).copied() else {
                        continue;
                    };
                    let df = *self.document_frequency.get(term).unwrap_or(&1) as f64;
                    let idf = (((corpus_len - df + 0.5) / (df + 0.5)) + 1.0).ln();
                    let tf = tf as f64;
                    let norm = tf
                        + 1.2
                            * (1.0 - 0.75 + 0.75 * (chunk.len as f64 / self.average_len.max(1.0)));
                    score += idf * (tf * 2.2) / norm;
                }
                let heading_terms = tokenize(&chunk.heading).into_iter().collect::<HashSet<_>>();
                score += heading_terms.intersection(&query_set).count() as f64 * 1.45;
                score += priorities
                    .get(chunk.source_id.as_str())
                    .copied()
                    .unwrap_or(0.0);
                (score > 0.35).then_some((score, chunk))
            })
            .collect::<Vec<_>>();
        scored.sort_by(|(score_a, chunk_a), (score_b, chunk_b)| {
            score_b
                .total_cmp(score_a)
                .then_with(|| chunk_a.id.cmp(&chunk_b.id))
        });

        let mut per_source = HashMap::<&str, usize>::new();
        let mut hits = Vec::new();
        for (score, chunk) in scored {
            let count = per_source.entry(chunk.source_id.as_str()).or_default();
            if *count >= 2 {
                continue;
            }
            *count += 1;
            hits.push(CorpusHit {
                id: chunk.id.clone(),
                source_id: chunk.source_id.clone(),
                title: chunk.title.clone(),
                author: chunk.author.clone(),
                heading: chunk.heading.clone(),
                locator: format!(
                    "{} · lines {}–{}",
                    chunk.heading, chunk.line_start, chunk.line_end
                ),
                body: excerpt(&chunk.body, MAX_HIT_BODY_CHARS),
                visual_dependency: chunk.visual_dependency,
                score,
            });
            if hits.len() >= limit {
                break;
            }
        }
        hits
    }
}

fn chunk_book(book: &BookEntry, raw: &str) -> Vec<Chunk> {
    let mut headings = BTreeMap::<usize, String>::new();
    let mut paragraphs = Vec::<(usize, usize, String, String, bool)>::new();
    let mut paragraph = String::new();
    let mut paragraph_start = 0;
    let mut paragraph_end = 0;
    let mut in_frontmatter = false;

    let flush = |paragraphs: &mut Vec<(usize, usize, String, String, bool)>,
                 paragraph: &mut String,
                 start: usize,
                 end: usize,
                 headings: &BTreeMap<usize, String>| {
        let body = clean_markup(paragraph);
        if body.chars().count() >= 40 {
            let heading = if headings.is_empty() {
                book.title.to_string()
            } else {
                headings.values().cloned().collect::<Vec<_>>().join(" › ")
            };
            let visual = book.visual_dependency && contains_visual_reference(paragraph);
            paragraphs.push((start, end, heading, body, visual));
        }
        paragraph.clear();
    };

    for (index, line) in raw.lines().enumerate() {
        let line_number = index + 1;
        if line_number == 1 && line.trim() == "---" {
            in_frontmatter = true;
            continue;
        }
        if in_frontmatter {
            if line.trim() == "---" {
                in_frontmatter = false;
            }
            continue;
        }
        let trimmed = line.trim();
        let hashes = trimmed
            .chars()
            .take_while(|character| *character == '#')
            .count();
        if (1..=6).contains(&hashes) && trimmed.chars().nth(hashes) == Some(' ') {
            flush(
                &mut paragraphs,
                &mut paragraph,
                paragraph_start,
                paragraph_end,
                &headings,
            );
            let heading = clean_markup(trimmed[hashes..].trim());
            headings.retain(|level, _| *level < hashes);
            if !heading.is_empty() {
                headings.insert(hashes, heading);
            }
            continue;
        }
        if trimmed.is_empty() {
            flush(
                &mut paragraphs,
                &mut paragraph,
                paragraph_start,
                paragraph_end,
                &headings,
            );
            continue;
        }
        if paragraph.is_empty() {
            paragraph_start = line_number;
        } else {
            paragraph.push(' ');
        }
        paragraph.push_str(trimmed);
        paragraph_end = line_number;
    }
    flush(
        &mut paragraphs,
        &mut paragraph,
        paragraph_start,
        paragraph_end,
        &headings,
    );

    let mut output = Vec::new();
    let mut body = String::new();
    let mut heading = String::new();
    let mut start = 0;
    let mut end = 0;
    let mut visual = false;
    let push_chunk = |output: &mut Vec<Chunk>,
                      body: &mut String,
                      heading: &str,
                      start: usize,
                      end: usize,
                      visual: bool| {
        if body.is_empty() {
            return;
        }
        let ordinal = output.len() + 1;
        let terms = term_frequencies(&format!("{heading} {body}"));
        let len = terms.values().sum::<usize>().max(1);
        output.push(Chunk {
            id: format!("local:{}:{ordinal}", book.id),
            source_id: book.id.clone(),
            title: book.title.clone(),
            author: book.author.clone(),
            heading: heading.to_string(),
            line_start: start,
            line_end: end,
            body: std::mem::take(body),
            visual_dependency: visual,
            terms,
            len,
        });
    };

    for (p_start, p_end, p_heading, p_body, p_visual) in paragraphs {
        if !body.is_empty()
            && (heading != p_heading
                || body.chars().count() + p_body.chars().count() + 2 > MAX_CHUNK_CHARS)
        {
            push_chunk(&mut output, &mut body, &heading, start, end, visual);
            visual = false;
        }
        if body.is_empty() {
            heading = p_heading;
            start = p_start;
        }
        if !body.is_empty() {
            body.push_str("\n\n");
        }
        // Exceptionally long converted paragraphs are bounded instead of
        // turning a single retrieval hit into a provider-context overflow.
        body.extend(p_body.chars().take(MAX_CHUNK_CHARS));
        end = p_end;
        visual |= p_visual;
    }
    push_chunk(&mut output, &mut body, &heading, start, end, visual);
    output
}

fn clean_markup(value: &str) -> String {
    let value = strip_markdown_targets(value);
    let mut output = String::with_capacity(value.len());
    let mut in_tag = false;
    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => output.push(character),
            _ => {}
        }
    }
    for (from, to) in [
        ("&nbsp;", " "),
        ("&amp;", "&"),
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&quot;", "\""),
        ("&#39;", "'"),
    ] {
        output = output.replace(from, to);
    }
    output
        .replace(['*', '`'], "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Keep human-readable labels while removing local image/link targets. The
/// converted books contain relative asset paths that are neither useful to the
/// model nor safe to expose as citation text.
fn strip_markdown_targets(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut remaining = value;
    loop {
        let Some((start, label_start, label_end, target_end)) = next_markdown_target(remaining)
        else {
            output.push_str(remaining);
            break;
        };
        output.push_str(&remaining[..start]);
        output.push_str(&remaining[label_start..label_end]);
        remaining = &remaining[target_end..];
    }
    output
}

fn next_markdown_target(value: &str) -> Option<(usize, usize, usize, usize)> {
    for (bracket, _) in value.match_indices('[') {
        let image = value[..bracket].ends_with('!');
        let start = bracket.saturating_sub(usize::from(image));
        let label_start = bracket + 1;
        let Some(label_offset) = value[label_start..].find(']') else {
            continue;
        };
        let label_end = label_offset + label_start;
        if !value[label_end..].starts_with("](") {
            continue;
        }
        let target_start = label_end + 2;
        let mut depth = 1_u32;
        for (offset, character) in value[target_start..].char_indices() {
            match character {
                '(' => depth = depth.saturating_add(1),
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some((start, label_start, label_end, target_start + offset + 1));
                    }
                }
                _ => {}
            }
        }
    }
    None
}

fn contains_visual_reference(value: &str) -> bool {
    let value = value.to_ascii_lowercase();
    value.contains("<img")
        || value.contains("![")
        || value.contains("figure ")
        || value.contains("illustration")
        || value.contains("music example")
        || value.contains("see example")
}

fn term_frequencies(value: &str) -> HashMap<String, usize> {
    let mut frequencies = HashMap::new();
    for token in tokenize(value) {
        *frequencies.entry(token).or_default() += 1;
    }
    frequencies
}

fn tokenize(value: &str) -> Vec<String> {
    value
        .split(|character: char| !character.is_alphanumeric())
        .filter_map(|token| {
            let token = token.to_ascii_lowercase();
            (token.chars().count() >= 3).then(|| stem(&token))
        })
        .collect()
}

fn stem(token: &str) -> String {
    for suffix in [
        "ingly", "edly", "ation", "ments", "ment", "ness", "ing", "ies", "ied", "ed", "es", "s",
    ] {
        if token.len() > suffix.len() + 3 && token.ends_with(suffix) {
            return if suffix == "ies" || suffix == "ied" {
                format!("{}y", &token[..token.len() - suffix.len()])
            } else {
                token[..token.len() - suffix.len()].to_string()
            };
        }
    }
    token.to_string()
}

fn expanded_terms(query: &str) -> Vec<String> {
    let mut terms = tokenize(query);
    let originals = terms.iter().cloned().collect::<HashSet<_>>();
    let groups: &[(&[&str], &[&str])] = &[
        (
            &["wrong", "incorrect", "mistake", "memorized", "memory"],
            &[
                "error",
                "habit",
                "persistent",
                "pathway",
                "old",
                "new",
                "reinforce",
                "retrieval",
            ],
        ),
        (
            &["slow", "slower", "plateau", "faster", "speed", "tempo"],
            &[
                "metronome",
                "chunk",
                "rhythm",
                "interleave",
                "fast",
                "click",
            ],
        ),
        (
            &["leap", "jump", "landing", "miss"],
            &["lateral", "arrival", "distance", "eyes", "silent"],
        ),
        (
            &["rhythm", "pulse", "beat", "rush"],
            &["subdivision", "metronome", "clap", "count", "coordination"],
        ),
        (
            &[
                "pain", "numb", "numbness", "hurt", "injury", "wrist", "tight",
            ],
            &[
                "stop", "tension", "weakness", "medical", "health", "release",
            ],
        ),
    ];
    for (triggers, additions) in groups {
        if triggers
            .iter()
            .map(|term| stem(term))
            .any(|term| originals.contains(&term))
        {
            terms.extend(additions.iter().map(|term| stem(term)));
        }
    }
    terms.sort();
    terms.dedup();
    terms
}

fn source_priorities(query: &str) -> HashMap<&'static str, f64> {
    let terms = tokenize(query).into_iter().collect::<HashSet<_>>();
    let has = |values: &[&str]| {
        values
            .iter()
            .map(|value| stem(value))
            .any(|value| terms.contains(&value))
    };
    let mut output = HashMap::new();
    if has(&[
        "wrist", "pain", "injury", "tension", "leap", "octave", "thumb", "posture", "tone",
    ]) {
        output.insert("roskell-complete-pianist", 2.4);
    }
    if has(&[
        "wrong",
        "mistake",
        "memory",
        "memorized",
        "learn",
        "slow",
        "speed",
        "tempo",
        "schedule",
        "next day",
    ]) {
        output.insert("gebrian-learn-faster", 2.2);
    }
    if has(&["drill", "jump", "rhythm", "voicing", "pedal", "connection"]) {
        output.insert("breth-effective-practicing", 1.8);
    }
    if has(&[
        "concentration",
        "mental",
        "memory",
        "memorize",
        "visualize",
        "score",
        "study",
    ]) {
        output.insert("gieseking-leimer-technique", 1.7);
    }
    output
}

fn excerpt(value: &str, max_chars: usize) -> String {
    let mut output = value.chars().take(max_chars).collect::<String>();
    if value.chars().count() > max_chars {
        output.push('…');
    }
    output
}

// ---------------------------------------------------------------------------
// Book library (D3): data-driven manifest management + the excerpt reader (D2).
// Every function anchors on `validated_root` so no file operation can escape the
// knowledge folder, and no book is ever hard-deleted.
// ---------------------------------------------------------------------------

/// One manifest entry plus whether its file is present on disk. Serialized to
/// the Settings "Books" panel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BookListing {
    pub id: String,
    pub file_name: String,
    pub title: String,
    pub author: String,
    pub kind: BookKind,
    pub visual_dependency: bool,
    pub available: bool,
}

/// The reader payload for D2: the markdown section around a quote.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BookExcerpt {
    pub source_id: String,
    pub title: String,
    pub author: String,
    pub heading: String,
    pub text: String,
}

fn listing_of(root: &Path, entry: BookEntry) -> BookListing {
    let available = book_is_available(root, &entry.file_name);
    BookListing {
        id: entry.id,
        file_name: entry.file_name,
        title: entry.title,
        author: entry.author,
        kind: entry.kind,
        visual_dependency: entry.visual_dependency,
        available,
    }
}

/// True when the named file exists directly beneath `root` as a regular
/// (non-symlink) file. Anything unsafe or off-root reads as unavailable.
fn book_is_available(root: &Path, file_name: &str) -> bool {
    if !is_safe_file_name(file_name) {
        return false;
    }
    let path = root.join(file_name);
    let Ok(metadata) = fs::symlink_metadata(&path) else {
        return false;
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return false;
    }
    path.canonicalize()
        .map(|canonical| canonical.parent() == Some(root))
        .unwrap_or(false)
}

/// A bare, in-directory filename with no traversal. Rejects separators, `.`,
/// `..`, and anything that is not a single normal path component.
fn is_safe_file_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains('\0')
        && name != "."
        && name != ".."
        && Path::new(name).file_name() == Some(std::ffi::OsStr::new(name))
}

/// Lowercase alphanumeric runs joined by single hyphens. Used for ids and file
/// stems so both stay path-safe.
fn slug(value: &str) -> String {
    let mut output = String::new();
    let mut pending_dash = false;
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            if pending_dash && !output.is_empty() {
                output.push('-');
            }
            pending_dash = false;
            output.extend(character.to_lowercase());
        } else if !output.is_empty() {
            pending_dash = true;
        }
    }
    output
}

fn split_ext(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(index) if index > 0 => (&name[..index], &name[index..]),
        _ => (name, ""),
    }
}

fn unique_id(books: &[BookEntry], desired: &str) -> String {
    let base = if desired.is_empty() { "book" } else { desired };
    if !books.iter().any(|book| book.id == base) {
        return base.to_string();
    }
    let mut n = 2;
    loop {
        let candidate = format!("{base}-{n}");
        if !books.iter().any(|book| book.id == candidate) {
            return candidate;
        }
        n += 1;
    }
}

fn unique_file_name(root: &Path, books: &[BookEntry], desired: &str) -> String {
    let taken = |candidate: &str| {
        books.iter().any(|book| book.file_name == candidate) || root.join(candidate).exists()
    };
    if !taken(desired) {
        return desired.to_string();
    }
    let (stem, ext) = split_ext(desired);
    let mut n = 2;
    loop {
        let candidate = format!("{stem}-{n}{ext}");
        if !taken(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

fn unique_trash_name(trash: &Path, desired: &str) -> String {
    if !trash.join(desired).exists() {
        return desired.to_string();
    }
    let (stem, ext) = split_ext(desired);
    let mut n = 2;
    loop {
        let candidate = format!("{stem}-{n}{ext}");
        if !trash.join(&candidate).exists() {
            return candidate;
        }
        n += 1;
    }
}

/// Manifest entries plus per-book availability.
pub fn list_books(dir: &Path) -> Result<Vec<BookListing>, String> {
    let root = validated_root(dir)?;
    let books = load_manifest(&root)?;
    Ok(books
        .into_iter()
        .map(|book| listing_of(&root, book))
        .collect())
}

/// Copy a readable `.md` source into the knowledge folder (collision-safe) and
/// append a manifest entry with a unique, slugged id. The frontend owns the
/// dialog; this validates and acts.
pub fn add_book(
    dir: &Path,
    source: &Path,
    title: &str,
    author: &str,
    kind: BookKind,
) -> Result<BookListing, String> {
    let root = validated_root(dir)?;
    let title = title.trim();
    if title.is_empty() {
        return Err("A book needs a title".into());
    }
    let author = author.trim();

    let source_meta = fs::symlink_metadata(source)
        .map_err(|_| "The selected file could not be read".to_string())?;
    if source_meta.file_type().is_symlink() || !source_meta.is_file() {
        return Err("The selected source must be a regular file".into());
    }
    let is_markdown = source
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"));
    if !is_markdown {
        return Err("Only Markdown (.md) books are supported this round".into());
    }
    if source_meta.len() > MAX_BOOK_BYTES {
        return Err("That book exceeds the 5 MB text limit".into());
    }
    // A source that is not readable UTF-8 would never index; reject it now.
    fs::read_to_string(source)
        .map_err(|_| "The book must be readable UTF-8 Markdown".to_string())?;

    let mut books = load_manifest(&root)?;
    let base_stem = {
        let from_source = source
            .file_stem()
            .and_then(|stem| stem.to_str())
            .map(slug)
            .unwrap_or_default();
        if from_source.is_empty() {
            let from_title = slug(title);
            if from_title.is_empty() {
                "book".to_string()
            } else {
                from_title
            }
        } else {
            from_source
        }
    };
    let file_name = unique_file_name(&root, &books, &format!("{base_stem}.md"));
    let destination = root.join(&file_name);
    fs::copy(source, &destination)
        .map_err(|_| "Could not copy the book into the knowledge folder".to_string())?;
    // Defense in depth: prove the copy landed directly beneath the root.
    match destination.canonicalize() {
        Ok(canonical) if canonical.parent() == Some(root.as_path()) => {}
        _ => {
            let _ = fs::remove_file(&destination);
            return Err("Book copy escaped the knowledge folder".into());
        }
    }

    let entry = BookEntry {
        id: unique_id(&books, &slug(title)),
        file_name,
        title: title.to_string(),
        author: author.to_string(),
        kind,
        // book_add carries no visual flag; added books default to false and can
        // be curated in the manifest later.
        visual_dependency: false,
    };
    books.push(entry.clone());
    if let Err(error) = write_manifest(&root, &books) {
        // Do not leave an orphaned copy if the manifest could not record it.
        let _ = fs::remove_file(&destination);
        return Err(error);
    }
    Ok(listing_of(&root, entry))
}

/// Remove a manifest entry and move its file into `.trash/` (never hard-delete).
/// Built-in books are removable by the same path.
pub fn remove_book(dir: &Path, id: &str) -> Result<(), String> {
    let root = validated_root(dir)?;
    let mut books = load_manifest(&root)?;
    let index = books
        .iter()
        .position(|book| book.id == id)
        .ok_or_else(|| "That book is not in the library".to_string())?;
    let entry = books[index].clone();

    // Trash the file first; only commit the manifest change if that succeeds, so
    // a failed move never loses the entry that still points at the file.
    if is_safe_file_name(&entry.file_name) {
        let source = root.join(&entry.file_name);
        if source.exists() {
            let trash = root.join(TRASH_DIR);
            fs::create_dir_all(&trash)
                .map_err(|_| "Could not prepare the trash folder".to_string())?;
            let dest_name = unique_trash_name(&trash, &entry.file_name);
            let destination = trash.join(&dest_name);
            fs::rename(&source, &destination)
                .or_else(|_| {
                    // Fall back to copy+remove across filesystem boundaries.
                    fs::copy(&source, &destination)
                        .and_then(|_| fs::remove_file(&source))
                        .map(|_| ())
                })
                .map_err(|_| "Could not move the book to the trash folder".to_string())?;
        }
    }

    books.remove(index);
    write_manifest(&root, &books)?;
    Ok(())
}

/// The markdown section around a quote (D2). Resolves by verbatim `contains`
/// substring first (the precise path for quotes.json), then falls back to the
/// nearest `heading` match. Either may be supplied; a missing match is honest.
pub fn book_excerpt(
    dir: &Path,
    source_id: &str,
    heading: Option<&str>,
    contains: Option<&str>,
) -> Result<BookExcerpt, String> {
    let root = validated_root(dir)?;
    let books = load_manifest(&root)?;
    let book = books
        .iter()
        .find(|book| book.id == source_id)
        .ok_or_else(|| "That book is not in the library".to_string())?;
    if !is_safe_file_name(&book.file_name) {
        return Err("That book's file name is invalid".into());
    }
    let path = root.join(&book.file_name);
    let metadata =
        fs::symlink_metadata(&path).map_err(|_| "That book's file is missing".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("That book's file is not a regular file".into());
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "That book's file could not be read".to_string())?;
    if canonical.parent() != Some(root.as_path()) {
        return Err("That book escapes the knowledge folder".into());
    }
    let raw = fs::read_to_string(&path)
        .map_err(|_| "That book is not readable UTF-8 text".to_string())?;
    let section = find_section(&raw, heading, contains)
        .ok_or_else(|| "Could not find that passage in the book".to_string())?;
    Ok(BookExcerpt {
        source_id: book.id.clone(),
        title: book.title.clone(),
        author: book.author.clone(),
        heading: section.heading,
        text: section.text,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct HeadingRec {
    line: usize,
    level: usize,
    text: String,
}

struct Section {
    heading: String,
    text: String,
}

fn collect_headings(lines: &[&str]) -> Vec<HeadingRec> {
    let mut headings = Vec::new();
    let mut in_frontmatter = false;
    for (index, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if index == 0 && trimmed == "---" {
            in_frontmatter = true;
            continue;
        }
        if in_frontmatter {
            if trimmed == "---" {
                in_frontmatter = false;
            }
            continue;
        }
        let hashes = trimmed.chars().take_while(|c| *c == '#').count();
        if (1..=6).contains(&hashes) && trimmed.chars().nth(hashes) == Some(' ') {
            let text = clean_markup(trimmed[hashes..].trim());
            if !text.is_empty() {
                headings.push(HeadingRec {
                    line: index,
                    level: hashes,
                    text,
                });
            }
        }
    }
    headings
}

/// The section body: lines after the heading up to the next heading of the same
/// or higher level (a lower hash count), trimmed of surrounding blank lines.
fn section_at(lines: &[&str], headings: &[HeadingRec], index: usize) -> Section {
    let current = &headings[index];
    let end = headings
        .iter()
        .skip(index + 1)
        .find(|other| other.level <= current.level)
        .map(|other| other.line)
        .unwrap_or(lines.len());
    let text = lines
        .get(current.line + 1..end)
        .unwrap_or(&[])
        .join("\n")
        .trim()
        .to_string();
    Section {
        heading: current.text.clone(),
        text,
    }
}

/// Collapse the source's whitespace so a single-line quote matches hard-wrapped
/// prose, while returning a per-byte map back to raw byte offsets. Intra-
/// paragraph whitespace (spaces, tabs, a single hard-wrap newline) becomes one
/// space; a paragraph break (a blank line — two or more newlines) becomes a
/// single `\n` sentinel. Because a normalized needle carries only spaces, it can
/// never match across that sentinel, so a quote that straddles a paragraph
/// boundary is correctly rejected rather than stitched into a false positive.
fn normalize_with_map(raw: &str) -> (String, Vec<usize>) {
    let mut normalized = String::with_capacity(raw.len());
    let mut map = Vec::with_capacity(raw.len());
    let mut chars = raw.char_indices().peekable();
    while let Some((index, character)) = chars.next() {
        if character.is_whitespace() {
            let mut newlines = usize::from(character == '\n');
            while let Some(&(_, next)) = chars.peek() {
                if next.is_whitespace() {
                    newlines += usize::from(next == '\n');
                    chars.next();
                } else {
                    break;
                }
            }
            // Leading whitespace is dropped so offsets stay aligned to content.
            if normalized.is_empty() {
                continue;
            }
            normalized.push(if newlines >= 2 { '\n' } else { ' ' });
            map.push(index);
        } else {
            let start = normalized.len();
            normalized.push(character);
            for offset in 0..(normalized.len() - start) {
                map.push(index + offset);
            }
        }
    }
    (normalized, map)
}

/// A quote is a single paragraph: every whitespace run collapses to one space,
/// ends trimmed. Matches exactly how quotes.json was verbatim-verified.
fn normalize_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn line_of_substring(raw: &str, needle: &str) -> Option<usize> {
    let needle = normalize_whitespace(needle);
    if needle.is_empty() {
        return None;
    }
    let (normalized, map) = normalize_with_map(raw);
    let position = normalized.find(&needle)?;
    let raw_offset = *map.get(position)?;
    Some(
        raw[..raw_offset]
            .bytes()
            .filter(|byte| *byte == b'\n')
            .count(),
    )
}

/// The final segment of a breadcrumb heading path, so a stored locator like
/// "Foundations › Concentration and mental study" matches the leaf markdown
/// heading. Tolerates both the corpus separator `›` and a plain `>`.
fn heading_leaf(query: &str) -> &str {
    query
        .rsplit(['›', '>'])
        .next()
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .unwrap_or_else(|| query.trim())
}

fn match_heading_index(headings: &[HeadingRec], query: &str) -> Option<usize> {
    let query = heading_leaf(query);
    if let Some(index) = headings
        .iter()
        .position(|heading| heading.text.eq_ignore_ascii_case(query))
    {
        return Some(index);
    }
    let lowered = query.to_ascii_lowercase();
    headings.iter().position(|heading| {
        let text = heading.text.to_ascii_lowercase();
        text.contains(&lowered) || lowered.contains(&text)
    })
}

fn find_section(raw: &str, heading: Option<&str>, contains: Option<&str>) -> Option<Section> {
    let lines: Vec<&str> = raw.lines().collect();
    let headings = collect_headings(&lines);

    // Verbatim substring is the precise locator: resolve to the governing
    // heading's section, or the preamble when the match precedes any heading.
    if let Some(needle) = contains.map(str::trim).filter(|value| !value.is_empty()) {
        if let Some(line) = line_of_substring(raw, needle) {
            if let Some(index) = headings.iter().rposition(|heading| heading.line <= line) {
                return Some(section_at(&lines, &headings, index));
            }
            let end = headings
                .first()
                .map(|heading| heading.line)
                .unwrap_or(lines.len());
            let text = lines
                .get(0..end)
                .unwrap_or(&[])
                .join("\n")
                .trim()
                .to_string();
            if !text.is_empty() {
                return Some(Section {
                    heading: String::new(),
                    text,
                });
            }
        }
    }

    // Fall back to (or start from) the nearest heading match.
    if let Some(query) = heading.map(str::trim).filter(|value| !value.is_empty()) {
        if let Some(index) = match_heading_index(&headings, query) {
            return Some(section_at(&lines, &headings, index));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn book_file(index: usize) -> String {
        builtin_books()[index].file_name.clone()
    }

    fn corpus() -> TempDir {
        let temp = TempDir::new().unwrap();
        fs::write(
            temp.path().join(book_file(0)),
            "# Technique\n\n## Leaps and lateral movements\nLook ahead before a lateral jump and organize the arrival without a rigid wrist.\n\n## Preventing injury\nPain, numbness, weakness, or loss of movement means stop playing and seek qualified help.\n\n## More complex rhythms and polyrhythms\nUnderstand the composite rhythm and keep a steady pulse.",
        ).unwrap();
        fs::write(
            temp.path().join(book_file(1)),
            "# Learning\n\n## Why bad habits are so persistent\nRepeating an error strengthens the wrong pathway.\n\n## Old way/new way\nContrast the old version with the intended new version, then retrieve the new pathway.\n\n## Common practicing mistake #2: playing slowly with a metronome\nMerely playing through slowly over and over can repeat the same mistake without changing the plan.\n\n## How to Play Faster\nUse rhythms, interleaved clicking up, at-tempo chunking, and irregular groupings.",
        ).unwrap();
        fs::write(
            temp.path().join(book_file(2)),
            "# Tools\n\n## JUMPS\nPractice the landing and connection of a jump.\n\n## RHYTHMS\nChange rhythmic groupings, then return to the written rhythm.\n\n## SUBDIVISION\nCount the smallest pulse before rebuilding the passage.",
        ).unwrap();
        fs::write(
            temp.path().join(book_file(3)),
            "# Foundations\n\n## Concentration and mental study\nStudy the score with full concentration and form a clear mental image before repeating mechanically.\n\n## Memory\nBuild memory from conscious score knowledge rather than relying only on muscular habit.",
        ).unwrap();
        temp
    }

    fn headings(search: CorpusSearch) -> String {
        search
            .hits
            .into_iter()
            .map(|hit| hit.heading)
            .collect::<Vec<_>>()
            .join(" | ")
    }

    #[test]
    fn wrong_memorization_and_ineffective_slow_practice_route_to_gebrian() {
        let temp = corpus();
        let result = headings(search(
            temp.path(),
            "I played it wrong so often that the wrong version is memorized",
            6,
        ));
        assert!(
            result.contains("bad habits") || result.contains("Old way/new way"),
            "{result}"
        );
        let slow_result = headings(search(
            temp.path(),
            "Playing slowly over and over is not fixing the mistake",
            6,
        ));
        assert!(slow_result.contains("playing slowly"), "{slow_result}");
    }

    #[test]
    fn tempo_plateau_routes_to_speed_section() {
        let temp = corpus();
        let result = headings(search(
            temp.path(),
            "I am stuck at a slow tempo and cannot get faster",
            6,
        ));
        assert!(result.contains("How to Play Faster"), "{result}");
    }

    #[test]
    fn leap_rhythm_and_pain_queries_have_authoritative_matches() {
        let temp = corpus();
        let leap = headings(search(
            temp.path(),
            "the left hand leap keeps missing its landing",
            6,
        ));
        assert!(
            leap.contains("Leaps and lateral") || leap.contains("JUMPS"),
            "{leap}"
        );
        let rhythm = headings(search(
            temp.path(),
            "I cannot remember the rhythm and lose the pulse",
            6,
        ));
        assert!(
            rhythm.contains("rhythms")
                || rhythm.contains("RHYTHMS")
                || rhythm.contains("SUBDIVISION"),
            "{rhythm}"
        );
        let pain = headings(search(temp.path(), "my wrist hurts and feels numb", 6));
        assert!(pain.contains("Preventing injury"), "{pain}");
    }

    #[test]
    fn mental_score_study_can_retrieve_gieseking_and_leimer() {
        let temp = corpus();
        let result = search(
            temp.path(),
            "How should I mentally study and memorize the score away from the piano?",
            6,
        );
        assert!(result
            .hits
            .iter()
            .any(|hit| hit.source_id == "gieseking-leimer-technique"));
    }

    #[test]
    fn only_exact_direct_regular_book_files_are_opened() {
        let temp = corpus();
        fs::write(temp.path().join("secret.md"), "secret material").unwrap();
        let search = search(temp.path(), "secret material", 6);
        assert!(search.hits.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_book_is_not_followed() {
        use std::os::unix::fs::symlink;
        let temp = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("book.md"), "# Secret\n\noutside secret").unwrap();
        symlink(
            outside.path().join("book.md"),
            temp.path().join(book_file(0)),
        )
        .unwrap();
        let result = search(temp.path(), "outside secret", 6);
        assert!(result.hits.is_empty());
        assert_eq!(result.status, CorpusStatus::Unavailable);
    }

    #[test]
    fn html_conversion_markup_is_removed_and_locator_is_preserved() {
        assert_eq!(
            clean_markup("<span class=\"b\">Old &amp; New</span>"),
            "Old & New"
        );
        let temp = corpus();
        let result = search(temp.path(), "old pathway", 6);
        assert!(result.hits.iter().all(|hit| hit.locator.contains("lines")));
        assert!(result.hits.iter().all(|hit| !hit.body.contains("<span")));
    }

    #[test]
    fn markdown_asset_and_link_targets_are_removed_but_labels_remain() {
        let cleaned = clean_markup(
            "See ![released wrist](images/hands/wrist.png) and [chapter notes](../private/book.md#chapter).",
        );
        assert_eq!(cleaned, "See released wrist and chapter notes.");
        assert!(!cleaned.contains("images/"));
        assert!(!cleaned.contains("../"));

        let nested = clean_markup("[example](assets/figure(2).png)");
        assert_eq!(nested, "example");
    }

    #[test]
    #[ignore = "requires Christian's external Knowledge and Resources folder"]
    fn real_local_corpus_routes_wrong_memory_and_slow_repetition() {
        let result = search(
            Path::new(super::super::DEFAULT_KNOWLEDGE_DIR),
            "I memorized the wrong version and repeating it slowly is not fixing it",
            6,
        );
        assert_eq!(result.status, CorpusStatus::Ready);
        assert_eq!(result.indexed_sources.len(), 4);
        assert!(result
            .hits
            .iter()
            .any(|hit| hit.source_id == "gebrian-learn-faster"));
        assert!(result.hits.iter().any(|hit| {
            let heading = hit.heading.to_ascii_lowercase();
            heading.contains("bad habit")
                || heading.contains("old way")
                || heading.contains("playing slowly")
        }));
    }

    // -- D3 manifest / library command coverage ---------------------------

    #[test]
    fn missing_manifest_bootstraps_the_four_builtins_and_leaves_retrieval_intact() {
        let temp = corpus();
        assert!(
            !temp.path().join(MANIFEST_NAME).exists(),
            "corpus() writes only book files, no manifest"
        );

        // A retrieval read bootstraps the manifest from the built-ins.
        let result = search(temp.path(), "how do I land this leap", 6);
        assert_eq!(result.status, CorpusStatus::Ready);
        assert_eq!(result.indexed_sources.len(), 4);

        let raw = fs::read_to_string(temp.path().join(MANIFEST_NAME)).unwrap();
        let manifest: Manifest = serde_json::from_str(&raw).unwrap();
        let expected = builtin_books();
        assert_eq!(
            manifest.books, expected,
            "bootstrap preserves ids and flags"
        );
        // Verbatim id/flag guarantee for the retrieval-critical books.
        assert_eq!(manifest.books[1].id, "gebrian-learn-faster");
        assert!(!manifest.books[1].visual_dependency);
        assert!(manifest.books[0].visual_dependency);
    }

    #[test]
    fn list_books_reports_availability_against_the_manifest() {
        let temp = corpus();
        // Only three of the four built-in files are written by corpus() — the
        // fourth (Gieseking/Leimer) is present too, actually all four. Remove one
        // to prove availability reflects disk truth.
        fs::remove_file(temp.path().join(book_file(3))).unwrap();
        let listed = list_books(temp.path()).unwrap();
        assert_eq!(listed.len(), 4);
        let gieseking = listed
            .iter()
            .find(|book| book.id == "gieseking-leimer-technique")
            .unwrap();
        assert!(!gieseking.available);
        assert!(listed
            .iter()
            .filter(|book| book.id != "gieseking-leimer-technique")
            .all(|book| book.available));
    }

    #[test]
    fn add_book_copies_the_source_and_appends_a_unique_slugged_entry() {
        let temp = corpus();
        let source_dir = TempDir::new().unwrap();
        let source = source_dir.path().join("cortot-rational-principles.md");
        fs::write(
            &source,
            "# Rational Principles\n\n## Relaxation\nRelease the arm weight into the key bed and let the wrist float.",
        )
        .unwrap();

        let added = add_book(
            temp.path(),
            &source,
            "Rational Principles of Piano Technique",
            "Alfred Cortot",
            BookKind::Interpretation,
        )
        .unwrap();
        assert_eq!(added.id, "rational-principles-of-piano-technique");
        assert_eq!(added.kind, BookKind::Interpretation);
        assert!(added.available);
        // Copied INTO the knowledge dir.
        assert!(temp.path().join(&added.file_name).exists());
        // Appended to the manifest (now 5).
        let listed = list_books(temp.path()).unwrap();
        assert_eq!(listed.len(), 5);
        assert!(listed.iter().any(|book| book.id == added.id));
    }

    #[test]
    fn add_book_rejects_non_markdown_sources() {
        let temp = corpus();
        let source_dir = TempDir::new().unwrap();
        let source = source_dir.path().join("notes.txt");
        fs::write(&source, "not markdown").unwrap();
        let result = add_book(
            temp.path(),
            &source,
            "Notes",
            "Someone",
            BookKind::PracticeMethod,
        );
        assert!(result.is_err());
        assert_eq!(
            list_books(temp.path()).unwrap().len(),
            4,
            "manifest unchanged"
        );
    }

    #[test]
    fn add_book_rejects_a_path_escape_via_missing_source() {
        let temp = corpus();
        // A traversal path outside any real file must be rejected, and nothing
        // may be written into the knowledge folder.
        let escape = temp
            .path()
            .join("..")
            .join("..")
            .join("etc")
            .join("hosts.md");
        let result = add_book(
            temp.path(),
            &escape,
            "Escape",
            "Attacker",
            BookKind::PracticeMethod,
        );
        assert!(result.is_err());
        assert_eq!(list_books(temp.path()).unwrap().len(), 4);
    }

    #[test]
    fn add_book_makes_a_collision_safe_copy() {
        let temp = corpus();
        let source_dir = TempDir::new().unwrap();
        // Same stem as a built-in file name to force a collision.
        let source = source_dir.path().join("the-complete-pianist.md");
        fs::write(
            &source,
            "# Copy\n\n## Section\nA second complete-pianist file body.",
        )
        .unwrap();
        let added = add_book(
            temp.path(),
            &source,
            "Another Complete Pianist",
            "Someone Else",
            BookKind::PracticeMethod,
        )
        .unwrap();
        assert_ne!(added.file_name, "the-complete-pianist.md");
        assert!(temp.path().join("the-complete-pianist.md").exists());
        assert!(temp.path().join(&added.file_name).exists());
    }

    #[test]
    fn remove_book_drops_the_entry_and_trashes_the_file() {
        let temp = corpus();
        let removed_file = book_file(0);
        remove_book(temp.path(), "roskell-complete-pianist").unwrap();

        let listed = list_books(temp.path()).unwrap();
        assert_eq!(listed.len(), 3);
        assert!(!listed
            .iter()
            .any(|book| book.id == "roskell-complete-pianist"));
        // Original gone from the root, present under .trash (never hard-deleted).
        assert!(!temp.path().join(&removed_file).exists());
        assert!(temp.path().join(TRASH_DIR).join(&removed_file).exists());
    }

    #[test]
    fn remove_book_rejects_an_unknown_id() {
        let temp = corpus();
        assert!(remove_book(temp.path(), "does-not-exist").is_err());
        assert_eq!(list_books(temp.path()).unwrap().len(), 4);
    }

    #[test]
    fn retrieval_reads_a_fifth_added_book() {
        let temp = corpus();
        let source_dir = TempDir::new().unwrap();
        let source = source_dir.path().join("scales-and-arpeggios.md");
        fs::write(
            &source,
            "# Scales\n\n## Thumb passing under\nKeep the thumb passing under silent and even, with a supple wrist and no accent.",
        )
        .unwrap();
        let added = add_book(
            temp.path(),
            &source,
            "Scales and Arpeggios",
            "A Teacher",
            BookKind::PracticeMethod,
        )
        .unwrap();

        let result = search(
            temp.path(),
            "keep the thumb passing under silent and even",
            6,
        );
        assert_eq!(result.status, CorpusStatus::Ready);
        assert_eq!(result.indexed_sources.len(), 5);
        assert!(
            result.hits.iter().any(|hit| hit.source_id == added.id),
            "the added fifth book is retrievable"
        );
    }

    // -- D2 excerpt reader coverage ---------------------------------------

    #[test]
    fn excerpt_returns_the_section_under_a_heading() {
        let temp = corpus();
        let excerpt = book_excerpt(
            temp.path(),
            "gebrian-learn-faster",
            Some("Old way/new way"),
            None,
        )
        .unwrap();
        assert_eq!(excerpt.heading, "Old way/new way");
        assert_eq!(excerpt.author, "Molly Gebrian");
        assert!(excerpt.text.contains("Contrast the old version"));
        // Bounded to its own section: does not bleed into the next heading.
        assert!(!excerpt.text.contains("playing slowly"));
    }

    #[test]
    fn excerpt_locates_a_section_by_verbatim_contains() {
        let temp = corpus();
        let excerpt = book_excerpt(
            temp.path(),
            "gebrian-learn-faster",
            None,
            Some("Repeating an error strengthens the wrong pathway"),
        )
        .unwrap();
        assert_eq!(excerpt.heading, "Why bad habits are so persistent");
        assert!(excerpt
            .text
            .contains("Repeating an error strengthens the wrong pathway"));
    }

    #[test]
    fn excerpt_missing_passage_is_an_honest_error() {
        let temp = corpus();
        let by_heading = book_excerpt(
            temp.path(),
            "gebrian-learn-faster",
            Some("No Such Heading"),
            None,
        );
        assert!(by_heading.is_err());
        let by_contains = book_excerpt(
            temp.path(),
            "gebrian-learn-faster",
            None,
            Some("a phrase that never appears in the source"),
        );
        assert!(by_contains.is_err());
        let unknown_book = book_excerpt(temp.path(), "not-a-book", Some("Old way/new way"), None);
        assert!(unknown_book.is_err());
    }

    #[test]
    fn slug_and_safe_name_helpers_hold_the_line() {
        assert_eq!(slug("The Complete Pianist!"), "the-complete-pianist");
        assert_eq!(slug("  ...  "), "");
        assert!(is_safe_file_name("book.md"));
        assert!(!is_safe_file_name("../book.md"));
        assert!(!is_safe_file_name("sub/book.md"));
        assert!(!is_safe_file_name(".."));
    }

    // -- D2 hard-wrap normalization (verifier regression) -----------------

    /// A book whose prose is hard-wrapped mid-paragraph, with two paragraphs in
    /// one section separated by a blank line.
    fn hard_wrapped_book(temp: &TempDir) -> BookListing {
        let source_dir = TempDir::new().unwrap();
        let source = source_dir.path().join("problem-solving.md");
        fs::write(
            &source,
            "# Practice\n\n\
## Problem solving\n\
Good practicing is problem solving. Good practice focuses on\n\
weaknesses, not strengths. Repeat the hard measures until they\n\
are secure.\n\n\
A second paragraph in the same section that must stay separate\n\
from the first across the blank line.\n",
        )
        .unwrap();
        add_book(
            temp.path(),
            &source,
            "Problem Solving",
            "A Teacher",
            BookKind::PracticeMethod,
        )
        .unwrap()
    }

    #[test]
    fn excerpt_contains_matches_across_hard_wrapped_lines() {
        let temp = corpus();
        let book = hard_wrapped_book(&temp);
        // (c) The q-gebrian-1 counterexample shape: needle single-spaced, source
        // wraps "focuses on\nweaknesses, not strengths".
        let excerpt = book_excerpt(
            temp.path(),
            &book.id,
            None,
            Some("Good practicing is problem solving. Good practice focuses on weaknesses, not strengths."),
        )
        .unwrap();
        assert_eq!(excerpt.heading, "Problem solving");
        assert!(excerpt.text.contains("problem solving"));
    }

    #[test]
    fn excerpt_contains_matches_a_quote_spanning_three_wrapped_lines() {
        let temp = corpus();
        let book = hard_wrapped_book(&temp);
        // (a) Spans three source lines with mixed wrapping.
        let excerpt = book_excerpt(
            temp.path(),
            &book.id,
            None,
            Some("focuses on weaknesses, not strengths. Repeat the hard measures until they are secure."),
        )
        .unwrap();
        assert_eq!(excerpt.heading, "Problem solving");
    }

    #[test]
    fn excerpt_contains_does_not_stitch_across_a_paragraph_break() {
        let temp = corpus();
        let book = hard_wrapped_book(&temp);
        // (b) Needle straddling the blank-line boundary must NOT match: the
        // paragraph sentinel blocks the single-spaced needle.
        let result = book_excerpt(
            temp.path(),
            &book.id,
            None,
            Some("across the blank line. A second paragraph in the same section"),
        );
        assert!(result.is_err(), "cross-paragraph needle must not match");
    }

    #[test]
    fn excerpt_heading_matches_a_breadcrumb_leaf() {
        let temp = corpus();
        // A stored locator carrying the corpus breadcrumb separator resolves to
        // its leaf markdown heading.
        let excerpt = book_excerpt(
            temp.path(),
            "gebrian-learn-faster",
            Some("Learning › Old way/new way"),
            None,
        )
        .unwrap();
        assert_eq!(excerpt.heading, "Old way/new way");
    }

    #[test]
    fn normalize_with_map_resolves_positions_back_to_raw_offsets() {
        let raw = "alpha beta\ngamma\n\ndelta";
        let (normalized, map) = normalize_with_map(raw);
        assert_eq!(normalized, "alpha beta gamma\ndelta");
        // The 'd' of "delta" in normalized maps back to its raw byte offset.
        let position = normalized.find("delta").unwrap();
        assert_eq!(&raw[map[position]..map[position] + 5], "delta");
        // A single hard-wrap newline became a space; the blank line became \n.
        assert!(normalized.contains("beta gamma"));
        assert!(normalized.contains("gamma\ndelta"));
    }
}
