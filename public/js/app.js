'use strict';
// Frontend: single-page app using hash routing (#/teams, #/matches ...) and the REST API.
const app = document.getElementById('app');
const navEl = document.getElementById('mainNav');
let me = null; // { username } when admin is logged in

/* ---------- helpers ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const shortDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const badge = (s) => `<span class="badge badge-${esc(s.toLowerCase())}">${esc(s)}</span>`;

async function api(method, url, body) {
    const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) throw new Error((data && data.error) || 'Request failed.');
    return data;
}

function toast(message, type = 'success') {
    const box = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

const field = (label, name, value = '', attrs = '') =>
    `<label>${label}<input name="${name}" value="${esc(value)}" ${attrs}></label>`;
const select = (label, name, options, selected, attrs = '') =>
    `<label>${label}<select name="${name}" ${attrs}>${options.map((o) =>
        `<option value="${esc(o.value)}" ${String(o.value) === String(selected) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
const searchBox = (tableId, placeholder) =>
    `<input type="search" class="search" data-table="${tableId}" placeholder="${placeholder}">`;
const emptyRow = (cols, msg) => `<tr><td colspan="${cols}" class="empty">${msg}</td></tr>`;

function route() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [page, query] = raw.split('?');
    const name = page || 'home';
    const params = new URLSearchParams(query || '');
    renderNav(name);
    const fn = pages[name] || pages.home;
    fn(params).catch((err) => { app.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; });
}
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

function renderNav(active) {
    const links = [['home', 'Home', '#/'], ['tournaments', 'Tournaments', '#/tournaments'], ['teams', 'Teams', '#/teams'],
                   ['players', 'Players', '#/players'], ['matches', 'Matches', '#/matches'], ['standings', 'Standings', '#/standings']];
    navEl.innerHTML = links.map(([key, label, href]) =>
        `<a href="${href}" class="${key === active ? 'active' : ''}">${label}</a>`).join('') +
        (me ? `<a href="#" class="btn-nav" data-logout="1">Logout (${esc(me.username)})</a>`
            : `<a href="#/login" class="btn-nav">Admin Login</a>`);
    navEl.classList.remove('open');
}

/* ---------- pages ---------- */
const pages = {};

pages.home = async () => {
    const d = await api('GET', '/api/dashboard');
    const c = d.counts;
    app.innerHTML = `
    <section class="hero">
        <h1>Sports Tournament Management System</h1>
        <p>Create tournaments, register teams and players, schedule matches, record results and watch the standings update automatically.</p>
    </section>
    <section class="stats">
        ${[['Tournaments', c.tournaments], ['Teams', c.teams], ['Players', c.players], ['Matches', c.matches]].map(([l, n]) =>
            `<div class="stat"><span class="stat-num">${n}</span><span class="stat-label">${l}</span></div>`).join('')}
    </section>
    ${d.active.length ? `<h2>Active &amp; Upcoming Tournaments</h2><div class="grid">${d.active.map((t) => `
        <div class="card">${badge(t.status)}<h3>${esc(t.name)}</h3>
        <p class="muted">${esc(t.sport)} &middot; ${esc(t.venue)}</p>
        <p class="small">${fmtDate(t.start_date)} &ndash; ${fmtDate(t.end_date)}</p>
        <a class="link" href="#/standings?tournament=${t.id}">View standings &rarr;</a></div>`).join('')}</div>` : ''}
    <div class="two-col">
        <section><h2>Upcoming Matches</h2><div class="table-wrap"><table>
            <thead><tr><th>Date</th><th>Match</th><th>Tournament</th></tr></thead><tbody>
            ${d.upcoming.map((m) => `<tr><td>${shortDate(m.match_date)} ${esc(m.match_time)}</td>
                <td><strong>${esc(m.team1)}</strong> vs <strong>${esc(m.team2)}</strong></td><td>${esc(m.tournament)}</td></tr>`).join('') || emptyRow(3, 'No upcoming matches.')}
            </tbody></table></div></section>
        <section><h2>Recent Results</h2><div class="table-wrap"><table>
            <thead><tr><th>Date</th><th>Result</th><th>Tournament</th></tr></thead><tbody>
            ${d.recent.map((m) => `<tr><td>${shortDate(m.match_date)}</td>
                <td>${esc(m.team1)} <span class="score">${m.score1} - ${m.score2}</span> ${esc(m.team2)}</td><td>${esc(m.tournament)}</td></tr>`).join('') || emptyRow(3, 'No results yet.')}
            </tbody></table></div></section>
    </div>`;
};

pages.login = async () => {
    if (me) return go('#/');
    app.innerHTML = `
    <div class="auth-card">
        <h1>Admin Login</h1>
        <p class="muted">Only admins can add or change data. Everyone can view tournaments, fixtures and standings.</p>
        <form class="form" data-method="POST" data-url="/api/login" data-login="1" data-after="#/" data-ok="Logged in.">
            ${field('Username', 'username', '', 'required autofocus')}
            <label>Password<input type="password" name="password" required></label>
            <button class="btn" type="submit">Login</button>
        </form>
        <p class="muted small">Default: admin / admin123</p>
    </div>`;
};

pages.tournaments = async (params) => {
    const list = await api('GET', '/api/tournaments');
    const edit = me ? list.find((t) => t.id === Number(params.get('edit'))) : null;
    const statuses = ['Upcoming', 'Ongoing', 'Completed'].map((s) => ({ value: s, label: s }));
    app.innerHTML = `<h1>Tournaments</h1>
    ${me ? `<section class="panel"><h2>${edit ? 'Edit Tournament' : 'Create Tournament'}</h2>
        <form class="form form-grid" data-method="${edit ? 'PUT' : 'POST'}" data-url="/api/tournaments${edit ? '/' + edit.id : ''}" data-after="#/tournaments">
            ${field('Tournament name *', 'name', edit?.name, 'required maxlength="120"')}
            ${field('Sport *', 'sport', edit?.sport, 'required maxlength="50" placeholder="Football, Cricket, Kabaddi..."')}
            ${field('Venue', 'venue', edit?.venue, 'maxlength="120"')}
            ${select('Status', 'status', statuses, edit?.status || 'Upcoming')}
            ${field('Start date *', 'start_date', edit?.start_date, 'type="date" required')}
            ${field('End date *', 'end_date', edit?.end_date, 'type="date" required')}
            <div class="form-actions"><button class="btn" type="submit">${edit ? 'Save changes' : 'Create tournament'}</button>
            ${edit ? '<a class="btn btn-light" href="#/tournaments">Cancel</a>' : ''}</div>
        </form></section>` : ''}
    <div class="toolbar">${searchBox('tbl', 'Search tournaments...')}</div>
    <div class="table-wrap"><table id="tbl">
        <thead><tr><th>Name</th><th>Sport</th><th>Venue</th><th>Dates</th><th>Status</th><th>Teams</th><th>Matches</th><th></th></tr></thead><tbody>
        ${list.map((t) => `<tr>
            <td><strong>${esc(t.name)}</strong></td><td>${esc(t.sport)}</td><td>${esc(t.venue)}</td>
            <td>${fmtDate(t.start_date)} &ndash; ${fmtDate(t.end_date)}</td><td>${badge(t.status)}</td>
            <td>${t.team_count}</td><td>${t.match_count}</td>
            <td class="actions"><a class="link" href="#/standings?tournament=${t.id}">Standings</a>
            ${me ? `<a class="link" href="#/tournaments?edit=${t.id}">Edit</a>
                <button class="link danger" data-act="1" data-method="DELETE" data-url="/api/tournaments/${t.id}"
                  data-msg="Delete this tournament and ALL its teams, players and matches?">Delete</button>` : ''}</td></tr>`).join('') || emptyRow(8, 'No tournaments yet.')}
        </tbody></table></div>`;
};

pages.teams = async (params) => {
    const [tournaments, teams] = await Promise.all([
        api('GET', '/api/tournaments'),
        api('GET', '/api/teams' + (params.get('tournament') ? '?tournament=' + encodeURIComponent(params.get('tournament')) : '')),
    ]);
    const filter = Number(params.get('tournament')) || 0;
    const edit = me ? teams.find((t) => t.id === Number(params.get('edit'))) : null;
    const tOpts = tournaments.map((t) => ({ value: t.id, label: t.name }));
    app.innerHTML = `<h1>Teams</h1>
    ${me ? `<section class="panel"><h2>${edit ? 'Edit Team' : 'Add Team'}</h2>
        ${!tournaments.length ? '<p class="muted">Create a tournament first.</p>' : `
        <form class="form form-grid" data-method="${edit ? 'PUT' : 'POST'}" data-url="/api/teams${edit ? '/' + edit.id : ''}" data-after="#/teams${filter ? '?tournament=' + filter : ''}">
            ${select('Tournament *', 'tournament_id', tOpts, edit?.tournament_id || filter, edit ? 'disabled' : 'required')}
            ${field('Team name *', 'name', edit?.name, 'required maxlength="100"')}
            ${field('Coach', 'coach', edit?.coach, 'maxlength="100"')}
            ${field('Contact', 'contact', edit?.contact, 'maxlength="100"')}
            <div class="form-actions"><button class="btn" type="submit">${edit ? 'Save changes' : 'Add team'}</button>
            ${edit ? '<a class="btn btn-light" href="#/teams">Cancel</a>' : ''}</div>
        </form>`}</section>` : ''}
    <div class="toolbar">
        <select data-nav="#/teams?tournament=">
            <option value="">All tournaments</option>
            ${tOpts.map((o) => `<option value="${o.value}" ${o.value === filter ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
        ${searchBox('tbl', 'Search teams...')}
    </div>
    <div class="table-wrap"><table id="tbl">
        <thead><tr><th>Team</th><th>Tournament</th><th>Coach</th><th>Contact</th><th>Players</th><th></th></tr></thead><tbody>
        ${teams.map((t) => `<tr><td><strong>${esc(t.name)}</strong></td><td>${esc(t.tournament)}</td><td>${esc(t.coach)}</td>
            <td>${esc(t.contact)}</td><td>${t.player_count}</td>
            <td class="actions"><a class="link" href="#/players?team=${t.id}">Players</a>
            ${me ? `<a class="link" href="#/teams?edit=${t.id}${filter ? '&tournament=' + filter : ''}">Edit</a>
                <button class="link danger" data-act="1" data-method="DELETE" data-url="/api/teams/${t.id}"
                  data-msg="Delete this team, its players and its matches?">Delete</button>` : ''}</td></tr>`).join('') || emptyRow(6, 'No teams found.')}
        </tbody></table></div>`;
};

pages.players = async (params) => {
    const filter = Number(params.get('team')) || 0;
    const [teams, players] = await Promise.all([
        api('GET', '/api/teams'),
        api('GET', '/api/players' + (filter ? '?team=' + filter : '')),
    ]);
    const edit = me ? players.find((p) => p.id === Number(params.get('edit'))) : null;
    const teamOpts = teams.map((t) => ({ value: t.id, label: `${t.name} (${t.tournament})` }));
    app.innerHTML = `<h1>Players</h1>
    ${me ? `<section class="panel"><h2>${edit ? 'Edit Player' : 'Add Player'}</h2>
        ${!teams.length ? '<p class="muted">Add a team first.</p>' : `
        <form class="form form-grid" data-method="${edit ? 'PUT' : 'POST'}" data-url="/api/players${edit ? '/' + edit.id : ''}" data-after="#/players${filter ? '?team=' + filter : ''}">
            ${select('Team *', 'team_id', teamOpts, edit?.team_id || filter, 'required')}
            ${field('Player name *', 'name', edit?.name, 'required maxlength="100"')}
            ${field('Jersey no.', 'jersey_no', edit?.jersey_no, 'type="number" min="0" max="999"')}
            ${field('Position / Role', 'position', edit?.position, 'maxlength="50" placeholder="Forward, Bowler..."')}
            ${field('Age', 'age', edit?.age, 'type="number" min="5" max="80"')}
            <div class="form-actions"><button class="btn" type="submit">${edit ? 'Save changes' : 'Add player'}</button>
            ${edit ? '<a class="btn btn-light" href="#/players">Cancel</a>' : ''}</div>
        </form>`}</section>` : ''}
    <div class="toolbar">
        <select data-nav="#/players?team=">
            <option value="">All teams</option>
            ${teamOpts.map((o) => `<option value="${o.value}" ${o.value === filter ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
        ${searchBox('tbl', 'Search players...')}
    </div>
    <div class="table-wrap"><table id="tbl">
        <thead><tr><th>#</th><th>Player</th><th>Team</th><th>Tournament</th><th>Position</th><th>Age</th><th></th></tr></thead><tbody>
        ${players.map((p) => `<tr><td>${esc(p.jersey_no)}</td><td><strong>${esc(p.name)}</strong></td><td>${esc(p.team)}</td>
            <td>${esc(p.tournament)}</td><td>${esc(p.position)}</td><td>${esc(p.age)}</td>
            <td class="actions">${me ? `<a class="link" href="#/players?edit=${p.id}${filter ? '&team=' + filter : ''}">Edit</a>
                <button class="link danger" data-act="1" data-method="DELETE" data-url="/api/players/${p.id}" data-msg="Delete this player?">Delete</button>` : ''}</td></tr>`).join('') || emptyRow(7, 'No players found.')}
        </tbody></table></div>`;
};

pages.matches = async (params) => {
    const filter = Number(params.get('tournament')) || 0;
    const [tournaments, teams, matches] = await Promise.all([
        api('GET', '/api/tournaments'),
        api('GET', '/api/teams'),
        api('GET', '/api/matches' + (filter ? '?tournament=' + filter : '')),
    ]);
    const here = '#/matches' + (filter ? '?tournament=' + filter : '');
    app.innerHTML = `<h1>Matches &amp; Results</h1>
    ${me ? `<section class="panel"><h2>Schedule a Match</h2>
        ${teams.length < 2 ? '<p class="muted">Add at least two teams first.</p>' : `
        <form class="form form-grid" data-method="POST" data-url="/api/matches" data-after="${here}" data-ok="Match scheduled.">
            <label>Tournament *<select name="tournament_id" id="mTournament" required>
                ${tournaments.map((t) => `<option value="${t.id}" ${t.id === filter ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
            <label>Team 1 *<select name="team1_id" id="mTeam1" required></select></label>
            <label>Team 2 *<select name="team2_id" id="mTeam2" required></select></label>
            ${field('Date *', 'match_date', '', 'type="date" required')}
            ${field('Time', 'match_time', '', 'type="time"')}
            ${field('Venue', 'venue', '', 'maxlength="120"')}
            <div class="form-actions"><button class="btn" type="submit">Schedule match</button></div>
        </form>`}</section>` : ''}
    <div class="toolbar">
        <select data-nav="#/matches?tournament=">
            <option value="">All tournaments</option>
            ${tournaments.map((t) => `<option value="${t.id}" ${t.id === filter ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
        </select>
        ${searchBox('tbl', 'Search matches...')}
    </div>
    <div class="table-wrap"><table id="tbl">
        <thead><tr><th>Date</th><th>Match</th><th>Score</th><th>Tournament</th><th>Venue</th><th>Status</th>${me ? '<th></th>' : ''}</tr></thead><tbody>
        ${matches.map((m) => `<tr>
            <td>${fmtDate(m.match_date)}${m.match_time ? `<br><span class="muted small">${esc(m.match_time)}</span>` : ''}</td>
            <td><strong>${esc(m.team1)}</strong> vs <strong>${esc(m.team2)}</strong></td>
            <td>${m.status === 'Completed' ? `<span class="score">${m.score1} - ${m.score2}</span>`
                : me ? `<form class="score-form" data-method="PUT" data-url="/api/matches/${m.id}/result" data-after="${here}" data-ok="Result saved. Standings updated.">
                        <input type="number" name="score1" min="0" max="999" required><span>-</span>
                        <input type="number" name="score2" min="0" max="999" required>
                        <button class="btn btn-small" type="submit">Save</button></form>` : '<span class="muted">&ndash;</span>'}</td>
            <td>${esc(m.tournament)}</td><td>${esc(m.venue)}</td><td>${badge(m.status)}</td>
            ${me ? `<td class="actions">
                ${m.status === 'Completed' ? `<button class="link" data-act="1" data-method="PUT" data-url="/api/matches/${m.id}/result"
                    data-body='{"clear":true}' data-msg="Clear this result?">Edit result</button>` : ''}
                <button class="link danger" data-act="1" data-method="DELETE" data-url="/api/matches/${m.id}" data-msg="Delete this match?">Delete</button></td>` : ''}
        </tr>`).join('') || emptyRow(me ? 7 : 6, 'No matches found.')}
        </tbody></table></div>`;

    // schedule form: only offer teams that belong to the chosen tournament
    const tSel = document.getElementById('mTournament');
    if (tSel) {
        const t1 = document.getElementById('mTeam1'), t2 = document.getElementById('mTeam2');
        const fill = () => {
            const opts = teams.filter((t) => String(t.tournament_id) === tSel.value)
                .map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
            t1.innerHTML = opts; t2.innerHTML = opts;
            if (t2.options.length > 1) t2.selectedIndex = 1;
        };
        tSel.addEventListener('change', fill);
        fill();
    }
};

pages.standings = async (params) => {
    const tournaments = await api('GET', '/api/tournaments');
    if (!tournaments.length) { app.innerHTML = '<h1>Standings</h1><p class="empty">No tournaments yet.</p>'; return; }
    const id = Number(params.get('tournament')) || tournaments[0].id;
    const rows = await api('GET', '/api/standings/' + id);
    app.innerHTML = `<h1>Standings</h1>
    <div class="toolbar"><select data-nav="#/standings?tournament=">
        ${tournaments.map((t) => `<option value="${t.id}" ${t.id === id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
    <p class="muted">Points: Win = 3, Draw = 1, Loss = 0. Ties are broken by goal/run difference, then goals scored.</p>
    <div class="table-wrap"><table>
        <thead><tr><th>Pos</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr class="${i === 0 && r.P > 0 ? 'leader' : ''}"><td>${i + 1}</td><td><strong>${esc(r.team)}</strong></td>
            <td>${r.P}</td><td>${r.W}</td><td>${r.D}</td><td>${r.L}</td><td>${r.GF}</td><td>${r.GA}</td>
            <td>${r.GD > 0 ? '+' + r.GD : r.GD}</td><td><strong>${r.Pts}</strong></td></tr>`).join('') || emptyRow(10, 'No teams registered in this tournament yet.')}
        </tbody></table></div>`;
};

/* ---------- global event handlers ---------- */
document.addEventListener('submit', async (ev) => {
    const form = ev.target.closest('form[data-url]');
    if (!form) return;
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(form).entries());
    try {
        const out = await api(form.dataset.method, form.dataset.url, body);
        if (form.dataset.login) me = out;
        toast(form.dataset.ok || 'Saved.');
        go(form.dataset.after || location.hash);
    } catch (err) { toast(err.message, 'error'); }
});

document.addEventListener('click', async (ev) => {
    const logout = ev.target.closest('[data-logout]');
    if (logout) {
        ev.preventDefault();
        await api('POST', '/api/logout', {});
        me = null;
        toast('You have been logged out.');
        return go('#/');
    }
    const btn = ev.target.closest('button[data-act]');
    if (btn) {
        if (btn.dataset.msg && !window.confirm(btn.dataset.msg)) return;
        try {
            await api(btn.dataset.method, btn.dataset.url, btn.dataset.body ? JSON.parse(btn.dataset.body) : undefined);
            toast('Done.');
            route();
        } catch (err) { toast(err.message, 'error'); }
    }
    if (ev.target.closest('#menuToggle')) navEl.classList.toggle('open');
});

document.addEventListener('change', (ev) => {
    const sel = ev.target.closest('select[data-nav]');
    if (sel) go(sel.value ? sel.dataset.nav + sel.value : sel.dataset.nav.split('?')[0]);
});

document.addEventListener('input', (ev) => {
    const input = ev.target.closest('input.search');
    if (!input) return;
    const table = document.getElementById(input.dataset.table);
    const q = input.value.toLowerCase();
    table.querySelectorAll('tbody tr').forEach((row) => {
        if (row.querySelector('td.empty')) return;
        row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
});

window.addEventListener('hashchange', route);
api('GET', '/api/me').then((u) => { me = u; }).catch(() => {}).finally(route);
