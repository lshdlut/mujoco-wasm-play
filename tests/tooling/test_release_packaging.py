import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("build_site_zip", Path(__file__).resolve().parents[2] / "tools" / "build_site_zip.py")
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class PackagingCheckoutTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        (self.repo / ".gitattributes").write_text("* text=auto eol=lf\n", encoding="utf-8")
        self.selected = self.repo / "included.js"
        self.outside = self.repo / "outside.js"
        self.binary = self.repo / "image.bin"
        self.selected.write_bytes(b"const a = 1;\nconst b = 2;\n")
        self.outside.write_bytes(b"outside\n")
        self.binary.write_bytes(b"\x00binary\r\n")
        subprocess.run(["git", "-C", str(self.repo), "add", "."], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.root = patch.object(tool, "REPO_ROOT", self.repo)
        self.root.start()
        self.addCleanup(self.root.stop)

    def test_canonical_lf_and_binary_inputs_pass_without_rewriting(self):
        binary = self.binary.read_bytes()
        tool.validate_checkout_eol([self.selected, self.binary])
        self.assertEqual(self.binary.read_bytes(), binary)

    def test_clean_crlf_checkout_fails(self):
        self.selected.write_bytes(b"const a = 1;\r\nconst b = 2;\r\n")
        # Git normalizes it for status, so a clean status is insufficient proof.
        self.assertEqual(subprocess.run(["git", "-C", str(self.repo), "diff", "--name-only"], check=True, stdout=subprocess.PIPE).stdout, b"")
        with self.assertRaisesRegex(RuntimeError, "canonical LF checkout.*included.js"):
            tool.validate_checkout_eol([self.selected])
        self.assertIn(b"\r\n", self.selected.read_bytes())

    def test_mixed_checkout_fails(self):
        self.selected.write_bytes(b"const a = 1;\r\nconst b = 2;\n")
        with self.assertRaisesRegex(RuntimeError, "canonical LF checkout.*included.js"):
            tool.validate_checkout_eol([self.selected])

    def test_non_packaged_crlf_file_does_not_block(self):
        self.outside.write_bytes(b"outside\r\n")
        tool.validate_checkout_eol([self.selected])

    def test_preflight_failure_preserves_previous_archive(self):
        self.selected.write_bytes(b"const a = 1;\r\nconst b = 2;\r\n")
        target = self.repo / "site.zip"
        target.write_bytes(b"previous archive")
        with patch.object(tool, "ALLOWLIST", ["included.js"]), patch("sys.argv", ["build_site_zip.py", "--out", str(target)]):
            with self.assertRaisesRegex(RuntimeError, "canonical LF checkout"):
                tool.main()
        self.assertEqual(target.read_bytes(), b"previous archive")
        self.assertFalse(target.with_suffix(".zip.tmp").exists())


if __name__ == "__main__":
    unittest.main()
