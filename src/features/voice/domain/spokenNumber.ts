const DIGITS: Readonly<Record<string, number>> = {
  zero: 0,
  oh: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};

const TEENS: Readonly<Record<string, number>> = {
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Readonly<Record<string, number>> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function own(table: Readonly<Record<string, number>>, key: string): number | null {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
}

function parseUnderHundred(words: readonly string[]): number | null {
  if (words.length === 1) {
    return own(DIGITS, words[0]) ?? own(TEENS, words[0]) ?? own(TENS, words[0]);
  }
  if (words.length === 2) {
    const tens = own(TENS, words[0]);
    const unit = own(DIGITS, words[1]);
    if (tens !== null && unit !== null && unit > 0) return tens + unit;
  }
  return null;
}

function parseStandard(words: readonly string[]): number | null {
  if (words.length === 0) return null;
  const hundred = words.indexOf("hundred");
  if (hundred < 0) return parseUnderHundred(words);
  if (hundred !== 1 || words.lastIndexOf("hundred") !== hundred) return null;

  const hundreds = own(DIGITS, words[0]);
  if (hundreds === null || hundreds === 0) return null;
  let rest = words.slice(2);
  if (rest[0] === "and") rest = rest.slice(1);
  if (rest.includes("and")) return null;
  if (rest.length === 0) return hundreds * 100;
  const underHundred = parseUnderHundred(rest);
  return underHundred === null ? null : hundreds * 100 + underHundred;
}

/**
 * Parse a complete, bounded English integer phrase. Unknown or homophone words
 * poison the entire parse (`for` is never silently treated as `four`).
 */
export function parseSpokenInteger(input: string): number | null {
  const normalized = input.trim().toLocaleLowerCase("en-US");
  if (normalized === "") return null;
  const words = normalized
    .split(/[\s-]+/u)
    .filter((word) => word !== "");
  if (words.length === 0) return null;

  if (words.length === 1 && /^\d+$/u.test(words[0])) {
    const parsed = Number(words[0]);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  if (words.some((word) => /^\d+$/u.test(word))) return null;

  // ASR often emits digit-by-digit speech (`nine six`, `one oh five`).
  if (words.length >= 2 && words.every((word) => own(DIGITS, word) !== null)) {
    if (own(DIGITS, words[0]) === 0) return null;
    const joined = words.map((word) => String(own(DIGITS, word))).join("");
    const parsed = Number(joined);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  // Musician shorthand: `one twenty` means 120, not 21.
  if (words.length >= 2) {
    const leading = own(DIGITS, words[0]);
    const rest = parseUnderHundred(words.slice(1));
    if (
      leading !== null
      && leading > 0
      && rest !== null
      && rest >= 10
    ) {
      return leading * 100 + rest;
    }
  }

  return parseStandard(words);
}

/**
 * Count declarations reject digit-by-digit word runs (`one two`): unlike a BPM,
 * that shape can be an enumeration rather than the integer 12. A user can say
 * `twelve` or the literal `12` without ambiguity.
 */
export function parseSpokenCountInteger(input: string): number | null {
  const words = input
    .trim()
    .toLocaleLowerCase("en-US")
    .split(/[\s-]+/u)
    .filter((word) => word !== "");
  if (words.length >= 2 && words.every((word) => own(DIGITS, word) !== null)) {
    return null;
  }
  return parseSpokenInteger(input);
}
