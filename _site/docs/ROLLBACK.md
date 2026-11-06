# 回滚手册（docs/ROLLBACK.md）

本站的上线链路是：`main`（源码） → `scripts/build-deploy.ps1` → `deploy` 分支（仅产物） → ESA 从 `deploy` 构建 → `production` 环境。
回滚时**不要让源码和产物两条线各回一半**：先判断坏的是"内容/模板"还是"ESA 侧"，再选下面的路径。

## 1. 触发条件

满足任意一条即可回滚，不要等"看一会儿再说"：

- 生产首页或文章页出现 5xx / 白屏 / 样式或脚本全丢（例如 `_site` 关键文件缺失、Pagefind 目录为空）。
- 搜索结果为空或点击结果 404（Pagefind 索引与页面不同步）。
- 移动端布局明显错乱并被确认是本次发布引入。
- PWA / Service Worker 缓存了坏版本，导致用户反复看到旧页面且无法自更新。
- ESA 侧推送成功但线上内容未变，或 `eni`/路由配置被误改。

以下情况**不回滚**，走修复提交：单篇文章错别字、单条链接失效、非核心页面的排版小问题。

## 2. 定位上一版

### 2.1 定位 deploy 分支的上一版（产物维度）

`deploy` 分支只有 `_site` 产物与 `esa.jsonc`，每个提交对应一次发布：

```powershell
git log --oneline -10 origin/deploy
```

记录：当前坏提交 `<BAD_SHA>`、它的上一个提交 `<PREV_SHA>`。

### 2.2 定位 ESA 的上一版（线上维度）

ESA 以"代码版本（CodeVersion）"为准，`deploy` 提交号与它不一一对应，必须实测：

```powershell
# 当前生产/预发版本
aliyun esa GetRoutine --Name citongshuo

# 全部保留的代码版本（按时间倒序看 CreateTime）
aliyun esa ListRoutineCodeVersions --Name citongshuo
```

在 `Envs` 数组里找 `Env=production` 的 `CodeVersion`，即为当前生产版本 `<BAD_VERSION>`；
列表里比它早一个、且未被删除的版本即回滚目标 `<PREV_VERSION>`。

> 注意：`build-deploy.ps1` 每次发布前会清理旧版本，保留策略是"生产/预发正在使用的版本 + 最新 2 个"，
> ESA 免费版总共只留 5 个。因此**回滚窗口通常只有上一版可达**，更早的版本已被删除，
> 只能走第 3.2 节的 Git 回滚重新构建。

## 3. 执行回滚

### 3.1 首选：ESA 版本回退（最快，不动 Git）

把 `production` 100% 指回上一版，属于灰度发布接口的 100/0 用法：

```powershell
aliyun esa CreateRoutineCodeDeployment `
  --Name citongshuo `
  --Env production `
  --Strategy percentage `
  --CodeVersions '[{"CodeVersion":"<PREV_VERSION>","Percentage":100}]'
```

执行后立刻复核（见第 4 节）。此操作不产生新代码版本，不占用 5 个版本的配额。

### 3.2 备选：`deploy` 分支回退（ESA 会重新构建出一个新版本）

用于"上一版已被清理"或"要连 `esa.jsonc` 一起回退"的情况。

`deploy` 有独立 worktree（`build-deploy.ps1` 固定使用仓库同级目录）：

```powershell
cd D:\codebuddy\citongshuo-deploy-wt
git fetch origin deploy
git log --oneline -5
git revert --no-edit <BAD_SHA>   # 反向提交，保留历史
git push origin deploy
```

规则：

- **只 revert，不 `reset --hard`、不 `force push`**（`deploy` 被 force push 后 ESA 的历史版本会对不上）。
- 不要手工改 `_site` 里的文件再提交，产物与源码会漂移；要改源码请走第 3.3 节。
- 推送后 ESA 会自动构建并生成新的 CodeVersion，用第 4 节确认真的切换了。

### 3.3 源码侧回退（内容/模板问题）

```powershell
git switch main
git pull --ff-only
git revert --no-edit <BAD_SHA>
git push origin main
```

随后按正常流程重新发布（**这一步会推送 `deploy`，需专人确认**）：

```powershell
.\scripts\build-deploy.ps1 -Message "revert: 回滚 <BAD_SHA>"
```

> 回滚期间**不要**执行 `build-deploy.ps1` 的第 1 步版本清理之外的手工删版本操作；
> 脚本只会删"既不是环境在用、也不在最新 2 个"的版本，刚回退到的 `<PREV_VERSION>` 因为被 production 使用而不会被删。

## 4. ESA 侧验证

```powershell
# 1) 生产环境版本号必须已经变成目标值
(aliyun esa GetRoutine --Name citongshuo | ConvertFrom-Json).Envs |
  Where-Object Env -eq 'production' | Select-Object Env, CodeVersion

# 2) 版本确实存在（不是被清理的空号）
aliyun esa GetRoutineCodeVersion --Name citongshuo --CodeVersion <TARGET_VERSION>
```

判定标准：

- `Env=production` 的 `CodeVersion` 等于 `<PREV_VERSION>`（3.1）或新生成的版本号（3.2），**不能仍是 `<BAD_VERSION>`**。
- `CanaryCodeVersion` 同步为同一版本（脚本的灰度策略是单版本 100%）。
- 若 10 分钟内版本号无变化：ESA 构建失败（配额满 / `deploy` 未绑定到 production / `esa.jsonc` 有误），
  用 `aliyun esa GetRoutine --Name citongshuo` 看 `CodeDeploy` 的创建时间是否更新。

## 5. 回滚后必查项

全部通过才算回滚完成：

| 检查项 | 命令 / 判定 |
| --- | --- |
| 首页 | `curl.exe -I https://www.citongshuo.online/` → 200 |
| 任意文章页 | 打开一篇最近文章，标题/正文/样式正常 |
| 404 | `curl.exe -I https://www.citongshuo.online/not-exist-page/` → 404（`notFoundStrategy=404Page`） |
| 搜索 | 打开搜索、输入关键词、点第一条结果能跳转（`/pagefind/` 下 `pagefind.js`、`pagefind-ui.js`、`pagefind-entry.json` 均 200） |
| 静态资源 | `/css/hux-blog.min.css`、`/js/citongshuo.js`、`/img/...` 均 200，无 404 洪峰 |
| PWA | `sw.js` 可访问；强制刷新一次后不再命中坏缓存 |
| 关键配置 | `esa.jsonc` 仍为 `{"name":"citongshuo","assets":{"directory":"./_site","notFoundStrategy":"404Page"}}` |
| 源码与产物一致 | `main` 的 `HEAD` 与 `deploy` 内容对应（3.2 回退时尤其要核对） |

## 6. 禁止事项

- 回滚不需要、也不允许执行 `build-deploy.ps1` 的完整发布流程，除非走 3.3 节的源码回滚。
- 不对 `main` / `deploy` 做 `force push`、`reset --hard`、`squash`。
- 不手工 `aliyun esa DeleteRoutineCodeVersion` 删除生产正在使用的版本。
- 不把 `_site` 提交进 `main`。
