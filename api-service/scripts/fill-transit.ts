// Fill in nearby public transport (metro / train / tram / bus) from Digitransit
// (Finland, key DIGITRANSIT_KEY from the env or .dev.vars) or OpenStreetMap
// for every event and place that has never been checked (transit IS NULL).
// Rows an admin already filled or edited are left alone, unless --all.
//
//   node scripts/fill-transit.ts --remote            look up + print, change nothing
//   node scripts/fill-transit.ts --remote --write    ...and save to production
//   node scripts/fill-transit.ts --local --write     ...or to the local dev DB
//
// Flags: --remote | --local (which DB, required), --write (save; without it this
// is a dry run), --all (redo rows that already have transit).
// Waits between lookups to stay inside Overpass' fair-use limits.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lookupTransit } from "../src/services/transit.ts";

const DB = "cosplay-map-db";
const TABLES = ["events", "places"] as const;
const PAUSE_MS = 1500;

const args = process.argv.slice(2);
const target = args.includes("--remote") ? "--remote" : args.includes("--local") ? "--local" : null;
const write = args.includes("--write");
const redoAll = args.includes("--all");
if (!target) {
  console.error("Pick a database: --remote (production) or --local. Add --write to save.");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// DIGITRANSIT_KEY from the environment, else from .dev.vars (local secrets file).
function digitransitKey(): string | undefined {
  if (process.env.DIGITRANSIT_KEY) return process.env.DIGITRANSIT_KEY;
  const file = path.join(root, ".dev.vars");
  if (!fs.existsSync(file)) return undefined;
  const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith("DIGITRANSIT_KEY="));
  return line?.slice("DIGITRANSIT_KEY=".length).trim().replace(/^"|"$/g, "") || undefined;
}
const key = digitransitKey();
if (!key) console.log("No DIGITRANSIT_KEY: using OpenStreetMap only.");
const wrangler = (cmd: string) =>
  execSync(`npx wrangler ${cmd}`, { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1" } }).toString();

type Row = { id: string; name: string; lat: number; lng: number; transit: string | null };

function rows(table: string): Row[] {
  const where = redoAll ? "" : " WHERE transit IS NULL";
  const out = wrangler(`d1 execute ${DB} ${target} --json --command "SELECT id, name, lat, lng, transit FROM ${table}${where}"`);
  return (JSON.parse(out) as Array<{ results: Row[] }>)[0].results;
}

const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const updates: string[] = [];
const failed: string[] = [];
for (const table of TABLES) {
  const list = rows(table);
  console.log(`\n${table}: ${list.length} to check`);
  for (const r of list) {
    try {
      const transit = await lookupTransit(Number(r.lat), Number(r.lng), { digitransitKey: key });
      const label = transit.length ? transit.map((s) => `${s.kind} ${s.name} ${s.distance} m`).join(", ") : "(nothing close)";
      console.log(`  ${r.name}: ${label}`);
      updates.push(`UPDATE ${table} SET transit = ${sqlText(JSON.stringify(transit))} WHERE id = ${sqlText(r.id)};`);
    } catch (e) {
      console.log(`  ${r.name}: FAILED (${(e as Error).message}), left unchecked`);
      failed.push(`${table}/${r.name}`);
    }
    await sleep(PAUSE_MS);
  }
}

console.log(`\n${updates.length} found, ${failed.length} failed.`);
if (!write) {
  console.log("Dry run: nothing saved. Add --write to save.");
} else if (updates.length > 0) {
  const file = path.join(root, "backups", `.transit-${Date.now()}.sql`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, updates.join("\n") + "\n");
  try {
    wrangler(`d1 execute ${DB} ${target} --file "${file}"`);
    console.log(`Saved ${updates.length} rows to the ${target === "--remote" ? "production" : "local"} DB.`);
  } finally {
    fs.rmSync(file, { force: true });
  }
}
