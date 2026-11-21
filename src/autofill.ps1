# Types a Riot login into the Riot Client window and ticks "Stay signed in".
# Reads {"u": "...", "p": "..."} from stdin (never from the command line, so other
# programs can't read it from the process list).
# Prints one word: ok | ok-nopersist | nowindow | nofocus | lostfocus | badinput
#
# The login form is found by its colours (light panel, grey input fields) at fixed
# relative positions of the Riot Client window (measured on client v143, 1552x872):
#   username field 0.193/0.300, password 0.193/0.374, "Stay signed in" box 0.0464/0.4977.
# If the form isn't recognised, it falls back to plain typing (username field has focus).
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

  // ---- reading the window: picture of it, colour at a relative position ----
  static Bitmap shot;
  public static bool Capture() {
    RECT r; if (!GetWindowRect(Target, out r)) return false;
    int w = r.R - r.L, h = r.B - r.T; if (w < 200 || h < 200) return false;
    if (shot != null) shot.Dispose();
    shot = new Bitmap(w, h);
    using (var g = Graphics.FromImage(shot)) { IntPtr dc = g.GetHdc(); PrintWindow(Target, dc, 2); g.ReleaseHdc(dc); }
    return true;
  }
  // debug: a small picture of the "Stay signed in" area (box + label, nothing else)
  public static void SaveBoxCrop(string file) {
    if (shot == null) return;
    int cx = (int)(0.0464 * shot.Width), cy = (int)(0.4977 * shot.Height);
    var r = new Rectangle(Math.Max(0, cx - 30), Math.Max(0, cy - 25), Math.Min(220, shot.Width - Math.Max(0, cx - 30)), 50);
    using (var crop = shot.Clone(r, shot.PixelFormat)) crop.Save(file);
  }
  public static Color At(double fx, double fy) { return shot.GetPixel((int)(fx * shot.Width), (int)(fy * shot.Height)); }
  static bool Grey(Color c, int lo, int hi) {
    int mx = Math.Max(c.R, Math.Max(c.G, c.B)), mn = Math.Min(c.R, Math.Min(c.G, c.B));
    return mn >= lo && mx <= hi && mx - mn <= 12;
  }
  // light login panel + grey username and password fields where we expect them
  public static bool LoginFormVisible() {
    if (!Capture()) return false;
    return Grey(At(0.019, 0.688), 240, 255) && Grey(At(0.193, 0.300), 220, 250) && Grey(At(0.193, 0.374), 220, 250);
  }
  // an unticked box is light grey; ticked looks clearly different
  public static bool BoxTicked() {
    if (!Capture()) return false;
    return !Grey(At(0.0464, 0.4977), 205, 255);
  }

  // left click at a relative window position (cursor is put back afterwards)
  public static bool Click(double fx, double fy) {
    if (!InFront()) return false;
    RECT r; if (!GetWindowRect(Target, out r)) return false;
    POINT old; GetCursorPos(out old);
    SetCursorPos(r.L + (int)(fx * (r.R - r.L)), r.T + (int)(fy * (r.B - r.T)));
    Thread.Sleep(60);
    Send(new[] { M(LDOWN), M(LUP) });
    Thread.Sleep(150);
    SetCursorPos(old.X, old.Y);
    return InFront();
  }
}
'@

$target = if ($env:RS_AUTOFILL_TARGET) { $env:RS_AUTOFILL_TARGET } else { 'Riot Client' }   # override only for testing
$proc = Get-Process -Name $target -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { 'nowindow'; exit }
[RiotType]::Target = $proc.MainWindowHandle

# test only: report what is recognised, touch nothing
if ($env:RS_AUTOFILL_PROBE) { 'form=' + [RiotType]::LoginFormVisible() + ' ticked=' + [RiotType]::BoxTicked(); exit }

if (-not [RiotType]::Focus()) { 'nofocus'; exit }
Start-Sleep -Milliseconds 400

$form = $false
for ($i = 0; $i -lt 6 -and -not $form; $i++) { $form = [RiotType]::LoginFormVisible(); if (-not $form) { Start-Sleep -Milliseconds 500 } }

if ($form) {
  # click into each field instead of trusting where the cursor is
  if (-not [RiotType]::Click(0.193, 0.300)) { 'lostfocus'; exit }
  [RiotType]::Ctrl(0x41)
  if (-not [RiotType]::Type([string]$cred.u)) { 'lostfocus'; exit }
  if (-not [RiotType]::Click(0.193, 0.374)) { 'lostfocus'; exit }
  [RiotType]::Ctrl(0x41)
  if (-not [RiotType]::Type([string]$cred.p)) { 'lostfocus'; exit }
  # "Stay signed in": without it the Riot Client forgets the login and switching can't restore it
  $dbg = Join-Path $env:TEMP 'rift-switch-debug'
  New-Item -ItemType Directory -Force $dbg | Out-Null
  $stamp = Get-Date -Format 'HHmmss'
  $ticked = [RiotType]::BoxTicked()
  [RiotType]::SaveBoxCrop((Join-Path $dbg "$stamp-1-before.png"))
  if (-not $ticked) {
    if (-not [RiotType]::Click(0.0464, 0.4977)) { 'lostfocus'; exit }
    Start-Sleep -Milliseconds 400
    $ticked = [RiotType]::BoxTicked()
    [RiotType]::SaveBoxCrop((Join-Path $dbg "$stamp-2-after.png"))
  }
  # back into the password field and submit
  if (-not [RiotType]::Click(0.193, 0.374)) { 'lostfocus'; exit }
  if (-not [RiotType]::InFront()) { 'lostfocus'; exit }
  [RiotType]::Key(0x0D)
  if ($ticked) { 'ok' } else { 'ok-nopersist' }
  exit
}

# fallback: form not recognised (other client version / layout) - plain typing as before
[RiotType]::Ctrl(0x41)
if (-not [RiotType]::Type([string]$cred.u)) { 'lostfocus'; exit }
if (-not [RiotType]::InFront()) { 'lostfocus'; exit }
[RiotType]::Key(0x09)
Start-Sleep -Milliseconds 120
[RiotType]::Ctrl(0x41)
if (-not [RiotType]::Type([string]$cred.p)) { 'lostfocus'; exit }
if (-not [RiotType]::InFront()) { 'lostfocus'; exit }
[RiotType]::Key(0x0D)
'ok-nopersist'
