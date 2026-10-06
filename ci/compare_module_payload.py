"""Read-only promotion audit: compare downloaded module payloads in GitHub Actions."""
import hashlib
import json
import os
from pathlib import Path
import sys
import zipfile
from verify_module import validate

current, baseline = map(Path, sys.argv[1:3])
for archive in (current, baseline):
    result = validate(archive)
    if result["version"] != "1.0.0":
        raise SystemExit(f"Unexpected promotion version: {result['version']}")
with zipfile.ZipFile(current) as new, zipfile.ZipFile(baseline) as old:
    names = lambda archive: {info.filename for info in archive.infolist() if not info.is_dir()}
    if names(new) != names(old):
        raise SystemExit("Promotion changed the module file list")
    matched, metadata_changes = [], []
    for name in sorted(names(new)):
        a, b = new.read(name), old.read(name)
        if name == "build-info.json":
            fresh, previous = json.loads(a), json.loads(b)
            if fresh.pop("commit") != os.environ["GITHUB_SHA"]:
                raise SystemExit("New artifact does not identify this master commit")
            if previous.pop("commit") != os.environ["TURBOIMS_BASELINE_COMMIT"]:
                raise SystemExit("Baseline artifact does not identify the validated feature commit")
            if fresh != previous:
                raise SystemExit("Build metadata changed beyond the source commit")
            metadata_changes.append(name + " (source commit only)")
        elif name == "README.md":
            if a != b.replace(b"FLASHABLE-", b""):
                raise SystemExit("Bundled README changed beyond artifact naming")
            metadata_changes.append(name + " (artifact naming only)")
        elif a != b:
            raise SystemExit("Promotion payload differs: " + name)
        else:
            matched.append(name)
    runner_digest = hashlib.sha256(new.read("runner.apk")).hexdigest()

summary = f"""
### Master promotion payload verified

Compared this downloaded module with the last successful feature build
{os.environ['TURBOIMS_BASELINE_COMMIT']} (artifact {os.environ['TURBOIMS_BASELINE_ARTIFACT_ID']}).

- Version remains **1.0.0**.
- **{len(matched)} files are byte-for-byte identical**, including WebUI, module scripts,
  configuration defaults, module.prop, runner.apk and runner.sha256.
- Expected differences: {', '.join(metadata_changes)}.
- Runner SHA-256: {runner_digest}.
- ZIP container timestamps, compression and download filename are not module-content differences.
"""
print(summary)
if os.environ.get("GITHUB_STEP_SUMMARY"):
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
        output.write(summary)
