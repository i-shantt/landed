#!/usr/bin/env python3
"""Bundles eval/scenarios/*.yaml into web/convex/scenarioData.json for the in-app judge runner."""
import yaml, json, glob, os, base64
HERE = os.path.dirname(os.path.abspath(__file__))
out = [yaml.safe_load(open(f)) for f in sorted(glob.glob(os.path.join(HERE, "..", "eval", "scenarios", "*.yaml")))]
# The in-app runner cannot read files: embed any referenced fixture PDF as base64.
for spec in out:
    for step in spec["steps"]:
        inj = step.get("inject")
        if isinstance(inj, dict) and inj.get("attachmentPdf"):
            path = os.path.join(HERE, "..", "fixtures", inj["attachmentPdf"])
            inj["attachmentPdfBase64"] = base64.b64encode(open(path, "rb").read()).decode()
json.dump(out, open(os.path.join(HERE, "..", "web", "convex", "scenarioData.json"), "w"), separators=(",", ":"))
print(f"bundled {len(out)} scenarios")
