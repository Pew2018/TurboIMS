"""Keep test results visible without presenting a second non-installable ZIP."""
import os
from pathlib import Path
import xml.etree.ElementTree as ET

files = sorted(Path("root-runner/build/test-results").rglob("TEST-*.xml"))
totals = {key: 0 for key in ("tests", "failures", "errors", "skipped")}
for file in files:
    suite = ET.parse(file).getroot()
    for key in totals:
        totals[key] += int(suite.get(key, "0"))
summary = "\n### Java regression tests\n\n"
summary += str(totals) + "\n" if files else "Reports unavailable; inspect the build log.\n"
with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
    output.write(summary)
