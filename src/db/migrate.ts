import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { loadEnv } from "../lib/env";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

export async function migrate(): Promise<string[]> {
  const sql = postgres(loadEnv().DATABASE_URL);
  const applied: string[] = [];
  try {
    await sql`create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`;

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const name = path.basename(file, ".sql");
      const existing = await sql`select 1 from _migrations where name = ${name}`;
      if (existing.length > 0) continue;

      const contents = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(contents);
        await tx`insert into _migrations (name) values (${name})`;
      });
      applied.push(name);
    }

    return applied;
  } finally {
    await sql.end();
  }
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  migrate()
    .then((applied) => {
      if (applied.length > 0) {
        console.log(`applied ${applied.join(", ")}`);
      } else {
        console.log("no migrations to apply");
      }
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
