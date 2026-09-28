"""Create a Linux amd64/arm64 plugin archive from built dist/."""

import hashlib
import json
import pathlib
import zipfile

root = pathlib.Path(__file__).resolve().parents[1]
dist = root / "dist"
manifest = json.loads((dist / "plugin.json").read_text())
plugin_id = manifest["id"]
version = manifest["info"]["version"]
assert "%" not in version and manifest["buildMode"] == "production", "Run make build first"
files = ("plugin.json", "module.js", "README.md", "LICENSE", "img/logo.svg") + tuple(
    manifest["executable"] + "_linux_" + arch for arch in ("amd64", "arm64")
)
assert all((dist / name).is_file() for name in files), "Missing plugin files; run make build"
target = dist / f"{plugin_id}-{version}.zip"
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(dist / name, pathlib.Path(plugin_id) / name)
print(target.relative_to(root))
for algorithm in ("sha1", "sha256"):
    digest = hashlib.new(algorithm, target.read_bytes()).hexdigest()
    target.with_suffix(f".zip.{algorithm}").write_text(f"{digest}  {target.name}\n")
