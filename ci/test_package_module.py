import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from verify_module import REQUIRED, validate

class PackageValidationTest(unittest.TestCase):
    def fixture(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as apk:
            apk.writestr("classes.dex", b"test-DEX io/github/turboims/ksu/ModuleMain")
        runner = buffer.getvalue()
        digest = hashlib.sha256(runner).hexdigest()
        files = {name: b"" for name in REQUIRED}
        files.update({
            "module.prop": b"id=turboims_next\nname=TurboIMS Next\nversion=0.1.1-experimental\nversionCode=2\nauthor=Pew2018\ndescription=Experimental\n",
            "runner.apk": runner,
            "runner.sha256": (digest + "  runner.apk\n").encode(),
            "build-info.json": json.dumps({"version": "0.1.1-experimental",
                "helper_sha256": digest}).encode(),
        })
        for name in files:
            if name.endswith(".sh"):
                files[name] = b"#!/system/bin/sh\n"
        return files

    def archive(self, files):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            for name, content in files.items():
                archive.writestr(name, content)
        buffer.seek(0)
        return buffer

    def test_flat_artifact_is_flashable(self):
        self.assertEqual(validate(self.archive(self.fixture()))["version"], "0.1.1-experimental")

    def test_old_nested_artifact_is_rejected(self):
        inner = self.archive(self.fixture()).getvalue()
        with self.assertRaisesRegex(ValueError, "root"):
            validate(self.archive({"TurboIMS-Next.zip": inner, "TurboIMS-Next.zip.sha256": b"hash"}))

    def test_test_report_is_not_a_module(self):
        with self.assertRaisesRegex(ValueError, "root"):
            validate(self.archive({"test-results/results.xml": b"<testsuite/>"}))

    def test_extra_parent_directory_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "root"):
            validate(self.archive({"module/" + k: v for k, v in self.fixture().items()}))

    def test_tampered_runner_is_rejected(self):
        files = self.fixture()
        files["runner.apk"] += b"tampered"
        with self.assertRaisesRegex(ValueError, "checksum"):
            validate(self.archive(files))

    def test_crlf_metadata_is_rejected(self):
        files = self.fixture()
        files["module.prop"] = files["module.prop"].replace(b"\n", b"\r\n")
        with self.assertRaisesRegex(ValueError, "LF"):
            validate(self.archive(files))

    def test_path_traversal_is_rejected(self):
        files = self.fixture()
        files["../outside"] = b"bad"
        with self.assertRaisesRegex(ValueError, "Unsafe"):
            validate(self.archive(files))

    def test_nested_zip_in_flat_payload_is_rejected(self):
        files = self.fixture()
        files["extra.zip"] = b"bad"
        with self.assertRaisesRegex(ValueError, "Nested"):
            validate(self.archive(files))

if __name__ == "__main__":
    unittest.main()
