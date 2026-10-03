/*!
 * citongshuo 增量交互（原生 JS，无第三方依赖）
 * 内容：深色模式、阅读进度条、返回顶部、图片灯箱、代码复制、社交分享
 */
(function () {
  "use strict";

  /* ============================ 深色模式 ============================ */
  var THEME_KEY = "ct-theme";
  var mql = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function resolveTheme(pref) {
    if (pref === "dark" || pref === "light") return pref;
    return mql && mql.matches ? "dark" : "light";
  }

  function updateToggle(pref, resolved) {
    var btn = document.querySelector(".theme-toggle a");
    if (!btn) return;
    var icon = btn.querySelector("i");
    var map = {
      light: { cls: "fa fa-sun-o", title: "当前：浅色（点击切换）" },
      dark: { cls: "fa fa-moon-o", title: "当前：深色（点击切换）" },
      system: { cls: "fa fa-desktop", title: "当前：跟随系统（点击切换）" }
    };
    var conf = map[pref] || map[resolved];
    if (icon) icon.className = conf.cls;
    btn.setAttribute("title", conf.title);
    btn.setAttribute("aria-label", conf.title);
  }

  function applyTheme(pref) {
    var resolved = resolveTheme(pref);
    document.documentElement.setAttribute("data-theme", resolved);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      if (!meta.dataset.ctLight) meta.dataset.ctLight = meta.getAttribute("content") || "#000000";
      meta.setAttribute("content", resolved === "dark" ? "#1b1b1d" : meta.dataset.ctLight);
    }
    updateToggle(pref, resolved);
  }

  function initTheme() {
    var pref = null;
    try {
      pref = localStorage.getItem(THEME_KEY);
    } catch (e) {}
    applyTheme(pref || "system");

    var btn = document.querySelector(".theme-toggle a");
    if (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        var order = ["light", "dark", "system"];
        var cur = null;
        try {
          cur = localStorage.getItem(THEME_KEY);
        } catch (err) {}
        var next = order[(order.indexOf(cur) + 1) % order.length];
        if (!cur) next = "dark"; // 未设置时默认从「跟随系统」切到「深色」最直观
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch (err) {}
        applyTheme(next);
      });
    }

    if (mql) {
      var onChange = function () {
        var p = null;
        try {
          p = localStorage.getItem(THEME_KEY);
        } catch (e) {}
        if (!p || p === "system") applyTheme("system");
      };
      if (mql.addEventListener) mql.addEventListener("change", onChange);
      else if (mql.addListener) mql.addListener(onChange);
    }
  }

  /* ============================ 提示条 ============================ */
  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById("ct-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "ct-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("show");
    }, 2000);
  }

  /* ============================ 阅读进度条 ============================ */
  function initProgress() {
    var bar = document.getElementById("ct-progress");
    if (!bar) return;
    var update = function () {
      var doc = document.documentElement;
      var total = doc.scrollHeight - doc.clientHeight;
      var pct = total > 0 ? (window.pageYOffset / total) * 100 : 0;
      bar.style.width = Math.min(100, Math.max(0, pct)) + "%";
    };
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  /* ============================ 返回顶部 ============================ */
  function initBackTop() {
    var btn = document.getElementById("ct-backtop");
    if (!btn) return;
    var toggle = function () {
      if (window.pageYOffset > 300) btn.classList.add("show");
      else btn.classList.remove("show");
    };
    window.addEventListener("scroll", toggle, { passive: true });
    btn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    toggle();
  }

  /* ============================ 图片灯箱 ============================ */
  function initLightbox() {
    var box = document.getElementById("ct-lightbox");
    if (!box) return;
    var img = box.querySelector("img");
    var close = function () {
      box.classList.remove("show");
      if (img) img.removeAttribute("src");
    };
    document.addEventListener("click", function (e) {
      var target = e.target;
      if (target && target.tagName === "IMG" && target.closest(".post-container")) {
        e.preventDefault();
        e.stopPropagation();
        if (img) img.src = target.currentSrc || target.src;
        box.classList.add("show");
      }
    });
    box.addEventListener("click", close);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && box.classList.contains("show")) close();
    });
  }

  /* ============================ 代码块复制 ============================ */
  function codeTextOf(block) {
    var scoped = block.querySelector("td.rouge-code pre") || block.querySelector("pre code") || block.querySelector("pre");
    return scoped ? scoped.innerText : block.innerText;
  }

  function initCopyCode() {
    var blocks = document.querySelectorAll(".post-container .highlight, .post-container > pre");
    if (!blocks.length || !navigator.clipboard) return;
    Array.prototype.forEach.call(blocks, function (block) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ct-copy-btn";
      btn.textContent = "复制";
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        navigator.clipboard.writeText(codeTextOf(block)).then(
          function () {
            btn.textContent = "已复制";
            toast("代码已复制");
            setTimeout(function () {
              btn.textContent = "复制";
            }, 1500);
          },
          function () {
            btn.textContent = "复制失败";
          }
        );
      });
      block.appendChild(btn);
    });
  }

  /* ============================ 社交分享 ============================ */
  function initShare() {
    var box = document.querySelector(".ct-share");
    if (!box) return;
    var url = box.dataset.url || window.location.href;
    var title = box.dataset.title || document.title;

    box.addEventListener("click", function (e) {
      var el = e.target.closest("[data-ct-share]");
      if (!el) return;
      e.preventDefault();
      var kind = el.dataset.ctShare;
      if (kind === "copy") {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(
            function () {
              toast("链接已复制");
            },
            function () {
              toast("复制失败，请手动复制");
            }
          );
        } else {
          toast("当前浏览器不支持自动复制");
        }
      } else if (kind === "wechat") {
        // 桌面端无法唤起微信，展开二维码让用户扫码到手机后再转发；
        // 触屏设备直接走系统分享面板（微信会出现在其中），不支持时退回复制链接。
        var qr = box.querySelector(".ct-share-qr");
        var touch = window.matchMedia("(pointer: coarse)").matches;
        if (touch && navigator.share) {
          navigator.share({ title: title, url: url }).catch(function () {});
        } else if (!touch && qr) {
          qr.hidden = !qr.hidden;
          el.setAttribute("aria-expanded", qr.hidden ? "false" : "true");
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(function () {
            toast("链接已复制，请在微信中粘贴分享");
          }, function () {
            toast("复制失败，请手动复制地址栏链接");
          });
        } else {
          toast("请手动复制地址栏链接后分享");
        }
      } else if (kind === "native") {
        if (navigator.share) {
          navigator.share({ title: title, url: url }).catch(function () {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(function () {
            toast("链接已复制");
          });
        }
      }
    });

    if (!navigator.share) {
      var nativeBtn = box.querySelector('[data-ct-share="native"]');
      if (nativeBtn) nativeBtn.style.display = "none";
    }
  }

  /* ============================ 初始化 ============================ */
  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    initTheme();
    initProgress();
    initBackTop();
    initLightbox();
    initCopyCode();
    initShare();
  });
})();