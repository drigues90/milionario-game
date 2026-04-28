const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');

const dbPath = path.join(__dirname, '..', 'data', 'milionario.sqlite');

let SQL;
let db;

function persistDb() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

function run(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  persistDb();
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);

  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }

  stmt.free();
  return row;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);

  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }

  stmt.free();
  return rows;
}

function initSchema() {
  run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      is_admin INTEGER NOT NULL DEFAULT 0,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const userColumns = all('PRAGMA table_info(users)');
  const hasIsAdminColumn = userColumns.some((col) => col.name === 'is_admin');
  if (!hasIsAdminColumn) {
    run('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
  }

  run(`
    CREATE TABLE IF NOT EXISTS game_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      draw_done INTEGER NOT NULL DEFAULT 0,
      millionaire_user_id INTEGER,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (millionaire_user_id) REFERENCES users(id)
    );
  `);

  run(`
    CREATE TABLE IF NOT EXISTS player_roles (
      user_id INTEGER PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('POBRE', 'MILIONARIO')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  run(`
    CREATE TABLE IF NOT EXISTS missions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES users(id)
    );
  `);

  const missionsTableSql = get(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'missions'"
  );

  if (missionsTableSql && String(missionsTableSql.sql).includes('UNIQUE(owner_user_id)')) {
    run('ALTER TABLE missions RENAME TO missions_old');

    run(`
      CREATE TABLE IF NOT EXISTS missions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (owner_user_id) REFERENCES users(id)
      );
    `);

    run(`
      INSERT INTO missions (owner_user_id, content, created_at)
      SELECT owner_user_id, content, created_at
      FROM missions_old;
    `);

    run('DROP TABLE missions_old');
  }

  run(`
    CREATE TABLE IF NOT EXISTS selected_missions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      millionaire_user_id INTEGER NOT NULL,
      owner_user_id INTEGER NOT NULL,
      mission_id INTEGER NOT NULL,
      drawn_at TEXT NOT NULL,
      UNIQUE(owner_user_id),
      FOREIGN KEY (millionaire_user_id) REFERENCES users(id),
      FOREIGN KEY (owner_user_id) REFERENCES users(id),
      FOREIGN KEY (mission_id) REFERENCES missions(id)
    );
  `);

  run(`
    CREATE TABLE IF NOT EXISTS profile_views (
      user_id INTEGER PRIMARY KEY,
      viewed_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  const state = get('SELECT * FROM game_state WHERE id = 1');
  if (!state) {
    run(
      'INSERT INTO game_state (id, draw_done, millionaire_user_id, updated_at) VALUES (1, 0, NULL, ?)',
      [new Date().toISOString()]
    );
  }

  const adminUser = get('SELECT id FROM users WHERE username = ?', ['admin']);
  if (!adminUser) {
    const adminPasswordHash = bcrypt.hashSync('admin', 10);
    run('INSERT INTO users (username, is_admin, password_hash, created_at) VALUES (?, 1, ?, ?)', [
      'admin',
      adminPasswordHash,
      new Date().toISOString(),
    ]);
  } else {
    run('UPDATE users SET is_admin = 1 WHERE username = ?', ['admin']);
  }
}

async function initDb() {
  SQL = await initSqlJs({});

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  initSchema();
}

module.exports = {
  initDb,
  run,
  get,
  all,
};
