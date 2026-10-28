#!/usr/bin/env python3
"""Publish a fresh stable release; never resume or replace an existing release."""

import filecmp
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
from urllib.parse import quote

REPOSITORY = "yan-ad/iceon"
MAX_ASSET = 256 * 1024 * 1024
MAX_TOTAL = 768 * 1024 * 1024


class PublishError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise PublishError(message)


def positive_id(value):
    return type(value) is int and value > 0


def regular_file(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= MAX_ASSET,
            "Expected a nonempty bounded regular file (not a symlink)")
    return info.st_size


def fingerprint(path):
    size = regular_file(path)
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return size, "sha256:" + digest.hexdigest()


def expected_names(tag):
    return [f"Iceon_{tag}_aarch64.dmg", f"Iceon_{tag}_aarch64.app.tar.gz",
            f"Iceon_{tag}_aarch64.app.tar.gz.sig", f"Iceon_{tag}_x86-setup.exe",
            f"Iceon_{tag}_x86-setup.exe.sig", "latest.json", "SHASUMS256.txt"]


def verify_checksums(directory, names):
    lines = (directory / "SHASUMS256.txt").read_text(encoding="utf-8").splitlines()
    expected = {name: fingerprint(directory / name)[1][7:] for name in names
                if name != "SHASUMS256.txt"}
    found = {}
    for line in lines:
        match = re.fullmatch(r"([0-9a-f]{64})  (.+)", line)
        require(match is not None, "Malformed checksum manifest")
        digest, name = match.groups()
        require(name in expected and name not in found, "Unexpected or duplicate checksum filename")
        found[name] = digest
    require(found == expected, "Checksums must cover exactly the six release files")


def run_bounded(command, output, limit, input_data=None, timeout=120):
    with tempfile.TemporaryFile() as stdin:
        if input_data is not None:
            stdin.write(input_data)
        stdin.seek(0)
        with subprocess.Popen(command, stdin=stdin, stdout=output,
                              stderr=subprocess.DEVNULL) as process:
            deadline = time.monotonic() + timeout
            try:
                while process.poll() is None:
                    require(os.fstat(output.fileno()).st_size <= limit, "Command output exceeded limit")
                    require(time.monotonic() < deadline, "Command timed out")
                    time.sleep(0.05)
                require(process.returncode == 0, "Release command failed; inspect the draft manually before retrying")
                require(os.fstat(output.fileno()).st_size <= limit, "Command output exceeded limit")
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()


class GitHub:
    def api(self, method, endpoint, payload=None):
        command = ["gh", "api", "--method", method, endpoint]
        data = None
        if payload is not None:
            command += ["--input", "-"]
            data = json.dumps(payload).encode("utf-8")
        with tempfile.TemporaryFile() as output:
            run_bounded(command, output, 2 * 1024 * 1024, data)
            output.seek(0)
            return json.load(output)

    def upload(self, repo, release_id, path):
        # A full URL keeps gh's GitHub authentication while selecting the upload host.
        endpoint = (f"https://uploads.github.com/repos/{repo}/releases/{release_id}/assets"
                    f"?name={quote(path.name, safe='')}")
        with tempfile.TemporaryFile() as output:
            run_bounded(["gh", "api", "--method", "POST", endpoint, "--input", str(path),
                         "-H", "Content-Type: application/octet-stream"], output, 2 * 1024 * 1024)

    def download(self, repo, asset_id, path):
        with path.open("xb") as output:
            run_bounded(["gh", "api", "--method", "GET",
                         f"repos/{repo}/releases/assets/{asset_id}",
                         "-H", "Accept: application/octet-stream"], output, MAX_ASSET)

    def verify(self, config, signature, payload, tag):
        with tempfile.TemporaryFile() as output:
            run_bounded(["cargo", "run", "--manifest-path", "xtask/Cargo.toml", "--locked", "--",
                         "verify-update", str(config), str(signature), str(payload), tag],
                        output, 2 * 1024 * 1024, timeout=300)


def publish(ops, repo, tag, sha, assets, downloads, notes_path, config_path):
    require(repo == REPOSITORY, "Expected the canonical repository")
    require(re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", tag),
            "Expected a canonical stable version without v")
    require(re.fullmatch(r"[0-9a-f]{40}", sha), "Expected an exact commit SHA")
    require(assets.is_dir() and not assets.is_symlink(), "Invalid asset directory")
    names = expected_names(tag)
    require(sorted(p.name for p in assets.iterdir()) == sorted(names), "Expected exactly seven assets")
    local = {name: fingerprint(assets / name) for name in names}
    require(sum(size for size, _ in local.values()) <= MAX_TOTAL, "Release exceeds total size limit")
    verify_checksums(assets, names)
    regular_file(notes_path)
    notes = notes_path.read_text(encoding="utf-8")
    require(notes.strip(), "Release notes must not be empty")
    regular_file(config_path)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    updater = config.get("plugins", {}).get("updater", {})
    require(config.get("version") == tag and updater.get("requireSignedVersion") is True
            and isinstance(updater.get("pubkey"), str) and updater["pubkey"].strip(),
            "Expected matching app version and a configured signed-version public key")
    require(not downloads.exists() and not downloads.is_symlink(), "Download directory must not exist")
    downloads.mkdir()
    repository = ops.api("GET", f"repos/{repo}")
    require(repository.get("private") is False and repository.get("full_name") == repo,
            "Expected the canonical public GitHub repository")
    # The list endpoint includes drafts, unlike the published-release tag endpoint.
    for page in range(1, 101):
        releases = ops.api("GET", f"repos/{repo}/releases?per_page=100&page={page}")
        require(isinstance(releases, list), "Invalid release inventory")
        require(not any(r.get("tag_name") == tag for r in releases),
                "A release already owns this tag; manual recovery is required")
        if len(releases) < 100:
            break
    else:
        raise PublishError("Release inventory exceeded the bounded page limit")
    title = f"Iceon {tag}"
    created = ops.api("POST", f"repos/{repo}/releases", {
        "tag_name": tag, "target_commitish": sha, "name": title, "body": notes,
        "draft": True, "prerelease": False, "make_latest": "false"})
    release_id = created.get("id")
    require(positive_id(release_id), "Create response did not contain a positive release ID")
    endpoint = f"repos/{repo}/releases/{release_id}"

    def audit(release, draft, with_assets=True):
        require(release.get("id") == release_id and positive_id(release.get("id"))
                and release.get("tag_name") == tag and release.get("target_commitish") == sha
                and release.get("draft") is draft and release.get("prerelease") is False
                and release.get("name") == title and release.get("body") == notes,
                "Unexpected release identity, provenance, notes or state")
        remote = release.get("assets")
        require(isinstance(remote, list), "Missing release assets")
        if not with_assets:
            require(not remote, "Fresh draft unexpectedly has assets")
            return remote
        require(sorted(a.get("name", "") for a in remote) == sorted(names),
                "Release must contain exactly the seven audited assets")
        ids = set()
        for asset in remote:
            asset_id = asset.get("id")
            require(positive_id(asset_id) and asset_id not in ids, "Invalid or duplicate asset ID")
            ids.add(asset_id)
            require(asset.get("name") in local, "Release contains an unexpected asset filename")
            size, digest = local[asset["name"]]
            require(asset.get("state") == "uploaded" and type(asset.get("size")) is int
                    and asset["size"] == size and asset.get("digest") == digest,
                    "GitHub asset state, size or digest differs from audited bytes")
        return remote

    audit(created, True, with_assets=False)
    for name in names:
        ops.upload(repo, release_id, assets / name)
    remote = audit(ops.api("GET", endpoint), True)
    for asset in remote:
        destination = downloads / asset["name"]
        ops.download(repo, asset["id"], destination)
        require(fingerprint(destination) == local[asset["name"]]
                and filecmp.cmp(assets / asset["name"], destination, shallow=False),
                "Downloaded release bytes differ")
    verify_checksums(downloads, names)
    for name in [f"Iceon_{tag}_aarch64.app.tar.gz", f"Iceon_{tag}_x86-setup.exe"]:
        ops.verify(config_path, downloads / (name + ".sig"), downloads / name, tag)
    # Reaudit immediately before the only publication mutation.
    audit(ops.api("GET", endpoint), True)
    changed = ops.api("PATCH", endpoint, {"draft": False, "prerelease": False, "make_latest": "true"})
    audit(changed, False)
    published = ops.api("GET", endpoint)
    audit(published, False)
    latest = ops.api("GET", f"repos/{repo}/releases/latest")
    audit(latest, False)
    url = f"https://github.com/{repo}/releases/tag/{tag}"
    require(latest.get("id") == release_id, "Published release is not latest")
    require(published.get("html_url") == url and latest.get("html_url") == url,
            "Unexpected public release URL")
    return release_id, url


def verify_checkout(tag, sha, cwd=None):
    require(re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", tag),
            "Expected a canonical stable tag")
    require(re.fullmatch(r"[0-9a-f]{40}", sha), "Expected an exact workflow commit")
    # checkout may synthesize a lightweight local tag. Fetch the remote tag into
    # a separate namespace so provenance checks never overwrite checkout refs.
    reference = f"refs/iceon/release-tags/{tag}"
    kind = subprocess.check_output(["git", "cat-file", "-t", reference],
                                   cwd=cwd, text=True, timeout=30).strip()
    require(kind == "tag", "Expected the remote release tag to be annotated")
    for selector in ["HEAD", f"{reference}^{{commit}}"]:
        actual = subprocess.check_output(["git", "rev-parse", "--verify", selector],
                                         cwd=cwd, text=True, timeout=30).strip()
        require(actual == sha, "Tag, checkout and workflow SHA must agree")


def main():
    tag = os.environ["RELEASE_TAG"]
    sha = os.environ["GITHUB_SHA"]
    verify_checkout(tag, sha)
    release_id, url = publish(GitHub(), os.environ["GH_REPO"], tag, sha,
                              Path("release-assets"), Path("release-verify"),
                              Path("/tmp/iceon-release-notes.md"), Path("src-tauri/tauri.conf.json"))
    print(f"{url} (release ID {release_id})")


if __name__ == "__main__":
    try:
        main()
    except (PublishError, OSError, ValueError, KeyError, subprocess.SubprocessError):
        print("Release publication failed; inspect any created draft manually. No automatic reuse or cleanup.",
              file=sys.stderr)
        sys.exit(1)
