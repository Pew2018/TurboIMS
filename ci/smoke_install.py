#!/usr/bin/env python3
"""Run customize.sh using BusyBox with KSU helper shims in a temporary state directory.
This tests installation checks and permissions, not Android Binder or SELinux."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile
from verify_module import validate

validate(sys.argv[1])
with tempfile.TemporaryDirectory(prefix="turboims-install-") as scratch:
    work = Path(scratch)
    module = work / "module"
    with zipfile.ZipFile(sys.argv[1]) as archive:
        archive.extractall(module)
    state = work / "state"
    customize = (module / "customize.sh").read_text()
    # Redirect only the persistent state location; never touch /data on the CI host.
    harness_script = work / "customize-test.sh"
    harness_script.write_text(customize.replace("/data/adb/turboims-next", str(state)))
    launcher = work / "installer-shim.sh"
    launcher.write_text('''#!/bin/sh
set -eu
abort() { echo "ABORT: $*" >&2; exit 1; }
ui_print() { echo "$*"; }
set_perm() { chmod "$4" "$1"; }
. "$TURBOIMS_TEST_CUSTOMIZE"
''')
    env = os.environ.copy()
    env.update(KSU="true", ARCH="arm64", API="36", MODPATH=str(module),
               TURBOIMS_TEST_CUSTOMIZE=str(harness_script))

    def run(overrides=None):
        settings = dict(env)
        settings.update(overrides or {})
        return subprocess.run(["busybox", "sh", str(launcher)], env=settings,
                              capture_output=True, text=True)

    for overrides in ({"KSU": "false"}, {"ARCH": "x86_64"}, {"API": "37"}):
        result = run(overrides)
        assert result.returncode != 0 and "ABORT:" in result.stderr, result
    original = (module / "runner.sha256").read_bytes()
    (module / "runner.sha256").write_text("0" * 64 + "  runner.apk\n")
    result = run()
    assert result.returncode != 0 and "checksum mismatch" in result.stderr, result
    (module / "runner.sha256").write_bytes(original)
    # Match upload-artifact's loss of Unix file permission bits.
    for path in module.rglob("*"):
        if path.is_file():
            path.chmod(0o644)
    result = run()
    assert result.returncode == 0, result.stderr + result.stdout
    assert (module / "runner.apk").stat().st_mode & 0o777 == 0o444
    for name in ("service.sh", "control.sh", "action.sh", "uninstall.sh"):
        assert (module / name).stat().st_mode & 0o777 == 0o755
    assert state.stat().st_mode & 0o777 == 0o700
    config = state / "config.json"
    assert config.stat().st_mode & 0o777 == 0o600
    assert config.read_bytes() == (module / "default-config.json").read_bytes()
    config.write_text('{"existing_config_must_survive":true}\n')
    result = run()
    assert result.returncode == 0, result.stderr + result.stdout
    assert config.read_text() == '{"existing_config_must_survive":true}\n'
    print("BusyBox install smoke passed: platform guards, checksum, permissions, fresh install and upgrade")
