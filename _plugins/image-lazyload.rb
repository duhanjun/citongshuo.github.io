# frozen_string_literal: true

# 为渲染后的页面图片补充 loading="lazy" 与 decoding="async"，
# 降低首屏图片请求负担。仅补齐缺失的属性，不覆盖已有声明。
# 每页第一张图不 lazy，改为 fetchpriority="high"，避免把 LCP 图延后。
# 若正文图片存在同时代的 WebP 变体（img/<base>-<宽>.webp），追加 srcset + sizes；
# 不改变 <img> 原有的 src / loading / decoding / 尺寸属性，老浏览器仍回退原图。
#
# 注意：GitHub Pages 的 safe 模式不执行自定义插件，
# 该优化仅在本机 / ESA 构建链路（提交 _site）生效。
module CitongshuoImages
  # 与 css/hux-blog.css 中 .post-container 的实际内容宽度对应：
  # <768 为流式宽度；md 约 575px；lg 约 585px；>=1200 约 710px。
  SIZES = "(max-width: 767px) calc(100vw - 30px), (max-width: 991px) 575px, " \
          "(max-width: 1199px) 585px, 710px"

  @variant_cache = {}

  class << self
    # 返回 [[宽度, 文件名], ...]，按宽度升序；文件名来自构建产物同目录的 img/ 源图旁
    def variants(source_dir, relative_path)
      return @variant_cache[relative_path] if @variant_cache.key?(relative_path)

      dir = File.dirname(relative_path)
      base = File.basename(relative_path)
      pattern = dir == "." ? File.join(source_dir, "img", "#{base}-*.webp") : File.join(source_dir, "img", dir, "#{base}-*.webp")
      widths = Dir.glob(pattern).map { |f| File.basename(f)[/-(\d+)\.webp\z/, 1] }.compact.map(&:to_i).sort
      @variant_cache[relative_path] = widths.map { |w| [w, "#{base}-#{w}.webp"] }
    end

    def with_srcset(tag, source_dir)
      src = tag[/\ssrc="([^"]+)"/, 1]
      return tag unless src

      match = src.match(/(\/(?:img)\/([^"?#]+)\.(?:png|jpe?g))(\?.*)?$/)
      return tag unless match

      relative = match[2]
      entries = variants(source_dir, relative)
      return tag if entries.size < 2

      prefix = src[0, src.index(relative)]
      srcset = entries.map { |w, name| "#{prefix}#{name} #{w}w" }.join(", ")
      tag.sub(/\ssrc="[^"]*"/) { |attr| %(#{attr} srcset="#{srcset}" sizes="#{SIZES}") }
    end
  end
end

Jekyll::Hooks.register %i[documents pages], :post_render do |doc|
  next unless doc.output_ext == ".html"

  image_index = 0
  doc.output = doc.output.gsub(/<img\s[^>]*>/i) do |tag|
    image_index += 1
    tag = if tag =~ /\bloading\s*=|\bfetchpriority\s*=|\bdecoding\s*=/
            tag
          elsif image_index == 1
            tag.sub("<img", '<img fetchpriority="high" decoding="async"')
          else
            tag.sub("<img", '<img loading="lazy" decoding="async"')
          end

    # 已有 srcset 的图（如头图 hero）保持模板里的手写声明
    tag = CitongshuoImages.with_srcset(tag, doc.site.source) unless tag =~ /\bsrcset\s*=/
    tag
  end
end
