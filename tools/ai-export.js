// Writes Rift Switch as two plain text files that any AI chat (ChatGPT, Gemini, …) can read:
//   ki-export/Rift-Switch-Ueberblick.md  – what the app does: README + every help page (small, good for comparisons)
//   ki-export/Rift-Switch-Code.md        – the whole source code in one file (for code reviews)
// Run: npm run ai-export  (or double-click "KI-Export.cmd"). The folder is not part of git.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const out = path.join(root, 'ki-export');
fs.mkdirSync(out, { recursive: true });
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/^﻿/, '');
const version = JSON.parse(read('package.json')).version;
const today = new Date().toISOString().slice(0, 10);

// ---------- overview ----------
const I18N = require(path.join(root, 'ui', 'i18n.js'));
const help = lang => Object.entries(I18N.STRINGS[lang]).filter(([k]) => /^help\.(?!open$)/.test(k));
const page = (title, lang) => help(lang).map(([k, v]) => `### ${title} – ${k.slice(5)}\n\n${v.replace(/^## /gm, '#### ')}`).join('\n\n');
const overview = `# Rift Switch ${version} – overview for AI assistants (${today})

Rift Switch is a free, open-source League of Legends account switcher and companion app for Windows
(Tauri 2 + Rust backend, plain HTML/JS window, 11 languages). This file describes every feature as the
user sees it: the README, then the built-in help pages in English and German.

Measured on Windows 11: tray only ~8 MB RAM (one process), window open ~90 MB, installer 1.8 MB.
Logins are encrypted with Windows DPAPI (optional extra seal with an app password, AES-GCM + scrypt);
showing a saved password asks Windows Hello.

---

${read('README.md')}

---

## Built-in help pages (English)

${page('Help', 'en')}

## Eingebaute Hilfeseiten (Deutsch)

${page('Hilfe', 'de')}
`;
fs.writeFileSync(path.join(out, 'Rift-Switch-Ueberblick.md'), overview);

// ---------- code ----------
let files = execSync('git ls-files', { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
files = files.filter(f => !/^ui\/lang\/|\.(png|ico|icns|jpg|svg|woff2?)$|package-lock|Cargo\.lock|strings\.json$|^LICENSE$|\.cmd$/.test(f));
const lang = f => ({ rs: 'rust', js: 'javascript', html: 'html', css: 'css', json: 'json', toml: 'toml', ps1: 'powershell', yml: 'yaml', md: 'markdown' }[f.split('.').pop()] || '');
const order = f => (/^src-tauri\/src\//.test(f) ? 0 : /^ui\//.test(f) ? 1 : /^src-tauri\//.test(f) ? 2 : /^test\//.test(f) ? 3 : 4);
files.sort((a, b) => order(a) - order(b) || a.localeCompare(b));
const code = `# Rift Switch ${version} – full source code (${today})

League of Legends account switcher for Windows. Backend: Rust (Tauri 2) in src-tauri/src; window: ui/ (plain
HTML/CSS/JS, no framework); tests: test/ (jsdom click tests) and Rust unit tests. Translations other than
English/German (ui/lang/*) are left out. ${files.length} files.

## Files
${files.map(f => '- ' + f).join('\n')}

${files.map(f => `## ${f}\n\n\`\`\`\`${lang(f)}\n${read(f).trimEnd()}\n\`\`\`\``).join('\n\n')}
`;
fs.writeFileSync(path.join(out, 'Rift-Switch-Code.md'), code);

const kb = f => Math.round(fs.statSync(path.join(out, f)).size / 1024) + ' KB';
console.log(`ki-export\\Rift-Switch-Ueberblick.md  ${kb('Rift-Switch-Ueberblick.md')}`);
console.log(`ki-export\\Rift-Switch-Code.md        ${kb('Rift-Switch-Code.md')}  (${files.length} files)`);
