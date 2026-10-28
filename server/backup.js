import { DatabaseSync, backup } from "node:sqlite";
import { existsSync, mkdirSync, cpSync } from "node:fs";
import { resolve, dirname } from "node:path";
if (existsSync(".env")) process.loadEnvFile(".env");
const source = resolve(process.env.DB_PATH || "data/luqma.sqlite");
if (!existsSync(source))
  throw Error(
    "Database does not exist. Start the server and complete setup first.",
  );
const folder = resolve("data/backups");
mkdirSync(folder, { recursive: true });
const target = resolve(
  folder,
  `luqma-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
);
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, target);
  const uploads = resolve(dirname(source), 'uploads');
  if (existsSync(uploads)) cpSync(uploads, target + '.uploads', {recursive:true});
  console.log(`Backup created: ${target}`);
} finally {
  db.close();
}
