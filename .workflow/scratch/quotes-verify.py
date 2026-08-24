#!/usr/bin/env python3
"""
Verification script for CodaKiller Home-screen quote corpus (ledger #27).

Checks that every quote's "text" field is a verbatim, contiguous substring of
its named source markdown file. The source files are hard-wrapped prose (each
paragraph broken across many short lines), so before comparing, all whitespace
runs (including those wrapped newlines) are collapsed to single spaces in both
the quote and the source text -- this is the correct notion of "contiguous
substring" for hard-wrapped text; it does not let a match cross a paragraph's
actual content, only line-wrap boundaries. If a quote still does not match,
the script also retries with a trailing "." appended, to allow for the
documented case of a curator deliberately dropping a trailing period from the
source sentence.

Usage: python3 quotes-verify.py
"""

import json
import os
import re
import sys


def normalize(s):
    """Collapse all whitespace runs (including the hard-wrap newlines the
    source markdown files use inside paragraphs) to a single space, so a
    quote that happens to span a wrapped line break in the source still
    counts as a valid contiguous substring of the underlying prose."""
    return re.sub(r"\s+", " ", s).strip()


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
QUOTES_JSON = os.path.join(SCRIPT_DIR, "quotes-draft.json")

KNOWLEDGE_DIR = (
    "/Users/c3/Desktop/christian's universe/Piano Practice/Knowledge and Resources"
)

SOURCE_FILES = {
    "roskell-complete-pianist": os.path.join(KNOWLEDGE_DIR, "the-complete-pianist.md"),
    "gebrian-learn-faster": os.path.join(
        KNOWLEDGE_DIR, "learn-faster-perform-better.md"
    ),
    "breth-effective-practicing": os.path.join(
        KNOWLEDGE_DIR, "the-piano-students-guide-to-effective-practicing.md"
    ),
    "gieseking-leimer-technique": os.path.join(
        KNOWLEDGE_DIR, "gieseking-leimer-piano-technique.md"
    ),
}


def load_sources():
    texts = {}
    for source_id, path in SOURCE_FILES.items():
        with open(path, "r", encoding="utf-8") as f:
            texts[source_id] = normalize(f.read())
    return texts


def main():
    with open(QUOTES_JSON, "r", encoding="utf-8") as f:
        quotes = json.load(f)

    sources = load_sources()

    total = len(quotes)
    passed = 0
    failed = []
    per_book = {}
    word_count_violations = []
    id_seen = set()
    dup_ids = []

    for q in quotes:
        qid = q.get("id", "<no id>")
        if qid in id_seen:
            dup_ids.append(qid)
        id_seen.add(qid)

        source_id = q.get("source_id")
        text = q.get("text", "")
        per_book.setdefault(source_id, {"total": 0, "passed": 0})
        per_book[source_id]["total"] += 1

        if source_id not in sources:
            failed.append((qid, source_id, "unknown source_id"))
            continue

        haystack = sources[source_id]
        stripped = normalize(text)

        ok = stripped in haystack
        if not ok:
            # allow for a deliberately-dropped trailing period
            if (stripped + ".") in haystack:
                ok = True

        if ok:
            passed += 1
            per_book[source_id]["passed"] += 1
        else:
            failed.append((qid, source_id, "NOT FOUND verbatim in source"))

        wc = len(stripped.split())
        if wc > 40:
            word_count_violations.append((qid, wc))

    print(f"=== Verification of {QUOTES_JSON} ===")
    print(f"Total quotes: {total}")
    print(f"Verbatim substring PASS: {passed}")
    print(f"Verbatim substring FAIL: {len(failed)}")
    print()
    print("Per-book breakdown:")
    for source_id, stats in per_book.items():
        print(f"  {source_id}: {stats['passed']}/{stats['total']} passed")
    print()
    if dup_ids:
        print(f"DUPLICATE IDs found ({len(dup_ids)}): {dup_ids}")
    else:
        print("No duplicate IDs.")
    print()
    if word_count_violations:
        print(f"Quotes over 40 words ({len(word_count_violations)}):")
        for qid, wc in word_count_violations:
            print(f"  {qid}: {wc} words")
    else:
        print("All quotes are <= 40 words.")
    print()
    if failed:
        print(f"FAILED quotes ({len(failed)}):")
        for qid, source_id, reason in failed:
            print(f"  {qid} [{source_id}]: {reason}")
        print()
        print("RESULT: FAIL")
        sys.exit(1)
    else:
        print("RESULT: PASS -- every quote is a verbatim substring of its source file.")
        sys.exit(0)


if __name__ == "__main__":
    main()
