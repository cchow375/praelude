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

/// Rep-check outcome, used once P3 wires practice-rep mode. Carried by
/// [`Intent::RepCheck`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// The rep was clean ("done", "got it", "nailed it").
    Pass,
    /// The rep was missed ("again", "messed up", "no").
    Fail,
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
    /// A practice-rep self-assessment (P3 mode). The `String` is an optional note.
    RepCheck(Verdict, Option<String>),
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
        // 1. Normalize: lowercase, punctuation & hyphens → spaces, collapse runs.
        let norm = normalize(text);
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

        // 3. Rep-check grammar takes priority inside an active rep block.
        if mode.rep_block_active {
            if let Some(v) = rep_verdict(&words) {
                return Intent::RepCheck(v, None);
            }
        }

        // 4. Metronome grammar.
        if let Some(intent) = route_metronome(&words, mode) {
            return intent;
        }

        // 5. Wake-prefixed but unmatched → a Question for the future assistant path.
        if mode.wake_word.is_some() {
            return Intent::Question(body);
        }

        Intent::Ignored
    }
}

/// Lowercase, turn every non-alphanumeric char into a space, and collapse runs of
/// whitespace. Apostrophes are dropped (so "let's" → "lets").
fn normalize(text: &str) -> String {
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

/// Words that mean "clean rep" vs "missed rep" in an active rep block.
fn rep_verdict(words: &[&str]) -> Option<Verdict> {
    let joined = words.join(" ");
    const PASS: &[&str] = &[
        "done", "got it", "get it", "nailed it", "clean", "perfect", "good", "yes", "yep",
    ];
    const FAIL: &[&str] = &[
        "again", "miss", "missed", "messed up", "mess up", "fail", "failed", "no", "retry",
    ];
    if PASS.iter().any(|p| joined == *p) {
        return Some(Verdict::Pass);
    }
    if FAIL.iter().any(|p| joined == *p) {
        return Some(Verdict::Fail);
    }
    None
}

fn has(words: &[&str], w: &str) -> bool {
    words.contains(&w)
}

/// Core metronome grammar. Returns `None` if nothing matched (→ Ignored/Question).
fn route_metronome(words: &[&str], mode: &Mode) -> Option<Intent> {
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
        "metronome", "off", "stop", "turn", "the", "please", "halt", "kill", "it", "now",
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
    // a number homophone fill the number slot: "for" → "four", "to"/"too" → "two".
    // Gating on the confirmed shape is what keeps "what is this for" (no cue) and
    // "take two" (no direction) from ever mapping a homophone to a tempo.
    let mapped: Vec<&str> = words
        .iter()
        .map(|w| homophone_number(w).unwrap_or(w))
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

/// Map a number homophone to its spelled number word. Only `for`/`to`/`too` — the
/// homophones the on-device recognizer actually produces for `four`/`two`. The
/// caller applies this ONLY after confirming the utterance is a complete command
/// shape, so these common English words never become tempos in ambient speech.
fn homophone_number(w: &str) -> Option<&'static str> {
    match w {
        "for" => Some("four"),
        "to" | "too" => Some("two"),
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
        assert_eq!(r("metronome 96", &stopped()), Intent::MetroStart(Some(96.0)));
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
        assert_eq!(r("start the metronome", &stopped()), Intent::MetroStart(None));
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
        assert_eq!(r("we should stop for lunch soon", &running()), Intent::Ignored);
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
    fn asr_ism_folding_does_not_weaken_firewall() {
        // Homophones only map inside a confirmed command shape; verb folds only
        // apply to known vocab verbs. None of these are commands.
        assert_eq!(r("what is this for", &running()), Intent::Ignored);
        assert_eq!(r("what is this for", &stopped()), Intent::Ignored);
        assert_eq!(r("I bumped into her", &running()), Intent::Ignored);
        assert_eq!(r("I bumped into her", &stopped()), Intent::Ignored);
        assert_eq!(r("take two", &running()), Intent::Ignored, "no direction cue");
        assert_eq!(r("take two", &stopped()), Intent::Ignored, "no direction cue");
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
            "ninety six",             // number with no command
            "one twenty",             // number with no command
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
}
