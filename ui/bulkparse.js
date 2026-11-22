// Reads many accounts from pasted text (no DOM; shared by the window and the tests).
// One account per line – the parts can be split by "--", tab, "|", ";", ":" or "," (in that order):
//   user--Name#TAG--password      (LeagueAccounts)
//   user:password  /  user;password;Name#TAG;note  /  Name#TAG alone (no login)
// or blocks of "key: value" lines (Username:, Password:, Riot ID:, Note:, Server:), a blank line between accounts.
(function (root) {
  const RIOT_ID = /^[^#\s][^#]{1,15}#[\p{L}\p{N}]{2,5}$/u;
  const LINK = /^https?:\/\/\S+$/i;
  const KEYS = [
    ['u', /^(user(name)?|login|benutzer(name)?|account|acc|e-?mail)$/i],
    ['p', /^(pass(word|wort)?|pw|kennwort)$/i],
    ['riotId', /^(riot[ _-]?id|ign|name|summoner|riot[ _-]?name)$/i],
    ['note', /^(note|notiz|notes|bemerkung|comment)$/i],
    ['server', /^(server|region)$/i],
  ];
  const SEPS = ['--', '\t', '|', ';', ':', ','];
  const isId = s => RIOT_ID.test(s) || LINK.test(s);

  function fromParts(parts) {
    const r = { u: '', p: '', riotId: '', note: '' };
    parts = parts.map(s => s.trim()).filter(Boolean);
    // LeagueAccounts: user--Name#TAG--password (the middle part is the Riot ID)
    const idAt = parts.length === 3 && isId(parts[1]) ? 1 : parts.findIndex(isId);
    if (idAt >= 0) { r.riotId = parts[idAt]; parts.splice(idAt, 1); }
    [r.u = '', r.p = ''] = parts;
    r.note = parts.slice(2).join(' ').slice(0, 24);
    return r;
  }
  function splitLine(line) {
    if (isId(line.trim())) return [line];
    for (const sep of SEPS) {
      if (!line.includes(sep)) continue;
      if (sep === ':' && LINK.test(line.trim())) continue;
      // "user:pass" – a password may contain ":" itself, so only the first one splits
      if (sep === ':') { const i = line.indexOf(':'); return [line.slice(0, i), line.slice(i + 1)]; }
      return line.split(sep);
    }
    return line.trim().split(/\s+/);
  }
  function keyOf(line) {
    const m = /^\s*([\p{L} _-]{1,20}?)\s*[:=]\s*(.*)$/u.exec(line);
    if (!m) return null;
    const k = KEYS.find(([, re]) => re.test(m[1].trim()));
    return k ? [k[0], m[2].trim()] : null;
  }
  function check(r) {
    if (r.u && !r.p) r.error = 'pass';
    else if (!r.u && r.p) r.error = 'user';
    else if (!r.u && !r.riotId) r.error = 'empty';
    else if (/\s/.test(r.u)) r.error = 'user';
    return r;
  }

  function parseBulk(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    const blocks = lines.some(l => keyOf(l));
    if (blocks) {
      let cur = null, start = 0;
      const flush = () => { if (cur) out.push(check({ u: '', p: '', riotId: '', note: '', ...cur, line: start })); cur = null; };
      lines.forEach((l, i) => {
        if (!l.trim()) return flush();
        const kv = keyOf(l);
        if (!kv) return;
        const [k, v] = kv;
        if (cur && cur[k] != null && k !== 'note') flush();   // the same key again: the next account
        if (!cur) { cur = {}; start = i + 1; }
        if (k !== 'server') cur[k] = k === 'note' ? v.slice(0, 24) : v;
      });
      flush();
    } else {
      lines.forEach((l, i) => {
        if (!l.trim() || /^\s*(#|\/\/)/.test(l) && !RIOT_ID.test(l.trim())) return;
        out.push(check({ ...fromParts(splitLine(l)), line: i + 1 }));
      });
    }
    // the same login (or Riot ID without login) twice: only the first one
    const seen = new Set();
    for (const r of out) {
      if (r.error) continue;
      const key = r.u ? 'u:' + r.u.toLowerCase() : 'id:' + r.riotId.toLowerCase();
      if (seen.has(key)) r.error = 'twice';
      seen.add(key);
    }
    return out;
  }

  const api = { parseBulk };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BulkParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
