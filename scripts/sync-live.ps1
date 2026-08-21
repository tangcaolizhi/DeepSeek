# 一键同步桌宠插件源码到部署位置（Windows）
# 用法：powershell -ExecutionPolicy Bypass -File scripts\sync-live.ps1
#
# 说明：活动 Harness 的插件路径必须为纯 ASCII（非 ASCII 字符会在
# Windows junction/模块解析时损坏，导致启动失败）。本脚本把工作区
# 源码复制到 ASCII 暂存路径（C:\Users\<you>\dsh-pet-deepseek-girl），
# 再复制到活动 profile 的 node_modules。编辑源码后运行一次，重启
# 桌面 App 即可生效。
$ErrorActionPreference = "Stop"

$src = "C:\my deepseek horness\deepseek娘\dsh-pet-deepseek-girl"
$stage = Join-Path $env:USERPROFILE "dsh-pet-deepseek-girl"
$live = Join-Path $env:APPDATA "dsh-desktop\harness\profiles\web\node_modules\dsh-pet-deepseek-girl"

if (-not (Test-Path $src)) { throw "找不到源码目录: $src" }

Write-Host "同步: 工作区 -> ASCII 暂存 -> 活动 profile"
Remove-Item -Recurse -Force $stage, $live -ErrorAction SilentlyContinue
Copy-Item -Recurse -Force $src $stage
Copy-Item -Recurse -Force $stage $live
Write-Host "完成。请重启 DSH Desktop 使改动生效。"
