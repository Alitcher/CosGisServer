// Make the local dev database's events + places match production (Cloudflare D1).
// Runs before `pnpm dev`. Production is only READ, never changed.
//
//   1. back up the local DB to backups/local-before-sync-<time>.sql
//   2. apply local migrations (local schema must have every production column)
//   3. export production events + places (data only)
//   4. replace local events + places with them
//
// Admin passkeys, sessions etc. are NOT copied, so the local admin login keeps working.
// If production can't be reached (offline / not logged in), dev starts with the current local data.
//
// Flags / env: --dry-run (export + count only, local DB untouched), SKIP_DB_SYNC=1 (skip entirely).
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DB = "cosplay-map-db";
const TABLES = ["events", "places"];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backups = path.join(root, "backups");
const dryRun = process.argv.includes("--dry-run");

if (process.env.SKIP_DB_SYNC === "1") {
  console.log("[db-sync] SKIP_DB_SYNC=1, using local data as is.");
  process.exit(0);
}

const run = (cmd) =>
  execSync(`npx wrangler ${cmd}`, { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1" } }).toString();

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
fs.mkdirSync(backups, { recursive: true });

// 3 first: if production is unreachable, leave the local DB completely alone.
const tmp = TABLES.map((t) => path.join(backups, `.prod-${t}-${stamp}.sql`));
try {
  TABLES.forEach((t, i) => run(`d1 export ${DB} --remote --table ${t} --no-schema --output "${tmp[i]}"`));
} catch (err) {
  tmp.forEach((f) => fs.rmSync(f, { force: true }));
  console.warn("[db-sync] Could not read production (offline or not logged in? try `npx wrangler login`).");
  console.warn("[db-sync] Starting with the current local data.\n" + String(err.stderr || err.message).split("\n").slice(-4).join("\n"));
  process.exit(0);
}

const inserts = tmp.map((f) => fs.readFileSync(f, "utf8").split("\n").filter((l) => l.startsWith("INSERT INTO")));
tmp.forEach((f) => fs.rmSync(f, { force: true }));
const counts = TABLES.map((t, i) => `${inserts[i].length} ${t}`).join(", ");

if (dryRun) {
  console.log(`[db-sync] dry run: production has ${counts}. Local DB not changed.`);
  process.exit(0);
}

// 1. backup
const backup = path.join(backups, `local-before-sync-${stamp}.sql`);
run(`d1 export ${DB} --local --output "${backup}"`);

// 2. local schema up to date
run(`d1 migrations apply ${DB} --local`);

// 4. replace
const sqlFile = path.join(backups, `.sync-${stamp}.sql`);
fs.writeFileSync(sqlFile, [...TABLES.map((t) => `DELETE FROM ${t};`), ...inserts.flat()].join("\n") + "\n");
try {
  run(`d1 execute ${DB} --local --file "${sqlFile}"`);
} finally {
  fs.rmSync(sqlFile, { force: true });
}
console.log(`[db-sync] Local DB now matches production: ${counts}. Backup: backups/${path.basename(backup)}`);
