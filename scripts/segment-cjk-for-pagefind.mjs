#!/usr/bin/env node
/**
 * Pagefind 中文分词对齐预处理。
 *
 * 背景：在本站使用的 Pagefind 1.5.2 下，索引侧会对中文分词，但生产 UI 的查询侧
 * 不按同样粒度切分「估值」「赛道」这类词，导致多字查询召回下降（实测原生索引
 * 在真实站点 UI 中「估值」1 条、「赛道」0 条）。这里保留原有的零宽空格对齐方案。
 *
 * 与旧版差异：不再处理 <head>（含 <title>）、<pre>/<code>，以及带
 * data-pagefind-meta="title" 的 h1，避免把 ZWSP 写进搜索标题/元数据与代码块。
 * 正文文本仍按 Intl.Segmenter 词边界插入 U+200B。
 *
 * 用法：
 *   node scripts/segment-cjk-for-pagefind.mjs <源目录> <输出目录>
 */

import fs from 'node:fs';
import path from 'node:path';

const ZWSP = '\u200B';

// 连续的 CJK 字符才需要分段；其余的 ASCII / 标点原样保留
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+/g;

if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') {
    console.error('当前 Node 不支持 Intl.Segmenter，无法进行中文分词对齐。请升级 Node 到 16+。');
    process.exit(1);
}

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

const segmentRun = (run) =>
    [...segmenter.segment(run)].map((s) => s.segment).join(ZWSP);

/**
 * 在 HTML 文本节点里插入词边界，以下块保持原样：
 * - <head>...</head>（含 title/meta/JSON-LD）
 * - <script>/<style>
 * - <pre>/<code>
 * - 带 data-pagefind-meta="title" 的 h1
 */
function segmentHtml(html) {
    return html.replace(
        /(<head[\s\S]*?<\/head>|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>|<h1[^>]*data-pagefind-meta[^>]*>[\s\S]*?<\/h1>)|(<[^>]*>)|([^<]+)/gi,
        (match, block, tag, text) => {
            if (block) return block;
            if (tag) return tag;
            return text.replace(CJK, segmentRun);
        }
    );
}

/** 递归列出目录下所有 .html 文件，返回相对路径。 */
function listHtmlFiles(root) {
    const out = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(abs);
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
                out.push(path.relative(root, abs));
            }
        }
    };
    walk(root);
    return out;
}

const [srcDir, outDir] = process.argv.slice(2);
if (!srcDir || !outDir) {
    console.error('用法：node scripts/segment-cjk-for-pagefind.mjs <源目录> <输出目录>');
    process.exit(1);
}
if (!fs.existsSync(srcDir)) {
    console.error(`源目录不存在：${srcDir}`);
    process.exit(1);
}
if (path.resolve(srcDir) === path.resolve(outDir)) {
    console.error('输出目录不能与源目录相同，避免覆盖站点产物。');
    process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });

const files = listHtmlFiles(srcDir);
for (const rel of files) {
    const srcPath = path.join(srcDir, rel);
    const outPath = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, segmentHtml(fs.readFileSync(srcPath, 'utf8')));
}

console.log(`已对 ${files.length} 个 HTML 做中文分词对齐：${srcDir} -> ${outDir}`);
