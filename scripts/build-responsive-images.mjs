// 为一组文章生成本地 WebP 响应式变体（正文图片）。
//
// 说明：正文源图最大宽度普遍在 1080px 以内，直接生成 1280/1920 会放大插值、
// 体积反而更大，因此按「源图实际宽度」生成：
//   <base>-640.webp   小屏 / 低 DPR 用
//   <base>-<宽>.webp  原分辨率（最宽 1080）
// 文件名中的数字即真实像素宽度，模板侧据此写 srcset 的 w 描述符。
//
// 用法：node scripts/build-responsive-images.mjs <文章.md> [更多文章...]
// 依赖：sharp（本地一次性生成用，不写入 package.json，避免影响 CI 构建链路）
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const posts = process.argv.slice(2);
if (!posts.length) {
  console.error("用法: node scripts/build-responsive-images.mjs <post.md> [...]");
  process.exit(1);
}

const refs = new Set();
for (const post of posts) {
  const text = await fs.readFile(post, "utf8");
  for (const m of text.matchAll(/!\[[^\]]*\]\((\/img\/[^)\s]+)\)/g)) refs.add(m[1]);
}

let beforeBytes = 0;
let afterBytes = 0;
let generated = 0;
let skipped = 0;

for (const ref of [...refs].sort()) {
  const src = path.join("img", ref.replace(/^\/img\//, ""));
  if (!/\.(png|jpe?g)$/i.test(src)) continue;

  const stat = await fs.stat(src);
  const meta = await sharp(src).metadata();
  const native = meta.width;

  const targets = [];
  if (native > 640) targets.push({ width: 640, out: src.replace(/\.(png|jpe?g)$/i, "-640.webp") });
  targets.push({ width: native, out: src.replace(/\.(png|jpe?g)$/i, `-${native}.webp`) });

  beforeBytes += stat.size;

  for (const t of targets) {
    let outStat = null;
    try {
      outStat = await fs.stat(t.out);
    } catch { }
    if (outStat && outStat.mtimeMs >= stat.mtimeMs) {
      skipped += 1;
      continue;
    }
    await sharp(src)
      .resize({ width: t.width, withoutEnlargement: true })
      .webp({ quality: 82, effort: 6 })
      .toFile(t.out);
    generated += 1;
    const size = (await fs.stat(t.out)).size;
    console.log(`  ${path.basename(t.out)}  ${Math.round(size / 1024)}KB`);
  }

  // 移动端实际取的是原分辨率变体，用它和源图对比传输体积
  const nativeOut = targets[targets.length - 1].out;
  afterBytes += (await fs.stat(nativeOut)).size;
}

console.log(`\n图片 ${refs.size} 张，生成 ${generated} 个 WebP，跳过 ${skipped} 个（已是最新）`);
console.log(`源图合计 ${Math.round(beforeBytes / 1024)}KB，移动端取用合计 ${Math.round(afterBytes / 1024)}KB，节省 ${beforeBytes ? Math.round((1 - afterBytes / beforeBytes) * 100) : 0}%`);
