// OBSOLETE — v2.8 embedded-fallback bake script.
//
// v2.9 removed the embedded fallback. Use `scripts/bake-snapshot.js` instead;
// it reads the same mcp-seed/raw/*.json files and writes data/snapshot.json,
// which the artifact fetches at runtime from GitHub raw.
//
// Left here as a breadcrumb for anyone diffing against v2.8. Safe to delete
// once the commit history no longer needs this reference.

console.error("build-fallback.js is obsolete. Use `node scripts/bake-snapshot.js` instead.");
process.exit(1);
