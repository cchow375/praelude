//! Read-only retrieval over Christian's three local piano-practice books.
//!
//! The copyrighted source books stay outside the application bundle.  This
//! module accepts a user-selected directory, opens only three exact Markdown
//! filenames directly beneath it, strips conversion HTML, chunks by heading
//! and paragraph, and caches an in-memory lexical index keyed by file metadata.
//! Provider prompts receive only the small set of retrieved chunks.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use super::Citation;

const MAX_BOOK_BYTES: u64 = 5 * 1024 * 1024;
const MAX_CORPUS_BYTES: u64 = 12 * 1024 * 1024;
const MAX_CHUNK_CHARS: usize = 3_200;
const MAX_HIT_BODY_CHARS: usize = 2_600;
const DEFAULT_HITS: usize = 6;

#[derive(Debug, Clone, Copy)]
struct BookSpec {
    id: &'static str,
    file_name: &'static str,
    title: &'static str,
    author: &'static str,
    visual_dependency: bool,
}

const BOOKS: &[BookSpec] = &[
    BookSpec {
        id: "roskell-complete-pianist",
        file_name: "the-complete-pianist.md",
        title: "The Complete Pianist",
        author: "Penelope Roskell",
        // Technique descriptions sometimes depend on photographs, diagrams,
        // or notated exercises in the matching PDF.
        visual_dependency: true,
    },
    BookSpec {
        id: "gebrian-learn-faster",
        file_name: "learn-faster-perform-better.md",
        title: "Learn Faster, Perform Better",
        author: "Molly Gebrian",
        visual_dependency: false,
    },
    BookSpec {
        id: "breth-effective-practicing",
        file_name: "the-piano-students-guide-to-effective-practicing.md",
        title: "The Piano Student's Guide to Effective Practicing",
        author: "Nancy O'Neill Breth",
        visual_dependency: true,
    },
];

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
    name: &'static str,
    len: u64,
    modified_nanos: u128,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct CorpusFingerprint {
    root: PathBuf,
    files: Vec<FileFingerprint>,
}

#[derive(Debug, Clone)]
struct Chunk {
    id: String,
    source_id: &'static str,
    title: &'static str,
    author: &'static str,
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
                status: if corpus.indexed_sources.len() == BOOKS.len() {
                    CorpusStatus::Ready
                } else if corpus.indexed_sources.is_empty() {
                    CorpusStatus::Unavailable
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
    if !dir.is_absolute() {
        return Err("Knowledge folder must be an absolute directory".into());
    }
    let root = dir
        .canonicalize()
        .map_err(|_| "Knowledge folder is missing or unreadable".to_string())?;
    if !root.is_dir() {
        return Err("Knowledge path is not a directory".into());
    }
    let fingerprint = fingerprint(&root)?;
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

    let built = Arc::new(build(fingerprint)?);
    cache
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(root, built.clone());
    Ok(built)
}

fn fingerprint(root: &Path) -> Result<CorpusFingerprint, String> {
    let mut total = 0_u64;
    let mut files = Vec::new();
    for book in BOOKS {
        let path = root.join(book.file_name);
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
            name: book.file_name,
            len: metadata.len(),
            modified_nanos: metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |duration| duration.as_nanos()),
        });
    }
    Ok(CorpusFingerprint {
        root: root.to_path_buf(),
        files,
    })
}

fn build(fingerprint: CorpusFingerprint) -> Result<CachedCorpus, String> {
    let mut chunks = Vec::new();
    let mut indexed_sources = Vec::new();
    let mut warnings = Vec::new();
    for book in BOOKS {
        let path = fingerprint.root.join(book.file_name);
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
        let mut book_chunks = chunk_book(*book, &raw);
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
                score += priorities.get(chunk.source_id).copied().unwrap_or(0.0);
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
            let count = per_source.entry(chunk.source_id).or_default();
            if *count >= 2 {
                continue;
            }
            *count += 1;
            hits.push(CorpusHit {
                id: chunk.id.clone(),
                source_id: chunk.source_id.into(),
                title: chunk.title.into(),
                author: chunk.author.into(),
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

fn chunk_book(book: BookSpec, raw: &str) -> Vec<Chunk> {
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
            source_id: book.id,
            title: book.title,
            author: book.author,
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
    output
}

fn excerpt(value: &str, max_chars: usize) -> String {
    let mut output = value.chars().take(max_chars).collect::<String>();
    if value.chars().count() > max_chars {
        output.push('…');
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn corpus() -> TempDir {
        let temp = TempDir::new().unwrap();
        fs::write(
            temp.path().join(BOOKS[0].file_name),
            "# Technique\n\n## Leaps and lateral movements\nLook ahead before a lateral jump and organize the arrival without a rigid wrist.\n\n## Preventing injury\nPain, numbness, weakness, or loss of movement means stop playing and seek qualified help.\n\n## More complex rhythms and polyrhythms\nUnderstand the composite rhythm and keep a steady pulse.",
        ).unwrap();
        fs::write(
            temp.path().join(BOOKS[1].file_name),
            "# Learning\n\n## Why bad habits are so persistent\nRepeating an error strengthens the wrong pathway.\n\n## Old way/new way\nContrast the old version with the intended new version, then retrieve the new pathway.\n\n## Common practicing mistake #2: playing slowly with a metronome\nMerely playing through slowly over and over can repeat the same mistake without changing the plan.\n\n## How to Play Faster\nUse rhythms, interleaved clicking up, at-tempo chunking, and irregular groupings.",
        ).unwrap();
        fs::write(
            temp.path().join(BOOKS[2].file_name),
            "# Tools\n\n## JUMPS\nPractice the landing and connection of a jump.\n\n## RHYTHMS\nChange rhythmic groupings, then return to the written rhythm.\n\n## SUBDIVISION\nCount the smallest pulse before rebuilding the passage.",
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
            temp.path().join(BOOKS[0].file_name),
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
        assert_eq!(result.indexed_sources.len(), 3);
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
}
