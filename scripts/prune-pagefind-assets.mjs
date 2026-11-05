#!/usr/bin/env node
/**
 * 裁剪 Pagefind 生成但本站未使用的资产。
 *
 * 全站只通过 footer.html 按需加载 pagefind/pagefind-ui.js 与 pagefind-ui.css；
 * pagefind-ui.js 内部仅动态 import 同目录 pagefind.js（其再使用 pagefind-worker.js
 * 与 wasm / pf_meta / 索引片段）。以下文件在模板、站点 JS、站点 CSS 中均无引用，
 * 也不被 pagefind-ui.js 或 pagefind.js 引用，故删除：
 *   - pagefind-component-ui.js / .css（Web Component 版 UI）
 *   - pagefind-modular-ui.js / .css（Modular UI）
 *   - pagefind-highlight.js（供自定义 UI 使用的高亮辅助模块）
 *
 * 用法：node scripts/prune-pagefind-assets.mjs <pagefind 输出目录>
 */

import fs from 'node:fs';
import path from 'node:path';

const UNUSED = [
    'pagefind-component-ui.js',
    'pagefind-component-ui.css',
    'pagefind-modular-ui.js',
    'pagefind-modular-ui.css',
    'pagefind-highlight.js',
];

const dir = process.argv[2];
if (!dir) {
    console.error('用法：node scripts/prune-pagefind-assets.mjs <pagefind 输出目录>');
    process.exit(1);
}
if (!fs.existsSync(dir)) {
    console.error(`目录不存在：${dir}`);
    process.exit(1);
}

let removed = 0;
let bytes = 0;
for (const name of UNUSED) {
    const target = path.join(dir, name);
    if (!fs.existsSync(target)) continue;
    bytes += fs.statSync(target).size;
    fs.rmSync(target);
    removed += 1;
}

console.log(`已裁剪 ${removed} 个未使用资产，共 ${(bytes / 1024).toFixed(1)}KB：${dir}`);
