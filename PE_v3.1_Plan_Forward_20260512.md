# Permission Explorer — Plan Forward
**Based on:** PE_v3.1_Test_Results_20260512.md  
**Date:** 2026-05-12  
**Overall test result:** 20 pass / 2 fail / 4 partial / 14 blocked (of 40 tests)

---

## TL;DR

Three blockers must be fixed before v3.1 can ship. Fourteen tests are blocked by data (0 orphaned PermSets, 0 dead fields in the May 11 bundle) — these are not code regressions and need a mitigation strategy to retest. Two features (UX-59 Duplicate PermSets, BUG-19) are fully confirmed and ready. The v3.0.2 commit gate has been cleared and can be pushed immediately.

---

## Step 1 — Commit and push v3.0.2 (gate cleared)

**Status: Ready to go. No further validation needed.**

The v3.0.2 validation gate was: confirm BUG-19 fix works against the fresh bundle. T-36 and T-37 both pass:
- Sales profile shows **243 Objects Granted** and **7,085 Fields Granted** ✅
- PermissionSet.csv = 758 rows (689 explicit + 69 implicit) ✅

Follow the standard push procedure (write commit message to file, no heredoc):

```
git add -A
git status   # expect: PermissionExplorer.jsx, requirements_v3_0.md, package.json, index.html, README.md
git commit -F .git-commit-msg-v3.0.2.txt
git tag -a v3.0.2 -m "v3.0.2 — BUG-17 precompute lift + BUG-19 Query 2 PermSet drift fix"
git push origin main && git push origin v3.0.2
```

---

## Step 2 — Fix the three blockers (pre-ship bugs)

These must be resolved before v3.1 is released. All are introduced or confirmed by this test run.

---

### BUG-20 — Migration tab hangs on profile clustering (🔴 Blocker)
**Tests affected:** T-27–T-31 (all of UX-61), T-35 (Phase 4 of Load All Computations)  
**Root cause:** Profile clustering runs synchronously on the main thread — 1,037 users × 68 profiles × 758 PermSets. Never completes within observed time (~30s+). Phase 4 of "Load All Computations" also silently fails.  
**Impact:** The entire Migration tab and the UX-61 Dormant/Empty/Single-User Profile feature are completely unusable with Bullhorn production data.

**Decision points before implementing:**
1. **Web Worker vs. `requestIdleCallback` with chunking?** Web Worker is the correct long-term fix (true off-thread) but adds build complexity in a single-file JSX artifact. `requestIdleCallback` with chunked batches avoids that complexity but may still feel slow on very large orgs.
2. **Partial results vs. spinner until complete?** Should the tab show clusters as they finish (streaming UI), or show a spinner and render all at once?
3. **Timeout fallback?** If clustering takes more than N seconds, should it degrade gracefully (show what it has, note "clustering timed out — showing partial results")?

**Suggested approach (pending your call):** `requestIdleCallback` chunked batching with streaming render. Keeps everything in one file. Each chunk processes one profile's similarity comparisons and yields before the next. Estimated ~100–150 lines of change.

---

### BUG-21 — Overlap & Redundancy tab freezes on managed filter toggle (🔴 New regression)
**Tests affected:** T-07  
**Root cause:** Toggling "Include managed-package & standard PermSets" on the Overlap & Redundancy tab triggers a synchronous recompute of subset/orphan analysis for all 758 PermSets. Browser tab hung for 30+ seconds; required opening a new tab. The equivalent toggle on the Mergable PermSets tab completed in ~10s (acceptable).  
**Note:** This is a regression introduced in the v3.1 UX-57 managed filter work. The Mergable tab's toggle was optimized; the Redundancy tab's was not.

**Decision points before implementing:**
1. **Debounce + loading indicator, or move to background task?** A 300ms debounce with a spinner overlay is the lowest-risk fix. A background task (Web Worker or chunked idle) is more robust but overlaps with BUG-20 work.
2. **Batch BUG-20 and BUG-21 into one "async computation" pass?** Both root causes are the same pattern (synchronous heavy loop on the main thread). Solving the pattern once and applying it to both tabs avoids doing this twice.

**Suggested approach:** Fix both BUG-20 and BUG-21 in a single pass using the same chunking pattern. Estimated ~200 lines total across both tabs.

---

### BUG-22 — consolidationMarks not persisted to IndexedDB (🔴 Fail)
**Tests affected:** T-39  
**Root cause:** The IDB cache record at `PermissionExplorer/cache/current` stores only `{cachedAt, schemaVersion, pebundle: Blob}`. The `consolidationMarks` state (set when the user marks a PermSet for merge or consolidation) is only in React state and is lost on page reload.  
**Impact:** Users lose all marked-for-merge/consolidation selections every time the page is refreshed.

**Decision points before implementing:**
1. **Store marks in the same IDB record (merged into the cache blob) or as a separate IDB key?** Separate key (`PermissionExplorer/marks/current`) is cleaner — marks survive a bundle re-import without needing a merge strategy. Same record is simpler but means a fresh import wipes marks.
2. **Scope of marks — just Mergable/Duplicate tabs, or include future Delete candidates too?** If Delete candidates will also be mark-able, establish a shared `consolidationMarks` shape now.
3. **Schema versioning?** If the marks shape changes in a later version, the app should handle reading a stale marks record gracefully.

**Suggested approach:** Separate IDB key for marks. `useEffect` watching `consolidationMarks` writes on every change. Read marks on startup after loading the bundle. Estimated ~40–60 lines.

---

### High — Load All Computations phase banners not visible (🟠)
**Tests affected:** T-35 (partial — button disables correctly, banners don't appear)  
**Root cause unknown:** Phase 1–4 progress banners don't render as observable DOM text during computation. Either the banner state renders outside the text-capture path or the state machine isn't triggering the banner render. Phase 4 definitively fails (Migration clustering).  
**Note:** Once BUG-20 is fixed, Phase 4 should start completing. This issue may partially resolve on its own. However, the banners should be visible during long Phase 1–3 runs too.

**Decision points:** No major decision points — investigate banner render path, confirm it updates React state in a way that commits to the DOM during the async computation (not just on completion). If using `useState` inside a synchronous loop, the renders will be batched and only the final state will paint. Needs `flushSync` or a structured yield between phases.

---

## Step 3 — Address the data-blocked tests (14 tests)

All 14 blocked tests hit dead ends because the May 11 bundle has 0 orphaned PermSets and 0 dead fields — a genuine production data change, not a code regression. The features are implemented (UX-60, UX-62, BUG-18) but untestable with current data.

**Options (pick one or more):**

**Option A — Synthetic test bundle (recommended)**  
Create a `test-fixtures/` directory with a minimal hand-crafted `.pebundle` that has:
- 3–5 synthetic orphaned PermSets (assigned to no users, not in any group)
- 2–3 synthetic dead fields (FLS grant on a PermSet assigned to 0 users, not in any profile)
- A few SetupAuditTrail rows in the correct format

Use this for CI-style tests only; it never ships to the deployed app. Lets all 14 blocked tests run on every future test cycle regardless of production data state.

**Option B — Wait for production data to drift**  
Orphaned PermSets dropped from 144 → 0 between May 6 and May 11, meaning someone cleaned them up. They may reappear as Bullhorn's Salesforce org evolves. This is passive and unreliable.

**Option C — Use a prior bundle for retesting**  
The May 6 bundle (`permission-explorer_20260506-0829.pebundle`) is in the bundles directory and has 144 orphaned PermSets and 203 dead fields. The app can be reset and re-imported with this bundle to unblock those test paths. Note: this tests against stale production data, not the current state.

**Decision point:** Should we build the synthetic bundle (Option A) as part of v3.1 prep, or use the May 6 bundle (Option C) as a quick unblock for this cycle?

---

## Step 4 — Retest plan (after blockers fixed)

Once BUG-20, BUG-21, BUG-22 are fixed and a test bundle strategy is in place:

| Priority | Tests to rerun | Dependency |
|----------|---------------|------------|
| 1 | T-27–T-31, T-35 (Migration tab, Load All) | BUG-20 fix |
| 2 | T-07 (Redundancy toggle) | BUG-21 fix |
| 3 | T-39 (marks IDB persistence) | BUG-22 fix |
| 4 | T-09, T-10, T-12–T-14 (orphaned PermSet tests) | Test bundle strategy |
| 5 | T-32–T-34 (dead fields) | Test bundle strategy |
| 6 | T-05, T-08 (managed namespace PermSets) | Org-level constraint — may remain blocked |
| 7 | T-03, T-38 (pebundle round-trip) | Manual full-cycle verification |

---

## Feature readiness summary

| Feature | Status | Blocking issue |
|---------|--------|---------------|
| **UX-59 Duplicate PermSets** | ✅ Ship-ready | None — 5/5 pass |
| **BUG-19 Profile detail grants** | ✅ Ship-ready | None — fully verified |
| **UX-58 Mergable PermSets** | ⚠️ Near-ready | BUG-22 (marks lost on reload) |
| **UX-57 Managed Package Filter** | ⚠️ Near-ready | BUG-21 (Redundancy tab freeze) |
| **UX-60 Last Assignment Activity** | 🔲 Untested | Data gap (0 orphans) |
| **UX-62 Orphaned PermSet Cross-Link** | 🔲 Untested | Data gap (0 orphans) |
| **BUG-18 Dead Fields Profile Grants** | 🔲 Untested | Data gap (0 dead fields) |
| **UX-61 Dormant/Empty/Single-User Profiles** | 🔴 Blocked | BUG-20 (Migration hang) |

---

## Proposed versioning

| Version | Content | Gate |
|---------|---------|------|
| **v3.0.2** | BUG-17 + BUG-19 (already implemented) | ✅ Cleared — push now |
| **v3.0.3** | BUG-20 + BUG-21 + BUG-22 + banner fix | All four fixes pass retest |
| **v3.1** | All v3.1 features once blockers resolved and data-gap tests pass | Full retest scorecard clean |

Splitting the bug fixes into v3.0.3 (rather than waiting for all v3.1 features) means the Migration tab and marks persistence are usable sooner, without holding them behind the larger feature work.

---

## Open questions for Manoj

1. **BUG-20 async approach:** `requestIdleCallback` chunking (single-file friendly) or accept the complexity of a Web Worker?
2. **BUG-20 + BUG-21 combined pass?** Fix the synchronous-computation pattern in one shot across both tabs?
3. **BUG-22 marks storage:** Separate IDB key (cleaner) or merged into the cache record (simpler)?
4. **Data gap strategy:** Build a synthetic test bundle (Option A), use May 6 bundle (Option C), or both?
5. **Versioning:** Confirm v3.0.3 for bug fixes separate from v3.1 feature release, or bundle everything into v3.1?
