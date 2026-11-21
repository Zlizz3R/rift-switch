# Rift Switch

A small, good-looking account switcher for **League of Legends** on Windows.
Click a tile, confirm, and League restarts with the other account – no typing, no logging out by hand.

*German UI name: „Kluft Wechsler“. The app speaks English (default) and German.*

## Features

- **One-click switching** – leaves your lobby/queue first, closes League, swaps the Riot Client session and presses *Play* for you.
- **Tiles per account** with Riot ID, profile icon, level and ranks (Solo/Duo, Flex, Ranked 5v5, Classic 5v5), win rate and a rough MMR estimate.
- **Ranked readiness** – shows what a fresh account still needs (level 30, 20 champions, 10 normal games) and Riot's own restrictions (e.g. LeaverBuster).
- **Profile view** (right-click): Blue Essence, RP, champions, skins, honor, mastery, LP history, last played, links to op.gg / Porofessor / League of Graphs / Mobalytics / u.gg.
- **Categories**, search, sorting (level, rank, last played, name, custom), drag & drop.
- **Customisable tiles** – choose what every tile shows.
- **Streamer mode** – hides names, tags, icons, ranks … (you choose what).
- **Tray app** – switch from the tray menu, start with Windows, auto-accept queue.
- **Light on resources** – about 40 MB RAM while sitting in the tray (one process), ~80 MB with the window open.

## How it works (and what it stores)

- **No passwords needed.** An account is a snapshot of the Riot Client's *“Stay signed in”* session
  (`%LOCALAPPDATA%\Riot Games\Riot Client\Data`). Switching restores that snapshot.
- **Optional password** for automatic re-login when a session has expired. It is typed into the Riot Client
  window (`src/autofill.ps1`) – the app never talks to Riot's servers itself.
- Everything is stored in `%APPDATA%\rift-switch`. Sessions and passwords are **encrypted with Windows DPAPI**
  (Electron `safeStorage`): only your Windows user on your PC can decrypt them. Nothing is ever sent anywhere.
- Ranks, icons etc. come from the **local League Client API** (the same one the client uses itself); icons and
  rank emblems are loaded from [CommunityDragon](https://communitydragon.org).

> ⚠️ The local client API is used by many community tools but is not officially supported by Riot.
> Automatic login and auto-accept only do what you would do by hand – use them at your own discretion.

## Install / run (from source)

Requires [Node.js](https://nodejs.org) on Windows.

```powershell
git clone https://github.com/Zlizz3R/rift-switch.git
cd rift-switch
npm install
npm start
```

Or double-click `Rift Switch.cmd` after `npm install`. A packaged installer is planned.

## Development notes

- `src/main.js` – main process (storage, polling, switching, tray)
- `src/riot.js` – Riot Client / League Client API, process handling
- `src/renderer.js`, `index.html`, `style.css` – the UI
- `src/i18n.js` – all texts (English + German)
- Test copy on its own data folder: `RS_DATA=<folder> npx electron .`

## Support

Rift Switch is free and open source. If it saves you some clicks, you can [buy me a coffee ☕](https://buymeacoffee.com/zlizz3r) – thank you!

## Legal

Rift Switch isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone
officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties
are trademarks or registered trademarks of Riot Games, Inc.

## License

[MIT](LICENSE)
