#!/usr/bin/env node
/**
 * 从微信公众号草稿箱抓取文章，转换为本项目的 Jekyll 文章。
 *
 * 一次转换做四件事：
 *   1. 抓取草稿正文（微信返回的是带内联样式的 HTML）
 *   2. 转成 Markdown，剥掉所有样式，保留标题层级 / 加粗 / 列表 / 引用 / 图片
 *   3. 下载正文图片到 img/，命名为 <slug>-N.<ext>（短且纯 ASCII，URL 干净）
 *   4. 生成 _posts/<日期>-<标题>.md，front matter 与现有文章保持一致
 *
 * 凭据走环境变量（不要写进仓库）：
 *   WECHAT_MP_APPID      公众号 AppID
 *   WECHAT_MP_APPSECRET  公众号 AppSecret
 *
 * 用法：
 *   node scripts/wechat-draft.mjs --list
 *   node scripts/wechat-draft.mjs --fetch "标题关键字" [选项]
 *   node scripts/wechat-draft.mjs --media-id <media_id> [选项]
 *
 * 选项：
 *   --date     "2026-10-02 09:00:00"  文章日期，默认今天 09:00:00
 *   --subtitle "副标题"               默认取草稿摘要
 *   --author   "二哥聊指数"           默认固定为「二哥聊指数」（草稿的 author 字段常是编辑器残留）
 *   --tags     "游资策略,短线交易"     默认用 DEFAULT_TAGS
 *   --slug     "short-english-name"   强烈建议指定。缺省时取中文标题，构建时由 _plugins/pinyin-slug.rb
 *                                     转成拼音，但图片名会跟着变中文、URL 变长
 *   --dry-run                         只打印转换结果，不下载图片、不写文件
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = path.join(ROOT, '_posts');
const IMG_DIR = path.join(ROOT, 'img');

// 现有 7 篇文章统一使用这三个标签，作为默认值
const DEFAULT_TAGS = ['游资策略', '短线交易', '价值投资'];

// 正文图片从 -2 开始编号，把 -1 留给封面图，与现有文章命名一致
const IMG_START_INDEX = 2;

const API = 'https://api.weixin.qq.com/cgi-bin';

/* ------------------------------------------------------------------ 参数解析 */

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i];
    if (!cur.startsWith('--')) continue;
    const key = cur.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

/* -------------------------------------------------------------- 微信接口调用 */

function readCredential(name) {
  const value = process.env[name];
  if (!value || value === '__FILL_ME__') {
    throw new Error(`环境变量 ${name} 未设置或仍是占位符 __FILL_ME__`);
  }
  return value;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.errcode) throw new Error(`微信接口报错 ${data.errcode}：${data.errmsg}`);
  return data;
}

async function getAccessToken() {
  const appid = readCredential('WECHAT_MP_APPID');
  const secret = readCredential('WECHAT_MP_APPSECRET');
  const data = await postJson(`${API}/stable_token`, {
    grant_type: 'client_credential',
    appid,
    secret,
  });
  if (!data.access_token) throw new Error(`换取 access_token 失败：${JSON.stringify(data)}`);
  return data.access_token;
}

async function listDrafts(token, withContent) {
  const data = await postJson(`${API}/draft/batchget?access_token=${token}`, {
    offset: 0,
    count: 20,
    no_content: withContent ? 0 : 1,
  });
  return data.item || [];
}

/* ------------------------------------------------------- HTML -> Markdown 转换 */

// 这些标签界定段落边界，进入和离开时都会结算当前段落
const BLOCK_TAGS = new Set([
  'p', 'section', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'figure', 'figcaption', 'tr', 'table',
]);

// 这些标签的内容整体丢弃
const DROP_TAGS = new Set(['style', 'script', 'head', 'title', 'meta', 'link']);

// 行内标签的前后标记；a 的收尾标记需要动态拼 href，单独处理
const INLINE_MARKS = {
  strong: ['**', '**'],
  b: ['**', '**'],
  em: ['*', '*'],
  i: ['*', '*'],
  code: ['`', '`'],
  del: ['~~', '~~'],
  s: ['~~', '~~'],
};

function decodeEntities(text) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
    hellip: '…', mdash: '—', ndash: '–', middot: '·',
  };
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, entity) => {
    if (entity[0] === '#') {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const code = parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return named[entity] ?? whole;
  });
}

function parseAttrs(raw) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(raw))) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

function tokenize(html) {
  const tokens = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      tokens.push({ type: 'text', value: html.slice(i) });
      break;
    }
    if (lt > i) tokens.push({ type: 'text', value: html.slice(i, lt) });

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt);
      i = end === -1 ? html.length : end + 3;
      continue;
    }

    const gt = html.indexOf('>', lt);
    if (gt === -1) break;
    const raw = html.slice(lt + 1, gt);
    i = gt + 1;

    if (raw.startsWith('!') || raw.startsWith('?')) continue;

    const closing = raw.startsWith('/');
    const body = closing ? raw.slice(1) : raw;
    const nameMatch = body.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
    if (!nameMatch) continue;

    const name = nameMatch[1].toLowerCase();
    tokens.push({
      type: closing ? 'close' : 'open',
      name,
      attrs: closing ? {} : parseAttrs(body),
      selfClosing: /\/\s*$/.test(raw),
    });
  }
  return tokens;
}

function pickImageUrl(attrs) {
  // 微信正文图片可能把真实地址放在 data-src，src 只是占位图
  let url = attrs['data-src'] || attrs.src || '';
  if (!url || url.startsWith('data:')) return '';
  // 属性值里的 &amp; 要还原，结尾的 #imgIndex=n 锚点要丢掉
  url = decodeEntities(url).split('#')[0];
  if (url.startsWith('//')) url = `https:${url}`;
  return url.replace(/^http:/, 'https:');
}

/**
 * 没有闭合标签的元素，维护字号栈时要跳过
 */
const VOID_TAGS = new Set([
  'br', 'hr', 'img', 'input', 'meta', 'link', 'col',
  'source', 'area', 'base', 'wbr', 'embed', 'param', 'track',
]);

function readFontSize(attrs) {
  const m = /font-size:\s*([0-9.]+)px/.exec((attrs && attrs.style) || '');
  return m ? parseFloat(m[1]) : null;
}

/**
 * 把微信正文 HTML 转成 Markdown。
 * 图片先写成 __IMG_n__ 占位符，下载完成后再回填本地路径。
 */
function htmlToMarkdown(html) {
  const blocks = [];
  const images = [];
  let buffer = '';
  let dropDepth = 0;
  let pendingPrefix = '';
  const inlineStack = [];
  const listStack = [];
  // 微信用内联 font-size 表达标题层级而非 <h1>-<h6>，这里维护一条字号栈
  const sizeStack = [];
  const currentSize = () => {
    for (let i = sizeStack.length - 1; i >= 0; i--) {
      if (sizeStack[i]) return sizeStack[i];
    }
    return null;
  };

  // 微信编辑器常产出 <strong><strong> 这类嵌套，会变成 ****文字****，需要收敛
  const cleanBlock = (text) => text
    .replace(/\*{4,}/g, '**')
    .replace(/~{4,}/g, '~~')
    .split('\n')
    .filter((line) => !/^(\*\*|~~|`|\*)$/.test(line.trim()))
    .join('\n')
    .trim();

  const flush = () => {
    const text = cleanBlock(buffer
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim());
    const size = currentSize();
    buffer = '';
    if (!text) {
      pendingPrefix = '';
      return;
    }
    blocks.push({ text: pendingPrefix + text, size });
    pendingPrefix = '';
  };

  const push = (text) => { buffer += text; };

  for (const token of tokenize(html)) {
    if (token.type === 'text') {
      if (dropDepth === 0) push(decodeEntities(token.value));
      continue;
    }

    const { name } = token;
    // 闭合标签要等业务逻辑用完当前字号再出栈，所以这里先算好是否参与字号栈
    const trackSize = !VOID_TAGS.has(name) && !token.selfClosing;

    if (DROP_TAGS.has(name)) {
      if (token.type === 'open') {
        dropDepth++;
        if (trackSize) sizeStack.push(readFontSize(token.attrs));
      } else {
        dropDepth = Math.max(0, dropDepth - 1);
        if (trackSize) sizeStack.pop();
      }
      continue;
    }
    if (dropDepth > 0) {
      if (trackSize) {
        if (token.type === 'open') sizeStack.push(null);
        else sizeStack.pop();
      }
      continue;
    }

    if (token.type === 'open') {
      if (trackSize) sizeStack.push(readFontSize(token.attrs));
      if (name === 'br') { push('\n'); continue; }
      if (name === 'hr') { flush(); blocks.push('---'); continue; }

      if (name === 'img') {
        flush();
        const url = pickImageUrl(token.attrs);
        if (url) {
          const index = images.length;
          images.push(url);
          blocks.push(`![Image](__IMG_${index}__)`);
        }
        continue;
      }

      if (BLOCK_TAGS.has(name)) {
        flush();
        if (name === 'li') {
          const ordered = listStack.length > 0 && listStack[listStack.length - 1].ordered;
          if (ordered) {
            const top = listStack[listStack.length - 1];
            top.index++;
            pendingPrefix = `${top.index}. `;
          } else {
            pendingPrefix = '- ';
          }
        } else if (/^h[1-6]$/.test(name)) {
          pendingPrefix = `${'#'.repeat(Number(name[1]))} `;
        }
        continue;
      }

      if (name === 'ul' || name === 'ol') {
        flush();
        listStack.push({ ordered: name === 'ol', index: 0 });
        continue;
      }

      if (name === 'a') {
        const href = token.attrs.href || '';
        if (href && !href.startsWith('javascript:')) {
          push('[');
          inlineStack.push({ name, closeMark: `](${href})` });
        } else {
          inlineStack.push({ name, closeMark: '' });
        }
        continue;
      }

      const marks = INLINE_MARKS[name];
      if (marks) {
        push(marks[0]);
        inlineStack.push({ name, closeMark: marks[1] });
      }
      continue;
    }

    // 收尾标签
    if (name === 'ul' || name === 'ol') {
      flush();
      listStack.pop();
      if (trackSize) sizeStack.pop();
      continue;
    }

    if (name === 'li' || name === 'p' || name === 'section' || name === 'div' ||
        name === 'blockquote' || name === 'pre' || name === 'tr' ||
        name === 'figure' || name === 'figcaption') {
      flush();
      if (trackSize) sizeStack.pop();
      continue;
    }

    if (/^h[1-6]$/.test(name)) {
      flush();
      if (trackSize) sizeStack.pop();
      continue;
    }

    // 行内标签闭合：从栈顶往回找同名的，保证标签嵌套错乱时也能正确收尾
    for (let k = inlineStack.length - 1; k >= 0; k--) {
      if (inlineStack[k].name === name) {
        push(inlineStack[k].closeMark);
        inlineStack.splice(k, 1);
        break;
      }
    }
    if (trackSize) sizeStack.pop();
  }

  flush();

  // 依字号推断标题层级：出现最多的字号视为正文，比正文大的字号按大小映射为 ##、### …
  const freq = new Map();
  for (const b of blocks) {
    if (b.size) freq.set(b.size, (freq.get(b.size) || 0) + 1);
  }
  const bodySize = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const headingSizes = [...new Set(blocks.map((b) => b.size))]
    .filter((s) => s && s > bodySize)
    .sort((a, b) => b - a);
  // 层级超过 3 档说明这条规律不可靠，此时不做推断，全部按正文输出
  const levelOf = headingSizes.length >= 1 && headingSizes.length <= 3
    ? new Map(headingSizes.map((s, i) => [s, Math.min(i + 2, 6)]))
    : new Map();

  // 先给每段定级，便于后续合并
  const parts = blocks.map((b) => {
    const level = levelOf.get(b.size);
    if (!level || b.text.startsWith('#')) return { text: b.text, level: 0 };
    // 整段加粗、篇幅短、且不以句末标点收尾，才认定为标题而不是强调句
    if (!/^\*\*[^*]+\*\*$/.test(b.text.trim())) return { text: b.text, level: 0 };
    const plain = b.text.replace(/\*\*/g, '').trim();
    if (plain.length > 40 || /[。！；，]$/.test(plain)) return { text: b.text, level: 0 };
    return { text: plain, level };
  });

  // 微信常把「困境一：」和它的说明拆成两段，同级且以冒号结尾时合并为一条标题
  const merged = [];
  for (let i = 0; i < parts.length; i++) {
    const cur = parts[i];
    const next = parts[i + 1];
    if (cur.level && next && next.level === cur.level && /[：:]$/.test(cur.text)) {
      merged.push({ text: cur.text + next.text, level: cur.level });
      i++;
      continue;
    }
    merged.push(cur);
  }

  const markdown = merged
    .map((p) => (p.level ? `${'#'.repeat(p.level)} ${p.text}` : p.text))
    .join('\n\n');

  return {
    markdown,
    images,
    headingInfo: { bodySize, levels: [...levelOf.keys()] },
  };
}

/* ------------------------------------------------------------------ 图片下载 */

function imageExt(url) {
  const fmt = url.match(/wx_fmt=([a-zA-Z]+)/);
  if (fmt) return `.${fmt[1].toLowerCase()}`;
  const ext = path.extname(url.split('?')[0]).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext) ? ext : '.png';
}

async function downloadImage(url, destPath) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      Referer: 'https://mp.weixin.qq.com/',
    },
  });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
}

/* ------------------------------------------------------------------ 文件写入 */

function sanitizeForFilename(text) {
  return text
    .replace(/[\\/:*?"<>|]/g, '')  // Windows 文件名非法字符（全角冒号等不受影响）
    .replace(/\s+/g, ' ')
    .trim();
}

function todayStamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function buildFrontMatter({ title, subtitle, author, date, slug, tags }) {
  const lines = [
    '---',
    'layout: post',
    `title: ${JSON.stringify(title)}`,
    `subtitle: ${JSON.stringify(subtitle)}`,
    `author: ${JSON.stringify(author)}`,
    `date: ${date}`,
    `slug: ${JSON.stringify(slug)}`,
    'header-bg-css: "#060608"',
    'header-mask: 0.3',
    'mathjax: false',
    'tags:',
    ...tags.map((t) => `    - ${t}`),
    '---',
  ];
  return lines.join('\n');
}

/* ---------------------------------------------------------------------- 主流程 */

function printDraftList(items) {
  if (items.length === 0) {
    console.log('草稿箱是空的。');
    return;
  }
  console.log(`共 ${items.length} 条草稿：\n`);
  for (const item of items) {
    const news = item.content?.news_item?.[0] || {};
    const updated = new Date(item.update_time * 1000).toLocaleString('zh-CN');
    console.log(`  标题   ${news.title || '(无标题)'}`);
    console.log(`  更新   ${updated}`);
    console.log(`  media_id  ${item.media_id}`);
    console.log('');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.list && !args.fetch && !args['media-id']) {
    console.log('用法：node scripts/wechat-draft.mjs --list | --fetch "标题关键字" | --media-id <media_id>');
    process.exit(1);
  }

  const token = await getAccessToken();

  if (args.list) {
    printDraftList(await listDrafts(token, true));
    return;
  }

  // 定位目标草稿
  let news;
  let mediaId = args['media-id'];
  if (mediaId) {
    const data = await postJson(`${API}/draft/get?access_token=${token}`, { media_id: mediaId });
    news = data.news_item?.[0];
  } else {
    const keyword = String(args.fetch);
    const items = await listDrafts(token, true);
    const hit = items.find((item) =>
      (item.content?.news_item || []).some((n) => (n.title || '').includes(keyword)));
    if (!hit) throw new Error(`没有找到标题包含「${keyword}」的草稿，先跑 --list 看看`);
    mediaId = hit.media_id;
    news = (hit.content?.news_item || []).find((n) => (n.title || '').includes(keyword));
  }
  if (!news) throw new Error('草稿内容为空');

  const title = (news.title || '未命名').trim();
  const date = args.date || `${todayStamp()} 09:00:00`;
  const dayPart = date.slice(0, 10);
  const subtitle = args.subtitle || (news.digest || '').trim() || title;
  // 草稿里的 author 字段常是编辑器残留（如「搭建数字分身的」），统一用项目惯例值
  const author = args.author || '二哥聊指数';
  const tags = args.tags ? String(args.tags).split(',').map((t) => t.trim()).filter(Boolean) : DEFAULT_TAGS;
  const slug = args.slug || title;

  console.log(`标题      ${title}`);
  console.log(`副标题    ${subtitle}`);
  console.log(`日期      ${date}`);
  console.log(`作者      ${author}`);
  console.log(`标签      ${tags.join('、')}`);
  console.log(`media_id  ${mediaId}`);
  console.log('');

  const { markdown, images, headingInfo } = htmlToMarkdown(news.content || '');
  console.log(`字号推断  正文 ${headingInfo.bodySize ?? '未知'}，标题 ${headingInfo.levels.length ? headingInfo.levels.join('、') : '未识别（全部按正文输出）'}`);
  console.log('');

  // 下载图片并回填本地路径
  let body = markdown;
  if (args['dry-run']) {
    console.log('--- dry-run，以下为转换结果（图片保留远程地址）---\n');
    images.forEach((url, i) => { body = body.replace(`__IMG_${i}__`, url); });
    console.log(body);
    return;
  }

  const fileBase = `${dayPart}-${sanitizeForFilename(title)}`;
  // 图片按 slug 命名：短、纯 ASCII，URL 干净；文件本身仍沿用「日期-标题」的仓库惯例
  const imageBase = sanitizeForFilename(slug) || fileBase;
  if (/[^\x00-\x7F]/.test(imageBase)) {
    console.log('提示：slug 含中文，图片 URL 也会含中文；建议用 --slug 指定短英文名。');
    console.log('');
  }
  if (images.length > 0) {
    fs.mkdirSync(IMG_DIR, { recursive: true });
  }
  for (let i = 0; i < images.length; i++) {
    const url = images[i];
    const filename = `${imageBase}-${IMG_START_INDEX + i}${imageExt(url)}`;
    const dest = path.join(IMG_DIR, filename);
    try {
      await downloadImage(url, dest);
      body = body.replace(`__IMG_${i}__`, `/img/${filename}`);
      console.log(`  图片 ${filename}`);
    } catch (err) {
      console.log(`  图片 ${filename} 下载失败（保留远程地址）：${err.message}`);
      body = body.replace(`__IMG_${i}__`, url);
    }
  }

  const frontMatter = buildFrontMatter({ title, subtitle, author, date, slug, tags });
  const postPath = path.join(POSTS_DIR, `${fileBase}.md`);
  fs.writeFileSync(postPath, `${frontMatter}\n\n${body}\n`, 'utf8');

  console.log('');
  console.log(`已生成 ${path.relative(ROOT, postPath)}`);
  console.log(`共 ${images.length} 张图片，Markdown 正文 ${body.length} 字。`);
}

main().catch((err) => {
  console.error(`失败：${err.message}`);
  process.exit(1);
});