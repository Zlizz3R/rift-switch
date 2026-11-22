# Closes the Riot Client's "Game Unavailable – cannot be played with your PBE account" dialog
# (it appears when live League is started for a PBE account). Through Windows UI Automation:
# the dialog is the element "riot-modal"; only a dialog that mentions PBE is touched, and only
# its first button (the X / Close) – never "Switch Accounts".
# Prints: closed | none | nowindow | error
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  $p = Get-Process -Name 'Riot Client' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $p) { 'nowindow'; exit }
  $AE = [System.Windows.Automation.AutomationElement]
  $TS = [System.Windows.Automation.TreeScope]
  $root = $AE::FromHandle($p.MainWindowHandle)
  $byId = New-Object System.Windows.Automation.PropertyCondition($AE::AutomationIdProperty, 'riot-modal')
  $isButton = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
  # Chromium builds its accessibility tree on the first query: look a few times
  for ($i = 0; $i -lt 6; $i++) {
    foreach ($m in $root.FindAll($TS::Descendants, $byId)) {
      $texts = ($m.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name }) -join ' '
      if ($texts -notmatch 'PBE') { continue }
      $btn = $m.FindFirst($TS::Descendants, $isButton)
      $pat = $null
      if ($btn -and $btn.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pat)) { $pat.Invoke(); 'closed'; exit }
    }
    Start-Sleep -Milliseconds 400
  }
  'none'
} catch { 'error' }
