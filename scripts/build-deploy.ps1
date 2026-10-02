# 一键发布：清理 ESA 旧版本 -> 重建 Jekyll 站点 -> 提交源码与 _site 产物 -> 推送 origin main
# 推送后阿里云 ESA 会自动构建并部署到 www.citongshuo.online
# 用法：.\scripts\build-deploy.ps1 [-Message "提交说明"]

param(
    [string]$Message = "chore: 更新站点内容并重建 _site"
)

# 切换到仓库根目录（脚本位于 scripts/ 下）
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

# ESA 免费模式每个函数仅保留 5 个代码版本，每次 main 构建都会新增一个，
# 满额后新构建会静默失败（推送成功但线上不更新）。发布前先清掉无用的旧版本。
Write-Host "[1/5] 预检 ESA 代码版本配额..." -ForegroundColor Cyan
if (-not (Get-Command aliyun -ErrorAction SilentlyContinue)) {
    Write-Host "  未检测到 aliyun CLI，已跳过清理；若配额已满，ESA 将不会构建。" -ForegroundColor Yellow
} else {
    try {
        $routineName = (Get-Content (Join-Path $repoRoot "esa.jsonc") -Raw | ConvertFrom-Json).name
        $routine = (aliyun esa GetRoutine --Name $routineName | Out-String) | ConvertFrom-Json
        $allVersions = ((aliyun esa ListRoutineCodeVersions --Name $routineName | Out-String) | ConvertFrom-Json).CodeVersions

        # 保留：生产/预发环境正在使用的版本，以及最新 2 个版本（便于回滚）
        $keep = New-Object System.Collections.Generic.HashSet[string]
        foreach ($env in $routine.Envs) {
            if ($env.CodeVersion) { [void]$keep.Add([string]$env.CodeVersion) }
        }
        $allVersions | Sort-Object -Property CreateTime -Descending | Select-Object -First 2 | ForEach-Object { [void]$keep.Add([string]$_.CodeVersion) }

        $obsolete = $allVersions | Where-Object { -not $keep.Contains([string]$_.CodeVersion) }
        foreach ($v in $obsolete) {
            aliyun esa DeleteRoutineCodeVersion --Name $routineName --CodeVersion $v.CodeVersion | Out-Null
            Write-Host "  已清理旧版本 $($v.CodeVersion)" -ForegroundColor DarkGray
        }
        Write-Host "  共 $($allVersions.Count) 个版本，保留 $($keep.Count) 个。" -ForegroundColor DarkGray
    } catch {
        Write-Host "  配额清理出错（不阻断发布）：$_" -ForegroundColor Yellow
    }
}

Write-Host "[2/5] 构建 Jekyll 站点..." -ForegroundColor Cyan
bundle exec jekyll build
if ($LASTEXITCODE -ne 0) {
    Write-Host "构建失败，已中止。" -ForegroundColor Red
    exit 1
}

Write-Host "[3/5] 暂存源码改动与 _site 产物..." -ForegroundColor Cyan
git add -A
git add -f _site

if (-not (git diff --cached --name-only)) {
    Write-Host "没有需要提交的改动，已中止。" -ForegroundColor Yellow
    exit 0
}

Write-Host "[4/5] 提交..." -ForegroundColor Cyan
git commit -m $Message
if ($LASTEXITCODE -ne 0) {
    Write-Host "提交失败，已中止。" -ForegroundColor Red
    exit 1
}

Write-Host "[5/5] 推送到 origin main..." -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "推送失败，提交已保留在本地，可执行 git push origin main 重试。" -ForegroundColor Red
    exit 1
}

Write-Host "发布完成，ESA 将自动构建并部署到 www.citongshuo.online。" -ForegroundColor Green