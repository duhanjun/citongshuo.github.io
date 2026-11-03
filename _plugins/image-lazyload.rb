# frozen_string_literal: true

# 为渲染后的页面图片补充 loading="lazy" 与 decoding="async"，
# 降低首屏图片请求负担。仅补齐缺失的属性，不覆盖已有声明。
# 每页第一张图不 lazy，改为 fetchpriority="high"，避免把 LCP 图延后。
#
# 注意：GitHub Pages 的 safe 模式不执行自定义插件，
# 该优化仅在本机 / ESA 构建链路（提交 _site）生效。
Jekyll::Hooks.register %i[documents pages], :post_render do |doc|
  next unless doc.output_ext == ".html"

  image_index = 0
  doc.output = doc.output.gsub(/<img\s[^>]*>/i) do |tag|
    image_index += 1
    # 已有 loading/fetchpriority/decoding 的图片不再重复补属性（尤其是 hero 首图）
    next tag if tag =~ /\bloading\s*=|\bfetchpriority\s*=|\bdecoding\s*=/i

    if image_index == 1
      tag.sub("<img", '<img fetchpriority="high" decoding="async"')
    else
      tag.sub("<img", '<img loading="lazy" decoding="async"')
    end
  end
end