# I Have, Who Has? — MathApps v1.0

A teacher-managed, phone-based classroom math chain game. Students read their cards aloud and tap a confirmation button; the teacher sees progress and time. Every generated deck is a single closed loop.

## Deploying to Netlify

**Important:** This is a **Netlify Functions** project, not a static HTML site. Do **not** use the simple drag-and-drop static-site uploader; it won't install dependencies and configure the serverless backend automatically.

Recommended method:
1. Unzip the project folder on your computer.
2. Create a new GitHub repository and add the **contents** of the unzipped folder (including `package.json`, `netlify.toml`, `public/`, `netlify/`, and `lib/`).
3. In Netlify, choose **Add new project → Import an existing project**, and select that repository.
4. Netlify reads `netlify.toml`: **Build command** `npm run build`; **Publish directory** `public`; **Functions directory** `netlify/functions`. Deploy.
5. Open your newly deployed site. Teacher chooses settings and creates a room. Students scan the QR code. **Test with two devices before class.**

Alternative for existing Netlify CLI users: install Node.js 20+ and Netlify CLI, open this directory, then run `npm install`, `npm test`, and `netlify deploy --build --prod` in the linked Netlify project.

The site uses `@netlify/blobs` in Netlify Functions for session state and `qrcode` to generate the join QR. No API keys are required for this prototype.

## First classroom run
1. On a laptop, open the website and click **I'm the teacher**.
2. Choose addition/subtraction/mixed/multiplication and a range.
3. Create a game. Project the QR and PIN (but keep the teacher's private next-reader hint hidden).
4. Students use their own phones and enter first names.
5. Teacher locks the roster by clicking **Start game**. Each phone receives exactly one card.
6. Start student reads aloud and taps **I Read My Card**. Correct responder reads next and taps.
7. When each card has appeared, the loop is complete. Teacher can choose **Play again** to reshuffle and redistribute without making students rejoin.

## Behavior and limits
- 2–40 participants. One card per participant. Unique numeric answers; no duplicated correct matches.
- Multiplication uses products from 1–12 multiplication facts. Not all answer limits have enough distinct products for a large class.
- The app gives an error if the selected range cannot supply enough unique answers.
- A room expires 8 hours after it is created. Refreshing the page in the same browser tab restores the local session.
- Teacher can show a private next-reader hint or advance when a student cannot respond.
- Reopening the lobby keeps existing player names and allows additional joins; it does not currently include a remove-player control.
- Students are asked to read aloud **before** tapping; the software cannot verify that someone actually spoke.
- Students' first names are stored temporarily as room data in the Netlify Blobs store; avoid sensitive student information.
- This is an MVP built using Netlify Blobs. **Blobs is not a transactional database** and overlapping updates to one room may overwrite each other (last-write-wins). For rigorous high-concurrency sessions, move session and turn writes to a transactional service such as Netlify DB. The app polls every two seconds, rather than using WebSockets.
- Room expiration is enforced in code, but expired objects are not automatically deleted from Netlify Blobs. Clear old store data periodically if needed.

## Local checks
Run `node --test tests/*.test.mjs` to verify loop generation. For full browser-to-browser tests, deploy on Netlify or use Netlify CLI with a connected site.

## Layout
- `public/index.html`, `public/styles.css`, `public/app.js`: teacher + student front end
- `netlify/functions/api.mjs`: serverless game actions and session coordination
- `lib/game.mjs`: loop generator and verifier
- `tests/game.test.mjs`: generator tests
