# Rift Switch

A small, good-looking account switcher and companion for **League of Legends** on Windows.
Pick an account, press **Log in**, and League restarts with it – no typing, no logging out by hand.

*German UI name: „Kluft Wechsler“. Available in 11 languages: English, Deutsch, 中文, हिन्दी, Español, Français,
العربية, বাংলা, Português, Русский, اردو.*

## Features

### Accounts
- **One-click login** – checks first where the Riot Client is (already signed in → just presses *Play*; login
  screen open → signs in without a restart), otherwise leaves your lobby/queue, closes League, swaps the session and
  presses *Play* for you. A progress screen shows every step (saving the sign-in, Riot Client, signing in, Play,
  League starting) and can cancel it.
- **Safe logins** – an account with a leaver lock, low priority queue or dodge timer asks before logging in; after the
  login the app checks that the account you picked is the one signed in; a code or captcha gets clear steps and an
  *Open Riot Client* button, and the app goes on by itself afterwards.
- **Add many at once** – paste a list: `user:password`, `user--Name#TAG--password` (LeagueAccounts),
  `;`/tab/`|` separated with Riot ID and note, a Riot ID alone, or blocks of `Username: …` / `Password: …` lines –
  with a preview of what was understood and a category for all of them.
- **Tiles + detail panel** – every account shows Riot ID, icon, level and ranks (Solo/Duo, Flex, Ranked 5v5,
  Classic 5v5), win rate. The panel on the right has *Log in* (greyed out when already signed
  in), profile, login details, *Open with* (op.gg, Porofessor, League of Graphs, Mobalytics, u.gg), note, move and remove.
- **Ranked readiness** – what a fresh account still needs (level 30, 20 champions, 10 normal games) plus Riot's own
  restrictions (e.g. LeaverBuster). Lobby-only reasons (party size, rank spread) are ignored.
- **Penalties on the tile** – leaver locks and dodge timers with the time left; a low priority queue with the games
  left and the wait per game, until it is over.
- **Overview** – the LP history of all accounts in one chart (Solo/Duo or Flex, 7/30/90 days or everything; hover
  shows every account on that day), ranked games, win rate and LP won or lost per account and in total, a rank goal per
  account with the LP still to go, and when each one was last played.
- **Decay warning** – Riot's own "decays in X days" for the signed-in account, an inactivity hint for the others.
- **Profile & LP history** – Blue Essence, RP, champions, skins, honor, mastery, last played and an LP chart; before
  the first recorded point the chart estimates your past LP from the ranked games it has seen (±20 LP per game, dashed).
- **Categories**, search, sorting (level, rank, last played, name, custom), drag & drop, customisable tiles.
- **Three layouts** – tiles, small tiles or a list (the list shows what the tile options switch on).
- **Several at once** – Ctrl+click, Shift+click or draw a box: note, category, *Open with* and remove for all picked accounts.
- **Keyboard** – Ctrl+F search, Ctrl+1…6 pages, Ctrl+N add (Ctrl+Shift+N many), arrow keys + Enter to log in,
  E note, P profile, Del remove, Ctrl+A pick all; `?` lists them all.
- **Collection** – owned champions, skins and loot shards of every account (read while you're logged in to it) and one
  search across all of them: who has Ahri, a Star Guardian skin or an Ashe shard?
- **Streamer mode** – hides names, tags, icons, ranks … (you choose what).

### While you play (Live page)
- **Clash** – your next opponents with their ranks and a **Multi op.gg** button for all five.
- **Lobby check** – ranks of your party, and of your team in champion select where Riot shows the names.
- **Champ select helper** – keep a pool of your champions; in champion select the enemy picks appear as pictures – click
  the one you expect in your lane (or type it; Riot hides the enemies' positions, so the app marks the likely laner by
  how often each champion plays your lane) and see your champions ranked by win rate and counter rating against it
  (counterstats.net). Every enemy pick is loaded in the background; "Pre-load all matchups" fetches every opponent your
  pool meets on that lane while you queue (kept for a day).

### Tools & comfort
- **Tools** – refresh ranks, close all Riot processes, restart League, clear the Riot Client cache (sign-ins stay),
  open the logs or the app's data folder, save a diagnostics file for a bug report (names, ids and your user folder
  are taken out).
- **Export / import** – without logins (safe backup), or with logins encrypted by a password of their own
  (scrypt + AES-256). Riot Client sign-ins, the app password and the match history are never in the file.
- **What's new** – after an update the app shows once what changed (Settings → About; also the release text on GitHub).
- **Auto-accept** switch in the title bar, **System / Light / Dark** appearance.
- **Tray app** – the ⬇ button keeps it running in the tray (switch from the tray menu), ✕ quits; can start with Windows.
- **Light on resources** – in the tray one process with about 8 MB RAM and almost no CPU (measured: 0.03 % of one core); about 90 MB while the window is open, all of it freed again when it goes back to the tray.

## How it works (and what it stores)

- **No passwords needed.** An account is a snapshot of the Riot Client's *“Stay signed in”* session
  (`%LOCALAPPDATA%\Riot Games\Riot Client\Data`). Switching restores that snapshot.
- **Optional password** for automatic re-login when a session has expired. It is typed into the Riot Client
  window (`src-tauri/scripts/autofill.ps1`) and "Stay signed in" is ticked – the app never talks to Riot's servers itself.
  It only types when it recognised the login form, only while the Riot Client is the front window, and it checks
  that every click really lands on the Riot Client.
- Everything is stored in `%APPDATA%\rift-switch`. Sessions and passwords are **encrypted with Windows DPAPI**
  : only your Windows user on your PC can decrypt them. Your logins and sessions never leave your PC.
- Outside requests – no account data is sent anywhere (the same list is in the app: Settings → About → *Data sources*):
  - **CommunityDragon** – icons, rank emblems, champion and item data.
  - **counterstats.net** – champion names only, for the champ select helper.
  - **GitHub** – every 6 hours: is there a newer release? A new installer is downloaded in the background and checked
    (size, SHA-256); it only runs when you say so.
  - Sites like op.gg only when you open a profile there yourself (with that player's Riot ID in the address).
- On your PC only: the Riot Client and League Client API (`127.0.0.1`, their own certificate – accepted only for these
  local addresses).
- Ranks, icons etc. come from the **local League Client API** (the same one the client uses itself); icons and
  rank emblems are loaded from [CommunityDragon](https://communitydragon.org).

> ⚠️ The local client API is used by many community tools but is not officially supported by Riot.
> Automatic login and auto-accept only do what you would do by hand – use them at your own discretion.

## Troubleshooting

| Problem | What to do |
|---|---|
| *Riot Client not found* | Install the Riot Client (or start it once by hand), then try again. |
| The login screen or sign-in wasn't ready in time | Open the Riot Client once by hand – it may be updating – then log in again. |
| League doesn't start after logging in | Make sure *Start League automatically* is on (Settings → Logging in). The app presses *Play* as soon as the Riot Client accepts it. |
| "Log in once by hand" | The account has no saved sign-in yet (or it expired and no password is saved): log in once in the Riot Client with *Stay signed in*. |
| Ranks or the match history stay empty | They come from the League client: open League on that account once. Accounts of another server are filled in when League runs on that server. |
| The Riot Client window is blank or broken | Tools → *Clear Riot Client cache* (sign-ins stay), then restart League. |
| A code or captcha while signing in | Click *Open Riot Client* in the box, enter the code or solve the captcha – the app notices the sign-in and goes on. |
| Signed in as another account than picked | The saved login of that account belongs to another Riot ID: open *Login* on the tile and fix it. |
| Anything else | Tools → *Save diagnostics* and attach the file to an [issue](https://github.com/Zlizz3R/rift-switch/issues). |

## Download

Grab the latest version from [Releases](https://github.com/Zlizz3R/rift-switch/releases):

- **Rift Switch_x.y.z_x64-setup.exe** – installer (Start menu shortcut, uninstall via Windows settings, updates itself)

Light on purpose: the app is a small native program (Rust + the WebView2 that comes with Windows). While it
sits in the tray there is no window at all – one process, a few MB of memory, and it asks League a handful of
questions every 15–60 seconds (the client's own events wake it up when something happens).

The app isn't code-signed (that costs a few hundred euros a year), so Windows SmartScreen may show
*“Windows protected your PC”* – click **More info → Run anyway**. The full source is right here if you want to check it.

## Build from source

Requires [Rust](https://rustup.rs) (with the Visual Studio C++ build tools) and [Node.js](https://nodejs.org) on Windows.

```powershell
git clone https://github.com/Zlizz3R/rift-switch.git
cd rift-switch
npm install
npm run dev      # run it
npm run dist     # installer in src-tauri/target/release/bundle/nsis/
```

## Development notes

- `src-tauri/src/` – the background part (Rust, Tauri 2):
  `main.rs` window, tray, the one `call` command the window uses, switching, polling;
  `riot.rs` Riot Client / League Client API, sessions, processes; `events.rs` client events (WebSocket);
  `live.rs` live page data, champion data, matchups; `matches.rs` the match history store (no limit:
  `matches/games.jsonl`, only an index stays in memory);
  `accounts.rs`, `settings.rs`, `store.rs`, `secrets.rs`, `menu.rs` – pure logic with tests;
  `updater.rs` GitHub releases; `winsys.rs` autostart and jump list
- `src-tauri/scripts/` – typing a login into the Riot Client (UI Automation, picture scan as fallback), closing the PBE dialog
- `ui/` – the window: `tauri-api.js` (its link to the background part), `renderer.js`, `views.js`,
  `matches-view.js`, `dashboard.js`, `collection.js`, `bulk.js` + `bulkparse.js`, `keys.js`, `changelog.js`, `matchfilter.js`, `rankmath.js`, `index.html`, `style.css`; texts in `i18n.js` + `lang/*.js`
- Tray and jump-list texts are copied from the window's texts: `npm run strings` after changing one
- Tests: `npm test` (window logic with Node's test runner + `cargo test` for the background part); they run on every push
- Releases: add the version's notes to `ui/changelog.js` (the app's *What's new* and the release text,
  `node tools/release-notes.js vX.Y.Z`), then push a tag `vX.Y.Z` matching the version in `src-tauri/tauri.conf.json` –
  GitHub Actions builds and publishes the installer, installed copies update themselves
- Test copy on its own data folder: `$env:RS_DATA='<folder>'; .\src-tauri\target\debug\rift-switch.exe`
  (never touches autostart, the jump list or the real data)

## Support

Rift Switch is free and open source. If it saves you some clicks, you can [buy me a coffee ☕](https://buymeacoffee.com/zlizz3r) – thank you!

## Legal

Rift Switch isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone
officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties
are trademarks or registered trademarks of Riot Games, Inc.

## License

[MIT](LICENSE)
