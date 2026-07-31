#!/usr/bin/env bash
#
# Vault side of the v11 -> v12 "Chamber Pieces Tanglewood" split.
#
# The folder ".../Pieces/Chamber Pieces Tanglewood" was a staging drawer holding
# two unrelated works:
#
#   Christian_C_Barber_Pas_de_Deux_Primo.pdf     -> Barber, Pas de Deux
#   Christian_C_Copland_Cowboys_with_Lassos.pdf  -> Copland, Cowboys with Lassos
#                                                   (from Billy the Kid)
#
# The database migration (src-tauri/src/store/migrations.rs, schema v12) splits
# the piece row and moves the practice graph. This script does the matching
# filesystem work so the app can re-discover an edition inside each new folder.
#
# GUARANTEES
#   * NON-DESTRUCTIVE. It only creates directories and COPIES files. It never
#     overwrites and never deletes anything, and by default the original
#     "Chamber Pieces Tanglewood" folder is left exactly as it is. The single
#     opt-in `--hide-original` flag renames that folder (see below); even then
#     nothing is removed.
#   * IDEMPOTENT. Re-running it after a successful run copies nothing and exits 0.
#   * REVERSIBLE. Undo is: delete the two folders it created (they contain only
#     copies), and `mv` the original back if it was hidden. `--undo` prints the
#     exact commands; it does not run them.
#   * DRY RUN BY DEFAULT. Nothing is written unless you pass --apply.
#
# WHY `cp -p` AND WHY THE PDFs SIT AT THE FOLDER ROOT (not in `score/`):
#   `score::pdf_editions` identifies an edition by its path RELATIVE to the piece
#   folder, and fingerprints it as "<size>-<mtime>" in hex. The existing
#   calibration row for the Barber was saved with edition id
#   "Christian_C_Barber_Pas_de_Deux_Primo.pdf" (a folder-root path) and
#   fingerprint 83cfa9-6a5674d0. Copying with -p to the folder ROOT keeps both
#   the relative id and the mtime, so that calibration still resolves.
#
# AFTER THE SPLIT, NOTHING POINTS AT THE OLD DRAWER
#   The migration re-points the surviving piece row at the new Barber folder, so
#   no piece row references "Chamber Pieces Tanglewood" any more. Because the
#   folder is still on disk, the next startup vault scan re-ingests it as a
#   third, historyless piece. Pass --hide-original to rename it to
#   "_Chamber Pieces Tanglewood", which the scanner skips (same rule as
#   `_piece-template`). That is a rename, not a delete; --undo prints the mv.
#
# USAGE
#   scripts/split-tanglewood-folders.sh                    # dry run (default)
#   scripts/split-tanglewood-folders.sh --apply            # do it
#   scripts/split-tanglewood-folders.sh --apply --hide-original
#   scripts/split-tanglewood-folders.sh --undo             # print undo commands
#   PIECES_DIR=/some/other/Pieces scripts/split-tanglewood-folders.sh --apply
#
set -euo pipefail

# NB: the apostrophe in "christian's" must not sit inside a ${VAR:-word}
# default — bash 3.2 (the /bin/bash macOS ships) treats it as a quote there.
DEFAULT_PIECES_DIR="$HOME/Desktop/christian's universe/Piano Practice/Pieces"
PIECES_DIR="${PIECES_DIR:-$DEFAULT_PIECES_DIR}"

SOURCE_FOLDER="Chamber Pieces Tanglewood"
BARBER_PDF="Christian_C_Barber_Pas_de_Deux_Primo.pdf"
COPLAND_PDF="Christian_C_Copland_Cowboys_with_Lassos.pdf"
BARBER_FOLDER="Barber - Pas de Deux"
COPLAND_FOLDER="Copland - Cowboys with Lassos (Billy the Kid)"
# The app's own append-only per-piece session log. The one in the merged folder
# documents blocks 97/98 — both Copland — so it is carried to the Copland only.
SESSIONS_MD="(C) codakiller-sessions.md"

APPLY=0
HIDE_ORIGINAL=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    --hide-original) HIDE_ORIGINAL=1 ;;
    --undo)
      echo "Undo removes ONLY the two folders this script creates (they hold copies):"
      echo
      echo "  rm -rf \"$PIECES_DIR/$BARBER_FOLDER\" \\"
      echo "         \"$PIECES_DIR/$COPLAND_FOLDER\""
      echo
      echo "And if --hide-original was used, un-hide with:"
      echo
      echo "  mv \"$PIECES_DIR/_$SOURCE_FOLDER\" \"$PIECES_DIR/$SOURCE_FOLDER\""
      echo
      echo "Nothing is ever deleted by this script, so nothing is lost."
      echo "Not running any of it — copy the command yourself if that is what you want."
      exit 0
      ;;
    *)
      echo "usage: $(basename "$0") [--dry-run | --apply] [--hide-original] | --undo" >&2
      exit 2
      ;;
  esac
done

src="$PIECES_DIR/$SOURCE_FOLDER"
# A previous run with --hide-original renamed the drawer. Keep reading from it
# so re-running the script stays a clean no-op instead of failing a precondition.
if [ ! -d "$src" ] && [ -d "$PIECES_DIR/_$SOURCE_FOLDER" ]; then
  src="$PIECES_DIR/_$SOURCE_FOLDER"
fi

if [ "$APPLY" -eq 1 ]; then
  echo "== APPLY: copying Tanglewood scores into their real piece folders =="
else
  echo "== DRY RUN (nothing will be written; pass --apply to do it) =="
fi
echo "pieces dir : $PIECES_DIR"
echo "source     : $src"
echo

# ── Preconditions. Any failure aborts before a single byte is written. ────────
[ -d "$PIECES_DIR" ] || { echo "FATAL: pieces dir not found: $PIECES_DIR" >&2; exit 1; }
[ -d "$src" ]        || { echo "FATAL: source folder not found: $src" >&2; exit 1; }
for pdf in "$BARBER_PDF" "$COPLAND_PDF"; do
  [ -f "$src/$pdf" ] || { echo "FATAL: missing source score: $src/$pdf" >&2; exit 1; }
done

changed=0
# Folders already announced this run, so a dry run (which creates nothing)
# does not report the same mkdir twice for a folder taking two files.
announced_dirs=""

# copy_in <destination folder> <filename> [optional]
#   Creates the destination folder, then copies the file into it preserving
#   mode/mtime. Never overwrites: an existing destination file is left alone.
copy_in() {
  dest_dir="$1"; file="$2"; optional="${3:-}"
  dest="$PIECES_DIR/$dest_dir"

  if [ ! -f "$src/$file" ]; then
    if [ -n "$optional" ]; then
      echo "  skip   $dest_dir/$file (not present in source)"
      return 0
    fi
    echo "FATAL: missing source file: $src/$file" >&2
    exit 1
  fi

  if [ ! -d "$dest" ]; then
    case "$announced_dirs" in
      *"|$dest_dir|"*) : ;;
      *)
        echo "  mkdir  $dest_dir/"
        announced_dirs="$announced_dirs|$dest_dir|"
        ;;
    esac
    changed=1
    [ "$APPLY" -eq 1 ] && mkdir -p "$dest"
  fi

  if [ -f "$dest/$file" ]; then
    if cmp -s "$src/$file" "$dest/$file"; then
      echo "  ok     $dest_dir/$file (already identical — nothing to do)"
    else
      echo "  KEEP   $dest_dir/$file (already exists and DIFFERS — refusing to overwrite)"
    fi
    return 0
  fi

  echo "  copy   $file -> $dest_dir/$file"
  changed=1
  [ "$APPLY" -eq 1 ] && cp -p "$src/$file" "$dest/$file"
  return 0
}

echo "[$BARBER_FOLDER]"
copy_in "$BARBER_FOLDER" "$BARBER_PDF"
echo
echo "[$COPLAND_FOLDER]"
copy_in "$COPLAND_FOLDER" "$COPLAND_PDF"
# The existing session log records only the two Copland blocks, so it belongs
# with the Copland. It is optional: a vault without one is not an error.
copy_in "$COPLAND_FOLDER" "$SESSIONS_MD" optional
echo

# ── Optional, opt-in: keep the emptied drawer out of the app ──────────────────
#
# After the split no piece row points at "Chamber Pieces Tanglewood" any more,
# so the next startup vault scan would re-ingest that still-present folder as a
# brand-new, historyless piece — a confusing third entry in the piece list.
#
# `vault::scan_folder` skips folders whose name starts with `_` (the same rule
# that hides `_piece-template`). Renaming the drawer to `_Chamber Pieces
# Tanglewood` therefore hides it from the app while keeping every byte on disk
# and in place. It is a rename, never a delete, and `--undo` prints the one
# `mv` that reverses it. Off by default.
if [ "$HIDE_ORIGINAL" -eq 1 ]; then
  original="$PIECES_DIR/$SOURCE_FOLDER"
  hidden="$PIECES_DIR/_$SOURCE_FOLDER"
  echo "[hide original]"
  if [ ! -d "$original" ] && [ -d "$hidden" ]; then
    echo "  ok     _$SOURCE_FOLDER already hidden — nothing to do"
  elif [ ! -d "$original" ]; then
    echo "  skip   $SOURCE_FOLDER not present"
  elif [ -d "$hidden" ]; then
    echo "  KEEP   both $SOURCE_FOLDER and _$SOURCE_FOLDER exist — refusing to merge them"
  else
    echo "  rename $SOURCE_FOLDER -> _$SOURCE_FOLDER (hidden from the vault scan, nothing deleted)"
    changed=1
    [ "$APPLY" -eq 1 ] && mv "$original" "$hidden"
    [ "$APPLY" -eq 1 ] && src="$hidden"
  fi
  echo
fi

if [ "$APPLY" -eq 1 ]; then
  echo "== result =="
  for folder in "$BARBER_FOLDER" "$COPLAND_FOLDER"; do
    echo "  $folder/"
    ls -la "$PIECES_DIR/$folder" | tail -n +2 | sed 's/^/    /'
  done
  echo
  echo "Original folder, contents intact:"
  echo "  $src"
  ls -la "$src" | tail -n +2 | sed 's/^/    /'
elif [ "$changed" -eq 1 ]; then
  echo "Dry run only. Re-run with --apply to perform the copies above."
else
  echo "Nothing to do — the vault is already in the target state."
fi
