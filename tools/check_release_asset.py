#!/usr/bin/env python3
"""Read-only release preflight: preserve an identical site.zip or fail on drift."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen


def sha256_file(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def should_publish(path: Path, repository: str, tag: str, token: str) -> bool:
    local_sha = sha256_file(path)
    request = Request(
        f"https://api.github.com/repos/{repository}/releases/tags/{quote(tag, safe='')}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    # There is no existing release helper. This query is strictly read-only;
    # only the release endpoint's 404 means publication has not happened yet.
    try:
        with urlopen(request, timeout=60) as response:
            release = json.load(response)
    except HTTPError as error:
        if error.code != 404:
            raise
        print(f"Release {tag} does not exist (HTTP 404); publish site.zip SHA-256 {local_sha}")
        return True

    assets = [asset for asset in release["assets"] if asset["name"] == "site.zip"]
    if not assets:
        print(f"Release {tag} has no site.zip; publish SHA-256 {local_sha}")
        return True
    if len(assets) != 1 or assets[0]["state"] != "uploaded":
        raise RuntimeError(f"Release {tag} does not have one fully uploaded site.zip")

    asset = assets[0]
    digest = asset.get("digest") or ""
    if re.fullmatch(r"sha256:[0-9a-fA-F]{64}", digest):
        remote_sha = digest.partition(":")[2].lower()
    else:
        # Older GitHub assets may have no digest. Download this public repo's
        # asset and hash its bytes; never forward the API token to the CDN.
        hasher = hashlib.sha256()
        size = 0
        with urlopen(asset["browser_download_url"], timeout=60) as response:
            for chunk in iter(lambda: response.read(1024 * 1024), b""):
                hasher.update(chunk)
                size += len(chunk)
        if size != asset["size"]:
            raise RuntimeError(f"Incomplete download of existing site.zip: {size} != {asset['size']} bytes")
        remote_sha = hasher.hexdigest()

    if remote_sha != local_sha:
        raise RuntimeError(
            f"Refusing to replace release {tag} site.zip: "
            f"existing SHA-256 {remote_sha} != generated SHA-256 {local_sha}"
        )
    print(f"Preserving existing release {tag} site.zip: SHA-256 {local_sha} matches")
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", type=Path, default=Path("site.zip"))
    args = parser.parse_args()
    publish = should_publish(
        args.zip, os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_REF_NAME"], os.environ["GH_TOKEN"],
    )
    if os.environ.get("GITHUB_OUTPUT"):
        with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
            output.write(f"publish={str(publish).lower()}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
