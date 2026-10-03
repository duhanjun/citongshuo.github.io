# frozen_string_literal: true

# 构建时生成微信分享二维码（内联 SVG）。
# 目的：微信不支持从普通网页唤起转发，桌面端改用「扫码到手机打开再转发」这一标准做法。
# 放在构建期生成，前端无需引入 QR 库，也不依赖任何外部二维码服务（隐私与可访问性更可控）。
#
# 用法：{{ _ct_share_url | qr_svg }}

require "rqrcode"

module Jekyll
  module QrSvgFilter
    def qr_svg(text)
      return "" if text.nil? || text.to_s.empty?

      # standalone 为 false 时 rqrcode 只输出 <path>（供嵌入其它 SVG 用），内联 HTML 需要
      # 完整的 <svg> 根元素；因此用默认的 standalone 再剥掉 <?xml ...?> 声明。
      svg = RQRCode::QRCode.new(text.to_s).as_svg(
        viewbox: true,
        use_path: true,
        color: "000000",
        shape_rendering: "crispEdges"
      )
      svg.sub(/\A<\?xml[^>]*\?>/, "")
    end
  end
end

Liquid::Template.register_filter(Jekyll::QrSvgFilter)

# 供模板判断 filter 是否可用：GitHub Pages 的 legacy 构建以安全模式运行、不加载
# _plugins，此时未知 filter 会被当作无操作、把原始 URL 渲染成文本，故模板需显式跳过。
Jekyll::Hooks.register :site, :after_init do |site|
  site.config["qr_svg_available"] = true
end