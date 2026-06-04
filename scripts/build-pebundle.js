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
//   5 = row-count contiguity check failed (a dataset is short vs its COUNT();
//       likely silent connector truncation — bundle NOT written)
//
// Contiguity / truncation guard:
//   The Salesforce connector can silently drop rows from the middle of a large
//   result while still reporting done:true and a plausible record count. To
//   catch this, the fetch step writes EXPECTED_COUNTS.json into the stage dir,
//   mapping each dataset key to its authoritative SOQL COUNT(). This script
//   compares staged rows against that count and ABORTS (exit 5) on any shortfall
//   beyond a dataset's documented allowance, so a truncated fetch fails loudly
//   instead of shipping a short bundle. If EXPECTED_COUNTS.json is absent the
//   check is skipped with a warning (back-compat), but the weekly task should
//   always write it.
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

// ---------- contiguity / truncation guard ----------
//
// Documented allowances: COUNT() can legitimately exceed the queryable row set
// for objects with profile-owned / implicit rows the query API does not return.
// For these, COUNT() - stagedRows up to `allowance` is EXPECTED, not an error.
// Any shortfall BEYOND the allowance is treated as truncation and aborts.
//
//   PermissionSetTabSetting: COUNT() tallies ~2,630 profile-owned/implicit rows
//   the query API never returns (verified 2026-06: COUNT()=16,034 vs queryable
//   13,404). Allowance set with headroom; tighten if the org's profile count
//   changes materially.
const KNOWN_COUNT_ALLOWANCES = {
  PermissionSetTabSetting: 2800,
};

// Read optional EXPECTED_COUNTS.json from the stage dir. Shape:
//   { "PermissionSetTabSetting": 16034, "ObjectPermissions": 41234, ... }
// Returns null if absent.
function readExpectedCounts(stageDir) {
  const p = path.join(stageDir, "EXPECTED_COUNTS.json");
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (err) { die(3, `Failed to parse ${p}: ${err.message}`); }
}

// Compare staged row counts against authoritative COUNT()s. Aborts (exit 5) on
// any shortfall beyond a documented allowance. Surplus (staged > expected) is
// allowed — it can't be truncation — but is reported as a warning since it may
// signal stale staging not fully cleaned before a re-run.
function assertContiguity(counts, expected) {
  if (!expected) {
    process.stderr.write("WARN: EXPECTED_COUNTS.json absent — skipping truncation guard. The weekly task should write it.\n");
    return;
  }
  const failures = [];
  for (const d of DATASETS) {
    if (expected[d.key] === undefined) continue; // no authoritative count for this slot
    const exp = expected[d.key];
    const got = counts[d.key] || 0;
    const allowance = KNOWN_COUNT_ALLOWANCES[d.key] || 0;
    const shortfall = exp - got;
    if (shortfall > allowance) {
      failures.push(`  ${d.key}: staged ${got} but COUNT()=${exp} (shortfall ${shortfall}, allowance ${allowance}) — likely truncation`);
    } else if (got > exp) {
      process.stderr.write(`WARN: ${d.key} staged ${got} > COUNT()=${exp}; possible stale staging from an unclean re-run.\n`);
    }
  }
  if (failures.length) {
    die(5, "Row-count contiguity check FAILED — bundle NOT written:\n" + failures.join("\n") +
      "\nRe-fetch the affected dataset(s) (export large objects to CSV if SOQL paging truncates).");
  }
}

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

// Salesforce REST returns relationship fields as nested objects:
//   { "Id": "...", "Profile": { "attributes": {...}, "Name": "Sales" } }
// The artifact's CSVs and the pebundle importer expect flattened keys with
// dot-paths (e.g. "Profile.Name"). Flatten one level deep — none of our
// queries traverse deeper. Also strip the Salesforce `attributes` metadata
// blob that ships on every row and every nested record.
function flattenRow(r) {
  const out = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === "attributes") continue;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      // Nested relationship object — flatten one level.
      for (const [k2, v2] of Object.entries(v)) {
        if (k2 === "attributes") continue;
        // Defensive: if a nested value is itself an object (rare), stringify
        // rather than crash. Our 13 queries don't trigger this.
        out[`${k}.${k2}`] = (v2 !== null && typeof v2 === "object") ? JSON.stringify(v2) : v2;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
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
    rows = rows.map(flattenRow);
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

  // 1b. Truncation guard — abort before writing anything if any dataset is
  //     short of its authoritative COUNT() beyond a documented allowance.
  assertContiguity(counts, readExpectedCounts(stageDir));

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
