# Salesforce Permission Explorer — Requirements (v3.0)

**Version:** 2026-04-v3.0
**Status:** Implemented
**Predecessor:** `requirements_v2_8.md` (which carries forward the full functional spec; this document covers only deltas).

---

## 1. Summary

v3.0 is a breaking release. It removes the repo-hosted demo snapshot fetch that was introduced in v2.9, and replaces it with a strictly local data flow: CSV upload (or `.pebundle` import) feeds the artifact, and the parsed dataset is cached in IndexedDB so subsequent sessions boot instantly without re-uploading. A companion Cowork scheduled task generates a fresh `.pebundle` weekly from the user's Salesforce org and drops it in the user's Cowork folder for manual import.

The motivation is twofold. First, the v2.9 snapshot pipeline shipped scrubbed/pseudonymized data that was not useful for real analysis (only for demos), and the bake pipeline added meaningful operational complexity (offline scrubber, safety greps, manual snapshot refresh). Second, organizations using the artifact for actual permission audits need real data, but real data must never be committed to a public-readable artifact path. The v3.0 design resolves both: the artifact never sees Salesforce credentials and never makes outbound calls; real data stays in the user's browser via IndexedDB and on the user's local disk via the weekly bundle.

---

## 2. In-Flight Corrections (v3.0 Additions)

### 2.1 ARCH-1 — Strictly CSV-Only Runtime

**Reason for change:** v2.9 fetched `data/snapshot.json` from `raw.githubusercontent.com` on every boot. This made the artifact dependent on a public-readable URL, conflated "demo snapshot" with "real data" in the user's mind, and created an attractive nuisance for shipping un-scrubbed data via the same channel.

**Changes:**

- Remove `GITHUB_SNAPSHOT_OWNER`, `GITHUB_SNAPSHOT_REPO`, `GITHUB_SNAPSHOT_BRANCH`, `GITHUB_SNAPSHOT_PATH`, and `GITHUB_SNAPSHOT_URL` constants.
- Remove the `fetchGithubSnapshot()` function.
- Remove the boot `useEffect` that called it.
- Remove the `snapshotMeta` React state and every reference to `source === "github"`.
- Delete `data/snapshot.json`, `scripts/bake-snapshot.js`, `scripts/build-fallback.js`, `docs/BAKE.md`, and the entire `mcp-seed/` tree from the repo.

**Acceptance criteria:**

- A network panel inspection of the app at boot shows zero outbound requests to any Salesforce, GitHub, or third-party data endpoint. (Babel + React CDN fetches at index.html load are out of scope and remain.)
- Grepping the JSX for `GITHUB`, `snapshot.json`, `fetchGithubSnapshot`, or `bake-snapshot` returns zero hits except in the historical changelog comment block.

### 2.2 ARCH-2 — IndexedDB Pebundle Cache ("save state")

**Reason for change:** Without the GitHub fallback, every browser refresh would otherwise force the user to re-upload 13 CSVs. That is unacceptable for routine use.

**Changes:**

- Add a single-store IndexedDB cache keyed `"current"`. Stored value: `{ cachedAt: ISO_string, schemaVersion: 1, pebundle: Blob }` where `pebundle` is the gzipped JSON of the same payload shape produced by `onExportBundle`.
- Add helpers `idbOpen()`, `idbReadCache()`, `idbWriteCache({datasets, dismissals})`, `idbClearCache()`. All resolve to safe defaults on failure (null/false) and never throw to the caller.
- Boot flow: on mount, call `idbReadCache()`. On hit with non-empty datasets, hydrate `datasets` + `dismissals`, set `source = "cache"`, surface a `From cache · Nd old` pill in the header, and pop the user into the Explorer tab. On miss, set `datasets = EMPTY_DATASETS`, `source = "none"`, force the active tab to Admin, and show the empty-state banner.
- Cache writes: `onUpload` debounces 1.5 s after the last upload event in a batch and writes once; `onImportBundle` writes immediately; `onReset` calls `idbClearCache()`; a new `onClearCache` handler clears the cache only without touching in-memory state.
- A new "Clear Cache" button in the Admin top control bar exposes `onClearCache`.

**Acceptance criteria:**

- Upload a single CSV, refresh the page, confirm the dataset re-hydrates from cache without re-upload.
- Import a `.pebundle`, refresh the page, confirm the same.
- Click Clear Cache; the in-memory dataset stays loaded but next refresh boots to an empty Admin state.
- Click Reset; both the in-memory dataset and the cache are wiped; next refresh boots to an empty Admin state.
- Open the app in a private/incognito window where IDB is unavailable: the app boots without crashing and shows the empty-state banner.

### 2.3 UX-55 — 14-Day Stale-Cache Banner

**Reason for change:** Permission data drifts. A cache from 30 days ago will produce wrong analyses with full UI confidence. We need to surface staleness without forcing a refresh.

**Changes:**

- New constant `CACHE_STALE_DAYS = 14`.
- New helper `ageInDays(isoTs)` returning days-since-timestamp (Infinity if unparseable).
- On boot from a stale cache (`ageInDays(cachedAt) > CACHE_STALE_DAYS`), surface a yellow banner: *"Cached dataset is N days old (older than 14-day staleness threshold). Re-upload CSVs or import a fresh weekly .pebundle from your Cowork folder to refresh."*

**Acceptance criteria:**

- Manually set a cache `cachedAt` to 20 days ago via DevTools, refresh: the banner appears.
- Re-import a fresh `.pebundle`: banner disappears immediately.
- A 13-day-old cache shows no banner (boundary check).

### 2.4 UX-56 — Tab Gating When No Data Is Loaded

**Reason for change:** Empty Explorer / Impact / Prescribe / Redundancy / Migration tabs render confusing zero-state UI. There is no work to be done in those views without data; the user should be steered to Admin.

**Changes:**

- Add helper `datasetsHaveData(d)` that returns true iff any dataset slot has at least one row.
- Compute `hasData = datasetsHaveData(datasets)` at render time.
- The tabs array is filtered to `[Admin]` when `!hasData`; the full six-tab list returns when data is loaded.
- A `useEffect` force-pins `tab = "admin"` whenever `!hasData` and the current tab is something else (defends against an in-flight Reset while sitting on Explorer).

**Acceptance criteria:**

- First load, no cache: only Admin is visible in the tab strip.
- Upload a single CSV: still admin-only (because `datasetsHaveData` requires real rows; a 0-row file does not unlock).
- Upload at least one CSV with rows: full tab set appears immediately.
- Click Reset from any tab: focus snaps back to Admin and the other tabs disappear.

### 2.5 OPS-1 — Weekly Cowork Scheduled Task

**Reason for change:** The user wants a save-state of fresh Salesforce data without putting Salesforce credentials in the browser. The scheduled task lives in Cowork (server-side, with the user's authed Salesforce MCP) and produces a static `.pebundle` for the user to manually import into the artifact.

**Changes:**

- Create scheduled task `weekly-permission-explorer-bundle` with cron `0 6 * * 1` (Mondays 6 AM local; Cowork adds a small deterministic jitter at dispatch).
- Task runs the 13 SOQL queries from §5.1 of `requirements_v2_8.md` against the user's authed production org via `mcp__salesforce__run_soql_query`.
- Task writes 13 raw CSV files plus a single gzipped `.pebundle` matching the JSX importer's expected shape (`format: "pebundle", version: 1, …`) to `/Users/manoj.aggarwal/Documents/Cowork/PermissionExplorer/bundles/`.
- Before writing new outputs, the task deletes any prior `*.csv` and `*.pebundle` files in the bundles directory. Other files are left alone.
- Org guardrail: if `mcp__salesforce__get_username` cannot positively identify the org as production, the task aborts and writes `LAST_RUN_ERROR.txt` without deleting prior outputs.

**Acceptance criteria:**

- Run "Run now" once from the Cowork Scheduled panel; verify 13 CSVs + 1 `.pebundle` appear in the bundles folder, with row counts matching the SOQL responses.
- Open the artifact, click Import Bundle, select the new `.pebundle`; verify all 13 datasets load with the correct row counts.
- Confirm `LAST_RUN_ERROR.txt` is created (and prior bundle is not deleted) if the org check fails.
- Confirm the bundle filename embeds the run date (`permission-explorer_YYYYMMDD-HHMM.pebundle`).

### 2.6 OPS-2 — `.gitignore` Hygiene

**Changes:**

- Drop the now-obsolete `mcp-seed/raw/` and `mcp-seed/scrubbed/` rules.
- Add `bundles/` and `*.pebundle` so the weekly outputs (which contain real PII) can never be accidentally committed.

**Acceptance criteria:**

- After running the weekly task, `git status` shows zero entries from the bundles folder.

### 2.7 DOC-1 — README, Changelog, Index Bootstrap Comments

**Changes:**

- Rewrite `README.md` to describe the CSV-only + IDB-cache + weekly-pebundle flow. Drop all snapshot/bake content.
- Update the JSX header changelog to v3.0 with a clear "Removed" section.
- Update the `index.html` bootstrap comment to v3.0 and note that `snapshot.json` no longer exists.
- Bump `package.json` to `3.0.0` and remove the `bake` / `verify` scripts.
- Add `requirements_v3_0.md` (this document).

**Acceptance criteria:**

- `grep -r "v2.9\|2.9.0" .` returns only historical changelog references in code comments.
- README's stated runtime data flow matches the JSX boot logic exactly.

---

## 3. Removed Functionality

The following v2.9 features are removed in v3.0 and will not be restored:

- Boot-time fetch of `data/snapshot.json` from GitHub raw.
- The "Snapshot from GitHub" data-source badge.
- The bake-snapshot pipeline (`scripts/bake-snapshot.js`, `scripts/build-fallback.js`, the deterministic SHA-256 pseudonymizer, the safety grep, the embedded blocklist of real employee names).
- The `mcp-seed/raw/` directory of un-scrubbed source SOQL exports.
- `docs/BAKE.md` — the offline snapshot refresh playbook.

The "Reset" button no longer reloads a demo snapshot; it now clears both the in-memory dataset and the IDB cache and returns the app to its empty Admin-only state.

---

## 4. Forward Compatibility

The IDB cache record carries a `schemaVersion: 1` field. If a future v3.x release changes the cache shape, bumping `CACHE_SCHEMA_VERSION` causes `idbReadCache()` to return null on mismatched records, which forces the user back through CSV upload or bundle import — a graceful degradation rather than a crash.

The pebundle `version: 1` field continues to be honored by the importer with a "newer than this app" warning, matching v2.x behavior.

---

## 5. Version History

| Version | Date | Notes |
|---|---|---|
| 2026-04-v3.0 | 2026-04-30 | Breaking: CSV-only runtime, IndexedDB cache, weekly Cowork pebundle task. Removed: GitHub snapshot fetch + bake pipeline. |
| 2026-04-v2.9 | 2026-04-24 | Repo-hosted snapshot.json replaced the embedded fallback; bake-time fixes for v2.8 demo dataset. (Superseded.) |
| 2026-04-v2.8 | 2026-04-22 | UX-53 dynamic width; UX-54 embedded MCP-seeded fallback; BUG-15 profile-direct booleans surfaced. |
| 2026-04-v2.7 | 2026-04-21 | UX-47 Prescribe Access; BUG-11/12/13/14 fixes. |
| 2026-04-v2.6 | 2026-04-17 | UX-20 Load All Computations; BUG-8 Profile detail rerender. |
| 2026-04-v2.5 | 2026-04-17 | Pebundle export/import, multiple BUG fixes. |
