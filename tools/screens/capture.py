"""Screenshots and the promo video for the README, taken from the demo copy of the window.

    node tools/screens/demo.js                 # builds tools/screens/site (made-up accounts)
    python tools/screens/capture.py            # docs/screens/*.png, docs/demo.webp, docs/demo.mp4
    python tools/screens/capture.py shots      # only the screenshots
    python tools/screens/capture.py film       # only the video

Headless Edge (no window), driven over the DevTools protocol (cdp.py). ffmpeg is needed for the
video: on PATH, in FFMPEG, or Pinokio's copy (with libwebp); Pillow for the cross-fades. The README
shows the animated WebP (a GIF of the same video would be four times the size); the MP4 is the sharp
version for the release page.

The video is a short promo: a title card, then one scene per feature – each with a caption, a mouse
pointer that moves and clicks, zooms and cross-fades – and an end card. Every frame is a screenshot
of the real window (demo data), the captions and the pointer are laid over it.
"""
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from cdp import EdgeSession  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SITE = Path(__file__).parent / "site" / "index.html"
SHOTS = ROOT / "docs" / "screens"
W, H = 1280, 800
FPS = 25
DT = 1 / FPS


def ffmpeg():
    for c in [os.environ.get("FFMPEG"), shutil.which("ffmpeg"), r"C:\pinokio\bin\ffmpeg-env\Library\bin\ffmpeg.exe"]:
        if c and Path(c).exists():
            return c
    raise SystemExit("ffmpeg not found (set FFMPEG)")


def js(page, code):
    return page.evaluate("(async () => {" + code + "})()", await_promise=True)


def settle(page, s=0.35):
    time.sleep(s)


def fresh(page):
    page.navigate(SITE.as_uri())
    page.wait_until("typeof renderDash === 'function' && document.querySelectorAll('#board .tile').length > 3")
    js(page, "await new Promise(r => setTimeout(r, 900)); document.querySelectorAll('.overlay').forEach(o => o.hidden = true);")
    settle(page, 0.8)   # icons from CommunityDragon


def show(page, view):
    js(page, f"showView('{view}');")
    settle(page, 0.6)


def tab(page, name):
    js(page, f"showView('dash'); showDashTab('{name}');")
    settle(page, 0.9)


def type_into(page, sel, text):
    js(page, f"const i = document.querySelector('{sel}'); i.value = {text!r}; i.dispatchEvent(new Event('input', {{ bubbles: true }}));")


def hover_chart(page, frac, sel=".dash-plot"):
    js(page, f"""const p = document.querySelector('{sel}'); const r = p.getBoundingClientRect();
      p.dispatchEvent(new MouseEvent('mousemove', {{ bubbles: true, clientX: r.left + r.width * {frac}, clientY: r.top + 40 }}));""")


# ---------- screenshots ----------
def screenshots(page):
    SHOTS.mkdir(parents=True, exist_ok=True)
    shot = lambda name: page.screenshot(SHOTS / f"{name}.png")
    fresh(page)
    js(page, "selectAccount(document.querySelectorAll('#board .tile')[0].dataset.id);")
    settle(page, 1.2)
    shot("accounts")
    js(page, "document.querySelector('[data-layout=list]').click();")
    settle(page, 0.8)
    shot("list")
    js(page, "document.querySelector('[data-layout=tiles]').click();")
    # the Overview: Performance first (the start page), then its other tabs
    tab(page, "stats")
    settle(page, 0.8)
    shot("performance")
    js(page, "document.getElementById('perfSec-style').scrollIntoView({ block: 'start' }); document.querySelector('main').scrollTop -= 16;")
    settle(page, 0.6)
    shot("play-style")
    js(page, "document.querySelector('main').scrollTop = 0;")
    tab(page, "tags")
    settle(page, 0.6)
    shot("tags")
    tab(page, "mast")
    shot("mastery")
    tab(page, "matches")
    settle(page, 1.0)
    js(page, "document.querySelector('#mhList .mh-row')?.click();")
    settle(page, 1.2)
    js(page, "document.querySelector('#mhList .mh-row.open').scrollIntoView({ block: 'start' }); document.querySelector('main').scrollTop -= 12;")
    settle(page, 0.5)
    shot("matches")
    js(page, "document.querySelector('main').scrollTop = 0;")
    tab(page, "lp")
    js(page, "document.querySelector('[data-dd=\"90\"]').click();")
    settle(page, 0.5)
    hover_chart(page, 0.62)
    settle(page, 0.3)
    shot("overview")
    tab(page, "seasons")
    shot("seasons")
    show(page, "coll")
    type_into(page, "#collSearch", "ahri")
    settle(page, 1.0)
    shot("collection")
    show(page, "live")
    settle(page, 2.0)
    shot("live")
    js(page, "document.querySelector('#liveBody .helper').scrollIntoView({ block: 'end' });")
    settle(page, 0.8)
    shot("helper")
    js(page, "window.__demoGame(true);")
    settle(page, 3.0)
    js(page, "document.getElementById('viewLive').scrollIntoView({ block: 'start' });")
    settle(page, 0.5)
    shot("live-game")
    js(page, "window.__demoGame(false);")
    show(page, "accounts")
    js(page, "openBulk(true); const b = document.getElementById('bulkText'); b.value = 'account01:hunter2\\naccount02--Shadow Step#EUW--pa55word\\naccount03;secret;Pocket Healer#EUW;support\\naccount04\\nCrit Happens#EUW'; b.dispatchEvent(new Event('input'));")
    settle(page, 0.6)
    shot("bulk-add")
    js(page, "openBulk(false);")
    js(page, "window.__demoPush({ switching: { id: S.accounts[1].puuid, n: 1, steps: ['close', 'client', 'signin', 'play', 'launch'], step: 'signin', detail: 'typing' } });")
    settle(page, 0.8)
    shot("login-steps")
    for old in ["champions.png"]:   # Champions is a section of Performance now
        (SHOTS / old).unlink(missing_ok=True)
    print("screenshots:", ", ".join(sorted(p.name for p in SHOTS.glob("*.png"))))


# ---------- the promo video ----------
# What is laid over the window: the pointer, its click ring, the caption, the title / end card, and a
# zoom of the whole window (.frame) around a point.
PROMO = r"""
const st = document.createElement('style');
st.textContent = `
#pmCur { position: fixed; left: 0; top: 0; width: 30px; height: 30px; z-index: 100003; pointer-events: none; display: none;
  filter: drop-shadow(0 3px 6px rgba(0,0,0,.65)); }
#pmRing { position: fixed; z-index: 100002; width: 54px; height: 54px; margin: -27px 0 0 -27px; border-radius: 50%; pointer-events: none; display: none;
  border: 3px solid #f0e6d2; box-shadow: 0 0 22px rgba(200,170,110,.9), inset 0 0 14px rgba(200,170,110,.6); }
#pmCap { position: fixed; left: 44px; bottom: 44px; z-index: 100001; max-width: 720px; padding: 20px 30px 22px 30px; border-radius: 18px; display: none;
  background: linear-gradient(135deg, rgba(16,22,35,.95), rgba(9,12,19,.93)); border: 1px solid rgba(200,170,110,.5);
  box-shadow: 0 30px 70px -12px rgba(0,0,0,.9), 0 0 40px -10px rgba(200,170,110,.35), inset 0 1px 0 rgba(255,255,255,.06); overflow: hidden; }
#pmCap::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: linear-gradient(180deg, #f0e6d2, #c8aa6e 50%, #7a5c29); }
#pmCap::after { content: ""; position: absolute; right: -80px; top: -80px; width: 240px; height: 240px; border-radius: 50%;
  background: radial-gradient(circle, rgba(200,170,110,.16), transparent 70%); }
#pmCap .k { display: flex; align-items: center; gap: 10px; font-size: 12.5px; font-weight: 800; letter-spacing: 3.2px; text-transform: uppercase; color: #c8aa6e; }
#pmCap .k i { width: 8px; height: 8px; transform: rotate(45deg); background: linear-gradient(135deg, #f0e6d2, #c8aa6e); box-shadow: 0 0 12px rgba(200,170,110,.8); }
#pmCap .t { margin-top: 9px; font-size: 38px; font-weight: 800; line-height: 1.1; letter-spacing: .2px;
  background: linear-gradient(180deg, #fff8e8, #e2c68c); -webkit-background-clip: text; background-clip: text; color: transparent; }
#pmCap .s { margin-top: 9px; font-size: 17px; line-height: 1.45; color: #b8c0cf; }
#pmCard { position: fixed; inset: 0; z-index: 100000; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 16px;
  background: radial-gradient(760px 420px at 50% 42%, rgba(200,170,110,.17), transparent 62%), radial-gradient(1100px 600px at 50% 118%, rgba(10,200,185,.13), transparent 60%), #080b12; }
#pmCard::before { content: ""; position: absolute; inset: 0; opacity: .9;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='48' viewBox='0 0 56 48'%3E%3Cpath d='M14 0l14 8v16l-14 8L0 24V8zM42 24l14 8v16l-14 8-14-8V32z' fill='none' stroke='%23c8aa6e' stroke-opacity='.06' stroke-width='1'/%3E%3C/svg%3E"); }
#pmCard > * { position: relative; }
#pmCard img { width: 118px; height: 118px; filter: drop-shadow(0 0 34px rgba(200,170,110,.5)); }
#pmCard h1 { font-size: 82px; font-weight: 800; letter-spacing: 1px; line-height: 1; margin: 6px 0 0;
  background: linear-gradient(180deg, #fff8e8 10%, #c8aa6e 90%); -webkit-background-clip: text; background-clip: text; color: transparent; }
#pmCard p { font-size: 24px; color: #b8c0cf; letter-spacing: .3px; }
#pmCard .line { width: 220px; height: 1px; background: linear-gradient(90deg, transparent, #c8aa6e, transparent); margin: 6px 0; }
#pmCard .chips { display: flex; gap: 12px; margin-top: 8px; }
#pmCard .chips span { padding: 8px 18px; border-radius: 999px; font-size: 16px; font-weight: 600; color: #f0e6d2;
  border: 1px solid rgba(200,170,110,.45); background: rgba(200,170,110,.08); }
#pmCard small { margin-top: 18px; font-size: 17px; color: #8b94a7; letter-spacing: .4px; }
#pmCard small b { color: #e2c68c; font-weight: 600; }
`;
document.head.appendChild(st);
const el = (id, html) => { const e = document.createElement('div'); e.id = id; e.innerHTML = html || ''; document.body.appendChild(e); return e; };
const cur = el('pmCur', '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 2.5l15.5 11.2-6.6 1.2 3.9 7.4-3 1.5-3.9-7.4L5 21z" fill="#fff" stroke="#0b0e14" stroke-width="1.4" stroke-linejoin="round"/></svg>');
const ring = el('pmRing'), cap = el('pmCap'), card = el('pmCard');
const frame = document.querySelector('.frame');
window.__pm = {
  cur(x, y, on = true) { cur.style.display = on ? 'block' : 'none'; cur.style.transform = `translate(${x - 4}px, ${y - 2}px)`; },
  ring(x, y, p) {
    if (p < 0 || p >= 1) { ring.style.display = 'none'; return; }
    ring.style.display = 'block'; ring.style.left = x + 'px'; ring.style.top = y + 'px';
    ring.style.transform = `scale(${0.35 + p * 0.95})`; ring.style.opacity = String(1 - p);
  },
  cap(k, title, sub, p, right = false) {
    if (p <= 0) { cap.style.display = 'none'; return; }
    cap.style.display = 'block';
    cap.style.left = right ? 'auto' : '44px'; cap.style.right = right ? '44px' : 'auto';
    cap.innerHTML = `<div class="k"><i></i>${k}</div><div class="t">${title}</div><div class="s">${sub}</div>`;
    cap.style.opacity = String(Math.min(1, p));
    cap.style.transform = `translateY(${(1 - p) * 28}px)`;
  },
  card(html, p, scale = true) {
    if (p <= 0) { card.style.display = 'none'; return; }
    card.style.display = 'flex';
    if (html != null) card.innerHTML = html;
    card.style.opacity = String(Math.min(1, p));
    for (const c of card.children) c.style.transform = scale ? `scale(${0.94 + 0.06 * p}) translateY(${(1 - p) * 14}px)` : '';
  },
  zoom(s, ox, oy) {
    frame.style.transformOrigin = `${ox}px ${oy}px`;
    frame.style.transform = s === 1 ? '' : `scale(${s})`;
  },
  // the middle of an element on screen (after a zoom)
  at(sel) { const e = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; },
};
"""

CARD_TITLE = """<img src="icon.png" alt=""><h1>Rift Switch</h1><div class="line"></div>
<p>The local multi-account companion for League of Legends</p>"""
CARD_END = """<img src="icon.png" alt=""><h1>Rift Switch</h1><div class="line"></div>
<div class="chips"><span>Free &amp; open source</span><span>Windows 10 · 11</span><span>2 MB installer</span><span>11 languages</span></div>
<small>Download: <b>github.com/Zlizz3R/rift-switch</b></small>"""


def ease(t):
    return t * t * (3 - 2 * t)


class Film:
    """Frames with their own duration -> ffmpeg concat list; cross-fades blended with Pillow."""

    def __init__(self, page, folder):
        self.page, self.dir, self.list, self.xf = page, folder, [], 0
        folder.mkdir(parents=True, exist_ok=True)

    def _path(self):
        return self.dir / f"f{len(self.list):05d}.png"

    def frame(self, dur=DT):
        f = self._path()
        self.page.screenshot(f)
        if self.xf and self.list:
            from PIL import Image
            a = Image.open(self.list[-1][0]).convert("RGB")
            b = Image.open(f).convert("RGB")
            if a.size == b.size:
                tmp = self.dir / "next.png"
                f.rename(tmp)
                for i in range(1, self.xf):
                    p = self._path()
                    Image.blend(a, b, ease(i / self.xf)).save(p)
                    self.list.append((p, DT))
                f = self._path()
                tmp.rename(f)
            self.xf = 0
        self.list.append((f, dur))

    def hold(self, s):
        self.frame(s)

    def crossfade(self, n=12):
        """the next frame fades in over the last one"""
        self.xf = n


class Pointer:
    def __init__(self, page, fm, x=W * 0.72, y=H * 0.86):
        self.page, self.fm, self.x, self.y = page, fm, x, y

    def place(self, x, y, on=True):
        self.x, self.y = x, y
        js(self.page, f"__pm.cur({x}, {y}, {str(on).lower()});")

    def hide(self):
        js(self.page, "__pm.cur(0, 0, false);")

    def at(self, sel):
        return js(self.page, f"return __pm.at({sel!r});")

    def move(self, target, frames=14):
        x0, y0 = self.x, self.y
        x1, y1 = self.at(target) if isinstance(target, str) else target
        for i in range(1, frames + 1):
            t = ease(i / frames)
            # a slight arc, like a hand
            arc = (1 - abs(2 * t - 1)) * -26
            self.place(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + arc)
            self.fm.frame()

    def click(self, sel=None, real=True, frames=7):
        if real and sel:
            js(self.page, f"document.querySelector({sel!r}).click();")
        for i in range(frames):
            js(self.page, f"__pm.ring({self.x}, {self.y}, {i / frames});")
            self.fm.frame()
        js(self.page, "__pm.ring(0, 0, -1);")


def caption(page, fm, k, title, sub, frames=9, out=False, right=False):
    for i in range(1, frames + 1):
        p = ease(i / frames)
        js(page, f"__pm.cap({k!r}, {title!r}, {sub!r}, {1 - p if out else p}, {str(right).lower()});")
        fm.frame()


def card(page, fm, html, frames=12, out=False):
    js(page, f"__pm.card({html!r}, 0.001);")
    for i in range(1, frames + 1):
        p = ease(i / frames)
        js(page, f"__pm.card(null, {1 - p if out else p});")
        fm.frame()


def zoom(page, fm, s0, s1, ox, oy, frames=14):
    for i in range(1, frames + 1):
        t = ease(i / frames)
        js(page, f"__pm.zoom({s0 + (s1 - s0) * t}, {ox}, {oy});")
        fm.frame()


def scroll(page, fm, to, frames=36, sel="main"):
    y0 = js(page, f"return document.querySelector('{sel}').scrollTop;")
    for i in range(1, frames + 1):
        t = ease(i / frames)
        js(page, f"document.querySelector('{sel}').scrollTop = {y0 + (to - y0) * t};")
        fm.frame()


def film(page):
    tmp = ROOT / "tools" / "screens" / "frames"
    shutil.rmtree(tmp, ignore_errors=True)
    fm = Film(page, tmp)
    fresh(page)
    js(page, PROMO)
    js(page, "selectAccount(document.querySelectorAll('#board .tile')[0].dataset.id);")
    settle(page, 1.0)
    cur = Pointer(page, fm)

    # ---- title card ----
    js(page, f"__pm.card({CARD_TITLE!r}, 1);")
    settle(page, 0.6)
    js(page, f"__pm.card(null, 0.001);")
    card(page, fm, CARD_TITLE, frames=16)
    fm.hold(1.6)
    js(page, "__pm.card(null, 0);")
    fm.crossfade(14)

    # ---- 1. one click per account ----
    fm.hold(0.5)
    caption(page, fm, "01 · Accounts", "One click per account", "Pick an account, press Log in – League restarts with it.<br>No typing, no logging out by hand.")
    fm.hold(0.6)
    cur.place(W * 0.6, H * 0.9)
    tile = "#board .tile[data-id='" + js(page, "return document.querySelectorAll('#board .tile')[1].dataset.id;") + "']"
    cur.move(tile)
    cur.click(tile)
    settle(page, 0.5)
    fm.hold(0.5)
    cur.move("#dSwitch", frames=12)
    cur.click("#dSwitch", real=False)
    sw = "window.__demoPush({ switching: { id: S.accounts[1].puuid, n: 1, steps: ['close', 'client', 'signin', 'play', 'launch'], step: '%s', detail: '%s' } });"
    for step, detail, d in [("close", "", 0.55), ("client", "", 0.55), ("signin", "typing", 0.7), ("signin", "verify", 0.5), ("play", "", 0.5), ("launch", "", 0.7)]:
        js(page, sw % (step, detail))
        settle(page, 0.15)
        fm.hold(d)
    js(page, "window.__demoPush({ switching: null, active: S.accounts[1].puuid, live: { clientUp: true, puuid: S.accounts[1].puuid, phase: 'Lobby', waits: [] } });")
    settle(page, 0.6)
    fm.hold(1.3)
    caption(page, fm, "01 · Accounts", "One click per account", "Pick an account, press Log in – League restarts with it.<br>No typing, no logging out by hand.", out=True)
    cur.hide()
    js(page, "showView('dash'); showDashTab('stats'); document.querySelector('main').scrollTop = 0;")
    settle(page, 1.6)
    fm.crossfade(14)

    # ---- 2. every game of every account ----
    fm.hold(0.4)
    caption(page, fm, "02 · Overview", "Every game of every account", "Win rate, KDA, champions, roles, play style and where you die –<br>one page, one filter, all your accounts together.")
    fm.hold(1.4)
    cur.place(W * 0.55, H * 0.8)
    cur.move("[data-ovacc]:nth-child(2)", frames=14)
    cur.click("[data-ovacc]:nth-child(2)")
    settle(page, 0.6)
    fm.hold(1.0)
    cur.move("[data-ovacc='']", frames=10)
    cur.click("[data-ovacc='']")
    settle(page, 0.6)
    fm.hold(0.5)
    cur.hide()
    scroll(page, fm, 360, frames=40)
    fm.hold(1.4)
    caption(page, fm, "02 · Overview", "Every game of every account", "Win rate, KDA, champions, roles, play style and where you die –<br>one page, one filter, all your accounts together.", out=True)
    scroll(page, fm, 0, frames=18)

    # ---- 3. auto-accept ----
    fm.hold(0.3)
    ox, oy = js(page, "return __pm.at('.aa-toggle');")
    zoom(page, fm, 1, 2.3, ox, oy, frames=16)
    caption(page, fm, "03 · Queue", "Auto-accept", "Never miss a queue pop – the match is accepted for you,<br>right from the title bar.")
    cur.place(ox - 140, oy + 120)
    cur.move(".aa-toggle .sw", frames=14)
    cur.click("#aaToggle")
    settle(page, 0.3)
    fm.hold(1.6)
    caption(page, fm, "03 · Queue", "Auto-accept", "Never miss a queue pop – the match is accepted for you,<br>right from the title bar.", out=True)
    cur.hide()
    zoom(page, fm, 2.3, 1, ox, oy, frames=12)

    # ---- 4. random skin ----
    js(page, "window.__demoPush({ live: { clientUp: true, puuid: S.accounts[0].puuid, phase: 'ChampSelect', waits: [] } }); showView('live');")
    settle(page, 2.2)
    js(page, "const m = document.querySelector('main'); m.scrollTop += document.querySelector('#liveBody .helper').getBoundingClientRect().top - 400;")
    settle(page, 0.5)
    fm.crossfade(12)
    fm.hold(0.3)
    caption(page, fm, "04 · Champion select", "Random skin", "One click picks a random skin you own – and a chroma –<br>for the champion you locked in.", right=True)
    cur.place(W * 0.5, H * 0.75)
    cur.move("#rndSkin", frames=16)
    cur.click("#rndSkin")
    settle(page, 0.4)
    fm.hold(1.8)
    caption(page, fm, "04 · Champion select", "Random skin", "One click picks a random skin you own – and a chroma –<br>for the champion you locked in.", out=True, right=True)
    cur.hide()

    # ---- 5. live game analysis ----
    js(page, "window.__demoGame(true);")
    settle(page, 3.2)
    js(page, "document.querySelector('main').scrollTop = 0; document.getElementById('viewLive').scrollIntoView({ block: 'start' });")
    settle(page, 0.6)
    fm.crossfade(14)
    fm.hold(0.4)
    caption(page, fm, "05 · In game", "Live game analysis", "All ten players from the loading screen on – rank, win rate on the<br>champion, mastery, traits, premades and the damage mix.")
    fm.hold(1.6)
    y = js(page, "return document.querySelector('main').scrollTop;")
    scroll(page, fm, y + 300, frames=40)
    fm.hold(1.4)
    caption(page, fm, "05 · In game", "Live game analysis", "All ten players from the loading screen on – rank, win rate on the<br>champion, mastery, traits, premades and the damage mix.", out=True)

    # ---- 6. strengths ----
    js(page, "window.__demoGame(false); showView('dash'); showDashTab('tags'); document.querySelector('main').scrollTop = 0;")
    settle(page, 1.6)
    fm.crossfade(14)
    fm.hold(0.4)
    caption(page, fm, "06 · Traits", "See your strengths", "Great farmer, lane tyrant, vision king … from your ranked games –<br>and what to work on, with the numbers behind every one.")
    fm.hold(1.0)
    cur.place(W * 0.7, H * 0.85)
    cur.move("#tagBody [data-tag]", frames=16)
    cur.click("#tagBody [data-tag]")
    settle(page, 0.5)
    fm.hold(2.0)
    caption(page, fm, "06 · Traits", "See your strengths", "Great farmer, lane tyrant, vision king … from your ranked games –<br>and what to work on, with the numbers behind every one.", out=True)
    cur.hide()

    # ---- 7. mastery ----
    js(page, "showDashTab('mast'); document.querySelector('main').scrollTop = 0;")
    settle(page, 1.4)
    fm.crossfade(14)
    fm.hold(0.4)
    caption(page, fm, "07 · Mastery", "Mastery across all accounts", "Every champion's points over all your accounts –<br>and the play time behind them.")
    fm.hold(1.2)
    cur.place(W * 0.55, H * 0.85)
    cur.move(".mast-totals > div:nth-child(2)", frames=16)
    fm.hold(1.8)
    caption(page, fm, "07 · Mastery", "Mastery across all accounts", "Every champion's points over all your accounts –<br>and the play time behind them.", out=True)
    cur.hide()

    # ---- end card ----
    card(page, fm, CARD_END, frames=16)
    fm.hold(3.0)

    lst = tmp / "list.txt"
    lines = []
    for f, d in fm.list:
        lines += [f"file '{f.name}'", f"duration {d:.3f}"]
    lines.append(f"file '{fm.list[-1][0].name}'")
    lst.write_text("\n".join(lines), encoding="utf-8")
    out = ROOT / "docs"
    ff = ffmpeg()
    common = [ff, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst)]
    subprocess.run(common + ["-vf", f"fps={FPS},format=yuv420p", "-c:v", "libx264", "-crf", "20", "-preset", "slow", "-movflags", "+faststart", str(out / "demo.mp4")], check=True, cwd=tmp)
    subprocess.run(common + ["-vf", "fps=15,scale=1100:-1:flags=lanczos", "-c:v", "libwebp_anim", "-lossless", "0", "-quality", "62",
                             "-compression_level", "4", "-loop", "0", "-an", str(out / "demo.webp")], check=True, cwd=tmp)
    total = sum(d for _, d in fm.list)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"video: {len(fm.list)} frames, {total:.1f} s")
    for f in ["demo.webp", "demo.mp4"]:
        print(f, round((out / f).stat().st_size / 1e6, 2), "MB")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    with EdgeSession(port=9344, width=W, height=H) as page:
        if what in ("all", "shots"):
            page.device(W, H, dsf=1.5)
            screenshots(page)
        if what in ("all", "film"):
            page.device(W, H, dsf=1)
            film(page)
