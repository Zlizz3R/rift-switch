# Types a Riot login into the Riot Client window and ticks "Stay signed in".
# Reads {"u": "...", "p": "...", "since": <ms epoch, optional>} from stdin (never from the command line, so other
# programs can't read it from the process list).
# Prints one word as the last line: ok | ok-nopersist | noform | nowindow | nofocus | lostfocus | badinput
#
# The login fields are found through Windows UI Automation (the input fields the client itself
# reports, the password one marked as such). Fallback: scanning a picture of the window:
#   light panel on the left -> two grey input fields (username, password) ->
#   below them the social-login buttons, then the "Stay signed in" checkbox.
# If the form isn't recognised, NOTHING is typed (the password could land in a chat or search
# field): it answers "noform" and saves a picture of the window to %TEMP%\rift-switch-debug.
$ErrorActionPreference = 'Stop'
try { $cred = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch { 'badinput'; exit }
if (-not $cred.u -or -not $cred.p) { 'badinput'; exit }

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;

public static class RiotType {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }

  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  // real screen pixels for window size, screenshot and clicks (matters at 125/150 % scaling)
  public static void DpiAware() { try { SetProcessDPIAware(); } catch { } }
  public static int WinL, WinT, WinW, WinH;
  public static bool ReadRect() { RECT r; if (!GetWindowRect(Target, out r)) return false; WinL = r.L; WinT = r.T; WinW = r.R - r.L; WinH = r.B - r.T; return true; }

  const uint KEYUP = 2, UNICODE = 4, LDOWN = 2, LUP = 4;
  public static IntPtr Target;

  public static bool Focus() {
    if (IsIconic(Target)) ShowWindow(Target, 9);
    for (int i = 0; i < 10; i++) {
      keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, KEYUP, UIntPtr.Zero); // Alt tap unlocks SetForegroundWindow
      SetForegroundWindow(Target);
      Thread.Sleep(150);
      if (GetForegroundWindow() == Target) return true;
    }
    return false;
  }
  public static bool InFront() { return GetForegroundWindow() == Target; }

  static void Send(INPUT[] a) { SendInput((uint)a.Length, a, Marshal.SizeOf(typeof(INPUT))); }
  static INPUT K(ushort vk, ushort scan, uint flags) { var i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; return i; }
  static INPUT M(uint flags) { var i = new INPUT(); i.type = 0; i.u.mi.dwFlags = flags; return i; }

  public static void Key(ushort vk) { Send(new[] { K(vk, 0, 0), K(vk, 0, KEYUP) }); Thread.Sleep(40); }
  public static void Ctrl(ushort vk) { Send(new[] { K(0x11, 0, 0), K(vk, 0, 0), K(vk, 0, KEYUP), K(0x11, 0, KEYUP) }); Thread.Sleep(40); }

  // types any character, independent of the keyboard layout; stops if the window loses focus
  public static bool Type(string s) {
    foreach (char c in s) {
      if (!InFront()) return false;
      Send(new[] { K(0, c, UNICODE), K(0, c, UNICODE | KEYUP) });
      Thread.Sleep(8);
    }
    return true;
  }

  // ---- reading the window ----
  static Bitmap shot;
  public static int W, H;
  public static string TestImage = null;   // test only: read a saved picture instead of the window
  public static bool Capture() {
    if (TestImage != null) { if (shot != null) shot.Dispose(); shot = new Bitmap(TestImage); W = shot.Width; H = shot.Height; return true; }
    RECT r; if (!GetWindowRect(Target, out r)) return false;
    int w = r.R - r.L, h = r.B - r.T; if (w < 200 || h < 200) return false;
    if (shot != null) shot.Dispose();
    shot = new Bitmap(w, h);
    using (var g = Graphics.FromImage(shot)) { IntPtr dc = g.GetHdc(); PrintWindow(Target, dc, 2); g.ReleaseHdc(dc); }
    W = w; H = h;
    return true;
  }
  static Color Px(int x, int y) { return shot.GetPixel(Math.Max(0, Math.Min(W - 1, x)), Math.Max(0, Math.Min(H - 1, y))); }
  static bool Grey(Color c, int lo, int hi) {
    int mx = Math.Max(c.R, Math.Max(c.G, c.B)), mn = Math.Min(c.R, Math.Min(c.G, c.B));
    return mn >= lo && mx <= hi && mx - mn <= 12;
  }
  static bool PanelWhite(Color c) { return Grey(c, 245, 255); }   // panel background ~252
  static bool FieldGrey(Color c) { return Grey(c, 228, 246); }    // input fields ~239

  // found positions (window pixels)
  public static int UserX, UserY, PassX, PassY, BoxX, BoxY, PanelR, PanelL, TabY;
  public static string Info = "";

  // light panel on the left with two grey input fields and a checkbox below the social buttons
  public static bool FindForm() {
    if (!Capture()) { Info = "capture failed"; return false; }
    int y0 = (int)(H * 0.6), x = Math.Max(2, (int)(W * 0.01));
    while (x < W / 2 && !PanelWhite(Px(x, y0))) x++;          // skip a thin edge strip
    int start = x;
    while (x < W / 2 && PanelWhite(Px(x, y0))) x++;
    PanelR = x; PanelL = start; TabY = 0;
    Info = "size=" + W + "x" + H + " panel=" + start + ".." + PanelR;
    if (PanelR - start < W * 0.1 || PanelR > W * 0.5) return false;

    // walk down the middle of the panel: grey blocks are the sign-in tabs and the two input
    // fields; the first dark/coloured block is the row of social-login buttons.
    // The username/password fields are the last two grey blocks above that row.
    int cx = (start + PanelR) / 2, minRun = Math.Max(8, (int)(H * 0.025));
    var mids = new System.Collections.Generic.List<int>();
    var ends = new System.Collections.Generic.List<int>();
    var lens = new System.Collections.Generic.List<int>();
    int runStart = -1;
    for (int y = (int)(H * 0.05); y < (int)(H * 0.85); y++) {
      Color c = Px(cx, y);
      bool g = FieldGrey(c);
      if (g && runStart < 0) runStart = y;
      if (!g && runStart >= 0) {
        if (y - runStart >= minRun) { mids.Add((runStart + y) / 2); ends.Add(y); lens.Add(y - runStart); }
        runStart = -1;
      }
      if (!g && !PanelWhite(c) && !Grey(c, 200, 255) && mids.Count >= 2) break;   // social buttons reached
    }
    int found = mids.Count;
    if (found >= 1) TabY = mids[0];
    Info += " greyBlocks=" + found;
    if (found < 2) return false;
    // the two input fields have about the same height and sit close together
    int h1 = lens[found - 2], h2 = lens[found - 1], gap = mids[found - 1] - mids[found - 2];
    if (h1 * 4 < h2 * 3 || h2 * 4 < h1 * 3 || gap > 2 * Math.Max(h1, h2)) { Info += " (fields don't match: " + h1 + "/" + h2 + " gap " + gap + ")"; return false; }
    UserX = cx; UserY = mids[found - 2]; PassX = cx; PassY = mids[found - 1];
    int passEnd = ends[found - 1];

    // left edge of the fields, measured near the field's bottom (no label text there)
    int ly = passEnd - 3, left = cx;
    while (left > start && FieldGrey(Px(left - 1, ly))) left--;
    // below the password field: 1st non-white block = social buttons, 2nd = the checkbox
    int bx = left + Math.Max(4, (int)(W * 0.005)), blocks = 0; runStart = -1;
    for (int y = passEnd + 3; y < (int)(H * 0.9); y++) {
      bool solid = !PanelWhite(Px(bx, y));
      if (solid && runStart < 0) runStart = y;
      if (!solid && runStart >= 0) {
        int len = y - runStart;
        if (len >= 6) { blocks++; if (blocks == 2) { BoxX = bx; BoxY = (runStart + y) / 2; break; } }
        runStart = -1;
      }
    }
    Info += " fieldsAt=" + UserY + "/" + PassY + " left=" + left + " box=" + (blocks == 2 ? BoxX + "," + BoxY : "none");
    return blocks == 2;
  }

  // an unticked box is light grey; ticked looks clearly different
  public static bool BoxTicked() {
    if (!Capture()) return false;
    Color c = Px(BoxX, BoxY);
    Info += " boxColor=" + c.R + "," + c.G + "," + c.B;
    return !Grey(c, 205, 255);
  }

  public static bool Blur() {
    if (!Capture()) return false;
    int y0 = (int)(H * 0.6), x = Math.Max(2, (int)(W * 0.01));
    while (x < W / 2 && !PanelWhite(Px(x, y0))) x++;
    int start = x; while (x < W / 2 && PanelWhite(Px(x, y0))) x++;
    if (x - start < W * 0.1) return false;
    int bx = (start + x) / 2, by = (int)(H * 0.66);
    for (int dy = -6; dy <= 6; dy += 3) if (!PanelWhite(Px(bx, by + dy))) return false;   // only on plain background
    return Click(bx, by);
  }
  // the "Sign-in" half of the sign-in / QR-code switch
  public static bool ClickSignInTab() {
    if (TabY <= 0) return false;
    return Click(PanelL + (int)((PanelR - PanelL) * 0.32), TabY);
  }
  public static void SaveShot(string file) { if (shot != null) shot.Save(file); }
  public static void SaveBoxCrop(string file) {
    if (shot == null) return;
    var r = new Rectangle(Math.Max(0, BoxX - 25), Math.Max(0, BoxY - 25), Math.Min(220, W - Math.Max(0, BoxX - 25)), Math.Min(50, H - Math.Max(0, BoxY - 25)));
    using (var crop = shot.Clone(r, shot.PixelFormat)) crop.Save(file);
  }

  // left click at a window pixel (cursor is put back afterwards)
  public static bool Click(int px, int py) {
    if (!InFront()) return false;
    RECT r; if (!GetWindowRect(Target, out r)) return false;
    POINT old; GetCursorPos(out old);
    // only click if the Riot Client itself is at that spot (not an always-on-top overlay)
    POINT at; at.X = r.L + px; at.Y = r.T + py;
    if (GetAncestor(WindowFromPoint(at), 2) != Target) return false;
    SetCursorPos(at.X, at.Y);
    Thread.Sleep(60);
    Send(new[] { M(LDOWN), M(LUP) });
    Thread.Sleep(150);
    SetCursorPos(old.X, old.Y);
    return InFront();
  }
}
'@

$target = if ($env:RS_AUTOFILL_TARGET) { $env:RS_AUTOFILL_TARGET } else { 'Riot Client' }   # override only for testing
$procs = Get-Process -Name $target -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
# after a restart: only a Riot Client started since then (never an older window left over)
if ($cred.since) {
  $since = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$cred.since).LocalDateTime.AddSeconds(-5)
  $procs = $procs | Where-Object { try { $_.StartTime -ge $since } catch { $false } }
}
$proc = $procs | Select-Object -First 1
if (-not $proc) { 'nowindow'; exit }
[RiotType]::Target = $proc.MainWindowHandle
[RiotType]::DpiAware()

$dbg = Join-Path $env:TEMP 'rift-switch-debug'
New-Item -ItemType Directory -Force $dbg | Out-Null
$stamp = Get-Date -Format 'HHmmss'
function Write-Dbg([string]$line) { Add-Content -Path (Join-Path $dbg 'autofill.log') -Value ("$stamp " + $line) -Encoding ascii }

# Ticks "Stay signed in" through Windows UI Automation (no mouse, no focus change needed).
# Idea and approach from lost-league-manager, Copyright (c) 2026 Lostgames, ISC licence.
function Set-StaySignedInUia {
  try {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
    $AE = [System.Windows.Automation.AutomationElement]
    $root = $AE::FromHandle([RiotType]::Target)
    $isBox = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::CheckBox)
    $boxes = $null
    for ($i = 0; $i -lt 8; $i++) {
      $boxes = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $isBox)
      if ($boxes.Count -gt 0) { break }
      Start-Sleep -Milliseconds 500
    }
    if (-not $boxes -or $boxes.Count -eq 0) { return 'checkbox not found' }
    $box = $null
    foreach ($b in $boxes) { if ($b.Current.Name -match 'stay signed in|signed in|angemeldet') { $box = $b; break } }
    if (-not $box -and $boxes.Count -eq 1) { $box = $boxes[0] }
    if (-not $box) { return "checkbox ambiguous ($($boxes.Count))" }
    $p = $null
    if ($box.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) {
      if ($p.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On) { return 'already ticked' }
      $p.Toggle()
      Start-Sleep -Milliseconds 200
      if ($p.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On) { return 'ticked' }
      return 'toggle had no effect'
    }
    if ($box.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $p.Invoke(); return 'ticked' }
    return 'checkbox not clickable'
  } catch { return 'uia error: ' + $_.Exception.Message }
}

# The two input fields as the client reports them: the password field is flagged as one,
# the username field is the input right above it. Returns $true and sets the click points.
function Find-FieldsUia {
  try {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
    $AE = [System.Windows.Automation.AutomationElement]
    if (-not [RiotType]::ReadRect()) { return $false }
    $root = $AE::FromHandle([RiotType]::Target)
    $isEdit = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
    $edits = @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $isEdit) |
      Where-Object { -not $_.Current.IsOffscreen -and $_.Current.BoundingRectangle.Width -gt 40 })
    $pass = @($edits | Where-Object { $_.Current.IsPassword })
    if ($pass.Count -ne 1) { return $false }
    $pr = $pass[0].Current.BoundingRectangle
    $user = $edits | Where-Object { -not $_.Current.IsPassword -and $_.Current.BoundingRectangle.Bottom -le $pr.Top + 2 -and
        [math]::Abs($_.Current.BoundingRectangle.Left - $pr.Left) -lt 40 } |
      Sort-Object { $_.Current.BoundingRectangle.Bottom } | Select-Object -Last 1
    if (-not $user) { return $false }
    $ur = $user.Current.BoundingRectangle
    [RiotType]::UserX = [int]($ur.Left + $ur.Width / 2) - [RiotType]::WinL; [RiotType]::UserY = [int]($ur.Top + $ur.Height / 2) - [RiotType]::WinT
    [RiotType]::PassX = [int]($pr.Left + $pr.Width / 2) - [RiotType]::WinL; [RiotType]::PassY = [int]($pr.Top + $pr.Height / 2) - [RiotType]::WinT
    # both points must lie inside the window
    foreach ($v in @([RiotType]::UserX, [RiotType]::PassX)) { if ($v -lt 0 -or $v -gt [RiotType]::WinW) { return $false } }
    foreach ($v in @([RiotType]::UserY, [RiotType]::PassY)) { if ($v -lt 0 -or $v -gt [RiotType]::WinH) { return $false } }
    return $true
  } catch { return $false }
}

# test only: report what is recognised, touch nothing
if ($env:RS_AUTOFILL_IMAGE) { [RiotType]::TestImage = $env:RS_AUTOFILL_IMAGE }
if ($env:RS_AUTOFILL_PROBE) {
  $u = if ($env:RS_AUTOFILL_IMAGE) { $false } else { Find-FieldsUia }
  $f = [RiotType]::FindForm(); $t = if ($f) { [RiotType]::BoxTicked() } else { $false }
  [RiotType]::SaveShot((Join-Path $dbg "$stamp-probe.png"))
  'uia=' + $u + ' form=' + $f + ' ticked=' + $t + ' ' + [RiotType]::Info; exit
}

if (-not [RiotType]::Focus()) { 'nofocus'; exit }
Start-Sleep -Milliseconds 400

# the login page may still be loading: look for up to ~6 s.
# Before each look: click an empty spot so no field is focused (focused fields turn white).
# If only the sign-in/QR switch is visible (QR view open), switch back to "Sign-in".
$form = $false; $tabTried = $false; $via = ''
for ($i = 0; $i -lt 12 -and -not $form; $i++) {
  if (Find-FieldsUia) { $form = $true; $via = 'uia'; break }
  [RiotType]::Blur() | Out-Null
  Start-Sleep -Milliseconds 120
  $form = [RiotType]::FindForm()
  if ($form) { $via = 'picture' }
  if (-not $form) {
    if (-not $tabTried -and [RiotType]::TabY -gt 0 -and $i -ge 1) {
      Write-Dbg ('switching to Sign-in tab: ' + [RiotType]::Info)
      [RiotType]::ClickSignInTab() | Out-Null; $tabTried = $true
    }
    Start-Sleep -Milliseconds 450
  }
}

if ($form) {
  Write-Dbg ('form found via ' + $via + ': ' + [RiotType]::Info)
  # click into each field instead of trusting where the cursor is
  if (-not [RiotType]::Click([RiotType]::UserX, [RiotType]::UserY)) { 'lostfocus'; exit }
  [RiotType]::Ctrl(0x41)
  if (-not [RiotType]::Type([string]$cred.u)) { 'lostfocus'; exit }
  if (-not [RiotType]::Click([RiotType]::PassX, [RiotType]::PassY)) { 'lostfocus'; exit }
  [RiotType]::Ctrl(0x41)
  if (-not [RiotType]::Type([string]$cred.p)) { 'lostfocus'; exit }
  # "Stay signed in": without it the Riot Client forgets the login and switching can't restore it.
  # 1st try: UI Automation (approach from lost-league-manager by Lostgames, ISC licence) -
  # Chromium only builds its accessibility tree after the first query, so retry a few seconds.
  $uia = Set-StaySignedInUia
  Write-Dbg ('uia: ' + $uia)
  $ticked = ($uia -eq 'ticked' -or $uia -eq 'already ticked')
  if (-not $ticked -and $via -eq 'uia') {
    [RiotType]::Blur() | Out-Null; Start-Sleep -Milliseconds 120
    if (-not [RiotType]::FindForm()) { Write-Dbg 'no picture of the checkbox' }
  }
  if (-not $ticked -and [RiotType]::BoxX -gt 0) { $ticked = [RiotType]::BoxTicked() }
  [RiotType]::SaveBoxCrop((Join-Path $dbg "$stamp-1-before.png"))
  # 2nd try: click the box found in the picture
  if (-not $ticked -and [RiotType]::BoxX -gt 0) {
    if (-not [RiotType]::Click([RiotType]::BoxX, [RiotType]::BoxY)) { 'lostfocus'; exit }
    Start-Sleep -Milliseconds 400
    $ticked = [RiotType]::BoxTicked()
    [RiotType]::SaveBoxCrop((Join-Path $dbg "$stamp-2-after.png"))
  }
  Write-Dbg ('ticked=' + $ticked + ' ' + [RiotType]::Info)
  # back into the password field and submit
  if (-not [RiotType]::Click([RiotType]::PassX, [RiotType]::PassY)) { 'lostfocus'; exit }
  if (-not [RiotType]::InFront()) { 'lostfocus'; exit }
  [RiotType]::Key(0x0D)
  if ($ticked) { 'ok' } else { 'ok-nopersist' }
  exit
}

# form not recognised: type nothing (the password could land in a chat or search field)
Write-Dbg ('form NOT found: ' + [RiotType]::Info)
[RiotType]::SaveShot((Join-Path $dbg "$stamp-notfound.png"))
'noform'
