# 一键发布：重建 Jekyll 站点 -> 提交源码与 _site 产物 -> 推送 origin main
# 推送后阿里云 ESA 会自动构建并部署到 www.citongshuo.online
# 用法：.\scripts\build-deploy.ps1 [-Message "提交说明"]

param(
    [string]$Message = "chore: 更新站点内容并重建 _site"
)

# 切换到仓库根目录（脚本位于 scripts/ 下）
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host "[1/4] 构建 Jekyll 站点..." -ForegroundColor Cyan
bundle exec jekyll build
if ($LASTEXITCODE -ne 0) {
    Write-Host "构建失败，已中止。" -ForegroundColor Red
    exit 1
}

Write-Host "[2/4] 暂存源码改动与 _site 产物..." -ForegroundColor Cyan
git add -A
git add -f _site

if (-not (git diff --cached --name-only)) {
    Write-Host "没有需要提交的改动，已中止。" -ForegroundColor Yellow
    exit 0
}

Write-Host "[3/4] 提交..." -ForegroundColor Cyan
git commit -m $Message
if ($LASTEXITCODE -ne 0) {
    Write-Host "提交失败，已中止。" -ForegroundColor Red
    exit 1
}

Write-Host "[4/4] 推送到 origin main..." -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "推送失败，提交已保留在本地，可执行 git push origin main 重试。" -ForegroundColor Red
    exit 1
}

Write-Host "发布完成，ESA 将自动构建并部署到 www.citongshuo.online。" -ForegroundColor Green