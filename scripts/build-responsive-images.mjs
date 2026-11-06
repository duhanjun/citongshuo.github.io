// 为一组文章生成本地 WebP 响应式变体（正文图片）。
//
// 说明：正文源图最大宽度普遍在 1080px 以内，直接生成 1280/1920 会放大插值、
// 体积反而更大，因此按「源图实际宽度」生成：
//   <base>-640.webp   小屏 / 低 DPR 用
//   <base>-<宽>.webp  原分辨率（最宽 1080）
// 文件名中的数字即真实像素宽度，模板侧据此写 srcset 的 w 描述符。
//
// 硬性下限：每档生成后与源图比字节数，webp ≥ 源图就丢弃该档，
// 由原图兜底。宁可少一档候选，也不出现「优化后更慢」。
// 判据是客观的「生成后比大小」，不靠固定质量参数，避免随图片类型漂移。
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

let srcBytes = 0;
let smallBytes = 0;
let nativeBytes = 0;
let generated = 0;
let discarded = 0;
let skipped = 0;

for (const ref of [...refs].sort()) {
  const src = path.join("img", ref.replace(/^\/img\//, ""));
  if (!/\.(png|jpe?g)$/i.test(src)) continue;

  const stat = await fs.stat(src);
  const meta = await sharp(src).metadata();
  const native = meta.width;

  const targets = [];
  if (native > 640) {
    targets.push({ kind: "small", width: 640, out: src.replace(/\.(png|jpe?g)$/i, "-640.webp") });
  }
  targets.push({ kind: "native", width: native, out: src.replace(/\.(png|jpe?g)$/i, `-${native}.webp`) });

  srcBytes += stat.size;

  for (const t of targets) {
    let outStat = null;
    try {
      outStat = await fs.stat(t.out);
    } catch {}

    // 历史产物若超过源图，直接丢弃（不再提供更慢的档）
    let dropped = false;
    if (outStat && outStat.size >= stat.size) {
      await fs.unlink(t.out);
      discarded += 1;
      console.log(`  丢弃 ${path.basename(t.out)}（已存在 ${outStat.size}B ≥ 源图 ${stat.size}B）`);
      outStat = null;
      dropped = true;
    }

    if (dropped) {
      // 该档已判定不可用，不再重复生成
    } else if (outStat && outStat.mtimeMs >= stat.mtimeMs) {
      skipped += 1;
    } else {
      const tmp = `${t.out}.tmp`;
      await sharp(src)
        .resize({ width: t.width, withoutEnlargement: true })
        .webp({ quality: 82, effort: 6 })
        .toFile(tmp);
      const size = (await fs.stat(tmp)).size;
      if (size >= stat.size) {
        await fs.unlink(tmp);
        discarded += 1;
        console.log(`  丢弃 ${path.basename(t.out)}（生成 ${size}B ≥ 源图 ${stat.size}B）`);
      } else {
        if (outStat) await fs.unlink(t.out);
        await fs.rename(tmp, t.out);
        generated += 1;
        outStat = await fs.stat(t.out);
        console.log(`  ${path.basename(t.out)}  ${Math.round(size / 1024)}KB`);
      }
    }

    // 该档实际传输字节：webp 存活取 webp，被丢弃则回退原图
    const effective = outStat ? outStat.size : stat.size;
    if (t.kind === "small") smallBytes += effective;
    else nativeBytes += effective;
  }
}

const pct = (after) => (srcBytes ? `${Math.round((1 - after / srcBytes) * 1000) / 10}%` : "0%");
const avg = (n) => (refs.size ? Math.round(n / refs.size / 102) / 10 : 0);

console.log(`\n图片 ${refs.size} 张，生成 ${generated} 个 WebP，丢弃 ${discarded} 个（≥ 源图），跳过 ${skipped} 个（已是最新）`);
console.log(`源图合计 ${Math.round(srcBytes / 1024)}KB（均 ${avg(srcBytes)}KB）`);
console.log(`640 档合计 ${Math.round(smallBytes / 1024)}KB（均 ${avg(smallBytes)}KB，降幅 ${pct(smallBytes)}）`);
console.log(`原分辨率档合计 ${Math.round(nativeBytes / 1024)}KB（均 ${avg(nativeBytes)}KB，降幅 ${pct(nativeBytes)}）`);
