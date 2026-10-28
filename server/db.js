import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MEALS } from "../src/domain.js";
export function openDatabase(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
 PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,department TEXT NOT NULL DEFAULT '',role TEXT NOT NULL CHECK(role IN ('admin','employee')),password_hash TEXT,active INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS invites(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL,used_at INTEGER);
 CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS meals(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>0),restaurant TEXT NOT NULL,allergens TEXT NOT NULL DEFAULT '',image TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 1,confirmed INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS days(day TEXT PRIMARY KEY,published INTEGER NOT NULL DEFAULT 0,budget INTEGER NOT NULL,attendance_deadline INTEGER NOT NULL,vote_deadline INTEGER NOT NULL,finalized_at INTEGER,winner_id TEXT,final_count INTEGER);
 CREATE TABLE IF NOT EXISTS day_meals(day TEXT NOT NULL REFERENCES days(day),meal_id TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,price INTEGER NOT NULL,restaurant TEXT NOT NULL,allergens TEXT NOT NULL,image TEXT NOT NULL,PRIMARY KEY(day,meal_id));
 CREATE TABLE IF NOT EXISTS day_people(day TEXT NOT NULL REFERENCES days(day),user_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(day,user_id));
 CREATE TABLE IF NOT EXISTS attendance(day TEXT NOT NULL REFERENCES days(day),user_id TEXT NOT NULL REFERENCES users(id),at INTEGER NOT NULL,method TEXT NOT NULL,policy_version TEXT NOT NULL,PRIMARY KEY(day,user_id));
 CREATE TABLE IF NOT EXISTS votes(day TEXT NOT NULL,user_id TEXT NOT NULL,meal_id TEXT NOT NULL,weight INTEGER NOT NULL CHECK(weight IN (1,2)),at INTEGER NOT NULL,PRIMARY KEY(day,user_id),FOREIGN KEY(day,user_id) REFERENCES attendance(day,user_id),FOREIGN KEY(day,meal_id) REFERENCES day_meals(day,meal_id));
 CREATE TABLE IF NOT EXISTS proofs(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),session_hash TEXT NOT NULL,day TEXT NOT NULL,method TEXT NOT NULL,expires_at INTEGER NOT NULL,used_at INTEGER);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,actor_id TEXT,event TEXT NOT NULL,day TEXT,detail TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS audit_day ON audit(day,id); CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
 `);
  if (!db.prepare("SELECT id FROM settings WHERE id=1").get())
    db.prepare("INSERT INTO settings VALUES(1,?)").run(
      JSON.stringify({
        company: "سُفرة",
        budget: 900,
        office: null,
        networks: [],
        verification: "self",
        autoPublish: false,
        policyVersion: "1",
      }),
    );
  const settingsRow = db.prepare("SELECT payload FROM settings WHERE id=1").get();
  const currentSettings = JSON.parse(settingsRow.payload);
  if (currentSettings.company === "لقمة وسهم") {
    currentSettings.company = "سُفرة";
    db.prepare("UPDATE settings SET payload=? WHERE id=1").run(JSON.stringify(currentSettings));
  }
  if (!db.prepare("PRAGMA table_info(meals)").all().some(c => c.name === "quantity"))
    db.exec("ALTER TABLE meals ADD COLUMN quantity INTEGER NOT NULL DEFAULT 30 CHECK(quantity>0)");
  if (!db.prepare("PRAGMA table_info(day_meals)").all().some(c => c.name === "quantity"))
    db.exec("ALTER TABLE day_meals ADD COLUMN quantity INTEGER NOT NULL DEFAULT 30 CHECK(quantity>0)");
  const seed = !db.prepare("SELECT 1 FROM audit WHERE event='catalog.initialized'").get();
  const insert = db.prepare(
    "INSERT OR IGNORE INTO meals(id,name,description,price,restaurant,allergens,image) VALUES(?,?,?,?,?,?,?)",
  );
  if (seed) for (const m of MEALS)
    insert.run(
      m.id,
      m.name,
      m.description,
      m.price,
      m.restaurant,
      m.allergens,
      m.image,
    );
  if (seed) db.prepare("INSERT INTO audit(at,event,detail) VALUES(?,?,?)").run(Date.now(), 'catalog.initialized', '{}');
  return db;
}
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
