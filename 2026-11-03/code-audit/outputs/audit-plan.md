# 刺桐说站点技术评估与优化方案

- 评估日期：2026-11-03
- 评估范围：`d:\codebuddy\citongshuo.github.io`（Jekyll + Chirpy/Hux 定制 + Pagefind + ESA Pages）
- 评估方式：只读阅读源码；在仓库外临时目录执行构建、Pagefind 索引与浏览器搜索对照；未修改仓库内任何代码、配置或内容文件，未 commit。
- 当前工作区状态：仅新增未跟踪目录 `2026-11-03/`（本方案所在目录），无 tracked 文件改动。

## 0. 结论

**整体健康度：中上。** 站点可用、内容组织清晰，现有定制（callout、置顶、分享图、暗色模式、Pagefind、SW）都已在线上运行，不属于“半成品”。真正的短板在工程化：发布依赖一台机器上的未入库脚本、构建不可复现、产物目录会把审计文档一起发布；前端则有明确的性能与 SEO 低风险高收益项。

**问题总量：20 条。** P0 2 条，P1 9 条，P2 9 条。

> 实施修正（2026-11-03）：P1-1 原“删除零宽空格预处理”的判断被真实站点 UI 实测推翻，最终实现改为“保留正文分词对齐 + 跳过标题/代码 + 渲染后清理 ZWSP”，详见文末“实施修正记录”。

**最该先动的 3 件事：**

1. **先止血**：把 `2026-11-03/`（审计文档与 `work/` 中间产物）排除出 Jekyll 构建与自动提交范围；同时给发布脚本加“干净工作区 + 当前分支 + 目标目录”预检。否则下一次发布会把这份含内部风险清单的文档公开到站点上。
2. **让构建可复现**：锁定 Ruby/Node/Pagefind 版本，补 `Gemfile.lock` 的 Linux 平台，建立 CI 构建门禁；Pagefind 中文分词对齐需保留（真实站点 UI 下原生索引“估值”1/“赛道”0），但脚本要跳过 head/title/code 并在 UI 渲染后移除 ZWSP，实测修正后 5/4 且结果无 ZWSP。
3. **再提性能与发布可信度**：关闭逐页 Terser（Jekyll 构建生成阶段 42.9–62.2s → 5.4s，墙钟 47–78s → 10.5s），把 Pagefind UI 改为点击搜索时加载，处理首屏大图与全站缺失的 `h1`；发布脚本对 Pagefind 失败由“静默继续”改为硬失败。

### 0.1 实测基线（本次评估的实际数据）

| 指标 | 实测值 | 说明 |
|---|---|---|
| Jekyll 生产构建（含 jekyll-minifier） | 生成 42.9s / 62.2s（两次），总耗时 47.2s / 78.1s | `JEKYLL_ENV=production`，构建到仓库外临时目录；受系统负载影响 |
| Jekyll 开发构建（不压缩） | 生成 4.2s / 9.7s（两次），总耗时 9.1s / 22.5s | 同上，`JEKYLL_ENV=development` |
| 生产构建但关闭 JS 压缩 | 生成 5.4s / 总耗时 10.5s | 仅关 `compress_javascript`，HTML/CSS/JSON 仍压缩 |
| 构建产物 | 6.3 MB / 126 个文件 | 临时目录；现有 `_site` 为 6.9 MB / 149 个（较旧） |
| HTML 总量 | 390 KB（压缩后）/ 468 KB（未压缩） | Brotli 单页差异约 0.9 KB |
| 本地 CSS / JS | 160 KB / 131 KB | 不含 Font Awesome 与 Pagefind |
| Pagefind UI | `pagefind-ui.js` 120 KB + `pagefind-ui.css` 14 KB | 当前每个页面都会加载 |
| Pagefind 目录 | 644 KB / 13 个文件；索引 38 KB，10 页 | 含未使用的 component/modular UI 资产 |
| 首页头图 | 289 KB，1920×1280 | 无 srcset/preload |
| 正文大图 | 286–421 KB；封面 3500×2333 | 无 WebP/AVIF、无响应式变体 |
| 首页/归档/标签/关于/404 的 `h1` 数 | 0 | 仅文章页有 `h1` |
| 原生 Pagefind 1.5.2 搜索 | Playground 5/4；真实站点 UI 1/0 | 未做零宽空格预处理 |
| 原生 Pagefind 1.6.0 搜索 | Playground 5/4；真实站点 UI 1/0 | 同上 |
| 旧零宽空格版 1.6.0 | 真实站点 UI 5/4 | 索引词数 2562，原生 1.6.0 为 7106；标题含 ZWSP |
| 修正后零宽空格版（实施） | 真实站点 UI 5/4，结果无 ZWSP | 跳过 head/title/code/h1-meta，并在 UI 渲染后清理 |
| 版本（实施前） | Pagefind 1.5.2（线上索引）/ npx 1.6.0；jQuery 2.1.3；Bootstrap 3.3.2；Ruby 3.4.9（mise 声明 3.3.8） | 见各问题证据 |
| 时间戳 | 文章 front matter `09:00:00`，feed 输出 `17:00:00+08:00` | 差 8 小时 |

---

## 1. 问题清单

### P0（会出错 / 会漏发布 / 有安全或数据风险）

#### P0-1 审计目录与中间产物会被构建发布，并被 `git add -A` 自动提交

- **问题**：`2026-11-03/` 位于仓库根目录，且不在 `_config.yml` 的 `exclude` 中。Jekyll 会把根目录下非下划线开头的目录当作静态文件复制到 `_site`；`scripts/build-deploy.ps1` 又用 `git add -A` 提交全部未跟踪文件。
- **证据**：
  - `_config.yml:34-43` 的 exclude 仅包含 `node_modules`、`README.md`、`LICENSE`、`mise.toml`、`历史文章.zip`、`scripts`，没有 `2026-11-03`。
  - 在仓库外临时目录执行生产构建后，`_site/2026-11-03/code-audit/work/build-probe.txt` 存在且内容为探针字符串（`Test-Path` 返回 True）；写入本方案后再次构建，`_site/2026-11-03/code-audit/outputs/audit-plan.md`（49KB）同样被复制进产物（探针文件已删除，结论不变）。
  - `scripts/build-deploy.ps1:89` 为 `git add -A`；`:138-140` 把 `_site` 整体复制到 deploy 工作区。
  - 当前 `git status --short` 输出 `?? 2026-11-03/`。
- **影响**：下一次发布会把本方案（含内部风险、已知弱点、改进优先级）以及未来放入 `work/` 的任何中间产物发布到 `https://www.citongshuo.online/2026-11-03/...`，可被直接访问、抓取或转发；同时会被提交进 main，之后即使删除也会留在 Git 历史与 ESA 历史版本中。这是当前最确定、最容易触发的一条。
- **同类做法与来源**：[Jekyll 配置文档](https://jekyllrb.com/docs/configuration/options/) 的 `exclude` 用于阻止源码/工具目录进入站点；通用实践是“源码仓与构建产物分离，发布脚本只 add 明确路径”。未找到专门针对“审计文档”的权威来源，本条基于 Jekyll 构建行为与通用发布实践。
- **建议改动**：
  1. `_config.yml` 的 `exclude` 增加 `"2026-11-03"`（或统一改成 `"code-audit"` 并保持目录名稳定）；若未来还有同类目录，使用前缀约定。
  2. 若该文档不需要进入 Git，追加到 `.gitignore`；若需要评审留档，则保留跟踪但在构建时排除，二者取其一，不要两者都不做。
  3. `scripts/build-deploy.ps1` 把 `git add -A` 改为显式路径（如 `_posts`、`_layouts`、`_includes`、`_data`、`_plugins`、`img`、`js`、`css`、`pwa`、根级页面与配置），或先 `git status --porcelain` 检查，发现非白名单文件时中止。
  4. 构建后增加断言：`if (Test-Path "_site/2026-11-03") { exit 1 }`。
- **风险与验证**：风险极低；改动只影响构建范围。验证：临时构建后 `Test-Path _site/2026-11-03` 为 False；`git check-ignore` 符合预期；部署后访问 `/2026-11-03/code-audit/outputs/audit-plan.md` 返回 404。
- **工作量**：0.5 人时。

#### P0-2 发布链路是单机、未入库脚本，且没有构建门禁

- **问题**：`scripts/build-deploy.ps1` 被 `.gitignore` 忽略，main 分支没有任何 GitHub Actions workflow；Pagefind 生成失败只打印黄色警告并继续发布；`npx --yes pagefind` 每次拉取最新版；`aliyun` CLI 缺失时静默跳过配额与上线确认。发布是否成功依赖操作者本机的工具链与手工观察。
- **证据**：
  - `.gitignore:21-22` 明确忽略 `scripts/build-deploy.ps1`；`git ls-files scripts` 只有 `segment-cjk-for-pagefind.mjs` 与 `wechat-draft.mjs`。
  - `git ls-tree -r origin/main` 无 `.github/`；`origin/master`、`origin/feature/...` 上残留旧 workflow，但 main 没有。
  - `scripts/build-deploy.ps1:72-85`：Pagefind 失败只 `Write-Host` 警告，不 `exit 1`；`:78` 用 `npx --yes pagefind`。
  - `scripts/build-deploy.ps1:29-34`、`:167-170`：`aliyun` 不存在时跳过配额清理与上线确认。
  - `scripts/build-deploy.ps1:89-107`：没有当前分支、工作区干净度、远端同步状态的前置检查。
- **影响**：换机器或新维护者无法复现发布；Pagefind 索引缺失时站点仍会“发布成功”，搜索静默降级；Pagefind 大版本漂移可能改变分词/索引格式；上线确认可能因 CLI 缺失而永远不执行。属于“会漏发布/漏验证”的链路风险。
- **同类做法与来源**：
  - Jekyll 官方 CI 文档建议用 GitHub Actions 在 Linux 上构建并上传 artifact，可绕开本机环境差异：[Jekyll CI](https://jekyllrb.com/docs/continuous-integration/github-actions/)。
  - ESA 官方提供 `esa-cli deployments list` 查看部署状态，比自定义轮询更直接：[ESA CLI](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/functions-and-pages-cli-tool)。
  - Pagefind 官方安装文档明确 `npx pagefind` 总会下载 extended 版本，并支持用 `pagefind@v1.1.1` 固定版本：[Pagefind Installation](https://pagefind.app/docs/installation/)。
- **建议改动**：
  1. 清洗后把 `build-deploy.ps1` 纳入仓库（去掉本机绝对路径/凭据，工作区路径改为参数或环境变量），让发布逻辑可评审、可回滚。
  2. 新增 `.github/workflows/build.yml`：`ubuntu-latest` + `ruby/setup-ruby@v1`（3.3.8，`bundler-cache: true`）+ `actions/setup-node@v4`（22）+ `npm ci` + `JEKYLL_ENV=production bundle exec jekyll build` + `npx --no-install pagefind ...`，并断言 `_site/pagefind/pagefind-entry.json` 存在、`page_count` 为文章数。CI 先做“构建门禁”，部署可继续本地或后续接 `esa-cli`。
  3. Pagefind 失败默认 `exit 1`；如确需容忍，显式加 `-AllowMissingSearch` 开关，并在输出中标记“搜索已降级”。
  4. 把 `aliyun`/`esa-cli` 作为部署硬前置：缺失时直接失败并提示安装，而不是继续。
  5. 前置检查：当前分支必须是 `main`；`git status --porcelain` 只允许白名单；`git fetch` 后本地不落后远端。
- **风险与验证**：CI 首次会暴露 `Gemfile.lock` 平台与 Ruby 版本问题（见 P1-9），属于预期收益。验证：Linux CI 绿；连续 3 次本地/CI 发布均能自动确认版本变化；把 Pagefind 二进制临时改名后脚本以非 0 退出；新机器按 README/脚本可完整发布。
- **工作量**：1–2 人日（含 CI 与脚本清洗）。

---

### P1（明显影响体验、性能或维护成本）

#### P1-1 Pagefind 中文分词：预处理必要，但旧实现污染搜索标题（实施时已修正原判断）

- **问题**：旧构建脚本先用 Node `Intl.Segmenter` 对 HTML 文本插入 U+200B，再建索引；原审计基于 Pagefind Playground 测试，误判为该预处理多余。实施阶段用**真实站点 UI** 复测发现：原生 Pagefind 1.5.2/1.6.0 索引下“估值”仅 1 条、“赛道”0 条；旧 ZWSP 索引下为 5/4。也就是说，预处理是生产 UI 召回所必需的；真正的问题是旧脚本把 ZWSP 写进了 `<title>`、`h1` 标题元数据和代码块。
- **证据**：
  - 原脚本 `scripts/segment-cjk-for-pagefind.mjs` 对所有文本节点（含 `<title>`、未排除 `<pre>/<code>`）插入 ZWSP；旧版分段源码中文章 h1 有 4 个 ZWSP、`<title>` 有 11 个。
  - 真实站点 UI（非 Playground）复测：原生 1.5.2 → 估值 1 / 赛道 0；原生 1.6.0 → 1 / 0；旧 ZWSP 索引 → 5 / 4。
  - Playground 对同一索引返回 5/4，说明 Playground 的搜索行为不能代表生产 `PagefindUI`；原审计 P1-1 的“删除即可”结论被该实测推翻。
  - 修正后的脚本跳过 `<head>`（含 `<title>`）、`<pre>/<code>`、带 `data-pagefind-meta="title"` 的 h1；实测真实站点 UI 仍为 5/4，且 `#pagefind-search` 渲染文本不含 U+200B。
  - Pagefind 官方 extended 版本支持中文分词：[Pagefind Multilingual](https://pagefind.app/docs/multilingual/)；但本站在生产 UI 的实际查询侧未达到同样粒度，需保留索引侧对齐。
- **同类做法与来源**：索引/查询分词不一致时，用零宽空格对齐是常见 workaround；代价是索引文本含不可见字符。修正做法是把 ZWSP 限制在正文索引，并在渲染层清除可见结果中的 ZWSP。Playground 只能作为索引导航，不能替代生产 UI 验收。
- **影响**：若直接删除预处理，搜索“估值/赛道”等中文词召回从 5/4 降到 1/0；若保留旧脚本，则标题/摘要复制会带不可见字符。修正后两者兼顾。
- **建议改动**（已实施）：保留 `scripts/segment-cjk-for-pagefind.mjs`，但跳过 `head/title/pre/code/h1-meta`；`build-deploy.ps1` 先分词再 `pagefind --output-path _site/pagefind`，失败硬中止；`footer.html` 在 Pagefind UI 渲染后从结果文本移除 U+200B。
- **风险与验证**：真实站点 UI 估值 5 / 赛道 4；搜索结果标题及 `#pagefind-search` 文本无 ZWSP；`pagefind-entry.json` page_count=10；Pagefind 固定 1.5.2。
- **工作量**：0.5 人日（已完成）。

#### P1-2 生产构建 42–62 秒，约 90% 时间耗在逐页 Terser

- **问题**：`jekyll-minifier` 在 production 下对每个页面的内联 JS 调 Terser（Ruby `terser` + ExecJS）。10 篇文章、约 28 个 HTML 产物（含重定向/404/离线页）的站点，生产构建生成阶段两次测量分别为 42.9s 与 62.2s；关闭 JS 压缩后 5.4s。
- **证据**：
  - `_config.yml:57-72`：`compress_javascript: true`。
  - `scripts/build-deploy.ps1:60-61` 显式设置 `JEKYLL_ENV=production`。
  - 实测：生产 42.9s/62.2s、开发 4.2s/9.7s、关闭 JS 压缩 5.4s（生成阶段，命令输出见基线表）。
  - 体积收益：`index.html` 21.0KB→25.7KB（raw），gzip 8.7→9.8KB，brotli 6.7→7.6KB；文章页 brotli 10.8→11.9KB。即每页 Brotli 只省约 0.9KB。
- **影响**：每次发布多等约 1 分钟；Terser/ExecJS 在 Windows 上不稳定，失败会阻断发布；压缩收益与成本严重不匹配。
- **同类做法与来源**：Jekyll 站点通常把 JS 压缩放到资源构建阶段（esbuild/Vite）或交给 CDN Brotli，而不是在 Liquid 渲染后逐页压缩；`jekyll-minifier` 的 Terser 依赖 ExecJS，在 Windows 上启动开销明显（通用工程实践，未找到官方性能基准）。
- **建议改动**：`_config.yml` 设 `compress_javascript: false`，保留 `compress_css/html/json`；如后续需要压缩自定义 JS，用 esbuild 对 `js/*.js` 做一次离线压缩，而不是逐页 Terser。可选：直接移除 `jekyll-minifier`，仅保留已压缩的 vendored 资源。
- **风险与验证**：关闭后 HTML 原始体积增加约 78KB（全站），Brotli 后每页约 +0.9KB；风险低。验证：生产构建生成时间 ≤15s，完整发布（含 Pagefind）≤30s；页面功能与代码块格式不变；Brotli 后单页增量 ≤1.5KB。
- **工作量**：0.5 人时。

#### P1-3 Service Worker 缓存不随版本失效，静态资源每次强制回源

- **问题**：`CACHE` 名称固定为 `main-precache-then-runtime`，`activate` 只删除几个历史名称；每次发布后，浏览器 CacheStorage 里的旧 CSS/JS 仍会被 SWR 优先返回，第一次导航可能拿到旧样式。同时所有静态资源 `fetch(..., {cache:"no-store"})`，每次导航都在后台重新下载全部 CSS/JS/图片，绕过浏览器 HTTP 缓存。
- **证据**：
  - `sw.js:12-14`：`CACHE_NAMESPACE`/`CACHE` 固定；`:36` 的 `DEPRECATED_CACHES` 不含当前 cache。
  - `sw.js:214-216`：静态资源 `fetch(event.request, { cache: "no-store" })`；`:223-234` 先返回 `cached`，后台再更新。
  - `sw.js:186-206`：HTML 导航网络优先，但同样带 `cache-bust` 与 `no-store`。
- **影响**：发布后第一跳可能出现新 HTML + 旧 CSS/JS 的错配（布局/交互异常）；移动端每次翻页都重复下载静态资源，流量与电量浪费；CacheStorage 随访问 URL 增长且不清理已删除文章。
- **同类做法与来源**：
  - Workbox 生命周期文档建议每次发布使用新的 cache 名称，并在 `activate` 删除旧 cache：[Workbox Service Worker Lifecycle](https://developer.chrome.com/docs/workbox/service-worker-lifecycle)。
  - MDN 对 stale-while-revalidate 的说明：命中缓存后仍请求网络刷新，但缓存键需要可管理：[MDN Caching](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching)。
- **建议改动**：
  1. 给 `sw.js` 加 front matter（Jekyll 会渲染它），用构建时间或 Git SHA 生成 `CACHE_VERSION`；`CACHE = 'main-' + CACHE_VERSION`。
  2. `activate` 删除所有 `main-` 前缀但非当前版本的 cache。
  3. 静态资源去掉 `cache:"no-store"`，改为默认 fetch（让 HTTP 缓存/边缘缓存生效）；HTML 导航保留 network-first，必要时只对 HTML 使用 `no-store`。
  4. 对 precache 使用逐项缓存（`Promise.allSettled`）而不是 `addAll` 原子失败；把 `citongshuo.css/js` 加入预缓存。
- **风险与验证**：首次切换会让所有客户端重建缓存，属预期；若 `site.time` 每次构建都变，会频繁失效，可改用 Git SHA。验证：修改一处 CSS 颜色并发布，刷新一次后新样式生效；DevTools Application 中只剩当前 cache 名称；离线访问仍可用；一次导航的静态请求量明显下降。
- **工作量**：0.5 人日。

#### P1-4 首屏载荷偏重，Pagefind UI 在每个页面都被加载

- **问题**：`footer.html` 的脚本在每个页面都插入 `/pagefind/pagefind-ui.js`（120KB）并实例化 `PagefindUI`，即使用户从不打开搜索；同时本地 CSS 160KB、JS 131KB、首页头图 289KB。搜索是低频操作，却在所有页面支付成本。
- **证据**：
  - `_includes/footer.html:223-294`：无条件创建 `script.src = /pagefind/pagefind-ui.js`，`onload` 后 `new PagefindUI(...)`。
  - `_includes/head.html:115-127`：Bootstrap 117KB、Hux 28KB、citongshuo 15KB；本地 JS 合计 131KB。
  - 基线表：`pagefind-ui.js` 120KB + CSS 14KB；Pagefind 目录 644KB。
- **影响**：移动端首屏 TBT 与流量增加；搜索页面的 JS 解析成本被所有访问者承担；弱网下搜索脚本失败还会触发回退脚本加载。
- **同类做法与来源**：搜索 UI 按需加载是静态站点常见做法；Pagefind 官方 UI 支持在需要时再导入/实例化（[Pagefind UI](https://pagefind.app/docs/ui/)）。未找到针对本站的官方性能基准，本条基于页面载荷与通用实践。
- **建议改动**：
  1. 把 Pagefind 脚本/CSS 的加载移入搜索图标点击处理：首次点击时创建 `<script>`，`onload` 后 `new PagefindUI`，再聚焦输入框；失败调用 `initLegacySearch`。
  2. 搜索 CSS 改为随 UI 脚本一起加载，避免首屏加载未使用的 14KB。
  3. 仅在文章页加载 `jquery.nav.js`（目录导航），首页/关于/归档不加载。
  4. 评估移除 `bootstrap.min.js`（仅 tooltip 初始化被注释、导航为自定义实现）；保留 Bootstrap CSS 的网格/导航部分或后续子集化。
- **风险与验证**：搜索首次打开会有一次加载延迟，可加 loading 文案。验证：初始页面网络面板无 `/pagefind/pagefind-ui.js` 请求；点击搜索后正常加载并聚焦；搜索查询结果与改动前一致；Lighthouse TBT/性能分提升。
- **工作量**：0.5 人日。

#### P1-5 图片未做响应式与压缩，LCP/CLS 风险明确

- **问题**：首页头图 289KB（1920×1280）、关于页封面 246KB（3500×2333）、正文大图 286–421KB；全部没有 `srcset/sizes`、没有 WebP/AVIF、正文图片没有宽高。`image-lazyload.rb` 给所有 `<img>` 加 `loading="lazy"`，包括可能处于首屏的图片。
- **证据**：
  - 文件尺寸与像素：`img/home-bg.jpg` 283KB/1920×1280；`img/cover-community.jpg` 246KB/3500×2333；`img/citongshuo-knowledge-connector-1.jpg` 411KB/2560×1440；`img/ai-supply-chain-review-3.png` 286KB/750×5757（命令输出）。
  - `_plugins/image-lazyload.rb:8-15` 只加 `loading="lazy"` 与 `decoding="async"`，不处理尺寸/格式。
  - `_includes/intro-header.html:10` 头图通过 CSS `background-image` 加载，无法使用 `srcset`。
- **影响**：移动端 LCP 被头图与首图拖慢；无固有尺寸导致 CLS；高 DPI 屏幕下载 3500px 图造成浪费；长截图 PNG 解码成本高。
- **同类做法与来源**：Web 性能通用实践是提供多尺寸 `srcset`、现代格式（WebP/AVIF）、显式 `width/height`，并对 LCP 图 `preload`/`fetchpriority=high`；Core Web Vitals 阈值为 LCP≤2.5s、CLS≤0.1（[web.dev CWV](https://web.dev/articles/defining-core-web-vitals-thresholds)）。
- **建议改动**：
  1. 用脚本把 `home-bg`、`cover-community`、正文大图转成 WebP（质量 78–82），保留 JPEG/PNG 回退；头图另出 1280/1920 两档。
  2. 首页 `<head>` 增加 `<link rel="preload" as="image" ...>`（带 `imagesrcset`）；头图改用 `<img>` + `object-fit: cover` 或 CSS `image-set()`。
  3. 正文图片在 Markdown 中补 `width/height`（或用插件在 post_render 时读取图片尺寸并写入）；`image-lazyload.rb` 跳过每篇第一张图，改为 `fetchpriority=high`。
  4. 目标：首屏图片 ≤80KB，正文单图 ≤150KB。
- **风险与验证**：金融截图文字多，压缩需目视检查；保留原图备份。验证：Lighthouse 移动端 LCP≤2.5s、CLS≤0.1；页面图片字节数达标；截图文字仍清晰。
- **工作量**：1 人日。

#### P1-6 全站多数页面没有 `h1`

- **问题**：文章页有 `h1`（`intro-header.html:46`），但首页、归档、标签、关于、404 的 `h1` 数为 0；`intro-header.html:107` 的页面标题被注释掉，首页卡片用 `h2`。
- **证据**：对 `_site/index.html`、`_site/archive/index.html`、`_site/tags/index.html`、`_site/about/index.html`、`_site/404.html` 统计 `<h1`，结果均为 0（命令输出）。
- **影响**：搜索引擎缺少页面主题信号；屏幕阅读器大纲从 `h2/h5` 开始，层级不清晰；对“加入社群/标签”等落地页的 SEO 不利。
- **同类做法与来源**：每页一个主 `h1` 是 SEO/可访问性基础实践；若视觉上不需要，可用 `sr-only`。参考 [W3C WAI](https://www.w3.org/WAI/tutorials/page-structure/headings/)（通用规范）。
- **建议改动**：在 `intro-header.html` 的 `type == 'page'` 分支输出 `<h1 class="sr-only">{{ page.title | default: site.title }}</h1>`；首页用 `site.title`；文章页保留现有 `h1`；确保每页恰好一个 `h1`。
- **风险与验证**：视觉不变；风险低。验证：构建后对每个页面 `grep -c '<h1'` 为 1；Lighthouse SEO/A11y 分提升；屏幕阅读器大纲正确。
- **工作量**：0.5 人时。

#### P1-7 依赖版本陈旧且 CDN 资源无 SRI

- **问题**：全站加载 jQuery 2.1.3（2014）与 Bootstrap 3.3.2（2014），均早于已知 XSS/原型污染修复版本；Font Awesome 4.6.3、MathJax 2.7.5、Anchor.js 1.1.1、FastClick 1.0.6 也均为 EOL。所有外部 `<script>/<link>` 都没有 `integrity`，CDN 被篡改或不可用时没有校验/回退。
- **证据**：
  - `js/jquery.min.js:1` 头部 `jQuery v2.1.3`；`css/bootstrap.min.css:1` 头部 `Bootstrap v3.3.2`。
  - `_includes/head.html:127`（Font Awesome）、`:134-135`（html5shiv/respond）、`_includes/footer.html:121`（FastClick）、`_layouts/post.html:156`（Anchor.js）、`_includes/mathjax_support.html:19`（MathJax）、`_includes/mermaid.html:9-10`（Mermaid）均无 `integrity`。
  - `git grep "integrity="` 无结果。
- **影响**：jQuery <3.4.0 存在原型污染（CVE-2019-11358），<3.5.0 存在 `htmlPrefilter` XSS（CVE-2020-11022/11023）；Bootstrap <3.4.1 存在 tooltip/popover XSS（CVE-2019-8331）。本站内容由站长撰写、未直接渲染用户输入，实际可利用性有限，但全站加载 EOL 库属于明确安全债；CDN 资源无 SRI 则把供应链风险完全交给第三方。
- **同类做法与来源**：
  - NVD：[CVE-2019-11358](https://nvd.nist.gov/vuln/detail/CVE-2019-11358)、[CVE-2020-11022](https://nvd.nist.gov/vuln/detail/CVE-2020-11022)、[CVE-2019-8331](https://nvd.nist.gov/vuln/detail/CVE-2019-8331)。
  - SRI 规范与用法：[MDN SRI](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Subresource_Integrity)。
- **建议改动**：
  1. 升级 jQuery 到 3.7.x、Bootstrap 到 3.4.1（或移除 Bootstrap JS，仅保留 CSS），先做导航、目录、标签云、表格、移动端回归。
  2. 自托管 Font Awesome 子集、MathJax、Mermaid（或固定版本文件 + SRI）；至少给保留的 CDN 资源加 `integrity` 与 `crossorigin="anonymous"`。
  3. 移除 FastClick（现代浏览器已无 300ms 点击延迟问题）；Anchor.js 升级或自托管。
  4. CI 增加 `bundle audit`/`npm audit` 与 Dependabot。
- **风险与验证**：jQuery 3 与旧插件（tagcloud、onePageNav）可能不兼容，需逐项测试；Bootstrap 3.4.1 与 jQuery 3 需验证 tooltip（目前未启用）。验证：导航折叠、目录高亮、标签筛选、表格、深色模式、移动端均正常；SRI 校验失败时资源不执行（故意改 hash 测试）。
- **工作量**：1 人日。

#### P1-8 文章时间戳系统性偏移 8 小时

- **问题**：所有文章 front matter 使用无时区的 `YYYY-MM-DD HH:MM:SS`。Jekyll（Psych/YAML）把它按 UTC 解析，再按 +08:00 输出，导致 feed/JSON-LD 的发布时间比作者写的晚 8 小时。仅设置 `timezone: Asia/Shanghai` 不能修复（已实测）。
- **证据**：
  - 例如 `_posts/2026-10-05-刺桐说金融知识MCP服务正式上线.md:6` 为 `date: 2026-10-05 09:00:00`；`_site/feed.xml` 输出 `<published>2026-10-05T17:00:00+08:00</published>`。
  - 最小复现站点：不设 timezone 与设 `timezone: Asia/Shanghai` 两种构建，`page.date | date_to_xmlschema` 均为 `2026-10-05T17:00:00+08:00`。
  - Jekyll 文档明确无偏移的时间“assuming UTC”：[Jekyll Variables](https://jekyllrb.com/docs/variables/)；timezone 只设置进程 TZ：[Jekyll Configuration](https://jekyllrb.com/docs/configuration/options/#timezone)。
- **影响**：RSS 读者看到晚 8 小时的发布时间；JSON-LD `datePublished` 与 `article:published_time` 不准确；`future: true` 下，未来文章的“到点发布”会整体推迟 8 小时；跨时区构建（如 CI UTC）会让日期边界文章落到前一天/后一天。
- **同类做法与来源**：Jekyll 官方建议带偏移写入（`YYYY-MM-DD HH:MM:SS +/-TTTT`）；或统一使用 UTC 并在展示层转换。参考同上。
- **建议改动**：给 10 篇文章的 `date` 追加 `+0800`；`_config.yml` 可同时取消注释 `timezone: Asia/Shanghai`（用于其他日期过滤器，但要知道它不修复裸时间）；CI 增加断言：feed 中目标文章 `<published>` 的小时与 front matter 一致。
- **风险与验证**：只改元数据，不影响 URL/排序（日期部分不变）；风险低。验证：重新构建后 feed/JSON-LD 为 `09:00:00+08:00`；文章顺序不变；sitemap lastmod 仍来自 Git 时间。
- **工作量**：1 人时。

#### P1-9 构建工具链未锁定，`Gemfile.lock` 只支持 Windows

- **问题**：`Gemfile.lock` 的 `PLATFORMS` 只有 `x64-mingw-ucrt`，在 Linux CI/其他机器上 `bundle install` 会因缺少平台而失败；`mise.toml` 只声明 Ruby 3.3.8，没有 Node；本机实际 Ruby 3.4.9；Pagefind 通过 `npx --yes` 拉最新版。构建结果不可复现。
- **证据**：
  - `Gemfile.lock:116-117` 仅 `x64-mingw-ucrt`；`Gemfile.lock:195-196` `BUNDLED WITH 4.0.8`。
  - `mise.toml:2` 仅 `ruby = "3.3.8"`；`ruby -v` 为 3.4.9；`node -v` 为 22.22.3。
  - `scripts/build-deploy.ps1:78` `npx --yes pagefind`；本机 `npx pagefind --version` 为 1.6.0，而 `_site/pagefind/pagefind-entry.json` 为 1.5.2。
- **影响**：CI/新机器无法安装依赖；不同机器生成的 HTML/索引可能不同；Pagefind 升级可能改变分词与索引体积（1.5.2 原生索引 36.7KB，1.6.0 原生 75.1KB）。
- **同类做法与来源**：
  - Bundler 官方 `bundle lock --add-platform` 可为 lockfile 增加目标平台：[Bundler bundle-lock](https://bundler.io/man/bundle-lock.1.html)。
  - Pagefind 支持 `pagefind@vX.Y.Z` 固定版本：[Pagefind Installation](https://pagefind.app/docs/installation/)。
- **建议改动**：
  1. `bundle lock --add-platform x86_64-linux`（如未来有 macOS 构建再加 `arm64-darwin`）。
  2. `mise.toml` 增加 `node = "22"`；脚本开头用 `mise exec` 或检查版本。
  3. 新增 `package.json` + `package-lock.json`，`devDependencies` 固定 `pagefind` 版本，`scripts` 提供 `search`；CI 用 `npm ci` 和 `npx --no-install pagefind`。
  4. 把 `package.json`/`package-lock.json` 加入 `_config.yml` 的 exclude（避免被复制到站点）。
- **风险与验证**：新增 Node 依赖需锁定安全版本；风险低。验证：Linux CI 从零 `bundle install && npm ci && jekyll build` 成功；`bundle exec jekyll build` 与 Windows 产物差异仅时间戳；Pagefind 版本号固定。
- **工作量**：0.5 人日。

---

### P2（可选优化）

#### P2-1 SEO/索引杂项：`offline.html` 进 sitemap、404/离线页背景指向 `/`

- **问题**：`offline.html` 被 jekyll-sitemap 收录；404 与离线页没有 `header-img` 也没有 `header-bg-css`，`intro-header.html` 会生成 `background-image: url('/')`，浏览器把首页 HTML 当图片请求；404 没有 `noindex`。
- **证据**：`_site/sitemap.xml` 含 `https://www.citongshuo.online/offline.html`；`_site/404.html` 中 `header.intro-header{...background-image:url('/')}`；`_includes/intro-header.html:10,97` 的 `site.header-img` 在 `_config.yml:5` 被注释。
- **影响**：离线页/404 被搜索引擎收录（低质量页面）；404/离线页产生一次无意义的 `/` 请求；离线页视觉上没有背景。
- **同类做法与来源**：jekyll-sitemap 官方 README 明确支持在 front matter 设置 `sitemap: false` 排除页面：[jekyll-sitemap](https://github.com/jekyll/jekyll-sitemap)。404 的 `noindex` 是通用 SEO 实践。
- **建议改动**：`offline.html`/`404.html` 加 `sitemap: false`；404 加 `<meta name="robots" content="noindex">`；给两页加 `header-bg-css: "#060608"` 或让 `intro-header` 在无图时回退到纯色；离线页补一句“当前处于离线状态”的提示。
- **风险与验证**：低。验证：sitemap 不含 offline/404；404 无 `/` 背景请求；离线页有可见文案。
- **工作量**：0.5 人时。

#### P2-2 发布物卫生：`esa.jsonc` 被发布、Pagefind 未使用资产、部署分支体积

- **问题**：`esa.jsonc` 在站点根被复制到 `_site`，线上可直接访问；Pagefind 目录包含 `pagefind-component-ui.js`（175KB）、`pagefind-modular-ui.*`、`pagefind-highlight.js` 等当前 UI 未使用的文件；deploy 分支每次提交完整 `_site`（约 6.3MB）。
- **证据**：临时构建 `_site/esa.jsonc` `Test-Path` 为 True；`_site/pagefind` 13 个文件/644KB，仅 UI/JS/索引/wasm 被引用；`origin/deploy` 树顶层为 `_site` + `esa.jsonc`，历史每次约 6MB。
- **影响**：暴露项目名与构建配置（非敏感但无必要）；部署包与仓库历史膨胀；ESA 文件数/包大小虽远低于限制（2000 文件/1GB），但长期成本增加。
- **同类做法与来源**：ESA Pages 的静态文件与单文件限制见[官方说明](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/what-is-functions-and-pages/)；Pagefind 官方 CLI 未找到“裁剪未使用 UI 资产”的选项，本条基于对构建产物的观察。
- **建议改动**：`_config.yml` exclude 增加 `"esa.jsonc"`；Pagefind 只保留实际引用的资产（若官方 CLI 不支持裁剪，至少不把未引用资产纳入前端预加载）；deploy 分支可定期 squash 或改用 `esa-cli` 直传产物（需先验证）。
- **风险与验证**：低。验证：`_site` 无 `esa.jsonc`；页面不请求未使用 Pagefind 资产；部署包大小下降。
- **工作量**：0.5 人时。

#### P2-3 界面文案 i18n 不完整

- **问题**：`_data/ui-text.yml` 已覆盖主要文案，但仍有硬编码中文/英文：`nav.html:11` "Toggle navigation"、`footer.html:248` "No results"、`css/citongshuo.css:542/551/560/569` 的“提示/说明/注意/风险”、`archive.html:3` 标题 "Archive"、`offline.html:3` "Offline"、页脚 "Powered by"、`short-about.html` "社群文化"、`friends.html` "友情链接"。
- **影响**：切语言/改文案时需要改多处；中英混排影响一致性；callout 类型标签无法按语言切换。
- **同类做法与来源**：Jekyll 的 `_data` 目录用于集中管理界面文案，模板通过数据文件读取是通用做法：[Jekyll Data Files](https://jekyllrb.com/docs/datafiles/)。未找到本项目专属的 i18n 规范。
- **建议改动**：把上述字符串迁入 `ui-text.yml`，模板通过 `site.data.ui-text[site.ui_lang]` 读取；callout 标签可用 CSS `content: attr(data-label)` 或在 Markdown 中传入；补一份 `en` 段（可选）。
- **风险与验证**：低。验证：`grep` 模板中无硬编码界面文案；切换 `ui_lang` 后页面文案一致。
- **工作量**：0.5 人日。

#### P2-4 Mermaid 主题切换不重绘，且图表源码进入搜索索引

- **问题**：`mermaid.html` 只在脚本加载时初始化一次，切换深浅色后不会重绘；Mermaid 代码块位于 `data-pagefind-body` 内，Pagefind 会把 `graph TD` 等源码文本纳入索引。
- **证据**：`_includes/mermaid.html:16-32` 只执行一次 `mermaid.initialize`/`run`；`_layouts/post.html:20` 的 `data-pagefind-body` 包裹 `{{ content }}`；Pagefind 默认不忽略 `<code>`（官方索引文档只列 nav/footer/script/form 等忽略元素）。
- **影响**：深色模式下图表仍是浅色主题；搜索“graph/flowchart”等词可能命中图表源码，降低结果质量。
- **同类做法与来源**：Pagefind 官方索引文档列出默认忽略元素（nav/footer/script/form 等），`<code>` 不在其中，可用 `data-pagefind-ignore` 排除：[Pagefind Indexing](https://pagefind.app/docs/indexing/)。Mermaid 官方支持通过 `theme` 重新初始化/重绘。
- **建议改动**：监听主题切换事件（`citongshuo.js` 中派发 `ct-theme-changed`），重新 `mermaid.run`；给 Mermaid 容器/代码块加 `data-pagefind-ignore`；`mermaid.run` 包 `try/catch` 并保留原代码块兜底。
- **风险与验证**：低。验证：切换主题后图表颜色跟随；搜索 `graph TD` 不命中；图表渲染失败时仍显示源码。
- **工作量**：0.5 人日。

#### P2-5 搜索回退与 Pagefind 初始化缺少异常保护

- **问题**：`footer.html` 在 `pagefind-ui.js` 的 `onload` 中直接 `new PagefindUI(...)`；若脚本加载成功但 `PagefindUI` 未定义、索引缺失或初始化抛错，不会回退到 `simple-jekyll-search`。回退的 `json: '/search.json'` 硬编码，忽略 `baseurl`；Pagefind CSS 在 JS 加载后才插入，打开搜索时可能闪一下无样式。
- **证据**：`_includes/footer.html:268-293`；`initLegacySearch` 只在 `script.onerror` 触发（`:292`）；`json: '/search.json'` 在 `:246`。
- **影响**：Pagefind 产物不完整时搜索白屏/报错；未来若设置 `baseurl`，回退搜索 404。
- **同类做法与来源**：Pagefind UI 官方文档说明通过 `new PagefindUI(...)` 挂载，并可在脚本加载后按需初始化：[Pagefind UI](https://pagefind.app/docs/ui/)；回退路径使用 `relative_url` 是 Jekyll 通用实践。
- **建议改动**：`onload` 内 `try { new PagefindUI(...) } catch { initLegacySearch() }`；`json: '{{ "/search.json" | relative_url }}'`；在搜索图标点击时先显示 loading，再按需加载 CSS/JS。
- **风险与验证**：低。验证：临时删除 `pagefind-ui.js`/索引，搜索仍可用；`baseurl` 非空时回退正常。
- **工作量**：0.5 人时。

#### P2-6 Service Worker 代码卫生与缓存增长

- **问题**：`getCacheBustingUrl`/`getRedirectUrl` 中 `url = new URL(...)` 未声明（隐式全局）；`isNavigationReq` 对 `req.headers.get('accept')` 直接 `.includes`，某些无 Accept 的请求会抛 TypeError；`HOSTNAME_WHITELIST` 含 `huangxuan.me`/`yanshuo.io` 与 `ys.static` 分支，均与本站无关；precache 使用 `addAll`，任一文件 404 会导致整批不缓存；当前 cache 不清理已删除 URL。
- **证据**：`sw.js:41,86`；`:63`；`:30-35`；`:178-181`；`:100-108`；`:36`。
- **影响**：极端请求下 fetch 事件抛错；旧域名分支永不命中；离线预缓存脆弱；CacheStorage 随访问增长。
- **同类做法与来源**：Workbox/Service Worker 生命周期建议版本化 cache 并清理旧缓存：[Workbox Lifecycle](https://developer.chrome.com/docs/workbox/service-worker-lifecycle)；预缓存逐项失败隔离是常用做法。
- **建议改动**：声明 `const url`；Accept 判空；删除无关域名/`ys.static` 分支；precache 逐项 `cache.add` 并 `Promise.allSettled`；按 `main-` 前缀清理非当前版本；把 `citongshuo.css/js` 加入清单。
- **风险与验证**：低。验证：`node --check sw.js`；断网/离线页可用；DevTools 中缓存条目受控。
- **工作量**：0.5 人日。

#### P2-7 可访问性细节

- **问题**：无“跳到主内容”链接；导航搜索图标只有 `<i>` 无 `aria-label`；移动端导航按钮无 `aria-expanded/aria-controls`；灯箱 `role="dialog"` 无 `aria-modal`/焦点管理；复制按钮默认 `opacity:0`，键盘聚焦时不可见；正文图片 alt 多为“Image”；页脚微信像素无 alt；浅色 muted 文本（#a3a3a3 on #fff）对比度不足。
- **证据**：`_includes/nav.html:10-33`；`_includes/footer.html:24-31`；`css/citongshuo.css:430-449`；`_posts/*.md` 中 `![Image](...)`；`_layouts/default.html:18`；`css/citongshuo.css:13`。
- **影响**：键盘/屏幕阅读器用户体验差；Lighthouse Accessibility 分低；图片无描述影响内容理解。
- **同类做法与来源**：W3C WAI 的页面结构与无障碍指南：[W3C WAI Headings](https://www.w3.org/WAI/tutorials/page-structure/headings/)、[W3C WAI](https://www.w3.org/WAI/)；skip link、焦点管理、对比度均为通用要求。
- **建议改动**：加 skip link 与 `id="main"`；搜索/导航按钮补 `aria-label`/`aria-expanded`；灯箱加 `aria-modal`、Esc/焦点回归；复制按钮 `:focus-visible { opacity: 1 }`；正文图片 alt 改为描述性文字；“Image”批量替换需人工过一遍；装饰像素 `alt="" aria-hidden="true"`；调整 muted 色值到对比度 ≥4.5:1。
- **风险与验证**：低。验证：Lighthouse Accessibility ≥90；Tab 键可完成导航/搜索/关闭；屏幕阅读器大纲正确。
- **工作量**：0.5 人日。

#### P2-8 归档页无 JS 时内容隐藏、无分页

- **问题**：`archive.html` 的结果容器初始为 `d-none`，依赖 `archive.js` 才显示；若 jQuery/JS 失败，归档页只有标签没有文章；归档页一次列出全部文章，无分页。
- **证据**：`archive.html:44` `class="mini-post-list js-result d-none"`；`js/archive.js:39-142` 依赖 jQuery。
- **影响**：弱网/禁用 JS 时归档不可用；文章增长后页面变长。
- **同类做法与来源**：未找到可靠来源，基于渐进增强/无 JS 可用的通用实践（内容应在 JS 失败时仍然可读）。
- **建议改动**：初始不加 `d-none`，JS 初始化后再隐藏并按标签过滤；或加 `<noscript>` 提示；超过 50 篇时按年份分页/折叠。
- **风险与验证**：低。验证：禁用 JS 后仍能看到文章列表；标签筛选正常；页面长度可控。
- **工作量**：0.5 人日。

#### P2-9 发布与回滚的运维细节

- **问题**：上线确认固定轮询 180 秒；版本清理只保留生产/预发 + 最新 2 个；ESA 默认缓存规则对以 `/` 结尾的请求默认回源（需控制台确认）；deploy 分支历史膨胀；没有书面回滚步骤。
- **证据**：`build-deploy.ps1:172-190` 180 秒；`:40-45` 保留策略；ESA 文档：[默认缓存规则](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/default-cache-rule)、[缓存绕过](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/cache-bypass)；ESA 免费版每函数 5 个版本：[计费说明](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/functions-and-pages-billing)。
- **影响**：构建排队超过 3 分钟会误报失败；回滚窗口只有 2 个版本；若控制台未配置缓存规则，所有文章页可能每次回源；deploy 历史持续增大。
- **同类做法与来源**：ESA 官方缓存与计费文档（见证据链接）；`esa-cli deployments list` 可用于查询部署状态：[ESA CLI](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/functions-and-pages-cli-tool)。
- **建议改动**：轮询延长到 10 分钟并指数退避，或使用 `esa-cli deployments list`；保留策略改为“生产/预发 + 最近 3 个”；在控制台确认 HTML/无后缀路径缓存规则；写一页回滚 runbook（`esa-cli deploy` 选旧版本/控制台回滚）；定期 squash deploy 历史。
- **风险与验证**：低。验证：连续 3 次发布自动确认；回滚到上一版本成功；缓存命中率/TTFB 符合预期。
- **工作量**：0.5 人日。

---

## 2. 看起来该改但不建议改

以下项看起来“不整洁/不现代”，但改动收益低于回归风险，或属于已决策的现状，建议保留：

1. **不要整体迁移到 Chirpy 上游主题或重写模板。** 现有定制已覆盖 i18n、callout、分享、暗色、Pagefind、SW，迁移会重置这些决策，且文章 URL/样式需要重新验证。
2. **不要一次性移除 Bootstrap/jQuery。** 导航折叠、目录滚动、标签云、表格响应式都依赖它们；先做 P1-7 的版本升级与按需裁剪，再考虑替换。
3. **不要把所有静态资源改成 network-first。** 会牺牲离线与弱网体验；正确做法是版本化 cache + SWR，而不是取消 SWR。
4. **不要改 `permalink: pretty` 或文章 slug。** 会破坏已有外链、搜索索引与分享卡片；中文标题转拼音插件对现有英文 slug 也无实际作用。
5. **不要删除 `search.json` 与 simple-jekyll-search 回退。** 上游 GitHub Pages/无 Pagefind 环境仍需要它；它是降级路径，不是死代码。
6. **不要为了“纯 GitHub Pages”删掉 `_plugins` 与本地构建。** GitHub Pages 以 `--safe` 运行、不执行自定义插件；QR 分享码、懒加载、拼音 slug 都会失效。ESA/本地构建才是主链路。
7. **不要只加 `timezone: Asia/Shanghai` 就认为修好了时间。** 已实测裸时间仍按 UTC 解析；必须给 front matter 加 `+0800`。
8. **不要删除旧 ESA 版本到“只剩当前版本”。** 免费版只有 5 个版本，保留 2–3 个是必要的回滚窗口。
9. **不要对金融截图做激进有损压缩。** 文字/表格截图对清晰度敏感；优先 WebP 高质量 + 尺寸适配，逐张目视验收。
10. **不要为了目录整洁删除 `img/cover-membership.jpg`、`home.html`、`ads.html` 等。** 它们当前未被引用，但可能是未来页面/活动的素材；清理应单独排期，不与本次风险修复混在一起。
11. **不要改导航顺序、`future: true`、置顶机制。** 这些是运营决策，不是代码缺陷；如需调整应由内容负责人提出。

---

## 3. 实施顺序建议（分批、可独立验证、可回滚）

### 批次 0：止血（当天，发布前必须完成）

- `_config.yml` exclude 增加 `"2026-11-03"`、`"esa.jsonc"`；如新增 `package.json`/`package-lock.json` 一并排除。
- `.gitignore` 增加 `.env`、`.env.*`；决定审计文档是否入库（入库则保留跟踪但构建排除）。
- `build-deploy.ps1` 加预检：当前分支、`git status --porcelain` 白名单、`_site` 中禁止路径断言；把 `git add -A` 改为显式路径。
- 验证：临时构建无 `_site/2026-11-03`、无 `_site/esa.jsonc`；`git status` 只含预期文件；部署后审计 URL 404。
- 回滚：仅改配置/脚本，`git revert` 即恢复；本批不发布也可验证。

### 批次 1：构建可复现（1–2 天）

- `bundle lock --add-platform x86_64-linux`；`mise.toml` 补 Node 22；新增 `package.json`/lock，固定 Pagefind 1.5.2。
- 删除 ZWSP 预处理与 `segment-cjk-for-pagefind.mjs`；`build-deploy.ps1` 直接 `pagefind --site _site`。
- `_config.yml` 设 `compress_javascript: false`；保留 HTML/CSS/JSON 压缩。
- 新增 GitHub Actions `build.yml` 做 Linux 构建门禁；Pagefind 失败 `exit 1`，可选 `-AllowMissingSearch`。
- 验证：CI 绿；生产构建 ≤15s；`pagefind-entry.json` page_count=10；估值/赛道结果与原生 1.5.2 一致；标题无 ZWSP。
- 回滚：恢复旧 `build-deploy.ps1`/`_config.yml`；Pagefind 版本仍在 lock 中，可快速切回。

### 批次 2：发布可信度（1 天）

- 清洗并纳入 `build-deploy.ps1`；加 `aliyun`/`esa-cli` 硬前置；上线确认延长/改用 `esa-cli deployments list`；记录生产版本号。
- 写回滚 runbook；把“保留 2 个版本”改为“生产/预发 + 最近 3 个”。
- 验证：连续 3 次发布自动确认；模拟 Pagefind/构建失败脚本非 0 退出；回滚到上一版本成功。
- 回滚：保留旧脚本备份；ESA 控制台可回滚到旧版本。

### 批次 3：首屏性能与 SEO（2–3 天）

- Pagefind UI 改为搜索点击加载；文章页才加载 `jquery.nav.js`；评估移除 Bootstrap JS。
- 图片转 WebP/多尺寸、preload 首图、补宽高；`image-lazyload` 跳过首图。
- 全站补 `h1`；sitemap 排除 offline/404；404/离线页背景回退；JSON-LD 补 `dateModified`。
- 验证：Lighthouse 移动端 Performance ≥85、LCP≤2.5s、CLS≤0.1；初始页面无 Pagefind 请求；每页一个 `h1`。
- 回滚：图片保留原文件；模板改动可单独 revert；Lighthouse 前后对比。

### 批次 4：依赖与体验打磨（2 天）

- jQuery 3.7.x/Bootstrap 3.4.1 或移除 Bootstrap JS；CDN 自托管/SRI；移除 FastClick。
- SW 版本化 cache、去除静态 `no-store`、清理无关分支；补 `citongshuo.css/js` 预缓存。
- Mermaid 主题重绘、搜索回退 try/catch、i18n、a11y、归档无 JS。
- 验证：导航/目录/标签/表格/深色模式回归；Lighthouse Accessibility ≥90；离线可用；搜索降级可用。
- 回滚：按文件 revert；SW 修改后需在测试设备清一次缓存验证。

---

## 4. 量化验收标准

| 类别 | 现状 | 目标 | 验证方式 |
|---|---|---|---|
| 生产构建（生成阶段） | 42.9–62.2s | ≤15s | `Measure-Command { bundle exec jekyll build }` |
| 完整发布（含 Pagefind） | Jekyll 47–78s + Pagefind 本地约 1s / npx 首次约 29s | ≤30s（本地 Pagefind 二进制） | 构建脚本计时 |
| 审计/配置泄露 | `_site/2026-11-03`、`_site/esa.jsonc` 存在 | 两者均不存在 | 临时构建 `Test-Path`；线上 URL 404 |
| Pagefind 索引 | 38KB / 10 页 / 含 ZWSP | ≤50KB / 10 页 / 标题无 `\u200B` | `pagefind-entry.json` + Node 扫描 |
| 搜索回归 | 修正后真实站点 UI 估值 5、赛道 4，结果无 ZWSP | 与修正版基线一致 | 本地站点 UI 查询 20 个词 + Node 扫描 |
| 首屏 Pagefind 请求 | 每页加载 120KB UI | 0 次，点击搜索后才加载 | 浏览器 Network |
| 首屏 CSS/JS | CSS 160KB + JS 131KB | CSS ≤160KB、JS ≤100KB（移除 Bootstrap JS） | 构建产物统计 |
| 首屏图片 | 头图 289KB | ≤80KB（WebP + 多尺寸） | Lighthouse/人工检查 |
| LCP / CLS | 未实测（风险高） | LCP≤2.5s、CLS≤0.1（移动端 75 分位） | Lighthouse/PageSpeed |
| Lighthouse | 未实测 | Performance≥85、Accessibility≥90、SEO≥95、Best Practices≥95 | Lighthouse 移动端 |
| H1 | 5 类页面 0 个 | 每页恰好 1 个 | 构建后 `grep -c '<h1'` |
| Sitemap | 含 offline.html | 不含 offline/404/审计 | `_site/sitemap.xml` 检查 |
| 时间戳 | 09:00 → 17:00+08 | 09:00+08 | feed/JSON-LD 断言 |
| 发布确认 | 180s 轮询、CLI 可缺省 | 3/3 自动确认、失败非 0 | 连续 3 次发布记录 |
| 版本配额 | 5 个上限、保留 2 | 清理后 ≤5、保留生产/预发+3 | `aliyun esa ListRoutineCodeVersions` |
| 回滚 | 手工控制台，窗口 2 版 | 1 个命令/1 次点击回到上一版 | 回滚演练 |
| 依赖安全 | jQuery 2.1.3/Bootstrap 3.3.2 | jQuery≥3.5、Bootstrap≥3.4.1；SRI/自托管 | 版本头 + `npm audit`/`bundle audit` |
| 可复现性 | 仅 Windows lock | Linux CI 从零构建成功 | GitHub Actions 日志 |

---

## 5. 参考来源

- Pagefind 多语言（中文分词由 extended 版本原生支持）：[Pagefind Multilingual](https://pagefind.app/docs/multilingual/)
- Pagefind 索引范围与 `data-pagefind-body`：[Pagefind Indexing](https://pagefind.app/docs/indexing/)
- Pagefind 元数据（`data-pagefind-meta` 可在 body 外）：[Pagefind Metadata](https://pagefind.app/docs/metadata/)
- Pagefind 安装与 `npx` 固定版本：[Pagefind Installation](https://pagefind.app/docs/installation/)
- 第三方关于 ZWSP 造成索引/查询分词不一致的同类经验记录：[One Human + a Fleet of Agents](https://hub.cissychen.com/blog-pipeline.en.html)（非官方文档，仅作旁证）
- Jekyll 日期变量“assuming UTC”：[Jekyll Variables](https://jekyllrb.com/docs/variables/)
- Jekyll `timezone` 配置：[Jekyll Configuration](https://jekyllrb.com/docs/configuration/options/#timezone)
- Jekyll `exclude` 配置：[Jekyll Configuration](https://jekyllrb.com/docs/configuration/options/)
- Jekyll `_data` 数据文件：[Jekyll Data Files](https://jekyllrb.com/docs/datafiles/)
- jekyll-sitemap 的 `sitemap: false`：[jekyll-sitemap](https://github.com/jekyll/jekyll-sitemap)
- GitHub Pages 以 `--safe` 运行、不执行自定义插件：[Jekyll Plugins on GitHub Pages](https://jekyllrb.com/docs/plugins/installation/#plugins-on-github-pages)
- Jekyll GitHub Actions 构建：[Jekyll CI](https://jekyllrb.com/docs/continuous-integration/github-actions/)
- Bundler 增加平台：[Bundler bundle-lock](https://bundler.io/man/bundle-lock.1.html)
- Pagefind UI 挂载：[Pagefind UI](https://pagefind.app/docs/ui/)
- ESA 免费版每函数 5 个版本：[ESA 计费说明](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/functions-and-pages-billing)
- ESA Pages 文件数/单文件限制：[ESA Functions and Pages](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/what-is-functions-and-pages/)
- ESA Pages 构建配置与回滚：[ESA Pages 构建](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/build-pages)
- ESA CLI（`esa-cli deployments list`）：[ESA CLI](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/functions-and-pages-cli-tool)
- ESA 默认缓存规则：[默认缓存策略](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/default-cache-rule)
- ESA 缓存绕过/动态请求回源：[缓存绕过](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/cache-bypass)
- ESA `GetRoutine` API：[GetRoutine](https://help.aliyun.com/zh/edge-security-acceleration/esa/api-esa-2024-09-10-getroutine)
- Service Worker 生命周期与缓存版本化：[Workbox Service Worker Lifecycle](https://developer.chrome.com/docs/workbox/service-worker-lifecycle)
- Stale-while-revalidate 说明：[MDN Caching](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching)
- SRI 用法：[MDN Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Subresource_Integrity)
- Core Web Vitals 阈值：[web.dev Defining Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)
- 可访问性/标题层级：[W3C WAI Headings](https://www.w3.org/WAI/tutorials/page-structure/headings/)
- jQuery 漏洞：[CVE-2019-11358](https://nvd.nist.gov/vuln/detail/CVE-2019-11358)、[CVE-2020-11022](https://nvd.nist.gov/vuln/detail/CVE-2020-11022)、[CVE-2020-11023](https://nvd.nist.gov/vuln/detail/CVE-2020-11023)
- Bootstrap 漏洞：[CVE-2019-8331](https://nvd.nist.gov/vuln/detail/CVE-2019-8331)

> 说明：ESA 免费套餐“构建失败无主动通知”未找到官方明确说明，本条来自本项目脚本注释与运行经验，属于“未找到可靠来源，基于通用实践/项目经验”的判断；其余结论均有上述文档或本次实测命令支撑。

## 6. 实施修正记录（2026-11-03）

- **P1-1 修正**：真实站点 UI 下原生 Pagefind 1.5.2/1.6.0 索引“估值”1 条、“赛道”0 条；旧 ZWSP 索引 5/4。原“删除预处理”结论被推翻，最终保留正文分词对齐，但跳过 `head/title/pre/code/h1-meta`，并在 Pagefind UI 渲染后清理可见 ZWSP。实测 5/4 且结果无 ZWSP。
- **P2-9 修正**：原方案的“生产/预发 + 最近 3 个版本”会超出免费版 5 个版本（2 环境 + 3 历史 + 本次构建 = 6）。实施保留“生产/预发 + 最近 2 个”，并在脚本中写明原因。
- **P2-8 已实施**：归档页移除初始 `d-none`，无 JS 时文章列表仍可见；标签筛选仍由 `archive.js` 处理。
- **已实施**：jQuery 3.7.1 / Bootstrap 3.4.1 升级；Font Awesome 4.7 自托管；Mermaid 固定版本 + SRI；SW 版本化 cache、旧缓存清理、离线回退；文章时间戳统一 `+0800`；导航 `aria-expanded`/搜索 `aria-label`。
- **未实施**：Lighthouse 实机跑分（环境无 Chrome/Edge；用构建耗时、HTML 体积、图片字节数、Pagefind 请求数、h1 数量作为等效指标）；Bootstrap JS 移除（回归风险高，保留并仅升级版本）；Anchor.js/ MathJax CDN 自托管（当前未启用 MathJax，Anchor.js 仅低风险 CDN，留待后续）；i18n 硬编码文案、灯箱焦点管理、Mermaid 索引忽略等纯 P2 体验项留待下一轮。
