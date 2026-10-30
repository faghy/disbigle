"""
Downloads Mozilla's released translation models (the ones Firefox uses) for the given
languages, to and from English, into MODELS/<source>-<target>/.

    python download_models.py --models /var/lib/disbigle/translator/models it es fr de pt
"""

import argparse
import gzip
import hashlib
import json
import os
import urllib.request

REGISTRY = (
    "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data"
    "/db/models.json"
)
RELEASES = ("Release", "Release Desktop", "Release Android")


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--models", default="./models")
    parser.add_argument("languages", nargs="+", help="language codes, e.g. it es fr")
    args = parser.parse_args()

    registry = json.loads(fetch(REGISTRY))
    base = registry["baseUrl"]
    for language in args.languages:
        for pair in (f"{language}-en", f"en-{language}"):
            # "Release" models are in every Firefox; some pairs only have desktop or Android ones.
            candidates = registry["models"].get(pair, [])
            model = next(
                (m for status in RELEASES for m in candidates if m.get("releaseStatus") == status),
                None,
            )
            if model is None:
                print(f"{pair}: no released model, skipped")
                continue
            directory = os.path.join(args.models, pair)
            os.makedirs(directory, exist_ok=True)
            for kind, file in model["files"].items():
                name = os.path.basename(file["path"]).removesuffix(".gz")
                target = os.path.join(directory, name)
                if os.path.exists(target):
                    continue
                data = gzip.decompress(fetch(f"{base}/{file['path']}"))
                expected = file.get("uncompressedHash")
                if expected and hashlib.sha256(data).hexdigest() != expected:
                    raise SystemExit(f"{pair}: {name} does not match its hash")
                with open(target + ".part", "wb") as out:
                    out.write(data)
                os.replace(target + ".part", target)
            print(f"{pair}: {model['architecture']}")


if __name__ == "__main__":
    main()
