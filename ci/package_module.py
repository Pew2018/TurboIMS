#!/usr/bin/env python3
"""Executed only by GitHub Actions: package DEX + offline WebUI into one installable module."""
import hashlib
import json
import os
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
apks = list((root / "root-runner/build/outputs/apk/release").glob("*.apk"))
if len(apks) != 1:
    raise SystemExit(f"Expected one helper APK, found {len(apks)}")
apk = apks[0].read_bytes()
with zipfile.ZipFile(apks[0]) as jar:
    dex_files = [n for n in jar.namelist() if n.endswith(".dex")]
    if not dex_files:
        raise SystemExit("APK has no executable DEX")
    for name in dex_files:
        dex = jar.read(name)
        if b"rikka/shizuku" in dex or b"rikka/sui" in dex:
            raise SystemExit("Unexpected Shizuku/Sui dependency in standalone runner")
    if b"io/github/turboims/ksu/ModuleMain" not in b"".join(jar.read(n) for n in dex_files):
        raise SystemExit("Root main entry point missing")
out = root / "dist"
out.mkdir(exist_ok=True)
dest = out / "TurboIMS-Next-0.1.0-experimental.zip"
digest = hashlib.sha256(apk).hexdigest()
with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as archive:
    def add(name, data, mode=0o644):
        info = zipfile.ZipInfo(name)
        info.create_system = 3
        info.external_attr = (0o100000 | mode) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, data)
    for file in sorted((root / "module").rglob("*")):
        if file.is_file():
            add(file.relative_to(root / "module").as_posix(), file.read_bytes(),
                0o755 if file.suffix == ".sh" else 0o644)
    add("runner.apk", apk, 0o444)
    add("runner.sha256", f"{digest}  runner.apk\n".encode())
    add("build-info.json", json.dumps({
        "version": "0.1.0-experimental", "commit": os.environ.get("GITHUB_SHA", ""),
        "helper_sha256": digest, "entry": "io.github.turboims.ksu.ModuleMain",
        "shizuku": False, "sui": False, "device_validated": False
    }, indent=2).encode())
    add("README.md", (root / "docs/KERNELSU_NEXT.md").read_bytes())
with zipfile.ZipFile(dest) as archive:
    required = {"module.prop", "skip_mount", "runner.apk", "runner.sha256", "service.sh",
                "customize.sh", "control.sh", "webroot/index.html", "webroot/bridge.js"}
    assert required.issubset(set(archive.namelist()))
    assert archive.testzip() is None
(out / (dest.name + ".sha256")).write_text(
    hashlib.sha256(dest.read_bytes()).hexdigest() + "  " + dest.name + "\n")
print(dest)
