---
title: "Salesforce Permission Explorer — Engineering Work Ticket"
---

# ENGINEERING WORK TICKET · CONFIDENTIAL

## Salesforce Permission Explorer

Claude-Powered Multi-Dimensional Permission Analysis Tool

| Field | Value |
|---|---|
| Version | 2026-04-v3.0 |
| Status | Implemented — CSV-only runtime with IndexedDB pebundle cache and weekly Cowork scheduled task |
| Ticket Type | Major Release — Breaking Architectural Change |
| Priority | High |
| Platform | Claude.ai Artifact (React JSX) served from GitHub Pages; Cowork scheduled task for offline data refresh |
| Data Source | CSV upload or `.pebundle` import; IndexedDB cache for cross-session persistence; weekly Cowork-scheduled Salesforce → pebundle build |
| Auth Method | None at runtime — the artifact never calls Salesforce. Salesforce auth is exercised only inside the offline Cowork scheduled task |
| Date | April–May 2026 |

---

## 1. Overview & Objectives

Build a Claude-powered interactive permission explorer for Salesforce that allows administrators and security teams to interrogate permission data from multiple dimensions. The tool surfaces insights across users, profiles, permission sets, permission set groups, objects, and fields — supporting use cases ranging from day-to-day access audits to full-scale profile-to-permission-set-group migration planning.

The tool is strictly CSV-driven at runtime. Admins populate data either by uploading the 13 CSVs the app expects (one per Required Export Query in §5.1), or by importing a `.pebundle` (gzipped JSON) generated offline by the weekly Cowork scheduled task that runs the SOQL queries against the user's Salesforce org. After either path, the parsed dataset is cached in IndexedDB so subsequent browser sessions hydrate instantly without re-uploading. The artifact never calls Salesforce or any other network endpoint at runtime; Salesforce credentials never touch the browser.

### Primary Goals

- Multi-directional permission exploration: start from a user, object, field, profile, or permission set and navigate outward
- Change impact analysis: understand consequences before modifying permissions
- Redundancy and overlap detection: identify consolidation opportunities
- Profile-to-PermSet Group migration planning: quantify coverage gaps and migration readiness
- Role hierarchy context: surface permission inconsistencies across organizational roles
- Reporting and export: generate auditable outputs for compliance and stakeholder review

### v3.0 Architectural Goals (added in this release)

- **Eliminate runtime Salesforce dependency.** No GitHub-hosted demo snapshot, no live Salesforce calls, no Connected App. Data enters the browser exclusively via CSV upload or `.pebundle` import.
- **Cross-session persistence.** The parsed dataset is silently cached in IndexedDB after upload/import; subsequent sessions boot from cache in well under a second.
- **Stale-data protection.** Cache entries older than 14 days surface a non-blocking yellow banner prompting a refresh.
- **Tab gating.** When no data is loaded, only the Admin tab is reachable; the other five tabs hide until at least one dataset has rows.
- **Offline data pipeline.** A weekly Cowork scheduled task runs the 13 SOQL queries against the user's authed Salesforce production org, packages results as both 13 CSV files and a single `.pebundle`, and drops them into the user's Cowork project folder for manual import. Salesforce credentials and PII stay on the user's machine.

---

## 2. In-Flight Corrections (v2.0+ Additions)

> DEVELOPER NOTE: These items were raised after the initial build was delivered. They must be addressed before further feature work continues. All three are blocking.

### 2.1 Bug Fix — React Component Export Pattern (runtime error on load)

When the artifact is loaded in Claude.ai, a JavaScript runtime error is thrown immediately that prevents the app from rendering. The user sees a blank or broken state instead of the Permission Explorer UI.

**Root Cause**

The Claude.ai artifact runner expects React JSX artifacts to expose the root component through a specific export pattern. The delivered code does not match that pattern — the component is either not exported, exported under the wrong name, or the file is structured as a plain script rather than a module with a default export.

**Fix Required**

- Ensure the root Permission Explorer component is the default export of the artifact file:
  `export default function PermissionExplorer() { … }`
- Do not use `ReactDOM.render()` or any manual mount call — the artifact runner handles mounting.
- The file must be valid JSX (not TSX) and must not reference any undefined globals.
- Verify in Claude.ai DevTools that the module loads, the default export is a function, and no ReferenceError appears in the console.
- Do not restructure any component logic, state, or data handling while making this fix.

**Acceptance Criteria**

- Artifact loads in Claude.ai with no JavaScript console errors.
- The full Permission Explorer UI renders on first load.
- All existing functionality works identically to the pre-error intended behavior.

### 2.2 UX Change — Remove Startup Splash Screen, Open Directly in App

The current artifact shows a welcome/startup splash screen on first load. The product owner has confirmed this screen is unnecessary and wants it removed. Users should land directly in the application.

**Current (Unwanted) Behavior**

On load the artifact displays a startup screen containing a shield icon, "Permission Explorer" title and "Salesforce permission analysis · v1.9" subtitle, an info box explaining how to export CSVs via SOQL queries, a blue "Go to Admin Tab" CTA button, and a small disclaimer about shared data. See Appendix A.

**Required Behavior**

- Remove the splash / welcome screen entirely. It must not appear at any point.
- On load, after the async data fetch completes, open directly in the main explorer UI.
- The brief loading indicator shown during the async data fetch is acceptable and should be kept — only the post-load welcome screen is being removed.
- The default landing view after load should be the primary explorer tab.

**Acceptance Criteria**

- No splash, welcome, intro, or "get started" screen appears at any point.
- After the data fetch completes, the full app UI is rendered immediately.
- The async loading indicator (spinner / pulse) during data fetch is preserved.
- All navigation tabs remain functional.
- The Admin tab (with CSV upload and SOQL queries) remains accessible from the nav, just not as the forced first screen.

### 2.3 Bug Fix — Copy Button Non-Functional in Admin Tab

The Copy buttons on SOQL query blocks in the Admin tab do not work. Clicking a Copy button has no effect — nothing is written to the clipboard and the button does not change to Copied!.

**Root Cause**

Claude.ai runs artifacts inside a sandboxed iframe. The Clipboard API (`navigator.clipboard.writeText()`) requires the `clipboard-write` permission which is not granted to sandboxed iframes by default. If the Permission Explorer is using `navigator.clipboard.writeText()` for its copy buttons, it will silently fail in this environment.

The Salesforce Advanced Approvals Map resolves this with a `document.execCommand('copy')` fallback — it creates a temporary off-screen textarea, sets its value to the text to copy, selects it, calls `document.execCommand('copy')`, then removes the element. This approach works inside the iframe sandbox without requiring clipboard permissions.

**Reference implementation (copyText):**

```js
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
```

**Fix Required**

- Replace any `navigator.clipboard.writeText()` calls used for the Admin tab copy buttons with the `document.execCommand` fallback pattern above.
- Each copy button must track its own copied state using a React state variable (e.g. copied key string or null), so multiple buttons on the page can show Copied! independently without affecting each other.
- The copied state must revert to the default label after 2 seconds.
- The fix must apply to every copy button in the Admin tab (all Required Export Query blocks).
- Do not use `navigator.clipboard` anywhere in the copy flow — use only the execCommand textarea pattern.

**Acceptance Criteria**

- Clicking any Copy button in the Admin tab writes the full query text to the user clipboard.
- The button label changes from Copy to Copied! immediately on click.
- The label reverts to Copy after 2 seconds.
- Multiple copy buttons on the page operate independently.
- The fix works in Chrome, Edge, and Firefox on both Mac and Windows.
- No `navigator.clipboard` calls remain in the copy button implementation.

### 2.4 Bug Fix — BUG-5 — Profile Detail View Shows No Objects / Fields / System Perms

Selecting a Profile in the explorer renders a detail page that is empty of permission content. ObjectPermissions, FieldPermissions, and SystemPermissions_PermSet rows keyed to `ParentId = Profile.Id` are present in the loaded datasets but not surfaced in the UI.

**Fix Required**

- When a Profile is selected, fan out from `Profile.Id` into `objPermsByParent`, `fieldPermsByParent`, `sysPermsByParent`, `tabsByParent`, and `setupByParent` just like a PermSet would.
- Render a tabbed sub-layout identical to the PermSet detail view: Objects, Fields, System Perms, Tab Settings, Setup Entity Access.
- Show row counts as pill badges on each tab and a per-tab search box.

**Acceptance Criteria**

- Selecting a Profile shows non-empty Objects, Fields, and System Perms tabs when data exists in the CSVs for that profile.
- Counts on the tab headers match the underlying index Map sizes.
- Each sub-section has its own search box (see UX-5).

### 2.5 Bug Fix — BUG-6 — Modify Profile Change-Impact Scenario Renders Blank

The "Modify a Profile" scenario under Change Impact renders a blank page.

**Fix Required**

- If the feature is planned: implement the scenario per Section 6.2 (swap a user's profile for a different profile, diff effective permissions, list losses and gains).
- If the feature is not yet implemented: remove the scenario entry from the Change Impact nav until it is, rather than shipping a dead link.
- Either way, no nav entry in Change Impact may render a blank page.

**Acceptance Criteria**

- Either the scenario produces meaningful output for any valid before/after profile pair, or the scenario is not selectable.

### 2.6 Bug Fix — BUG-7 — Revoke Field from PermSet Selector Includes Groups

The PermSet selector in the Revoke Field from PermSet scenario currently lists PermSet Groups alongside PermSets. PermSet Groups are not a valid target for field revocation — fields belong to permsets (or profiles), not groups.

**Fix Required**

- Filter the selector's source list to rows from `PermissionSet.csv` only (exclude any `PermissionSetGroup.csv` rows).
- Double-check every Change Impact scenario's selectors for the same class of mistake and correct in one pass.

**Acceptance Criteria**

- The Revoke Field from PermSet selector returns zero PermSet Group results for any query.
- Typeahead matches are drawn exclusively from the `PermissionSet` dataset.

### 2.7 UX — UX-5 — Per-Sub-Section Search in Right/Detail Panel

Each sub-section rendered in the right/detail panel (Objects, Fields, System Perms, Tab Settings, Setup Entity Access, Assigned Users, Member PermSets, etc.) must have its own search box. Users should be able to type a substring and have the sub-section's rows filter live.

**Acceptance Criteria**

- Every detail sub-section exposes a search input.
- Typing filters that sub-section only, not the entire detail view.
- Empty search state shows all rows.

### 2.8 UX — UX-6 — Cascading Object → Field Filter

When the user filters the detail view by object (either via a filter control or by selecting an object row), the Fields sub-section must automatically filter to fields whose `SobjectType` matches the selected object. Clearing the object filter restores the full field list.

**Acceptance Criteria**

- Selecting an object filters the Fields sub-section within 1 frame.
- Clearing the object filter restores all fields.
- The cascade does not reset independent text search on either sub-section.

### 2.9 UX — UX-7 — PermSet Detail Shows Assigned Users

When a Permission Set is selected, the detail view must include an Assigned Users sub-section listing every active standard user with that PermSet assigned (via `PermissionSetAssignment`). Include a second sub-list or a badge for users who receive the PermSet transitively through a PermSet Group.

**Acceptance Criteria**

- Assigned Users sub-section lists all direct assignees with name, email, and profile.
- Group-derived assignees are shown with a "via <Group MasterLabel>" label.
- Sub-section has its own search box (UX-5).
- Count shown on the sub-section header matches actual row count.

### 2.10 UX — UX-8 — User Detail Shows Permission Provenance + Mute Indicators

When a User is selected, every permission shown in Objects / Fields / System Perms must be annotated with where it comes from: Profile (`<Profile Name>`), PermSet (`<PermSet Label>`), or PermSet Group member (`<Group Label> → <PermSet Label>`). Fields that are granted by a source but then removed by a Muting PermSet must be displayed with a "Muted by `<Muting PermSet Label>`" badge instead of silently disappearing.

**Acceptance Criteria**

- Each permission row displays at least one source attribution.
- Multiple concurrent sources are listed together (e.g., "Profile: Sales + PermSet: Sales Ops").
- Muted fields appear in a separate "Muted" list with the muting source named.

### 2.11 UX — UX-9 — PermSet Group Drill-Down Shows Member PermSets

When a PermSet Group is selected, the detail view must render a list of member PermSets inline (not only the aggregated permissions). Each member PermSet should be a clickable row that navigates into that PermSet's own detail view. Muting members are flagged visually.

**Acceptance Criteria**

- Group detail view shows one row per member from `PermissionSetGroupComponent`.
- Muting members (Type='Muting') have a distinct badge.
- Clicking a member navigates to its PermSet detail.

### 2.12 UX — UX-10 — Object List: Remove Blanks, Explain Remaining

Blank / empty-name rows appear at the top of the Object list, which is noisy. These most often come from `ObjectPermissions` rows whose `SobjectType` is empty (typically a data issue in the CSV export) or where the row has no CRUD flags set.

**Fix Required**

- Filter out rows with empty / null `SobjectType` from the Object list.
- Filter out rows where every CRUD flag is false (row grants nothing).
- On the Admin tab's manifest, surface the per-file count of rows dropped for either reason as a yellow warning so the admin knows something was excluded.

**Acceptance Criteria**

- No blank-named rows appear at the top of the Object list.
- Zero-permission rows are not shown in the default view (toggle to include them is acceptable).
- Admin tab reports how many rows were dropped.

### 2.13 UX — UX-11 — Field Detail Shows Source Provenance Chain

For any field, show where the Read / Edit grants come from, with full chain:
- Profile name (if the grant comes from `Parent.IsOwnedByProfile = true`)
- PermSet label (if the grant comes from a standalone PermSet)
- Group name + PermSet label (if the grant comes from a PermSet that's inside a Group)
- Whether the PermSet is profile-owned

**Acceptance Criteria**

- Each Read / Edit grant line shows the full provenance chain.
- Group-linked grants show both the Group label and the member PermSet label.
- Profile-owned PermSets are labeled as such.

### 2.14 UX — UX-12 — Roles Restricted to Internal Only

The Role entry point and role hierarchy view must include only internal roles. Portal roles (`PortalType IN ('Partner','CustomerPortal')`) are excluded both at query time and in-app defensively.

**SOQL change:** Query 5 (User Roles) must add `PortalType` to the SELECT and filter `WHERE PortalType = 'None'` at export time (corrected in v3.0 from the prior `= null` form). On Salesforce's UserRole object, internal roles store the literal picklist value `'None'` for `PortalType`, not SQL NULL — so `WHERE PortalType = null` returns zero rows in production orgs while `WHERE PortalType = 'None'` returns the correct internal-roles set. See the updated query in Section 5.1.

**Acceptance Criteria**

- The Roles list shows zero partner / customer portal roles.
- If an uploaded UserRole.csv contains portal rows anyway, the app filters them out and surfaces a yellow warning on the Admin tab.

### 2.15 UX — UX-13 — Change Impact: All Selectors Use Incremental (Typeahead) Search

Every selector on every Change Impact scenario must be an incremental / typeahead / combobox-style search, not a native `<select>` dropdown. Dropdowns with thousands of entries are unusable.

**Acceptance Criteria**

- No native `<select>` is used in Change Impact for user, profile, permset, group, object, or field selection.
- Typing two or more characters narrows the candidate list.
- Arrow keys and Enter work for keyboard selection.

### 2.16 UX — UX-14 — Remove PermSet from User: Precompute All Impacts, No Selection Required

Instead of requiring the user to pick a user and then a permset, precompute the impact of every `(user, assigned permset)` pair and render as a searchable / filterable table. Estimated cost: approximately 1,036 users × ~25 assigned permsets on average = ~26,000 pairs. With a memoized per-user baseline and per-permset delta (each delta is O(permset-object-perms + permset-field-perms)), total compute is expected in the 3–10 second range as a one-time load. This is acceptable for a one-time pass that powers the whole view.

**Required behavior:**

- On entering this scenario for the first time after a dataset load, run the full precompute with a progress indicator (e.g., "Analyzing 1,036 users × 25 permsets…").
- Cache the result in memory for the current dataset — re-enter is instant.
- Invalidate the cache on any dataset reload / import.
- Render as a table with columns: User, Profile, PermSet (that would be removed), Lost Objects (count), Lost Fields (count), Lost System Perms (count).
- Each row is clickable → full before/after diff.
- Table supports typeahead filtering on any column.

**Acceptance Criteria**

- The scenario does not require any selection to produce output.
- The table populates within 10 s for a dataset of ~470k rows.
- Subsequent entries to the scenario (same dataset) are instant.

### 2.17 UX — UX-15 — Delete PermSet Entirely: Incremental Search + Zero-Impact Callout

Selector is typeahead (UX-13). In addition, the view highlights PermSets whose deletion would have **zero effective impact on any active standard user (including API users)** because every assignee of that PermSet still receives the same permissions from another source (profile or another assigned PermSet / Group member).

**Scope clarification from feedback:**

- "Unassigned" PermSets (no user and no group reference) are NOT included in this callout — they are already surfaced separately in the Orphaned PermSets finding (Section 6.3).
- "Redundant" PermSets ARE included — these are assigned to one or more users, but every affected user is fully covered elsewhere.
- A single PermSet may be covered by multiple sources for the same user. The view must show ALL covering sources per user, not just the first one found, because that's the kind of detail an admin needs to sign off on the deletion.

**Required behavior:**

- Typeahead PermSet selector.
- On selection, compute: for every user assigned (directly or via group), the set of effective permissions they would lose. Group by user. If the loss set is empty, flag that user as "covered."
- A PermSet is tagged "Zero-impact deletion candidate" if all affected users are covered.
- For covered users, display every other profile / PermSet / Group that provides the same permissions — not just one.
- Include API users (`UserType = 'Standard'` filter already covers them via User.csv; if an admin later wants integration users, that's a separate spec change out of scope here).

**Acceptance Criteria**

- A PermSet with zero effective impact gets the "Zero-impact deletion candidate" badge.
- For each covered user, the covering source list contains every redundant source (not just one).
- Unassigned PermSets are NOT in this list (they live in Orphaned).

### 2.18 UX — UX-16 — Modify Profile: Incremental Search

Both the before-profile selector and the after-profile selector on the Modify Profile scenario must be typeahead (UX-13). This item depends on BUG-6 being fixed first.

**Acceptance Criteria**

- No native dropdowns on Modify Profile.
- Typeahead matches are drawn from the `Profile` dataset.

### 2.19 UX — UX-17 — Revoke Field from PermSet: Cascaded Typeahead with Impacted Users

The flow becomes: (1) PermSet typeahead — PermSets only, no Groups (see BUG-7). (2) Object typeahead — only objects for which the selected PermSet has at least one field grant. (3) Field typeahead — only fields within the selected object for which the PermSet has a Read or Edit grant. (4) On selection, display every active standard user who would lose effective access to that field (i.e., the PermSet is the sole remaining Read/Edit source after profile and other PermSet union).

**Acceptance Criteria**

- All three selectors are typeahead, not native dropdowns.
- Object and Field selectors are cascaded from the PermSet selection.
- Impacted Users list appears below the selectors on full field selection.
- Users already covered by profile or another PermSet are NOT in the impacted list.

### 2.20 UX — UX-18 — Widen App Layout / Use More Horizontal Real Estate

The current layout underuses the viewport horizontally. Tables and panels feel constrained, forcing truncation and unnecessary wrapping.

**Fix Required**

- Remove fixed max-width containers or raise them substantially. Target layout uses up to ~1680 px (or `max-w-screen-2xl` equivalent) with comfortable but not excessive side padding.
- The three-area layout (left sidebar, main panel, right panel) should grow with the window; the main panel should absorb most of the extra space.
- Collapsed/expanded states of the right panel must persist for the session (see UX-21 / 2.23).

**Acceptance Criteria**

- On a 1440 px and 1920 px viewport, the detail tables consume noticeably more horizontal space than in v2.5.
- No table with fewer than ~8 columns requires horizontal scrolling at 1440 px width.

### 2.21 UX — UX-19 — Expose Apex Classes / Visualforce Pages / Custom Permissions by PermSet & Profile

The dataset already contains `SetupEntityAccess` rows keyed to `ParentId` (PermSet or Profile) with `SetupEntityType` of `ApexClass`, `ApexPage` (Visualforce), `CustomPermission`, `TabSet`, `ConnectedApplication`, etc. (Sample file contains 1,000 rows; `ApexClass`, `CustomPermission` confirmed present.) Administrators need to see which PermSets/Profiles grant which Apex classes, VF pages, and custom permissions — and the reverse: for a given Apex class or VF page, which PermSets/Profiles enable it.

**Fix Required**

- PermSet and Profile detail views must render a "Setup Entity Access" sub-section grouped by `SetupEntityType` with counts per type (e.g., Apex Classes (12), Visualforce Pages (4), Custom Permissions (7), Connected Apps (2), TabSets (1)).
- Each group supports per-sub-section search (UX-5) matching on `Parent.Name` (the entity name) case-insensitively.
- Add Apex Class, Visualforce Page, and Custom Permission as first-class entry points in the left-sidebar navigation. Selecting one shows all PermSets and Profiles whose `SetupEntityAccess.SetupEntityId` or `Parent.Name` matches, with a flag distinguishing Profile-owned PermSets (see UX-11 / 2.13).
- Reverse lookup ACs: typing an Apex class name resolves to every PermSet/Profile that grants access to it.

**Acceptance Criteria**

- Pick a PermSet known to grant Apex classes; the PermSet detail view shows those Apex classes in a Setup Entity Access sub-section with the correct count in the header badge.
- Pick an Apex class from the new entry point; the list of granting PermSets/Profiles matches the `ParentId` rows in `SetupEntityAccess.csv` for that class.
- Same round-trip works for Visualforce Pages (`ApexPage`) and Custom Permissions (`CustomPermission`).

### 2.22 UX — UX-20 — "Load All Computations" Admin Action

Admins testing the app want to warm every precompute (Impact Matrix, similarity clusters, redundancy findings, etc.) in one click rather than navigating to each scenario to trigger its first-run cost.

**Fix Required**

- Add a "Load All Computations" button on the Admin tab, placed in the top-of-tab control bar (Section 7.3) next to Import/Export Bundle.
- On click, sequentially run every precompute that the app performs lazily today: Remove-PermSet-from-User Impact Matrix (UX-14), Delete-PermSet zero-impact callout (UX-15), profile similarity clustering (Jaccard), duplicate/subset detection, orphaned PermSets scan, field provenance indexes, Setup Entity Access indexes (UX-19).
- Show a progress list with per-task status (`pending`, `running`, `done`, `error`) and elapsed time. Disable the button while running.
- Completed precomputes persist for the session so later navigation is instant (ties into UX-21 / 2.23).

**Acceptance Criteria**

- Clicking the button with a fresh dataset completes all precomputes without navigation; final status shows `done` for every task.
- After a successful run, opening any Change Impact scenario or Overlap report renders instantly (no spinner).
- Failures on individual tasks are surfaced with a retry affordance; one failure does not block the others.

### 2.23 UX — UX-21 — Session-Persistent Selections Across Navigation

Today, navigating from (say) "Revoke Field from PermSet" to the Explorer and back clears the selections in the first view. The user has to re-select everything. Because `localStorage` and `sessionStorage` are blocked in the sandboxed iframe (Section 2.4 / v2.4), persistence must be implemented in the app's in-memory state (React context or lifted state), scoped to the session.

**Fix Required**

- Lift all view-local selections (entry-point selection, Change Impact selectors, scope pills, search inputs) into a top-level `AppState` context that lives for the lifetime of the component mount.
- Navigating between tabs/sub-views must not reset that state. Returning to a prior tab must restore the last selections exactly.
- Explicit "Clear" controls remain available in each view. Only navigation-away must not wipe state.
- State resets on: dataset reload (CSV upload or bundle import), Admin "Reset" action, and full page refresh (expected, since storage APIs are blocked).

**Acceptance Criteria**

- Select a PermSet + Object + Field in Revoke Field, navigate to Explorer, navigate back — all three selections are still there.
- Switch to any other tab and back — every typeahead input, scope pill, and search input retains its prior value.
- Uploading a new CSV clears state (by design).

### 2.24 UX — UX-22 — PermSet Reconciliation / Consolidation Workflow

Strategic use case (example from product owner): "I have 7 different Salesforce CPQ permsets — that seems excessive. Can we consolidate, and how?" The Overlap & Redundancy view (Section 6.3) already identifies duplicates and subsets, but it does not guide an admin through the reconciliation itself.

**Fix Required**

- Add a "Reconcile PermSets" workflow reachable from Overlap & Redundancy and from the left-sidebar PermSet entry point (multi-select mode).
- Workflow inputs: 2+ PermSets chosen via typeahead, or auto-populated from a detected similarity cluster.
- Workflow outputs:
  1. **Venn summary** — permissions unique to each PermSet, pairwise intersections, and the full intersection.
  2. **Proposed consolidated PermSet** — a synthetic PermSet that is the union of all inputs; shown as a downloadable `.permissionset` XML metadata preview and a CSV of its permissions.
  3. **Proposed muting PermSets** — if any input PermSet has a permission that others lack, show the mute set that would be required to reproduce the original narrower PermSet from the consolidated union (for users who must not gain the broader access).
  4. **Assignment migration plan** — every user currently assigned to any of the input PermSets, with the target state (assign consolidated PermSet + optional muting PermSet) and the effective-permission delta (Losses / Gains) after migration.
- All selectors are typeahead (UX-13). Workflow state persists per UX-21.

**Acceptance Criteria**

- For a cluster of 7 CPQ PermSets, running the workflow renders the Venn summary, a consolidated PermSet preview, and an assignment migration plan covering every currently-assigned user.
- The assignment migration plan's Losses column is empty for every user if the proposed muting PermSets are applied as specified.

### 2.25 UX — UX-23 — Explorer: Hide Objects With No Grants in "Effective Objects"

In the User detail view, the "Effective Objects" sub-section lists every object in the org, including those with zero grants for the selected user. This adds noise.

**Fix Required**

- Filter the Effective Objects sub-section to objects with at least one non-false permission (Read / Create / Edit / Delete / ViewAll / ModifyAll) for the selected user's union of Profile + PermSets, after muting.
- The sub-section header count reflects the filtered count.
- A toggle "Show objects with no access" (off by default) restores the full list for admins who want it.

**Acceptance Criteria**

- For a user with grants on 42 objects out of 600, the Effective Objects sub-section shows 42 rows by default.
- Enabling the toggle restores the full 600.

### 2.26 UX — UX-24 — Profile Detail: Sort Assigned Users by Last Login Ascending

When viewing a Profile, the Assigned Users sub-section (UX-7 pattern, extended to Profile) must be sorted by `LastLoginDate` ascending by default, so dormant users surface first. Null `LastLoginDate` values (never logged in) sort first.

**Fix Required**

- Default sort key for the Profile → Assigned Users sub-section is `LastLoginDate ASC` with null-first ordering.
- Column header is clickable to toggle ASC/DESC and to switch sort key.
- Sort selection persists per UX-21.

**Acceptance Criteria**

- Opening any Profile with ≥2 assigned users shows the longest-dormant user at the top; never-logged-in users appear above all others.
- Header click inverts the sort.

### 2.27 UX — UX-25 — Explorer: Reduce Horizontal Scrolling in "Effective Fields"

Effective Fields currently scrolls horizontally even on wide viewports. Combined with UX-18 (wider layout) this should be eliminated for typical column counts.

**Fix Required**

- Collapse low-value columns into a single "Grants" cell rendering compact read/edit pills (`R`, `R/E`, `R/E/View`, etc.).
- Move provenance to a hover popover or an expand-row action instead of inline columns.
- At 1440 px the Effective Fields table must fit without horizontal scroll for any field count.

**Acceptance Criteria**

- No horizontal scrollbar on Effective Fields at 1440 px and 1920 px viewport widths for a user with up to 2,000 effective fields.
- All provenance details from UX-11 remain reachable (via popover or expand).

### 2.28 Bug Fix — BUG-8 — Profile Detail Still Renders Empty (Re-open of BUG-5)

BUG-5 (Section 2.4) was meant to address empty Profile detail views, but the issue persists. Evidence: selecting the Finance profile renders Objects (0), Fields (0), Tab Settings (0), Setup Entity Access (0), and only 1 system perm (`PermissionsApiEnabled`), despite the Finance profile having substantial grants in `ObjectPermissions.csv`, `FieldPermissions.csv`, and related CSVs. The expected output (per product owner) for Finance includes rows such as `Account — Read, Create, Edit, Delete — 577 — Default On — Varies by Record Type` that must render as structured columns (Object, CRUD pills, count, default flag, record-type note) rather than a run-on string.

**Root Cause Hypothesis**

- The fan-out from Profile.Id likely uses the PermSet ParentId convention, but Profile rows are keyed differently in the underlying CSVs (Profile.Id vs. PermissionSet.Id where `IsOwnedByProfile = true`). The index is probably joining the wrong key.
- Additionally, when the renderer concatenates `SobjectType + PermissionsRead + PermissionsCreate + …` without delimiters, it produces strings like `AccountsAccountRead, Create, Edit, Delete577Default OnVaries by Record Type`. This is a render-layer defect on top of the join defect.

**Fix Required**

- Resolve Profile → ObjectPermissions / FieldPermissions / System Perms via the profile's implicit PermissionSet (`PermissionSet.ProfileId = Profile.Id AND IsOwnedByProfile = true`), not via `ParentId = Profile.Id`. Confirm with the exported CSVs which key actually joins.
- Render the detail as a proper table with typed columns: Object | CRUD | Field Count | Default On | Record Type Notes. No concatenated string cells.
- Include a debug-mode link on the detail header ("Why is this empty?") that shows the join path, the key being used, and the count of rows examined — so the next regression is self-diagnosing.

**Acceptance Criteria**

- Selecting Finance renders ≥1 row for Account with CRUD flags and the correct field count; no empty sub-sections for any profile with grants.
- For every profile with ≥1 row in `ObjectPermissions.csv` (after the implicit-PermSet join), the Objects sub-section count is ≥1.
- No concatenated-string rendering appears anywhere in the Profile detail view.

### 2.29 Bug Fix — BUG-9 — Role List Still Includes Portal Roles (Re-open of UX-12)

Per UX-12 (Section 2.14) the Roles view must show only internal roles. Product owner reports portal roles are still visible.

**Root Cause Hypothesis**

- Either the Query 5 SOQL export was run before UX-12 was applied, or the client-side defensive filter on `PortalType` is not in place, or both.

**Fix Required**

- Enforce a client-side filter that treats only `PortalType === 'None'` (or empty) as internal — every other value (`Partner`, `CustomerPortal`, etc.) is filtered out of all Role entry-point lookups and the Role hierarchy traversal, even if the CSV includes portal rows.
- Render a yellow admin warning when any portal rows were dropped ("N portal roles were filtered out of UserRole.csv — re-run Query 5 with `WHERE PortalType = 'None'` to remove them at the source").

**Acceptance Criteria**

- With a `UserRole.csv` containing known portal rows, the Roles list shows zero portal roles and the Admin tab displays a yellow warning with the dropped count.

### 2.30 UX — UX-26 — Audit Renderer for Permsets That Appear Empty

Product owner reports PermSets that appear to grant "nothing meaningful" (example: `S: Send Email / Edit Tasks` showing only System Perms `Send Email` and `Send Non-Commercial Email`). It is unclear whether the PermSet actually grants only those two system perms or whether other categories (object perms, field perms, tab settings, setup entity access, custom permissions) exist but are not rendered.

**Fix Required**

- For each PermSet in the dataset, audit every permission category (ObjectPermissions, FieldPermissions, SystemPermissions, TabSettings, SetupEntityAccess by type — ApexClass, ApexPage, CustomPermission, ConnectedApplication, etc.) and emit a `PermSet Coverage Report` on the Admin tab: for each PermSet, how many rows exist per category and which categories are non-zero.
- Cross-check the report against the PermSet detail view. Any non-zero category in the dataset that is not rendered in the UI is a renderer bug — file and fix.
- For `S: Send Email / Edit Tasks` specifically, document in the report whether its only grants are the two system perms, or whether grants exist in categories the UI is not showing.

**Acceptance Criteria**

- The PermSet Coverage Report is reachable from the Admin tab and exports as CSV.
- For every PermSet, the detail view's sub-section counts equal the report counts for that PermSet, per category.

### 2.31 UX — UX-27 — Remove PermSet from User: Separate Filters for User / Profile / PermSet

The Impact Matrix (UX-14) currently has one combined filter. Admins want to narrow the matrix independently by User, by Profile, and by PermSet.

**Fix Required**

- Replace the single filter with three independent filter inputs above the Impact Matrix table, each a typeahead (see UX-28 / 2.32).
- Filters compose as AND: selecting User=X and PermSet=Y shows only the (X, Y) row.
- Clearing a filter removes only its contribution; the others remain applied.
- Filter state persists per UX-21.

**Acceptance Criteria**

- The Impact Matrix has three filter inputs labeled "User", "Profile", "PermSet".
- Setting User=X restricts rows to that user; setting Profile=P further restricts; setting PermSet=Y further restricts to the specific (X, Y) row.

### 2.32 UX — UX-28 — Change Impact Filters: Typeahead Suggestions, Not Live Row Filter

Today, typing into the Change Impact filters filters the rows of the table as you type. The product owner wants a classic typeahead: the input suggests matching values in a dropdown; rows update only when a suggestion is selected (via click or Enter).

**Fix Required**

- Input typing shows a dropdown of up to 50 suggestions ranked by match quality (prefix > substring; name > label > developer name).
- Rows do NOT re-filter on keystroke; they re-filter only when a suggestion is selected.
- Escape closes the dropdown without applying a filter.
- Behavior applies to all Change Impact filters (Remove, Delete, Modify Profile, Revoke Field) and replaces the live-filter behavior across them.

**Acceptance Criteria**

- Typing "Acc" shows a suggestion list but the table does not change.
- Selecting "Accounting Manager" from the list applies the filter and updates the table.

### 2.33 UX — UX-29 — Cross-Link: Impact Matrix Reflects Explorer Context

If the admin has a User selected in the Explorer, then navigates to Remove-PermSet-from-User, the Impact Matrix should pre-filter to that user. The relationship is bidirectional: clicking an impacted user in the matrix navigates to that user in the Explorer with the selection preserved per UX-21.

**Fix Required**

- When entering Remove-PermSet-from-User with an Explorer User selection active, pre-apply the User filter.
- Every User cell in the Impact Matrix is a link → opens that user in the Explorer with the User selection applied.
- Every PermSet cell in the Impact Matrix is a link → opens that PermSet in the Explorer.

**Acceptance Criteria**

- Select a User in Explorer, open Remove-PermSet-from-User — User filter is pre-populated.
- Click a user cell in the matrix — Explorer opens to that user.

### 2.34 UX — UX-30 — Remove PermSet from User: Enumerate Alternative Covering Sources

For each (User, PermSet) row in the Impact Matrix, when the user would retain an object / field / system perm via another source, list every such covering source. This is the same "covering sources" enumeration used in UX-15 (Delete PermSet Entirely) applied per-row to the Remove case.

**Fix Required**

- Add an expandable "Covering sources (retained access)" section per matrix row: for every permission the user would NOT lose, show which other Profile / PermSet / Group provides it.
- This is distinct from the existing "Lost permissions" section which lists only what disappears.
- The expansion is lazy-rendered to keep the matrix performant.

**Acceptance Criteria**

- Expanding a non-zero-impact row shows both Lost (what disappears) and Covered (what's retained with the source list).
- The union of Lost and Covered equals the PermSet's full grant set (sanity check).

### 2.35 UX — UX-31 — Remove PermSet from User: Flag Rows That Cause Loss of Access

Zero-impact rows are already highlighted as safe. The inverse — rows that would cause any loss of access — should be explicitly flagged so an admin skimming a long list cannot miss them.

**Fix Required**

- Rows with any lost permission render a red "Will lose access" badge at the row level.
- A column "Impact severity" ranks rows: `None` (green), `Minor` (yellow, e.g., field-only losses on low-volume fields), `Major` (red, any object-level CRUD loss or system perm loss).
- The table can be sorted by Impact severity.

**Acceptance Criteria**

- Every non-zero-impact row shows the "Will lose access" badge and a color-coded severity.
- Sorting by severity puts Major first.

### 2.36 UX — UX-32 — Delete PermSet Entirely: Surface Impacted Users at Top of Selected PermSet View

Currently, once a PermSet is selected, the Impacted Users list is at the bottom of the page and requires scrolling past the zero-impact callout and covering-sources enumeration to reach.

**Fix Required**

- Reorder the Delete-PermSet detail layout: (1) header with PermSet name and zero-impact badge (if applicable), (2) Impacted Users list (collapsed by default with the count visible), (3) per-user covering-sources enumeration, (4) supporting detail.
- Default scroll position on PermSet selection is the top of the page; Impacted Users is visible above the fold on a 1080 px tall viewport.

**Acceptance Criteria**

- On selecting a PermSet with ≥1 impacted user, the "Impacted Users — N" header is visible without scrolling on a 1440×900 viewport.

### 2.37 UX — UX-33 — Delete PermSet Entirely: Per-User Alternative Covering Sources

For each impacted user, list every other PermSet / Profile the user has that grants each permission they would otherwise lose — so the admin can decide whether the deletion is actually safe for that user.

**Fix Required**

- Under each impacted user, render a table: Permission | Covered By (list of Profile / PermSet / Group names).
- If any permission has an empty "Covered By" column, that row renders red (true loss) — unambiguous signal.
- If every row has a non-empty "Covered By", the user is promoted out of "Impacted" into a new "Impacted but covered" list (de-emphasized).

**Acceptance Criteria**

- For a test PermSet + user combination with a mix of covered and uncovered permissions, both tables render correctly.
- A user whose every permission has a covering source appears under "Impacted but covered", not "Impacted".

### 2.38 UX — UX-34 — Clarify "0 tokens" Label in Covering Sources (All)

The phrase "0 tokens" under "Covering sources (All)" is unclear. (Likely refers to permission tokens/keys or to a count of covering-source objects; the label needs to say what it counts or be removed.)

**Fix Required**

- Replace "tokens" with a concrete noun matching what is being counted (e.g., "0 covering permissions", "0 additional sources").
- Add a tooltip on hover explaining the metric in one sentence.
- If the metric is not informative on its own, remove it from the UI.

**Acceptance Criteria**

- The label on screen is a concrete noun a non-developer administrator can interpret unaided.
- Hover reveals a one-sentence explanation.

### 2.39 UX — UX-35 — Modify Profile: Rename Target → Future

Rename the "Target profile" label to "Future profile" throughout the Modify Profile scenario UI and exports.

**Acceptance Criteria**

- No occurrence of "Target profile" in the Modify Profile view; all labels say "Future profile".
- Exported Change Impact Reports use "Future profile" as the column header.

### 2.40 UX — UX-36 — Modify Profile: Show Current Profile Explicitly

The Modify Profile scenario must render the user's current profile prominently alongside the Future profile selector.

**Fix Required**

- Layout: two labeled cards side by side — "Current profile: <Name>" (read-only, derived from the selected user) and "Future profile: <typeahead>".
- Both cards display the profile's key metadata (License type, User count, Last modified date).

**Acceptance Criteria**

- On selecting a user, the Current profile card is immediately populated and read-only.
- Changing the Future profile updates only the right card; the left remains fixed to the user's actual current profile.

### 2.41 UX — UX-37 — Modify Profile: Side-by-Side Comparison by Object, Field, System Perms

Beyond the existing Gains / Losses summary, render a full side-by-side comparison of Current vs. Future profile across three tabs: Objects, Fields, System Perms. Each row shows the permission, the Current value, the Future value, and a Change indicator (added / removed / changed / unchanged).

**Fix Required**

- Three tabs under the Comparison panel: Objects, Fields, System Perms.
- Each tab is a table: Name | Current | Future | Change.
- "Only show differences" toggle, on by default, filters to rows where `Current != Future`.
- Export each tab to CSV.

**Acceptance Criteria**

- For a tested (user, future profile) pair, every row where Current and Future differ is surfaced, with an accurate Change indicator.
- Exported CSVs match the on-screen tables exactly.

### 2.42 UX — UX-38 — Revoke Field from PermSet: On-Screen Purpose Description

The Revoke Field from PermSet view has no explanation of what it does. Add a short description at the top.

**Fix Required**

- Render a paragraph at the top of the view: "Simulate revoking a specific field from a Permission Set. Shows every user who would lose Read or Edit on that field, grouped by whether the loss is real (no other source grants it) or covered (another PermSet/Profile still grants it)."
- A "Learn more" link expands to a longer explanation of the cascaded selector flow.

**Acceptance Criteria**

- The purpose paragraph is visible on first render of the view; no user-initiated interaction required to see it.

### 2.43 Bug Fix — BUG-10 — Revoke Field PermSet Typeahead Matches on Type Field

The PermSet typeahead in Revoke Field matches on both the PermSet name and the PermSet type — so searching `Custom` returns every PermSet whose type is `Custom`, not just PermSets whose name contains "Custom".

**Root Cause**

- The typeahead match function is including the `Type` column in its match predicate.

**Fix Required**

- Restrict the match predicate to the name, label, and developer name fields only (per UX-13). Exclude `Type`, `License`, `Namespace`, and all other metadata columns.
- Apply the same scoping to every Change Impact typeahead across scenarios, not just Revoke Field.

**Acceptance Criteria**

- Typing `Custom` into the PermSet typeahead returns only PermSets whose name contains "Custom".
- No PermSet appears in results solely because its `Type` is `Custom`.

### 2.44 UX — UX-39 — Overlap & Redundancy: Section Labels and Descriptions

Every block in the Overlap & Redundancy view (Duplicate PermSets, Subsets, Similarity Clusters, Orphaned PermSets, Dead Fields, Dismissed Findings) needs an inline explanation of what the block shows, why it matters, and what the admin can do about it.

**Fix Required**

- One-paragraph description beneath every block header.
- "Show examples" affordance for each block that seeds a synthetic example when the dataset has none.

**Acceptance Criteria**

- Every Overlap & Redundancy block has a visible description paragraph.
- The description includes a recommended action ("Consider consolidating these with the Reconcile workflow — UX-22").

### 2.45 UX — UX-40 — Overlap & Redundancy: Define "Duplicate PermSet" + Side-by-Side Compare

"Duplicate PermSets" is ambiguous — does it mean an exact permission-set equality, or high similarity? Administrators need (1) a precise definition on screen and (2) a way to confirm the duplication by comparing the two PermSets side-by-side before acting.

**Fix Required**

- Define on screen: "Two PermSets are duplicates when they grant the identical set of object permissions, field permissions, system permissions, tab settings, and setup entity access — after applying muting." Display this definition above the Duplicate PermSets block.
- Each duplicate pair shows a "Compare" button → opens a side-by-side comparison with three tabs (Objects, Fields, System Perms) and a "Highlight differences" toggle.
- If the comparison surfaces any difference, the pair is downgraded from "Duplicate" to "Near-duplicate" and moved to a new block with a noted similarity percentage.

**Acceptance Criteria**

- A definition paragraph appears above the Duplicate PermSets block.
- Clicking Compare on any duplicate pair opens a three-tab comparison; toggling "Highlight differences" shows zero differences for a true duplicate.
- A seeded near-duplicate (one-field delta) appears under Near-duplicate, not Duplicate.

### 2.46 UX — UX-41 — Migration: Section Labels and Descriptions

Every block in the Migration Analysis view (Three-Way Decomposition, Shared Base, Additive Deltas, Muting PermSets, Similarity Clusters, Coverage Gaps, Migration Readiness) needs an inline explanation mirroring UX-39.

**Acceptance Criteria**

- Every Migration block has a visible description paragraph explaining what the block shows and the recommended action.

### 2.47 UX — UX-42 — Migration: Profile-to-Profile Comparison

Admins need to compare any two profiles directly within Migration Analysis to confirm similarity and understand differences before clustering them.

**Fix Required**

- "Compare Profiles" control in the Migration tab: two typeaheads (Profile A, Profile B) → side-by-side comparison with the same three-tab layout used in UX-37 / 2.41 (Objects, Fields, System Perms).
- Similarity score (Jaccard) displayed prominently; green at >70%, yellow at 50–70%, red below.

**Acceptance Criteria**

- The Compare Profiles control renders a three-tab side-by-side view with a visible Jaccard similarity score.
- Selecting two profiles from the same cluster shows >70% similarity.

### 2.48 UX — UX-43 — Migration: Cluster Inspection and Comparison

Similarity clusters currently render as a list of member profiles with a similarity score. Admins need an expansion per cluster that shows every pairwise comparison inside it, and a "cluster consensus" view.

**Fix Required**

- Each cluster expands to a matrix of pairwise Jaccard scores.
- A "Cluster consensus" view displays the intersection of all member profiles (the Shared Base candidate) and per-member additive deltas (the Additive Delta candidates) — same structure as the Three-Way Decomposition.
- "Confirm cluster" button promotes the cluster to the migration plan; "Reject cluster" dismisses it and records the reason per Section 6.3 dismissal workflow.

**Acceptance Criteria**

- Expanding a cluster shows the pairwise score matrix and the consensus view.
- Confirm/Reject actions persist in the dismissal log and round-trip through bundle export/import.

### 2.49 UX — UX-44 — Admin: Validation Notices Must Explain the Fix

Every yellow/red validation notice on the Admin tab must tell the admin how to resolve it or explicitly mark itself as informational.

**Fix Required**

- Each notice has a `Reason`, a `Fix` (or `Informational only` if no action is required), and a `Learn more` link where applicable.
- Examples:
  - "N rows in ObjectPermissions.csv had blank SobjectType" → `Fix`: "Re-run Query 3 in Workbench; some rows may represent deprecated objects that Salesforce will not return if the query uses `WHERE IsCustomSetting = false AND SobjectType != null`."
  - "N portal roles filtered" → `Fix`: "Re-run Query 5 with `WHERE PortalType = 'None'`."
  - "Dataset loaded from embedded fallback" → `Informational only`.

**Acceptance Criteria**

- Every validation notice renders with a `Reason` line and either a `Fix` line or an explicit `Informational only` tag.

### 2.50 UX — UX-45 — Admin: Informational-Only Notices Explicitly Labeled

Any Admin notice that does not require action must carry an `Informational only` tag so the admin doesn't spend time looking for a fix that doesn't exist.

**Acceptance Criteria**

- Every Admin notice is tagged either `Action required`, `Warning`, or `Informational only`.
- Informational-only notices do not appear in the top-of-tab warning counter.

### 2.51 UX — UX-46 — Admin: Remove Embedded Snapshot

The Admin tab currently shows an embedded snapshot of the dataset. Remove it — the per-dataset cards and the bottom file manifest (Section 7.3) already cover dataset visibility, and the snapshot duplicates that information.

**Fix Required**

- Remove the embedded dataset snapshot UI from the Admin tab.
- Do not replace it; the per-dataset cards and the file manifest are sufficient.

**Acceptance Criteria**

- The Admin tab renders no full-dataset snapshot.
- All row counts and source labels remain visible via the per-dataset cards and manifest.

### 2.52 UX — UX-47 — Prescriptive Access Lookup ("What PermSet Do I Need to Assign?")

The existing explorer answers descriptive questions ("who has access?"). Admins also need the prescriptive inverse: "User X needs access to Object/Field/System-Perm Y — which PermSet (or PermSet Group) should I assign to grant exactly that?" This is distinct from every existing view and is a new first-class capability.

**Fix Required**

- Add a "Prescribe Access" view reachable from the left sidebar and from any Object/Field/System-Perm detail view ("Who already grants this?").
- Inputs: (1) a target user (typeahead), (2) a desired access — at minimum `{ SobjectType, CRUD bitmask }` for objects, `{ SobjectType.Field, Read|Edit }` for fields, or a system-perm key; multiple desired-access rows can be added.
- Outputs:
  - **Already covered** — list desired rows the user already has (via Profile, PermSet, Group); no assignment needed.
  - **Minimum-assignment candidates** — ranked list of PermSets / PermSet Groups that, if assigned, would fully cover the remaining desired rows. Rank by (i) fewest extra grants the user would also gain (least-privilege), (ii) PermSet Group > single PermSet where both qualify, (iii) alphabetical tiebreaker.
  - **Combination suggestions** — when no single PermSet covers the desired rows, suggest the minimum set of PermSets that together cover them (greedy set-cover). Show the coverage gap if no combination covers all rows.
  - **Side-effect preview** — for the top candidate and each combination, render a compact "User after assignment" diff: Gains (new permissions beyond the desired rows) and Losses (none expected; flag if non-zero as a warning).
- All selectors use typeahead (UX-13). State persists per UX-21.
- Export: CSV of desired rows, selected candidate(s), and the side-effect diff.

**Acceptance Criteria**

- For a test user + a desired (Object, CRUD) that is granted by exactly one PermSet, the "Minimum-assignment candidates" list shows that PermSet as rank #1 with zero unnecessary extras.
- For a desired row already covered by the user's Profile, the row appears under "Already covered" and the candidate list does not include any PermSet on its account.
- For desired rows not covered by any single PermSet, a Combination suggestion renders with a coverage score; if no combination covers all rows, the coverage gap is listed explicitly.

### 2.53 Bug Fix — BUG-11 — Effective Objects "Granted By" Renders 18-Digit IDs Instead of Names

In the User detail → Effective Objects sub-section, the "Granted by" column renders the raw 18-digit Salesforce Ids (e.g., `0PS3g0000045XyZAAI`) instead of the source's human-readable name.

**Root Cause Hypothesis**

- The renderer emits `sourceId` directly rather than resolving it through `profileById` / `permSetById` / `groupById` (all of which exist in the index). Likely also affects PermSet Groups where the assignment is via group membership.

**Fix Required**

- Render the source name with a fallback chain: Profile.Name → PermissionSet.Label → PermissionSet.Name → PermSetGroup.MasterLabel → Id (last resort only, shown in a tooltip).
- Prefix each source with its kind pill — `Profile` / `PermSet` / `Group` — so the admin knows where the grant came from at a glance.
- If a grant comes via a Group → member PermSet, render as `Group: <Group name> → <PermSet name>`.
- Apply the same resolution wherever "Granted by" appears (Effective Objects, Effective Fields, Effective Sys Perms, Muted, Change Impact covering-sources lists).

**Acceptance Criteria**

- Zero 18-digit Ids rendered as the primary display value in any "Granted by" column across the app.
- Every source has a kind pill (Profile / PermSet / Group).
- Raw Id is still available on hover as a tooltip for debugging.

### 2.54 Bug Fix — BUG-12 — Effective Objects → Fields Cascade Not Functional

UX-6 specifies that selecting an Object row filters the Fields sub-section to that object's fields. Live testing shows the cascade is not applied — either the click is not wired, the "Scoped to <Object> — Clear scope" pill is not rendering, or the filter is being reset on re-render.

**Fix Required**

- Instrument the cascade path end-to-end: click handler on Object row → updates cascade state in `AppStateContext` (UX-21) → Fields sub-section reads the cascade scope and filters its rows.
- Make the selected Object row visually sticky (accent border or background) so the state is obvious.
- Render the "Scoped to <Object> — Clear scope" pill above the Fields sub-section whenever a cascade is active. Clicking the pill clears the scope.

**Acceptance Criteria**

- Click an Object row in User → Effective Objects; the Fields sub-section reduces to that object's fields only, within one frame.
- The scope pill is visible and the Object row is visually marked as selected.
- Clicking "Clear scope" (or the selected row again) restores the full Fields list.

### 2.55 UX — UX-48 — Effective Fields: Fix Column Layout (Drop Object Column, Narrow Field)

Two issues in User → Effective Fields: (1) the Field column is extremely wide, causing horizontal scroll even on wide viewports, and (2) the Object column is redundant once the UX-6 cascade is applied (the entire table is already scoped to one Object). When the cascade is not applied the table shows all objects — but at that point, the Object column is better rendered as a row-group header rather than a per-row column.

**Fix Required**

- When UX-6 cascade is active (table scoped to one Object): omit the Object column entirely.
- When no cascade is active: render the table grouped by Object with a row-group header (sticky within the group). No per-row Object column; the header establishes the object.
- The Field column truncates to a reasonable width (~240 px) with full name on hover; wider names wrap to a second line rather than forcing horizontal scroll.
- Combine the UX-25 GrantPillCell refactor with this change so the combined column set fits a 1440 px viewport without horizontal scroll.

**Acceptance Criteria**

- With cascade ON, the table has no Object column and no horizontal scroll at 1440 px.
- With cascade OFF, rows are grouped under Object headers; the visible column count still fits 1440 px without horizontal scroll.
- Long field API names (> ~30 chars) wrap or truncate with tooltip; they never force horizontal scroll.

### 2.56 Bug Fix — BUG-13 — Remove-PermSet-from-User "Total" Sort Direction Not Toggling

The sort control on the Impact Matrix Total column only sorts descending; clicking the header or dropdown again does not switch to ascending. Admins want both directions so they can see smallest-impact rows as easily as largest.

**Fix Required**

- Make the sort direction a toggle: first click sorts descending (current default), second click ascending, third click returns to default (or removes the sort).
- Show a directional indicator (▲ / ▼) on the active sort column's header.
- Persist direction per UX-21.

**Acceptance Criteria**

- Clicking the Total header alternates DESC / ASC / unsorted and the directional arrow reflects the state.
- The sort order of rows in the table matches the indicated direction exactly.

### 2.57 UX — UX-49 — Delete-PermSet-Entirely: Clear Selection Affordance

After selecting a PermSet in the Delete-PermSet-Entirely search bar, there is no one-click way to clear the selection and return to the default view. Admins have to reload or manually delete their typed text.

**Fix Required**

- Render an `×` Clear control inside the PermSet search/typeahead whenever a selection is active.
- Clicking Clear resets the selection and restores the default empty view.
- The Escape key also clears an active selection (same behavior).

**Acceptance Criteria**

- An `×` control is visible whenever a PermSet is selected in Delete-PermSet-Entirely.
- Clicking Clear or pressing Escape returns the view to its default empty state.

### 2.58 UX — UX-50 — Modify Profile: Rename Tab/Section to "Change User Profile"

The Modify Profile scenario is better named "Change User Profile" to reflect what the user is simulating. This supersedes the v2.6 labeling.

**Fix Required**

- Rename the Change Impact nav entry, the page header, and every on-screen reference from "Modify Profile" → "Change User Profile".
- Exported Change Impact Reports use "Change User Profile" in the scenario column.
- The UX-35 "Target profile → Future profile" rename remains (intra-scenario labeling is unaffected).

**Acceptance Criteria**

- No visible occurrence of "Modify Profile" anywhere in the UI or in exports.
- The left-nav entry, the page header, and any breadcrumbs all say "Change User Profile".

### 2.59 Bug Fix — BUG-14 — Change User Profile: Loss Calculation Appears Implausibly Small

Live test: simulating a System Administrator user moving to a Sales User profile shows very few losses, which is implausible — System Administrator grants broad access that Sales User does not. Either (a) the diff is computing against the wrong baseline (e.g., comparing user's full effective set against user's full effective set, so PermSets carry over and hide Profile-only losses), (b) the System Administrator profile's implicit-PermSet fan-out is missing rows (ties back to BUG-8), or (c) the comparison key is wrong (e.g., matching on SobjectType but ignoring CRUD-bit differences).

**Fix Required**

- Build a reproducible test fixture: System Administrator user → Sales User profile; expected loss set includes ModifyAllData, ViewAllData, most object-level ViewAll/ModifyAll flags, and a broad swath of field edits. Snapshot the expected losses from the raw CSVs (golden file) and compare programmatically.
- Instrument the diff engine to log, per (Object, CRUD bit), the Before value, the After value, and whether it was classified as Lost / Gained / Unchanged. Surface this log in a debug panel behind a toggle on the Change User Profile view.
- Verify the diff is (`Profile_before_implicit + PermSets → Profile_after_implicit + PermSets`), keeping PermSet assignments fixed, so Profile-only differences actually surface.
- Verify each of the three hypotheses above and fix whichever applies; re-run the fixture until the diff matches the golden file.

**Acceptance Criteria**

- The System-Administrator → Sales-User fixture produces a loss list that includes ModifyAllData, ViewAllData, and ≥90% of the Sales-User-missing Profile-level object/field permissions.
- The debug panel shows per-permission Before/After/Classification rows that add up to the summary counts.
- No Loss or Gain in the summary is unexplained by an underlying row in the debug panel.

### 2.60 UX — UX-51 — Overlap & Redundancy: Subset Relationship — Show Substantive Extras

When a Subset relationship is detected (PermSet A ⊂ PermSet B), the current view tells the admin the relationship exists but not what the superset grants beyond the subset. Admins need to see the substantive extras — the specific objects / fields / system perms / setup-entity grants that are in B but not in A — in order to reason about the impact of assigning B instead of A.

**Fix Required**

- Each Subset row expands to show the extras, grouped: Objects (with CRUD pills), Fields (with Read/Edit flags), System Perms, Setup Entity Access (grouped by type).
- Counts per group render as pill badges on the expand control so the admin can scan without expanding.
- An "Open side-by-side" button routes to the UX-40 / UX-22 compare pane with both PermSets pre-populated.
- Export: CSV of the extras per subset relationship.

**Acceptance Criteria**

- Every Subset row is expandable and the expansion shows the full extras grouped by category with counts.
- An expandable row with zero extras would indicate the relationship is actually a duplicate, not a subset — detect and move it to the Duplicates bucket if encountered.

### 2.61 UX — UX-52 — Near-Duplicate Comparison: Clarify Diff Labeling

The Near-duplicate compare pane uses phrasing like `Account — Edit (only in Training Team)` that is ambiguous: does it mean Support Quality Analyst *lacks* Edit on Account, or something else? Admins need unambiguous labels so they don't misinterpret the diff.

**Fix Required**

- Replace single-column "only in <X>" labeling with a paired layout:
  - Left column header: `<PermSet A name>` — rows under it say `Has: Account — Edit`, `Missing: Contact — Read`, etc.
  - Right column header: `<PermSet B name>` — symmetric rows.
  - Each row shows both sides explicitly; no inference is required.
- Add a legend at the top of the compare pane defining the terms: `Has` means the PermSet grants this permission; `Missing` means it does not; `Shared` means both grant it; `Differs` means the bit pattern differs (e.g., A has Read but not Edit, B has both).
- Apply the same labeling to the Subset extras view (UX-51) and to the UX-37 Change User Profile side-by-side diff.

**Acceptance Criteria**

- A compare pane for any pair of PermSets / Profiles has both names as column headers and every row states the permission's status on each side in unambiguous language.
- A legend defining the terms is visible above the pane.
- "only in X" phrasing no longer appears anywhere in the app.

### 2.62 UX — UX-53 — Dynamic Width: Consume Full Browser Horizontal Real Estate

UX-18 (v2.6) raised the `maxWidth` cap to 1680 px. Live testing on wider displays (1920–2560 px) shows substantial empty margin on either side of the working area. Admins want the app to absorb the full viewport, so tables with many columns (Impact Matrix, Effective Fields, Setup Entity Access, Coverage Report) can breathe without inside-table horizontal scroll. This supersedes UX-18.

**Fix Required**

- Remove the `maxWidth: 1680` on every top-level page container (Admin, Explorer, Scenarios, Migration, Overlap, Prescribe Access). Replace with `width: "100%"` inside a fluid layout, with comfortable but not cap-forced side padding (~24 px baseline, scaling up at ≥2560 px to keep line-length readable only for prose blocks like §7.4 descriptions — never for data tables).
- Left sidebar: fixed width baseline (280–320 px) but allow a splitter so the admin can resize the main panel share.
- Right panel (when expanded): takes up ~30% of main-panel width with a minimum of 420 px; also resizable via a splitter.
- Splitter positions persist per UX-21.
- On very wide viewports (≥2560 px), avoid un-truncated line lengths of > ~130 characters in prose/help text by constraining those blocks only; data tables remain full-width.

**Acceptance Criteria**

- At 1280, 1440, 1920, 2560, and 3840 px viewport widths, the main-panel data tables fill the available horizontal space minus the sidebar and (when expanded) the right panel — no fixed 1680 px cap.
- Splitter-driven widths persist across tab navigation and Admin reloads (until dataset reload clears state per UX-21).
- Help/prose blocks do not exceed ~130 character line lengths even on 3840 px; data tables do.

### 2.63 UX — UX-54 — Developer Uses Salesforce MCP to Build the Embedded Fallback Dataset

The current embedded fallback is a hand-authored synthetic dataset with obvious placeholder names ("Amy Admin", "Sales_Bundle", etc.). The product owner wants the fallback to be seeded from real Salesforce data via the developer's MCP connection at build time, not at runtime — this keeps §3.2's runtime CSV-only model intact while giving the demo/fallback dataset realistic shape, sizes, and edge cases.

**Scope (developer workflow, not runtime behavior)**

- During development, the developer connects to a reference Salesforce org via the available `mcp__salesforce__*` MCP tools (`run_soql_query`, `retrieve_metadata`, etc.) and runs each of the 13 Required Export Queries (Section 5) against it.
- The results are captured, lightly scrubbed for PII (real user emails, names, and Ids replaced with deterministic pseudonyms keyed off the source values so relationships between rows remain intact), and baked into the embedded fallback as a read-only dataset.
- The fallback dataset ships inside the artifact (in a single compressed `.pebundle` blob or equivalent) so runtime behavior remains CSV-only per §3.2 — no MCP calls happen in the user's browser.
- A new `build-fallback.js` script (Node-side, committed to the repo if applicable) documents the MCP-to-fallback pipeline and can be re-run to refresh the fallback from a new Salesforce snapshot.

**Constraints / Safety**

- No real user email addresses, names, or 18-digit Salesforce Ids (other than metadata Ids that are effectively public, e.g., standard object API names) may ship in the fallback. The scrubber replaces each PII value with a deterministic pseudonym the first time it's seen and reuses the pseudonym for subsequent occurrences so join integrity is preserved.
- The "Using embedded fallback" badge on the header (§7.2) stays visible whenever the fallback is in use — users must know they are looking at a demo snapshot, not their own org.
- Fallback size target: ≤ 10 MB compressed to keep initial artifact load reasonable.
- The runtime code path for loading the fallback is unchanged from today — only the bytes differ.

**Acceptance Criteria**

- The embedded fallback, loaded on first artifact load with no user interaction, exercises every tab and every precompute (Impact Matrix, Delete candidates, near-duplicates, subset relationships, orphaned PermSets, migration clusters, Prescribe Access) without edge-case emptiness — i.e., it produces at least one non-empty result per scenario.
- Running a known-string grep for common real user/email patterns (e.g., `@bullhorn.com`, real employee first/last names) against the built artifact returns zero matches.
- A documented `build-fallback` workflow exists and can be re-run against the reference org to refresh the fallback.
- No MCP call is made at runtime (static analysis: grep the bundled JS for `mcp_` / `callMcpTool` / `window.cowork` returns zero matches in the shipped artifact).

### 2.64 Bug Fix — BUG-15 — Profile Detail: Objects AND System Perms Still Missing (Third Re-open)

Third re-open of the Profile detail rendering defect. BUG-5 (v2.5) and BUG-8 (v2.6) both claimed to fix it via the implicit-PermSet join (`profileFanoutIds`), but live testing against the shipped v2.7 build shows the Finance profile still renders:

- Object permissions missing: Finance grants Accounts `Read, Create, Edit, Delete, View All Records` — the Profile detail shows nothing.
- System perms missing: Finance has `PermissionsChatterInternalUser`, `PermissionsManageDashbds`, `PermissionsCustomizeApplication` (and others) set to `true` on the Profile row — the Profile detail shows nothing for these.

**Root Cause Hypotheses (separate investigations required)**

1. **Object perms path**: the implicit-PermSet discovery may be silently failing for the Finance profile specifically. Possible causes: (a) the Finance profile's implicit PS row is not in the current `PermissionSet.csv` export (filter too strict), (b) the `IsOwnedByProfile` column is absent/blank on the real export, (c) the `Parent.ProfileId` fallback in ObjectPermissions.csv is not being populated for these rows. The v2.6 diagnostic strip should be showing green/yellow — check what it says for Finance.

2. **System perms path**: Profile system permissions on Salesforce live primarily as boolean columns on the `Profile` row itself (e.g., `Profile.PermissionsManageDashbds`). The v2.6 fix routed Profile system-perm lookup through the implicit PermSet via `sysPermsByParent`, but Salesforce does NOT always mirror every Profile-level boolean into the implicit PS's SystemPermissions rows. The renderer must ALSO read directly from the Profile row's boolean columns (the same boolean columns surfaced via Query 13 `/` Query 1 depending on the export).

3. **Renderer path**: even if the index contains the data, the Profile detail component may be keying off a property that is populated only for PermSets — e.g., looking up by `parent.Id` where `parent` is the Profile object but the index stores under the implicit PS's Id.

**Fix Required**

- Add a "Profile detail diagnostics" dump, turned on via a debug toggle on the Profile detail page. Dump: `Profile.Id`, discovered `implicitPermSetId` (or `null`), Boolean columns pulled directly off the Profile row, `profileFanoutIds` output, per-sub-section row counts from each index (`objPermsByParent`, `fieldPermsByParent`, `sysPermsByParent`, `tabsByParent`, `setupByParent`) for every fan-out id, and the final rendered row count. Each sub-section's header should render a "0 ← check diagnostics" link if the count is zero, to make the zero state actionable.
- **System perms specifically**: build a `profileBooleansBySystemPermissionKey` map from the Profile SOQL columns (Query 1 returns every `Permissions*` boolean). On Profile detail, the System Perms sub-section merges `sysPermsByParent[fanoutIds]` with the boolean columns directly off the Profile row. Deduplicate by permission key. Source column shows `Profile (direct)` vs `Implicit PS` vs `both` for transparency.
- **Object perms specifically**: if `profileFanoutIds` returns only `[Profile.Id]` (no implicit PS discovered), ALSO attempt the legacy fan-out `ParentId = Profile.Id` path against `objPermsByParent` and `fieldPermsByParent`. Some orgs store Profile perms directly under the Profile Id; do not assume the implicit-PS model applies uniformly.
- Add a fixture test: load a snapshot that includes Finance profile with known Accounts CRUD flags and known Profile-level booleans. Assert the Profile detail renders the Accounts row and every expected system perm. Include this in the dev-time test suite.
- Update the Section 5 SOQL for Query 1 to explicitly return every `Permissions*` boolean column on Profile, and update §8 parsing to ingest every boolean column found (tolerant of missing columns). This is the canonical source for Profile system perms.

**Acceptance Criteria**

- Loading the Finance profile in the detail view renders the Accounts row with CRUD flags `R, C, E, D, VA` and the View All Records indicator; the Objects sub-section count is non-zero.
- The System Perms sub-section lists Chatter Internal User, Create and Customize Dashboards, Customize Application, and every other `Permissions*` boolean that is `true` on the Profile row.
- The debug toggle on the Profile detail page dumps the diagnostic payload described above; a zero-count sub-section header links to the diagnostics.
- A regression test (Finance profile fixture) is added to the dev test suite and passes.

### 2.65 ARCH-1 — v3.0 — Strictly CSV-Only Runtime (Removed GitHub Snapshot Fetch)

**Reason for change:** v2.9 fetched `data/snapshot.json` from `raw.githubusercontent.com` on every boot. This made the artifact dependent on a public-readable URL, conflated "demo snapshot" with "real data" in the user's mind, and created an attractive nuisance for shipping un-scrubbed data via the same channel. The pseudonymized demo data was not useful for real analysis.

**Changes:**

- Remove `GITHUB_SNAPSHOT_OWNER`, `GITHUB_SNAPSHOT_REPO`, `GITHUB_SNAPSHOT_BRANCH`, `GITHUB_SNAPSHOT_PATH`, and `GITHUB_SNAPSHOT_URL` constants from `PermissionExplorer.jsx`.
- Remove `fetchGithubSnapshot()` function and the boot `useEffect` that calls it.
- Remove the `snapshotMeta` React state and every reference to `source === "github"` (data-source badge, AdminTab status pills, file-list status column).
- Delete the offline pipeline from the repo: `data/snapshot.json`, `scripts/bake-snapshot.js`, `scripts/build-fallback.js`, `docs/BAKE.md`, and the entire `mcp-seed/` tree.
- Update `package.json` to drop the `bake` and `verify` scripts; bump version to `3.0.0`.
- Update `.gitignore`: remove `mcp-seed/` rules, add `bundles/` and `*.pebundle` so weekly outputs cannot be committed.

**Acceptance Criteria:**

- A network-panel inspection at boot shows zero outbound requests to any Salesforce, GitHub, or third-party data endpoint. (Babel + React CDN fetches at index.html load are out of scope and remain.)
- Grepping `PermissionExplorer.jsx` for `GITHUB`, `snapshot.json`, `fetchGithubSnapshot`, or `bake-snapshot` returns zero hits except in the historical changelog comment block.
- The repo no longer contains `data/`, `scripts/bake-snapshot.js`, `scripts/build-fallback.js`, `docs/BAKE.md`, or `mcp-seed/`.

### 2.66 ARCH-2 — v3.0 — IndexedDB Pebundle Cache ("save state")

**Reason for change:** Without the GitHub fallback, every browser refresh would otherwise force the user to re-upload 13 CSVs. That is unacceptable for routine use.

**Changes:**

- Add a single-store IndexedDB cache keyed `"current"`. Stored value: `{ cachedAt: ISO_string, schemaVersion: 1, pebundle: Blob }` where `pebundle` is the gzipped JSON of the same payload shape produced by `onExportBundle`.
- Helpers added to `PermissionExplorer.jsx`: `idbOpen()`, `idbReadCache()`, `idbWriteCache({datasets, dismissals})`, `idbClearCache()`. All resolve to safe defaults on failure (null/false) and never throw to the caller. If IDB is unavailable (private browsing, kiosk, quota), boot proceeds with an empty dataset — IDB failure is never fatal.
- Boot flow: on mount, call `idbReadCache()`. On hit with non-empty datasets, hydrate `datasets` + `dismissals`, set `source = "cache"`, and pop the user into the Explorer tab. On miss, set `datasets = EMPTY_DATASETS`, `source = "none"`, force the active tab to Admin.
- Cache writes: `onUpload` debounces 1.5 s after the last upload event in a batch and writes once; `onImportBundle` writes immediately; `onReset` calls `idbClearCache()`; a new `onClearCache` handler clears the cache only without touching in-memory state.
- A new "Clear Cache" button in the Admin top control bar exposes `onClearCache`. Reset still wipes both in-memory and persisted state.
- Header badge: when `source === "cache"`, display `From cache · Nd old` where N is `Math.max(1, Math.round(ageInDays(cachedAt)))`.

**Acceptance Criteria:**

- Upload a single CSV, refresh the page; the dataset re-hydrates from cache without re-upload, header shows `From cache · 0d old`.
- Import a `.pebundle`, refresh the page; the same.
- Click Clear Cache; the in-memory dataset stays loaded but next refresh boots to an empty Admin state.
- Click Reset; both the in-memory dataset and the cache are wiped; next refresh boots to an empty Admin state.
- Open the app in a private/incognito window where IDB is unavailable: the app boots without crashing and shows the empty-state banner.

### 2.67 UX-55 — v3.0 — 14-Day Stale-Cache Banner

**Reason for change:** Permission data drifts. A cache from 30 days ago will produce wrong analyses with full UI confidence. The user needs a non-blocking signal of staleness without forcing a refresh.

**Changes:**

- New constant `CACHE_STALE_DAYS = 14`.
- New helper `ageInDays(isoTs)` returning days-since-timestamp (`Infinity` if unparseable).
- On boot from a stale cache (`ageInDays(cachedAt) > CACHE_STALE_DAYS`), surface a yellow banner: *"Cached dataset is N days old (older than 14-day staleness threshold). Re-upload CSVs or import a fresh weekly .pebundle from your Cowork folder to refresh."*

**Acceptance Criteria:**

- Manually set a cache `cachedAt` to 20 days ago via DevTools, refresh: the banner appears.
- Re-import a fresh `.pebundle`: banner disappears immediately.
- A 13-day-old cache shows no banner (boundary check).

### 2.68 UX-56 — v3.0 — Tab Gating When No Data Is Loaded

**Reason for change:** Empty Explorer / Impact / Prescribe / Redundancy / Migration tabs render confusing zero-state UI. There is no work to be done in those views without data; the user should be steered to Admin.

**Changes:**

- Add helper `datasetsHaveData(d)` that returns true iff any dataset slot has at least one row.
- Compute `hasData = datasetsHaveData(datasets)` at render time.
- The tabs array passed to `<Tabs>` is filtered to `[Admin]` when `!hasData`; the full six-tab list returns when data is loaded.
- A `useEffect` force-pins `tab = "admin"` whenever `!hasData` and the current tab is something else (defends against an in-flight Reset while sitting on Explorer).

**Acceptance Criteria:**

- First load with no cache: only Admin is visible in the tab strip.
- Upload a single CSV with at least one row: full tab set appears immediately.
- Click Reset from any tab: focus snaps back to Admin and the other tabs disappear.

### 2.69 OPS-1 — v3.0 — Weekly Cowork Scheduled Task

**Reason for change:** The user wants a save-state of fresh Salesforce data without putting Salesforce credentials in the browser. The scheduled task lives in Cowork (server-side, with the user's authed Salesforce MCP) and produces a static `.pebundle` for the user to manually import into the artifact.

**Changes:**

- Create scheduled task `weekly-permission-explorer-bundle` via `mcp__scheduled-tasks__create_scheduled_task`. Cron `0 6 * * 1` (Mondays 6 AM local; Cowork adds a small deterministic jitter at dispatch).
- Task verifies the org is `bullhorn` (production) via `mcp__salesforce__get_username` and `mcp__salesforce__list_all_orgs`. If not positively identified, writes `bundles/LAST_RUN_ERROR.txt` and aborts without touching prior outputs.
- Task runs the 13 SOQL queries from §5.1 against the production org via `mcp__salesforce__run_soql_query`, using uniform `Id > '<lastId>' ORDER BY Id LIMIT 2000` cursor pagination. Initial cursor is `'000000000000000'` (15-char zero-pad) because empty-string `Id > ''` fails on multi-condition WHERE clauses on this org. Every SELECT explicitly includes `Id` so the cursor predicate works.
- Task runs a COUNT() preflight per dataset before paginating and bails with `LAST_RUN_ERROR.txt` if the observed count exceeds the dataset's MAX bound (Profile 1000, PermissionSet 5000, PSGroup 1000, User 50000, UserRole 5000, PSA 200000, PSGComponent 10000, ObjectPermissions 100000, FieldPermissions 1000000, TabSetting 100000, SetupEntityAccess 200000, CustomPermission 5000, SystemPermissions_PermSet 5000).
- Task NEVER drops a filter even if results look unexpected. The prior failed run dropped `WHERE PortalType = null` after the first page returned portal rows (the filter was wrong — `PortalType` stores the literal picklist value `'None'`, not SQL NULL — but the agent's response was to drop the filter rather than report 0 results, which is forbidden). If COUNT is 0, write an empty staging file and skip pagination. The corrected v3.0 filter is `WHERE PortalType = 'None'`.
- Task streams each page to `/tmp/permission-explorer-stage/<key>.jsonl` (one JSON row per line) via `jq -c '.records[]' >> ...`. No Python intermediary.
- Once all 13 staging files are populated, task invokes `node scripts/build-pebundle.js --stage /tmp/permission-explorer-stage --out <Cowork-bundles> --source-org bullhorn --app-version 2026-04-v3.0`.
- The build script writes 13 raw CSV files plus a single gzipped `.pebundle` (matching the JSX importer's `format: "pebundle", version: 1, ...` shape) to `/Users/manoj.aggarwal/Documents/Cowork/PermissionExplorer/bundles/`. Atomic rotation: builds in a temp directory under the output dir, then deletes prior `*.csv` / `*.pebundle` / `LAST_RUN_ERROR.txt` and moves new files into place. Non-bundle files (e.g., `notes.md`) are preserved.
- The build script flattens nested SObject relationships (`row.Profile.Name` → `"Profile.Name"`) and strips the Salesforce `attributes` metadata blob from every row.

**Acceptance Criteria:**

- "Run now" once from the Cowork Scheduled panel produces 13 CSVs + 1 `.pebundle` in `/Users/manoj.aggarwal/Documents/Cowork/PermissionExplorer/bundles/`, with row counts matching the SOQL COUNT preflights.
- Open the artifact, click Import Bundle, select the new `.pebundle`; all 13 datasets load with the correct row counts.
- `LAST_RUN_ERROR.txt` is created (and prior bundle is preserved) if the org check fails.
- The `.pebundle` filename is `permission-explorer_<YYYYMMDD-HHMM>.pebundle`.
- The total tool-call budget for a single run stays under 200 calls; a healthy run is roughly 60–90.

### 2.70 OPS-2 — v3.0 — `.gitignore` Hygiene

**Changes:** Drop the now-obsolete `mcp-seed/raw/` and `mcp-seed/scrubbed/` rules. Add `bundles/` and `*.pebundle` so the weekly outputs (which contain real PII) can never be accidentally committed.

**Acceptance Criteria:** After running the weekly task, `git status` shows zero entries from the bundles folder.

### 2.71 DOC-1 — v3.0 — README, Changelog, Index Bootstrap Comments

**Changes:** Rewrite `README.md` to describe the CSV-only + IDB-cache + weekly-pebundle flow; drop all snapshot/bake content. Update the JSX header changelog to v3.0 with a clear "Removed" section. Update the `index.html` bootstrap comment to v3.0 and note that `snapshot.json` no longer exists. Bump `package.json` to `3.0.0` and remove the `bake` / `verify` scripts. Add `requirements_v3_0.md` (this document) as the canonical spec.

**Acceptance Criteria:** `grep -r "v2.9\|2.9.0" .` returns only historical changelog references in code comments. README's stated runtime data flow matches the JSX boot logic exactly.

### 2.72 BUG-16 — Prescribe Access Cannot Grant Permissions the Target User Doesn't Already Have — IMPLEMENTED in v3.0.1

> **Status:** Implemented in v3.0.1 patch release. The user surfaced this trying to prescribe access to the "Transfer Record" system permission for a target user (Azam Malik); the permission did not appear in the picker. Investigation traced the issue to two distinct defects — one code-side, one data-side — that compound to make grantable-but-not-currently-granted permissions invisible. The decision points enumerated below were resolved with the smallest-reasonable-change choice for each (Decision 1=a, Decision 2=a, Decision 3=a, Decision 4=a, Decision 5=a, Decision 6=b, Decision 7=a, Decision 8=N/A, Decision 9 deferred to spec only). This entry captures the original audit and decision points for historical record.

**Defect A — JSX picker filter (code defect).** In `PermissionExplorer.jsx` at the `PrescribeAccessTab` component, the `allSysKeys` memo (currently at line 4054) computes the universe of selectable system-permission keys with this filter:

```
for (const sp of idx.sysPermsByParent.values()) {
  for (const [k, v] of Object.entries(sp.perms || {})) if (v) set.add(k);
  //                                                  ^^^^^^^^ filters to "true on at least one PermSet/Profile"
}
```

A permission whose value is `false` everywhere in the dataset never enters the picker, even if its column is present in the parsed data. This is the wrong semantics for Prescribe Access — the user is selecting permissions they want to *grant* to a target user, so the universe must include every known column regardless of current truth value.

The same component's object picker (line 4043, `allObjects`) and field picker (line 4049, `allFields`) do **not** have this filter — they iterate `idx.objPermsByParent`/`idx.fieldPermsByParent` and add every `SobjectType`/`Field` they see, regardless of grant state. So those pickers are correctly broad. Defect A is specific to the system-permission picker.

**Defect B — SOQL completeness gap (data defect).** The downstream consequence of Defect A is masked by a separate problem in §5.1 SOQL: even if the JSX picker filter is removed, a permission whose column is *absent* from the exported CSV cannot appear. Salesforce's `PermissionSet` object has 80+ `Permissions*` boolean columns; current Query 13 enumerates only 12 (`PermissionsModifyAllData`, `PermissionsViewAllData`, `PermissionsManageUsers`, `PermissionsAuthorApex`, `PermissionsCustomizeApplication`, `PermissionsManageCustomPermissions`, `PermissionsApiEnabled`, `PermissionsBulkApiHardDelete`, `PermissionsDataExport`, `PermissionsViewSetup`, `PermissionsManageRoles`, `PermissionsRunReports`). Query 1 (Profile) enumerates only 4 (`PermissionsModifyAllData`, `PermissionsViewAllData`, `PermissionsApiEnabled`, `PermissionsAuthorApex`) — despite §2.64 BUG-15 mandating that Query 1 return *every* `Permissions*` boolean column on Profile. That mandate was documented but never applied to §5.1's canonical SOQL.

For the Transfer Record case specifically, the relevant Salesforce API field is `PermissionsTransferAnyEntity` (with legacy variants `PermissionsTransferAnyLead` and `PermissionsTransferAnyCase`). None of those appear in the current Query 13 SELECT, so they're not in `SystemPermissions_PermSet.csv`, so the artifact has no way to know the permission exists.

**Defect C — Behavior cross-check (verified absent elsewhere).** The user asked "where else is this occurring?" Audit of every permission-picker site in the JSX:

| Scenario | Picker source | Status |
|---|---|---|
| Prescribe Access — system-perm picker | `Object.entries(sp.perms).filter([k,v] => v)` | **Buggy (Defect A)** |
| Prescribe Access — object picker | Every `SobjectType` in any `ObjectPermissions` row | Correct |
| Prescribe Access — field picker | Every `Field` in any `FieldPermissions` row | Correct |
| Modify Profile / Change User Profile (UX-35–37) | Profile-level picker only; no per-permission picker | N/A |
| Compare Profiles (Migration UX-42) | Profile-level picker; diff uses union of both sides' perms | Correct |
| Cluster Inspection (Migration UX-43) | PermSet-level picker; diff uses union | Correct |
| Reconcile PermSets (UX-22) | PermSet-level picker; analysis uses union | Correct |
| Remove PermSet from User (UX-14) | PermSet-level picker | N/A |
| Delete PermSet Entirely (UX-15) | PermSet-level picker | N/A |
| Revoke Field from PermSet (UX-17) | Object/Field pickers correctly filter to what the PermSet *grants* — semantically correct because you can only revoke what's granted | Correct by design |
| User detail provenance (UX-8) | Enumerates all sources of all currently-effective grants | Correct |
| Field detail / Object detail "Granted By" (UX-11, BUG-11) | Enumerates union of granting sources | Correct |

So Defect A is confined to one site. The audit is part of this entry's evidence.

**Decision points (must be resolved explicitly before implementation; no defaults assumed):**

1. **Scope of the JSX picker fix.** Is the intended behavior to:
   - **(a)** Show every column key from `Object.keys(sp.perms)` regardless of value — the picker becomes "all known permissions in the dataset"?
   - **(b)** Show all known permissions AND visually distinguish which ones currently have zero coverage in the org (e.g., a "no PermSet grants this yet" badge)?
   - **(c)** Show all known permissions AND filter to those *not* already granted to the target user (i.e., the picker is the gap, not the universe)?
   - **(d)** Some other behavior?

2. **What permission columns should Query 13 enumerate?** The set is large and the choice has maintenance implications:
   - **(a)** Add only `PermissionsTransferAnyEntity, PermissionsTransferAnyLead, PermissionsTransferAnyCase` to address the immediate Transfer Record case. Stop there.
   - **(b)** Enumerate a broader curated list of "commonly grantable" permissions (e.g., add `PermissionsEditTask`, `PermissionsEditEvent`, `PermissionsImportLeads`, `PermissionsManageContentPermissions`, `PermissionsSendSitRequests`, `PermissionsResetPasswords`, etc. — to be specified). Decide which.
   - **(c)** Enumerate every documented `Permissions*` field on `PermissionSet` (~80 columns; full list to be sourced from Salesforce's Object Reference for the `PermissionSet` object). Highest maintenance, broadest coverage.
   - **(d)** Use SOQL `FIELDS(ALL)` to fetch all standard fields automatically. **NB**: `FIELDS(ALL)` requires `LIMIT ≤ 200` per Salesforce — for 689 PermSets this means at least 4 paginated calls, and the cursor pagination strategy in §2.69 OPS-1 needs to be re-validated against `FIELDS(ALL)` semantics. Risk: SF rejects the query or returns inconsistent column sets across pages.
   - **(e)** Use a Tooling API metadata query (e.g., `SELECT QualifiedApiName FROM EntityParticle WHERE EntityDefinition.QualifiedApiName = 'PermissionSet' AND QualifiedApiName LIKE 'Permissions%'`) to discover columns dynamically, then issue Query 13 with the discovered list. Adds a new metadata fetch step to the scheduled task.

3. **What permission columns should Query 1 (Profile) enumerate?** §2.64 BUG-15 mandated "every `Permissions*` boolean on Profile." Decision options mirror Decision 2:
   - **(a)** Apply BUG-15 literally — enumerate every documented `Permissions*` field on `Profile` (~80 columns).
   - **(b)** Match Query 13's column set exactly so the System Perms detail view shows the same columns for Profiles and PermSets.
   - **(c)** Curated subset — to be specified.
   - **(d)** `FIELDS(ALL)` — same caveats as Decision 2(d).
   - **(e)** Tooling API metadata discovery — same as Decision 2(e).

4. **Friendly-name mapping.** The Salesforce API field name is `PermissionsTransferAnyEntity` but the Setup UI labels it "Transfer Record." The artifact currently strips the `Permissions` prefix and shows `TransferAnyEntity` in the picker. Decision:
   - **(a)** Keep API names; the user adapts. Lowest effort.
   - **(b)** Hand-curate a friendly-name mapping (`PermissionsTransferAnyEntity → "Transfer Record"`, etc.). Document the mapping where (code constant, JSON file in repo, requirements doc)?
   - **(c)** Programmatically derive labels via Tooling API on `FieldDefinition` / `EntityParticle` for each column. Requires a metadata fetch in the Cowork scheduled task and a new column on the SystemPermissions_PermSet CSV (e.g., `PermissionLabel`).

5. **Bundle refresh sequencing.** Once Query 13 (and possibly Query 1) is expanded, the existing pebundle becomes stale. Decision:
   - **(a)** Manual one-time re-export — user runs the new SOQL in Workbench, uploads the new CSVs (matches the path used to fix UserRole/SetupEntityAccess earlier in this session).
   - **(b)** Wait for the next weekly Cowork scheduled task run after the prompt is updated.
   - **(c)** Trigger the Cowork task immediately after the SOQL update.

6. **Versioning.** Both this defect and UX-57 (§2.73) are tagged "Planned for v3.1." Decision:
   - **(a)** Bundle BUG-16 + DATA-1 + UX-57 in a single v3.1 release.
   - **(b)** Ship BUG-16 + DATA-1 in a v3.0.1 patch (no API changes; just code + data fixes), keep UX-57 for v3.1 proper.
   - **(c)** Sequence in a different order.

7. **Validation acceptance test.** Concrete test case:
   - **(a)** "Open Prescribe Access, pick user Azam Malik, click + System Perm, type 'transfer' — `TransferAnyEntity` (or its friendly label per Decision 4) appears in the typeahead and can be selected." Use this as the canonical regression test.
   - **(b)** Different test case — to be specified.

8. **Picker visual indicators (depends on Decision 1).** If Decision 1 lands on (b) or (c), specify:
   - The exact text/badge for "no PermSet currently grants this" rows.
   - Whether to sort: granted-anywhere first, ungranted last; or alphabetical.
   - Whether to show row counts ("Granted by 4 PermSets" vs "Not granted anywhere").

9. **Tolerant-parsing edge cases.** When a user uploads a CSV with new columns (after the SOQL expansion), the existing tolerant-parser code path (lines 568–578) merges them into `allSysCols`. Verify behavior in two scenarios:
   - **(a)** A bundle exported under v3.0 (with the 12-column Query 13) is imported into a v3.1 build expecting more columns. The 68+ missing columns should default to `false` everywhere — no crash, no false-positive grants.
   - **(b)** A bundle exported under v3.1 (with expanded columns) is imported into a v3.0 build that only knows the 12 columns. The extra columns should be loaded into `extraCols` and surfaced in the detail view but not crash the Prescribe Access picker (since v3.0's picker code still has Defect A and would just ignore them).

**Acceptance Criteria (contingent on the above decisions):**

- The system-permission picker in Prescribe Access surfaces every permission column known to the data, regardless of the target user's current grants. Specific behaviors per Decision 1.
- The exported `SystemPermissions_PermSet.csv` includes every column listed under Decision 2; the exported `Profile.csv` includes every column listed under Decision 3.
- The validation test from Decision 7 passes against a fresh bundle.
- A v3.0 → v3.1 in-place upgrade with stale cached bundle behaves per Decision 9(a) — no crash, no false grants.

**Out of scope for BUG-16 / DATA-1:**

- Live Salesforce permission metadata fetching at runtime in the artifact. The artifact remains strictly CSV-only at runtime per ARCH-1.
- A Salesforce-version-aware permission catalog (different orgs on different SF API versions may have different `Permissions*` columns). Whatever the user's CSV contains is the source of truth for that bundle.
- Editing managed-package permissions on managed-package PermSets — out of reach per UX-57.
- Auto-generating CRUD recommendations from permission grants. Prescribe Access stays focused on the user's explicit desired-access input.

---

### 2.73 UX-57 — Filter Actionable Analyses to Customer-Owned PermSets Only — DEFERRED, PLANNED FOR v3.1

> **Status:** Deferred — not implemented in v3.0. Documented here so the design and acceptance criteria are nailed down before v3.1 work begins. No code, SOQL, or scheduled-task changes accompany this entry.

**Reason for change:** The Overlap & Redundancy, Migration, Delete-PermSet-Entirely, Reconcile-PermSets, and Remove-PermSet-from-User views currently treat all PermSets uniformly. In practice, only the customer's own custom PermSets are actionable — managed-package PermSets (Salesforce CPQ / SBQQ, Cvent, Steelbrick, Zoom, etc.) are owned by the installed package and cannot be deleted, merged, or modified by the customer's admin. Surfacing them as duplicate, subset, or merge candidates produces noise and false-positive workload. Salesforce-standard PermSets (`IsCustom = false`) are similarly unmodifiable — they ship with the platform.

The schema field that distinguishes these is `PermissionSet.NamespacePrefix`:

| `NamespacePrefix` | `IsCustom` | Category | Actionable? |
|---|---|---|---|
| null / empty | false | Salesforce standard | No — can only assign/revoke |
| null / empty | true | **Customer-owned custom** | **Yes — primary target of consolidation work** |
| `SBQQ`, `Cvent`, `tspa`, etc. | true | Managed-package | No — owned by the package |

The customer-owned actionable set is `NamespacePrefix IS NULL AND IsCustom = true AND IsOwnedByProfile = false`.

**Changes (deferred to v3.1):**

1. **SOQL — Query 2.** Add `NamespacePrefix` to the SELECT. New form: `SELECT Id, Name, Label, Description, IsCustom, Type, IsOwnedByProfile, NamespacePrefix FROM PermissionSet WHERE IsOwnedByProfile = false ORDER BY Label`. Update in three places: `PermissionExplorer.jsx` SOQL constants, requirements §5.1 Query 2, and the `weekly-permission-explorer-bundle` scheduled task prompt. The CSV parser is already tolerant of new columns (UX-44/45 + Query 13 spec) so older bundles without `NamespacePrefix` continue to load with the column treated as null.

2. **Index builder.** Compute a derived per-PermSet `IsManaged` flag at load time: `IsManaged = !!(row.NamespacePrefix && row.NamespacePrefix.trim())`. Surface alongside `IsOwnedByProfile` in `permSetIndex`.

3. **Default filter — actionable scenarios.** Apply `IsManaged === false && IsCustom === true && IsOwnedByProfile === false` as the default candidate set in:
   - Overlap & Redundancy → Duplicate PermSets, Subset PermSets, Orphaned PermSets, Near-Duplicate PermSets (UX-39 / UX-40 / UX-51 / UX-52)
   - Migration → similarity clustering source candidates and three-way decomposition (§6.4)
   - Delete PermSet Entirely → the `<PermSet>` typeahead candidate list (UX-15 / UX-32 / UX-33)
   - Reconcile / Combine PermSets workflow (UX-22)
   - Remove PermSet from User → Impact Matrix `<PermSet>` filter typeahead (UX-14 / UX-27)

4. **Keep managed-package and standard PermSets visible** in informational/exploratory scenarios:
   - Prescribe Access ranking (UX-47) — assigning a managed-package PermSet is often legitimately the answer; do not hide them from recommendations
   - User detail provenance (UX-8) — must show every source of every effective permission, including managed
   - PermSet Group drill-down (UX-9) — managed-package PermSets routinely appear inside customer-owned Groups
   - Field detail / Object detail "Granted By" enumerations (UX-11, BUG-11)
   - Explorer left-sidebar PermSet entry-point list (default visible; the actionable filter is per-scenario, not global)

5. **Toggle: "Include managed-package PermSets."** Each affected scenario gets a checkbox, default OFF. When ON, the candidate set expands to include managed-package and Salesforce-standard PermSets, and recommendations clearly flag those as non-actionable ("Managed by SBQQ — read-only").

6. **New "Managed by" column** in every PermSet table (Overlap, Migration, Delete, Reconcile, Explorer's PermSet list, AdminTab manifest):
   - Customer-owned: render `—` (em dash) or "Custom"
   - Salesforce-standard: render "Standard"
   - Managed-package: render the namespace prefix (`SBQQ`, `Cvent`, etc.)
   This makes the actionability obvious even when the toggle is OFF and the user is browsing all PermSets.

7. **Coverage report (UX-26).** Add a per-category summary at the top: "X customer-owned PermSets, Y managed-package, Z Salesforce-standard, W profile-owned." Report N "actionable empty" PermSets separately from total empty, since empty-but-managed is not a finding.

**Acceptance Criteria:**

- A re-exported Query 2 includes a `NamespacePrefix` column populated with the package namespace for managed PermSets and null for customer-owned + standard.
- Loading a Bullhorn bundle with the v3.1 logic, the Overlap & Redundancy → Duplicate PermSets block does not show CPQ, Cvent, or any other managed-package PermSet by default.
- Toggling "Include managed-package PermSets" surfaces them with a "Managed by SBQQ" pill (or similar) and a "read-only" badge on the action buttons.
- Migration similarity clustering excludes managed-package PermSets from cluster source candidates by default; they may still appear as targets if a user is assigned to one (the migration view explains this).
- The Delete PermSet Entirely typeahead does not list managed-package PermSets by default.
- Prescribe Access continues to recommend managed-package PermSets when they're the least-privilege answer, with a "Managed by X" annotation on the recommendation row.
- The Coverage Report summary distinguishes `customer-owned` from `managed` from `standard` from `profile-owned` PermSet counts.
- A bundle without `NamespacePrefix` (e.g. older `.pebundle` from v3.0) loads cleanly: the `IsManaged` derivation defaults all PermSets to non-managed, the Admin tab shows a yellow Informational notice prompting a re-export, and no scenario crashes.

**Migration plan from v3.0 → v3.1:**

- Pre-cutover: customer re-exports Query 2 with `NamespacePrefix` and uploads the new CSV (or runs the weekly task once after the SOQL update lands). The new bundle has `NamespacePrefix` populated.
- v3.1 release ships with the index builder + filter logic + UI changes. Boot from a v3.0-cached IDB pebundle missing `NamespacePrefix` triggers the Informational re-export prompt; user clicks Reset (or re-uploads the new bundle) to fix.

**Out of scope for UX-57:**

- Editing managed-package PermSets — there's no API for that even if the artifact wanted to attempt it.
- Auto-detecting which managed packages are installed and presenting a "managed packages summary" view. Could be a future enhancement (UX-58?), but not required to deliver UX-57.
- Changing the model for `IsOwnedByProfile = true` (implicit profile-owned PermSets) — those are already excluded from analysis candidates by §6.4 and need no further treatment.

---

## 3. Technical Architecture

### 3.1 Runtime

Claude Artifact (React JSX, single file with one `import React from "react"` and one default export) served from GitHub Pages. `index.html` loads React 18 + Babel-standalone from CDN, fetches `PermissionExplorer.jsx` as text, strips the lone import + export-default lines, Babel-transforms the JSX, and `eval`s the result. There is no build step, no server, no authentication, and no runtime API calls to Salesforce or any other endpoint. The artifact uses Claude inside the user's Cowork session (the offline scheduled task) for data refresh; the in-browser experience is purely a static JSX app rendered locally.

### 3.2 Data Source — CSV Upload or Pebundle Import (No Live Salesforce)

There is no live Salesforce connection at runtime. Attempting a direct Salesforce connection was considered and rejected because OAuth tokens cannot be obtained in the target environment (sandboxed artifact iframe + no Connected App setup path available to the user), and because keeping Salesforce credentials out of the browser is itself a hard requirement.

Data enters the app exclusively through one of two paths, both initiated from the Admin tab:

1. **Per-file CSV upload.** Admin clicks "Upload CSV" on each of the 13 dataset cards and selects the matching file from disk. CSVs are produced by running the 13 SOQL queries (§5.1) against any Salesforce environment using the admin's tool of choice — Workbench, Data Loader, the SOQL query editor in Setup, SFDX / Salesforce CLI, or any tool that emits CSV.
2. **`.pebundle` import.** Admin clicks "Import Bundle" and selects a `.pebundle` file. Pebundles are gzipped JSON containing the parsed contents of all 13 datasets in a single artifact. The canonical source of pebundles is the weekly Cowork scheduled task (§2.69 OPS-1) which writes a fresh bundle to `/Users/manoj.aggarwal/Documents/Cowork/PermissionExplorer/bundles/` every Monday morning. Pebundles can also be hand-shared via email, drive, etc. — the format is portable.

After either path completes, the parsed dataset is silently written to IndexedDB so subsequent browser sessions hydrate from cache without re-uploading (see §3.3).

### 3.3 Data Loading Strategy — IndexedDB Cache + Bundle Export/Import + Weekly Refresh

**On startup:** The artifact's boot `useEffect` calls `idbReadCache()`. If a non-empty cache exists, it hydrates `datasets` and `dismissals` from the cached gzipped pebundle and pops the user into the Explorer tab. If the cache is older than `CACHE_STALE_DAYS` (14), a non-blocking yellow staleness banner appears prompting a refresh. If no cache exists or read fails, the app boots into the Admin tab with all other tabs hidden until at least one dataset has rows.

**On CSV upload:** Admin uploads any of the 13 CSVs via the Admin tab. Each upload is parsed, validated against `required` columns, and cross-referenced for join integrity. The parsed rows replace that slot's contents in the in-memory `datasets`. `onUpload` debounces 1.5 s after the last upload event in a batch (so a 13-file drag-drop triggers exactly one cache write, not 13).

**On `.pebundle` import:** `onImportBundle` validates `format === "pebundle"` and `version === 1`, replaces all 13 dataset slots from `obj.datasets[*].rows`, restores `dismissals`, and immediately writes the cache.

**Bundle export:** "Export Bundle" produces a `.pebundle` of the current in-memory state for sharing. Same format the importer accepts. Used to hand a snapshot to a teammate, attach to an audit ticket, or back up before a destructive Reset.

**Reset vs Clear Cache:** Two destructive actions in Admin.
- **Reset** wipes both the in-memory dataset and the IDB cache; the next refresh boots empty.
- **Clear Cache** wipes only the IDB persistence; the current view stays loaded for this session, but the next refresh boots empty.

**Why IndexedDB:** `localStorage` is capped at 5 MB and is sometimes blocked in sandboxed iframes. IndexedDB has no practical size cap for our payload (~10–30 MB gzipped), is universally supported, and survives tab closes. The cache record carries a `schemaVersion: 1` field; bumping `CACHE_SCHEMA_VERSION` in a future release causes `idbReadCache()` to return null on mismatched records, gracefully forcing the user back through CSV upload or bundle import. IDB failures (private browsing, kiosk, quota) are non-fatal — the helpers resolve to safe defaults (null/false) and the app degrades to "no cache, empty state."

**Why the weekly Cowork task:** Refreshing 13 SOQL exports manually is friction. The Cowork scheduled task automates the export → CSV → pebundle pipeline once a week, drops the result in the user's Cowork folder, and the user simply imports the latest. Salesforce credentials are exercised only inside the scheduled task's Cowork session — never in the browser.

All data is held in memory after upload or import. Every analysis operation is instant in-memory computation.

**Required Files (13 total — one per Required Export Query in Section 5.1):**

| File | Source Query | Required? |
|---|---|---|
| Profile.csv | Query 1 — Profiles | Yes |
| PermissionSet.csv | Query 2 — Permission Sets | Yes |
| PermissionSetGroup.csv | Query 3 — PermSet Groups | Yes |
| User.csv | Query 4 — Standard Users | Yes |
| UserRole.csv | Query 5 — User Roles | Yes |
| PermissionSetAssignment.csv | Query 6 — PermSet Assignments (filtered) | Yes |
| PermissionSetGroupComponent.csv | Query 7 — Group Members | Yes |
| ObjectPermissions.csv | Query 8 — Object Permissions | Yes |
| FieldPermissions.csv | Query 9 — Field Permissions | Yes |
| PermissionSetTabSetting.csv | Query 10 — Tab Settings | Yes |
| SetupEntityAccess.csv | Query 11 — Apex/VF/Custom/App | Yes |
| CustomPermission.csv | Query 12 — Custom Permissions | Yes |
| SystemPermissions_PermSet.csv | Query 13 — System Permissions | Yes |

Muting status is derived from Query 2's `Type` field (no separate Muting file required).

### 3.4 Actual Org Row Counts (Reference)

| Dataset | Actual Rows | Notes |
|---|---|---|
| Profiles | 68 | |
| Permission Sets | 750 | |
| PermSet Groups | 72 | |
| PermSet Group Components | 707 | |
| Active Standard Users | 1,036 | IsActive=true, UserType=Standard |
| User Roles | 162 | |
| PermSet Assignments (filtered) | 20,481 | Unfiltered is 2,010,598 — do not use |
| Object Permissions | 33,330 | |
| Field Permissions | 317,936 | Largest file — ~100MB parsed |
| Setup Entity Access | 82,144 | Apex, VF, Custom Perms, Apps |
| Tab Settings | 15,955 | PermissionSetTabSetting |
| Custom Permissions | ~50 | Definitions only |
| System Permissions on PermSets | 750 | One row per PermSet |
| **TOTAL** | **~473,500 rows** | **~150–250 MB in memory after parsing** |

The earlier "~100–180 MB" estimate understated peak memory; FieldPermissions alone consumes 80–150 MB in Chrome's V8 heap, and index Maps built on top of it add meaningful overhead.

---

## 4. UI Style Reference — Salesforce Advanced Approvals Map

The Permission Explorer must follow the same dark-themed visual design established in the Salesforce Advanced Approvals Map artifact. That artifact's JSX source is provided as the style reference. The developer must replicate the design system — not copy the business logic — when building the Permission Explorer UI.

### 4.1 Design Tokens

| Token | Hex Value | Used For |
|---|---|---|
| bg | #0a0e1a | Page / app background |
| bgAlt | #0f1526 | Alternate panel background |
| card | #151c2e | Card and panel backgrounds |
| cardHover | #1a2338 | Hovered card state |
| border | #1e2a42 | Default borders |
| borderActive | #4f8bff | Focused / expanded / selected borders |
| text | #e8ecf4 | Primary body text |
| textMuted | #8896b0 | Secondary / helper text |
| textDim | #5a6a86 | Placeholder / tertiary text |
| accent | #4f8bff | Primary accent, CTAs, links |
| accentLight | #7cacff | Lighter accent for field names |
| accentBg | rgba(79,139,255,0.08) | Accent-tinted backgrounds |
| green | #34d399 | Active / success / granted |
| greenBg | rgba(52,211,153,0.08) | Green-tinted backgrounds |
| greenBorder | rgba(52,211,153,0.2) | Green borders |
| red | #f87171 | Triggered / error / revoked |
| redBg | rgba(248,113,113,0.08) | Red-tinted backgrounds |
| yellow | #fbbf24 | Operators / conditions / warnings |
| purple | #c084fc | Objects / permission sets / groups |
| cyan | #22d3ee | Users / approvers / field access |
| orange | #fb923c | Variables / highlights / caution |
| glow | 0 0 40px rgba(79,139,255,0.06) | Card box-shadow |

### 4.2 Typography

- Primary font: `'Geist', 'SF Pro Display', system-ui, -apple-system, sans-serif`
- Monospace / code font: `'JetBrains Mono', 'SF Mono', monospace` — used for field names, IDs, SOQL queries, and permission keys
- Import JetBrains Mono from Google Fonts via `@import` in the style block

### 4.3 Layout Patterns

The following UI patterns from the Approvals Map must be applied consistently in the Permission Explorer:

**Stat Cards** — Summary metric cards with a colored top accent bar, large monospace number, and uppercase label.

**Expandable Row Cards** — Cards with a clickable header row that expands to show detail content. Border changes to `borderActive` when expanded. Chevron rotates on expand.

**Badge / Pill Labels** — Inline pills with a colored border, matching tinted background, and small bold text. Border and text color come from the same token; background is the token's rgba variant.

**Tab Navigation Bar** — Horizontal pill-group nav bar on a card background. Active tab has a solid accent background and white text; inactive tabs are transparent with dimmed text.

**Data Tables** — Full-width tables rendered on the dark theme: card background, `border` color dividers, header row using `bgAlt` with uppercase letter-spaced labels, alternating row tint using `cardHover` at low opacity. Do not use the light-table treatment; it breaks the dark theme.

**Code / Query Blocks** — Dark background (#060b16), green monospace text, rounded corners, 1px border, max-height with scroll. Copy button positioned absolutely in the top-right.

**Scrollbar Styling** — Custom webkit scrollbars: 6px width/height, transparent track, border-colored thumb, accent-colored on hover.

**Details / Summary Expand Pattern** — Native HTML `<details>`/`<summary>` elements styled to hide the default marker.

> The Approvals Map JSX source is provided as the reference implementation. Use it for component structure, spacing values, and interaction patterns. Do not copy Approvals-specific business logic.

---

## 5. SOQL Query Reference

All queries in this section are displayed in the Admin tab with copy buttons. They do not execute inside the app — the app only receives the exported CSV files. All queries must be run comment-free (SOQL has no comment syntax). For large tables (FieldPermissions, SetupEntityAccess, ObjectPermissions) the export tool must handle pagination automatically or the admin must export in batches.

> SOQL has no comment syntax. Never include `--` or `/* */` comments in any query.

### 5.1 Required Export Queries

These 13 queries produce the CSV files the app needs to function. Each query maps 1:1 to a file upload slot in the Admin tab. They are shown in the order the admin should run them.

**Query 1 — Profiles** → `Profile.csv`

Updated in v3.0.1 to include `PermissionsTransferAnyEntity`, `PermissionsTransferAnyLead`, `PermissionsTransferAnyCase` so the Transfer Record permission and its legacy variants are present in the dataset and selectable in the Prescribe Access picker (see §2.72 BUG-16). The full BUG-15 mandate ("every `Permissions*` boolean on Profile") remains a partially-applied target — additional columns can be added incrementally as needs arise without breaking older bundles, since the parser is column-tolerant.

```sql
SELECT Id, Name, UserType, Description, PermissionsModifyAllData, PermissionsViewAllData, PermissionsApiEnabled, PermissionsAuthorApex, PermissionsTransferAnyEntity, PermissionsTransferAnyLead, PermissionsTransferAnyCase FROM Profile ORDER BY Name
```

**Query 2 — Permission Sets** → `PermissionSet.csv`

Excludes profile-owned permission sets. `Type` field is used to identify Muting PermSets downstream — no separate Muting query needed.

```
SELECT Id, Name, Label, Description, IsCustom, Type, IsOwnedByProfile FROM PermissionSet WHERE IsOwnedByProfile = false ORDER BY Label
```

**Query 3 — Permission Set Groups** → `PermissionSetGroup.csv`

Note: no Name field exists on this object; use DeveloperName and MasterLabel.

```
SELECT Id, DeveloperName, MasterLabel, Description FROM PermissionSetGroup ORDER BY MasterLabel
```

**Query 4 — Standard Users** → `User.csv`

Filters to active standard users only. Excludes integration users, guest users, and inactive accounts.

```
SELECT Id, Name, Email, Profile.Name, ProfileId, UserRoleId, LastLoginDate FROM User WHERE UserType = 'Standard' AND IsActive = true ORDER BY Name
```

**Query 5 — User Roles** → `UserRole.csv`

Filters to internal roles only. `PortalType = 'None'` is the literal picklist value Salesforce stores for internal (non-portal) roles. **Do not use `PortalType = null`** — that returns zero rows in production orgs because the field is always populated with one of the picklist values (`None`, `Partner`, `CustomerPortal`, etc.), never SQL NULL. Excluding rows where `PortalType` is `Partner` or `CustomerPortal` keeps the internal hierarchy clean of partner-portal user containers that are not relevant to the permission-modeling use cases. See Section 2.14 (UX-12). Historical note: the `= null` form shipped in v2.5–v2.9 and produced empty Roles tabs; v3.0 corrects this.

```sql
SELECT Id, Name, DeveloperName, ParentRoleId, PortalType FROM UserRole WHERE PortalType = 'None' ORDER BY Name
```

If a previously-exported CSV still contains portal rows, the app filters them defensively at load time and raises a yellow warning on the Admin tab.

**Query 6 — Permission Set Assignments** → `PermissionSetAssignment.csv`

CRITICAL: must filter to active standard users. Unfiltered row count is 2,010,598 and will cause export tools to time out.

```
SELECT PermissionSet.Id, PermissionSet.Name, PermissionSet.Label, PermissionSet.IsOwnedByProfile, PermissionSet.Type, PermissionSetGroupId, AssigneeId FROM PermissionSetAssignment WHERE Assignee.IsActive = true AND Assignee.UserType = 'Standard' ORDER BY AssigneeId
```

**Query 7 — Permission Set Group Members** → `PermissionSetGroupComponent.csv`

Maps which PermSets belong to which PermSet Groups, including Muting PermSets.

```
SELECT PermissionSetId, PermissionSet.Name, PermissionSetGroupId, PermissionSetGroup.MasterLabel FROM PermissionSetGroupComponent ORDER BY PermissionSetGroup.MasterLabel
```

**Query 8 — Object Permissions** → `ObjectPermissions.csv`

~33k rows. Covers CRUD and View All / Modify All for every object across all profiles and PermSets.

```
SELECT SobjectType, PermissionsCreate, PermissionsRead, PermissionsEdit, PermissionsDelete, PermissionsViewAllRecords, PermissionsModifyAllRecords, ParentId, Parent.Name, Parent.IsOwnedByProfile FROM ObjectPermissions ORDER BY SobjectType
```

**Query 9 — Field Permissions** → `FieldPermissions.csv`

~318k rows, largest file (~100MB). Export tool must support pagination. Some tools require batching by SobjectType.

```
SELECT Field, SobjectType, PermissionsRead, PermissionsEdit, ParentId, Parent.Name, Parent.IsOwnedByProfile FROM FieldPermissions ORDER BY SobjectType, Field
```

**Query 10 — Tab Settings** → `PermissionSetTabSetting.csv`

```
SELECT Name, Visibility, ParentId, Parent.Name FROM PermissionSetTabSetting ORDER BY Parent.Name, Name
```

**Query 11 — Setup Entity Access (Apex, VF, Custom Permissions, Apps)** → `SetupEntityAccess.csv`

~82k rows. Covers Apex class access, Visualforce page access, custom permission grants, and app visibility. Run as a single export or in four separate exports and concatenate.

```
SELECT SetupEntityId, SetupEntityType, ParentId, Parent.Name FROM SetupEntityAccess WHERE SetupEntityType IN ('ApexClass','ApexPage','CustomPermission','TabSet') ORDER BY Parent.Name, SetupEntityType
```

**Query 12 — Custom Permissions** → `CustomPermission.csv`

Definition records only, not the grants (those are in SetupEntityAccess).

```
SELECT Id, DeveloperName, MasterLabel FROM CustomPermission ORDER BY MasterLabel
```

**Query 13 — System Permissions on Permission Sets** → `SystemPermissions_PermSet.csv`

Captures the key administrative permission flags on each PermSet. This list is **committed as hardcoded** because the target org's available Permissions* fields have been verified. The parser MUST tolerate missing columns in the uploaded CSV (see note below) so the same app continues to work if Salesforce adds/removes fields in future releases or if a different org's CSV schema differs.

Updated in v3.0.1 to include `PermissionsTransferAnyEntity`, `PermissionsTransferAnyLead`, `PermissionsTransferAnyCase`. See §2.72 BUG-16. Additional `Permissions*` columns can be added incrementally; the parser tolerates new columns without code changes.

```sql
SELECT Id, Name, Label, PermissionsModifyAllData, PermissionsViewAllData, PermissionsManageUsers, PermissionsAuthorApex, PermissionsCustomizeApplication, PermissionsManageCustomPermissions, PermissionsApiEnabled, PermissionsBulkApiHardDelete, PermissionsDataExport, PermissionsViewSetup, PermissionsManageRoles, PermissionsRunReports, PermissionsTransferAnyEntity, PermissionsTransferAnyLead, PermissionsTransferAnyCase FROM PermissionSet WHERE IsOwnedByProfile = false ORDER BY Label
```

Fields that are NOT available on `PermissionSet` in the target org and have been removed from the query: `PermissionsManageProfiles`, `PermissionsManagePermissionSets`, `PermissionsCreateCustomizeReports`, `PermissionsEditReports`, `PermissionsViewAllDashboards`.

**CSV override / tolerant parsing:**

- The parser must treat every `Permissions*` column as optional. Missing columns default to `false` for all rows.
- Extra `Permissions*` columns present in the CSV but not in the app's known set must still be loaded and surfaced in the System Permissions explorer view. This allows the CSV to drive forward-compatibility without a code change.
- Upload validation surfaces a yellow (non-blocking) warning listing any columns present in the hardcoded expected set that are missing from the uploaded CSV.

---

## 6. Use Cases & Feature Specifications

### 6.1 Multi-Directional Exploration

The UI must support exploration starting from any of the following entry points. Selecting any item navigates into a detail view and enables further drill-down.

| Start From | Primary Key Used | Fans Out To |
|---|---|---|
| User | UserId → PermissionSetAssignment | Profile + all PermSet permissions |
| Profile | Profile.Id as ParentId | ObjectPermissions, FieldPermissions, System Perms |
| Permission Set | PermissionSet.Id as ParentId | Same as Profile |
| PermSet Group | PermSetGroupComponent → member PermSet Ids | Union of all member PermSet permissions |
| Object | SobjectType across all ObjectPermissions | All profiles/permsets granting access, drill to fields |
| Field | Field name across all FieldPermissions | All profiles/permsets granting read/edit |
| System Permission | Boolean field filter on PermissionSet/Profile | All grantees → resolve to users |
| Role (internal only) | UserRoleId on User | All users in role → effective permission comparison. Portal roles (`PortalType IN ('Partner','CustomerPortal')`) are excluded — see Section 2.14 (UX-12). |

### 6.2 Change Impact Analysis

Answers the question: what breaks if I change X? Triggered explicitly by the user selecting a change scenario. Supported scenarios: Remove a PermSet from a User, Delete a PermSet Entirely, Modify a Profile, Revoke a Field from a PermSet.

All selectors in every scenario use incremental (typeahead) search, not long dropdown lists (see Section 2.15 UX-13). Typeahead behavior is defined in Section 7.4.

**Scenario A — Remove a PermSet from a User.** No selection is required up front. The app precomputes an Impact Matrix by iterating every (User, PermSet) pair where the user has the PermSet assigned and the PermSet is not owned by a profile. For each pair the app computes the effective-permission delta (object-level, field-level, system) that the user would lose, after accounting for other PermSets and the profile that still grant the same permission. The matrix is displayed as a sortable, filterable table of candidate removals with zero-impact pairs highlighted as safe removals and non-zero-impact pairs showing the lost permissions grouped by category. Precompute cost is expected to be a few seconds (~26k pairs on the target org) and runs once per session on demand; a progress indicator is shown. See Section 2.16 (UX-14).

**Scenario B — Delete a PermSet Entirely.** The user picks a PermSet via typeahead. The app computes which users are impacted, which objects/fields/system perms are lost, and where each lost permission would still be covered by a different source (Profile, PermSet, or PermSet Group). The view also surfaces a zero-impact callout listing every PermSet whose deletion would result in no effective-permission loss for any currently-assigned user because every granted permission is redundantly covered by another source. "Unassigned" PermSets (no user and no group reference) are NOT included in the zero-impact callout — they are already surfaced as Orphaned PermSets in Section 6.3. For a zero-impact (redundant) PermSet, the UI must show, per permission, ALL covering sources — a single permission may be covered by multiple Profiles/PermSets/Groups, and every one must be listed so the administrator can reason about what happens when any single covering source itself is later removed. See Section 2.17 (UX-15).

**Scenario C — Modify a Profile.** The user picks a source User (typeahead) and a target Profile (typeahead). The app swaps the user's profile to the target profile in a simulated effective-permission set and diffs it against the current effective-permission set, showing Losses (permissions the user would lose) and Gains (permissions the user would acquire). All PermSet assignments remain unchanged in the simulation. This scenario must render fully (not blank) for every valid (user, profile) pairing — see Section 2.5 (BUG-6). See also Section 2.18 (UX-16).

**Scenario D — Revoke a Field from a PermSet.** The selectors cascade: (1) PermSet (typeahead, filtered to PermSets only, Groups excluded — see Section 2.6 BUG-7), (2) Object (typeahead, filtered to objects with FieldPermissions granted by the selected PermSet), (3) Field (typeahead, filtered to fields of the selected object that have any grant from the selected PermSet). After all three are picked, the app lists every user assigned to the PermSet whose effective access to the (Object, Field) would change, split into Read Loss and Edit Loss with the covering-sources enumeration (other PermSets/Groups/Profile still granting the permission). See Section 2.19 (UX-17).

### 6.3 Permission Overlap & Redundancy

Identifies consolidation opportunities across profiles and permission sets. Includes Duplicate PermSet Detection, Subset Detection, Profile Similarity Clustering, Orphaned PermSets, Dead Fields, and a Finding Dismissal & Triage Workflow with persistent storage (see 8.4).

### 6.4 Profile to PermSet Group Migration Planning

The primary strategic use case: planning a migration from profile-centric to PermSet Group-centric permission management. Uses a Three-Way Decomposition Model: Shared Base PermSet Group, Additive Delta PermSets, and Muting PermSets. Similarity Clustering uses Jaccard scores with a >70% threshold.

### 6.5 User Role & Hierarchy Context

Surfaces permission inconsistencies across the role hierarchy. Supports Role-Based Permission Consistency Check and Role Hierarchy Traversal using `UserRole.ParentRoleId` to build the full tree.

### 6.6 Reporting & Export

All views must be exportable. Required report types: Permission Matrix (CSV), User Permission Passport (CSV or printable), Overlap & Redundancy Report, Migration Readiness Report, Change Impact Report.

---

## 7. UI Structure

### 7.1 App Layout

The app has three main areas:

- Left sidebar: navigation — entry point selector (User / Profile / PermSet / PermSet Group / Object / Field / Role), top-of-list search/filter that matches over the entry-point list, and selection list
- Main panel: detail view for selected item, with tabbed sub-sections (Objects, Fields, System Perms, Access, Users, Provenance, etc.). Every sub-section renders a search/filter input above its table or list that narrows the rows in that sub-section specifically — see Section 7.4 and Section 2.7 (UX-5). Every Object → Field table supports a cascading filter: picking an object restricts the Field list/tab to that object's fields — see Section 2.8 (UX-6).
- Right panel (collapsible): analysis tools — Change Impact, Compare, Migration Analysis, Export. All selectors inside the right panel use typeahead (see Section 7.4 and Section 2.15 UX-13).

### 7.2 Landing Screen

On first load the app must NOT show a welcome splash screen. It goes directly to the main explorer UI (Explorer tab if cached data was hydrated; Admin tab if no data is loaded).

**v3.0 boot sequence:**

1. The boot `useEffect` calls `idbReadCache()`.
2. **Cache hit** (non-empty datasets): hydrate `datasets` and `dismissals`, set `source = "cache"`, `setTab("explorer")`. Header pill: `From cache · Nd old`. If `ageInDays(cachedAt) > CACHE_STALE_DAYS`, surface a yellow staleness banner above the main UI (non-blocking).
3. **Cache miss / IDB unavailable**: set `datasets = EMPTY_DATASETS`, `source = "none"`, force `setTab("admin")`. Header pill: `No dataset — upload CSVs in Admin tab`. The tab strip is filtered to `[Admin]` only — the other five tabs are hidden until at least one dataset has rows. A non-blocking yellow banner above the main UI directs the user to upload CSVs or import a `.pebundle` from their Cowork folder.

Once data is loaded, the header badge reflects the current source: `From cache · Nd old`, `Dataset loaded — CSV upload · X ago`, or `Dataset loaded — bundle · X ago`.

### 7.3 Admin Tab — Unified Query + Upload View with Bundle Export/Import + Cache Controls

**Structural change in v2.3+:** "Data Source Status," "Query Reference," and "CSV Upload" are merged into a single unified per-dataset card list. Each of the 13 required datasets has one card containing everything needed for that dataset — no jumping between a query section and an upload section. Bundle Export/Import + Cache controls sit as a top-of-tab control bar above the cards.

**Top-of-tab control bar (above the per-dataset cards), v3.0 layout:**

- **Data source indicator**: one of `CSV upload in progress (N/13 staged)`, `CSV upload complete — N/13`, `Bundle imported — X ago`, `From cache · Nd old`, or `No dataset loaded`.
- **Load All Computations** button (UX-20): pre-builds Impact Matrix + Delete candidates + Migration clusters in one pass. Disabled until all 13 datasets are loaded.
- **Import Bundle** button: opens a file picker filtered to `.pebundle`. On import, the bundle is decompressed, parsed, loaded into memory, and immediately written to the IndexedDB cache so the next session starts from this bundle automatically. Progress indicator is shown during decompression of large bundles (>20 MB).
- **Export Bundle** button: serializes all currently-loaded datasets into a single gzipped `.pebundle` file and triggers a browser download. Disabled unless all 13 required datasets are loaded.
- **Clear Cache** button (new in v3.0): clears the IndexedDB persistence only. The current view stays loaded for this session; the next refresh boots empty. Use when handing the workstation to another user or when running on a shared/kiosk machine.
- **Reset** button: clears both the in-memory dataset AND the IndexedDB cache, returning the app to the empty Admin-only state.
- A short inline note under the control bar, visible at all times, explaining the v3.0 model: "Data flow (v3.0): upload the 13 CSVs below, or import a .pebundle generated by your weekly Cowork scheduled task. After either step, the parsed dataset is cached locally in IndexedDB, so the next session boots instantly without re-uploading. The artifact never calls Salesforce or any other network endpoint at runtime — your data stays in your browser."

**Per-dataset card layout (one card per Required Export Query 1–13):**

Header row:
- Query number + label (e.g., "Query 6 — Permission Set Assignments")
- Target filename pill (e.g., `PermissionSetAssignment.csv`)
- Status badge: current row count + source ("CSV uploaded Xmin ago" / "From bundle" / "Embedded fallback" / "Not loaded")

Expandable query block:
- Collapsible `<details>`/`<summary>` with the full SOQL in a dark code block (`#060b16` background, `#34d399` monospace text).
- Copy button positioned absolutely in the top-right of the code block. Uses the `document.execCommand` pattern from Section 2.3. Shows "Copied!" for 2s.

Upload area (inside the same card):
- "Upload CSV" button that opens a file picker. After a file passes validation the label changes to "Replace".
- Inline validation results: row count on success; specific error messages in red on failure (wrong file, missing required columns, mismatched schema); warnings in yellow (very few rows, some invalid IDs, optional columns missing). A file with errors is rejected and the slot remains unchanged.

Cross-reference validation:
- Runs after any file is staged, across all staged + existing files (join integrity checks).
- Warnings appear in a yellow callout above the Export Bundle button — they do not block export.

At the bottom of the tab:
- Full file manifest recap (all 13 datasets with row counts, source labels, and the uncompressed/compressed size the current state would produce if exported).

> The previous three-sub-section layout (Data Source Status / Query Reference / CSV Upload) is removed. All of its information is carried into the unified per-dataset cards and the top-of-tab control bar above.

### 7.4 Detail Panel Behavior — Sub-Section Search, Cascading Filters, and Provenance

This section specifies the uniform interaction behaviors that apply across every entry-point detail view and across the Change Impact panel.

**Per-sub-section search (UX-5).** Every sub-section that renders a list or table (Objects, Fields, System Perms, Access items, Users, Assigned Users, PermSet Members, Muting PermSets, etc.) must render a dedicated search input immediately above its list. The input filters only that sub-section's rows and is independent of search inputs in sibling sub-sections. The sidebar's entry-point search is also independent of all sub-section searches. Search matches the primary display string (e.g., name, label, developer name) case-insensitively and as substring. Clearing the input restores the full sub-section.

**Cascading Object → Field filter (UX-6).** When a detail view includes both an Objects sub-section and a Fields sub-section, selecting a row in the Objects sub-section filters the Fields sub-section to fields of that object. A visible "Scoped to <ObjectName> — Clear scope" pill appears above the Fields list when scoped. Clearing the scope restores the full Fields list. If no Object is selected, the Fields sub-section shows fields across all objects.

**Object list cleanup (UX-10).** Rows with a blank or whitespace-only `SobjectType` are never rendered in any Object list. Instead, the number of dropped rows is aggregated per source file (ObjectPermissions and FieldPermissions) and surfaced on the Admin tab as a yellow (non-blocking) warning ("N rows in ObjectPermissions.csv had blank SobjectType and were dropped"). See Section 2.12.

**PermSet detail — assigned users sub-section (UX-7).** The PermSet detail view includes an "Assigned Users" sub-section listing every currently-assigned active standard user, with Name, Email, Profile, and LastLoginDate. The list supports per-sub-section search as defined above. The count in the sub-section header ("Assigned Users — N") must match exactly the count of PermissionSetAssignment rows for this PermSet after applying the standard-user/active filter.

**PermSet Group drill-down (UX-9).** The PermSet Group detail view includes a "Member PermSets" sub-section listing every member PermSet from PermissionSetGroupComponent, flagged as Additive or Muting. Each row is navigable — clicking navigates into the member PermSet's detail view. Breadcrumb or "Back to Group" affordance is present.

**User detail — provenance + mute indicators (UX-8).** The User detail view must show, for every effective permission, its source: the assigned Profile, the PermSet (direct or via a Group), and/or the Muting PermSet that suppresses it. Fields suppressed by a Muting PermSet are shown in a dedicated "Muted" sub-section and are visibly distinct (strikethrough or "Muted by <MutingPermSet>" pill) from fields simply not granted.

**Field detail — provenance chain (UX-11).** The Field detail view (a specific `SobjectType.Field`) must enumerate every source that grants Read and/or Edit on that field, organized into three columns or rows: Profiles, Permission Sets, and Permission Set Groups. Each source row includes a badge indicating whether it is a Profile-owned PermSet (`IsOwnedByProfile = true`), so administrators can distinguish profile-implicit grants from explicit PermSet grants. Muting PermSets that suppress the field are listed in a fourth row with a "Muting" indicator.

**Typeahead semantics (UX-13).** Typeahead inputs used by Change Impact and by the left-sidebar selector must match case-insensitively across name, label, and developer name. They must display the top N matches (default 50, capped) in a dropdown as the user types. They must support keyboard navigation (arrow up/down, Enter to select, Escape to close). When no selection is made they do not submit. The Change Impact scenarios each specify what the typeahead is filtered to (e.g., PermSets only — not Groups — for Revoke Field, see Section 2.6 BUG-7).

---

## 8. Important Implementation Notes

### 8.1 SOQL Rules

- Never include comments in SOQL — there is no comment syntax. No `--` or `/* */`.
- `PermissionSetGroup` has DeveloperName and MasterLabel — there is no Name field.
- User query must filter `WHERE UserType = 'Standard' AND IsActive = true`.
- `PermissionSetAssignment` must filter `WHERE Assignee.IsActive = true AND Assignee.UserType = 'Standard'` — unfiltered count is 2,010,598 rows.
- After CSVs are uploaded, no further SOQL is executed — all operations are in-memory.

### 8.2 Effective Permission Resolution

- A permission is granted if ANY of the user's profile or permsets grants it — OR logic, purely additive.
- Muting PermSets inside a PermSet Group explicitly suppress permissions — these must be applied as subtractions. Muting status is read from `PermissionSet.Type` (Query 2).
- Resolution order: union all profile + PermSet grants, then apply Muting PermSet subtractions.
- PermSet Groups resolve to member PermSets via `PermissionSetGroupComponent`, then apply member grants, then Muting subtractions.

### 8.3 Performance & Memory

- 318k FieldPermissions rows consume approximately 80–150 MB in Chrome's V8 heap.
- Total in-memory footprint after loading all 13 datasets and building lookup indexes: approximately 150–250 MB — well within Chrome's default per-tab heap limits.
- All in-memory filtering should use pre-built index Maps (keyed by ParentId, SobjectType, Field) built once at load completion.

### 8.4 Data Persistence & Sharing — IndexedDB Cache + Pebundle Export/Import + Weekly Cowork Task (revised in v3.0)

**v2.3 history (rejected):** A chunked+compressed `window.storage` scheme was proposed. Rejected before implementation because (a) Claude.ai artifacts run in a sandboxed iframe where `localStorage` / `sessionStorage` are blocked, (b) no `window.storage` API is guaranteed, and (c) chunking 150–250 MB of parsed data across 5 MB keys is architecturally fragile. A direct Salesforce connection was also rejected because OAuth tokens cannot be obtained in this environment.

**v2.4–v2.8:** Downloadable **Dataset Bundle** file (`.pebundle`) for sharing between users. No browser-side persistence — every refresh re-uploaded.

**v2.9 (deprecated):** Repo-hosted `data/snapshot.json` fetched from `raw.githubusercontent.com` at boot. Removed in v3.0 because it conflated demo data with real data and was an attractive nuisance for shipping un-scrubbed PII to a public URL.

**v3.0 design — three-layer persistence:**

1. **IndexedDB cache** (browser-side, automatic). After successful CSV upload (debounced 1.5s after the last upload event in a batch) or `.pebundle` import, the parsed dataset is silently written to IndexedDB. Stored value: `{ cachedAt: ISO, schemaVersion: 1, pebundle: Blob }` where `pebundle` is a gzipped JSON of the same payload shape as a manual export. Subsequent sessions hydrate from this cache on boot in well under a second. A 14-day staleness threshold (`CACHE_STALE_DAYS`) surfaces a non-blocking yellow banner when exceeded. IDB failures are non-fatal: the helpers return null/false and the app boots empty.
2. **Manual `.pebundle` export/import** (file-based, deliberate). The "Export Bundle" button produces the same gzipped JSON for hand-sharing with teammates or attaching to audit tickets. "Import Bundle" decompresses, validates `format === "pebundle" && version === 1`, replaces in-memory state, and writes to the IDB cache so the next session starts there.
3. **Weekly Cowork scheduled task** (offline pipeline). The `weekly-permission-explorer-bundle` task runs every Monday at 06:00 local time inside a fresh Cowork session with the user's authed Salesforce MCP. It runs the 13 SOQL queries against the production org, paginates via `Id > lastId` cursor, streams rows to `/tmp/permission-explorer-stage/<key>.jsonl`, and invokes `node scripts/build-pebundle.js` to produce 13 CSVs + 1 `.pebundle` in `/Users/manoj.aggarwal/Documents/Cowork/PermissionExplorer/bundles/`. Atomic rotation: builds in a temp dir, then deletes prior `*.csv` / `*.pebundle` / `LAST_RUN_ERROR.txt` and moves new files into place. Non-bundle files (e.g., `notes.md`) are preserved. The user opens the artifact and clicks "Import Bundle" against the latest file to refresh.

**Why this layered model is genuinely simpler and stronger than v2.4:** no 5 MB cap, real cross-session persistence, no public-URL exposure of PII, no auth in the browser, real portability when needed, GDPR-friendly because the user controls where their data physically lives.

**Bundle format (`.pebundle`):**

- A single file produced by serializing all loaded datasets into a structured payload and compressing it with the browser's built-in `CompressionStream('gzip')`. No external libraries required.
- Payload (before gzip) is JSON with this shape:

```
{
  "format": "pebundle",
  "version": 1,
  "createdAt": "<ISO-8601>",
  "sourceOrg": "<optional admin-entered label>",
  "appVersion": "<permission-explorer build>",
  "datasets": {
    "Profile":                      { "rows": [ … ], "schema": [ … ] },
    "PermissionSet":                { "rows": [ … ], "schema": [ … ] },
    …one entry per Required Export Query 1–13…
  },
  "dismissals": [ … ]
}
```

- Each dataset's `rows` is an array of row objects; `schema` is the column name list in the CSV's original order (preserves forward-compat for Query 13 `Permissions*` columns).
- Dismissals (Section 6.3) travel with the bundle so triage state is part of the shared artifact.
- Typical size after gzip: 15–30 MB for a full org export (FieldPermissions dominates). Well within browser download limits.

**Export flow:**

1. Admin stages all 13 CSVs in the Admin tab (see 7.3).
2. Cross-reference validator runs. Export is allowed if all green; yellow warnings don't block.
3. Admin clicks **Export Bundle**. The app builds the payload in memory, pipes it through `CompressionStream('gzip')`, and triggers a browser download via a Blob URL. Filename is `permission-explorer_<yyyymmdd-hhmm>.pebundle`.
4. Admin shares the file — email, shared drive, git, internal file share. That's the sharing mechanism.

**Import flow:**

1. User clicks **Import Bundle**, picks a `.pebundle` file.
2. The file is streamed through `DecompressionStream('gzip')`, parsed as JSON, validated against the expected format + version.
3. Datasets are loaded into memory and the same index Maps (keyed by ParentId, SobjectType, Field) are built as if the CSVs had just been uploaded.
4. Header badge switches to "Dataset loaded — imported from `<filename>` Xmin ago".

**Why not browser storage at all:**

- `localStorage` / `sessionStorage` are blocked in the sandboxed iframe.
- `window.storage` is not a documented, guaranteed API in Claude.ai artifacts.
- Chunking 150–250 MB across 5 MB keys introduces many partial-write failure modes.
- A file download avoids every one of these and is trivially auditable (you can inspect the `.pebundle` outside the app).

**Tradeoff acknowledged:**

- No automatic cross-user sync. A teammate has to import the bundle to see the same data. The Admin tab explicitly calls this out so users aren't surprised.
- Dismissals are per-bundle; a re-export is required to share updated triage state. Acceptable because dismissals are low-velocity admin actions.

---

## 9. Acceptance Criteria

Contiguous numbering. Bug-fix (BUG-) and UX-change (UX-) criteria are separate from the main feature criteria.

**Bug-fix criteria (from Section 2):**

| # | Criterion | Verification |
|---|---|---|
| BUG-1 | Artifact loads in Claude.ai without any JavaScript console errors | Load in Claude.ai, open DevTools console |
| BUG-2 | Full Permission Explorer UI renders correctly on first load after bug fix | Visual inspection |
| BUG-3 | Copy buttons in Admin tab write query text to clipboard successfully | Click each Copy button, paste into text editor, verify full query text |
| BUG-4 | Copy button shows "Copied!" for 2 seconds then reverts — multiple buttons operate independently | Click two different Copy buttons in sequence, verify independent state |
| UX-1 | No splash, welcome, intro, or "Go to Admin Tab" screen appears at any point | Load artifact fresh, observe first render |
| UX-2 | After data load, app opens directly on primary explorer tab | Load artifact, verify first rendered view |
| UX-3 | Async loading indicator (spinner/pulse) during data fetch is preserved | Observe load sequence |
| UX-4 | Admin tab remains accessible from navigation and CSV upload works normally | Navigate to Admin tab, upload a CSV |
| BUG-5 | Profile detail view renders populated Objects, Fields, and System Perms sub-sections for every profile that has any grants in ObjectPermissions / FieldPermissions / PermissionSet system-perm rows | Pick 5 profiles with known grants; confirm no empty panels; confirm counts match ParentId-joined row counts |
| BUG-6 | Modify Profile change-impact scenario renders a populated diff (Losses + Gains) — never a blank page — for every valid (user, profile) pairing, including cases where the diff is empty (which must be shown as "No change") | Run scenario for 3 test users × 3 target profiles; confirm non-blank render in all 9 cases |
| BUG-7 | Revoke Field from PermSet scenario's parent selector lists only Permission Sets (not PermSet Groups) | Open scenario, verify no Group entries appear in the typeahead |
| UX-5 | Every list/table sub-section in the detail panel has an independent search input that narrows only that sub-section | Type into one sub-section's search, confirm other sub-sections unchanged |
| UX-6 | Selecting an object row filters the Fields sub-section to that object's fields; a "Scoped to <Object> — Clear scope" pill is visible; clearing restores full list | Click an object row, verify scope pill and filtered fields; clear and verify full list returns |
| UX-7 | PermSet detail shows an Assigned Users sub-section with count matching PermissionSetAssignment rows for the PermSet (filtered to active standard users) | Pick a PermSet with known N assignees, verify count = N |
| UX-8 | User detail shows provenance (Profile / PermSet / Group) for every effective permission, with a distinct Muted sub-section for fields suppressed by Muting PermSets | Pick a user with at least one Muting PermSet, verify muted entries appear and are visibly distinct |
| UX-9 | PermSet Group detail shows a Member PermSets sub-section listing every member with Additive/Muting flag; each row is navigable | Pick a group with a Muting member, verify flag and navigation work |
| UX-10 | Object lists never render rows with blank `SobjectType`; the count of dropped rows per source file appears as a yellow warning on the Admin tab | Upload ObjectPermissions.csv with blank-SobjectType rows, verify warning and absence from lists |
| UX-11 | Field detail view enumerates every granting source across Profiles, PermSets, and PermSet Groups with a Profile-owned flag; Muting PermSets appear under a Muting row | Pick a field granted by both a profile-owned and a stand-alone PermSet, verify both appear with correct flag |
| UX-12 | User Roles list and Role hierarchy show only internal roles (`PortalType = 'None'`, the literal picklist value — not SQL NULL); any portal rows in an uploaded CSV (`Partner`, `CustomerPortal`, etc.) are filtered defensively at load time and trigger a yellow Admin warning | Upload UserRole.csv containing portal rows, verify filtering + warning |
| UX-13 | Every Change Impact selector is a typeahead with case-insensitive matching across name/label/developer name and keyboard navigation; no long scroll dropdown anywhere | Open each scenario, verify typeahead behavior |
| UX-14 | Remove PermSet from User runs without any pre-selection — a precompute produces an Impact Matrix over all (User, PermSet) pairs with a visible progress indicator; zero-impact pairs are highlighted | Trigger scenario cold, verify matrix renders within a few seconds with correct zero-impact flags |
| UX-15 | Delete PermSet Entirely scenario surfaces a zero-impact callout listing every PermSet whose deletion results in no effective-permission loss; unassigned PermSets are excluded from this callout (they appear under Orphaned PermSets); each redundant PermSet enumerates ALL covering sources per permission | Seed a PermSet whose every grant is redundantly covered by two other PermSets, verify it appears with both covering sources listed; seed an unassigned PermSet, verify absence from the callout and presence under Orphaned PermSets |
| UX-16 | Modify Profile scenario uses typeahead for both User and Target Profile selectors | Open scenario, verify both selectors are typeaheads |
| UX-17 | Revoke Field from PermSet uses three cascaded typeaheads (PermSet → Object → Field). Object typeahead is filtered to objects the selected PermSet grants. Field typeahead is filtered to fields of the selected object that the selected PermSet grants. After all three are picked, the impacted-users list renders with covering-sources enumeration | Run scenario end-to-end for a PermSet granting 2 objects and multiple fields, verify cascaded filtering and impacted users |
| UX-18 | At 1440 px and 1920 px viewport widths, detail tables consume more horizontal space than in v2.5; tables with fewer than ~8 columns show no horizontal scrollbar at 1440 px | Visual inspection at both viewport widths |
| UX-19 | PermSet and Profile detail views render a Setup Entity Access sub-section grouped by type (ApexClass, ApexPage, CustomPermission, etc.) with correct counts; Apex Class, VF Page, and Custom Permission are first-class entry points with reverse lookup | Pick a PermSet granting Apex classes, verify sub-section counts match CSV; navigate via new entry points and verify reverse lookup |
| UX-20 | "Load All Computations" button on Admin tab runs every precompute sequentially with per-task status; after success, Change Impact and Overlap views render instantly | Click button cold, verify status list completes; navigate to scenarios, confirm no spinner |
| UX-21 | Session-persistent selections survive tab navigation: typeaheads, scope pills, and search inputs retain values across navigation until a dataset reload, Admin Reset, or page refresh | Set selections in 3 different views, navigate between all tabs, verify every selection restored |
| UX-22 | Reconcile PermSets workflow accepts 2+ PermSets and produces a Venn summary, consolidated PermSet preview, proposed muting PermSets, and assignment migration plan with zero Losses when mutes are applied | Run workflow for a cluster of ≥3 PermSets, verify all four outputs render |
| UX-23 | Effective Objects sub-section shows only objects with at least one grant for the selected user; toggle "Show objects with no access" restores full list | Pick a user with known 42-of-600 object grants, verify default count; toggle on, verify full 600 |
| UX-24 | Profile → Assigned Users sorts by LastLoginDate ASC by default with null-first ordering; header click toggles direction | Open a profile with dormant users, verify dormant-first ordering; click header, verify inversion |
| UX-25 | Effective Fields table shows no horizontal scrollbar at 1440 px or 1920 px viewport widths for up to 2,000 effective fields; provenance remains accessible via popover or expand | Visual inspection on a user with many fields |
| BUG-8 | Selecting any Profile (including Finance) with underlying grants renders non-empty Objects, Fields, Tab Settings, and Setup Entity Access sub-sections with typed columns (no concatenated-string cells); Profile → implicit-PermSet join is used | Pick Finance and 4 other profiles with known grants, verify each sub-section populates with structured columns |
| BUG-9 | Roles view and hierarchy show zero portal roles even when `UserRole.csv` contains portal rows; a yellow admin warning reports the dropped count | Upload UserRole.csv with known portal rows, verify filtering + warning |
| UX-26 | PermSet Coverage Report on Admin tab enumerates per-category row counts for every PermSet; detail-view sub-section counts match report counts; any discrepancy is a renderer bug and is tracked | Export report, spot-check 5 PermSets against their detail views |
| UX-27 | Impact Matrix has three independent typeahead filters (User / Profile / PermSet) that compose as AND; filter state persists per UX-21 | Apply each filter individually and in combination, verify row restrictions |
| UX-28 | Change Impact filter typing shows a suggestion dropdown; rows update only when a suggestion is selected via click or Enter; Escape closes without applying | Type partial name, verify dropdown but no table change; select suggestion, verify table updates |
| UX-29 | Selecting a User in Explorer pre-populates the User filter on entering Remove-PermSet-from-User; matrix user cells link back to Explorer | Select user, open scenario, verify pre-fill; click user cell, verify Explorer opens to that user |
| UX-30 | Expanding a non-zero-impact row in the Impact Matrix shows both Lost and Covered permissions with covering sources; Lost ∪ Covered equals the PermSet's full grant set | Pick a row with partial loss, expand, verify union equals PermSet grants |
| UX-31 | Every non-zero-impact row in the Impact Matrix shows a "Will lose access" badge and a color-coded Impact severity column sortable as None/Minor/Major | Sort by severity, verify Major rows at top with correct badges |
| UX-32 | On selecting a PermSet in Delete-PermSet-Entirely, the Impacted Users header is visible above the fold on a 1440×900 viewport | Open scenario with a known PermSet, verify no scroll required |
| UX-33 | Each impacted user in Delete-PermSet-Entirely shows a Permission / Covered By table; users with every row covered are moved to "Impacted but covered"; users with any uncovered permission remain in "Impacted" | Verify placement for mixed and fully-covered test users |
| UX-34 | "Covering sources (All)" label replaces "N tokens" with a concrete noun; hover tooltip explains the metric in one sentence | Inspect label and tooltip |
| UX-35 | All labels in the Modify Profile scenario (UI and exported reports) say "Future profile", never "Target profile" | Grep the UI and exported CSVs |
| UX-36 | Modify Profile scenario renders Current profile card (read-only, derived from user) and Future profile card (typeahead) side by side with key metadata on both | Select a user, verify both cards populate; change future profile, verify left card unchanged |
| UX-37 | Modify Profile scenario exposes a three-tab side-by-side comparison (Objects, Fields, System Perms) with "Only show differences" on by default; exports match on-screen tables | Run scenario for a tested pair, verify tables and exports |
| UX-38 | Revoke Field from PermSet shows a purpose paragraph on first render; "Learn more" expands a longer explanation | Open scenario cold, verify paragraph; click Learn more |
| BUG-10 | Revoke Field (and every Change Impact) PermSet typeahead matches only on name/label/developer name — not on Type, License, or Namespace | Type "Custom"; verify zero results whose `Type = Custom` but name excludes "Custom" |
| UX-39 | Every Overlap & Redundancy block has a visible description paragraph with a recommended action | Visual inspection of all blocks |
| UX-40 | Duplicate PermSets block shows a precise definition above it; each pair has a Compare button opening a three-tab side-by-side view; true duplicates show zero differences; one-field deltas appear under a Near-duplicate block | Verify definition; seed a true duplicate and a near-duplicate, inspect both |
| UX-41 | Every Migration Analysis block has a visible description paragraph | Visual inspection of all blocks |
| UX-42 | Migration tab's Compare Profiles control renders a three-tab side-by-side view with a visible Jaccard similarity score and color coding | Select two known-similar profiles, verify score and tabs |
| UX-43 | Each similarity cluster expands to a pairwise Jaccard matrix and a Cluster Consensus view; Confirm/Reject actions persist in the dismissal log and round-trip through bundle export/import | Expand a cluster, confirm one, reject another, export bundle, re-import, verify persistence |
| UX-44 | Every Admin validation notice has a Reason line and either a Fix line or an explicit `Informational only` tag | Inspect every notice on the Admin tab |
| UX-45 | Admin notices are tagged `Action required`, `Warning`, or `Informational only`; informational-only notices do not appear in the top-of-tab warning counter | Inspect tagging and counter |
| UX-46 | Admin tab renders no full-dataset snapshot; per-dataset cards and file manifest remain | Visual inspection |
| UX-47 | Prescribe Access view ranks PermSet candidates by least-privilege coverage of the desired access; "Already covered" rows are separated; combination suggestions render when no single PermSet suffices | Run for 3 users × 3 desired-access configurations; verify ranking, coverage classifications, combinations |
| BUG-11 | "Granted by" column resolves every source Id to a human-readable Profile / PermSet / Group name with a kind pill; raw Id appears only on hover | Pick a user with grants via all three source kinds, verify no 18-digit Ids render as primary values |
| BUG-12 | Clicking an Object row in User → Effective Objects filters Fields to that object's fields within one frame; the "Scoped to <Object> — Clear scope" pill renders; clearing restores full list | Click sequence test |
| UX-48 | Effective Fields table has no Object column when cascade is active; uses grouped headers when cascade is off; long field names wrap or truncate with tooltip and never force horizontal scroll at 1440 px | Visual inspection with cascade on and off for a user with many fields |
| BUG-13 | Total column sort toggles DESC → ASC → unsorted on repeated header clicks with a visible arrow indicator; row order matches indicator | Click sequence test |
| UX-49 | Delete-PermSet-Entirely search shows an × Clear control whenever a PermSet is selected; clicking or pressing Escape returns the view to default empty state | Select a PermSet, clear, verify reset |
| UX-50 | No visible occurrence of "Modify Profile" anywhere in the app or exports; all references say "Change User Profile" | Grep UI and exported CSVs |
| BUG-14 | Change User Profile fixture (System Administrator → Sales User) produces a loss set including ModifyAllData, ViewAllData, and ≥90% of Profile-level permissions missing from Sales User; debug panel rows reconcile to summary counts | Run against golden-file fixture |
| UX-51 | Every Subset row in Overlap & Redundancy is expandable and shows the substantive extras grouped by category with counts; zero-extras rows are detected and re-classified as Duplicates | Seed a Subset and a Duplicate, verify classification and expansion |
| UX-52 | Near-duplicate and every compare pane (UX-22, UX-37, UX-40, UX-51) uses two-column paired labeling with `Has` / `Missing` / `Shared` / `Differs` semantics and a visible legend; no "only in X" phrasing remains | Inspect all compare panes |
| UX-53 | At 1280, 1440, 1920, 2560, and 3840 px viewport widths, the main-panel data tables fill available horizontal space; no 1680 px cap; sidebar and right panel splitters resize and persist per UX-21; prose blocks constrained to ~130 chars, tables not | Resize viewport across the five widths, verify; resize splitters, navigate, verify persistence |
| UX-54 | Embedded fallback, loaded on first artifact run, exercises every tab and every precompute with non-empty results; bundled JS contains zero real PII and zero runtime MCP calls; a `build-fallback` workflow exists and is reproducible | Grep bundled artifact for `@bullhorn.com` and real name patterns (expect 0); grep for `callMcpTool` in runtime JS (expect 0); re-run `build-fallback` and verify fallback rebuilds |
| BUG-15 | Finance profile detail renders Accounts row with CRUD flags `R,C,E,D,VA` and View All Records indicator; System Perms sub-section lists Chatter Internal User, Create and Customize Dashboards, Customize Application, and every `Permissions*` boolean true on the Profile row; debug toggle dumps diagnostic payload; fixture regression test exists and passes | Open Finance profile; verify Objects and System Perms sub-sections populate; run fixture test |
| ARCH-1 | The artifact makes zero outbound runtime requests to any Salesforce, GitHub, or third-party data endpoint at boot or during use. The `GITHUB_SNAPSHOT_*` constants and `fetchGithubSnapshot` are removed from `PermissionExplorer.jsx`. The repo no longer contains `data/snapshot.json`, `scripts/bake-snapshot.js`, `scripts/build-fallback.js`, `docs/BAKE.md`, or `mcp-seed/`. | DevTools network panel inspection; grep the JSX and the repo |
| ARCH-2 | After a successful CSV upload or `.pebundle` import, refreshing the browser tab restores the dataset from IndexedDB without re-upload, with header pill `From cache · Nd old`. Clicking Clear Cache wipes only the persistence; clicking Reset wipes both in-memory and persistence. In a private/incognito window where IDB is unavailable, the app boots without crashing into the empty Admin state. | Manual upload + refresh test; Clear Cache test; Reset test; private-window test |
| UX-55 | A cache record older than 14 days at boot triggers a yellow staleness banner naming the age in days. A 13-day-old cache shows no banner. A fresh import dismisses the banner immediately. | DevTools manipulation of `cachedAt`; refresh; verify banner |
| UX-56 | When no dataset is loaded, the tab strip shows only the Admin tab; the other five tabs (Explorer, Change Impact, Prescribe Access, Overlap & Redundancy, Migration) are hidden. As soon as at least one dataset has rows, the full six-tab list appears. Clicking Reset from any tab snaps focus back to Admin and re-hides the other five. | First-load test with no cache; CSV upload test; Reset test |
| OPS-1 | "Run now" on the `weekly-permission-explorer-bundle` Cowork scheduled task produces 13 CSV files plus one `.pebundle` in `/Users/manoj.aggarwal/Documents/Cowork/PermissionExplorer/bundles/`, with row counts matching the per-dataset COUNT preflights. The org is positively identified as production (`bullhorn`, `isSandbox: false`) before any data is fetched; otherwise the task aborts with `LAST_RUN_ERROR.txt` and prior outputs are preserved. The bundle filename is `permission-explorer_<YYYYMMDD-HHMM>.pebundle`. The artifact's "Import Bundle" loads the file and displays the row counts in the file manifest. The total tool-call budget for a single run stays under 200 calls. | Trigger Run now from Cowork sidebar; verify outputs; import into artifact |
| OPS-2 | After a successful weekly task run, `git status` in the project repo shows zero entries from `bundles/` (the directory is gitignored). | Inspect `.gitignore`; run task; check `git status` |
| DOC-1 | `README.md`, `package.json`, `index.html` bootstrap comment, and the JSX header changelog all reference v3.0 as the current version and describe the CSV-only + IDB-cache + weekly-pebundle flow consistently. `requirements_v3_0.md` exists and supersedes `requirements_v2_8.md` as the canonical spec. | Grep `v2.9`, `2.9.0`, `snapshot.json` (expect zero non-historical hits) |

**Main feature criteria:**

| # | Criterion | Verification |
|---|---|---|
| 1 | Admin tab displays all 13 Required Export queries with functional Copy buttons | Click each Copy button, verify correct SOQL |
| 2 | Uploading a valid CSV file shows correct row count and passes per-file validation | Upload known-good export, verify row count |
| 3 | Uploading an invalid or mismatched CSV surfaces clear per-file error messages | Upload wrong file to a slot, verify error |
| 4 | Cross-reference validation runs after files are staged and surfaces join-integrity warnings | Upload files with known mismatch, verify warning |
| 5 | Export Bundle produces a single gzipped `.pebundle` file that, when imported in a fresh session, restores the full dataset and dismissals | Export in one session, import in a new tab, verify row counts and dismissals |
| 6 | Query 13 parser tolerates missing Permissions* columns (defaults to false) and loads extra columns as-is | Upload CSV missing one Permissions* column, upload CSV with an extra Permissions* column |
| 7 | Selecting a User resolves full effective permissions by unioning Profile + all PermSets, applying Muting suppressions | Verify against known user |
| 8 | Selecting a Profile fans out correctly to ObjectPermissions, FieldPermissions, and System Perms | Test with a known profile |
| 9 | Selecting a Permission Set fans out to its granted objects, fields, and system perms | Test with a known PermSet |
| 10 | Selecting a PermSet Group unions member PermSets and applies Muting members as subtractions | Test with a known group containing a Muting member |
| 11 | Reverse lookup: entering an object name shows all profiles/permsets with CRUD access | Test with Account, Opportunity |
| 12 | Reverse lookup: entering a field name shows all grantees with Read/Edit | Test with a known custom field |
| 13 | Role entry point lists all users in the role and compares their effective permissions | Test with a populated role |
| 14 | Change Impact: removing a PermSet from a user identifies permissions that would be lost entirely | Compare before/after for a test user |
| 15 | Change Impact: deleting a PermSet entirely lists every user and group that loses access | Run for a PermSet with known assignees |
| 16 | Migration analysis: similarity clustering correctly groups profiles with >70% Jaccard similarity | Verify clusters against manual expected groupings |
| 17 | Migration analysis: three-way decomposition produces Shared Base + Additive Deltas + Muting sets that recompose correctly | Recompose and diff against source profiles |
| 18 | Overlap detection surfaces duplicate PermSets and subset relationships | Seed known duplicates, verify detected |
| 19 | Orphaned PermSets (no user, no group) are listed in the redundancy view | Verify known orphans appear |
| 20 | Redundancy findings can be dismissed with a reason; dismissals are included in exported bundles and restored on import | Dismiss, export, re-import in a fresh session, verify |
| 21 | All data tables have an Export to CSV button that downloads correct data | Download and open in Excel |
| 22 | No SOQL query in the Admin tab contains `--` or `/* */` comments | Code review |
| 23 | Bundle export uses `CompressionStream('gzip')` and produces a single `.pebundle` file; bundle import uses `DecompressionStream('gzip')` and validates `format` and `version` before loading; invalid files surface a clear error and leave current in-memory data untouched | Export a bundle and re-import it; attempt to import a non-bundle file and verify error handling |
| 24 | After a successful CSV upload batch (debounced 1.5s after last upload), the parsed dataset is silently written to IndexedDB. After a successful `.pebundle` import, the dataset is written to IndexedDB immediately. After a Reset, the IndexedDB record is removed. After a Clear Cache, the IndexedDB record is removed but in-memory state survives. | Manual test of all four flows |
| 25 | The build script `scripts/build-pebundle.js` reads 13 staging JSONL files from `--stage`, flattens nested SObject relationships (`row.Profile.Name` → `"Profile.Name"`), strips Salesforce `attributes` blobs, deduplicates by `Id`, writes 13 CSVs and one gzipped `.pebundle` to `--out`, and atomically rotates prior outputs (deletes prior `*.csv`, `*.pebundle`, `LAST_RUN_ERROR.txt`; preserves non-bundle files). Empty staging slots produce empty but present CSVs. | Unit test against synthetic JSONL; production end-to-end via the Cowork scheduled task |
| 26 | The Cowork scheduled task `weekly-permission-explorer-bundle` is configured to run weekly with cron `0 6 * * 1` (Mondays 6 AM local). Its prompt is self-contained (no references to the originating chat conversation), uses uniform `Id > '<lastId>' ORDER BY Id LIMIT 2000` cursor pagination, runs COUNT preflights with hard MAX bounds, never drops a filter even if results look unexpected, and invokes `node scripts/build-pebundle.js` for marshaling rather than re-implementing CSV/gzip/rotation in the prompt. | Inspect the SKILL.md generated by Cowork; trigger Run now and confirm completion within 200 tool calls |

---

## 10. Out of Scope

- Live Salesforce API connection in the browser — the artifact never calls Salesforce at runtime. Salesforce auth is exercised only inside the offline Cowork scheduled task.
- OAuth, Connected Apps, or any Salesforce authentication in the artifact itself.
- Writing back to Salesforce — read-only analysis only.
- Event Monitoring / field usage analytics (separate data source).
- Sharing rules, OWD, and record-level security (separate system from permission sets).
- Natural-language / free-text question answering over the dataset (removed in v2.3).
- Ad-hoc audit queries (dormant users, non-standard profiles, orphaned PermSets via SOQL, etc.) — these are admin-initiated point-in-time checks that run directly against Salesforce and are not part of this app's scope; admins who want them can run them in Workbench independently.
- Multi-org comparison.
- A repo-hosted demo snapshot (removed in v3.0). The artifact ships with no built-in dataset; first-load is empty until the user uploads CSVs or imports a `.pebundle`. See §3.2.
- Browser-side Salesforce credential storage. The IndexedDB cache stores parsed permission data only; it never stores OAuth tokens, API keys, or any auth material — there are none to store.

---

## Appendix A — Startup Screen to Remove

The following screenshot was provided by the product owner showing the screen that must be removed in v2.0. This entire screen must not appear — the app should load directly into the explorer UI.

> *Screen contents (from screenshot): Shield icon · "Permission Explorer" heading · "Salesforce permission analysis · v1.9" subtitle · Info box: "Export CSVs from your Salesforce org using the SOQL queries in the Admin tab, then upload them. No authentication or Connected App required. Works with any org — production, sandbox, or scratch." · Blue CTA button: "Go to Admin Tab" · Disclaimer: "CSV upload is instant. Data is shared with all users of this artifact."*

This screen is the 5.2 Landing Screen from v1.9 of the spec. In v2.0+ it is replaced by a non-blocking banner within the main UI.

---

## Version History

| Version | Date | Changes |
|---|---|---|
| 2026-04-v1.0 | April 2026 | Initial design. Core architecture, full SOQL query reference, multi-directional exploration, change impact, overlap & redundancy, profile-to-PermSet Group migration planning, role hierarchy context, reporting & export. |
| 2026-04-v1.1 | April 2026 | Added actual org row counts. |
| 2026-04-v1.2 | April 2026 | Replaced lazy-loading with sync-first pull-all model. |
| 2026-04-v1.3 | April 2026 | Added load time estimates and parallel page fetching. |
| 2026-04-v1.4 | April 2026 | Updated with exact org numbers. Fixed PermSetAssignment SOQL filter. |
| 2026-04-v1.5 | April 2026 | Added muting PermSets to migration planning model. Added Jaccard similarity clustering. |
| 2026-04-v1.6 | April 2026 | Replaced session token paste with OAuth 2.0 Authorization Code + PKCE flow. |
| 2026-04-v1.7 | April 2026 | Replaced sandbox auth with CSV upload model. Added Admin tab spec. |
| 2026-04-v1.8 | April 2026 | Added versioning scheme and version history. |
| 2026-04-v1.9 | April 2026 | Simplified to CSV-only architecture. Removed all OAuth, production live mode, Connected App requirements. |
| 2026-04-v2.0 | April 2026 | Added Section 2 in-flight corrections (BUG-1 returnReact runtime crash, UX-1 splash removal). Added Section 4 UI Style Reference. Updated Section 7.2 landing screen spec. |
| 2026-04-v2.1 | April 2026 | Expanded Section 5 queries and Section 7.3 Admin Tab spec with Approvals Map copy-button pattern. |
| 2026-04-v2.2 | April 2026 | Added Section 2.3 Copy button iframe-sandbox fix using `document.execCommand` fallback. Added BUG-3 and BUG-4. |
| 2026-04-v2.3 | April 2026 | (a) Removed audit queries from Admin tab — they are admin-only reference, not part of the app scope; moved to Out of Scope. (b) Reconciled file-count mismatch to 13 datasets consistently across Sections 3.3, 5, 7.3, and ACs. (c) Removed redundant Query 13 (Muting PermSets) — Muting status already derived from Query 2 `Type` field. (d) Committed Query 14 (now Query 13) to hardcoded field list with tolerant parsing / CSV override; removed the 5 Permissions* fields not present in the target org. (e) Fixed Section 3.4 totals and memory estimate (150–250 MB). (f) Replaced 5 MB single-write storage model with chunked+compressed `window.storage` scheme (Section 8.4) since direct Salesforce connection is not available. (g) Renumbered acceptance criteria contiguously; added BUG/UX prefix block and 23 main feature criteria. (h) Updated model reference to `claude-sonnet-4-6`. (i) Merged Admin tab's Data Source Status / Query Reference / CSV Upload into a unified per-dataset card layout. (j) Fixed version header to match body. (k) Rewrote Section 2.1 root-cause diagnosis (default-export component pattern, no speculation about a `returnReact` symbol). (l) Removed Section 7.4 Natural Language Query Mode. |
| 2026-04-v2.4 | April 2026 | Replaced the chunked+compressed `window.storage` persistence model with an **Export / Import Dataset Bundle** approach (`.pebundle` files via `CompressionStream('gzip')`). Rationale: `localStorage`/`sessionStorage` are blocked in the sandboxed iframe and `window.storage` is not a guaranteed API; a downloadable bundle file has no 5 MB cap, is portable, version-controllable, and GDPR-friendly. Updated Sections 3.3, 7.2, 7.3, and 8.4. Adjusted acceptance criteria 5, 20, and 23 to match bundle export/import semantics. Removed "shared across all users via browser storage" language throughout. |
| 2026-04-v2.5 | April 2026 | Incorporated live-app feedback: 3 new bug fixes (BUG-5 Profile detail empty; BUG-6 Modify Profile blank; BUG-7 Revoke Field selector includes Groups) and 13 UX enhancements (UX-5 per-sub-section search; UX-6 cascading object→field filter; UX-7 PermSet assigned users; UX-8 user provenance + muted fields; UX-9 group drill-down to member PermSets; UX-10 drop blank-SobjectType rows and surface counts in Admin; UX-11 field provenance chain with profile-owned flag; UX-12 internal roles only — Query 5 SOQL adds `PortalType` and `WHERE PortalType = null`; UX-13 all Change Impact selectors typeahead; UX-14 Remove PermSet from User precomputed over ~26k pairs with no pre-selection; UX-15 Delete PermSet zero-impact callout excluding unassigned, enumerating ALL covering sources; UX-16 Modify Profile typeahead; UX-17 Revoke Field cascaded typeahead with impacted users). Added Section 7.4 Detail Panel Behavior to specify uniform search/filter/provenance semantics. Expanded Section 6.2 with per-scenario detail (A–D). Added 16 acceptance criteria (BUG-5 through BUG-7, UX-5 through UX-17). Feedback items are numbered individually rather than grouped per user's direction. |
| 2026-04-v2.6 | April 2026 | Second pass of live-app feedback. Added 3 bug fixes — BUG-8 (Profile detail still empty — Finance profile evidence; root-cause hypothesis: Profile→implicit-PermSet join key; re-opens BUG-5 with stricter ACs and a concatenated-string-rendering defect); BUG-9 (portal roles still visible; client-side defensive filter required; re-opens UX-12); BUG-10 (Revoke Field typeahead matches PermSet `Type` column; restrict to name/label/developer name only). Added 29 UX enhancements — UX-18 wider layout; UX-19 Apex/VF/CustomPermission via SetupEntityAccess as first-class entry points; UX-20 "Load All Computations" admin action; UX-21 session-persistent selections across navigation (in-memory; storage APIs still blocked); UX-22 Reconcile PermSets workflow (CPQ consolidation use case); UX-23 hide zero-grant objects in Effective Objects; UX-24 Profile → Assigned Users sorted by LastLoginDate ASC null-first; UX-25 reduce horizontal scroll in Effective Fields; UX-26 PermSet Coverage Report audit; UX-27 separate User/Profile/PermSet filters on Impact Matrix; UX-28 typeahead suggestions replace live row filter; UX-29 Explorer↔Impact-Matrix cross-link; UX-30 per-row covering-source enumeration on Remove; UX-31 "Will lose access" severity flag; UX-32 impacted users above the fold; UX-33 per-user alternative covering sources on Delete; UX-34 "0 tokens" label clarified; UX-35 rename Target → Future profile; UX-36 show current profile; UX-37 side-by-side Objects/Fields/System-Perms diff; UX-38 on-screen purpose description for Revoke Field; UX-39 overlap block descriptions; UX-40 precise Duplicate PermSet definition + side-by-side compare + Near-duplicate bucket; UX-41 migration block descriptions; UX-42 Compare Profiles in Migration tab; UX-43 cluster expansion with pairwise Jaccard matrix and consensus view; UX-44 validation notices explain Fix; UX-45 informational-only tagging; UX-46 remove embedded dataset snapshot from Admin tab. Added 32 acceptance criteria (BUG-8 through BUG-10, UX-18 through UX-46). Added top-level status line for 9 BUG + 42 UX totals. |
| 2026-04-v2.7 | April 2026 | Third pass of live-app feedback on the shipped v2.6 build. Added 4 bug fixes — BUG-11 (Effective Objects "Granted by" column renders 18-digit Ids instead of resolved Profile/PermSet/Group names — fallback chain + kind pill required); BUG-12 (Object → Field cascade specified in UX-6 is not wired end-to-end; add `AppStateContext` cascade state + visible scope pill + selected-row styling); BUG-13 (Impact-Matrix Total sort only toggles descending; make it DESC / ASC / unsorted with directional arrow); BUG-14 (Change User Profile loss calc implausibly small — System Administrator → Sales User shows near-zero losses; add golden-file fixture, debug log, verify Profile-vs-Profile diff baseline and implicit-PermSet fan-out). Added 6 UX enhancements — UX-47 Prescribe Access view answering "what PermSet should I assign?" with least-privilege ranking, combination suggestions (greedy set-cover), and side-effect preview (new first-class capability); UX-48 Effective Fields column layout (drop Object column when cascade active; grouped headers when off; field-name truncate+tooltip; fit 1440 px without horizontal scroll); UX-49 Clear affordance on Delete-PermSet-Entirely search (× button + Escape key); UX-50 rename "Modify Profile" → "Change User Profile" tab-wide (UX-35 Future-profile intra-scenario label remains); UX-51 Subset relationships show substantive extras grouped by category with counts + Open-side-by-side + CSV export + auto-reclassify zero-extras as Duplicate; UX-52 unambiguous two-column paired diff labeling (`Has` / `Missing` / `Shared` / `Differs` + legend; eliminate "only in X" phrasing across UX-22 / UX-37 / UX-40 / UX-51). Added 10 acceptance criteria (BUG-11 through BUG-14, UX-47 through UX-52). Status line updated to 13 BUG + 48 UX totals. |
| 2026-04-v2.8 | April 2026 | Fourth pass of live-app feedback on the shipped v2.7 build. Added 1 bug fix — BUG-15 (Profile detail still empty for Finance: Accounts CRUD not shown and Profile-level system-perm booleans — Chatter Internal User, Create/Customize Dashboards, Customize Application — not rendered; third re-open of BUG-5/BUG-8; root-cause hypotheses split into (1) implicit-PS discovery failure per-profile, (2) Profile.Permissions* boolean columns must be read directly off the Profile row and merged with `sysPermsByParent`, (3) renderer may be keying off Profile.Id where the index stores under implicit-PS Id; fix adds a debug toggle dumping per-fanout-id counts, a `profileBooleansBySystemPermissionKey` map, legacy `ParentId=Profile.Id` fallback, a Finance fixture regression test, and an explicit Query 1 expansion to return every `Permissions*` boolean). Added 2 UX enhancements — UX-53 fluid dynamic width (removes UX-18's 1680 px cap; viewport-filling tables; resizable sidebar/right-panel splitters that persist; prose line-length protection at extreme widths); UX-54 developer-time Salesforce MCP pipeline to seed the embedded fallback with scrubbed real-org data via `mcp__salesforce__*` tools and a committed `build-fallback` script — keeps §3.2 runtime CSV-only model intact (no runtime MCP calls) while producing a realistic demo dataset that exercises every tab and precompute non-trivially. Added 4 acceptance criteria (BUG-15, UX-53, UX-54; UX-53 ACs span 5 viewport widths). Status line updated to 14 BUG + 50 UX totals + MCP-Seeded Fallback. |
| 2026-04-v2.9 | April 24 2026 | (Superseded by v3.0.) Replaced the embedded fallback (UX-54) with a repo-hosted `data/snapshot.json` fetched at runtime from `raw.githubusercontent.com`. Added bake-time fixes for v2.8 demo-dataset issues: round-robin user assignment across 10 standard profiles, UserRoleId referential-integrity enforcement, aggressive substring scrub for org-specific labels (`BH `, `_BH`, `Bullhorn`, `PNET`). The snapshot pipeline (`scripts/bake-snapshot.js`, `mcp-seed/raw/`, `docs/BAKE.md`) was added in this release and removed in v3.0. |
| 2026-05-planned-v3.1 | TBD | **Planned — not implemented.** **UX-57** (§2.73): Filter actionable analyses (Overlap & Redundancy, Migration, Delete-PermSet-Entirely, Reconcile, Remove-PermSet-from-User Impact Matrix) to customer-owned custom PermSets only by default. Adds `NamespacePrefix` to Query 2's SELECT, derives an `IsManaged` flag at index time, and ships a "Include managed-package PermSets" toggle (default OFF) plus a "Managed by" column in every PermSet table. Keeps managed-package PermSets visible in informational scenarios (Prescribe Access, User detail provenance, Group drill-down, Field/Object "Granted By"). |
| 2026-05-v3.0.1 | May 4 2026 | **Patch release — BUG-16 fix + DATA-1 SOQL expansion.** Resolves the Prescribe Access defect surfaced by the user trying to grant Transfer Record to Azam Malik. Two changes: (1) JSX `PrescribeAccessTab.allSysKeys` memo (line ~4057) drops the `if (v)` filter so the picker now shows every permission column known to the data, regardless of current truth value. (2) SOQL Query 1 (Profile) and Query 13 (PermissionSet system perms) expand SELECT to include `PermissionsTransferAnyEntity, PermissionsTransferAnyLead, PermissionsTransferAnyCase` — verified to exist on both objects in the Bullhorn org. Updated in three places: JSX SOQL constants, requirements §5.1, and the `weekly-permission-explorer-bundle` Cowork scheduled task prompt. The current bundle (`permission-explorer_<latest>.pebundle`) was rebuilt with re-fetched Profile.csv and SystemPermissions_PermSet.csv so the new columns are present. Decision points 1–9 in §2.72 were resolved with smallest-reasonable-change choices: filter dropped to "show all known", three Transfer columns added (no broader 80-column enumeration), API field names retained (no friendly-name mapping), v3.0.1 patch versioning chosen over bundling with v3.1. README/index.html/package.json/JSX header all bumped to v3.0.1. Bundle `appVersion` field is now `2026-04-v3.0.1`. |
| 2026-04-v3.0 | April 30 2026 | **Breaking architectural change.** Removed v2.9's repo-hosted runtime snapshot fetch entirely (ARCH-1). The artifact no longer makes any outbound network calls at runtime. Added IndexedDB pebundle cache with debounced auto-write after CSV upload or `.pebundle` import (ARCH-2). Added 14-day stale-cache banner (UX-55). Added tab gating so only Admin is reachable when no data is loaded (UX-56). Added the `weekly-permission-explorer-bundle` Cowork scheduled task that runs the 13 SOQL queries against the user's authed Salesforce production org weekly, paginates via uniform `Id > lastId` cursor, and produces 13 CSVs + 1 `.pebundle` in the user's Cowork folder (OPS-1). Added `scripts/build-pebundle.js` — a 265-line Node helper that reads 13 staging JSONL files, flattens nested SObject relationships (`row.Profile.Name` → `"Profile.Name"`), strips Salesforce `attributes` blobs, deduplicates by Id, writes 13 CSVs and one gzipped `.pebundle`, and atomically rotates prior outputs. `.gitignore` cleaned: dropped `mcp-seed/`, added `bundles/` and `*.pebundle` (OPS-2). README, JSX header, index.html bootstrap comment, and package.json all updated to v3.0 (DOC-1). Removed: `data/snapshot.json`, `scripts/bake-snapshot.js`, `scripts/build-fallback.js`, `docs/BAKE.md`, `mcp-seed/`, `GITHUB_SNAPSHOT_*` constants, `fetchGithubSnapshot()`, `snapshotMeta` state, `source === "github"` rendering branches. Added 7 acceptance criteria (ARCH-1, ARCH-2, UX-55, UX-56, OPS-1, OPS-2, DOC-1) and 3 main feature criteria (24, 25, 26). **Bug fix carried into v3.0**: Query 5 (UserRole) corrected from `WHERE PortalType = null` to `WHERE PortalType = 'None'`. The original filter shipped in v2.5–v2.9 returned zero rows in production orgs because Salesforce stores the literal picklist value `'None'` for internal roles, never SQL NULL. With the correct filter, Bullhorn returns 162 internal roles (matching the §3.4 reference count). Updated in JSX SOQL constants, error-message copy, requirements §2.14, §5.1, §6.3, §7.3 admin notice example, UX-12 acceptance criterion, and the Cowork scheduled task prompt. |
