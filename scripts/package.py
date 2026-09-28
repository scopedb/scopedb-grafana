"""Create a Linux amd64 plugin archive from built dist/."""
import json
import pathlib
import zipfile

root = pathlib.Path(__file__).resolve().parents[1]
dist = root / "dist"
manifest = json.loads((dist / "plugin.json").read_text())
plugin_id = manifest["id"]
version = manifest["info"]["version"]
assert "%" not in version, "Run make build first"
binary = dist / (manifest["executable"] + "_linux_amd64")
assert binary.is_file(), "Missing Linux amd64 backend; run make build"
assert (dist / "module.js").is_file(), "Missing frontend; run make build"
target = dist / f"{plugin_id}-{version}.zip"
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(dist.rglob("*")):
        if file.is_file() and file.suffix not in (".zip", ".map") and file.name != "MANIFEST.txt":
            archive.write(file, pathlib.Path(plugin_id) / file.relative_to(dist))
print(target.relative_to(root))
