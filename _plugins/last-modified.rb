# frozen_string_literal: true

# 用 git 提交时间填充文章的 page.last_modified_at，供 intro-header.html 展示「更新于」。
# 仅依赖 git（构建在含 .git 的源码工作区进行）；取不到时保持 nil，模板不会输出。
# 这样避免用文件 mtime 兜底——克隆/检出后 mtime 会变成当天，反而产生误导。

module Jekyll
  class LastModifiedGenerator < Generator
    safe true
    priority :low

    def generate(site)
      docs = site.posts.docs
      return if docs.empty?

      root = site.source
      docs.each do |doc|
        stamp = git_commit_time(root, doc.relative_path)
        doc.data["last_modified_at"] = Time.at(stamp).localtime if stamp
      end
    end

    private

    def git_commit_time(root, relative_path)
      out = `git -C "#{root}" log -1 --format=%ct -- "#{relative_path}" 2>#{File::NULL}`
      return nil unless $?.success?

      value = out.strip
      return nil if value.empty?

      value.to_i
    rescue StandardError
      nil
    end
  end
end