//! Fixtures built directly from Christian's July 31 voice complaints (v6 S9).
//!
//! The narrated-session corpus (`narrated_session_*.rs`) proves the firewall
//! still holds against real recorded practice. It cannot prove the other half:
//! that the commands he *reported broken* now work. Those phrases were never
//! recorded — they are what he said the app failed to hear — so they get their
//! own table here, with each case tagged by the complaint it answers.
//!
//! Three complaints, three groups:
//!
//! * **"'metronome off' barely works"** — `Mangle`: the recognizer's spellings
//!   of the word, which the router used to have no idea about.
//! * **"metronome on is like delayed by 5 seconds"** — `FastPath`: the phrases
//!   allowed to act on a partial. Routing is asserted here; that they fire early
//!   is asserted in `voice_loop`'s own tests, where the allowlist lives.
//! * **"it's like Siri 2015"** — `Natural`: the forms a person actually says.
//!
//! And the group that keeps the other three honest: **`Adversarial`** — ambient
//! sentences carrying command words that must still route nowhere. Every
//! loosening above is only acceptable because these hold.

use praelude_lib::intent::{canonicalize, Intent, Mode, Router};

/// Which July 31 complaint (or which guard) a case exists for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Complaint {
    /// "'metronome off' barely works" — ASR mangles of the word.
    Mangle,
    /// "metronome on is like delayed by 5 seconds" — fast-path phrases.
    FastPath,
    /// "it's like Siri 2015" — natural spoken forms.
    Natural,
    /// The firewall these loosenings are only safe because of.
    Adversarial,
}

struct Case {
    complaint: Complaint,
    text: &'static str,
    /// `true` when the metronome is running as the phrase is heard.
    running: bool,
    expect: Intent,
}

const fn c(complaint: Complaint, text: &'static str, running: bool, expect: Intent) -> Case {
    Case {
        complaint,
        text,
        running,
        expect,
    }
}

fn cases() -> Vec<Case> {
    use Complaint::*;
    vec![
        // -- "'metronome off' barely works" -------------------------------
        // Every mangle, against every command shape it can carry.
        c(Mangle, "metranome off", true, Intent::MetroStop),
        c(Mangle, "metrodome off", true, Intent::MetroStop),
        c(Mangle, "metro gnome off", true, Intent::MetroStop),
        c(Mangle, "metro nome off", true, Intent::MetroStop),
        c(Mangle, "metranome stop", true, Intent::MetroStop),
        c(Mangle, "turn the metrodome off", true, Intent::MetroStop),
        c(Mangle, "metranome on", false, Intent::MetroStart(None)),
        c(Mangle, "metrodome on", false, Intent::MetroStart(None)),
        c(Mangle, "metro gnome on", false, Intent::MetroStart(None)),
        c(Mangle, "metro nome on", false, Intent::MetroStart(None)),
        c(
            Mangle,
            "metranome ninety six",
            false,
            Intent::MetroStart(Some(96.0)),
        ),
        // Punctuation and casing are the recognizer's, not the user's.
        c(Mangle, "Metro-Gnome, off!", true, Intent::MetroStop),
        // -- "metronome on is delayed by 5 seconds" ------------------------
        // The fast-path allowlist, as finals. (Partial behaviour is pinned in
        // `voice_loop::tests`, next to the allowlist itself.)
        c(FastPath, "metronome off", true, Intent::MetroStop),
        c(FastPath, "metronome stop", true, Intent::MetroStop),
        c(FastPath, "metronome on", false, Intent::MetroStart(None)),
        c(FastPath, "stop", true, Intent::MetroStop),
        // ...and the state guard that keeps a bare "stop" ambient.
        c(FastPath, "stop", false, Intent::Ignored),
        // -- "it's like Siri 2015" ----------------------------------------
        c(Natural, "turn the metronome off", true, Intent::MetroStop),
        c(Natural, "turn metronome off", true, Intent::MetroStop),
        c(
            Natural,
            "can you stop the metronome",
            true,
            Intent::MetroStop,
        ),
        c(
            Natural,
            "could you turn the metronome off",
            true,
            Intent::MetroStop,
        ),
        c(
            Natural,
            "would you turn the metronome off",
            true,
            Intent::MetroStop,
        ),
        c(
            Natural,
            "hey can you stop the metronome",
            true,
            Intent::MetroStop,
        ),
        c(Natural, "metronome please stop", true, Intent::MetroStop),
        c(
            Natural,
            "please stop the metronome",
            true,
            Intent::MetroStop,
        ),
        c(Natural, "kill the metronome", true, Intent::MetroStop),
        c(
            Natural,
            "turn the metronome on",
            false,
            Intent::MetroStart(None),
        ),
        c(
            Natural,
            "start the metronome",
            false,
            Intent::MetroStart(None),
        ),
        c(
            Natural,
            "can you start the metronome",
            false,
            Intent::MetroStart(None),
        ),
        c(
            Natural,
            "okay start the metronome",
            false,
            Intent::MetroStart(None),
        ),
        // -- The firewall -------------------------------------------------
        // Command words inside ordinary practice talk. Each of these carries a
        // token the loosenings above act on, and each must route nowhere.
        c(
            Adversarial,
            "i think the metronome off days are behind me",
            true,
            Intent::Ignored,
        ),
        c(
            Adversarial,
            "can you believe the metronome on that recording",
            true,
            Intent::Ignored,
        ),
        c(
            Adversarial,
            "we're done with the slow section, again from the top",
            true,
            Intent::Ignored,
        ),
        c(
            Adversarial,
            "the metranome was off the whole time and i never noticed",
            true,
            Intent::Ignored,
        ),
        c(
            Adversarial,
            "could you hear the metro gnome on the last take",
            true,
            Intent::Ignored,
        ),
        c(
            Adversarial,
            "i asked if you could stop the metronome",
            true,
            Intent::Ignored,
        ),
        // No context memory: a bare object never inherits "the metronome".
        c(Adversarial, "turn it off", true, Intent::Ignored),
        c(Adversarial, "shut it off", true, Intent::Ignored),
        // Courtesy with nothing behind it.
        c(Adversarial, "hey", true, Intent::Ignored),
        c(Adversarial, "can you", true, Intent::Ignored),
        c(Adversarial, "hey can you", true, Intent::Ignored),
    ]
}

fn mode(running: bool) -> Mode {
    Mode {
        rep_block_active: false,
        wake_word: None,
        metro_running: running,
    }
}

#[test]
fn every_july_31_complaint_phrase_routes_as_intended() {
    for case in cases() {
        assert_eq!(
            Router::route(case.text, &mode(case.running)),
            case.expect,
            "[{:?}] {:?} (metronome {})",
            case.complaint,
            case.text,
            if case.running { "running" } else { "stopped" }
        );
    }
}

/// The adversarial group is the load-bearing one — it is what makes the other
/// three safe rather than reckless. Assert it is actually populated, so a future
/// edit cannot quietly delete the firewall half of this file and stay green.
#[test]
fn every_complaint_has_coverage_and_the_firewall_is_not_empty() {
    let all = cases();
    for complaint in [
        Complaint::Mangle,
        Complaint::FastPath,
        Complaint::Natural,
        Complaint::Adversarial,
    ] {
        let n = all.iter().filter(|c| c.complaint == complaint).count();
        assert!(n >= 4, "{complaint:?} has only {n} cases");
    }
    let adversarial = all
        .iter()
        .filter(|c| c.complaint == Complaint::Adversarial)
        .count();
    assert!(
        adversarial >= 8,
        "the firewall group must stay substantial; found {adversarial}"
    );
}

/// The mangle fold is a rewrite of the *word*, not of the sentence: it must
/// leave everything else exactly as normalization produced it.
#[test]
fn canonicalize_folds_the_mangle_and_nothing_else() {
    assert_eq!(canonicalize("Metro-Gnome, off!"), "metronome off");
    assert_eq!(canonicalize("metranome"), "metronome");
    assert_eq!(
        canonicalize("metro nome ninety six"),
        "metronome ninety six"
    );
    // Words that merely start the same way are untouched.
    assert_eq!(canonicalize("the metro is closed"), "the metro is closed");
    assert_eq!(canonicalize("metronomic playing"), "metronomic playing");
}
