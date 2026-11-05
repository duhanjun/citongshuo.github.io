# frozen_string_literal: true

# Pagefind 索引排除 Mermaid 源码块。
#
# ```mermaid 代码块在静态产物里是 <pre><code class="language-mermaid">，Pagefind 会把
# flowchart / graph 这类图表语法也当成正文索引，导致搜「flowchart」命中文章正文。
# 这里只给承载源码的 <pre> 加 data-pagefind-ignore，图表前后的标题与说明文字仍留在
# 索引里，不削减整篇文章的搜索价值。
Jekyll::Hooks.register %i[documents pages], :post_render do |doc|
  next unless doc.output_ext == ".html"
  next unless doc.output.include?('class="language-mermaid"')

  doc.output = doc.output.gsub(/<pre(\s[^>]*)?>(<code\s+class="language-mermaid")/) do
    match = Regexp.last_match
    attrs = match[1] || ""
    if attrs.include?("data-pagefind-ignore")
      match[0]
    else
      "<pre#{attrs} data-pagefind-ignore>#{match[2]}"
    end
  end
end
