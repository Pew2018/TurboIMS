#!/usr/bin/env python3
"""Build canonical ZIP plus a flat payload for upload-artifact; Actions runs only."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import zipfile
from verify_module import validate

root = Path(__file__).resolve().parent.parent
apks = list((root / "root-runner/build/outputs/apk/release").glob("*.apk"))
if len(apks) != 1:
    raise SystemExit(f"Expected one helper APK, found {len(apks)}")
prop = dict(line.split("=", 1) for line in (root / "module/module.prop").read_text().splitlines()
            if line and not line.startswith("#"))
version = prop["version"]
compile_sdk = int(os.environ.get("TURBOIMS_COMPILE_SDK", "36"))
out = root / "dist"
out.mkdir(exist_ok=True)
payload = out / "flashable"
if payload.exists():
    shutil.rmtree(payload)
shutil.copytree(root / "module", payload)
apk = apks[0].read_bytes()
digest = hashlib.sha256(apk).hexdigest()
(payload / "runner.apk").write_bytes(apk)
(payload / "runner.apk").chmod(0o444)
(payload / "runner.sha256").write_text(f"{digest}  runner.apk\n")
(payload / "build-info.json").write_text(json.dumps({
    "version": version, "commit": os.environ.get("GITHUB_SHA", ""),
    "compile_sdk": compile_sdk, "helper_sha256": digest, "entry": "io.github.turboims.ksu.ModuleMain",
    "shizuku": False, "sui": False, "device_validated": False
}, indent=2) + "\n")
shutil.copyfile(root / "docs/KERNELSU_NEXT.md", payload / "README.md")
dest = out / f"TurboIMS-Next-{version}-sdk{compile_sdk}.zip"
with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(payload.rglob("*")):
        if file.is_file():
            info = zipfile.ZipInfo(file.relative_to(payload).as_posix())
            info.create_system = 3
            mode = 0o755 if file.suffix == ".sh" else 0o444 if file.name == "runner.apk" else 0o644
            info.external_attr = (0o100000 | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, file.read_bytes())
validate(dest)
(out / (dest.name + ".sha256")).write_text(
    hashlib.sha256(dest.read_bytes()).hexdigest() + "  " + dest.name + "\n")
# Upload this DIRECTORY, never dist/*: GitHub itself creates the final ZIP.
# It must contain module.prop at root, not a ZIP nested inside another ZIP.
print(dest)
if os.environ.get("GITHUB_OUTPUT"):
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write(f"artifact_name=FLASHABLE-TurboIMS-Next-{version}-sdk{compile_sdk}\n")
