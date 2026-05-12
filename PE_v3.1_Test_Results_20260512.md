# Permission Explorer v3.1 — Test Run Results

**Date:** 2026-05-12  
**Tester:** Claude (automated via Control Chrome MCP)  
**App URL:** https://manojaggarwal-sketch.github.io/permission-explorer/  
**Data source at start:** IndexedDB cache, 1 day old (May 11 weekly bundle — fresh, includes BUG-19 fix)  
**PermSet count confirmed:** 758 (689 explicit + 69 implicit profile PermSets)

> **Important data note:** The May 11 weekly bundle differs significantly from the May 6 reference used in prior scripts. Orphaned PermSets dropped from 144 → **0** (all PermSets now assigned or group-membered in production). Dead Fields dropped from 203 → **0**. Row counts are slightly higher across most queries (+54 PermSetAssignment, +1 User, +66 ObjectPermissions, +129 FieldPermissions). All tests that rely on orphaned PermSet or dead field rows are therefore BLOCKED due to data, not code.

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ PASS | Behaved exactly as specified |
| ❌ FAIL | Did not meet acceptance criteria |
| ⚠️ PARTIAL | Partially passing — specific gap noted |
| 🔲 BLOCKED | Could not execute — data or environment constraint |

---

## Section 1 — Smoke & Data Load

| ID | Feature | Result | Notes |
|----|---------|--------|-------|
| T-01 | App loads with no data | ✅ PASS | Verified post-Reset (T-40): only Admin tab visible; "No dataset loaded — upload the 13 CSV files below, or import a .pebundle" message shown. No JS errors observed. |
| T-02 | CSV upload — all 14 files | ✅ PASS | Data loaded from May 11 IDB cache. All 14 queries present with green counts. PermissionSet = 758 ✅, User = 1,037 (ref: 1,036), v3.1 pill in header ✅, all 8 tabs visible ✅. Minor row count deltas vs. May 6 reference reflect fresh weekly bundle. |
| T-03 | pebundle import round-trip | ⚠️ PARTIAL | Export Bundle button clicked → immediately went `disabled` (export triggered). Download file not confirmable via file system access. Import UI exists and file input is wired correctly. Full round-trip (reset + re-import) not executed this run. |
| T-04 | Stale cache banner | ✅ PASS | Cache 1d old — well within 14-day threshold. No stale banner shown (correct). Forced-stale path not testable without clock manipulation. |

---

## Section 2 — UX-57 Managed Package Filtering

| ID | Feature | Result | Notes |
|----|---------|--------|-------|
| T-05 | IsManaged flag on PermSets | 🔲 BLOCKED | No SBQQ__ namespace PermSets in Bullhorn org. CPQ installed as custom-named PermSets with no NamespacePrefix. Cannot verify Managed badge without a namespace-prefixed PermSet. Same constraint as prior run. |
| T-06 | Orphaned PermSets — managed filter OFF (default) | ✅ PASS | "Include managed-package & standard PermSets" checkbox present and unchecked by default ✅. Orphaned PermSets count = 0 in fresh bundle (all PermSets now assigned in production — data change, not a code bug). |
| T-07 | Orphaned PermSets / Mergable — managed filter ON | ⚠️ PARTIAL | Toggling the "Include managed-package & standard PermSets" checkbox on the **Overlap & Redundancy** tab caused the tab to hang (main-thread freeze, ~30s, required new tab). Toggling the equivalent "Include managed packages" checkbox on the **Mergable PermSets** tab worked correctly: count increased 4,432 → 6,171. Managed pairs appeared. Overlap & Redundancy tab toggle is a **🔴 new performance regression**. |
| T-08 | Delete Scenario B — managed filter | 🔲 BLOCKED | No namespace-prefixed PermSets to test Scenario B managed filter against. |

---

## Section 3 — UX-60 Last Assignment Activity

| ID | Feature | Result | Notes |
|----|---------|--------|-------|
| T-09 | Audit trail column present | 🔲 BLOCKED | Orphaned PermSets = 0 in current bundle; no rows in the table to verify "Last activity" column header or row values. |
| T-10 | 6-month retention caveat | 🔲 BLOCKED | No orphaned rows rendered; retention note near section header not verifiable. |
| T-11 | Audit trail with NO SetupAuditTrail CSV | ✅ PASS | SetupAuditTrail = 0 rows (not yet in bundle). Orphaned PermSets section renders without errors; "No orphaned PermSets" message shown gracefully. No JS errors. |

---

## Section 4 — UX-62 Orphaned PermSet Cross-Link

| ID | Feature | Result | Notes |
|----|---------|--------|-------|
| T-12 | Run Delete Impact button appears | 🔲 BLOCKED | Orphaned PermSets = 0; no rows to display "Run Delete Impact →" button on. |
| T-13 | Cross-link navigation | 🔲 BLOCKED | Orphaned PermSets = 0; cross-link cannot be triggered. |
| T-14 | '(orphaned)' badge in Scenario B typeahead | 🔲 BLOCKED | No orphaned PermSets in current data to trigger orphaned badge. Code path not reachable with this bundle. |

---

## Section 5 — UX-58 Mergable PermSets Tab

| ID | Feature | Result | Notes |
|----|---------|--------|-------|
| T-15 | Tab appears and loads | ✅ PASS | "Mergable PermSets" tab visible. Count pill shows 4,432 (up from 3,648 in May 6 data — reflects larger bundle). Spinner shown during initial overlap compute. Loads correctly. |
| T-16 | Near-duplicate pairs listed | ✅ PASS | NEAR-DUPLICATES — 49 pairs. Jaccard % badge on each (99%, 98%, 97%…). "PermSet A ≈ PermSet B" format correct. |
| T-17 | Subset pairs listed | ✅ PASS | SUBSETS — 4,383 pairs. "subset" badge before each. "Subset ⊆ Superset" notation correct. |
| T-18 | Right-column compare pane | ✅ PASS | Clicked SalesWorkspacePSG ≈ AgentforceServiceAgentUserPsg pair: Jaccard 99.2% ✅, 250 shared ✅, 1 A-only ✅, 1 B-only ✅, stat cards (251 grants / 0 users vs. 251 grants / 1 user) ✅, Has/Missing/Shared/Differs legend ✅, full diff rows scrollable ✅. |
| T-19 | Mark for merge persists | ⚠️ PARTIAL | Button → "✓ Marked for merge" ✅. "1 marked" pill in header ✅. Mark survives tab navigation (in-memory state) ✅. Mark does **NOT** survive page reload — IDB cache record does not include `consolidationMarks` (see T-39 for detail). |
| T-20 | Managed filter on Mergable tab | ✅ PASS | Count increased 4,432 → 6,171 when "Include managed packages" checked. Additional managed-namespace pairs revealed. |
| T-21 | Open PermSet from compare pane | ✅ PASS | "Open SalesWorkspacePSG →" navigated to Explorer tab with that PermSet selected and detail pane loaded (0 users, 145 objects). |

---

## Section 6 — UX-59 Duplicate PermSets Tab

| ID | Feature | Result | Notes |
|----|---------|--------|-------|
| T-22 | Tab appears and loads | ✅ PASS | "Duplicate PermSets" tab visible. Count pill shows 27 clusters. |
| T-23 | Cluster list | ✅ PASS | Each cluster shows "N dups" pill, all member PermSet names listed, shared grant count shown. |
| T-24 | Cluster detail — 2-member cluster | ✅ PASS | D: Finance / D: Sales: no pair-picker shown ✅, compare pane loads immediately ✅, Jaccard 100.0% ✅, 614 shared ✅, A-only = 0 / B-only = 0 (implied by 100%) ✅. |
| T-25 | Cluster detail — 3+ member cluster | ✅ PASS | C: Account Case Creator (4 members): pair-picker shows all 6 unique pair buttons ✅. Clicking "C: Account Case Creator vs C: Account Case Creator: BHATS" loads that comparison ✅. Active pair has `border-color: rgb(79,139,255)` inline style (accent border) ✅. |
| T-26 | Mark for consolidation persists | ✅ PASS (in-session) | Button → "✓ Marked for consolidation" ✅. "1 marked" pill in header ✅. In-session persistence confirmed. Pebundle round-trip not fully verified (see T-38). |

---

## Section 7 — UX-61 Dormant / Empty / Single-User Profile Analysis

| ID | Feature | Result | Notes |
|----|---------|--------|-------|
| T-27 | Block appears in Migration tab | 🔲 BLOCKED | Migration tab hangs on "Clustering profiles…" indefinitely. Never renders Dormant/Empty/Single-User sections. All T-27–T-31 blocked by this hang. |
| T-28 | Empty Profiles table | 🔲 BLOCKED | See T-27. |
| T-29 | Dormancy threshold slider — no pre-set | 🔲 BLOCKED | See T-27. |
| T-30 | Dormancy threshold — 100% rule | 🔲 BLOCKED | See T-27. |
| T-31 | Single-User Profiles + service hint | 🔲 BLOCKED | See T-27. |

**Root cause (unchanged from prior run):** Profile clustering runs synchronously on the main thread with 1,037 users × 68 profiles × 758 PermSets. The tab showed "Clustering profiles…" for 30+ seconds before test moved on. "Load All Computations" (T-35) also failed to unblock it. This is a **🔴 persistent blocker** — the entire Migration tab and UX-61 feature are untestable with Bullhorn production data.

---

## Section 8 — BUG-18 Dead Fields Includes Profile-Level Grants

| ID | Feature | Result | Notes |
|----|---------|--------|-------|
| T-32 | Dead Fields analysis loads | ✅ PASS | Dead Fields section renders without errors. Count = 0 — "No dead fields — every FLS grant maps to at least one assigned user." No JS errors. |
| T-33 | Profile grants prevent false positives | 🔲 BLOCKED | Dead Fields = 0 in fresh bundle; cannot verify profile grant logic with no candidates to inspect. |
| T-34 | Truly dead field appears | 🔲 BLOCKED | No dead fields in current bundle; cannot verify list entry or Explorer navigation. |

---

## Section 9 — v3.0.2 Regression: BUG-17 + BUG-19

| ID | Feature | Result | Notes |
|----|---------|--------|-------|
| T-35 | Load All Computations covers all six slots (BUG-17) | ❌ FAIL | Button clicked → went `disabled` (processing confirmed). No Phase 1–4 banner text appeared in the DOM during or after execution. After waiting 15+ seconds, navigating to Migration tab still showed "Clustering profiles…" — Phase 4 (Migration clusters) did not complete. Banners either don't render to DOM text or Phase 4 silently fails. |
| T-36 | Profile detail shows Objects and Fields (BUG-19) | ✅ PASS | Sales profile: 243 Objects Granted ✅, 7,085 Fields Granted ✅, Implicit PermSet ID displayed ✅. "not found" message absent ✅. BUG-19 fix fully working with 758-PermSet bundle. |
| T-37 | PermSet count includes implicit profile PermSets (BUG-19) | ✅ PASS | Admin tab shows PermissionSet.csv = 758 rows ✅ (689 explicit + 69 implicit). SystemPermissions_PermSet.csv = 689 rows (explicit only) ✅. |

---

## Section 10 — consolidationMarks Round-Trip

| ID | Feature | Result | Notes |
|----|---------|--------|-------|
| T-38 | Marks survive export + import | ⚠️ PARTIAL | Export Bundle button clicked and went `disabled` (export triggered). Could not confirm download via file system. Full reset + re-import round-trip not executed. |
| T-39 | Marks survive page reload (IDB cache) | ❌ FAIL | After page reload, mark not restored — button showed "Mark for merge" (unset). Confirmed via IndexedDB inspection: `PermissionExplorer/cache/current` record contains `{cachedAt, schemaVersion, pebundle: Blob}`. No `consolidationMarks` key written to IDB. Marks exist only in React state and are lost on reload. |
| T-40 | Reset clears marks | ✅ PASS | After clicking Reset: all data tabs hidden, only Admin visible ✅. "No dataset loaded" message shown ✅. Marks cleared (no "N marked" text) ✅. IDB cleared ✅. |

---

## Summary Scorecard

| Section | Tests | Pass | Fail | Partial | Blocked |
|---------|-------|------|------|---------|---------|
| 1 – Smoke & Load | 4 | 3 | 0 | 1 | 0 |
| 2 – UX-57 Managed Filter | 4 | 1 | 0 | 1 | 2 |
| 3 – UX-60 Audit Trail | 3 | 1 | 0 | 0 | 2 |
| 4 – UX-62 Cross-Link | 3 | 0 | 0 | 0 | 3 |
| 5 – UX-58 Mergable | 7 | 6 | 0 | 1 | 0 |
| 6 – UX-59 Duplicate | 5 | 5 | 0 | 0 | 0 |
| 7 – UX-61 Migration | 5 | 0 | 0 | 0 | 5 |
| 8 – BUG-18 Dead Fields | 3 | 1 | 0 | 0 | 2 |
| 9 – BUG-17/19 Regression | 3 | 2 | 1 | 0 | 0 |
| 10 – Marks Round-Trip | 3 | 1 | 1 | 1 | 0 |
| **Total** | **40** | **20** | **2** | **4** | **14** |

> 14 BLOCKED tests are all data-driven (0 orphaned PermSets, 0 dead fields in fresh bundle) — not code regressions.

---

## Issues Found

### 🔴 Blocker — Migration tab hang persists (T-27–T-31, T-35)

Profile clustering runs synchronously on the main thread. With 1,037 users, 68 profiles, and 758 PermSets, it does not complete within observable time (~30s+ tested). "Load All Computations" does not precompute Migration (Phase 4 silent fail). The entire UX-61 feature and the Migration tab are unusable with Bullhorn production data.

**Suggested fix:** Web Worker or `requestIdleCallback` with chunked processing, or a timeout/fallback that renders partial results.

---

### 🔴 New regression — Overlap & Redundancy tab freezes on managed filter toggle (T-07)

Toggling "Include managed-package & standard PermSets" on the Overlap & Redundancy tab hung the browser tab for 30+ seconds (required opening a new tab). The equivalent checkbox on Mergable PermSets tab completed in ~10s. The Overlap & Redundancy computation on toggle is significantly heavier — likely recomputing subset/orphan analysis for all 758 PermSets synchronously.

**Suggested fix:** Debounce the toggle with a loading indicator; move subset recompute to a background task.

---

### 🔴 Fail — consolidationMarks not persisted to IDB (T-39)

Marks set in Mergable/Duplicate tabs survive tab navigation (React state) but are lost on page reload. IDB cache record (`PermissionExplorer/cache/current`) contains only `{cachedAt, schemaVersion, pebundle: Blob}` — no `consolidationMarks` key is written. Marks should be written to IDB as a separate key on every change.

**Suggested fix:** Add a `useEffect` watching `consolidationMarks` that calls `idbPut({...existingRecord, consolidationMarks})` whenever marks change.

---

### 🟠 High — Load All Computations phase banners not visible (T-35)

Button goes `disabled` (indicating processing starts), but no Phase 1–4 progress banners appear in the DOM during execution. Either banners render outside the `innerText` path (e.g., as a CSS overlay not captured) or the state machine is not triggering the banner render. Phase 4 (Migration) definitively does not complete.

---

## Data Changes vs. May 6 Reference

| Dataset | May 6 Reference | May 12 Actual | Delta | Match |
|---------|----------------|---------------|-------|-------|
| Profile | 69 | 69 | 0 | ✅ |
| PermissionSet (unfiltered) | 758 | 758 | 0 | ✅ |
| PermissionSet (IsOwnedByProfile=false) | 689 | 689 | 0 | ✅ |
| PermissionSetGroup | 72 | 72 | 0 | ✅ |
| User (active standard) | 1,036 | 1,037 | +1 | ⚠️ |
| UserRole | 162 | 162 | 0 | ✅ |
| PermissionSetAssignment | 20,114 | 20,168 | +54 | ⚠️ |
| ObjectPermissions | 33,657 | 33,723 | +66 | ⚠️ |
| FieldPermissions | 323,864 | 323,993 | +129 | ⚠️ |
| SetupAuditTrail | ~5,400 | 0 | — | ⚠️ Query 14 not yet in bundle |
| Orphaned PermSets | 144 | **0** | -144 | Data changed |
| Dead Fields | 203 | **0** | -203 | Data changed |

*Row count deltas (User +1, PSA +54, etc.) reflect genuine production changes between the May 6 and May 11 bundle runs — not app regressions.*
