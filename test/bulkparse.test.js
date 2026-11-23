const test = require('node:test');
const assert = require('node:assert');
const { parseBulk } = require('../ui/bulkparse.js');

test('bulk add: one account per line in the usual formats', () => {
  const r = parseBulk([
    'acc01--Moonlit Fox#EUW--pa:ss',
    'acc02:my:pass',
    'acc03;pw3;Other#EUW;main acc',
    'acc04\tpw4',
    'Just Name#EUW',
    'https://op.gg/lol/summoners/euw/Foo-EUW',
    '',
    '# a comment',
    'acc05',
    'acc01:again',
  ].join('\n'));
  assert.deepEqual(r.map(x => [x.u, x.p, x.riotId, x.note, x.error || '']), [
    ['acc01', 'pa:ss', 'Moonlit Fox#EUW', '', ''],
    ['acc02', 'my:pass', '', '', ''],
    ['acc03', 'pw3', 'Other#EUW', 'main acc', ''],
    ['acc04', 'pw4', '', '', ''],
    ['', '', 'Just Name#EUW', '', ''],
    ['', '', 'https://op.gg/lol/summoners/euw/Foo-EUW', '', ''],
    ['acc05', '', '', '', 'pass'],
    ['acc01', 'again', '', '', 'twice'],
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
