#!/usr/bin/env python3
"""Validate the exact ZIP downloaded by users before declaring it flashable."""
import hashlib
import io
import json
from pathlib import PurePosixPath
import re
import stat
import sys
import zipfile

REQUIRED = {"module.prop", "skip_mount", "runner.apk", "runner.sha256",
            "build-info.json", "customize.sh", "service.sh", "control.sh",
            "action.sh", "uninstall.sh", "default-config.json",
            "webroot/index.html", "webroot/bridge.js", "webroot/app.js", "webroot/style.css"}

def validate(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate ZIP entries")
        if not REQUIRED.issubset(names):
            raise ValueError("Not a flashable module: required files (including module.prop) must be at ZIP root")
        for info in archive.infolist():
            name = info.filename
            pure = PurePosixPath(name)
            if (name.startswith("/") or "\\" in name or ".." in pure.parts
                    or str(pure) != name.rstrip("/") or stat.S_ISLNK(info.external_attr >> 16)):
                raise ValueError("Unsafe ZIP entry: " + name)
            if name.endswith(".zip"):
                raise ValueError("Nested ZIP is not allowed in the install artifact")
        if archive.testzip() is not None:
            raise ValueError("ZIP CRC check failed")
        prop = archive.read("module.prop").decode("utf-8")
        if "\r" in prop:
            raise ValueError("module.prop must use UNIX LF")
        fields = dict(line.split("=", 1) for line in prop.splitlines()
                      if line and not line.startswith("#"))
        if fields.get("id") != "turboims_next":
            raise ValueError("Unexpected module id")
        if not re.fullmatch(r"[1-9][0-9]*", fields.get("versionCode", "")):
            raise ValueError("Invalid versionCode")
        for field in ("name", "version", "author", "description"):
            if not fields.get(field):
                raise ValueError("Missing module metadata: " + field)
        for name in names:
            if name.endswith(".sh"):
                script = archive.read(name)
                if not script.startswith(b"#!/system/bin/sh\n") or b"\r" in script:
                    raise ValueError("Invalid Android shell script: " + name)
        apk = archive.read("runner.apk")
        digest = hashlib.sha256(apk).hexdigest()
        if archive.read("runner.sha256").decode().strip() != digest + "  runner.apk":
            raise ValueError("Runner checksum mismatch")
        build = json.loads(archive.read("build-info.json"))
        if build.get("version") != fields["version"] or build.get("helper_sha256") != digest:
            raise ValueError("Build metadata mismatch")
        with zipfile.ZipFile(io.BytesIO(apk)) as runner:
            if runner.testzip() is not None:
                raise ValueError("Runner APK CRC failure")
            dex = b"".join(runner.read(n) for n in runner.namelist() if n.endswith(".dex"))
            if b"io/github/turboims/ksu/ModuleMain" not in dex:
                raise ValueError("Root entry point missing")
            if b"rikka/shizuku" in dex or b"rikka/sui" in dex:
                raise ValueError("Unexpected external privilege dependency")
        return {"version": fields["version"], "files": len(names), "runner_sha256": digest}

if __name__ == "__main__":
    result = validate(sys.argv[1])
    print(json.dumps(result, indent=2))
