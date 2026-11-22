// Prints the GitHub release text of one version from ui/changelog.js:
//   node tools/release-notes.js v1.2.0 > notes.md
const { CHANGELOG } = require('../ui/changelog.js');
const v = String(process.argv[2] || '').replace(/^v/, '');
const e = CHANGELOG.find(x => x.v === v);
if (!e) {
  console.error(`No changelog entry for ${v} in ui/changelog.js`);
  process.exit(1);
}
const list = items => items.map(i => `- ${i}`).join('\n');
process.stdout.write(`## What's new\n\n${list(e.en)}\n\n## Neu (Deutsch)\n\n${list(e.de)}\n`);
