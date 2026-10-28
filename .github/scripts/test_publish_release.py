import copy
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from publish_release import (GitHub, MAX_ASSET, PublishError, REPOSITORY,
                             expected_names, publish, run_bounded)

TAG = "0.0.3"
SHA = "a" * 40


class FakeGitHub:
    def __init__(self, assets, notes):
        self.assets = assets
        self.calls = []
        self.verifications = []
        self.inventory = []
        self.tamper = False
        self.verify_error = False
        self.mutate = lambda release: None
        self.release = {"id": 12345, "tag_name": TAG, "target_commitish": SHA,
                        "name": f"Iceon {TAG}", "body": notes, "draft": True,
                        "prerelease": False, "assets": [],
                        "html_url": f"https://github.com/{REPOSITORY}/releases/tag/{TAG}"}

    def api(self, method, endpoint, payload=None):
        self.calls.append((method, endpoint, payload))
        if "/releases/tags/" in endpoint:
            raise AssertionError("GET by tag returns 404 for drafts and must never be used")
        if endpoint == f"repos/{REPOSITORY}":
            return {"private": False, "full_name": REPOSITORY}
        if "/releases?" in endpoint:
            return self.inventory
        if method == "POST":
            self.release.update(payload)
        elif method == "PATCH":
            self.release.update({k: v for k, v in payload.items() if k != "make_latest"})
        result = copy.deepcopy(self.release)
        if method == "GET" and endpoint.endswith("/12345"):
            self.mutate(result)
        return result

    def upload(self, repo, release_id, path):
        assert repo == REPOSITORY and release_id == 12345
        self.calls.append(("upload", release_id, path.name))
        data = path.read_bytes()
        self.release["assets"].append({"id": 100 + len(self.release["assets"]),
                                       "name": path.name, "state": "uploaded", "size": len(data),
                                       "digest": "sha256:" + hashlib.sha256(data).hexdigest()})

    def download(self, repo, asset_id, path):
        self.calls.append(("download", asset_id, path.name))
        assert repo == REPOSITORY
        asset = next(a for a in self.release["assets"] if a["id"] == asset_id)
        assert asset["name"] == path.name
        path.write_bytes(b"tampered" if self.tamper else (self.assets / path.name).read_bytes())

    def verify(self, config, signature, payload, tag):
        self.verifications.append((config, signature, payload, tag))
        if self.verify_error:
            raise PublishError("Bad signed-version signature")


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.assets = self.root / "assets"
        self.assets.mkdir()
        self.names = expected_names(TAG)
        for name in self.names[:-1]:
            (self.assets / name).write_bytes(("fixture " + name).encode())
        self.write_checksums()
        self.notes = self.root / "notes.md"
        self.notes.write_text("Tagged release notes\n")
        self.config = self.root / "config.json"
        self.config.write_text(json.dumps({"version": TAG, "plugins": {"updater": {
            "pubkey": "fixture public key", "requireSignedVersion": True}}}))
        self.ops = FakeGitHub(self.assets, self.notes.read_text())

    def write_checksums(self):
        (self.assets / "SHASUMS256.txt").write_text("".join(
            hashlib.sha256((self.assets / name).read_bytes()).hexdigest() + "  " + name + "\n"
            for name in self.names[:-1]))

    def publish(self):
        return publish(self.ops, REPOSITORY, TAG, SHA, self.assets, self.root / "downloads",
                       self.notes, self.config)

    def assert_not_published(self):
        self.assertFalse(any(call[0] == "PATCH" for call in self.ops.calls))

    def test_fresh_id_flow_never_looks_up_a_tag(self):
        release_id, url = self.publish()
        self.assertEqual(release_id, 12345)
        self.assertEqual(url, f"https://github.com/{REPOSITORY}/releases/tag/{TAG}")
        create = next(c for c in self.ops.calls if c[0] == "POST")
        self.assertEqual(create[1], f"repos/{REPOSITORY}/releases")
        self.assertEqual(create[2]["target_commitish"], SHA)
        self.assertIs(create[2]["draft"], True)
        self.assertEqual(create[2]["body"], self.notes.read_text())
        uploads = [c for c in self.ops.calls if c[0] == "upload"]
        downloads = [c for c in self.ops.calls if c[0] == "download"]
        self.assertEqual(len(uploads), 7)
        self.assertEqual(len(downloads), 7)
        self.assertEqual(len(self.ops.verifications), 2)
        for config, sig, payload, tag in self.ops.verifications:
            self.assertEqual(config, self.config)
            self.assertEqual(str(sig), str(payload) + ".sig")
            self.assertEqual(tag, TAG)
            self.assertEqual(payload.parent, self.root / "downloads")
        patch_call = next(c for c in self.ops.calls if c[0] == "PATCH")
        self.assertEqual(patch_call, ("PATCH", f"repos/{REPOSITORY}/releases/12345",
                                     {"draft": False, "prerelease": False, "make_latest": "true"}))

    def test_existing_draft_or_published_release_is_not_reused(self):
        for draft in (True, False):
            with self.subTest(draft=draft):
                self.ops.inventory = [{"tag_name": TAG, "draft": draft, "id": 4264406147}]
                with self.assertRaises(PublishError):
                    self.publish()
                self.assertFalse(any(c[0] in ("POST", "PATCH", "upload") for c in self.ops.calls))
                (self.root / "downloads").rmdir()

    def test_create_422_is_not_retried_or_reused(self):
        original = self.ops.api
        def conflict(method, endpoint, payload=None):
            if method == "POST":
                raise PublishError("422 already exists")
            return original(method, endpoint, payload)
        self.ops.api = conflict
        with self.assertRaises(PublishError):
            self.publish()
        self.assert_not_published()

    def test_invalid_create_id(self):
        for release_id in (None, 0, -1, True, "12345"):
            with self.subTest(release_id=release_id):
                self.ops.release["id"] = release_id
                with self.assertRaises(PublishError):
                    self.publish()
                self.assert_not_published()
                (self.root / "downloads").rmdir()

    def test_audit_failures_block_publication(self):
        mutations = {
            "id": lambda r: r.update(id=999),
            "tag": lambda r: r.update(tag_name="0.0.4"),
            "sha": lambda r: r.update(target_commitish="main"),
            "draft": lambda r: r.update(draft=False),
            "prerelease": lambda r: r.update(prerelease=True),
            "notes": lambda r: r.update(body="unexpected notes"),
            "name": lambda r: r.update(name="unexpected title"),
            "digest": lambda r: r["assets"][0].update(digest=None),
            "size": lambda r: r["assets"][0].update(size=123456),
            "state": lambda r: r["assets"][0].update(state="new"),
            "filename": lambda r: r["assets"][0].update(name="../escape"),
            "extra": lambda r: r["assets"].append(copy.deepcopy(r["assets"][0])),
            "asset_id": lambda r: r["assets"][0].update(id=True),
        }
        for name, mutation in mutations.items():
            with self.subTest(name=name):
                self.ops = FakeGitHub(self.assets, self.notes.read_text())
                self.ops.mutate = mutation
                with self.assertRaises(PublishError):
                    self.publish()
                self.assert_not_published()
                (self.root / "downloads").rmdir()

    def test_download_tampering_blocks_publication(self):
        self.ops.tamper = True
        with self.assertRaises(PublishError):
            self.publish()
        self.assert_not_published()
        self.assertFalse(self.ops.verifications)

    def test_signature_failure_blocks_publication(self):
        self.ops.verify_error = True
        with self.assertRaises(PublishError):
            self.publish()
        self.assert_not_published()
        self.assertEqual(len(self.ops.verifications), 1)

    def test_missing_key_configuration_blocks_all_network(self):
        self.config.unlink()
        with self.assertRaises(OSError):
            self.publish()
        self.assertEqual(self.ops.calls, [])

    def test_missing_public_key_and_wrong_version_block_all_network(self):
        self.config.write_text(json.dumps({"version": "0.0.4"}))
        with self.assertRaises(PublishError):
            self.publish()
        self.assertEqual(self.ops.calls, [])

    def test_symlink_and_extra_assets_rejected(self):
        path = self.assets / self.names[0]
        path.unlink()
        path.symlink_to(self.notes)
        with self.assertRaises(PublishError):
            self.publish()
        path.unlink()
        path.write_bytes(b"restored")
        (self.assets / "extra.txt").write_bytes(b"extra")
        with self.assertRaises(PublishError):
            self.publish()
        self.assertEqual(self.ops.calls, [])

    def test_checksum_duplicate_or_traversal_rejected(self):
        manifest = self.assets / "SHASUMS256.txt"
        original = manifest.read_text()
        for contents in (original + original.splitlines()[0] + "\n",
                         original.replace(self.names[0], "../escape"), original[:-10]):
            manifest.write_text(contents)
            with self.assertRaises(PublishError):
                self.publish()
        self.assertEqual(self.ops.calls, [])

    def test_existing_download_directory_rejected(self):
        (self.root / "downloads").mkdir()
        with self.assertRaises(PublishError):
            self.publish()
        self.assertEqual(self.ops.calls, [])

    def test_private_repository_blocks_creation(self):
        original = self.ops.api
        def private(method, endpoint, payload=None):
            if endpoint == f"repos/{REPOSITORY}":
                return {"private": True, "full_name": REPOSITORY}
            return original(method, endpoint, payload)
        self.ops.api = private
        with self.assertRaises(PublishError):
            self.publish()
        self.assert_not_published()
        self.assertFalse(any(c[0] == "POST" for c in self.ops.calls))

    def test_latest_must_have_the_created_release_id(self):
        original = self.ops.api
        def wrong_latest(method, endpoint, payload=None):
            result = original(method, endpoint, payload)
            if endpoint.endswith("/latest"):
                result["id"] = 777
            return result
        self.ops.api = wrong_latest
        with self.assertRaises(PublishError):
            self.publish()

    def test_final_reaudit_blocks_concurrent_change(self):
        def mutate(release):
            if self.ops.verifications:
                release["body"] = "changed during verification"
        self.ops.mutate = mutate
        with self.assertRaises(PublishError):
            self.publish()
        self.assertEqual(len(self.ops.verifications), 2)
        self.assert_not_published()


class TransportTests(unittest.TestCase):
    def test_id_upload_download_and_json_headers(self):
        calls = []
        def fake_run(command, output, limit, input_data=None, timeout=120):
            calls.append((command, limit, input_data))
            output.write(b'{}' if input_data else b'fixture')
        with tempfile.TemporaryDirectory() as directory, patch("publish_release.run_bounded", fake_run):
            root = Path(directory)
            api = GitHub()
            api.api("POST", "repos/yan-ad/iceon/releases", {"draft": True})
            api.upload(REPOSITORY, 12345, root / "file #?.sig")
            api.download(REPOSITORY, 101, root / "download")
            api.verify(root / "config", root / "sig", root / "payload", TAG)
        self.assertEqual(json.loads(calls[0][2]), {"draft": True})
        self.assertIn("--input", calls[0][0])
        self.assertIn("https://uploads.github.com/repos/yan-ad/iceon/releases/12345/assets?name=file%20%23%3F.sig", calls[1][0])
        self.assertIn("Content-Type: application/octet-stream", calls[1][0])
        self.assertIn("repos/yan-ad/iceon/releases/assets/101", calls[2][0])
        self.assertIn("Accept: application/octet-stream", calls[2][0])
        self.assertEqual(calls[2][1], MAX_ASSET)
        self.assertIn("--locked", calls[3][0])
        self.assertEqual(calls[3][0][-1], TAG)

    def test_command_failure_and_output_limit(self):
        import sys
        with tempfile.TemporaryFile() as output:
            with self.assertRaises(PublishError):
                run_bounded([sys.executable, "-c", "raise SystemExit(1)"], output, 100)
        with tempfile.TemporaryFile() as output:
            with self.assertRaises(PublishError):
                run_bounded([sys.executable, "-c", "print('x' * 1024)"], output, 100)


if __name__ == "__main__":
    unittest.main()
