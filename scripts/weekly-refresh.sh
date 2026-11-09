#!/bin/bash
# weekly-refresh.sh
# Full Permission Explorer data refresh: 18 Salesforce exports -> staging -> build-pebundle.js
# Runs entirely on this Mac via the sf CLI. ALL exports use REST auto-paging (sf data query
# -r csv) — never Bulk API 2.0; see note at the dataset definitions for why.
# Invoked by the Cowork scheduled task; the task only reads the tail of the log afterward.
#
# Exit codes: 0 ok | 2 auth/org problem | 3 export failure | 4 sanity-bound breach | 5 build failure
set -uo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
# REST queries silently truncate at 50,000 rows without this (FieldPermissions is ~324k):
export SF_ORG_MAX_QUERY_LIMIT=2000000

ORG=bullhorn
PROD_URL="https://bullhorn.my.salesforce.com"
ROOT="/Users/manoj.aggarwal/Documents/Cowork/PermissionExplorer"
BUNDLES="$ROOT/bundles"
LOG="$BUNDLES/refresh.log"
HISTORY="$BUNDLES/run_history.jsonl"
STAGE=$(mktemp -d /tmp/permission-explorer-stage.XXXXXX)
PY=/usr/bin/python3
LOCKFILE=/tmp/permission-explorer-refresh.lock

mkdir -p "$BUNDLES"

# ---------- 0. Single-instance guard ----------
# The Cowork scheduled task invokes this script via osascript with a timeout well short
# of the script's real 15-25min runtime. When osascript times out it can retry, spawning
# a second concurrent run that redoes all 13 exports (confirmed 2026-07-31: two, then three,
# overlapping instances in one morning). Refuse to start if a prior instance is still alive.
if [ -f "$LOCKFILE" ]; then
  OLD_PID=$(cat "$LOCKFILE" 2>/dev/null)
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    rm -rf "$STAGE"
    printf '[SKIP] %s weekly-refresh.sh already running (pid %s) — exiting without re-running\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$OLD_PID" >> "$LOG"
    echo "REFRESH SKIPPED: another instance (pid $OLD_PID) is already running"
    exit 0
  fi
  # Stale lock (owning process no longer exists) — safe to clear and proceed.
  rm -f "$LOCKFILE"
fi
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

exec > >(tee "$LOG") 2>&1
echo "=== Permission Explorer weekly refresh $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

fail() { # code, message
  echo "REFRESH FAILED ($1): $2"
  printf '%s\n%s\n' "$(date -u)" "$2" > "$BUNDLES/LAST_RUN_ERROR.txt"
  rm -rf "$STAGE"
  exit "$1"
}

# ---------- 1. Verify production org + auth ----------
ORG_JSON=$(sf org display -o "$ORG" --json 2>/dev/null) || fail 2 "sf org display failed — run: sf org login web -a bullhorn"
echo "$ORG_JSON" | grep -q "\"instanceUrl\": \"$PROD_URL\"" || fail 2 "Org alias '$ORG' is not production ($PROD_URL). Aborting."
echo "$ORG_JSON" | grep -q '"connectedStatus": "Connected"' || fail 2 "Org '$ORG' not connected — run: sf org login web -a bullhorn"
echo "[OK] org=$ORG production connected"

# ---------- 2. Resolve app version ----------
if [ -f "$ROOT/VERSION" ]; then APP_VERSION=$(tr -d '[:space:]' < "$ROOT/VERSION");
elif git -C "$ROOT" describe --tags --abbrev=0 >/dev/null 2>&1; then APP_VERSION="2026-06-$(git -C "$ROOT" describe --tags --abbrev=0)";
else APP_VERSION="2026-06-v3.7.0"; fi
echo "[OK] app-version=$APP_VERSION"

# ---------- 3. Dataset definitions ----------
# key|mode|soql — mode is ALWAYS rest. Do NOT switch the large objects to Bulk API 2.0:
# validated 2026-06-12 that bulk silently returns FEWER rows than COUNT() on these system
# objects (ObjectPermissions 19,736 of 33,729; FieldPermissions 312,615 of 324,153) with
# JobComplete status — same quirk class as the PermissionSetTabSetting shortfall.
# REST auto-paging (sf data query -r csv) returns the complete set (33,729 verified).
# DATA-3 v3.10 (requirements_v3_0.md §2.99): Profile and SystemPermissions_PermSet carry EVERY
# Permissions* boolean, exported in 3 chunks each (Profile, Profile_2, Profile_3;
# SystemPermissions_PermSet, _2, _3) to stay under the REST URL length limit. The app merges
# chunks by Id (mergeChunksById) and auto-loads any column it doesn't hardcode.
# The column lists are built at run time from the org's own describe (Profile and PermissionSet
# do NOT share an identical field set), so they can never drift: a hardcoded list broke the
# 2026-11-09 run (PermissionsCustomAppsOnFSMobile / PermissionsRegrelloUser don't exist on
# Profile) and silently omitted 113 newer permissions (CreateTask, AddToCampaign, ConvertProspect...).
GEN_LINES=$("$PY" - "$ORG" <<'PYEOF'
import json, subprocess, sys
org = sys.argv[1]
MAXLEN = 14000   # REST GET URL limit is ~16KB once URL-encoded
def perm_fields(sobj):
    r = subprocess.run(["sf", "sobject", "describe", "-s", sobj, "-o", org, "--json"],
                       capture_output=True, text=True, timeout=180)
    if r.returncode != 0:
        sys.stderr.write(f"describe {sobj} failed: {r.stderr[:300]} {r.stdout[:300]}\n"); sys.exit(1)
    fs = json.loads(r.stdout)["result"]["fields"]
    names = sorted(f["name"] for f in fs if f["name"].startswith("Permissions") and f["type"] == "boolean")
    if len(names) < 500:
        sys.stderr.write(f"describe {sobj}: only {len(names)} Permissions* fields — refusing\n"); sys.exit(1)
    return names
def emit(prefix, sobj, head, where):
    names = perm_fields(sobj)
    n = len(names); size = -(-n // 3)
    chunks = [names[i*size:(i+1)*size] for i in range(3)]
    for i, ch in enumerate(chunks):
        cols = (head if i == 0 else "Id") + ", " + ", ".join(ch)
        q = f"SELECT {cols} FROM {sobj}" + (f" WHERE {where}" if where else "")
        if len(q) > MAXLEN:
            sys.stderr.write(f"{prefix} chunk {i+1} query is {len(q)} chars (> {MAXLEN})\n"); sys.exit(1)
        key = prefix + ("" if i == 0 else f"_{i+1}")
        print(f"{key}|rest|{q}")
    sys.stderr.write(f"[GEN] {prefix}: {n} Permissions* fields in 3 chunks\n")
emit("Profile", "Profile", "Id, Name, UserType, Description, UserLicense.Name, LastModifiedDate", None)
emit("SystemPermissions_PermSet", "PermissionSet", "Id, Name, Label", "IsOwnedByProfile = false")
PYEOF
) || fail 3 "could not build Permissions* chunk queries from org describe"

read -r -d '' DATASETS <<'EOF'
PermissionSet|rest|SELECT Id, Name, Label, Description, IsCustom, Type, IsOwnedByProfile, ProfileId, NamespacePrefix FROM PermissionSet
PermissionSetGroup|rest|SELECT Id, DeveloperName, MasterLabel, Description FROM PermissionSetGroup
User|rest|SELECT Id, Name, Email, Profile.Name, ProfileId, UserRoleId, LastLoginDate FROM User WHERE UserType = 'Standard' AND IsActive = true
UserRole|rest|SELECT Id, Name, DeveloperName, ParentRoleId, PortalType FROM UserRole WHERE PortalType = 'None'
PermissionSetGroupComponent|rest|SELECT Id, PermissionSetId, PermissionSet.Name, PermissionSetGroupId, PermissionSetGroup.MasterLabel FROM PermissionSetGroupComponent
PermissionSetTabSetting|rest|SELECT Id, Name, Visibility, ParentId, Parent.Name FROM PermissionSetTabSetting
CustomPermission|rest|SELECT Id, DeveloperName, MasterLabel FROM CustomPermission
PermissionSetAssignment|rest|SELECT Id, PermissionSet.Id, PermissionSet.Name, PermissionSet.Label, PermissionSet.IsOwnedByProfile, PermissionSet.Type, PermissionSetGroupId, AssigneeId FROM PermissionSetAssignment WHERE Assignee.IsActive = true AND Assignee.UserType = 'Standard'
ObjectPermissions|rest|SELECT Id, SobjectType, PermissionsCreate, PermissionsRead, PermissionsEdit, PermissionsDelete, PermissionsViewAllRecords, PermissionsModifyAllRecords, ParentId, Parent.Name, Parent.IsOwnedByProfile, Parent.ProfileId FROM ObjectPermissions
SetupEntityAccess|rest|SELECT Id, SetupEntityId, SetupEntityType, ParentId, Parent.Name FROM SetupEntityAccess WHERE SetupEntityType IN ('ApexClass','ApexPage','CustomPermission','TabSet')
FieldPermissions|rest|SELECT Id, Field, SobjectType, PermissionsRead, PermissionsEdit, ParentId, Parent.Name, Parent.IsOwnedByProfile, Parent.ProfileId FROM FieldPermissions
SetupAuditTrail|rest|SELECT Id, CreatedDate, Action, Display, CreatedById FROM SetupAuditTrail WHERE Action IN ('PermSetAssign','PermSetUnassign','PermSetGroupAssign','PermSetGroupUnassign')
EOF
DATASETS="$GEN_LINES"$'\n'"$DATASETS"

count_where() { # extract WHERE clause (if any) from a SOQL string after FROM <obj>
  echo "$1" | sed -E 's/^SELECT .* FROM /FROM /; s/ ORDER BY .*$//'
}



# ---------- 4. Export + COUNT preflights ----------
echo "{}" > "$STAGE/EXPECTED_COUNTS.json"
while IFS='|' read -r KEY MODE SOQL; do
  [ -z "$KEY" ] && continue
  CNT_SOQL="SELECT COUNT() $(count_where "$SOQL")"
  CNT=$(sf data query -o "$ORG" -q "$CNT_SOQL" --json 2>/dev/null | $PY -c 'import json,sys; print(json.load(sys.stdin)["result"]["totalSize"])') \
    || fail 3 "COUNT preflight failed for $KEY"
  $PY - "$STAGE/EXPECTED_COUNTS.json" "$KEY" "$CNT" <<'PYEOF'
import json, sys
p, k, c = sys.argv[1], sys.argv[2], int(sys.argv[3])
d = json.load(open(p)); d[k] = c; json.dump(d, open(p, "w"))
PYEOF
  CSV="$STAGE/$KEY.csv"
  if [ "$MODE" = bulk ]; then
    sf data export bulk -o "$ORG" -q "$SOQL" --output-file "$CSV" --result-format csv --wait 30 >/dev/null 2>&1 \
      || fail 3 "Bulk export failed for $KEY"
  else
    sf data query -o "$ORG" -q "$SOQL" --result-format csv > "$CSV" 2>"$STAGE/$KEY.err" \
      || fail 3 "REST export failed for $KEY: $(grep -v '^$' "$STAGE/$KEY.err" | tail -3 | tr '\n' ' ' | cut -c1-400)"
  fi
  ROWS=$(( $(wc -l < "$CSV") - 1 )); [ "$ROWS" -lt 0 ] && ROWS=0
  echo "[EXPORT] $KEY mode=$MODE count=$CNT rows=$ROWS"
done <<< "$DATASETS"

# ---------- 5. Sanity bounds vs last run (±20%), PSTabSetting allowance 2800 ----------
$PY - "$STAGE/EXPECTED_COUNTS.json" "$HISTORY" "$STAGE" <<'PYEOF' || fail 4 "Sanity-bound breach — see log above"
import json, os, sys, csv
exp = json.load(open(sys.argv[1]))
hist_path, stage = sys.argv[2], sys.argv[3]
prior = None
if os.path.exists(hist_path):
    lines = [l for l in open(hist_path) if l.strip()]
    if lines: prior = json.loads(lines[-1])
ok = True
for key, cnt in exp.items():
    with open(os.path.join(stage, key + ".csv")) as f:
        rows = sum(1 for _ in csv.reader(f)) - 1
    # PermissionSetTabSetting: COUNT() overcounts ~3,370 vs REST-accessible rows
    # (Salesforce sharing/namespace artifact — confirmed 2026-06-17).
    # Skip staged-vs-COUNT; track drift on staged rows vs prior staged rows instead.
    if key == "PermissionSetTabSetting":
        if prior and key in prior and prior[key] > 0:
            drift = abs(rows - prior[key]) / prior[key]
            if drift > 0.20:
                print(f"[SANITY] {key}: staged {rows} drifts {drift:.0%} vs prior staged {prior[key]} — FAIL"); ok = False
        continue
    allow = 0
    # SetupAuditTrail: rolling 6-month event log — still checked against COUNT(), but no week-over-week drift check.
    if key == "SetupAuditTrail":
        if cnt - rows > allow or rows > cnt:
            print(f"[SANITY] {key}: staged {rows} vs COUNT {cnt} (allowance {allow}) — FAIL"); ok = False
        continue
    if cnt - rows > allow or rows > cnt:
        print(f"[SANITY] {key}: staged {rows} vs COUNT {cnt} (allowance {allow}) — FAIL"); ok = False
    if prior and key in prior and prior[key] > 0:
        drift = abs(cnt - prior[key]) / prior[key]
        if drift > 0.20:
            print(f"[SANITY] {key}: COUNT {cnt} drifts {drift:.0%} vs prior {prior[key]} — FAIL"); ok = False
print("[SANITY] all datasets within bounds" if ok else "[SANITY] FAILURES above")
sys.exit(0 if ok else 1)
PYEOF

# ---------- 6. CSV -> JSONL staging for the build script ----------
for CSV in "$STAGE"/*.csv; do
  KEY=$(basename "$CSV" .csv)
  $PY - "$CSV" "$STAGE/$KEY.jsonl" <<'PYEOF' || fail 3 "CSV->JSONL conversion failed"
import csv, json, sys
with open(sys.argv[1]) as f, open(sys.argv[2], "w") as out:
    for row in csv.DictReader(f):
        out.write(json.dumps(row) + "\n")
PYEOF
done
echo "[OK] staging converted to JSONL"

# ---------- 7. Build ----------
node "$ROOT/scripts/build-pebundle.js" \
  --stage "$STAGE" \
  --out "$BUNDLES" \
  --source-org "$ORG" \
  --app-version "$APP_VERSION" || fail 5 "build-pebundle.js exited non-zero"

# ---------- 8. Append run history ----------
TS=$(date -u +%Y-%m-%d)
BUNDLE_SRC=$(ls -t "$BUNDLES"/*.pebundle 2>/dev/null | head -1 | xargs basename | sed 's/\.pebundle//')
rows() { echo $(( $(wc -l < "$BUNDLES/$1.csv") - 1 )); }
printf '{"ts":"%s","source":"%s","Profile":%s,"PermissionSet":%s,"PermissionSetGroup":%s,"User":%s,"UserRole":%s,"PermissionSetGroupComponent":%s,"PermissionSetTabSetting":%s,"CustomPermission":%s,"SystemPermissions_PermSet":%s,"PermissionSetAssignment":%s,"ObjectPermissions":%s,"SetupEntityAccess":%s,"FieldPermissions":%s}\n' \
  "$TS" "$BUNDLE_SRC" \
  "$(rows Profile)" "$(rows PermissionSet)" "$(rows PermissionSetGroup)" \
  "$(rows User)" "$(rows UserRole)" "$(rows PermissionSetGroupComponent)" \
  "$(rows PermissionSetTabSetting)" "$(rows CustomPermission)" "$(rows SystemPermissions_PermSet)" \
  "$(rows PermissionSetAssignment)" "$(rows ObjectPermissions)" "$(rows SetupEntityAccess)" "$(rows FieldPermissions)" \
  >> "$HISTORY"

# ---------- 9. Build Claude/SQL query layer (pe.duckdb, MANIFEST.json, changes_latest.*) ----------
# NON-FATAL: a failure here must never fail the refresh. Needs `pip3 install duckdb` on the Mac.
PYDB=$PY; [ -x /opt/homebrew/bin/python3 ] && PYDB=/opt/homebrew/bin/python3
if "$PYDB" -c 'import duckdb' 2>/dev/null; then
  "$PYDB" "$ROOT/scripts/build-pe-db.py" --bundles "$BUNDLES" --app-version "$APP_VERSION" --source "$BUNDLE_SRC" \
    || echo "[WARN] build-pe-db.py failed — pe.duckdb not updated (refresh itself is OK)"
else
  echo "[WARN] duckdb python module missing ($PYDB) — run: $PYDB -m pip install duckdb ; skipping pe.duckdb build"
fi

rm -rf "$STAGE"
rm -f "$BUNDLES/LAST_RUN_ERROR.txt"
SIZE=$(ls -lh "$BUNDLES"/*.pebundle | head -1 | awk '{print $5}')
echo "REFRESH OK bundle=$BUNDLE_SRC size=$SIZE app-version=$APP_VERSION ts=$TS"
