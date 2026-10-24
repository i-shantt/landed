#!/usr/bin/env python3
"""Bundles eval/scenarios/*.yaml into web/convex/scenarioData.json for the in-app judge runner."""
import yaml, json, glob, os
HERE = os.path.dirname(os.path.abspath(__file__))
out = [yaml.safe_load(open(f)) for f in sorted(glob.glob(os.path.join(HERE, "..", "eval", "scenarios", "*.yaml")))]
json.dump(out, open(os.path.join(HERE, "..", "web", "convex", "scenarioData.json"), "w"), separators=(",", ":"))
print(f"bundled {len(out)} scenarios")
