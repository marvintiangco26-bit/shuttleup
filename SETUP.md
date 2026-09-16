# ShuttleUp — Setup Guide (Netlify + Firebase)

A plain-English, click-by-click walkthrough.

- **Part 1** – Firebase (≈7 min) — **required**: manager login + live sync
- **Part 2** – Netlify (≈3 min) — required, this is how the site goes live
- **Part 3** – How the flow works (what to do on the day)
- **Part 4** – Verify it works
- **Troubleshooting**
- **After your event** – lock it down

> **How accounts work in this version:** only the **tournament manager**
> creates an account (email + password). **Players never sign up** — you
> register them for them, and they follow everything (schedule, game times,
> live results) through a **shared link** that needs no account. Your home
> page keeps a **tournament history** and a **player list** of everyone you've
> ever registered, so re-registering them for the next tournament is one tap.

---

## Part 1 — Firebase (≈7 minutes)

You'll end up with a small block of config values to paste into the code.

### 1.1 Create a Firebase project
1. Open **https://console.firebase.google.com** and sign in with a Google account.
2. Click **Add project** (the `+` / “Create a project” button, top-right).
3. Give it a name, e.g. `shuttleup-tournaments`.
4. Google Analytics is optional — you can **turn it off** to skip that step.
5. Click **Create project**. Wait for it to finish.

### 1.2 Add a Web app (this gives you the config)
1. In your project, click the **`</>` (Web)** icon to add an app.
   - If you're on the project overview screen, click **Add app** → **Web (</>)**.
2. Enter a nickname, e.g. `shuttleup`. You do **not** need Firebase Hosting.
3. Click **Register app**.
4. Firebase shows a `firebaseConfig` object that looks like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "shuttleup-tournaments.firebaseapp.com",
     projectId: "shuttleup-tournaments",
     storageBucket: "shuttleup-tournaments.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abc123"
   };
   ```
   **Copy all of those values.** You'll paste them in step 1.5.

### 1.3 Turn on sign-in: Email/Password
1. In the left sidebar go to **Build → Authentication**.
2. Click **Get started**.
3. Open the **Sign-in method** tab.
4. Find **Email/Password** → click it → **Enable** → **Save**.

   That's it — no Google/Facebook providers needed. Only the manager signs in.

### 1.4 Turn on Firestore (the database)
1. In the left sidebar go to **Build → Firestore Database**.
2. Click **Create database**.
3. Pick a **location** close to you (e.g. `australia-southeast` for Sydney/Melbourne).
4. Choose **Start in test mode** and pick your location.
   - Test mode lets the app read/write freely for 30 days — perfect for an
     event. You can publish the proper rules afterwards (step 1.6).
5. Click **Enable** / **Create**.

### 1.5 Paste the config into the code
1. Open the file **`js/config.js`** in the folder.
2. Replace the two placeholder lines so it reads:
   ```js
   window.FIREBASE_CONFIG = {
     apiKey: "AIza...your key",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project-id",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abc123"
   };
   ```
   (Just swap the values — keep the line `window.FIREBASE_CONFIG = { ... };`.)
3. Save the file.

That's it for Firebase setup. The app creates everything else by itself:
- a `users/{uid}` profile doc when you sign up,
- a `users/{uid}/players/…` doc for every player you ever register (your roster),
- a `tournaments/{tid}` doc when you create a tournament,
- `tournaments/{tid}/registrations/{rid}` docs for each entry.

### 1.6 (Recommended) publish the security rules
Test mode is open to *anyone* for 30 days. For a real event, paste these rules
into **Firestore → Rules → Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // User profiles — each person manages only their own.
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;

      // The manager's player roster.
      match /players/{pid} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
      }
    }

    match /tournaments/{tid} {
      // Read is open: anyone with the shared link watches the live view.
      allow read: if true;
      // Only the manager creates, edits or deletes a tournament.
      allow create: if request.auth != null && request.resource.data.organizerId == request.auth.uid;
      allow update, delete: if request.auth != null && resource.data.organizerId == request.auth.uid;
    }

    match /tournaments/{tid}/registrations/{rid} {
      // Read is open so the live view can show the entries.
      allow read: if true;
      // Only the tournament's manager adds/edits/removes entries.
      allow create, update, delete: if request.auth != null &&
        get(/databases/$(database)/documents/tournaments/$(tid))
          .data.organizerId == request.auth.uid;
    }
  }
}
```

Plain-English version:
- **Anyone** (even not signed in) can *read* a tournament and its entries —
  that's what makes the no-login live link work.
- Only **you, signed in** can create, edit or delete tournaments and entries.
- Your **player roster** and profile are private to your account.

---

## Part 2 — Netlify (≈3 minutes)

Netlify hosts the static site and gives you a shareable link. No build step is
needed — the folder is already a finished website.

### Option A — Drag & drop (easiest, no Git)
1. Go to **https://app.netlify.com** and **Sign up / Log in** (you can sign up
   with your Google account).
2. Click **Add new site** → **Deploy manually**.
3. Drag the **`badminton-tournaments` folder** (the unzipped one, *not* the zip
   itself) onto the drop zone.
4. Wait a few seconds. Netlify deploys and gives you a URL like
   `https://random-name-123.netlify.app`.

That's the whole thing. ✅

### Option B — From a Git repo (better if you'll keep updating it)
1. Push the `badminton-tournaments` folder to a GitHub / GitLab repo.
2. On Netlify: **Add new site → Import an existing project** → pick the repo.
3. When it asks for build settings:
   - **Build command:** leave **empty**
   - **Publish directory:** `/` (root)
   - (The included `netlify.toml` already sets the publish folder, so this is
     mostly a formality.)
4. Click **Deploy site**.

### Renaming your link (optional)
**Site configuration → Change site name** → pick something like
`shuttleup-2026`. Your link becomes `https://shuttleup-2026.netlify.app`.

### Making future updates
- **Drag & drop site:** go to **Deploys**, and drag the updated folder onto the
  “Drag your site output folder here” area to publish a new version.
- **Git site:** just push your changes to the repo — Netlify redeploys
  automatically.

---

## Part 3 — How the flow works (on the day)

**Your home page** has two tabs:
- **Tournament history** — every tournament you've created, newest first, with
  its status (Planning / ● Live / 🏆 Finished) and the champion once it's over.
- **Players** — everyone you've ever registered, searchable. Start typing a
  name when registering a tournament and your list suggests them: one tap
  fills the form. New people you type in are added to the list automatically.

**Running a tournament:**
1. Open the site → **Create account** (first time) or **Sign in**.
2. Enter a tournament name → **＋ Create tournament**.
3. Open the **Setup** tab: pick the mode (Singles / Doubles · teams known /
   Doubles · random partners), settings (best of 3 or 5, **set length
   11 / 15 / 21 points with win-by-2**, groups vs straight knockout, start
   time, hours, courts, match length), and watch the plan line. A recorded
   set score that isn't a valid finish (target + 2-point lead, or the cap)
   shows a ⚠ so you can fix a typo — it doesn't stop play.
4. **Players tab → Register players**: type a name (or pick one from your
   list), add as many as you like; use **✎** to edit and **✕** to remove.
5. **Players tab → Share the live view**: copy the link or download the QR
   code. Anyone who opens it sees the schedule and **live results — no
   account needed**.
6. When everyone's in, open **Setup → ⚡ Generate tournament** (or *Redraw*
   on the Groups tab for a fresh random draw — this clears scores).
7. **Score as you go**: the **Schedule** tab shows one blank score box per set
   for every match (3 boxes for best of 3, 5 for best of 5). Just type the
   scores in (e.g. `21` then `15`); when a player wins enough sets the match
   ticks off as done and the bracket advances. Clearing both boxes of a set
   removes it; **undo** on a finished match clears it (and any knockout
   results that depend on it).
8. The **Bracket** tab shows group standings, knockout progress and the
   champion banner when the final is done. 🏆

Players on their phones just keep the shared link open — their scores,
standings and the next match times update live while you score on your device.

---

## Part 4 — Verify it works

1. Open your Netlify URL in a browser.
2. **Create an account** (e.g. `marvin@example.com`) → home page with your
   name in the top-right chip; both tabs (history + players) start empty.
3. **Create a tournament**, open its **Players** tab and register 4 players.
4. Check **home → Players** tab: all 4 are in your list.
5. **Invite flow:** on the tournament's Players tab, click **Copy link** (or
   open the QR). Open that exact link in an **incognito window** (no sign-in
   at all): you should see the tournament's **live view** — schedule, groups,
   bracket, “read only”, and a “The schedule will appear here once…” note
   before you generate.
6. Switch back to your account: **Setup → ⚡ Generate**. The live view now
   shows groups + schedule.
7. **Live scoring:** in the **Schedule** tab, type set scores into the blank
   boxes (e.g. 21 / 15, then 18 / 21, then 21 / 15). Watch the live view
   update in the incognito window, the standings move, and the champion
   banner appear once the final is done.
8. Check **home → Tournament history**: the finished tournament shows
   **🏆 Finished** with the champion's name.
9. **Create a second tournament** and register someone again: start typing
   their name, click the suggestion from your player list, and confirm the
   **Players** tab count didn't grow (no duplicate created).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| “Paste your Firebase config into `js/config.js`” screen | You deployed without saving the config. Edit `js/config.js` locally and redeploy the folder. |
| `email-already-in-use` on sign-up | That email is registered — use **Sign in** instead. |
| `Wrong email or password.` on sign-in | Check for typos / caps lock. (Accounts are per Firebase project — same `projectId` on every device.) |
| `PERMISSION_DENIED` in the console | Rules are locked or test mode expired with custom rules published — re-check **Firestore → Rules** (step 1.6). |
| Shared link opens on the sign-in screen | Expected only if you typed the base URL — the live view needs the full link *including* the `#/t/…` part. Copy the link from the Players tab. |
| “Tournament not found” when opening a link | The tournament was deleted, or the `#/t/…` part of the link got cut off. |
| A player is registered twice in your list | Your list matches by exact name (case-insensitive). Rename or remove the spare in **home → Players**, then re-add. |
| Score box won't accept input | The match is already done (locked) — use **undo** first, or the players aren't both in the draw yet (TBC). |
| Blank page on Netlify | Wrong folder deployed. You must drop the folder that *contains* `index.html` (not a parent folder, not the zip). |
| 404 on refresh / sub-pages | Not expected — single page app with hash routes (`#/t/…`). If it happens, confirm **Publish directory** is the folder root. |

---

## After your event — lock it down

If you published the rules from step 1.6 you're already locked down. To close
it completely now: **Firestore → Rules →** replace with:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```
→ **Publish**. You can also disable Authentication
(**Authentication → Sign-in method → Email/Password → Disable**) and, once
you've exported any data you want, just **delete the Firebase project**.

---

### Quick reference
- Firebase config file: **`js/config.js`**
- Firebase project needs: **Email/Password auth** + **Firestore** (both from Part 1)
- Accounts: **manager only** — players follow via the shared link (no login)
- Data layout: `users/{uid}` · `users/{uid}/players/{pid}` · `tournaments/{tid}` · `tournaments/{tid}/registrations/{rid}`
- Routes: `#/home` (history + player list) · `#/t/{tid}` (organizer view, or live view for everyone else)
- Netlify build: **none** · publish folder: **root** (handled by `netlify.toml`)
