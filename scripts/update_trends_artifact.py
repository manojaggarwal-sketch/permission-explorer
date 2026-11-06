#!/usr/bin/env python3
"""Regenerate RUN_HISTORY in the pe-record-count-trends artifact -> PermissionExplorer/pe_trends_updated.html"""
import json, re, sys
H = "/Users/manoj.aggarwal/Documents/Cowork/PermissionExplorer/bundles/run_history.jsonl"
A = sys.argv[1] if len(sys.argv) > 1 else "/Users/manoj.aggarwal/Claude/Artifacts/pe-record-count-trends/index.html"
rows = [json.loads(l) for l in open(H) if l.strip()]
js = "[\n  " + ",\n  ".join(json.dumps(r) for r in rows) + "\n]"
html = open(A).read()
new = re.sub(r"const RUN_HISTORY = \[[\s\S]*?\];", lambda m: "const RUN_HISTORY = " + js + ";", html, count=1)
open("/Users/manoj.aggarwal/Documents/Cowork/PermissionExplorer/pe_trends_updated.html", "w").write(new)
print(len(rows), "rows; changed:", new != html)
