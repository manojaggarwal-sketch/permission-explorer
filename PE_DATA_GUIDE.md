# Permission Explorer Data Guide (for Claude chats)

Read this first when investigating Salesforce access (production `bullhorn`) from `PermissionExplorer/bundles/`.

## Files (all in `bundles/`, refreshed weekly by `scripts/weekly-refresh.sh`)

| File | Use |
|---|---|
| `MANIFEST.json` | **Read first.** Export timestamp, app version, row counts, change counts. Tell the user how fresh the data is. |
| `pe.duckdb` | Query layer. Prefer this over the raw CSVs. |
| `changes_latest.md` / `.csv` | Diff vs the previous refresh (added/removed/modified assignments, object/field/system perms, setup entity access, group members, users). |
| `<Object>.csv` (13 files) | Raw Salesforce exports; same data as `t_*` tables in the db. |

## How to query

```python
# pip install duckdb --break-system-packages   (once per sandbox)
import duckdb
c = duckdb.connect('/sessions/<session>/mnt/PermissionExplorer/bundles/pe.duckdb', read_only=True)
c.execute("select * from v_effective_object_access where user_name ilike '%smith%' and object='Account'").fetchdf()
```

The mounted folder disallows deleting files, so for anything that writes, copy `pe.duckdb` to `/tmp` first. Opening `read_only=True` is safe.

## Views (all names resolved; ids included)

| View | Grain / purpose |
|---|---|
| `v_users` | Active Standard users with profile and role names. |
| `v_permsets` | Every permission set; `display_name` = `Profile: <name>` for profile-owned sets (their raw API names look like `X00e0P…`). |
| `v_user_permsets` | One row per (user, contributing permission set). `source` = `Profile` / `Direct` / `Group`; `via_group` names the group. **Start here for "why does X have access".** |
| `v_effective_object_access` | Per user + object: OR of CRUD/ViewAll/ModifyAll across all sets, plus `sources` (list of sets granting). |
| `v_effective_field_access` | Per user + field: read/edit + `sources`. **Large; always filter by user and/or field.** |
| `v_user_system_permissions` | Per user + system permission (e.g. `ModifyAllData`, `ViewAllData`, `ManageUsers`, `AuthorApex`) + `sources`. ~88 permissions tracked. |
| `v_user_setup_entity_access` | Per user: ApexClass / ApexPage / CustomPermission / TabSet grants + `via_permset`. |
| `v_permset_object_perms`, `v_permset_field_perms`, `v_permset_system_perms`, `v_permset_setup_entity_access`, `v_permset_tabs` | Same data per permission set (use to answer "what does set Y grant"). |
| `v_permset_group_members` | Permission set group → member sets. |
| `v_permset_assignee_counts` | Users per permission set. |
| `changes`, `snap`, `meta` | Diff rows, snapshot used for diffing, build metadata. |

Raw tables are `t_<ObjectName>` (all columns are text; booleans are `'true'/'false'`).

## Resolution rules (how access is computed)

1. A user's access is the **union (OR)** of all permission sets contributing to them: the profile's owned set + directly assigned sets + member sets of assigned permission set groups. Salesforce has no deny except muting (below).
2. `PermissionSetAssignment` includes a row for the profile-owned set (`IsOwnedByProfile=true`), and a row for a group assignment carries `PermissionSetGroupId`; the group's member sets come from `PermissionSetGroupComponent`. `v_user_permsets` already does this expansion.
3. Profile system permissions come from `Profile.csv` and map to the profile-owned permission set via `PermissionSet.ProfileId`. Permission set system permissions come from `SystemPermissions_PermSet.csv`. Both are unified in `t_sys_perm_grants` / `v_permset_system_perms`.
4. Permission set `Type` values: `Profile`, `Regular`, `Standard` (Salesforce-managed), `Group` (a group's own set; no direct grants), `Session` (session-activated).

## Known limits — say so in answers when relevant

- **ViewAllData / ModifyAllData** imply read / edit on all objects and fields **without** `ObjectPermissions`/`FieldPermissions` rows. Always check `v_user_system_permissions` before concluding "no access".
- **Muting permission sets** inside groups are not exported or modelled, so group-derived access can be overstated.
- **Standard-field defaults, required fields, record types, page layouts, sharing rules, OWD, role hierarchy, teams, and territory access** are not in this data. It answers *permission* questions, not *record visibility*.
- Only **active Standard users** are exported. Inactive, portal and integration-only users are absent.
- **ApexClass / ApexPage** names are not exported (only ids). Only CustomPermission names resolve.
- `PermissionSetTabSetting` can be short of the Salesforce COUNT (~3k rows, known platform artifact).
- Data is a **weekly snapshot**. For "right now" questions, confirm with the live org (read-only SOQL).

## Recipes

```sql
-- Why does a user have access to an object? (sources = the sets granting it)
select object, can_read, can_edit, modify_all, sources
from v_effective_object_access where user_name ilike '%name%' and object = 'Opportunity';

-- Who has ModifyAllData, and through what?
select user_name, profile_name, sources from v_user_system_permissions where permission = 'ModifyAllData';

-- Who can edit a given field?
select user_name, sources from v_effective_field_access where field = 'Account.Industry' and can_edit;

-- What does a permission set / group grant?
select * from v_permset_object_perms where permset ilike '%KCS Publisher%';
select * from v_permset_group_members where group_label ilike '%Support Analyst%';

-- Who is assigned a set, and is it direct or via a group?
select user_name, source, via_group from v_user_permsets where permset ilike '%Plauti%';

-- Biggest sets by assignee count / unused sets
select * from v_permset_assignee_counts order by users desc limit 20;
select label from v_permsets where permset_id not in (select permset_id from v_user_permsets) and not is_profile_owned;

-- What changed since the last refresh?
select kind, change, count(*) from changes group by all;
select * from changes where kind='system_perm' and change='added';
```

Field names in `v_effective_field_access.field` are `Object.Field` (e.g. `Account.Industry`).

## Answer-quality checklist

1. State the data date from `MANIFEST.json`.
2. Name the granting permission set(s) and how each was granted (profile / direct / group).
3. Check system permissions (ViewAll/ModifyAll) before saying "no access".
4. Distinguish permission access from record-level sharing.
5. Read-only: never modify Salesforce; follow the `salesforce-read-only` skill for any live org query.
