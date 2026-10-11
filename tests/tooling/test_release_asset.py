import contextlib
import hashlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError


def load_tool(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parents[2] / "tools" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tool = load_tool("check_release_asset")


class ReleaseAssetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "site.zip"
        self.content = b"the generated release archive"
        self.path.write_bytes(self.content)
        self.digest = hashlib.sha256(self.content).hexdigest()
        self.asset = {
            "name": "site.zip", "state": "uploaded", "digest": f"sha256:{self.digest}",
            "size": len(self.content), "browser_download_url": "https://github.com/example/play/releases/download/v1/site.zip",
        }

    def check(self):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            publish = tool.should_publish(self.path, "example/play", "v1", "test-token")
        return publish, output.getvalue()

    def response(self, assets):
        return io.BytesIO(json.dumps({"assets": assets}).encode())

    def test_missing_release_404_allows_publication(self):
        error = HTTPError("https://api.github.com", 404, "Not Found", {}, None)
        with patch.object(tool, "urlopen", side_effect=error):
            publish, message = self.check()
        self.assertTrue(publish)
        self.assertIn("HTTP 404", message)

    def test_existing_release_without_site_zip_allows_publication(self):
        with patch.object(tool, "urlopen", return_value=self.response([])):
            self.assertTrue(self.check()[0])

    def test_matching_digest_preserves_asset_without_downloading(self):
        with patch.object(tool, "urlopen", return_value=self.response([self.asset])) as request:
            publish, message = self.check()
        self.assertFalse(publish)
        self.assertIn("Preserving existing", message)
        self.assertEqual(request.call_count, 1)

    def test_mismatching_digest_fails(self):
        self.asset["digest"] = "sha256:" + "0" * 64
        with patch.object(tool, "urlopen", return_value=self.response([self.asset])):
            with self.assertRaisesRegex(RuntimeError, "Refusing to replace.*existing SHA-256.*generated SHA-256"):
                self.check()

    def test_permissions_server_and_network_errors_fail(self):
        errors = [HTTPError("https://api.github.com", code, "failure", {}, None) for code in (401, 403, 429, 500)]
        errors.append(URLError("network unavailable"))
        for error in errors:
            with self.subTest(error=error), patch.object(tool, "urlopen", side_effect=error):
                with self.assertRaises(type(error)):
                    self.check()

    def test_missing_digest_hashes_download_without_forwarding_token(self):
        self.asset["digest"] = None
        with patch.object(tool, "urlopen", side_effect=[self.response([self.asset]), io.BytesIO(self.content)]) as request:
            self.assertFalse(self.check()[0])
        api_request = request.call_args_list[0].args[0]
        self.assertEqual(api_request.get_header("Authorization"), "Bearer test-token")
        self.assertEqual(request.call_args_list[1].args[0], self.asset["browser_download_url"])

    def test_missing_digest_mismatching_download_fails(self):
        self.asset.pop("digest")
        changed = b"different release archive"
        self.asset["size"] = len(changed)
        with patch.object(tool, "urlopen", side_effect=[self.response([self.asset]), io.BytesIO(changed)]):
            with self.assertRaisesRegex(RuntimeError, "Refusing to replace"):
                self.check()

    def test_missing_digest_truncated_download_fails(self):
        self.asset["digest"] = None
        self.asset["size"] += 1
        with patch.object(tool, "urlopen", side_effect=[self.response([self.asset]), io.BytesIO(self.content)]):
            with self.assertRaisesRegex(RuntimeError, "Incomplete download"):
                self.check()

    def test_missing_digest_download_errors_including_404_fail(self):
        self.asset["digest"] = None
        errors = [HTTPError(self.asset["browser_download_url"], code, "failure", {}, None) for code in (404, 403, 500)]
        errors.append(URLError("download unavailable"))
        for error in errors:
            with self.subTest(error=error), patch.object(tool, "urlopen", side_effect=[self.response([self.asset]), error]):
                with self.assertRaises(type(error)):
                    self.check()

    def test_incomplete_uploaded_asset_fails(self):
        self.asset["state"] = "starter"
        with patch.object(tool, "urlopen", return_value=self.response([self.asset])):
            with self.assertRaisesRegex(RuntimeError, "fully uploaded"):
                self.check()

    def test_ambiguous_same_name_assets_fail(self):
        with patch.object(tool, "urlopen", return_value=self.response([self.asset, self.asset])):
            with self.assertRaisesRegex(RuntimeError, "one fully uploaded"):
                self.check()

    def test_main_writes_publish_false_for_matching_asset(self):
        output = Path(self.temp.name) / "github-output"
        env = {"GITHUB_REPOSITORY": "example/play", "GITHUB_REF_NAME": "v1", "GH_TOKEN": "test-token", "GITHUB_OUTPUT": str(output)}
        with patch.dict(os.environ, env), patch("sys.argv", ["check_release_asset.py", "--zip", str(self.path)]), \
                patch.object(tool, "urlopen", return_value=self.response([self.asset])), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(tool.main(), 0)
        self.assertEqual(output.read_text(), "publish=false\n")

    def test_main_failure_does_not_emit_a_publish_decision(self):
        output = Path(self.temp.name) / "github-output"
        self.asset["digest"] = "sha256:" + "0" * 64
        env = {"GITHUB_REPOSITORY": "example/play", "GITHUB_REF_NAME": "v1", "GH_TOKEN": "test-token", "GITHUB_OUTPUT": str(output)}
        with patch.dict(os.environ, env), patch("sys.argv", ["check_release_asset.py", "--zip", str(self.path)]), \
                patch.object(tool, "urlopen", return_value=self.response([self.asset])):
            with self.assertRaisesRegex(RuntimeError, "Refusing to replace"):
                tool.main()
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
