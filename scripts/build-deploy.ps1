# 一键发布（源码 / 产物分离）：
#   main   分支：仅源码，与上游仓库一致，便于提 PR，不再提交 _site
#   deploy 分支：仅 _site 产物 + esa.jsonc，ESA 从此分支构建并部署到 www.citongshuo.online
# 用法：.\scripts\build-deploy.ps1 [-Message "提交说明"] [-NoPush]

param(
    [string]$Message = "chore: 更新站点内容并重建产物",
    [switch]$NoPush
)

# 切换到仓库根目录（脚本位于 scripts/ 下）
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Fail([string]$Message) {
    Write-Host $Message -ForegroundColor Red
    exit 1
}

# 预检：发布只允许在干净的 main 工作区执行，避免把无关文件/审计目录带入提交
Write-Host "[预检] 检查当前分支与工作区..." -ForegroundColor Cyan
$currentBranch = (& git rev-parse --abbrev-ref HEAD 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $currentBranch -ne "main") {
    Fail "当前分支为 '$currentBranch'，发布必须在 main 分支执行。"
}
$dirty = @(& git status --porcelain)
if ($dirty.Count -gt 0) {
    Write-Host "  工作区存在未提交改动：" -ForegroundColor Yellow
    $dirty | ForEach-Object { Write-Host "    $_" }
    Fail "请先提交或清理工作区后再发布。"
}
Write-Host "  分支 main，工作区干净。" -ForegroundColor DarkGray

# deploy 分支的独立工作区放在仓库同级目录，避免污染主工作区
$deployWt = Join-Path (Split-Path -Parent $repoRoot) "citongshuo-deploy-wt"
$deployBranch = "deploy"

# ESA 项目名（即 esa.jsonc 的 name），配额预检和发布确认都要用
$routineName = $null
# 推送前生产环境的版本号，用于判断本次是否真的部署成功
$prodVersionBefore = $null
try {
    $routineName = (Get-Content (Join-Path $repoRoot "esa.jsonc") -Raw | ConvertFrom-Json).name
} catch { }

# ESA 免费模式每个函数仅保留 5 个代码版本，每次 deploy 构建都会新增一个，
# 满额后新构建会静默失败（推送成功但线上不更新）。发布前先清掉无用的旧版本。
# 保留策略：生产/预发正在使用的版本 + 最新 2 个，最多 4 个，新增本次构建后仍不超过 5 个。
# 不要改成“+3”：两个环境 + 3 个历史版本 + 本次构建 = 6，会超配额。
Write-Host "[1/6] 预检 ESA 代码版本配额..." -ForegroundColor Cyan
if ($NoPush) {
    Write-Host "  -NoPush：跳过 ESA 配额预检与上线确认。" -ForegroundColor Yellow
} elseif (-not $routineName) {
    Fail "未能从 esa.jsonc 读取项目名，无法执行配额预检。"
} elseif (-not (Get-Command aliyun -ErrorAction SilentlyContinue)) {
    Fail "未检测到 aliyun CLI；发布前必须安装并配置，否则无法清理版本/确认上线。"
} else {
    try {
        $routine = (aliyun esa GetRoutine --Name $routineName | Out-String) | ConvertFrom-Json
        $prodVersionBefore = ($routine.Envs | Where-Object { $_.Env -eq 'production' }).CodeVersion
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
        Fail "ESA 配额预检/清理失败，已中止：$_"
    }
}

Write-Host "[2/6] 构建 Jekyll 站点..." -ForegroundColor Cyan
# jekyll-minifier 仅在 JEKYLL_ENV=production 时执行压缩，此处显式声明生产环境
$env:JEKYLL_ENV = "production"
bundle exec jekyll build
if ($LASTEXITCODE -ne 0) {
    Fail "构建失败，已中止。"
}

# 产物断言：审计/工具配置不得进入站点，核心文件必须存在
foreach ($forbidden in @("_site/2026-11-03", "_site/esa.jsonc")) {
    if (Test-Path $forbidden) {
        Fail "构建产物包含禁止路径：$forbidden（请检查 _config.yml 的 exclude）"
    }
}
if (-not (Test-Path "_site/index.html")) {
    Fail "构建产物缺少 index.html。"
}
if (-not (Test-Path "_site/sitemap.xml")) {
    Fail "构建产物缺少 sitemap.xml。"
}
Write-Host "  产物检查通过：无审计目录/esa.jsonc，核心文件存在。" -ForegroundColor DarkGray

# 生成 Pagefind 全文搜索索引（产物落在 _site/pagefind）。
# 生产 UI 的查询侧不会按中文词边界切分「估值」「赛道」这类词，实测原生索引在
# 真实站点 UI 中召回明显下降（估值 1 条、赛道 0 条）；因此保留零宽空格对齐，
# 但脚本会跳过 <head>/<title>/<pre>/<code>/标题元数据，避免污染搜索结果标题。
# 使用 package.json 固定的本地版本，避免 npx 拉到新版本导致索引格式漂移。
Write-Host "  生成 Pagefind 全文索引..." -ForegroundColor DarkGray
$pagefindSrc = ".jekyll-cache/pagefind-src"
Remove-Item "_site/pagefind" -Recurse -Force -ErrorAction SilentlyContinue
node scripts/segment-cjk-for-pagefind.mjs "_site" $pagefindSrc
if ($LASTEXITCODE -ne 0) {
    Fail "中文分词对齐失败，已中止（不能退回未分词索引，否则多字中文查询会退化）。"
}
npx --no-install pagefind --site $pagefindSrc --output-path "_site/pagefind"
if ($LASTEXITCODE -ne 0) {
    Fail "Pagefind 索引生成失败，已中止（请检查 package.json 固定版本与 node_modules）。"
}
$entryPath = "_site/pagefind/pagefind-entry.json"
if (-not (Test-Path $entryPath)) {
    Fail "Pagefind 未生成 pagefind-entry.json。"
}
$entry = (Get-Content $entryPath -Raw | ConvertFrom-Json)
$expectedPagefind = (Get-Content "package.json" -Raw | ConvertFrom-Json).devDependencies.pagefind
if ($entry.version -ne $expectedPagefind) {
    Fail "Pagefind 实际版本 $($entry.version) 与 package.json 固定的 $expectedPagefind 不一致。"
}
$postCount = (Get-ChildItem "_posts" -File | Measure-Object).Count
$indexedPages = ($entry.languages.PSObject.Properties | ForEach-Object { $_.Value.page_count } | Measure-Object -Sum).Sum
if ($indexedPages -ne $postCount) {
    Fail "Pagefind 索引页数 $indexedPages 与文章数 $postCount 不一致。"
}
Write-Host "  Pagefind $($entry.version) 已索引 $indexedPages 页。" -ForegroundColor DarkGray

Write-Host "[3/6] 提交并推送源码到 main（不含产物）..." -ForegroundColor Cyan
# 只暂存明确的源码/内容路径，避免 git add -A 把审计、临时文件或凭据带进提交。
git add -u
$sourcePaths = @(
    "_posts", "_layouts", "_includes", "_data", "_plugins", "img", "js", "css", "pwa", "scripts", ".github",
    "2026-11-03/code-audit/outputs", "package.json", "package-lock.json",
    "_config.yml", "Gemfile", "Gemfile.lock", "mise.toml", "sw.js", "search.json", "robots.txt", "ads.txt",
    "index.html", "about.html", "archive.html", "tags.html", "404.html", "offline.html", "esa.jsonc"
)
foreach ($path in $sourcePaths) {
    if (Test-Path -LiteralPath $path) {
        git add -- $path
    }
}
if (-not (git diff --cached --name-only)) {
    Write-Host "  main 没有源码改动。" -ForegroundColor DarkGray
} else {
    git commit -m $Message
    if ($LASTEXITCODE -ne 0) {
        Fail "提交失败，已中止。"
    }
    if ($NoPush) {
        Write-Host "  已提交（-NoPush，跳过推送）。" -ForegroundColor Yellow
    } else {
        # 推送前确认远端 main 没有新提交，避免把本地旧基线强推上去
        git fetch origin main 2>$null
        if ($LASTEXITCODE -ne 0) {
            Fail "无法获取 origin/main，已中止（请检查网络/凭据）。"
        }
        $behind = [int]((& git rev-list --count HEAD..origin/main | Out-String).Trim())
        if ($behind -gt 0) {
            Fail "本地 main 落后 origin/main $behind 个提交，请先同步后再发布。"
        }
        git push origin main
        if ($LASTEXITCODE -ne 0) {
            Write-Host "main 推送失败，提交已保留在本地，可执行 git push origin main 重试。" -ForegroundColor Red
            exit 1
        }
    }
}

Write-Host "[4/6] 准备 deploy 分支工作区..." -ForegroundColor Cyan
if (Test-Path (Join-Path $deployWt ".git")) {
    Write-Host "  已存在：$deployWt" -ForegroundColor DarkGray
} else {
    git fetch origin $deployBranch 2>$null
    git show-ref --verify --quiet "refs/heads/$deployBranch" 2>$null
    $hasLocal = ($LASTEXITCODE -eq 0)
    git show-ref --verify --quiet "refs/remotes/origin/$deployBranch" 2>$null
    $hasRemote = ($LASTEXITCODE -eq 0)
    if ($hasLocal) {
        git worktree add $deployWt $deployBranch
    } elseif ($hasRemote) {
        git worktree add -b $deployBranch $deployWt "origin/$deployBranch"
    } else {
        # 首次：创建无历史空分支，只放产物
        git worktree add --detach $deployWt
        Push-Location $deployWt
        git checkout --orphan $deployBranch
        git rm -rf . 2>$null | Out-Null
        Pop-Location
    }
    if (-not (Test-Path (Join-Path $deployWt ".git"))) {
        Write-Host "  deploy 工作区创建失败，已中止。" -ForegroundColor Red
        exit 1
    }
}

Write-Host "[5/6] 同步产物到 deploy 分支并推送..." -ForegroundColor Cyan
# 清空工作区（保留 .git），再放入本次构建产物
Get-ChildItem -Force $deployWt | Where-Object { $_.Name -ne ".git" } | Remove-Item -Recurse -Force
Copy-Item (Join-Path $repoRoot "_site") -Destination (Join-Path $deployWt "_site") -Recurse -Force
Copy-Item (Join-Path $repoRoot "esa.jsonc") -Destination (Join-Path $deployWt "esa.jsonc") -Force

Push-Location $deployWt
git add -A
if (-not (git diff --cached --name-only)) {
    Write-Host "  产物无变化，跳过。" -ForegroundColor DarkGray
    $deployPushed = $false
} else {
    git commit -m "$Message（产物）"
    if ($NoPush) {
        Write-Host "  已提交产物（-NoPush，跳过推送）。" -ForegroundColor Yellow
        $deployPushed = $false
    } else {
        git push origin $deployBranch
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  deploy 推送失败，提交已保留在本地工作区。" -ForegroundColor Red
            Pop-Location
            exit 1
        }
        $deployPushed = $true
    }
}
Pop-Location

# 推送成功不等于上线成功：ESA 的构建发生在推送之后，失败时不会有任何提示，
# 表现就是「推了代码但线上没变」。这里轮询生产版本号，确认真的切换了。
Write-Host "[6/6] 确认 ESA 已部署到生产..." -ForegroundColor Cyan
if ($NoPush -or -not $deployPushed) {
    Write-Host "  本次未推送 deploy，跳过上线确认。" -ForegroundColor Yellow
} elseif (-not $routineName -or -not $prodVersionBefore) {
    Fail "缺少项目名或推送前的生产版本号，无法自动确认上线。"
} else {
    $deadline = (Get-Date).AddSeconds(600)
    $prodVersionNow = $null
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 15
        try {
            $prodEnv = ((aliyun esa GetRoutine --Name $routineName | Out-String) | ConvertFrom-Json).Envs | Where-Object { $_.Env -eq 'production' }
            if ($prodEnv.CodeVersion -and $prodEnv.CodeVersion -ne $prodVersionBefore) {
                $prodVersionNow = $prodEnv.CodeVersion
                break
            }
        } catch { }
    }
    if ($prodVersionNow) {
        Write-Host "  已上线，生产版本 $prodVersionNow（上一版 $prodVersionBefore）" -ForegroundColor Green
    } else {
        Write-Host "  等待 600 秒仍未出现新版本，ESA 构建可能失败了。" -ForegroundColor Red
        Write-Host "  常见原因：ESA 生产分支尚未改绑到 deploy、代码版本配额已满、esa.jsonc 配置有误。" -ForegroundColor Yellow
        Write-Host "  可执行 aliyun esa GetRoutine --Name $routineName 排查。" -ForegroundColor Yellow
        exit 1
    }
}