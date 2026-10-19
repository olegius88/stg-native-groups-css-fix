"""Build stg-native-groups-css.xpi / .zip with forward-slash entry names.

Windows PowerShell 5.1 Compress-Archive writes backslashes into ZIP entry
names (e.g. "experiments\\api.js"), which Firefox treats as a corrupt add-on
and silently removes from the profile. Always build with this script.

Usage: python build.py
"""
import os
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
INCLUDE = ["manifest.json", "background.js", "experiments", "icons", "popup"]
OUTPUTS = ["stg-native-groups-css.xpi", "stg-native-groups-css.zip"]


def collect():
    files = []
    for item in INCLUDE:
        full = os.path.join(ROOT, item)
        if os.path.isfile(full):
            files.append(item)
        else:
            for dirpath, _, filenames in os.walk(full):
                for fn in sorted(filenames):
                    rel = os.path.relpath(os.path.join(dirpath, fn), ROOT)
                    files.append(rel)
    return files


def build():
    files = collect()
    for out in OUTPUTS:
        out_path = os.path.join(ROOT, out)
        if os.path.exists(out_path):
            os.remove(out_path)
        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
            # manifest.json first
            for rel in sorted(files, key=lambda f: f != "manifest.json"):
                arcname = rel.replace("\\", "/")
                z.write(os.path.join(ROOT, rel), arcname)
        print(f"Built {out} ({os.path.getsize(out_path)} bytes)")
    # verify raw entry names
    with open(os.path.join(ROOT, OUTPUTS[0]), "rb") as f:
        raw = f.read()
    assert b"\\" not in b"".join(
        raw[i + 46: i + 46 + int.from_bytes(raw[i + 28:i + 30], "little")]
        for i in _find_all(raw, b"PK\x01\x02")
    ), "Backslash found in ZIP entry names!"
    print("Verified: all entry names use forward slashes")


def _find_all(raw, sig):
    i = raw.find(sig)
    while i >= 0:
        yield i
        i = raw.find(sig, i + 1)


if __name__ == "__main__":
    build()
