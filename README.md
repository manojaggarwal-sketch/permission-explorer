# Permission Explorer

A single-file React artifact for interrogating Salesforce permission data. Admins export CSVs from their org, upload them into the app, and every analysis runs in-memory — no live Salesforce connection, no OAuth, no Connected App.

This repo is the home of the explorer JSX plus the offline **bake pipeline** that seeds a demo snapshot from a reference Salesforce sandbox. The pipeline runs once at build time — the shipped artifact never calls Salesforce.

## Layout

```
PermissionExplorer/
├── PermissionExplorer.jsx       # The artifact. Single-file, React + JSX.
├── data/
│   └── snapshot.json            # Baked demo dataset. Fetched at runtime from GitHub raw.
├── scripts/
│   └── bake-snapshot.js         # Reads mcp-seed/raw/*.json → writes data/snapshot.json.
├── mcp-seed/                    # (gitignored) Raw un-scrubbed SOQL exports.
│   └── raw/                     # Drop 13 SOQL JSON files here before running bake.
├── docs/
│   └── BAKE.md                  # How to refresh the demo snapshot from a new org.
├── requirements_v2_8.md         # Engineering work ticket / spec.
└── .gitignore
```

## Runtime data flow

At startup the artifact attempts to fetch `data/snapshot.json` from this repo's `main` branch via `raw.githubusercontent.com`. If the fetch succeeds, the snapshot becomes the working dataset. If it fails (offline, rate-limited, repo private), the app shows an empty state with a prompt to upload CSVs manually.

CSV upload is always available as a manual override from the Admin tab, regardless of whether the snapshot loaded.

To point the app at a fork or a different branch, edit the `GITHUB_SNAPSHOT_URL` constant near the top of `PermissionExplorer.jsx`.

## Refreshing the snapshot

See `docs/BAKE.md`. The one-line version:

```
# From a Claude Cowork session with Salesforce MCP configured:
node scripts/bake-snapshot.js
```

The script reads the 13 SOQL export files under `mcp-seed/raw/`, applies deterministic SHA-256-keyed pseudonymization to every Id / name / email, fixes join gaps (e.g. ensures every user's `UserRoleId` resolves), distributes users across the 10 standard profiles for coverage, and emits `data/snapshot.json`. A safety grep aborts the build if any known real-org token survives.

## Safety invariants

- No live Salesforce credentials in the shipped artifact.
- No real employee names, emails, or 18-char Salesforce Ids in `data/snapshot.json` (enforced by the bake script's grep list).
- No runtime MCP calls. The explorer is a pure browser app; the snapshot is static JSON fetched over HTTPS.

## Versioning

Current version: **v2.9** (see `PermissionExplorer.jsx` header for changelog). The v2.8 release shipped the data inline; v2.9 moved it to this repo.
