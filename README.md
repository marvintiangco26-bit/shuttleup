# 🏸 ShuttleUp — Badminton Tournament Manager

A manager-run, no-build static web app for on-the-day badminton tournaments:

1. **Only the tournament manager has an account** (email + password, Firebase
   Auth). Players never sign up.
2. The manager **registers all players** — typing a name suggests people from
   their existing **player list** (one-tap re-registration), and new people are
   added to that list automatically.
3. The manager's home page keeps a **tournament history** (status + champion)
   and the **player registration history** (searchable roster).
4. Press **⚡ Generate** — the app works out the groups, the full game schedule
   across your booked courts, and the knockout stages (Quarter-finals →
   Semi-finals → Final, sized to the number of groups).
5. **Scoring is blank-and-typeable**: every match shows an empty score box per
   set (best of 3 → three boxes, best of 5 → five). Type the scores in and the
   winner, standings and bracket advance automatically.
6. **Players follow through a shared link (no account)**: schedule, groups,
   bracket and **live results** update in real time as the manager scores.

Hosted on **Netlify**, backed by **Firebase (Auth + Cloud Firestore) — required**
for the manager login and live sync.

---

## Features

| Feature | Details |
|---|---|
| Accounts | Email + password — **manager only**. Players never sign up. |
| Player list (roster) | Every player ever registered, stored per manager, searchable; typing a name in any tournament suggests them for one-tap re-registration; new names are added automatically |
| Tournament history | Home page lists all your tournaments (planning / live / finished) with dates and the champion |
| Public live view | Shared link / QR — anyone sees groups, schedule, bracket and live results, read-only, no login |
| Scoring | Blank score box per set (0-0 until typed); clear a set by emptying both boxes; **undo** clears a match and its dependent knockout results |
| Game mode | Singles · Doubles (teams already known) · Doubles (random partners) |
| Match format | Best of 3 sets · Best of 5 sets |
| Set length | **11 / 15 / 21 points** — win by 2 (caps: 15 / 20 / 30); set scores that aren't a valid finish get a ⚠ marker |
| Stage format | Group stage + knockout · Straight knockout (with byes) |
| Skill-based grouping | Off (pure random) · **Balanced** (snake-draft, mixes levels) · **Matched** (strong with strong) — shown in **Doubles · random partners** mode, where the skill questions are asked at registration |
| Skill questionnaire | Kept minimal: a 1–10 self-rating + years playing |
| Timeframe | Hours + start time — drives how many games can physically be played |
| Courts booked | Drives how many games run at once |
| Groups | Auto-calculated from time + courts, with manual override; groups are always **3–7** in size |
| Matches per team in group | Auto (full round-robin) or a manual cap (2–6) — knockout (semis/final) still always follows the group stage |

**How the engine plans the tournament**

- A *slot* = average match time + changeover. `slots available = timeframe ÷ slot`, and each slot runs `1 game per court`.
- Groups hold **3–7 players/teams** (a "group" of 2 is just one game, so it's never generated). In random-partners mode the plan is calculated on **teams** (pairs), not raw players — e.g. 16 players → 8 teams → **2 groups of 4**.
- For group stage: the engine tries 8 → 4 → 2 → 1 groups and picks the **largest structure that finishes in time**, reserving slots for the knockout rounds plus a short break. Top 2 of each group advance:
  - 2 groups → Semi-finals + Final
  - 4 groups → Quarter-finals + Semi-finals + Final
  - 8 groups → Round of 16 + Quarter-finals + Semi-finals + Final
- The **Setup → Tournament plan** panel shows the exact math live (groups, match counts, projected finish time) and warns with suggestions if it won't fit.
- Knockout seeding uses standard bracket seeding (seed 1 vs seed 2, etc.); byes go to the top seeds (top skills when skill mode is on).
- Round-robin fixtures use the circle method, interleaved across groups so no player ever has two games in the same time slot.
- Standings: wins → total points scored → head-to-head.

## Project structure

```
badminton-tournaments/
├── index.html            # single-page app (auth / home / tournament screens)
├── css/styles.css
├── js/
│   ├── config.js         # ← paste your Firebase config here
│   ├── engine.js         # pure tournament logic (tested)
│   ├── data.js           # Firebase Auth + Firestore data layer (manager-only)
│   └── app.js            # UI, routing (#/home, #/t/{tid}), organizer + live views
├── test/engine.test.mjs  # pure engine tests (no deps)
├── test/smoke.mjs        # end-to-end engine plan/sample tests (no deps)
├── test/dom.test.mjs     # full manager-flow UI test (jsdom + in-memory Firebase mock)
├── test/mock-utils.mjs   # in-memory Auth/Firestore mock shared by the DOM test
├── netlify.toml
├── SETUP.md              # ← click-by-click Netlify + Firebase guide
└── README.md
```

> **Setting it up for real? Start with [`SETUP.md`](SETUP.md)** — it's a
> step-by-step Netlify + Firebase walkthrough tailored to this project
> (including enabling the **Email/Password** sign-in method and the
> recommended security rules).

No dependencies, no build step — plain HTML/CSS/ES modules. Firebase SDK loads
from CDN at runtime (v10.12.2).

---

## 1️⃣ Set up Firebase (≈7 minutes, required)

The site needs **Firebase Auth (Email/Password)** + **Cloud Firestore**.
`SETUP.md` Part 1 walks through every click; in short:

1. [console.firebase.google.com](https://console.firebase.google.com) →
   **Add project** (e.g. `shuttleup-tournaments`).
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**
3. **Build → Firestore Database → Create database** — nearest region, **test mode**.
4. Project overview → **`</>` (Web)** app → **Register app** → copy the
   `firebaseConfig` values.
5. Paste them into **`js/config.js`**:

   ```js
   window.FIREBASE_CONFIG = {
     apiKey: "AIza...",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project-id",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abc123"
   };
   ```

**Data layout** (all auto-created):

```
users/{uid}                            { name, email, createdAt }
users/{uid}/players/{pid}              { name, rating, yearsIdx, createdAt }
                                       (the manager's reusable player roster)
tournaments/{tid}                      { name, organizerId, settings, status,
                                         gen, createdAt, updatedAt }
tournaments/{tid}/registrations/{rid}  { mode, name/p1/p2/teamName, rating,
                                         yearsIdx, addedBy, createdAt }
```

Your role in a tournament is derived from `organizerId`; anyone else who opens
the link gets the read-only live view. The draw + results (`gen`) live inside
the tournament doc so everything stays in sync with one write.

---

## 2️⃣ Deploy to Netlify

**Option A — drag & drop (fastest)**
1. Go to [app.netlify.com](https://app.netlify.com) → **Add new site → Deploy manually**.
2. Drag the `badminton-tournaments` folder onto the page. Done — you get a
   `https://your-site-name.netlify.app` URL.

**Option B — from Git**
1. Push this folder to a GitHub/GitLab repo.
2. Netlify → **Add new site → Import an existing project** → pick the repo.
3. Build command: *(leave empty)* · Publish directory: */* (the included `netlify.toml` already handles this).

To update: change files → push (or drag the folder again onto the site's
**Deploys** tab).

---

## 3️⃣ Running a tournament (day-of flow)

1. Sign in (create your account the first time).
2. On your home page, enter a name and **＋ Create tournament**.
3. **Setup tab** — pick game mode, best of 3/5, **set length (11/15/21, win by 2)**,
   groups or knockout, skill mode
   (shown for random partners), timeframe, start time, courts. Watch the
   **Tournament plan** panel update live.
4. **Players tab** — register everyone. Start typing a name: people from your
   **player list** are suggested (one tap fills the form, including their skill
   answers in random-partners mode); new names are added to the list
   automatically. Use **✎** to edit and **✕** to remove entries any time
   before scoring starts.
5. **Share the live view** (same tab) — copy the link or download the QR code.
   Players keep it open on their phones: groups, schedule, game times and
   results update live, no account needed.
6. **⚡ Generate tournament** — groups are drawn (random / balanced / matched)
   and the full schedule is built across your courts. (↻ **Redraw** on the
   Groups tab shuffles again — it clears scores, so only do it before games
   start.)
7. **Schedule tab** — type set scores into the blank boxes (e.g. `21` / `15`).
   A player who wins enough sets completes the match; winners advance and the
   bracket tab updates. Empty both boxes of a set to remove it; **undo** on a
   finished match clears it (and the knockout results built on it).
8. When the Final is recorded, the **champion banner** appears — and your home
   page's tournament history marks it **🏆 Finished** with the champion. 🏆

Useful bits:

- **Home → Players** — your whole registration history, searchable; remove
  spares with ✕ (past tournaments are unaffected).
- **🖨 Print** (schedule tab) produces a clean paper copy (one game per court
  per slot).
- If an odd number of individuals sign up for random partners, one player is
  flagged as sitting out.
- Switching the game mode excludes entries from the other modes from the draw
  (they stay saved; switch back and they rejoin).

## Development

```bash
npm test                      # engine + smoke + full DOM E2E (needs jsdom: npm i)
npm run test:engine           # pure engine tests only (no deps)
npm run test:smoke            # engine plan/sample tests only (no deps)
npm run test:dom              # full manager-flow UI test (jsdom)

# serve locally
python3 -m http.server 8080 -d badminton-tournaments
# → http://localhost:8080
```

The DOM test signs up a manager against an in-memory Auth/Firestore mock
(`test/mock-utils.mjs`) and drives the real `index.html` + `app.js` through the
whole flow: create → register players (incl. roster suggestions) → generate →
type scores into blank boxes → champion, plus the no-login live view and the
home history/roster pages.
