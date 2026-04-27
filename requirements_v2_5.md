---
title: "Salesforce Permission Explorer — Engineering Work Ticket"
---

# ENGINEERING WORK TICKET · CONFIDENTIAL

## Salesforce Permission Explorer

Claude-Powered Multi-Dimensional Permission Analysis Tool

| Field | Value |
|---|---|
| Version | 2026-04-v2.5 |
| Status | Active Development — 6 Bug Fixes + 13 UX Enhancements + Architecture Clarifications + Persistence Redesign |
| Ticket Type | New Feature (Full Build) + In-Flight Corrections |
| Priority | High |
| Platform | Claude.ai Artifact (React JSX) |
| Data Source | CSV Upload (Salesforce SOQL exports) |
| Auth Method | None — CSV file upload only |
| Date | April 2026 |

---

## 1. Overview & Objectives

Build a Claude-powered interactive permission explorer for Salesforce that allows administrators and security teams to interrogate permission data from multiple dimensions. The tool surfaces insights across users, profiles, permission sets, permission set groups, objects, and fields — supporting use cases ranging from day-to-day access audits to full-scale profile-to-permission-set-group migration planning.

The tool is entirely CSV-driven. Admins export data from their Salesforce org using the provided SOQL queries (via Workbench, Data Loader, or any Salesforce query tool), upload the CSV files to the app, and all analysis runs instantly in-memory. No authentication, no API calls at runtime, no Connected App required.

### Primary Goals

- Multi-directional permission exploration: start from a user, object, field, profile, or permission set and navigate outward
- Change impact analysis: understand consequences before modifying permissions
- Redundancy and overlap detection: identify consolidation opportunities
- Profile-to-PermSet Group migration planning: quantify coverage gaps and migration readiness
- Role hierarchy context: surface permission inconsistencies across organizational roles
- Reporting and export: generate auditable outputs for compliance and stakeholder review

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

**SOQL change:** Query 5 (User Roles) must add `PortalType` to the SELECT and filter `WHERE PortalType = null` at export time. See the updated query in Section 5.1.

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

---

## 3. Technical Architecture

### 3.1 Runtime

Claude Artifact (React JSX) calling the Anthropic API (`claude-sonnet-4-6`). The artifact uses Claude as an intelligent analysis engine — the user uploads CSV exports from Salesforce, Claude parses and indexes the data in memory, and the user can explore permissions, run analyses, and surface findings. No server, no authentication, no API calls to Salesforce at runtime.

### 3.2 Data Source — CSV Upload Only

There is no live Salesforce connection. Attempting a direct Salesforce connection was considered and rejected because OAuth tokens cannot be obtained in the target environment (sandboxed artifact iframe + no Connected App setup path available to the user). The tool is therefore CSV-driven by design.

All data comes from CSV files that the admin exports from their org using the SOQL queries provided in the Admin tab (Section 5). This approach works for any Salesforce environment — production, sandbox, scratch org — without requiring a Connected App, OAuth setup, or any Salesforce configuration.

Supported export tools: Salesforce Workbench, Data Loader, SOQL query editor in Setup, SFDX / Salesforce CLI, or any tool that can run SOQL and export CSV.

### 3.3 Data Loading Strategy — CSV Upload + Bundle Export/Import

The admin exports CSVs from their Salesforce org and uploads them to the app. The app parses and validates each file on upload, cross-references them for join integrity, and surfaces warnings. Once all required files are present, the admin can click **Export Bundle** to download a single `.pebundle` file (gzipped via the browser's built-in `CompressionStream`, typically 15–30 MB). That file is how datasets are shared with teammates or auditors — via email, shared drive, git, or any other file-transfer channel. Other users reload the dataset by clicking **Import Bundle** and selecting the file.

Rationale for the bundle model over browser-persistent shared storage: Claude.ai artifacts run in a sandboxed iframe where `localStorage` / `sessionStorage` are blocked and no `window.storage` API is guaranteed to be present. Chunking 150–250 MB of parsed data across 5 MB keys is also fragile. A downloadable bundle file is portable, version-controllable, GDPR-friendly (the user controls where their data goes), and has no artificial size cap. See Section 8.4 for the full format spec.

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

```
SELECT Id, Name, UserType, Description, PermissionsModifyAllData, PermissionsViewAllData, PermissionsApiEnabled, PermissionsAuthorApex FROM Profile ORDER BY Name
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

Filters to internal roles only. `PortalType = null` excludes Partner and CustomerPortal roles, which pollute the internal hierarchy with partner-portal user containers that are not relevant to the permission-modeling use cases. See Section 2.14 (UX-12).

```
SELECT Id, Name, DeveloperName, ParentRoleId, PortalType FROM UserRole WHERE PortalType = null ORDER BY Name
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

```
SELECT Id, Name, Label, PermissionsModifyAllData, PermissionsViewAllData, PermissionsManageUsers, PermissionsAuthorApex, PermissionsCustomizeApplication, PermissionsManageCustomPermissions, PermissionsApiEnabled, PermissionsBulkApiHardDelete, PermissionsDataExport, PermissionsViewSetup, PermissionsManageRoles, PermissionsRunReports FROM PermissionSet WHERE IsOwnedByProfile = false ORDER BY Label
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

On first load the app must NOT show a welcome splash screen. It goes directly to the main explorer UI.

If no dataset is in memory, the UI renders in its empty/unpopulated state with a non-blocking banner directing the user to the Admin tab to either (a) upload CSV files, or (b) import a `.pebundle` file shared by a teammate. If an embedded fallback dataset is shipped with the artifact, it is loaded automatically and a "Using embedded fallback" badge is shown in the header. Once a user uploads CSVs or imports a bundle, the header badge updates to "Dataset loaded — imported X ago" with a source label (CSV upload / Bundle import / Embedded).

### 7.3 Admin Tab — Unified Query + Upload View with Bundle Export/Import

**Structural change in v2.3+:** "Data Source Status," "Query Reference," and "CSV Upload" are merged into a single unified per-dataset card list. Each of the 13 required datasets has one card containing everything needed for that dataset — no jumping between a query section and an upload section. Bundle Export/Import sits as a top-of-tab control bar above the cards.

**Top-of-tab control bar (above the per-dataset cards):**

- **Data source indicator**: "CSV upload in progress (N/13 staged)", "Bundle imported — <filename> — imported Xmin ago", "Using embedded fallback", or "No dataset loaded".
- **Import Bundle** button: opens a file picker filtered to `.pebundle`. On import, the bundle is decompressed, parsed, and loaded into memory. Progress indicator is shown during decompression of large bundles (>20 MB).
- **Export Bundle** button: serializes all currently-loaded datasets into a single gzipped `.pebundle` file and triggers a browser download. Disabled unless all 13 required datasets are loaded and the cross-reference validator is green (or only has yellow warnings).
- **Reset** button: clears the in-memory dataset and returns to the empty/embedded state.
- A short inline note under the control bar, visible at all times, explaining the model: "Datasets are shared by exporting a .pebundle file and sending it to teammates. There is no automatic cross-user sync — by design, so you control where your org's permission data lives."

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

### 8.4 Data Persistence & Sharing — Export/Import Dataset Bundle (revised in v2.4)

The v2.3 spec proposed a chunked+compressed `window.storage` scheme. That was rejected before implementation because (a) Claude.ai artifacts run in a sandboxed iframe where `localStorage` / `sessionStorage` are blocked, (b) no `window.storage` API is guaranteed, and (c) chunking 150–250 MB of parsed data across 5 MB keys is architecturally fragile. A direct Salesforce connection is also unavailable because OAuth tokens cannot be obtained in this environment.

The v2.4 design replaces browser-persistent shared storage with a downloadable **Dataset Bundle** file. This is genuinely simpler and stronger: no 5 MB cap, real portability, version-controllable, no dependency on browser storage APIs, and GDPR-friendly because the user controls where their data physically lives.

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
| UX-12 | User Roles list and Role hierarchy show only internal roles (PortalType = null); any portal rows in an uploaded CSV are filtered defensively and trigger a yellow Admin warning | Upload UserRole.csv containing portal rows, verify filtering + warning |
| UX-13 | Every Change Impact selector is a typeahead with case-insensitive matching across name/label/developer name and keyboard navigation; no long scroll dropdown anywhere | Open each scenario, verify typeahead behavior |
| UX-14 | Remove PermSet from User runs without any pre-selection — a precompute produces an Impact Matrix over all (User, PermSet) pairs with a visible progress indicator; zero-impact pairs are highlighted | Trigger scenario cold, verify matrix renders within a few seconds with correct zero-impact flags |
| UX-15 | Delete PermSet Entirely scenario surfaces a zero-impact callout listing every PermSet whose deletion results in no effective-permission loss; unassigned PermSets are excluded from this callout (they appear under Orphaned PermSets); each redundant PermSet enumerates ALL covering sources per permission | Seed a PermSet whose every grant is redundantly covered by two other PermSets, verify it appears with both covering sources listed; seed an unassigned PermSet, verify absence from the callout and presence under Orphaned PermSets |
| UX-16 | Modify Profile scenario uses typeahead for both User and Target Profile selectors | Open scenario, verify both selectors are typeaheads |
| UX-17 | Revoke Field from PermSet uses three cascaded typeaheads (PermSet → Object → Field). Object typeahead is filtered to objects the selected PermSet grants. Field typeahead is filtered to fields of the selected object that the selected PermSet grants. After all three are picked, the impacted-users list renders with covering-sources enumeration | Run scenario end-to-end for a PermSet granting 2 objects and multiple fields, verify cascaded filtering and impacted users |

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

---

## 10. Out of Scope

- Live Salesforce API connection — this is a CSV-driven offline tool (OAuth tokens are not obtainable in the target environment)
- OAuth, Connected Apps, or any Salesforce authentication
- Writing back to Salesforce — read-only analysis only
- Event Monitoring / field usage analytics (separate data source)
- Sharing rules, OWD, and record-level security (separate system from permission sets)
- Natural-language / free-text question answering over the dataset (removed in v2.3)
- Ad-hoc audit queries (dormant users, non-standard profiles, orphaned PermSets via SOQL, etc.) — these are admin-initiated point-in-time checks that run directly against Salesforce and are not part of this app's scope; admins who want them can run them in Workbench independently
- Multi-org comparison in v1

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
