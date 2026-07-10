//! Deterministic English word-number parser for tempo values.
//!
//! Handles the three spoken forms a musician actually uses for a BPM:
//!
//! * **Digits** — `"96"` → `96`.
//! * **Standard cardinals** — `"ninety six"` → `96`, `"one hundred twenty"` →
//!   `120`, `"two hundred"` → `200`.
//! * **Compact hundreds** (the shorthand `"one twenty"` really means `120`, not
//!   `1 + 20`) — `"one twenty"` → `120`, `"two forty"` → `240`,
//!   `"one twenty five"` → `125`, `"one fifteen"` → `115`.
//! * **Spelled digit runs** — `"one oh five"` → `105`.
//!
//! Returns `None` for anything that is not a clean number phrase (so the router's
//! caller can treat "no parseable number" as a distinct signal). This is
//! intentionally strict: a single unknown token poisons the whole parse, so
//! ambient words never masquerade as a tempo.
//!
//! No `regex`, no allocation beyond the token split — pure, exhaustively unit
//! tested below.

/// A single number-word atom.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Atom {
    /// A digit 0–9 spoken as a word (`one`..`nine`, `oh`, `zero`).
    Digit(u32),
    /// A teen 10–19.
    Teen(u32),
    /// A round ten 20,30,…,90.
    Tens(u32),
    Hundred,
    Thousand,
    /// A bare integer literal token like `"96"`.
    Literal(f64),
}

/// Classify one lowercased token as a number atom, or `None` if it is not a
/// number word. `"and"` is filtered out by the caller before classification.
fn classify(tok: &str) -> Option<Atom> {
    let a = match tok {
        "zero" | "oh" => Atom::Digit(0),
        "one" => Atom::Digit(1),
        "two" => Atom::Digit(2),
        "three" => Atom::Digit(3),
        "four" => Atom::Digit(4),
        "five" => Atom::Digit(5),
        "six" => Atom::Digit(6),
        "seven" => Atom::Digit(7),
        "eight" => Atom::Digit(8),
        "nine" => Atom::Digit(9),
        "ten" => Atom::Teen(10),
        "eleven" => Atom::Teen(11),
        "twelve" => Atom::Teen(12),
        "thirteen" => Atom::Teen(13),
        "fourteen" => Atom::Teen(14),
        "fifteen" => Atom::Teen(15),
        "sixteen" => Atom::Teen(16),
        "seventeen" => Atom::Teen(17),
        "eighteen" => Atom::Teen(18),
        "nineteen" => Atom::Teen(19),
        "twenty" => Atom::Tens(20),
        "thirty" => Atom::Tens(30),
        "forty" | "fourty" => Atom::Tens(40),
        "fifty" => Atom::Tens(50),
        "sixty" => Atom::Tens(60),
        "seventy" => Atom::Tens(70),
        "eighty" => Atom::Tens(80),
        "ninety" => Atom::Tens(90),
        "hundred" => Atom::Hundred,
        "thousand" => Atom::Thousand,
        _ => {
            // A pure-digit token ("96", "120").
            if !tok.is_empty() && tok.bytes().all(|b| b.is_ascii_digit()) {
                Atom::Literal(tok.parse::<f64>().ok()?)
            } else {
                return None;
            }
        }
    };
    Some(a)
}

/// Parse an English number phrase (words, digits, or the musician "one twenty"
/// shorthand) into a value. Returns `None` unless the *entire* input is a clean
/// number phrase.
pub fn parse_number(input: &str) -> Option<f64> {
    let norm = input.trim().to_ascii_lowercase();
    if norm.is_empty() {
        return None;
    }
    // Split on whitespace and hyphens so "ninety-six" == "ninety six".
    let tokens: Vec<&str> = norm
        .split(|c: char| c.is_whitespace() || c == '-')
        .filter(|t| !t.is_empty() && *t != "and")
        .collect();
    if tokens.is_empty() {
        return None;
    }

    let atoms: Vec<Atom> = tokens
        .iter()
        .map(|t| classify(t))
        .collect::<Option<Vec<_>>>()?;

    // A bare integer literal is only accepted when it stands alone; a literal
    // mixed with words ("one 20") is rejected as malformed.
    let literal_count = atoms.iter().filter(|a| matches!(a, Atom::Literal(_))).count();
    if literal_count > 0 {
        if atoms.len() == 1 {
            if let Atom::Literal(v) = atoms[0] {
                return Some(v);
            }
        }
        return None;
    }

    // Spelled digit run: every atom a Digit, ≥2 of them, first non-zero →
    // concatenate ("one oh five" → 105, "nine six" → 96).
    if atoms.len() >= 2 && atoms.iter().all(|a| matches!(a, Atom::Digit(_))) {
        if let Atom::Digit(first) = atoms[0] {
            if first != 0 {
                let mut v = 0u64;
                for a in &atoms {
                    if let Atom::Digit(d) = a {
                        v = v * 10 + *d as u64;
                    }
                }
                return Some(v as f64);
            }
        }
    }

    // Compact hundreds: [Digit 1–9] followed by a Teen or Tens, with no explicit
    // hundred/thousand → digit*100 + standard(rest). "one twenty" → 120.
    if atoms.len() >= 2 {
        if let Atom::Digit(d) = atoms[0] {
            if (1..=9).contains(&d)
                && matches!(atoms[1], Atom::Teen(_) | Atom::Tens(_))
                && !atoms
                    .iter()
                    .any(|a| matches!(a, Atom::Hundred | Atom::Thousand))
            {
                let rest = standard(&atoms[1..])?;
                return Some(d as f64 * 100.0 + rest);
            }
        }
    }

    standard(&atoms)
}

/// Standard positional accumulation for cardinal number words.
fn standard(atoms: &[Atom]) -> Option<f64> {
    let mut result: f64 = 0.0;
    let mut current: f64 = 0.0;
    for a in atoms {
        match a {
            Atom::Digit(d) => current += *d as f64,
            Atom::Teen(t) | Atom::Tens(t) => current += *t as f64,
            Atom::Hundred => current = if current == 0.0 { 100.0 } else { current * 100.0 },
            Atom::Thousand => {
                result += if current == 0.0 { 1000.0 } else { current * 1000.0 };
                current = 0.0;
            }
            Atom::Literal(_) => return None,
        }
    }
    Some(result + current)
}

#[cfg(test)]
mod tests {
    use super::parse_number;

    fn n(s: &str) -> Option<f64> {
        parse_number(s)
    }

    #[test]
    fn digits() {
        assert_eq!(n("96"), Some(96.0));
        assert_eq!(n("120"), Some(120.0));
        assert_eq!(n("7"), Some(7.0));
        assert_eq!(n("0"), Some(0.0));
        assert_eq!(n("1000"), Some(1000.0));
    }

    #[test]
    fn standard_cardinals() {
        assert_eq!(n("ninety six"), Some(96.0));
        assert_eq!(n("ninety-six"), Some(96.0));
        assert_eq!(n("seven"), Some(7.0));
        assert_eq!(n("twenty"), Some(20.0));
        assert_eq!(n("twenty one"), Some(21.0));
        assert_eq!(n("forty"), Some(40.0));
        assert_eq!(n("one hundred"), Some(100.0));
        assert_eq!(n("one hundred twenty"), Some(120.0));
        assert_eq!(n("one hundred and twenty"), Some(120.0));
        assert_eq!(n("one hundred twenty five"), Some(125.0));
        assert_eq!(n("two hundred"), Some(200.0));
        assert_eq!(n("three hundred sixty"), Some(360.0));
        assert_eq!(n("two thousand"), Some(2000.0));
    }

    #[test]
    fn compact_hundreds_shorthand() {
        assert_eq!(n("one twenty"), Some(120.0), "musician shorthand, not 21");
        assert_eq!(n("two forty"), Some(240.0));
        assert_eq!(n("one twenty five"), Some(125.0));
        assert_eq!(n("one fifteen"), Some(115.0));
        assert_eq!(n("one ten"), Some(110.0));
        assert_eq!(n("one sixty"), Some(160.0));
        assert_eq!(n("three thirty"), Some(330.0));
    }

    #[test]
    fn spelled_digit_runs() {
        assert_eq!(n("one oh five"), Some(105.0));
        assert_eq!(n("nine six"), Some(96.0));
        assert_eq!(n("one oh oh"), Some(100.0));
    }

    #[test]
    fn case_and_whitespace_insensitive() {
        assert_eq!(n("  Ninety   Six "), Some(96.0));
        assert_eq!(n("NINETY-SIX"), Some(96.0));
    }

    #[test]
    fn rejects_non_numbers() {
        assert_eq!(n(""), None);
        assert_eq!(n("   "), None);
        assert_eq!(n("banana"), None);
        assert_eq!(n("ninety banana"), None);
        assert_eq!(n("one twenty banana"), None);
        assert_eq!(n("the corner"), None);
        assert_eq!(n("one 20"), None, "mixed literal + words is malformed");
        assert_eq!(n("stop"), None);
    }
}
