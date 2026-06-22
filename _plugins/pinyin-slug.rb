# 将包含中文的 slug 自动转为拼音，避免 URL 中出现中文编码问题
# 例如：游资进化-从涨停幻想到认知升维 → you-zi-jin-hua-cong-zhang-ting-huan-xiang-dao-ren-zhi-sheng-wei

require "ruby-pinyin"

class PinyinSlugGenerator < Jekyll::Generator
  safe true

  def generate(site)
    site.posts.docs.each do |doc|
      slug = doc.data["slug"]
      if slug && slug.match?(/\p{Han}/)
        # 先移除特殊标点，避免分词异常
        cleaned = slug.gsub(/[^\p{Han}\p{Alnum}\-]/, "")
        pinyin = PinYin.sentence(cleaned, separator: "-")
        pinyin = pinyin.downcase.gsub(/[^a-z0-9\-]/, "-").gsub(/-+/, "-").gsub(/^-|-$/, "")
        doc.data["slug"] = pinyin unless pinyin.empty?
      end
    end
  end
end
