# Windows console acceptance for the root launcher.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $root '启动.cmd'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$tempName = [string][char]0x4E34 + [char]0x65F6
$tempRoot = Join-Path $root $tempName
$fixture = Join-Path $tempRoot ('console-acceptance-' + [guid]::NewGuid().ToString('N'))
$dataDir = Join-Path $fixture '数据'
$logDir = Join-Path $fixture '日志'
$transcript = Join-Path $logDir '验收.log'
$port = Get-Random -Minimum 30000 -Maximum 45000
$consoleTitle = 'Toolbox acceptance ' + [guid]::NewGuid().ToString('N')
$run = $null
$duplicate = $null
$blocker = $null
$blockedRun = $null
$servicePid = 0
$secondServicePid = 0
$blockerPid = 0
$passed = 0

Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class ConsoleAcceptanceNative {
  public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint ctrlEvent, uint processGroupId);
  public static IntPtr FindTitle(string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((hwnd, ignored) => {
      var text = new StringBuilder(512);
      GetWindowText(hwnd, text, text.Capacity);
      if (String.Equals(text.ToString(), title, StringComparison.Ordinal)) { found = hwnd; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@

function Check([bool]$condition, [string]$name) {
  if (-not $condition) { throw "FAIL: $name" }
  $script:passed++
  Write-Host "PASS: $name"
}

function Wait-Until([scriptblock]$condition, [int]$seconds = 30) {
  $until = [DateTime]::UtcNow.AddSeconds($seconds)
  while ([DateTime]::UtcNow -lt $until) {
    if (& $condition) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

function Get-ListeningOwner([int]$targetPort) {
  $row = Get-NetTCPConnection -LocalPort $targetPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($row) { return [int]$row.OwningProcess }
  return 0
}

function Test-ProcessDescendant([int]$candidatePid, [int]$ancestorPid) {
  $rows = Get-CimInstance Win32_Process
  $parents = @{}
  foreach ($row in $rows) { $parents[[int]$row.ProcessId] = [int]$row.ParentProcessId }
  $current = $candidatePid
  for ($depth = 0; $depth -lt 32 -and $parents.ContainsKey($current); $depth++) {
    $current = $parents[$current]
    if ($current -eq $ancestorPid) { return $true }
  }
  return $false
}

function Get-ChildNodePids([int]$ancestorPid) {
  $children = @()
  foreach ($row in (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' })) {
    if (Test-ProcessDescendant ([int]$row.ProcessId) $ancestorPid) { $children += [int]$row.ProcessId }
  }
  return $children
}

function Get-ConsoleWindow([string]$title) {
  return [ConsoleAcceptanceNative]::FindTitle($title)
}

function Start-Launcher([int]$targetPort, [string]$title, [string]$targetDataDir) {
  $arguments = @('/d', '/c', "title $title`&call `"$launcher`" --端口 $targetPort --数据目录 `"$targetDataDir`"")
  return Start-Process -FilePath 'cmd.exe' -ArgumentList $arguments -PassThru -WindowStyle Normal
}

function Close-Console([string]$title) {
  $window = Get-ConsoleWindow $title
  if ($window -eq [IntPtr]::Zero -or -not [ConsoleAcceptanceNative]::IsWindow($window)) {
    throw "无法找到独立 console 窗口 '$title'；未发送关闭请求，因此不把服务退出判作通过。"
  }
  if (-not [ConsoleAcceptanceNative]::PostMessage($window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) {
    throw "无法向 console 窗口 '$title' 发送 WM_CLOSE；未把服务退出判作通过。"
  }
}

function Stop-Console([string]$title, [int]$targetPort, [int]$launcherPid, [int]$expectedNodePid) {
  Close-Console $title
  $nodeExited = Wait-Until { (Get-Process -Id $expectedNodePid -ErrorAction SilentlyContinue) -eq $null } 20
  $portReleased = Wait-Until { (Get-ListeningOwner $targetPort) -eq 0 } 10
  $launcherExited = Wait-Until { (Get-Process -Id $launcherPid -ErrorAction SilentlyContinue) -eq $null } 10
  return @{ NodeExited = $nodeExited; PortReleased = $portReleased; LauncherExited = $launcherExited }
}

try {
  if (-not (Test-Path -LiteralPath $launcher)) { throw "入口不存在：$launcher" }
  New-Item -ItemType Directory -Path $dataDir,$logDir -Force | Out-Null
  Start-Transcript -LiteralPath $transcript -Force | Out-Null

  $run = Start-Launcher $port $consoleTitle $dataDir
  $ready = Wait-Until {
    $owner = Get-ListeningOwner $port
    if ($owner -gt 0) {
      try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -TimeoutSec 2 -UseBasicParsing
        if ([int]$response.StatusCode -eq 200 -and $response.Content -match '<html|<!doctype') {
          $script:servicePid = $owner
          return $true
        }
      } catch { }
    }
    return $false
  }
  Check $ready 'root launcher starts a real listening Node service and serves the page over HTTP'
  Check ((Get-Process -Id $servicePid -ErrorAction SilentlyContinue).ProcessName -eq 'node' -and (Test-ProcessDescendant $servicePid $run.Id)) 'TCP listener is a Node process in the launcher console process tree'
  Check ((Get-ConsoleWindow $consoleTitle) -ne [IntPtr]::Zero) 'launcher owns a separately addressable console window'
  Check (Test-Path -LiteralPath $dataDir) 'service receives the isolated fixture data directory'

  $duplicateTitle = $consoleTitle + ' duplicate'
  $duplicate = Start-Launcher $port $duplicateTitle $dataDir
  $duplicateConsole = Wait-Until { (Get-ConsoleWindow $duplicateTitle) -ne [IntPtr]::Zero } 10
  Check $duplicateConsole 'repeated startup gets its own console for the port conflict'
  Start-Sleep -Seconds 2
  $duplicateStopped = Wait-Until { @(Get-ChildNodePids $duplicate.Id).Count -eq 0 } 30
  Check $duplicateStopped 'repeated startup does not keep a second Node service process alive'
  Check ((Get-ListeningOwner $port) -eq $servicePid) 'port conflict leaves the original service as the sole listener'
  Check ((Get-Process -Id $servicePid -ErrorAction SilentlyContinue) -ne $null) 'port conflict does not stop the original Node service'
  Close-Console $duplicateTitle
  $duplicateClosed = Wait-Until { (Get-Process -Id $duplicate.Id -ErrorAction SilentlyContinue) -eq $null } 10
  Check $duplicateClosed 'closing the failed duplicate console closes its paused command window'

  $closed = Stop-Console $consoleTitle $port $run.Id $servicePid
  Check $closed.NodeExited 'closing the actual console window exits its Node service process'
  Check $closed.PortReleased 'closing the console releases the service port'
  Check $closed.LauncherExited 'launcher command process exits with the console lifecycle'

  $secondTitle = $consoleTitle + ' second run'
  $secondDataDir = Join-Path $fixture '第二轮数据'
  New-Item -ItemType Directory -Path $secondDataDir -Force | Out-Null
  $secondRun = Start-Launcher $port $secondTitle $secondDataDir
  $secondReady = Wait-Until {
    $owner = Get-ListeningOwner $port
    if ($owner -gt 0 -and (Test-ProcessDescendant $owner $secondRun.Id)) {
      try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -TimeoutSec 2 -UseBasicParsing
        if ([int]$response.StatusCode -eq 200 -and $response.Content -match '<html|<!doctype') { $script:secondServicePid = $owner; return $true }
      } catch { }
    }
    return $false
  } 30
  Check $secondReady 'a fresh console starts the service again after the first console released the port'
  $secondClosed = Stop-Console $secondTitle $port $secondRun.Id $secondServicePid
  Check $secondClosed.NodeExited 'closing the second console exits its Node service process'
  Check $secondClosed.PortReleased 'closing the second console releases the port again'
  Check $secondClosed.LauncherExited 'second launcher command exits with its console'

  $blockPort = Get-Random -Minimum 45001 -Maximum 59000
  $blocker = Start-Process -FilePath $node -ArgumentList @('-e', "require('http').createServer((q,s)=>s.end('occupied')).listen($blockPort,'127.0.0.1')") -PassThru -WindowStyle Hidden
  $blockerPid = $blocker.Id
  $blockerReady = Wait-Until { (Get-ListeningOwner $blockPort) -eq $blocker.Id } 10
  Check $blockerReady 'port conflict fixture owns its selected TCP port'
  $blockedTitle = $consoleTitle + ' blocked'
  $blockedRun = Start-Launcher $blockPort $blockedTitle (Join-Path $fixture '冲突数据')
  $blockedConsole = Wait-Until { (Get-ConsoleWindow $blockedTitle) -ne [IntPtr]::Zero } 10
  Check $blockedConsole 'external port conflict leaves its own console open for the error and pause'
  Start-Sleep -Seconds 2
  $blockedStopped = Wait-Until { @(Get-ChildNodePids $blockedRun.Id).Count -eq 0 } 30
  Check $blockedStopped 'external port conflict does not keep a child Node service alive'
  Check ((Get-ListeningOwner $blockPort) -eq $blocker.Id) 'port conflict preserves the unrelated fixture listener'
  Close-Console $blockedTitle
  $blockedClosed = Wait-Until { (Get-Process -Id $blockedRun.Id -ErrorAction SilentlyContinue) -eq $null } 10
  Check $blockedClosed 'closing the failed port-conflict console exits its paused command window'
  Check ((Get-Process -Id $secondServicePid -ErrorAction SilentlyContinue) -eq $null) 'the accepted service remains stopped after all launcher checks'
  Write-Host "Completed $passed Windows console acceptance checks. Temporary fixture: $fixture"
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  if ($servicePid) { Write-Host "DIAG: servicePid=$servicePid port=$port console='$consoleTitle' dataDir='$dataDir'" }
  exit 1
} finally {
  foreach ($process in @($blockedRun, $duplicate, $secondRun, $run)) {
    if ($process -and (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
      try { & taskkill.exe /PID $process.Id /T /F *> $null } catch { }
    }
  }
  foreach ($pidToStop in @($servicePid, $secondServicePid, $blockerPid)) {
    if ($pidToStop -and (Get-Process -Id $pidToStop -ErrorAction SilentlyContinue)) {
      try { & taskkill.exe /PID $pidToStop /T /F *> $null } catch { }
    }
  }
  if ($blocker -and (Get-Process -Id $blocker.Id -ErrorAction SilentlyContinue)) {
    Stop-Process -Id $blocker.Id -Force -ErrorAction SilentlyContinue
  }
  try { Stop-Transcript | Out-Null } catch { }
}
