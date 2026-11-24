// Earlier ranked seasons typed in or pasted, one per line – "2023 Solo Gold II 54W 50L",
// "S2024-1 Flex Platin 3 20-18", "2022; Diamond 4; 100 90". → { entries, bad: [line numbers] }.
// Tier names in English and German, short forms too. No DOM; window and tests.
(function (root) {
  const TIERS = [
    ['GRANDMASTER', ['grandmaster', 'großmeister', 'grossmeister', 'gm']],
    ['CHALLENGER', ['challenger', 'herausforderer', 'chall']],
    ['MASTER', ['master', 'meister']],
    ['DIAMOND', ['diamond', 'diamant', 'dia']],
    ['EMERALD', ['emerald', 'smaragd', 'eme']],
    ['PLATINUM', ['platinum', 'platin', 'plat']],
    ['GOLD', ['gold']],
    ['SILVER', ['silver', 'silber']],
    ['BRONZE', ['bronze']],
    ['IRON', ['iron', 'eisen']],
  ];
  const APEX = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
  const ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', i: 'I', ii: 'II', iii: 'III', iv: 'IV' };

  function parseLine(line) {
    const raw = line.trim();
    if (!raw) return null;
    let s = raw.toLowerCase().replace(/[;,|]/g, ' ').replace(/\s+/g, ' ');
    // the season comes first: 2023, S2023, S2024-1, 2024 split 2, S13
    const m = /^(s(?:eason)?\s?)?(\d{4}(?:[-./ ]?(?:split\s?)?[1-3])?|\d{1,2})\b/.exec(s);
    if (!m) return { error: true };
    const season = m[2].replace(/\s?split\s?/, '-').replace(/[ ./]/, '-');
    s = s.slice(m[0].length);
    const queue = /\bflex\b/.test(s) ? 'flex' : 'solo';
    s = s.replace(/\b(flex|solo\/duo|solo|duo|ranked)\b/g, ' ');
    let tier = '', division = '';
    for (const [id, names] of TIERS) {
      const re = new RegExp(`\\b(${names.join('|')})\\b\\s*(iv|iii|ii|i|[1-4])?\\b`);
      const t = re.exec(s);
      if (t) {
        tier = id;
        division = APEX.includes(id) ? '' : ROMAN[t[2]] || '';
        s = s.slice(0, t.index) + ' ' + s.slice(t.index + t[0].length);
        break;
      }
    }
    // wins and losses: "54w 50l", "54s 50n", "54-50", "54/50", "54 50"
    const n = s.match(/\d+/g) || [];
    const wins = n.length >= 1 ? Number(n[0]) : null;
    const losses = n.length >= 2 ? Number(n[1]) : null;
    if (!tier && wins == null) return { error: true };
    if ((wins != null && wins > 5000) || (losses != null && losses > 5000)) return { error: true };
    return { season: /^\d{4}/.test(season) ? season : 'S' + season, queue, tier, division, wins, losses };
  }
  function parseSeasons(text) {
    const entries = [], bad = [];
    String(text || '').split(/\r?\n/).forEach((line, i) => {
      const e = parseLine(line);
      if (!e) return;
      if (e.error) bad.push(i + 1); else entries.push(e);
    });
    return { entries, bad };
  }
  // one entry back as a line (for editing)
  const lineOf = e => [e.season, e.queue === 'flex' ? 'Flex' : 'Solo', e.tier ? e.tier.charAt(0) + e.tier.slice(1).toLowerCase() : '', e.division,
    e.wins != null ? e.wins + 'W' : '', e.losses != null ? e.losses + 'L' : ''].filter(Boolean).join(' ');

  const api = { parseSeasons, parseLine, lineOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SeasonParse = api;
})(typeof window !== 'undefined' ? window : this);
