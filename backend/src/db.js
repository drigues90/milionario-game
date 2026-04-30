const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');

const dbPath = path.join(__dirname, '..', 'data', 'milionario.sqlite');
const devSnapshotPath = path.join(__dirname, '..', 'data', 'milionario.dev.snapshot.sqlite');

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
      forced_millionaire_user_id INTEGER,
      current_round INTEGER NOT NULL DEFAULT 1,
      voting_started INTEGER NOT NULL DEFAULT 0,
      voting_finalized INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (millionaire_user_id) REFERENCES users(id)
    );
  `);

  const gameStateColumns = all('PRAGMA table_info(game_state)');
  const hasCurrentRound = gameStateColumns.some((col) => col.name === 'current_round');
  if (!hasCurrentRound) {
    run('ALTER TABLE game_state ADD COLUMN current_round INTEGER NOT NULL DEFAULT 1');
  }

  const hasVotingStarted = gameStateColumns.some((col) => col.name === 'voting_started');
  if (!hasVotingStarted) {
    run('ALTER TABLE game_state ADD COLUMN voting_started INTEGER NOT NULL DEFAULT 0');
  }

  const hasVotingFinalized = gameStateColumns.some((col) => col.name === 'voting_finalized');
  if (!hasVotingFinalized) {
    run('ALTER TABLE game_state ADD COLUMN voting_finalized INTEGER NOT NULL DEFAULT 0');
  }

  const hasForcedMillionaireUserId = gameStateColumns.some(
    (col) => col.name === 'forced_millionaire_user_id'
  );
  if (!hasForcedMillionaireUserId) {
    run('ALTER TABLE game_state ADD COLUMN forced_millionaire_user_id INTEGER');
  }

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
      assigned_to_millionaire INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES users(id)
    );
  `);

  const missionColumns = all('PRAGMA table_info(missions)');
  const hasAssignedToMillionaire = missionColumns.some(
    (col) => col.name === 'assigned_to_millionaire'
  );
  if (!hasAssignedToMillionaire) {
    run('ALTER TABLE missions ADD COLUMN assigned_to_millionaire INTEGER NOT NULL DEFAULT 0');
  }

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
        assigned_to_millionaire INTEGER NOT NULL DEFAULT 0,
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
      completed INTEGER NOT NULL DEFAULT 0,
      UNIQUE(owner_user_id),
      FOREIGN KEY (millionaire_user_id) REFERENCES users(id),
      FOREIGN KEY (owner_user_id) REFERENCES users(id),
      FOREIGN KEY (mission_id) REFERENCES missions(id)
    );
  `);

  const selectedMissionColumns = all('PRAGMA table_info(selected_missions)');
  const hasCompleted = selectedMissionColumns.some((col) => col.name === 'completed');
  if (!hasCompleted) {
    run('ALTER TABLE selected_missions ADD COLUMN completed INTEGER NOT NULL DEFAULT 0');
  }

  run(`
    CREATE TABLE IF NOT EXISTS player_points (
      user_id INTEGER PRIMARY KEY,
      points INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  run(`
    CREATE TABLE IF NOT EXISTS round_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_number INTEGER NOT NULL,
      voter_user_id INTEGER NOT NULL,
      target_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(round_number, voter_user_id),
      FOREIGN KEY (voter_user_id) REFERENCES users(id),
      FOREIGN KEY (target_user_id) REFERENCES users(id)
    );
  `);

  run(`
    CREATE TABLE IF NOT EXISTS round_profile_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_number INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      viewed_at TEXT NOT NULL,
      UNIQUE(round_number, user_id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  run(`
    CREATE TABLE IF NOT EXISTS millionaire_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_number INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      assigned_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  run(`
    CREATE TABLE IF NOT EXISTS round_millionaire_refusals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_number INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      refused_at TEXT NOT NULL,
      UNIQUE(round_number, user_id),
      FOREIGN KEY (user_id) REFERENCES users(id)
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
      'INSERT INTO game_state (id, draw_done, millionaire_user_id, current_round, voting_started, voting_finalized, updated_at) VALUES (1, 0, NULL, 1, 0, 0, ?)',
      [new Date().toISOString()]
    );
  }

  const legacyViewsCount = get('SELECT COUNT(*) AS total FROM profile_views');
  if (Number(legacyViewsCount?.total || 0) > 0) {
    run(`
      INSERT OR IGNORE INTO round_profile_views (round_number, user_id, viewed_at)
      SELECT 1, user_id, viewed_at
      FROM profile_views;
    `);
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

  run(`
    INSERT OR IGNORE INTO player_points (user_id, points)
    SELECT id, 0
    FROM users
    WHERE is_admin = 0;
  `);
}

async function initDb() {
  SQL = await initSqlJs({});

  // In dev mode, always reset the active DB from the saved test snapshot.
  if (process.env.NODE_ENV === 'development' && fs.existsSync(devSnapshotPath)) {
    fs.copyFileSync(devSnapshotPath, dbPath);
  }

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
