const test = require('node:test');
const assert = require('node:assert');
const { parseBulk } = require('../ui/bulkparse.js');

test('bulk add: one account per line in the usual formats', () => {
  const r = parseBulk([
    'smurf01--Hide on bush#KR1--pa:ss',
    'smurf02:my:pass',
    'smurf03;pw3;Other#EUW;main acc',
    'smurf04\tpw4',
    'Just Name#EUW',
    'https://op.gg/lol/summoners/euw/Foo-EUW',
    '',
    '# a comment',
    'smurf05',
    'smurf01:again',
  ].join('\n'));
  assert.deepEqual(r.map(x => [x.u, x.p, x.riotId, x.note, x.error || '']), [
    ['smurf01', 'pa:ss', 'Hide on bush#KR1', '', ''],
    ['smurf02', 'my:pass', '', '', ''],
    ['smurf03', 'pw3', 'Other#EUW', 'main acc', ''],
    ['smurf04', 'pw4', '', '', ''],
    ['', '', 'Just Name#EUW', '', ''],
    ['', '', 'https://op.gg/lol/summoners/euw/Foo-EUW', '', ''],
    ['smurf05', '', '', '', 'pass'],
    ['smurf01', 'again', '', '', 'twice'],
  ]);
  assert.equal(r[6].line, 9);
});

test('bulk add: blocks of "key: value" lines', () => {
  const r = parseBulk('Username: alpha\nPassword: a1\nRiot ID: Alpha#EUW\nServer: EUW\n\nLogin: beta\nPasswort: b2\nNotiz: Flex\nUsername: gamma\nPassword: c3');
  assert.deepEqual(r.map(x => [x.u, x.p, x.riotId, x.note, x.error || '']), [
    ['alpha', 'a1', 'Alpha#EUW', '', ''],
    ['beta', 'b2', '', 'Flex', ''],
    ['gamma', 'c3', '', '', ''],
  ]);
});
