// Makes a release the way GitHub Actions will accept it – every check the release workflow runs,
// here first, so a tag never fails there again ("tag not on main", `cargo fmt`):
//
//   node tools/release.js 1.3.2          set the version, check everything, commit, tag (no push)
//   node tools/release.js 1.3.2 --push   … and push main and the tag (GitHub then builds the release)
//
// Steps: on main with nothing uncommitted · an entry for the version in ui/changelog.js · the version
// set in tauri.conf.json, Cargo.toml and package.json · cargo fmt --check · cargo clippy -D warnings ·
// npm test (window tests + cargo test) · commit "Version x.y.z" · tag vx.y.z on that commit.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FILES = {
  conf: 'src-tauri/tauri.conf.json',
  cargo: 'src-tauri/Cargo.toml',
  pkg: 'package.json',
};

// the text of each file with the version set (only the package's own version line)
function setVersion(name, text, v) {
  if (name === 'cargo') return text.replace(/^(\[package\][\s\S]*?^version\s*=\s*")[^"]*(")/m, `$1${v}$2`);
  return text.replace(/^(\s*"version"\s*:\s*")[^"]*(")/m, `$1${v}$2`);
}
function getVersion(name, text) {
  const m = name === 'cargo' ? text.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]*)"/m) : text.match(/^\s*"version"\s*:\s*"([^"]*)"/m);
  return m ? m[1] : null;
}
const validVersion = v => /^\d+\.\d+\.\d+$/.test(v);

function main() {
  const args = process.argv.slice(2);
  const v = String(args.find(a => !a.startsWith('--')) || '').replace(/^v/, '');
  const push = args.includes('--push');
  if (!validVersion(v)) fail('Usage: node tools/release.js 1.2.3 [--push]');
  const sh = (cmd, opt = {}) => execSync(cmd, { cwd: ROOT, stdio: opt.quiet ? 'pipe' : 'inherit', encoding: 'utf8', ...opt });
  const step = s => console.log(`\n▶ ${s}`);

  step('Branch and working tree');
  const branch = sh('git rev-parse --abbrev-ref HEAD', { quiet: true }).trim();
  if (branch !== 'main') fail(`On "${branch}" – releases come from main only.`);
  if (sh('git status --porcelain', { quiet: true }).trim()) fail('Uncommitted changes – commit them first.');
  if (sh(`git tag -l v${v}`, { quiet: true }).trim()) fail(`Tag v${v} exists already.`);
  try { sh('git fetch origin main --quiet', { quiet: true }); } catch { fail('Could not reach origin.'); }
  try { sh('git merge-base --is-ancestor origin/main HEAD', { quiet: true }); } catch { fail('origin/main has commits this main lacks – pull first.'); }

  step('Changelog');
  delete require.cache[require.resolve('../ui/changelog.js')];
  const { CHANGELOG } = require('../ui/changelog.js');
  const e = CHANGELOG.find(x => x.v === v);
  if (!e || !(e.en || []).length || !(e.de || []).length) fail(`ui/changelog.js has no entry (en + de) for ${v}.`);
  if (CHANGELOG[0].v !== v) fail(`The entry for ${v} must be the first one in ui/changelog.js.`);

  step(`Version ${v}`);
  for (const [name, file] of Object.entries(FILES)) {
    const p = path.join(ROOT, file);
    const before = fs.readFileSync(p, 'utf8');
    const after = setVersion(name, before, v);
    if (getVersion(name, after) !== v) fail(`Could not set the version in ${file}.`);
    if (after !== before) fs.writeFileSync(p, after);
  }

  step('cargo fmt --check');
  sh('cargo fmt --check', { cwd: path.join(ROOT, 'src-tauri') });
  step('cargo clippy');
  sh('cargo clippy --all-targets -- -D warnings', { cwd: path.join(ROOT, 'src-tauri') });
  step('npm test');
  sh('npm test');

  step('Commit and tag');
  if (sh('git status --porcelain', { quiet: true }).trim()) {
    sh(`git add ${Object.values(FILES).join(' ')} src-tauri/Cargo.lock`);
    sh(`git commit -m "Version ${v}"`);
  }
  sh(`git tag v${v}`);
  if (push) {
    step('Push');
    sh('git push origin main');
    sh(`git push origin v${v}`);
    console.log(`\n✔ v${v} pushed – GitHub Actions builds and publishes the release.`);
  } else {
    console.log(`\n✔ v${v} tagged. Publish with:  git push origin main; git push origin v${v}`);
  }
}
function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

if (require.main === module) {
  try { main(); } catch (e) { fail(e.message.split('\n')[0]); }
}
module.exports = { setVersion, getVersion, validVersion };
