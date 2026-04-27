# Refreshing the demo snapshot

`data/snapshot.json` is the baked demo dataset fetched by the artifact at runtime. It is regenerated offline from raw SOQL exports by `scripts/bake-snapshot.js`.

## One-time setup

1. A Salesforce org you can run SOQL against (sandbox recommended — production has too much data and too much PII to be worth shipping).
2. `sf` CLI authed against that org *or* a Claude Cowork session with the Salesforce MCP server configured.

## Steps

1. **Export raw SOQL.** Run each of the 13 Required Export Queries (see `requirements_v2_8.md` §5.1) against the reference org. Save each result as JSON under `mcp-seed/raw/`:

   ```
   mcp-seed/raw/Q1_Profile.json
   mcp-seed/raw/Q2_PermissionSet.json
   mcp-seed/raw/Q3_PermissionSetGroup.json
   mcp-seed/raw/Q4_User.json
   mcp-seed/raw/Q5_UserRole.json
   mcp-seed/raw/Q6_PermissionSetAssignment.json
   mcp-seed/raw/Q7_PermissionSetGroupComponent.json
   mcp-seed/raw/Q8_ObjectPermissions.json
   mcp-seed/raw/Q9_FieldPermissions.json
   mcp-seed/raw/Q10_PermissionSetTabSetting.json
   mcp-seed/raw/Q11_SetupEntityAccess.json
   mcp-seed/raw/Q12_CustomPermission.json
   mcp-seed/raw/Q13_SystemPermissions.json
   ```

   Each file must be shaped `{ "query": "QN", "rows": [...] }` with the SOQL record fields preserved.

2. **Run the bake.**

   ```
   node scripts/bake-snapshot.js
   ```

   The bake script will:
   - Apply deterministic SHA-256-keyed pseudonymization to every Id, name, and email.
   - Round-robin user assignments across 10 standard profiles so every profile has ≥3 users (fixes v2.8 coverage gap).
   - Null out `UserRoleId` on any user whose scrubbed role didn't survive into `UserRole[]`.
   - Scrub org-specific substrings (e.g. `"BH Internal User"` → `"Internal User"`).
   - Run a known-bad-token grep — any hit aborts the bake.
   - Write `data/snapshot.json`.

3. **Commit & push.**

   ```
   git add data/snapshot.json
   git commit -m "Refresh demo snapshot from <sandbox alias> @ <YYYY-MM-DD>"
   git push
   ```

   The shipped artifact begins serving the new snapshot as soon as GitHub's raw CDN picks up the commit (usually within a few seconds).

## Safety review

`mcp-seed/raw/` is in `.gitignore`. Do not commit raw exports — they contain real PII. Only `data/snapshot.json` (scrubbed) gets pushed.

Before pushing, eyeball the snapshot:

```
grep -cE '@(bullhorn|salesforce|example\.com)' data/snapshot.json    # expect 0
grep -cE '\bBH [A-Z]' data/snapshot.json                              # expect 0
grep -cE '00[A-Za-z][0-9a-zA-Z]{15,17}' data/snapshot.json            # expect 0 — all scrubbed Ids are 18-char pseudonyms with key prefix preserved but tail rehashed
```

## Troubleshooting

- **"Safety grep FAILED"** — the scrubber found a real-org token in its output. Most likely a new org-specific label in the source data that isn't on the scrub list. Add the pattern to `blockedSubstrings` in `scripts/bake-snapshot.js` and re-run.
- **"UserRole[] is empty"** — your source org has no internal roles (only portal). The bake script synthesizes 3 minimal internal roles in this case; verify they appear in the output.
- **"snapshot.json > 10 MB"** — tighten the ParentId scope on Q8/Q9/Q11 when you re-export. The target is a few thousand rows across the big tables, not the full org.
