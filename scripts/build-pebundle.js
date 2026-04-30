#!/usr/bin/env node
// scripts/build-pebundle.js
//
// Read 13 staged JSONL files (one JSON row per line) produced by the weekly
// scheduled task, then write 13 CSVs and a single gzipped .pebundle into the
// output directory. Atomic rotation: build everything in a temp dir first,
// then delete prior *.csv / *.pebundle files in --out and move the new files
// into place. No npm deps.
//
// Usage:
//   node scripts/build-pebundle.js \
//     --stage /tmp/permission-explorer-stage \
//     --out   /Users/manoj.aggarwal/Documents/Cowork/PermissionExplorer/bundles \
//     --source-org bullhorn \
//     --app-version 2026-04-v3.0
//
// Exit codes:
//   0 = bundle written
//   1 = bad arguments
//   2 = stage dir missing or empty
//   3 = at least one expected stage file missing or unreadable
//   4 = atomic rotation failed (bundle may be partially in place; check --out)
//
// The script does NOT call Salesforce. It only reshapes and packages data the
// caller has already fetched. Keeping fetch and packaging separate means a
// failed pagination loop loses at most one key's staging file, never the
// whole bundle.

"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

// The 13 datasets, in the same order and with the same keys as FILES[] in
// PermissionExplorer.jsx. The CSV filename mirrors the JSX FILES[].filename.
const DATASETS = [
  { key: "Profile",                     csv: "Profile.csv" },
  { key: "PermissionSet",               csv: "PermissionSet.csv" },
  { key: "PermissionSetGroup",          csv: "PermissionSetGroup.csv" },
  { key: "User",                        csv: "User.csv" },
  { key: "UserRole",                    csv: "UserRole.csv" },
  { key: "PermissionSetAssignment",     csv: "PermissionSetAssignment.csv" },
  { key: "PermissionSetGroupComponent", csv: "PermissionSetGroupComponent.csv" },
  { key: "ObjectPermissions",           csv: "ObjectPermissions.csv" },
  { key: "FieldPermissions",            csv: "FieldPermissions.csv" },
  { key: "PermissionSetTabSetting",     csv: "PermissionSetTabSetting.csv" },
  { key: "SetupEntityAccess",           csv: "SetupEntityAccess.csv" },
  { key: "CustomPermission",            csv: "CustomPermission.csv" },
  { key: "SystemPermissions_PermSet",   csv: "SystemPermissions_PermSet.csv" },
];

// ---------- arg parsing ----------
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith("--")) die(1, `Unexpected positional argument: ${flag}`);
    const name = flag.slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith("--")) die(1, `Missing value for ${flag}`);
    args[name] = val;
    i++;
  }
  for (const k of ["stage", "out", "source-org", "app-version"]) {
    if (!args[k]) die(1, `Missing required flag --${k}`);
  }
  return args;
}
function die(code, msg) { process.stderr.write(msg + "\n"); process.exit(code); }

// ---------- staging input ----------
function readJsonl(filepath) {
  // Streams unnecessary for our row counts (a few hundred k max). Read whole
  // file, split on \n, parse each non-empty line. Tolerates a trailing \n.
  const raw = fs.readFileSync(filepath, "utf8");
  const rows = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    rows.push(JSON.parse(t));
  }
  return rows;
}

// Per-dataset deduplication: if the staged rows include an `Id` column (which
// the cursor pagination will always add), we de-dup on it. Prevents duplicate
// rows from a re-run that didn't fully clean staging. Datasets without `Id`
// (none of ours, but defensive) pass through.
function dedupe(rows) {
  if (!rows.length || rows[0].Id === undefined) return rows;
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (seen.has(r.Id)) continue;
    seen.add(r.Id);
    out.push(r);
  }
  return out;
}

// ---------- CSV writer ----------
const NEEDS_QUOTING = /[",\n\r]/;
function csvEscape(v) {
  if (v == null) return "";
  const s = typeof v === "string" ? v : String(v);
  return NEEDS_QUOTING.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function writeCsv(filepath, rows) {
  if (!rows.length) {
    // Write an empty file so downstream tools see the slot exists.
    fs.writeFileSync(filepath, "");
    return { rows: 0, bytes: 0 };
  }
  // Schema is the union of keys across rows, in first-seen order. Salesforce
  // SOQL responses are usually shape-stable per query, so this is normally
  // just Object.keys(rows[0]).
  const cols = [];
  const seen = new Set();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) { seen.add(k); cols.push(k); }
    }
  }
  const lines = [cols.join(",")];
  for (const r of rows) {
    lines.push(cols.map(c => csvEscape(r[c])).join(","));
  }
  const text = lines.join("\n") + "\n";
  fs.writeFileSync(filepath, text);
  return { rows: rows.length, bytes: Buffer.byteLength(text) };
}

// ---------- pebundle ----------
function buildPebundle(byKey, sourceOrg, appVersion) {
  const datasets = {};
  for (const d of DATASETS) {
    const rows = byKey[d.key] || [];
    datasets[d.key] = {
      rows,
      schema: rows.length ? Object.keys(rows[0]) : [],
    };
  }
  return {
    format: "pebundle",
    version: 1,
    createdAt: new Date().toISOString(),
    sourceOrg,
    appVersion,
    datasets,
    dismissals: [],
  };
}
function gzipSync(buffer) {
  return zlib.gzipSync(buffer, { level: 9 });
}

// ---------- atomic rotation ----------
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function clearPriorOutputs(outDir) {
  const removed = [];
  for (const name of fs.readdirSync(outDir)) {
    if (name.endsWith(".csv") || name.endsWith(".pebundle") || name === "LAST_RUN_ERROR.txt") {
      const p = path.join(outDir, name);
      fs.unlinkSync(p);
      removed.push(name);
    }
  }
  return removed;
}

function moveAll(srcDir, dstDir) {
  const moved = [];
  for (const name of fs.readdirSync(srcDir)) {
    const from = path.join(srcDir, name);
    const to = path.join(dstDir, name);
    fs.renameSync(from, to);
    moved.push(name);
  }
  return moved;
}

// ---------- main ----------
function main() {
  const args = parseArgs(process.argv);
  const stageDir = path.resolve(args.stage);
  const outDir = path.resolve(args.out);
  const sourceOrg = args["source-org"];
  const appVersion = args["app-version"];

  if (!fs.existsSync(stageDir) || !fs.statSync(stageDir).isDirectory()) {
    die(2, `Stage directory does not exist: ${stageDir}`);
  }

  ensureDir(outDir);

  // 1. Read staged rows for all 13 datasets.
  const byKey = {};
  const counts = {};
  const missing = [];
  for (const d of DATASETS) {
    const sp = path.join(stageDir, d.key + ".jsonl");
    if (!fs.existsSync(sp)) { missing.push(d.key); byKey[d.key] = []; counts[d.key] = 0; continue; }
    let rows;
    try { rows = readJsonl(sp); }
    catch (err) { die(3, `Failed to parse ${sp}: ${err.message}`); }
    rows = dedupe(rows);
    byKey[d.key] = rows;
    counts[d.key] = rows.length;
  }
  if (missing.length === DATASETS.length) {
    die(2, `Stage directory is empty: ${stageDir}`);
  }
  if (missing.length) {
    process.stderr.write(`WARN: missing staging files for: ${missing.join(", ")} — those slots will be empty in the bundle.\n`);
  }

  // 2. Build CSVs + pebundle in a temp dir under --out.
  const stamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 13); // YYYYMMDDTHHMM
  const tempDir = path.join(outDir, `.tmp-${stamp}-${crypto.randomBytes(4).toString("hex")}`);
  ensureDir(tempDir);

  const csvStats = {};
  for (const d of DATASETS) {
    csvStats[d.key] = writeCsv(path.join(tempDir, d.csv), byKey[d.key]);
  }

  const bundle = buildPebundle(byKey, sourceOrg, appVersion);
  const gz = gzipSync(Buffer.from(JSON.stringify(bundle)));
  const pad = n => String(n).padStart(2, "0");
  const now = new Date();
  const bundleName = `permission-explorer_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.pebundle`;
  fs.writeFileSync(path.join(tempDir, bundleName), gz);

  // 3. Atomic rotation.
  let removed, moved;
  try {
    removed = clearPriorOutputs(outDir);
    moved = moveAll(tempDir, outDir);
    fs.rmdirSync(tempDir);
  } catch (err) {
    die(4, `Atomic rotation failed: ${err.message}. Inspect ${outDir} and ${tempDir} manually.`);
  }

  // 4. Summary.
  const sizes = moved.map(n => {
    const st = fs.statSync(path.join(outDir, n));
    return { name: n, kb: (st.size / 1024).toFixed(1) };
  });
  const totalRows = Object.values(counts).reduce((n, v) => n + v, 0);
  const summary = {
    org: sourceOrg,
    appVersion,
    bundleName,
    bundleSizeMB: (gz.length / (1024 * 1024)).toFixed(2),
    totalRows,
    rowsPerDataset: counts,
    priorOutputsRemoved: removed,
    outputsWritten: sizes,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}

main();
