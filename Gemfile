source "https://rubygems.org"
gem "csv"
gem "base64"
gem "jekyll", "~> 4.4.0"
gem "minima", "~> 2.5"
group :jekyll_plugins do
  gem "jekyll-feed", "~> 0.12"
  # 全站压缩（HTML/CSS/JS）。
  # 刻意只放在 jekyll_plugins 分组、不写进 _config.yml 的 plugins:，
  # 这样本地/ESA 构建会加载它，而上游 GitHub Pages（github-pages gem，白名单模式）
  # 不会因未知插件而构建失败（该仓库的线上入口是 ESA，非 Pages）。
  gem "jekyll-minifier"
end
platforms :mingw, :x64_mingw, :mswin, :jruby do
  gem "tzinfo", ">= 1", "< 3"
  gem "tzinfo-data"
end
gem "rake"
gem "http_parser.rb", "~> 0.6.0", :platforms => [:jruby]
gem "jekyll-theme-clean-blog"
gem "jekyll-paginate"
gem "jekyll-redirect-from"
gem "jekyll-sitemap"
gem "webrick", "~> 1.7"
gem "ruby-pinyin", "~> 0.5.0"

gem "rqrcode", "~> 3.2"
