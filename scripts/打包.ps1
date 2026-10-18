# Build a desktop runtime folder with production dependencies and release documentation.
# Usage: .\scripts\打包.ps1 [-Open] [-IncludeModels] [-Target <path>]
[CmdletBinding()]
param([switch]$IncludeModels, [switch]$Open, [string]$Target)

$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $PSScriptRoot
$programRoot = Join-Path $source '程序'
$version = (Get-Content -Raw -LiteralPath (Join-Path $programRoot 'version.json') -Encoding UTF8 | ConvertFrom-Json).version
if (-not $Target) {
  $stamp = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'China Standard Time').ToString('yyyy-MM-dd-HHmmss')
  $Target = Join-Path ([Environment]::GetFolderPath('Desktop')) "工具箱-V$version-桌面版-$stamp"
}
$fullSource = [IO.Path]::GetFullPath($source).TrimEnd('\')
$fullTarget = [IO.Path]::GetFullPath($Target).TrimEnd('\')
if ($fullTarget -eq $fullSource -or $fullTarget.StartsWith($fullSource + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Target must be outside the source project.' }
if (Test-Path -LiteralPath $fullTarget) { Write-Host 'Target exists; nothing was written.'; exit 2 }
$pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
$personalRoots = @(
  (Join-Path $env:LOCALAPPDATA '工具箱'),
  (Join-Path $env:APPDATA '工具箱'),
  (Join-Path $programRoot '工具箱数据'),
  (Join-Path $programRoot 'tag模块\data')
)
$positionFile = Join-Path $env:LOCALAPPDATA '工具箱\位置.json'
if (Test-Path -LiteralPath $positionFile) {
  $position = Get-Content -LiteralPath $positionFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($position.数据目录) { $personalRoots += [IO.Path]::GetFullPath($position.数据目录) }
}
$excludedNames = @('node_modules', 'test', 'tools', '试', '旧设计', '.git', '临时')
$extensions = @('.js', '.mjs', '.cjs', '.json', '.jsonl', '.yaml', '.yml', '.html', '.css', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.txt', '.wasm')
function Copy-Program([string]$Directory) {
  foreach ($item in Get-ChildItem -LiteralPath $Directory -Force) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Source contains a link: $($item.FullName)" }
    if ($item.PSIsContainer) {
      if ($excludedNames -contains $item.Name -or $personalRoots -contains $item.FullName) { continue }
      Copy-Program $item.FullName
    } elseif ($extensions -contains $item.Extension -and $item.Name -notlike 'tbx-probe-*') {
      $relative = $item.FullName.Substring($programRoot.Length).TrimStart('\')
      $destination = Join-Path (Join-Path $fullTarget '程序') $relative
      New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
      Copy-Item -LiteralPath $item.FullName -Destination $destination
    }
  }
}
New-Item -ItemType Directory -Path $fullTarget | Out-Null
Copy-Program $programRoot
Copy-Item -LiteralPath (Join-Path $source '启动.cmd') -Destination $fullTarget
$releaseDocs = Join-Path $source '文档\桌面版'
Copy-Item -LiteralPath (Join-Path $releaseDocs 'README.md') -Destination $fullTarget
New-Item -ItemType Directory -Path (Join-Path $fullTarget '文档') | Out-Null
Get-ChildItem -LiteralPath $releaseDocs -File -Filter '*.md' | Where-Object Name -ne 'README.md' | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $fullTarget '文档')
}
$modelSource = Join-Path $source '模型'
$modelTarget = Join-Path $fullTarget '模型'
New-Item -ItemType Directory -Path (Join-Path $modelTarget '识图'), (Join-Path $modelTarget '翻译') -Force | Out-Null
if ($IncludeModels) {
  & robocopy $modelSource $modelTarget /E /XJ /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /XD .git .cache /XF '*.log' '.env*' | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Model copy failed ($LASTEXITCODE)." }
} else {
  Get-ChildItem -LiteralPath $modelSource -File -Filter '*.md' -Recurse | ForEach-Object {
    $relative = $_.FullName.Substring($modelSource.Length).TrimStart('\')
    $destination = Join-Path $modelTarget $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $destination
  }
}
$runtime = Join-Path $fullTarget '程序\对接层'
& $pnpm --dir $runtime install --prod --offline --frozen-lockfile --config.node-linker=hoisted
if ($LASTEXITCODE -ne 0) { throw "Production dependency installation failed ($LASTEXITCODE)." }
$dependencyRoot = Join-Path $runtime 'node_modules'
foreach ($metadata in @('.modules.yaml', '.pnpm-workspace-state-v1.json')) {
  $file = [IO.Path]::GetFullPath((Join-Path $dependencyRoot $metadata))
  if (-not $file.StartsWith($fullTarget + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Metadata path is outside the new package.' }
  if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
}
$links = @(Get-ChildItem -LiteralPath $dependencyRoot -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
if ($links.Count) { throw 'The desktop package contains dependency links.' }
foreach ($bin in @(Get-ChildItem -LiteralPath $dependencyRoot -Recurse -Directory -Force -Filter '.bin')) {
  $binPath = [IO.Path]::GetFullPath($bin.FullName)
  if (-not $binPath.StartsWith($dependencyRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Command wrappers are outside the new package dependencies.' }
  Remove-Item -LiteralPath $binPath -Recurse -Force
}
$files = @(Get-ChildItem -LiteralPath $fullTarget -Recurse -Force -File)
Write-Host ("Packed V{0}: {1} ({2} files; models={3})" -f $version, $fullTarget, $files.Count, [bool]$IncludeModels)
if ($Open) { Start-Process explorer.exe -ArgumentList "`"$fullTarget`"" }
exit 0
