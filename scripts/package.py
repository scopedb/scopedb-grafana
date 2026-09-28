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
package = json.loads((root / "package.json").read_text())
lock = json.loads((root / "package-lock.json").read_text())
assert version == package["version"] == lock["version"] == lock["packages"][""]["version"], "Package versions differ; rebuild"
files = ("plugin.json", "module.js", "README.md", "LICENSE", "img/logo.svg") + tuple(
    manifest["executable"] + "_linux_" + arch for arch in ("amd64", "arm64")
)
assert all((dist / name).is_file() for name in files), "Missing plugin files; run make build"
for arch, machine in (("amd64", 62), ("arm64", 183)):
    binary = dist / (manifest["executable"] + "_linux_" + arch)
    with binary.open("rb") as stream:
        header = stream.read(20)
    assert header[:6] == b"\x7fELF\x02\x01" and int.from_bytes(header[18:20], "little") == machine, f"Invalid {arch} binary"
    assert binary.stat().st_mode & 0o111 == 0o111, f"Binary is not executable: {binary.name}"
target = dist / f"{plugin_id}-{version}.zip"
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(dist / name, pathlib.Path(plugin_id) / name)
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None, "Corrupt plugin archive"
print(target.relative_to(root))
for algorithm in ("sha1", "sha256"):
    digest = hashlib.new(algorithm, target.read_bytes()).hexdigest()
    target.with_suffix(f".zip.{algorithm}").write_text(f"{digest}  {target.name}\n")
