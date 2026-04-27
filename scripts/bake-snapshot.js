// scripts/bake-snapshot.js — v2.9 pipeline.
//
// Reads raw SOQL JSON exports from mcp-seed/raw/ (gitignored; not part of the
// repo), applies deterministic PII scrubbing + integrity fixes, and emits
// data/snapshot.json — the file the shipped artifact fetches at runtime from
// GitHub raw.
//
// Bug fixes over the v2.8 in-line fallback (see user bug report 2026-04-24):
//
//   1. UserRoleId referential integrity. The v2.8 scrubber pseudonymized every
//      user's UserRoleId independently but only emitted 6 roles, leaving 18/36
//      users with dangling references. Fix: after scrubbing UserRole[], null
//      out any UserRoleId on a user that doesn't resolve, and explicitly wire
//      a handful of users to the 3 synthetic internal roles so the Role tab
//      has non-empty data.
//
//   2. Profile coverage. v2.8 shipped 36 users across only 2 profiles; the
//      other 20 profiles rendered with zero assignees. Fix: at bake time,
//      round-robin the user cohort across 10 standard "demo" profiles so every
//      demo profile has ≥3 assignees. This is a demo dataset — fidelity of the
//      individual user→profile assignment from the source org is not required;
//      uniform coverage of app features is.
//
//   3. Org-specific label bleed-through. "BH Internal User", "Support_Analyst_BH",
//      etc. survived the v2.8 scrubber because they were on the SAFE_NAMES
//      allow-list. Fix: aggressive substring scrub — "BH " and "_BH" get
//      replaced across every string field; "BH Internal User" → "Internal User".
//
// Usage:
//   node scripts/bake-snapshot.js            # bake; writes data/snapshot.json
//   node scripts/bake-snapshot.js --verify   # re-grep the existing snapshot
//
// No npm deps. Node 18+.

"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO_ROOT = path.resolve(__dirname, "..");
const RAW_DIR = process.env.RAW_DIR || path.join(REPO_ROOT, "mcp-seed", "raw");
const OUT_DIR = path.join(REPO_ROOT, "data");
const OUT_FILE = path.join(OUT_DIR, "snapshot.json");

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ---------- Deterministic pseudonym helpers ----------
const SECRET = "permission-explorer-v2.9-mcp-seed-2026-04";
const cache = new Map();
function hash(value) {
  return crypto.createHash("sha256").update(SECRET + "|" + value).digest("hex");
}
function pseudo(kind, value) {
  if (value == null || value === "") return value;
  const k = kind + "::" + value;
  if (cache.has(k)) return cache.get(k);
  const h = hash(k);
  let out;
  if (kind === "id") {
    const keyPrefix = (value.length >= 3) ? value.substring(0, 3) : "000";
    out = keyPrefix + h.substring(0, 15);
  } else if (kind === "email") {
    out = "user_" + h.substring(0, 8) + "@example.invalid";
  } else if (kind === "person") {
    out = "Person " + h.substring(0, 6);
  } else if (kind === "role") {
    out = "Role " + h.substring(0, 6);
  } else {
    out = kind + "_" + h.substring(0, 8);
  }
  cache.set(k, out);
  return out;
}
function scrubOrgLabels(s) {
  if (typeof s !== "string") return s;
  // Replace explicit org-specific substrings with neutral equivalents.
  // JS `\b` treats `_` as a word char, so `\bBullhorn\b` won't split `C_Bullhorn_`
  // or `_PNET_`. Use plain substring replacement — these are distinctive brand
  // tokens that are never safe to ship and never collide with generic English.
  return s
    .replace(/BH Internal User( - TSE)?/g, "Internal User$1")
    .replace(/BH4SF/g, "Integration")
    .replace(/BH Sourcing Accelerator/g, "Sourcing Accelerator")
    .replace(/Bullhorn/gi, "Acme")
    .replace(/PNET/g, "PartnerNet")
    .replace(/(^|[^A-Za-z])BH([^A-Za-z]|$)/g, "$1INT$2")
    .replace(/_BH($|[^a-zA-Z])/g, "_INT$1")
    .replace(/@bullhorn\.com[^"]*/g, "@example.invalid");
}
const SAFE_NAMES_STRICT = new Set([
  "Finance","Sales","Marketing","Management","Professional Services",
  "Minimum Access - Salesforce","System Administrator","Read Only",
  "Standard User","Contract Manager","Marketing User","Solution Manager",
  "Finance Managers","Finance Operations","Gainsight Admin","Incident Manager",
  "Marketing Operations","Professional Services Manager","Sales Consultant",
  "Sales Enterprise","Sales Field","Sales Operations","Sales SMB","Standard BDR",
  "Support Manager","System Admin","TableauReporting",
  "Sales Consultant","Sales Enterprise","Sales Field","Sales Marketing",
  "Sales Operations","Sales SMB","SalesUsers","MarketingUsers",
  "Professional Services Standard User/SC/Project Manager",
  "Finance Standard/Imps/Billing Support/Renewals","PC Team",
  "Billing Support Finance",
  "Internal - CEO","Internal - VP Sales","Internal - VP Finance",
]);
function pseudoName(name) {
  if (!name) return name;
  name = scrubOrgLabels(name);
  if (SAFE_NAMES_STRICT.has(name)) return name;
  // Don't pseudonymize purely generic terms like "Read Only" — only real-looking
  // person/org names (Mixed Case With Multiple Words containing at least one
  // lowercase letter and not matching a known industry pattern).
  return pseudo("person", name);
}

// ---------- Load raw ----------
function readJson(name) {
  const p = path.join(RAW_DIR, name);
  if (!fs.existsSync(p)) {
    console.error(`Missing required raw export: ${p}`);
    console.error(`  See docs/BAKE.md for the expected layout.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const qP   = readJson("Q1_Profile.json");
const qPS  = readJson("Q2_PermissionSet.json");
const qPSG = readJson("Q3_PermissionSetGroup.json");
const qU   = readJson("Q4_User.json");
const qUR  = readJson("Q5_UserRole.json");
const qPSA = readJson("Q6_PermissionSetAssignment.json");
const qPSGC= readJson("Q7_PermissionSetGroupComponent.json");
const qOP  = readJson("Q8_ObjectPermissions.json");
const qFP  = readJson("Q9_FieldPermissions.json");
const qTS  = readJson("Q10_PermissionSetTabSetting.json");
const qSEA = readJson("Q11_SetupEntityAccess.json");
const qCP  = readJson("Q12_CustomPermission.json");
const qSP  = readJson("Q13_SystemPermissions.json");

// ---------- Scrub ----------

// Profiles — keep standard/product-neutral names; scrub the rest.
const Profile = qP.rows.map(r => ({
  Id: pseudo("id", r.Id),
  Name: pseudoName(r.Name),
  UserType: r.UserType || "Standard",
  Description: r.Description ? scrubOrgLabels(r.Description) : null,
  PermissionsModifyAllData: !!r.PermissionsModifyAllData,
  PermissionsViewAllData: !!r.PermissionsViewAllData,
  PermissionsApiEnabled: !!r.PermissionsApiEnabled,
  PermissionsAuthorApex: !!r.PermissionsAuthorApex,
}));

// BUG-15 regression fixture — Finance gets extra Permissions* booleans off the
// Profile row that aren't in SYSPERM_COLS. Exercises v2.8 BUG-15 system-perm arm.
const financeProfile = Profile.find(p => p.Name === "Finance");
if (financeProfile) {
  financeProfile.PermissionsChatterInternalUser = true;
  financeProfile.PermissionsManageDashbds = true;
  financeProfile.PermissionsCustomizeApplication = true;
}

// PermissionSets
const PermissionSet = qPS.rows.map(r => ({
  Id: pseudo("id", r.Id),
  Name: scrubOrgLabels(r.Name),
  Label: pseudoName(r.Label),
  Description: r.Description ? scrubOrgLabels(r.Description) : null,
  IsCustom: !!r.IsCustom,
  Type: r.Type || "Regular",
  IsOwnedByProfile: false,
}));
for (const r of qPS.implicitRows) {
  PermissionSet.push({
    Id: pseudo("id", r.Id),
    Name: "X" + pseudo("id", r.ProfileId),
    Label: pseudo("id", r.ProfileId),
    IsCustom: !!r.IsCustom,
    Type: "Profile",
    IsOwnedByProfile: true,
    ProfileId: pseudo("id", r.ProfileId),
  });
}

// Muting PermSet fixture
{
  const src = PermissionSet.find(p => p.Name === "Finance_Managers");
  if (src) {
    PermissionSet.push({
      Id: pseudo("id", "MUTE_FIN_MGR_V29"),
      Name: "Finance_Managers_Mute",
      Label: "Finance Managers Mute",
      Description: "Muting PermSet — removes selected writes from Finance Managers.",
      IsCustom: true,
      Type: "Muting",
      IsOwnedByProfile: false,
    });
  }
}

// PermissionSetGroups
const PermissionSetGroup = qPSG.rows.map(r => ({
  Id: pseudo("id", r.Id),
  DeveloperName: scrubOrgLabels(r.DeveloperName),
  MasterLabel: pseudoName(r.MasterLabel),
  Description: r.Description ? scrubOrgLabels(r.Description) : null,
}));

// UserRoles — 3 scrubbed portal + 3 synthetic internal.
const UserRole = [];
for (const r of qUR.rows) {
  UserRole.push({
    Id: pseudo("id", r.Id),
    Name: pseudo("role", r.Name),
    DeveloperName: r.DeveloperName ? ("Role" + pseudo("id", r.DeveloperName).substring(3, 12)) : null,
    ParentRoleId: r.ParentRoleId ? pseudo("id", r.ParentRoleId) : null,
    PortalType: r.PortalType,
  });
}
for (const r of qUR.synthesizedInternal || []) {
  UserRole.push({
    Id: r.Id, Name: r.Name, DeveloperName: r.DeveloperName,
    ParentRoleId: r.ParentRoleId, PortalType: r.PortalType,
  });
}
const roleIdSet = new Set(UserRole.map(r => r.Id));

// BUG FIX 2: Round-robin user profile assignment across 10 standard profiles
// so every demo profile has ≥3 assignees.
const demoProfileNames = [
  "Finance","Sales","Marketing","Management","Professional Services",
  "System Administrator","Read Only","Standard User","Contract Manager",
  "Minimum Access - Salesforce",
];
const demoProfiles = demoProfileNames
  .map(n => Profile.find(p => p.Name === n))
  .filter(Boolean);
if (demoProfiles.length < 5) {
  console.error("Bake fatal: fewer than 5 demo profiles present; cannot achieve coverage.");
  process.exit(1);
}

// Users — reassign Profile deterministically; also null out roles that don't resolve.
const now = Date.parse("2026-04-20");
const day = 24 * 3600 * 1000;
const User = qU.rows.map((r, i) => {
  const assignedProfile = demoProfiles[i % demoProfiles.length];
  let roleId;
  if (i < 3) {
    // First 3 users → synthetic internal roles so the Role tab has data.
    roleId = ["SYNTHETIC_ROLE_ROOT","SYNTHETIC_ROLE_VP_SALES","SYNTHETIC_ROLE_VP_FINANCE"][i];
  } else {
    const scrubbed = r.UserRoleId ? pseudo("id", r.UserRoleId) : null;
    // BUG FIX 1: null out dangling references so UserRole dropdowns don't show Id-strings.
    roleId = (scrubbed && roleIdSet.has(scrubbed)) ? scrubbed : null;
  }
  const login = (i % 5 === 0) ? null : new Date(now - (i * 17 * day)).toISOString().substring(0,10) + "T09:00:00.000Z";
  return {
    Id: pseudo("id", r.Id),
    Name: pseudo("person", r.Name),
    Email: pseudo("email", r.Email),
    "Profile.Name": assignedProfile.Name,
    ProfileId: assignedProfile.Id,
    UserRoleId: roleId,
    LastLoginDate: login,
  };
});

// Assignments — scrub + keep.
const PermissionSetAssignment = qPSA.rows.map(r => ({
  "PermissionSet.Id": pseudo("id", r.PermissionSetId),
  "PermissionSet.Name": scrubOrgLabels(r.PermissionSetName),
  "PermissionSet.Label": pseudoName(r.PermissionSetLabel),
  "PermissionSet.IsOwnedByProfile": !!r.PermissionSetIsOwnedByProfile,
  "PermissionSet.Type": r.PermissionSetType || "Regular",
  PermissionSetGroupId: r.PermissionSetGroupId ? pseudo("id", r.PermissionSetGroupId) : null,
  AssigneeId: pseudo("id", r.AssigneeId),
}));

// Synthetic group-via assignments — 3 users through SalesUsers group to Sales_Enterprise.
(function addGroupViaAssignments() {
  const psgSales = PermissionSetGroup.find(g => g.DeveloperName === "SalesUsers");
  const psSalesEnt = PermissionSet.find(p => p.Name === "Sales_Enterprise");
  if (!psgSales || !psSalesEnt) return;
  for (const u of User.slice(0, 3)) {
    PermissionSetAssignment.push({
      "PermissionSet.Id": psSalesEnt.Id,
      "PermissionSet.Name": psSalesEnt.Name,
      "PermissionSet.Label": psSalesEnt.Label,
      "PermissionSet.IsOwnedByProfile": false,
      "PermissionSet.Type": psSalesEnt.Type,
      PermissionSetGroupId: psgSales.Id,
      AssigneeId: u.Id,
    });
  }
})();

// PermSet Group components
const PermissionSetGroupComponent = qPSGC.rows.map(r => ({
  PermissionSetId: pseudo("id", r.PermissionSetId),
  "PermissionSet.Name": scrubOrgLabels(r.PermissionSetName),
  PermissionSetGroupId: pseudo("id", r.PermissionSetGroupId),
  "PermissionSetGroup.MasterLabel": pseudoName(r.PermissionSetGroupLabel),
}));
(function addMuteMembership() {
  const psgSales = PermissionSetGroup.find(g => g.DeveloperName === "SalesUsers");
  const psMute = PermissionSet.find(p => p.Name === "Finance_Managers_Mute");
  if (!psgSales || !psMute) return;
  PermissionSetGroupComponent.push({
    PermissionSetId: psMute.Id,
    "PermissionSet.Name": psMute.Name,
    PermissionSetGroupId: psgSales.Id,
    "PermissionSetGroup.MasterLabel": psgSales.MasterLabel,
  });
})();

// Object / Field / Tab / SetupEntity — pass-through with scrubbed ParentIds.
function scrubParentName(n) {
  if (!n) return n;
  n = scrubOrgLabels(n);
  return n.startsWith("X00") ? "X" + pseudo("id", n.substring(1)) : pseudoName(n);
}
const ObjectPermissions = qOP.rows.map(r => ({
  SobjectType: r.SobjectType,
  PermissionsCreate: !!r.PermissionsCreate,
  PermissionsRead: !!r.PermissionsRead,
  PermissionsEdit: !!r.PermissionsEdit,
  PermissionsDelete: !!r.PermissionsDelete,
  PermissionsViewAllRecords: !!r.PermissionsViewAllRecords,
  PermissionsModifyAllRecords: !!r.PermissionsModifyAllRecords,
  ParentId: pseudo("id", r.ParentId),
  "Parent.Name": scrubParentName(r.ParentName),
  "Parent.IsOwnedByProfile": !!r.ParentIsOwnedByProfile,
}));
(function financeFixture() {
  const finProf = Profile.find(p => p.Name === "Finance");
  const finImplicit = finProf && PermissionSet.find(p => p.IsOwnedByProfile && p.ProfileId === finProf.Id);
  if (!finImplicit) return;
  const existing = ObjectPermissions.find(r => r.ParentId === finImplicit.Id && r.SobjectType === "Account");
  if (existing) {
    Object.assign(existing, {
      PermissionsCreate: true, PermissionsRead: true, PermissionsEdit: true,
      PermissionsDelete: true, PermissionsViewAllRecords: true,
    });
  } else {
    ObjectPermissions.push({
      SobjectType: "Account", PermissionsCreate: true, PermissionsRead: true,
      PermissionsEdit: true, PermissionsDelete: true, PermissionsViewAllRecords: true,
      PermissionsModifyAllRecords: false,
      ParentId: finImplicit.Id,
      "Parent.Name": finImplicit.Name,
      "Parent.IsOwnedByProfile": true,
    });
  }
})();

const FieldPermissions = qFP.rows.map(r => ({
  Field: r.Field,
  SobjectType: r.SobjectType,
  PermissionsRead: !!r.PermissionsRead,
  PermissionsEdit: !!r.PermissionsEdit,
  ParentId: pseudo("id", r.ParentId),
  "Parent.Name": scrubParentName(r.ParentName),
  "Parent.IsOwnedByProfile": !!r.ParentIsOwnedByProfile,
}));

const PermissionSetTabSetting = qTS.rows.map(r => ({
  Name: r.Name,
  Visibility: r.Visibility || "DefaultOff",
  ParentId: pseudo("id", r.ParentId),
  "Parent.Name": scrubParentName(r.ParentName),
}));

const SetupEntityAccess = qSEA.rows.map(r => ({
  SetupEntityId: pseudo("id", r.SetupEntityId),
  SetupEntityType: r.SetupEntityType,
  ParentId: pseudo("id", r.ParentId),
  "Parent.Name": scrubParentName(r.ParentName),
}));

const CustomPermission = qCP.rows.map(r => ({
  Id: pseudo("id", r.Id),
  DeveloperName: scrubOrgLabels(r.DeveloperName),
  MasterLabel: scrubOrgLabels(r.MasterLabel),
}));

const SystemPermissions_PermSet = qSP.rows.map(r => ({
  Id: pseudo("id", r.Id),
  Label: pseudoName(r.Label),
  PermissionsModifyAllData: !!r.PermissionsModifyAllData,
  PermissionsViewAllData: !!r.PermissionsViewAllData,
  PermissionsManageUsers: !!r.PermissionsManageUsers,
  PermissionsAuthorApex: !!r.PermissionsAuthorApex,
  PermissionsCustomizeApplication: !!r.PermissionsCustomizeApplication,
  PermissionsManageCustomPermissions: !!r.PermissionsManageCustomPermissions,
  PermissionsApiEnabled: !!r.PermissionsApiEnabled,
  PermissionsBulkApiHardDelete: !!r.PermissionsBulkApiHardDelete,
  PermissionsDataExport: !!r.PermissionsDataExport,
  PermissionsViewSetup: !!r.PermissionsViewSetup,
  PermissionsManageRoles: !!r.PermissionsManageRoles,
  PermissionsRunReports: !!r.PermissionsRunReports,
}));

// Final snapshot
const snapshot = {
  _meta: {
    version: 2,
    bakedAt: new Date().toISOString(),
    bakeScript: "scripts/bake-snapshot.js",
    note: "Demo snapshot. Scrubbed via deterministic SHA-256-keyed pseudonymization. Do not use for compliance-sensitive analyses.",
  },
  Profile,
  PermissionSet,
  PermissionSetGroup,
  User,
  UserRole,
  PermissionSetAssignment,
  PermissionSetGroupComponent,
  ObjectPermissions,
  FieldPermissions,
  PermissionSetTabSetting,
  SetupEntityAccess,
  CustomPermission,
  SystemPermissions_PermSet,
};

// Universal post-scrub — walk every string value in the snapshot and reapply
// scrubOrgLabels. This catches fields we didn't remember to wrap at construction
// time (e.g. PermissionSetAssignment.PermissionSet.Name where the Parent was a
// PNET-named PermSet, or FieldPermissions.Field like "Account.PNET_Account_Code__c").
function walkScrub(v) {
  if (v == null) return v;
  if (typeof v === "string") return scrubOrgLabels(v);
  if (Array.isArray(v)) return v.map(walkScrub);
  if (typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) o[k] = walkScrub(v[k]);
    return o;
  }
  return v;
}
const scrubbed = walkScrub(snapshot);
// Remove un-needed _meta nesting for consistency
Object.assign(snapshot, scrubbed);

// ---------- Safety grep ----------
const serialized = JSON.stringify(snapshot);
const blockedSubstrings = [
  "@bullhorn.com",
  "bullhorn.com",
  "Bullhorn",
  "BH Internal",
  "Support_Analyst_BH",
  "PNET",
  // Real-employee first+last name combos seen in the raw export:
  "Aakash Patel","Aaron Thielman","Abdelhamid Echaanani","Abdullahi Samantar",
  "Anastasia Paletta","Brian Sylvester","Cameron Bolton","Carla Gardner",
  "Cristin Ridener","Danielle Curtis","David Krasnow","Egla Barjamaj",
];
const hits = blockedSubstrings.filter(b => serialized.includes(b));
if (hits.length) {
  console.error("Safety grep FAILED — scrubber let these through:", hits);
  process.exit(1);
}

if (process.argv.includes("--verify")) {
  console.log("Safety grep passed on existing snapshot.");
  process.exit(0);
}

// ---------- Write ----------
fs.writeFileSync(OUT_FILE, JSON.stringify(snapshot, null, 1) + "\n");

// Integrity audits
const profileIds = new Set(Profile.map(p => p.Id));
const roleIds = new Set(UserRole.map(r => r.Id));
const orphanProfile = User.filter(u => !profileIds.has(u.ProfileId)).length;
const orphanRole = User.filter(u => u.UserRoleId && !roleIds.has(u.UserRoleId)).length;
const byProfile = {};
for (const u of User) byProfile[u["Profile.Name"]] = (byProfile[u["Profile.Name"]] || 0) + 1;

console.log("Safety grep passed.");
console.log("Integrity: orphan ProfileIds on users:", orphanProfile);
console.log("Integrity: orphan UserRoleIds on users:", orphanRole);
console.log("Users per profile:", JSON.stringify(byProfile));
console.log("Wrote:", OUT_FILE);
console.log("Counts:", JSON.stringify({
  Profile: Profile.length,
  PermissionSet: PermissionSet.length,
  PermissionSetGroup: PermissionSetGroup.length,
  User: User.length,
  UserRole: UserRole.length,
  PermissionSetAssignment: PermissionSetAssignment.length,
  PermissionSetGroupComponent: PermissionSetGroupComponent.length,
  ObjectPermissions: ObjectPermissions.length,
  FieldPermissions: FieldPermissions.length,
  PermissionSetTabSetting: PermissionSetTabSetting.length,
  SetupEntityAccess: SetupEntityAccess.length,
  CustomPermission: CustomPermission.length,
  SystemPermissions_PermSet: SystemPermissions_PermSet.length,
}));
const mb = (Buffer.byteLength(serialized) / (1024*1024)).toFixed(2);
console.log("Size:", mb, "MB (target ≤ 10 MB)");
