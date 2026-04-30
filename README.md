# Permission Explorer

A single-file React artifact for interrogating Salesforce permission data. Admins export CSVs from their org, upload them into the app, and every analysis runs in-memory — no live Salesforce connection, no OAuth, no Connected App.

This is the v3.0 release. The artifact is now strictly CSV-driven: there is no built-in demo dataset, and the app never makes any network calls at runtime. Data enters the app through CSV upload or `.pebundle` import, and persists across sessions via an IndexedDB cache.

## Layout

```
PermissionExplorer/
├── PermissionExplorer.jsx       # The artifact. Single-file, React + JSX.
├── index.html                   # Browser entry point.
├── package.json
├── requirements_v2_5.md         # Historical specs.
├── requirements_v2_6.md
├── requirements_v2_7.md
├── requirements_v2_8.md
└── README.md
```

## Runtime data flow

On startup the artifact attempts to read a previously-cached dataset from IndexedDB. If a cache exists, the app boots into the Explorer tab in well under a second — no network, no re-upload. If no cache exists, the app boots into the Admin tab with all other tabs hidden, and prompts you to either upload the 13 CSV files or import a `.pebundle`.

After a successful CSV upload (the per-file uploader debounces and writes once after the batch settles) or a `.pebundle` import, the app silently writes the parsed dataset back to IndexedDB. The next session starts from that cache automatically.

If the cache timestamp is older than 14 days, the app surfaces a yellow staleness banner prompting a refresh. Click Reset (in Admin) to clear both the in-memory dataset and the cache; click Clear Cache to clear only the persisted copy while keeping the current view.

The artifact never calls Salesforce or any other network endpoint.

## Generating fresh data

There are two ways to refresh the dataset:

1. **Manual CSV upload.** From the Admin tab, click "View SOQL query" on each card to copy the canonical query, run it against your Salesforce org with the export tool of your choice (Workbench, Data Loader, sf CLI), and upload the resulting CSV into the matching slot.

2. **Weekly Cowork scheduled task.** A scheduled Cowork task runs the 13 SOQL queries against the user's authed Salesforce org once a week, packages the results into both the 13 raw CSV files and a single `.pebundle`, and drops them in the user's Cowork project folder. The previous week's outputs are removed when the new ones are written. The user opens the artifact and clicks "Import Bundle" against the latest `.pebundle` to refresh.

The scheduled task is the simplest path. It keeps Salesforce credentials out of the browser entirely — the bundle is built offline by Cowork and the artifact only sees a static file.

## The 13 Required Export Queries

See `requirements_v2_8.md` §5.1 for the canonical SOQL. The Admin tab also displays every query inline with a Copy button. The 13 queries map 1:1 to the 13 expected CSV files.

## Safety

- No live Salesforce credentials in the artifact.
- No outbound network calls at runtime.
- The IndexedDB cache lives only in your browser profile. If you use a shared workstation, run in a private/incognito window or click Clear Cache before closing the tab.
