#!/usr/bin/env node
/**
 * Pagefind 中文分词对齐预处理。
 *
 * 问题：Pagefind 建立索引时用 Rust 分词器，会把「估值」整体当作一个词存进索引；
 * 而浏览器查询时用 Intl.Segmenter（ICU），会把「估值」切成「估」「值」两个词去查，
 * 两边分词粒度不一致，导致搜索「估值」「赛道」这类词返回 0 条结果。
 *
 * 解决：建索引前，先用 Node 内置的 Intl.Segmenter（与浏览器同一套 ICU 数据）
 * 对 HTML 里的中文文本按词边界插入零宽空格 U+200B，让索引里的词边界与查询侧一致。
 * 之后索引中的「估」「值」两个词都能分别被命中，从而「估值」查询可以正常返回。
 *
 * 只处理文本节点：<script>/<style> 内容与 HTML 标签、属性一律原样保留，
 * 因此 id、锚点、meta、data-pagefind-* 等结构不受影响。
 *
 * 用法：
 *   node scripts/segment-cjk-for-pagefind.mjs <源目录> <输出目录>
 *
 * 示例：
 *   node scripts/segment-cjk-for-pagefind.mjs _site .jekyll-cache/pagefind-src
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
 * 在 HTML 文本节点里插入词边界，标签与脚本/样式块保持原样。
 */
function segmentHtml(html) {
    return html.replace(
        /(<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>)|(<[^>]*>)|([^<]+)/gi,
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

fs.rmSync(outDir, { recursive: true, force: true });

const files = listHtmlFiles(srcDir);
for (const rel of files) {
    const srcPath = path.join(srcDir, rel);
    const outPath = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, segmentHtml(fs.readFileSync(srcPath, 'utf8')));
}

console.log(`已对 ${files.length} 个 HTML 做中文分词对齐：${srcDir} -> ${outDir}`);