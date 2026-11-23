// The few texts the background part shows itself (tray menu, jump list, tier names) in every
// language, taken from ui/i18n.js + ui/lang/*.js -> src-tauri/strings.json (built into the app).
// Run after changing one of these texts: npm run strings
const fs = require('fs');
const path = require('path');
const { STRINGS, LANGS } = require('../ui/i18n.js');

const KEY = /^(app\.name|tray\..+|discord\..+|lock\.locked|tile\.savedLogin|stream\.alias|jump\.switch|cat\.new|tier\..+|reveal\..+)$/;
const out = {};
for (const [code] of LANGS) {
  const s = STRINGS[code] || {};
  out[code] = Object.fromEntries(Object.entries(s).filter(([k]) => KEY.test(k)));
}
fs.writeFileSync(path.join(__dirname, '..', 'src-tauri', 'strings.json'), JSON.stringify(out));
console.log('strings.json:', Object.keys(out.en).length, 'keys,', LANGS.length, 'languages');
