#!/usr/bin/env python3
"""Export a private, read-only Mac practice snapshot for native iOS import.

Usage: python3 ios/scripts/export_desktop.py --database /absolute/codakiller.db
       --output /private/path/Mac-practice.praelude-desktop.json
Nothing is uploaded. Output must be outside a Git checkout and is never overwritten.
The SQLite snapshot preserves every table/schema/type. JSON rows use
{"$sqliteBlob": "base64..."} for SQLite BLOBs; original paths remain in the snapshot.
"""
import argparse
import base64
import datetime as dt
import hashlib
import io
import json
import math
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import subprocess
import tempfile

MAX_ARCHIVE_BYTES = 280_000_000
MAX_SCORE_BYTES = 100_000_000
MAX_ASSET_BYTES = 10 * 1024 * 1024
MAX_ASSETS_TOTAL = 40 * 1024 * 1024
ASSET_EXTENSIONS = {".xml", ".musicxml", ".mxl", ".mscz", ".png", ".jpg", ".jpeg",
                    ".webp", ".svg", ".json", ".md", ".txt"}


class ExportError(Exception):
    """An unsafe/incomplete transfer must not be published."""


def b64(data):
    return base64.b64encode(data).decode("ascii")


def quoted(identifier):
    return '"' + identifier.replace('"', '""') + '"'


def value_for_json(value):
    if isinstance(value, bytes):
        return {"$sqliteBlob": b64(value)}
    if isinstance(value, float) and not math.isfinite(value):
        return {"$sqliteFloat": repr(value)}
    return value


def snapshot_database(database, snapshot):
    """SQLite backup includes committed WAL rows; never opens a writable source."""
    if not database.is_file():
        raise ExportError("Desktop database does not exist.")
    source = sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True, timeout=10)
    target = sqlite3.connect(snapshot)
    try:
        source.execute("PRAGMA query_only=ON")
        source.backup(target)
        if target.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ExportError("Desktop database integrity check failed.")
        if target.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise ExportError("Desktop database has foreign-key violations.")
        tables = {}
        names = [row[0] for row in target.execute(
            "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")]
        for name in names:
            cursor = target.execute("SELECT * FROM " + quoted(name))
            columns = [column[0] for column in cursor.description]
            tables[name] = [{key: value_for_json(value) for key, value in zip(columns, row)}
                            for row in cursor]
        if "piece" not in tables:
            raise ExportError("Database has no Praelude piece table.")
        if any(row.get("ended_at") is None for row in tables.get("session", [])):
            raise ExportError("Finish the active Mac practice session before exporting.")
        if any(row.get("status") == "open" for row in tables.get("rep_block", [])):
            raise ExportError("Finish or abandon the active Mac practice set before exporting.")
        return tables
    finally:
        target.close()
        source.close()


def pdf_page_counts(paths):
    """Use a real PDF parser; PDFKit is available on the source Mac."""
    try:
        from pypdf import PdfReader
    except ImportError:
        PdfReader = None
    if PdfReader:
        counts = {}
        for path in paths:
            try:
                count = len(PdfReader(io.BytesIO(path.read_bytes()), strict=False).pages)
            except Exception as error:
                raise ExportError("A score PDF could not be parsed.") from error
            if count < 1:
                raise ExportError("A score PDF has no readable pages.")
            counts[str(path)] = count
        return counts
    if not shutil.which("xcrun"):
        raise ExportError("PDF page counting requires Apple's PDFKit or Python pypdf.")
    swift = '''import Foundation
import PDFKit
let data = FileHandle.standardInput.readDataToEndOfFile()
let paths = try JSONDecoder().decode([String].self, from: data)
var counts: [String: Int] = [:]
for path in paths {
    guard let pdf = PDFDocument(url: URL(fileURLWithPath: path)), !pdf.isLocked, pdf.pageCount > 0 else {
        exit(2)
    }
    counts[path] = pdf.pageCount
}
FileHandle.standardOutput.write(try JSONEncoder().encode(counts))
'''
    with tempfile.TemporaryDirectory(prefix="praelude-pdf-count-") as temporary:
        script = Path(temporary) / "count.swift"
        script.write_text(swift)
        try:
            result = subprocess.run(["xcrun", "swift", str(script)],
                                    input=json.dumps([str(path) for path in paths]).encode(),
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90, check=True)
            counts = json.loads(result.stdout)
            if any(not isinstance(counts.get(str(path)), int) or counts[str(path)] < 1 for path in paths):
                raise ExportError("PDFKit returned an invalid page count.")
            return counts
        except (subprocess.SubprocessError, ValueError, OSError) as error:
            raise ExportError("PDFKit could not count every score. No export was written.") from error


def stable_bytes(path, limit, with_metadata=False):
    """Do not silently combine a database with a PDF being edited mid-export."""
    if path.is_symlink() or not path.is_file():
        raise ExportError("A referenced score is missing or is a symbolic link: " + str(path))
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as file:
        before = os.fstat(file.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise ExportError("A source file exceeds the transfer size limit or is unsafe: " + str(path))
        data = file.read(limit + 1)
        after = os.fstat(file.fileno())
    if len(data) > limit:
        raise ExportError("A source file exceeds the transfer size limit: " + str(path))
    if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
        raise ExportError("A source file changed during export. Retry while practice is idle.")
    return (data, before) if with_metadata else data


def absolute_path(value, folder=None):
    path = Path(value).expanduser()
    if not path.is_absolute():
        if folder is None:
            raise ExportError("A desktop piece folder path is not absolute.")
        path = folder / path
    return path.absolute()


def collect_files(tables, allow_missing_scores=False):
    editions = []
    asset_paths = set()
    warnings = []
    for piece in tables["piece"]:
        piece_id = piece.get("id")
        # Schema20's reserved Warm-ups piece is a virtual ledger owner, never a folder.
        if piece_id == 0 and piece.get("kind") == "system" and piece.get("folder_path") == "codakiller://warmups":
            if any(piece.get(key) for key in ("pdf_path", "preferred_pdf_path", "xml_path")):
                raise ExportError("The virtual Warm-ups piece unexpectedly references score files.")
            warnings.append("System Warm-ups has no score PDF; its full practice records remain in the desktop snapshot.")
            continue
        folder = absolute_path(piece["folder_path"]) if piece.get("folder_path") else None
        candidates = set()
        missing_references = []
        selected = piece.get("preferred_pdf_path") or piece.get("pdf_path")
        selected = absolute_path(selected, folder) if selected else None
        for key in ("pdf_path", "preferred_pdf_path"):
            if piece.get(key):
                path = absolute_path(piece[key], folder)
                if path.suffix.lower() != ".pdf" or path.is_symlink() or not path.is_file():
                    missing_references.append((key, path))
                else:
                    candidates.add(path)
        if folder:
            directories = [folder]
            score_directory = folder / "score"
            if score_directory.is_dir() and not score_directory.is_symlink():
                for root, child_directories, _ in os.walk(score_directory, followlinks=False):
                    root = Path(root)
                    for name in child_directories[:]:
                        if (root / name).is_symlink():
                            warnings.append("Omitted related directory symlink: " + str(root / name))
                            child_directories.remove(name)
                    child_directories.sort()
                    directories.append(root)
            else:
                warnings.append("Piece %s: missing or unsafe score directory %s" % (piece_id, score_directory))
            processed_directories = set(directories)
            for directory in directories:
                if not directory.is_dir():
                    warnings.append("Piece %s: missing directory %s" % (piece_id, directory))
                    continue
                for path in sorted(directory.iterdir()):
                    if path.suffix.lower() == ".pdf" and not path.name.startswith("."):
                        if path.is_symlink() or not path.is_file():
                            raise ExportError("Unsafe discovered score PDF for piece " + str(piece_id))
                        candidates.add(path.absolute())
                    elif path.is_file() and not path.is_symlink():
                        asset_paths.add(path.absolute())
                    elif path in processed_directories and path.is_dir() and not path.is_symlink():
                        continue
                    else:
                        warnings.append("Omitted related directory or symlink: " + str(path))
        for key, value in piece.items():
            if key.endswith("_path") and key not in {"folder_path", "pdf_path", "preferred_pdf_path"} and value:
                asset_paths.add(absolute_path(value, folder))
        ordered_candidates = sorted(candidates)
        if missing_references:
            if not candidates and not allow_missing_scores:
                raise ExportError("Missing or unsafe referenced score PDF for piece " + str(piece_id))
            for key, path in missing_references:
                warnings.append("Piece %s (%s): missing/unsafe %s %s; original reference retained in the database%s" % (
                    piece_id, piece.get("title", ""), key, path,
                    "; available folder editions included" if candidates else "; no score bytes available"))
        if selected not in candidates and ordered_candidates:
            if selected:
                warnings.append("Piece %s: selected score is unavailable; first available folder edition selected for mobile." % piece_id)
            selected = ordered_candidates[0]
        for path in ordered_candidates:
            relative = str(path.relative_to(folder)) if folder and path.is_relative_to(folder) else str(path)
            editions.append({"pieceID": piece_id, "edition": str(path), "editionID": relative,
                             "preferred": path == selected, "path": path})
        if not candidates:
            warnings.append("Piece %s has no score PDF in desktop data." % piece_id)
    # Cover art and recordings may live in app-owned paths outside piece folders.
    for rows in tables.values():
        for row in rows:
            for key, value in row.items():
                if key.endswith("_path") and isinstance(value, str) and value.startswith("/"):
                    path = Path(value)
                    if key not in {"folder_path", "pdf_path", "preferred_pdf_path"}:
                        asset_paths.add(path)
    return editions, asset_paths, warnings


def validate_output(output):
    output = output.expanduser().absolute()
    if output.exists() or output.is_symlink():
        raise ExportError("Output already exists; choose a new private filename.")
    if not output.parent.is_dir():
        raise ExportError("The output directory must already exist.")
    canonical = output.parent.resolve() / output.name
    if any((directory / ".git").exists() for directory in canonical.parents):
        raise ExportError("Personal transfer output must be outside every Git checkout.")
    return canonical


def export_desktop(database, output, page_counter=pdf_page_counts, allow_missing_scores=False):
    output = validate_output(Path(output))
    with tempfile.TemporaryDirectory(prefix="praelude-desktop-snapshot-") as temporary:
        snapshot = Path(temporary) / "desktop.sqlite"
        tables = snapshot_database(Path(database), snapshot)
        editions, asset_paths, warnings = collect_files(tables, allow_missing_scores=allow_missing_scores)
        paths = sorted({edition["path"] for edition in editions})
        scores = {}
        score_files = []
        budget = MAX_ARCHIVE_BYTES
        filenames = {}
        fingerprints = {}
        pdf_directory = Path(temporary) / "Scores"
        pdf_directory.mkdir()
        for path in paths:
            data, metadata = stable_bytes(path, MAX_SCORE_BYTES, with_metadata=True)
            filename = hashlib.sha256(data).hexdigest() + ".pdf"
            if filename not in scores:
                scores[filename] = b64(data)
                (pdf_directory / filename).write_bytes(data)
                budget -= len(scores[filename])
                if budget < 0:
                    raise ExportError("Scores exceed the transfer size limit.")
            filenames[path] = filename
            fingerprints[path] = "%x-%x" % (metadata.st_size, int(metadata.st_mtime))
        # Count exactly the copied bytes, so concurrent source PDF edits cannot mismatch page counts.
        copied_pdfs = sorted(pdf_directory.iterdir())
        counts = page_counter(copied_pdfs) if copied_pdfs else {}
        for edition in editions:
            path = edition.pop("path")
            filename = filenames[path]
            if not 1 <= counts[str(pdf_directory / filename)] <= 2000:
                raise ExportError("A score exceeds the supported 2,000-page mobile transfer limit.")
            score_files.append({**edition, "filename": filename,
                                "fingerprint": fingerprints[path],
                                "pageCount": counts[str(pdf_directory / filename)]})
        assets = {}
        asset_files = []
        assets_total = 0
        for path in sorted(asset_paths):
            if path.suffix.lower() not in ASSET_EXTENSIONS:
                warnings.append("Omitted unsupported related file: " + str(path))
                continue
            if path.is_symlink() or not path.is_file():
                warnings.append("Omitted missing or unsafe related file: " + str(path))
                continue
            if path.stat().st_size > MAX_ASSET_BYTES or assets_total + path.stat().st_size > MAX_ASSETS_TOTAL:
                warnings.append("Omitted related file exceeding asset budget: " + str(path))
                continue
            data = stable_bytes(path, MAX_ASSET_BYTES)
            filename = hashlib.sha256(data).hexdigest() + path.suffix.lower()
            if filename not in assets:
                assets[filename] = b64(data)
                assets_total += len(data)
            asset_files.append({"originalPath": str(path), "filename": filename})
        database_bytes = snapshot.read_bytes()
        archive = {"format": "praelude-desktop-transfer", "version": 1,
                   "exportedAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
                   "databaseSHA256": hashlib.sha256(database_bytes).hexdigest(),
                   "database": b64(database_bytes), "tables": tables,
                   "scores": scores, "scoreFiles": score_files, "assets": assets,
                   "assetFiles": asset_files, "warnings": sorted(set(warnings))}
        payload = json.dumps(archive, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
        if len(payload) > MAX_ARCHIVE_BYTES:
            raise ExportError("The complete JSON archive exceeds 280 MB. No export was written.")
        # Hard-link publication is atomic and refuses a destination created by a concurrent exporter.
        temporary_output = None
        try:
            with tempfile.NamedTemporaryFile(prefix=".praelude-transfer-", dir=output.parent, delete=False) as file:
                temporary_output = Path(file.name)
                os.chmod(file.name, 0o600)
                file.write(payload)
                file.flush()
                os.fsync(file.fileno())
            os.link(temporary_output, output)
        except FileExistsError as error:
            raise ExportError("Output was created concurrently; it has not been overwritten.") from error
        finally:
            if temporary_output:
                temporary_output.unlink(missing_ok=True)
        return {"output": str(output), "bytes": len(payload), "tables": len(tables),
                "rowCounts": {name: len(rows) for name, rows in tables.items()},
                "pieces": len(tables["piece"]), "scoreEditions": len(score_files),
                "uniquePDFs": len(scores), "warnings": archive["warnings"],
                "sha256": hashlib.sha256(payload).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--database", type=Path, required=True, help="Mac codakiller.db; opened read-only")
    parser.add_argument("--output", type=Path, required=True, help="New private file outside Git; never overwritten")
    parser.add_argument("--allow-missing-scores", action="store_true",
                        help="Explicitly retain pieces with missing score files, preserving references and reporting omissions")
    args = parser.parse_args()
    try:
        print(json.dumps(export_desktop(args.database, args.output, allow_missing_scores=args.allow_missing_scores), indent=2))
    except (ExportError, sqlite3.Error, OSError) as error:
        parser.exit(1, "Export refused: " + str(error) + "\n")


if __name__ == "__main__":
    main()
