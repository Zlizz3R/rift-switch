"""Screenshots and the demo video for the README, taken from the demo copy of the window.

    node tools/screens/demo.js            # builds tools/screens/site (made-up accounts)
    python tools/screens/capture.py       # writes docs/screens/*.png, docs/demo.gif, docs/demo.mp4

Headless Edge (no window), driven over the DevTools protocol (cdp.py). ffmpeg is needed for the
video: on PATH, in FFMPEG, or Pinokio's copy.
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
    show(page, "dash")
    js(page, "document.querySelector('[data-dd=\"90\"]').click();")
    settle(page, 0.5)
    hover_chart(page, 0.62)
    settle(page, 0.3)
    shot("overview")
    js(page, "document.querySelector('[data-dt=\"mast\"]').click();")
    settle(page, 1.2)
    shot("mastery")
    js(page, "document.querySelector('[data-dt=\"stats\"]').click();")
    settle(page, 1.2)
    js(page, "document.querySelector('[data-prow=\"top\"]')?.click();")
    settle(page, 0.5)
    shot("performance")
    js(page, "document.querySelector('[data-dt=\"champs\"]').click();")
    settle(page, 0.8)
    shot("champions")
    js(page, "document.querySelector('[data-dt=\"style\"]').click();")
    settle(page, 0.8)
    shot("play-style")
    js(page, "document.querySelector('[data-dt=\"tags\"]').click();")
    settle(page, 1.2)
    shot("tags")
    js(page, "document.querySelector('[data-dt=\"lp\"]').click();")
    show(page, "coll")
    type_into(page, "#collSearch", "ahri")
    settle(page, 1.0)
    shot("collection")
    show(page, "matches")
    settle(page, 1.5)
    js(page, "document.querySelector('.mh-row, [data-gid]')?.click();")
    settle(page, 1.2)
    shot("matches")
    show(page, "live")
    settle(page, 2.0)
    shot("live")
    js(page, "document.querySelector('#liveBody .helper').scrollIntoView({ block: 'end' });")
    settle(page, 0.8)
    shot("helper")
    js(page, "window.__demoGame(true);")
    settle(page, 3.0)
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
    print("screenshots:", ", ".join(sorted(p.name for p in SHOTS.glob("*.png"))))


# ---------- demo video ----------
class Film:
    """Frames with their own duration -> ffmpeg concat list."""

    def __init__(self, page, folder):
        self.page, self.dir, self.list = page, folder, []
        folder.mkdir(parents=True, exist_ok=True)

    def frame(self, dur):
        f = self.dir / f"f{len(self.list):04d}.png"
        self.page.screenshot(f)
        self.list.append((f, dur))

    def hold(self, s):
        self.frame(s)


def film(page):
    tmp = ROOT / "tools" / "screens" / "frames"
    shutil.rmtree(tmp, ignore_errors=True)
    fm = Film(page, tmp)
    fresh(page)
    js(page, "selectAccount(document.querySelectorAll('#board .tile')[0].dataset.id);")
    settle(page, 1.0)
    fm.hold(1.6)
    # arrow keys move through the accounts
    for _ in range(3):
        js(page, "document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));")
        settle(page, 0.25)
        fm.hold(0.55)
    # three layouts
    for lay in ["compact", "list"]:
        js(page, f"document.querySelector('[data-layout={lay}]').click();")
        settle(page, 0.5)
        fm.hold(1.3)
    js(page, "document.querySelector('[data-layout=tiles]').click();")
    # logging in: the steps screen
    sw = "window.__demoPush({ switching: { id: S.accounts[0].puuid, n: 1, steps: ['close', 'client', 'signin', 'play', 'launch'], step: '%s', detail: '%s' } });"
    for step, detail, d in [("close", "", 0.7), ("client", "", 0.7), ("signin", "typing", 0.8), ("signin", "verify", 0.6), ("play", "", 0.6), ("launch", "", 0.9)]:
        js(page, sw % (step, detail))
        settle(page, 0.15)
        fm.hold(d)
    js(page, "window.__demoPush({ switching: null });")
    # overview: every account in one chart, hover walks along it
    show(page, "dash")
    js(page, "document.querySelector('[data-dd=\"90\"]').click();")
    settle(page, 0.4)
    fm.hold(1.0)
    for k in range(14):
        hover_chart(page, 0.12 + k * 0.06)
        fm.frame(0.12)
    js(page, "document.querySelector('[data-dq=flex]').click();")
    settle(page, 0.4)
    fm.hold(1.4)
    # collection search
    show(page, "coll")
    fm.hold(0.9)
    for n in range(1, 5):
        type_into(page, "#collSearch", "ahri"[:n])
        settle(page, 0.12)
        fm.frame(0.22)
    settle(page, 0.6)
    fm.hold(1.6)
    # match history with a game opened
    show(page, "matches")
    settle(page, 1.0)
    fm.hold(1.0)
    js(page, "document.querySelector('.mh-row, [data-gid]')?.click();")
    settle(page, 0.9)
    fm.hold(2.0)
    # champ select helper
    show(page, "live")
    settle(page, 1.5)
    fm.hold(2.4)
    show(page, "accounts")
    fm.hold(1.2)

    lst = tmp / "list.txt"
    lines = []
    for f, d in fm.list:
        lines += [f"file '{f.name}'", f"duration {d:.2f}"]
    lines.append(f"file '{fm.list[-1][0].name}'")
    lst.write_text("\n".join(lines), encoding="utf-8")
    out = ROOT / "docs"
    ff = ffmpeg()
    common = [ff, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst)]
    subprocess.run(common + ["-vf", "fps=25,format=yuv420p", "-c:v", "libx264", "-crf", "24", "-movflags", "+faststart", str(out / "demo.mp4")], check=True, cwd=tmp)
    subprocess.run(common + ["-vf", "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
                             str(out / "demo.gif")], check=True, cwd=tmp)
    shutil.rmtree(tmp, ignore_errors=True)
    for f in ["demo.gif", "demo.mp4"]:
        print(f, round((out / f).stat().st_size / 1e6, 2), "MB")


if __name__ == "__main__":
    with EdgeSession(port=9344, width=W, height=H) as page:
        page.device(W, H, dsf=1.5)
        screenshots(page)
        page.device(W, H, dsf=1)
        film(page)
