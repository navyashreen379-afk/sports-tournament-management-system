'use strict';
// Sports Tournament Management System - backend (plain Node.js http server + REST API)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, verifyPassword } = require('./db');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

/* ---------- validation helpers ---------- */
function text(v, label, { required = false, max = 120 } = {}) {
    const s = v == null ? '' : String(v).trim();
    if (required && !s) throw new HttpError(400, `${label} is required.`);
    if (s.length > max) throw new HttpError(400, `${label} is too long (max ${max} characters).`);
    return s || null;
}
function int(v, label, { min = 0, max = 1000000, required = false } = {}) {
    if (v === '' || v == null) {
        if (required) throw new HttpError(400, `${label} is required.`);
        return null;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
        throw new HttpError(400, `${label} must be a whole number between ${min} and ${max}.`);
    }
    return n;
}
function date(v, label) {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
        throw new HttpError(400, `${label} must be a valid date.`);
    }
    return v;
}
function time(v) {
    if (!v) return null;
    if (!/^\d{2}:\d{2}$/.test(v)) throw new HttpError(400, 'Time must be in HH:MM format.');
    return v;
}
function oneOf(v, list, label) {
    if (!list.includes(v)) throw new HttpError(400, `${label} must be one of: ${list.join(', ')}.`);
    return v;
}
function mustExist(table, id, label) {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!row) throw new HttpError(404, `${label} not found.`);
    return row;
}

/* ---------- sessions (in memory) ---------- */
const sessions = new Map();           // token -> { userId, username, expires }
const SESSION_MS = 8 * 60 * 60 * 1000;
const failedLogins = new Map();       // ip -> { count, until }

function getSession(req) {
    const m = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || '');
    if (!m) return null;
    const s = sessions.get(m[1]);
    if (!s || s.expires < Date.now()) { sessions.delete(m[1]); return null; }
    return { token: m[1], ...s };
}

/* ---------- standings ---------- */
function standings(tournamentId) {
    const table = new Map();
    db.prepare('SELECT id, name FROM teams WHERE tournament_id = ?').all(tournamentId).forEach(t => {
        table.set(t.id, { team_id: t.id, team: t.name, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 });
    });
    const done = db.prepare("SELECT * FROM matches WHERE tournament_id = ? AND status = 'Completed'").all(tournamentId);
    for (const m of done) {
        const a = table.get(m.team1_id), b = table.get(m.team2_id);
        if (!a || !b) continue;
        a.P++; b.P++;
        a.GF += m.score1; a.GA += m.score2;
        b.GF += m.score2; b.GA += m.score1;
        if (m.score1 > m.score2) { a.W++; b.L++; a.Pts += 3; }
        else if (m.score1 < m.score2) { b.W++; a.L++; b.Pts += 3; }
        else { a.D++; b.D++; a.Pts++; b.Pts++; }
    }
    const rows = [...table.values()];
    rows.forEach(r => { r.GD = r.GF - r.GA; });
    rows.sort((x, y) => y.Pts - x.Pts || y.GD - x.GD || y.GF - x.GF || x.team.localeCompare(y.team));
    return rows;
}

const MATCH_SELECT = `SELECT m.*, t1.name AS team1, t2.name AS team2, tr.name AS tournament
    FROM matches m
    JOIN teams t1 ON t1.id = m.team1_id
    JOIN teams t2 ON t2.id = m.team2_id
    JOIN tournaments tr ON tr.id = m.tournament_id`;

/* ---------- routes ---------- */
const routes = [];
function route(method, pattern, handler, { auth = false } = {}) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '(\\d+)'; }) + '/?$');
    routes.push({ method, re, keys, handler, auth });
}

// --- auth ---
route('POST', '/api/login', (ctx) => {
    const ip = ctx.req.socket.remoteAddress;
    const f = failedLogins.get(ip);
    if (f && f.count >= 10 && f.until > Date.now()) {
        throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes.');
    }
    const username = text(ctx.body.username, 'Username', { required: true, max: 50 });
    const password = String(ctx.body.password || '');
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
        failedLogins.set(ip, { count: (f && f.until > Date.now() ? f.count : 0) + 1, until: Date.now() + 15 * 60 * 1000 });
        throw new HttpError(401, 'Invalid username or password.');
    }
    failedLogins.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { userId: user.id, username: user.username, expires: Date.now() + SESSION_MS });
    ctx.cookie = `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`;
    return { username: user.username };
});
route('POST', '/api/logout', (ctx) => {
    if (ctx.session) sessions.delete(ctx.session.token);
    ctx.cookie = 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
    return { ok: true };
});
route('GET', '/api/me', (ctx) => (ctx.session ? { username: ctx.session.username } : null));

// --- dashboard ---
route('GET', '/api/dashboard', () => {
    const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    return {
        counts: { tournaments: count('tournaments'), teams: count('teams'), players: count('players'), matches: count('matches') },
        active: db.prepare("SELECT * FROM tournaments WHERE status <> 'Completed' ORDER BY start_date LIMIT 4").all(),
        upcoming: db.prepare(MATCH_SELECT + " WHERE m.status = 'Scheduled' ORDER BY m.match_date, m.match_time LIMIT 5").all(),
        recent: db.prepare(MATCH_SELECT + " WHERE m.status = 'Completed' ORDER BY m.match_date DESC, m.match_time DESC LIMIT 5").all(),
    };
});

// --- tournaments ---
const STATUSES = ['Upcoming', 'Ongoing', 'Completed'];
function tournamentInput(b) {
    const start = date(b.start_date, 'Start date');
    const end = date(b.end_date, 'End date');
    if (end < start) throw new HttpError(400, 'End date cannot be before the start date.');
    return [text(b.name, 'Name', { required: true }), text(b.sport, 'Sport', { required: true, max: 50 }),
            text(b.venue, 'Venue'), start, end, oneOf(b.status || 'Upcoming', STATUSES, 'Status')];
}
route('GET', '/api/tournaments', () => db.prepare(`SELECT t.*,
    (SELECT COUNT(*) FROM teams WHERE tournament_id = t.id) AS team_count,
    (SELECT COUNT(*) FROM matches WHERE tournament_id = t.id) AS match_count
    FROM tournaments t ORDER BY t.start_date DESC`).all());
route('POST', '/api/tournaments', (ctx) => {
    const r = db.prepare('INSERT INTO tournaments (name, sport, venue, start_date, end_date, status) VALUES (?,?,?,?,?,?)')
        .run(...tournamentInput(ctx.body));
    ctx.status = 201;
    return { id: Number(r.lastInsertRowid) };
}, { auth: true });
route('PUT', '/api/tournaments/:id', (ctx) => {
    mustExist('tournaments', ctx.params.id, 'Tournament');
    db.prepare('UPDATE tournaments SET name=?, sport=?, venue=?, start_date=?, end_date=?, status=? WHERE id=?')
        .run(...tournamentInput(ctx.body), ctx.params.id);
    return { ok: true };
}, { auth: true });
route('DELETE', '/api/tournaments/:id', (ctx) => {
    mustExist('tournaments', ctx.params.id, 'Tournament');
    db.prepare('DELETE FROM tournaments WHERE id = ?').run(ctx.params.id);
    return { ok: true };
}, { auth: true });

// --- teams ---
route('GET', '/api/teams', (ctx) => {
    const t = Number(ctx.query.get('tournament')) || 0;
    const sql = `SELECT tm.*, tr.name AS tournament,
        (SELECT COUNT(*) FROM players WHERE team_id = tm.id) AS player_count
        FROM teams tm JOIN tournaments tr ON tr.id = tm.tournament_id`;
    return t ? db.prepare(sql + ' WHERE tm.tournament_id = ? ORDER BY tm.name').all(t)
             : db.prepare(sql + ' ORDER BY tr.name, tm.name').all();
});
route('POST', '/api/teams', (ctx) => {
    const tid = int(ctx.body.tournament_id, 'Tournament', { required: true });
    mustExist('tournaments', tid, 'Tournament');
    const r = db.prepare('INSERT INTO teams (tournament_id, name, coach, contact) VALUES (?,?,?,?)')
        .run(tid, text(ctx.body.name, 'Team name', { required: true, max: 100 }),
             text(ctx.body.coach, 'Coach', { max: 100 }), text(ctx.body.contact, 'Contact', { max: 100 }));
    ctx.status = 201;
    return { id: Number(r.lastInsertRowid) };
}, { auth: true });
route('PUT', '/api/teams/:id', (ctx) => {
    mustExist('teams', ctx.params.id, 'Team');
    db.prepare('UPDATE teams SET name=?, coach=?, contact=? WHERE id=?')
        .run(text(ctx.body.name, 'Team name', { required: true, max: 100 }),
             text(ctx.body.coach, 'Coach', { max: 100 }), text(ctx.body.contact, 'Contact', { max: 100 }), ctx.params.id);
    return { ok: true };
}, { auth: true });
route('DELETE', '/api/teams/:id', (ctx) => {
    mustExist('teams', ctx.params.id, 'Team');
    db.prepare('DELETE FROM teams WHERE id = ?').run(ctx.params.id);
    return { ok: true };
}, { auth: true });

// --- players ---
function playerInput(b) {
    const teamId = int(b.team_id, 'Team', { required: true });
    mustExist('teams', teamId, 'Team');
    return [teamId, text(b.name, 'Player name', { required: true, max: 100 }),
            int(b.jersey_no, 'Jersey number', { min: 0, max: 999 }), text(b.position, 'Position', { max: 50 }),
            int(b.age, 'Age', { min: 5, max: 80 })];
}
route('GET', '/api/players', (ctx) => {
    const team = Number(ctx.query.get('team')) || 0;
    const sql = `SELECT p.*, tm.name AS team, tr.name AS tournament FROM players p
        JOIN teams tm ON tm.id = p.team_id JOIN tournaments tr ON tr.id = tm.tournament_id`;
    return team ? db.prepare(sql + ' WHERE p.team_id = ? ORDER BY p.jersey_no, p.name').all(team)
                : db.prepare(sql + ' ORDER BY tm.name, p.jersey_no, p.name').all();
});
route('POST', '/api/players', (ctx) => {
    const r = db.prepare('INSERT INTO players (team_id, name, jersey_no, position, age) VALUES (?,?,?,?,?)')
        .run(...playerInput(ctx.body));
    ctx.status = 201;
    return { id: Number(r.lastInsertRowid) };
}, { auth: true });
route('PUT', '/api/players/:id', (ctx) => {
    mustExist('players', ctx.params.id, 'Player');
    db.prepare('UPDATE players SET team_id=?, name=?, jersey_no=?, position=?, age=? WHERE id=?')
        .run(...playerInput(ctx.body), ctx.params.id);
    return { ok: true };
}, { auth: true });
route('DELETE', '/api/players/:id', (ctx) => {
    mustExist('players', ctx.params.id, 'Player');
    db.prepare('DELETE FROM players WHERE id = ?').run(ctx.params.id);
    return { ok: true };
}, { auth: true });

// --- matches ---
route('GET', '/api/matches', (ctx) => {
    const t = Number(ctx.query.get('tournament')) || 0;
    return t ? db.prepare(MATCH_SELECT + ' WHERE m.tournament_id = ? ORDER BY m.match_date, m.match_time').all(t)
             : db.prepare(MATCH_SELECT + ' ORDER BY m.match_date, m.match_time').all();
});
route('POST', '/api/matches', (ctx) => {
    const b = ctx.body;
    const tid = int(b.tournament_id, 'Tournament', { required: true });
    const t1 = int(b.team1_id, 'Team 1', { required: true });
    const t2 = int(b.team2_id, 'Team 2', { required: true });
    mustExist('tournaments', tid, 'Tournament');
    if (t1 === t2) throw new HttpError(400, 'A team cannot play against itself.');
    for (const id of [t1, t2]) {
        const team = mustExist('teams', id, 'Team');
        if (team.tournament_id !== tid) throw new HttpError(400, 'Both teams must belong to the selected tournament.');
    }
    const r = db.prepare('INSERT INTO matches (tournament_id, team1_id, team2_id, match_date, match_time, venue) VALUES (?,?,?,?,?,?)')
        .run(tid, t1, t2, date(b.match_date, 'Match date'), time(b.match_time), text(b.venue, 'Venue'));
    ctx.status = 201;
    return { id: Number(r.lastInsertRowid) };
}, { auth: true });
route('PUT', '/api/matches/:id/result', (ctx) => {
    mustExist('matches', ctx.params.id, 'Match');
    if (ctx.body.clear) {
        db.prepare("UPDATE matches SET score1=NULL, score2=NULL, status='Scheduled' WHERE id=?").run(ctx.params.id);
        return { ok: true };
    }
    const s1 = int(ctx.body.score1, 'Score 1', { required: true, max: 999 });
    const s2 = int(ctx.body.score2, 'Score 2', { required: true, max: 999 });
    db.prepare("UPDATE matches SET score1=?, score2=?, status='Completed' WHERE id=?").run(s1, s2, ctx.params.id);
    return { ok: true };
}, { auth: true });
route('DELETE', '/api/matches/:id', (ctx) => {
    mustExist('matches', ctx.params.id, 'Match');
    db.prepare('DELETE FROM matches WHERE id = ?').run(ctx.params.id);
    return { ok: true };
}, { auth: true });

// --- standings ---
route('GET', '/api/standings/:id', (ctx) => {
    mustExist('tournaments', ctx.params.id, 'Tournament');
    return standings(ctx.params.id);
});

/* ---------- request handling ---------- */
const MIME = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > 100 * 1024) { reject(new HttpError(413, 'Request too large.')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => {
            if (!chunks.length) return resolve({});
            try {
                const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                resolve(data && typeof data === 'object' ? data : {});
            } catch { reject(new HttpError(400, 'Invalid JSON.')); }
        });
        req.on('error', reject);
    });
}

function send(res, status, payload, headers = {}) {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(body);
}

async function handleApi(req, res, url) {
    try {
        const matched = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
        if (!matched) {
            const pathKnown = routes.some((r) => r.re.test(url.pathname));
            throw new HttpError(pathKnown ? 405 : 404, pathKnown ? 'Method not allowed.' : 'API route not found.');
        }
        const session = getSession(req);
        if (matched.auth && !session) throw new HttpError(401, 'Please log in as admin to do that.');

        let body = {};
        if (req.method !== 'GET' && req.method !== 'DELETE') {
            if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
                throw new HttpError(415, 'Content-Type must be application/json.');
            }
            body = await readBody(req);
        }
        const values = matched.re.exec(url.pathname).slice(1);
        const params = {};
        matched.keys.forEach((k, i) => { params[k] = Number(values[i]); });

        const ctx = { req, body, params, query: url.searchParams, session, status: 200, cookie: null };
        const data = matched.handler(ctx);
        send(res, ctx.status, data, ctx.cookie ? { 'Set-Cookie': ctx.cookie } : {});
    } catch (err) {
        if (err instanceof HttpError) return send(res, err.status, { error: err.message });
        if (/UNIQUE constraint/.test(String(err.message))) {
            return send(res, 409, { error: 'That team name already exists in this tournament.' });
        }
        console.error(err);
        send(res, 500, { error: 'Something went wrong on the server.' });
    }
}

function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
    fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(req.method === 'HEAD' ? undefined : data);
    });
}

const server = http.createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'");
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
    serveStatic(req, res, url);
});

if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`Sports Tournament Management System running at http://localhost:${PORT}`);
        console.log('Admin login: admin / admin123');
    });
}

module.exports = server;
