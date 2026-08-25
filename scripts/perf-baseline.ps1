#Requires -Version 5.1
<#
.SYNOPSIS
  Windows 性能基线:冷启动时间与内存占用(qraft.exe)。

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/perf-baseline.ps1 -ExePath "src-tauri\target\release\qraft.exe"

.NOTES
  冷启动 = 进程 Start 到 MainWindowHandle 非零(含 WebView2 初始化的主进程侧等待)。
  内存 = qraft.exe WorkingSet;WebView2 渲染子进程(msedgewebview2)按启动时间归因,
  单独列出作参考值。macOS / Linux 口径见 docs/release-checklist.md 手动步骤。
  测量结果请回填 docs/performance-baseline.md。
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$ExePath,
  [int]$Samples = 10,
  [int]$IntervalMs = 300
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $ExePath)) {
  throw "找不到目标可执行文件: $ExePath"
}

# 预检:single-instance 插件会让第二个实例静默退出,污染测量数据
$exeName = [System.IO.Path]::GetFileNameWithoutExtension($ExePath)
$existing = @(Get-Process -Name $exeName -ErrorAction SilentlyContinue)
if ($existing.Count -gt 0) {
  throw ("检测到已在运行的 {0} 实例(PID: {1}),请先退出后再测量" -f
    $exeName, (($existing | ForEach-Object { $_.Id }) -join ', '))
}

Write-Host '== 冷启动 =='
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$proc = Start-Process -FilePath $ExePath -PassThru
try {
  $ready = $false
  while ($sw.ElapsedMilliseconds -lt 15000) {
    $proc.Refresh()
    if ($proc.HasExited) { throw "进程提前退出(code=$($proc.ExitCode))" }
    if ($proc.MainWindowHandle -ne [IntPtr]::Zero) { $ready = $true; break }
    Start-Sleep -Milliseconds 20
  }
  if (-not $ready) {
    Write-Warning '15s 内未检测到主窗口句柄,本次冷启动数据无效'
  }
  else {
    Write-Host ('冷启动(到主窗口): {0} ms' -f $sw.ElapsedMilliseconds)
  }

  Write-Host ('== 内存({0} 次采样 / {1}ms)==' -f $Samples, $IntervalMs)
  $peak = [uint64]0
  for ($i = 1; $i -le $Samples; $i++) {
    Start-Sleep -Milliseconds $IntervalMs
    $proc.Refresh()
    if ($proc.HasExited) { throw "进程在内存采样期间退出(code=$($proc.ExitCode))" }
    if ($null -ne $proc.WorkingSet64 -and $proc.WorkingSet64 -gt $peak) { $peak = $proc.WorkingSet64 }
    Write-Host ('  #{0}: {1:N1} MB' -f $i, ($proc.WorkingSet64 / 1MB))
  }
  Write-Host ('主进程峰值 WorkingSet: {0:N1} MB' -f ($peak / 1MB))

  # WebView2 子进程按「晚于主进程启动」归因(参考值,不作为达标口径)
  $startAt = $proc.StartTime
  Start-Sleep -Milliseconds 500
  $children = @(Get-Process -Name 'msedgewebview2' -ErrorAction SilentlyContinue |
    Where-Object { $_.StartTime -ge $startAt })
  $childSum = ($children | Measure-Object -Property WorkingSet64 -Sum).Sum
  if ($null -eq $childSum) { $childSum = [uint64]0 }
  Write-Host ('WebView2 子进程(参考值): {0} 个,合计 {1:N1} MB' -f $children.Count, ($childSum / 1MB))
}
finally {
  if (-not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  }
}
