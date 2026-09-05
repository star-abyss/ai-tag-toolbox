"use strict";

/*
 * App 的浏览器视图层。
 *
 * 这里没有业务状态仓库：标签、图片集合、设置、预设、世界书和会话都由
 * AppModules 的公开 API 持有。本文件只把 DOM 事件翻译成模块命令，再把
 * 返回的快照画出来；这样换页面样式不会牵动 AI/图片实现。
 */
(function installAppView(global) {
  function createAppView(modules, documentRef = global.document) {
    const doc = documentRef;
    const tags = modules.tags;
    const images = modules.images;
    const imageStore = modules.imageStore || null;
    const translation = modules.translation;
    const assistant = modules.assistant;
    const imageRepository = modules.imageRepository || assistant?.imageRepository || null;
    const visionTempStore = modules.visionTempStore || assistant?.visionTempStore || null;
    const prompts = modules.prompts;
    const comfy = modules.comfy;
    const ui = {
      route: "tags",
      aiTab: "talk",
      talkMode: "assistant",
      favoritesOpen: false,
      visionResult: null,
      visionOpen: false,
      visionDescription: "",
      visionBusy: false,
      visionAbort: null,
      visionRequestId: 0,
      visionUploadId: 0,
      lastImageContext: "",
      visible: 400,
      subcategory: "",
      locale: "zh-CN",
      translateTimer: null,
      translateRefsTimer: null,
      translateRequestId: 0,
      searchTimer: null,
      searchPrecision: "standard",
      tagPageCache: new Map(),
      pendingWorldEntries: [],
      confirmAction: null,
      thinkingOpen: Object.create(null),
      thinkingScroll: Object.create(null),
      candidatePreviews: Object.create(null),
      gallerySelected: new Set(),
      galleryOrder: "oldest",
      galleryQuery: "",
      galleryColumns: "two",
      gallerySize: "standard",
      aiTabBeforeGallery: "talk",
      comfyFollow: { "#talkConv": true },
      comfyCapabilities: null,
      started: false,
    };
    const talkVisionFold = { builtin: null, model: null, description: false };
    const $ = (s, root = doc) => root.querySelector(s);
    const $$ = (s, root = doc) => [...root.querySelectorAll(s)];
    const str = (v, fallback = "") => {
      const value = v == null ? "" : String(v).trim();
      return value || fallback;
    };
    function normaliseSearchPrecision(value) {
      const raw = str(value, "standard").toLowerCase();
      if (["exact", "strict", "high", "精确", "高"].includes(raw)) return "exact";
      if (["broad", "loose", "fuzzy", "low", "宽松", "低"].includes(raw)) return "broad";
      return "standard";
    }
    const storage = {
      get(key, fallback = null) {
        try {
          return modules.storage?.get?.(key, fallback) ?? fallback;
        } catch {
          return fallback;
        }
      },
      set(key, value) {
        try {
          modules.storage?.set?.(key, value);
        } catch {
          /* 页面仍可继续使用 */
        }
      },
    };
    const notify = (message) => {
      const el = $("#toast");
      if (!el) return;
      el.textContent = str(message);
      el.classList.add("show");
      clearTimeout(notify.timer);
      notify.timer = setTimeout(() => el.classList.remove("show"), 1800);
    };
    const show = (selector, yes) => {
      const el = $(selector);
      if (el) el.style.display = yes ? "" : "none";
    };
    const put = (selector, value) => {
      const el = $(selector);
      if (el) el.textContent = str(value);
    };
    const copy = async (value) => {
      try {
        await navigator.clipboard?.writeText?.(str(value));
        return true;
      } catch {
        return false;
      }
    };
    function showChipToast(target, message = "已复制") {
      if (!target) return;
      const toast = doc.createElement("span");
      toast.className = "chip-toast";
      toast.textContent = message;
      doc.body.appendChild(toast);
      const rect = target.getBoundingClientRect();
      toast.style.left = (rect.left + rect.width / 2) + "px";
      if (rect.top < 38) {
        toast.style.top = (rect.bottom + 8) + "px";
        toast.style.transform = "translateX(-50%)";
      } else {
        toast.style.top = (rect.top - 7) + "px";
      }
      setTimeout(() => toast.remove(), 950);
    }
    const clone = (value) =>
      value == null ? value : JSON.parse(JSON.stringify(value));

    function tagSnapshot() {
      const snap = tags?.stateSnapshot?.() || tags?.snapshot?.() || {};
      const categories =
        snap.categories ||
        tags?.getCategories?.() ||
        tags?.categories?.() ||
        [];
      return {
        categories,
        categoryCounts: snap.categoryCounts || {},
        query: str(snap.query),
        category: str(snap.category, "quality"),
        adult: Boolean(snap.includeAdult),
        precision: normaliseSearchPrecision(snap.searchPrecision || ui.searchPrecision),
        revision: Number(snap.revision) || 0,
        selected: snap.selected || tags?.selected?.() || [],
      };
    }
    function localized(key, fallback = "") {
      const pack = modules.locales?.[ui.locale] || {};
      const value = str(key).split(".").reduce((object, part) => object && object[part], pack);
      return typeof value === "string" ? value : fallback;
    }
    function galleryText(key, fallback = "", values = {}) {
      return formatText(localized(`ui.gallery.${key}`, fallback), values);
    }
    const navActionConfig = {
      ai: { selector: "#aiBtn", idleKey: "ui.header.aiAssistant", activeKey: "ui.header.backHome", idle: ["🤖 AI 助手", "🤖 AI Assistant"], active: ["← 返回主页", "← Back home"], run: () => route(ui.route === "ai" ? "tags" : "ai") },
      translation: { selector: "#translateBtn", idleKey: "ui.header.translation", activeKey: "ui.header.backHome", idle: ["🌐 翻译", "🌐 Translate"], active: ["← 返回主页", "← Back home"], run: () => route(ui.route === "translation" ? "tags" : "translation") },
      vision: { selector: "#visionBtn", idleKey: "ui.header.vision", activeKey: "ui.header.visionClose", idle: ["🔍 识图", "🔍 Vision"], active: ["✕ 关闭识图", "✕ Close vision"], run: () => setVisionOpen(!ui.visionOpen) },
      gallery: { selector: "#galleryBtn", idleKey: "ui.header.gallery", activeKey: "ui.header.backHome", idle: ["🖼 图片库", "🖼 Gallery"], active: ["← 返回主页面", "← Back home"], run: () => route(ui.route === "gallery" ? "tags" : "gallery") },
      favorites: { selector: "#favBtn", idleKey: "ui.header.favorites", activeKey: "ui.header.favoritesClose", idle: ["⭐ 收藏组合", "⭐ Favorites"], active: ["✕ 关闭收藏组合", "✕ Close favorites"], run: () => toggleFavoriteDrawer() },
      adult: { selector: "#nsfwBtn", idleKey: "ui.header.adult", activeKey: "ui.header.adultClose", idle: ["○ 成人标签：关", "○ Adult tags: off"], active: ["● 成人标签：开", "● Adult tags: on"], run: () => toggleAdultTags() },
      sponsor: { selector: "#sponsorBtn", idleKey: "ui.header.sponsor", idle: ["❤️ 赞助作者", "❤️ Sponsor"], run: () => $("#sponsorModal")?.classList.add("show") },
      theme: { selector: "#themeBtn", idleKey: "ui.header.style", idle: ["🎨 样式", "🎨 Style"], run: event => toggleThemeMenu(event) },
      locale: { selector: "#localeBtn", idleKey: "ui.header.language", idle: ["文/A", "文/A"], run: () => toggleLocaleMenu() },
    };
    function syncNavAction(name, active) {
      const config = navActionConfig[name];
      const button = config ? $(config.selector) : null;
      if (!button) return;
      const english = ui.locale === "en-US" ? 1 : 0;
      const useActive = Boolean(active && config.activeKey && config.active);
      const fallback = (useActive ? config.active : config.idle)[english];
      button.classList.toggle("on", useActive);
      if (config.activeKey) button.setAttribute("aria-pressed", useActive ? "true" : "false");
      else button.removeAttribute("aria-pressed");
      button.dataset.navState = useActive ? "active" : "idle";
      button.textContent = localized(useActive ? config.activeKey : config.idleKey, fallback);
      if (name === "vision" || name === "favorites") button.setAttribute("aria-expanded", useActive ? "true" : "false");
      if (name === "vision" || name === "favorites") button.title = button.textContent;
    }
    function syncNavigationStates() {
      syncNavAction("ai", ui.route === "ai");
      syncNavAction("translation", ui.route === "translation");
      syncNavAction("vision", ui.visionOpen);
      syncNavAction("gallery", ui.route === "gallery");
      syncNavAction("favorites", ui.favoritesOpen);
      syncNavAction("adult", tagSnapshot().adult);
      syncNavAction("sponsor", false);
      syncNavAction("theme", false);
      syncNavAction("locale", false);
    }
    function categoryLabel(id, fallback = "") {
      const pack = modules.locales?.[ui.locale] || {};
      return pack.categories?.[id] || fallback || id;
    }
    function formatText(template, values = {}) {
      return String(template || "").replace(/\{(\w+)\}/g, (_match, key) => values[key] == null ? "" : String(values[key]));
    }
    function normalTag(item) {
      if (typeof item === "string")
        return {
          id: item.toLowerCase(),
          en: item,
          zh: "",
          aliases: [],
          category: "other",
          subcategory: "默认",
          nsfw: false,
        };
      return item || {};
    }
    const categoryColors = {
      quality: "#4967D8", negative: "#C2413A", character: "#6E5ACB", character_names: "#7659A8", body: "#258F83",
      expression: "#B9770E", eyes: "#1E8FA5", hair: "#8A5A9E", features: "#7A63B8",
      outfit: "#2A8C6F", footwear: "#2A8F88", accessory: "#B46A2C", pose: "#5564C7",
      scene: "#AF7413", camera: "#3C75B8", style: "#8B63A8", time_weather: "#3D8A5A",
      atmosphere: "#AD5D83", effects: "#B34A46", food: "#A27A16", animal: "#B76832",
      other: "#64748B", rating: "#9B7B1F", series: "#287EA4", nsfw: "#E85D9F",
    };
    function categoryColor(id) {
      return categoryColors[String(id || "").toLowerCase()] || "#94A3B8";
    }
    function selected() {
      return tags?.selected?.() || tagSnapshot().selected || [];
    }
    function selectedIds() {
      return selected()
        .map((item) => str(item?.id || item?.en).toLowerCase())
        .filter(Boolean);
    }
    function restoreTags() {
      tags?.restore?.();
    }
    function tagRows() {
      const snap = tagSnapshot();
      const cacheKey = [
        snap.query,
        snap.category,
        snap.precision,
        snap.adult ? "adult" : "safe",
        snap.revision || 0,
        ui.subcategory,
        ui.visible,
        tags?.size?.() || 0,
        JSON.stringify(snap.categoryCounts || {}),
      ].join("\u0001");
      const cached = ui.tagPageCache.get(cacheKey);
      if (cached) return cached;
      const page = tags?.page?.({
        query: snap.query,
        category: snap.query ? "" : snap.category,
        includeAdult: snap.adult,
        subcategory: snap.query ? "" : ui.subcategory,
        precision: snap.precision,
        offset: 0,
        limit: ui.visible,
      }) || { items: [], total: 0, hasMore: false };
      if (ui.tagPageCache.size >= 24) {
        const oldest = ui.tagPageCache.keys().next().value;
        if (oldest != null) ui.tagPageCache.delete(oldest);
      }
      ui.tagPageCache.set(cacheKey, page);
      return page;
    }
    function executeSearch() {
      const query = str($("#q")?.value);
      if (ui.route !== "tags") route("tags");
      ui.subcategory = "";
      ui.visible = 400;
      tags?.setQuery?.(query);
      renderCategories();
      renderTags();
    }
    function renderCategories() {
      const host = $("#catList");
      if (!host) return;
      const snap = tagSnapshot();
      host.replaceChildren();
      const known = new Set(snap.categories.map((item) => item.id));
      const dynamic = Object.keys(snap.categoryCounts).filter(id => id !== 'all' && !known.has(id)).map((id) => ({
        id,
        name: categoryLabel(id, String(id).startsWith("wd_") ? (ui.locale === "en-US" ? `Vision · ${String(id).replace(/^wd_/, "")}` : `识图·${String(id).replace(/^wd_/, "")}`) : (ui.locale === "en-US" ? `Custom · ${id}` : `自定义·${id}`)),
        icon: String(id).startsWith("wd_") ? "🧠" : "🏷️",
      }));
      const rows = [
        { id: "all", name: "全部标签", icon: "📦" },
        ...snap.categories,
        ...dynamic,
      ];
      const seen = new Set();
      rows.forEach((category) => {
        if (!category || seen.has(category.id)) return;
        seen.add(category.id);
        const count = snap.categoryCounts[category.id] || 0;
        const button = doc.createElement("button");
        button.className = `cat btn btn-menu${snap.category === category.id ? " on" : ""}${category.neg ? " neg" : ""}${category.nsfw ? " nsfw" : ""}`;
        button.dataset.cat = category.id;
        button.style.setProperty("--cat-color", categoryColor(category.id));
        const label = category.id === "all" ? localized("ui.tag.all", category.name || category.id) : categoryLabel(category.id, category.name || category.id);
        button.innerHTML = `<span class="cico">${category.icon || "🏷️"}</span><span>${label}</span><span class="n">${count}</span>`;
        host.appendChild(button);
      });
      const adult = $("#aiNsfwChk");
      if (adult) adult.checked = snap.adult;
      syncNavAction("adult", snap.adult);
    }
    function renderCustomCategories() {
      const select = $("#nCat");
      if (!select) return;
      select.replaceChildren();
      const rows = tagSnapshot().categories.filter(
        (item) => item.id && !String(item.id).startsWith("wd_"),
      );
      rows.forEach((item) => {
        const option = doc.createElement("option");
        option.value = item.id;
        option.textContent = categoryLabel(item.id, item.name || item.id);
        select.appendChild(option);
      });
      const create = doc.createElement("option");
      create.value = "__new__";
      create.textContent = "＋ 新建分类…";
      select.appendChild(create);
      const other = doc.createElement("option");
      other.value = "other";
      other.textContent = "其他";
      select.appendChild(other);
    }
    function renderCustomList() {
      const host = $("#customList");
      if (!host) return;
      const custom = tags?.customTags?.() || [];
      host.replaceChildren();
      if (!custom.length) {
        host.innerHTML = '<div class="empty" style="padding:12px 0">还没有自定义标签</div>';
        return;
      }
      custom.slice().reverse().forEach((item) => {
        const row = doc.createElement("div");
        row.className = "crow";
        row.innerHTML = '<span class="cen"></span><span class="czh"></span><button class="cdel btn btn-icon btn-danger">✕</button>';
        $(".cen", row).textContent = item.en || item.id;
        $(".czh", row).textContent = item.zh || "";
        $(".cdel", row).onclick = () => confirm(`确定删除自定义 Tag「${item.en || item.id}」吗？`, () => {
          tags?.removeCustom?.(item.id || item.en);
          renderCustomList();
          renderCategories();
          renderTags();
        });
        host.appendChild(row);
      });
    }
    function renderSubcategoryNav(snap = tagSnapshot()) {
      const host = $("#subcatNav");
      if (!host) return;
      host.replaceChildren();
      host.hidden = true;
      const category = str(snap.category);
      if (snap.query || !category || category === "all") return;
      const entries = tags?.subcategories?.(category, { includeAdult: snap.adult }) || [];
      if (entries.length <= 1) return;
      const color = categoryColor(category);
      const allCount = entries.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
      const rows = [{ name: "", label: localized("ui.tag.all", "全部"), count: allCount }, ...entries.map(item => ({
        name: str(item.name, "默认"),
        label: str(item.name, "默认"),
        count: Number(item.count) || 0,
      }))];
      rows.forEach((item) => {
        const button = doc.createElement("button");
        const active = (ui.subcategory || "") === item.name;
        button.type = "button";
        button.className = "subcat-btn btn btn-menu";
        if (active) button.classList.add("on");
        button.style.setProperty("--subcat-color", color);
        button.dataset.subcategory = item.name;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", active ? "true" : "false");
        const label = doc.createElement("span");
        label.textContent = item.label;
        const count = doc.createElement("span");
        count.className = "n";
        count.textContent = String(item.count);
        button.append(label, count);
        host.appendChild(button);
      });
      host.hidden = false;
    }
    function renderTags() {
      const host = $("#chips");
      if (!host) return;
      const snap = tagSnapshot();
      const page = tagRows();
      const rows = page.items || [];
      renderSubcategoryNav(snap);
      const clearSearch = $("#clearQ");
      if (clearSearch) clearSearch.style.display = snap.query ? "" : "none";
      const chosen = new Set(selectedIds());
      host.replaceChildren();
      put(
        "#catTitle",
        snap.query
          ? `🔍 ${localized("ui.tag.search", ui.locale === "en-US" ? "Search" : "搜索")}: ${snap.query}`
          : categoryLabel(snap.category, snap.categories.find((item) => item.id === snap.category)?.name || localized("ui.tag.all", "标签")),
      );
      put("#catCnt", formatText(localized("ui.tag.tagCount", "{count} 个"), { count: page.total ?? rows.length }));
      const shown = rows;
      const groups = new Map();
      shown.forEach((raw) => {
        const item = normalTag(raw);
        const key = str(item.subcategory || item.sub || item.group, "默认");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      });
      if (!shown.length) {
        host.innerHTML = `<div class="empty">${localized("ui.tag.noMatch", "没有匹配的 Tag")}</div>`;
        return;
      }
      groups.forEach((items, group) => {
        const section = doc.createElement("section");
        section.className = "group";
        section.style.setProperty("--group-color", categoryColor(items[0]?.category));
        section.innerHTML = `<div class="group-head"><span class="name">${group}</span><span class="line"></span><span class="n">${items.length} 个</span></div>`;
        const row = doc.createElement("div");
        row.className = "chips";
        items.forEach((item) => {
          const button = doc.createElement("button");
          button.className = `chip btn btn-chip${chosen.has(str(item.id || item.en).toLowerCase()) ? " sel" : ""}${item.nsfw ? " nsfw" : ""}`;
          button.dataset.en = str(item.id || item.en).toLowerCase();
          button.style.setProperty("--c", categoryColor(item.category));
          button.innerHTML = `<span class="en">${item.en || ""}</span><span class="zh">${item.zh || (item.aliases || item.al || []).join(" ")}</span><span class="cp">${localized("ui.tag.copyOnly", "仅复制")}</span>`;
          row.appendChild(button);
        });
        section.appendChild(row);
        host.appendChild(section);
      });
      if (page.hasMore) {
        const more = doc.createElement("button");
        more.className = "abtn ghost btn btn-ghost loadmore";
          more.textContent = formatText(localized("ui.tag.loadMore", "继续加载（{shown}/{total}）"), { shown: shown.length, total: page.displayTotal ?? page.total });
        more.onclick = () => {
          ui.visible += 400;
          renderTags();
        };
        host.appendChild(more);
      }
    }
    function renderSelection() {
      const rows = selected();
      const host = $("#selbox");
      put("#selCount", rows.length);
      if (!host) return;
      host.replaceChildren();
      if (!rows.length)
        host.innerHTML =
          '<span class="emptyhint">点击上方标签即可选中，支持多选</span>';
      rows.forEach((item) => {
        const chip = doc.createElement("span");
        chip.className = "schip";
        chip.innerHTML = `<span>${item.en || item.id}</span><button class="btn btn-icon btn-danger" data-remove="${item.id || item.en}">✕</button>`;
        host.appendChild(chip);
      });
      put("#preview", rows.map((item) => item.en || item.id).join(", "));
    }
    function syncSelectedClasses() {
      const chosen = new Set(selectedIds());
      $$("#chips [data-en]").forEach((button) => button.classList.toggle("sel", chosen.has(button.dataset.en)));
    }
    function renderFavorites() {
      const host = $("#favList");
      if (!host) return;
      host.replaceChildren();
      (assistant?.listFavorites?.() || []).forEach((item) => {
        const row = doc.createElement("div");
        row.className = "fav";
        row.innerHTML = `<b>${item.name || "未命名收藏"}</b><div class="row"><button class="abtn btn btn-secondary load">载入</button><button class="abtn btn btn-secondary add">追加</button><button class="abtn ghost btn btn-danger del">删除</button></div>`;
        row.querySelector(".load").onclick = () => {
          tags?.clearSelection?.();
          (item.tags || []).forEach((id) => tags?.select?.(id, true));
          syncSelectedClasses();
          renderSelection();
          closeDrawer();
        };
        row.querySelector(".add").onclick = () => {
          (item.tags || []).forEach((id) => tags?.select?.(id, true));
          syncSelectedClasses();
          renderSelection();
        };
        row.querySelector(".del").onclick = () => confirm(`确定删除收藏组合「${item.name || "未命名收藏"}」吗？`, () => { assistant?.removeFavorite?.(item.id); renderFavorites(); });
        host.appendChild(row);
      });
    }
    function openDrawer() {
      if (ui.visionOpen) setVisionOpen(false);
      ui.favoritesOpen = true;
      $("#drawer")?.classList.add("show");
      syncNavAction("favorites", true);
      syncScrim();
      renderFavorites();
    }
    function closeDrawer() {
      ui.favoritesOpen = false;
      $("#drawer")?.classList.remove("show");
      syncNavAction("favorites", false);
      syncScrim();
    }
    function toggleFavoriteDrawer() {
      if (ui.favoritesOpen) closeDrawer();
      else openDrawer();
    }
    function toggleAdultTags() {
      tags?.setAdult?.(!tagSnapshot().adult);
      renderCategories();
      renderTags();
    }
    function syncScrim() {
      const drawerOpen = $("#drawer")?.classList.contains("show");
      $("#scrim")?.classList.toggle("show", Boolean(drawerOpen || ui.visionOpen));
      doc.body.classList.toggle("vision-open", ui.visionOpen);
      if (ui.visionOpen) syncVisionPaneOffset();
    }
    function syncVisionPaneOffset() {
      const header = $("header");
      const bottom = Number(header?.getBoundingClientRect?.().bottom || header?.offsetHeight || 63);
      const sidebar = $("#sidebar");
      const pane = $("#tagPane");
      const sidebarRect = sidebar?.getBoundingClientRect?.();
      const paneRect = pane?.getBoundingClientRect?.();
      const narrow = Number(global.innerWidth || 0) <= 900;
      const sidebarVisible = sidebar && sidebar.style.display !== "none" && Number(sidebarRect?.width || sidebar.offsetWidth || 0) > 0;
      const sidebarWidth = !narrow && sidebarVisible
        ? Number(sidebarRect?.width || sidebar.offsetWidth || 0)
        : 0;
      const paneWidth = Number(paneRect?.width || pane?.offsetWidth || 0);
      // On narrow AI layouts the repository occupies the first block of the
      // column. Place the Vision drawer below it so neither the drawer nor the
      // scrim steals repository hit targets.
      const paneTop = narrow && ui.visionOpen && doc.body.classList.contains("aiview") && sidebarVisible
        ? bottom + Number(sidebarRect?.height || sidebar?.offsetHeight || 0)
        : bottom;
      const root = doc.documentElement;
      root.style.setProperty("--vision-pane-top", `${Math.max(0, Math.ceil(paneTop))}px`);
      root.style.setProperty("--vision-scrim-top", `${Math.max(0, Math.ceil(narrow ? paneTop : bottom))}px`);
      root.style.setProperty("--vision-scrim-left", `${Math.max(0, Math.ceil(sidebarWidth))}px`);
      root.style.setProperty("--vision-scrim-right", `${Math.max(0, Math.ceil(narrow ? 0 : paneWidth))}px`);
    }
    function setVisionOpen(value) {
      ui.visionOpen = Boolean(value);
      syncVisionPaneOffset();
      if (ui.visionOpen && ui.favoritesOpen) closeDrawer();
      const pane = $("#tagPane");
      pane?.classList.toggle("vision-open", ui.visionOpen);
      syncNavAction("vision", ui.visionOpen);
      const button = $("#visionBtn");
      if (button) button.setAttribute("aria-expanded", ui.visionOpen ? "true" : "false");
      syncScrim();
    }

    function settings() {
      return assistant?.getSettings?.() || {};
    }
    let capabilityTimer = null;
    let capabilityRequestId = 0;
    function capabilityLabel(capabilities) {
      const comfyState = capabilities?.comfy || {};
      if (comfyState.render) return "ComfyUI 已连接 · 工作流已就绪";
      if (!comfyState.connected) return comfyState.error || "ComfyUI 未连接 · 请确认 ComfyUI 已启动，并检查「API 设置 → ComfyUI 地址」";
      if (!comfyState.enabled) return comfyState.error || "ComfyUI 已停用 · 请在绘图模式左上角打开“ComfyUI 出图”";
      if (!comfyState.workflowReady) {
        return comfyState.error || "ComfyUI 未就绪 · 请到「API 设置 → ComfyUI」上传或粘贴 API 格式工作流";
      }
      return comfyState.error || "ComfyUI 未连接 · 请确认 ComfyUI 已启动，并检查「API 设置 → ComfyUI 地址」";
    }
    function syncDrawControls(capabilities = ui.comfyCapabilities) {
      const module = $("#comfyUiModule");
      if (!module) return;
      const state = capabilities?.comfy || {};
      const inDrawMode = ui.talkMode === "draw";
      module.hidden = !inDrawMode;
      const status = $("#comfyStatus");
      const statusLabel = capabilityLabel(capabilities);
      if (status) {
        status.textContent = statusLabel;
        status.title = statusLabel;
        const connected = state.connected === true;
        const workflowReady = state.workflowReady === true;
        status.classList.toggle("is-comfy-ready", connected && workflowReady);
        status.classList.toggle("is-comfy-warning", connected && !workflowReady);
        status.classList.toggle("is-comfy-error", !connected);
      }
      const toggleWrap = $("#tkDrawRenderWrap");
      const iterationsWrap = $("#tkDrawIterationsWrap");
      const toggle = $("#tkDrawRender");
      const iterations = $("#tkDrawIterations");
      const actions = $("#tkDrawControls", module);
      if (!inDrawMode) return;
      const ready = state.connected === true && state.workflowReady === true;
      // The user's enable choice is independent from ComfyUI connectivity.
      // Keep the toggle visible and writable while showing readiness in the
      // status line; otherwise an async capability refresh can make a checked
      // toggle appear to switch itself off.
      if (actions) actions.hidden = false;
      if (toggleWrap) toggleWrap.hidden = false;
      if (toggle) {
        toggle.disabled = false;
        toggle.checked = settings().comfyOn === true;
      }
      if (ready) {
        if (iterationsWrap) iterationsWrap.hidden = false;
        if (iterations) {
          iterations.disabled = false;
          const value = Math.max(1, Math.min(20, Number(settings().maxComfyCalls) || Number(settings().comfyIters) || 3));
          iterations.value = String(value);
        }
        return;
      }
      if (iterationsWrap) iterationsWrap.hidden = true;
      if (iterations) iterations.disabled = true;
    }
    async function refreshCapabilitiesStatus(options = {}) {
      const calls = assistant?.calls;
      if (typeof calls?.refreshCapabilities !== "function") return null;
      const requestId = ++capabilityRequestId;
      let capabilities;
      try { capabilities = await calls.refreshCapabilities(options); } catch { return null; }
      if (requestId !== capabilityRequestId) return capabilities;
      ui.comfyCapabilities = capabilities;
      const label = capabilityLabel(capabilities);
      put("#comfyCapabilityHint", label);
      syncDrawControls(capabilities);
      const render = $("#tkDrawRender");
      if (render) {
        render.disabled = false;
        render.checked = settings().comfyOn === true;
      }
      const localButton = $("#tpIdentify");
      const aiButton = $("#tpDescribe");
      if (localButton) {
        localButton.disabled = !Boolean(capabilities?.vision?.local) || !currentVisionId();
        localButton.title = capabilities?.vision?.local ? "本地 WD EVA02 识图" : "本地识图模型不可用";
      }
      if (aiButton) {
        // A picture should always make the action clickable. Availability
        // errors are shown by describe() instead of being swallowed by a
        // disabled button with no feedback.
        aiButton.disabled = !currentVisionId();
        aiButton.title = capabilities?.vision?.ai
          ? "独立视觉 API 识图"
          : capabilities?.vision?.aiError || "请先配置支持图片输入的独立识图 API";
      }
      const visionHint = $("#visionCapabilityHint");
      if (visionHint && capabilities?.vision) {
        visionHint.textContent = capabilities.vision.aiError
          || (capabilities.vision.ai ? "当前识图模型支持图片输入。" : "请配置支持图片输入的识图模型。");
      }
      return capabilities;
    }
    function scheduleCapabilitiesStatus() {
      clearTimeout(capabilityTimer);
      capabilityTimer = setTimeout(() => refreshCapabilitiesStatus(), 180);
    }
    function activePreset() {
      return assistant?.getActivePreset?.() || null;
    }
    function activeWorld() {
      return assistant?.getActiveWorld?.() || null;
    }
    function renderWorldMatch(value, selector) {
      const input = str(value).toLowerCase();
      const entries = activeWorld()?.entries || [];
      const matched = entries.filter((entry) => {
        if (!entry || entry.enabled === false) return false;
        if (entry.constant === true) return true;
        const keys = String(entry.keys || entry.key || "").split(/[\s,，、;；]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
        return !keys.length || (input && keys.some((key) => input.includes(key)));
      });
      put(selector, matched.length ? `世界书命中：${matched.map((entry) => entry.name || "未命名条目").join("、")}` : "");
    }
    function ensurePromptState() {
      if (assistant && !(assistant.listPresets?.() || []).length)
        assistant.setPresets?.([
          {
            id: "preset_default",
            name: "默认主提示词",
            main: prompts?.get?.("main") || "",
            generate: prompts?.get?.("generate") || "",
            vision: prompts?.get?.("vision") || "",
            quality: prompts?.get?.("quality") || "",
          },
        ]);
      if (assistant && !(assistant.listWorlds?.() || []).length)
        assistant.setWorlds?.([
          {
            id: "world_default",
            name: "默认世界书（附录）",
            enabled: true,
            entries: (prompts?.appendices?.() || []).map((item) => ({
              id: item.id,
              name: item.title,
              content: item.text,
              keys: "",
              enabled: true,
              constant: false,
            })),
          },
        ]);
    }
    function renderPrompt() {
      ensurePromptState();
      const preset = activePreset() || {};
      const worlds = assistant?.listWorlds?.() || [];
      const presets = assistant?.listPresets?.() || [];
      const ps = $("#presetSel");
      if (ps) {
        ps.replaceChildren();
        presets.forEach((item) => {
          const option = doc.createElement("option");
          option.value = item.id;
          option.textContent = item.name;
          ps.appendChild(option);
        });
        ps.value = preset.id || "";
      }
      [
        ["#aiSys", "main"],
        ["#genTask", "generate"],
        ["#qpText", "quality"],
        ["#aiVision", "vision"],
      ].forEach(([selector, key]) => {
        const el = $(selector);
        if (el) el.value = preset[key] || prompts?.get?.(key) || "";
        const enabled = $(selector === "#aiSys" ? "#aiSysEnabled" : selector === "#genTask" ? "#genTaskEnabled" : selector === "#qpText" ? "#qpEnabled" : "#aiVisionEnabled");
        if (enabled) enabled.checked = prompts?.item?.(key)?.enabled !== false;
      });
      const ws = $("#worldSel");
      if (ws) {
        ws.replaceChildren();
        worlds.forEach((item) => {
          const option = doc.createElement("option");
          option.value = item.id;
          option.textContent = item.name;
          ws.appendChild(option);
        });
        ws.value = activeWorld()?.id || "";
      }
      const check = $("#worldEnabled");
      if (check) check.checked = activeWorld()?.enabled !== false;
      renderPromptModules();
      renderWorldCallMods();
      renderWorldCards();
      renderWorldEntries();
    }
    const promptModuleDefs = [
      ["assistant", "ui.ai.modeAssist"],
      ["draw", "ui.ai.modeDraw"],
    ];
    const promptSlotMap = { base: "main", genTask: "generate", quality: "quality", vision: "vision", system: "comfy" };
    const defaultPromptMods = {
      main: ["draw"],
      generate: ["draw"],
      quality: ["draw"],
      vision: ["assistant", "draw"],
      comfy: ["draw"],
    };
    function presetSlotMods(preset, slot) {
      const value = preset?.mods?.[slot];
      return Array.isArray(value) ? value : (defaultPromptMods[slot] || []).slice();
    }
    function renderPromptModules() {
      const preset = activePreset();
      $$(".pmod-lead .pmod-mods").forEach((host) => {
        const slot = promptSlotMap[host.parentElement?.dataset.special] || "main";
        const selected = new Set(presetSlotMods(preset, slot));
        host.replaceChildren();
        const label = doc.createElement("span");
        label.className = "pmod-mods-label";
        label.textContent = localized("ui.prompt.enabledObjects", "启用对象") + "：";
        host.appendChild(label);
        promptModuleDefs.forEach(([mod, key]) => {
          const item = doc.createElement("label");
          item.className = "pmod-chk";
          const input = doc.createElement("input");
          input.type = "checkbox";
          input.checked = selected.has(mod);
          input.onchange = () => {
            const presets = assistant?.listPresets?.() || [];
            const target = presets.find((row) => row.id === preset?.id);
            if (!target) return;
            target.mods = { ...(target.mods || {}), [slot]: [...selected] };
            if (input.checked) target.mods[slot] = [...new Set([...target.mods[slot], mod])];
            else target.mods[slot] = target.mods[slot].filter((value) => value !== mod);
            assistant?.setPresets?.(presets);
          };
          const textEl = doc.createElement("span");
          textEl.textContent = localized(key, mod);
          item.append(input, textEl);
          host.appendChild(item);
        });
      });
    }
    function renderWorldCallMods() {
      const host = $("#wbCallMods");
      if (!host) return;
      const world = activeWorld();
      host.replaceChildren();
      if (!world) return;
      const selected = new Set(Array.isArray(world.mods) && world.mods.length ? world.mods : promptModuleDefs.map(([mod]) => mod));
      promptModuleDefs.forEach(([mod, key]) => {
        const item = doc.createElement("label");
        item.className = "pmod-chk";
        const input = doc.createElement("input");
        input.type = "checkbox";
        input.checked = selected.has(mod);
        input.onchange = () => {
          const worlds = assistant?.listWorlds?.() || [];
          const target = worlds.find((row) => row.id === world.id);
          if (!target) return;
          const values = new Set(Array.isArray(target.mods) && target.mods.length ? target.mods : promptModuleDefs.map(([name]) => name));
          if (input.checked) values.add(mod); else values.delete(mod);
          target.mods = [...values];
          assistant?.setWorlds?.(worlds);
        };
        const textEl = doc.createElement("span");
        textEl.textContent = localized(key, mod);
        item.append(input, textEl);
        host.appendChild(item);
      });
    }
    function renderWorldCards() {
      const host = $("#worldCards");
      if (!host) return;
      host.replaceChildren();
      (assistant?.listWorlds?.() || []).forEach((world) => {
        const card = doc.createElement("div");
        card.className = `world-card${world.id === activeWorld()?.id ? " on" : ""}`;
        card.innerHTML = `<span>${world.name}</span><span class="muted">${(world.entries || []).length} 条</span><button class="abtn ghost btn btn-danger">删除</button>`;
        $("span", card).onclick = () => {
          assistant?.selectWorld?.(world.id);
          renderPrompt();
        };
        $("button", card).onclick = () => {
          if ((assistant?.listWorlds?.() || []).length <= 1) return notify("至少保留一本世界书");
          confirm(`确定删除世界书「${world.name}」吗？`, () => { assistant?.removeWorld?.(world.id); renderPrompt(); });
        };
        host.appendChild(card);
      });
    }
    function renderWorldEntries() {
      const host = $("#wbList");
      const world = activeWorld();
      if (!host || !world) return;
      host.replaceChildren();
      (world.entries || []).forEach((entry, index) => {
        const row = doc.createElement("div");
        row.className = "wbi";
        row.innerHTML = `<div class="wi-head"><input class="wi-name"><label><input class="wi-enabled" type="checkbox">启用</label><label><input class="wi-constant" type="checkbox">常驻</label><button class="abtn ghost btn btn-danger wi-del">删除</button></div><input class="wi-keys" placeholder="触发关键词（空=常驻）"><textarea class="wi-content" rows="3"></textarea>`;
        $(".wi-name", row).value = entry.name || "";
        $(".wi-keys", row).value = entry.keys || "";
        $(".wi-content", row).value = entry.content || "";
        $(".wi-enabled", row).checked = entry.enabled !== false;
        $(".wi-constant", row).checked = entry.constant === true;
        const update = (patch) => {
          const worlds = assistant?.listWorlds?.() || [];
          const target = worlds.find((item) => item.id === world.id);
          if (!target) return;
          target.entries[index] = { ...target.entries[index], ...patch };
          assistant?.setWorlds?.(worlds);
        };
        $(".wi-name", row).onchange = (e) => update({ name: e.target.value });
        $(".wi-keys", row).onchange = (e) => update({ keys: e.target.value });
        $(".wi-content", row).onchange = (e) =>
          update({ content: e.target.value });
        $(".wi-enabled", row).onchange = (e) =>
          update({ enabled: e.target.checked });
        $(".wi-constant", row).onchange = (e) =>
          update({ constant: e.target.checked });
        $(".wi-del", row).onclick = () => confirm(`确定删除条目「${entry.name || "未命名条目"}」吗？`, () => {
          const worlds = assistant?.listWorlds?.() || [];
          const target = worlds.find((item) => item.id === world.id);
          if (target) { target.entries.splice(index, 1); assistant?.setWorlds?.(worlds); renderWorldEntries(); }
        });
        host.appendChild(row);
      });
    }
    function savePreset() {
      const current = activePreset();
      if (!current) return;
      const all = assistant?.listPresets?.() || [];
      const target = all.find((item) => item.id === current.id);
      if (!target) return;
      target.main = $("#aiSys")?.value || "";
      target.generate = $("#genTask")?.value || "";
      target.quality = $("#qpText")?.value || "";
      target.vision = $("#aiVision")?.value || "";
      assistant?.setPresets?.(all);
      notify("提示词预设已保存");
    }
    function download(name, value) {
      const link = doc.createElement("a");
      link.href = URL.createObjectURL(
        new Blob(
          [typeof value === "string" ? value : JSON.stringify(value, null, 2)],
          { type: "application/json" },
        ),
      );
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 500);
    }
    function readJson(file, callback) {
      if (!file) return;
      readText(file).then((value) => {
        try {
          callback(JSON.parse(value));
        } catch {
          notify("JSON 文件格式不正确");
        }
      });
    }
    function normaliseImportedEntry(entry, index) {
      const value = entry && typeof entry === "object" ? entry : { content: entry };
      return {
        id: str(value.id, `entry_import_${Date.now()}_${index}`),
        name: str(value.name || value.title, `条目 ${index + 1}`),
        keys: Array.isArray(value.key) ? value.key.join(" ") : str(value.keys || value.key),
        content: str(value.content || value.text || value.value),
        enabled: value.enabled !== false,
        constant: Boolean(value.constant),
      };
    }
    function openWorldImport(data) {
      const incoming = Array.isArray(data) ? data : data?.worlds || [data];
      ui.pendingWorldEntries = [];
      incoming.filter((world) => world && world.entries).forEach((world, wi) => {
        const entries = Array.isArray(world.entries) ? world.entries : Object.values(world.entries || {});
        entries.forEach((entry, ei) => ui.pendingWorldEntries.push({
          ...normaliseImportedEntry(entry, `${wi}_${ei}`),
          worldName: str(world.name, "导入世界书"),
        }));
      });
      const list = $("#wbImportList");
      if (!list || !ui.pendingWorldEntries.length) return notify("没有找到可导入的世界书条目");
      list.replaceChildren();
      ui.pendingWorldEntries.forEach((entry, index) => {
        const row = doc.createElement("label");
        row.className = "wbimp";
        row.innerHTML = '<input type="checkbox" checked><div class="wi-body"><div class="wi-name"></div><div class="wi-prev"></div></div>';
        $("input", row).dataset.index = String(index);
        $(".wi-name", row).textContent = `${entry.worldName} · ${entry.name}`;
        $(".wi-prev", row).textContent = entry.content || "（空内容）";
        list.appendChild(row);
      });
      $("#wbModal")?.classList.add("show");
    }
    function closeWorldImport() { $("#wbModal")?.classList.remove("show"); ui.pendingWorldEntries = []; }
    function importSelectedWorldEntries() {
      const selected = $$("#wbImportList input[type=checkbox]").filter((input) => input.checked).map((input) => ui.pendingWorldEntries[Number(input.dataset.index)]).filter(Boolean);
      if (!selected.length) return notify("请至少选择一条世界书条目");
      const grouped = new Map();
      selected.forEach((entry) => { const key = entry.worldName || "导入世界书"; if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(entry); });
      grouped.forEach((entries, name) => assistant?.addWorld?.({ name, enabled: true, entries }));
      closeWorldImport();
      renderPrompt();
      notify(`已导入 ${selected.length} 条世界书条目`);
    }
    function confirm(message, action, options = {}) {
      const modal = $("#cfmModal");
      if (!modal) return action?.();
      const retainWrap = $("#cfmRetainImagesWrap");
      const retain = $("#cfmRetainImages");
      if (retainWrap) retainWrap.hidden = options.retainImages !== true;
      if (retain) retain.checked = false;
      ui.confirmAction = () => action?.(Boolean(retain?.checked));
      put("#cfmText", message);
      modal.classList.add("show");
    }

    function formValue(selector, fallback = "") {
      const field = $(selector);
      return field ? String(field.value ?? "").trim() : String(fallback ?? "").trim();
    }

    function workflowText(value) {
      if (typeof value === "string") return value;
      if (!value || typeof value !== "object") return "";
      try { return JSON.stringify(value, null, 2); } catch { return ""; }
    }

    let settingsSaveTimer = null;
    function scheduleSettingsSave() {
      clearTimeout(settingsSaveTimer);
      settingsSaveTimer = setTimeout(() => {
        settingsSaveTimer = null;
        if (ui.route === "ai" && ui.aiTab === "api") configFromView();
      }, 240);
    }

    function flushSettingsSave() {
      clearTimeout(settingsSaveTimer);
      settingsSaveTimer = null;
      if (ui.route === "ai" && ui.aiTab === "api") configFromView();
    }

    function configFromView(options = {}) {
      const s = settings();
      const inheritedVision = $("#visionInheritPrimary")?.checked ?? s.visionInheritPrimary !== false;
      const patch = {
        base: formValue("#aiBase", s.base).replace(/\/+$/, ""),
        model:
          $("#aiModel")?.value === "__custom__"
            ? formValue("#aiModelCustom", s.model)
            : $("#aiModel")?.value === "__loading__"
              ? s.model
              : formValue("#aiModel", s.model),
        key: formValue("#aiKey", s.key),
        visionInheritPrimary: $("#visionInheritPrimary") ? Boolean($("#visionInheritPrimary").checked) : s.visionInheritPrimary !== false,
        visionBase: formValue("#visionBase", s.visionBase).replace(/\/+$/, ""),
        visionKey: formValue("#visionKey", s.visionKey),
        // The model selector is informational while inherit mode is on. Keep
        // a saved independent choice for the moment the user turns inherit
        // off, but never let it shadow the primary model in that mode.
        visionModel: options.preserveVisionModel
          ? s.visionModel
          : inheritedVision
          ? s.visionModel
          : $("#visionModel")?.value === "__custom__"
            ? formValue("#visionModelCustom", s.visionModel)
            : $("#visionModel")?.value === "__loading__"
              ? s.visionModel
              : formValue("#visionModel", s.visionModel),
        visionTemperature: Number(s.visionTemperature) || 0.2,
        visionTimeoutMs: Number(s.visionTimeoutMs) || 120000,
        generateNegativeTags: $("#generateNegativeTags") ? Boolean($("#generateNegativeTags").checked) : s.generateNegativeTags === true,
        temperature: Number(s.temperature) || 0.7,
        strict: $("#aiStrict") ? $("#aiStrict").checked : s.strict !== false,
        timeoutEnabled: $("#aiTimeoutEnabled")
          ? $("#aiTimeoutEnabled").checked
          : Boolean(s.timeoutEnabled),
        timeoutSec: Math.max(
          300,
          Math.min(
            3600,
            Number($("#aiTimeoutSec")?.value) || Number(s.timeoutSec) || 300,
          ),
        ),
        comfyBase: formValue("#comfyBase", s.comfyBase).replace(/\/+$/, ""),
        comfyWorkflow: formValue("#comfyWf", s.comfyWorkflow),
        // `comfyOn` is owned by setDrawComfyEnabled(). Other API fields must
        // not copy a stale checkbox value back into persistent settings.
        comfyOn: s.comfyOn === true,
        maxComfyCalls: Math.max(
          1,
          Math.min(
            10,
            Number($("#maxComfyCalls")?.value) || Number(s.maxComfyCalls) || Number(s.comfyIters) || 3,
          ),
        ),
        batchCount: Math.max(1, Math.min(10, Number($("#batchCount")?.value) || Number(s.batchCount) || 1)),
        maxComfyCalls: Math.max(1, Math.min(20, Number($("#maxComfyCalls")?.value) || Number(s.maxComfyCalls) || 3)),
        comfyPos: formValue("#comfyPos", s.comfyPos),
        comfyNeg: formValue("#comfyNeg", s.comfyNeg),
        comfyW: Number($("#comfyW")?.value) || Number(s.comfyW) || 768,
        comfyH: Number($("#comfyH")?.value) || Number(s.comfyH) || 1024,
        comfySteps:
          Number($("#comfySteps")?.value) || Number(s.comfySteps) || 25,
        comfyCfg: Number($("#comfyCfg")?.value) || Number(s.comfyCfg) || 7,
      };
      assistant?.setSettings?.(patch);
      comfy?.setBase?.(patch.comfyBase);
      comfy?.setWorkflow?.(patch.comfyWorkflow);
      assistant?.calls?.invalidateCapabilities?.();
      scheduleCapabilitiesStatus();
      return patch;
    }
    function isLocalApi(base) {
      return /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/v1)?$/i.test(String(base || "").replace(/\/+$/, ""));
    }
    function syncApiMode() {
      const s = settings();
      const base = str($("#aiBase")?.value, s.base || "https://api.openai.com/v1").replace(/\/+$/, "");
      const local = isLocalApi(base);
      const hint = $("#aiModeHint");
      if (hint) {
        hint.className = "api-mode-hint " + (local ? "local" : "remote");
        hint.textContent = localized(local ? "ui.settings.localModeHint" : "ui.settings.remoteModeHint", local ? "本地模式：API Key 可留空，模型从本机服务读取。" : "远程模式：选择厂商后自动读取可用模型。");
      }
      const key = $("#aiKey");
      if (key) key.placeholder = local
        ? localized("ui.settings.localKeyPlaceholder", "本地模式可留空")
        : localized("ui.settings.remoteKeyPlaceholder", "输入 API Key");
      put("#aiKeyStatus", s.key
        ? localized("ui.settings.keySaved", "Key 已填写（本地保存）")
        : local
          ? localized("ui.settings.localKeyEmpty", "本地模式：API Key 可留空")
          : localized("ui.settings.remoteKeyEmpty", "未填写 API Key"));
      const inherited = $("#visionInheritPrimary")?.checked ?? s.visionInheritPrimary !== false;
      const visionFields = $("#visionApiFields");
      if (visionFields) {
        visionFields.style.opacity = inherited ? "0.72" : "";
        // Inherit mode reuses the complete primary API profile. Turn it off
        // when a separate vision address, key, or model is needed.
        ["#visionBase", "#visionKey"].forEach(selector => {
          const field = $(selector);
          if (field) field.disabled = inherited;
        });
        ["#visionModel", "#visionModelCustom"].forEach(selector => {
          const field = $(selector);
          if (field) field.disabled = inherited;
        });
      }
    }
    function loadSettings(options = {}) {
      clearTimeout(settingsSaveTimer);
      settingsSaveTimer = null;
      const s = settings();
      if ($("#aiBase"))
        $("#aiBase").value = s.base || "https://api.openai.com/v1";
      if ($("#aiPreset")) {
        const option = [...$("#aiPreset").options].find((item) => item.value === (s.base || ""));
        $("#aiPreset").value = option ? option.value : "";
      }
      if ($("#aiKey")) $("#aiKey").value = s.key || "";
      if ($("#generateNegativeTags")) $("#generateNegativeTags").checked = s.generateNegativeTags === true;
      if ($("#visionInheritPrimary")) $("#visionInheritPrimary").checked = s.visionInheritPrimary !== false;
      if ($("#visionBase")) $("#visionBase").value = s.visionBase || s.base || "https://api.openai.com/v1";
      if ($("#visionKey")) $("#visionKey").value = s.visionKey || "";
      if ($("#visionModelCustom")) $("#visionModelCustom").value = s.visionModel || "";
      syncApiMode();
      if ($("#aiStrict")) $("#aiStrict").checked = s.strict !== false;
      if ($("#aiTimeoutEnabled"))
        $("#aiTimeoutEnabled").checked = Boolean(s.timeoutEnabled);
      if ($("#aiTimeoutSec")) {
        $("#aiTimeoutSec").value = Number(s.timeoutSec) || 300;
        $("#aiTimeoutSec").disabled = !s.timeoutEnabled;
      }
      if ($("#comfyBase"))
        $("#comfyBase").value = s.comfyBase || "http://127.0.0.1:8188";
      if ($("#comfyIters")) $("#comfyIters").value = Number(s.maxComfyCalls) || Number(s.comfyIters) || 3;
      if ($("#batchCount")) $("#batchCount").value = Number(s.batchCount) || 1;
      if ($("#maxComfyCalls")) $("#maxComfyCalls").value = Number(s.maxComfyCalls) || 3;
      if ($("#tkDrawIterations")) $("#tkDrawIterations").value = String(Math.max(1, Math.min(20, Number(s.maxComfyCalls) || Number(s.comfyIters) || 3)));
      if ($("#comfyWf")) $("#comfyWf").value = workflowText(s.comfyWorkflow);
      if ($("#comfyPos")) $("#comfyPos").value = s.comfyPos || "";
      if ($("#comfyNeg")) $("#comfyNeg").value = s.comfyNeg || "";
      ["comfyW", "comfyH", "comfySteps", "comfyCfg"].forEach((key) => {
        if ($("#" + key))
          $("#" + key).value = Number(s[key]) || $("#" + key).value;
      });
      comfy?.setBase?.(s.comfyBase || "http://127.0.0.1:8188");
      comfy?.setWorkflow?.(workflowText(s.comfyWorkflow));
      populateModels({ ...options, selectedModel: s.model });
      populateVisionModels({ ...options, selectedModel: s.visionInheritPrimary !== false ? s.model : s.visionModel });
      refreshAgentStatus();
      refreshCapabilitiesStatus({ force: true });
      setTimeout(refreshAgentStatus, 300);
    }
    function refreshAgentStatus() {
      const status = modules.agent?.status?.();
      if (!status) return;
      put("#agentStatus", status.running ? `工具服务已启动：http://${status.host}:${status.port}` : "工具服务未启动");
    }
    let modelRequestId = 0;
    function modelIsVision(value) {
      return /vision|[-_]?vl(?:[-_]|$)|gpt-4o|gpt-4\.1|qwen.*vl|llava|moondream|internvl|minicpm[-_]?v|pixtral|gemma.*vision|deepseek.*(?:vision|vl)|kimi.*vision/i.test(String(value || ""));
    }
    function fallbackModels(base) {
      const values = {
        "https://api.openai.com/v1": ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
        "https://api.deepseek.com": ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash-vision-exp", "deepseek-v4-flash", "deepseek-v4-pro"],
        "https://api.deepseek.com/v1": ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash-vision-exp", "deepseek-v4-flash", "deepseek-v4-pro"],
        "https://api.siliconflow.cn/v1": ["Qwen/Qwen2.5-VL-72B-Instruct", "deepseek-ai/DeepSeek-V4-Flash-Vision-Exp", "deepseek-ai/DeepSeek-V3"],
        "http://localhost:11434/v1": ["llama3.2-vision", "qwen2.5"],
      }[base];
      return values || (isLocalApi(base) ? ["llama3.2-vision", "qwen2.5"] : []);
    }
    function syncCustomModelInput() {
      const select = $("#aiModel");
      const input = $("#aiModelCustom");
      if (!select || !input) return;
      const custom = select.value === "__custom__";
      input.style.display = custom ? "" : "none";
      if (custom && !input.value) input.value = settings().model || "";
    }
    async function populateModels(options = {}) {
      const select = $("#aiModel");
      if (!select) return [];
      const s = settings();
      const base = str($("#aiBase")?.value, s.base || "https://api.openai.com/v1").replace(/\/+$/, "");
      const savedModel = options.selectedModel === undefined ? str(s.model) : str(options.selectedModel);
      const requestId = ++modelRequestId;
      const loading = doc.createElement("option");
      loading.value = "__loading__";
      loading.textContent = localized("ui.settings.modelsLoading", "正在读取模型…");
      select.replaceChildren(loading);
      select.value = "__loading__";
      const fallback = fallbackModels(base);
      let values = fallback;
      const result = options.fetch === false ? null : await assistant?.ai?.listModels?.({ base, key: str($("#aiKey")?.value, s.key) });
      if (requestId !== modelRequestId) return values;
      if (result?.ok && Array.isArray(result.models) && result.models.length) values = result.models;
      if (result && !result.ok && options.fetch !== false) {
        const hint = $("#aiModeHint");
        if (hint) hint.textContent = fallback.length
          ? localized("ui.settings.modelFetchFailed", "未能拉取模型，已使用本地候选列表")
          : result.error || localized("ui.settings.modelFetchFailed", "未能拉取模型");
      }
      select.replaceChildren();
      [...new Set(values)].forEach((value) => {
        const option = doc.createElement("option");
        option.value = value;
        option.textContent = (modelIsVision(value) ? "👁 " : "") + value;
        if (modelIsVision(value)) option.title = "支持图片输入的视觉模型";
        select.appendChild(option);
      });
      const custom = doc.createElement("option");
      custom.value = "__custom__";
      custom.textContent = localized("ui.settings.customModel", "自定义模型…");
      select.appendChild(custom);
      if (savedModel && values.includes(savedModel)) select.value = savedModel;
      else if (savedModel) {
        select.value = "__custom__";
        if ($("#aiModelCustom")) $("#aiModelCustom").value = savedModel;
      } else select.value = values[0] || "__custom__";
      syncCustomModelInput();
      return values;
    }

    function syncVisionCustomModelInput() {
      const select = $("#visionModel");
      const input = $("#visionModelCustom");
      if (!select || !input) return;
      const custom = select.value === "__custom__";
      input.style.display = custom ? "" : "none";
      if (custom && !input.value) input.value = settings().visionModel || "";
    }

    let visionModelRequestId = 0;
    async function populateVisionModels(options = {}) {
      const select = $("#visionModel");
      if (!select) return [];
      const s = settings();
      const inherited = $("#visionInheritPrimary")?.checked ?? s.visionInheritPrimary !== false;
      const primaryModel = str(s.model);
      const base = (inherited
        ? str($("#aiBase")?.value, s.base || "https://api.openai.com/v1")
        : str($("#visionBase")?.value, s.visionBase || s.base || "https://api.openai.com/v1")).replace(/\/+$/, "");
      const savedModel = options.selectedModel === undefined
        ? (inherited ? primaryModel : str(s.visionModel))
        : str(options.selectedModel);
      const requestId = ++visionModelRequestId;
      const loading = doc.createElement("option");
      loading.value = "__loading__";
      loading.textContent = localized("ui.settings.modelsLoading", "正在读取模型…");
      select.replaceChildren(loading);
      const fallback = fallbackModels(base);
      let values = fallback;
      const client = inherited ? assistant?.ai : assistant?.visionAi;
      const key = inherited ? str($("#aiKey")?.value, s.key) : str($("#visionKey")?.value, s.visionKey);
      // Do not make an unnecessary network request while the primary model is
      // still blank or already known to be vision-capable. Fetch the provider
      // list only when it can help replace a likely text-only model.
      const shouldFetch = options.fetch !== false && (!inherited || (Boolean(s.model) && !modelIsVision(s.model)));
      const result = shouldFetch ? await client?.listModels?.({ base, key }) : null;
      if (requestId !== visionModelRequestId) return values;
      if (result?.ok && Array.isArray(result.models) && result.models.length) values = result.models;
      if (inherited && primaryModel && !values.includes(primaryModel)) values = [primaryModel, ...values];
      select.replaceChildren();
      [...new Set(values)].forEach(value => {
        const option = doc.createElement("option");
        option.value = value;
        option.textContent = (modelIsVision(value) ? "👁 " : "") + value;
        if (modelIsVision(value)) option.title = "支持图片输入的视觉模型";
        select.appendChild(option);
      });
      const custom = doc.createElement("option");
      custom.value = "__custom__";
      custom.textContent = localized("ui.settings.customModel", "自定义模型…");
      select.appendChild(custom);
      if (inherited && primaryModel) select.value = primaryModel;
      else if (savedModel && values.includes(savedModel)) select.value = savedModel;
      else if (savedModel) {
        select.value = "__custom__";
        if ($("#visionModelCustom")) $("#visionModelCustom").value = savedModel;
      } else select.value = values.find(modelIsVision) || values[0] || "__custom__";
      syncVisionCustomModelInput();
      const selected = select.value;
      const hint = $("#visionCapabilityHint");
      const effectiveModel = inherited ? primaryModel : selected;
      if (hint) hint.textContent = modelIsVision(effectiveModel)
        ? "当前识图模型支持图片输入。"
        : inherited && effectiveModel
          ? `沿用主模型：${effectiveModel}；如果它不支持图片，请取消“沿用主对话 API 配置”并选择独立视觉模型。`
          : "自定义模型是否支持图片输入由服务商决定。";
      if (!inherited && !s.visionModel && selected !== "__custom__" && selected !== "__loading__") {
        // Keep the selected option and the persisted effective profile in
        // sync. This matters when the user switches from inheriting a
        // text-only primary model to an independent vision API: the select
        // value changes during refresh without emitting a DOM change event.
        assistant?.setSettings?.({ visionModel: selected });
      }
      return values;
    }

    function currentVisionImage() {
      const active = visionTempStore?.current?.();
      const id = str(active?.tempId || active?.imageId);
      if (!id) return null;
      try { return visionTempStore?.get?.(id) || imageStore?.get?.(id) || images?.get?.(id) || null; } catch { return null; }
    }
    function currentVisionId() {
      const active = visionTempStore?.current?.();
      return str(active?.tempId || active?.imageId);
    }
    function renderVisionPreview() {
      const current = currentVisionImage();
      const preview = $("#tpImg");
      if (preview)
        preview.innerHTML = current
          ? '<img loading="lazy" decoding="async" src="' + (current.thumbnailDataUrl || current.dataUrl || "") + '" alt="当前图片">'
          : '<div class="tp-empty">尚未上传图片</div>';
    }
    function currentTalkSessionId() {
      return str(assistant?.currentSession?.()?.id);
    }
    function conversationRows() {
      const sessionId = currentTalkSessionId();
      return sessionId ? (imageRepository?.listConversation?.(sessionId)?.items || []) : [];
    }
    function renderPendingImageStrip() {
      const strip = $("#talkPendingStrip");
      const host = $("#talkImgRow");
      if (!strip || !host) return;
      const rows = conversationRows().filter(item => item.pending);
      host.replaceChildren();
      strip.style.display = rows.length ? "" : "none";
      rows.forEach(item => {
        const asset = images?.get?.(item.imageId) || {};
        const wrap = doc.createElement("div");
        wrap.className = "pending-image-card";
        wrap.dataset.refId = item.refId;
        wrap.innerHTML = '<img loading="lazy" decoding="async" alt=""><span class="imgnum"></span><button type="button" class="imgdel btn btn-icon btn-danger">✕</button>';
        $(".imgdel", wrap).title = localized("ui.ai.removePendingImage", "Remove pending image");
        $("img", wrap).src = asset.thumbnailDataUrl || asset.dataUrl || "";
        const slotLabel = formatText(localized("ui.ai.imageSlot", "Image {slot}"), { slot: item.slotNo });
        $("img", wrap).alt = item.displayTitle || slotLabel;
        $(".imgnum", wrap).textContent = slotLabel;
        $(".imgdel", wrap).onclick = event => { event.stopPropagation(); imageRepository?.setPending?.(currentTalkSessionId(), item.refId, false); renderConversationRepository(); };
        host.appendChild(wrap);
      });
    }
    function renderConversationRepository() {
      const host = $("#talkImageRepository");
      if (!host) return;
      const rows = conversationRows();
      const pending = rows.filter(item => item.pending);
      host.dataset.columns = storage.get("conversation.columns", "two") === "single" ? "single" : "two";
      host.dataset.size = ["compact", "standard", "large"].includes(storage.get("conversation.size", "standard")) ? storage.get("conversation.size", "standard") : "standard";
      const count = $("#talkImageRepositoryCount");
      if (count) count.textContent = formatText(localized("ui.ai.pendingImages", "对话图片 {count} 张 / 待发送 {pending} 张"), { count: rows.length, pending: pending.length });
      host.replaceChildren();
      if (!rows.length) { const empty = doc.createElement("div"); empty.className = "repo-empty"; empty.textContent = localized("ui.ai.repositoryEmpty", "No conversation images"); host.appendChild(empty); renderPendingImageStrip(); return; }
      rows.forEach(item => {
        const asset = images?.get?.(item.imageId) || {};
        const card = doc.createElement("article");
        card.className = "conversation-image-card";
        card.dataset.refId = item.refId;
        card.draggable = true;
        if (item.pending) card.classList.add("is-pending");
        if (item.selected) card.classList.add("is-selected");
        card.innerHTML = '<img class="conversation-image-thumb" loading="lazy" decoding="async" alt=""><div class="conversation-image-meta"><strong class="conversation-image-slot"></strong><span class="conversation-image-title"></span><span class="conversation-image-source"></span><span class="conversation-image-candidate"></span></div><button type="button" class="conversation-image-delete btn btn-icon btn-danger">🗑</button>';
        const slotLabel = formatText(localized("ui.ai.imageSlot", "Image {slot}"), { slot: item.slotNo });
        const img = $(".conversation-image-thumb", card); img.src = asset.thumbnailDataUrl || asset.dataUrl || ""; img.alt = item.displayTitle || slotLabel;
        $(".conversation-image-delete", card).title = localized("ui.ai.removeConversationImage", "Remove from conversation");
        $(".conversation-image-slot", card).textContent = slotLabel;
        $(".conversation-image-title", card).textContent = item.displayTitle || asset.displayName || asset.filename || localized("ui.ai.imageFallback", "Image");
        $(".conversation-image-source", card).textContent = localized(`ui.ai.source.${item.source || "upload"}`, item.source || localized("ui.ai.source.upload", "Upload"));
        $(".conversation-image-candidate", card).textContent = item.candidateId ? `${localized("ui.ai.candidate", "Candidate")} ${item.candidateId}` : (item.pending ? localized("ui.ai.pending", "Pending") : item.sent ? localized("ui.ai.sent", "Sent") : "");
        card.tabIndex = 0;
        card.setAttribute("role", "button");
        card.setAttribute("aria-pressed", item.pending ? "true" : "false");
        card.setAttribute("aria-label", `${item.displayTitle || asset.displayName || asset.filename || item.imageId} · ${item.pending ? localized("ui.ai.pending", "Pending") : localized("ui.ai.notPending", "Not pending")}`);
        const togglePending = event => { if (event?.target?.closest?.("button")) return; imageRepository?.setPending?.(currentTalkSessionId(), item.refId, !item.pending); renderConversationRepository(); };
        card.addEventListener("click", togglePending);
        card.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); togglePending(event); } });
        $(".conversation-image-delete", card).onclick = event => { event.stopPropagation(); imageRepository?.removeFromConversation?.(currentTalkSessionId(), item.refId); renderConversationRepository(); };
        card.addEventListener("dragstart", event => { const payload = JSON.stringify({ sessionId: currentTalkSessionId(), refId: item.refId, imageId: item.imageId }); event.dataTransfer?.setData("application/x-ai-tag-conversation-ref", payload); event.dataTransfer?.setData("application/x-ai-tag-image-id", item.imageId); event.dataTransfer?.setData("text/plain", item.imageId); if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy"; });
        host.appendChild(card);
      });
      renderPendingImageStrip();
    }
    async function addConversationImages(files) {
      const sessionId = currentTalkSessionId();
      if (!sessionId) return null;
      let added = 0;
      for (const file of files || []) {
        if (!file?.type?.startsWith("image/")) continue;
        const dataUrl = await readFile(file);
        const thumbnailDataUrl = await makeThumbnail(file);
        const item = imageStore?.add?.({ dataUrl, thumbnailDataUrl, filename: file.name, source: "file" });
        if (item?.id && imageRepository?.attachToConversation?.(sessionId, item.id, { source: "upload", pending: true })) added += 1;
      }
      if (added) renderConversationRepository();
      return added;
    }
    function galleryPreferences() {
      const valid = {
        order: ["oldest", "newest"],
        columns: ["two", "single"],
        size: ["compact", "standard", "large"]
      };
      const order = valid.order.includes(storage.get("gallery.order", "oldest")) ? storage.get("gallery.order", "oldest") : "oldest";
      const columns = valid.columns.includes(storage.get("gallery.columns", "two")) ? storage.get("gallery.columns", "two") : "two";
      const size = valid.size.includes(storage.get("gallery.size", "standard")) ? storage.get("gallery.size", "standard") : "standard";
      ui.galleryOrder = order; ui.galleryColumns = columns; ui.gallerySize = size;
      return { order, columns, size };
    }
    function galleryRows() {
      return imageRepository?.listGallery?.({ order: ui.galleryOrder, query: ui.galleryQuery })?.items || [];
    }
    function galleryDownloadItem(item) {
      if (!item?.imageId) return;
      const bytesPromise = imageRepository?.getOriginalBytes?.(item.imageId) || images?.getBytes?.(item.imageId);
      Promise.resolve(bytesPromise).then(bytes => {
        if (!bytes) return notify(galleryText("downloadFailed", "无法读取原始图片"));
        const mime = item.mime || "image/png";
        const link = doc.createElement("a");
        link.href = URL.createObjectURL(new Blob([bytes], { type: mime }));
        link.download = item.filename || `${item.imageId}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 800);
      }).catch(error => notify(error?.message || String(error)));
    }
    function chooseGalleryDelete(item) {
      const refs = imageRepository?.referenceCount?.(item.imageId) || { gallery: 1, conversations: 0, messages: 0, total: 1 };
      const name = item.displayName || item.filename || item.imageId;
      if (refs.conversations || refs.messages) {
        const impact = galleryText("deleteImpact", `会话引用 ${refs.conversations}，消息引用 ${refs.messages}。`, refs);
        if (typeof global.alert === "function") global.alert(impact);
        if (typeof global.confirm !== "function" || !global.confirm(galleryText("deleteConfirm", `确定从图片库移除 ${name} 吗？`, { name }))) return;
        imageRepository?.removeFromGallery?.(item.imageId, { purge: false, retain: true });
        return;
      }
      const choice = typeof global.prompt === "function" ? global.prompt(`${galleryText("deleteConfirm", `确定处理 ${name} 吗？`, { name })}\n1. ${galleryText("removeOnly", "仅移除图库关联")}\n2. ${galleryText("purge", "彻底删除（无引用时）")}`, "1") : "1";
      if (choice === "1") imageRepository?.removeFromGallery?.(item.imageId, { purge: false, retain: true });
      else if (choice === "2") imageRepository?.removeFromGallery?.(item.imageId, { purge: true });
    }
    function chooseGallerySession() {
      const sessions = assistant?.sessions?.() || [];
      if (!sessions.length) return null;
      const current = assistant?.currentSession?.();
      if (sessions.length === 1) return current || sessions[0];
      const labels = sessions.map((item, index) => `${index + 1}. ${item.title || item.id}`).join("\n");
      const answer = typeof global.prompt === "function" ? global.prompt(labels, String(Math.max(1, sessions.indexOf(current) + 1))) : "1";
      const index = Number(answer) - 1;
      return Number.isInteger(index) && sessions[index] ? sessions[index] : null;
    }
    function renderGallery() {
      const host = $("#galleryGrid");
      if (!host) return;
      const prefs = galleryPreferences();
      host.dataset.columns = prefs.columns;
      host.dataset.size = prefs.size;
      if ($("#galleryOrder")) $("#galleryOrder").value = prefs.order;
      if ($("#galleryColumns")) $("#galleryColumns").value = prefs.columns;
      if ($("#gallerySize")) $("#gallerySize").value = prefs.size;
      host.replaceChildren();
      const rows = galleryRows();
      put("#galleryCount", galleryText("count", `${rows.length} 张`, { count: rows.length }));
      if (!rows.length) {
        const empty = doc.createElement("div"); empty.className = "gallery-empty"; empty.textContent = galleryText("empty", "图片库为空"); host.appendChild(empty); return;
      }
      const available = new Set(rows.map(item => item.imageId));
      ui.gallerySelected = new Set([...ui.gallerySelected].filter(id => available.has(id)));
      rows.forEach(item => {
        const card = doc.createElement("article");
        card.className = "gallery-card";
        card.dataset.imageId = item.imageId;
        card.draggable = true;
        if (ui.gallerySelected.has(item.imageId)) card.classList.add("is-selected");
        const preview = images?.preview?.(item.imageId) || item;
        const src = preview?.thumbnailDataUrl || preview?.dataUrl || "";
        card.innerHTML = `<img class="gallery-thumb" loading="lazy" decoding="async" alt=""><div class="gallery-meta"><div class="gallery-name"></div><div class="gallery-sub"></div><div class="gallery-actions"><button type="button" data-action="vision">${galleryText("identify", "识图")}</button><button type="button" data-action="conversation">${galleryText("send", "发送到对话仓库")}</button><button type="button" data-action="download">${galleryText("downloadOne", "下载")}</button><button type="button" data-action="rename">${galleryText("rename", "重命名")}</button></div></div><div class="gallery-card-tools"><button type="button" class="btn btn-icon btn-danger" data-action="delete" title="${galleryText("deleteTitle", "删除")}">🗑</button></div>`;
        const img = $(".gallery-thumb", card); img.src = src; img.alt = item.displayName || item.filename || item.imageId;
        $(".gallery-name", card).textContent = item.displayName || item.filename || item.imageId;
        const dimensions = item.width && item.height ? `${item.width}×${item.height}` : "";
        $(".gallery-sub", card).textContent = [item.source || "", dimensions, item.createdAt ? new Date(item.createdAt).toLocaleString() : ""].filter(Boolean).join(" · ");
        card.addEventListener("click", event => { if (event.target.closest("[data-action]")) return; if (ui.gallerySelected.has(item.imageId)) ui.gallerySelected.delete(item.imageId); else ui.gallerySelected.add(item.imageId); renderGallery(); });
        card.addEventListener("dragstart", event => { event.dataTransfer?.setData("application/x-ai-tag-image-id", item.imageId); event.dataTransfer?.setData("text/plain", item.imageId); if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy"; });
        card.addEventListener("click", event => {
          const action = event.target.closest("[data-action]")?.dataset.action;
          if (!action) return;
          event.stopPropagation();
          if (action === "vision") { visionTempStore?.setLibraryReference?.(item.imageId); clearVisionResult(); renderVisionPreview(); renderTalkVisionPanel(); setVisionOpen(true); }
          if (action === "conversation") { const target = chooseGallerySession(); if (!target) return notify(galleryText("noSession", "没有可用会话，无法发送图片")); const attached = imageRepository?.attachToConversation?.(target.id, item.imageId, { source: "gallery" }); if (!attached) return notify("发送图片失败"); notify(galleryText("sent", "已发送到对话仓库")); renderTalk(); }
          if (action === "download") galleryDownloadItem(item);
          if (action === "rename") { const name = global.prompt(galleryText("rename", "重命名"), item.displayName || item.filename || ""); if (name?.trim()) { imageRepository?.renameGalleryImage?.(item.imageId, name.trim()); renderGallery(); } }
          if (action === "delete") { chooseGalleryDelete(item); ui.gallerySelected.delete(item.imageId); renderGallery(); }
        });
        host.appendChild(card);
      });
    }
    function readFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () =>
          reject(reader.error || new Error("图片读取失败"));
        reader.readAsDataURL(file);
      });
    }
    async function makeThumbnail(file, maxSize = 320) {
      if (!file || typeof global.createImageBitmap !== "function") return "";
      try {
        const bitmap = await global.createImageBitmap(file);
        const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
        const canvas = doc.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close?.();
        return canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.82);
      } catch {
        return "";
      }
    }
    function readText(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () =>
          reject(reader.error || new Error("文件读取失败"));
        reader.readAsText(file);
      });
    }
    async function importWorkflow(file) {
      if (!file) return;
      try {
        const apply = (value) => {
          const parsed = comfy?.importApiWorkflow?.(value);
          if (!parsed) {
            const raw = typeof value === "string" ? value : JSON.stringify(value, null, 2);
            $("#comfyWf").value = raw;
            configFromView();
            return { found: false, text: raw };
          }
          $("#comfyWf").value = parsed.text;
          if ($("#comfyPos")) $("#comfyPos").value = String(parsed.prompt || "");
          if ($("#comfyNeg")) $("#comfyNeg").value = String(parsed.negative || "");
          if (parsed.width !== "" && $("#comfyW")) $("#comfyW").value = parsed.width;
          if (parsed.height !== "" && $("#comfyH")) $("#comfyH").value = parsed.height;
          if (parsed.steps !== "" && $("#comfySteps")) $("#comfySteps").value = parsed.steps;
          if (parsed.cfg !== "" && $("#comfyCfg")) $("#comfyCfg").value = parsed.cfg;
          configFromView();
          return parsed;
        };
        if (file.type === "application/json" || /\.json$/i.test(file.name || "")) {
          const parsed = apply(await readText(file));
          notify(parsed.found ? "工作流已导入并提取提示词" : "工作流已载入（未找到标准提示词节点）");
          return;
        }
        if (file.type === "image/png" || /\.png$/i.test(file.name || "")) {
          const item = images?.add?.({
            dataUrl: await readFile(file),
            filename: file.name,
            source: "workflow",
          });
          const metadata = images?.metadata?.(item?.id);
          // ComfyUI PNG usually stores both fields: `prompt` is the executable
          // API workflow, while `workflow` is the canvas/UI layout. Prefer the
          // API copy so importing a generated image works without conversion.
          const workflow = metadata?.promptJson || metadata?.workflowJson || metadata?.workflow;
          // 工作流 PNG 只是导入载体，不是用户基准图；解析完立即从图片仓库
          // 移除，避免它的内置 Tag 污染后续上传图片的提示词。
          if (item?.id) images?.remove?.(item.id);
          if (workflow) {
            const parsed = apply(workflow);
            notify(parsed.found ? "已从 PNG 读取工作流并提取提示词" : "已从 PNG 读取工作流（未找到标准提示词节点）");
          } else notify("PNG 中没有找到工作流");
        }
      } catch (error) {
        notify(error.message || String(error));
      }
    }
    async function addImage(file, name) {
      if (!file || !file.type?.startsWith("image/") || !imageStore?.add) return null;
      const dataUrl = await readFile(file);
      const thumbnailDataUrl = await makeThumbnail(file);
      if (!/^data:image\//i.test(dataUrl)) return null;
      const item = imageStore.add(
        { dataUrl, thumbnailDataUrl, filename: file.name, source: "file" },
        { collection: name },
      );
      return item;
    }
    function cancelVisionRequest(restoreControls = false) {
      ui.visionRequestId += 1;
      ui.visionAbort?.abort?.();
      ui.visionAbort = null;
      ui.visionBusy = false;
      if (restoreControls) {
        const identify = $("#tpIdentify");
        const describe = $("#tpDescribe");
        if (identify) {
          identify.removeAttribute("aria-busy");
          identify.removeAttribute("disabled");
          identify.textContent = localized("ui.ai.identify", "本地识图");
        }
        if (describe) {
          describe.removeAttribute("disabled");
          describe.textContent = localized("ui.ai.aiVision", "🖼 AI识图");
        }
        show("#tpStop", false);
      }
    }
    function clearVisionResult() {
      ui.visionResult = null;
      ui.visionDescription = "";
      talkVisionFold.builtin = null;
      talkVisionFold.model = null;
      talkVisionFold.description = false;
    }
    async function loadVisionMetadata(imageId, requestId, controller) {
      const call = assistant?.calls?.call;
      let result = null;
      try {
        result = call
          ? await call("vision.processOne", { imageId, mode: "metadata" }, { caller: "ui", signal: controller.signal })
          : { ok: true, data: await Promise.resolve(visionTempStore?.get?.(imageId)?.metadata || images?.metadata?.(imageId) || {}) };
      } catch (error) {
        result = { ok: false, error: error?.message || String(error) };
      }
      if (requestId !== ui.visionRequestId || imageId !== currentVisionId()) return result;
      ui.visionResult = result?.ok === false ? null : (result?.data || null);
      ui.visionBusy = false;
      ui.visionAbort = null;
      renderVisionPreview();
      renderTalkVisionPanel();
      return result;
    }
    async function replaceVisionImage(file) {
      if (!file || !visionTempStore?.replaceExternal) return null;
      const uploadId = ui.visionUploadId + 1;
      ui.visionUploadId = uploadId;
      cancelVisionRequest(true);
      clearVisionResult();
      renderVisionPreview();
      renderTalkVisionPanel();
      let dataUrl;
      let thumbnailDataUrl;
      try {
        dataUrl = await readFile(file);
        thumbnailDataUrl = await makeThumbnail(file);
      } catch (error) {
        if (uploadId === ui.visionUploadId) notify(error?.message || String(error));
        return null;
      }
      if (uploadId !== ui.visionUploadId) return null;
      const item = visionTempStore.replaceExternal({ dataUrl, thumbnailDataUrl, filename: file.name, mime: file.type || "image/png" });
      if (!item?.tempId) {
        notify("识图图片导入失败");
        renderVisionPreview();
        renderTalkVisionPanel();
        return null;
      }
      renderVisionPreview();
      renderTalkVisionPanel();
      refreshCapabilitiesStatus();
      const controller = new AbortController();
      const requestId = ui.visionRequestId + 1;
      ui.visionRequestId = requestId;
      ui.visionAbort = controller;
      ui.visionBusy = true;
      await loadVisionMetadata(item.tempId, requestId, controller);
      return item;
    }
    async function addVisionFiles(files) {
      const imageFiles = [...(files || [])].filter(file => file?.type?.startsWith("image/"));
      if (!imageFiles.length) return null;
      if (imageFiles.length > 1) notify("识图区域一次只保留一张图片，已使用第一张");
      return replaceVisionImage(imageFiles[0]);
    }
    function imageContextFromNode(node) {
      let current = node;
      while (current) {
        if (current.dataset?.imageContext) return current.dataset.imageContext;
        if (typeof current.closest === "function") {
          const marked = current.closest("[data-image-context]");
          if (marked?.dataset?.imageContext) return marked.dataset.imageContext;
        }
        current = current.parentElement;
      }
      return "";
    }
    function imageContextFromEvent(event, options = {}) {
      const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
      for (const node of path) {
        const context = imageContextFromNode(node);
        if (context) return context;
      }
      const targetContext = imageContextFromNode(event?.target);
      if (targetContext) return targetContext;
      if (options.useActive !== false) {
        const activeContext = imageContextFromNode(doc.activeElement);
        if (activeContext) return activeContext;
      }
      return "";
    }
    function addFilesForContext(files, context) {
      ui.lastImageContext = context || "";
      if (context === "vision") return addVisionFiles(files);
      if (context === "conversation") return addConversationImages(files);
      return null;
    }
    function tagText(item) { return str(item?.tag || item?.name || item?.en || item); }
    function embeddedTags() {
      const image = currentVisionImage();
      const fromImage = image?.metadata?.builtinTags || [];
      const fromResult = ui.visionResult?.builtinTags || [];
      return [...fromImage, ...fromResult].filter(item => tagText(item));
    }
    function renderVisionChips(selector, rows) {
      const host = $(selector); if (!host) return;
      host.replaceChildren();
      const seen = new Set();
      rows.forEach(item => {
        const value = tagText(item); const key = value.toLowerCase();
        if (!value || seen.has(key)) return;
        seen.add(key);
        const chip = doc.createElement("button"); chip.type = "button"; chip.className = "tchip ok tagchip btn btn-chip"; chip.dataset.tag = value; chip.textContent = value; chip.title = `${value} · 点击复制`;
        chip.onclick = async () => { if (await copy(value)) notify(`已复制：${value}`); };
        host.appendChild(chip);
      });
    }
    function renderEmbeddedVision() { renderTalkVisionPanel(); }
    function renderTalkVisionPanel() {
      const host = $("#tpModes"); if (!host) return;
      const image = currentVisionImage();
      const result = ui.visionResult || {};
      const embedded = [
        ...(image?.metadata?.builtinTags || []),
        ...(result.builtinTags || [])
      ].filter(item => tagText(item));
      const model = [
        ...(image?.analysis?.tags || image?.analysis?.modelTags || []),
        ...(result.modelTags || result.tags || [])
      ].filter(item => tagText(item));
      // metadata 模式的 result.text 是 PNG 内置正向提示词，不是 AI
      // 识图结果。只有用户明确点击“AI 识图”后写入的 description 才能
      // 显示在 AI 描述区，避免刚拖入图片就像已经调用过视觉 API。
      const description = str(ui.visionDescription);
      host.replaceChildren();
      const groups = [
        [localized("ui.ai.builtinTags", "原图内置 Tag"), embedded, false],
        [localized("ui.ai.modelTags", "模型识别 Tag"), model, true],
      ];
      groups.forEach(([title, values, identified]) => {
        if (!values.length) return;
        const module = doc.createElement("section"); module.className = "tp-mod";
        const head = doc.createElement("div"); head.className = "tpm-head";
        const label = doc.createElement("span"); label.textContent = title;
        const spacer = doc.createElement("span"); spacer.style.flex = "1";
        const fold = doc.createElement("button"); fold.type = "button"; fold.className = "tp-fold btn btn-icon"; fold.textContent = "▾"; fold.title = "折叠 / 展开";
        const button = doc.createElement("button"); button.type = "button"; button.className = "tpm-copy btn btn-ghost"; button.textContent = "📋 复制";
        const body = doc.createElement("div"); body.className = "tpm-body";
        renderVisionChipsInto(body, values);
        const key = identified ? "model" : "builtin";
        const defaultFolded = identified && embedded.length > 0;
        const initialFolded = talkVisionFold[key] == null ? defaultFolded : talkVisionFold[key];
        const setFolded = folded => {
          talkVisionFold[key] = folded;
          module.classList.toggle("collapsed", folded);
          fold.textContent = folded ? "▸" : "▾";
          fold.setAttribute("aria-expanded", folded ? "false" : "true");
        };
        const toggle = () => setFolded(!module.classList.contains("collapsed"));
        fold.onclick = toggle; head.onclick = event => { if (event.target === button || event.target === fold) return; toggle(); };
        button.onclick = async event => {
          event.stopPropagation();
          const copiedValues = uniqueTagTexts(values);
          if (await copy(copiedValues.join(", "))) notify(`已复制 ${copiedValues.length} 个${identified ? "识别" : "内置"} Tag`);
        };
        head.append(label, spacer, fold, button); module.append(head, body); host.appendChild(module); setFolded(initialFolded);
      });
      if (description) {
        const module = doc.createElement("section"); module.className = "tp-mod";
        const head = doc.createElement("div"); head.className = "tpm-head";
        const label = doc.createElement("span"); label.textContent = localized("ui.ai.describe", "🖼 AI 描述");
        const spacer = doc.createElement("span"); spacer.style.flex = "1";
        const fold = doc.createElement("button"); fold.type = "button"; fold.className = "tp-fold btn btn-icon"; fold.title = localized("ui.common.collapse", "折叠");
        const button = doc.createElement("button"); button.type = "button"; button.className = "tpm-copy btn btn-ghost"; button.textContent = `📋 ${localized("ui.common.copy", "复制")}`;
        const body = doc.createElement("pre"); body.id = "tpDesc"; body.className = "tpm-body tpm-description"; body.textContent = description;
        const setFolded = folded => {
          talkVisionFold.description = folded;
          module.classList.toggle("collapsed", folded);
          fold.textContent = folded ? "▸" : "▾";
          fold.setAttribute("aria-expanded", folded ? "false" : "true");
        };
        const toggle = () => setFolded(!module.classList.contains("collapsed"));
        fold.onclick = toggle; head.onclick = event => { if (event.target === button || event.target === fold) return; toggle(); };
        button.onclick = async event => { event.stopPropagation(); if (await copy(description)) notify(localized("ui.tag.copied", "已复制")); };
        head.append(label, spacer, fold, button); module.append(head, body); host.appendChild(module); setFolded(talkVisionFold.description);
      }
      const placeholder = $("#tpPlaceholder"); if (placeholder) placeholder.style.display = embedded.length || model.length || description ? "none" : "";
    }
    function renderVisionChipsInto(host, rows) {
      host.replaceChildren();
      uniqueTagTexts(rows).forEach(value => {
        const chip = doc.createElement("button"); chip.type = "button"; chip.className = "tchip ok tagchip btn btn-chip"; chip.dataset.tag = value; chip.textContent = value; chip.title = `${value} · 点击复制`; chip.onclick = async () => { if (await copy(value)) notify(`已复制：${value}`); }; host.appendChild(chip);
      });
    }
    function uniqueTagTexts(rows) {
      const seen = new Set();
      return (rows || []).map(tagText).filter(value => {
        const key = value.toLowerCase();
        if (!value || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    async function localVision() {
      const button = $("#tpIdentify");
      if (button?.disabled) return [];
      const label = button?.textContent || localized("ui.ai.identify", "本地识图");
      if (button) {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        button.innerHTML = '<span class="spin"></span> 识图中…';
      }
      const modelId = $("#tpWdModel")?.value || "eva02";
      const imageId = currentVisionId();
      if (!imageId) {
        if (button) {
          button.disabled = false;
          button.removeAttribute("aria-busy");
          button.textContent = label;
        }
        notify("请先添加图片");
        return [];
      }
      cancelVisionRequest();
      const controller = new AbortController();
      const requestId = ui.visionRequestId + 1;
      ui.visionRequestId = requestId;
      ui.visionAbort = controller;
      ui.visionBusy = true;
      try {
        const call = assistant?.calls?.call;
        if (!call) throw new Error("Calls 网关不可用");
        const result = await call("vision.processOne", { imageId, mode: "local", model: modelId }, { caller: "ui", signal: controller.signal });
        if (requestId !== ui.visionRequestId || imageId !== currentVisionId()) return result;
        ui.visionResult = result?.data || result?.analysis || null;
        const embedded = embeddedTags();
        const model = currentVisionImage()?.analysis?.tags || currentVisionImage()?.analysis?.modelTags || ui.visionResult?.modelTags || ui.visionResult?.tags || [];
        // 本地识图完成后展开本次模型结果，自动折叠此前的内置 Tag / AI 描述。
        talkVisionFold.model = model.length ? false : null;
        if (embedded.length) talkVisionFold.builtin = true;
        if (ui.visionDescription) talkVisionFold.description = true;
        renderTalkVisionPanel();
        return result?.data || result;
      } finally {
        if (requestId === ui.visionRequestId) {
          ui.visionBusy = false;
          ui.visionAbort = null;
        }
        if (button && requestId === ui.visionRequestId) {
          button.disabled = false;
          button.removeAttribute("aria-busy");
          button.textContent = label;
        }
      }
    }
    async function describe() {
      const imageId = currentVisionId();
      if (!imageId) return notify("请先添加图片");
      cancelVisionRequest();
      const requestId = ui.visionRequestId + 1;
      ui.visionRequestId = requestId;
      const controller = new AbortController();
      const button = $("#tpDescribe");
      const label = button?.textContent || localized("ui.ai.aiVision", "🖼 AI识图");
      ui.visionAbort = controller;
      ui.visionBusy = true;
      ui.visionDescription = "AI 识图中…";
      renderTalkVisionPanel();
      show("#tpStop", true);
      if (button) {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        button.innerHTML = '<span class="spin"></span> AI 识图中…';
      }
      try {
        const capabilities = await assistant?.refreshCapabilities?.({ force: true }) || assistant?.getCapabilities?.() || {};
        if (capabilities.vision && capabilities.vision.ai !== true) throw new Error(capabilities.vision.aiError || "请先配置支持图片输入的独立识图 API");
        const call = assistant?.calls?.call;
        if (typeof call !== "function") throw new Error("Calls 网关不可用，无法执行 AI 识图");
        const result = await call("vision.processOne", { imageId, mode: "ai", instruction: "请按图片中可见内容进行详细描述：主体、人物外观、服装、姿势表情、构图视角、场景物体、光影色彩与画风；以精炼绘图 Tag 为主，如实包含可见 NSFW 内容，只输出结果。", includeLocalTags: true }, { caller: "ui", signal: controller.signal });
        if (ui.visionRequestId === requestId) {
          ui.visionResult = result?.data || null;
          ui.visionDescription = result?.data?.text || result?.text || result?.data?.error || result?.error || "没有返回描述";
          if (result?.ok === false) notify(ui.visionDescription);
        }
      } catch (error) {
        if (ui.visionRequestId === requestId) {
          ui.visionDescription = controller.signal.aborted ? "AI 识图已停止" : error.message || String(error);
          notify(ui.visionDescription);
        }
      } finally {
        if (ui.visionRequestId === requestId) {
          ui.visionBusy = false;
          ui.visionAbort = null;
          // AI 识图完成后只保留描述区展开，其他识图结果折叠但不删除。
          talkVisionFold.description = false;
          if (embeddedTags().length) talkVisionFold.builtin = true;
          if ((currentVisionImage()?.analysis?.tags || currentVisionImage()?.analysis?.modelTags || ui.visionResult?.tags || []).length) talkVisionFold.model = true;
          show("#tpStop", false);
          if (button) {
            button.disabled = !currentVisionId();
            button.removeAttribute("aria-busy");
            button.textContent = label;
          }
          renderTalkVisionPanel();
        }
      }
    }
    function currentConfig() {
      const s = settings();
      return {
        base: s.base,
        model: s.model,
        key: s.key,
        temperature: Number(s.temperature) || 0.7,
        timeoutMs: s.timeoutEnabled
          ? (Number(s.timeoutSec) || 300) * 1000
          : 120000,
      };
    }
    const messageIconMarkup = {
      copy: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="10" height="10" rx="2"></rect><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"></path></svg>',
      edit: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"></path><path d="m14.5 6.5 3 3"></path></svg>',
      regenerate: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18.5 9a7 7 0 1 0 1.2 6"></path><path d="M18.5 4.5v4.5H14"></path></svg>',
    };
    function setMessageActionIcon(button, type, title) {
      button.type = "button";
      button.className = "cico btn btn-icon message-action";
      button.dataset.action = type;
      button.title = title;
      button.setAttribute("aria-label", title);
      button.innerHTML = messageIconMarkup[type] || "";
    }
    function appendMarkdownInline(parent, value) {
      const source = String(value || "");
      const pattern = /(\x60[^\x60]+\x60|\*\*[^\*]+\*\*|__[^\_]+__|~~[^~]+~~|\*[^\*]+\*|\_[^\_]+\_|\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)]+\)|https?:\/\/[^\s<]+)/g;
      let cursor = 0;
      let match;
      while ((match = pattern.exec(source))) {
        if (match.index > cursor) parent.appendChild(doc.createTextNode(source.slice(cursor, match.index)));
        const token = match[0];
        if (token.charCodeAt(0) === 96) {
          const code = doc.createElement("code");
          code.className = "md-inline-code";
          code.textContent = token.slice(1, -1);
          parent.appendChild(code);
        } else if (token.startsWith("**") || token.startsWith("__")) {
          const strong = doc.createElement("strong");
          appendMarkdownInline(strong, token.slice(2, -2));
          parent.appendChild(strong);
        } else if (token.startsWith("~~")) {
          const deleted = doc.createElement("del");
          appendMarkdownInline(deleted, token.slice(2, -2));
          parent.appendChild(deleted);
        } else if (token.startsWith("*") || token.startsWith("_")) {
          const emphasis = doc.createElement("em");
          appendMarkdownInline(emphasis, token.slice(1, -1));
          parent.appendChild(emphasis);
        } else {
          const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
          if (!linkMatch && /^https?:\/\//.test(token)) {
            const link = doc.createElement("a");
            link.className = "md-link";
            link.href = token;
            link.target = "_blank";
            link.rel = "noreferrer";
            link.textContent = token;
            parent.appendChild(link);
          } else if (!linkMatch) {
            parent.appendChild(doc.createTextNode(token));
          } else {
            const link = doc.createElement("a");
            link.className = "md-link";
            link.href = linkMatch[2];
            link.target = "_blank";
            link.rel = "noreferrer";
            link.textContent = linkMatch[1];
            parent.appendChild(link);
          }
        }
        cursor = match.index + token.length;
      }
      if (cursor < source.length) parent.appendChild(doc.createTextNode(source.slice(cursor)));
    }
    function markdownTableCells(line) {
      let source = String(line || "").trim();
      if (source.startsWith("|")) source = source.slice(1);
      if (source.endsWith("|") && !source.endsWith("\\|")) source = source.slice(0, -1);
      const cells = [];
      let current = "";
      let escaped = false;
      for (const char of source) {
        if (char === "|" && !escaped) {
          cells.push(current.trim());
          current = "";
          continue;
        }
        if (char === "\\" && !escaped) {
          escaped = true;
          continue;
        }
        current += char;
        escaped = false;
      }
      cells.push(current.trim());
      return cells;
    }
    function markdownTableDelimiter(line) {
      const cells = markdownTableCells(line);
      return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
    }
    function markdownCodeBlock(code, language) {
      const block = doc.createElement("div");
      block.className = "codeblock";
      const bar = doc.createElement("div");
      bar.className = "codebar";
      const lang = doc.createElement("span");
      lang.className = "codelang";
      lang.textContent = language || "text";
      const button = doc.createElement("button");
      button.className = "codebtn btn btn-ghost";
      button.type = "button";
      button.textContent = "📋 复制代码";
      button.onclick = async (event) => {
        event.stopPropagation();
        if (await copy(code)) notify("代码已复制");
      };
      const pre = doc.createElement("pre");
      pre.className = "codepre";
      pre.textContent = code;
      bar.append(lang, button);
      block.append(bar, pre);
      return block;
    }
    function renderMarkdownTable(host, headerCells, alignments, bodyRows) {
      const wrap = doc.createElement("div");
      wrap.className = "md-table-wrap";
      const table = doc.createElement("table");
      table.className = "md-table";
      const thead = doc.createElement("thead");
      const headRow = doc.createElement("tr");
      headerCells.forEach((cell, index) => {
        const th = doc.createElement("th");
        if (alignments[index]) th.style.textAlign = alignments[index];
        appendMarkdownInline(th, cell);
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);
      if (bodyRows.length) {
        const tbody = doc.createElement("tbody");
        bodyRows.forEach(row => {
          const tr = doc.createElement("tr");
          headerCells.forEach((_header, index) => {
            const td = doc.createElement("td");
            if (alignments[index]) td.style.textAlign = alignments[index];
            appendMarkdownInline(td, row[index] || "");
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
      }
      wrap.appendChild(table);
      host.appendChild(wrap);
    }
    function renderMarkdownBlocks(host, value) {
      const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
      let paragraph = [];
      const flushParagraph = () => {
        if (!paragraph.length) return;
        const p = doc.createElement("p");
        p.className = "md-p";
        paragraph.forEach((line, index) => {
          if (index) p.appendChild(doc.createElement("br"));
          appendMarkdownInline(p, line);
        });
        host.appendChild(p);
        paragraph = [];
      };
      let index = 0;
      while (index < lines.length) {
        const line = lines[index];
        if (!line.trim()) {
          flushParagraph();
          index += 1;
          continue;
        }
        const fence = line.match(/^ {0,3}(\x60{3,}|~{3,})\s*([^\s]*)\s*$/);
        if (fence) {
          flushParagraph();
          const marker = fence[1];
          const markerChar = marker[0];
          const closePattern = new RegExp("^ {0,3}" + (markerChar === "~" ? "~" : "\\x60") + "{" + marker.length + ",}\\s*$");
          const codeLines = [];
          index += 1;
          while (index < lines.length && !closePattern.test(lines[index])) {
            codeLines.push(lines[index]);
            index += 1;
          }
          if (index < lines.length) index += 1;
          host.appendChild(markdownCodeBlock(codeLines.join("\n"), fence[2] || "text"));
          continue;
        }
        const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (heading) {
          flushParagraph();
          const h = doc.createElement("h" + Math.min(6, heading[1].length));
          h.className = "md-heading";
          appendMarkdownInline(h, heading[2]);
          host.appendChild(h);
          index += 1;
          continue;
        }
        if (index + 1 < lines.length && line.includes("|") && markdownTableDelimiter(lines[index + 1])) {
          flushParagraph();
          const headerCells = markdownTableCells(line);
          const delimiterCells = markdownTableCells(lines[index + 1]);
          const alignments = delimiterCells.map(cell => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : "");
          const bodyRows = [];
          index += 2;
          while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
            bodyRows.push(markdownTableCells(lines[index]));
            index += 1;
          }
          renderMarkdownTable(host, headerCells, alignments, bodyRows);
          continue;
        }
        const unordered = line.match(/^ {0,3}[-*+]\s+(.+)$/);
        const ordered = line.match(/^ {0,3}\d+[.)]\s+(.+)$/);
        if (unordered || ordered) {
          flushParagraph();
          const list = doc.createElement(ordered ? "ol" : "ul");
          list.className = "md-list";
          const matcher = ordered ? /^ {0,3}\d+[.)]\s+(.+)$/ : /^ {0,3}[-*+]\s+(.+)$/;
          while (index < lines.length) {
            const itemMatch = lines[index].match(matcher);
            if (!itemMatch) break;
            const li = doc.createElement("li");
            const task = itemMatch[1].match(/^\[([ xX])\]\s+(.+)$/);
            if (task) {
              const marker = doc.createElement("span");
              marker.className = "md-task";
              marker.textContent = task[1].toLowerCase() === "x" ? "✓" : "○";
              li.appendChild(marker);
              appendMarkdownInline(li, task[2]);
            } else appendMarkdownInline(li, itemMatch[1]);
            list.appendChild(li);
            index += 1;
          }
          host.appendChild(list);
          continue;
        }
        const quote = line.match(/^ {0,3}>\s?(.*)$/);
        if (quote) {
          flushParagraph();
          const quoteLines = [];
          while (index < lines.length) {
            const quoteMatch = lines[index].match(/^ {0,3}>\s?(.*)$/);
            if (!quoteMatch) break;
            quoteLines.push(quoteMatch[1]);
            index += 1;
          }
          const blockquote = doc.createElement("blockquote");
          renderMarkdownBlocks(blockquote, quoteLines.join("\n"));
          host.appendChild(blockquote);
          continue;
        }
        if (/^ {0,3}(?:[-*_]\s*){3,}$/.test(line)) {
          flushParagraph();
          host.appendChild(doc.createElement("hr"));
          index += 1;
          continue;
        }
        paragraph.push(line);
        index += 1;
      }
      flushParagraph();
    }
    function renderRichMessage(host, value) {
      host.replaceChildren();
      renderMarkdownBlocks(host, value);
    }
    function updateStreamingBody(host, value) {
      const raw = String(value || "");
      // Most streamed chunks are plain text. Reuse the existing text node so
      // long replies do not rebuild every code block on every refresh.
      if (!raw.includes("```") && !host.querySelector(".codeblock")) {
        let textEl = host.querySelector(":scope > .msg-text");
        if (!textEl) {
          host.replaceChildren();
          textEl = doc.createElement("div");
          textEl.className = "msg-text";
          host.appendChild(textEl);
        }
        textEl.textContent = raw;
        return;
      }
      renderRichMessage(host, raw);
    }
    function talkContext(text, imageIds, config = settings()) {
      const world = activeWorld();
      const preset = activePreset();
      return {
        text,
        imageIds,
        primaryVision: modelIsVision(config.model),
        nsfwEnabled: Boolean(tagSnapshot().adult),
        includeAdult: Boolean(tagSnapshot().adult),
        searchPrecision: ui.searchPrecision,
        currentCategory: tagSnapshot().category,
        tagRevision: tagSnapshot().revision,
        strict: config.strict !== false,
        worldbookEntries: world?.enabled === false ? [] : world?.entries || [],
        worldbookMods: world?.enabled === false ? [] : world?.mods || [],
        promptMods: preset?.mods || {},
        qualityPrefix: preset?.quality || "",
        promptOverrides: {
          main: preset?.main,
          chat: preset?.chat,
          generate: preset?.generate,
          vision: preset?.vision,
          comfy: preset?.comfy,
        },
      };
    }
    function drawContextTask() {
      return settings().comfyOn !== false ? "comfy" : "draw";
    }
    function setDrawComfyEnabled(value) {
      const enabled = Boolean(value);
      assistant?.setSettings?.({ comfyOn: enabled });
      if ($("#tkDrawRender")) $("#tkDrawRender").checked = enabled;
      scheduleCapabilitiesStatus();
    }
    function setDrawIterations(value) {
      const iterations = Math.max(1, Math.min(10, Number(value) || 3));
      assistant?.setSettings?.({ maxComfyCalls: iterations });
      if ($("#comfyIters")) $("#comfyIters").value = String(iterations);
      if ($("#tkDrawIterations")) $("#tkDrawIterations").value = String(iterations);
      syncDrawControls(ui.comfyCapabilities);
    }
    let talkRenderPending = false;
    function scheduleTalkRender(render = renderTalk) {
      if (talkRenderPending) return;
      talkRenderPending = true;
      setTimeout(() => {
        talkRenderPending = false;
        render();
      }, 80);
    }
    function setTalkBusy(busy, label = "📤 发送") {
      const button = $("#talkSendBtn");
      if (button) {
        button.disabled = Boolean(busy);
        if (busy) button.innerHTML = '<span class="spin"></span> 处理中…';
        else button.textContent = label;
      }
      show("#talkStopBtn", Boolean(busy));
    }
    function resizeTalkInput() {
      const input = $("#talkIn");
      if (!input) return;
      input.style.height = "auto";
      const minHeight = 78;
      const maxHeight = 220;
      const height = Math.min(maxHeight, Math.max(minHeight, input.scrollHeight));
      input.style.height = String(height) + "px";
      input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
    }
    async function editTalkMessage(row, message) {
      const body = $(".body", row);
      if (!body) return;
      row.classList.add("editing");
      const area = doc.createElement("textarea");
      area.className = "editarea";
      area.value = message.text || "";
      const bar = doc.createElement("div");
      bar.className = "editbar";
      const save = doc.createElement("button");
      save.className = "abtn pri btn btn-primary";
      save.textContent = message.role === "user" ? "保存并重新发送" : "保存修改";
      const cancel = doc.createElement("button");
      cancel.className = "abtn ghost btn btn-ghost";
      cancel.textContent = "取消";
      bar.append(save, cancel);
      body.replaceChildren(area, bar);
      area.focus();
      const resizeEditor = () => {
        area.style.height = "auto";
        area.style.height = `${Math.min(320, Math.max(140, area.scrollHeight))}px`;
        area.style.overflowY = area.scrollHeight > 320 ? "auto" : "hidden";
      };
      area.addEventListener("input", resizeEditor);
      resizeEditor();
      cancel.onclick = () => {
        row.classList.remove("editing");
        body.replaceChildren();
        renderRichMessage(body, message.text || "");
      };
      save.onclick = async () => {
        const value = area.value.trim();
        if (!value) return notify("消息不能为空");
        if (message.role === "user") {
          const config = configFromView();
          put("#talkStatus", "正在重新发送…");
          const label = $("#talkSendBtn")?.textContent || "📤 发送";
          const input = talkContext(value, message.imageIds || [], config);
          input.onStart = () => renderTalk();
          input.onDelta = () => scheduleTalkRender(updateStreamingTalk);
          input.onToolEvent = handleTalkToolEvent;
          setTalkBusy(true, label);
          let result;
          try {
            result = await assistant?.rerunFromMessage?.(message.id, input, config);
          } finally {
            setTalkBusy(false, label);
          }
          renderTalk();
          put("#talkStatus", result?.ok === false ? result.text || "重新发送失败" : "完成");
        } else {
          assistant?.editMessage?.(message.id, value);
          renderTalk();
          put("#talkStatus", "已修改 AI 输出");
        }
      };
    }
    async function regenerateTalkMessage(message, index, session) {
      const previous = (session?.messages || []).slice(0, index).reverse().find((item) => item.role === "user");
      if (!previous) return notify("没有找到对应的用户消息");
      const config = configFromView();
      put("#talkStatus", "正在重新生成…");
      const label = $("#talkSendBtn")?.textContent || "📤 发送";
      const input = talkContext(previous.text, previous.imageIds || [], config);
      input.onStart = () => renderTalk();
      input.onDelta = () => scheduleTalkRender(updateStreamingTalk);
      input.onToolEvent = handleTalkToolEvent;
      setTalkBusy(true, label);
      let result;
      try {
        result = await assistant?.regenerateMessage?.(message.id, input, config);
      } finally {
        setTalkBusy(false, label);
      }
      renderTalk();
      put("#talkStatus", result?.ok === false ? result.text || "重新生成失败" : "完成");
    }
    function renderTalk() {
      const host = $("#talkConv");
      if (!host) return;
      const sessionList = assistant?.sessions?.() || [];
      const session = sessionList.length ? assistant?.currentSession?.() : null;
      host.replaceChildren();
      if (!session?.messages?.length)
        host.innerHTML =
          '<div class="cmsg sys"><div class="body">输入内容后发送；图片会自动编号并交给 Images 模块。</div></div>';
      else
        session.messages.forEach((message, index) => {
          const row = doc.createElement("div");
          row.dataset.messageId = message.id;
          row.className = "cmsg " + (message.role === "assistant" ? "ai" : message.role === "error" ? "err" : message.role === "system" ? "sys" : "user");
          const body = doc.createElement("div");
          body.className = "body";
          const candidateRows = message.mode === "draw" && (Array.isArray(message.candidates) ? message.candidates : message.result?.candidates || []);
          const parsedDraw = message.mode === "draw" && !message.result?.prompt && message.text
            ? assistant?.parseReply?.(message.text)
            : null;
          const drawPrompt = message.mode === "draw"
            ? candidateRows.length
              ? (message.result?.finalPrompt || (message.result?.finalCandidateId ? message.result?.prompt : ""))
              : message.result?.prompt || parsedDraw?.prompt
            : "";
          const bodyText = message.mode === "draw" && message.role !== "error" && (candidateRows.length || drawPrompt) ? "" : message.text || "";
          renderRichMessage(body, bodyText);
          if (!bodyText && message.status === "streaming" && !message.reasoning)
            body.textContent = "🤔 AI 正在思考…";
          if (!bodyText && message.status === "done" && candidateRows.length && !drawPrompt)
            body.textContent = "请选择一张候选图作为最终结果";
          row.appendChild(body);
          const reasoning = message.reasoning || parsedDraw?.thinking || "";
          if (reasoning) {
            const details = doc.createElement("details");
            details.className = "gthink";
            details.innerHTML = "<summary>💭 思考过程</summary><pre></pre>";
            const thinkingPre = details.querySelector("pre");
            thinkingPre.textContent = reasoning;
            thinkingPre.scrollTop = Number(ui.thinkingScroll[message.id]) || 0;
            thinkingPre.addEventListener("scroll", event => { ui.thinkingScroll[message.id] = event.currentTarget.scrollTop; });
            details.open = ui.thinkingOpen[message.id] ?? (message.status === "streaming" && !bodyText);
            details.addEventListener("toggle", () => {
              ui.thinkingOpen[message.id] = details.open;
            });
            row.appendChild(details);
          }
          renderActivityTimeline(row, message);
          const hasCandidates = message.mode === "draw" && renderCandidateCards(row, message);
          if (!hasCandidates && Array.isArray(message.imageIds) && message.imageIds.length) {
            const gallery = doc.createElement("div");
            gallery.className = "imgs";
            message.imageIds.forEach((id, index) => {
              const image = candidateImage({ imageId: id });
              const imageSource = image?.thumbnailDataUrl || image?.dataUrl || image?.viewUrl || "";
              if (!imageSource) return;
              const img = doc.createElement("img");
              img.src = imageSource;
              img.alt = "图片" + (index + 1);
              gallery.appendChild(img);
            });
            if (gallery.childElementCount) row.appendChild(gallery);
          }
          if (message.mode === "draw" && drawPrompt) {
            const final = doc.createElement("pre");
            final.className = "genout";
            const negative = candidateRows.length
              ? message.result?.finalNegative || message.result?.negative || ""
              : message.result?.negative || parsedDraw?.negative || "";
            final.textContent = `【最终提示词】\n${drawPrompt}${negative ? `\n\n【负面提示词】\n${negative}` : ""}`;
            row.appendChild(final);
          }
          if (Array.isArray(message.toolCalls) && message.toolCalls.length) {
            const toolsDetails = doc.createElement("details");
            toolsDetails.className = "tooltrace";
            toolsDetails.innerHTML = "<summary>🔧 工具调用（" + message.toolCalls.length + "）</summary><pre></pre>";
            toolsDetails.querySelector("pre").textContent = message.toolCalls.map(call => {
              const status = call.result?.ok === false ? "失败" : "完成";
              return `${call.name} · ${status}`;
            }).join("\n");
            row.appendChild(toolsDetails);
          }
          if (message.role === "user" || message.role === "assistant") {
            const actions = doc.createElement("div");
            actions.className = "cacts cmsg-actions-row " + (message.role === "user" ? "user-actions" : "ai-actions");
            if (message.role === "assistant" && message.status !== "streaming") {
              const regenButton = doc.createElement("button");
              setMessageActionIcon(regenButton, "regenerate", "重新生成");
              regenButton.onclick = () => regenerateTalkMessage(message, index, session);
              actions.appendChild(regenButton);
            }
            const copyButton = doc.createElement("button");
            setMessageActionIcon(copyButton, "copy", "复制这条消息");
            copyButton.onclick = async () => { if (await copy(message.text || "")) notify("消息已复制"); };
            actions.appendChild(copyButton);
            if (message.role === "user") {
              const editButton = doc.createElement("button");
              setMessageActionIcon(editButton, "edit", "修改并重新发送");
              editButton.onclick = () => editTalkMessage(row, message);
              actions.appendChild(editButton);
            }
            row.appendChild(actions);
          }
          host.appendChild(row);
        });
      talkScroll();
      renderTalkSessions();
      renderConversationRepository();
    }
    function updateStreamingTalk() {
      const host = $("#talkConv");
      const session = assistant?.currentSession?.();
      const message = session?.messages?.at(-1);
      if (!host || !message || message.status !== "streaming") return renderTalk();
      const row = [...host.children].find(item => item.dataset?.messageId === message.id);
      if (!row) return renderTalk();
      const body = $(".body", row);
      if (!body) return renderTalk();
      const candidateRows = message.mode === "draw" && (Array.isArray(message.candidates) ? message.candidates : message.result?.candidates || []);
      const parsedDraw = message.mode === "draw" && !message.result?.prompt && message.text
        ? assistant?.parseReply?.(message.text)
        : null;
      const drawPrompt = message.mode === "draw"
        ? candidateRows.length
          ? (message.result?.finalPrompt || (message.result?.finalCandidateId ? message.result?.prompt : ""))
          : message.result?.prompt || parsedDraw?.prompt
        : "";
      const bodyText = message.mode === "draw" && message.role !== "error" && (candidateRows.length || drawPrompt) ? "" : message.text || "";
      updateStreamingBody(body, bodyText);
      if (!bodyText && !message.reasoning) body.textContent = "🤔 AI 正在思考…";
      if (!bodyText && message.status === "done" && candidateRows.length && !drawPrompt)
        body.textContent = "请选择一张候选图作为最终结果";
      const reasoning = message.reasoning || parsedDraw?.thinking || "";
      let details = $(".gthink", row);
      if (reasoning) {
        if (!details) {
          details = doc.createElement("details");
          details.className = "gthink";
          details.innerHTML = "<summary>💭 思考过程</summary><pre></pre>";
          details.open = ui.thinkingOpen[message.id] ?? true;
          details.querySelector("pre").scrollTop = Number(ui.thinkingScroll[message.id]) || 0;
          details.querySelector("pre").addEventListener("scroll", event => { ui.thinkingScroll[message.id] = event.currentTarget.scrollTop; });
          details.addEventListener("toggle", () => { ui.thinkingOpen[message.id] = details.open; });
          row.appendChild(details);
        }
        const pre = $("pre", details);
        if (pre) {
          const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 16;
          const previousTop = pre.scrollTop;
          pre.textContent = reasoning;
          pre.scrollTop = atBottom ? pre.scrollHeight : Math.min(previousTop, Math.max(0, pre.scrollHeight - pre.clientHeight));
        }
      } else if (details) details.remove();
      updateActivityTimeline();
      talkScroll();
    }
    function conversationDeleteImpact(session) {
      const refs = imageRepository?.listConversation?.(session?.id)?.items || [];
      const shared = refs.filter(item => item.ownership === "shared-gallery").length;
      const owned = refs.length - shared;
      return {
        refs,
        message: localized("ui.ai.deleteConversationImpact", `消息 ${session?.messages?.length || 0} 条 · 专属图片 ${owned} 张 · 共享图片 ${shared} 张`, { messages: session?.messages?.length || 0, owned, shared })
      };
    }
    function confirmDeleteConversation(session, onDone) {
      const impact = conversationDeleteImpact(session);
      confirm(`${localized("ui.ai.deleteConversation", "确定删除对话“{title}”吗？", { title: session?.title || localized("ui.ai.newChatTitle", "新对话") })}\n${impact.message}`, retainImages => onDone?.(retainImages), { retainImages: true });
    }
    function renderTalkSessions() {
      const host = $("#talkSessionList");
      if (!host) return;
      host.replaceChildren();
      const sessions = assistant?.sessions?.() || [];
      const current = sessions.length ? assistant?.currentSession?.() : null;
      sessions.forEach((session) => {
        const row = doc.createElement("div");
        row.className = `tsession${current?.id === session.id ? " active" : ""}`;
        row.tabIndex = 0;
        row.setAttribute("role", "button");
        const title = doc.createElement("span");
        title.className = "ttitle";
        title.textContent = session.title || "新对话";
        const del = doc.createElement("button");
        del.type = "button";
        del.className = "tdel btn btn-icon btn-danger";
        del.textContent = "🗑️";
        del.title = "删除这条对话";
        del.onclick = (event) => {
          event.stopPropagation();
          confirmDeleteConversation(session, retainImages => {
            assistant?.deleteSession?.(session.id, { retainImages });
            renderTalk();
            renderConversationRepository();
            renderManager();
          }, { retainImages: true });
        };
        row.onclick = (event) => {
          if (event.target.closest(".tdel")) return;
          assistant.switchSession?.(session.id);
          renderTalk();
        };
        row.onkeydown = (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            row.click();
          }
        };
        row.append(title, del);
        host.appendChild(row);
      });
    }
    function candidateImage(candidate) {
      const id = str(candidate?.imageId);
      if (id) {
        try {
          const stored = imageStore?.get?.(id) || images?.get?.(id);
          if (stored?.dataUrl || stored?.thumbnailDataUrl) return stored;
          const ready = imageStore?.preview?.(id) || images?.preview?.(id);
          if (ready) return ready;
        } catch { /* use artifact fallback */ }
      }
      const previewUrl = str(candidate?.previewUrl || ui.candidatePreviews[candidate?.id] || ui.candidatePreviews[id]);
      return previewUrl ? { ...(candidate?.artifact || {}), dataUrl: previewUrl } : candidate?.artifact || null;
    }
    function candidatePromptText(candidate) {
      const prompt = str(candidate?.prompt);
      const negative = str(candidate?.negative);
      return `${prompt}${negative ? `\n\n【负面提示词】\n${negative}` : ""}`;
    }
    function activityLabel(item) {
      const name = item.name === "comfy.render" ? "ComfyUI"
        : item.name === "vision.processOne" ? "识图"
          : item.name === "tags.search" ? "Tag 查询" : item.name;
      if (item.type === "thinking") return `AI 思考（第 ${item.round || 1} 轮）`;
      if (item.type === "tool") return `调用 ${name || "工具"}`;
      if (item.type === "candidate") return `第 ${item.iteration || 1} 次返图已显示`;
      if (item.type === "evaluation") return `已评估 ${item.candidateId || "候选结果"}`;
      if (item.type === "recommendation") return `AI 推荐 ${item.candidateId || "候选结果"}`;
      if (item.type === "event") return item.name ? `${item.name} 事件` : "任务事件";
      return item.message || name || "任务事件";
    }
    function renderActivityTimeline(row, message) {
      const activity = Array.isArray(message?.activity) ? message.activity : [];
      if (!activity.length) return null;
      const details = doc.createElement("details");
      details.className = "draw-activity";
      const summary = doc.createElement("summary");
      summary.textContent = `任务过程（${activity.length}）`;
      const list = doc.createElement("ol");
      activity.forEach(item => {
        const line = doc.createElement("li");
        line.className = `activity-${item.status || "done"}`;
        const label = doc.createElement("span");
        label.textContent = activityLabel(item);
        line.appendChild(label);
        if (item.message && item.type !== "thinking") {
          const note = doc.createElement("small");
          note.textContent = item.message;
          line.appendChild(note);
        }
        list.appendChild(line);
      });
      details.append(summary, list);
      row.appendChild(details);
      details.open = message.status === "streaming";
      return details;
    }
    function updateActivityTimeline() {
      const host = $("#talkConv");
      const session = assistant?.currentSession?.();
      const message = session?.messages?.at(-1);
      if (!host || !message) return;
      const row = [...host.children].find(item => item.dataset?.messageId === message.id);
      if (!row) return;
      const details = $(".draw-activity", row);
      if (!details) return renderActivityTimeline(row, message);
      const list = $("ol", details);
      if (!list) return;
      const previousOpen = details.open;
      const next = doc.createDocumentFragment();
      (message.activity || []).forEach(item => {
        const line = doc.createElement("li");
        line.className = `activity-${item.status || "done"}`;
        const label = doc.createElement("span");
        label.textContent = activityLabel(item);
        line.appendChild(label);
        if (item.message && item.type !== "thinking") {
          const note = doc.createElement("small");
          note.textContent = item.message;
          line.appendChild(note);
        }
        next.appendChild(line);
      });
      list.replaceChildren(next);
      details.querySelector("summary").textContent = `任务过程（${(message.activity || []).length}）`;
      details.open = previousOpen;
    }
    function updateStreamingCandidates() {
      const host = $("#talkConv");
      const session = assistant?.currentSession?.();
      const message = session?.messages?.at(-1);
      if (!host || !message) return;
      const row = [...host.children].find(item => item.dataset?.messageId === message.id);
      if (!row || message.mode !== "draw") return;
      $(".draw-candidates", row)?.remove();
      renderCandidateCards(row, message);
      talkScroll();
    }
    function renderCandidateCards(row, message) {
      const candidates = Array.isArray(message?.candidates)
        ? message.candidates
        : Array.isArray(message?.result?.candidates) ? message.result.candidates : [];
      if (!candidates.length) return false;
      const selectedId = str(message.result?.finalCandidateId || message.result?.selectedCandidateId);
      const host = doc.createElement("div");
      host.className = "draw-candidates";
      candidates.forEach(candidate => {
        const card = doc.createElement("article");
        card.className = "draw-candidate";
        if (candidate.id === selectedId || candidate.selected) card.classList.add("selected");
        if (candidate.evaluation?.recommended) card.classList.add("recommended");
        const head = doc.createElement("div");
        head.className = "draw-candidate-head";
        const title = doc.createElement("strong");
        title.textContent = `第 ${Number(candidate.iteration) || 1} 次渲染`;
        const state = doc.createElement("span");
        state.className = "draw-candidate-state";
        state.textContent = candidate.id === selectedId || candidate.selected
          ? "最终选择"
          : candidate.evaluation?.recommended ? "AI 推荐" : "候选";
        head.append(title, state);
        card.appendChild(head);
        const image = candidateImage(candidate);
        const imageSource = image?.thumbnailDataUrl || image?.dataUrl || image?.viewUrl || "";
        if (imageSource) {
          const link = doc.createElement("a");
          link.href = imageSource;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.title = "点击查看大图";
          const preview = doc.createElement("img");
          preview.src = imageSource;
          preview.alt = `第 ${Number(candidate.iteration) || 1} 次生成图片`;
          preview.loading = "lazy";
          link.appendChild(preview);
          card.appendChild(link);
        }
        if (candidate.evaluation?.summary) {
          const evaluation = doc.createElement("p");
          evaluation.className = "draw-candidate-evaluation";
          evaluation.textContent = candidate.evaluation.summary;
          card.appendChild(evaluation);
        }
        const tags = doc.createElement("details");
        tags.className = "draw-candidate-tags";
        const tagsSummary = doc.createElement("summary");
        tagsSummary.textContent = "查看本轮 Tag";
        const tagsBody = doc.createElement("pre");
        tagsBody.textContent = candidatePromptText(candidate);
        tags.append(tagsSummary, tagsBody);
        card.appendChild(tags);
        const actions = doc.createElement("div");
        actions.className = "draw-candidate-actions";
        const copyPrompt = doc.createElement("button");
        copyPrompt.type = "button";
        copyPrompt.className = "cico btn btn-secondary";
        copyPrompt.textContent = "完整";
        copyPrompt.title = "复制本轮完整提示词";
        copyPrompt.onclick = async () => { if (await copy(candidatePromptText(candidate))) notify("本轮提示词已复制"); };
        const copyPositive = doc.createElement("button");
        copyPositive.type = "button";
        copyPositive.className = "cico btn btn-secondary";
        copyPositive.textContent = "正向";
        copyPositive.title = "复制本轮正向 Tag";
        copyPositive.onclick = async () => { if (await copy(candidate.prompt)) notify("正向 Tag 已复制"); };
        const copyNegative = doc.createElement("button");
        copyNegative.type = "button";
        copyNegative.className = "cico btn btn-secondary";
        copyNegative.textContent = "负向";
        copyNegative.title = "复制本轮负向 Tag";
        copyNegative.disabled = !str(candidate.negative);
        copyNegative.onclick = async () => { if (await copy(candidate.negative)) notify("负向 Tag 已复制"); };
        const choose = doc.createElement("button");
        choose.type = "button";
        choose.className = "draw-candidate-choose btn btn-primary";
        choose.textContent = candidate.id === selectedId || candidate.selected ? "已选为最终结果" : "设为最终结果";
        choose.disabled = candidate.id === selectedId || candidate.selected;
        choose.onclick = () => {
          const result = assistant?.chooseCandidate?.(message.id, candidate.id, "user");
          if (result) { renderTalk(); notify(`已选择第 ${Number(candidate.iteration) || 1} 次结果`); }
        };
        actions.append(copyPrompt, copyPositive, copyNegative, choose);
        card.appendChild(actions);
        host.appendChild(card);
      });
      row.appendChild(host);
      return true;
    }
    function toolProgress(selector, event) {
      if (!event || !event.name) return;
      const label = event.name === "vision.processOne" ? (event.arguments?.mode === "local" ? "本地识图" : event.arguments?.mode === "metadata" ? "读取图片信息" : "识图 AI") : event.name === "tags.search" ? "Tag 查询" : event.name === "comfy.render" ? "ComfyUI" : event.name;
      if (event.type === "ai-start") put(selector, `AI 正在思考（第 ${Number(event.round) || 1} 轮）…`);
      else if (event.type === "start") put(selector, `正在调用 ${label}…`);
      else if (event.type === "event" && event.event?.type === "progress") put(selector, `${label} 排队中（队列 ${Number(event.event.queue) || 0}）…`);
      else if (event.type === "complete") {
        if (event.result?.ok === false) {
          const reason = event.result.error || event.result.text || "请检查设置后重试";
          put(selector, `${label}调用失败：${reason}`);
        } else put(selector, `${label}调用完成`);
      }
    }
    function handleTalkToolEvent(event) {
      toolProgress("#talkStatus", event);
      updateActivityTimeline();
      if (event?.name !== "comfy.render") return;
      if (event.type === "start") put("#talkStatus", "ComfyUI 渲染中…");
      if (event.type === "complete" && event.result?.ok !== false) put("#talkStatus", "已收到 ComfyUI 返图");
      if (event.type === "complete" && (event.result?.code === "COMFY_CALL_LIMIT" || event.result?.status === "tool_limit")) put("#talkStatus", `已达到 AI 出图调用上限（${Number(settings().maxComfyCalls) || 3} 次）`);
      if (event.type === "candidate-ready") {
        if (event.candidate?.id && event.candidate?.previewUrl) ui.candidatePreviews[event.candidate.id] = event.candidate.previewUrl;
        updateStreamingCandidates();
        updateActivityTimeline();
        put("#talkStatus", `已显示第 ${Number(event.candidate?.iteration) || 1} 次生成结果`);
      }
      if (event.type === "candidate-recommended") {
        updateStreamingCandidates();
        updateActivityTimeline();
        put("#talkStatus", `AI 推荐第 ${Number(String(event.candidateId).split(/[-_]/).pop()) || 1} 次结果`);
      }
      if (event.type === "candidate-evaluated") {
        updateStreamingCandidates();
        updateActivityTimeline();
        put("#talkStatus", `已评估第 ${Number(String(event.candidateId).split(/[-_]/).pop()) || 1} 次结果`);
      }
    }
    function talkScroll(force = false) {
      const host = $("#talkConv");
      if (host && (force || ui.comfyFollow["#talkConv"] !== false)) host.scrollTop = host.scrollHeight;
    }
    async function sendTalk() {
      const text = str($("#talkIn")?.value);
      const sessionId = currentTalkSessionId();
      const pendingRefs = sessionId ? (imageRepository?.pendingConversationReferences?.(sessionId) || conversationRows().filter(item => item.pending)) : [];
      const ids = pendingRefs.map(item => item.imageId).filter(Boolean);
      if (!text && !ids.length) return notify("请输入内容或先添加图片");
      const s = configFromView();
      const input = talkContext(text, ids, s);
      input.mode = ui.talkMode === "draw" ? "draw" : "assistant";
      input.task = ui.talkMode === "draw" ? (drawContextTask() === "comfy" ? "comfy" : "draw") : "assistant";
      input.autoLocalVision = input.mode === "draw" && ids.length > 0;
      input.maxComfyCalls = Number(s.maxComfyCalls) || Number(s.comfyIters) || 3;
      let streamRenderPending = false;
      input.onStart = () => renderTalk();
      input.onDelta = () => {
        if (streamRenderPending) return;
        streamRenderPending = true;
        setTimeout(() => {
          streamRenderPending = false;
          updateStreamingTalk();
        }, 50);
      };
      input.onToolEvent = event => {
        handleTalkToolEvent(event);
      };
      if (ids.length && !modelIsVision(s.model))
        notify("当前模型未标记为视觉模型，若发送失败请切换带 👁 的模型");
      if (input.task === "comfy" && (!s.comfyWorkflow || s.comfyOn === false)) {
        return notify(capabilityLabel({ comfy: {
          enabled: s.comfyOn !== false,
          workflowReady: Boolean(s.comfyWorkflow),
          render: false
        } }));
      }
      const button = $("#talkSendBtn");
      const label = button?.textContent || "📤 发送";
      setTalkBusy(true, label);
      $("#talkIn").value = "";
      resizeTalkInput();
      put("#talkStatus", "AI 处理中…");
      let result;
      try {
        result = await assistant?.run?.(input, s);
      } catch (error) {
        result = { ok: false, text: error.message || String(error), error: error.message || String(error) };
      }
      if (result?.ok !== false) {
        imageRepository?.markSent?.(sessionId, pendingRefs.map(item => item.refId));
        renderConversationRepository();
      }
      renderTalk();
      put("#talkStatus", result?.ok === false ? result.text || result.error || "发送失败" : "完成");
      setTalkBusy(false, label);
    }
    function renderManager() {
      const host = $("#mgrGenList");
      if (!host) return;
      const sessionList = assistant?.sessions?.() || [];
      const current = sessionList.length ? assistant?.currentSession?.() : null;
      put("#mgrGenCur", current ? `${current.title || "当前对话"} · ${(current.messages || []).filter((item) => item.mode === "draw").length} 条绘图消息` : "暂无当前绘图对话");
      put("#mgrChatCur", current ? `${current.title || "当前对话"} · ${(current.messages || []).filter((item) => item.mode === "assistant").length} 条助手消息` : "暂无当前助手对话");
      if (!$("#mgrActions")) {
        const actions = doc.createElement("div");
        actions.id = "mgrActions";
        actions.className = "row";
        actions.innerHTML =
          '<button class="abtn btn btn-secondary" id="mgrExport">📋 导出对话</button><button class="abtn btn btn-secondary" id="mgrImport">📥 导入对话</button><button class="abtn ghost btn btn-danger" id="mgrClear">🗑 清空当前</button><input id="mgrImportFile" type="file" accept=".json,application/json" hidden>';
        host.parentElement?.insertBefore(actions, host);
        $("#mgrExport").onclick = () => {
          const blob = new Blob([assistant?.exportSessions?.() || "[]"], {
            type: "application/json",
          });
          const link = doc.createElement("a");
          link.href = URL.createObjectURL(blob);
          link.download = "ai-tag-sessions.json";
          link.click();
          setTimeout(() => URL.revokeObjectURL(link.href), 500);
        };
        $("#mgrImport").onclick = () => $("#mgrImportFile")?.click();
        $("#mgrImportFile").onchange = (event) => {
          const file = event.target.files?.[0];
          if (file)
            readText(file).then((value) => {
              assistant?.importSessions?.(value, false);
              renderManager();
            });
        };
        $("#mgrClear").onclick = () => {
          const sessions = assistant?.sessions?.() || [];
          const current = sessions.length ? assistant?.currentSession?.() : null;
          if (current) assistant?.clearSession?.(current.id);
          renderManager();
          renderTalk();
          renderConversationRepository();
        };
      }
      host.replaceChildren();
      (assistant?.sessions?.() || []).forEach((session) => {
        const row = doc.createElement("div");
        row.className = "fav";
        row.innerHTML = `<b>${session.title || "对话"}</b><span class="muted"> ${(session.messages || []).length} 条</span><div class="row"><button class="abtn btn btn-secondary load">载入</button><button class="abtn ghost btn btn-danger del">删除</button></div>`;
        row.querySelector(".load").onclick = () => {
          assistant.switchSession?.(session.id);
          renderTalk();
          renderConversationRepository();
          showAi("talk");
        };
        row.querySelector(".del").onclick = () => confirmDeleteConversation(session, retainImages => { assistant.deleteSession?.(session.id, { retainImages }); renderManager(); renderTalk(); renderConversationRepository(); });
        host.appendChild(row);
      });
    }
    function syncTalkMode() {
      const modes = $$(".tkmode");
      const active = modes.find((item) => item.dataset.mode === ui.talkMode) || modes[0];
      if (!active) return;
      modes.forEach((item) => { const selected = item === active; item.classList.toggle("on", selected); item.setAttribute("aria-pressed", selected ? "true" : "false"); });
      const thumb = $("#tkThumb");
      if (thumb) { thumb.style.left = `${active.offsetLeft}px`; thumb.style.width = `${active.offsetWidth}px`; }
    }
    function setTalkMode(mode, options = {}) {
      const normalized = mode === "draw" ? "draw" : "assistant";
      ui.talkMode = ["assistant", "draw"].includes(normalized) ? normalized : "assistant";
      if (options.persist !== false) storage.set("app.talkMode", ui.talkMode);
      syncTalkMode();
      syncDrawControls();
    }
    function showAi(tab) {
      const nextTab = [
        "talk",
        "prompt",
        "api",
        "mgr",
      ].includes(tab)
        ? tab
        : "talk";
      if (ui.aiTab === "api" && nextTab !== "api") flushSettingsSave();
      ui.aiTab = nextTab;
      const views = {
        talk: "#tabTalk",
        prompt: "#tabPrompt",
        api: "#tabApi",
        mgr: "#tabMgr",
      };
      Object.values(views).forEach((selector) => show(selector, false));
      show(views[ui.aiTab], true);
      $$(".ai-module-tab").forEach((button) => {
        const active = button.dataset.panel === ui.aiTab;
        button.classList.toggle("on", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
      });
      const active = $(".ai-module-tab.on");
      const thumb = $(".ai-module-thumb");
      if (active && thumb) {
        thumb.style.left = `${active.offsetLeft}px`;
        thumb.style.width = `${active.offsetWidth}px`;
      }
      if (ui.aiTab === "prompt") renderPrompt();
      if (ui.aiTab === "api") loadSettings();
      if (ui.aiTab === "mgr") renderManager();
      if (ui.aiTab === "talk") requestAnimationFrame(syncTalkMode);
      ensureVisionPanePlacement();
    }
    function ensureVisionPanePlacement() {
      const pane = $("#tagPane");
      const tagSlot = $("#tagVisionSlot");
      const workspace = doc.body;
      if (!pane || !tagSlot || !workspace) return;
      // Keep the drawer outside route-specific containers. In particular, the
      // AI view is hidden on the translation page; a fixed descendant of that
      // hidden subtree would not be paintable when the nav button is clicked.
      const target = workspace;
      if (pane.parentElement !== target) target.appendChild(pane);
      tagSlot.classList.toggle("active", ui.route === "tags");
      setVisionOpen(ui.visionOpen);
    }
    function route(route) {
      if (ui.route === "ai" && ui.aiTab === "api" && route !== "ai") flushSettingsSave();
      const wasAi = ui.route === "ai";
      const wasTags = ui.route === "tags";
      const wasGallery = ui.route === "gallery";
      if (route === "gallery" && wasAi) ui.aiTabBeforeGallery = ui.aiTab;
      ui.route = route;
      if (route === "tags" && !wasTags) {
        ui.subcategory = "";
        ui.visible = 400;
      }
      const ai = route === "ai";
      if (ai && !wasAi) ui.aiTab = wasGallery ? ui.aiTabBeforeGallery : ui.aiTab;
      const shell = $("#wrapEl");
      const aiView = $("#aiView");
      if (shell && aiView && aiView.parentElement !== shell)
        shell.appendChild(aiView);
      show("#tagLibraryView", route === "tags");
      const galleryView = $("#galleryView");
      if (galleryView) { galleryView.hidden = route !== "gallery"; galleryView.style.display = route === "gallery" ? "" : "none"; }
      show(".main", !ai);
      show("#aiView", ai);
      show("#aiCfgBtns", ai);
      show("#sidebar", route !== "translation" && route !== "gallery");
      show("#catList", route === "tags");
      show("#addTagBtn", route === "tags");
      show("#sideAi", ai);
      // 选择栏是全局工作区底栏，切换翻译/AI 时仍保留当前 Tag 组合。
      show(".bar", route !== "gallery");
      const search = $("#searchWrap");
      if (search) {
        const searchHidden = ai || route === "gallery";
        search.style.display = searchHidden ? "none" : "";
        search.style.visibility = searchHidden ? "hidden" : "";
        search.style.pointerEvents = searchHidden ? "none" : "";
      }
      const tv = $("#translateView");
      // index.html keeps the translation pane hidden for the initial paint.
      // `hidden` wins over CSS display, so clear/toggle the attribute as well
      // as the inline style when routing to it.
      if (tv) {
        const active = route === "translation";
        tv.hidden = !active;
        tv.style.display = active ? "" : "none";
      }
      doc.body.classList.toggle("aiview", ai);
      doc.body.classList.toggle("translation-mode", route === "translation");
      syncNavigationStates();
      ensureVisionPanePlacement();
      if (ai) {
        renderVisionPreview();
        renderTalkVisionPanel();
        scheduleCapabilitiesStatus();
        showAi(ui.aiTab);
      }
      if (route === "gallery") renderGallery();
    }
    function applyTheme(value) {
      const theme = str(value, "light");
      const dark =
        theme === "dark" ||
        (theme === "auto" &&
          global.matchMedia?.("(prefers-color-scheme: dark)").matches);
      doc.body.classList.toggle("dark", dark);
      storage.set("app.theme", theme);
      $$(".popitem[data-theme]").forEach((item) => {
        const check = $(".ck", item);
        if (check) check.textContent = item.dataset.theme === theme ? "✓" : "";
      });
    }
    function locale(id) {
      const pack = modules.locales?.[id] || {};
      const lookup = (key) =>
        str(key)
          .split(".")
          .reduce((obj, part) => obj && obj[part], pack);
      $$("[data-i18n]").forEach((el) => {
        const value = lookup(el.dataset.i18n);
        if (value != null && typeof value !== "object") el.textContent = String(value).replace(/V1\.4\.1/g, `V${modules.version || "1.4.92"}`);
      });
      $$("[data-i18n-placeholder]").forEach((el) => {
        const value = lookup(el.dataset.i18nPlaceholder);
        if (value != null) el.placeholder = String(value).replace(/V1\.4\.1/g, `V${modules.version || "1.4.92"}`);
      });
      $$("[data-i18n-title]").forEach((el) => {
        const value = lookup(el.dataset.i18nTitle);
        if (value != null) el.title = value;
      });
      $$("[data-i18n-aria]").forEach((el) => {
        const value = lookup(el.dataset.i18nAria);
        if (value != null) el.setAttribute("aria-label", value);
      });
      const precision = $("#searchPrecision");
      if (precision) precision.value = ui.searchPrecision;
      doc.documentElement.lang = id;
      ui.locale = id;
      storage.set("app.locale", id);
      const localizedTitle = localized("ui.document.title", doc.title);
      if (localizedTitle) doc.title = localizedTitle.replace(/V1\.4\.1/g, `V${modules.version || "1.4.92"}`);
      put("#brandSub", `V${modules.version || "1.4.92"}`);
      syncNavigationStates();
      syncApiMode();
      renderConversationRepository();
      renderCategories();
      renderTags();
      renderCustomCategories();
      renderTalkVisionPanel();
      setVisionOpen(ui.visionOpen);
      if (ui.route === "gallery") renderGallery();
      if (ui.aiTab === "prompt") renderPrompt();
    }

    function toggleThemeMenu(event) {
      event?.stopPropagation?.();
      const pop = $("#themePop");
      if (pop) pop.hidden = !pop.hidden;
    }
    function toggleLocaleMenu() {
      const pop = $("#localePop");
      if (!pop) return locale(ui.locale === "zh-CN" ? "en-US" : "zh-CN");
      if (!pop.childElementCount) {
        [
          ["zh-CN", "简体中文"],
          ["en-US", "English"],
        ].forEach(([id, label]) => {
          const option = doc.createElement("button");
          option.className = "popitem btn btn-menu";
          option.dataset.locale = id;
          option.innerHTML = '<span class="ck"></span><span></span>';
          $("span:last-child", option).textContent = label;
          option.onclick = () => {
            locale(id);
            pop.hidden = true;
          };
          pop.appendChild(option);
        });
      }
      $$(".popitem[data-locale]", pop).forEach((option) => {
        $(".ck", option).textContent = option.dataset.locale === ui.locale ? "✓" : "";
      });
      pop.hidden = !pop.hidden;
    }
    function bindNavigation() {
      Object.entries(navActionConfig).forEach(([name, config]) => {
        const button = $(config.selector);
        if (!button || typeof config.run !== "function") return;
        button.dataset.navAction = name;
        button.addEventListener("click", event => {
          config.run(event);
          syncNavigationStates();
        });
      });
      syncNavigationStates();
    }

    function bind() {
      $("#searchPrecision")?.addEventListener("change", (event) => {
        ui.searchPrecision = normaliseSearchPrecision(event.target.value);
        event.target.value = ui.searchPrecision;
        storage.set("app.searchPrecision", ui.searchPrecision);
        tags?.setSearchPrecision?.(ui.searchPrecision);
        ui.tagPageCache.clear();
        ui.visible = 400;
        renderCategories();
        renderTags();
      });
      $("#q")?.addEventListener("input", (event) => {
        ui.subcategory = "";
        ui.visible = 400;
        ui.tagPageCache.clear();
        clearTimeout(ui.searchTimer);
        ui.searchTimer = setTimeout(() => {
          tags?.setQuery?.(event.target.value);
          renderCategories();
          renderTags();
        }, 120);
      });
      $("#q")?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          clearTimeout(ui.searchTimer);
          executeSearch();
        }
      });
      $("#searchBtn")?.addEventListener("click", () => {
        clearTimeout(ui.searchTimer);
        executeSearch();
      });
      $("#clearQ")?.addEventListener("click", () => {
        $("#q").value = "";
        ui.subcategory = "";
        ui.tagPageCache.clear();
        tags?.setQuery?.("");
        renderCategories();
        renderTags();
      });
      $("#catList")?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-cat]");
        if (!button) return;
        if (ui.route !== "tags") route("tags");
        clearTimeout(ui.searchTimer);
        tags?.setCategory?.(button.dataset.cat);
        // Keep the text as a reusable draft, but leave the active result set
        // so the selected category can be browsed before searching again.
        tags?.setQuery?.("");
        ui.subcategory = "";
        ui.visible = 400;
        ui.tagPageCache.clear();
        renderCategories();
        renderTags();
      });
      $("#subcatNav")?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-subcategory]");
        if (!button) return;
        ui.subcategory = str(button.dataset.subcategory);
        ui.visible = 400;
        ui.tagPageCache.clear();
        renderSubcategoryNav(tagSnapshot());
        renderTags();
      });
      $("#chips")?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-en]");
        if (!button) return;
        if (event.target.closest(".cp")) {
          copy(button.dataset.en);
          showChipToast(button, localized("ui.tag.copied", "已复制"));
          return;
        }
        const id = button.dataset.en;
        const current = selectedIds().includes(id);
        tags?.select?.(id, !current);
        copy(id);
        showChipToast(button, localized("ui.tag.copied", "已复制"));
        syncSelectedClasses();
        renderSelection();
      });
      $("#selbox")?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-remove]");
        if (button) {
          tags?.select?.(button.dataset.remove, false);
          syncSelectedClasses();
          renderSelection();
        }
      });
      $("#clearSel")?.addEventListener("click", () => {
        tags?.clearSelection?.();
        syncSelectedClasses();
        renderSelection();
      });
      $("#copyAll")?.addEventListener("click", async () => {
        if (await copy(tags?.selectedText?.(", ") || ""))
          notify("Prompt 已复制");
        else notify("复制失败，请检查剪贴板权限");
      });
      $("#aiNsfwChk")?.addEventListener("change", (event) => {
        tags?.setAdult?.(event.target.checked);
        renderCategories();
        renderTags();
      });
      $("#saveFav")?.addEventListener("click", openDrawer);
      $("#drawerClose")?.addEventListener("click", closeDrawer);
      $("#scrim")?.addEventListener("click", () => {
        closeDrawer();
        setVisionOpen(false);
      });
      $("#favSave")?.addEventListener("click", () => {
        const ids = selectedIds();
        if (!ids.length) return notify("请先选择 Tag");
        assistant?.addFavorite?.({
          name: str($("#favName")?.value, "未命名收藏"),
          tags: ids,
        });
        renderFavorites();
      });
      $("#addTagBtn")?.addEventListener("click", () => {
        renderCustomCategories();
        renderCustomList();
        $("#addModal")?.classList.add("show");
      });
      $("#addClose")?.addEventListener("click", () =>
        $("#addModal")?.classList.remove("show"),
      );
      $("#nCancel")?.addEventListener("click", () =>
        $("#addModal")?.classList.remove("show"),
      );
      $("#nCat")?.addEventListener("change", (event) => {
        if ($("#nNewCatWrap"))
          $("#nNewCatWrap").style.display =
            event.target.value === "__new__" ? "" : "none";
      });
      $("#nSave")?.addEventListener("click", () => {
        const category =
          $("#nCat")?.value === "__new__"
            ? str($("#nNewCat")?.value, "other")
            : str($("#nCat")?.value, "other");
        const item = {
          en: str($("#nEn")?.value),
          zh: str($("#nZh")?.value),
          aliases: str($("#nAl")?.value),
          subcategory: str($("#nSub")?.value, "自定义"),
          category,
        };
        if (!item.en) return notify("英文 Tag 不能为空");
        tags?.addCustom?.(item);
        $("#addModal")?.classList.remove("show");
        renderCustomCategories();
        renderCustomList();
        renderCategories();
        renderTags();
      });
      $$(".popitem[data-theme]").forEach((item) =>
        item.addEventListener("click", () => {
          applyTheme(item.dataset.theme);
          $("#themePop").hidden = true;
        }),
      );
      bindNavigation();
      galleryPreferences();
      $("#galleryUpload")?.addEventListener("click", () => $("#galleryFile")?.click());
      $("#galleryFile")?.addEventListener("change", async event => {
        let added = 0;
        try {
          for (const file of [...(event.target.files || [])].filter(item => item.type?.startsWith("image/"))) {
            const item = await addImage(file, "gallery");
            if (item?.id && imageRepository?.addToGallery?.(item.id, { source: "upload" })) added += 1;
          }
          if (!added && event.target.files?.length) notify(galleryText("uploadFailed", "图片上传失败，请检查文件格式或权限"));
        } catch (error) {
          notify(error?.message || String(error));
        }
        event.target.value = "";
        renderGallery();
      });
      $("#galleryOrder")?.addEventListener("change", event => { ui.galleryOrder = ["oldest", "newest"].includes(event.target.value) ? event.target.value : "oldest"; storage.set("gallery.order", ui.galleryOrder); renderGallery(); });
      $("#galleryColumns")?.addEventListener("change", event => { ui.galleryColumns = ["two", "single"].includes(event.target.value) ? event.target.value : "two"; storage.set("gallery.columns", ui.galleryColumns); renderGallery(); });
      $("#gallerySize")?.addEventListener("change", event => { ui.gallerySize = ["compact", "standard", "large"].includes(event.target.value) ? event.target.value : "standard"; storage.set("gallery.size", ui.gallerySize); renderGallery(); });
      $("#galleryQuery")?.addEventListener("input", event => { ui.galleryQuery = String(event.target.value || "").trim(); renderGallery(); });
      $("#galleryDownload")?.addEventListener("click", () => {
        const selected = galleryRows().filter(item => ui.gallerySelected.has(item.imageId));
        if (!selected.length) return notify(galleryText("selectFirst", "请先选择图片"));
        selected.forEach(galleryDownloadItem);
      });
      $("#galleryDelete")?.addEventListener("click", () => {
        const selected = galleryRows().filter(item => ui.gallerySelected.has(item.imageId));
        if (!selected.length) return notify(galleryText("selectFirst", "请先选择图片"));
        const details = selected.map(item => { const refs = imageRepository?.referenceCount?.(item.imageId) || {}; return `${item.displayName || item.filename || item.imageId}: ${galleryText("deleteImpact", "会话引用 {conversations}，消息引用 {messages}。", refs)}`; }).join("\n");
        const choice = typeof global.prompt === "function" ? global.prompt(`${galleryText("batchDeleteConfirm", "确定处理 {count} 张图片吗？", { count: selected.length })}\n${details}\n1. ${galleryText("removeOnly", "仅移除图库关联")}\n2. ${galleryText("purge", "彻底删除（无引用时）")}`, "1") : "1";
        if (!["1", "2"].includes(choice)) return;
        selected.forEach(item => imageRepository?.removeFromGallery?.(item.imageId, { purge: choice === "2", retain: choice !== "2" })); ui.gallerySelected.clear(); renderGallery();
      });
      $("#menuBtn")?.addEventListener("click", () => {
        const sidebar = $("#sidebar");
        if (!sidebar) return;
        sidebar.classList.toggle("hide");
        // 移动端使用 show 控制滑入；桌面端使用 hide 收起侧栏。
        if (global.innerWidth <= 860) sidebar.classList.toggle("show", !sidebar.classList.contains("hide"));
      });
      $("#sponsorClose")?.addEventListener("click", () =>
        $("#sponsorModal")?.classList.remove("show"),
      );
      $("#translateBack")?.addEventListener("click", () => route("tags"));
      $("#aiClose")?.addEventListener("click", () => route("tags"));
      $$(".ai-module-tab").forEach((button) =>
        button.addEventListener("click", () => {
          const panel = button.dataset.panel;
          if (ui.route === "ai") showAi(panel);
          else {
            ui.aiTab = panel;
            if (ui.route === "gallery") ui.aiTabBeforeGallery = panel;
            route("ai");
          }
        }),
      );
      $("#apiBack")?.addEventListener("click", () => showAi("talk"));
      $("#promptBack")?.addEventListener("click", () => showAi("talk"));
      doc.addEventListener("click", (event) => {
        if (!event.target.closest(".popwrap")) {
          $("#themePop")?.setAttribute("hidden", "");
          $("#localePop")?.setAttribute("hidden", "");
        }
      });
      $$(".tkmode").forEach((button) =>
        button.addEventListener("click", (event) => {
          if (event.target.closest("select")) return;
          setTalkMode(button.dataset.mode || "assist");
        }),
      );
      syncVisionPaneOffset();
      global.addEventListener("resize", () => {
        syncTalkMode();
        syncVisionPaneOffset();
      });
      const persistedComfyFields = ["#comfyBase", "#comfyPos", "#comfyNeg", "#comfyW", "#comfyH", "#comfySteps", "#comfyCfg", "#comfyIters", "#batchCount", "#maxComfyCalls", "#generateNegativeTags", "#comfyWf"];
      persistedComfyFields.forEach(selector => $(selector)?.addEventListener("change", () => {
        configFromView();
        if (selector === "#comfyIters" && ui.talkMode === "draw") syncDrawControls(ui.comfyCapabilities);
      }));
      ["#comfyBase", "#comfyPos", "#comfyNeg", "#comfyWf"].forEach(selector =>
        $(selector)?.addEventListener("input", scheduleSettingsSave),
      );
      $("#talkConv")?.addEventListener("scroll", event => {
        const host = event.currentTarget;
        ui.comfyFollow["#talkConv"] = host.scrollHeight - host.scrollTop - host.clientHeight < 40;
      });
      $("#talkSendBtn")?.addEventListener("click", sendTalk);
      $("#tkDrawRender")?.addEventListener("change", event => {
        if (ui.talkMode === "draw") setDrawComfyEnabled(event.target.checked);
      });
      $("#tkDrawIterations")?.addEventListener("change", event => {
        if (ui.talkMode === "draw") setDrawIterations(event.target.value);
      });
      $("#talkStopBtn")?.addEventListener("click", () => {
        assistant?.cancel?.();
        put("#talkStatus", "正在停止…");
      });
      $("#talkIn")?.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          sendTalk();
        }
      });
      $("#talkIn")?.addEventListener("input", resizeTalkInput);
      $("#talkNew")?.addEventListener("click", () => {
        assistant?.newSession?.();
        renderTalk();
        renderConversationRepository();
      });
      $("#talkManage")?.addEventListener("click", () => showAi("mgr"));
      $("#talkClearBtn")?.addEventListener("click", () => {
        const session = assistant?.currentSession?.();
        if (session) assistant?.clearSession?.(session.id);
        renderTalk();
        renderConversationRepository();
      });
      $("#talkImgBtn")?.addEventListener("click", () =>
        $("#talkImgFile")?.click(),
      );
      $("#talkImgFile")?.addEventListener("change", (event) =>
        addConversationImages(event.target.files)
          .catch(error => notify(error?.message || String(error)))
          .finally(() => { event.target.value = ""; }),
      );
      $("#talkRepositoryColumns")?.addEventListener("change", event => { const value = event.target.value === "single" ? "single" : "two"; storage.set("conversation.columns", value); renderConversationRepository(); });
      $("#talkRepositorySize")?.addEventListener("change", event => { const value = ["compact", "standard", "large"].includes(event.target.value) ? event.target.value : "standard"; storage.set("conversation.size", value); renderConversationRepository(); });
      $("#talkRepositoryClearPending")?.addEventListener("click", () => { imageRepository?.resetPending?.(currentTalkSessionId()); renderConversationRepository(); });
      $("#tpUpload")?.addEventListener("click", () => $("#tpFile")?.click());
      $("#tpFile")?.addEventListener("change", (event) => {
        const input = event.target;
        Promise.resolve().then(() => addVisionFiles(input.files)).catch(error => notify(error?.message || String(error))).finally(() => { input.value = ""; });
      });
      $("#tpIdentify")?.addEventListener("click", () => localVision());
      $("#tpWdModel")?.addEventListener("change", () => {
        const select = $("#tpWdModel");
        if (select) select.title = select.selectedOptions?.[0]?.textContent || localized("ui.ai.visionModel", "识图模型");
        if (!currentVisionId()) return;
        renderTalkVisionPanel();
      });
      $("#tpDescribe")?.addEventListener("click", () => describe());
      $("#tpStop")?.addEventListener("click", () => {
        if (!ui.visionBusy) return;
        cancelVisionRequest(true);
        ui.visionDescription = "AI 识图已停止";
        renderTalkVisionPanel();
        show("#tpStop", false);
      });
      $("#tpClearImg")?.addEventListener("click", () => {
        ui.visionUploadId += 1;
        cancelVisionRequest(true);
        clearVisionResult();
        visionTempStore?.clear?.();
        renderVisionPreview();
        renderTalkVisionPanel();
        refreshCapabilitiesStatus();
        show("#tpStop", false);
      });
      $("#aiPreset")?.addEventListener("change", (event) => {
        if (event.target.value) {
          if ($("#aiBase")) $("#aiBase").value = event.target.value;
          configFromView();
          syncApiMode();
          populateModels({ selectedModel: settings().model });
        }
      });
      $("#aiBase")?.addEventListener("change", () => {
        configFromView();
        syncApiMode();
        populateModels({ selectedModel: settings().model });
        populateVisionModels({ selectedModel: $("#visionInheritPrimary")?.checked ? settings().model : settings().visionModel, fetch: false });
      });
      $("#aiModel")?.addEventListener("change", () => {
        syncCustomModelInput();
        configFromView();
        if ($("#visionInheritPrimary")?.checked) populateVisionModels({ selectedModel: settings().model, fetch: false });
      });
      $("#aiModelCustom")?.addEventListener("input", configFromView);
      $("#aiModelCustom")?.addEventListener("change", configFromView);
      $("#visionInheritPrimary")?.addEventListener("change", () => {
        configFromView({ preserveVisionModel: true });
        syncApiMode();
        populateVisionModels({ selectedModel: settings().visionModel, fetch: false });
      });
      $("#visionBase")?.addEventListener("change", () => { configFromView(); populateVisionModels(); });
      $("#visionModel")?.addEventListener("change", () => { syncVisionCustomModelInput(); configFromView(); });
      $("#visionModelCustom")?.addEventListener("input", configFromView);
      $("#visionModelCustom")?.addEventListener("change", configFromView);
      $("#visionKey")?.addEventListener("change", () => { configFromView(); populateVisionModels(); });
      $("#visionTest")?.addEventListener("click", async () => {
        const s = configFromView();
        const client = assistant?.visionAi;
        if (!client?.complete) return notify("识图 API 不可用");
        try {
          const testImage = currentVisionImage()?.dataUrl || "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
          const result = await client.complete([{ role: "user", content: [
            { type: "text", text: "请只回复 OK，确认当前模型支持图片输入。" },
            { type: "image_url", image_url: { url: testImage } }
          ] }], {
            base: s.visionInheritPrimary ? s.base : s.visionBase,
            key: s.visionInheritPrimary ? s.key : s.visionKey,
            model: s.visionInheritPrimary ? s.model : s.visionModel,
            stream: false,
            timeoutMs: 10000,
          });
          notify(result?.ok === false ? result.error || result.text || "当前模型不支持图片输入" : "识图 API 图片测试成功");
        } catch (error) { notify(error?.message || String(error)); }
      });
      $("#aiKey")?.addEventListener("change", () => {
        configFromView();
        populateModels();
      });
      $("#aiKeyClear")?.addEventListener("click", () => {
        if ($("#aiKey")) $("#aiKey").value = "";
        configFromView();
        syncApiMode();
        populateModels();
      });
      $("#aiTimeoutEnabled")?.addEventListener("change", configFromView);
      $("#aiTimeoutSec")?.addEventListener("change", configFromView);
      $("#aiStrict")?.addEventListener("change", configFromView);
      $("#aiTest")?.addEventListener("click", async () => {
        configFromView();
        try {
          const result = await assistant?.ai?.complete?.(
            [{ role: "user", content: "ping" }],
            currentConfig(),
          );
          if (!result || result.ok === false) throw new Error(result?.text || result?.error || "AI 连接失败");
          notify("AI 连接成功");
        } catch (error) {
          notify(error.message || String(error));
        }
      });
      $("#aiClearCfg")?.addEventListener("click", () => {
        assistant?.setSettings?.({
          base: "https://api.openai.com/v1",
          model: "gpt-4o-mini",
          key: "",
          visionInheritPrimary: true,
          visionBase: "",
          visionModel: "",
          visionKey: "",
          visionTemperature: 0.2,
          visionTimeoutMs: 120000,
          timeoutEnabled: false,
          timeoutSec: 300,
          comfyBase: "http://127.0.0.1:8188",
          comfyIters: 3,
          comfyWorkflow: "",
          comfyPos: "",
          comfyNeg: "",
          comfyW: 768,
          comfyH: 1024,
          comfySteps: 25,
          comfyCfg: 7,
        });
        loadSettings();
      });
      $("#presetSave")?.addEventListener("click", savePreset);
      $("#presetSel")?.addEventListener("change", (event) => {
        assistant?.selectPreset?.(event.target.value);
        renderPrompt();
      });
      $("#presetDelete")?.addEventListener("click", () => {
        const current = activePreset();
        if ((assistant?.listPresets?.() || []).length <= 1)
          return notify("至少保留一个预设");
        assistant?.removePreset?.(current?.id);
        renderPrompt();
      });
      $("#presetExport")?.addEventListener("click", () => {
        savePreset();
        download("ai-tag-preset.json", {
          format: "ai-tag-preset",
          version: 1,
          presets: assistant?.listPresets?.() || [],
        });
      });
      $("#presetImport")?.addEventListener("click", () => {
        const input = doc.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.onchange = () =>
          readJson(input.files?.[0], (data) => {
            const list = Array.isArray(data) ? data : data?.presets || [];
            const merged = [
              ...(assistant?.listPresets?.() || []),
              ...list.filter((item) => item && item.name),
            ];
            assistant?.setPresets?.(merged);
            renderPrompt();
          });
        input.click();
      });
      $("#aiSysReset")?.addEventListener("click", () => {
        prompts?.reset?.("main");
        renderPrompt();
        notify("主提示词已恢复默认");
      });
      $("#genTaskReset")?.addEventListener("click", () => {
        prompts?.reset?.("generate");
        renderPrompt();
        notify("生成提示词已恢复默认");
      });
      $("#qpReset")?.addEventListener("click", () => {
        prompts?.reset?.("quality");
        renderPrompt();
        notify("质量提示词已恢复默认");
      });
      $("#aiVisionReset")?.addEventListener("click", () => {
        prompts?.reset?.("vision");
        renderPrompt();
        notify("识图提示词已恢复默认");
      });
      [["#aiSysEnabled", "main"], ["#genTaskEnabled", "generate"], ["#qpEnabled", "quality"], ["#aiVisionEnabled", "vision"]].forEach(([selector, key]) => {
        $(selector)?.addEventListener("change", event => {
          prompts?.setEnabled?.(key, event.target.checked);
          renderPrompt();
        });
      });
      $("#promptModReset")?.addEventListener("click", () => {
        const current = activePreset();
        const presets = assistant?.listPresets?.() || [];
        const target = presets.find((item) => item.id === current?.id);
        if (!target) return;
        target.mods = JSON.parse(JSON.stringify(defaultPromptMods));
        assistant?.setPresets?.(presets);
        renderPrompt();
        notify("已恢复当前预设的提示词启用对象");
      });
      const syncPromptPanels = () => {
        const p = modules.prompts;
        if (!p) return;
        ["main", "generate", "vision"].forEach(key => { const el = $("#internalPrompt" + key[0].toUpperCase() + key.slice(1)); if (el) el.value = p.get(key, ""); });
        const ext = $("#externalPromptText"); if (ext) ext.value = p.get("chat", "");
      };
      ["main", "generate", "vision"].forEach(key => $("#internalPrompt" + key[0].toUpperCase() + key.slice(1))?.addEventListener("change", e => modules.prompts?.set?.(key, e.target.value)));
      $("#externalPromptText")?.addEventListener("change", e => modules.prompts?.set?.("chat", e.target.value));
      $("#internalPromptReset")?.addEventListener("click", () => { modules.prompts?.resetBlock?.("internal"); syncPromptPanels(); });
      $("#internalPromptExport")?.addEventListener("click", () => { const blob = new Blob([JSON.stringify(modules.prompts?.exportBlock?.("internal") || {}, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "internal-prompts.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); });
      $("#internalPromptImport")?.addEventListener("click", () => $("#internalPromptFile")?.click());
      $("#internalPromptFile")?.addEventListener("change", event => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const result = modules.prompts?.importBlock?.(JSON.parse(reader.result), "internal"); if (!result?.ok) throw new Error("内部提示词文件格式无效"); syncPromptPanels(); } catch { /* invalid bundle is rejected without changing state */ } }; reader.readAsText(file); event.target.value = ""; });
      syncPromptPanels();
      $("#pcolExport")?.addEventListener("click", () => {
        savePreset();
        download("ai-tag-prompt-collection.json", {
          format: "ai-tag-prompt-collections",
          version: 1,
          presets: assistant?.listPresets?.() || [],
          worlds: assistant?.listWorlds?.() || [],
        });
      });
      $("#pcolImport")?.addEventListener("click", () =>
        $("#pcolFile")?.click(),
      );
      $("#pcolFile")?.addEventListener("change", (event) =>
        readJson(event.target.files?.[0], (data) => {
          if (Array.isArray(data?.presets))
            assistant?.setPresets?.([
              ...(assistant?.listPresets?.() || []),
              ...data.presets,
            ]);
          if (Array.isArray(data?.worlds))
            assistant?.setWorlds?.([
              ...(assistant?.listWorlds?.() || []),
              ...data.worlds,
            ]);
          renderPrompt();
        }),
      );
      $("#worldSel")?.addEventListener("change", (event) => {
        assistant?.selectWorld?.(event.target.value);
        renderPrompt();
      });
      $("#worldEnabled")?.addEventListener("change", (event) => {
        const worlds = assistant?.listWorlds?.() || [];
        const world = worlds.find((item) => item.id === activeWorld()?.id);
        if (world) {
          world.enabled = event.target.checked;
          assistant?.setWorlds?.(worlds);
        }
      });
      $("#wbAdd")?.addEventListener("click", () => {
        const world = activeWorld();
        if (!world) return;
        const worlds = assistant?.listWorlds?.() || [];
        const target = worlds.find((item) => item.id === world.id);
        target?.entries?.push({
          id: `entry_${Date.now()}`,
          name: "新条目",
          keys: "",
          content: "",
          enabled: true,
          constant: false,
        });
        assistant?.setWorlds?.(worlds);
        renderWorldEntries();
        renderWorldCards();
      });
      $("#worldAdd")?.addEventListener("click", () => {
        const name = global.prompt("世界书名称", "新世界书");
        if (name) {
          assistant?.addWorld?.({ name, enabled: true, entries: [] });
          renderPrompt();
        }
      });
      $("#wbExport")?.addEventListener("click", () => {
        const world = activeWorld();
        if (world)
          download(`${world.name || "worldbook"}.json`, {
            name: world.name,
            entries: world.entries || [],
          });
      });
      $("#wbBundle")?.addEventListener("click", () =>
        download("ai-tag-worldbooks.json", {
          format: "dbt-worldbooks",
          version: 1,
          worlds: assistant?.listWorlds?.() || [],
        }),
      );
      $("#wbImport")?.addEventListener("click", () =>
        $("#wbImportFile")?.click(),
      );
      $("#wbImportFile")?.addEventListener("change", (event) =>
        readJson(event.target.files?.[0], openWorldImport),
      );
      $("#wbModalClose")?.addEventListener("click", closeWorldImport);
      $("#wbImportCancel")?.addEventListener("click", closeWorldImport);
      $("#wbSelAll")?.addEventListener("click", () => $$("#wbImportList input[type=checkbox]").forEach((input) => { input.checked = true; }));
      $("#wbSelNone")?.addEventListener("click", () => $$("#wbImportList input[type=checkbox]").forEach((input) => { input.checked = false; }));
      $("#wbImportGo")?.addEventListener("click", importSelectedWorldEntries);
      $("#wbFoldAll")?.addEventListener("click", () =>
        $$("#wbList .wbi").forEach((row) => {
          row.hidden = !row.hidden;
        }),
      );
      $("#previewWorld")?.addEventListener("click", () => {
        const world = activeWorld();
        global.alert(
          (world?.entries || [])
            .filter((item) => item.enabled !== false)
            .map((item) => `【${item.name}】\n${item.content}`)
            .join("\n\n") || "当前世界书没有启用条目",
        );
      });
      $("#cfmNo")?.addEventListener("click", () => { ui.confirmAction = null; $("#cfmModal")?.classList.remove("show"); });
      $("#cfmYes")?.addEventListener("click", () => { const action = ui.confirmAction; ui.confirmAction = null; $("#cfmModal")?.classList.remove("show"); action?.(); });
      $("#translateDirection")?.addEventListener("change", () => {
        clearTimeout(ui.translateRefsTimer);
        ui.translateRefsTimer = setTimeout(renderTranslationRefs, 80);
        if ($("#translateInput")?.value) translate(false);
      });
      $("#translateInput")?.addEventListener("input", () => {
        const input = $("#translateInput")?.value || "";
        ui.translateRequestId += 1;
        put("#translateInputCount", `${input.length} 字`);
        if ($("#translateAi") && !$("#translateAi").disabled) $("#translateAi").disabled = !input.trim();
        clearTimeout(ui.translateRefsTimer);
        ui.translateRefsTimer = setTimeout(renderTranslationRefs, 100);
        clearTimeout(ui.translateTimer);
        if (input.trim()) ui.translateTimer = setTimeout(() => translate(false), 500);
      });
      $("#translateAi")?.addEventListener("click", () => translate(true));
      $("#translateClear")?.addEventListener("click", () => {
        ui.translateRequestId += 1;
        clearTimeout(ui.translateRefsTimer);
        clearTimeout(ui.translateTimer);
        $("#translateInput").value = "";
        $("#translateOutput").value = "";
        renderTranslationRefs();
        const thinking = $("#translateThinking");
        if (thinking) thinking.hidden = true;
      });
      $("#translateCopy")?.addEventListener("click", () =>
        copy($("#translateOutput")?.value),
      );
      $("#translateCopyTags")?.addEventListener("click", () =>
        copy(
          ($$(".translate-tag") || []).map((el) => el.textContent).join(", "),
        ),
      );
      $("#comfyTest")?.addEventListener("click", async () => {
        configFromView();
        try {
          const connected = await comfy?.check?.();
          notify(connected
            ? "ComfyUI 已连接 · 地址可访问"
            : "ComfyUI 未连接 · 请确认 ComfyUI 已启动，并检查「API 设置 → ComfyUI 地址」");
        } catch (error) {
          notify(error?.message || String(error));
        } finally {
          refreshCapabilitiesStatus({ force: true });
        }
      });
      $("#comfyWfClear")?.addEventListener("click", () => {
        if ($("#comfyWf")) $("#comfyWf").value = "";
        configFromView();
      });
      $("#comfyClearCfg")?.addEventListener("click", () => {
        assistant?.setSettings?.({
          comfyBase: "http://127.0.0.1:8188",
          comfyIters: 3,
          comfyWorkflow: "",
          comfyPos: "",
          comfyNeg: "",
          comfyW: 768,
          comfyH: 1024,
          comfySteps: 25,
          comfyCfg: 7,
          visionInheritPrimary: true,
          visionBase: "",
          visionModel: "",
          visionKey: "",
          visionTemperature: 0.2,
          visionTimeoutMs: 120000,
        });
        loadSettings();
      });
      $("#comfyWfJson")?.addEventListener("click", () =>
        $("#comfyWfJsonFile")?.click(),
      );
      $("#comfyWfJsonFile")?.addEventListener("change", (event) => {
        const file = event.target.files?.[0];
        if (file) importWorkflow(file);
      });
      $("#comfyWfPng")?.addEventListener("click", () =>
        $("#comfyWfPngFile")?.click(),
      );
      $("#comfyWfPngFile")?.addEventListener("change", async (event) => {
        const file = event.target.files?.[0];
        if (file) importWorkflow(file);
      });
      $("#comfyWfCopy")?.addEventListener("click", () =>
        copy($("#comfyWf")?.value),
      );
      $("#comfyWfOpen")?.addEventListener("click", () =>
        global.open(settings().comfyBase || "http://127.0.0.1:8188"),
      );
      $("#comfyWfSync")?.addEventListener("click", () =>
        notify("请在 ComfyUI 中复制 API 工作流后粘贴回这里"),
      );
      $("#tabApi")?.addEventListener("dragover", (event) => {
        if ([...(event.dataTransfer?.files || [])].some((file) => /\.json$|\.png$/i.test(file.name || ""))) event.preventDefault();
      });
      $("#tabApi")?.addEventListener("drop", (event) => {
        const file = [...(event.dataTransfer?.files || [])].find((item) => /\.json$|\.png$/i.test(item.name || ""));
        if (!file) return;
        event.preventDefault();
        event.stopPropagation();
        importWorkflow(file);
      });
      $$('[data-image-context]').forEach(zone => {
        zone.addEventListener("dragover", event => {
          if (event.dataTransfer?.types?.includes("application/x-ai-tag-conversation-ref") || event.dataTransfer?.types?.includes("application/x-ai-tag-image-id") || [...(event.dataTransfer?.files || [])].some(file => file?.type?.startsWith("image/"))) {
            event.preventDefault();
            event.stopPropagation();
            zone.classList.add("image-drag-over");
          }
        });
        zone.addEventListener("dragleave", event => {
          if (!zone.contains(event.relatedTarget)) zone.classList.remove("image-drag-over");
        });
        zone.addEventListener("drop", event => {
          zone.classList.remove("image-drag-over");
          const context = zone.dataset.imageContext;
          const conversationPayload = event.dataTransfer?.getData("application/x-ai-tag-conversation-ref");
          const imageId = event.dataTransfer?.getData("application/x-ai-tag-image-id") || event.dataTransfer?.getData("text/plain");
          if ((conversationPayload || imageId) && (context === "conversation" || context === "vision")) {
            event.preventDefault();
            event.stopPropagation();
            let ref = null;
            try { ref = conversationPayload ? JSON.parse(conversationPayload) : null; } catch { ref = null; }
            const id = str(ref?.imageId || imageId);
            if (!id) return;
            if (context === "conversation") {
              const attached = imageRepository?.attachToConversation?.(currentTalkSessionId(), id, { source: imageRepository?.listGallery?.()?.items?.some(item => item.imageId === id) ? "gallery" : "upload" });
              if (attached) renderConversationRepository();
            } else if (ref?.refId && ref.sessionId) {
              const active = visionTempStore?.setConversationReference?.(id, { sessionId: ref.sessionId, refId: ref.refId });
              if (active) { clearVisionResult(); renderVisionPreview(); renderTalkVisionPanel(); setVisionOpen(true); }
            } else if (imageRepository?.listGallery?.()?.items?.some(item => item.imageId === id)) {
              visionTempStore?.setLibraryReference?.(id); clearVisionResult(); renderVisionPreview(); renderTalkVisionPanel(); setVisionOpen(true);
            }
            return;
          }
          const files = [...(event.dataTransfer?.files || [])].filter(file => file?.type?.startsWith("image/"));
          if (!files.length) return;
          event.preventDefault();
          event.stopPropagation();
          Promise.resolve(addFilesForContext(files, context)).catch(error => notify(error?.message || String(error)));
        });
      });
      $("#tagPane")?.addEventListener("dragover", event => { if (event.dataTransfer?.types?.includes("application/x-ai-tag-image-id")) { event.preventDefault(); event.stopPropagation(); $("#tagPane").classList.add("image-drag-over"); } });
      $("#tagPane")?.addEventListener("dragleave", event => { if (!$("#tagPane").contains(event.relatedTarget)) $("#tagPane").classList.remove("image-drag-over"); });
      $("#tagPane")?.addEventListener("drop", event => {
        $("#tagPane").classList.remove("image-drag-over");
        const conversationPayload = event.dataTransfer?.getData("application/x-ai-tag-conversation-ref");
        if (conversationPayload) {
          let ref = null; try { ref = JSON.parse(conversationPayload); } catch { ref = null; }
          const id = str(ref?.imageId);
          if (id && ref?.refId) { event.preventDefault(); event.stopPropagation(); visionTempStore?.setConversationReference?.(id, { sessionId: ref.sessionId, refId: ref.refId }); clearVisionResult(); renderVisionPreview(); renderTalkVisionPanel(); setVisionOpen(true); }
          return;
        }
        const id = event.dataTransfer?.getData("application/x-ai-tag-image-id");
        if (!id || !imageRepository?.listGallery?.()?.items?.some(item => item.imageId === id)) return;
        event.preventDefault(); event.stopPropagation();
        visionTempStore?.setLibraryReference?.(id); clearVisionResult(); renderVisionPreview(); renderTalkVisionPanel(); setVisionOpen(true);
      });
      $("#mgrExport")?.addEventListener("click", () => {
        const blob = new Blob([assistant?.exportSessions?.() || "[]"], {
          type: "application/json",
        });
        const link = doc.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "ai-tag-sessions.json";
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 500);
      });
      $("#mgrImport")?.addEventListener("click", () =>
        $("#mgrImportFile")?.click(),
      );
      $("#mgrImportFile")?.addEventListener("change", (event) => {
        const file = event.target.files?.[0];
        if (file)
          readText(file).then((value) => {
            assistant?.importSessions?.(value, false);
            renderManager();
          });
      });
      $("#mgrClear")?.addEventListener("click", () => {
        const current = assistant?.currentSession?.();
        if (current) assistant?.clearSession?.(current.id);
        renderManager();
        renderTalk();
      });
      document.addEventListener("dragover", (event) => {
        if (event.dataTransfer?.types?.includes("Files"))
          event.preventDefault();
      });
      document.addEventListener("drop", (event) => {
        const files = [...(event.dataTransfer?.files || [])].filter((file) =>
          file.type?.startsWith("image/"),
        );
        if (!files.length) return;
        const context = imageContextFromEvent(event, { useActive: false });
        if (!context) return;
        event.preventDefault();
        event.stopPropagation();
        Promise.resolve(addFilesForContext(files, context)).catch(error => notify(error?.message || String(error)));
      });
      document.addEventListener("paste", (event) => {
        const files = [...(event.clipboardData?.files || [])].filter((file) =>
          file.type?.startsWith("image/"),
        );
        if (files.length) {
          const context = imageContextFromEvent(event, { useActive: true });
          if (!context) return;
          event.preventDefault();
          event.stopPropagation();
          Promise.resolve(addFilesForContext(files, context)).catch(error => notify(error?.message || String(error)));
        }
      });
      document.addEventListener("keydown", (event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "k"
        ) {
          event.preventDefault();
          $("#q")?.focus();
        }
        if (event.key === "Escape") {
          closeDrawer();
          setVisionOpen(false);
          $("#themePop")?.setAttribute("hidden", "");
          $("#localePop")?.setAttribute("hidden", "");
          $$(".modal.show").forEach((el) => el.classList.remove("show"));
        }
      });
    }
    function renderTranslationRefs() {
      const host = $("#translateTags");
      if (!host) return;
      const input = $("#translateInput")?.value || "";
      const refs =
        translation?.findReferences?.(
          input,
          $("#translateDirection")?.value || "auto",
        ) || [];
      host.replaceChildren();
      put("#translateTagCount", `${refs.length} 个`);
      refs.slice(0, 60).forEach((ref) => {
        const button = doc.createElement("button");
        button.className = "translate-tag btn btn-chip";
        button.textContent = `${ref.en || ref.tag?.en || ""}${ref.zhPrimary ? ` · ${ref.zhPrimary}` : ""}`;
        button.onclick = () => {
          const id = ref.tag?.id || ref.en;
          tags?.select?.(id, true);
          renderTags();
          renderSelection();
        };
        host.appendChild(button);
      });
    }
    function setTranslationThinking(visible, text, done = false) {
      const box = $("#translateThinking");
      const body = $("#translateThinkingBody");
      const title = $("#translateThinkingTitle");
      if (!box) return;
      const wasHidden = box.hidden;
      box.hidden = !visible;
      if (body && text != null) body.textContent = text;
      if (title) title.textContent = localized(done ? "ui.translation.aiThinkingDone" : "ui.translation.aiThinkingNow", done ? "💭 AI 思考完成" : "💭 AI 正在思考…");
      // Initialize a new thinking panel as collapsed, but never overwrite the
      // user's toggle while streaming new reasoning chunks into it.
      if (visible && !done && wasHidden) box.open = false;
    }
    async function translate(useAi) {
      const input = str($("#translateInput")?.value);
      if (!input) return notify("请输入要翻译的内容");
      if (useAi) {
        clearTimeout(ui.translateTimer);
        ui.translateTimer = null;
        if ($("#translateAi")) $("#translateAi").disabled = true;
      }
      const requestId = ++ui.translateRequestId;
      const direction = $("#translateDirection")?.value || "auto";
      let result;
      try {
        if (useAi) {
          let reasoning = "";
          setTranslationThinking(true, "AI 正在思考…");
          result = await translation?.translateWithAI?.(input, direction, {
            ...currentConfig(),
            stream: true,
            onDelta: (_content, deltaReasoning) => {
              if (requestId !== ui.translateRequestId || !deltaReasoning) return;
              reasoning += String(deltaReasoning);
              setTranslationThinking(true, reasoning);
            },
          });
          if (requestId === ui.translateRequestId)
            setTranslationThinking(true, reasoning || "AI 已完成翻译。", true);
        } else {
          setTranslationThinking(false);
          result = await translation?.translateLocal?.(input, direction);
        }
      } catch (error) {
        result = { ok: false, error: error.message || String(error) };
      }
      if (requestId !== ui.translateRequestId) {
        if (useAi && $("#translateAi")) $("#translateAi").disabled = !String($("#translateInput")?.value || "").trim();
        return result;
      }
      if ($("#translateOutput"))
        $("#translateOutput").value = result?.text || result?.error || "";
      put("#translateStatus", result?.ok === false ? "翻译失败" : "完成");
      if (useAi && $("#translateAi")) $("#translateAi").disabled = !input;
    }
    function start() {
      if (ui.started) return;
      ui.started = true;
      restoreTags();
      ui.searchPrecision = normaliseSearchPrecision(storage.get("app.searchPrecision", "standard"));
      $("#searchPrecision")?.setAttribute("value", ui.searchPrecision);
      if ($("#searchPrecision")) $("#searchPrecision").value = ui.searchPrecision;
      tags?.setSearchPrecision?.(ui.searchPrecision);
      const theme = storage.get(
        "app.theme",
        storage.get("rewrite_theme", "light"),
      );
      applyTheme(theme);
      ensurePromptState();
      bind();
      setTalkMode(storage.get("app.talkMode", "assistant"), { persist: false });
      resizeTalkInput();
      loadSettings({ fetch: false });
      refreshCapabilitiesStatus({ force: true });
      renderCustomCategories();
      renderCustomList();
      renderCategories();
      renderTags();
      renderSelection();
      renderPrompt();
      renderTalk();
      renderConversationRepository();
      renderVisionPreview();
      renderEmbeddedVision();
      locale(storage.get("app.locale", storage.get("rewrite_locale", "zh-CN")));
      route("tags");
    }
    return {
      start,
      route,
      showAi,
      renderTags,
      renderSelection,
      renderPrompt,
      renderTalk,
      getVisionState: () => ({
        currentVisionImageId: currentVisionId(),
        busy: Boolean(ui.visionBusy),
        result: clone(ui.visionResult),
        description: str(ui.visionDescription),
      }),
    };
  }
  global.AppView = { create: createAppView };
})(window);
