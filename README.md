# Rift Switch

A small, good-looking account switcher and companion for **League of Legends** on Windows.
Pick an account, press **Switch**, and League restarts with it – no typing, no logging out by hand.

*German UI name: „Kluft Wechsler“. Available in 11 languages: English, Deutsch, 中文, हिन्दी, Español, Français,
العربية, বাংলা, Português, Русский, اردو.*

## Features

### Accounts
- **One-click switching** – checks first where the Riot Client is (already signed in → just presses *Play*; login
  screen open → signs in without a restart), otherwise leaves your lobby/queue, closes League, swaps the session and
  presses *Play* for you.
- **Tiles + detail panel** – every account shows Riot ID, icon, level and ranks (Solo/Duo, Flex, Ranked 5v5,
  Classic 5v5), win rate and a rough MMR estimate. The panel on the right has *Switch* (greyed out when already signed
  in), profile, login details, *Open with* (op.gg, Porofessor, League of Graphs, Mobalytics, u.gg), note, move and remove.
- **Ranked readiness** – what a fresh account still needs (level 30, 20 champions, 10 normal games) plus Riot's own
  restrictions (e.g. LeaverBuster). Lobby-only reasons (party size, rank spread) are ignored.
- **Decay warning** – Riot's own "decays in X days" for the signed-in account, an inactivity hint for the others.
- **Profile & LP history** – Blue Essence, RP, champions, skins, honor, mastery, last played and an LP chart; before
  the first recorded point the chart estimates your past LP from the ranked games it has seen (±20 LP per game, dashed).
- **Categories**, search, sorting (level, rank, last played, name, custom), drag & drop, customisable tiles.
- **Streamer mode** – hides names, tags, icons, ranks … (you choose what).

### While you play (Live page)
- **Clash** – your next opponents with their ranks and a **Multi op.gg** button for all five.
- **Lobby check** – ranks of your party, and of your team in champion select where Riot shows the names.
- **Champ select helper** – keep a pool of your champions, type the enemy laner (pre-filled when it's known) and see
  which of your champions has the best win rate against it (from counterstats.net).

### Tools & comfort
- **Tools** – refresh ranks, close all Riot processes, restart League, clear the Riot Client cache (sign-ins stay),
  open the logs or the app's data folder.
- **Auto-accept** switch in the title bar, **System / Light / Dark** appearance.
- **Tray app** – the ⬇ button keeps it running in the tray (switch from the tray menu), ✕ quits; can start with Windows.
- **Light on resources** – about 35–40 MB RAM in the tray (one process), roughly 80–120 MB with the window open.

## How it works (and what it stores)

- **No passwords needed.** An account is a snapshot of the Riot Client's *“Stay signed in”* session
  (`%LOCALAPPDATA%\Riot Games\Riot Client\Data`). Switching restores that snapshot.
- **Optional password** for automatic re-login when a session has expired. It is typed into the Riot Client
  window (`src/autofill.ps1`) and "Stay signed in" is ticked – the app never talks to Riot's servers itself.
  It only types when it recognised the login form, only while the Riot Client is the front window, and it checks
  that every click really lands on the Riot Client.
- Everything is stored in `%APPDATA%\rift-switch`. Sessions and passwords are **encrypted with Windows DPAPI**
  (Electron `safeStorage`): only your Windows user on your PC can decrypt them. Nothing is ever sent anywhere.
- Ranks, icons etc. come from the **local League Client API** (the same one the client uses itself); icons and
  rank emblems are loaded from [CommunityDragon](https://communitydragon.org).

> ⚠️ The local client API is used by many community tools but is not officially supported by Riot.
> Automatic login and auto-accept only do what you would do by hand – use them at your own discretion.

## Download

Grab the latest version from [Releases](https://github.com/Zlizz3R/rift-switch/releases):

- **RiftSwitch-Setup-x.y.z.exe** – installer (Start menu + desktop shortcut, uninstall via Windows settings)
- **RiftSwitch-Portable-x.y.z.exe** – no installation, just run it

The app isn't code-signed (that costs a few hundred euros a year), so Windows SmartScreen may show
*“Windows protected your PC”* – click **More info → Run anyway**. The full source is right here if you want to check it.

## Install / run (from source)

Requires [Node.js](https://nodejs.org) on Windows.

```powershell
git clone https://github.com/Zlizz3R/rift-switch.git
cd rift-switch
npm install
npm start
```

Or double-click `Rift Switch.cmd` after `npm install`. Build the installer yourself with `npm run dist` (output in `dist/`).

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
