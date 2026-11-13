"""Mac transfer safety checks using disposable SQLite/PDF fixtures only."""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("desktop_export", Path(__file__).with_name("export_desktop.py"))
exporter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(exporter)


def make_pdf():
    """One genuine blank PDF page, parseable by PDFKit/pypdf."""
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>",
               b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>"]
    document = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, value in enumerate(objects, 1):
        offsets.append(len(document))
        document.extend(str(index).encode() + b" 0 obj\n" + value + b"\nendobj\n")
    xref_offset = len(document)
    document.extend(b"xref\n0 4\n0000000000 65535 f \n")
    for offset in offsets[1:]:
        document.extend(("%010d 00000 n \n" % offset).encode())
    document.extend(("trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % xref_offset).encode())
    return bytes(document)


def page_counter(paths):
    for path in paths:
        if path.read_bytes() != make_pdf():
            raise AssertionError("PDF parsing must receive exact exported bytes")
    return {str(path): 1 for path in paths}


class DesktopExportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.piece = self.root / "piece"
        self.score_dir = self.piece / "score"
        self.score_dir.mkdir(parents=True)
        self.pdf = self.score_dir / "urtext.pdf"
        self.pdf.write_bytes(make_pdf())
        self.database = self.root / "codakiller.db"
        self.output = self.root / "practice.json"
        self.connection = sqlite3.connect(self.database)
        self.connection.executescript('''
            PRAGMA foreign_keys=ON;
            CREATE TABLE piece (id INTEGER PRIMARY KEY, title TEXT, folder_path TEXT,
                                pdf_path TEXT, preferred_pdf_path TEXT, xml_path TEXT);
            CREATE TABLE session (id INTEGER PRIMARY KEY, ended_at TEXT);
            CREATE TABLE rep_block (id INTEGER PRIMARY KEY, piece_id INTEGER REFERENCES piece(id), status TEXT);
            CREATE TABLE rep (id INTEGER PRIMARY KEY, block_id INTEGER REFERENCES rep_block(id), verdict TEXT);
            CREATE TABLE future_table (id INTEGER PRIMARY KEY, text_value TEXT, blob_value BLOB, real_value REAL);
            CREATE TABLE "strange""table" ("strange""column" TEXT);
            INSERT INTO "strange""table" VALUES ('preserved');
            INSERT INTO session VALUES (1,'2026-10-01T12:00:00Z');
        ''')
        self.connection.execute("INSERT INTO piece VALUES (1,?,?,?,?,?)",
                                ("A pianist's score ♯", str(self.piece), str(self.pdf), None, None))
        self.connection.execute("INSERT INTO rep_block VALUES (1,1,'done')")
        self.connection.execute("INSERT INTO rep VALUES (1,1,'clean')")
        self.connection.execute("INSERT INTO future_table VALUES (1,?,?,?)", ("durable data", b"\x00\xff", 0.5))
        self.connection.commit()

    def tearDown(self):
        self.connection.close()
        self.temporary.cleanup()

    def export(self, counter=page_counter):
        return exporter.export_desktop(self.database, self.output, counter)

    def archive(self):
        return json.loads(self.output.read_bytes())

    def test_full_tables_snapshot_blob_and_pdf_preserved_without_mutation(self):
        before = self.database.read_bytes()
        summary = self.export()
        archive = self.archive()
        self.assertEqual(archive["format"], "praelude-desktop-transfer")
        self.assertEqual(archive["version"], 1)
        self.assertEqual(set(archive["tables"]), {"piece", "session", "rep_block", "rep", "future_table", 'strange"table'})
        self.assertEqual(archive["tables"]["future_table"][0]["blob_value"], {"$sqliteBlob": "AP8="})
        self.assertEqual(summary["rowCounts"]["future_table"], 1)
        self.assertEqual(archive["tables"]['strange"table'][0]['strange"column'], "preserved")
        snapshot = base64.b64decode(archive["database"])
        self.assertEqual(hashlib.sha256(snapshot).hexdigest(), archive["databaseSHA256"])
        copied_database = self.root / "snapshot.db"
        copied_database.write_bytes(snapshot)
        with sqlite3.connect(copied_database) as check:
            self.assertEqual(check.execute("PRAGMA integrity_check").fetchone(), ("ok",))
            self.assertEqual(check.execute("SELECT blob_value FROM future_table").fetchone()[0], b"\x00\xff")
        self.assertEqual(before, self.database.read_bytes())
        score = archive["scoreFiles"][0]
        self.assertEqual(base64.b64decode(archive["scores"][score["filename"]]), make_pdf())
        self.assertEqual(score["pageCount"], 1)
        self.assertEqual(score["editionID"], "score/urtext.pdf")
        self.assertEqual(score["edition"], str(self.pdf))
        self.assertTrue(score["preferred"])
        self.assertEqual(score["fingerprint"], "%x-%x" % (self.pdf.stat().st_size, int(self.pdf.stat().st_mtime)))
        self.assertEqual(os.stat(self.output).st_mode & 0o777, 0o600)

    def test_committed_wal_is_in_snapshot_and_pending_write_is_excluded(self):
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("INSERT INTO future_table VALUES (2,'committed',NULL,NULL)")
        self.connection.commit()
        self.connection.execute("INSERT INTO future_table VALUES (3,'uncommitted',NULL,NULL)")
        self.export()
        rows = self.archive()["tables"]["future_table"]
        self.assertEqual({row["id"] for row in rows}, {1, 2})
        self.connection.rollback()

    def test_json_rows_and_sqlite_share_one_snapshot_with_concurrent_later_write(self):
        def later_write(paths):
            self.connection.execute("INSERT INTO future_table VALUES (2,'later',NULL,NULL)")
            self.connection.commit()
            return page_counter(paths)
        self.export(later_write)
        archive = self.archive()
        self.assertEqual(len(archive["tables"]["future_table"]), 1)
        snapshot = self.root / "snapshot.db"
        snapshot.write_bytes(base64.b64decode(archive["database"]))
        with sqlite3.connect(snapshot) as check:
            self.assertEqual(check.execute("SELECT count(*) FROM future_table").fetchone()[0], 1)

    def test_missing_referenced_score_refuses_complete_export(self):
        self.pdf.unlink()
        with self.assertRaisesRegex(exporter.ExportError, "referenced score"):
            self.export()
        self.assertFalse(self.output.exists())

    def test_virtual_system_warmups_preserves_data_without_treating_uri_as_path(self):
        self.connection.execute("ALTER TABLE piece ADD COLUMN kind TEXT")
        self.connection.execute("INSERT INTO piece (id,title,folder_path,kind) VALUES (0,'Warm-ups','codakiller://warmups','system')")
        self.connection.execute("INSERT INTO rep_block VALUES (2,0,'done')")
        self.connection.execute("INSERT INTO rep VALUES (2,2,'clean')")
        self.connection.commit()
        self.export()
        archive = self.archive()
        self.assertEqual({piece["id"] for piece in archive["tables"]["piece"]}, {0, 1})
        self.assertEqual(len(archive["tables"]["rep"]), 2)
        self.assertEqual(len(archive["scoreFiles"]), 1)
        self.assertTrue(any("System Warm-ups" in warning for warning in archive["warnings"]))

    def test_virtual_system_piece_with_pdf_reference_refuses_export(self):
        self.connection.execute("ALTER TABLE piece ADD COLUMN kind TEXT")
        self.connection.execute("INSERT INTO piece (id,title,folder_path,kind,pdf_path) VALUES (0,'Warm-ups','codakiller://warmups','system',?)", (str(self.pdf),))
        self.connection.commit()
        with self.assertRaisesRegex(exporter.ExportError, "unexpectedly references"):
            self.export()

    def test_unknown_relative_piece_path_is_not_silently_skipped(self):
        self.connection.execute("UPDATE piece SET folder_path='codakiller://unknown'")
        self.connection.commit()
        with self.assertRaisesRegex(exporter.ExportError, "not absolute"):
            self.export()

    def test_missing_preferred_score_available_alternate_is_reported(self):
        self.connection.execute("UPDATE piece SET preferred_pdf_path=?", (str(self.score_dir / "missing.pdf"),))
        self.connection.commit()
        self.export()
        archive = self.archive()
        self.assertTrue(any("missing/unsafe preferred_pdf_path" in warning for warning in archive["warnings"]))
        self.assertTrue(any("selected score is unavailable" in warning for warning in archive["warnings"]))
        self.assertEqual(archive["tables"]["piece"][0]["preferred_pdf_path"], str(self.score_dir / "missing.pdf"))
        self.assertTrue(archive["scoreFiles"][0]["preferred"])

    def test_allow_missing_scores_requires_explicit_option_and_preserves_reference(self):
        self.pdf.unlink()
        exporter.export_desktop(self.database, self.output, page_counter, allow_missing_scores=True)
        archive = self.archive()
        self.assertEqual(archive["scoreFiles"], [])
        self.assertEqual(archive["tables"]["piece"][0]["pdf_path"], str(self.pdf))
        self.assertTrue(any("no score bytes available" in warning for warning in archive["warnings"]))

    def test_active_session_refuses_export(self):
        self.connection.execute("UPDATE session SET ended_at=NULL")
        self.connection.commit()
        with self.assertRaisesRegex(exporter.ExportError, "active Mac practice session"):
            self.export()

    def test_active_set_refuses_export(self):
        self.connection.execute("UPDATE rep_block SET status='open'")
        self.connection.commit()
        with self.assertRaisesRegex(exporter.ExportError, "active Mac practice set"):
            self.export()

    def test_existing_output_is_never_overwritten(self):
        self.output.write_bytes(b"existing private transfer")
        with self.assertRaisesRegex(exporter.ExportError, "already exists"):
            self.export()
        self.assertEqual(self.output.read_bytes(), b"existing private transfer")

    def test_publish_race_is_never_overwritten_and_temp_is_removed(self):
        original_link = os.link
        def race(source, target):
            Path(target).write_bytes(b"another exporter")
            return original_link(source, target)
        with patch.object(exporter.os, "link", race):
            with self.assertRaisesRegex(exporter.ExportError, "concurrently"):
                self.export()
        self.assertEqual(self.output.read_bytes(), b"another exporter")
        self.assertEqual(list(self.root.glob(".praelude-transfer-*")), [])

    def test_git_output_is_refused_even_through_symlink(self):
        checkout = self.root / "checkout"
        checkout.mkdir()
        (checkout / ".git").write_text("gitdir: elsewhere")
        shortcut = self.root / "shortcut"
        shortcut.symlink_to(checkout, target_is_directory=True)
        self.output = shortcut / "private.json"
        with self.assertRaisesRegex(exporter.ExportError, "outside every Git"):
            self.export()

    def test_all_editions_are_preserved_and_identical_content_is_deduplicated(self):
        alternate = self.piece / "other.PDF"
        alternate.write_bytes(make_pdf())
        self.connection.execute("UPDATE piece SET preferred_pdf_path=?", (str(alternate),))
        self.connection.commit()
        summary = self.export()
        scores = self.archive()["scoreFiles"]
        self.assertEqual(summary["scoreEditions"], 2)
        self.assertEqual(summary["uniquePDFs"], 1)
        self.assertEqual(len([score for score in scores if score["preferred"]]), 1)
        self.assertTrue(next(score for score in scores if score["edition"] == str(alternate))["preferred"])

    def test_discovered_score_is_selected_when_database_has_no_pdf_path(self):
        self.connection.execute("UPDATE piece SET pdf_path=NULL")
        self.connection.commit()
        self.export()
        self.assertTrue(self.archive()["scoreFiles"][0]["preferred"])

    def test_nested_score_editions_are_included_without_following_symlink_directories(self):
        nested = self.score_dir / "Cortot" / "Scans"
        nested.mkdir(parents=True)
        (nested / "edition.pdf").write_bytes(make_pdf())
        outside = self.root / "outside-scores"
        outside.mkdir()
        (outside / "private.pdf").write_bytes(make_pdf())
        (self.score_dir / "shortcut").symlink_to(outside, target_is_directory=True)
        self.export()
        archive = self.archive()
        self.assertEqual({file["editionID"] for file in archive["scoreFiles"]}, {"score/urtext.pdf", "score/Cortot/Scans/edition.pdf"})
        self.assertTrue(any("directory symlink" in warning and "shortcut" in warning for warning in archive["warnings"]))
        self.assertFalse(any("Omitted" in warning and "Cortot" in warning for warning in archive["warnings"]))

    def test_related_assets_preserved_and_omissions_reported(self):
        (self.piece / "notes.md").write_text("Teacher: keep pulse.")
        (self.piece / "performance.mov").write_bytes(b"not included")
        (self.piece / "xml.xml").write_text("<score-partwise/>")
        self.connection.execute("UPDATE piece SET xml_path=?", (str(self.piece / "xml.xml"),))
        self.connection.commit()
        self.export()
        archive = self.archive()
        self.assertEqual(len(archive["assets"]), 2)
        self.assertEqual(len(archive["assetFiles"]), 2)
        self.assertTrue(any("performance.mov" in warning for warning in archive["warnings"]))
        self.assertFalse(any("directory or symlink" in warning and warning.endswith("/score") for warning in archive["warnings"]))

    def test_score_symlink_refuses_export(self):
        original = self.root / "outside.pdf"
        self.pdf.rename(original)
        self.pdf.symlink_to(original)
        with self.assertRaises(exporter.ExportError):
            self.export()

    def test_invalid_foreign_keys_refuse_export(self):
        self.connection.execute("PRAGMA foreign_keys=OFF")
        self.connection.execute("INSERT INTO rep VALUES (2,999,'clean')")
        self.connection.commit()
        with self.assertRaisesRegex(exporter.ExportError, "foreign-key violations"):
            self.export()

    def test_size_limit_refuses_atomic_output(self):
        with patch.object(exporter, "MAX_ARCHIVE_BYTES", 512):
            with self.assertRaisesRegex(exporter.ExportError, "size limit|280 MB"):
                self.export()
        self.assertFalse(self.output.exists())

    def test_original_pdf_can_change_after_copy_without_mismatching_archive(self):
        def mutate_original(paths):
            self.pdf.write_bytes(b"source changed after snapshot")
            return page_counter(paths)
        self.export(mutate_original)
        archive = self.archive()
        self.assertEqual(base64.b64decode(next(iter(archive["scores"].values()))), make_pdf())
        self.assertEqual(archive["scoreFiles"][0]["pageCount"], 1)


if __name__ == "__main__":
    unittest.main()
