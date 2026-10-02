"""Describe exactly which download is installable, with the downloaded ZIP checksum."""
import hashlib
import os
from pathlib import Path
import sys
from verify_module import validate

archive = Path(sys.argv[1])
result = validate(archive)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
name = os.environ["TURBOIMS_ARTIFACT_NAME"]
summary = f"""
### Verified install download

Download **{name}.zip** from this run's Artifacts and select it directly in KernelSU Next.
**No extraction or inner ZIP selection is needed.** Test reports are in the build summary/log.
The actual downloaded ZIP passed root module.prop validation and the BusyBox customize.sh smoke.
Device Binder/SELinux/IMS behavior still requires a real-device test.

- Module version: {result['version']}
- Downloaded archive SHA-256: {digest}
- Runner SHA-256: {result['runner_sha256']}
"""
with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
    output.write(summary)
