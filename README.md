# Sports Tournament Management System (Node.js)

MCA mini project: a web application to manage sports tournaments, teams, players, match schedules, results and live standings.

- **Backend:** Node.js (built-in `http` server) exposing a REST API
- **Database:** SQLite (built into Node via `node:sqlite`) - no XAMPP, no MySQL, no `npm install`
- **Frontend:** HTML, CSS and JavaScript single-page app (in `public/`)

## Requirements

Node.js **22.13 or newer** (check with `node -v`). Download from https://nodejs.org if needed.

## Run

```bash
cd sports-tournament-node
npm start
```

Open **http://localhost:3000**

Admin login: `admin` / `admin123` (visitors without login can only view data).

The database file `sports.db` is created automatically on first run with sample data. Delete it to reset.

Run the automated checks with `npm test`.

## Features

- Admin login (scrypt-hashed password, HttpOnly session cookie, login attempt limiting)
- Tournaments: create, edit, delete, status (Upcoming / Ongoing / Completed)
- Teams: add, edit, delete per tournament (duplicate names blocked)
- Players: add, edit, delete with jersey number, position, age
- Matches: schedule fixtures, enter results, clear/edit results
- Standings: auto-calculated table (Win 3, Draw 1, Loss 0; tie-break by goal difference, then goals scored)
- Dashboard with counts, upcoming matches and recent results
- Search boxes, filters, responsive layout

## Project structure

```
sports-tournament-node/
  server.js        Backend: routes, validation, sessions, static file server
  db.js            SQLite schema, password hashing, sample data
  test.js          Automated API tests
  package.json
  public/
    index.html     Page shell
    css/style.css  Styling
    js/app.js      Frontend (pages, forms, API calls)
```

## REST API

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | `/api/login`, `/api/logout` | - | Session |
| GET | `/api/me`, `/api/dashboard` | - | Current user / home data |
| GET, POST | `/api/tournaments` | POST: admin | List / create |
| PUT, DELETE | `/api/tournaments/:id` | admin | Update / delete |
| GET, POST | `/api/teams?tournament=ID` | POST: admin | List / create |
| PUT, DELETE | `/api/teams/:id` | admin | Update / delete |
| GET, POST | `/api/players?team=ID` | POST: admin | List / create |
| PUT, DELETE | `/api/players/:id` | admin | Update / delete |
| GET, POST | `/api/matches?tournament=ID` | POST: admin | List / schedule |
| PUT | `/api/matches/:id/result` | admin | Save result (`{score1, score2}`) or clear (`{clear:true}`) |
| DELETE | `/api/matches/:id` | admin | Delete match |
| GET | `/api/standings/:tournamentId` | - | Points table |

## Database tables

`users`, `tournaments`, `teams`, `players`, `matches` (foreign keys with cascade delete).
