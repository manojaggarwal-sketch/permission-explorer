/*
  Salesforce Permission Explorer
  Version: 2026-04-v3.0
  Claude.ai artifact — single file, default export.

  v3.0 (breaking) adds:
    - CSV-only data flow. The runtime no longer fetches a repo-hosted
      snapshot. On first load there is no dataset; only the Admin tab is
      reachable. The user populates data by uploading the 13 CSVs (one per
      Required Export Query in §5.1) or by importing a .pebundle generated
      by the weekly Cowork scheduled task.
    - IndexedDB pebundle cache ("save state"). After a successful CSV
      upload batch or .pebundle import, the parsed dataset is silently
      written to IndexedDB as a gzipped pebundle blob. Subsequent sessions
      boot from cache in well under a second — no re-upload required.
      A "Clear cached data" button in Admin wipes the cache.
    - Stale warning. If the cache timestamp is older than CACHE_STALE_DAYS
      (14), boot surfaces a yellow banner prompting a refresh.
    - Removed: GITHUB_SNAPSHOT_* constants, fetchGithubSnapshot, the boot
      fetch useEffect, the source==='github' badge branch, the repo
      snapshot pipeline (data/snapshot.json, scripts/bake-snapshot.js,
      docs/BAKE.md, mcp-seed/). See README.md for the new flow.

  v2.8 adds:
    - UX-53: Dynamic width — top-level page containers drop the 1680-px cap
             and consume the full browser viewport (minus sidebar + right
             panel), with fluid side padding that scales up on very wide
             displays. Prose/help blocks constrain to ~130ch; data tables
             remain full-width. Supersedes UX-18's fixed 1680 cap.
    - UX-54: Embedded fallback seeded from real Salesforce data via MCP at
             build time (superseded in v2.9 by repo-hosted snapshot.json).
    - BUG-15: Profile detail (third re-open of BUG-5 / BUG-8). Profile-direct
             Permissions* booleans from Profile.csv are now surfaced even if
             they are not present in SystemPermissions_PermSet.csv; the
             System-perms sub-section de-duplicates across Profile-direct +
             Implicit-PS sources and labels each row with its source
             (Profile / Implicit PS / both). Objects and Fields use a
             legacy-fan-out fallback (`ParentId = Profile.Id`) in addition
             to the implicit-PS fan-out. A debug toggle on Profile detail
             dumps a diagnostics payload (per-fanout row counts, Profile
             booleans, implicit PS id); zero-count sub-section headers link
             back to the diagnostics.

  v2.7 adds:
    - BUG-11: "Granted by" columns resolve source Ids to Profile/PermSet/Group
              name + kind pill; raw Id only on hover (GrantSourceCell).
    - BUG-12: Object → Field cascade wired end-to-end via AppStateContext.
              Selected Object row is visually sticky; scope pill appears above
              Fields sub-section and can be cleared.
    - BUG-13: Impact Matrix Total sort toggles DESC → ASC → unsorted with an
              arrow indicator (▼ / ▲).
    - BUG-14: Change User Profile loss calc now uses Profile-vs-Profile baseline
              (keeps PermSet assignments fixed) and fans out both profiles
              through their implicit PermSets. Debug panel shows per-(object,
              bit) Before / After / Classification rows.
    - UX-47: Prescribe Access view — "what PermSet should I assign?". Ranks
             candidates by least-privilege; proposes combinations via greedy
             set-cover; shows side-effect diff.
    - UX-48: Effective Fields drops Object column when cascade active; groups
             by Object when cascade off; truncates long field names.
    - UX-49: × Clear affordance + Escape key on Delete-PermSet-Entirely search.
    - UX-50: Renamed "Modify Profile" → "Change User Profile" in nav + header
             + exports.
    - UX-51: Subset relationships expand to show substantive extras grouped by
             category (Objects, Fields, System, Setup Entity); zero-extras
             relationships auto-reclassified as Duplicate; CSV export.
    - UX-52: Paired two-column diff labeling (Has / Missing / Shared / Differs)
             with a visible legend; eliminates "only in X" phrasing.

  Previous v2.6: BUG-8/9/10, UX-18..46 (wider layout, Load All Computations,
  session-persistent selections, Reconcile workflow, hide zero-grant objects,
  Profile→LastLogin ASC sort, compact GrantPillCell, PermSet Coverage Report,
  Impact Matrix 3-filter, suggestion typeahead, cross-links, per-row covering
  sources, severity flags, Delete-PermSet above the fold, "Future profile"
  rename, side-by-side Objects/Fields/System diff, Revoke Field description,
  Overlap/Migration block descriptions, Duplicate definition, Near-duplicate
  block, Compare Profiles in Migration, cluster pairwise matrix, Admin
  notices Reason+Fix+Tag, removed embedded snapshot).

  Previous v2.5: BUG-1..7 fixes, UX-1..17 enhancements, main ACs 1..23. 13 CSV
  datasets, bundle export/import (.pebundle, CompressionStream), document.execCommand
  copy fallback, no splash, direct-to-explorer load. 7-entry-point explorer
  (User/Profile/PermSet/PermSet Group/Object/Field/Role). 4 Change Impact scenarios
  with typeahead selectors and UX-14 precompute. Redundancy + migration planning
  (Jaccard), dismissals in bundle.
*/

import React, { useState, useMemo, useEffect, useRef, useCallback, createContext, useContext } from "react";

/* ============================================================================
 * 1. DESIGN TOKENS (Section 4.1) + typography (4.2)
 * ==========================================================================*/
const T = {
  bg: "#0a0e1a",
  bgAlt: "#0f1526",
  card: "#151c2e",
  cardHover: "#1a2338",
  border: "#1e2a42",
  borderActive: "#4f8bff",
  text: "#e8ecf4",
  textMuted: "#8896b0",
  textDim: "#5a6a86",
  accent: "#4f8bff",
  accentLight: "#7cacff",
  accentBg: "rgba(79,139,255,0.08)",
  green: "#34d399",
  greenBg: "rgba(52,211,153,0.08)",
  greenBorder: "rgba(52,211,153,0.2)",
  red: "#f87171",
  redBg: "rgba(248,113,113,0.08)",
  yellow: "#fbbf24",
  yellowBg: "rgba(251,191,36,0.08)",
  purple: "#c084fc",
  purpleBg: "rgba(192,132,252,0.08)",
  cyan: "#22d3ee",
  cyanBg: "rgba(34,211,238,0.08)",
  orange: "#fb923c",
  orangeBg: "rgba(251,146,60,0.08)",
  glow: "0 0 40px rgba(79,139,255,0.06)",
  font: "'Geist','SF Pro Display',system-ui,-apple-system,sans-serif",
  mono: "'JetBrains Mono','SF Mono',monospace",
};

/* ============================================================================
 * 2. HELPERS
 * ==========================================================================*/

// Copy to clipboard using the iframe-sandbox-safe execCommand pattern (2.3).
function copyText(text, setCopied, key) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  } catch {}
}

// Minimal RFC4180-ish CSV parser — tolerates quoted fields with embedded
// commas / newlines / escaped quotes. Returns { headers, rows } where rows
// are objects keyed by header.
function parseCSV(text) {
  const out = [];
  let row = [];
  let cur = "";
  let inQ = false;
  const t = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQ) {
      if (c === '"') {
        if (t[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); out.push(row); row = []; cur = ""; }
      else if (c === "\r") {/* skip */}
      else cur += c;
    }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); out.push(row); }
  if (!out.length) return { headers: [], rows: [] };
  const headers = out[0].map(h => h.trim());
  const rows = [];
  for (let i = 1; i < out.length; i++) {
    const r = out[i];
    if (r.length === 1 && r[0] === "") continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = r[j] ?? "";
    rows.push(obj);
  }
  return { headers, rows };
}

// Normalise CSV boolean-ish values ("true","1","TRUE") to real booleans.
const toBool = v => v === true || v === "true" || v === "TRUE" || v === "1" || v === 1;

// Friendly relative time (for "imported N min ago" badges).
function ago(ts) {
  if (!ts) return "";
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Download a Blob with a given filename.
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Stream-based gzip using CompressionStream (Section 8.4).
async function gzipJSON(obj) {
  const json = JSON.stringify(obj);
  const enc = new TextEncoder().encode(json);
  if (typeof CompressionStream === "undefined") {
    // Fallback — still ship a valid .pebundle, just uncompressed.
    return new Blob([enc], { type: "application/octet-stream" });
  }
  const cs = new CompressionStream("gzip");
  const stream = new Blob([enc]).stream().pipeThrough(cs);
  return await new Response(stream).blob();
}
async function gunzipJSON(blob) {
  const buf = await blob.arrayBuffer();
  if (typeof DecompressionStream === "undefined") {
    const txt = new TextDecoder().decode(new Uint8Array(buf));
    return JSON.parse(txt);
  }
  // Try gzip first; if it fails, assume plain JSON (fallback path).
  try {
    const ds = new DecompressionStream("gzip");
    const stream = new Blob([buf]).stream().pipeThrough(ds);
    const text = await new Response(stream).text();
    return JSON.parse(text);
  } catch {
    const txt = new TextDecoder().decode(new Uint8Array(buf));
    return JSON.parse(txt);
  }
}

// Export an array of row objects to CSV. Used by "Export to CSV" buttons (AC-21).
function rowsToCSV(rows, columns) {
  if (!rows || !rows.length) return "";
  const cols = columns || Object.keys(rows[0]);
  const esc = v => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n");
}

/* ============================================================================
 * 3. SOQL QUERIES (Section 5.1)
 * ==========================================================================*/
const SOQL = {
  profile:
    "SELECT Id, Name, UserType, Description, PermissionsModifyAllData, PermissionsViewAllData, PermissionsApiEnabled, PermissionsAuthorApex, UserLicense.Name, LastModifiedDate FROM Profile ORDER BY Name",
  // BUG-8 v2.6: must load implicit profile-owned PermissionSets to join Profile->ObjectPermissions.
  // Query is unfiltered; index builder splits implicit (IsOwnedByProfile=true) from regular.
  permissionSet:
    "SELECT Id, Name, Label, Description, IsCustom, Type, IsOwnedByProfile, ProfileId FROM PermissionSet ORDER BY Label",
  permissionSetGroup:
    "SELECT Id, DeveloperName, MasterLabel, Description FROM PermissionSetGroup ORDER BY MasterLabel",
  user:
    "SELECT Id, Name, Email, Profile.Name, ProfileId, UserRoleId, LastLoginDate FROM User WHERE UserType = 'Standard' AND IsActive = true ORDER BY Name",
  userRole:
    "SELECT Id, Name, DeveloperName, ParentRoleId, PortalType FROM UserRole WHERE PortalType = null ORDER BY Name",
  psa:
    "SELECT PermissionSet.Id, PermissionSet.Name, PermissionSet.Label, PermissionSet.IsOwnedByProfile, PermissionSet.Type, PermissionSetGroupId, AssigneeId FROM PermissionSetAssignment WHERE Assignee.IsActive = true AND Assignee.UserType = 'Standard' ORDER BY AssigneeId",
  psgc:
    "SELECT PermissionSetId, PermissionSet.Name, PermissionSetGroupId, PermissionSetGroup.MasterLabel FROM PermissionSetGroupComponent ORDER BY PermissionSetGroup.MasterLabel",
  objectPerms:
    "SELECT SobjectType, PermissionsCreate, PermissionsRead, PermissionsEdit, PermissionsDelete, PermissionsViewAllRecords, PermissionsModifyAllRecords, ParentId, Parent.Name, Parent.IsOwnedByProfile, Parent.ProfileId FROM ObjectPermissions ORDER BY SobjectType",
  fieldPerms:
    "SELECT Field, SobjectType, PermissionsRead, PermissionsEdit, ParentId, Parent.Name, Parent.IsOwnedByProfile, Parent.ProfileId FROM FieldPermissions ORDER BY SobjectType, Field",
  tabs:
    "SELECT Name, Visibility, ParentId, Parent.Name FROM PermissionSetTabSetting ORDER BY Parent.Name, Name",
  setup:
    "SELECT SetupEntityId, SetupEntityType, ParentId, Parent.Name FROM SetupEntityAccess WHERE SetupEntityType IN ('ApexClass','ApexPage','CustomPermission','TabSet') ORDER BY Parent.Name, SetupEntityType",
  customPerm:
    "SELECT Id, DeveloperName, MasterLabel FROM CustomPermission ORDER BY MasterLabel",
  sysPerms:
    "SELECT Id, Name, Label, PermissionsModifyAllData, PermissionsViewAllData, PermissionsManageUsers, PermissionsAuthorApex, PermissionsCustomizeApplication, PermissionsManageCustomPermissions, PermissionsApiEnabled, PermissionsBulkApiHardDelete, PermissionsDataExport, PermissionsViewSetup, PermissionsManageRoles, PermissionsRunReports FROM PermissionSet WHERE IsOwnedByProfile = false ORDER BY Label",
};

// One row per required file (Section 3.3). Mirrors the Admin-tab card list.
const FILES = [
  { key: "Profile",                     n: 1,  label: "Profiles",                          filename: "Profile.csv",                      soql: SOQL.profile,            required: ["Id","Name"],                           idField: "Id" },
  { key: "PermissionSet",               n: 2,  label: "Permission Sets",                   filename: "PermissionSet.csv",                soql: SOQL.permissionSet,      required: ["Id","Label"],                          idField: "Id" },
  { key: "PermissionSetGroup",          n: 3,  label: "Permission Set Groups",             filename: "PermissionSetGroup.csv",           soql: SOQL.permissionSetGroup, required: ["Id","MasterLabel"],                    idField: "Id" },
  { key: "User",                        n: 4,  label: "Standard Users",                    filename: "User.csv",                         soql: SOQL.user,               required: ["Id","Name"],                           idField: "Id" },
  { key: "UserRole",                    n: 5,  label: "User Roles",                        filename: "UserRole.csv",                     soql: SOQL.userRole,           required: ["Id","Name"],                           idField: "Id" },
  { key: "PermissionSetAssignment",     n: 6,  label: "Permission Set Assignments",        filename: "PermissionSetAssignment.csv",      soql: SOQL.psa,                required: ["AssigneeId"],                          idField: null },
  { key: "PermissionSetGroupComponent", n: 7,  label: "Permission Set Group Members",      filename: "PermissionSetGroupComponent.csv",  soql: SOQL.psgc,               required: ["PermissionSetId","PermissionSetGroupId"], idField: null },
  { key: "ObjectPermissions",           n: 8,  label: "Object Permissions",                filename: "ObjectPermissions.csv",            soql: SOQL.objectPerms,        required: ["SobjectType","ParentId"],              idField: null },
  { key: "FieldPermissions",            n: 9,  label: "Field Permissions",                 filename: "FieldPermissions.csv",             soql: SOQL.fieldPerms,         required: ["Field","SobjectType","ParentId"],      idField: null },
  { key: "PermissionSetTabSetting",     n: 10, label: "Tab Settings",                      filename: "PermissionSetTabSetting.csv",      soql: SOQL.tabs,               required: ["Name","ParentId"],                     idField: null },
  { key: "SetupEntityAccess",           n: 11, label: "Setup Entity Access (Apex/VF/Custom/App)", filename: "SetupEntityAccess.csv",     soql: SOQL.setup,              required: ["SetupEntityId","SetupEntityType","ParentId"], idField: null },
  { key: "CustomPermission",            n: 12, label: "Custom Permissions",                filename: "CustomPermission.csv",             soql: SOQL.customPerm,         required: ["Id","DeveloperName"],                  idField: "Id" },
  { key: "SystemPermissions_PermSet",   n: 13, label: "System Permissions on PermSets",    filename: "SystemPermissions_PermSet.csv",    soql: SOQL.sysPerms,           required: ["Id","Label"],                          idField: "Id" },
];
const FILE_BY_KEY = Object.fromEntries(FILES.map(f => [f.key, f]));

// Expected system-permission columns for Query 13 (tolerant parser — see 5.1).
const SYSPERM_COLS = [
  "PermissionsModifyAllData","PermissionsViewAllData","PermissionsManageUsers",
  "PermissionsAuthorApex","PermissionsCustomizeApplication","PermissionsManageCustomPermissions",
  "PermissionsApiEnabled","PermissionsBulkApiHardDelete","PermissionsDataExport",
  "PermissionsViewSetup","PermissionsManageRoles","PermissionsRunReports",
];

/* ============================================================================
 * 4. DATASET SOURCE — v3.0 CSV-only + IndexedDB cache
 *
 * The artifact never calls Salesforce or any network endpoint at runtime.
 * Data enters the app exclusively through:
 *
 *   1. Per-file CSV upload from the Admin tab (13 slots, one per Required
 *      Export Query in §5.1).
 *   2. .pebundle import from the Admin tab. Pebundles are produced offline
 *      by the weekly Cowork scheduled task that runs the 13 SOQL queries
 *      against the user's Salesforce org and packages the results.
 *
 * After either path completes, the parsed dataset is silently written to
 * IndexedDB as a gzipped pebundle. Subsequent sessions hydrate from this
 * cache on boot — no re-upload, no network. If the cache timestamp is
 * older than CACHE_STALE_DAYS, a yellow banner prompts a refresh.
 *
 * IndexedDB is the only persistence. localStorage is intentionally not
 * used (5 MB cap; some sandboxed iframes block it). If IDB is unavailable
 * (private browsing, kiosk, quota exceeded), boot proceeds with an empty
 * dataset — IDB failure is never fatal.
 * ==========================================================================*/

// Empty dataset skeleton used when no data is loaded.
const EMPTY_DATASETS = {
  Profile: [], PermissionSet: [], PermissionSetGroup: [], User: [], UserRole: [],
  PermissionSetAssignment: [], PermissionSetGroupComponent: [],
  ObjectPermissions: [], FieldPermissions: [], PermissionSetTabSetting: [],
  SetupEntityAccess: [], CustomPermission: [], SystemPermissions_PermSet: [],
};

// Returns true if a datasets object has at least one row in any slot. Used to
// gate the non-Admin tabs.
function datasetsHaveData(d) {
  if (!d) return false;
  for (const k of Object.keys(EMPTY_DATASETS)) {
    if (Array.isArray(d[k]) && d[k].length > 0) return true;
  }
  return false;
}

/* ---- IndexedDB cache layer --------------------------------------------------
 * One database, one object store, one record keyed "current". The stored
 * value is a gzipped pebundle blob plus metadata. We never throw out of these
 * helpers — IDB is best-effort, every method resolves to either a value or
 * null, and the caller falls back to "no cache."
 * --------------------------------------------------------------------------*/
const IDB_DB_NAME = "PermissionExplorer";
const IDB_DB_VERSION = 1;
const IDB_STORE = "cache";
const IDB_KEY = "current";
const CACHE_SCHEMA_VERSION = 1;
const CACHE_STALE_DAYS = 14;

function idbOpen() {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let req;
    try { req = indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION); }
    catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

// Read the cached pebundle. Returns { datasets, dismissals, cachedAt } | null.
async function idbReadCache() {
  const db = await idbOpen();
  if (!db) return null;
  try {
    const blob = await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
    db.close();
    if (!blob) return null;
    // Stored value is { cachedAt, schemaVersion, pebundle: Blob }
    if (typeof blob !== "object" || !blob.pebundle) return null;
    if (blob.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
    const obj = await gunzipJSON(blob.pebundle);
    if (!obj || obj.format !== "pebundle") return null;
    const datasets = {};
    for (const key of Object.keys(EMPTY_DATASETS)) {
      datasets[key] = (obj.datasets && obj.datasets[key] && obj.datasets[key].rows) || [];
    }
    return {
      datasets,
      dismissals: Array.isArray(obj.dismissals) ? obj.dismissals : [],
      cachedAt: blob.cachedAt || obj.createdAt || null,
    };
  } catch {
    try { db.close(); } catch {}
    return null;
  }
}

// Write the current dataset to cache. No-op on failure; never throws.
async function idbWriteCache({ datasets, dismissals }) {
  const db = await idbOpen();
  if (!db) return false;
  try {
    const payload = {
      format: "pebundle",
      version: 1,
      createdAt: new Date().toISOString(),
      sourceOrg: "",
      appVersion: "2026-04-v3.0",
      datasets: Object.fromEntries(FILES.map(f => [f.key, {
        rows: (datasets && datasets[f.key]) || [],
        schema: (datasets && datasets[f.key] && datasets[f.key][0]) ? Object.keys(datasets[f.key][0]) : [],
      }])),
      dismissals: dismissals || [],
    };
    const pebundle = await gzipJSON(payload);
    const record = {
      cachedAt: payload.createdAt,
      schemaVersion: CACHE_SCHEMA_VERSION,
      pebundle,
    };
    await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const req = tx.objectStore(IDB_STORE).put(record, IDB_KEY);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
    db.close();
    return true;
  } catch {
    try { db.close(); } catch {}
    return false;
  }
}

// Clear the cache record.
async function idbClearCache() {
  const db = await idbOpen();
  if (!db) return false;
  try {
    await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const req = tx.objectStore(IDB_STORE).delete(IDB_KEY);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
    db.close();
    return true;
  } catch {
    try { db.close(); } catch {}
    return false;
  }
}

// Days between two ISO timestamps. Returns Infinity if either is unparseable.
function ageInDays(isoTs) {
  if (!isoTs) return Infinity;
  const t = Date.parse(isoTs);
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / (24 * 3600 * 1000);
}

/* ============================================================================
 * 5. INDEX BUILDERS (Section 8.2 effective-permission model + 8.3 indexes)
 * ==========================================================================*/
function buildIndexes(datasets) {
  const warnings = [];

  // --- 1. Maps keyed by ParentId -------------------------------------------
  const objPermsByParent = new Map();
  const fieldPermsByParent = new Map();
  const sysPermsByParent = new Map(); // actually by PermSet.Id (same key)
  const tabsByParent = new Map();
  const setupByParent = new Map();

  const pushMap = (m, k, v) => { const a = m.get(k) || []; a.push(v); m.set(k, a); };

  // ObjectPermissions — UX-10: drop blanks + zero-perm rows, count drops.
  let opBlank = 0, opZero = 0, opKept = 0;
  for (const r of datasets.ObjectPermissions || []) {
    const sobj = (r.SobjectType || "").trim();
    if (!sobj) { opBlank++; continue; }
    const any = toBool(r.PermissionsCreate) || toBool(r.PermissionsRead) ||
      toBool(r.PermissionsEdit) || toBool(r.PermissionsDelete) ||
      toBool(r.PermissionsViewAllRecords) || toBool(r.PermissionsModifyAllRecords);
    if (!any) { opZero++; continue; }
    const norm = {
      SobjectType: sobj,
      ParentId: r.ParentId,
      ParentName: r["Parent.Name"] || "",
      IsOwnedByProfile: toBool(r["Parent.IsOwnedByProfile"]),
      c: toBool(r.PermissionsCreate), r: toBool(r.PermissionsRead),
      e: toBool(r.PermissionsEdit), d: toBool(r.PermissionsDelete),
      va: toBool(r.PermissionsViewAllRecords), ma: toBool(r.PermissionsModifyAllRecords),
    };
    pushMap(objPermsByParent, r.ParentId, norm);
    opKept++;
  }
  if (opBlank) warnings.push({ level: "yellow", file: "ObjectPermissions.csv",
    text: `${opBlank} rows in ObjectPermissions.csv had blank SobjectType and were dropped (UX-10).` });
  if (opZero) warnings.push({ level: "yellow", file: "ObjectPermissions.csv",
    text: `${opZero} zero-permission rows in ObjectPermissions.csv were hidden from the default Object list (toggleable).` });

  // FieldPermissions — UX-10 defence: drop blank SobjectType + zero R/E.
  let fpBlank = 0, fpZero = 0;
  for (const r of datasets.FieldPermissions || []) {
    const sobj = (r.SobjectType || "").trim();
    if (!sobj) { fpBlank++; continue; }
    const read = toBool(r.PermissionsRead), edit = toBool(r.PermissionsEdit);
    if (!read && !edit) { fpZero++; continue; }
    const norm = {
      SobjectType: sobj,
      Field: r.Field || `${sobj}.(unknown)`,
      ParentId: r.ParentId,
      ParentName: r["Parent.Name"] || "",
      IsOwnedByProfile: toBool(r["Parent.IsOwnedByProfile"]),
      read, edit,
    };
    pushMap(fieldPermsByParent, r.ParentId, norm);
  }
  if (fpBlank) warnings.push({ level: "yellow", file: "FieldPermissions.csv",
    text: `${fpBlank} rows in FieldPermissions.csv had blank SobjectType and were dropped (UX-10).` });

  // System permissions — forward-compat: keep all Permissions* columns.
  // BUG-15 v2.8: also scan Profile.csv columns for extras. Profile.csv Query 1
  // returns every Permissions* boolean directly on the Profile row, and some
  // keys (PermissionsChatterInternalUser, PermissionsManageDashbds, etc.)
  // only live there — they are NOT always mirrored into the implicit PS's
  // SystemPermissions rows. Without this scan, Profile-direct booleans are
  // silently dropped.
  const sysPermCols = new Set(SYSPERM_COLS);
  const sysPermsRaw = datasets.SystemPermissions_PermSet || [];
  const profileRowsRaw = datasets.Profile || [];
  const extraCols = new Set();
  const missingCols = new Set(SYSPERM_COLS);
  const extraColsFromProfile = new Set();
  for (const r of sysPermsRaw) {
    for (const k of Object.keys(r)) {
      if (/^Permissions/.test(k)) {
        if (!sysPermCols.has(k)) extraCols.add(k);
        missingCols.delete(k);
      }
    }
  }
  for (const p of profileRowsRaw) {
    for (const k of Object.keys(p)) {
      if (/^Permissions/.test(k) && !sysPermCols.has(k) && !extraCols.has(k)) {
        extraColsFromProfile.add(k);
      }
    }
  }
  // Missing-column warning (non-blocking)
  if (sysPermsRaw.length && missingCols.size) {
    warnings.push({ level: "yellow", file: "SystemPermissions_PermSet.csv",
      text: `Expected column(s) missing — defaulted to false: ${[...missingCols].join(", ")}` });
  }
  if (extraCols.size) {
    warnings.push({ level: "info", file: "SystemPermissions_PermSet.csv",
      text: `Extra column(s) loaded from CSV: ${[...extraCols].join(", ")}` });
  }
  if (extraColsFromProfile.size) {
    warnings.push({ level: "info", file: "Profile.csv",
      text: `BUG-15: extra Permissions* columns detected on Profile.csv and loaded: ${[...extraColsFromProfile].join(", ")}` });
  }
  // allSysCols = hardcoded set ∪ extras-from-system-csv ∪ extras-from-profile-csv.
  const allSysCols = [...SYSPERM_COLS, ...extraCols, ...extraColsFromProfile];
  for (const r of sysPermsRaw) {
    const obj = { ParentId: r.Id, Label: r.Label, Name: r.Name, perms: {} };
    for (const c of allSysCols) obj.perms[c] = toBool(r[c]);
    sysPermsByParent.set(r.Id, obj);
  }
  // Also add profile-level system perms from Profile.csv (Section 6.1 fan-out).
  // BUG-15: this is now the canonical source for Profile system perms; the
  // renderer de-duplicates across this entry and the implicit-PS entry.
  const profileBooleansBySystemPermissionKey = new Map(); // Profile.Id -> Map(permKey -> true)
  for (const p of profileRowsRaw) {
    const obj = { ParentId: p.Id, Label: p.Name, Name: p.Name, perms: {} };
    const directKeys = new Map();
    for (const c of allSysCols) {
      const v = toBool(p[c]);
      obj.perms[c] = v;
      if (v) directKeys.set(c, true);
    }
    sysPermsByParent.set(p.Id, obj);
    profileBooleansBySystemPermissionKey.set(p.Id, directKeys);
  }

  for (const r of datasets.PermissionSetTabSetting || []) {
    pushMap(tabsByParent, r.ParentId, { Name: r.Name, Visibility: r.Visibility, ParentName: r["Parent.Name"] });
  }
  for (const r of datasets.SetupEntityAccess || []) {
    pushMap(setupByParent, r.ParentId, { SetupEntityId: r.SetupEntityId, SetupEntityType: r.SetupEntityType, ParentName: r["Parent.Name"] });
  }

  // --- 2. Object / Field -> grantors -------------------------------------
  const objPermsBySobj = new Map();
  for (const rows of objPermsByParent.values()) for (const row of rows) pushMap(objPermsBySobj, row.SobjectType, row);
  const fieldPermsByField = new Map();
  const fieldPermsBySobj = new Map();
  for (const rows of fieldPermsByParent.values()) for (const row of rows) {
    pushMap(fieldPermsByField, row.Field, row);
    pushMap(fieldPermsBySobj, row.SobjectType, row);
  }

  // --- 3. Group -> member PermSets + assignment indexes ------------------
  const groupMembers = new Map();
  for (const r of datasets.PermissionSetGroupComponent || []) {
    pushMap(groupMembers, r.PermissionSetGroupId, { PermissionSetId: r.PermissionSetId, PermissionSetName: r["PermissionSet.Name"] });
  }
  const psaByUser = new Map();
  const psaByPermSet = new Map();
  const psaByGroup = new Map();
  for (const r of datasets.PermissionSetAssignment || []) {
    const a = {
      PermSetId: r["PermissionSet.Id"] || r.PermissionSetId,
      PermSetName: r["PermissionSet.Name"],
      PermSetLabel: r["PermissionSet.Label"],
      IsOwnedByProfile: toBool(r["PermissionSet.IsOwnedByProfile"]),
      Type: r["PermissionSet.Type"] || "",
      GroupId: r.PermissionSetGroupId || "",
      UserId: r.AssigneeId,
    };
    pushMap(psaByUser, a.UserId, a);
    pushMap(psaByPermSet, a.PermSetId, a);
    if (a.GroupId) pushMap(psaByGroup, a.GroupId, a);
  }

  // --- 4. User / PermSet / Group / Profile lookup Maps -------------------
  const byId = k => new Map((datasets[k] || []).map(r => [r.Id, r]));
  const userById    = byId("User");
  const profileById = byId("Profile");
  const permSetById = byId("PermissionSet");
  const groupById   = byId("PermissionSetGroup");
  const customPermById = byId("CustomPermission");

  // --- 4a. BUG-8 v2.6: Profile → implicit (profile-owned) PermissionSet ---
  // Real Salesforce stores Profile object/field perms with ParentId = implicit PS.Id
  // (the auto-generated PermissionSet where IsOwnedByProfile=true). Build the map
  // from profile.Id → implicit PS.Id so we can fan out profile queries.
  const profileImplicitPsByProfileId = new Map();
  for (const ps of permSetById.values()) {
    if (toBool(ps.IsOwnedByProfile) && ps.ProfileId) {
      profileImplicitPsByProfileId.set(ps.ProfileId, ps.Id);
    }
  }
  // Also discover implicit PS via ObjectPermissions.Parent.ProfileId (fallback path
  // for datasets missing ProfileId on PermissionSet.csv).
  for (const r of datasets.ObjectPermissions || []) {
    const pid = r["Parent.ProfileId"] || r.ParentProfileId;
    if (pid && toBool(r["Parent.IsOwnedByProfile"]) && !profileImplicitPsByProfileId.has(pid)) {
      profileImplicitPsByProfileId.set(pid, r.ParentId);
    }
  }
  for (const r of datasets.FieldPermissions || []) {
    const pid = r["Parent.ProfileId"] || r.ParentProfileId;
    if (pid && toBool(r["Parent.IsOwnedByProfile"]) && !profileImplicitPsByProfileId.has(pid)) {
      profileImplicitPsByProfileId.set(pid, r.ParentId);
    }
  }

  // Role filtering (UX-12 / BUG-9) — defensively drop ANY portal role, even if SOQL filter missed.
  // BUG-9 v2.6: strict — any non-empty PortalType is treated as a portal role and filtered out.
  const rolesRaw = datasets.UserRole || [];
  const isPortal = r => {
    const pt = (r.PortalType || "").trim();
    return pt !== "" && pt !== "None";
  };
  const portalRoles = rolesRaw.filter(isPortal);
  if (portalRoles.length) warnings.push({ level: "yellow", file: "UserRole.csv",
    tag: "warning",
    reason: `${portalRoles.length} role(s) have a non-empty PortalType, indicating portal roles not intended for internal permission analysis.`,
    fix: "Re-run Query 5 with the filter WHERE PortalType = null (or IS NULL) in SOQL and re-upload the file.",
    text: `${portalRoles.length} portal role(s) filtered out of UserRole.csv at load time (BUG-9 / UX-12).` });
  const roles = rolesRaw.filter(r => !isPortal(r));
  const roleById = new Map(roles.map(r => [r.Id, r]));
  const usersByRole = new Map();
  for (const u of datasets.User || []) if (u.UserRoleId) pushMap(usersByRole, u.UserRoleId, u);

  // --- 5. Cross-reference validator --------------------------------------
  const xrefWarnings = [];
  const permSetIds = new Set([...permSetById.keys()]);
  const profileIds = new Set([...profileById.keys()]);
  const groupIds   = new Set([...groupById.keys()]);
  const userIds    = new Set([...userById.keys()]);

  const missingParents = new Map(); // parentId -> count
  for (const parentId of [...objPermsByParent.keys(), ...fieldPermsByParent.keys()]) {
    if (!permSetIds.has(parentId) && !profileIds.has(parentId)) {
      missingParents.set(parentId, (missingParents.get(parentId) || 0) + 1);
    }
  }
  if (missingParents.size)
    xrefWarnings.push({ level: "yellow",
      text: `${missingParents.size} ParentId(s) in ObjectPermissions/FieldPermissions do not match any PermissionSet or Profile.` });

  let missingAssignees = 0;
  for (const a of datasets.PermissionSetAssignment || []) {
    if (a.AssigneeId && !userIds.has(a.AssigneeId)) missingAssignees++;
  }
  if (missingAssignees)
    xrefWarnings.push({ level: "yellow",
      text: `${missingAssignees} PermSetAssignment row(s) reference an AssigneeId not in User.csv (may be inactive or non-standard).` });

  let missingGroupMembers = 0;
  for (const g of datasets.PermissionSetGroupComponent || []) {
    if (!groupIds.has(g.PermissionSetGroupId)) missingGroupMembers++;
    else if (!permSetIds.has(g.PermissionSetId)) missingGroupMembers++;
  }
  if (missingGroupMembers)
    xrefWarnings.push({ level: "yellow",
      text: `${missingGroupMembers} PermissionSetGroupComponent row(s) reference unknown group or permset.` });

  return {
    warnings, xrefWarnings,
    objPermsByParent, fieldPermsByParent, sysPermsByParent, tabsByParent, setupByParent,
    objPermsBySobj, fieldPermsByField, fieldPermsBySobj,
    groupMembers, psaByUser, psaByPermSet, psaByGroup,
    userById, profileById, permSetById, groupById, customPermById, roleById, usersByRole,
    roles, allSysCols,
    profileImplicitPsByProfileId,               // BUG-8 v2.6
    profileBooleansBySystemPermissionKey,       // BUG-15 v2.8
  };
}

// BUG-8 v2.6: for any grantor id, return [id, implicitPsId?] so profile lookups
// also resolve object/field permissions that live under the implicit PermissionSet.
function profileFanoutIds(idx, parentId) {
  const implicit = idx.profileImplicitPsByProfileId && idx.profileImplicitPsByProfileId.get(parentId);
  return implicit ? [parentId, implicit] : [parentId];
}

/* ============================================================================
 * 6. EFFECTIVE PERMISSION RESOLVER (Section 8.2)
 *    Per-user union of profile + assigned permsets + group-member permsets,
 *    then apply muting-permset subtractions.
 * ==========================================================================*/

// For a user, return ordered list of sources:
//   [{kind:'profile'|'permset'|'groupmember'|'muting', id, label, groupId, groupLabel}]
function userSources(idx, userId) {
  const u = idx.userById.get(userId);
  const out = [];
  if (!u) return out;
  if (u.ProfileId) {
    const p = idx.profileById.get(u.ProfileId);
    out.push({ kind: "profile", id: u.ProfileId, label: (p && p.Name) || u["Profile.Name"] || u.ProfileId });
  }
  const seenPs = new Set();
  const assigns = idx.psaByUser.get(userId) || [];
  for (const a of assigns) {
    if (seenPs.has(a.PermSetId + "|" + (a.GroupId||""))) continue;
    seenPs.add(a.PermSetId + "|" + (a.GroupId||""));
    const ps = idx.permSetById.get(a.PermSetId);
    const label = (ps && ps.Label) || a.PermSetLabel || a.PermSetName || a.PermSetId;
    const psType = (ps && ps.Type) || a.Type || "Regular";
    if (a.GroupId) {
      const g = idx.groupById.get(a.GroupId);
      const gLabel = (g && g.MasterLabel) || a.GroupId;
      if (psType === "Muting") out.push({ kind: "muting", id: a.PermSetId, label, groupId: a.GroupId, groupLabel: gLabel });
      else                     out.push({ kind: "groupmember", id: a.PermSetId, label, groupId: a.GroupId, groupLabel: gLabel });
    } else {
      out.push({ kind: "permset", id: a.PermSetId, label });
    }
  }
  return out;
}

// Effective object-level perms for a user: returns Map(sobj -> {c,r,e,d,va,ma, sources:{c:[],r:[]...}})
function effectiveObjects(idx, userId) {
  const srcs = userSources(idx, userId);
  const grant = new Map();
  const mute = new Map();

  for (const s of srcs) {
    // BUG-8 v2.6: profile sources fan out to their implicit PermissionSet as well.
    const ids = s.kind === "profile" ? profileFanoutIds(idx, s.id) : [s.id];
    for (const pid of ids) {
      const rows = idx.objPermsByParent.get(pid) || [];
      for (const r of rows) {
        const target = s.kind === "muting" ? mute : grant;
        let cur = target.get(r.SobjectType);
        if (!cur) { cur = { c:false,r:false,e:false,d:false,va:false,ma:false, sources:{c:[],r:[],e:[],d:[],va:[],ma:[]} }; target.set(r.SobjectType, cur); }
        ["c","r","e","d","va","ma"].forEach(k => {
          if (r[k]) { if (!cur[k]) cur[k] = true; cur.sources[k].push(s); }
        });
      }
    }
  }
  // Apply muting subtractions. Muting on ObjectPermissions follows the same semantics.
  for (const [sobj, m] of mute) {
    const g = grant.get(sobj);
    if (!g) continue;
    ["c","r","e","d","va","ma"].forEach(k => { if (m[k] && g[k]) { g[k] = false; g.sources[k+"_mutedBy"] = (g.sources[k+"_mutedBy"] || []).concat(m.sources[k]); } });
  }
  return grant;
}

// Effective field perms for a user. Returns Map(field -> {read,edit, sources:{read:[],edit:[]}, muted:{read,edit,by}})
function effectiveFields(idx, userId) {
  const srcs = userSources(idx, userId);
  const grant = new Map();
  const mute = new Map();
  for (const s of srcs) {
    // BUG-8 v2.6: profile sources fan out to their implicit PermissionSet as well.
    const ids = s.kind === "profile" ? profileFanoutIds(idx, s.id) : [s.id];
    for (const pid of ids) {
      const rows = idx.fieldPermsByParent.get(pid) || [];
      for (const r of rows) {
        const target = s.kind === "muting" ? mute : grant;
        let cur = target.get(r.Field);
        if (!cur) { cur = { SobjectType: r.SobjectType, read:false, edit:false, sources:{read:[], edit:[]} }; target.set(r.Field, cur); }
        if (r.read) { cur.read = true; cur.sources.read.push(s); }
        if (r.edit) { cur.edit = true; cur.sources.edit.push(s); }
      }
    }
  }
  for (const [field, m] of mute) {
    const g = grant.get(field);
    if (!g) continue;
    if (m.read && g.read) { g.read = false; g.mutedRead = m.sources.read; }
    if (m.edit && g.edit) { g.edit = false; g.mutedEdit = m.sources.edit; }
  }
  // Return also the raw muted entries so UX-8 can show them even if never granted
  return { grant, mute };
}

// Effective system perms for a user. Returns {permName: {value:bool, sources:[]}} (no mute on sys perms)
function effectiveSysPerms(idx, userId) {
  const srcs = userSources(idx, userId);
  const out = {};
  for (const s of srcs) {
    // BUG-8 v2.6: profile sources fan out to implicit PS for sys-perms too.
    const ids = s.kind === "profile" ? profileFanoutIds(idx, s.id) : [s.id];
    for (const pid of ids) {
      const sp = idx.sysPermsByParent.get(pid);
      if (!sp) continue;
      for (const [k, v] of Object.entries(sp.perms)) {
        if (!v) continue;
        if (!out[k]) out[k] = { value: true, sources: [] };
        out[k].sources.push(s);
      }
    }
  }
  return out;
}

/* ============================================================================
 * 7. PRECOMPUTES  (UX-14, UX-15, migration planning, redundancy)
 * ==========================================================================*/

// Canonicalise a grantor's grants into a comparable string-set.
// Used for subset / duplicate / Jaccard similarity over permsets + profiles.
// BUG-8 v2.6: fans out profile IDs through their implicit PermissionSet.
function grantorSignature(idx, parentId) {
  const tokens = [];
  const ids = profileFanoutIds(idx, parentId);
  for (const pid of ids) {
    for (const o of idx.objPermsByParent.get(pid) || []) {
      if (o.c) tokens.push(`O:${o.SobjectType}:C`);
      if (o.r) tokens.push(`O:${o.SobjectType}:R`);
      if (o.e) tokens.push(`O:${o.SobjectType}:E`);
      if (o.d) tokens.push(`O:${o.SobjectType}:D`);
      if (o.va) tokens.push(`O:${o.SobjectType}:VA`);
      if (o.ma) tokens.push(`O:${o.SobjectType}:MA`);
    }
    for (const f of idx.fieldPermsByParent.get(pid) || []) {
      if (f.read) tokens.push(`F:${f.Field}:R`);
      if (f.edit) tokens.push(`F:${f.Field}:E`);
    }
    const sp = idx.sysPermsByParent.get(pid);
    if (sp) for (const [k, v] of Object.entries(sp.perms)) if (v) tokens.push(`S:${k}`);
  }
  return new Set(tokens);
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

// UX-14 Impact Matrix over all (User, assigned PermSet) pairs.
// v2.6 UX-30/31: also returns lost[] and covered[] token lists per row plus a severity
// bucket ("none" | "low" | "medium" | "high") so the UI can expand rows and badge them.
// Returns rows: {userId, userName, profile, permSetId, permSetLabel, lostObjects, lostFields, lostSystem, total, lost, covered, severity}
function precomputeImpactMatrix(idx, onProgress) {
  const rows = [];
  const users = [...idx.userById.values()];
  const totalPairs = [...idx.psaByUser.values()].reduce((n, arr) => n + arr.filter(a => !a.IsOwnedByProfile).length, 0);
  let done = 0;
  for (const u of users) {
    const assigns = (idx.psaByUser.get(u.Id) || []).filter(a => !a.IsOwnedByProfile);
    if (!assigns.length) continue;

    // Baseline effective maps
    const baseObj = effectiveObjects(idx, u.Id);
    const baseFields = effectiveFields(idx, u.Id).grant;
    const baseSys = effectiveSysPerms(idx, u.Id);

    // Pre-compute a mapping from (sourceId -> tokens granted) so we can subtract.
    const seenPs = new Set();
    for (const a of assigns) {
      if (seenPs.has(a.PermSetId + "|" + (a.GroupId||""))) continue;
      seenPs.add(a.PermSetId + "|" + (a.GroupId||""));

      // Simulated: remove this single assignment (i.e., remove its PermSet contribution
      // IF the user isn't also assigned the same PermSet via another row).
      const dupAssigns = (idx.psaByUser.get(u.Id) || []).filter(x => x.PermSetId === a.PermSetId && !(x === a));
      const coveredElsewhere = dupAssigns.length > 0;

      let lostObjects = 0, lostFields = 0, lostSys = 0;
      const lost = [];        // v2.6 UX-30 — list of lost tokens
      const covered = [];     // v2.6 UX-30 — list of covered tokens with covering sources
      if (!coveredElsewhere) {
        // Objects
        const psObj = idx.objPermsByParent.get(a.PermSetId) || [];
        for (const r of psObj) {
          const eff = baseObj.get(r.SobjectType);
          if (!eff) continue;
          // If the only source for any CRUD flag is this PermSet, flag as lost.
          ["c","r","e","d","va","ma"].forEach(k => {
            if (!r[k]) return;
            const srcs = eff.sources[k] || [];
            const uniqueOther = srcs.filter(s => !(s.id === a.PermSetId));
            const flagMap = { c: "C", r: "R", e: "E", d: "D", va: "VA", ma: "MA" };
            const tok = `O:${r.SobjectType}:${flagMap[k]}`;
            if (eff[k] && uniqueOther.length === 0) { lostObjects++; lost.push({ token: tok, label: tokenToNoun(tok) }); }
            else if (eff[k]) { covered.push({ token: tok, label: tokenToNoun(tok), coveredBy: uniqueOther.map(s => s.label) }); }
          });
        }
        // Fields
        const psField = idx.fieldPermsByParent.get(a.PermSetId) || [];
        for (const r of psField) {
          const eff = baseFields.get(r.Field);
          if (!eff) continue;
          if (r.read) {
            const uniqueOther = (eff.sources.read || []).filter(s => s.id !== a.PermSetId);
            const tok = `F:${r.Field}:R`;
            if (eff.read && uniqueOther.length === 0) { lostFields++; lost.push({ token: tok, label: tokenToNoun(tok) }); }
            else if (eff.read) covered.push({ token: tok, label: tokenToNoun(tok), coveredBy: uniqueOther.map(s => s.label) });
          }
          if (r.edit) {
            const uniqueOther = (eff.sources.edit || []).filter(s => s.id !== a.PermSetId);
            const tok = `F:${r.Field}:E`;
            if (eff.edit && uniqueOther.length === 0) { lostFields++; lost.push({ token: tok, label: tokenToNoun(tok) }); }
            else if (eff.edit) covered.push({ token: tok, label: tokenToNoun(tok), coveredBy: uniqueOther.map(s => s.label) });
          }
        }
        // System perms
        const psSys = idx.sysPermsByParent.get(a.PermSetId);
        if (psSys) {
          for (const [k, v] of Object.entries(psSys.perms)) {
            if (!v) continue;
            const eff = baseSys[k];
            if (!eff) continue;
            const uniqueOther = eff.sources.filter(s => s.id !== a.PermSetId);
            const tok = `S:${k}`;
            if (uniqueOther.length === 0) { lostSys++; lost.push({ token: tok, label: tokenToNoun(tok) }); }
            else covered.push({ token: tok, label: tokenToNoun(tok), coveredBy: uniqueOther.map(s => s.label) });
          }
        }
      }

      // v2.6 UX-31: severity bucket by total losses and token sensitivity.
      const total = lostObjects + lostFields + lostSys;
      const hasHighSignal = lost.some(l => /:D$|:MA$|ModifyAllData|ViewAllData|ManageUsers|AuthorApex/.test(l.token));
      const severity = total === 0 ? "none" : (hasHighSignal ? "high" : total > 20 ? "medium" : "low");

      rows.push({
        userId: u.Id,
        userName: u.Name,
        email: u.Email,
        profile: u["Profile.Name"] || (idx.profileById.get(u.ProfileId)||{}).Name || "",
        permSetId: a.PermSetId,
        permSetLabel: a.PermSetLabel || a.PermSetName || a.PermSetId,
        groupLabel: a.GroupId ? ((idx.groupById.get(a.GroupId)||{}).MasterLabel || a.GroupId) : "",
        lostObjects, lostFields, lostSys,
        total,
        lost, covered, severity,
      });
      done++;
      if (onProgress && (done & 63) === 0) onProgress(done, totalPairs || done);
    }
  }
  if (onProgress) onProgress(totalPairs, totalPairs);
  return rows;
}

// UX-15 Zero-impact deletion candidates.
// For each PermSet (excluding those with no user assignments → those go in Orphaned),
// simulate its removal and see if any user loses any effective permission.
function precomputeDeleteCandidates(idx) {
  const byPermSet = new Map();

  for (const ps of idx.permSetById.values()) {
    if (toBool(ps.IsOwnedByProfile)) continue;
    const assignedUsers = new Set();
    for (const a of idx.psaByPermSet.get(ps.Id) || []) assignedUsers.add(a.UserId);
    if (assignedUsers.size === 0) continue; // skip — these are Orphaned, handled elsewhere

    let zeroImpact = true;
    const perUser = []; // {userId, userName, covered:bool, coveringSources:Map(token->Set(sourceIds))}

    for (const userId of assignedUsers) {
      const u = idx.userById.get(userId);
      if (!u) continue;
      // Tokens uniquely granted by this PermSet to this user (not covered elsewhere)
      // + covering sources for every token granted by this PermSet.
      const tokensByThisPs = grantorSignature(idx, ps.Id);
      const otherSources = userSources(idx, userId).filter(s => s.id !== ps.Id);
      const otherSig = new Map(); // token -> [source...]
      for (const s of otherSources) {
        const sig = grantorSignature(idx, s.id);
        if (s.kind === "muting") continue; // muting doesn't "cover" anything
        for (const t of sig) {
          if (!otherSig.has(t)) otherSig.set(t, []);
          otherSig.get(t).push(s);
        }
      }
      const coveringPerToken = [];
      let lost = 0;
      for (const t of tokensByThisPs) {
        const covers = otherSig.get(t) || [];
        if (covers.length === 0) lost++;
        coveringPerToken.push({ token: t, covers });
      }
      const covered = lost === 0;
      if (!covered) zeroImpact = false;
      perUser.push({ userId, userName: u.Name, covered, coveringPerToken, lostTokenCount: lost });
    }
    byPermSet.set(ps.Id, { permSetId: ps.Id, label: ps.Label, zeroImpact, perUser });
  }
  return byPermSet;
}

// Profile similarity clustering (6.4) — Jaccard > 0.7 pairs and transitive clusters.
function precomputeProfileSimilarity(idx) {
  const profs = [...idx.profileById.values()];
  const sigs = profs.map(p => ({ id: p.Id, name: p.Name, sig: grantorSignature(idx, p.Id) }));
  const pairs = [];
  const adj = new Map();
  for (let i = 0; i < sigs.length; i++)
    for (let j = i + 1; j < sigs.length; j++) {
      const s = jaccard(sigs[i].sig, sigs[j].sig);
      if (s >= 0.7) {
        pairs.push({ a: sigs[i].id, aName: sigs[i].name, b: sigs[j].id, bName: sigs[j].name, score: s });
        if (!adj.has(sigs[i].id)) adj.set(sigs[i].id, new Set());
        if (!adj.has(sigs[j].id)) adj.set(sigs[j].id, new Set());
        adj.get(sigs[i].id).add(sigs[j].id); adj.get(sigs[j].id).add(sigs[i].id);
      }
    }
  // Build connected components
  const seen = new Set();
  const clusters = [];
  for (const n of adj.keys()) {
    if (seen.has(n)) continue;
    const stack = [n]; const cluster = [];
    while (stack.length) {
      const x = stack.pop();
      if (seen.has(x)) continue;
      seen.add(x); cluster.push(x);
      for (const y of adj.get(x) || []) if (!seen.has(y)) stack.push(y);
    }
    if (cluster.length > 1) clusters.push(cluster.map(id => ({ id, name: idx.profileById.get(id).Name })));
  }
  return { pairs, clusters, sigs };
}

// Three-way decomposition for the profiles in a cluster.
// Returns { sharedBase, additiveByProfile, mutingCandidates } where sharedBase is
// the intersection of grants, additive is each profile's unique tokens, muting is
// the "inverted" tokens that the profile does NOT grant but the shared-base does.
function threeWayDecomposition(sigsForCluster) {
  if (!sigsForCluster.length) return { shared: new Set(), additive: {}, muting: {} };
  let shared = new Set(sigsForCluster[0].sig);
  for (let i = 1; i < sigsForCluster.length; i++) {
    const other = sigsForCluster[i].sig;
    shared = new Set([...shared].filter(x => other.has(x)));
  }
  const additive = {}, muting = {};
  for (const s of sigsForCluster) {
    const add = [...s.sig].filter(x => !shared.has(x));
    const mut = [...shared].filter(x => !s.sig.has(x));
    additive[s.id] = add;
    muting[s.id] = mut;
  }
  return { shared, additive, muting };
}

// Duplicate + subset detection across PermSets.
function precomputePermSetOverlap(idx) {
  const entries = [];
  for (const ps of idx.permSetById.values())
    entries.push({ id: ps.Id, label: ps.Label, sig: grantorSignature(idx, ps.Id) });
  const dups = [];
  const subsets = [];
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      if (a.sig.size === 0 || b.sig.size === 0) continue;
      const aInB = [...a.sig].every(x => b.sig.has(x));
      const bInA = [...b.sig].every(x => a.sig.has(x));
      if (aInB && bInA) dups.push({ a: a.id, aLabel: a.label, b: b.id, bLabel: b.label });
      else if (aInB) subsets.push({ subsetId: a.id, subsetLabel: a.label, supersetId: b.id, supersetLabel: b.label });
      else if (bInA) subsets.push({ subsetId: b.id, subsetLabel: b.label, supersetId: a.id, supersetLabel: a.label });
    }
  return { dups, subsets, entries };
}

// Orphaned PermSets (no user + not in any group).
function precomputeOrphans(idx) {
  const inGroup = new Set();
  for (const rows of idx.groupMembers.values()) for (const r of rows) inGroup.add(r.PermissionSetId);
  const orphans = [];
  for (const ps of idx.permSetById.values()) {
    if (toBool(ps.IsOwnedByProfile)) continue;
    const assigns = idx.psaByPermSet.get(ps.Id) || [];
    if (assigns.length === 0 && !inGroup.has(ps.Id)) orphans.push(ps);
  }
  return orphans;
}

// Dead fields: FieldPermissions rows where no user currently has either Read or Edit.
// Derived: a field is "dead" if every grantor of that field is either not assigned
// to any user or is entirely muted.
function precomputeDeadFields(idx) {
  const assignedParents = new Set();
  for (const arr of idx.psaByUser.values()) for (const a of arr) assignedParents.add(a.PermSetId);
  // BUG-8 v2.6: for every profile, also treat its implicit PermissionSet as "assigned"
  // so field rows under the implicit PS aren't falsely flagged dead.
  for (const u of idx.userById.values()) {
    if (!u.ProfileId) continue;
    assignedParents.add(u.ProfileId);
    const implicit = idx.profileImplicitPsByProfileId.get(u.ProfileId);
    if (implicit) assignedParents.add(implicit);
  }

  const dead = [];
  for (const [field, rows] of idx.fieldPermsByField.entries()) {
    const anyLive = rows.some(r => assignedParents.has(r.ParentId));
    if (!anyLive) dead.push({ field, sobject: rows[0].SobjectType });
  }
  return dead;
}

// v2.6 UX-34: translate a grantor-signature token into a concrete-noun label.
// E.g. "O:Account:R" -> "Account — Read", "F:Account.Name:R" -> "Account.Name (Read)",
//      "S:PermissionsViewAllData" -> "System — ViewAllData"
function tokenToNoun(tok) {
  if (!tok) return "";
  if (tok.startsWith("O:")) {
    const [, sobj, flag] = tok.split(":");
    const flagMap = { C: "Create", R: "Read", E: "Edit", D: "Delete", VA: "View All Records", MA: "Modify All Records" };
    return `${sobj} — ${flagMap[flag] || flag}`;
  }
  if (tok.startsWith("F:")) {
    const [, field, flag] = tok.split(":");
    return `${field} (${flag === "R" ? "Read" : "Edit"})`;
  }
  if (tok.startsWith("S:")) return `System — ${tok.slice(2).replace(/^Permissions/, "")}`;
  return tok;
}

// v2.6 UX-40: Near-duplicate detection — Jaccard ≥ 0.85 but not exact.
// Returns { dups, nearDups, subsets } with the entries pre-sorted by score.
function precomputePermSetOverlapV26(idx) {
  const entries = [];
  for (const ps of idx.permSetById.values())
    entries.push({ id: ps.Id, label: ps.Label, sig: grantorSignature(idx, ps.Id) });
  const dups = [], nearDups = [], subsets = [];
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      if (a.sig.size === 0 || b.sig.size === 0) continue;
      const aInB = [...a.sig].every(x => b.sig.has(x));
      const bInA = [...b.sig].every(x => a.sig.has(x));
      const inter = [...a.sig].filter(x => b.sig.has(x)).length;
      const uni = a.sig.size + b.sig.size - inter;
      const score = uni === 0 ? 0 : inter / uni;
      if (aInB && bInA) {
        dups.push({ a: a.id, aLabel: a.label, b: b.id, bLabel: b.label, score: 1, sharedCount: a.sig.size });
      } else if (aInB) {
        subsets.push({ subsetId: a.id, subsetLabel: a.label, supersetId: b.id, supersetLabel: b.label });
      } else if (bInA) {
        subsets.push({ subsetId: b.id, subsetLabel: b.label, supersetId: a.id, supersetLabel: a.label });
      } else if (score >= 0.85) {
        const aOnly = [...a.sig].filter(x => !b.sig.has(x));
        const bOnly = [...b.sig].filter(x => !a.sig.has(x));
        nearDups.push({ a: a.id, aLabel: a.label, b: b.id, bLabel: b.label, score, aOnly, bOnly, shared: inter });
      }
    }
  nearDups.sort((x, y) => y.score - x.score);
  return { dups, nearDups, subsets, entries };
}

// v2.6 UX-43: pairwise Jaccard matrix for a cluster of profiles/permsets.
// Returns { ids, names, matrix: number[][] } where matrix[i][j] is the Jaccard score.
function clusterPairwiseMatrix(entries) {
  const ids = entries.map(e => e.id);
  const names = entries.map(e => e.name);
  const matrix = [];
  for (let i = 0; i < entries.length; i++) {
    const row = [];
    for (let j = 0; j < entries.length; j++) {
      if (i === j) row.push(1);
      else row.push(jaccard(entries[i].sig, entries[j].sig));
    }
    matrix.push(row);
  }
  return { ids, names, matrix };
}

// v2.6 UX-26: PermSet Coverage Report — lists PermSets that grant nothing useful
// (empty signature) and those whose grants are already fully covered by another
// PermSet assigned to every one of their users.
function precomputePermSetCoverage(idx) {
  const empty = [];
  const fullyCovered = [];
  for (const ps of idx.permSetById.values()) {
    if (toBool(ps.IsOwnedByProfile)) continue;
    const sig = grantorSignature(idx, ps.Id);
    if (sig.size === 0) { empty.push({ id: ps.Id, label: ps.Label, name: ps.Name }); continue; }
    const assignedUsers = new Set((idx.psaByPermSet.get(ps.Id) || []).map(a => a.UserId));
    if (assignedUsers.size === 0) continue;
    let allUsersCovered = true;
    for (const uid of assignedUsers) {
      const other = userSources(idx, uid).filter(s => s.id !== ps.Id && s.kind !== "muting");
      const otherTokens = new Set();
      for (const s of other) for (const t of grantorSignature(idx, s.id)) otherTokens.add(t);
      if (![...sig].every(t => otherTokens.has(t))) { allUsersCovered = false; break; }
    }
    if (allUsersCovered) fullyCovered.push({ id: ps.Id, label: ps.Label, name: ps.Name, users: assignedUsers.size, tokens: sig.size });
  }
  return { empty, fullyCovered };
}

/* ============================================================================
 * 8. STYLE BLOCK (scrollbars, animations, font import)
 * ==========================================================================*/
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; }
  html, body, #root { height: 100%; background: ${T.bg}; color: ${T.text}; font-family: ${T.font}; }
  body { margin: 0; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: ${T.accent}; }
  details > summary { list-style: none; cursor: pointer; }
  details > summary::-webkit-details-marker { display: none; }
  .pe-fade { animation: pe-fade .18s ease-out; }
  @keyframes pe-fade { from { opacity:0; transform: translateY(2px); } to { opacity:1; transform:none; } }
  .pe-spinner { width:20px;height:20px;border:2px solid ${T.border};border-top-color:${T.accent};border-radius:50%;animation:pe-spin .8s linear infinite; display:inline-block; vertical-align:middle; }
  @keyframes pe-spin { to { transform: rotate(360deg); } }
  .pe-row:hover { background: ${T.cardHover}; }
  table.pe-table { width:100%; border-collapse: separate; border-spacing:0; }
  table.pe-table th, table.pe-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid ${T.border}; }
  table.pe-table th { background: ${T.bgAlt}; color: ${T.textMuted}; font-size: 11px; font-weight:600; letter-spacing: .08em; text-transform: uppercase; position: sticky; top: 0; z-index: 2; }
  table.pe-table tbody tr:nth-child(even) { background: rgba(26,35,56,0.3); }
  table.pe-table tbody tr:hover { background: ${T.cardHover}; }
  .pe-pill { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; font-size:11px; font-weight:600; border-radius:999px; border:1px solid; }
  input.pe-input, select.pe-input { background: ${T.bgAlt}; color: ${T.text}; border: 1px solid ${T.border}; border-radius: 8px; padding: 8px 10px; font-size: 13px; font-family: inherit; outline: none; }
  input.pe-input:focus { border-color: ${T.borderActive}; }
  button.pe-btn { background: ${T.accent}; color: #fff; border:0; padding:8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
  button.pe-btn[disabled] { opacity: .5; cursor: not-allowed; }
  button.pe-btn.secondary { background: transparent; color: ${T.text}; border: 1px solid ${T.border}; }
  button.pe-btn.ghost { background: transparent; color: ${T.accent}; border: 0; }
  button.pe-btn.danger { background: ${T.red}; }
  .pe-kbd { font-family: ${T.mono}; font-size: 11px; padding: 2px 6px; background: ${T.bgAlt}; border: 1px solid ${T.border}; border-radius: 4px; }
  /* UX-53 v2.8: prose/help blocks stay readable even on ultra-wide displays. */
  .pe-prose { max-width: 130ch; }
`;

/* ============================================================================
 * 9. GENERIC UI PRIMITIVES
 * ==========================================================================*/
function Pill({ tone = "accent", children, style, onClick }) {
  const map = {
    accent: [T.accent, T.accentBg],
    green: [T.green, T.greenBg],
    red: [T.red, T.redBg],
    yellow: [T.yellow, T.yellowBg],
    purple: [T.purple, T.purpleBg],
    cyan: [T.cyan, T.cyanBg],
    orange: [T.orange, T.orangeBg],
    mute: [T.textMuted, "transparent"],
  };
  const [c, bg] = map[tone] || map.accent;
  return (
    <span className="pe-pill" onClick={onClick} style={{ color: c, background: bg, borderColor: c, cursor: onClick ? "pointer" : "default", ...style }}>
      {children}
    </span>
  );
}

function StatCard({ label, value, tone = "accent" }) {
  const color = T[tone] || T.accent;
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderTop: `3px solid ${color}`, borderRadius: 10, padding: 14, boxShadow: T.glow }}>
      <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: T.textMuted }}>{label}</div>
      <div style={{ fontFamily: T.mono, fontSize: 28, fontWeight: 600, marginTop: 6, color: T.text }}>{value}</div>
    </div>
  );
}

function SearchInput({ value, onChange, placeholder, style }) {
  return (
    <div style={{ position: "relative", ...style }}>
      <input className="pe-input" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder || "Search…"} style={{ width: "100%", paddingLeft: 30 }} />
      <span style={{ position: "absolute", left: 10, top: 8, color: T.textDim }}>⌕</span>
    </div>
  );
}

function CodeBlock({ text, copyKey, copiedKey, setCopied }) {
  return (
    <div style={{ position: "relative", background: "#060b16", border: `1px solid ${T.border}`, borderRadius: 8, padding: 14, paddingRight: 80, maxHeight: 200, overflow: "auto", fontFamily: T.mono, fontSize: 12, color: T.green, whiteSpace: "pre-wrap" }}>
      {text}
      <button
        className="pe-btn secondary"
        onClick={() => copyText(text, setCopied, copyKey)}
        style={{ position: "absolute", top: 8, right: 8, padding: "4px 10px", fontSize: 11 }}
      >
        {copiedKey === copyKey ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

// Typeahead combobox (UX-13). Filters by substring over getLabel(item).
// Keyboard: ArrowUp/Down, Enter to select, Escape to close.
// BUG-10 v2.6: matchFields defaults to ["Label","Name","DeveloperName","MasterLabel"]
// so typing "Sales" never matches rows merely because "sales" appears in Description
// or Email. Callers can override matchFields to include custom attributes.
function Typeahead({ items, value, onSelect, getLabel, getId, getSub, placeholder, maxShow = 50, emptyLabel = "No matches", matchFields }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef();
  const label = v => (v ? getLabel(v) : "");
  useEffect(() => { setQ(value ? label(value) : ""); }, [value]); // keep in sync with external changes

  const qLow = q.toLowerCase();
  // BUG-10 v2.6: restrict matching to name-like fields; falls back to label/sub.
  const pickMatchText = it => {
    if (matchFields && matchFields.length) {
      const parts = [];
      for (const f of matchFields) {
        const v = typeof f === "function" ? f(it) : it[f];
        if (v) parts.push(String(v));
      }
      return parts.join(" ").toLowerCase();
    }
    // Default: ONLY Label/Name/DeveloperName/MasterLabel plus getLabel().
    const parts = [getLabel(it)];
    ["Label","Name","DeveloperName","MasterLabel"].forEach(f => { if (it && it[f]) parts.push(it[f]); });
    return parts.join(" ").toLowerCase();
  };
  const matches = useMemo(() => {
    const src = items || [];
    if (!qLow) return src.slice(0, maxShow);
    const scored = [];
    for (const it of src) {
      const txt = pickMatchText(it);
      const pos = txt.indexOf(qLow);
      if (pos === -1) continue;
      scored.push({ it, pos });
      if (scored.length >= maxShow * 2) break;
    }
    scored.sort((a, b) => a.pos - b.pos);
    return scored.slice(0, maxShow).map(s => s.it);
  }, [items, qLow, maxShow]);

  useEffect(() => { if (active >= matches.length) setActive(0); }, [matches]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input className="pe-input"
        value={q}
        placeholder={placeholder}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, matches.length - 1)); setOpen(true); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && matches[active]) { e.preventDefault(); onSelect(matches[active]); setQ(getLabel(matches[active])); setOpen(false); }
          else if (e.key === "Escape") setOpen(false);
        }}
        style={{ width: "100%" }}
      />
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, marginTop: 4, maxHeight: 280, overflow: "auto", zIndex: 50, boxShadow: T.glow }}>
          {matches.length === 0 ? (
            <div style={{ padding: 10, color: T.textMuted, fontSize: 12 }}>{emptyLabel}</div>
          ) : matches.map((m, i) => (
            <div key={getId(m)}
              onMouseDown={() => { onSelect(m); setQ(getLabel(m)); setOpen(false); }}
              style={{ padding: "8px 10px", cursor: "pointer", background: i === active ? T.cardHover : "transparent", borderBottom: `1px solid ${T.border}` }}
              onMouseEnter={() => setActive(i)}
            >
              <div style={{ fontSize: 13, color: T.text }}>{getLabel(m)}</div>
              {getSub && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{getSub(m)}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// v2.6 UX-28: Suggestion-style typeahead — the text field behaves as a plain search
// input. Matching items appear as a dropdown; clicking (or pressing Enter on the
// active row) APPLIES the selection. Unlike classic Typeahead, the input doesn't
// swap to the selected label and the list isn't gated by focus: it stays visible
// whenever there's text. BUG-10 match restriction applies here too.
function SuggestionTypeahead({ items, value, onSelect, getLabel, getId, getSub, placeholder, maxShow = 50, emptyLabel = "No matches", matchFields }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);

  const pickMatchText = it => {
    if (matchFields && matchFields.length) {
      const parts = [];
      for (const f of matchFields) {
        const v = typeof f === "function" ? f(it) : it[f];
        if (v) parts.push(String(v));
      }
      return parts.join(" ").toLowerCase();
    }
    const parts = [getLabel(it)];
    ["Label","Name","DeveloperName","MasterLabel"].forEach(f => { if (it && it[f]) parts.push(it[f]); });
    return parts.join(" ").toLowerCase();
  };
  const qLow = q.toLowerCase();
  const matches = useMemo(() => {
    const src = items || [];
    if (!qLow) return [];
    const scored = [];
    for (const it of src) {
      const txt = pickMatchText(it);
      const pos = txt.indexOf(qLow);
      if (pos === -1) continue;
      scored.push({ it, pos });
      if (scored.length >= maxShow * 2) break;
    }
    scored.sort((a, b) => a.pos - b.pos);
    return scored.slice(0, maxShow).map(s => s.it);
  }, [items, qLow, maxShow]);

  const apply = m => { onSelect(m); setQ(""); setActive(0); };

  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "relative" }}>
        <input className="pe-input"
          value={q}
          placeholder={placeholder}
          onChange={e => { setQ(e.target.value); setActive(0); }}
          onKeyDown={e => {
            // UX-49 v2.7: Escape clears an active selection if one exists; else
            // it just clears the current typing buffer.
            if (e.key === "Escape") {
              if (value) { onSelect(null); setQ(""); e.preventDefault(); return; }
              setQ(""); return;
            }
            if (!matches.length) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, matches.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); apply(matches[active]); }
          }}
          style={{ width: "100%", paddingRight: value ? 28 : undefined }}
        />
        {/* UX-49 v2.7: × Clear affordance is visible whenever a selection is
            active; clicking it returns the scenario to its default empty state. */}
        {value && (
          <button
            onClick={() => { onSelect(null); setQ(""); }}
            title="Clear selection (Esc)"
            aria-label="Clear selection"
            style={{
              position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
              background: "transparent", border: 0, color: T.textMuted,
              fontSize: 14, lineHeight: 1, cursor: "pointer", padding: 4, borderRadius: 4,
            }}>×</button>
        )}
      </div>
      {value && (
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <span style={{ color: T.textMuted }}>Applied:</span>
          <Pill tone="cyan">{getLabel(value)}</Pill>
          <button className="pe-btn ghost" style={{ fontSize: 11, padding: "2px 6px" }} onClick={() => onSelect(null)}>clear</button>
        </div>
      )}
      {qLow && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, marginTop: 4, maxHeight: 280, overflow: "auto", zIndex: 50, boxShadow: T.glow }}>
          {matches.length === 0 ? (
            <div style={{ padding: 10, color: T.textMuted, fontSize: 12 }}>{emptyLabel}</div>
          ) : matches.map((m, i) => (
            <div key={getId(m)}
              onMouseDown={() => apply(m)}
              onMouseEnter={() => setActive(i)}
              style={{ padding: "8px 10px", cursor: "pointer", background: i === active ? T.cardHover : "transparent", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 13, color: T.text }}>{getLabel(m)}</div>
              {getSub && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{getSub(m)}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// v2.6 UX-25 / BUG-11 v2.7: compact Grants cell for Effective Fields tables.
// Renders up to 3 pill-shaped source labels with a kind prefix pill
// (Profile / PermSet / Group) and folds the rest into a "+N more" pill.
//
// BUG-11: if `idx` is supplied, each source is resolved through the fallback
// chain Profile.Name → PermissionSet.Label → PermissionSet.Name →
// PermSetGroup.MasterLabel → Id (last resort, shown as tooltip).
const SF_ID_RE = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
function looksLikeSalesforceId(v) {
  return typeof v === "string" && SF_ID_RE.test(v);
}
function resolveSourceLabel(s, idx) {
  // Keep existing label if it doesn't look like a raw Id.
  if (s.label && !looksLikeSalesforceId(s.label)) return s.label;
  if (!idx) return s.label || s.id;
  // Fallback chain per BUG-11.
  if (s.kind === "profile") {
    const p = idx.profileById && idx.profileById.get(s.id);
    if (p && p.Name) return p.Name;
  }
  if (s.kind === "permset" || s.kind === "groupmember" || s.kind === "muting") {
    const ps = idx.permSetById && idx.permSetById.get(s.id);
    if (ps) return ps.Label || ps.Name || s.id;
  }
  if (s.kind === "group") {
    const g = idx.groupById && idx.groupById.get(s.id);
    if (g) return g.MasterLabel || g.DeveloperName || s.id;
  }
  return s.label || s.id;
}
function sourceKindPill(kind) {
  // BUG-11 v2.7: always render the kind as a short pill prefix so admins know
  // where the grant came from at a glance.
  if (kind === "profile")    return { label: "Profile", tone: "purple" };
  if (kind === "permset")    return { label: "PermSet", tone: "accent" };
  if (kind === "groupmember")return { label: "Group",   tone: "cyan"   };
  if (kind === "muting")     return { label: "Muting",  tone: "red"    };
  if (kind === "group")      return { label: "Group",   tone: "cyan"   };
  return { label: kind || "Src", tone: "mute" };
}
function GrantPillCell({ sources, max = 3, idx }) {
  if (!sources || !sources.length) return <span style={{ color: T.textDim }}>—</span>;
  const uniq = [];
  const seen = new Set();
  for (const s of sources) {
    const k = (s.kind || "") + "|" + (s.id || s.label);
    if (seen.has(k)) continue;
    seen.add(k); uniq.push(s);
  }
  const head = uniq.slice(0, max), rest = uniq.slice(max);
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
      {head.map((s, i) => {
        const kp = sourceKindPill(s.kind);
        const name = resolveSourceLabel(s, idx);
        const viaGroup = s.groupLabel ? ` · via ${s.groupLabel}` : "";
        return (
          <span key={i} title={`${kp.label}${viaGroup}: ${name}${s.id && s.id !== name ? ` (${s.id})` : ""}`}
            style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
            <Pill tone={kp.tone}>{kp.label}</Pill>
            <span style={{ fontSize: 11, color: T.text, fontFamily: T.font }}>
              {s.kind === "groupmember" || s.kind === "muting"
                ? <><span style={{ color: T.textMuted }}>{s.groupLabel || "group"} → </span>{name}</>
                : name}
            </span>
          </span>
        );
      })}
      {rest.length > 0 && (
        <span title={rest.map(s => `${sourceKindPill(s.kind).label}: ${resolveSourceLabel(s, idx)}`).join(", ")}>
          <Pill tone="mute">+{rest.length} more</Pill>
        </span>
      )}
    </span>
  );
}

// UX-48 v2.7: when the Object cascade is NOT active, Effective Fields renders
// grouped by Object with a sticky header instead of a per-row Object column.
function GroupedFieldsByObject({ fieldRows, idx }) {
  const [q, setQ] = useState("");
  const byObj = new Map();
  for (const r of fieldRows) {
    const k = r.SobjectType || "(blank)";
    if (!byObj.has(k)) byObj.set(k, []);
    byObj.get(k).push(r);
  }
  const qLow = q.trim().toLowerCase();
  const objs = [...byObj.keys()].sort().filter(o => !qLow || o.toLowerCase().includes(qLow));
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: T.text, textTransform: "uppercase", letterSpacing: .3 }}>
          Effective Fields — <span style={{ color: T.textMuted }}>{fieldRows.length.toLocaleString()} rows / {byObj.size} objects</span>
        </div>
        <div style={{ flex: 1 }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by object…"
          style={{ background: T.bgAlt, border: `1px solid ${T.border}`, color: T.text, borderRadius: 6, padding: "4px 8px", fontSize: 12, width: 200 }} />
      </div>
      {fieldRows.length === 0 ? (
        <Empty text="No effective field permissions." />
      ) : objs.map(o => (
        <div key={o} style={{ marginBottom: 10, border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden" }}>
          <div style={{ position: "sticky", top: 0, background: T.bgAlt, padding: "6px 10px",
            fontSize: 12, fontWeight: 700, color: T.accentLight, borderBottom: `1px solid ${T.border}`,
            display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{o}</span>
            <span style={{ color: T.textMuted, fontWeight: 400, fontSize: 11 }}>{byObj.get(o).length} fields</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <thead>
              <tr style={{ background: T.bgAlt }}>
                <th style={{ textAlign: "left", padding: "6px 10px", fontSize: 10, color: T.textMuted, textTransform: "uppercase", letterSpacing: .5, width: "40%" }}>Field</th>
                <th style={{ textAlign: "left", padding: "6px 10px", fontSize: 10, color: T.textMuted, textTransform: "uppercase", width: 60 }}>Read</th>
                <th style={{ textAlign: "left", padding: "6px 10px", fontSize: 10, color: T.textMuted, textTransform: "uppercase", width: 60 }}>Edit</th>
                <th style={{ textAlign: "left", padding: "6px 10px", fontSize: 10, color: T.textMuted, textTransform: "uppercase" }}>Granted by</th>
              </tr>
            </thead>
            <tbody>
              {byObj.get(o).map(r => (
                <tr key={r.Field} style={{ borderTop: `1px solid ${T.border}` }}>
                  <td style={{ padding: "6px 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span title={r.Field} style={{ fontFamily: T.mono, color: T.accentLight }}>{r.Field}</span>
                  </td>
                  <td style={{ padding: "6px 10px" }}><BoolFlag v={r.read} /></td>
                  <td style={{ padding: "6px 10px" }}><BoolFlag v={r.edit} /></td>
                  <td style={{ padding: "6px 10px" }}><GrantPillCell sources={r.srcObjs} idx={idx} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{ display: "inline-flex", gap: 4, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 4 }}>
      {tabs.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)} style={{
          padding: "6px 14px", borderRadius: 6, border: 0, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: T.font,
          background: active === t.key ? T.accent : "transparent",
          color: active === t.key ? "#fff" : T.textMuted,
        }}>{t.label}{t.count != null && <span style={{ marginLeft: 6, opacity: .75 }}>({t.count})</span>}</button>
      ))}
    </div>
  );
}

function ExpandableCard({ header, children, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div style={{ background: T.card, border: `1px solid ${open ? T.borderActive : T.border}`, borderRadius: 10, marginBottom: 10, boxShadow: T.glow, transition: "border-color .15s" }}>
      <div onClick={() => setOpen(!open)} style={{ padding: 12, display: "flex", alignItems: "center", cursor: "pointer", gap: 10 }}>
        <span style={{ color: T.textMuted, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
        <div style={{ flex: 1 }}>{header}</div>
      </div>
      {open && <div style={{ padding: "0 12px 12px", borderTop: `1px solid ${T.border}` }}>{children}</div>}
    </div>
  );
}

function ExportCSVButton({ rows, columns, filename }) {
  return (
    <button className="pe-btn secondary" style={{ padding: "4px 10px", fontSize: 11 }} disabled={!rows || !rows.length}
      onClick={() => {
        const csv = rowsToCSV(rows, columns);
        downloadBlob(new Blob([csv], { type: "text/csv" }), filename || "export.csv");
      }}>Export CSV</button>
  );
}

function Empty({ text }) {
  return <div style={{ padding: 24, textAlign: "center", color: T.textMuted, fontSize: 13 }}>{text}</div>;
}

/* ============================================================================
 * 10. ADMIN TAB (Section 7.3) — unified per-dataset cards + bundle export/import
 * ==========================================================================*/
function AdminTab({ datasets, source, sourceTs, cachedAt, warnings, xrefWarnings, uploadedAt, onUpload, onReset, onClearCache, onExportBundle, onImportBundle, manifest, onLoadAllComputations, computing, computingProgress, idx, nav }) {
  const [copied, setCopied] = useState(null);
  const fileInputs = useRef({});
  const bundleInput = useRef();
  // v2.6 UX-26: PermSet Coverage Report — lazily computes which permission sets are empty
  // (zero grant tokens) and which are fully covered by the other sources assigned to their users.
  const [coverage, setCoverage] = useState(null);
  const [coverageRunning, setCoverageRunning] = useState(false);

  const allLoaded = FILES.every(f => datasets && datasets[f.key] && datasets[f.key].length > 0);
  const loadedCount = FILES.filter(f => datasets && datasets[f.key] && datasets[f.key].length > 0).length;

  const sourceBadge = (() => {
    if (!datasets) return <Pill tone="mute">No dataset loaded</Pill>;
    if (source === "upload") {
      if (loadedCount < FILES.length) return <Pill tone="yellow">CSV upload in progress ({loadedCount}/{FILES.length} staged)</Pill>;
      return <Pill tone="green">CSV upload complete — {loadedCount}/{FILES.length}</Pill>;
    }
    if (source === "bundle") return <Pill tone="accent">Bundle imported — {ago(sourceTs)}</Pill>;
    if (source === "cache") return <Pill tone="purple">From cache{cachedAt ? ` · ${Math.max(1, Math.round(ageInDays(cachedAt)))}d old` : ""}</Pill>;
    if (source === "none") return <Pill tone="yellow">No dataset loaded</Pill>;
    return <Pill tone="mute">No dataset loaded</Pill>;
  })();

  return (
    <div style={{ padding: "24px clamp(16px, 2vw, 48px)", width: "100%", boxSizing: "border-box", margin: "0 auto" }}>
      {/* Top control bar — v2.6 UX-18 widened; UX-20 Load All Computations added */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: T.glow }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Data source:</div>
          {sourceBadge}
          <div style={{ flex: 1 }} />
          <button className="pe-btn secondary" disabled={!allLoaded || !onLoadAllComputations}
            title="Pre-compute Impact Matrix, redundancy and migration clusters in one pass. v2.6 UX-20."
            onClick={() => onLoadAllComputations && onLoadAllComputations()}>
            {computing ? <><span className="pe-spinner" style={{ width: 12, height: 12, marginRight: 6 }}/>Computing…</> : "Load All Computations"}
          </button>
          <button className="pe-btn secondary" onClick={() => bundleInput.current && bundleInput.current.click()}>Import Bundle</button>
          <button className="pe-btn" disabled={!allLoaded} onClick={onExportBundle}>Export Bundle</button>
          <button className="pe-btn secondary" onClick={onClearCache}
            title="Clear the IndexedDB cache. Current view stays loaded; next session will boot to an empty Admin tab.">
            Clear Cache
          </button>
          <button className="pe-btn secondary" onClick={onReset}>Reset</button>
          <input ref={bundleInput} type="file" accept=".pebundle,application/octet-stream" style={{ display: "none" }}
            onChange={e => { const f = e.target.files && e.target.files[0]; if (f) onImportBundle(f); e.target.value = ""; }} />
        </div>
        {computingProgress && (
          <div style={{ marginTop: 8, fontSize: 11, color: T.textMuted }}>
            {computingProgress}
          </div>
        )}
        <div style={{ marginTop: 10, fontSize: 11, color: T.textMuted, lineHeight: 1.55 }}>
          Data flow (v3.0): upload the 13 CSVs below, or import a <code style={{ fontFamily: T.mono }}>.pebundle</code> generated by your weekly Cowork scheduled task.
          After either step, the parsed dataset is cached locally in IndexedDB, so the next session boots instantly without re-uploading.
          The artifact never calls Salesforce or any other network endpoint at runtime — your data stays in your browser.
        </div>
      </div>

      {/* Validation notices — v2.6 UX-44/45:
          • Every notice renders Reason + Fix.
          • Each notice is tagged Action required / Warning / Informational only.
          • The "validation issues" counter shown in the chip excludes Informational items. */}
      {(warnings.length > 0 || xrefWarnings.length > 0) && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          {(() => {
            const all = [...xrefWarnings, ...warnings];
            const actionable = all.filter(w => (w.tag || (w.level === "info" ? "info" : "warning")) !== "info");
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em", color: T.textMuted }}>Validation notices</div>
                <Pill tone={actionable.length ? "yellow" : "green"}>{actionable.length} need attention</Pill>
                <Pill tone="mute">{all.length - actionable.length} informational</Pill>
              </div>
            );
          })()}
          {[...xrefWarnings, ...warnings].map((w, i) => {
            const tag = w.tag || (w.level === "info" ? "info" : w.level === "red" ? "action" : "warning");
            const palette = tag === "action" ? { tone: "red", border: T.red, bg: T.redBg, color: T.red, label: "Action required" }
                           : tag === "warning" ? { tone: "yellow", border: T.yellow, bg: T.yellowBg, color: T.yellow, label: "Warning" }
                           : { tone: "accent", border: T.accent, bg: T.accentBg, color: T.accentLight, label: "Informational only" };
            return (
              <div key={i} style={{ padding: 10, marginBottom: 8, borderRadius: 6, background: palette.bg, border: `1px solid ${palette.border}`, color: palette.color, fontSize: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Pill tone={palette.tone}>{palette.label}</Pill>
                  {w.file && <span style={{ fontFamily: T.mono, fontSize: 11 }}>[{w.file}]</span>}
                </div>
                <div style={{ color: T.text, fontSize: 12, marginBottom: 4 }}>{w.text}</div>
                {w.reason && <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 2 }}><b>Reason:</b> {w.reason}</div>}
                {w.fix && <div style={{ fontSize: 11, color: T.textMuted }}><b>Fix:</b> {w.fix}</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* v2.6 UX-26: PermSet Coverage Report */}
      {idx && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: T.glow }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Permission Set Coverage Report</div>
            <Pill tone="mute">UX-26</Pill>
            <div style={{ flex: 1 }} />
            <button className="pe-btn secondary" disabled={coverageRunning}
              onClick={() => {
                setCoverageRunning(true);
                setTimeout(() => {
                  setCoverage(precomputePermSetCoverage(idx));
                  setCoverageRunning(false);
                }, 20);
              }}>
              {coverageRunning ? <><span className="pe-spinner" style={{ width: 12, height: 12, marginRight: 6 }}/>Scanning…</> : (coverage ? "Re-run" : "Run coverage scan")}
            </button>
          </div>
          <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 10 }}>
            Two independent checks: <b>Empty</b> = PermSet has no grant tokens at all (safe to remove);
            <b> Fully covered</b> = every user assigned to this PermSet already receives every one of its
            tokens from other sources (Profile or other assigned PermSets), so this PermSet is redundant for every assignee.
          </div>
          {coverage && (
            <div>
              <SubSectionTable title="Empty permission sets" rows={coverage.empty} columns={[
                { key: "label", label: "Label", render: r => <span onClick={() => { const ps = idx.permSetById.get(r.id); if (ps && nav) nav({ kind: "PermissionSet", item: ps }); }} style={{ color: T.accentLight, cursor: "pointer" }}>{r.label}</span> },
                { key: "name", label: "API Name", render: r => <span style={{ fontFamily: T.mono, color: T.textMuted }}>{r.name}</span> },
              ]} getRowId={r => r.id} emptyText="No empty permission sets detected." />
              <SubSectionTable title="Fully covered permission sets (redundant for all assignees)" rows={coverage.fullyCovered} columns={[
                { key: "label", label: "Label", render: r => <span onClick={() => { const ps = idx.permSetById.get(r.id); if (ps && nav) nav({ kind: "PermissionSet", item: ps }); }} style={{ color: T.accentLight, cursor: "pointer" }}>{r.label}</span> },
                { key: "name", label: "API Name", render: r => <span style={{ fontFamily: T.mono, color: T.textMuted }}>{r.name}</span> },
                { key: "users", label: "Assigned users" },
                { key: "tokens", label: "Tokens covered" },
              ]} getRowId={r => r.id} emptyText="No fully covered permission sets detected." />
            </div>
          )}
        </div>
      )}

      {/* Per-dataset cards */}
      {FILES.map(f => {
        const rows = (datasets && datasets[f.key]) || [];
        const status = (() => {
          if (source === "upload" && uploadedAt && uploadedAt[f.key]) return { tone: "green", text: `CSV uploaded ${ago(uploadedAt[f.key])}` };
          if (source === "bundle" && rows.length) return { tone: "accent", text: `From bundle` };
          if (source === "cache" && rows.length) return { tone: "purple", text: `From cache${cachedAt ? ` · ${Math.max(1, Math.round(ageInDays(cachedAt)))}d old` : ""}` };
          return { tone: "mute", text: "Not loaded" };
        })();
        return (
          <div key={f.key} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, marginBottom: 12, boxShadow: T.glow }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 14 }}>
              <div style={{ minWidth: 40, textAlign: "center", fontFamily: T.mono, color: T.textDim, fontSize: 12 }}>{f.n}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>Query {f.n} — {f.label}</div>
                <div style={{ fontSize: 11, fontFamily: T.mono, color: T.textMuted, marginTop: 2 }}>{f.filename}</div>
              </div>
              <Pill tone={status.tone}>{rows.length.toLocaleString()} rows · {status.text}</Pill>
              <button className="pe-btn secondary" onClick={() => fileInputs.current[f.key] && fileInputs.current[f.key].click()}>
                {rows.length ? "Replace" : "Upload CSV"}
              </button>
              <input ref={el => fileInputs.current[f.key] = el} type="file" accept=".csv,text/csv" style={{ display: "none" }}
                onChange={e => { const file = e.target.files && e.target.files[0]; if (file) onUpload(f.key, file); e.target.value = ""; }} />
            </div>
            <details style={{ borderTop: `1px solid ${T.border}` }}>
              <summary style={{ padding: "10px 14px", color: T.accent, fontSize: 12, fontWeight: 500 }}>View SOQL query ▾</summary>
              <div style={{ padding: 14 }}>
                <CodeBlock text={f.soql} copyKey={`q-${f.key}`} copiedKey={copied} setCopied={setCopied} />
              </div>
            </details>
          </div>
        );
      })}

      {/* Manifest recap */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em", color: T.textMuted }}>File manifest</div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 11, color: T.textMuted }}>Total rows: {manifest.totalRows.toLocaleString()} · est. bundle: ~{manifest.estMB} MB gzipped</div>
        </div>
        <table className="pe-table"><thead><tr><th>File</th><th>Rows</th><th>Source</th></tr></thead>
          <tbody>
            {FILES.map(f => {
              const rows = (datasets && datasets[f.key]) || [];
              return (
                <tr key={f.key}>
                  <td style={{ fontFamily: T.mono, fontSize: 12 }}>{f.filename}</td>
                  <td>{rows.length.toLocaleString()}</td>
                  <td style={{ color: T.textMuted, fontSize: 12 }}>
                    {source === "upload" && uploadedAt && uploadedAt[f.key] ? "CSV upload" : source === "bundle" ? "Bundle" : source === "cache" ? "Cache" : source === "none" ? "Empty" : "Not loaded"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================================================================
 * 11. EXPLORER TAB — left sidebar with 7 entry points + detail panel
 * ==========================================================================*/

// Label helpers shared by sidebar + typeaheads.
const getUserLabel = u => u.Name || u.Id;
const getUserSub = u => u["Profile.Name"] || u.ProfileId || u.Email;
const getProfileLabel = p => p.Name;
const getProfileSub = p => p.UserType;
const getPsLabel = ps => ps.Label;
const getPsSub = ps => ps.Type === "Muting" ? "Muting" : (ps.IsCustom === "true" || ps.IsCustom === true ? "Custom" : "Standard");
const getGroupLabel = g => g.MasterLabel || g.DeveloperName;
const getRoleLabel = r => r.Name;

function SectionHeader({ title, count, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0" }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
      {count != null && <Pill tone="mute">{count}</Pill>}
      <div style={{ flex: 1 }} />
      {right}
    </div>
  );
}

// Generic per-sub-section table with its own search box (UX-5).
function SubSectionTable({ title, rows, columns, getRowId, onRowClick, rightControls, emptyText, searchPlaceholder, initialSort, filterFn }) {
  const [q, setQ] = useState("");
  const qLow = q.toLowerCase();
  const filtered = useMemo(() => {
    let r = rows || [];
    if (filterFn) r = r.filter(filterFn);
    if (!qLow) return r;
    return r.filter(row => columns.some(c => {
      const v = c.get ? c.get(row) : row[c.key];
      return v != null && String(v).toLowerCase().includes(qLow);
    }));
  }, [rows, qLow, filterFn]);
  return (
    <div style={{ marginBottom: 16 }}>
      <SectionHeader title={title} count={filtered.length} right={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {rightControls}
          <ExportCSVButton rows={filtered} columns={columns.map(c => c.key)} filename={`${title.replace(/\s+/g, "_").toLowerCase()}.csv`} />
        </div>
      } />
      <SearchInput value={q} onChange={setQ} placeholder={searchPlaceholder || `Search ${title.toLowerCase()}…`} style={{ marginBottom: 8 }} />
      {filtered.length === 0 ? <Empty text={emptyText || "No rows"} /> : (
        <div style={{ overflow: "auto", maxHeight: 420, border: `1px solid ${T.border}`, borderRadius: 8 }}>
          <table className="pe-table">
            <thead><tr>{columns.map(c => <th key={c.key} style={{ width: c.width }}>{c.label}</th>)}</tr></thead>
            <tbody>
              {filtered.map(row => (
                <tr key={getRowId ? getRowId(row) : JSON.stringify(row)} onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={{ cursor: onRowClick ? "pointer" : "default" }}>
                  {columns.map(c => <td key={c.key}>{c.render ? c.render(row) : (c.get ? c.get(row) : row[c.key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Flags boolean columns as green-dot / red-dash.
function BoolFlag({ v, changed }) {
  // `changed` (v2.6 UX-37): highlight the Future-profile cell when it differs from Current.
  const ring = changed ? { outline: `1px solid ${T.yellow}`, borderRadius: 4, padding: "0 3px" } : null;
  return v
    ? <span style={{ color: T.green, fontWeight: 700, ...ring }}>●</span>
    : <span style={{ color: T.textDim, ...ring }}>—</span>;
}

/* ---- Detail views --------------------------------------------------------- */

// Common sub-layout: Objects + Fields (with cascade) + System Perms + Tabs + Setup.
// Used by Profile detail AND PermSet detail (BUG-5).
// BUG-8 v2.6: profile parentIds fan out through the implicit PermissionSet so
// object/field/sys rows aren't empty in real SOQL-loaded datasets.
function ParentDetailSubSections({ idx, parentId, onNavObject, onNavField, onDiag }) {
  const [scopedObj, setScopedObj] = useState("");
  const fanoutIds = profileFanoutIds(idx, parentId);
  const collect = (m) => fanoutIds.flatMap(id => m.get(id) || []);
  const objRows = collect(idx.objPermsByParent);
  const fieldRows = collect(idx.fieldPermsByParent);

  // BUG-15 v2.8: System Perms merge — union across every fan-out id AND tag each
  // granted row with its source (Profile / Implicit PS / both). profileBooleans
  // BySystemPermissionKey is the canonical source for Profile-direct booleans;
  // if a profile does not have an implicit PS discovered, we still surface the
  // booleans that are true directly on the Profile row.
  const sysSourceMap = new Map(); // permKey -> Set<"profile"|"implicitPs">
  const sysLabelMap = new Map();  // permKey -> label (permKey itself today)
  const isProfile = idx.profileById && idx.profileById.has(parentId);
  for (const id of fanoutIds) {
    const s = idx.sysPermsByParent.get(id);
    if (!s) continue;
    const srcKind = (isProfile && id === parentId) ? "profile"
                 : (isProfile && id !== parentId) ? "implicitPs"
                 : "permset";
    for (const [k, v] of Object.entries(s.perms)) {
      if (!v) continue;
      if (!sysSourceMap.has(k)) sysSourceMap.set(k, new Set());
      sysSourceMap.get(k).add(srcKind);
      sysLabelMap.set(k, k);
    }
  }
  // Extra guarantee: explicitly merge Profile-direct booleans for Profiles even
  // if sysPermsByParent somehow missed the row (belt + braces).
  if (isProfile && idx.profileBooleansBySystemPermissionKey) {
    const direct = idx.profileBooleansBySystemPermissionKey.get(parentId);
    if (direct) for (const k of direct.keys()) {
      if (!sysSourceMap.has(k)) sysSourceMap.set(k, new Set());
      sysSourceMap.get(k).add("profile");
      sysLabelMap.set(k, k);
    }
  }
  const sysRows = [...sysSourceMap.entries()].map(([k, sources]) => {
    const hasProfile = sources.has("profile");
    const hasImplicit = sources.has("implicitPs");
    const sourceLabel = !isProfile ? "PermSet"
      : (hasProfile && hasImplicit) ? "both"
      : hasProfile ? "Profile (direct)"
      : hasImplicit ? "Implicit PS"
      : "PermSet";
    const sourceTone = !isProfile ? "purple"
      : (hasProfile && hasImplicit) ? "accent"
      : hasProfile ? "green"
      : "cyan";
    return { perm: k, source: sourceLabel, sourceTone };
  }).sort((a, b) => a.perm.localeCompare(b.perm));

  const tabs = collect(idx.tabsByParent);
  const setup = collect(idx.setupByParent);

  const objColumns = [
    { key: "SobjectType", label: "Object", width: 160, render: r => (
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {r.SobjectType}
        <button className="pe-btn ghost" style={{ padding: "2px 6px", fontSize: 10 }} onClick={e => { e.stopPropagation(); setScopedObj(r.SobjectType); }}>scope</button>
      </span>
    ) },
    { key: "c", label: "C", render: r => <BoolFlag v={r.c} /> },
    { key: "r", label: "R", render: r => <BoolFlag v={r.r} /> },
    { key: "e", label: "E", render: r => <BoolFlag v={r.e} /> },
    { key: "d", label: "D", render: r => <BoolFlag v={r.d} /> },
    { key: "va", label: "VA", render: r => <BoolFlag v={r.va} /> },
    { key: "ma", label: "MA", render: r => <BoolFlag v={r.ma} /> },
  ];
  const fieldColumns = [
    { key: "Field", label: "Field", render: r => (
      <span onClick={e => { e.stopPropagation(); onNavField && onNavField(r.Field); }} style={{ fontFamily: T.mono, color: T.accentLight, cursor: onNavField ? "pointer" : "default" }}>{r.Field}</span>
    ) },
    { key: "SobjectType", label: "Object", width: 140 },
    { key: "read", label: "Read", render: r => <BoolFlag v={r.read} /> },
    { key: "edit", label: "Edit", render: r => <BoolFlag v={r.edit} /> },
  ];

  // BUG-15 v2.8: zero-count actionable link → click to toggle diagnostics panel.
  const zeroAction = onDiag
    ? <button className="pe-btn ghost" style={{ padding: "2px 6px", fontSize: 11 }} onClick={onDiag}>0 ← check diagnostics</button>
    : null;

  return (
    <>
      <SubSectionTable title="Objects" rows={objRows} columns={objColumns}
        getRowId={r => r.SobjectType}
        onRowClick={r => onNavObject && onNavObject(r.SobjectType)}
        emptyText="No object permissions for this grantor."
        rightControls={objRows.length === 0 ? zeroAction : null}
      />

      <div style={{ marginBottom: 6, display: scopedObj ? "flex" : "none", alignItems: "center", gap: 8 }}>
        <Pill tone="cyan">Scoped to {scopedObj} — Clear scope</Pill>
        <button className="pe-btn ghost" onClick={() => setScopedObj("")}>clear</button>
      </div>

      <SubSectionTable title="Fields" rows={fieldRows} columns={fieldColumns}
        getRowId={r => r.Field + "|" + r.ParentId}
        filterFn={r => !scopedObj || r.SobjectType === scopedObj}
        emptyText={scopedObj ? `No fields granted on ${scopedObj}.` : "No field permissions."}
        rightControls={fieldRows.length === 0 ? zeroAction : null}
      />

      <SubSectionTable title="System Perms" rows={sysRows}
        columns={[
          { key: "perm", label: "Permission", render: r => <span style={{ fontFamily: T.mono, color: T.accentLight }}>{r.perm}</span> },
          { key: "source", label: "Source", width: 180, render: r => <Pill tone={r.sourceTone}>{r.source}</Pill> },
        ]}
        getRowId={r => r.perm}
        emptyText="No system permissions granted."
        rightControls={sysRows.length === 0 ? zeroAction : null}
      />

      <SubSectionTable title="Tab Settings" rows={tabs} columns={[
        { key: "Name", label: "Tab" },
        { key: "Visibility", label: "Visibility", render: r => <Pill tone={r.Visibility === "DefaultOn" ? "green" : "mute"}>{r.Visibility}</Pill> },
      ]} getRowId={r => r.Name} emptyText="No tab settings."
        rightControls={tabs.length === 0 ? zeroAction : null}
      />

      <SubSectionTable title="Setup Entity Access" rows={setup} columns={[
        { key: "SetupEntityType", label: "Type", width: 160, render: r => <Pill tone="purple">{r.SetupEntityType}</Pill> },
        { key: "SetupEntityId", label: "Entity" },
      ]} getRowId={r => r.SetupEntityType + ":" + r.SetupEntityId} emptyText="No Apex / VF / Custom Perm / App grants."
        rightControls={setup.length === 0 ? zeroAction : null}
      />
    </>
  );
}

// Profile detail view — fixes BUG-5 (v2.5) + BUG-8 (v2.6) + BUG-15 (v2.8)
// BUG-8: Objects/Fields/System-perms are fanned out through the implicit PermissionSet.
// BUG-15 v2.8: Profile-direct booleans surfaced (see ParentDetailSubSections) AND a
// dedicated diagnostics panel — togglable — that dumps every index counter per
// fan-out id so admins can reason about where rows are (or aren't) coming from.
function ProfileDetail({ idx, profile, nav }) {
  const [showDiag, setShowDiag] = useState(false);
  const assignedUsers = useMemo(() => [...idx.userById.values()].filter(u => u.ProfileId === profile.Id), [idx, profile.Id]);
  // BUG-8 v2.6: use profileFanoutIds for all permission lookups.
  const fanoutIds = profileFanoutIds(idx, profile.Id);
  const implicitPsId = fanoutIds.length > 1 ? fanoutIds[1] : null;
  const objCount = fanoutIds.reduce((n, id) => n + ((idx.objPermsByParent.get(id) || []).length), 0);
  const fieldCount = fanoutIds.reduce((n, id) => n + ((idx.fieldPermsByParent.get(id) || []).length), 0);
  const sysCount = fanoutIds.reduce((n, id) => {
    const sp = idx.sysPermsByParent.get(id);
    if (!sp) return n;
    return n + Object.values(sp.perms).filter(Boolean).length;
  }, 0);

  // v2.6 UX-24: sort assigned users by LastLoginDate ASC, null-first (dormant accounts to the top).
  const sortedAssigned = useMemo(() => {
    const arr = [...assignedUsers];
    arr.sort((a, b) => {
      const aL = a.LastLoginDate || "", bL = b.LastLoginDate || "";
      if (!aL && !bL) return (a.Name || "").localeCompare(b.Name || "");
      if (!aL) return -1;
      if (!bL) return 1;
      return aL < bL ? -1 : aL > bL ? 1 : 0;
    });
    return arr;
  }, [assignedUsers]);

  return (
    <div className="pe-fade">
      <Breadcrumb nav={nav} items={[{ label: "Profiles" }, { label: profile.Name }]} />
      <HeaderBlock title={profile.Name} subtitle={profile.Description || "Profile"} tags={[
        <Pill key="t" tone="purple">Profile</Pill>,
        <Pill key="ut" tone="mute">{profile.UserType}</Pill>,
        profile["UserLicense.Name"] && <Pill key="ul" tone="cyan">{profile["UserLicense.Name"]}</Pill>,
      ].filter(Boolean)} />
      <StatsRow stats={[
        { label: "Assigned users", value: assignedUsers.length, tone: "cyan" },
        { label: "Objects granted", value: objCount, tone: "purple" },
        { label: "Fields granted", value: fieldCount, tone: "accent" },
        { label: "Sys perms granted", value: sysCount, tone: "green" },
      ]} />

      {/* BUG-8 diagnostic strip — tells admins whether the implicit PermissionSet was found. */}
      <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 10, padding: "6px 10px", background: T.bgAlt, border: `1px solid ${T.border}`, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          Implicit PermissionSet:&nbsp;
          {implicitPsId
            ? <span style={{ color: T.green, fontFamily: T.mono }}>{implicitPsId}</span>
            : <span style={{ color: T.yellow }}>not found — Objects/Fields may be empty if your org stores profile perms under the implicit PermissionSet (BUG-8). Check that PermissionSet.csv includes IsOwnedByProfile=true rows with ProfileId populated.</span>}
        </div>
        {/* BUG-15 v2.8: diagnostics toggle. */}
        <button className="pe-btn ghost" onClick={() => setShowDiag(v => !v)} style={{ fontSize: 11 }}>
          {showDiag ? "Hide diagnostics" : "Show diagnostics"}
        </button>
      </div>

      {/* BUG-15 v2.8: diagnostics panel — only rendered when toggled. */}
      {showDiag && <ProfileDiagnosticsPanel idx={idx} profile={profile} fanoutIds={fanoutIds} implicitPsId={implicitPsId} />}

      <SubSectionTable title="Assigned Users" rows={sortedAssigned}
        columns={[
          { key: "Name", label: "Name", render: r => <span onClick={e => { e.stopPropagation(); nav({ kind: "User", item: r }); }} style={{ color: T.accentLight, cursor: "pointer" }}>{r.Name}</span> },
          { key: "Email", label: "Email" },
          { key: "LastLoginDate", label: "Last login (ascending, dormant first)" },
        ]}
        getRowId={r => r.Id} emptyText="No users assigned to this profile." />

      <ParentDetailSubSections idx={idx} parentId={profile.Id}
        onNavObject={s => nav({ kind: "Object", item: { SobjectType: s } })}
        onNavField={f => nav({ kind: "Field", item: { Field: f } })}
        onDiag={() => setShowDiag(true)}
      />
    </div>
  );
}

// BUG-15 v2.8: Profile detail diagnostics panel.
// Dumps the data needed to diagnose "Why is my Profile detail showing zero rows
// here when SOQL says there are N?":
//   - Profile.Id
//   - implicitPermSetId (or null)
//   - profileFanoutIds output (what the app actually iterates)
//   - Profile-direct Permissions* boolean columns that are true
//   - per-index row counts for every fan-out id
//   - final rendered row count (mirrors StatsRow)
// This is intentionally read-only and self-contained. If an index is absent on
// the supplied idx (e.g. profileBooleansBySystemPermissionKey on an older build),
// the panel renders "—" rather than throwing.
function ProfileDiagnosticsPanel({ idx, profile, fanoutIds, implicitPsId }) {
  const directBools = (idx.profileBooleansBySystemPermissionKey
    && idx.profileBooleansBySystemPermissionKey.get(profile.Id))
    || new Map();
  const directBoolList = [...directBools.keys()].sort();
  const indexCounts = fanoutIds.map(id => {
    const objN = (idx.objPermsByParent.get(id) || []).length;
    const fldN = (idx.fieldPermsByParent.get(id) || []).length;
    const sp = idx.sysPermsByParent.get(id);
    const sysN = sp ? Object.values(sp.perms).filter(Boolean).length : 0;
    const tabN = (idx.tabsByParent.get(id) || []).length;
    const setupN = (idx.setupByParent.get(id) || []).length;
    return { id, objN, fldN, sysN, tabN, setupN };
  });
  const totals = indexCounts.reduce((t, r) => ({
    objN: t.objN + r.objN,
    fldN: t.fldN + r.fldN,
    sysN: t.sysN + r.sysN,
    tabN: t.tabN + r.tabN,
    setupN: t.setupN + r.setupN,
  }), { objN: 0, fldN: 0, sysN: 0, tabN: 0, setupN: 0 });
  const rowStyle = { padding: "4px 8px", borderBottom: `1px solid ${T.border}`, fontFamily: T.mono, fontSize: 11 };
  const headerStyle = { ...rowStyle, color: T.textMuted, background: T.bgAlt, fontWeight: 600 };
  return (
    <div style={{ marginBottom: 14, border: `1px solid ${T.border}`, borderRadius: 6, background: T.bg, overflow: "hidden" }}>
      <div style={{ padding: "8px 12px", background: T.bgAlt, borderBottom: `1px solid ${T.border}`, fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
        <Pill tone="yellow">Diagnostics</Pill>
        <span>Profile detail — what the indexer sees</span>
      </div>
      <div style={rowStyle}>Profile.Id: <span style={{ color: T.accentLight }}>{profile.Id}</span></div>
      <div style={rowStyle}>
        Implicit PermissionSet.Id: {implicitPsId
          ? <span style={{ color: T.green }}>{implicitPsId}</span>
          : <span style={{ color: T.yellow }}>null (no IsOwnedByProfile row found)</span>}
      </div>
      <div style={rowStyle}>
        profileFanoutIds(...) = [{fanoutIds.map((id, i) => (
          <span key={id}>
            {i > 0 && ", "}
            <span style={{ color: T.accentLight }}>{id}</span>
          </span>
        ))}]
      </div>
      <div style={rowStyle}>
        Profile-direct Permissions* columns (true): {directBoolList.length === 0
          ? <span style={{ color: T.textMuted }}>— none —</span>
          : <span style={{ color: T.green }}>{directBoolList.join(", ")}</span>}
      </div>
      <div style={headerStyle}>
        ParentId fan-out counts (objPermsByParent / fieldPermsByParent / sysPermsByParent / tabsByParent / setupByParent):
      </div>
      {indexCounts.map(r => (
        <div key={r.id} style={rowStyle}>
          <span style={{ color: T.accentLight }}>{r.id}</span>
          {"  "}obj={r.objN}  fld={r.fldN}  sys={r.sysN}  tabs={r.tabN}  setup={r.setupN}
        </div>
      ))}
      <div style={{ ...rowStyle, background: T.bgAlt, fontWeight: 600 }}>
        totals (what the detail view will render):
        {"  "}obj={totals.objN}  fld={totals.fldN}  sys={totals.sysN}  tabs={totals.tabN}  setup={totals.setupN}
      </div>
      <div style={{ ...rowStyle, color: T.textMuted, fontFamily: "inherit", fontSize: 11 }}>
        If your SOQL count differs from the totals above, the most likely cause is
        that your export wrote profile permissions under a <code>PermSet</code> whose
        <code> IsOwnedByProfile</code> flag was not set to <code>true</code>, so the
        indexer didn't wire that PS into the profile fan-out. The second most
        common cause is a Profile row carrying <code>Permissions*</code> booleans
        that aren't yet columns of SystemPermissions_PermSet.csv — in which case
        the "Profile-direct" row above should list them and they will appear in
        the System Perms table with source <em>Profile (direct)</em>.
      </div>
    </div>
  );
}

function PermSetDetail({ idx, permSet, nav }) {
  // UX-7 Assigned users, direct + via group.
  const directRows = (idx.psaByPermSet.get(permSet.Id) || []).filter(a => !a.GroupId);
  const viaGroupRows = (idx.psaByPermSet.get(permSet.Id) || []).filter(a => a.GroupId);
  const userByA = a => idx.userById.get(a.UserId);

  const assignedRows = [];
  const seen = new Set();
  for (const a of directRows) {
    if (seen.has(a.UserId)) continue;
    const u = userByA(a); if (!u) continue;
    assignedRows.push({ Id: u.Id, Name: u.Name, Email: u.Email, Profile: u["Profile.Name"], Via: "Direct", u });
    seen.add(a.UserId);
  }
  for (const a of viaGroupRows) {
    const u = userByA(a); if (!u) continue;
    const g = idx.groupById.get(a.GroupId);
    assignedRows.push({ Id: `${u.Id}|${a.GroupId}`, Name: u.Name, Email: u.Email, Profile: u["Profile.Name"], Via: `via ${g ? g.MasterLabel : a.GroupId}`, u });
  }

  return (
    <div className="pe-fade">
      <Breadcrumb nav={nav} items={[{ label: "Permission Sets" }, { label: permSet.Label }]} />
      <HeaderBlock title={permSet.Label} subtitle={permSet.Description || permSet.Name}
        tags={[
          <Pill key="t" tone="purple">PermSet</Pill>,
          permSet.Type === "Muting" && <Pill key="m" tone="red">Muting</Pill>,
          toBool(permSet.IsCustom) && <Pill key="c" tone="accent">Custom</Pill>,
        ].filter(Boolean)} />
      <StatsRow stats={[
        { label: "Assigned users", value: assignedRows.length, tone: "cyan" },
        { label: "Objects granted", value: (idx.objPermsByParent.get(permSet.Id) || []).length, tone: "purple" },
        { label: "Fields granted", value: (idx.fieldPermsByParent.get(permSet.Id) || []).length, tone: "accent" },
      ]} />

      <SubSectionTable title="Assigned Users" rows={assignedRows} columns={[
        { key: "Name", label: "Name", render: r => <span onClick={e => { e.stopPropagation(); nav({ kind: "User", item: r.u }); }} style={{ color: T.accentLight, cursor: "pointer" }}>{r.Name}</span> },
        { key: "Email", label: "Email" },
        { key: "Profile", label: "Profile" },
        { key: "Via", label: "Source", render: r => r.Via === "Direct" ? <Pill tone="green">Direct</Pill> : <Pill tone="cyan">{r.Via}</Pill> },
      ]} getRowId={r => r.Id} emptyText="No active standard users assigned." />

      <ParentDetailSubSections idx={idx} parentId={permSet.Id}
        onNavObject={s => nav({ kind: "Object", item: { SobjectType: s } })}
        onNavField={f => nav({ kind: "Field", item: { Field: f } })}
      />
    </div>
  );
}

function GroupDetail({ idx, group, nav }) {
  const members = idx.groupMembers.get(group.Id) || [];
  // Enrich with Type, label, etc.
  const enriched = members.map(m => {
    const ps = idx.permSetById.get(m.PermissionSetId);
    return { ...m, Label: ps ? ps.Label : m.PermissionSetName, Type: ps ? ps.Type : "", ps };
  });
  return (
    <div className="pe-fade">
      <Breadcrumb nav={nav} items={[{ label: "PermSet Groups" }, { label: group.MasterLabel }]} />
      <HeaderBlock title={group.MasterLabel} subtitle={group.Description || group.DeveloperName}
        tags={[<Pill key="t" tone="purple">PermSet Group</Pill>]} />

      <SubSectionTable title="Member PermSets" rows={enriched} columns={[
        { key: "Label", label: "Permission Set", render: r => <span onClick={e => { e.stopPropagation(); if (r.ps) nav({ kind: "PermissionSet", item: r.ps }); }} style={{ color: T.accentLight, cursor: r.ps ? "pointer" : "default" }}>{r.Label}</span> },
        { key: "Type", label: "Role", render: r => r.Type === "Muting" ? <Pill tone="red">Muting</Pill> : <Pill tone="green">Additive</Pill> },
      ]} getRowId={r => r.PermissionSetId} emptyText="No member PermSets." />

      {/* Aggregate grants — union of members excluding Muting, minus muting-member contributions */}
      <GroupAggregate idx={idx} group={group} nav={nav} />
    </div>
  );
}

function GroupAggregate({ idx, group, nav }) {
  const members = idx.groupMembers.get(group.Id) || [];
  // Build a pseudo-user's effective view by unioning members and subtracting mutes.
  const grantObj = new Map();
  const muteObj = new Map();
  const grantFld = new Map();
  const muteFld = new Map();
  for (const m of members) {
    const ps = idx.permSetById.get(m.PermissionSetId);
    const isMute = ps && ps.Type === "Muting";
    for (const r of idx.objPermsByParent.get(m.PermissionSetId) || []) {
      const target = isMute ? muteObj : grantObj;
      let cur = target.get(r.SobjectType);
      if (!cur) { cur = { SobjectType: r.SobjectType, c:false,r:false,e:false,d:false,va:false,ma:false }; target.set(r.SobjectType, cur); }
      ["c","r","e","d","va","ma"].forEach(k => { if (r[k]) cur[k] = true; });
    }
    for (const r of idx.fieldPermsByParent.get(m.PermissionSetId) || []) {
      const target = isMute ? muteFld : grantFld;
      let cur = target.get(r.Field);
      if (!cur) { cur = { Field: r.Field, SobjectType: r.SobjectType, read:false, edit:false }; target.set(r.Field, cur); }
      if (r.read) cur.read = true; if (r.edit) cur.edit = true;
    }
  }
  for (const [k, m] of muteObj) {
    const g = grantObj.get(k); if (!g) continue;
    ["c","r","e","d","va","ma"].forEach(kk => { if (m[kk] && g[kk]) g[kk] = false; });
  }
  for (const [k, m] of muteFld) {
    const g = grantFld.get(k); if (!g) continue;
    if (m.read) g.read = false; if (m.edit) g.edit = false;
  }
  return (
    <>
      <SubSectionTable title="Group — Effective Objects"
        rows={[...grantObj.values()]}
        columns={[
          { key: "SobjectType", label: "Object" },
          { key: "c", label: "C", render: r => <BoolFlag v={r.c} /> }, { key: "r", label: "R", render: r => <BoolFlag v={r.r} /> },
          { key: "e", label: "E", render: r => <BoolFlag v={r.e} /> }, { key: "d", label: "D", render: r => <BoolFlag v={r.d} /> },
        ]} getRowId={r => r.SobjectType} emptyText="No effective object permissions." />
      <SubSectionTable title="Group — Effective Fields"
        rows={[...grantFld.values()]}
        columns={[{ key: "Field", label: "Field", render: r => <span onClick={e => { e.stopPropagation(); nav({ kind: "Field", item: { Field: r.Field } }); }} style={{ fontFamily: T.mono, color: T.accentLight, cursor: "pointer" }}>{r.Field}</span> },
          { key: "SobjectType", label: "Object", width: 140 }, { key: "read", label: "Read", render: r => <BoolFlag v={r.read} /> }, { key: "edit", label: "Edit", render: r => <BoolFlag v={r.edit} /> }]}
        getRowId={r => r.Field} emptyText="No effective field permissions." />
    </>
  );
}

// User detail — provenance + muted (UX-8)
function UserDetail({ idx, user, nav }) {
  const sources = userSources(idx, user.Id);
  const effObjects = effectiveObjects(idx, user.Id);
  const { grant: effFields, mute: muteFields } = effectiveFields(idx, user.Id);
  const effSys = effectiveSysPerms(idx, user.Id);
  const profile = idx.profileById.get(user.ProfileId);
  const role = idx.roleById.get(user.UserRoleId);
  // UX-23: toggle to hide objects where every CRUD/VA/MA flag is false (muted or never granted).
  // BUG-12 v2.7: cascadeObject / setCascadeObject drive the Object -> Field cascade.
  const { hideZeroGrantObjects, setHideZeroGrantObjects, cascadeObject, setCascadeObject } = useAppState();

  const sourceTag = s => {
    if (s.kind === "profile") return `Profile: ${s.label}`;
    if (s.kind === "permset") return `PermSet: ${s.label}`;
    if (s.kind === "groupmember") return `Group: ${s.groupLabel} → ${s.label}`;
    if (s.kind === "muting") return `Muting: ${s.groupLabel} → ${s.label}`;
    return s.label;
  };

  const objRows = [...effObjects.entries()].map(([sobj, v]) => {
    const allSrcs = Object.values(v.sources).flat();
    return {
      SobjectType: sobj, c: v.c, r: v.r, e: v.e, d: v.d, va: v.va, ma: v.ma,
      sources: [...new Set(allSrcs.map(sourceTag))].join(" + "),
      srcObjs: allSrcs,
      anyGrant: !!(v.c || v.r || v.e || v.d || v.va || v.ma),
    };
  });
  const objRowsFiltered = hideZeroGrantObjects ? objRows.filter(r => r.anyGrant) : objRows;
  const fieldRows = [...effFields.entries()].filter(([, v]) => v.read || v.edit).map(([field, v]) => {
    const srcObjs = [...(v.sources.read||[]), ...(v.sources.edit||[])];
    return {
      Field: field, SobjectType: v.SobjectType, read: v.read, edit: v.edit,
      sources: [...new Set(srcObjs.map(sourceTag))].join(" + "),
      srcObjs,
    };
  });
  const mutedRows = [...muteFields.entries()].map(([field, v]) => ({
    Field: field, SobjectType: v.SobjectType,
    mutedBy: [...new Set([...(v.sources.read||[]), ...(v.sources.edit||[])].map(sourceTag))].join(" + "),
  }));
  const sysRows = Object.entries(effSys).map(([perm, v]) => ({ perm, sources: [...new Set(v.sources.map(sourceTag))].join(" + ") }));

  return (
    <div className="pe-fade">
      <Breadcrumb nav={nav} items={[{ label: "Users" }, { label: user.Name }]} />
      <HeaderBlock title={user.Name} subtitle={user.Email}
        tags={[
          <Pill key="p" tone="purple" onClick={() => profile && nav({ kind: "Profile", item: profile })}>{user["Profile.Name"] || (profile && profile.Name)}</Pill>,
          role && <Pill key="r" tone="cyan" onClick={() => nav({ kind: "Role", item: role })}>{role.Name}</Pill>,
        ].filter(Boolean)} />
      <StatsRow stats={[
        { label: "Sources", value: sources.length, tone: "cyan" },
        { label: "Effective objects", value: objRows.length, tone: "purple" },
        { label: "Effective fields", value: fieldRows.length, tone: "accent" },
        { label: "Muted fields", value: mutedRows.length, tone: "red" },
      ]} />

      <SubSectionTable title="Permission Sources" rows={sources} columns={[
        { key: "kind", label: "Kind", render: s => <Pill tone={s.kind === "muting" ? "red" : s.kind === "profile" ? "purple" : "cyan"}>{s.kind}</Pill> },
        { key: "label", label: "Source", render: s => <span>{s.label}</span> },
        { key: "groupLabel", label: "Via Group" },
      ]} getRowId={s => s.id + "|" + s.kind + "|" + (s.groupId || "")} emptyText="No permission sources." />

      {/* UX-23: toggle — hide objects with zero grants (fully muted or unreferenced). */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 4, fontSize: 12, color: T.textMuted }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={hideZeroGrantObjects} onChange={e => setHideZeroGrantObjects(e.target.checked)} />
          Hide zero-grant objects
        </label>
        <span style={{ opacity: .7 }}>
          Showing {objRowsFiltered.length.toLocaleString()} of {objRows.length.toLocaleString()}
        </span>
      </div>
      {/* BUG-12 v2.7: Object -> Field cascade.
          Clicking an Object row sets cascadeObject for this user scope so the
          Effective Fields sub-section filters to that object. The selected row
          shows an accent ring; a "Scoped to <X> — Clear scope" pill renders
          above the Fields table.
      */}
      {(() => {
        const scopeId = "user:" + user.Id;
        const scoped = cascadeObject[scopeId] || null;
        return (
          <>
            <SubSectionTable title="Effective Objects" rows={objRowsFiltered} columns={[
              { key: "SobjectType", label: "Object",
                render: r => (
                  <span
                    onClick={e => { e.stopPropagation();
                      setCascadeObject(prev => ({ ...prev, [scopeId]: prev[scopeId] === r.SobjectType ? null : r.SobjectType }));
                    }}
                    style={{
                      cursor: "pointer",
                      color: scoped === r.SobjectType ? T.accentLight : T.text,
                      fontWeight: scoped === r.SobjectType ? 600 : 400,
                      padding: "2px 6px", borderRadius: 4,
                      border: scoped === r.SobjectType ? `1px solid ${T.borderActive}` : "1px solid transparent",
                      background: scoped === r.SobjectType ? T.accentBg : "transparent",
                    }}>{r.SobjectType}</span>
                ) },
              { key: "c", label: "C", render: r => <BoolFlag v={r.c} /> },
              { key: "r", label: "R", render: r => <BoolFlag v={r.r} /> },
              { key: "e", label: "E", render: r => <BoolFlag v={r.e} /> },
              { key: "d", label: "D", render: r => <BoolFlag v={r.d} /> },
              { key: "sources", label: "Granted by", render: r => <GrantPillCell sources={r.srcObjs} idx={idx} /> },
            ]} getRowId={r => r.SobjectType} emptyText="No effective object permissions." />

            {/* BUG-12 v2.7: scope pill. */}
            {scoped && (
              <div style={{ margin: "6px 0", display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                <Pill tone="accent">Scoped to {scoped}</Pill>
                <button className="pe-btn ghost" style={{ fontSize: 11, padding: "2px 8px" }}
                  onClick={() => setCascadeObject(prev => ({ ...prev, [scopeId]: null }))}>Clear scope</button>
              </div>
            )}

            {/* UX-48 v2.7: drop Object column when cascade active. When off,
                group rows under Object headers (see groupByObject rendering). */}
            {scoped ? (
              <SubSectionTable title={`Effective Fields — ${scoped}`}
                rows={fieldRows.filter(r => r.SobjectType === scoped)}
                columns={[
                  { key: "Field", label: "Field",
                    render: r => (
                      <span title={r.Field} style={{
                        fontFamily: T.mono, color: T.accentLight,
                        display: "inline-block", maxWidth: 240,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{r.Field}</span>) },
                  { key: "read", label: "Read", render: r => <BoolFlag v={r.read} /> },
                  { key: "edit", label: "Edit", render: r => <BoolFlag v={r.edit} /> },
                  { key: "sources", label: "Granted by", render: r => <GrantPillCell sources={r.srcObjs} idx={idx} /> },
                ]} getRowId={r => r.Field} emptyText={`No field grants on ${scoped}.`} />
            ) : (
              <GroupedFieldsByObject fieldRows={fieldRows} idx={idx} />
            )}
          </>
        );
      })()}

      {mutedRows.length > 0 && (
        <SubSectionTable title="Muted Fields" rows={mutedRows} columns={[
          { key: "Field", label: "Field", render: r => <span style={{ fontFamily: T.mono, textDecoration: "line-through", color: T.red }}>{r.Field}</span> },
          { key: "SobjectType", label: "Object" },
          { key: "mutedBy", label: "Muted by", render: r => <Pill tone="red">{r.mutedBy}</Pill> },
        ]} getRowId={r => r.Field} emptyText="" />
      )}

      <SubSectionTable title="System Permissions" rows={sysRows} columns={[
        { key: "perm", label: "Permission", render: r => <span style={{ fontFamily: T.mono, color: T.accentLight }}>{r.perm}</span> },
        { key: "sources", label: "Sources", render: r => <span style={{ color: T.textMuted, fontSize: 11 }}>{r.sources}</span> },
      ]} getRowId={r => r.perm} emptyText="No system permissions granted." />
    </div>
  );
}

// Object detail — reverse lookup + drill-to-fields
function ObjectDetail({ idx, obj, nav }) {
  const name = obj.SobjectType;
  const opRows = idx.objPermsBySobj.get(name) || [];
  const fpRows = idx.fieldPermsBySobj.get(name) || [];
  // Group field rows by Field to show "who grants what" for each field.
  const fieldsByName = new Map();
  for (const r of fpRows) {
    let cur = fieldsByName.get(r.Field);
    if (!cur) { cur = { Field: r.Field, readers: 0, editors: 0 }; fieldsByName.set(r.Field, cur); }
    if (r.read) cur.readers++;
    if (r.edit) cur.editors++;
  }

  return (
    <div className="pe-fade">
      <Breadcrumb nav={nav} items={[{ label: "Objects" }, { label: name }]} />
      <HeaderBlock title={name} subtitle="Object permission reverse lookup" tags={[<Pill key="t" tone="purple">Object</Pill>]} />

      <StatsRow stats={[
        { label: "Grantors", value: opRows.length, tone: "purple" },
        { label: "Fields tracked", value: fieldsByName.size, tone: "accent" },
      ]} />

      <SubSectionTable title="Grantors (Profiles & PermSets)" rows={opRows} columns={[
        { key: "ParentName", label: "Grantor", render: r => <span onClick={e => { e.stopPropagation(); const ps = idx.permSetById.get(r.ParentId); const pr = idx.profileById.get(r.ParentId); if (ps) nav({ kind: "PermissionSet", item: ps }); else if (pr) nav({ kind: "Profile", item: pr }); }} style={{ color: T.accentLight, cursor: "pointer" }}>{r.ParentName || r.ParentId}</span> },
        { key: "Owner", label: "Kind", render: r => <Pill tone={r.IsOwnedByProfile ? "purple" : "accent"}>{r.IsOwnedByProfile ? "Profile" : "PermSet"}</Pill> },
        { key: "c", label: "C", render: r => <BoolFlag v={r.c} /> },
        { key: "r", label: "R", render: r => <BoolFlag v={r.r} /> },
        { key: "e", label: "E", render: r => <BoolFlag v={r.e} /> },
        { key: "d", label: "D", render: r => <BoolFlag v={r.d} /> },
        { key: "va", label: "VA", render: r => <BoolFlag v={r.va} /> },
        { key: "ma", label: "MA", render: r => <BoolFlag v={r.ma} /> },
      ]} getRowId={r => r.ParentId} emptyText="No grantors." />

      <SubSectionTable title="Fields on this Object" rows={[...fieldsByName.values()]} columns={[
        { key: "Field", label: "Field", render: r => <span onClick={e => { e.stopPropagation(); nav({ kind: "Field", item: { Field: r.Field } }); }} style={{ fontFamily: T.mono, color: T.accentLight, cursor: "pointer" }}>{r.Field}</span> },
        { key: "readers", label: "Grantors (Read)" },
        { key: "editors", label: "Grantors (Edit)" },
      ]} getRowId={r => r.Field} emptyText="No field-level permissions on this object." />
    </div>
  );
}

// Field detail — provenance chain (UX-11)
function FieldDetail({ idx, field, nav }) {
  const name = field.Field;
  const rows = idx.fieldPermsByField.get(name) || [];
  const profileGrants = [];
  const permsetGrants = [];
  const groupGrants = [];
  const mutingGrants = [];

  // Build reverse map from PermSetId -> Groups (for provenance chain)
  const psToGroups = new Map();
  for (const [gId, members] of idx.groupMembers.entries()) for (const m of members) {
    if (!psToGroups.has(m.PermissionSetId)) psToGroups.set(m.PermissionSetId, []);
    psToGroups.get(m.PermissionSetId).push(gId);
  }

  for (const r of rows) {
    const ps = idx.permSetById.get(r.ParentId);
    const pr = idx.profileById.get(r.ParentId);
    const base = { ParentId: r.ParentId, ParentName: r.ParentName, read: r.read, edit: r.edit };
    if (pr) profileGrants.push({ ...base, name: pr.Name });
    else if (ps) {
      if (ps.Type === "Muting") mutingGrants.push({ ...base, name: ps.Label, groupIds: psToGroups.get(r.ParentId) || [], isProfileOwned: toBool(ps.IsOwnedByProfile) });
      else {
        const groupIds = psToGroups.get(r.ParentId) || [];
        const groupNames = groupIds.map(g => (idx.groupById.get(g) || {}).MasterLabel || g);
        if (groupIds.length) groupGrants.push({ ...base, name: ps.Label, groupIds, groupNames, isProfileOwned: toBool(ps.IsOwnedByProfile) });
        permsetGrants.push({ ...base, name: ps.Label, isProfileOwned: toBool(ps.IsOwnedByProfile) });
      }
    }
  }

  return (
    <div className="pe-fade">
      <Breadcrumb nav={nav} items={[{ label: "Fields" }, { label: name }]} />
      <HeaderBlock title={name} subtitle="Field-level permission provenance"
        tags={[<Pill key="t" tone="purple">Field</Pill>]} />

      <SubSectionTable title="Profile Grants" rows={profileGrants} columns={[
        { key: "name", label: "Profile", render: r => <span onClick={() => { const pr = idx.profileById.get(r.ParentId); if (pr) nav({ kind: "Profile", item: pr }); }} style={{ color: T.accentLight, cursor: "pointer" }}>{r.name}</span> },
        { key: "read", label: "Read", render: r => <BoolFlag v={r.read} /> },
        { key: "edit", label: "Edit", render: r => <BoolFlag v={r.edit} /> },
      ]} getRowId={r => r.ParentId} emptyText="No profile grants." />

      <SubSectionTable title="Permission Set Grants" rows={permsetGrants} columns={[
        { key: "name", label: "PermSet", render: r => <span onClick={() => { const ps = idx.permSetById.get(r.ParentId); if (ps) nav({ kind: "PermissionSet", item: ps }); }} style={{ color: T.accentLight, cursor: "pointer" }}>{r.name}</span> },
        { key: "profileOwned", label: "Profile-owned", render: r => r.isProfileOwned ? <Pill tone="purple">Profile-owned</Pill> : <Pill tone="mute">Standalone</Pill> },
        { key: "read", label: "Read", render: r => <BoolFlag v={r.read} /> },
        { key: "edit", label: "Edit", render: r => <BoolFlag v={r.edit} /> },
      ]} getRowId={r => r.ParentId} emptyText="No PermSet grants." />

      <SubSectionTable title="Permission Set Group Grants" rows={groupGrants} columns={[
        { key: "groupName", label: "Group", render: r => (r.groupNames || []).join(", ") },
        { key: "name", label: "→ PermSet", render: r => <span onClick={() => { const ps = idx.permSetById.get(r.ParentId); if (ps) nav({ kind: "PermissionSet", item: ps }); }} style={{ color: T.accentLight, cursor: "pointer" }}>{r.name}</span> },
        { key: "profileOwned", label: "Profile-owned", render: r => r.isProfileOwned ? <Pill tone="purple">Profile-owned</Pill> : <Pill tone="mute">Standalone</Pill> },
        { key: "read", label: "Read", render: r => <BoolFlag v={r.read} /> },
        { key: "edit", label: "Edit", render: r => <BoolFlag v={r.edit} /> },
      ]} getRowId={r => r.ParentId + "|" + (r.groupIds||[]).join(",")} emptyText="No group-derived grants." />

      <SubSectionTable title="Muting PermSets (suppress this field)" rows={mutingGrants} columns={[
        { key: "name", label: "Muting PermSet", render: r => <Pill tone="red">{r.name}</Pill> },
        { key: "groupNames", label: "Via Group", render: r => (r.groupIds || []).map(g => (idx.groupById.get(g) || {}).MasterLabel || g).join(", ") },
      ]} getRowId={r => r.ParentId + "|m"} emptyText="No muting PermSets suppress this field." />
    </div>
  );
}

function RoleDetail({ idx, role, nav }) {
  const users = idx.usersByRole.get(role.Id) || [];
  // Role hierarchy - ancestors (parent chain) and direct children
  const ancestors = [];
  let cur = role;
  while (cur && cur.ParentRoleId) {
    const p = idx.roleById.get(cur.ParentRoleId);
    if (!p || p.Id === cur.Id) break;
    ancestors.unshift(p); cur = p;
  }
  const children = idx.roles.filter(r => r.ParentRoleId === role.Id);

  // UX-12 — show consistency across users in the role
  const comparison = users.map(u => {
    const sigs = [...grantorSignature(idx, u.ProfileId || "")];
    const assigns = idx.psaByUser.get(u.Id) || [];
    for (const a of assigns) grantorSignature(idx, a.PermSetId).forEach(s => sigs.push(s));
    return { userId: u.Id, name: u.Name, size: new Set(sigs).size };
  });

  return (
    <div className="pe-fade">
      <Breadcrumb nav={nav} items={[{ label: "Roles" }, { label: role.Name }]} />
      <HeaderBlock title={role.Name} subtitle={role.DeveloperName} tags={[<Pill key="t" tone="cyan">Role</Pill>]} />

      <SubSectionTable title="Hierarchy — Ancestors" rows={ancestors} columns={[
        { key: "Name", label: "Role", render: r => <span onClick={() => nav({ kind: "Role", item: r })} style={{ color: T.accentLight, cursor: "pointer" }}>{r.Name}</span> },
      ]} getRowId={r => r.Id} emptyText="Top of hierarchy." />

      <SubSectionTable title="Hierarchy — Children" rows={children} columns={[
        { key: "Name", label: "Role", render: r => <span onClick={() => nav({ kind: "Role", item: r })} style={{ color: T.accentLight, cursor: "pointer" }}>{r.Name}</span> },
      ]} getRowId={r => r.Id} emptyText="No child roles." />

      <SubSectionTable title="Users in Role" rows={users} columns={[
        { key: "Name", label: "Name", render: r => <span onClick={() => nav({ kind: "User", item: r })} style={{ color: T.accentLight, cursor: "pointer" }}>{r.Name}</span> },
        { key: "Profile.Name", label: "Profile" },
        { key: "Email", label: "Email" },
      ]} getRowId={r => r.Id} emptyText="No users in this role." />

      <SubSectionTable title="Permission Footprint (unique grant tokens)" rows={comparison} columns={[
        { key: "name", label: "User" },
        { key: "size", label: "# grant tokens" },
      ]} getRowId={r => r.userId} emptyText="" />
    </div>
  );
}

/* ---- Misc shared layout bits --------------------------------------------- */
function Breadcrumb({ nav, items }) {
  return (
    <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 10 }}>
      {items.map((it, i) => (
        <span key={i}>{i > 0 && <span style={{ opacity: .5 }}> / </span>}<span>{it.label}</span></span>
      ))}
    </div>
  );
}

function HeaderBlock({ title, subtitle, tags }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{title}</div>
        <div style={{ display: "flex", gap: 6 }}>{tags}</div>
      </div>
      {subtitle && <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

function StatsRow({ stats }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${stats.length}, 1fr)`, gap: 10, marginBottom: 16 }}>
      {stats.map((s, i) => <StatCard key={i} label={s.label} value={s.value} tone={s.tone} />)}
    </div>
  );
}

// ---- v2.6 UX-19 detail views for Apex Class / Visualforce Page / Custom Permission ----
// Each of these surfaces "who grants access to this entity" by scanning SetupEntityAccess.
// The rows list PermSet/PermSetGroup/Profile sources so admins can trace the grant chain.
function SetupEntityDetail({ idx, item, nav, kind }) {
  const setupId = item.SetupEntityId || item.Id;
  // Walk every PermissionSet's SetupEntityAccess rows and find matches for this setupId.
  const grantingPs = useMemo(() => {
    const out = [];
    for (const [parentId, rows] of idx.setupByParent.entries()) {
      if (rows.some(r => r.SetupEntityId === setupId && r.SetupEntityType === kind)) {
        const ps = idx.permSetById.get(parentId);
        if (ps) out.push(ps);
      }
    }
    return out.sort((a, b) => (a.Label || a.Name || "").localeCompare(b.Label || b.Name || ""));
  }, [idx, setupId, kind]);

  // Figure out which profiles grant it (via their implicit PS).
  const grantingProfiles = useMemo(() => {
    const out = [];
    const m = idx.profileImplicitPsByProfileId;
    if (!m) return out;
    for (const [profileId, implicitPsId] of m.entries()) {
      const rows = idx.setupByParent.get(implicitPsId) || [];
      if (rows.some(r => r.SetupEntityId === setupId && r.SetupEntityType === kind)) {
        const p = idx.profileById.get(profileId);
        if (p) out.push(p);
      }
    }
    return out.sort((a, b) => (a.Name || "").localeCompare(b.Name || ""));
  }, [idx, setupId, kind]);

  // Count impacted users = active users whose effective access includes this setup entity.
  const impactedUserCount = useMemo(() => {
    let n = 0;
    for (const u of idx.userById.values()) {
      if (!toBool(u.IsActive)) continue;
      const srcs = userSources(idx, u.Id);
      let hit = false;
      for (const s of srcs) {
        if (s.kind === "muting") continue;
        const ids = s.kind === "profile" ? profileFanoutIds(idx, s.id) : [s.id];
        for (const pid of ids) {
          const rows = idx.setupByParent.get(pid) || [];
          if (rows.some(r => r.SetupEntityId === setupId && r.SetupEntityType === kind)) { hit = true; break; }
        }
        if (hit) break;
      }
      if (hit) n++;
    }
    return n;
  }, [idx, setupId, kind]);

  const kindLabel = kind === "ApexClass" ? "Apex Class" : (kind === "ApexPage" ? "Visualforce Page" : kind);
  return (
    <div>
      <HeaderBlock
        title={setupId}
        subtitle={`${kindLabel} — granted by ${grantingPs.length} permission set${grantingPs.length === 1 ? "" : "s"} + ${grantingProfiles.length} profile${grantingProfiles.length === 1 ? "" : "s"}`}
        tags={[<Pill key="k" tone={kind === "ApexClass" ? "green" : "yellow"}>{kindLabel}</Pill>]}
      />
      <StatsRow stats={[
        { label: "Permission Sets", value: grantingPs.length, tone: "accent" },
        { label: "Profiles (via implicit PS)", value: grantingProfiles.length, tone: "purple" },
        { label: "Impacted active users", value: impactedUserCount, tone: impactedUserCount > 0 ? "cyan" : "muted" },
      ]} />
      <SubSectionTable title="Granting Permission Sets" rows={grantingPs} columns={[
        { key: "Label", label: "Label", render: r => <span onClick={() => nav({ kind: "PermissionSet", item: r })} style={{ color: T.accentLight, cursor: "pointer" }}>{r.Label}</span> },
        { key: "Name", label: "API Name" },
        { key: "Type", label: "Type", render: r => <Pill tone={r.Type === "Muting" ? "orange" : "muted"}>{r.Type || "Regular"}</Pill> },
      ]} getRowId={r => r.Id} emptyText="No PermSets grant this." />
      <SubSectionTable title="Granting Profiles (via implicit PermSet)" rows={grantingProfiles} columns={[
        { key: "Name", label: "Profile", render: r => <span onClick={() => nav({ kind: "Profile", item: r })} style={{ color: T.accentLight, cursor: "pointer" }}>{r.Name}</span> },
        { key: "UserType", label: "UserType" },
      ]} getRowId={r => r.Id} emptyText="No profiles grant this via their implicit PermSet." />
    </div>
  );
}

function CustomPermissionDetail({ idx, item, nav }) {
  // Custom Permissions can be granted via SetupEntityAccess where SetupEntityType='CustomPermission'.
  // The SetupEntityId is typically the DeveloperName for CustomPermission grants (salesforce quirk).
  const key = item.Id || item.DeveloperName;
  const grantingPs = useMemo(() => {
    const out = [];
    for (const [parentId, rows] of idx.setupByParent.entries()) {
      if (rows.some(r => r.SetupEntityType === "CustomPermission" && (r.SetupEntityId === key || r.SetupEntityId === item.DeveloperName || r.SetupEntityId === item.Id))) {
        const ps = idx.permSetById.get(parentId);
        if (ps) out.push(ps);
      }
    }
    return out.sort((a, b) => (a.Label || a.Name || "").localeCompare(b.Label || b.Name || ""));
  }, [idx, key, item]);

  const grantingProfiles = useMemo(() => {
    const out = [];
    const m = idx.profileImplicitPsByProfileId;
    if (!m) return out;
    for (const [profileId, implicitPsId] of m.entries()) {
      const rows = idx.setupByParent.get(implicitPsId) || [];
      if (rows.some(r => r.SetupEntityType === "CustomPermission" && (r.SetupEntityId === key || r.SetupEntityId === item.DeveloperName))) {
        const p = idx.profileById.get(profileId);
        if (p) out.push(p);
      }
    }
    return out.sort((a, b) => (a.Name || "").localeCompare(b.Name || ""));
  }, [idx, key, item]);

  return (
    <div>
      <HeaderBlock
        title={item.MasterLabel || item.DeveloperName}
        subtitle={item.DeveloperName || ""}
        tags={[<Pill key="cp" tone="orange">Custom Permission</Pill>]}
      />
      <StatsRow stats={[
        { label: "Permission Sets granting", value: grantingPs.length, tone: "accent" },
        { label: "Profiles granting", value: grantingProfiles.length, tone: "purple" },
      ]} />
      <SubSectionTable title="Granting Permission Sets" rows={grantingPs} columns={[
        { key: "Label", label: "Label", render: r => <span onClick={() => nav({ kind: "PermissionSet", item: r })} style={{ color: T.accentLight, cursor: "pointer" }}>{r.Label}</span> },
        { key: "Name", label: "API Name" },
      ]} getRowId={r => r.Id} emptyText="No PermSets grant this custom permission." />
      <SubSectionTable title="Granting Profiles" rows={grantingProfiles} columns={[
        { key: "Name", label: "Profile", render: r => <span onClick={() => nav({ kind: "Profile", item: r })} style={{ color: T.accentLight, cursor: "pointer" }}>{r.Name}</span> },
        { key: "UserType", label: "UserType" },
      ]} getRowId={r => r.Id} emptyText="No profiles grant this custom permission." />
    </div>
  );
}

// ---- Explorer sidebar + shell -----------------------------------------------
// v2.6 UX-19: three new entry points — Apex Class, Visualforce Page, Custom Permission —
// each sourced from SetupEntityAccess and cross-referenced with CustomPermission.
const ENTRY_POINTS = [
  { key: "User",          label: "Users",          icon: "⏣", tone: "cyan" },
  { key: "Profile",       label: "Profiles",       icon: "◆", tone: "purple" },
  { key: "PermissionSet", label: "Permission Sets",icon: "◑", tone: "accent" },
  { key: "PermissionSetGroup", label: "PermSet Groups", icon: "◐", tone: "accent" },
  { key: "Object",        label: "Objects",        icon: "◧", tone: "purple" },
  { key: "Field",         label: "Fields",         icon: "✎", tone: "orange" },
  { key: "Role",          label: "Roles",          icon: "❖", tone: "cyan" },
  { key: "ApexClass",     label: "Apex Classes",   icon: "{ }", tone: "green" },
  { key: "VfPage",        label: "Visualforce Pages", icon: "◨", tone: "yellow" },
  { key: "CustomPermission", label: "Custom Permissions", icon: "✦", tone: "orange" },
];

function ExplorerTab({ idx, selection, setSelection }) {
  const [entry, setEntry] = useState(selection ? selection.kind : "User");
  useEffect(() => { if (selection && selection.kind !== entry) setEntry(selection.kind); /* keep in sync */ }, [selection]);
  const [q, setQ] = useState("");

  // Build the list for the selected entry point.
  const listData = useMemo(() => {
    if (!idx) return [];
    if (entry === "User") return [...idx.userById.values()];
    if (entry === "Profile") return [...idx.profileById.values()];
    // v2.6 UX-19: exclude implicit profile-owned PermSets from the Permission Set list —
    // they're an implementation detail of Salesforce, not something admins should edit.
    if (entry === "PermissionSet") return [...idx.permSetById.values()].filter(ps => !toBool(ps.IsOwnedByProfile));
    if (entry === "PermissionSetGroup") return [...idx.groupById.values()];
    if (entry === "Role") return idx.roles;
    if (entry === "Object") {
      const set = new Set(idx.objPermsBySobj.keys());
      for (const k of idx.fieldPermsBySobj.keys()) set.add(k);
      return [...set].sort().map(s => ({ SobjectType: s }));
    }
    if (entry === "Field") {
      return [...idx.fieldPermsByField.keys()].sort().map(f => ({ Field: f }));
    }
    // v2.6 UX-19: ApexClass / VfPage / CustomPermission entry points derived from SetupEntityAccess.
    if (entry === "ApexClass" || entry === "VfPage") {
      const type = entry === "ApexClass" ? "ApexClass" : "ApexPage";
      const set = new Map();
      for (const rows of idx.setupByParent.values()) for (const r of rows) {
        if (r.SetupEntityType !== type) continue;
        if (!set.has(r.SetupEntityId)) set.set(r.SetupEntityId, { SetupEntityId: r.SetupEntityId, SetupEntityType: r.SetupEntityType });
      }
      return [...set.values()].sort((a, b) => a.SetupEntityId.localeCompare(b.SetupEntityId));
    }
    if (entry === "CustomPermission") {
      // Combine from CustomPermission.csv + from SetupEntityAccess rows of type CustomPermission.
      const map = new Map();
      for (const cp of idx.customPermById.values()) {
        map.set(cp.DeveloperName || cp.Id, { Id: cp.Id, DeveloperName: cp.DeveloperName, MasterLabel: cp.MasterLabel });
      }
      for (const rows of idx.setupByParent.values()) for (const r of rows) {
        if (r.SetupEntityType !== "CustomPermission") continue;
        const key = r.SetupEntityId;
        if (!map.has(key)) map.set(key, { Id: key, DeveloperName: key, MasterLabel: key });
      }
      return [...map.values()].sort((a, b) => (a.MasterLabel || a.DeveloperName).localeCompare(b.MasterLabel || b.DeveloperName));
    }
    return [];
  }, [idx, entry]);

  const qLow = q.toLowerCase();
  const filtered = useMemo(() => !qLow ? listData : listData.filter(it => {
    const s = entry === "User" ? `${it.Name} ${it.Email} ${it["Profile.Name"]}` :
      entry === "Profile" ? it.Name :
      entry === "PermissionSet" ? `${it.Label} ${it.Name}` :
      entry === "PermissionSetGroup" ? `${it.MasterLabel} ${it.DeveloperName}` :
      entry === "Role" ? `${it.Name} ${it.DeveloperName}` :
      entry === "Object" ? it.SobjectType :
      entry === "Field" ? it.Field :
      entry === "ApexClass" || entry === "VfPage" ? it.SetupEntityId :
      entry === "CustomPermission" ? `${it.MasterLabel || ""} ${it.DeveloperName || ""}` :
      "";
    return s && s.toLowerCase().includes(qLow);
  }), [listData, qLow, entry]);

  const pick = item => setSelection({ kind: entry, item });

  const renderItem = it => {
    if (entry === "User") return <><div>{it.Name}</div><div style={{ fontSize: 11, color: T.textMuted }}>{it["Profile.Name"]}</div></>;
    if (entry === "Profile") return <><div>{it.Name}</div><div style={{ fontSize: 11, color: T.textMuted }}>{it.UserType}</div></>;
    if (entry === "PermissionSet") return <><div>{it.Label}</div><div style={{ fontSize: 11, color: T.textMuted }}>{it.Type === "Muting" ? "Muting" : (toBool(it.IsCustom) ? "Custom" : "Standard")}</div></>;
    if (entry === "PermissionSetGroup") return <><div>{it.MasterLabel}</div><div style={{ fontSize: 11, color: T.textMuted }}>{it.DeveloperName}</div></>;
    if (entry === "Role") return <><div>{it.Name}</div><div style={{ fontSize: 11, color: T.textMuted }}>{it.DeveloperName}</div></>;
    if (entry === "Object") return <div style={{ fontFamily: T.mono }}>{it.SobjectType}</div>;
    if (entry === "Field") return <div style={{ fontFamily: T.mono }}>{it.Field}</div>;
    if (entry === "ApexClass" || entry === "VfPage")
      return <div style={{ fontFamily: T.mono, fontSize: 12 }}>{it.SetupEntityId}</div>;
    if (entry === "CustomPermission")
      return <><div>{it.MasterLabel || it.DeveloperName}</div><div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>{it.DeveloperName}</div></>;
    return <div>?</div>;
  };
  const itemKey = it => it.Id || it.SobjectType || it.Field || it.SetupEntityId || it.DeveloperName;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", height: "calc(100vh - 70px)" }}>
      <div style={{ borderRight: `1px solid ${T.border}`, background: T.bgAlt, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 12 }}>
          <select className="pe-input" style={{ width: "100%" }} value={entry} onChange={e => { setEntry(e.target.value); setSelection(null); setQ(""); }}>
            {ENTRY_POINTS.map(ep => <option key={ep.key} value={ep.key}>{ep.label}</option>)}
          </select>
          <div style={{ height: 8 }} />
          <SearchInput value={q} onChange={setQ} placeholder={`Search ${entry}s…`} />
          <div style={{ marginTop: 6, fontSize: 11, color: T.textMuted }}>{filtered.length.toLocaleString()} of {listData.length.toLocaleString()}</div>
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          {filtered.slice(0, 2000).map(it => {
            const isSelected = selection && selection.kind === entry && itemKey(selection.item) === itemKey(it);
            return (
              <div key={itemKey(it)} onClick={() => pick(it)}
                className="pe-row"
                style={{
                  padding: "8px 12px",
                  borderLeft: isSelected ? `3px solid ${T.accent}` : "3px solid transparent",
                  background: isSelected ? T.cardHover : "transparent",
                  fontSize: 13, cursor: "pointer",
                }}>{renderItem(it)}</div>
            );
          })}
          {filtered.length > 2000 && <div style={{ padding: 12, color: T.textMuted, fontSize: 11 }}>…showing first 2000. Refine search for more.</div>}
        </div>
      </div>

      <div style={{ overflow: "auto", padding: 24 }}>
        {!selection ? <Empty text={`Pick ${entry === "User" || entry === "Object" || entry === "Field" ? "a " : "a "}${entry} to begin.`} /> : (
          selection.kind === "User" ? <UserDetail idx={idx} user={selection.item} nav={setSelection} /> :
          selection.kind === "Profile" ? <ProfileDetail idx={idx} profile={selection.item} nav={setSelection} /> :
          selection.kind === "PermissionSet" ? <PermSetDetail idx={idx} permSet={selection.item} nav={setSelection} /> :
          selection.kind === "PermissionSetGroup" ? <GroupDetail idx={idx} group={selection.item} nav={setSelection} /> :
          selection.kind === "Object" ? <ObjectDetail idx={idx} obj={selection.item} nav={setSelection} /> :
          selection.kind === "Field" ? <FieldDetail idx={idx} field={selection.item} nav={setSelection} /> :
          selection.kind === "Role" ? <RoleDetail idx={idx} role={selection.item} nav={setSelection} /> :
          selection.kind === "ApexClass" ? <SetupEntityDetail idx={idx} item={selection.item} nav={setSelection} kind="ApexClass" /> :
          selection.kind === "VfPage" ? <SetupEntityDetail idx={idx} item={selection.item} nav={setSelection} kind="ApexPage" /> :
          selection.kind === "CustomPermission" ? <CustomPermissionDetail idx={idx} item={selection.item} nav={setSelection} /> :
          <Empty text="Unknown selection type." />
        )}
      </div>
    </div>
  );
}

/* ============================================================================
 * 12. CHANGE IMPACT TAB (Section 6.2) — 4 scenarios, all typeahead
 * ==========================================================================*/

function ChangeImpactTab({ idx, nav, impactMatrix, setImpactMatrix, deleteCandidates, setDeleteCandidates }) {
  const [scenario, setScenario] = useState("A");
  const scenarios = [
    { key: "A", label: "Remove PermSet from User" },
    { key: "B", label: "Delete PermSet Entirely" },
    { key: "C", label: "Change User Profile" }, /* UX-50 v2.7 */
    { key: "D", label: "Revoke Field from PermSet" },
  ];
  return (
    <div style={{ padding: "24px clamp(16px, 2vw, 48px)", width: "100%", boxSizing: "border-box", margin: "0 auto" }}>
      <Tabs tabs={scenarios} active={scenario} onChange={setScenario} />
      <div style={{ height: 16 }} />
      {scenario === "A" && <ScenarioA idx={idx} nav={nav} impactMatrix={impactMatrix} setImpactMatrix={setImpactMatrix} />}
      {scenario === "B" && <ScenarioB idx={idx} nav={nav} deleteCandidates={deleteCandidates} setDeleteCandidates={setDeleteCandidates} />}
      {scenario === "C" && <ScenarioC idx={idx} nav={nav} />}
      {scenario === "D" && <ScenarioD idx={idx} nav={nav} />}
    </div>
  );
}

// A: UX-14 precompute Impact Matrix
// v2.6 UX-27/29/30/31: three independent filters (User / PermSet / Profile), severity column,
// per-row expansion showing exact lost tokens + covering sources, and "Open in Explorer" cross-link.
function ScenarioA({ idx, nav, impactMatrix, setImpactMatrix }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  // UX-21: persistent filter state via AppState (reopening the tab restores filters).
  const { impactFilterUser, setImpactFilterUser, impactFilterPs, setImpactFilterPs,
          impactFilterProfile, setImpactFilterProfile,
          impactSortKey, setImpactSortKey,
          impactSortDir, setImpactSortDir } = useAppState();
  const [expanded, setExpanded] = useState(() => new Set());

  useEffect(() => {
    if (impactMatrix || running) return;
    setRunning(true);
    setTimeout(() => {
      const rows = precomputeImpactMatrix(idx, (d, t) => setProgress({ done: d, total: t }));
      setImpactMatrix(rows);
      setRunning(false);
    }, 30);
  }, [impactMatrix, running, idx, setImpactMatrix]);

  const rows = impactMatrix || [];

  // UX-27: three independent text filters, AND-combined.
  const filtered = useMemo(() => {
    const uq = (impactFilterUser || "").toLowerCase();
    const pq = (impactFilterPs   || "").toLowerCase();
    const prq= (impactFilterProfile|| "").toLowerCase();
    return rows.filter(r => {
      if (uq && !(r.userName || "").toLowerCase().includes(uq) && !(r.email || "").toLowerCase().includes(uq)) return false;
      if (pq && !(r.permSetLabel || "").toLowerCase().includes(pq) && !(r.groupLabel || "").toLowerCase().includes(pq)) return false;
      if (prq && !(r.profile || "").toLowerCase().includes(prq)) return false;
      return true;
    });
  }, [rows, impactFilterUser, impactFilterPs, impactFilterProfile]);

  // UX-31 / BUG-13 v2.7: sort by severity bucket by default. Total column
  // toggles DESC -> ASC -> unsorted (dir = null) with a visible arrow.
  const sevRank = { high: 3, medium: 2, low: 1, none: 0 };
  const sorted = useMemo(() => {
    const copy = [...filtered];
    const dir = impactSortDir === "asc" ? 1 : -1; // -1 = desc
    if (impactSortKey === "severity") copy.sort((a, b) => dir * ((sevRank[b.severity] - sevRank[a.severity]) || (b.total - a.total)));
    else if (impactSortKey === "total") {
      if (impactSortDir === null) return copy; // BUG-13: unsorted state preserves precompute order
      copy.sort((a, b) => dir * (b.total - a.total));
    }
    else if (impactSortKey === "user")  copy.sort((a, b) => dir * (b.userName||"").localeCompare(a.userName||""));
    return copy;
  }, [filtered, impactSortKey, impactSortDir]);

  // BUG-13 v2.7: clicking the Total header cycles DESC -> ASC -> unsorted.
  const cycleTotalSort = () => {
    if (impactSortKey !== "total") { setImpactSortKey("total"); setImpactSortDir("desc"); return; }
    if (impactSortDir === "desc") { setImpactSortDir("asc"); return; }
    if (impactSortDir === "asc")  { setImpactSortDir(null);  return; }
    setImpactSortDir("desc");
  };
  const totalArrow = impactSortKey === "total"
    ? (impactSortDir === "desc" ? " ▼" : impactSortDir === "asc" ? " ▲" : "")
    : "";

  const toggleRow = key => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const rowKey = r => `${r.userId}|${r.permSetId}|${r.groupLabel||""}`;

  const sevPill = sev =>
    sev === "high"   ? <Pill tone="red">High</Pill> :
    sev === "medium" ? <Pill tone="orange">Med</Pill> :
    sev === "low"    ? <Pill tone="yellow">Low</Pill> :
                       <Pill tone="green">None</Pill>;

  return (
    <div>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: T.glow }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Scenario A — Remove a PermSet from a User</div>
        <div style={{ fontSize: 12, color: T.textMuted }}>
          Precomputed across every (active user × assigned PermSet) pair. Zero-impact rows are safe removals.
          Each row can be expanded to see the exact tokens lost and the covering sources for tokens that
          survive because they're granted elsewhere.
        </div>
        {running && (
          <div style={{ marginTop: 10, fontSize: 12, color: T.textMuted, display: "flex", alignItems: "center", gap: 8 }}>
            <span className="pe-spinner" />
            Analyzing {idx.userById.size.toLocaleString()} users × ~{Math.round((idx.psaByUser.size ? [...idx.psaByUser.values()].reduce((n, a) => n + a.length, 0) / idx.userById.size : 0))} assigned permsets… {progress.total ? `(${progress.done}/${progress.total})` : ""}
          </div>
        )}
      </div>
      {!running && (
        <>
          {/* UX-27: three independent filters + a sort control */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 180px auto", gap: 8, marginBottom: 10 }}>
            <SearchInput value={impactFilterUser || ""} onChange={setImpactFilterUser} placeholder="Filter by user or email…" />
            <SearchInput value={impactFilterPs || ""} onChange={setImpactFilterPs} placeholder="Filter by permset or group…" />
            <SearchInput value={impactFilterProfile || ""} onChange={setImpactFilterProfile} placeholder="Filter by profile…" />
            <select className="pe-input" value={impactSortKey || "severity"} onChange={e => setImpactSortKey(e.target.value)}>
              <option value="severity">Sort: severity</option>
              <option value="total">Sort: total lost</option>
              <option value="user">Sort: user name</option>
            </select>
            <button className="pe-btn ghost" title="Clear all filters"
              onClick={() => { setImpactFilterUser(""); setImpactFilterPs(""); setImpactFilterProfile(""); }}>
              Clear
            </button>
          </div>
          <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6 }}>
            {sorted.length.toLocaleString()} pairs · {sorted.filter(r => r.total === 0).length.toLocaleString()} zero-impact ·
            {" "}{sorted.filter(r => r.severity === "high").length.toLocaleString()} high-severity
          </div>
          <div style={{ maxHeight: 560, overflow: "auto", border: `1px solid ${T.border}`, borderRadius: 8 }}>
            <table className="pe-table">
              <thead><tr>
                <th style={{ width: 24 }}></th>
                <th>User</th><th>Profile</th><th>PermSet</th><th>Via Group</th>
                <th>Severity</th><th>Lost Obj</th><th>Lost Fld</th><th>Lost Sys</th>
                {/* BUG-13 v2.7: clickable Total header toggles DESC -> ASC -> unsorted. */}
                <th onClick={cycleTotalSort} style={{ cursor: "pointer", userSelect: "none" }}
                  title="Click to sort by Total — cycles DESC → ASC → unsorted">
                  Total{totalArrow}
                </th>
                <th style={{ width: 110 }}>Explorer</th>
              </tr></thead>
              <tbody>
                {sorted.slice(0, 2000).map((r, i) => {
                  const k = rowKey(r);
                  const isOpen = expanded.has(k);
                  return (
                    <React.Fragment key={k}>
                      <tr style={{ background: r.total === 0 ? T.greenBg : undefined, cursor: "pointer" }}
                          onClick={() => toggleRow(k)}>
                        <td style={{ color: T.textMuted }}>{isOpen ? "▾" : "▸"}</td>
                        <td><span onClick={e => { e.stopPropagation(); const u = idx.userById.get(r.userId); if (u) nav({ kind: "User", item: u }); }} style={{ color: T.accentLight, cursor: "pointer" }}>{r.userName}</span></td>
                        <td style={{ color: T.textMuted }}>{r.profile}</td>
                        <td><span onClick={e => { e.stopPropagation(); const ps = idx.permSetById.get(r.permSetId); if (ps) nav({ kind: "PermissionSet", item: ps }); }} style={{ color: T.accentLight, cursor: "pointer" }}>{r.permSetLabel}</span></td>
                        <td style={{ color: T.textMuted }}>{r.groupLabel || "—"}</td>
                        <td>{sevPill(r.severity)}</td>
                        <td>{r.lostObjects}</td><td>{r.lostFields}</td><td>{r.lostSys}</td>
                        <td>{r.total === 0 ? <Pill tone="green">Zero</Pill> : <Pill tone="red">{r.total}</Pill>}</td>
                        <td>
                          {/* UX-29: cross-link — open this pair's user in the Explorer tab */}
                          <button className="pe-btn ghost" style={{ fontSize: 11, padding: "2px 6px" }}
                            onClick={e => { e.stopPropagation(); const u = idx.userById.get(r.userId); if (u) nav({ kind: "User", item: u }); }}>
                            Open ↗
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={11} style={{ background: T.bgAlt, padding: "8px 14px", fontSize: 12 }}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                              <div>
                                <div style={{ fontWeight: 600, marginBottom: 4, color: T.red }}>
                                  Lost tokens ({(r.lost || []).length})
                                </div>
                                {(r.lost || []).length === 0 ? <div style={{ color: T.textMuted }}>— none —</div> :
                                  <div style={{ maxHeight: 180, overflow: "auto", fontFamily: T.mono, fontSize: 11 }}>
                                    {(r.lost || []).slice(0, 200).map((l, j) => (
                                      <div key={j} style={{ color: T.red, marginBottom: 2 }}>
                                        {l.token}
                                        <span style={{ color: T.textMuted, marginLeft: 6 }}>({l.label})</span>
                                      </div>
                                    ))}
                                    {(r.lost || []).length > 200 && <div style={{ color: T.textMuted }}>…{r.lost.length - 200} more</div>}
                                  </div>
                                }
                              </div>
                              <div>
                                <div style={{ fontWeight: 600, marginBottom: 4, color: T.green }}>
                                  Covered tokens ({(r.covered || []).length})
                                </div>
                                {(r.covered || []).length === 0 ? <div style={{ color: T.textMuted }}>— none —</div> :
                                  <div style={{ maxHeight: 180, overflow: "auto", fontFamily: T.mono, fontSize: 11 }}>
                                    {(r.covered || []).slice(0, 200).map((c, j) => (
                                      <div key={j} style={{ marginBottom: 2 }}>
                                        <span style={{ color: T.textMuted }}>{c.token}</span>
                                        <span style={{ marginLeft: 6 }}>({c.label}) ←{" "}</span>
                                        <span style={{ color: T.accentLight }}>{(c.coveredBy || []).join(", ")}</span>
                                      </div>
                                    ))}
                                    {(r.covered || []).length > 200 && <div style={{ color: T.textMuted }}>…{r.covered.length - 200} more</div>}
                                  </div>
                                }
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 8 }}>
            <ExportCSVButton rows={sorted} columns={["userName","email","profile","permSetLabel","groupLabel","severity","lostObjects","lostFields","lostSys","total"]} filename="impact_matrix.csv" />
          </div>
        </>
      )}
    </div>
  );
}

// B: Delete PermSet entirely — typeahead + zero-impact callout + all covering sources.
// v2.6 UX-32/33/34: impacted users surfaced above the fold, rows split into "Impacted"
// vs "Impacted but fully covered", tokens rendered with concrete nouns via tokenToNoun.
function ScenarioB({ idx, nav, deleteCandidates, setDeleteCandidates }) {
  // UX-21: persist the selected PS across tab switches.
  const { deleteSelectedPs, setDeleteSelectedPs } = useAppState();
  const ps = deleteSelectedPs;
  const setPs = setDeleteSelectedPs;

  useEffect(() => {
    if (deleteCandidates) return;
    setTimeout(() => setDeleteCandidates(precomputeDeleteCandidates(idx)), 30);
  }, [deleteCandidates, idx, setDeleteCandidates]);

  const permsets = useMemo(() => [...idx.permSetById.values()].filter(p => !toBool(p.IsOwnedByProfile)), [idx]);
  const analysis = ps && deleteCandidates ? deleteCandidates.get(ps.Id) : null;

  const zeroImpactRows = useMemo(() => {
    if (!deleteCandidates) return [];
    const rows = [];
    for (const v of deleteCandidates.values()) if (v.zeroImpact) rows.push({ permSetId: v.permSetId, label: v.label, users: v.perUser.length });
    return rows.sort((a, b) => b.users - a.users);
  }, [deleteCandidates]);

  // UX-33: split per-user rows — impacted (has losses) vs impacted-but-covered (everything is covered).
  const impactedRows    = analysis ? analysis.perUser.filter(r => !r.covered) : [];
  const coveredRows     = analysis ? analysis.perUser.filter(r =>  r.covered) : [];

  // UX-34 helper — render a token as a concrete noun with the raw token as a hover tooltip.
  const renderCoveringPerToken = rows => (
    <details>
      <summary style={{ color: T.accent, fontSize: 11 }}>{rows.length} tokens ▾</summary>
      <div style={{ marginTop: 6, fontSize: 11 }}>
        {rows.slice(0, 50).map((t, i) => (
          <div key={i} style={{ color: t.covers.length ? T.text : T.red, marginBottom: 2 }}>
            <span title={t.token} style={{ color: T.textMuted }}>{tokenToNoun(t.token)}</span>
            {" — "}
            {t.covers.length ? <span style={{ color: T.accentLight }}>{t.covers.map(s => `${s.kind}: ${s.label}`).join(" | ")}</span>
                             : <span style={{ color: T.red, fontWeight: 600 }}>NO COVER</span>}
          </div>
        ))}
      </div>
    </details>
  );

  return (
    <div>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: T.glow }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Scenario B — Delete PermSet entirely</div>
        <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 8 }}>
          Pick a PermSet and see the per-user impact if it were deleted outright. Users are grouped into
          <b> Impacted</b> (would lose at least one grant) and <b>Impacted-but-covered</b> (every grant is
          still available from another source). Tokens are shown as concrete nouns (hover to see the raw
          token) so admins can spot sensitive grants at a glance.
        </div>
        <Typeahead items={permsets} value={ps} onSelect={setPs} getId={p => p.Id} getLabel={getPsLabel} getSub={getPsSub} placeholder="Type a Permission Set name…" />
        {!deleteCandidates && <div style={{ fontSize: 12, color: T.textMuted, marginTop: 8 }}><span className="pe-spinner" /> Precomputing zero-impact candidates…</div>}
      </div>

      {/* UX-32: impacted users pulled above-the-fold when a PS is selected. */}
      {ps && analysis && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: T.glow }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <div style={{ fontWeight: 600 }}>{ps.Label}</div>
            {analysis.zeroImpact ? <Pill tone="green">Zero-impact deletion candidate</Pill> : <Pill tone="red">Will cause loss</Pill>}
            <Pill tone="red">{impactedRows.length} impacted</Pill>
            <Pill tone="green">{coveredRows.length} impacted-but-covered</Pill>
            <div style={{ flex: 1 }} />
            <button className="pe-btn ghost" onClick={() => nav({ kind: "PermissionSet", item: ps })}>
              Open in Explorer ↗
            </button>
            <ExportCSVButton rows={analysis.perUser.map(u => ({
              user: u.userName, covered: u.covered, lostTokenCount: u.lostTokenCount,
              coveringExample: (u.coveringPerToken.find(t => t.covers.length)||{}).covers
                ? u.coveringPerToken.filter(t => t.covers.length).map(t => `${tokenToNoun(t.token)} <- ${t.covers.map(s => s.label).join(",")}`).slice(0, 3).join(" | ")
                : "",
            }))} columns={["user","covered","lostTokenCount","coveringExample"]} filename={`delete_impact_${ps.Name}.csv`} />
          </div>

          {/* UX-33 split tables */}
          <SubSectionTable title={`Impacted users — would lose grants (${impactedRows.length})`} rows={impactedRows} columns={[
            { key: "userName", label: "User", render: r => <span onClick={() => nav({ kind: "User", item: idx.userById.get(r.userId) })} style={{ color: T.accentLight, cursor: "pointer" }}>{r.userName}</span> },
            { key: "covered", label: "Status", render: r => <Pill tone="red">{r.lostTokenCount} lost</Pill> },
            { key: "covering", label: "Token-by-token (click to expand)", render: r => renderCoveringPerToken(r.coveringPerToken) },
          ]} getRowId={r => "i-" + r.userId} emptyText="No users would lose grants." />

          <SubSectionTable title={`Impacted-but-covered — safe for these users (${coveredRows.length})`} rows={coveredRows} columns={[
            { key: "userName", label: "User", render: r => <span onClick={() => nav({ kind: "User", item: idx.userById.get(r.userId) })} style={{ color: T.accentLight, cursor: "pointer" }}>{r.userName}</span> },
            { key: "covered", label: "Status", render: () => <Pill tone="green">Fully covered</Pill> },
            { key: "covering", label: "Covering sources (click to expand)", render: r => renderCoveringPerToken(r.coveringPerToken) },
          ]} getRowId={r => "c-" + r.userId} emptyText="No users are covered elsewhere." />
        </div>
      )}

      {/* Zero-impact callout (kept below the selected-PS analysis) */}
      {deleteCandidates && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em", color: T.textMuted, marginBottom: 6 }}>Zero-impact deletion candidates</div>
          <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 10 }}>
            PermSets whose deletion would have no effective-permission loss for any currently-assigned user
            (unassigned PermSets are excluded — see Orphaned list in Redundancy).
          </div>
          {zeroImpactRows.length === 0 ? <Empty text="None detected." /> :
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
              {zeroImpactRows.map(r => (
                <div key={r.permSetId} style={{ padding: 10, border: `1px solid ${T.greenBorder}`, background: T.greenBg, borderRadius: 8, cursor: "pointer" }}
                  onClick={() => setPs(idx.permSetById.get(r.permSetId))}>
                  <div style={{ fontWeight: 600 }}>{r.label}</div>
                  <div style={{ fontSize: 11, color: T.textMuted }}>{r.users} user(s) affected · all covered elsewhere</div>
                </div>
              ))}
            </div>
          }
        </div>
      )}
    </div>
  );
}

// C: Change User Profile (UX-50 v2.7 — was "Modify Profile"). v2.6 UX-35/36/37:
//   • Target profile renamed to "Future profile" for clarity.
//   • Current / Future profile cards shown side-by-side with metadata + summary stats.
//   • 3-tab breakdown (Objects / Fields / System) with "Only show differences" default ON,
//     so the common case (looking for what would change) is one click away.
function ScenarioC({ idx, nav }) {
  // UX-21: persist user + future profile + tab + only-diff toggle across tab switches.
  const { modifyCurrentProfile, setModifyCurrentProfile,
          modifyFutureProfile, setModifyFutureProfile,
          modifyCompareTab, setModifyCompareTab,
          modifyOnlyDiff, setModifyOnlyDiff } = useAppState();
  // BUG-14 v2.7: local toggle for the per-permission debug panel. Default OFF
  // — admins only need to pop this open when they're auditing why a specific
  // loss/gain is / isn't being surfaced.
  const [showDiffDebug, setShowDiffDebug] = useState(false);
  // "modifyCurrentProfile" stores the *user* for backwards-compat with v2.5 state shape.
  const user = modifyCurrentProfile;
  const setUser = setModifyCurrentProfile;
  const futureProfile = modifyFutureProfile;
  const setFutureProfile = setModifyFutureProfile;

  const users = useMemo(() => [...idx.userById.values()], [idx]);
  const profiles = useMemo(() => [...idx.profileById.values()], [idx]);
  const currentProfile = user ? idx.profileById.get(user.ProfileId) : null;

  // BUG-14 v2.7: collect object / field / sys grants for each profile.
  // Fans out via profileFanoutIds (BUG-8: implicit PermissionSet) so object
  // and field grants properly join to Profile. Critically also reads the
  // *Profile row's own* `Permissions*` columns for system permissions —
  // because Query 13 (SystemPermissions_PermSet.csv) excludes implicit
  // profile-owned PermSets, profile-level system perms (ModifyAllData,
  // ViewAllData, ManageUsers, etc.) live ONLY on the Profile row and were
  // being missed entirely in v2.6. That under-counted Profile-vs-Profile
  // losses dramatically (e.g. System Administrator → Sales User showed
  // near-zero losses).
  const collect = pid => {
    const objects = new Map(); // sobj -> {c,r,e,d,va,ma}
    const fields  = new Map(); // field -> {read, edit, SobjectType}
    const sys     = new Set(); // perm name
    if (!pid) return { objects, fields, sys };
    for (const id of profileFanoutIds(idx, pid)) {
      for (const o of idx.objPermsByParent.get(id) || []) {
        const cur = objects.get(o.SobjectType) || { c: false, r: false, e: false, d: false, va: false, ma: false };
        ["c","r","e","d","va","ma"].forEach(k => { if (o[k]) cur[k] = true; });
        objects.set(o.SobjectType, cur);
      }
      for (const f of idx.fieldPermsByParent.get(id) || []) {
        const cur = fields.get(f.Field) || { read: false, edit: false, SobjectType: f.SobjectType };
        if (f.read) cur.read = true;
        if (f.edit) cur.edit = true;
        fields.set(f.Field, cur);
      }
      const sp = idx.sysPermsByParent.get(id);
      if (sp) for (const [k, v] of Object.entries(sp.perms)) if (v) sys.add(k);
    }
    // BUG-14: pull system perms straight off the Profile row (Query 1
    // columns, e.g. Profile.PermissionsModifyAllData = "true").
    const profileRow = idx.profileById.get(pid);
    if (profileRow) {
      for (const k of Object.keys(profileRow)) {
        if (!k.startsWith("Permissions")) continue;
        if (toBool(profileRow[k])) sys.add(k.replace(/^Permissions/, ""));
      }
    }
    return { objects, fields, sys };
  };

  const cur = useMemo(() => collect(user && user.ProfileId), [idx, user]);
  const fut = useMemo(() => collect(futureProfile && futureProfile.Id), [idx, futureProfile]);

  // UX-37: row builders shared by all three tabs.
  const objRows = useMemo(() => {
    if (!user || !futureProfile) return [];
    const keys = new Set([...cur.objects.keys(), ...fut.objects.keys()]);
    return [...keys].sort().map(sobj => {
      const c = cur.objects.get(sobj) || {};
      const f = fut.objects.get(sobj) || {};
      const changed = ["c","r","e","d","va","ma"].some(k => !!c[k] !== !!f[k]);
      return { sobj, cur: c, fut: f, changed };
    });
  }, [cur, fut, user, futureProfile]);

  const fldRows = useMemo(() => {
    if (!user || !futureProfile) return [];
    const keys = new Set([...cur.fields.keys(), ...fut.fields.keys()]);
    return [...keys].sort().map(fld => {
      const c = cur.fields.get(fld) || { read: false, edit: false };
      const f = fut.fields.get(fld) || { read: false, edit: false };
      const changed = (!!c.read !== !!f.read) || (!!c.edit !== !!f.edit);
      const SobjectType = (cur.fields.get(fld) || fut.fields.get(fld) || {}).SobjectType || "";
      return { fld, SobjectType, cur: c, fut: f, changed };
    });
  }, [cur, fut, user, futureProfile]);

  const sysRows = useMemo(() => {
    if (!user || !futureProfile) return [];
    const keys = new Set([...cur.sys, ...fut.sys]);
    return [...keys].sort().map(k => ({ perm: k, cur: cur.sys.has(k), fut: fut.sys.has(k), changed: cur.sys.has(k) !== fut.sys.has(k) }));
  }, [cur, fut, user, futureProfile]);

  const diffCounts = {
    objects: objRows.filter(r => r.changed).length,
    fields:  fldRows.filter(r => r.changed).length,
    sys:     sysRows.filter(r => r.changed).length,
  };

  const tabs = [
    { key: "objects", label: "Objects", count: diffCounts.objects },
    { key: "fields",  label: "Fields",  count: diffCounts.fields },
    { key: "system",  label: "System",  count: diffCounts.sys },
  ];
  const active = modifyCompareTab || "objects";

  return (
    <div>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: T.glow }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Scenario C — Change User Profile</div>
        <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 10 }}>
          Pick a user to see their <b>current profile</b>, then pick a <b>future profile</b> to see exactly
          what object, field, and system permissions would change. Differences are computed against the
          profile's own grants (including its implicit PermissionSet) — PermSet assignments are unchanged by this operation.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>User</div>
            {/* UX-28: SuggestionTypeahead applies on Enter/click instead of replacing the input —
                matches the expectation of a suggestion picker (like Gmail's To: field). */}
            <SuggestionTypeahead items={users} value={user} onSelect={setUser} getId={u => u.Id} getLabel={getUserLabel} getSub={getUserSub} placeholder="Type a user name…" />
          </div>
          <div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Future profile</div>
            <SuggestionTypeahead items={profiles} value={futureProfile} onSelect={setFutureProfile} getId={p => p.Id} getLabel={getProfileLabel} getSub={getProfileSub} placeholder="Type a profile name…" />
          </div>
        </div>
      </div>

      {user && currentProfile && futureProfile && (
        <>
          {/* UX-36: Current / Future profile cards side-by-side */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <ProfileCompareCard title="Current profile" tone="purple" profile={currentProfile} counts={{ objects: cur.objects.size, fields: cur.fields.size, sys: cur.sys.size }} nav={nav} />
            <ProfileCompareCard title="Future profile"  tone="accent" profile={futureProfile}  counts={{ objects: fut.objects.size, fields: fut.fields.size, sys: fut.sys.size }} nav={nav} />
          </div>

          {/* UX-37: 3-tab comparison + Only show differences toggle (default ON) */}
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <Tabs tabs={tabs} active={active} onChange={setModifyCompareTab} />
              <div style={{ flex: 1 }} />
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: T.textMuted, cursor: "pointer" }}>
                <input type="checkbox" checked={!!modifyOnlyDiff} onChange={e => setModifyOnlyDiff(e.target.checked)} />
                Only show differences
              </label>
            </div>
            {/* UX-52 v2.7: legend — clarifies what the Cur / Fut columns mean. */}
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 8, lineHeight: 1.6 }}>
              <b style={{ color: T.text }}>Current</b> = bit granted on the user's current profile (incl. implicit PermSet). <b style={{ color: T.text }}>Future</b> = bit granted on the future profile. A yellow <Pill tone="yellow">changed</Pill> pill means the bit differs between the two — either the user would <b>gain</b> it (Current=off, Future=on) or <b>lose</b> it (Current=on, Future=off). PermSet assignments are held constant.
            </div>

            {active === "objects" && (
              <SubSectionTable title={`Objects${modifyOnlyDiff ? " (differences only)" : ""}`}
                rows={modifyOnlyDiff ? objRows.filter(r => r.changed) : objRows}
                columns={[
                  { key: "sobj", label: "Object" },
                  { key: "cur.c", label: "Cur C", render: r => <BoolFlag v={r.cur.c} /> },
                  { key: "fut.c", label: "Fut C", render: r => <BoolFlag v={r.fut.c} changed={r.cur.c !== r.fut.c} /> },
                  { key: "cur.r", label: "Cur R", render: r => <BoolFlag v={r.cur.r} /> },
                  { key: "fut.r", label: "Fut R", render: r => <BoolFlag v={r.fut.r} changed={r.cur.r !== r.fut.r} /> },
                  { key: "cur.e", label: "Cur E", render: r => <BoolFlag v={r.cur.e} /> },
                  { key: "fut.e", label: "Fut E", render: r => <BoolFlag v={r.fut.e} changed={r.cur.e !== r.fut.e} /> },
                  { key: "cur.d", label: "Cur D", render: r => <BoolFlag v={r.cur.d} /> },
                  { key: "fut.d", label: "Fut D", render: r => <BoolFlag v={r.fut.d} changed={r.cur.d !== r.fut.d} /> },
                  { key: "changed", label: "Δ", render: r => r.changed ? <Pill tone="yellow">changed</Pill> : <Pill tone="mute">same</Pill> },
                ]} getRowId={r => r.sobj} emptyText={modifyOnlyDiff ? "No object-level differences." : "No object permissions."} />
            )}

            {active === "fields" && (
              <SubSectionTable title={`Fields${modifyOnlyDiff ? " (differences only)" : ""}`}
                rows={modifyOnlyDiff ? fldRows.filter(r => r.changed) : fldRows}
                columns={[
                  { key: "fld", label: "Field", render: r => <span style={{ fontFamily: T.mono, color: T.accentLight }}>{r.fld}</span> },
                  { key: "SobjectType", label: "Object", width: 140 },
                  { key: "cur.read", label: "Cur R", render: r => <BoolFlag v={r.cur.read} /> },
                  { key: "fut.read", label: "Fut R", render: r => <BoolFlag v={r.fut.read} changed={r.cur.read !== r.fut.read} /> },
                  { key: "cur.edit", label: "Cur E", render: r => <BoolFlag v={r.cur.edit} /> },
                  { key: "fut.edit", label: "Fut E", render: r => <BoolFlag v={r.fut.edit} changed={r.cur.edit !== r.fut.edit} /> },
                  { key: "changed", label: "Δ", render: r => r.changed ? <Pill tone="yellow">changed</Pill> : <Pill tone="mute">same</Pill> },
                ]} getRowId={r => r.fld} emptyText={modifyOnlyDiff ? "No field-level differences." : "No field permissions."} />
            )}

            {active === "system" && (
              <SubSectionTable title={`System${modifyOnlyDiff ? " (differences only)" : ""}`}
                rows={modifyOnlyDiff ? sysRows.filter(r => r.changed) : sysRows}
                columns={[
                  { key: "perm", label: "Permission", render: r => <span style={{ fontFamily: T.mono, color: T.accentLight }}>{r.perm}</span> },
                  { key: "cur", label: "Current", render: r => <BoolFlag v={r.cur} /> },
                  { key: "fut", label: "Future", render: r => <BoolFlag v={r.fut} changed={r.cur !== r.fut} /> },
                  { key: "changed", label: "Δ", render: r => r.changed ? <Pill tone="yellow">changed</Pill> : <Pill tone="mute">same</Pill> },
                ]} getRowId={r => r.perm} emptyText={modifyOnlyDiff ? "No system-permission differences." : "No system permissions."} />
            )}
          </div>

          {/* BUG-14 v2.7: per-permission Before/After/Classification debug panel,
              collapsed by default. Verifies the counts in the summary tabs above
              are exactly the rows in this flat log. */}
          <ChangeProfileDebugPanel
            show={showDiffDebug}
            onToggle={() => setShowDiffDebug(v => !v)}
            objRows={objRows} fldRows={fldRows} sysRows={sysRows}
          />
        </>
      )}
    </div>
  );
}

// BUG-14 v2.7: debug panel for Change User Profile. Flattens every (Object, CRUD-bit)
// pair, every Field R/E pair, and every system perm into Before/After/Classification
// rows so an admin can verify the summary tab counts are grounded in actual data.
function ChangeProfileDebugPanel({ show, onToggle, objRows, fldRows, sysRows }) {
  const [which, setWhich] = useState("all");
  const rows = useMemo(() => {
    const out = [];
    const classify = (b, a) => b === a ? "Unchanged" : (b && !a ? "Lost" : "Gained");
    for (const r of objRows) {
      for (const bit of ["c", "r", "e", "d", "va", "ma"]) {
        const before = !!r.cur[bit];
        const after = !!r.fut[bit];
        out.push({
          scope: "Object", key: `${r.sobj}.${bit.toUpperCase()}`,
          before, after, cls: classify(before, after),
        });
      }
    }
    for (const r of fldRows) {
      for (const bit of ["read", "edit"]) {
        const before = !!r.cur[bit];
        const after = !!r.fut[bit];
        out.push({
          scope: "Field", key: `${r.fld}.${bit === "read" ? "R" : "E"}`,
          before, after, cls: classify(before, after),
        });
      }
    }
    for (const r of sysRows) {
      const before = !!r.cur;
      const after = !!r.fut;
      out.push({
        scope: "System", key: r.perm,
        before, after, cls: classify(before, after),
      });
    }
    return out;
  }, [objRows, fldRows, sysRows]);

  const tallies = useMemo(() => {
    const t = { Lost: 0, Gained: 0, Unchanged: 0 };
    for (const r of rows) t[r.cls]++;
    return t;
  }, [rows]);

  const filtered = useMemo(() => {
    if (which === "all") return rows;
    if (which === "changed") return rows.filter(r => r.cls !== "Unchanged");
    if (which === "lost") return rows.filter(r => r.cls === "Lost");
    if (which === "gained") return rows.filter(r => r.cls === "Gained");
    return rows;
  }, [rows, which]);

  return (
    <div style={{ marginTop: 14, background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="pe-btn ghost" style={{ fontSize: 11, padding: "3px 10px" }} onClick={onToggle}>
          {show ? "▼" : "▶"} Debug panel — Before / After / Classification
        </button>
        <Pill tone="mute">{rows.length} rows</Pill>
        <Pill tone="red">Lost {tallies.Lost}</Pill>
        <Pill tone="green">Gained {tallies.Gained}</Pill>
        <Pill tone="mute">Unchanged {tallies.Unchanged}</Pill>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11, color: T.textMuted }}>
          Counts here exactly match the summary tabs above — if they don't, the diff engine is dropping rows.
        </div>
      </div>

      {show && (
        <>
          <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
            {[
              { k: "all", label: `All (${rows.length})` },
              { k: "changed", label: `Changed (${tallies.Lost + tallies.Gained})` },
              { k: "lost", label: `Lost (${tallies.Lost})` },
              { k: "gained", label: `Gained (${tallies.Gained})` },
            ].map(opt => (
              <button key={opt.k}
                className={"pe-btn " + (which === opt.k ? "" : "ghost")}
                style={{ fontSize: 11, padding: "2px 8px" }}
                onClick={() => setWhich(opt.k)}>{opt.label}</button>
            ))}
          </div>
          <div style={{ marginTop: 10, maxHeight: 320, overflow: "auto", border: `1px solid ${T.border}`, borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: T.mono }}>
              <thead>
                <tr style={{ position: "sticky", top: 0, background: T.bgAlt, zIndex: 1 }}>
                  <th style={{ textAlign: "left", padding: "4px 8px", borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Scope</th>
                  <th style={{ textAlign: "left", padding: "4px 8px", borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Key</th>
                  <th style={{ textAlign: "left", padding: "4px 8px", borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Before</th>
                  <th style={{ textAlign: "left", padding: "4px 8px", borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>After</th>
                  <th style={{ textAlign: "left", padding: "4px 8px", borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Classification</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 2000).map((r, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={{ padding: "3px 8px", color: T.textMuted }}>{r.scope}</td>
                    <td style={{ padding: "3px 8px", color: T.accentLight }}>{r.key}</td>
                    <td style={{ padding: "3px 8px" }}>{r.before ? "true" : "false"}</td>
                    <td style={{ padding: "3px 8px" }}>{r.after ? "true" : "false"}</td>
                    <td style={{ padding: "3px 8px" }}>
                      {r.cls === "Lost" && <Pill tone="red">Lost</Pill>}
                      {r.cls === "Gained" && <Pill tone="green">Gained</Pill>}
                      {r.cls === "Unchanged" && <Pill tone="mute">Unchanged</Pill>}
                    </td>
                  </tr>
                ))}
                {filtered.length > 2000 && (
                  <tr><td colSpan={5} style={{ padding: "6px 8px", color: T.textMuted, textAlign: "center" }}>
                    Truncated to first 2,000 rows of {filtered.length} to keep the panel responsive.
                  </td></tr>
                )}
                {!filtered.length && (
                  <tr><td colSpan={5} style={{ padding: "10px 8px", color: T.textMuted, textAlign: "center" }}>No rows.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// Small shared card for the Current / Future profile header pair.
function ProfileCompareCard({ title, tone, profile, counts, nav }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderTop: `3px solid ${T[tone] || T.accent}`, borderRadius: 12, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: T.textMuted }}>{title}</div>
        <Pill tone={tone}>{profile.UserType || "—"}</Pill>
        <div style={{ flex: 1 }} />
        <button className="pe-btn ghost" style={{ fontSize: 11, padding: "2px 6px" }}
          onClick={() => nav({ kind: "Profile", item: profile })}>Open ↗</button>
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{profile.Name}</div>
      {profile.Description && <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 8 }}>{profile.Description}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, fontSize: 12 }}>
        <div><span style={{ color: T.textMuted }}>Objects:</span> {counts.objects}</div>
        <div><span style={{ color: T.textMuted }}>Fields:</span> {counts.fields}</div>
        <div><span style={{ color: T.textMuted }}>Sys perms:</span> {counts.sys}</div>
      </div>
    </div>
  );
}

// D: Revoke Field from PermSet — cascaded typeaheads (BUG-7 / UX-17)
function ScenarioD({ idx, nav }) {
  const [ps, setPs] = useState(null);
  const [obj, setObj] = useState(null);
  const [fld, setFld] = useState(null);

  // Permsets only — NOT groups (BUG-7).
  const permsets = useMemo(() => [...idx.permSetById.values()].filter(p => !toBool(p.IsOwnedByProfile)), [idx]);

  const objectsForPs = useMemo(() => {
    if (!ps) return [];
    const set = new Set();
    for (const r of idx.fieldPermsByParent.get(ps.Id) || []) set.add(r.SobjectType);
    return [...set].sort().map(s => ({ SobjectType: s }));
  }, [ps, idx]);

  const fieldsForObj = useMemo(() => {
    if (!ps || !obj) return [];
    const rows = (idx.fieldPermsByParent.get(ps.Id) || []).filter(r => r.SobjectType === obj.SobjectType);
    const set = new Set();
    for (const r of rows) set.add(r.Field);
    return [...set].sort().map(f => ({ Field: f }));
  }, [ps, obj, idx]);

  // Impacted users: assigned to the PermSet where the PermSet is the sole Read/Edit source.
  const impacted = useMemo(() => {
    if (!ps || !obj || !fld) return null;
    const out = { readLoss: [], editLoss: [] };
    const assigneeIds = new Set((idx.psaByPermSet.get(ps.Id) || []).map(a => a.UserId));
    for (const uid of assigneeIds) {
      const eff = effectiveFields(idx, uid).grant.get(fld.Field);
      if (!eff) continue;
      const coversR = (eff.sources.read || []).filter(s => s.id !== ps.Id);
      const coversE = (eff.sources.edit || []).filter(s => s.id !== ps.Id);
      const u = idx.userById.get(uid);
      if (eff.read && coversR.length === 0) out.readLoss.push({ userId: uid, name: u && u.Name, covering: "", mode: "read" });
      if (eff.edit && coversE.length === 0) out.editLoss.push({ userId: uid, name: u && u.Name, covering: "", mode: "edit" });
    }
    return out;
  }, [ps, obj, fld, idx]);

  return (
    <div>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: T.glow }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Scenario D — Revoke a Field from a PermSet</div>
        {/* v2.6 UX-38: explain purpose so admins understand the downstream effect. */}
        <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 10, lineHeight: 1.45 }}>
          Simulate removing FLS Read or Edit on a single field grantor and see which users would
          lose access as a result. Use this before deleting a sensitive field permission from a
          production PermSet — the Read Loss and Edit Loss columns list every user for whom this
          grantor is the only source of that grant (i.e. no other assigned PermSet or Profile
          provides coverage).&nbsp;
          <a href="https://help.salesforce.com/s/articleView?id=sf.users_profiles_field_perms.htm&type=5" target="_blank" rel="noreferrer" style={{ color: T.accentLight }}>Learn more about FLS ↗</a>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Permission Set</div>
            <Typeahead items={permsets} value={ps} onSelect={v => { setPs(v); setObj(null); setFld(null); }} getId={p => p.Id} getLabel={getPsLabel} getSub={getPsSub} placeholder="Type a PermSet…" />
          </div>
          <div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Object (filtered)</div>
            <Typeahead items={objectsForPs} value={obj} onSelect={v => { setObj(v); setFld(null); }} getId={o => o.SobjectType} getLabel={o => o.SobjectType} placeholder={ps ? "Type an object…" : "Pick a PermSet first"} emptyLabel={ps ? "No fields granted" : "Select PermSet"} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Field (filtered)</div>
            <Typeahead items={fieldsForObj} value={fld} onSelect={setFld} getId={f => f.Field} getLabel={f => f.Field} placeholder={obj ? "Type a field…" : "Pick an object first"} emptyLabel={obj ? "No granted fields" : "Select object"} />
          </div>
        </div>
      </div>
      {impacted && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <SubSectionTable title={`Read Loss (${impacted.readLoss.length})`} rows={impacted.readLoss} columns={[
            { key: "name", label: "User", render: r => <span onClick={() => nav({ kind: "User", item: idx.userById.get(r.userId) })} style={{ color: T.accentLight, cursor: "pointer" }}>{r.name}</span> },
          ]} getRowId={r => r.userId + "r"} emptyText="No read losers." />
          <SubSectionTable title={`Edit Loss (${impacted.editLoss.length})`} rows={impacted.editLoss} columns={[
            { key: "name", label: "User", render: r => <span onClick={() => nav({ kind: "User", item: idx.userById.get(r.userId) })} style={{ color: T.accentLight, cursor: "pointer" }}>{r.name}</span> },
          ]} getRowId={r => r.userId + "e"} emptyText="No edit losers." />
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * 12b. PRESCRIBE ACCESS TAB (UX-47 v2.7)
 *     Prescriptive inverse of the explorer: "User X needs access to Y — what
 *     PermSet should I assign?". Ranks single-PermSet candidates by least
 *     privilege, then finds greedy set-cover combinations if no single PermSet
 *     covers everything, and previews the side-effect Gains/Losses if the
 *     admin assigned the #1 candidate.
 * ==========================================================================*/

// --- UX-47 helpers ----------------------------------------------------------

// Canonical token for a desired-access row. Must match tokens produced by
// `grantorSignature` / `psSignature` below so coverage can be computed via Set
// membership.
function prescribeRowToken(row) {
  if (!row) return "";
  if (row.kind === "object") {
    const bits = [];
    const b = row.crud || {};
    if (b.C) bits.push("C"); if (b.R) bits.push("R"); if (b.E) bits.push("E");
    if (b.D) bits.push("D"); if (b.VA) bits.push("VA"); if (b.MA) bits.push("MA");
    return bits.length ? bits.map(bit => `O:${row.sobjectType}:${bit}`) : [];
  }
  if (row.kind === "field") {
    const bits = [];
    const b = row.crud || {};
    if (b.R) bits.push(`F:${row.field}:R`);
    if (b.E) bits.push(`F:${row.field}:E`);
    return bits;
  }
  if (row.kind === "syspm") {
    return row.sysKey ? [`S:${row.sysKey}`] : [];
  }
  return [];
}

// Expand all rows to a flat token set (each (Object, CRUD bit) or (Field, R/E)
// or (SystemPerm) becomes its own token).
function prescribeRowsToTokens(rows) {
  const out = new Set();
  for (const r of rows || []) {
    for (const t of prescribeRowToken(r)) out.add(t);
  }
  return out;
}

// Grant signature for a single PermSet (no profile fan-out — callers pass
// either a PermSet.Id or a PermSetGroup synthetic id). Returns a Set of tokens
// in the same namespace as prescribeRowToken.
function psGrantTokens(idx, parentId) {
  const tokens = new Set();
  for (const o of idx.objPermsByParent.get(parentId) || []) {
    if (o.c) tokens.add(`O:${o.SobjectType}:C`);
    if (o.r) tokens.add(`O:${o.SobjectType}:R`);
    if (o.e) tokens.add(`O:${o.SobjectType}:E`);
    if (o.d) tokens.add(`O:${o.SobjectType}:D`);
    if (o.va) tokens.add(`O:${o.SobjectType}:VA`);
    if (o.ma) tokens.add(`O:${o.SobjectType}:MA`);
  }
  for (const f of idx.fieldPermsByParent.get(parentId) || []) {
    if (f.read) tokens.add(`F:${f.Field}:R`);
    if (f.edit) tokens.add(`F:${f.Field}:E`);
  }
  const sp = idx.sysPermsByParent.get(parentId);
  if (sp) for (const [k, v] of Object.entries(sp.perms)) if (v) tokens.add(`S:${k}`);
  return tokens;
}

// Grant signature for a PermSet Group = union of its member PermSets.
function groupGrantTokens(idx, groupId) {
  const tokens = new Set();
  const members = idx.groupMembers.get(groupId) || [];
  for (const m of members) {
    for (const t of psGrantTokens(idx, m.PermissionSetId)) tokens.add(t);
  }
  return tokens;
}

// User's current covered tokens = union of profile (fanned out) + every
// assigned (non-muted) PermSet. We intentionally IGNORE muting in the
// prescriptive view — the admin is asking "what would I need to ADD?", so we
// show the simple additive coverage. Muting shows up in the side-effect diff
// if the assigned PermSet would hit a muter.
function userCoveredTokens(idx, userId) {
  const out = new Set();
  const u = idx.userById.get(userId);
  if (!u) return out;
  if (u.ProfileId) {
    for (const pid of profileFanoutIds(idx, u.ProfileId)) {
      for (const t of psGrantTokens(idx, pid)) out.add(t);
    }
  }
  for (const a of idx.psaByUser.get(userId) || []) {
    if (a.Type === "Muting") continue;
    for (const t of psGrantTokens(idx, a.PermSetId)) out.add(t);
  }
  return out;
}

// Pretty-print a token back to a noun phrase for lists / CSVs.
function tokenToLabel(tok) {
  if (!tok) return "";
  if (tok.startsWith("O:")) {
    const [_, sobj, bit] = tok.split(":");
    const bitLabel = { C: "Create", R: "Read", E: "Edit", D: "Delete", VA: "View All", MA: "Modify All" }[bit] || bit;
    return `${sobj} — ${bitLabel}`;
  }
  if (tok.startsWith("F:")) {
    const rest = tok.slice(2);
    const dot = rest.lastIndexOf(":");
    const field = rest.slice(0, dot);
    const bit = rest.slice(dot + 1);
    return `${field} — ${bit === "R" ? "Read" : "Edit"}`;
  }
  if (tok.startsWith("S:")) return tok.slice(2).replace(/^Permissions/, "");
  return tok;
}

// Rank candidates (single PermSet or Group) that would newly cover the most
// of the uncovered desired tokens. Return array ordered by:
//   (1) count newly covered DESC
//   (2) fewest "extras" the user would also gain (least privilege) ASC
//   (3) PermSet Group > single PermSet where tied
//   (4) alphabetical
function rankPrescribeCandidates(idx, userId, desiredTokens, alreadyCovered) {
  const gap = new Set([...desiredTokens].filter(t => !alreadyCovered.has(t)));
  if (!gap.size) return { gap, candidates: [] };
  const candidates = [];

  // Single PermSets (exclude profile-owned implicit PSs and muting PSs).
  for (const ps of idx.permSetById.values()) {
    if (toBool(ps.IsOwnedByProfile)) continue;
    if (ps.Type === "Muting") continue;
    const g = psGrantTokens(idx, ps.Id);
    const covers = [...gap].filter(t => g.has(t));
    if (!covers.length) continue;
    const extras = [...g].filter(t => !desiredTokens.has(t) && !alreadyCovered.has(t));
    candidates.push({
      kind: "permset", id: ps.Id,
      label: ps.Label || ps.Name || ps.Id,
      sub: ps.Type === "Muting" ? "Muting" : (toBool(ps.IsCustom) ? "Custom" : "Standard"),
      covers, coversCount: covers.length,
      extras, extrasCount: extras.length,
      totalGrants: g.size,
    });
  }

  // PermSet Groups.
  for (const g of idx.groupById.values()) {
    const gt = groupGrantTokens(idx, g.Id);
    const covers = [...gap].filter(t => gt.has(t));
    if (!covers.length) continue;
    const extras = [...gt].filter(t => !desiredTokens.has(t) && !alreadyCovered.has(t));
    candidates.push({
      kind: "group", id: g.Id,
      label: g.MasterLabel || g.DeveloperName || g.Id,
      sub: "PermSet Group",
      covers, coversCount: covers.length,
      extras, extrasCount: extras.length,
      totalGrants: gt.size,
    });
  }

  candidates.sort((a, b) => {
    if (b.coversCount !== a.coversCount) return b.coversCount - a.coversCount;
    if (a.extrasCount !== b.extrasCount) return a.extrasCount - b.extrasCount;
    if (a.kind !== b.kind) return a.kind === "group" ? -1 : 1; // group wins ties
    return a.label.localeCompare(b.label);
  });

  return { gap, candidates };
}

// Greedy set-cover: repeatedly pick the candidate that covers the most
// still-uncovered tokens, tie-breaking with least extras. Caps at 5 picks to
// keep the UI from proposing something daft.
function greedySetCover(candidates, gap) {
  const remaining = new Set(gap);
  const picks = [];
  const seen = new Set();
  while (remaining.size && picks.length < 5) {
    let best = null;
    for (const c of candidates) {
      if (seen.has(c.kind + ":" + c.id)) continue;
      const gains = c.covers.filter(t => remaining.has(t)).length;
      if (!gains) continue;
      if (!best ||
          gains > best.gains ||
          (gains === best.gains && c.extrasCount < best.cand.extrasCount) ||
          (gains === best.gains && c.extrasCount === best.cand.extrasCount && c.kind === "group" && best.cand.kind !== "group")) {
        best = { cand: c, gains };
      }
    }
    if (!best) break;
    for (const t of best.cand.covers) remaining.delete(t);
    seen.add(best.cand.kind + ":" + best.cand.id);
    picks.push(best.cand);
  }
  return { picks, leftover: [...remaining] };
}

function PrescribeAccessTab({ idx, nav }) {
  // UX-21: persist across tab switches.
  const { prescribeUser, setPrescribeUser,
          prescribeRows, setPrescribeRows } = useAppState();

  const users = useMemo(() => [...idx.userById.values()], [idx]);

  // Build an object list from the index (all SobjectTypes the org actually has
  // permissions on — same set the explorer uses).
  const allObjects = useMemo(() => {
    const set = new Set();
    for (const rows of idx.objPermsByParent.values()) for (const r of rows) set.add(r.SobjectType);
    return [...set].sort().map(s => ({ SobjectType: s }));
  }, [idx]);
  // Fields grouped by object for field picker.
  const allFields = useMemo(() => {
    const set = new Set();
    for (const rows of idx.fieldPermsByParent.values()) for (const r of rows) set.add(r.Field);
    return [...set].sort().map(f => ({ Field: f, SobjectType: f.split(".")[0] || "" }));
  }, [idx]);
  const allSysKeys = useMemo(() => {
    const set = new Set();
    for (const sp of idx.sysPermsByParent.values()) {
      for (const [k, v] of Object.entries(sp.perms || {})) if (v) set.add(k);
    }
    return [...set].sort().map(k => ({ Key: k, Label: k.replace(/^Permissions/, "") }));
  }, [idx]);

  // Add a row — default type = object with Read.
  const addRow = kind => {
    const id = `r${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const base = { id, kind, sobjectType: "", field: "", sysKey: "",
                   crud: kind === "object" ? { R: true } : (kind === "field" ? { R: true } : {}) };
    setPrescribeRows([...(prescribeRows || []), base]);
  };
  const updateRow = (id, patch) => setPrescribeRows(prescribeRows.map(r => r.id === id ? { ...r, ...patch } : r));
  const removeRow = id => setPrescribeRows(prescribeRows.filter(r => r.id !== id));
  const clearAll = () => setPrescribeRows([]);

  // Materialise the desired token set from the row editor.
  const desired = useMemo(() => prescribeRowsToTokens(prescribeRows), [prescribeRows]);
  const covered = useMemo(() => prescribeUser ? userCoveredTokens(idx, prescribeUser.Id) : new Set(), [prescribeUser, idx]);
  const alreadyCoveredList = useMemo(() => [...desired].filter(t => covered.has(t)).sort(), [desired, covered]);
  const { gap, candidates } = useMemo(() => rankPrescribeCandidates(idx, prescribeUser && prescribeUser.Id, desired, covered),
                                        [idx, prescribeUser, desired, covered]);
  // Combination greedy-cover (only meaningful if no single candidate covers the full gap).
  const topSingle = candidates[0] && candidates[0].coversCount === gap.size ? candidates[0] : null;
  const combo = useMemo(() => !topSingle && gap.size ? greedySetCover(candidates, gap) : null, [topSingle, candidates, gap]);

  const ready = prescribeUser && prescribeRows && prescribeRows.length > 0 && desired.size > 0;

  // Side-effect preview rows for a chosen candidate (extras = potential gains).
  const buildSideEffect = cand => {
    if (!cand) return null;
    return {
      gains: cand.extras.slice().sort(),
      desiredCovered: cand.covers.slice().sort(),
      // Losses — a muter the user might hit. Rarely non-zero for Regular PermSets
      // but we surface the warning spec nonetheless.
      losses: [], // forward-compat hook
    };
  };
  const topCandidate = topSingle || candidates[0] || null;
  const topSideEffect = buildSideEffect(topCandidate);

  const exportCsv = () => {
    const rows = [];
    rows.push({ section: "Desired", token: "", label: "" });
    for (const t of desired) rows.push({ section: "Desired", token: t, label: tokenToLabel(t) });
    rows.push({ section: "Already covered", token: "", label: "" });
    for (const t of alreadyCoveredList) rows.push({ section: "Already covered", token: t, label: tokenToLabel(t) });
    if (topCandidate) {
      rows.push({ section: `Top candidate: ${topCandidate.label}`, token: "", label: "" });
      for (const t of topCandidate.covers) rows.push({ section: "  covers", token: t, label: tokenToLabel(t) });
      for (const t of topCandidate.extras) rows.push({ section: "  extras (gain)", token: t, label: tokenToLabel(t) });
    }
    if (combo) {
      rows.push({ section: "Combination", token: "", label: "" });
      for (const p of combo.picks) rows.push({ section: `  ${p.kind === "group" ? "Group" : "PermSet"}: ${p.label}`, token: "", label: "" });
      for (const t of combo.leftover) rows.push({ section: "  uncovered", token: t, label: tokenToLabel(t) });
    }
    const csv = rowsToCSV(rows, ["section", "token", "label"]);
    downloadBlob(new Blob([csv], { type: "text/csv" }), `prescribe-access-${(prescribeUser && prescribeUser.Name) || "user"}.csv`);
  };

  return (
    <div>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: T.glow }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Prescribe Access — “what PermSet do I assign?”</div>
        <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
          Pick a <b>target user</b> and the <b>access they need</b>. We'll identify the rows the user already has
          (no action needed), then rank the Permission Sets / Permission Set Groups that — if assigned — would
          grant exactly that access, preferring those that add the fewest <i>extra</i> permissions (least privilege).
          If no single PermSet covers everything, we'll suggest a combination.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Target user</div>
            <SuggestionTypeahead items={users} value={prescribeUser} onSelect={setPrescribeUser}
              getId={u => u.Id} getLabel={getUserLabel} getSub={getUserSub}
              placeholder="Type a user name…" />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, flexWrap: "wrap" }}>
            <button className="pe-btn" style={{ fontSize: 12 }} onClick={() => addRow("object")}>+ Object</button>
            <button className="pe-btn" style={{ fontSize: 12 }} onClick={() => addRow("field")}>+ Field</button>
            <button className="pe-btn" style={{ fontSize: 12 }} onClick={() => addRow("syspm")}>+ System Perm</button>
            {prescribeRows && prescribeRows.length > 0 &&
              <button className="pe-btn ghost" style={{ fontSize: 12 }} onClick={clearAll}>Clear all</button>}
            {ready && <button className="pe-btn ghost" style={{ fontSize: 12 }} onClick={exportCsv}>Export CSV ↓</button>}
          </div>
        </div>
      </div>

      {/* Desired-access row editor */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Desired access <Pill tone="mute">{desired.size}</Pill></div>
        {(!prescribeRows || prescribeRows.length === 0) && (
          <div style={{ fontSize: 12, color: T.textMuted, padding: "10px 0" }}>
            No rows yet. Click <b>+ Object</b>, <b>+ Field</b>, or <b>+ System Perm</b> to add an access requirement.
          </div>
        )}
        {prescribeRows && prescribeRows.map(row => (
          <div key={row.id} style={{ display: "grid", gridTemplateColumns: "80px 1.4fr 1.4fr 2fr 36px", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: `1px dashed ${T.border}` }}>
            <Pill tone={row.kind === "object" ? "accent" : row.kind === "field" ? "purple" : "yellow"}>
              {row.kind === "object" ? "Object" : row.kind === "field" ? "Field" : "System"}
            </Pill>
            {row.kind === "object" && (
              <>
                <Typeahead items={allObjects}
                  value={row.sobjectType ? { SobjectType: row.sobjectType } : null}
                  onSelect={v => updateRow(row.id, { sobjectType: v ? v.SobjectType : "" })}
                  getId={o => o.SobjectType} getLabel={o => o.SobjectType}
                  placeholder="Object (SobjectType)…" />
                <div />
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {[
                    { k: "C", label: "Create" }, { k: "R", label: "Read" },
                    { k: "E", label: "Edit" }, { k: "D", label: "Delete" },
                    { k: "VA", label: "View All" }, { k: "MA", label: "Modify All" },
                  ].map(bit => {
                    const on = !!(row.crud && row.crud[bit.k]);
                    return (
                      <button key={bit.k}
                        className={"pe-btn " + (on ? "" : "ghost")}
                        style={{ fontSize: 10, padding: "2px 6px" }}
                        onClick={() => updateRow(row.id, { crud: { ...(row.crud || {}), [bit.k]: !on } })}>
                        {bit.label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {row.kind === "field" && (
              <>
                <Typeahead items={allObjects}
                  value={row.sobjectType ? { SobjectType: row.sobjectType } : null}
                  onSelect={v => updateRow(row.id, { sobjectType: v ? v.SobjectType : "", field: "" })}
                  getId={o => o.SobjectType} getLabel={o => o.SobjectType}
                  placeholder="Object…" />
                <Typeahead
                  items={row.sobjectType ? allFields.filter(f => f.SobjectType === row.sobjectType) : allFields}
                  value={row.field ? { Field: row.field } : null}
                  onSelect={v => updateRow(row.id, { field: v ? v.Field : "" })}
                  getId={f => f.Field} getLabel={f => f.Field}
                  placeholder={row.sobjectType ? "Field (Object.Field)…" : "Pick object first"} />
                <div style={{ display: "flex", gap: 4 }}>
                  {[{ k: "R", label: "Read" }, { k: "E", label: "Edit" }].map(bit => {
                    const on = !!(row.crud && row.crud[bit.k]);
                    return (
                      <button key={bit.k}
                        className={"pe-btn " + (on ? "" : "ghost")}
                        style={{ fontSize: 10, padding: "2px 6px" }}
                        onClick={() => updateRow(row.id, { crud: { ...(row.crud || {}), [bit.k]: !on } })}>
                        {bit.label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {row.kind === "syspm" && (
              <>
                <Typeahead items={allSysKeys}
                  value={row.sysKey ? { Key: row.sysKey, Label: row.sysKey.replace(/^Permissions/, "") } : null}
                  onSelect={v => updateRow(row.id, { sysKey: v ? v.Key : "" })}
                  getId={k => k.Key} getLabel={k => k.Label} getSub={k => k.Key}
                  placeholder="System permission…" />
                <div />
                <div style={{ fontSize: 11, color: T.textMuted }}>System permissions have no CRUD bits — binary grant only.</div>
              </>
            )}
            <button className="pe-btn ghost" style={{ fontSize: 11, padding: "2px 6px" }}
              onClick={() => removeRow(row.id)} title="Remove row">×</button>
          </div>
        ))}
      </div>

      {/* Results */}
      {ready && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {/* Already covered */}
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
              Already covered <Pill tone="green">{alreadyCoveredList.length}</Pill>
            </div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 8 }}>
              Rows the user already has via their Profile or an assigned PermSet — no new assignment needed.
            </div>
            {alreadyCoveredList.length === 0 && <Empty text="Nothing in the desired list is already covered." />}
            {alreadyCoveredList.length > 0 && (
              <div style={{ maxHeight: 240, overflow: "auto", fontSize: 12, fontFamily: T.mono }}>
                {alreadyCoveredList.map(t => (
                  <div key={t} style={{ padding: "3px 0", display: "flex", alignItems: "center", gap: 6 }}>
                    <Pill tone="green">✓</Pill>
                    <span style={{ color: T.accentLight }}>{tokenToLabel(t)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Gap */}
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
              Still needed <Pill tone={gap.size ? "yellow" : "green"}>{gap.size}</Pill>
            </div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 8 }}>
              Rows not yet granted to this user from any existing source.
            </div>
            {gap.size === 0 && <Empty text="Nothing to assign — the user already has everything on the list." />}
            {gap.size > 0 && (
              <div style={{ maxHeight: 240, overflow: "auto", fontSize: 12, fontFamily: T.mono }}>
                {[...gap].sort().map(t => (
                  <div key={t} style={{ padding: "3px 0", display: "flex", alignItems: "center", gap: 6 }}>
                    <Pill tone="yellow">⎈</Pill>
                    <span style={{ color: T.accentLight }}>{tokenToLabel(t)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Minimum-assignment candidates */}
      {ready && gap.size > 0 && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14, marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Minimum-assignment candidates</div>
            <Pill tone="mute">{candidates.length}</Pill>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 11, color: T.textMuted }}>
              Ranked by coverage of the gap (higher = better), then by fewest extra grants (least privilege).
            </div>
          </div>
          {candidates.length === 0 && <Empty text="No single PermSet or Group grants any of the remaining desired rows." />}
          {candidates.slice(0, 8).map((c, i) => (
            <div key={c.kind + c.id} style={{
              padding: "8px 10px", borderTop: i === 0 ? `1px solid ${T.border}` : `1px dashed ${T.border}`,
              background: i === 0 ? T.bgAlt : "transparent",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 22, height: 22, borderRadius: 11, background: i === 0 ? T.accent : T.border,
                              color: "#fff", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>
                  {i + 1}
                </div>
                <Pill tone={c.kind === "group" ? "purple" : "accent"}>{c.kind === "group" ? "Group" : "PermSet"}</Pill>
                <div style={{ fontWeight: 600 }}>{c.label}</div>
                <div style={{ fontSize: 11, color: T.textMuted }}>{c.sub}</div>
                <div style={{ flex: 1 }} />
                <Pill tone="green">covers {c.coversCount}/{gap.size}</Pill>
                <Pill tone={c.extrasCount === 0 ? "green" : c.extrasCount < 20 ? "yellow" : "red"}>extras {c.extrasCount}</Pill>
                <button className="pe-btn ghost" style={{ fontSize: 11, padding: "2px 8px" }}
                  onClick={() => c.kind === "group"
                    ? nav({ kind: "PermSetGroup", item: idx.groupById.get(c.id) })
                    : nav({ kind: "PermSet", item: idx.permSetById.get(c.id) })}>
                  Open ↗
                </button>
              </div>
              {i === 0 && (
                <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Of your desired rows, this PermSet grants:</div>
                    <div style={{ maxHeight: 140, overflow: "auto", fontSize: 11, fontFamily: T.mono }}>
                      {c.covers.slice().sort().map(t => (
                        <div key={t} style={{ padding: "2px 0" }}><Pill tone="green">✓</Pill> <span style={{ color: T.accentLight }}>{tokenToLabel(t)}</span></div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>
                      Side-effects (extras the user would also gain): <b>{c.extrasCount}</b>
                    </div>
                    <div style={{ maxHeight: 140, overflow: "auto", fontSize: 11, fontFamily: T.mono }}>
                      {c.extras.slice(0, 80).sort().map(t => (
                        <div key={t} style={{ padding: "2px 0" }}><Pill tone="yellow">+</Pill> <span style={{ color: T.accentLight }}>{tokenToLabel(t)}</span></div>
                      ))}
                      {c.extras.length > 80 && (
                        <div style={{ padding: "4px 0", color: T.textMuted }}>+ {c.extras.length - 80} more — export CSV to see all.</div>
                      )}
                      {c.extras.length === 0 && <div style={{ color: T.green }}>None — this PermSet grants exactly the desired rows. (Least-privilege match.)</div>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Combination suggestion */}
      {ready && combo && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14, marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Combination suggestion</div>
            <Pill tone="accent">{combo.picks.length} assignments</Pill>
            {combo.leftover.length === 0
              ? <Pill tone="green">fully covers gap</Pill>
              : <Pill tone="red">{combo.leftover.length} uncovered</Pill>}
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 11, color: T.textMuted }}>
              Greedy set-cover over PermSets + Groups; each pick covers the most still-uncovered tokens.
            </div>
          </div>
          {combo.picks.length === 0 && <Empty text="No combination of existing PermSets covers any of the remaining desired rows." />}
          {combo.picks.map((p, i) => (
            <div key={p.kind + p.id} style={{ padding: "6px 10px", borderTop: `1px dashed ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 22, height: 22, borderRadius: 11, background: T.border, color: T.text, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>{i + 1}</div>
              <Pill tone={p.kind === "group" ? "purple" : "accent"}>{p.kind === "group" ? "Group" : "PermSet"}</Pill>
              <div style={{ fontWeight: 600 }}>{p.label}</div>
              <div style={{ flex: 1 }} />
              <Pill tone="green">covers {p.coversCount}</Pill>
              <Pill tone={p.extrasCount === 0 ? "green" : p.extrasCount < 20 ? "yellow" : "red"}>extras {p.extrasCount}</Pill>
              <button className="pe-btn ghost" style={{ fontSize: 11, padding: "2px 8px" }}
                onClick={() => p.kind === "group"
                  ? nav({ kind: "PermSetGroup", item: idx.groupById.get(p.id) })
                  : nav({ kind: "PermSet", item: idx.permSetById.get(p.id) })}>
                Open ↗
              </button>
            </div>
          ))}
          {combo.leftover.length > 0 && (
            <div style={{ marginTop: 8, padding: "8px 10px", background: T.redBg, border: `1px solid ${T.red}`, borderRadius: 8, fontSize: 12 }}>
              <b>Coverage gap:</b> no PermSet in this org grants the following desired row(s).
              You may need to create a new PermSet to cover them:
              <div style={{ marginTop: 6, fontFamily: T.mono, fontSize: 11 }}>
                {combo.leftover.slice().sort().map(t => (
                  <div key={t} style={{ padding: "1px 0" }}><Pill tone="red">✗</Pill> <span style={{ color: T.accentLight }}>{tokenToLabel(t)}</span></div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// UX-51 v2.7: classify a token into one of four buckets used by the Subset
// extras expansion + the reconcile compare pane. Tokens look like O:<sobj>:<bit>,
// F:<field>:<bit>, S:<permName>, or T:<tabName>/E:<setupEntityId>. We don't
// currently emit T/E in grantorSignature — setup-entity tokens are surfaced
// via `idx.setupByParent` separately below.
function classifyToken(tok) {
  if (!tok) return "other";
  if (tok.startsWith("O:")) return "objects";
  if (tok.startsWith("F:")) return "fields";
  if (tok.startsWith("S:")) return "system";
  if (tok.startsWith("T:") || tok.startsWith("E:")) return "setup";
  return "other";
}

// UX-51 v2.7: compute extras for (A ⊂ B) subset relationship, grouped by category.
// Objects track each CRUD bit separately so the admin sees C/R/E/D/VA/MA granularly.
// Setup-entity extras come from `idx.setupByParent` and are grouped by SetupEntityType.
function subsetExtras(idx, subsetId, supersetId) {
  const sigA = grantorSignature(idx, subsetId);
  const sigB = grantorSignature(idx, supersetId);
  const extras = [...sigB].filter(t => !sigA.has(t));
  const grouped = { objects: [], fields: [], system: [], setup: [] };
  for (const t of extras) grouped[classifyToken(t)].push(t);

  // Setup-entity extras — things like ApexClass / VisualforcePage visibility.
  const setupA = new Map(); // sei -> type
  for (const r of idx.setupByParent.get(subsetId) || []) setupA.set(r.SetupEntityId, r.SetupEntityType);
  for (const r of idx.setupByParent.get(supersetId) || []) {
    if (!setupA.has(r.SetupEntityId)) {
      grouped.setup.push(`E:${r.SetupEntityType}:${r.SetupEntityId}`);
    }
  }
  return {
    objects: grouped.objects.sort(),
    fields: grouped.fields.sort(),
    system: grouped.system.sort(),
    setup: grouped.setup.sort(),
    total: grouped.objects.length + grouped.fields.length + grouped.system.length + grouped.setup.length,
  };
}

// UX-52 v2.7: paired Has/Missing/Shared/Differs row model.
// Given two grantor signatures (sig A, sig B), produce a single row per
// permission "key" (object+bit, field+bit, or system perm) that records
// presence on each side and a label:
//   "Shared"  — both sides have it
//   "Has"     — only the named side has it (rendered under that column)
//   "Missing" — the named side does not have it (rendered under that column)
//   "Differs" — used at the granular level only if we were packing bits
//               into a compound row (not used in current token model — each
//               CRUD bit is its own token — but kept in the legend for
//               future-compat / clarity).
function pairedDiffLegend() {
  return [
    { term: "Has",     tone: "green",  desc: "This side grants the permission." },
    { term: "Missing", tone: "red",    desc: "This side does not grant the permission." },
    { term: "Shared",  tone: "mute",   desc: "Both sides grant it — no difference." },
    { term: "Differs", tone: "yellow", desc: "Same row but different bit pattern (e.g., one has Read, other has Read+Edit)." },
  ];
}

function PairedDiffLegend({ style }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "6px 0", fontSize: 11, ...style }}>
      <span style={{ color: T.textMuted, fontWeight: 600 }}>Legend:</span>
      {pairedDiffLegend().map(x => (
        <span key={x.term} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Pill tone={x.tone}>{x.term}</Pill>
          <span style={{ color: T.textMuted }}>{x.desc}</span>
        </span>
      ))}
    </div>
  );
}

// UX-52 v2.7: paired token → rows view. Each row has { token, label, inA, inB }.
// UI renders: for the A column, `Has: <label>` if inA, `Missing: <label>` if !inA;
// symmetrically for B. When both inA && inB the row is `Shared: <label>` on both
// sides. This replaces every "only in X" label across the app.
function PairedDiffPane({ aLabel, bLabel, tokens }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>{aLabel}</div>
          <div style={{ maxHeight: 260, overflow: "auto", fontFamily: T.mono, fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 8, padding: 8 }}>
            {tokens.length === 0 && <div style={{ color: T.textMuted }}>— nothing —</div>}
            {tokens.map((r, i) => {
              if (r.inA && r.inB) return <div key={i} style={{ marginBottom: 2 }}><Pill tone="mute">Shared</Pill> <span style={{ color: T.accentLight }}>{r.label}</span></div>;
              if (r.inA)          return <div key={i} style={{ marginBottom: 2 }}><Pill tone="green">Has</Pill> <span style={{ color: T.accentLight }}>{r.label}</span></div>;
                                  return <div key={i} style={{ marginBottom: 2 }}><Pill tone="red">Missing</Pill> <span style={{ color: T.textMuted }}>{r.label}</span></div>;
            })}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>{bLabel}</div>
          <div style={{ maxHeight: 260, overflow: "auto", fontFamily: T.mono, fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 8, padding: 8 }}>
            {tokens.length === 0 && <div style={{ color: T.textMuted }}>— nothing —</div>}
            {tokens.map((r, i) => {
              if (r.inA && r.inB) return <div key={i} style={{ marginBottom: 2 }}><Pill tone="mute">Shared</Pill> <span style={{ color: T.accentLight }}>{r.label}</span></div>;
              if (r.inB)          return <div key={i} style={{ marginBottom: 2 }}><Pill tone="green">Has</Pill> <span style={{ color: T.accentLight }}>{r.label}</span></div>;
                                  return <div key={i} style={{ marginBottom: 2 }}><Pill tone="red">Missing</Pill> <span style={{ color: T.textMuted }}>{r.label}</span></div>;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * 13. REDUNDANCY TAB (Section 6.3) — duplicates, subsets, orphans, dead fields
 *    + dismissals (stored in bundle)
 * ==========================================================================*/
function RedundancyTab({ idx, dismissals, setDismissals, nav }) {
  const [overlap, setOverlap] = useState(null);
  const [overlapV26, setOverlapV26] = useState(null); // UX-40 includes near-duplicate bucket
  const [orphans, setOrphans] = useState(null);
  const [dead, setDead] = useState(null);
  // UX-21 + UX-40: Compare pane state (pair currently being inspected side-by-side).
  // UX-51 v2.7: subsetExpanded map drives the per-row extras expansion.
  const { compareOverlapPair, setCompareOverlapPair,
          reconcileSelection, setReconcileSelection,
          subsetExpanded, setSubsetExpanded } = useAppState();

  useEffect(() => {
    setTimeout(() => setOverlap(precomputePermSetOverlap(idx)), 20);
    setTimeout(() => setOverlapV26(precomputePermSetOverlapV26(idx)), 25);
    setTimeout(() => setOrphans(precomputeOrphans(idx)), 30);
    setTimeout(() => setDead(precomputeDeadFields(idx)), 40);
  }, [idx]);

  const isDismissed = key => !!dismissals.find(d => d.key === key);
  const dismiss = (key, category, reason) => {
    if (isDismissed(key)) return;
    setDismissals([...dismissals, { key, category, reason: reason || "", at: new Date().toISOString() }]);
  };
  const undismiss = key => setDismissals(dismissals.filter(d => d.key !== key));

  return (
    <div style={{ padding: "24px clamp(16px, 2vw, 48px)", width: "100%", boxSizing: "border-box", margin: "0 auto" }}>
      <HeaderBlock title="Overlap & Redundancy" subtitle="Consolidation opportunities across profiles and permission sets."
        tags={[<Pill key="d" tone="yellow">{dismissals.length} dismissed</Pill>]} />
      {/* v2.6 UX-39: block-level descriptions for every panel. */}
      <div style={{ background: T.bgAlt, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, marginBottom: 14, fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
        <div style={{ marginBottom: 4 }}><b style={{ color: T.text }}>Duplicate PermSets</b> — two PermSets grant exactly the same object/field/system permission tokens (ignoring ID and name). Consolidate to the more descriptive label.</div>
        <div style={{ marginBottom: 4 }}><b style={{ color: T.text }}>Subset Relationships</b> — one PermSet is entirely contained within another. Users assigned the subset could be moved to the superset without losing any grant.</div>
        <div style={{ marginBottom: 4 }}><b style={{ color: T.text }}>Orphaned PermSets</b> — no user is assigned and the PermSet is not a member of any PermSet Group. Safe to archive after confirming no integration or automation references it.</div>
        <div><b style={{ color: T.text }}>Dead Fields</b> — a FieldPermissions row exists but no assigned grantor propagates Read or Edit to any active user. Candidate for cleanup on the source metadata.</div>
      </div>

      {!overlap ? <div style={{ padding: 40, textAlign: "center" }}><span className="pe-spinner" /> Computing…</div> : (() => {
        // UX-51 v2.7: compute extras per subset row, then auto-reclassify any
        // zero-extras rows into the Duplicates bucket (per acceptance criterion).
        const subsetsAnnotated = (overlap.subsets || []).map(s => ({
          ...s,
          extras: subsetExtras(idx, s.subsetId, s.supersetId),
        }));
        const reallySubsets = subsetsAnnotated.filter(s => s.extras.total > 0);
        const reclassifiedAsDup = subsetsAnnotated.filter(s => s.extras.total === 0).map(s => ({
          a: s.subsetId, b: s.supersetId,
          aLabel: s.subsetLabel, bLabel: s.supersetLabel,
          reclassified: true,
        }));
        const allDups = [...(overlap.dups || []), ...reclassifiedAsDup];
        return (
        <>
          <SubSectionTable title="Duplicate PermSets" rows={allDups.filter(d => !isDismissed(`dup|${d.a}|${d.b}`))} columns={[
            { key: "aLabel", label: "PermSet A", render: r => (
              <span>
                <span onClick={() => nav({ kind: "PermissionSet", item: idx.permSetById.get(r.a) })} style={{ color: T.accentLight, cursor: "pointer" }}>{r.aLabel}</span>
                {r.reclassified && <Pill tone="yellow" style={{ marginLeft: 6 }}>reclassified from Subset (zero extras)</Pill>}
              </span>
            ) },
            { key: "bLabel", label: "PermSet B", render: r => <span onClick={() => nav({ kind: "PermissionSet", item: idx.permSetById.get(r.b) })} style={{ color: T.accentLight, cursor: "pointer" }}>{r.bLabel}</span> },
            { key: "actions", label: "", render: r => <button className="pe-btn ghost" style={{ fontSize: 11 }} onClick={() => {
              const reason = prompt("Dismissal reason (optional):") || "";
              dismiss(`dup|${r.a}|${r.b}`, "duplicate", reason);
            }}>Dismiss</button> },
          ]} getRowId={r => `${r.a}|${r.b}`} emptyText="No duplicate PermSets detected." />

          {/* UX-51 v2.7: Subset Relationships — expandable rows that show the
              substantive extras grouped by category (Objects / Fields / System /
              Setup Entities). Zero-extras relationships were moved to the
              Duplicates table above. */}
          <div style={{ marginBottom: 14 }}>
            <SectionHeader
              title="Subset Relationships"
              count={reallySubsets.length}
              right={<ExportCSVButton
                rows={reallySubsets.flatMap(s =>
                  [...s.extras.objects, ...s.extras.fields, ...s.extras.system, ...s.extras.setup]
                    .map(t => ({ subset: s.subsetLabel, superset: s.supersetLabel, category: classifyToken(t), token: t, label: tokenToNoun(t) })))}
                columns={["subset", "superset", "category", "token", "label"]}
                filename="subset_extras.csv" />} />
            {reallySubsets.length === 0 && <Empty text="No subset relationships detected." />}
            {reallySubsets.filter(d => !isDismissed(`sub|${d.subsetId}|${d.supersetId}`)).map(row => {
              const rowKey = `${row.subsetId}|${row.supersetId}`;
              const expanded = !!(subsetExpanded && subsetExpanded[rowKey]);
              const toggle = () => setSubsetExpanded({ ...(subsetExpanded || {}), [rowKey]: !expanded });
              return (
                <div key={rowKey} style={{ border: `1px solid ${T.border}`, borderRadius: 10, marginBottom: 8, background: T.card }}>
                  <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <button className="pe-btn ghost" style={{ fontSize: 11, padding: "2px 6px" }} onClick={toggle}>{expanded ? "▼" : "▶"}</button>
                    <div>
                      <span style={{ color: T.textMuted, fontSize: 11, marginRight: 6 }}>Subset</span>
                      <span onClick={() => nav({ kind: "PermissionSet", item: idx.permSetById.get(row.subsetId) })} style={{ color: T.accentLight, cursor: "pointer" }}>{row.subsetLabel}</span>
                    </div>
                    <span style={{ color: T.textMuted }}>⊂</span>
                    <div>
                      <span style={{ color: T.textMuted, fontSize: 11, marginRight: 6 }}>Superset</span>
                      <span onClick={() => nav({ kind: "PermissionSet", item: idx.permSetById.get(row.supersetId) })} style={{ color: T.accentLight, cursor: "pointer" }}>{row.supersetLabel}</span>
                    </div>
                    <div style={{ flex: 1 }} />
                    <Pill tone="accent">Objects {row.extras.objects.length}</Pill>
                    <Pill tone="purple">Fields {row.extras.fields.length}</Pill>
                    <Pill tone="yellow">System {row.extras.system.length}</Pill>
                    <Pill tone="mute">Setup {row.extras.setup.length}</Pill>
                    <button className="pe-btn ghost" style={{ fontSize: 11 }}
                      onClick={() => setCompareOverlapPair({ aId: row.subsetId, bId: row.supersetId })}>Open side-by-side</button>
                    <button className="pe-btn ghost" style={{ fontSize: 11 }} onClick={() => {
                      const reason = prompt("Dismissal reason (optional):") || "";
                      dismiss(`sub|${row.subsetId}|${row.supersetId}`, "subset", reason);
                    }}>Dismiss</button>
                  </div>
                  {expanded && (
                    <div style={{ padding: "0 12px 12px 12px", borderTop: `1px dashed ${T.border}` }}>
                      <div style={{ fontSize: 12, color: T.textMuted, padding: "6px 0" }}>
                        Extras that <b>{row.supersetLabel}</b> grants beyond <b>{row.subsetLabel}</b> — users moved from the subset
                        would <i>gain</i> these permissions.
                      </div>
                      <PairedDiffLegend />
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        {[
                          { k: "objects", label: "Objects", tone: "accent" },
                          { k: "fields", label: "Fields", tone: "purple" },
                          { k: "system", label: "System Perms", tone: "yellow" },
                          { k: "setup", label: "Setup Entities", tone: "mute" },
                        ].map(cat => (
                          <div key={cat.k}>
                            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                              <Pill tone={cat.tone}>{cat.label}</Pill>
                              <span>{row.extras[cat.k].length} extras</span>
                            </div>
                            <div style={{ maxHeight: 160, overflow: "auto", fontFamily: T.mono, fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 8, padding: 8 }}>
                              {row.extras[cat.k].length === 0 && <div style={{ color: T.textMuted }}>— none —</div>}
                              {row.extras[cat.k].map((t, i) => (
                                <div key={i} style={{ marginBottom: 2, display: "flex", gap: 6, alignItems: "center" }}>
                                  <Pill tone="red">Missing</Pill>
                                  <span style={{ color: T.textMuted }}>{row.subsetLabel}:</span>
                                  <span>/</span>
                                  <Pill tone="green">Has</Pill>
                                  <span style={{ color: T.accentLight }}>{tokenToNoun(t)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* v2.6 UX-40: Near-duplicate PermSets (Jaccard ≥ 0.85, not exact).
              Each row offers Compare (shows Venn-like side-by-side) and Reconcile (launches UX-22 workflow). */}
          <SubSectionTable
            title="Near-duplicate PermSets (Jaccard ≥ 0.85)"
            rows={(overlapV26 ? overlapV26.nearDups : []).filter(d => !isDismissed(`near|${d.a}|${d.b}`))}
            columns={[
              { key: "aLabel", label: "PermSet A", render: r => <span onClick={() => nav({ kind: "PermissionSet", item: idx.permSetById.get(r.a) })} style={{ color: T.accentLight, cursor: "pointer" }}>{r.aLabel}</span> },
              { key: "bLabel", label: "PermSet B", render: r => <span onClick={() => nav({ kind: "PermissionSet", item: idx.permSetById.get(r.b) })} style={{ color: T.accentLight, cursor: "pointer" }}>{r.bLabel}</span> },
              { key: "score", label: "Jaccard", render: r => <Pill tone={r.score >= 0.95 ? "red" : r.score >= 0.90 ? "orange" : "yellow"}>{(r.score * 100).toFixed(1)}%</Pill> },
              { key: "shared", label: "Shared" },
              { key: "diff", label: "Has-A / Has-B", render: r => (
                <span style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted }}
                      title="Count of tokens A has that B is missing / B has that A is missing (UX-52).">
                  {(r.aOnly||[]).length} / {(r.bOnly||[]).length}
                </span>) },
              { key: "actions", label: "", render: r => (
                <span style={{ display: "inline-flex", gap: 6 }}>
                  <button className="pe-btn ghost" style={{ fontSize: 11 }} onClick={() => setCompareOverlapPair({ aId: r.a, bId: r.b })}>Compare</button>
                  <button className="pe-btn ghost" style={{ fontSize: 11 }} onClick={() => setReconcileSelection({ aId: r.a, bId: r.b })}>Reconcile</button>
                  <button className="pe-btn ghost" style={{ fontSize: 11 }} onClick={() => {
                    const reason = prompt("Dismissal reason (optional):") || "";
                    dismiss(`near|${r.a}|${r.b}`, "near-duplicate", reason);
                  }}>Dismiss</button>
                </span>
              ) },
            ]}
            getRowId={r => `${r.a}|${r.b}`}
            emptyText="No near-duplicates detected." />

          {/* UX-40 + UX-52 v2.7: Compare pane — paired Has/Missing/Shared rows.
              Works for any pair of PermSets / Profiles, including subsets opened
              from the new UX-51 "Open side-by-side" affordance. */}
          {compareOverlapPair && (() => {
            const aPs = idx.permSetById.get(compareOverlapPair.aId);
            const bPs = idx.permSetById.get(compareOverlapPair.bId);
            if (!aPs || !bPs) return null;
            const sigA = grantorSignature(idx, aPs.Id);
            const sigB = grantorSignature(idx, bPs.Id);
            const all = [...new Set([...sigA, ...sigB])].sort();
            const rows = all.map(t => ({ token: t, label: tokenToNoun(t), inA: sigA.has(t), inB: sigB.has(t) }));
            const shared = rows.filter(r => r.inA && r.inB).length;
            const aOnly = rows.filter(r => r.inA && !r.inB).length;
            const bOnly = rows.filter(r => !r.inA && r.inB).length;
            const aLabel = aPs.Label || aPs.Name;
            const bLabel = bPs.Label || bPs.Name;
            // Match the UX-40 score from the overlapV26 cache if we have it.
            const pair = overlapV26 && (
              overlapV26.nearDups.find(n => n.a === aPs.Id && n.b === bPs.Id) ||
              overlapV26.dups.find(n => (n.a === aPs.Id && n.b === bPs.Id) || (n.b === aPs.Id && n.a === bPs.Id))
            );
            return (
              <div style={{ background: T.card, border: `1px solid ${T.accentBorder || T.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <div style={{ fontWeight: 600 }}>Compare — {aLabel} vs {bLabel}</div>
                  {pair && pair.score != null && <Pill tone="accent">Jaccard {(pair.score * 100).toFixed(1)}%</Pill>}
                  <Pill tone="mute">{shared} shared</Pill>
                  <Pill tone="green">{aOnly} has-only on A</Pill>
                  <Pill tone="green">{bOnly} has-only on B</Pill>
                  <div style={{ flex: 1 }} />
                  <button className="pe-btn ghost" onClick={() => setCompareOverlapPair(null)}>Close</button>
                </div>
                <PairedDiffLegend />
                <PairedDiffPane aLabel={aLabel} bLabel={bLabel} tokens={rows} />
              </div>
            );
          })()}

          {/* v2.6 UX-22: Reconcile PermSets workflow — pick one to keep, see the exact
              users who'd need to be migrated and the token-level diff of the plan. */}
          {reconcileSelection && (() => {
            const a = idx.permSetById.get(reconcileSelection.aId);
            const b = idx.permSetById.get(reconcileSelection.bId);
            if (!a || !b) return null;
            const sigA = grantorSignature(idx, a.Id);
            const sigB = grantorSignature(idx, b.Id);
            const shared = [...sigA].filter(t => sigB.has(t));
            const aOnly  = [...sigA].filter(t => !sigB.has(t));
            const bOnly  = [...sigB].filter(t => !sigA.has(t));
            const usersA = new Set((idx.psaByPermSet.get(a.Id) || []).map(x => x.UserId));
            const usersB = new Set((idx.psaByPermSet.get(b.Id) || []).map(x => x.UserId));
            const keep = reconcileSelection.keep || null; // "a" | "b" | null
            const setKeep = which => setReconcileSelection({ ...reconcileSelection, keep: which });
            const drop = keep === "a" ? b : keep === "b" ? a : null;
            const droppedUsers = keep === "a" ? usersB : keep === "b" ? usersA : new Set();
            const migrateNeeded = [...droppedUsers].filter(uid => !(keep === "a" ? usersA : usersB).has(uid));
            const extraTokens = keep === "a" ? bOnly : keep === "b" ? aOnly : [];
            return (
              <div style={{ background: T.card, border: `2px solid ${T.accent}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: T.glow }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Reconcile workflow</div>
                  <Pill tone="accent">UX-22</Pill>
                  <div style={{ flex: 1 }} />
                  <button className="pe-btn ghost" onClick={() => setReconcileSelection(null)}>Close</button>
                </div>
                <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 10 }}>
                  Choose which PermSet to keep. The other is removed and its assignees are migrated to the
                  kept PermSet. The plan also shows whether the kept PermSet grants any token the dropped
                  PermSet didn't (so you can decide whether the migration is truly a superset consolidation
                  or a trade-off).
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <div style={{ padding: 12, border: `2px solid ${keep === "a" ? T.green : T.border}`, borderRadius: 10, cursor: "pointer" }} onClick={() => setKeep("a")}>
                    <div style={{ fontWeight: 600 }}>{a.Label}</div>
                    <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
                      {sigA.size} tokens · {usersA.size} users
                    </div>
                    {keep === "a" && <Pill tone="green" style={{ marginTop: 6 }}>KEEP</Pill>}
                  </div>
                  <div style={{ padding: 12, border: `2px solid ${keep === "b" ? T.green : T.border}`, borderRadius: 10, cursor: "pointer" }} onClick={() => setKeep("b")}>
                    <div style={{ fontWeight: 600 }}>{b.Label}</div>
                    <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
                      {sigB.size} tokens · {usersB.size} users
                    </div>
                    {keep === "b" && <Pill tone="green" style={{ marginTop: 6 }}>KEEP</Pill>}
                  </div>
                </div>
                {keep && drop && (
                  <div>
                    <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 6 }}>
                      Drop <b>{drop.Label}</b> → migrate <b>{migrateNeeded.length}</b> users to <b>{keep === "a" ? a.Label : b.Label}</b> (users already assigned to the kept PermSet need no action).
                    </div>
                    {/* UX-52 v2.7: legend + explicit Has/Missing/Shared framing. */}
                    <PairedDiffLegend />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, fontSize: 12 }}>
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}><Pill tone="mute">Shared</Pill> Both PermSets grant ({shared.length})</div>
                        <div style={{ maxHeight: 180, overflow: "auto", fontFamily: T.mono, fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 6, padding: 6 }}>
                          {shared.slice(0, 100).map((t, i) => <div key={i}>{tokenToNoun(t)}</div>)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 4, color: T.red }}>
                          <Pill tone="red">Missing</Pill> on <b>{keep === "a" ? a.Label : b.Label}</b> · dropped users would lose ({keep === "a" ? bOnly.length : aOnly.length})
                        </div>
                        <div style={{ maxHeight: 180, overflow: "auto", fontFamily: T.mono, fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 6, padding: 6 }}>
                          {(keep === "a" ? bOnly : aOnly).slice(0, 100).map((t, i) => <div key={i} style={{ color: T.red }}>{tokenToNoun(t)}</div>)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 4, color: T.green }}>
                          <Pill tone="green">Has</Pill> on <b>{keep === "a" ? a.Label : b.Label}</b> but not on {drop.Label} · dropped users would gain ({extraTokens.length})
                        </div>
                        <div style={{ maxHeight: 180, overflow: "auto", fontFamily: T.mono, fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 6, padding: 6 }}>
                          {extraTokens.slice(0, 100).map((t, i) => <div key={i} style={{ color: T.green }}>{tokenToNoun(t)}</div>)}
                        </div>
                      </div>
                    </div>
                    <div style={{ marginTop: 10, fontSize: 11, color: T.textMuted }}>
                      Migration plan is read-only — this tool doesn't modify your org. Export the plan via the Export button below
                      and run it through your change-management workflow (eg. Salesforce CLI or ChangeSet).
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <ExportCSVButton
                        rows={[
                          ...migrateNeeded.map(uid => {
                            const u = idx.userById.get(uid);
                            return { userId: uid, userName: (u && u.Name) || uid, action: `Assign ${keep === "a" ? a.Label : b.Label}` };
                          }),
                          ...[...droppedUsers].map(uid => {
                            const u = idx.userById.get(uid);
                            return { userId: uid, userName: (u && u.Name) || uid, action: `Unassign ${drop.Label}` };
                          }),
                        ]}
                        columns={["userId", "userName", "action"]}
                        filename={`reconcile_${a.Name}_${b.Name}.csv`} />
                    </div>
                  </div>
                )}
              </div>
            );
          })()}


          <SubSectionTable title="Orphaned PermSets" rows={(orphans || []).filter(p => !isDismissed(`orphan|${p.Id}`))} columns={[
            { key: "Label", label: "PermSet", render: r => <span onClick={() => nav({ kind: "PermissionSet", item: r })} style={{ color: T.accentLight, cursor: "pointer" }}>{r.Label}</span> },
            { key: "Name", label: "Dev name", render: r => <span style={{ fontFamily: T.mono, color: T.textMuted }}>{r.Name}</span> },
            { key: "actions", label: "", render: r => <button className="pe-btn ghost" style={{ fontSize: 11 }} onClick={() => {
              const reason = prompt("Dismissal reason (optional):") || "";
              dismiss(`orphan|${r.Id}`, "orphan", reason);
            }}>Dismiss</button> },
          ]} getRowId={r => r.Id} emptyText="No orphaned PermSets (every PermSet is either assigned or a group member)." />

          <SubSectionTable title="Dead Fields" rows={(dead || []).filter(d => !isDismissed(`dead|${d.field}`))} columns={[
            { key: "field", label: "Field", render: r => <span style={{ fontFamily: T.mono, color: T.accentLight }}>{r.field}</span> },
            { key: "sobject", label: "Object" },
            { key: "actions", label: "", render: r => <button className="pe-btn ghost" style={{ fontSize: 11 }} onClick={() => {
              const reason = prompt("Dismissal reason (optional):") || "";
              dismiss(`dead|${r.field}`, "dead-field", reason);
            }}>Dismiss</button> },
          ]} getRowId={r => r.field} emptyText="No dead fields — every FLS grant maps to at least one assigned user." />
        </>
        );
      })()}

      {dismissals.length > 0 && (
        <ExpandableCard header={<div>Dismissals — {dismissals.length}</div>}>
          <SubSectionTable title="" rows={dismissals} columns={[
            { key: "category", label: "Kind" },
            { key: "key", label: "Key", render: r => <span style={{ fontFamily: T.mono, fontSize: 11 }}>{r.key}</span> },
            { key: "reason", label: "Reason" },
            { key: "at", label: "At", render: r => <span style={{ fontSize: 11, color: T.textMuted }}>{r.at}</span> },
            { key: "undo", label: "", render: r => <button className="pe-btn ghost" style={{ fontSize: 11 }} onClick={() => undismiss(r.key)}>Undo</button> },
          ]} getRowId={r => r.key} emptyText="No dismissals." />
        </ExpandableCard>
      )}
    </div>
  );
}

/* ============================================================================
 * 14. MIGRATION TAB (Section 6.4) — Jaccard clustering + three-way decomposition
 * ==========================================================================*/
function MigrationTab({ idx, nav }) {
  const [data, setData] = useState(null);
  const [focus, setFocus] = useState(null);
  useEffect(() => { setTimeout(() => setData(precomputeProfileSimilarity(idx)), 20); }, [idx]);
  if (!data) return <div style={{ padding: 40, textAlign: "center" }}><span className="pe-spinner" /> Clustering profiles…</div>;

  return (
    <div style={{ padding: "24px clamp(16px, 2vw, 48px)", width: "100%", boxSizing: "border-box", margin: "0 auto" }}>
      <HeaderBlock title="Profile → PermSet Group Migration" subtitle="Similarity clustering (Jaccard > 0.70) and three-way decomposition." tags={[<Pill key="c" tone="purple">{data.clusters.length} clusters</Pill>]} />
      {/* v2.6 UX-41: descriptions for every migration block. */}
      <div style={{ background: T.bgAlt, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, marginBottom: 14, fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
        <div style={{ marginBottom: 4 }}><b style={{ color: T.text }}>Profile Pairs</b> — two profiles whose effective-permission sets overlap at or above the Jaccard threshold (default 0.70). Starting here helps you find the first consolidation candidates before committing to a cluster-wide migration.</div>
        <div style={{ marginBottom: 4 }}><b style={{ color: T.text }}>Clusters</b> — transitively connected groups of profiles (via pairwise similarity edges). Each cluster is a candidate for replacement by a single PermSet Group with muting overrides.</div>
        <div style={{ marginBottom: 4 }}><b style={{ color: T.text }}>Shared Base</b> — the intersection of every profile's tokens in the cluster. These become the grants on the new consolidated PermSet Group.</div>
        <div style={{ marginBottom: 4 }}><b style={{ color: T.text }}>Additive deltas</b> — per profile, the tokens that exist in that profile but not in the shared base. Each becomes an additive PermSet assigned to the users of that profile.</div>
        <div><b style={{ color: T.text }}>Muting candidates</b> — per profile, the tokens present in the shared base but not in that profile. Implemented as a Muting PermSet so the consolidated group doesn't over-grant users who didn't have that permission originally.</div>
      </div>

      <SubSectionTable title="Profile Pairs (>70% similarity)" rows={data.pairs} columns={[
        { key: "aName", label: "Profile A", render: r => <span onClick={() => { const p = idx.profileById.get(r.a); if (p) nav({ kind: "Profile", item: p }); }} style={{ color: T.accentLight, cursor: "pointer" }}>{r.aName}</span> },
        { key: "bName", label: "Profile B", render: r => <span onClick={() => { const p = idx.profileById.get(r.b); if (p) nav({ kind: "Profile", item: p }); }} style={{ color: T.accentLight, cursor: "pointer" }}>{r.bName}</span> },
        { key: "score", label: "Jaccard", render: r => <Pill tone="accent">{(r.score * 100).toFixed(0)}%</Pill> },
      ]} getRowId={r => `${r.a}|${r.b}`} emptyText="No profile pairs meet the 70% threshold." />

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Clusters</div>
        {data.clusters.map((cluster, i) => {
          const sigs = cluster.map(c => data.sigs.find(s => s.id === c.id));
          const decomp = threeWayDecomposition(sigs);
          return (
            <div key={i} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>Cluster {i + 1}:</div>
                {cluster.map(c => <Pill key={c.id} tone="purple" onClick={() => nav({ kind: "Profile", item: idx.profileById.get(c.id) })}>{c.name}</Pill>)}
              </div>
              <details>
                <summary style={{ color: T.accent, fontSize: 12 }}>Shared Base — {decomp.shared.size} tokens ▾</summary>
                <div style={{ fontFamily: T.mono, fontSize: 11, padding: 8, color: T.green, maxHeight: 160, overflow: "auto" }}>
                  {[...decomp.shared].slice(0, 200).map((t, k) => <div key={k}>{t}</div>)}
                </div>
              </details>
              <details>
                <summary style={{ color: T.accent, fontSize: 12 }}>Additive deltas per profile ▾</summary>
                {cluster.map(c => (
                  <div key={c.id} style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: T.textMuted }}>{c.name} — {decomp.additive[c.id].length} tokens</div>
                    <div style={{ fontFamily: T.mono, fontSize: 11, padding: 4, color: T.accentLight, maxHeight: 120, overflow: "auto" }}>
                      {decomp.additive[c.id].slice(0, 100).map((t, k) => <div key={k}>{t}</div>)}
                    </div>
                  </div>
                ))}
              </details>
              <details>
                <summary style={{ color: T.accent, fontSize: 12 }}>Muting candidates per profile ▾</summary>
                {cluster.map(c => (
                  <div key={c.id} style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: T.textMuted }}>{c.name} — {decomp.muting[c.id].length} tokens missing from shared base</div>
                    <div style={{ fontFamily: T.mono, fontSize: 11, padding: 4, color: T.red, maxHeight: 120, overflow: "auto" }}>
                      {decomp.muting[c.id].slice(0, 100).map((t, k) => <div key={k}>{t}</div>)}
                    </div>
                  </div>
                ))}
              </details>
            </div>
          );
        })}
        {data.clusters.length === 0 && <Empty text="No high-similarity clusters (using Jaccard ≥ 0.70)." />}
      </div>
    </div>
  );
}

/* ============================================================================
 * 15. ROOT COMPONENT + tab routing + CSV & bundle handlers
 * ==========================================================================*/

function validateCsv(fileMeta, headers, rows) {
  // required headers
  const hs = new Set(headers);
  const missing = (fileMeta.required || []).filter(c => !hs.has(c));
  const errors = [];
  const warnings = [];
  if (missing.length) errors.push(`Missing required column(s): ${missing.join(", ")}`);
  if (rows.length === 0) warnings.push("File contains zero rows.");
  if (rows.length > 0 && rows.length < 5) warnings.push(`Only ${rows.length} rows — verify the export.`);
  return { errors, warnings };
}

// v2.6 UX-21: AppStateContext — holds tab-scoped UI state so selections, filters,
// sorts, and workflow progress survive tab switches without hitting localStorage
// (which is blocked in the sandboxed iframe).
const AppStateContext = createContext(null);
function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used inside AppStateProvider");
  return ctx;
}
function AppStateProvider({ children }) {
  // Explorer
  const [explorerEntry, setExplorerEntry] = useState("User");
  const [explorerSelection, setExplorerSelection] = useState(null);
  const [explorerSearch, setExplorerSearch] = useState("");
  // Change Impact
  const [impactScenario, setImpactScenario] = useState("A");
  const [impactFilterUser, setImpactFilterUser] = useState("");
  const [impactFilterPs, setImpactFilterPs] = useState("");
  const [impactFilterProfile, setImpactFilterProfile] = useState("");
  const [impactSortKey, setImpactSortKey] = useState("severity");
  // BUG-13 v2.7: direction for Total column cycles desc -> asc -> null (unsorted).
  // For other keys the direction is forced to "desc" on first activation but remains
  // toggleable via the header.
  const [impactSortDir, setImpactSortDir] = useState("desc"); // "desc" | "asc" | null
  const [expandedImpactRows, setExpandedImpactRows] = useState({}); // rowKey -> bool
  const [deleteSelectedPs, setDeleteSelectedPs] = useState(null);
  const [modifyCurrentProfile, setModifyCurrentProfile] = useState(null);
  const [modifyFutureProfile, setModifyFutureProfile] = useState(null);
  const [modifyCompareTab, setModifyCompareTab] = useState("objects");
  const [modifyOnlyDiff, setModifyOnlyDiff] = useState(true);
  const [revokeFieldSel, setRevokeFieldSel] = useState({ ps: null, obj: null, fld: null });
  // User detail
  const [hideZeroGrantObjects, setHideZeroGrantObjects] = useState(true); // UX-23
  // Redundancy
  const [redundancyDismissals, setRedundancyDismissals] = useState([]);
  const [compareOverlapPair, setCompareOverlapPair] = useState(null); // UX-40
  // Migration
  const [compareProfilesPair, setCompareProfilesPair] = useState(null); // UX-42
  const [migrationConfirmed, setMigrationConfirmed] = useState({});   // clusterIdx -> bool (UX-43)
  const [migrationRejected, setMigrationRejected] = useState({});     // clusterIdx -> reason (UX-43)
  // Reconcile workflow (UX-22)
  const [reconcileSelection, setReconcileSelection] = useState(null); // {aId, bId}

  // BUG-12 v2.7: Object -> Field cascade scope lives here so tabs can share it.
  // Key = caller scope id (e.g. "user:<userId>", "profile:<profileId>", "permset:<psId>").
  // Value = SobjectType (string) or null.
  const [cascadeObject, setCascadeObject] = useState({}); // { [scopeId]: SobjectType }

  // UX-47 v2.7: Prescribe Access view state.
  const [prescribeUser, setPrescribeUser] = useState(null);   // User row
  const [prescribeRows, setPrescribeRows] = useState([]);     // array of desired-access rows
  const [prescribeRank, setPrescribeRank] = useState(null);   // cached ranking result
  // rows look like: { id, kind: "object"|"field"|"syspm",
  //                   sobjectType, field, crud: {R,C,E,D,VA,MA}, sysKey }

  // UX-51 v2.7: expanded state for Subset extras rows.
  const [subsetExpanded, setSubsetExpanded] = useState({}); // "a|b" -> bool

  const resetAll = useCallback(() => {
    setExplorerSelection(null); setExplorerSearch("");
    setImpactFilterUser(""); setImpactFilterPs(""); setImpactFilterProfile("");
    setImpactSortKey("severity"); setImpactSortDir("desc"); // BUG-13 v2.7
    setExpandedImpactRows({});
    setDeleteSelectedPs(null);
    setModifyCurrentProfile(null); setModifyFutureProfile(null); setModifyCompareTab("objects"); setModifyOnlyDiff(true);
    setRevokeFieldSel({ ps: null, obj: null, fld: null });
    setCompareOverlapPair(null); setCompareProfilesPair(null);
    setReconcileSelection(null);
    setMigrationConfirmed({}); setMigrationRejected({});
    // v2.7 resets
    setCascadeObject({});
    setPrescribeUser(null); setPrescribeRows([]); setPrescribeRank(null);
    setSubsetExpanded({});
  }, []);

  const value = {
    explorerEntry, setExplorerEntry,
    explorerSelection, setExplorerSelection,
    explorerSearch, setExplorerSearch,
    impactScenario, setImpactScenario,
    impactFilterUser, setImpactFilterUser,
    impactFilterPs, setImpactFilterPs,
    impactFilterProfile, setImpactFilterProfile,
    impactSortKey, setImpactSortKey,
    impactSortDir, setImpactSortDir,            // BUG-13 v2.7
    expandedImpactRows, setExpandedImpactRows,
    deleteSelectedPs, setDeleteSelectedPs,
    modifyCurrentProfile, setModifyCurrentProfile,
    modifyFutureProfile, setModifyFutureProfile,
    modifyCompareTab, setModifyCompareTab,
    modifyOnlyDiff, setModifyOnlyDiff,
    revokeFieldSel, setRevokeFieldSel,
    hideZeroGrantObjects, setHideZeroGrantObjects,
    redundancyDismissals, setRedundancyDismissals,
    compareOverlapPair, setCompareOverlapPair,
    compareProfilesPair, setCompareProfilesPair,
    migrationConfirmed, setMigrationConfirmed,
    migrationRejected, setMigrationRejected,
    reconcileSelection, setReconcileSelection,
    // v2.7 additions
    cascadeObject, setCascadeObject,                    // BUG-12
    prescribeUser, setPrescribeUser,                    // UX-47
    prescribeRows, setPrescribeRows,                    // UX-47
    prescribeRank, setPrescribeRank,                    // UX-47
    subsetExpanded, setSubsetExpanded,                  // UX-51
    resetAll,
  };
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export default function PermissionExplorer() {
  // ---- Loading indicator (BUG-1 / UX-2 / UX-3) ----
  // "Async loading" = JS parse + fallback index build, synchronous but deferred
  // one tick so the spinner can paint.
  const [bootLoading, setBootLoading] = useState(true);
  const [tab, setTab] = useState("admin"); // v3.0: default to Admin so first-load lands on the upload UI.

  // ---- Datasets + source tracking ----
  const [datasets, setDatasets] = useState(null);
  const [source, setSource] = useState(null); // "upload" | "bundle" | "cache" | "none"
  const [sourceTs, setSourceTs] = useState(null);
  const [cachedAt, setCachedAt] = useState(null); // ISO ts of cached pebundle (when source==="cache")
  const [uploadedAt, setUploadedAt] = useState({});
  const [uploadErrors, setUploadErrors] = useState({}); // fileKey -> error
  const [customWarnings, setCustomWarnings] = useState([]); // upload validation warnings

  // ---- Selection + precomputes cached per-dataset ----
  const [selection, setSelection] = useState(null);
  const [impactMatrix, setImpactMatrix] = useState(null);
  const [deleteCandidates, setDeleteCandidates] = useState(null);
  const [dismissals, setDismissals] = useState([]);
  // v2.6 UX-20: Load All Computations — pre-builds Impact Matrix + Delete candidates + migration.
  const [computing, setComputing] = useState(false);
  const [computingProgress, setComputingProgress] = useState("");

  // ---- Banner auto-dismiss for bundle-import errors ----
  const [banner, setBanner] = useState(null);

  // v3.0: hydrate from IndexedDB cache. No network calls. On miss → empty
  // dataset and the user starts on Admin. On stale-hit → load anyway, banner
  // prompts a refresh.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cached = await idbReadCache();
        if (cancelled) return;
        if (cached && datasetsHaveData(cached.datasets)) {
          setDatasets(cached.datasets);
          setDismissals(cached.dismissals || []);
          setSource("cache");
          setSourceTs(Date.now());
          setCachedAt(cached.cachedAt);
          const age = ageInDays(cached.cachedAt);
          if (age > CACHE_STALE_DAYS) {
            setBanner({
              tone: "yellow",
              text: `Cached dataset is ${Math.round(age)} days old (older than ${CACHE_STALE_DAYS}-day staleness threshold). Re-upload CSVs or import a fresh weekly .pebundle from your Cowork folder to refresh.`,
            });
          }
          // Cache hit — bring the user back to Explorer rather than Admin.
          setTab("explorer");
        } else {
          setDatasets(EMPTY_DATASETS);
          setSource("none");
          setSourceTs(Date.now());
          // No banner — the empty state in the UI is signal enough, and the
          // user is already on the Admin tab.
        }
      } catch {
        if (cancelled) return;
        setDatasets(EMPTY_DATASETS);
        setSource("none");
        setSourceTs(Date.now());
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Build indexes
  const idx = useMemo(() => datasets ? buildIndexes(datasets) : null, [datasets]);

  // Invalidate precomputes whenever datasets change (UX-14)
  useEffect(() => { setImpactMatrix(null); setDeleteCandidates(null); setSelection(null); }, [datasets]);
  // v2.6 UX-21: context state reset is wired inside <AppStateProvider> via a child
  // effect that watches the datasets prop. A simpler signal is passed via the
  // `datasetEpoch` ref below so components can watch it and call `resetAll()`.
  const datasetEpochRef = useRef(0);
  useEffect(() => { datasetEpochRef.current += 1; }, [datasets]);

  // ---- CSV upload handler ----
  // Uses a ref-tracked debounce to coalesce a batch of file uploads (the user
  // may select all 13 files at once via the multi-file picker, or paste them
  // in via drag-drop; we don't want to gzip+write to IDB 13 times in a row).
  // The actual cache write happens 1.5s after the last upload settles.
  const cacheWriteTimerRef = useRef(null);
  const onUpload = useCallback(async (fileKey, file) => {
    try {
      const text = await file.text();
      const { headers, rows } = parseCSV(text);
      const meta = FILE_BY_KEY[fileKey];
      const { errors, warnings } = validateCsv(meta, headers, rows);
      if (errors.length) {
        setUploadErrors(e => ({ ...e, [fileKey]: errors.join(" · ") }));
        setBanner({ tone: "red", text: `${file.name}: ${errors.join(" · ")}` });
        return;
      }
      setUploadErrors(e => { const n = { ...e }; delete n[fileKey]; return n; });
      setCustomWarnings(w => [...w.filter(x => x.file !== meta.filename),
        ...warnings.map(t => ({ level: "yellow", file: meta.filename, text: t }))]);
      // Merge into existing slots so partial uploads don't wipe unrelated data.
      // User can hit Reset to start clean.
      let nextDatasets = null;
      setDatasets(d => {
        const base = { ...(d || EMPTY_DATASETS) };
        base[fileKey] = rows;
        nextDatasets = base;
        return base;
      });
      setSource("upload");
      setSourceTs(Date.now());
      setCachedAt(null); // Newly uploaded — no longer "from cache."
      setUploadedAt(u => ({ ...u, [fileKey]: Date.now() }));
      setBanner({ tone: "green", text: `${meta.filename}: ${rows.length.toLocaleString()} rows loaded.` });
      // Debounced cache write.
      if (cacheWriteTimerRef.current) clearTimeout(cacheWriteTimerRef.current);
      cacheWriteTimerRef.current = setTimeout(() => {
        cacheWriteTimerRef.current = null;
        if (nextDatasets) idbWriteCache({ datasets: nextDatasets, dismissals });
      }, 1500);
    } catch (err) {
      setBanner({ tone: "red", text: `Failed to read ${file.name}: ${err.message}` });
    }
  }, [dismissals]);

  // ---- Bundle export handler ----
  const onExportBundle = useCallback(async () => {
    if (!datasets) return;
    const payload = {
      format: "pebundle",
      version: 1,
      createdAt: new Date().toISOString(),
      sourceOrg: "",
      appVersion: "2026-04-v3.0",
      datasets: Object.fromEntries(FILES.map(f => [f.key, {
        rows: datasets[f.key] || [],
        schema: (datasets[f.key] && datasets[f.key][0]) ? Object.keys(datasets[f.key][0]) : [],
      }])),
      dismissals,
    };
    try {
      const blob = await gzipJSON(payload);
      const now = new Date();
      const pad = n => String(n).padStart(2, "0");
      const name = `permission-explorer_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.pebundle`;
      downloadBlob(blob, name);
      setBanner({ tone: "green", text: `Bundle exported: ${name} (${(blob.size / (1024*1024)).toFixed(1)} MB).` });
    } catch (err) {
      setBanner({ tone: "red", text: `Export failed: ${err.message}` });
    }
  }, [datasets, dismissals]);

  // ---- Bundle import handler ----
  const onImportBundle = useCallback(async (file) => {
    try {
      const obj = await gunzipJSON(file);
      if (!obj || obj.format !== "pebundle" || typeof obj.version !== "number") {
        setBanner({ tone: "red", text: "File is not a valid .pebundle (missing format/version). Current dataset left untouched." });
        return;
      }
      if (obj.version > 1) {
        setBanner({ tone: "yellow", text: `Bundle version ${obj.version} is newer than this app. Attempting best-effort load.` });
      }
      const next = {};
      for (const f of FILES) next[f.key] = (obj.datasets && obj.datasets[f.key] && obj.datasets[f.key].rows) || [];
      const nextDismissals = Array.isArray(obj.dismissals) ? obj.dismissals : [];
      setDatasets(next);
      setSource("bundle");
      setSourceTs(Date.now());
      setCachedAt(null);
      setUploadedAt({});
      setDismissals(nextDismissals);
      setBanner({ tone: "green", text: `Bundle imported: ${file.name}.` });
      // Persist to IDB so the next session starts from this bundle automatically.
      idbWriteCache({ datasets: next, dismissals: nextDismissals });
    } catch (err) {
      setBanner({ tone: "red", text: `Import failed — file not recognized as a valid bundle. Current data untouched. (${err.message})` });
    }
  }, []);

  // ---- Reset (clears in-memory state AND the IDB cache) ----
  const onReset = useCallback(() => {
    (async () => {
      setUploadedAt({});
      setUploadErrors({});
      setDismissals([]);
      setCustomWarnings([]);
      setImpactMatrix(null);
      setDeleteCandidates(null);
      setDatasets(EMPTY_DATASETS);
      setSource("none");
      setSourceTs(Date.now());
      setCachedAt(null);
      const ok = await idbClearCache();
      setBanner({
        tone: ok ? "green" : "yellow",
        text: ok ? "Reset complete — cached data cleared. Upload CSVs or import a .pebundle to start." : "Reset complete (cache could not be cleared — IDB unavailable).",
      });
    })();
  }, []);

  // ---- Clear cache only (keeps in-memory dataset; next session boots empty) ----
  const onClearCache = useCallback(() => {
    (async () => {
      const ok = await idbClearCache();
      setCachedAt(null);
      // If we were sourced from cache, demote so the user sees we're working
      // off a non-persisted in-memory copy.
      setSource(s => s === "cache" ? "upload" : s);
      setBanner({
        tone: ok ? "green" : "yellow",
        text: ok ? "Cached data cleared. Current view stays loaded; close the tab to lose it." : "Cache could not be cleared — IDB unavailable.",
      });
    })();
  }, []);

  // v2.6 UX-20: Load All Computations — precompute Impact Matrix + Delete candidates
  // in sequence so admins can navigate to Change Impact / Redundancy instantly.
  const onLoadAllComputations = useCallback(() => {
    if (!idx || computing) return;
    setComputing(true);
    setComputingProgress("Starting…");
    setTimeout(() => {
      try {
        setComputingProgress("Phase 1/2 — Impact Matrix…");
        const im = precomputeImpactMatrix(idx, (d, t) => {
          if ((d & 255) === 0) setComputingProgress(`Phase 1/2 — Impact Matrix (${d}/${t})`);
        });
        setImpactMatrix(im);
        setComputingProgress("Phase 2/2 — Delete candidates…");
        // Run on next tick so the UI can paint between phases.
        setTimeout(() => {
          try {
            const dc = precomputeDeleteCandidates(idx);
            setDeleteCandidates(dc);
            setComputingProgress("");
            setComputing(false);
            setBanner({ tone: "green", text: `All computations complete — ${im.length.toLocaleString()} impact rows, ${dc.size.toLocaleString()} PermSets analyzed.` });
          } catch (err) {
            setComputing(false);
            setComputingProgress("");
            setBanner({ tone: "red", text: `Computation failed in phase 2: ${err.message}` });
          }
        }, 30);
      } catch (err) {
        setComputing(false);
        setComputingProgress("");
        setBanner({ tone: "red", text: `Computation failed in phase 1: ${err.message}` });
      }
    }, 30);
  }, [idx, computing]);

  // ---- Manifest recap data ----
  const manifest = useMemo(() => {
    const totalRows = FILES.reduce((n, f) => n + ((datasets && datasets[f.key]) ? datasets[f.key].length : 0), 0);
    const estMB = Math.max(1, Math.round(totalRows / 50000)); // rough: very heuristic
    return { totalRows, estMB };
  }, [datasets]);

  // ---- Tab list ----
  // v3.0: when no data is loaded, only Admin is reachable. The other tabs
  // depend on the index and would render empty / nonsensical content.
  const hasData = datasetsHaveData(datasets);
  const allTabs = [
    { key: "explorer", label: "Explorer" },
    { key: "impact", label: "Change Impact" },
    { key: "prescribe", label: "Prescribe Access" },
    { key: "redundancy", label: "Overlap & Redundancy" },
    { key: "migration", label: "Migration" },
    { key: "admin", label: "Admin" },
  ];
  const tabs = hasData ? allTabs : allTabs.filter(t => t.key === "admin");

  // Force-pin to admin if data is gone (or never loaded).
  useEffect(() => {
    if (!hasData && tab !== "admin") setTab("admin");
  }, [hasData, tab]);

  // Auto-dismiss banner
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 5000);
    return () => clearTimeout(t);
  }, [banner]);

  // Combined warnings for the Admin tab
  const allWarnings = useMemo(() => {
    const w = [];
    if (idx) w.push(...idx.warnings);
    w.push(...customWarnings);
    for (const [k, e] of Object.entries(uploadErrors)) w.push({ level: "yellow", file: FILE_BY_KEY[k] && FILE_BY_KEY[k].filename, text: `Upload error: ${e}` });
    return w;
  }, [idx, customWarnings, uploadErrors]);

  return (
    <AppStateProvider>
      <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
      <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: T.font }}>
        {/* Header */}
        <div style={{ borderBottom: `1px solid ${T.border}`, background: T.bgAlt, padding: "10px 20px", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: `linear-gradient(135deg, ${T.accent}, ${T.purple})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 12 }}>P</div>
            <div style={{ fontWeight: 700 }}>Permission Explorer</div>
            <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>v3.0 · Salesforce</div>
          </div>
          <Tabs tabs={tabs} active={tab} onChange={setTab} />
          <div style={{ flex: 1 }} />
          {/* Data-source badge (7.2) */}
          {source === "cache" && <Pill tone="purple">From cache{cachedAt ? ` · ${Math.max(1, Math.round(ageInDays(cachedAt)))}d old` : ""}</Pill>}
          {source === "none" && <Pill tone="yellow">No dataset — upload CSVs in Admin tab</Pill>}
          {source === "upload" && <Pill tone="green">Dataset loaded — CSV upload · {ago(sourceTs)}</Pill>}
          {source === "bundle" && <Pill tone="accent">Dataset loaded — bundle · {ago(sourceTs)}</Pill>}
          {!source && <Pill tone="mute">No dataset</Pill>}
        </div>

        {/* Transient banner */}
        {banner && (
          <div style={{ padding: "10px 20px", borderBottom: `1px solid ${T.border}`, background: banner.tone === "red" ? T.redBg : banner.tone === "green" ? T.greenBg : banner.tone === "yellow" ? T.yellowBg : T.accentBg, color: banner.tone === "red" ? T.red : banner.tone === "green" ? T.green : banner.tone === "yellow" ? T.yellow : T.accent, fontSize: 12 }}>
            {banner.text}
          </div>
        )}

        {/* Non-blocking banner if no dataset (7.2) */}
        {!hasData && !bootLoading && (
          <div style={{ padding: "10px 20px", borderBottom: `1px solid ${T.border}`, background: T.yellowBg, color: T.yellow, fontSize: 12 }}>
            No dataset loaded — upload the 13 CSV files below, or import a <code style={{ fontFamily: T.mono }}>.pebundle</code> from your Cowork folder.
          </div>
        )}

        {/* Content */}
        {bootLoading || !idx ? (
          <div style={{ padding: 80, textAlign: "center", color: T.textMuted }}>
            <span className="pe-spinner" />
            <div style={{ marginTop: 10 }}>Preparing Permission Explorer…</div>
          </div>
        ) : (
          <>
            {tab === "explorer" && <ExplorerTab idx={idx} selection={selection} setSelection={setSelection} />}
            {tab === "impact" && <ChangeImpactTab idx={idx} nav={s => { setSelection(s); setTab("explorer"); }}
              impactMatrix={impactMatrix} setImpactMatrix={setImpactMatrix}
              deleteCandidates={deleteCandidates} setDeleteCandidates={setDeleteCandidates} />}
            {tab === "prescribe" && <PrescribeAccessTab idx={idx} nav={s => { setSelection(s); setTab("explorer"); }} />}
            {tab === "redundancy" && <RedundancyTab idx={idx} dismissals={dismissals} setDismissals={setDismissals}
              nav={s => { setSelection(s); setTab("explorer"); }} />}
            {tab === "migration" && <MigrationTab idx={idx} nav={s => { setSelection(s); setTab("explorer"); }} />}
            {tab === "admin" && <AdminTab datasets={datasets} source={source} sourceTs={sourceTs} cachedAt={cachedAt}
              warnings={allWarnings} xrefWarnings={idx ? idx.xrefWarnings : []}
              uploadedAt={uploadedAt}
              onUpload={onUpload} onReset={onReset} onClearCache={onClearCache}
              onExportBundle={onExportBundle} onImportBundle={onImportBundle}
              manifest={manifest} idx={idx}
              nav={s => { setSelection(s); setTab("explorer"); }}
              onLoadAllComputations={onLoadAllComputations} computing={computing} computingProgress={computingProgress} />}
          </>
        )}
      </div>
    </AppStateProvider>
  );
}
