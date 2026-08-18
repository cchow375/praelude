//! The deterministic intent router — CodaKiller's **misfire firewall**.
//!
//! [`Router::route`] maps a final speech transcript to an [`Intent`] using only
//! regex-free, rule-based matching. There is **no LLM** on this path: the whole
//! point is that ambient conversation, song lyrics, and mumbling route to
//! [`Intent::Ignored`] deterministically, and only genuine, command-shaped speech
//! actions the metronome. The exhaustive test module at the bottom (especially the
//! *rejection* cases) is the specification.
//!
//! ## Grammar summary
//!
//! | Utterance | Intent |
//! |---|---|
//! | `metronome 96` / `metronome ninety six` | `MetroStart(Some(96))` |
//! | `turn on the metronome at one twenty` | `MetroStart(Some(120))` |
//! | `metronome on` / `start the metronome` | `MetroStart(None)` (resume) |
//! | `tempo 140` (stopped) / `tempo 140` (running) | `MetroStart(Some(140))` / `MetroSet{abs}` |
//! | `stop` (only while running) / `metronome off` | `MetroStop` |
//! | `bump it up 4` / `take it down two` | `MetroSet{delta}` |
//! | `accent every 3` | `MetroSet{beats_per_bar:3}` |
//! | rep mode: `done` / `again` | `RepCheck(Pass/Fail)` |
//! | wake mode: `coda <cmd>` vs bare `<cmd>` | routed / `Ignored` |
//! | anything else | `Ignored` |
//!
//! ## Guards
//!
//! * **Word boundary on `stop`** — `"I stopped by the store"` never stops the
//!   metronome (token is `stopped`, not `stop`; and it is not a bare-stop phrase).
//! * **Running-state guard on bare `stop`** — a bare `"stop"` only stops the
//!   metronome when it is actually running ([`Mode::metro_running`]); otherwise
//!   it is ambient speech → `Ignored`. Explicit forms (`metronome off`) are not
//!   gated. NOTE: the brief sketched `Mode { rep_block_active, wake_word }`; the
//!   *binding* "running-state guard on bare stop" requirement is impossible inside
//!   a pure router without the running flag, so `metro_running` is carried on
//!   `Mode` — see the field's docs.
//! * **Wake word** — when [`Mode::wake_word`] is set, an utterance must lead with
//!   the wake word or it is `Ignored`; the wake word is stripped before routing.

pub mod numbers;

/// Rep-check outcome (three-way). Carried by [`Intent::RepCheck`]; the voice
/// layer maps this onto the store's [`crate::rep::RepVerdict`]
/// (`Pass→clean`, `Flawed→flawed`, `Fail→failed`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// A clean rep ("done", "clean", "got it", "nailed it", "yes", "yep").
    Pass,
    /// A shaky-but-through rep ("sloppy", "rough", "shaky", "almost").
    Flawed,
    /// A missed rep ("again", "nope", "no", "messed up", "failed").
    Fail,
}

/// A voice request to open a rep block (`open a rep tracker measures 40 to 56
/// start at 80 target 120`). The piece is resolved by the voice layer from the
/// `ui.current_piece` setting, not carried here.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RepOpenSpec {
    pub m_start: u32,
    pub m_end: u32,
    pub start_bpm: Option<f64>,
    pub target_bpm: Option<f64>,
    pub reps: Option<u32>,
}

/// Arguments for a live metronome adjustment ([`Intent::MetroSet`]). Exactly the
/// fields a spoken tweak can carry; `None` means "leave unchanged".
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MetroSetArgs {
    /// Relative tempo change in BPM (`bump it up 4` → `+4.0`).
    pub bpm_delta: Option<f64>,
    /// Absolute tempo, for `set tempo to N` while already running.
    pub bpm_abs: Option<f64>,
    /// Beats per bar from `accent every N`; implies accent-on-first.
    pub beats_per_bar: Option<u8>,
}

impl MetroSetArgs {
    fn delta(d: f64) -> Self {
        MetroSetArgs {
            bpm_delta: Some(d),
            bpm_abs: None,
            beats_per_bar: None,
        }
    }
    fn abs(v: f64) -> Self {
        MetroSetArgs {
            bpm_delta: None,
            bpm_abs: Some(v),
            beats_per_bar: None,
        }
    }
    fn accent(beats: u8) -> Self {
        MetroSetArgs {
            bpm_delta: None,
            bpm_abs: None,
            beats_per_bar: Some(beats),
        }
    }
}

/// The routed meaning of a transcript.
#[derive(Debug, Clone, PartialEq)]
pub enum Intent {
    /// Start (or resume) the metronome. `Some(bpm)` sets the tempo; `None` resumes
    /// the last/stored tempo.
    MetroStart(Option<f64>),
    /// Stop the metronome.
    MetroStop,
    /// Adjust a running metronome.
    MetroSet(MetroSetArgs),
    /// A practice-rep self-assessment (rep mode). The `String` is an optional
    /// note captured after a leading fail/flawed token.
    RepCheck(Verdict, Option<String>),
    /// Open a rep block (any mode). See [`RepOpenSpec`].
    RepOpen(RepOpenSpec),
    /// "Where are we / how many left / status" — report the active block (rep mode).
    RepStatus,
    /// "Close the block / end the tracker" — close the active block (rep mode).
    RepClose,
    /// "End the session" — end + export the session (any mode).
    SessionEnd,
    /// Navigate the score viewer to a one-based PDF page.
    ScorePage(u32),
    /// Navigate the score viewer to a one-based musical measure.
    ScoreMeasure(u32),
    /// A spoken question for a future assistant path (only produced in wake-word
    /// mode for a wake-prefixed utterance that is not a command).
    Question(String),
    /// Ambient speech / not a command. The firewall's default.
    Ignored,
}

/// Routing context.
#[derive(Debug, Clone, Default)]
pub struct Mode {
    /// A practice-rep block is active: rep-check phrases (`done`, `again`) route to
    /// [`Intent::RepCheck`] before the metronome grammar is tried.
    pub rep_block_active: bool,
    /// Optional wake word (lowercased). When set, an utterance must lead with it or
    /// it is [`Intent::Ignored`]; the word is stripped before routing.
    pub wake_word: Option<String>,
    /// Whether the metronome is currently running. Gates the bare `stop` command
    /// (a bare `stop` while stopped is ambient speech). Not part of the brief's
    /// sketched field list, but required by the binding running-state-guard rule.
    pub metro_running: bool,
}

/// The stateless router.
pub struct Router;

impl Router {
    /// Route a **final** transcript to an [`Intent`]. Pure and deterministic.
    pub fn route(text: &str, mode: &Mode) -> Intent {
        // Whisper rendered several three-digit Scherzo measures as clock times
        // (`5:16`, `5:30`). Normalization turns their colons into spaces, and the
        // rep-open and delta parsers would otherwise consume separate literals
        // as a valid but catastrophically wrong range or tempo change. Preserve
        // that ambiguity signal from the raw transcript and refuse numbered
        // score/practice/metronome actions. Explicit `516` / `five sixteen`
        // remains supported.
        let has_numeric_colon = contains_numeric_colon(text);

        // 1. Normalize: lowercase, punctuation & hyphens → spaces, collapse runs,
        //    then fold the recognizer's spellings of "metronome" back onto the
        //    word (see `canonicalize`).
        let norm = canonicalize(text);
        if norm.is_empty() {
            return Intent::Ignored;
        }

        // 2. Wake-word gate. In wake mode, everything unprefixed is dropped.
        let body = match &mode.wake_word {
            Some(w) if !w.is_empty() => match strip_wake(&norm, &w.to_ascii_lowercase()) {
                Some(rest) => rest,
                None => return Intent::Ignored,
            },
            _ => norm.clone(),
        };
        let words: Vec<&str> = body.split_whitespace().collect();
        if words.is_empty() {
            // Wake word alone (or empty body) with no command.
            return Intent::Ignored;
        }

        // 3. Session + rep-block lifecycle (available in ANY mode). These are
        //    command-shaped enough to route before the metronome grammar, and
        //    `end the session` / `open a rep tracker` must work whether or not a
        //    block is currently active.
        if is_session_end(&words) {
            return Intent::SessionEnd;
        }
        if !has_numeric_colon {
            if let Some(nav) = route_score_navigation(&words) {
                return nav;
            }
            if let Some(spec) = route_rep_open(&words) {
                return Intent::RepOpen(spec);
            }
        }

        // 4. Rep-check grammar takes priority inside an active rep block.
        if mode.rep_block_active {
            if is_rep_status(&words) {
                return Intent::RepStatus;
            }
            if is_rep_close(&words) {
                return Intent::RepClose;
            }
            if let Some((v, note)) = rep_check(&words) {
                return Intent::RepCheck(v, note);
            }
        }

        // 5. Metronome grammar.
        if !has_numeric_colon {
            if let Some(intent) = route_metronome(&words, mode) {
                return intent;
            }
        }

        // 6. Wake-prefixed but unmatched → a Question for the future assistant path.
        if mode.wake_word.is_some() {
            return Intent::Question(body);
        }

        Intent::Ignored
    }
}

/// Lowercase, turn every non-alphanumeric char into a space, and collapse runs of
/// whitespace. Apostrophes are dropped (so "let's" → "lets").
///
/// Public as the first half of [`canonicalize`], which is what anything outside
/// this module should compare against: the voice loop's fast path has to judge a
/// *partial* hypothesis using exactly the spelling the router will later see, and
/// two normalizers would drift.
pub fn normalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if c == '\'' {
            // drop apostrophes entirely so contractions stay one token
        } else {
            out.push(' ');
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// [`normalize`], plus the ASR-mangle fold ([`fold_metronome`]). This is the
/// exact spelling the router's grammar sees, so anything that has to *predict*
/// the router — the voice loop's fast-path allowlist, the TS mirror in
/// `tierAIntent.ts` — compares against this, not against raw text.
pub fn canonicalize(text: &str) -> String {
    fold_metronome(&normalize(text))
}

/// Fold the on-device recognizer's renderings of "metronome" back onto the word.
///
/// The word is long, unusual, and the thing this app is mostly asked to do, and
/// the recognizer mangles it in a small number of stable ways — the ones seen in
/// Christian's sessions are `metranome`, `metrodome`, and the two-word splits
/// `metro gnome` / `metro nome`. The single most-reported failure ("'metronome
/// off' barely works") is partly this: the command was said correctly and
/// transcribed into a word the router had never heard of.
///
/// This is the same shape as [`fold_verb`] on the delta path, and it is safe for
/// the same reason: it can only ever produce a token the grammar *already*
/// accepts, so no firewall is loosened. A sentence that merely contains a mangle
/// still has to pass the all-in-vocabulary and length checks like any other.
fn fold_metronome(norm: &str) -> String {
    let words: Vec<&str> = norm.split_whitespace().collect();
    let mut out: Vec<&str> = Vec::with_capacity(words.len());
    let mut i = 0;
    while i < words.len() {
        // Two-word splits first — "metro gnome" is one mangled word, not two.
        if words[i] == "metro" && matches!(words.get(i + 1), Some(&"gnome" | &"nome")) {
            out.push("metronome");
            i += 2;
            continue;
        }
        out.push(match words[i] {
            "metranome" | "metrodome" => "metronome",
            other => other,
        });
        i += 1;
    }
    out.join(" ")
}

/// Whether the raw transcript contains an ASCII digit-colon-digit shape such
/// as `5:16`. In practice narration this is an ASR rendering of a three-digit
/// measure, but it is also valid clock syntax; either way it is too ambiguous to
/// feed numbered mutation parsers after punctuation is discarded.
fn contains_numeric_colon(text: &str) -> bool {
    text.as_bytes()
        .windows(3)
        .any(|w| w[0].is_ascii_digit() && w[1] == b':' && w[2].is_ascii_digit())
}

/// If `norm` leads with the wake word, return the remainder (may be empty). The
/// wake word may itself be multi-token ("hey coda").
fn strip_wake(norm: &str, wake: &str) -> Option<String> {
    let wake_norm = normalize(wake);
    let rest = norm.strip_prefix(&wake_norm)?;
    // Must be a token boundary: either exact match (empty rest) or followed by a
    // space, never a longer word ("codafoo").
    if rest.is_empty() {
        Some(String::new())
    } else {
        // Must be a real token boundary (a space), never a longer word.
        rest.strip_prefix(' ').map(|tail| tail.trim().to_string())
    }
}

/// Longest note (in words) captured after a leading fail/flawed verdict token.
/// A longer trailing clause is treated as ambient rambling that happens to begin
/// with a verdict word (`"no i really think we should go home now and ..."`), so
/// the whole utterance is rejected rather than logged as a rep.
const MAX_NOTE_WORDS: usize = 12;

/// Classify an in-rep-block utterance into a three-way [`Verdict`] plus an
/// optional note.
///
/// * **Pass** matches only an *exact* whole-utterance pass phrase — a clean rep
///   carries no note, and a pass word with a trailing clause is not a rep.
/// * **Flawed** / **Fail** match on a leading verdict token (one or two words);
///   any remaining words become the note (≤ [`MAX_NOTE_WORDS`], else the whole
///   utterance is rejected). This is the only path that captures notes.
fn rep_check(words: &[&str]) -> Option<(Verdict, Option<String>)> {
    let joined = words.join(" ");
    const PASS: &[&str] = &[
        "done",
        "clean",
        "got it",
        "get it",
        "nailed it",
        "perfect",
        "good",
        "yes",
        "yep",
    ];
    if PASS.contains(&joined.as_str()) {
        return Some((Verdict::Pass, None));
    }

    // Narrated-practice firewall: a leading fail word can also be a discourse
    // marker. These exact shapes occurred in Christian's recordings, and the
    // existing eager note capture turned them into phantom failed reps. Keep the
    // guard deliberately narrow so real controls (`again`, `again fingering fell
    // apart`, `no shoot I got it wrong`) continue to work.
    if conversational_leading_verdict(words) {
        return None;
    }

    // Leading verdict token(s): two-word forms first, then single tokens.
    let (verdict, lead) =
        if words.starts_with(&["messed", "up"]) || words.starts_with(&["mess", "up"]) {
            (Verdict::Fail, 2)
        } else {
            match words.first().copied() {
                Some("again" | "nope" | "no" | "failed" | "fail" | "miss" | "missed" | "retry") => {
                    (Verdict::Fail, 1)
                }
                Some("sloppy" | "rough" | "shaky" | "almost") => (Verdict::Flawed, 1),
                _ => return None,
            }
        };

    let rest = &words[lead..];
    if rest.is_empty() {
        return Some((verdict, None));
    }
    if rest.len() > MAX_NOTE_WORDS {
        // Too long to be a rep note — reject the whole utterance (ambient speech
        // that merely starts with a verdict word).
        return None;
    }
    Some((verdict, Some(rest.join(" "))))
}

/// Observed conversational phrases that happen to begin with a fail verdict.
/// This is intentionally an allowlisted rejection, not a broad NLP heuristic.
fn conversational_leading_verdict(words: &[&str]) -> bool {
    if words.starts_with(&["no", "thanks"]) || words.starts_with(&["no", "thank", "you"]) {
        return true;
    }

    let conversational_again = words.starts_with(&["again", "that", "i"])
        || words.starts_with(&["again", "like"])
        || words.starts_with(&["again", "just", "to"]);
    let has_explicit_failure = words.iter().skip(1).any(|word| {
        matches!(
            *word,
            "fail" | "failed" | "miss" | "missed" | "mess" | "messed"
        )
    });

    conversational_again && !has_explicit_failure
}

/// "End the session" family (any mode).
fn is_session_end(words: &[&str]) -> bool {
    matches!(
        words.join(" ").as_str(),
        "end the session" | "end session" | "finish the session" | "end this session"
    )
}

/// "Where are we / how many left / status" (rep mode).
fn is_rep_status(words: &[&str]) -> bool {
    matches!(
        words.join(" ").as_str(),
        "where are we"
            | "where were we"
            | "how many left"
            | "how many are left"
            | "how many reps left"
            | "status"
    )
}

/// "Close the block / end the tracker" (rep mode).
fn is_rep_close(words: &[&str]) -> bool {
    matches!(
        words.join(" ").as_str(),
        "close the block"
            | "close block"
            | "end the block"
            | "close the tracker"
            | "close the rep tracker"
            | "end the tracker"
    )
}

/// Strict score-navigation grammar. The entire utterance must be one of the
/// command shapes below followed by one positive integer number phrase. This is
/// deliberately narrower than keyword matching: ambient practice talk such as
/// "page 12 is hard" and "measure 83 is hard" must remain inert.
fn route_score_navigation(words: &[&str]) -> Option<Intent> {
    let (kind, number_words) = match words {
        ["go", "to", "page", rest @ ..] | ["show", "page", rest @ ..] => ("page", rest),
        ["go", "to", "measure", rest @ ..] | ["show", "measure", rest @ ..] => ("measure", rest),
        _ => return None,
    };
    if number_words.is_empty() {
        return None;
    }
    let parsed = numbers::parse_number(&number_words.join(" "))?;
    if !parsed.is_finite() || parsed.fract() != 0.0 || !(1.0..=u32::MAX as f64).contains(&parsed) {
        return None;
    }
    let value = parsed as u32;
    Some(match kind {
        "page" => Intent::ScorePage(value),
        _ => Intent::ScoreMeasure(value),
    })
}

/// Parse a rep-open utterance: `open a rep tracker measures 40 to 56 start at 80
/// target 120`. Requires a rep-open cue (`tracker`/`rep`/`block`) AND the word
/// `measures`/`measure` followed by a two-number range; both range numbers must
/// parse or the whole thing is rejected. Optional `at N` (start tempo),
/// `target N`, and `N reps` are pulled by keyword.
fn route_rep_open(words: &[&str]) -> Option<RepOpenSpec> {
    let has_cue = has(words, "tracker") || has(words, "rep") || has(words, "block");
    let has_measures = has(words, "measures") || has(words, "measure");
    if !has_cue || !has_measures {
        return None;
    }

    // Command-shape firewall (mirrors `is_explicit_metro_stop`/`route_delta`):
    // every word must be rep-open vocabulary or a number. This is what stops the
    // *very* common ambient phrasing this app invites — a musician saying "the
    // block measures 40 to 56 are hard" or "that rep in measures 12 to 16 was
    // rough" carries a cue word + "measures" + a range, but the stray words
    // ("are"/"hard"/"in"/"was"/"rough") are out of vocab, so it never opens a
    // block. A genuine command ("open a rep tracker measures 40 to 56 start at 80
    // target 120") is built entirely from this vocabulary.
    const VOCAB: &[&str] = &[
        "open", "start", "new", "up", "a", "an", "the", "please", "lets", "let", "us", "go", "rep",
        "reps", "tracker", "block", "measures", "measure", "to", "through", "thru", "at", "target",
        "and",
    ];
    if !words
        .iter()
        .all(|w| VOCAB.contains(w) || numbers::parse_number(w).is_some())
    {
        return None;
    }

    let mpos = words
        .iter()
        .position(|w| *w == "measures" || *w == "measure")?;
    let after = &words[mpos + 1..];

    // The range lives before the first tempo/reps keyword, so a distant tempo
    // number can never be mistaken for the range end.
    let range_end = after
        .iter()
        .position(|w| matches!(*w, "start" | "at" | "target" | "reps"))
        .unwrap_or(after.len());
    let range_seg = &after[..range_end];
    let (m_start, i1) = number_run_at(range_seg, 0)?;
    let (m_end, _) = number_run_at(range_seg, i1)?;

    let start_bpm = keyword_number(after, "at");
    let target_bpm = keyword_number(after, "target");
    let reps = number_before(after, "reps").map(|n| n as u32);

    Some(RepOpenSpec {
        m_start: m_start as u32,
        m_end: m_end as u32,
        start_bpm,
        target_bpm,
        reps,
    })
}

/// Whether a token is a bare digit literal (`"120"`), as opposed to a
/// number-word (`"twenty"`).
fn is_digit_literal(tok: &str) -> bool {
    !tok.is_empty() && tok.bytes().all(|b| b.is_ascii_digit())
}

/// From `start`, skip forward to the first number token, then consume one number
/// run and parse it. Returns the value and the index just past the run. `None` if
/// there is no number at/after `start`.
///
/// A digit literal (`"120"`) is always a standalone run, so two adjacent numbers
/// with no separator (`"target 120 twenty reps"`) are kept apart — a literal is
/// never merged with the following number-word into an unparseable `"120 twenty"`.
/// Number-words chain (`"one twenty"`, `"fifty six"`), stopping at the next digit
/// literal or non-number.
fn number_run_at(tokens: &[&str], start: usize) -> Option<(f64, usize)> {
    let mut i = start;
    while i < tokens.len() && numbers::parse_number(tokens[i]).is_none() {
        i += 1;
    }
    if i >= tokens.len() {
        return None;
    }
    if is_digit_literal(tokens[i]) {
        return numbers::parse_number(tokens[i]).map(|v| (v, i + 1));
    }
    let run_start = i;
    let mut j = i + 1;
    while j < tokens.len()
        && !is_digit_literal(tokens[j])
        && (numbers::parse_number(tokens[j]).is_some() || tokens[j] == "and")
    {
        j += 1;
    }
    let val = numbers::parse_number(&tokens[run_start..j].join(" "))?;
    Some((val, j))
}

/// The number run immediately following the first occurrence of `kw`.
fn keyword_number(tokens: &[&str], kw: &str) -> Option<f64> {
    let pos = tokens.iter().position(|w| *w == kw)?;
    number_run_at(tokens, pos + 1).map(|(v, _)| v)
}

/// The number run immediately preceding the first occurrence of `kw`
/// (`twenty reps` → 20).
fn number_before(tokens: &[&str], kw: &str) -> Option<f64> {
    let pos = tokens.iter().position(|w| *w == kw)?;
    if pos == 0 {
        return None;
    }
    // A digit literal immediately before the keyword is the whole number.
    if is_digit_literal(tokens[pos - 1]) {
        return numbers::parse_number(tokens[pos - 1]);
    }
    // Otherwise walk back over number-words (and "and"), stopping at a literal.
    let mut i = pos;
    while i > 0
        && !is_digit_literal(tokens[i - 1])
        && (numbers::parse_number(tokens[i - 1]).is_some() || tokens[i - 1] == "and")
    {
        i -= 1;
    }
    if i < pos {
        numbers::parse_number(&tokens[i..pos].join(" "))
    } else {
        None
    }
}

fn has(words: &[&str], w: &str) -> bool {
    words.contains(&w)
}

/// Leading courtesy that carries no instruction: `"can you stop the metronome"`
/// is the same command as `"stop the metronome"`, and Christian's "Siri 2015"
/// complaint is largely that the second worked and the first did not.
///
/// Stripped only from the HEAD of the utterance, only these exact forms, and at
/// most twice ("hey can you stop the metronome"). That narrowness is the point:
/// the metronome grammar's firewall is "short AND built entirely from command
/// vocabulary", so the only way to admit a politeness without punching a hole in
/// it is to remove the politeness *before* the shape is judged. Mid-sentence
/// courtesy is untouched — "i asked if you could stop the metronome" still has
/// out-of-vocabulary words and still routes nowhere.
const COURTESY_PREFIXES: &[&[&str]] = &[
    &["can", "you"],
    &["could", "you"],
    &["would", "you"],
    &["will", "you"],
    &["hey"],
    &["ok"],
    &["okay"],
];

/// Drop up to two leading [`COURTESY_PREFIXES`], never leaving an empty slice
/// (a bare "hey" is not a command, and letting it fall through as an empty
/// utterance would be a different bug).
fn strip_courtesy<'a>(words: &'a [&'a str]) -> &'a [&'a str] {
    let mut rest = words;
    for _ in 0..2 {
        let Some(stripped) = COURTESY_PREFIXES
            .iter()
            .find(|p| rest.starts_with(p) && rest.len() > p.len())
            .map(|p| &rest[p.len()..])
        else {
            break;
        };
        rest = stripped;
    }
    rest
}

/// Core metronome grammar. Returns `None` if nothing matched (→ Ignored/Question).
fn route_metronome(words: &[&str], mode: &Mode) -> Option<Intent> {
    // Natural forms reach the same grammar as the terse ones: courtesy off the
    // front, then every rule below is unchanged. The rules are already
    // order-flexible (they test for tokens, not sequences), so "turn the
    // metronome off", "metronome please stop" and "can you stop the metronome"
    // are all the same command shape once the politeness is gone.
    let words = strip_courtesy(words);
    let has_metro = has(words, "metronome");

    // --- STOP -------------------------------------------------------------
    // Explicit: a command-SHAPED metronome-stop phrase, not gated on running.
    // Command-shaped means short AND built only from stop-command vocabulary —
    // so a *sentence* that merely contains "metronome" and "off"
    // ("the metronome is off today so it sounds weird") is NOT a stop.
    if is_explicit_metro_stop(words) {
        return Some(Intent::MetroStop);
    }
    // Bare stop: a short stop-only utterance ("stop", "stop it", "please stop",
    // "halt"). Guarded on running state so ambient "stop" is ignored.
    if is_bare_stop(words) {
        return if mode.metro_running {
            Some(Intent::MetroStop)
        } else {
            None
        };
    }

    // --- SET (deltas / accent) -------------------------------------------
    if let Some(args) = route_accent(words) {
        return Some(Intent::MetroSet(args));
    }
    if let Some(args) = route_delta(words) {
        return Some(Intent::MetroSet(args));
    }

    // --- START / absolute tempo ------------------------------------------
    let has_tempo = has(words, "tempo");
    let start_triggered = words.first() == Some(&"metronome")
        || (has(words, "start") && has_metro)
        || (has(words, "turn") && has(words, "on") && has_metro)
        || has_tempo;

    if start_triggered {
        // Strip command/filler words; whatever remains must be a clean number
        // phrase (or nothing, for a bare resume).
        const FILLER: &[&str] = &[
            "metronome",
            "start",
            "turn",
            "on",
            "off",
            "the",
            "a",
            "at",
            "to",
            "please",
            "tempo",
            "set",
            "it",
            "up",
            "bpm",
            "of",
            "go",
            "lets",
            "let",
            "us",
        ];
        let rest: Vec<&str> = words
            .iter()
            .copied()
            .filter(|w| !FILLER.contains(w))
            .collect();
        if rest.is_empty() {
            // Bare resume ("metronome on", "start the metronome"), but a lone
            // "tempo" with no number is ambient — require an explicit metronome/
            // start cue, not just the word "tempo".
            if has_metro || has(words, "start") {
                return Some(Intent::MetroStart(None));
            }
            return None;
        }
        if let Some(bpm) = numbers::parse_number(&rest.join(" ")) {
            // A tempo command against a running metronome is a live set; otherwise
            // it starts.
            if has_tempo && mode.metro_running && !has(words, "start") {
                return Some(Intent::MetroSet(MetroSetArgs::abs(bpm)));
            }
            return Some(Intent::MetroStart(Some(bpm)));
        }
        // Trigger word present but the remainder is not a number → ambient noise
        // that merely contained "metronome"/"tempo" ("metronome in the corner").
        return None;
    }

    None
}

/// A bare stop utterance: contains a stop word and consists only of a small
/// allow-list of stop-context tokens, kept short so a sentence that merely
/// contains "stop" (e.g. "stop the store") never matches.
fn is_bare_stop(words: &[&str]) -> bool {
    const ALLOWED: &[&str] = &["stop", "halt", "please", "it", "now", "the"];
    let has_stop = words.contains(&"stop") || words.contains(&"halt");
    has_stop && words.len() <= 3 && words.iter().all(|w| ALLOWED.contains(w))
}

/// A command-shaped explicit metronome-stop: mentions "metronome", carries a stop
/// cue, is short, and is built ONLY from stop-command vocabulary. The all-in-vocab
/// requirement is the firewall — an ambient sentence carrying those tokens
/// ("i turned the metronome off and went home") has out-of-vocab words and fails.
fn is_explicit_metro_stop(words: &[&str]) -> bool {
    const VOCAB: &[&str] = &[
        "metronome",
        "off",
        "stop",
        "turn",
        "the",
        "please",
        "halt",
        "kill",
        "it",
        "now",
    ];
    let has_cue = words.contains(&"off")
        || words.contains(&"stop")
        || words.contains(&"halt")
        || words.contains(&"kill");
    words.contains(&"metronome")
        && has_cue
        && words.len() <= 5
        && words.iter().all(|w| VOCAB.contains(w))
}

/// `accent every N` → set beats-per-bar to N (with accent on the first beat).
fn route_accent(words: &[&str]) -> Option<MetroSetArgs> {
    if !has(words, "accent") {
        return None;
    }
    // Find a number following "every"/"on", or any number in the phrase.
    if let Some(pos) = words.iter().position(|w| *w == "every" || *w == "on") {
        if let Some(rest) = words.get(pos + 1..) {
            if let Some(n) = numbers::parse_number(&rest.join(" ")) {
                if (1.0..=32.0).contains(&n) {
                    return Some(MetroSetArgs::accent(n as u8));
                }
            }
        }
    }
    None
}

/// Relative tempo change: `bump it up 4`, `speed up`, `take it down two`,
/// `slower`. A missing number defaults to ±5.
///
/// Firewall shape (mirrors [`is_explicit_metro_stop`]): the utterance must be
/// short AND built only from delta-command vocabulary (verbs, up/down, filler,
/// number words). This is what stops ambient sentences that merely *contain* a
/// direction token — "just relax", "that song is way too slow", "we need to
/// increase our sales", "the tempo picked up around one twenty in the bridge" —
/// from ever firing a tempo change. (Weak, ambiguous cues like "relax",
/// "increase", "decrease" are deliberately NOT verbs here.)
fn route_delta(words: &[&str]) -> Option<MetroSetArgs> {
    const VERBS: &[&str] = &["bump", "speed", "slow", "take", "bring", "knock", "push"];
    const VOCAB: &[&str] = &[
        "bump", "speed", "slow", "take", "bring", "knock", "push", "faster", "slower", "quicker",
        "it", "up", "down", "by", "tempo", "the", "a", "please", "notch", "bit", "little",
    ];
    // ASR-ism fold (fix round 2): the on-device recognizer transcribes some verbs
    // as their past tense ("bump it up four" → "Bumped it up for"). Fold ONLY the
    // past-tense forms of verbs already in the delta vocabulary back to the base
    // verb — this can never admit a new word, so the firewall is unchanged.
    let words: Vec<&str> = words.iter().map(|w| fold_verb(w)).collect();
    let words: &[&str] = &words;

    // Command-shape gate: short, and every non-number word is delta vocabulary (or
    // a number homophone in the number slot — see `homophone_number`).
    if words.is_empty() || words.len() > 6 {
        return None;
    }
    if !words.iter().all(|w| {
        VOCAB.contains(w)
            || *w == "and"
            || numbers::parse_number(w).is_some()
            || homophone_number(w).is_some()
    }) {
        return None;
    }

    let has_verb = VERBS.iter().any(|v| has(words, v));
    let comp_up = has(words, "faster") || has(words, "quicker");
    let comp_down = has(words, "slower");
    let dir_up = has(words, "up") || comp_up;
    let dir_down = has(words, "down") || comp_down;

    // Exactly one direction, and a legitimate cue (a verb, a comparative, or an
    // up/down paired with the object "it") — never a lone bare "up"/"down".
    if dir_up == dir_down {
        return None;
    }
    let legit = has_verb || comp_up || comp_down || has(words, "it");
    if !legit {
        return None;
    }

    // Only NOW (command shape confirmed, cue present, all words in vocab) do we let
    // the sole surviving number homophone fill the number slot: "for" → "four".
    // "to"/"too" → "two" was removed entirely — it corrupted real digit runs like
    // "bump it up to 100" by turning "to" into "two" mid-number. "for" is kept, but
    // ONLY maps to a number when it is the FINAL token of the command AND no
    // genuine number was already parsed from the raw words — this is what keeps
    // "what is this for" (no cue) and "take two" (no direction) from ever mapping
    // a homophone to a tempo, while still catching ASR drops like "bump it up for"
    // (→ "bump it up four").
    let has_real_number = words.iter().any(|w| numbers::parse_number(w).is_some());
    let last_idx = words.len() - 1;
    let mapped: Vec<&str> = words
        .iter()
        .enumerate()
        .map(|(i, w)| {
            if !has_real_number && i == last_idx && *w == "for" {
                homophone_number(w).unwrap_or(w)
            } else {
                w
            }
        })
        .collect();
    let mag = extract_first_number(&mapped).unwrap_or(5.0);
    Some(MetroSetArgs::delta(if dir_up { mag } else { -mag }))
}

/// Fold a past-tense ASR mis-transcription back to the base verb, but ONLY for
/// verbs already in the delta vocabulary. Returns the input unchanged otherwise,
/// so this never introduces a token the firewall would not already accept.
fn fold_verb(w: &str) -> &str {
    match w {
        "bumped" => "bump",
        "sped" | "speeded" => "speed",
        "slowed" => "slow",
        "took" => "take",
        "brought" => "bring",
        "knocked" => "knock",
        "pushed" => "push",
        other => other,
    }
}

/// Map a number homophone to its spelled number word. Only `for` — the homophone
/// the on-device recognizer actually produces for `four`. (`to`/`too` → `two` was
/// removed: it corrupted genuine digit runs, e.g. "bump it up to 100" had its
/// "to" rewritten to "two" and mangled the number parse.) The caller applies this
/// ONLY after confirming the utterance is a complete command shape, AND only when
/// `for` is the final token with no real number already present elsewhere in the
/// words — see the call site in [`route_delta`] — so this common English word
/// never becomes a tempo in ambient speech or steals a slot from a real number.
fn homophone_number(w: &str) -> Option<&'static str> {
    match w {
        "for" => Some("four"),
        _ => None,
    }
}

/// Find the first contiguous number-word run in `words` and parse it.
fn extract_first_number(words: &[&str]) -> Option<f64> {
    let mut i = 0;
    while i < words.len() {
        if numbers::parse_number(words[i]).is_some() {
            // Extend the run greedily.
            let mut j = i + 1;
            while j < words.len()
                && (numbers::parse_number(words[j]).is_some() || words[j] == "and")
            {
                j += 1;
            }
            if let Some(n) = numbers::parse_number(&words[i..j].join(" ")) {
                return Some(n);
            }
        }
        i += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stopped() -> Mode {
        Mode {
            rep_block_active: false,
            wake_word: None,
            metro_running: false,
        }
    }
    fn running() -> Mode {
        Mode {
            rep_block_active: false,
            wake_word: None,
            metro_running: true,
        }
    }
    fn r(text: &str, mode: &Mode) -> Intent {
        Router::route(text, mode)
    }

    // ------------------------------------------------------------------ START
    #[test]
    fn start_with_digit() {
        assert_eq!(
            r("metronome 96", &stopped()),
            Intent::MetroStart(Some(96.0))
        );
    }
    #[test]
    fn start_with_words() {
        assert_eq!(
            r("metronome ninety six", &stopped()),
            Intent::MetroStart(Some(96.0))
        );
    }
    #[test]
    fn start_compact_hundreds() {
        assert_eq!(
            r("turn on the metronome at one twenty", &stopped()),
            Intent::MetroStart(Some(120.0))
        );
    }
    #[test]
    fn start_bare_resume() {
        assert_eq!(r("metronome on", &stopped()), Intent::MetroStart(None));
        assert_eq!(
            r("start the metronome", &stopped()),
            Intent::MetroStart(None)
        );
        assert_eq!(r("metronome", &stopped()), Intent::MetroStart(None));
        assert_eq!(r("metronome please", &stopped()), Intent::MetroStart(None));
    }
    #[test]
    fn start_at_tempo_variants() {
        assert_eq!(
            r("metronome at 140", &stopped()),
            Intent::MetroStart(Some(140.0))
        );
        assert_eq!(
            r("start metronome at one hundred", &stopped()),
            Intent::MetroStart(Some(100.0))
        );
        assert_eq!(
            r("tempo 128", &stopped()),
            Intent::MetroStart(Some(128.0)),
            "tempo command while stopped starts"
        );
    }
    #[test]
    fn tempo_while_running_is_a_set() {
        assert_eq!(
            r("tempo 128", &running()),
            Intent::MetroSet(MetroSetArgs::abs(128.0))
        );
    }
    #[test]
    fn punctuation_and_case_ignored() {
        assert_eq!(
            r("Metronome, ninety-six!", &stopped()),
            Intent::MetroStart(Some(96.0))
        );
    }

    // ------------------------------------------------------- SCORE NAVIGATION
    #[test]
    fn score_navigation_accepts_only_command_shaped_page_and_measure_forms() {
        assert_eq!(r("go to page 12", &stopped()), Intent::ScorePage(12));
        assert_eq!(r("show page twelve", &stopped()), Intent::ScorePage(12));
        assert_eq!(r("go to measure 83", &stopped()), Intent::ScoreMeasure(83));
        assert_eq!(
            r("show measure eighty three", &stopped()),
            Intent::ScoreMeasure(83)
        );
    }

    #[test]
    fn score_navigation_rejects_ambient_mentions_and_invalid_locations() {
        for phrase in [
            "page 12 is hard",
            "measure 83 is hard",
            "the turn on page twelve is awkward",
            "show me why measure eighty three is hard",
            "go to page zero",
            "show measure 0",
        ] {
            assert_eq!(
                r(phrase, &stopped()),
                Intent::Ignored,
                "ambient or invalid score phrase must be ignored: {phrase:?}"
            );
        }
    }

    // ------------------------------------------------------------------- STOP
    #[test]
    fn bare_stop_only_while_running() {
        assert_eq!(r("stop", &running()), Intent::MetroStop);
        assert_eq!(r("stop", &stopped()), Intent::Ignored);
        assert_eq!(r("stop it", &running()), Intent::MetroStop);
        assert_eq!(r("please stop", &running()), Intent::MetroStop);
        assert_eq!(r("halt", &running()), Intent::MetroStop);
    }
    #[test]
    fn explicit_stop_not_gated() {
        assert_eq!(r("metronome off", &stopped()), Intent::MetroStop);
        assert_eq!(r("turn off the metronome", &stopped()), Intent::MetroStop);
        assert_eq!(r("stop the metronome", &stopped()), Intent::MetroStop);
    }
    #[test]
    fn kill_is_a_stop_cue() {
        // "kill" was already in is_explicit_metro_stop's VOCAB allow-list but was
        // never checked by has_cue, so it was dead/misleading — a stop-shaped
        // sentence built entirely from stop vocabulary containing "kill" never
        // actually fired. Fixed: "kill" now triggers the cue like the other stop
        // synonyms. The shape gate (short + all-in-vocab) still applies unchanged.
        assert_eq!(r("kill the metronome", &stopped()), Intent::MetroStop);
    }
    #[test]
    fn stopped_word_boundary_is_not_stop() {
        // "stopped" is not "stop"; and this is a long ambient sentence.
        assert_eq!(
            r("I stopped by the store yesterday", &running()),
            Intent::Ignored
        );
    }
    #[test]
    fn stop_inside_unrelated_sentence_ignored() {
        assert_eq!(r("stop the store", &running()), Intent::Ignored);
        assert_eq!(
            r("we should stop for lunch soon", &running()),
            Intent::Ignored
        );
    }

    // -------------------------------------------------------------------- SET
    #[test]
    fn delta_up_with_number() {
        assert_eq!(
            r("bump it up 4", &running()),
            Intent::MetroSet(MetroSetArgs::delta(4.0))
        );
    }
    #[test]
    fn delta_down_with_words() {
        assert_eq!(
            r("take it down two", &running()),
            Intent::MetroSet(MetroSetArgs::delta(-2.0))
        );
    }
    #[test]
    fn delta_default_magnitude() {
        assert_eq!(
            r("speed up", &running()),
            Intent::MetroSet(MetroSetArgs::delta(5.0))
        );
        assert_eq!(
            r("slow down", &running()),
            Intent::MetroSet(MetroSetArgs::delta(-5.0))
        );
        assert_eq!(
            r("faster", &running()),
            Intent::MetroSet(MetroSetArgs::delta(5.0))
        );
        assert_eq!(
            r("slower", &running()),
            Intent::MetroSet(MetroSetArgs::delta(-5.0))
        );
    }
    #[test]
    fn take_it_up_a_notch_fires_a_delta() {
        // Task 13 review flagged this as a possible misfire risk ("take it up a
        // notch" is often just a figure of speech), but for CodaKiller's
        // practice-coaching context a literal "take it up a notch" IS a genuine
        // ask to nudge the tempo up — so this is a conscious, accepted-fire
        // decision, not an oversight. Documented here so a future reviewer sees
        // it was considered and kept as-is.
        assert_eq!(
            r("take it up a notch", &running()),
            Intent::MetroSet(MetroSetArgs::delta(5.0))
        );
    }
    #[test]
    fn asr_ism_folding_and_homophone_number() {
        // "bump it up four" is transcribed by the on-device recognizer as
        // "Bumped it up for": past-tense verb fold (bumped→bump) + number
        // homophone in the number slot (for→4).
        assert_eq!(
            r("bumped it up for", &running()),
            Intent::MetroSet(MetroSetArgs::delta(4.0))
        );
        // Compact-hundreds already handles the absolute-tempo ASR shape.
        assert_eq!(
            r("metronome one twenty", &stopped()),
            Intent::MetroStart(Some(120.0))
        );
    }
    #[test]
    fn to_too_no_longer_map_to_two() {
        // "to"/"too" → "two" was removed: it corrupted genuine digit runs by
        // rewriting the "to" inside "up to 100" into "two", mangling the parse.
        assert_eq!(r("bump it up to 100", &running()), Intent::Ignored);
        assert_eq!(r("take it up to one forty", &running()), Intent::Ignored);
    }
    #[test]
    fn for_still_maps_to_four_as_final_token() {
        assert_eq!(
            r("bump it up for", &running()),
            Intent::MetroSet(MetroSetArgs::delta(4.0))
        );
        assert_eq!(
            r("bumped it up for", &running()),
            Intent::MetroSet(MetroSetArgs::delta(4.0))
        );
    }
    #[test]
    fn asr_ism_folding_does_not_weaken_firewall() {
        // Homophones only map inside a confirmed command shape; verb folds only
        // apply to known vocab verbs. None of these are commands.
        assert_eq!(r("what is this for", &running()), Intent::Ignored);
        assert_eq!(r("what is this for", &stopped()), Intent::Ignored);
        assert_eq!(r("I bumped into her", &running()), Intent::Ignored);
        assert_eq!(r("I bumped into her", &stopped()), Intent::Ignored);
        assert_eq!(
            r("take two", &running()),
            Intent::Ignored,
            "no direction cue"
        );
        assert_eq!(
            r("take two", &stopped()),
            Intent::Ignored,
            "no direction cue"
        );
    }
    #[test]
    fn accent_every_n() {
        assert_eq!(
            r("accent every 3", &running()),
            Intent::MetroSet(MetroSetArgs::accent(3))
        );
        assert_eq!(
            r("accent every four", &running()),
            Intent::MetroSet(MetroSetArgs::accent(4))
        );
    }

    // ------------------------------------------------------------- REJECTIONS
    #[test]
    fn rejects_ambient_speech() {
        for phrase in [
            "lets see what happens",
            "is this the real life is this just fantasy",
            "uh um yeah so anyway",
            "the metronome in the corner looked old",
            "i really need a new metronome someday",
            "ninety six", // number with no command
            "one twenty", // number with no command
            "can you pass the salt",
            "what a beautiful day today",
            "mmm hmm okay right",
        ] {
            assert_eq!(
                r(phrase, &running()),
                Intent::Ignored,
                "ambient phrase must be Ignored: {phrase:?}"
            );
        }
    }
    #[test]
    fn rejects_buried_command_tokens() {
        // Regression firewall: natural sentences that merely CONTAIN a command
        // token must not misfire (found by adversarial review).
        for phrase in [
            "just relax",
            "lets all relax now",
            "that song is way too slow",
            "we need to increase our sales this quarter",
            "slow down there buddy",
            "take the trash out down the hall",
            "the tempo picked up around one twenty in the bridge",
            "the metronome is off today so it sounds weird",
            "i turned the metronome off and went home",
            "can you turn the lights off",
            "i really need to slow down my life",
            "the tempo of this piece is lovely",
        ] {
            assert_eq!(
                Router::route(phrase, &running()),
                Intent::Ignored,
                "buried-token sentence must be Ignored: {phrase:?}"
            );
            assert_eq!(
                Router::route(phrase, &stopped()),
                Intent::Ignored,
                "buried-token sentence must be Ignored (stopped): {phrase:?}"
            );
        }
    }
    #[test]
    fn empty_and_whitespace_ignored() {
        assert_eq!(r("", &running()), Intent::Ignored);
        assert_eq!(r("   ...  ", &running()), Intent::Ignored);
    }

    // -------------------------------------------------------------- WAKE WORD
    #[test]
    fn wake_word_required() {
        let mode = Mode {
            wake_word: Some("coda".into()),
            metro_running: false,
            rep_block_active: false,
        };
        assert_eq!(
            r("coda metronome 90", &mode),
            Intent::MetroStart(Some(90.0))
        );
        assert_eq!(
            r("metronome 90", &mode),
            Intent::Ignored,
            "unprefixed command dropped in wake mode"
        );
    }
    #[test]
    fn wake_word_stop_and_boundary() {
        let mut mode = Mode {
            wake_word: Some("coda".into()),
            metro_running: true,
            rep_block_active: false,
        };
        assert_eq!(r("coda stop", &mode), Intent::MetroStop);
        // A word that merely starts with the wake letters is not the wake word.
        assert_eq!(r("codafoo metronome 90", &mode), Intent::Ignored);
        mode.metro_running = false;
        assert_eq!(r("stop", &mode), Intent::Ignored);
    }
    #[test]
    fn wake_prefixed_noncommand_is_question() {
        let mode = Mode {
            wake_word: Some("coda".into()),
            metro_running: false,
            rep_block_active: false,
        };
        assert_eq!(
            r("coda what time is it", &mode),
            Intent::Question("what time is it".into())
        );
    }

    // ------------------------------------------------------------- REP MODE
    #[test]
    fn rep_mode_verdicts() {
        let mode = Mode {
            rep_block_active: true,
            wake_word: None,
            metro_running: true,
        };
        assert_eq!(r("done", &mode), Intent::RepCheck(Verdict::Pass, None));
        assert_eq!(r("got it", &mode), Intent::RepCheck(Verdict::Pass, None));
        assert_eq!(r("again", &mode), Intent::RepCheck(Verdict::Fail, None));
        assert_eq!(r("nailed it", &mode), Intent::RepCheck(Verdict::Pass, None));
    }
    #[test]
    fn rep_mode_still_allows_stop() {
        let mode = Mode {
            rep_block_active: true,
            wake_word: None,
            metro_running: true,
        };
        assert_eq!(r("stop", &mode), Intent::MetroStop);
    }
    #[test]
    fn rep_words_ignored_outside_rep_mode() {
        // "done" is ambient outside a rep block.
        assert_eq!(r("done", &running()), Intent::Ignored);
    }

    // ------------------------------------------------------- REP GRAMMAR (P3)
    fn rep_mode() -> Mode {
        Mode {
            rep_block_active: true,
            wake_word: None,
            metro_running: false,
        }
    }

    #[test]
    fn three_way_verdicts() {
        let m = rep_mode();
        assert_eq!(r("done", &m), Intent::RepCheck(Verdict::Pass, None));
        assert_eq!(r("clean", &m), Intent::RepCheck(Verdict::Pass, None));
        assert_eq!(r("yep", &m), Intent::RepCheck(Verdict::Pass, None));
        assert_eq!(r("sloppy", &m), Intent::RepCheck(Verdict::Flawed, None));
        assert_eq!(r("rough", &m), Intent::RepCheck(Verdict::Flawed, None));
        assert_eq!(r("almost", &m), Intent::RepCheck(Verdict::Flawed, None));
        assert_eq!(r("again", &m), Intent::RepCheck(Verdict::Fail, None));
        assert_eq!(r("nope", &m), Intent::RepCheck(Verdict::Fail, None));
        assert_eq!(r("no", &m), Intent::RepCheck(Verdict::Fail, None));
        assert_eq!(r("messed up", &m), Intent::RepCheck(Verdict::Fail, None));
        assert_eq!(r("failed", &m), Intent::RepCheck(Verdict::Fail, None));
    }

    #[test]
    fn fail_and_flawed_capture_a_trailing_note() {
        let m = rep_mode();
        assert_eq!(
            r("nope missed the left hand jump", &m),
            Intent::RepCheck(Verdict::Fail, Some("missed the left hand jump".into()))
        );
        assert_eq!(
            r("again fingering fell apart", &m),
            Intent::RepCheck(Verdict::Fail, Some("fingering fell apart".into()))
        );
        assert_eq!(
            r("sloppy rushed the runs", &m),
            Intent::RepCheck(Verdict::Flawed, Some("rushed the runs".into()))
        );
    }

    #[test]
    fn pass_never_captures_a_note() {
        // A pass word with a trailing clause is not a clean rep (and not ambient
        // enough to be a fail either) → it falls through to Ignored.
        assert_eq!(r("done and dusted for today", &rep_mode()), Intent::Ignored);
    }

    #[test]
    fn overlong_note_is_rejected() {
        // A verdict word leading a long ramble is ambient speech, not a rep note.
        assert_eq!(
            r(
                "no i really do not think we should keep going for much longer today",
                &rep_mode()
            ),
            Intent::Ignored
        );
    }

    #[test]
    fn rep_status_and_close() {
        let m = rep_mode();
        assert_eq!(r("where are we", &m), Intent::RepStatus);
        assert_eq!(r("how many left", &m), Intent::RepStatus);
        assert_eq!(r("status", &m), Intent::RepStatus);
        assert_eq!(r("close the block", &m), Intent::RepClose);
        assert_eq!(r("end the block", &m), Intent::RepClose);
        assert_eq!(r("close the tracker", &m), Intent::RepClose);
    }

    #[test]
    fn session_end_works_in_any_mode() {
        assert_eq!(r("end the session", &stopped()), Intent::SessionEnd);
        assert_eq!(r("end session", &running()), Intent::SessionEnd);
        assert_eq!(r("end the session", &rep_mode()), Intent::SessionEnd);
        // Not confused with closing a block.
        assert_ne!(r("end the block", &rep_mode()), Intent::SessionEnd);
    }

    #[test]
    fn rep_open_hero_phrase() {
        assert_eq!(
            r(
                "open a rep tracker measures 40 to 56 start at 80 target 120",
                &stopped()
            ),
            Intent::RepOpen(RepOpenSpec {
                m_start: 40,
                m_end: 56,
                start_bpm: Some(80.0),
                target_bpm: Some(120.0),
                reps: None,
            })
        );
    }

    #[test]
    fn rep_open_variants() {
        // "at N" is the start tempo, no target.
        assert_eq!(
            r("rep block measures 12 to 16 at 60", &stopped()),
            Intent::RepOpen(RepOpenSpec {
                m_start: 12,
                m_end: 16,
                start_bpm: Some(60.0),
                target_bpm: None,
                reps: None,
            })
        );
        // "through" range + explicit rep count.
        assert_eq!(
            r(
                "tracker measures 40 through 56 start at 80 target 120 twenty reps",
                &stopped()
            ),
            Intent::RepOpen(RepOpenSpec {
                m_start: 40,
                m_end: 56,
                start_bpm: Some(80.0),
                target_bpm: Some(120.0),
                reps: Some(20),
            })
        );
    }

    #[test]
    fn rep_open_works_in_rep_mode_too() {
        assert!(matches!(
            r("open a rep tracker measures 1 to 8 at 90", &rep_mode()),
            Intent::RepOpen(_)
        ));
    }

    #[test]
    fn rep_open_requires_both_range_numbers() {
        // Only one range number → not a valid open → Ignored.
        assert_eq!(
            r("open a rep tracker measures 40 start at 80", &stopped()),
            Intent::Ignored
        );
    }

    #[test]
    fn rep_open_requires_a_cue_and_measures() {
        // "measures 40 to 56" with no rep/tracker/block cue is ambient (e.g.
        // "the melody measures 40 to 56 are lovely").
        assert_eq!(
            r("the melody measures 40 to 56 are lovely", &stopped()),
            Intent::Ignored
        );
    }

    #[test]
    fn rep_open_firewall_rejects_ambient_measure_talk() {
        // This app is ALL about measures, so a musician constantly says "measures
        // N to N" in passing. A cue word + a range buried in a sentence with any
        // out-of-vocab word must NOT open a block (the command-shape gate). These
        // carry a cue (rep/block) + "measures 40 to 56" but are plainly ambient.
        for phrase in [
            "the block measures 40 to 56 are hard",
            "that rep in measures 40 to 56 was rough",
            "the rep i did on measures 12 to 16 felt shaky",
            "lets look at the block where measures 40 to 56 get tricky",
            "the tracker says measures 40 to 56 are the problem area",
        ] {
            assert_eq!(
                Router::route(phrase, &stopped()),
                Intent::Ignored,
                "ambient measure-talk must be Ignored: {phrase:?}"
            );
            assert_eq!(
                Router::route(phrase, &rep_mode()),
                Intent::Ignored,
                "…and in rep mode too: {phrase:?}"
            );
        }
    }

    // -------------------------------------------------- REP FIREWALL BATTERY
    #[test]
    fn rep_mode_does_not_misfire_on_ambient_speech() {
        // In rep mode, ordinary conversation that does NOT lead with a verdict
        // word must not be logged as a rep or note. (A leading fail/flawed token
        // *does* capture a short note by design — that is the "nope missed the
        // jump" path — so the ambient battery deliberately excludes utterances
        // that begin with one.)
        for phrase in [
            "i stopped by the store",
            "that was so clean of him",
            "can you pass the salt",
            "lets take a break",
            "the weather is rough today",
            "i almost forgot to tell you something important earlier",
            "yes please that would be lovely thank you so much",
            "we should probably close the window it is cold",
            "where are we going for dinner tonight",
            "how many people are coming to the party",
            "the timing there was clean but the pedal was muddy",
            "that sounded good to me overall",
        ] {
            let got = Router::route(phrase, &rep_mode());
            assert!(
                matches!(got, Intent::Ignored),
                "ambient in rep mode must be Ignored: {phrase:?} → {got:?}"
            );
        }
    }

    #[test]
    fn non_rep_mode_ignores_bare_verdict_and_flawed_words() {
        // Outside a block these are ambient.
        for phrase in [
            "sloppy",
            "rough",
            "almost",
            "nope",
            "that was so clean of him",
        ] {
            assert_eq!(
                Router::route(phrase, &running()),
                Intent::Ignored,
                "rep vocab outside rep mode must be Ignored: {phrase:?}"
            );
        }
    }

    // --------------------------------------------------- LOOSER MATCHING (S9)
    // Christian, July 31: the router felt like "Siri 2015" — the exact phrase
    // worked and everything a person actually says did not. Two narrow changes
    // answer that (`fold_metronome`, `strip_courtesy`), and these tests pin both
    // ends of them: the forms that must now route, and the ambient sentences
    // that must still not.

    #[test]
    fn asr_mangles_of_metronome_route_like_the_word() {
        for mangle in [
            "metranome",
            "metrodome",
            "metro gnome",
            "metro nome",
        ] {
            assert_eq!(
                r(&format!("{mangle} off"), &running()),
                Intent::MetroStop,
                "{mangle:?} off"
            );
            assert_eq!(
                r(&format!("{mangle} on"), &stopped()),
                Intent::MetroStart(None),
                "{mangle:?} on"
            );
            assert_eq!(
                r(&format!("{mangle} 96"), &stopped()),
                Intent::MetroStart(Some(96.0)),
                "{mangle:?} 96"
            );
        }
    }

    #[test]
    fn canonicalize_folds_only_the_mangle_and_leaves_the_rest_alone() {
        assert_eq!(canonicalize("Metro-Gnome, off!"), "metronome off");
        assert_eq!(canonicalize("metranome"), "metronome");
        // Not a mangle: "metro" alone, and words that merely start the same way.
        assert_eq!(canonicalize("the metro is closed"), "the metro is closed");
        assert_eq!(canonicalize("metronomic playing"), "metronomic playing");
    }

    #[test]
    fn natural_command_forms_route() {
        for phrase in [
            "turn the metronome off",
            "turn metronome off",
            "can you stop the metronome",
            "could you turn the metronome off",
            "hey can you stop the metronome",
            "metronome please stop",
            "kill the metronome",
        ] {
            assert_eq!(r(phrase, &running()), Intent::MetroStop, "{phrase:?}");
        }
        for phrase in [
            "turn the metronome on",
            "start the metronome",
            "can you start the metronome",
            "okay start the metronome",
        ] {
            assert_eq!(
                r(phrase, &stopped()),
                Intent::MetroStart(None),
                "{phrase:?}"
            );
        }
    }

    #[test]
    fn courtesy_stripping_does_not_open_the_firewall() {
        // Each of these carries command tokens AND a courtesy opener, and each
        // is ambient. What rejects them is unchanged: too long, or built from
        // words the command vocabulary does not contain.
        for phrase in [
            "can you believe the metronome on that recording",
            "could you hear the metronome on the last take",
            "hey the metronome off days are behind me",
            "okay so the metronome was off the whole time",
        ] {
            assert_eq!(r(phrase, &running()), Intent::Ignored, "{phrase:?}");
        }
    }

    #[test]
    fn there_is_no_context_memory_for_a_bare_object() {
        // "turn it off" has no object. The metronome may well be running and it
        // may well be what the user meant — the router does not guess, because
        // guessing is how an ambient "turn it off" stops a take.
        for phrase in ["turn it off", "turn that off", "shut it off", "off"] {
            assert_eq!(r(phrase, &running()), Intent::Ignored, "{phrase:?}");
        }
    }

    #[test]
    fn a_bare_courtesy_opener_is_not_a_command() {
        for phrase in ["hey", "can you", "okay", "hey can you"] {
            assert_eq!(r(phrase, &running()), Intent::Ignored, "{phrase:?}");
        }
    }
}
