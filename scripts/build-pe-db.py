#!/usr/bin/env python3
"""
build-pe-db.py — build bundles/pe.duckdb (query layer for Claude / SQL) from the refresh CSVs.

Outputs (all in the bundles dir):
  pe.duckdb            raw tables (t_*) + resolved views (v_*) + snap/changes tables
  MANIFEST.json        refresh timestamp, app version, row counts, freshness info
  changes_latest.csv   diff vs the previous pe.duckdb (added/removed/modified rows)
  changes_latest.md    short human summary of the diff

Usage: python3 build-pe-db.py [--bundles DIR] [--app-version V] [--source NAME]
Requires: pip install duckdb
Safe to re-run. Never touches the CSVs. Never calls Salesforce.
"""
import argparse, csv, datetime as dt, json, os, shutil, sys
import duckdb

ap = argparse.ArgumentParser()
ap.add_argument("--bundles", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bundles"))
ap.add_argument("--app-version", default="")
ap.add_argument("--source", default="")
a = ap.parse_args()

B = os.path.abspath(a.bundles)
DB = os.path.join(B, "pe.duckdb")
NEW = os.path.join(B, "pe.duckdb.new")
PREV = os.path.join(B, "pe_prev.duckdb")

TABLES = ["Profile", "PermissionSet", "PermissionSetGroup", "User", "UserRole",
          "PermissionSetGroupComponent", "PermissionSetTabSetting", "CustomPermission",
          "SystemPermissions_PermSet", "PermissionSetAssignment", "ObjectPermissions",
          "SetupEntityAccess", "FieldPermissions"]

for f in (NEW,):
    if os.path.exists(f):
        os.remove(f)
# Pin the on-disk format so older duckdb versions (e.g. in Claude chat sandboxes) can still read
# the file even when the Mac builds it with a newer duckdb. Newer duckdb reads older formats.
con = duckdb.connect()
con.execute(f"ATTACH '{NEW}' AS pe (STORAGE_VERSION 'v1.2.0')")
con.execute("USE pe")

# ---------- raw tables ----------
for t in TABLES:
    p = os.path.join(B, t + ".csv")
    if not os.path.exists(p):
        sys.exit(f"missing {p}")
    con.execute(f"CREATE TABLE t_{t} AS SELECT * FROM read_csv('{p}', header=true, all_varchar=true, "
                f"quote='\"', escape='\"', strict_mode=false, parallel=false)")


# DATA-3 v3.10: fold chunk CSVs (Profile_2/_3, SystemPermissions_PermSet_2/_3) into their base
# table by Id so downstream views see every Permissions* column. Chunks are optional (older bundles).
CHUNKS = {"Profile": ["Profile_2", "Profile_3"],
          "SystemPermissions_PermSet": ["SystemPermissions_PermSet_2", "SystemPermissions_PermSet_3"]}
for base, chunk_names in CHUNKS.items():
    for ch in chunk_names:
        p = os.path.join(B, ch + ".csv")
        if not os.path.exists(p) or os.path.getsize(p) == 0:
            continue
        con.execute(f"CREATE TABLE t_{ch} AS SELECT * FROM read_csv('{p}', header=true, all_varchar=true, "
                    f"quote='\"', escape='\"', strict_mode=false, parallel=false)")
        con.execute(f"CREATE OR REPLACE TABLE t_{base} AS SELECT b.*, c.* EXCLUDE (Id) "
                    f"FROM t_{base} b LEFT JOIN t_{ch} c ON c.Id = b.Id")
        con.execute(f"DROP TABLE t_{ch}")


def b(col):  # CSV 'true'/'false' -> boolean
    return f"(lower(coalesce({col},'')) = 'true')"


# ---------- dimension views ----------
con.execute("""
CREATE VIEW v_permsets AS
SELECT ps.Id AS permset_id, ps.Name AS api_name, ps.Label AS label, ps.Type AS type,
       (lower(ps.IsOwnedByProfile)='true') AS is_profile_owned, ps.ProfileId AS profile_id,
       ps.Description AS description,
       CASE WHEN lower(ps.IsOwnedByProfile)='true' THEN 'Profile: ' || coalesce(p.Name, ps.ProfileId)
            ELSE ps.Label END AS display_name
FROM t_PermissionSet ps LEFT JOIN t_Profile p ON p.Id = ps.ProfileId;

CREATE VIEW v_users AS
SELECT u.Id AS user_id, u.Name AS user_name, u.Email AS email, u."Profile.Name" AS profile_name,
       u.ProfileId AS profile_id, u.UserRoleId AS role_id, r.Name AS role_name,
       u.LastLoginDate AS last_login
FROM t_User u LEFT JOIN t_UserRole r ON r.Id = u.UserRoleId;

-- One row per (user, permission set) that actually contributes access, with how it was granted.
-- source = 'Profile' | 'Direct' | 'Group' (via_group says which group).
-- Muting permission sets inside a group are NOT modelled (see PE_DATA_GUIDE.md).
CREATE VIEW v_user_permsets AS
WITH base AS (
  SELECT a.AssigneeId AS user_id, a."PermissionSet.Id" AS assigned_id,
         nullif(a.PermissionSetGroupId,'') AS group_id,
         a."PermissionSet.Type" AS assigned_type,
         lower(a."PermissionSet.IsOwnedByProfile")='true' AS is_profile
  FROM t_PermissionSetAssignment a
),
direct AS (
  SELECT user_id, assigned_id AS permset_id,
         CASE WHEN is_profile THEN 'Profile' ELSE 'Direct' END AS source,
         CAST(NULL AS VARCHAR) AS via_group
  FROM base WHERE group_id IS NULL
),
grp AS (
  SELECT b.user_id, c.PermissionSetId AS permset_id, 'Group' AS source,
         c."PermissionSetGroup.MasterLabel" AS via_group
  FROM base b JOIN t_PermissionSetGroupComponent c ON c.PermissionSetGroupId = b.group_id
  WHERE b.group_id IS NOT NULL
),
allrows AS (SELECT * FROM direct UNION ALL SELECT * FROM grp)
SELECT DISTINCT ar.user_id, u.user_name, u.email, u.profile_name,
       ar.permset_id, p.display_name AS permset, p.api_name AS permset_api_name,
       ar.source, ar.via_group
FROM allrows ar
LEFT JOIN v_users u ON u.user_id = ar.user_id
LEFT JOIN v_permsets p ON p.permset_id = ar.permset_id;

-- Per-permset object grants with readable names
CREATE VIEW v_permset_object_perms AS
SELECT o.ParentId AS permset_id, p.display_name AS permset, p.api_name AS permset_api_name,
       o.SobjectType AS object,
       (lower(o.PermissionsCreate)='true') AS can_create, (lower(o.PermissionsRead)='true') AS can_read,
       (lower(o.PermissionsEdit)='true') AS can_edit, (lower(o.PermissionsDelete)='true') AS can_delete,
       (lower(o.PermissionsViewAllRecords)='true') AS view_all, (lower(o.PermissionsModifyAllRecords)='true') AS modify_all
FROM t_ObjectPermissions o LEFT JOIN v_permsets p ON p.permset_id = o.ParentId;

CREATE VIEW v_permset_field_perms AS
SELECT f.ParentId AS permset_id, p.display_name AS permset, p.api_name AS permset_api_name,
       f.SobjectType AS object, f.Field AS field,
       (lower(f.PermissionsRead)='true') AS can_read, (lower(f.PermissionsEdit)='true') AS can_edit
FROM t_FieldPermissions f LEFT JOIN v_permsets p ON p.permset_id = f.ParentId;

-- Effective object access per user (OR across all contributing permission sets) + sources
CREATE VIEW v_effective_object_access AS
SELECT up.user_id, up.user_name, up.profile_name, o.object,
       bool_or(o.can_create) AS can_create, bool_or(o.can_read) AS can_read,
       bool_or(o.can_edit) AS can_edit, bool_or(o.can_delete) AS can_delete,
       bool_or(o.view_all) AS view_all, bool_or(o.modify_all) AS modify_all,
       list(DISTINCT up.permset) AS sources
FROM v_user_permsets up JOIN v_permset_object_perms o ON o.permset_id = up.permset_id
GROUP BY up.user_id, up.user_name, up.profile_name, o.object;

-- Effective field access per user. LARGE — always filter by user_id/user_name and/or field.
CREATE VIEW v_effective_field_access AS
SELECT up.user_id, up.user_name, up.profile_name, f.object, f.field,
       bool_or(f.can_read) AS can_read, bool_or(f.can_edit) AS can_edit,
       list(DISTINCT up.permset) AS sources
FROM v_user_permsets up JOIN v_permset_field_perms f ON f.permset_id = up.permset_id
GROUP BY up.user_id, up.user_name, up.profile_name, f.object, f.field;
""")

# ---------- system permission grants (unpivot Profile + permset boolean columns) ----------
def perm_cols(tbl):
    return [r[0] for r in con.execute(
        f"SELECT column_name FROM information_schema.columns WHERE table_name='{tbl}' "
        f"AND column_name LIKE 'Permissions%'").fetchall()]

parts = []
# Profile: key to the profile-owned permission set
for c in perm_cols("t_Profile"):
    parts.append(f"SELECT ps.Id AS permset_id, '{c[11:]}' AS permission FROM t_Profile p "
                 f"JOIN t_PermissionSet ps ON ps.ProfileId = p.Id WHERE lower(p.{c})='true'")
for c in perm_cols("t_SystemPermissions_PermSet"):
    parts.append(f"SELECT s.Id AS permset_id, '{c[11:]}' AS permission FROM t_SystemPermissions_PermSet s "
                 f"WHERE lower(s.{c})='true'")
con.execute("CREATE TABLE t_sys_perm_grants AS SELECT DISTINCT * FROM (" + " UNION ALL ".join(parts) + ")")
con.execute("""
CREATE VIEW v_permset_system_perms AS
SELECT g.permset_id, p.display_name AS permset, p.api_name AS permset_api_name, g.permission
FROM t_sys_perm_grants g LEFT JOIN v_permsets p ON p.permset_id = g.permset_id;

-- Which users hold which system permission, and via which permission set(s)
CREATE VIEW v_user_system_permissions AS
SELECT up.user_id, up.user_name, up.email, up.profile_name, g.permission,
       list(DISTINCT up.permset) AS sources
FROM v_user_permsets up JOIN t_sys_perm_grants g ON g.permset_id = up.permset_id
GROUP BY up.user_id, up.user_name, up.email, up.profile_name, g.permission;

-- Apex class / Visualforce page / custom permission / tab-set grants. entity_name is resolved
-- only for CustomPermission (Apex/VF names are not in the export — entity_id only).
CREATE VIEW v_permset_setup_entity_access AS
SELECT s.ParentId AS permset_id, p.display_name AS permset, p.api_name AS permset_api_name,
       s.SetupEntityType AS entity_type, s.SetupEntityId AS entity_id,
       cp.MasterLabel AS entity_name, cp.DeveloperName AS entity_api_name
FROM t_SetupEntityAccess s
LEFT JOIN v_permsets p ON p.permset_id = s.ParentId
LEFT JOIN t_CustomPermission cp ON cp.Id = s.SetupEntityId;

CREATE VIEW v_user_setup_entity_access AS
SELECT DISTINCT up.user_id, up.user_name, up.profile_name, e.entity_type, e.entity_id,
       e.entity_name, e.entity_api_name, up.permset AS via_permset
FROM v_user_permsets up JOIN v_permset_setup_entity_access e ON e.permset_id = up.permset_id;

CREATE VIEW v_permset_group_members AS
SELECT c.PermissionSetGroupId AS group_id, c."PermissionSetGroup.MasterLabel" AS group_label,
       c.PermissionSetId AS permset_id, p.display_name AS permset, p.api_name AS permset_api_name
FROM t_PermissionSetGroupComponent c LEFT JOIN v_permsets p ON p.permset_id = c.PermissionSetId;

CREATE VIEW v_permset_tabs AS
SELECT t.ParentId AS permset_id, p.display_name AS permset, t.Name AS tab, t.Visibility AS visibility
FROM t_PermissionSetTabSetting t LEFT JOIN v_permsets p ON p.permset_id = t.ParentId;

CREATE VIEW v_permset_assignee_counts AS
SELECT permset_id, permset, count(DISTINCT user_id) AS users
FROM v_user_permsets GROUP BY permset_id, permset;
""")

# ---------- snapshot (for diffs) ----------
con.execute("""
CREATE TABLE snap AS
SELECT 'user' AS kind, user_id AS key, user_name AS label,
       coalesce(profile_name,'') || '|' || coalesce(role_name,'') AS detail FROM v_users
UNION ALL
SELECT 'assignment', user_id || '|' || permset_id || '|' || coalesce(via_group,''),
       user_name || ' <- ' || permset || coalesce(' (group ' || via_group || ')',''), source
FROM v_user_permsets
UNION ALL
SELECT 'object_perm', permset_id || '|' || object, permset || ' / ' || object,
       (CASE WHEN can_create THEN 'C' ELSE '-' END) || (CASE WHEN can_read THEN 'R' ELSE '-' END) ||
       (CASE WHEN can_edit THEN 'E' ELSE '-' END) || (CASE WHEN can_delete THEN 'D' ELSE '-' END) ||
       (CASE WHEN view_all THEN 'V' ELSE '-' END) || (CASE WHEN modify_all THEN 'M' ELSE '-' END)
FROM v_permset_object_perms
UNION ALL
SELECT 'field_perm', permset_id || '|' || field, permset || ' / ' || field,
       (CASE WHEN can_read THEN 'R' ELSE '-' END) || (CASE WHEN can_edit THEN 'E' ELSE '-' END)
FROM v_permset_field_perms
UNION ALL
SELECT 'system_perm', permset_id || '|' || permission, permset || ' / ' || permission, 'granted'
FROM v_permset_system_perms
UNION ALL
SELECT 'setup_entity', permset_id || '|' || entity_type || '|' || entity_id,
       permset || ' / ' || entity_type || ' ' || coalesce(entity_name, entity_id), 'granted'
FROM v_permset_setup_entity_access
UNION ALL
SELECT 'group_member', group_id || '|' || permset_id, group_label || ' + ' || permset, 'member'
FROM v_permset_group_members
""")

# ---------- diff vs previous db ----------
now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
changes_n = {}
prev_built = None
con.execute("CREATE TABLE changes (kind VARCHAR, change VARCHAR, key VARCHAR, label VARCHAR, old_detail VARCHAR, new_detail VARCHAR)")
if os.path.exists(DB):
    shutil.copyfile(DB, PREV)
    try:
        con.execute(f"ATTACH '{PREV}' AS prev (READ_ONLY)")
        try:
            prev_built = con.execute("SELECT built_at FROM prev.meta").fetchone()[0]
        except Exception:
            prev_built = None
        con.execute("""
        INSERT INTO changes
        SELECT coalesce(n.kind,o.kind),
               CASE WHEN o.key IS NULL THEN 'added' WHEN n.key IS NULL THEN 'removed' ELSE 'modified' END,
               coalesce(n.key,o.key), coalesce(n.label,o.label), o.detail, n.detail
        FROM snap n FULL OUTER JOIN prev.snap o ON n.kind=o.kind AND n.key=o.key
        WHERE o.key IS NULL OR n.key IS NULL OR n.detail IS DISTINCT FROM o.detail
        """)
        con.execute("DETACH prev")
    except Exception as e:  # prior db unreadable/incompatible -> no diff, not fatal
        print(f"[WARN] diff skipped: {e}")
        prev_built = None
    finally:
        if os.path.exists(PREV):
            os.remove(PREV)
for k, c, n in con.execute("SELECT kind, change, count(*) FROM changes GROUP BY ALL ORDER BY 1,2").fetchall():
    changes_n.setdefault(k, {})[c] = n

# ---------- meta + manifest ----------
counts = {t: con.execute(f"SELECT count(*) FROM t_{t}").fetchone()[0] for t in TABLES}
refresh_ts = None
hist = os.path.join(B, "run_history.jsonl")
if os.path.exists(hist):
    last = [l for l in open(hist) if l.strip()]
    if last:
        refresh_ts = json.loads(last[-1]).get("ts")
bundle_src = a.source
if not bundle_src:
    pb = sorted(f for f in os.listdir(B) if f.endswith(".pebundle"))
    bundle_src = pb[-1][:-len(".pebundle")] if pb else ""
csv_mtime = dt.datetime.fromtimestamp(os.path.getmtime(os.path.join(B, "ObjectPermissions.csv")),
                                      dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
con.execute("CREATE TABLE meta (built_at VARCHAR, data_exported_at VARCHAR, refresh_date VARCHAR, bundle VARCHAR, app_version VARCHAR, prev_built_at VARCHAR)")
con.execute("INSERT INTO meta VALUES (?,?,?,?,?,?)", [now, csv_mtime, refresh_ts, bundle_src, a.app_version, prev_built])

manifest = {
    "db": "pe.duckdb", "built_at": now, "data_exported_at": csv_mtime, "refresh_date": refresh_ts,
    "bundle": bundle_src, "app_version": a.app_version, "source_org": "bullhorn (production)",
    "row_counts": counts, "compared_against": prev_built,
    "changes_since_previous": changes_n,
    "guide": "PE_DATA_GUIDE.md",
}
json.dump(manifest, open(os.path.join(B, "MANIFEST.json"), "w"), indent=2)

# ---------- change files ----------
cur = con.execute("SELECT kind, change, key, label, old_detail, new_detail FROM changes ORDER BY 1,2,4")
with open(os.path.join(B, "changes_latest.csv"), "w", newline="") as f:
    w = csv.writer(f); w.writerow(["kind", "change", "key", "label", "old_detail", "new_detail"])
    w.writerows(cur.fetchall())
with open(os.path.join(B, "changes_latest.md"), "w") as f:
    f.write(f"# Permission Explorer changes\n\nData exported {csv_mtime}; compared against build {prev_built or 'n/a (first build)'}.\n\n")
    if not changes_n:
        f.write("No changes detected.\n" if prev_built else "No previous snapshot to compare.\n")
    else:
        f.write("| kind | added | removed | modified |\n|---|---|---|---|\n")
        for k, d in sorted(changes_n.items()):
            f.write(f"| {k} | {d.get('added',0)} | {d.get('removed',0)} | {d.get('modified',0)} |\n")
        f.write("\nFull detail: changes_latest.csv (or table `changes` in pe.duckdb).\n")

con.close()
os.replace(NEW, DB)
print(f"[OK] pe.duckdb built ({sum(counts.values())} source rows; changes: "
      f"{sum(sum(d.values()) for d in changes_n.values())})")
