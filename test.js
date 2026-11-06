'use strict';
// Self-test: starts the server on a temporary database and checks the main features.
// Run with:  npm test
const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const dbFile = path.join(os.tmpdir(), `sports-test-${Date.now()}.db`);
process.env.DB_FILE = dbFile;
const server = require('./server');

let cookie = '';
let base = '';
async function call(method, url, body, { auth = false } = {}) {
    const res = await fetch(base + url, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth && cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    let data = null;
    try { data = await res.json(); } catch (e) { /* none */ }
    return { status: res.status, data };
}

(async () => {
    await new Promise((r) => server.listen(0, r));
    base = `http://127.0.0.1:${server.address().port}`;
    let passed = 0;
    const ok = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

    // public pages + static files
    let r = await fetch(base + '/');
    assert.strictEqual(r.status, 200);
    ok('serves frontend', () => {});
    r = await fetch(base + '/../server.js');
    assert.ok(r.status === 404 || r.status === 403);
    ok('blocks path traversal', () => {});

    // public reads
    r = await call('GET', '/api/tournaments');
    ok('lists sample tournaments', () => assert.strictEqual(r.data.length, 2));

    // writes need login
    r = await call('POST', '/api/tournaments', { name: 'X' });
    ok('rejects write when logged out (401)', () => assert.strictEqual(r.status, 401));

    r = await call('POST', '/api/login', { username: 'admin', password: 'wrong' });
    ok('rejects wrong password', () => assert.strictEqual(r.status, 401));

    r = await call('POST', '/api/login', { username: 'admin', password: 'admin123' });
    ok('admin login works', () => { assert.strictEqual(r.status, 200); assert.ok(cookie.startsWith('sid=')); });

    // tournament + validation
    r = await call('POST', '/api/tournaments', { name: 'Bad', sport: 'Football', start_date: '2026-12-10', end_date: '2026-12-01' }, { auth: true });
    ok('rejects end date before start date', () => assert.strictEqual(r.status, 400));

    r = await call('POST', '/api/tournaments', { name: 'Test Cup', sport: 'Kabaddi', venue: 'Hall', start_date: '2026-12-01', end_date: '2026-12-05', status: 'Ongoing' }, { auth: true });
    ok('creates tournament', () => assert.strictEqual(r.status, 201));
    const tid = r.data.id;

    // teams
    const teamIds = [];
    for (const n of ['Alpha', 'Beta', 'Gamma']) {
        r = await call('POST', '/api/teams', { tournament_id: tid, name: n }, { auth: true });
        teamIds.push(r.data.id);
    }
    ok('creates teams', () => assert.strictEqual(teamIds.length, 3));
    r = await call('POST', '/api/teams', { tournament_id: tid, name: 'Alpha' }, { auth: true });
    ok('rejects duplicate team name (409)', () => assert.strictEqual(r.status, 409));

    // players
    r = await call('POST', '/api/players', { team_id: teamIds[0], name: 'Ravi', jersey_no: '7', position: 'Raider', age: '22' }, { auth: true });
    ok('adds player', () => assert.strictEqual(r.status, 201));
    r = await call('POST', '/api/players', { team_id: teamIds[0], name: 'Old', age: '200' }, { auth: true });
    ok('rejects invalid age', () => assert.strictEqual(r.status, 400));

    // matches + validation
    r = await call('POST', '/api/matches', { tournament_id: tid, team1_id: teamIds[0], team2_id: teamIds[0], match_date: '2026-12-02' }, { auth: true });
    ok('rejects team playing itself', () => assert.strictEqual(r.status, 400));
    r = await call('POST', '/api/matches', { tournament_id: tid, team1_id: 1, team2_id: teamIds[1], match_date: '2026-12-02' }, { auth: true });
    ok('rejects team from another tournament', () => assert.strictEqual(r.status, 400));

    const mk = async (a, b) => (await call('POST', '/api/matches', { tournament_id: tid, team1_id: teamIds[a], team2_id: teamIds[b], match_date: '2026-12-02', match_time: '10:00' }, { auth: true })).data.id;
    const m1 = await mk(0, 1), m2 = await mk(1, 2), m3 = await mk(0, 2);
    r = await call('PUT', `/api/matches/${m1}/result`, { score1: 3, score2: 1 }, { auth: true });   // Alpha wins
    r = await call('PUT', `/api/matches/${m2}/result`, { score1: 2, score2: 2 }, { auth: true });   // draw
    r = await call('PUT', `/api/matches/${m3}/result`, { score1: -1, score2: 2 }, { auth: true });
    ok('rejects negative score', () => assert.strictEqual(r.status, 400));
    r = await call('PUT', `/api/matches/${m3}/result`, { score1: 0, score2: 4 }, { auth: true });   // Gamma wins

    // standings: Alpha 3pts GD+1(3-1, 0-4 => GF3 GA5 => -2), compute exactly
    r = await call('GET', `/api/standings/${tid}`);
    const s = Object.fromEntries(r.data.map((x) => [x.team, x]));
    ok('standings: Gamma leads (W+D = 4 pts, GD +4)', () => {
        assert.strictEqual(r.data[0].team, 'Gamma');
        assert.strictEqual(s.Gamma.Pts, 4); assert.strictEqual(s.Gamma.GD, 4);
    });
    ok('standings: Alpha 3 pts, Beta 1 pt', () => {
        assert.strictEqual(s.Alpha.Pts, 3); assert.strictEqual(s.Alpha.W, 1); assert.strictEqual(s.Alpha.L, 1);
        assert.strictEqual(s.Beta.Pts, 1); assert.strictEqual(s.Beta.D, 1);
    });

    // clear a result
    await call('PUT', `/api/matches/${m1}/result`, { clear: true }, { auth: true });
    r = await call('GET', `/api/standings/${tid}`);
    ok('clearing a result updates standings', () => assert.strictEqual(r.data.find((x) => x.team === 'Alpha').P, 1));

    // cascade delete
    r = await call('DELETE', `/api/tournaments/${tid}`, null, { auth: true });
    ok('deletes tournament', () => assert.strictEqual(r.status, 200));
    r = await call('GET', `/api/teams?tournament=${tid}`);
    ok('cascade removed its teams', () => assert.strictEqual(r.data.length, 0));

    // logout
    await call('POST', '/api/logout', {}, { auth: true });
    r = await call('POST', '/api/tournaments', { name: 'X' }, { auth: true });
    ok('logout ends session', () => assert.strictEqual(r.status, 401));

    console.log(`\nAll ${passed} checks passed.`);
    server.close();
    for (const f of [dbFile, dbFile + '-wal', dbFile + '-shm']) fs.rmSync(f, { force: true });
})().catch((err) => {
    console.error('\nTEST FAILED:', err);
    process.exit(1);
});
