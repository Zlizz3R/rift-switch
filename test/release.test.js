// tools/release.js: setting the version touches only the package's own version line.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setVersion, getVersion, validVersion } = require('../tools/release.js');

test('release: the version is set in tauri.conf.json, package.json and Cargo.toml only where it belongs', () => {
  const conf = '{\n  "productName": "Rift Switch",\n  "version": "1.3.1",\n  "x": { "version": "9" }\n}';
  assert.equal(getVersion('conf', setVersion('conf', conf, '1.3.2')), '1.3.2');
  assert.match(setVersion('conf', conf, '1.3.2'), /"x": \{ "version": "9" \}/);
  const cargo = '[package]\nname = "rift-switch"\nversion = "1.3.1"\n\n[dependencies]\nserde = { version = "1" }\ntokio = "1"\n';
  const out = setVersion('cargo', cargo, '1.3.2');
  assert.equal(getVersion('cargo', out), '1.3.2');
  assert.match(out, /serde = \{ version = "1" \}/);
  assert.ok(validVersion('1.3.2') && !validVersion('1.3') && !validVersion('v1.3.2'));
});
