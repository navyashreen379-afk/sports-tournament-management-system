'use strict';
// Database layer: SQLite using Node's built-in "node:sqlite" module (no npm packages needed).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');

const db = new DatabaseSync(process.env.DB_FILE || path.join(__dirname, 'sports.db'));
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tournaments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    sport      TEXT NOT NULL,
    venue      TEXT,
    start_date TEXT NOT NULL,
    end_date   TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'Upcoming' CHECK (status IN ('Upcoming','Ongoing','Completed'))
);

CREATE TABLE IF NOT EXISTS teams (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    coach         TEXT,
    contact       TEXT,
    UNIQUE (tournament_id, name)
);

CREATE TABLE IF NOT EXISTS players (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id   INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name      TEXT NOT NULL,
    jersey_no INTEGER,
    position  TEXT,
    age       INTEGER
);

CREATE TABLE IF NOT EXISTS matches (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    team1_id      INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    team2_id      INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    match_date    TEXT NOT NULL,
    match_time    TEXT,
    venue         TEXT,
    score1        INTEGER,
    score2        INTEGER,
    status        TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled','Completed'))
);
`);

/* ---------- password hashing (scrypt, built into Node) ---------- */
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return salt + ':' + hash;
}

function verifyPassword(password, stored) {
    const [salt, hash] = stored.split(':');
    const expected = Buffer.from(hash, 'hex');
    const actual = crypto.scryptSync(password, salt, 64);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/* ---------- sample data (only on first run) ---------- */
function seed() {
    if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;

    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run('admin', hashPassword('admin123'));

    const addT = db.prepare('INSERT INTO tournaments (name, sport, venue, start_date, end_date, status) VALUES (?,?,?,?,?,?)');
    addT.run('Inter-College Football Cup 2026', 'Football', 'University Stadium', '2026-11-01', '2026-11-30', 'Ongoing');
    addT.run('Annual Cricket League', 'Cricket', 'City Cricket Ground', '2026-12-10', '2026-12-25', 'Upcoming');

    const addTeam = db.prepare('INSERT INTO teams (tournament_id, name, coach, contact) VALUES (?,?,?,?)');
    [[1, 'ATME Warriors', 'R. Kumar', '9000000001'],
     [1, 'VTU Strikers', 'S. Rao', '9000000002'],
     [1, 'City Lions', 'M. Khan', '9000000003'],
     [1, 'Tech Titans', 'A. Nair', '9000000004'],
     [2, 'Royal Challengers CC', 'P. Shetty', '9000000005'],
     [2, 'Mysuru Kings', 'D. Gowda', '9000000006']].forEach(r => addTeam.run(...r));

    const addP = db.prepare('INSERT INTO players (team_id, name, jersey_no, position, age) VALUES (?,?,?,?,?)');
    [[1, 'Arjun K', 9, 'Forward', 21], [1, 'Rohit S', 1, 'Goalkeeper', 22],
     [2, 'Kiran P', 10, 'Midfielder', 20], [2, 'Vikram R', 5, 'Defender', 23],
     [3, 'Imran A', 7, 'Forward', 21], [4, 'Suresh N', 4, 'Defender', 22]].forEach(r => addP.run(...r));

    const addM = db.prepare(`INSERT INTO matches (tournament_id, team1_id, team2_id, match_date, match_time, venue, score1, score2, status)
                             VALUES (?,?,?,?,?,?,?,?,?)`);
    addM.run(1, 1, 2, '2026-11-02', '16:00', 'University Stadium', 2, 1, 'Completed');
    addM.run(1, 3, 4, '2026-11-03', '16:00', 'University Stadium', 1, 1, 'Completed');
    addM.run(1, 1, 3, '2026-11-05', '16:00', 'University Stadium', 0, 2, 'Completed');
    addM.run(1, 2, 4, '2026-11-12', '16:00', 'University Stadium', null, null, 'Scheduled');
    addM.run(1, 1, 4, '2026-11-15', '16:00', 'University Stadium', null, null, 'Scheduled');
    addM.run(2, 5, 6, '2026-12-10', '09:30', 'City Cricket Ground', null, null, 'Scheduled');
}
seed();

module.exports = { db, hashPassword, verifyPassword };
