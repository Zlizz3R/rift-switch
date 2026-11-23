// What changed in each version – the one source for the "What's new" box in the app and for the
// GitHub release text (tools/release-notes.js). English and German; other languages show English.
(function (root) {
  const CHANGELOG = [
    {
      v: '1.2.0',
      en: [
        'Overview page: the LP history of all accounts in one chart – Solo/Duo, Flex, Ranked 5v5 and Classic 5v5 in any combination –, games, win rate and LP per account and in total, a rank goal per account and queue.',
        'Collection page: owned champions, skins and loot shards of every account, with one search across all of them.',
        'Match history: any combination of queues, Ranked 5v5 and Classic 5v5 included.',
        'The Live page opens at once instead of waiting for the champion list and Clash.',
        'Optional Windows notification when a match is found (Settings → Logging in).',
        'Add many accounts at once: paste a list (user:password, user--Name#TAG--password, blocks of "Username: …") – with a preview of what was understood.',
        'Three layouts for the accounts: tiles, small tiles or a list.',
        'Keyboard shortcuts for pages, search, adding and moving through the accounts – press ? for the list.',
        'A locked account (leaver lock, low priority, dodge) asks before logging in; after logging in the app checks that the right account is signed in.',
        'A code or captcha while signing in: clear steps and a button that opens the Riot Client – the app goes on by itself afterwards.',
        'Diagnostics file for bug reports (Tools), with names, ids and your user folder removed.',
        'Export with clear choices: without logins, or with logins protected by a password of their own.',
        '"Switch" is now called "Log in"; the MMR estimate and the in-game overlay were removed again.',
      ],
      de: [
        'Übersicht: die LP-Historie aller Accounts in einem Graphen – Solo/Duo, Flex, Ranked 5v5 und Classic 5v5 beliebig kombiniert –, Spiele, Winrate und LP pro Account und insgesamt, ein Rangziel pro Account und Modus.',
        'Sammlung: Champions, Skins und Shards aller Accounts, mit einer Suche über alle.',
        'Spielverlauf: Modi beliebig kombinierbar, auch Ranked 5v5 und Classic 5v5.',
        'Der Live-Tab öffnet sofort, statt auf die Champion-Liste und Clash zu warten.',
        'Auf Wunsch eine Windows-Benachrichtigung, sobald ein Match gefunden ist (Einstellungen → Einloggen).',
        'Mehrere Accounts auf einmal hinzufügen: Liste einfügen (user:passwort, user--Name#TAG--passwort, Blöcke mit „Username: …“) – mit Vorschau, was erkannt wurde.',
        'Drei Ansichten für die Accounts: Kacheln, kleine Kacheln oder Liste.',
        'Tastenkürzel für Seiten, Suche, Hinzufügen und die Auswahl der Accounts – ? zeigt die Liste.',
        'Ein gesperrter Account (Leaver-Sperre, Low Priority, Dodge) fragt vor dem Einloggen nach; nach dem Login prüft die App, ob der richtige Account angemeldet ist.',
        'Code oder Captcha beim Anmelden: klare Schritte und ein Knopf, der den Riot Client öffnet – danach macht die App von selbst weiter.',
        'Diagnose-Datei für Fehlerberichte (Tools), ohne Namen, IDs und Benutzerordner.',
        'Export mit klaren Optionen: ohne Logins oder mit Logins, geschützt durch ein eigenes Passwort.',
        '„Wechseln“ heißt jetzt „Einloggen“; die MMR-Schätzung und das Ingame-Overlay sind wieder entfernt.',
      ],
    },
    {
      v: '1.1.0',
      en: ['Rewritten with Tauri and Rust: about 8 MB in the tray instead of well over 100 MB, a 2 MB installer.',
        'Match history without a limit, with filters, details, gold graphs and a player comparison.'],
      de: ['Neu geschrieben mit Tauri und Rust: etwa 8 MB im Tray statt weit über 100 MB, ein 2-MB-Installer.',
        'Spielverlauf ohne Grenze, mit Filtern, Details, Goldgraphen und Spielervergleich.'],
    },
  ];
  const api = { CHANGELOG };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Changelog = api;
})(typeof window !== 'undefined' ? window : globalThis);
