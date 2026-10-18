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
    const catalog = modules.catalog || null;
    /**
 * DSH 轨迹行的原生 JS 实现（照抄，见 `dsh-rows.js` 的来源说明）。
 *
 * 本项目没有构建步骤，所以它们是全局脚本，在 `index.html` 里先于本文件加载。
 * 取不到时退回 `null`，调用方会走老的渲染路径（并存期用）。
 */
const dshRows = (typeof window !== "undefined" && window.dshRows) || null;

/** 工具名 / 参数摘要 / 状态文案的唯一来源（`src/tool-presentation.js`，键是注册名）。 */
    const toolPresentation = global.ToolPresentation;
    const removeListeners = [];
    function listen(target, type, handler, options) {
      target?.addEventListener(type, handler, options);
      removeListeners.push(() => target?.removeEventListener(type, handler, options));
    }
    const characters = modules.characters || null;
    const favorites = modules.favorites || null;
    const imageApp = modules.imageApp || null;
    const images = modules.images || null;
    const imageStore = modules.imageStore || null;
    const assistant = modules.assistant;
    const imageRepository = modules.imageRepository || assistant?.imageRepository || null;
    const galleryRefs = new Map();
    const imageWrites = new Set();
    const visionTempStore = modules.visionTempStore || assistant?.visionTempStore || null;
    const comfy = modules.comfy;
    const runtime = modules.runtime || assistant?.runtime || null;
    const preferencesStore = modules.preferences || modules.settings || null;
    // 提问不自动作答：AI 问完就停在这一轮，用户不答就点提问卡上的「停止（不回答）」。
    const ui = {
      route: "tags",
      aiTab: "talk",
      visionResult: null,
      visionOpen: false,
      visionDescription: "",
      visionBusy: false,
      visionAbort: null,
      visionRequestId: 0,
      visionUploadId: 0,
      lastImageContext: "",
      visible: 400,
      tagArea: "tags",
      expandedGroups: new Set(),
      selectedGroupId: "",
      groupMemberSelection: new Set(),
      hiddenTagsOpen: false,
      hiddenTagsRevision: 0,
      hiddenTagsReady: false,
      subcategory: "",
      locale: "zh-CN",
      searchTimer: null,
      tagPageCache: new Map(),
      pendingWorldEntries: [],
      confirmAction: null,
      thinkingOpen: Object.create(null),
      thinkingScroll: Object.create(null),
      /** 过程列表里"思考段"的开合与滚动位置，按段 id 记。 */
      thoughtScroll: Object.create(null),
      candidatePreviews: Object.create(null),
      characterSelectionBusy: false,
      imgViewer: null,
      gallerySelected: new Set(),
      sendDrafts: [],
      /**
       * 草稿图**元数据登记表**（`imageId` → 建草稿时那份对象）。
       *
       * 为什么需要它：草稿的权威在状态层（`dsh-input-state.js`），它只保存
       * **附件 id**；而 `ui.sendDrafts` 里那份投影要带 `filename` / `refId` /
       * `sessionId`（待发条与图片仓库卡片读、`sendTalk` 挂接时用）。
       * 这些字段只有**建草稿的那一刻**才有，所以在这里登记一次，
       * 投影时按 id 复原 —— 不猜、不重新构造。
       */
      pendingDrafts: new Map(),
      conversationSelectionSnapshot: [],
      visionSelectLock: false,
      galleryOrder: "oldest",
      galleryQuery: "",
      aiTabBeforeGallery: "talk",
      editingTagId: "",
      comfyFollow: { "#talkConv": true },
      talkScrollLastTop: null,
      talkRendered: false,
      comfyCapabilities: null,
      versionManager: { rows: [], currentVersion: modules.version == null ? '' : String(modules.version), open: false, busy: false, progress: null, error: '', offEvent: null },
      started: false,
    };
    const talkVisionFold = { builtin: null, model: null, description: false };
    const $ = (s, root = doc) => root.querySelector(s);
    const $$ = (s, root = doc) => [...root.querySelectorAll(s)];
    const str = (v, fallback = "") => {
      const value = v == null ? "" : String(v).trim();
      return value || fallback;
    };
    const preferences = {
      get(key, fallback = null) {
        try {
          return preferencesStore?.get?.(key, fallback) ?? fallback;
        } catch {
          return fallback;
        }
      },
      set(key, value) {
        try {
          preferencesStore?.set?.(key, value);
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
    function download(filename, value, type = "application/json") {
      const content = typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2);
      const link = doc.createElement("a");
      link.href = URL.createObjectURL(new Blob([content], { type }));
      link.download = str(filename, "download.json");
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 500);
      return link.download;
    }
    async function readJson(file) {
      const raw = await readText(file);
      try { return JSON.parse(raw); } catch (error) { throw new Error(`JSON 文件无效：${error.message || error}`); }
    }
    function confirm(message, onConfirm, options = {}) {
      const modal = $("#cfmModal");
      const showRetainImages = options.showRetainImages === true;
      if (!modal) { if (global.confirm?.(message)) onConfirm?.(options.retainImagesDefault === true); return; }
      ui.confirmAction = onConfirm;
      put("#cfmText", message);
      put("#cfmYes", options.confirmLabel || localized("ui.common.confirm", "确定"));
      put("#cfmNo", options.cancelLabel || localized("ui.common.cancel", "取消"));
      const retain = $("#cfmRetainImagesWrap");
      const retainCheck = $("#cfmRetainImages");
      if (retain) retain.hidden = !showRetainImages;
      if (retainCheck) retainCheck.checked = showRetainImages && options.retainImagesDefault === true;
      modal.classList.add("show");
    }
    /**
     * 文本输入弹窗（Electron 渲染进程不实现 `window.prompt`，用应用已有的自定义弹窗）。
     *
     * @param {{title:string, value?:string, hint?:string, placeholder?:string,
     *          confirmLabel?:string, cancelLabel?:string}} options
     * @returns {Promise<string|null>} 确认时给出去空白后的文本；取消 / Esc / 关窗给 `null`
     */
    function promptDialog(options = {}) {
      const createDialog = global.AppViews?.tagLocation?.createDialogTools;
      if (typeof createDialog !== "function") return Promise.resolve(null);
      return new Promise(resolve => {
        let done = false;
        const dialog = createDialog(doc, "prompt", event => {
          if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); event.stopImmediatePropagation(); finish(null); }
        });
        dialog.panel.classList.add("gallery-rename-dialog");
        dialog.title.textContent = str(options.title, "输入");
        const form = doc.createElement("form");
        form.className = "gallery-rename-form";
        const label = doc.createElement("label");
        label.textContent = str(options.label, options.title) || "输入";
        const input = doc.createElement("input");
        input.type = "text";
        input.maxLength = 180;
        input.value = str(options.value);
        if (options.placeholder) input.placeholder = str(options.placeholder);
        label.append(input);
        const hint = doc.createElement("p");
        hint.className = "gallery-rename-hint";
        hint.textContent = str(options.hint);
        const error = doc.createElement("p");
        error.setAttribute("role", "alert");
        const actions = doc.createElement("div");
        actions.className = "gallery-rename-actions";
        const cancel = doc.createElement("button");
        cancel.type = "button";
        cancel.textContent = localized("ui.common.cancel", "取消");
        cancel.onclick = () => finish(null);
        const save = doc.createElement("button");
        save.type = "submit";
        save.dataset.action = "save";
        save.textContent = str(options.confirmLabel, localized("ui.common.save", "保存"));
        actions.append(cancel, save);
        form.append(label, hint, error, actions);
        dialog.panel.append(form);
        function finish(value) {
          if (done) return;
          done = true;
          dialog.dispose();
          resolve(value);
        }
        form.addEventListener("submit", event => {
          event.preventDefault();
          const value = input.value.trim();
          if (!value) { error.textContent = str(options.requiredMessage, "不能为空"); input.focus(); return; }
          finish(value);
        });
        dialog.open();
        input.focus();
        input.select();
      });
    }
    const tagLocation = catalog && global.AppViews?.tagLocation?.createTagLocationView?.({ document: doc, catalog, getLocale: () => ui.locale, localize: (key, fallback) => localized(`ui.${key}`, fallback) });
    const tagEditor = catalog && global.AppViews?.tagEditor?.createTagEditorView?.({ document: doc, catalog, getLocale: () => ui.locale, localize: (key, fallback) => localized(`ui.${key}`, fallback), notify, locationView: tagLocation, onChange: () => { ui.tagPageCache.clear(); renderCategories(); renderTags(); renderSelection(); } });
    const tagGroupEditor = catalog && global.AppViews?.tagGroupEditor?.createTagGroupEditorView?.({ document: doc, catalog, notify, onChange: () => { renderTags(); } });
    const viewFactories = global.AppViews || {};
    const views = {};
    const boundViews = new Set();
    const viewScriptNames = { agentStatus: 'agent-status', callMonitor: 'call-monitor', agentInspector: 'agent-inspector' };
    let disposed = false;
    function instantiateView(name) {
      const factory = {
        favorites: viewFactories.favorites, translation: viewFactories.translation,
        settings: viewFactories.settings, comfy: viewFactories.comfy, prompt: viewFactories.prompt,
        agentStatus: viewFactories.agentStatus, callMonitor: viewFactories.callMonitor,
        agentInspector: viewFactories.agentInspector, interaction: viewFactories.interaction,
        characters: viewFactories.characters
      }[name];
      if (name === 'favorites') return favorites ? factory?.createFavoritesView?.({ document: doc, favorites, tagEditor, preferences, createTagReferenceButton, copy: value => copyExact(value), notify, localize: (key, fallback) => localized(`ui.${key}`, fallback), onSelectionChange: () => renderSelection(), getIncludeAdult: () => tagSnapshot().adult, parsePaste: (...args) => favorites.parseFavoritePaste?.(...args), onTagGroupJump: openTagGroup, onCharacterJump: openFavoriteCharacter }) : null;
      if (name === 'translation') return factory?.createTranslationView?.({ document: doc, runtime, translation: modules.translation, createTagReferenceButton, notify, copy: value => copyExact(value), localized, onTagSelected: async reference => {
        const raw = typeof reference === 'object' ? reference?.en || reference?.tag?.en : reference;
        const id = typeof reference === 'object' && reference?.tag?.id
          ? String(reference.tag.id)
          : await tags?.resolveText?.(raw);
        if (!id) { notify(localized('ui.translation.tagNotResolvable', '这个写法没有唯一对应的站内 Tag')); return; }
        const result = await tags?.select?.(id, true);
        if (result?.ok === false) { notify(result.error?.message || localized('ui.tag.selectionFailed', '加入候选失败')); return; }
        renderTags(); renderSelection();
      } });
      if (name === 'settings') return factory?.createSettingsView?.({ document: doc, api: assistant, runtime, comfy, notify, onChange: value => { views.comfy?.render?.(value)?.catch(error => notify(error?.message || String(error))); syncGenerationControls(); }, autoBind: false });
      if (name === 'comfy') return factory?.createComfyView?.({ document: doc, comfy, assistant, notify, openExternal: url => global.open(url), onGenerated: async () => { invalidateImageCache(); await renderConversationRepository(); renderTalk(); }, onChange: value => { views.settings?.render?.(value); syncComfyStatus(ui.comfyCapabilities); syncGenerationControls(); refreshCapabilitiesStatus({ force: true }); }, autoBind: false });
      if (name === 'prompt') return factory?.createPromptView?.({ document: doc, notify, download, confirm });
      if (name === 'agentStatus') return factory?.createAgentStatusView?.({ document: doc, runtime, api: assistant, notify, autoBind: false });
      if (name === 'callMonitor') return factory?.createCallMonitorView?.({ document: doc, runtime, assistant, notify, download, confirm, autoBind: false });
      if (name === 'agentInspector') return factory?.createAgentInspectorView?.({ document: doc, assistant, notify, download, autoBind: false });
      if (name === 'interaction') return factory?.createInteractionView?.({ document: doc, broker: assistant?.interactions, projection: assistant?.agentProjection, assistant, notify, onAnswer: (interaction, value) => sendTalk({ interactionId: interaction.interactionId, text: typeof value === 'string' ? value : str(value?.label || value?.name || value?.id) }), autoBind: false });
      if (name === 'characters') return factory?.createCharactersView?.({ document: doc, characters, tags, catalog, tagEditor, createTagReferenceButton, favoriteTag, favoriteBundle, onChange: () => renderSelection(), copy: value => copyExact(value), notify, getLocale: () => ui.locale });
      return null;
    }
    function hydrateViews(names = ['favorites', 'translation', 'settings', 'comfy', 'prompt', 'agentStatus', 'callMonitor', 'agentInspector', 'interaction', 'characters']) {
      if (disposed) return views;
      for (const name of names) {
        if (!views[name]) views[name] = instantiateView(name);
        const value = views[name];
        if (value && ui.started && !boundViews.has(name)) { value.bind?.(); boundViews.add(name); }
      }
      return views;
    }
    hydrateViews();
    function ensureViews(names) {
      const missing = names.filter(name => !views[name] && !viewFactories[name]);
      if (!missing.length || !global.AppViewLoader) return null;
      return Promise.all(missing.map(name => global.AppViewLoader.load(viewScriptNames[name] || name))).then(() => {
        if (!disposed) hydrateViews(missing);
      });
    }
    /**
     * 提问由对话流里的提问卡承担（见 `generationNeedsInput` 的 `kind === "question"` 分支：
     * 选项按钮 + 自由作答 + 倒计时），与其它 agent 过程一样长在对话里。
     * 视图文件与 `#agentInteractionPanel` 保留但不装配（不装配即不可见）。
     */
    const aiViews = tab => tab === 'prompt' ? ['prompt'] : tab === 'comfy' ? ['settings', 'comfy']
      : tab === 'api' ? ['settings', 'callMonitor', 'agentInspector']
        : tab === 'talk' ? ['settings', 'agentStatus', 'callMonitor'] : [];
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
    async function copyExact(value) {
      try {
        if (!doc.defaultView?.navigator?.clipboard?.writeText) return false;
        await doc.defaultView.navigator.clipboard.writeText(String(value ?? ""));
        return true;
      } catch { return false; }
    }
    async function copyTagIds(ids) {
      const values = [...new Set((ids || []).filter(Boolean))];
      const text = tags?.copyText?.(values) || values.map(id => catalog?.getTag?.(id)?.content || id).join(', ');
      const ok = await copyExact(text);
      notify(ok ? localized('ui.tag.copied', '已复制') : localized('ui.favorites.copyFailed', '复制失败'));
      return ok;
    }
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
        category: str(snap.category, "all"),
        adult: Boolean(snap.includeAdult),
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
    function workspaceIcon(name, sprite = "workspace") {
      const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.classList.add("workspace-icon");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("aria-hidden", "true");
      icon.setAttribute("focusable", "false");
      const use = doc.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute("href", `../assets/icons/${sprite}.svg#${name}`);
      icon.append(use);
      return icon;
    }
    function createTagReferenceButton(content) {
      const button = doc.createElement('button');
      button.type = 'button'; button.className = 'tag-reference-button tag-action-button';
      button.dataset.tagReference = str(content);
      button.title = localized('ui.tag.viewReference', '在 Danbooru 查看参考图');
      if (!str(content).trim() || /[,，\r\n]/.test(str(content))) {
        button.disabled = true;
        button.title = localized('ui.tag.referenceSingleOnly', '请展开组合后查看单个 Tag 的参考图');
      }
      button.setAttribute('aria-label', button.title);
      button.append(workspaceIcon('globe'));
      button.onclick = async event => {
        event.preventDefault(); event.stopPropagation();
        try {
          if (!modules.openTagReference) throw new Error(localized('ui.tag.referenceUnavailable', '查图窗口暂不可用，请重启应用后重试'));
          const result = await modules.openTagReference(str(content));
          if (result?.ok === false) throw new Error(result.error?.message || result.error || localized('ui.tag.referenceFailed', '打开参考图失败，请重试'));
        } catch (error) {
          notify(error?.message || localized('ui.tag.referenceFailed', '打开参考图失败，请重试'));
        }
      };
      button.addEventListener('pointerdown', event => event.stopPropagation());
      button.addEventListener('dragstart', event => { event.preventDefault(); event.stopPropagation(); });
      return button;
    }
    const navigationIcons = { ai: "message-circle", translation: "languages", vision: "scan-line", gallery: "images", favorites: "star", adult: "eye-off", sponsor: "heart", theme: "palette", locale: "globe" };
    function decorateWorkspaceControls() {
      const controls = {
        copyAll: ["copy", "favorites"], saveFav: ["star"], addTagBtn: ["plus", "favorites"],
        talkNew: ["plus", "favorites"], talkManage: ["folder", "favorites"],
        talkImgBtn: ["images"], talkSendBtn: ["arrow-up", "favorites"],
        tpUpload: ["upload", "favorites"], tpDescribe: ["scan-line"],
        aiModuleTalk: ["message-circle"], aiModulePrompt: ["layers"],
        aiModuleApi: ["globe"], aiModuleComfy: ["images"],
      };
      for (const [id, [icon, sprite]] of Object.entries(controls)) {
        const control = $(`#${id}`);
        if (!control) continue;
        const label = doc.createElement("span");
        label.textContent = control.textContent.replace(/^[^\p{L}\p{N}]+/u, "");
        control.replaceChildren(workspaceIcon(icon, sprite), label);
      }
    }
    const navActionConfig = {
      ai: { selector: "#aiBtn", idleKey: "ui.header.aiAssistant", activeKey: "ui.header.backHome", idle: ["🤖 AI 助手", "🤖 AI Assistant"], active: ["← 返回主页", "← Back home"], run: () => route(ui.route === "ai" ? "tags" : "ai") },
      translation: { selector: "#translateBtn", idleKey: "ui.header.translation", activeKey: "ui.header.backHome", idle: ["🌐 翻译", "🌐 Translate"], active: ["← 返回主页", "← Back home"], run: () => route(ui.route === "translation" ? "tags" : "translation") },
      vision: { selector: "#visionBtn", idleKey: "ui.header.vision", activeKey: "ui.header.visionClose", idle: ["🔍 识图", "🔍 Vision"], active: ["✕ 关闭识图", "✕ Close vision"], run: () => setVisionOpen(!ui.visionOpen) },
      gallery: { selector: "#galleryBtn", idleKey: "ui.header.gallery", activeKey: "ui.header.backHome", idle: ["🖼 图片库", "🖼 Gallery"], active: ["← 返回主页面", "← Back home"], run: () => route(ui.route === "gallery" ? "tags" : "gallery") },
      favorites: { selector: "#favBtn", idleKey: "ui.header.favorites", activeKey: "ui.header.backHome", idle: ["⭐ 快捷收藏", "⭐ Favorites"], active: ["← 返回主页", "← Back home"], run: () => route(ui.route === "favorites" ? "tags" : "favorites") },
      adult: { selector: "#nsfwBtn", idleKey: "ui.header.adult", activeKey: "ui.header.adultClose", idle: ["○ 成人标签：关", "○ Adult tags: off"], active: ["● 成人标签：开", "● Adult tags: on"], run: () => toggleAdultTags() },
      sponsor: { selector: "#sponsorBtn", idleKey: "ui.header.sponsor", idle: ["❤️ 赞助作者", "❤️ Sponsor"], run: () => $("#sponsorModal")?.classList.add("show") },
      theme: { selector: "#themeBtn", idleKey: "ui.header.style", idle: ["🎨 样式", "🎨 Style"], run: event => toggleThemeMenu(event) },
      locale: { selector: "#localeBtn", idleKey: "ui.header.language", idle: ["文/A", "文/A"], run: event => toggleLocaleMenu(event) },
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
      const label = doc.createElement("span");
      label.textContent = localized(useActive ? config.activeKey : config.idleKey, fallback).replace(/^[^\p{L}\p{N}]+/u, "");
      const icon = useActive ? (name === "vision" ? "x" : name === "adult" ? "eye" : "arrow-left") : navigationIcons[name];
      button.replaceChildren(workspaceIcon(icon), label);
      if (name === "vision") button.setAttribute("aria-expanded", useActive ? "true" : "false");
      if (name === "vision" || name === "favorites") button.title = button.textContent;
    }
    function syncNavigationStates() {
      syncNavAction("ai", ui.route === "ai");
      syncNavAction("translation", ui.route === "translation");
      syncNavAction("vision", ui.visionOpen);
      syncNavAction("gallery", ui.route === "gallery");
      syncNavAction("favorites", ui.route === "favorites");
      syncNavAction("adult", tagSnapshot().adult);
      syncNavAction("sponsor", false);
      syncNavAction("theme", false);
      syncNavAction("locale", false);
      const context = $("#workspaceContext");
      if (context) {
        context.hidden = ui.route !== "favorites" && ui.route !== "gallery";
        context.textContent = localized(ui.route === "favorites" ? "ui.header.favorites" : "ui.header.gallery", ui.route === "favorites" ? "快捷收藏" : "图片库").replace(/^[^\p{L}\p{N}]+/u, "");
      }
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
    function messageHasRender(message) {
      return Boolean(message?.toolCalls?.some?.(call => call?.name === "comfy.render" || call?.call === "comfy.render") || message?.result?.artifact || message?.result?.candidates?.length || message?.candidates?.length);
    }
    const categoryColors = {
      quality: "#4967D8", negative: "#C2413A", character: "#6E5ACB", character_names: "#7659A8", body: "#258F83",
      expression: "#B9770E", eyes: "#1E8FA5", hair: "#8A5A9E", features: "#7A63B8",
      outfit: "#2A8C6F", footwear: "#2A8F88", accessory: "#B46A2C", pose: "#5564C7",
      scene: "#AF7413", camera: "#3C75B8", style: "#8B63A8", time_weather: "#3D8A5A",
      atmosphere: "#AD5D83", effects: "#B34A46", food: "#A27A16", animal: "#B76832",
      other: "#64748B", rating: "#9B7B1F", series: "#287EA4", nsfw: "#E85D9F",
    };
    const categoryIcons = {
      all: "layers", quality: "sparkles", negative: "x", character: "user-round", character_names: "book-open",
      series: "clapperboard", body: "ruler", expression: "smile", eyes: "eye", hair: "scissors", features: "fingerprint",
      outfit: "shirt", footwear: "footprints", accessory: "package", pose: "person-standing", scene: "landmark",
      camera: "camera", style: "palette", time_weather: "cloud-sun", atmosphere: "sun", effects: "wand-sparkles",
      food: "utensils", animal: "paw-print", other: "circle-help", rating: "shield-alert", nsfw: "eye-off",
      wd_general: "brain", character_specific: "user-round-cog",
    };
    function categoryColor(id) {
      return categoryColors[String(id || "").toLowerCase()] || "#94A3B8";
    }
    function selected() { return tags?.selected?.() || []; }
    function selectedIds() { return selected().map(item => String(item.id || item.en)).filter(Boolean); }
    function canonicalSelected() { return catalog?.selected({ includeAdult: tagSnapshot().adult }) || []; }
    let operationSequence = 0;
    async function command(value) {
      try {
        const result = await catalog.execute(value, { operationId: 'ui:' + Date.now() + ':' + (++operationSequence) });
        if (!result?.ok) notify(result?.error?.message || '操作失败'); return result;
      } catch { notify('操作失败'); return { ok: false }; }
    }
    async function favoriteTag(id) {
      if (await tagEditor.requestClose() === false || await views.characters?.requestClose?.() === false) return false;
      const tag = catalog.getTag(id); if (!tag) return false;
      const locations = tag.favoriteLocations || [];
      if (locations.length) {
        const membershipIds = locations.map(row => row.membershipId);
        const question = formatText(localized('ui.favorites.unfavoriteConfirm', '确定取消收藏“{name}”吗？'), { name: tag.displayName || tag.content });
        const impact = formatText(localized('ui.favorites.unfavoriteLocations', '将从以下 {count} 个收藏位置移除，标签内容保留：'), { count: locations.length });
        confirm(`${question}\n${impact}\n${locations.map(row => `${row.pageName} / ${row.groupName}`).join('\n')}`, async () => {
          const result = await command({ type: 'unfavorite', membershipIds });
          if (result.ok) notify(localized('ui.favorites.unfavorited', '已取消收藏'));
        }, { confirmLabel: localized('ui.favorites.unfavorite', '取消收藏'), cancelLabel: localized('ui.favorites.keepFavorite', '保留收藏') });
        return false;
      }
      const placement = await tagLocation.choose({ kind: 'favorite' }); if (!placement) return false;
      return (await command({ type: 'favoriteTag', tagId: id, placement })).ok;
    }
    async function favoriteBundle(content, displayName = '') {
      if (await tagEditor.requestClose() === false || await views.characters?.requestClose?.() === false) return false;
      const placement = await tagLocation.choose({ kind: 'favorite' });
      return placement ? tagEditor.open({ initialValues: { kind: 'bundle', content, displayName }, placement }) : false;
    }
    function selectedCharacters() {
      try { return characters?.selected?.({ includeAdult: tagSnapshot().adult }) || []; }
      catch { return []; }
    }
    function escapeQualifierParentheses(value) {
      return str(value).replace(/\\([()])/g, "$1").replace(/[()]/g, "\\$&");
    }
    function selectedFavorites() { return favorites?.selected?.({ includeAdult: tagSnapshot().adult }) || []; }
    function combinedSelectionText() {
      if (!catalog) {
        const words = new Map();
        for (const value of [...selected().map(row => row.en || row.id), ...selectedCharacters().flatMap(row => row.tags || [])]) {
          const key = value.replace(/\\([()])/g, '$1').toLowerCase().replace(/[\s_]+/g, ' ').trim();
          if (!words.has(key) || /\\[()]/.test(value)) words.set(key, value);
        }
        return [...words.values(), ...selectedFavorites().map(row => row.rawText)].join(', ');
      }
      const seen = new Set(), blocks = [];
      for (const row of canonicalSelected()) {
        if (row.kind === 'legacySnapshot') { blocks.push(row.content); continue; }
        for (const id of row.tagIds) {
          if (seen.has(id)) continue; seen.add(id);
          const tag = catalog.getTag(id); if (tag) blocks.push(modules.formatTagOutput(tag));
        }
      }
      return blocks.join(', ');
    }
    function renderCharacters(options = {}) {
      const query = options.query == null ? str($("#q")?.value) : str(options.query);
      const clearSearch = $("#clearQ");
      if (clearSearch) clearSearch.style.display = query ? "" : "none";
      return views.characters?.render?.({ query, includeAdult: tagSnapshot().adult });
    }
    function restoreTags() {
      tags?.restoreUserState?.();
    }
    function tagRows() {
      const snap = tagSnapshot();
      const cacheKey = [
        snap.query,
        snap.category,
        snap.adult ? "adult" : "safe",
        snap.revision || 0,
        ui.subcategory,
        ui.visible,
        tags?.size?.() || 0,
        JSON.stringify(snap.categoryCounts || {}),
      ].join("\u0001");
      const cached = ui.tagPageCache.get(cacheKey);
      if (cached) return cached;
      const options = {
        query: snap.query,
        category: snap.query ? "" : snap.category,
        includeAdult: snap.adult,
        subcategory: snap.query ? "" : ui.subcategory,
        offset: 0,
        limit: Math.min(2000, ui.visible),
      };
      let page;
      if (snap.query && tags?.searchContract === "query-v2" && typeof tags?.search === "function") {
        const response = tags.search(snap.query);
        if (response?.ok === false) {
          page = { items: [], total: 0, hasMore: false, error: response.error };
          if (response.error?.message) notify(response.error.message);
        } else {
          const data = response?.data ?? response;
          const rawItems = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
          const items = rawItems.filter(hit => {
            const entity = hit?.entity || hit;
            return !entity?.kind || entity.kind === 'tag';
          }).map(hit => {
            const entity = hit?.entity || hit;
            return {
              ...entity,
              en: entity?.en ?? entity?.content ?? "",
              zh: entity?.zh ?? entity?.displayName ?? "",
              nsfw: entity?.nsfw ?? entity?.adult ?? false,
              category: entity?.category ?? entity?.categoryId ?? "other",
            };
          });
          page = { ...(Array.isArray(data) ? {} : data), items, total: data?.total ?? items.length, hasMore: data?.hasMore === true };
        }
      } else {
        page = tags?.page?.(options) || { items: [], total: 0, hasMore: false };
        while (page.hasMore && page.items.length < ui.visible) {
          const next = tags.page({ ...options, offset: page.items.length, limit: Math.min(2000, ui.visible - page.items.length) });
          if (!next.items.length) break;
          page = { ...next, items: [...page.items, ...next.items], offset: 0 };
        }
      }
      if (ui.tagPageCache.size >= 24) {
        const oldest = ui.tagPageCache.keys().next().value;
        if (oldest != null) ui.tagPageCache.delete(oldest);
      }
      ui.tagPageCache.set(cacheKey, page);
      return page;
    }
    function executeSearch() {
      ui.hiddenTagsOpen = false;
      const query = str($("#q")?.value);
      if (ui.route === "characters") {
        renderCharacters({ query });
        return;
      }
      if (ui.route !== "tags") route("tags");
      ui.subcategory = "";
      ui.visible = 400;
      tags?.setQuery?.(query);
      renderTags();
    }
    function renderCategories() {
      const host = $("#catList");
      if (!host) return;
      if (ui.catalogFailed) { host.replaceChildren(); return; }
      if (ui.catalogPending) {
        host.replaceChildren();
        const loading = doc.createElement('div');
        loading.className = 'catalog-loading';
        loading.textContent = localized('ui.common.loading', '正在准备标签库…');
        host.appendChild(loading);
        return;
      }
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
      const characterNames = rows.find(category => category?.id === "character_names");
      const orderedRows = characters ? rows.filter(category => category?.id !== "character_names") : rows;
      const seen = new Set();
      const appendCharacterLibrary = () => {
        if (!characters || !characterNames) return;
        const button = doc.createElement("button");
        button.type = "button";
        button.className = `cat character-library-entry btn btn-menu${ui.route === "characters" ? " on" : ""}`;
        button.dataset.characters = "true";
        button.style.setProperty("--cat-color", "#0E9B8E");
        const icon = doc.createElement("span");
        icon.className = "cico";
        icon.append(workspaceIcon(categoryIcons.character_names));
        const label = doc.createElement("span");
        label.textContent = ui.locale === "en-US" ? "Character library" : "角色库";
        const count = doc.createElement("span");
        count.className = "n";
        let total = 0;
        try { total = Number(characters.count?.() ?? characters.size?.()) || 0; } catch { total = 0; }
        count.textContent = String(total);
        button.append(icon, label, count);
        host.appendChild(button);
      };
      orderedRows.forEach((category) => {
        if (!category || seen.has(category.id)) return;
        seen.add(category.id);
        const count = snap.categoryCounts[category.id] || 0;
        const button = doc.createElement("button");
        button.className = `cat btn btn-menu${ui.route !== "characters" && snap.category === category.id ? " on" : ""}${category.neg ? " neg" : ""}${category.nsfw ? " nsfw" : ""}`;
        button.dataset.cat = category.id;
        button.style.setProperty("--cat-color", categoryColor(category.id));
        const label = category.id === "all" ? localized("ui.tag.all", category.name || category.id) : categoryLabel(category.id, category.name || category.id);
        const icon = doc.createElement('span'); icon.className = 'cico'; icon.append(workspaceIcon(categoryIcons[category.id] || 'tag')); button.append(icon);
        for (const [className, value] of [['', label], ['n', count]]) { const node = doc.createElement('span'); node.className = className; node.textContent = String(value); button.append(node); }
        if (category.source === 'custom') {
          button.dataset.customCategory = category.id;
          button.title = localized('ui.custom.deleteCategoryHint', '右键删除分类及其中的全部标签');
          host.appendChild(button);
        } else {
          host.appendChild(button);
        }
        if (category.id === "all") appendCharacterLibrary();
      });
      const adult = $("#aiNsfwChk");
      if (adult) adult.checked = snap.adult;
      syncNavAction("adult", snap.adult);
    }
    function renderSubcategoryNav(snap = tagSnapshot()) {
      const host = $("#subcatNav");
      if (!host) return;
      host.replaceChildren();
      host.hidden = true;
      const category = str(snap.category);
      if (snap.query || !category || category === "all") return;
      const entries = tags?.subcategories?.(category, { includeAdult: snap.adult }) || [];
      if (entries.length <= 1 && !entries.some(item => item.custom)) return;
      const color = categoryColor(category);
      const allCount = entries.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
      const rows = [{ id: '', name: "", label: localized("ui.tag.all", "全部"), count: allCount }, ...entries.map(item => ({
        id: item.id,
        name: str(item.name, "默认"),
        label: str(item.name, "默认"),
        count: Number(item.count) || 0,
        custom: item.custom === true,
      }))];
      rows.forEach((item) => {
        const wrap = doc.createElement('div'); wrap.className = 'subcat-item';
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
        wrap.appendChild(button);
        if (item.custom) {
          const remove = doc.createElement('button'); remove.type = 'button'; remove.className = 'subcat-delete'; remove.dataset.deleteSubcategory = item.id;
          remove.title = localized('ui.custom.deleteSubcategory', '删除子分类'); remove.setAttribute('aria-label', remove.title); remove.append(workspaceIcon('trash-2', 'favorites')); wrap.appendChild(remove);
        }
        host.appendChild(wrap);
      });
      host.hidden = false;
    }
    function renderFavoriteMatches() {
      const host = $("#favoriteSearchResults");
      if (!host) return;
      const query = tagSnapshot().query;
      host.replaceChildren();
      const result = query && favorites?.search?.(query, { scope: "global", includeAdult: tagSnapshot().adult, limit: 16 });
      host.hidden = !result?.items?.length;
      if (host.hidden) return;
      const heading = doc.createElement("h3");
      heading.textContent = `${localized("ui.favorites.searchMatches", "我的收藏")} (${result.total ?? result.items.length})`;
      const rows = doc.createElement("div"); rows.className = "chips";
      const selected = new Set(selectedFavorites().map(item => item.entryId));
      result.items.forEach(hit => {
        const row = doc.createElement("div"); row.className = "favorite-global-item";
        const button = doc.createElement("button"); button.type = "button";
        button.dataset.favoriteGlobalEntry = hit.entryId;
        button.className = `chip btn btn-chip${selected.has(hit.entryId) ? " sel" : ""}`;
        button.style.setProperty("--c", hit.color || "var(--pri)");
        button.setAttribute("aria-pressed", String(selected.has(hit.entryId)));
        const title = doc.createElement("span"); title.className = "en";
        title.textContent = hit.title || hit.rawText;
        const detail = doc.createElement("span"); detail.className = "zh";
        detail.textContent = ["Tag", hit.seriesName, hit.sectionName].filter(Boolean).join(" · ");
        button.append(title, detail);
        button.onclick = async () => {
          const chosen = await favorites.setSelected(hit.entryId, !selectedFavorites().some(item => item.entryId === hit.entryId));
          if (chosen?.ok === false) { notify(chosen.error?.message || localized("ui.favorites.selectFailed", "选择失败")); return; }
          renderSelection();
          if (await copyExact(favorites.copyText([hit.entryId]))) await favorites.markCopied?.([hit.entryId]);
          else notify(localized("ui.favorites.copyFailed", "复制失败"));
        };
        const locate = doc.createElement("button"); locate.type = "button"; locate.className = "btn btn-icon";
        const isGroup = hit.kind === 'bundle'; locate.title = isGroup ? localized('ui.tag.groupJump', '跳转到标签组') : localized("ui.favorites.locate", "定位原处"); locate.setAttribute("aria-label", locate.title);
        if (isGroup) locate.dataset.tagGroupJump = hit.tagId || hit.sourceTagId || '';
        locate.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="../assets/icons/favorites.svg#locate-fixed"></use></svg>';
        locate.onclick = async event => { event.stopPropagation(); if (isGroup) { ui.tagArea='groups'; ui.selectedGroupId=hit.tagId || hit.sourceTagId || ''; tags?.setQuery?.(''); $('#q').value=''; ui.tagPageCache.clear(); renderTags(); } else if (await route("favorites") !== false) views.favorites?.focusEntry?.(hit.entryId); };
        const wrap = doc.createElement('span'); wrap.className = 'tag-reference-wrap';
        wrap.append(button, createTagReferenceButton(hit.rawText || hit.content));
        row.append(wrap, locate); rows.appendChild(row);
      });
      host.append(heading, rows);
    }
    async function openTagGroup(id) {
      const group = catalog?.getTag?.(id);
      if (group?.kind !== 'bundle' || !Array.isArray(group.memberTagIds)) return false;
      if (await route('tags') === false) return false;
      clearTimeout(ui.searchTimer);
      ui.tagArea = 'groups'; ui.selectedGroupId = id; ui.expandedGroups.clear(); ui.groupMemberSelection.clear();
      tags?.setQuery?.(''); if ($('#q')) $('#q').value = ''; ui.tagPageCache.clear(); renderTags();
      return true;
    }
    async function openFavoriteCharacter(id) {
      const character = characters?.get?.(id, { includeAdult: tagSnapshot().adult });
      if (!character || await route('characters') === false) return false;
      clearTimeout(ui.searchTimer);
      ui.characterQuery = character.name;
      if ($('#q')) $('#q').value = character.name;
      renderCharacters({ query: character.name });
      views.characters?.openCharacter?.(id);
      views.characters?.refresh?.();
      return true;
    }
    function renderGroupSearchMatches(host, snap) {
      if (!host || !snap.query) return;
      const groups = tags?.searchGroups?.(snap.query, { includeAdult: snap.adult }) || [];
      if (!groups.length) return;
      const section = doc.createElement('section'); section.className = 'tag-group-search-results';
      const title = doc.createElement('h3'); title.textContent = localized('ui.tag.groupMatches', '标签组匹配'); section.append(title);
      const list = doc.createElement('div'); list.className = 'tag-group-search-list';
      for (const group of groups.slice(0, 20)) {
        const row = doc.createElement('div'); row.className = 'tag-group-search-row';
        const label = doc.createElement('span'); label.textContent = group.displayName || group.content || group.id;
        const jump = doc.createElement('button'); jump.type = 'button'; jump.className = 'tag-group-jump'; jump.dataset.tagGroupJump = group.id; jump.append(workspaceIcon('book-open')); const jumpLabel = doc.createElement('span'); jumpLabel.textContent = localized('ui.tag.groupJump', '查看标签组'); jump.append(jumpLabel); jump.title = jumpLabel.textContent;
        row.append(label, jump); list.append(row);
      }
      section.append(list); host.append(section);
    }
    function syncTagModeTabs() {
      const tabs = $("#tagModeTabs");
      if (!tabs) return;
      $$("[data-tag-mode]", tabs).forEach(button => {
        const mode = button.dataset.tagMode;
        const active = mode === 'characters' ? ui.route === 'characters' : ui.route === 'tags' && mode === ui.tagArea;
        button.classList.toggle("on", active);
        button.setAttribute("aria-selected", String(active));
        const iconName = mode === 'characters' ? 'book-open' : mode === 'groups' ? 'layers' : 'tag';
        const label = mode === 'characters' ? localized('ui.characters.library', '角色库') : mode === 'groups' ? localized('ui.tag.groups', '标签组') : localized('ui.tag.tags', '标签');
        const text = doc.createElement('span'); text.className = 'mode-label'; text.textContent = label;
        button.replaceChildren(workspaceIcon(iconName), text);
      });
      const create = $("#tagGroupCreateFromSelection");
      if (create) create.hidden = ui.route !== 'tags' || selectedIds().length < 2;
      show("#addTagBtn", ui.route === "tags" && ui.tagArea === "tags");
      show("#addGroupBtn", ui.route === "tags" && ui.tagArea === "groups");
    }

    function renderTagGroups() {
      const host = $('#chips');
      if (!host) return;
      if (!viewFactories.characters && global.AppViewLoader) {
        host.textContent = localized('ui.common.loading', '正在加载…');
        ensureViews(['characters']).then(() => {
          if (!disposed && ui.route === 'tags' && ui.tagArea === 'groups') renderTagGroups();
        }).catch(error => { if (!disposed) notify(error.message); });
        return;
      }
      const snap = tagSnapshot();
      const groups = snap.query
        ? (tags?.searchGroups?.(snap.query, { includeAdult: snap.adult }) || [])
        : (tags?.listGroups?.({ includeAdult: snap.adult }) || []);
      const template = viewFactories.characters;
      host.replaceChildren();
      $('#subcatNav')?.setAttribute('hidden', '');
      $('#favoriteSearchResults')?.setAttribute('hidden', '');
      const clearSearch = $('#clearQ'); if (clearSearch) clearSearch.style.display = snap.query ? '' : 'none';
      put('#catTitle', localized('ui.tag.groups', '标签组'));
      put('#catCnt', formatText(localized('ui.tag.groupCount', '{count} 个标签组'), { count: groups.length }));
      const workspace = doc.createElement('div'); workspace.id = 'tagGroupWorkspace'; workspace.className = 'characters-layout';
      const browser = doc.createElement('section'); browser.className = 'character-browser'; browser.setAttribute('aria-label', localized('ui.tag.groups', '标签组'));
      const list = doc.createElement('div'); list.id = 'tagGroupList'; list.className = 'character-list'; browser.append(list);
      const detail = doc.createElement('article'); detail.id = 'tagGroupDetail'; detail.className = 'character-detail'; detail.setAttribute('aria-live', 'polite');
      workspace.append(browser, detail); host.append(workspace);
      if (!groups.length) {
        ui.selectedGroupId = ''; ui.groupMemberSelection.clear();
        list.append(Object.assign(doc.createElement('div'), { className: 'character-empty', textContent: localized('ui.tag.noGroup', '没有标签组') }));
        detail.append(Object.assign(doc.createElement('div'), { className: 'character-detail-empty', textContent: localized('ui.tag.chooseGroup', '选择一个标签组查看成员') }));
        return;
      }
      if (!groups.some(group => group.id === ui.selectedGroupId)) ui.selectedGroupId = groups[0].id;
      const selectedGroup = groups.find(group => group.id === ui.selectedGroupId);
      const selectedMembers = (tags?.expandGroup?.(selectedGroup.id) || []).filter(member => snap.adult || !(member.adult || member.nsfw));
      const selectedMemberIds = new Set(selectedMembers.map(member => member.id));
      ui.groupMemberSelection = new Set([...ui.groupMemberSelection].filter(id => selectedMemberIds.has(id)));
      const actionButton = (icon, title, sprite = 'workspace') => {
        const button = doc.createElement('button'); button.type = 'button'; button.className = 'tag-action-button';
        button.title = title; button.setAttribute('aria-label', title); button.append(workspaceIcon(icon, sprite)); return button;
      };
      for (const group of groups) {
        const wrap = doc.createElement('div'); wrap.className = 'character-row-wrap tag-group-row tag-actions-parent'; wrap.dataset.tagGroup = group.id;
        wrap.classList.toggle('on', group.id === ui.selectedGroupId);
        const row = template.createCollectionRow(doc, {
          title: group.content || group.id, subtitle: group.displayName,
          meta: group.edited ? localized('ui.custom.modified', '已修改') : group.custom ? localized('ui.custom.custom', '自建') : '',
          count: group.memberTagIds.length, active: group.id === ui.selectedGroupId
        });
        row.dataset.tagGroupSelect = group.id; row.classList.toggle('is-custom', Boolean(group.custom)); row.classList.toggle('is-edited', Boolean(group.edited));
        row.onclick = () => { if (ui.selectedGroupId !== group.id) ui.groupMemberSelection.clear(); ui.selectedGroupId = group.id; renderTagGroups(); };
        const actions = doc.createElement('span'); actions.className = 'tag-actions tag-group-row-actions';
        const edit = actionButton('pencil', localized('ui.custom.editTitle', '编辑 Tag 组'), 'favorites'); edit.dataset.tagGroupEdit = group.id;
        const expand = actionButton(ui.expandedGroups.has(group.id) ? 'chevron-up' : 'chevron-down', ui.expandedGroups.has(group.id) ? localized('ui.tag.collapse', '收起') : localized('ui.tag.expand', '展开'), 'favorites');
        expand.dataset.tagGroupExpand = group.id; expand.setAttribute('aria-expanded', String(ui.expandedGroups.has(group.id)));
        actions.append(edit, expand); wrap.append(row, actions);
        if (ui.expandedGroups.has(group.id)) {
          const members = doc.createElement('div'); members.className = 'character-tag-values tag-group-row-members';
          for (const member of (tags?.expandGroup?.(group.id) || []).filter(item => snap.adult || !(item.adult || item.nsfw))) {
            const button = doc.createElement('button'); button.type = 'button'; button.className = 'character-tag-value';
            button.textContent = member.displayName ? member.content + ' · ' + member.displayName : member.content;
            button.onclick = () => void copyTagIds([member.id]); members.append(button);
          }
          wrap.append(members);
        }
        list.append(wrap);
      }
      const edit = actionButton('pencil', localized('ui.custom.editTitle', '编辑 Tag 组'), 'favorites'); edit.dataset.tagGroupEdit = selectedGroup.id;
      detail.append(template.createCollectionHeading(doc, { title: selectedGroup.displayName || selectedGroup.content || selectedGroup.id, subtitle: selectedGroup.content, actions: [edit] }));
      const meta = doc.createElement('div'); meta.className = 'character-meta';
      if (selectedGroup.note) meta.append(Object.assign(doc.createElement('span'), { className: 'character-meta-row', textContent: selectedGroup.note }));
      if (selectedGroup.aliases?.length) meta.append(Object.assign(doc.createElement('span'), { className: 'character-meta-row', textContent: selectedGroup.aliases.join(' / ') }));
      detail.append(meta);
      const section = doc.createElement('section'); section.className = 'character-trait-section';
      section.append(Object.assign(doc.createElement('h4'), { textContent: localized('ui.tag.members', '组成员') }));
      const values = doc.createElement('div'); values.className = 'character-member-list';
      const controls = doc.createElement('div'); controls.className = 'character-actions';
      const copySelected = doc.createElement('button'); copySelected.type = 'button'; copySelected.className = 'abtn character-copy-action btn btn-secondary'; copySelected.dataset.groupCopySelected = selectedGroup.id;
      const copyAll = doc.createElement('button'); copyAll.type = 'button'; copyAll.className = 'abtn character-copy-action btn btn-secondary'; copyAll.dataset.groupCopyAll = selectedGroup.id;
      const updateSelected = () => { copySelected.disabled = !ui.groupMemberSelection.size; copySelected.textContent = localized('ui.tag.copySelectedMembers', '复制所选') + ' (' + ui.groupMemberSelection.size + ')'; };
      copySelected.onclick = () => void copyTagIds(selectedMembers.filter(member => ui.groupMemberSelection.has(member.id)).map(member => member.id));
      copyAll.textContent = localized('ui.tag.copyAllMembers', '复制全部'); copyAll.disabled = !selectedMembers.length; copyAll.onclick = () => void copyTagIds(selectedMembers.map(member => member.id));
      for (const member of selectedMembers) {
        const edit = actionButton('pencil', localized('ui.custom.editTitle', '编辑 Tag'), 'favorites'); edit.dataset.groupMemberEdit = member.id; edit.onclick = () => void openTagEditor(member);
        const favorite = actionButton('star', member.favorite ? localized('ui.favorites.unfavorite', '取消收藏') : localized('ui.favorites.favorite', '收藏'));
        favorite.dataset.groupMemberFavorite = member.id; favorite.classList.add('favorite-toggle'); favorite.classList.toggle('is-favorite', Boolean(member.favorite)); favorite.setAttribute('aria-pressed', String(Boolean(member.favorite))); favorite.onclick = () => void favoriteTag(member.id);
        const rendered = template.createCollectionMember(doc, {
          title: member.content, subtitle: member.displayName, checked: ui.groupMemberSelection.has(member.id),
          selectionLabel: (ui.locale === 'en-US' ? 'Select ' : '选择 ') + (member.displayName || member.content),
          copyLabel: localized('ui.tag.copyOnly', '仅复制'), onCopy: () => void copyTagIds([member.id]),
          actions: [edit, favorite, createTagReferenceButton(member.content)]
        });
        rendered.row.dataset.tagGroupMember = member.id; rendered.input.dataset.groupMemberSelect = member.id; rendered.words.dataset.groupMemberCopy = member.id;
        rendered.row.classList.toggle('is-selected', rendered.input.checked);
        rendered.input.onchange = () => { rendered.input.checked ? ui.groupMemberSelection.add(member.id) : ui.groupMemberSelection.delete(member.id); rendered.row.classList.toggle('is-selected', rendered.input.checked); updateSelected(); };
        values.append(rendered.row);
      }
      if (!values.childElementCount) values.append(Object.assign(doc.createElement('div'), { className: 'character-no-features', textContent: localized('ui.tag.noMembers', '暂无成员') }));
      section.append(values); controls.append(copySelected, copyAll); detail.append(section, controls); updateSelected();
    }

    function ensureHiddenTagsButton() {
      const toolbar = $('#tagLibraryView > .toolbar');
      if (!toolbar) return null;
      let button = toolbar.querySelector('[data-hidden-tags-toggle]');
      if (!button) {
        button = doc.createElement('button');
        button.type = 'button';
        button.className = 'abtn ghost btn btn-ghost';
        button.dataset.hiddenTagsToggle = 'true';
        toolbar.insertBefore(button, $('#clearQ'));
      }
      button.textContent = ui.hiddenTagsOpen
        ? (ui.locale === 'en-US' ? 'Back to tags' : '返回标签')
        : (ui.locale === 'en-US' ? 'Hidden tags' : '已隐藏标签');
      button.hidden = ui.tagArea === 'groups';
      button.setAttribute('aria-pressed', String(ui.hiddenTagsOpen));
      button.disabled = !ui.hiddenTagsReady;
      return button;
    }
    async function renderHiddenTags() {
      const host = $('#chips');
      if (!host) return;
      const revision = ++ui.hiddenTagsRevision;
      host.replaceChildren();
      const loading = doc.createElement('div');
      loading.className = 'catalog-loading';
      loading.textContent = ui.locale === 'en-US' ? 'Loading hidden tags…' : '正在读取隐藏标签…';
      host.appendChild(loading);
      const result = await catalog?.listHiddenTags?.();
      if (!ui.hiddenTagsOpen || revision !== ui.hiddenTagsRevision) return;
      host.replaceChildren();
      if (!result?.ok || !Array.isArray(result.data)) {
        const error = doc.createElement('div');
        error.className = 'empty';
        error.textContent = result?.error?.message || (ui.locale === 'en-US' ? 'Unable to load hidden tags' : '读取隐藏标签失败');
        host.appendChild(error);
        return;
      }
      const records = result.data;
      if (!records.length) {
        const empty = doc.createElement('div');
        empty.className = 'empty';
        empty.textContent = ui.locale === 'en-US' ? 'No hidden tags' : '没有已隐藏的标签';
        host.appendChild(empty);
        return;
      }
      const section = doc.createElement('section');
      section.className = 'group';
      const heading = doc.createElement('div');
      heading.className = 'group-head';
      const title = doc.createElement('span'); title.className = 'name'; title.textContent = ui.locale === 'en-US' ? 'Hidden tags' : '已隐藏标签';
      const line = doc.createElement('span'); line.className = 'line';
      const count = doc.createElement('span'); count.className = 'n'; count.textContent = String(records.length);
      heading.append(title, line, count);
      const rows = doc.createElement('div'); rows.className = 'chips';
      for (const record of records) {
        const row = doc.createElement('div'); row.className = 'chip-with-actions';
        const label = doc.createElement('div'); label.className = 'chip btn btn-chip';
        const en = doc.createElement('span'); en.className = 'en'; en.textContent = String(record.content || record.id || '');
        const zh = doc.createElement('span'); zh.className = 'zh'; zh.textContent = String(record.displayName || '');
        label.append(en, zh);
        const restore = doc.createElement('button'); restore.type = 'button'; restore.className = 'abtn btn btn-secondary';
        restore.dataset.hiddenTagRestore = String(record.id);
        restore.textContent = ui.locale === 'en-US' ? 'Restore' : '恢复';
        row.append(label, restore);
        rows.appendChild(row);
      }
      section.append(heading, rows);
      host.appendChild(section);
    }
    function renderTags() {
      ensureHiddenTagsButton();
      syncTagModeTabs();
      $('#tagLibraryView')?.classList.toggle('tag-groups-active', ui.tagArea === 'groups');
      $('#tagLibraryView > .toolbar')?.classList.toggle('characters-toolbar', ui.tagArea === 'groups');
      if (ui.tagArea === "groups") { renderTagGroups(); return; }
      const host = $("#chips");
      if (!host) return;
      if (ui.hiddenTagsOpen) { void renderHiddenTags(); return; }
      if (ui.catalogFailed) { host.replaceChildren(); return; }
      if (ui.catalogPending) {
        host.replaceChildren();
        const loading = doc.createElement('div');
        loading.className = 'catalog-loading';
        loading.textContent = localized('ui.common.loading', '正在准备标签库…');
        host.appendChild(loading);
        return;
      }
      const snap = tagSnapshot();
      const page = tagRows();
      renderFavoriteMatches();
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
        renderGroupSearchMatches(host, snap);
        return;
      }
      groups.forEach((items, group) => {
        const section = doc.createElement("section");
        section.className = "group";
        section.style.setProperty("--group-color", categoryColor(items[0]?.category));
        const head = doc.createElement('div'); head.className = 'group-head'; for (const [className, value] of [['name', group], ['line', ''], ['n', items.length + ' 个']]) { const node = doc.createElement('span'); node.className = className; node.textContent = String(value); head.append(node); } section.append(head);
        const row = doc.createElement("div");
        row.className = "chips";
        items.forEach((item) => {
          const button = doc.createElement("button");
          button.className = `chip btn btn-chip${chosen.has(String(item.id || item.en)) ? " sel" : ""}${item.nsfw ? " nsfw" : ""}`;
          if (item.custom) button.classList.add('is-custom');
          if (item.edited) button.classList.add('is-edited');
          button.dataset.en = String(item.id || item.en);
          button.style.setProperty("--c", categoryColor(item.category));
          const en = doc.createElement("span"); en.className = "en"; en.textContent = item.en || ""; const zh = doc.createElement("span"); zh.className = "zh"; zh.textContent = item.zh || (item.aliases || item.al || []).join(" "); const cp = doc.createElement("span"); cp.className = "cp"; cp.textContent = localized("ui.tag.copyOnly", "仅复制"); button.append(en, zh, cp);
          if (item.searchable === false) { const state = doc.createElement('small'); state.className = 'tag-search-disabled'; state.textContent = localized('ui.tag.searchDisabled', '不参与搜索'); button.append(state); }
          const wrap = doc.createElement("div");
          wrap.className = item.category === "character_names" && characters ? "chip-with-character chip-with-actions" : "chip-with-actions";
          const actions = doc.createElement('span'); actions.className = 'chip-actions';
          const edit = doc.createElement('button'); edit.type = 'button'; edit.className = 'chip-action chip-edit'; edit.dataset.tagEdit = str(item.id || item.en); edit.append(workspaceIcon('pencil', 'favorites')); edit.title = localized('ui.custom.editTitle', '编辑 Tag'); edit.setAttribute('aria-label', edit.title);
          const star = doc.createElement('button'); star.type = 'button'; star.className = 'chip-action chip-favorite favorite-toggle'; star.dataset.tagFavorite = str(item.id || item.en); star.append(workspaceIcon('star')); star.title = item.favorite ? localized('ui.favorites.unfavorite', '取消收藏') : localized('ui.favorites.favorite', '收藏'); star.setAttribute('aria-label', star.title);
          star.setAttribute('aria-pressed', String(Boolean(item.favorite)));
          star.classList.toggle('is-favorite', Boolean(item.favorite));
          actions.append(edit, star);
          if (item.edited) { const restore = doc.createElement('button'); restore.type = 'button'; restore.className = 'chip-action chip-restore'; restore.dataset.tagRestore = str(item.id || item.en); restore.append(workspaceIcon('undo-2', 'favorites')); restore.title = localized('ui.custom.restore', '恢复默认'); restore.setAttribute('aria-label', restore.title); actions.append(restore); }
          wrap.classList.add('has-tag-reference');
          wrap.append(button, actions, createTagReferenceButton(item.en));
          if (item.note) {
            const note = doc.createElement('span'); note.className = 'tag-note-popover'; note.dataset.tagNote = item.id; note.id = 'tag-note-' + encodeURIComponent(item.id); note.setAttribute('role', 'tooltip'); note.textContent = item.note;
            button.setAttribute('aria-describedby', note.id); wrap.append(note);
          }
          if (item.category === "character_names" && characters) {
            const jump = doc.createElement("button");
            jump.type = "button";
            jump.className = "character-jump";
            jump.dataset.characterJump = str(item.id || item.en);
            jump.textContent = ui.locale === "en-US" ? "Open character" : "查看角色";
            jump.title = ui.locale === "en-US" ? "Open character library" : "跳转到角色库";
            wrap.append(jump);
          }
          row.appendChild(wrap);
        });
        section.appendChild(row);
        host.appendChild(section);
      });
      renderGroupSearchMatches(host, snap);
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
      if (catalog) {
        const rows = canonicalSelected(), host = $('#selbox'); put('#selCount', rows.length);
        if (!host) return; host.replaceChildren();
        for (const item of rows) {
          const chip = doc.createElement('span'); chip.className = 'schip'; const text = doc.createElement('span'); text.textContent = item.displayName || item.content;
          if (item.kind === 'legacySnapshot') { const badge = doc.createElement('small'); badge.className = 'selection-snapshot-label'; badge.textContent = localized('ui.tag.legacySnapshot', '旧快照'); chip.append(badge); }
          const remove = doc.createElement('button'); remove.type = 'button'; remove.className = 'btn btn-icon btn-danger'; remove.dataset.selectionKey = item.key; remove.textContent = '✕';
          const referenceContent = item.kind === 'character' ? catalog.getTag(item.tagIds?.[0])?.content : item.content;
          chip.append(text, createTagReferenceButton(referenceContent), remove); host.append(chip);
        }
        const preview = $('#preview'); if (preview) preview.textContent = combinedSelectionText();
        syncSelectedClasses(); views.favorites?.syncSelection?.(); return;
      }
      const rows = selected();
      const characterRows = selectedCharacters();
      const favoriteRows = selectedFavorites();
      const host = $("#selbox");
      put("#selCount", rows.length + characterRows.length + favoriteRows.length);
      if (!host) return;
      const expandedFavorites = new Set($$(".favorite-selection-details[open]", host).map(node => node.dataset.favoriteSnapshot));
      host.replaceChildren();
      if (!rows.length && !characterRows.length && !favoriteRows.length)
        host.innerHTML =
          '<span class="emptyhint">点击上方标签即可选中，支持多选</span>';
      rows.forEach((item) => {
        const chip = doc.createElement("span");
        chip.className = "schip";
        const text = doc.createElement('span'); text.textContent = item.en || item.id; const remove = doc.createElement('button'); remove.dataset.remove = item.id || item.en; remove.textContent = '✕'; chip.append(text, remove);
        host.appendChild(chip);
      });
      characterRows.forEach(item => {
        const chip = doc.createElement("span");
        chip.className = "schip character-selection";
        const words = doc.createElement("span");
        words.className = "character-chip-text";
        const name = doc.createElement("b");
        name.textContent = str(item.name || item.id);
        const tagsText = doc.createElement("small");
        tagsText.textContent = (item.tags || []).join(", ");
        words.append(name, tagsText);
        const remove = doc.createElement("button");
        remove.type = "button";
        remove.className = "btn btn-icon btn-danger";
        remove.dataset.removeCharacter = str(item.id);
        remove.textContent = "✕";
        chip.append(words, remove);
        host.appendChild(chip);
      });
      favoriteRows.forEach(item => {
        const chip = doc.createElement("span"); chip.className = "schip favorite-selection";
        const details = doc.createElement("details"); details.className = "favorite-selection-details";
        details.dataset.favoriteSnapshot = item.entryId; details.open = expandedFavorites.has(item.entryId);
        const summary = doc.createElement("summary");
        const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg"); icon.classList.add("favorite-icon"); icon.setAttribute("aria-hidden", "true");
        const use = doc.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", "../assets/icons/favorites.svg#tag"); icon.append(use);
        const title = doc.createElement("span"); title.textContent = item.title || item.rawText; title.title = item.rawText;
        const raw = doc.createElement("pre"); raw.textContent = item.rawText;
        summary.append(icon, title); details.append(summary, raw);
        const remove = doc.createElement("button"); remove.type = "button"; remove.className = "btn btn-icon btn-danger";
        remove.dataset.removeFavorite = item.entryId; remove.textContent = "✕";
        remove.setAttribute("aria-label", localized("ui.favorites.removeSelection", "从当前组合移除"));
        chip.append(details, remove); host.appendChild(chip);
      });
      const preview = $("#preview"); if (preview) preview.textContent = combinedSelectionText();
      const selectedIds = new Set(favoriteRows.map(item => item.entryId));
      $$("[data-favorite-global-entry]").forEach(button => {
        const selected = selectedIds.has(button.dataset.favoriteGlobalEntry);
        button.classList.toggle("sel", selected); button.setAttribute("aria-pressed", String(selected));
      });
      views.favorites?.syncSelection?.();
    }
    function syncSelectedClasses() {
      const chosen = new Set(selectedIds());
      $$("#chips [data-en]").forEach((button) => button.classList.toggle("sel", chosen.has(button.dataset.en)));
    }
    function toggleAdultTags() {
      const next = !tagSnapshot().adult;
      ui.adult = next;
      ui.adultStored = true;
      tags?.setAdult?.(next);
      // 既按界面惯例记在 `app.adult`，也推给标签库；该键必须在 UI 偏好白名单里。
      preferences.set("app.adult", next);
      renderCategories();
      if (ui.route === "characters") renderCharacters();
      else if (ui.route === "favorites") views.favorites?.render?.();
      else renderTags();
      renderSelection();
    }
    function syncScrim() {
      $("#scrim")?.classList.toggle("show", ui.visionOpen);
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
      if (ui.visionOpen) {
        // 进入识图模式：记录当前多选（发送区草稿）→ 取消多选并锁定多选，
        // 允许从对话区拖动单张图片到右侧识图；关闭时恢复之前的多选。
        ui.conversationSelectionSnapshot = ui.sendDrafts.slice();
        ui.visionSelectLock = true;
        ui.sendDrafts = [];
        renderConversationRepository();
      } else if (ui.visionSelectLock) {
        ui.visionSelectLock = false;
        ui.sendDrafts = ui.conversationSelectionSnapshot.filter(draft => Boolean(fullImageFor(draft.imageId)));
        ui.conversationSelectionSnapshot = [];
        renderConversationRepository();
      }
      syncVisionPaneOffset();
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
    let manualCapabilityCheck = false;
    function capabilityLabel(capabilities) {
      const comfyState = capabilities?.comfy || {};
      if (comfyState.render) return "ComfyUI 已连接 · 工作流已就绪";
      if (!comfyState.connected) return comfyState.error || "ComfyUI 未连接 · 请确认 ComfyUI 已启动，并检查「API 设置 → ComfyUI 地址」";
      if (!comfyState.enabled) return comfyState.error || "ComfyUI 已停用 · 请在 API 设置中开启 ComfyUI";
      if (!comfyState.workflowReady) {
        return comfyState.error || "ComfyUI 未就绪 · 请到「API 设置 → ComfyUI」上传或粘贴 API 格式工作流";
      }
      return comfyState.error || "ComfyUI 已连接 · 工作流已就绪";
    }
    function syncComfyStatus(capabilities = ui.comfyCapabilities) {
      const module = $("#comfyUiModule");
      if (!module) return;
      const state = capabilities?.comfy || assistant?.getCapabilities?.()?.comfy || {};
      module.hidden = false;
      for (const selector of ["#talkComfyOn", "#comfyOn"]) {
        const toggle = $(selector);
        if (toggle) {
          if (!toggle.disabled) toggle.checked = settings().comfyOn === true;
          toggle.title = "";
        }
      }
      syncGenerationControls();
    }
    function syncGenerationControls() {
      const current = settings();
      const state = ui.comfyCapabilities?.comfy;
      const enabled = (current.comfyOn === true || current.comfy?.enabled === true) && state?.connected === true && state?.workflowReady === true;
      const batch = $("#imagesPerRound");
      if (batch) { if (doc.activeElement !== batch) batch.value = String(Math.max(1, Number(current.imagesPerRound) || 1)); batch.disabled = false; }
      const settingsBatch = $("#settingsImagesPerRound");
      if (settingsBatch && doc.activeElement !== settingsBatch) settingsBatch.value = String(Math.max(1, Number(current.imagesPerRound) || 1));
      const controls = $(".generation-controls"); if (controls) controls.hidden = false;
    }
    async function refreshCapabilitiesStatus(options = {}) {
      if (typeof assistant?.refreshCapabilities !== "function") return null;
      if (manualCapabilityCheck && !options.userInitiated) return null;
      const requestId = ++capabilityRequestId;
      let capabilities;
      try { capabilities = await assistant.refreshCapabilities(options); }
      catch (error) { if (options.userInitiated) throw error; return null; }
      if (requestId !== capabilityRequestId) return capabilities;
      ui.comfyCapabilities = capabilities;
      const label = capabilityLabel(capabilities);
      put("#comfyCapabilityHint", label);
      syncComfyStatus(capabilities);
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
        /**
         * 悬浮说明：带图的请求从链路 1 开始试，已证实不能看图的链路自动跳过。
         */
        aiButton.title = capabilities?.vision?.ai
          ? "识图：带图的请求从链路 1 开始试，已证实不能看图的链路自动跳过"
          : capabilities?.vision?.aiError || "链路列表里还没有填全的链路（地址 + 模型），请到「API 设置」补一条";
      }
      return capabilities;
    }
    function scheduleCapabilitiesStatus() {
      clearTimeout(capabilityTimer);
      capabilityTimer = setTimeout(() => refreshCapabilitiesStatus(), 180);
    }
    function renderPrompt() {
      views.prompt?.render();
      return views.prompt?.snapshot?.() || {};
    }
    function workflowText(value) {
      if (typeof value === "string") return value;
      if (!value || typeof value !== "object") return "";
      try { return JSON.stringify(value, null, 2); } catch { return ""; }
    }

    /**
     * 链路表里"用户改过、还没落盘"的标记。
     *
     * 行的编辑一律在 `change`（失焦）时立刻保存；`input` 只把这个标记立起来，
     * 由 `flushSettingsSave()`（切标签页 / 离开 AI 页 / 显式 flush）兜底 ——
     * 避免边打字边把半截地址写进设置。
     */
    let linkTableDirty = false;
    function markLinkTableDirty() { linkTableDirty = true; }

    function flushSettingsSave() {
      if (ui.route === "ai" && ui.aiTab === "api" && linkTableDirty) {
        linkTableDirty = false;
        saveLinkTable({ silent: true });
      }
    }

    /**
     * 链路表（API 设置整块界面）。
     *
     * 设置里只有一条有序列表 `links`：一行 = 一条链路，**行序 = 优先级**。
     *
     * `assistant.setSettings({ links })` 交给宿主的那一份（`对接层/界面/服务商.js` 的 `写链路`）按 **id** 合并：
     *   · 数组的**成员** = 保存后还剩哪几行（数组里没有的 id = 删掉那行，连同它的密钥）；
     *   · 数组的**顺序** = 新的优先级顺序；
     *   · 每行的 `key` **只在用户现输入时带上**（非空 = 写新密钥）。
     *
     * 表单投影（`getSettings()`）永不含密钥、只给 `keyConfigured`，所以"用户没动 Key"
     * 必须表现为**这个字段不出现** —— 传 `key: ""` 会把已存的密钥擦掉。
     */
    /**
     * 服务商预设 —— **全应用只有这一份**。
     *
     * 旧界面在 HTML 里抄了两份（主 API 一份、识图 API 一份 + 两个 `#aiPreset`/`#visionPreset`），
     * 每一行的下拉都从这里生成。
     */
    const PROVIDER_PRESETS = Object.freeze([
      { base: "https://api.openai.com/v1", key: "presetOpenAI", fallback: "OpenAI" },
      { base: "https://api.deepseek.com/v1", key: "presetDeepSeek", fallback: "DeepSeek（deepseek-chat）" },
      { base: "https://api.siliconflow.cn/v1", key: "presetSiliconFlow", fallback: "硅基流动 SiliconFlow" },
      { base: "https://api.moonshot.cn/v1", key: "presetMoonshot", fallback: "Moonshot Kimi" },
      { base: "https://dashscope.aliyuncs.com/compatible-mode/v1", key: "presetDashScope", fallback: "阿里云百炼（通义）" },
      { base: "http://localhost:11434/v1", key: "presetOllama", fallback: "Ollama（本地）" },
      { base: "", key: "presetCustom", fallback: "自定义…" },
    ]);
    /** 界面上最多几条（加到这儿「＋ 添加链路」就灰；底下那句把它说出来）。 */
    const MAX_LINKS = 8;

    function presetLabel(preset) { return localized(`ui.settings.${preset.key}`, preset.fallback); }

    /** 行内元素查询（行的 id 只在 data 属性上，不用拼选择器，避免转义问题）。 */
    function rowField(row, name) { return row?.querySelector?.(`[data-link-field="${name}"]`) || null; }
    function linkRows() {
      const host = $("#linkList");
      return host ? [...host.querySelectorAll("[data-link-row]")] : [];
    }
    function linkRowById(id) { return linkRows().find(node => str(node.dataset.linkId) === str(id)) || null; }

    /**
     * 建一行（**只建 DOM，不绑事件**）—— 事件统一委托在 `#linkList` 上（见 `bind()`）。
     * 行节点会被复用（按 id 认人），所以监听器绑在行上会在重排/删除时漏掉。
     */
    function buildLinkRow(id) {
      const row = doc.createElement("div");
      row.className = "link-row";
      row.dataset.linkRow = "";
      row.dataset.linkId = str(id);
      row.innerHTML = `
        <div class="link-row-head">
          <span class="link-index" data-link-field="index"></span>
          <span class="link-badge" data-link-field="badge" role="img"></span>
          <span class="link-row-spacer"></span>
          <button type="button" class="abtn ghost btn btn-ghost" data-link-action="up"></button>
          <button type="button" class="abtn ghost btn btn-ghost" data-link-action="down"></button>
          <button type="button" class="abtn btn btn-secondary" data-link-action="probe"></button>
          <button type="button" class="abtn btn btn-secondary" data-link-action="test"></button>
          <button type="button" class="abtn ghost danger btn btn-danger" data-link-action="remove"></button>
        </div>
        <label><span data-link-field="presetLabel"></span><select data-link-field="preset"></select></label>
        <label><span data-link-field="baseLabel"></span><input data-link-field="base" /></label>
        <label>
          <span data-link-field="keyLabel"></span>
          <div class="key-row">
            <input data-link-field="key" type="password" autocomplete="off" />
            <button type="button" class="abtn ghost danger btn btn-danger" data-link-action="clearKey"></button>
          </div>
          <span class="secret-status" data-link-field="keyStatus"></span>
        </label>
        <div class="link-model">
          <span data-link-field="modelLabel"></span>
          <!-- 模型这一格是**自由输入 + 现取的候选**：型号自己填得进去；点这一格（或按右边那个
               「取列表」）现去服务商那边取一份，候选画在下面那块里。只有这家真的提供的模型才进得去。 -->
          <div class="link-model-row">
            <input data-link-field="model" autocomplete="off" spellcheck="false" />
            <button type="button" class="abtn ghost btn btn-ghost" data-link-action="models"></button>
          </div>
          <div class="link-model-list" data-link-field="modelList" hidden></div>
          <span class="api-mode-hint" data-link-field="modelHint"></span>
        </div>
        <!--
          **模型上下文窗口**（token 数，留空 = 未知）。

          ⚠️ **不预置任何模型的默认值**：同名模型在不同供应商那里窗口可能不同，
          猜一个数会让界面上的上下文占用百分比**看着精确其实是错的**。
          留空时占用计量环整个隐藏（contextMeter 的硬规则：两个数缺一个就 hidden）。
        -->
        <label>
          <span data-link-field="contextWindowLabel"></span>
          <input data-link-field="contextWindow" type="number" min="0" step="1000" inputmode="numeric" autocomplete="off" />
          <span class="api-mode-hint" data-link-field="contextWindowHint"></span>
        </label>
        <div class="api-mode-hint" data-link-field="modeHint"></div>
      `;
      rowField(row, "presetLabel").textContent = localized("ui.settings.providerPreset", "服务商预设");
      rowField(row, "baseLabel").textContent = localized("ui.settings.apiAddress", "API 地址");
      rowField(row, "keyLabel").textContent = localized("ui.settings.apiKey", "API Key（存本机存档里；本地 Ollama 可留空）");
      rowField(row, "modelLabel").textContent = localized("ui.settings.modelName", "模型名");
      rowField(row, "model").placeholder = localized("ui.settings.modelPlaceholder", "点一下取列表 · 也可以直接填型号");
      rowField(row, "modelHint").textContent = localized("ui.settings.modelHintPick", "点这一格会去服务商那边取一次模型清单；型号也可以自己填。");
      row.querySelector('[data-link-action="models"]').textContent = localized("ui.settings.modelTakeList", "取列表");
      rowField(row, "contextWindowLabel").textContent = localized("ui.settings.contextWindow", "上下文窗口（token，留空 = 未知）");
      rowField(row, "contextWindow").placeholder = localized("ui.settings.contextWindowPlaceholder", "如 128000");
      rowField(row, "contextWindowHint").textContent = localized(
        "ui.settings.contextWindowHint",
        "留空则不显示上下文占用 —— 这个值模型 API 不返回，只能由你按所用模型填。"
      );
      /** 地址框的示例值也取自同一份预设表（免得那个 URL 在源码里出现第二次）。 */
      rowField(row, "base").placeholder = PROVIDER_PRESETS[0].base;
      for (const preset of PROVIDER_PRESETS) {
        const option = doc.createElement("option");
        option.value = preset.base;
        option.textContent = presetLabel(preset);
        rowField(row, "preset").appendChild(option);
      }
      row.querySelector('[data-link-action="up"]').textContent = localized("ui.settings.linkUp", "上移");
      row.querySelector('[data-link-action="down"]').textContent = localized("ui.settings.linkDown", "下移");
      row.querySelector('[data-link-action="probe"]').textContent = localized("ui.settings.linkProbe", "👁 探测");
      row.querySelector('[data-link-action="test"]').textContent = localized("ui.settings.linkTest", "测试");
      row.querySelector('[data-link-action="remove"]').textContent = localized("ui.settings.linkRemove", "删除");
      row.querySelector('[data-link-action="clearKey"]').textContent = localized("ui.settings.keyClear", "清除已保存 Key");
      row.querySelector('[data-link-action="probe"]').title = localized(
        "ui.settings.linkProbeTitle",
        "用一张 1×1 的图问服务商本人：这个模型吃不吃图。结论按（地址 + 模型）记进本机存档（👁 / 🚫）。"
      );
      row.querySelector('[data-link-action="test"]').title = localized(
        "ui.settings.linkTestTitle",
        "真发一次最小的请求：链路表从上到下各试一条，第一条通的算数。"
      );
      return row;
    }

    function ensureLinkRow(host, id) { return linkRowById(id) || (() => { const row = buildLinkRow(id); host.appendChild(row); return row; })(); }

    /**
     * 值只写"用户没在编辑的那个框"。
     *
     * 重画会在保存之后发生（保存的正是这些框里的值），所以正常情况下这次写入是空操作；
     * 真正要防的是**重画时把用户正在敲的半截地址/模型顶掉**。
     */
    function setRowValue(element, value) {
      if (!element || element === doc.activeElement) return;
      const next = str(value);
      if (element.value !== next) element.value = next;
    }

    /**
     * 这一行现在填的模型：**输入框里的字就是真值**（用户自己填的型号与从候选里挑的都在这儿），
     * 框里空着才回落到存下来的那一个。
     */
    function readLinkRowModel(row) {
      const 打的 = str(rowField(row, "model")?.value).trim();
      return 打的 || str(row.dataset.savedModel);
    }

    function readLinkRow(row) {
      return {
        id: str(row.dataset.linkId),
        label: str(row.dataset.linkLabel),
        base: str(rowField(row, "base")?.value).replace(/\/+$/, ""),
        model: readLinkRowModel(row),
        typedKey: str(rowField(row, "key")?.value),
        keyConfigured: row.dataset.keyConfigured === "true",
        clearKey: row.dataset.clearKey === "true",
      };
    }

    /**
     * 界面上的链路表 → `setSettings({ links })` 要的那份数组。
     *
     * 顺序取 DOM 顺序；Key 只在用户输入时出现（输入框有值 → `key`；
     * 点过「清除已保存 Key」→ `clearKey: true`）；`label` 原样带回去。
     */
    function linkTableFromView() {
      const host = $("#linkList");
      if (!host) return null;
      return linkRows().map(row => {
        const entry = { id: str(row.dataset.linkId), label: str(row.dataset.linkLabel), base: str(rowField(row, "base")?.value).replace(/\/+$/, ""), model: readLinkRowModel(row) };
        /**
         * **上下文窗口**：留空 → 0（未知）。
         *
         * 必须**每行都带上**（哪怕是 0）：链路保存是**整份替换**，
         * 界面上没带的字段会在往返里丢掉 —— 那正是"填了又变回未知"的成因。
         * `Math.max(0, …)` 兜住负号与 `NaN`。
         */
        entry.contextWindow = Math.max(0, Math.round(Number(rowField(row, "contextWindow")?.value) || 0));
        const typed = str(rowField(row, "key")?.value);
        if (typed) entry.key = typed;
        else if (row.dataset.clearKey === "true") entry.clearKey = true;
        return entry;
      });
    }

    /**
     * 保存链路表（增删 / 上移下移 / 改地址 / 改模型 / 改 Key 全走这里）。
     *
     * 存下去之后立刻清空密码框（密钥已进本机存档，界面不再持有它），
     * 并把"这一行存没存过 Key"从回执里刷回行上 —— 不重画也要说真话。
     */
    function saveLinkTable(options = {}) {
      const links = linkTableFromView();
      if (!links) return null;
      linkTableDirty = false;
      const result = assistant?.setSettings?.({ links });
      if (result !== undefined && result !== null) {
        const 回的 = Array.isArray(result?.links) ? result.links : [];
        for (const row of linkRows()) {
          const key = rowField(row, "key");
          if (key && key !== doc.activeElement) key.value = "";
          delete row.dataset.clearKey;
          const 一 = 回的.find(item => str(item.id) === str(row.dataset.linkId));
          if (一) row.dataset.keyConfigured = 一.keyConfigured === true ? "true" : "false";
        }
        const status = $("#linkStatus");
        if (status) {
          const keys = 回的.filter(link => link.keyConfigured === true).length;
          status.textContent = formatText(localized("ui.settings.linkSummaryWithKeys", "已读取 {count} 条 API 配置（最多 {max} 条），{keys} 条已保存 Key；从上到下依次匹配。"), { count: 回的.length, max: MAX_LINKS, keys });
        }
      }
      if (options.render !== false) renderLinkList({ fetch: false });
      if (options.silent !== true) renderLinkBadges();
      return result;
    }

    /** 选项类（与链路无关的那些）—— 总时限、无进展时限与秒数。 */
    function saveApiOptions() {
      const s = settings();
      return assistant?.setSettings?.({
      });
    }

    /** 一个可选框的值只写"没在编辑"的元素（同 `setRowValue`，用于 checkbox）。 */
    function setChecked(element, value) {
      if (!element || element === doc.activeElement) return;
      const next = value === true;
      if (element.checked !== next) element.checked = next;
    }

    /** 预设下拉：地址与某个预设一致就选中它，否则落在"自定义…"上（不顶掉用户自己填的地址）。 */
    function syncLinkRowPreset(row, base) {
      const select = rowField(row, "preset");
      if (!select) return;
      const value = str(base);
      select.value = PROVIDER_PRESETS.some(preset => preset.base && preset.base === value) ? value : "";
    }

    /** 本地/远程提示 + Key 的状态行（与旧主 API 那套同一套判定，只是现在一行一份）。 */
    function syncLinkRowMode(row) {
      const base = str(rowField(row, "base")?.value).replace(/\/+$/, "");
      const local = isLocalApi(base);
      const hint = rowField(row, "modeHint");
      if (hint) {
        hint.className = "api-mode-hint " + (local ? "local" : "remote");
        hint.textContent = local
          ? localized("ui.settings.localModeHint", "本地模式：API Key 可留空，模型从本机服务读取。")
          : localized("ui.settings.remoteModeHint", "远程模式：选择厂商后自动读取可用模型。");
      }
      const key = rowField(row, "key");
      if (key) key.placeholder = local
        ? localized("ui.settings.localKeyPlaceholder", "本地模式可留空")
        : localized("ui.settings.remoteKeyPlaceholder", "输入 API Key");
      syncLinkRowKeyStatus(row);
    }

    function syncLinkRowKeyStatus(row) {
      const status = rowField(row, "keyStatus");
      if (!status) return;
      const typed = str(rowField(row, "key")?.value);
      const configured = row.dataset.keyConfigured === "true";
      const local = isLocalApi(str(rowField(row, "base")?.value));
      const clear = row.querySelector('[data-link-action="clearKey"]');
      if (clear) clear.disabled = !configured;
      status.className = "secret-status";
      status.textContent = typed
        ? localized("ui.settings.linkKeyPending", "失焦后写进本机存档（输入框随即清空）")
        : configured
          ? localized("ui.settings.linkKeySaved", "已保存 Key（住本机存档；界面拿不到它）")
          : local
            ? localized("ui.settings.localKeyEmpty", "本地模式：API Key 可留空")
            : localized("ui.settings.remoteKeyEmpty", "未填写 API Key");
    }

    /**
     * **行级图片能力徽标** —— 结论只有一个来源：服务商本人（`assistant.linkInfo()`）。
     *   `👁`  服务商收下过带图的请求，或它自己声明这个模型收图片输入
     *   `🚫`  服务商明确说这个模型不收图片，或声明里没有图片这一路
     *   `👁?` 还没有结论 —— **不猜**，点「👁 探测」现问一次
     *
     * **模型名字里带不带 `vision` 一个字都不算依据**：名字不是证据。
     */
    function linkInfoRows() {
      try { return assistant?.linkInfo?.() || []; } catch { return []; }
    }

    function linkBadgeView(images, reason, source) {
      const 谁说 = source === "探测" ? localized("ui.settings.badgeByProbe", "探测过") : source === "声明" ? localized("ui.settings.badgeByDeclare", "服务商声明的") : "";
      if (images === true) return { text: "👁", title: `${localized("ui.settings.badgeCanSee", "已证实能看图。")}${谁说 ? `（${谁说}）` : ""}${reason ? ` · ${reason}` : ""}` };
      if (images === false) return { text: "🚫", title: `${localized("ui.settings.badgeCannotSee", "已证实不能看图。")}${谁说 ? `（${谁说}）` : ""}${reason ? ` · ${reason}` : ""}` };
      return { text: "👁?", title: localized("ui.settings.badgeUnknown", "还不知道能不能看图：点「👁 探测」用一张 1×1 的图问服务商本人。") };
    }

    function renderLinkBadges() {
      const info = linkInfoRows();
      for (const row of linkRows()) {
        const badge = rowField(row, "badge");
        if (!badge) continue;
        const 填 = readLinkRow(row);
        /** 认（id · 地址 · 模型）三元：地址或模型刚改过还没存时，旧结论不适用于这一行。 */
        const 现 = info.find(一 => str(一?.id) === str(row.dataset.linkId)
          && str(一?.base) === 填.base && str(一?.model) === 填.model) || null;
        const view = linkBadgeView(现 ? 现.images : null, 现 ? str(现.imagesReason) : "", 现 ? str(现.imagesSource) : "");
        badge.textContent = view.text;
        badge.title = view.title;
        badge.setAttribute("aria-label", view.title);
      }
    }

    /**
     * 画整张表（设置页打开 / 保存之后 / 切语言时都会走）。
     *
     * 行节点**按 id 复用**（认 id 不认位置）：重排之后 DOM 顺序跟着数组走，
     * 但每一行的输入内容、正在进行的模型请求都还在自己身上，不会被"整块重建"清掉。
     */
    function renderLinkList(options = {}) {
      const host = $("#linkList");
      if (!host) return [];
      const links = Array.isArray(settings().links) ? settings().links : [];
      const storeState = settings().api存档状态;
      const status = $("#linkStatus");
      if (storeState?.ok !== true) {
        const code = str(storeState?.code, "API_STORE_READ");
        const reason = str(storeState?.reason, "没有读取到存档状态");
        host.replaceChildren();
        if (status) status.textContent = formatText(localized("ui.settings.linkStoreReadFailed", "链路配置读取失败（{code}）：{reason}。页面不会把它当成空配置；请检查本机存档文件。"), { code, reason });
        const add = $("#linkAdd");
        if (add) add.disabled = true;
        return [];
      }
      if (!links.length) {
        /** 一条都没有是**合法状态**（头一次进来就是这样）：说清怎么加一条，别把它说成故障。 */
        if (!host.querySelector(".link-empty")) {
          const empty = doc.createElement("div");
          empty.className = "hint link-empty";
          empty.textContent = localized("ui.settings.linkEmpty", "还没有链路。点「＋ 添加链路」新建一条：填地址与 Key，模型那一格点一下就能取回服务商提供的清单。");
          host.replaceChildren(empty);
        }
        const add = $("#linkAdd");
        if (add) add.disabled = false;
        if (status) status.textContent = localized("ui.settings.linkSummaryEmpty", "已读取 0 条 API 配置；尚未保存链路。");
        return [];
      }
      host.querySelector(".link-empty")?.remove();
      const seen = new Set();
      links.forEach((link, index) => {
        const id = str(link.id);
        const row = ensureLinkRow(host, id);
        seen.add(id);
        row.dataset.linkLabel = str(link.label);
        row.dataset.keyConfigured = link.keyConfigured === true ? "true" : "false";
        row.dataset.savedModel = str(link.model);
        rowField(row, "index").textContent = String(index + 1);
        setRowValue(rowField(row, "base"), link.base);
        /** 模型那一格也是"用户没在编辑才回填"：正在敲的型号不许被重画顶掉。 */
        setRowValue(rowField(row, "model"), link.model);
        /**
         * **上下文窗口回填**：0（未知）时**留空**，不显示 "0" ——
         * 界面上应该是"没填"，而不是一个像真值的零。
         */
        const windowField = rowField(row, "contextWindow");
        if (windowField) setRowValue(windowField, Number(link.contextWindow) > 0 ? String(link.contextWindow) : "");
        syncLinkRowPreset(row, link.base);
        syncLinkRowMode(row);
        const up = row.querySelector('[data-link-action="up"]');
        const down = row.querySelector('[data-link-action="down"]');
        const remove = row.querySelector('[data-link-action="remove"]');
        if (up) up.disabled = index === 0;
        if (down) down.disabled = index === links.length - 1;
        /** 只剩一条时不许删：空表 = 所有 AI 调用都发不出去（`removeLinkRow` 里还有一道同样的闸）。 */
        if (remove) remove.disabled = links.length <= 1;
        populateLinkModels(row, options).then(() => 顺带探一探(row));
      });
      for (const row of linkRows()) if (!seen.has(str(row.dataset.linkId))) row.remove();
      links.forEach(link => { const row = linkRowById(link.id); if (row) host.appendChild(row); });
      const add = $("#linkAdd");
      if (add) add.disabled = links.length >= MAX_LINKS;
      /** 一句话交代"现在有几条、上限多少"—— 光看行数不知道还能不能加。 */
      if (status) {
        const keys = links.filter(link => link.keyConfigured === true).length;
        status.textContent = formatText(localized("ui.settings.linkSummaryWithKeys", "已读取 {count} 条 API 配置（最多 {max} 条），{keys} 条已保存 Key；从上到下依次匹配。"), { count: links.length, max: MAX_LINKS, keys });
      }
      renderLinkBadges();
      return links;
    }

    /** 新增一行：id 由界面生成（宿主按 id 合并，新 id 就是"新的一行"）。 */
    function addLinkRow() {
      const links = Array.isArray(settings().links) ? settings().links : [];
      if (links.length >= MAX_LINKS) return notify(localized("ui.settings.linkMax", "最多 8 条链路。"));
      const used = new Set(links.map(link => str(link.id)));
      let index = links.length + 1;
      while (used.has(`link-${index}`)) index += 1;
      const id = `link-${index}`;
      const row = buildLinkRow(id);
      row.dataset.linkLabel = "";
      row.dataset.keyConfigured = "false";
      row.dataset.savedModel = "";
      $("#linkList")?.appendChild(row);
      const saved = saveLinkTable();
      notify(localized("ui.settings.linkAdded", "已添加一条链路（放在最后：带图的请求会先试前面的）。"));
      return saved;
    }

    /**
     * 上移 / 下移：**重排数组**再保存 —— 顺序就是优先级，这就是这次操作的全部含义。
     * 先把界面上每行的值读下来（`linkTableFromView`），交换位置，再整表写回。
     */
    function moveLinkRow(id, delta) {
      const links = linkTableFromView();
      if (!links) return null;
      const index = links.findIndex(item => str(item.id) === str(id));
      const target = index + delta;
      if (index < 0 || target < 0 || target >= links.length) return null;
      const [row] = links.splice(index, 1);
      links.splice(target, 0, row);
      linkTableDirty = false;
      const result = assistant?.setSettings?.({ links });
      renderLinkList({ fetch: false });
      return result;
    }

    /**
     * 删除一行：数组里没有它的 id，宿主就把那行（连同它的密钥）删掉。
     * 只剩一条时拒绝（按钮也灰着，见 `renderLinkList`）—— 链路表不允许空，
     * 空表 = 所有 AI 调用都发不出去，而用户会以为是"程序坏了"。
     */
    function removeLinkRow(id) {
      const links = linkTableFromView();
      if (!links || links.length <= 1) {
        notify(localized("ui.settings.linkKeepOne", "至少要保留一条链路（否则所有 AI 调用都发不出去）。"));
        return null;
      }
      const next = links.filter(item => str(item.id) !== str(id));
      linkTableDirty = false;
      const result = assistant?.setSettings?.({ links: next });
      renderLinkList({ fetch: false });
      return result;
    }

    /** 自动探过的那几对（地址 · 模型）：同一对不重复问。 */
    const 探过的 = new Set();

    /**
     * 问一次服务商：这个模型吃不吃图（`assistant.probeImages` → 一张 1×1 的图）。
     *
     * @param {object} row
     * @param {boolean} 出声 用户按的「👁 探测」→ 结果用吐司说出来；顺手那一次不吵人
     * @returns {Promise<object|null>} 探测的回执（没探成给 null）
     */
    async function 探一行(row, 出声) {
      const target = readLinkRow(row);
      const 名 = target.model || target.base || localized("ui.settings.linkUnnamed", "这条链路");
      if (!target.base || !target.model) {
        if (出声) notify(localized("ui.settings.linkProbeNeedFields", "请先把地址和模型填全，再探测。"));
        return null;
      }
      const 键 = `${target.base}|${target.model}`;
      if (!出声 && 探过的.has(键)) return null;
      探过的.add(键);
      if (出声) notify(localized("ui.settings.linkProbeRunning", "正在用一张 1×1 的图问服务商本人…"));
      try {
        const result = await assistant?.probeImages?.({ id: target.id, base: target.base, model: target.model });
        renderLinkBadges();
        if (!result) {
          if (出声) notify(localized("ui.settings.linkProbeUnavailable", "探测没有回执（这一侧没接上 probeImages）。"));
          return null;
        }
        if (result.ok === false) {
          if (出声) notify(formatText(localized("ui.settings.linkProbeFailed", "探测没能得出结论：{reason}（能力保持未知）"), { reason: str(result.error?.message || result.error, "未知错误") }));
          return null;
        }
        if (!出声) return result;
        if (result.images === true) {
          notify(formatText(localized("ui.settings.linkProbeYes", "{name} 收得下图片输入（👁）。"), { name: 名 }));
          return result;
        }
        if (result.images === false) {
          notify(formatText(localized("ui.settings.linkProbeNo", "{name} 不收图片输入（🚫）。{reason}"), { name: 名, reason: str(result.reason) }));
          return result;
        }
        notify(formatText(localized("ui.settings.linkProbeUnknown", "服务商没给结论：{reason}（能力保持未知，点「👁 探测」可以再问一次）"), { reason: str(result.reason, "它没说什么") }));
        return result;
      } catch (error) {
        renderLinkBadges();
        if (出声) notify(error?.message || String(error));
        return null;
      }
    }

    /**
     * 表里没有结论的那些，顺手问一次（`探一行` 的安静版）。
     *
     * 有结论的不再问；服务商没给结论的也不纠缠 —— 要再问一次就按「👁 探测」。
     */
    function 顺带探一探(row) {
      const 填 = readLinkRow(row);
      if (!填.base || !填.model) return null;
      const 现 = linkInfoRows().find(一 => str(一?.id) === str(填.id) && str(一?.base) === 填.base && str(一?.model) === 填.model);
      if (现 && typeof 现.images === "boolean") return null;
      return 探一行(row, false);
    }

    /**
     * 「👁 探测」那个钮：先把这一行存下来（宿主按 id 找它存着的钥匙），再问一次。
     */
    async function probeLinkRow(id) {
      const row = linkRowById(id);
      if (!row) return null;
      if (!readLinkRow(row).base || !readLinkRow(row).model) {
        notify(localized("ui.settings.linkProbeNeedFields", "请先把地址和模型填全，再探测。"));
        return null;
      }
      saveLinkTable({ render: false });
      return 探一行(row, true);
    }

    /**
     * 「测试」：链路表从上到下各发一次最小请求，第一条通的算数。
     * 要只问某一行，用「👁 探测」。
     */
    async function testLinkRow(id) {
      const row = linkRowById(id);
      if (!row) return null;
      saveLinkTable({ render: false });
      try {
        const result = await assistant?.testConnection?.();
        if (!result || result.ok === false) {
          throw new Error(str(result?.error?.message || result?.text || result?.error, localized("ui.settings.linkTestFailed", "链路测试失败")));
        }
        const link = result.link || result.data?.link || null;
        const name = link ? str(link.label || link.model, "链路") : localized("ui.settings.linkUnnamed", "这条链路");
        return notify(formatText(localized("ui.settings.linkTestOk", "请求成功：这次实际走的是「{name}」（链路从上到下试）。"), { name }));
      } catch (error) {
        return notify(str(error?.message, localized("ui.settings.linkTestFailed", "链路测试失败")));
      }
    }

    /**
     * 设置页打开 / 保存之后 —— 按**当前快照**把界面重画一遍。
     *
     * API 这一块现在只剩两件事：链路表（`renderLinkList`）+ 与 API 无关的超时开关。
     * ComfyUI 那一套不在这里（它在自己那个标签页，见 `views.comfy`）。
     */
    function loadSettings(options = {}) {
      linkTableDirty = false;
      const s = settings();
      views.settings?.render(s);
      syncGenerationControls();
      /** 存档路径如实写出来（宿主报的那一个，界面不拼第二份）。 */
      const 存档 = $("#linkStorePath");
      if (存档) 存档.textContent = str(s.api存档, "（这一侧没报路径）");
      renderLinkList(options);
      if ($("#aiStrict")) setChecked($("#aiStrict"), s.strict !== false);
      /** 超时控件读的是 `limits.primaryTimeoutMs`（核心唯一认的那份）。 */
      if (options.capabilities !== false) refreshCapabilitiesStatus({ force: true });
    }
    function isLocalApi(base) {
      return /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/v1)?$/i.test(String(base || "").replace(/\/+$/, ""));
    }
    function refreshAgentStatus() { put("#agentStatus", "固定工具就绪"); }
    /**
     * 模型列表一律联网现取（`assistant.listModels({ base, key })` 用界面上当前填的地址与密钥）。
     * 拉取失败时只保留用户已选的那个模型。
     *
     * 缓存 60 秒，键含 base（`modelCacheKey` 的第一段），所以换服务商就是一次新请求；
     * 缓存里同时存 `rows`（含平台声明的 `images`）。
     */
    const MODEL_CACHE_MS = 60000;
    const modelListCache = new Map();
    /** 密钥只留"长度 + 末 4 位"进缓存键：够区分，又不至于把明文密钥散在内存里。 */
    function secretToken(value) { const text = str(value); return text ? `${text.length}:${text.slice(-4)}` : ""; }
    function modelCacheKey(base, token) { return `${String(base || "").replace(/\/+$/, "")}|${str(token)}`; }
    function cachedModelRows(base, token, allowCache) {
      if (!allowCache) return null;
      const hit = modelListCache.get(modelCacheKey(base, token));
      if (hit && Date.now() - hit.at < MODEL_CACHE_MS) return hit.rows;
      return null;
    }
    function rememberModelRows(base, token, rows) {
      if (!Array.isArray(rows) || !rows.length) return;
      modelListCache.set(modelCacheKey(base, token), { at: Date.now(), rows });
      if (modelListCache.size > 24) {
        const oldest = [...modelListCache.entries()].sort((left, right) => left[1].at - right[1].at)[0];
        if (oldest) modelListCache.delete(oldest[0]);
      }
    }
    /**
     * 把服务商给的候选画进这一行下面那块（`rows[].images` → 👁 / 🚫 / ·）。
     *
     * **候选里只有这家真的提供的模型**：清单就是上一次从服务商那儿取回来的那份。
     * 被记成"不能看图"（🚫）的照旧列出来 —— 它是个能用的模型，只是带图的请求轮不到它。
     *
     * @param {object} row
     * @param {Array<{name:string, images:boolean|null, note?:string}>} rows
     * @param {boolean} 开着 画完要不要摊开（不摊开就原样收着）
     */
    function paintLinkModelList(row, rows, 开着 = false) {
      const 盒 = rowField(row, "modelList");
      if (!盒) return [];
      const 表 = Array.isArray(rows) ? rows : [];
      const 现在的 = readLinkRowModel(row);
      盒.replaceChildren();
      const 名字们 = [];
      for (const 一 of 表) {
        const 名 = str(一?.name);
        if (!名 || 名字们.includes(名)) continue;
        名字们.push(名);
        const 钮 = doc.createElement("button");
        钮.type = "button";
        钮.className = `link-model-item${名 === 现在的 ? " on" : ""}`;
        钮.dataset.model = 名;
        if (一.note) 钮.title = str(一.note);
        const 标 = doc.createElement("span");
        标.className = "mark";
        标.textContent = 一.images === true ? "👁" : 一.images === false ? "🚫" : "·";
        标.title = 一.images === true ? localized("ui.settings.modelOptionImages", "服务商说这个模型收图片输入")
          : 一.images === false ? localized("ui.settings.modelOptionNoImages", "服务商说这个模型不收图片输入")
            : localized("ui.settings.modelOptionUnknown", "服务商没声明图片能力：吃不吃图由「👁 探测」问一次");
        const 字 = doc.createElement("span");
        字.className = "name";
        字.textContent = 名;
        钮.append(标, 字);
        盒.appendChild(钮);
      }
      if (!名字们.length) {
        const 空 = doc.createElement("div");
        空.className = "link-model-empty";
        空.textContent = localized("ui.settings.modelListEmpty", "这家还没给出模型清单；型号也可以自己填。");
        盒.appendChild(空);
      }
      盒.hidden = !开着;
      return 名字们;
    }

    /** 这一行的提示行：正在取 / 取回来几个 / 为什么没取到。 */
    function 说模型清单(row, 话, 类 = "") {
      const 提示 = rowField(row, "modelHint");
      if (!提示) return;
      const 类名 = `api-mode-hint ${类}`.trim();
      if (提示.textContent === 话 && 提示.className === 类名) return;
      提示.className = 类名;
      提示.textContent = 话;
    }

    /** 候选那一块：摊开 / 收着。 */
    function 开候选(row) { const 盒 = rowField(row, "modelList"); if (盒) 盒.hidden = false; }
    function 收候选(row) { const 盒 = rowField(row, "modelList"); if (盒) 盒.hidden = true; }
    /** 一次只摊开一行。 */
    function 只留这一行(row) { for (const 一 of linkRows()) if (一 !== row) 收候选(一); }

    /**
     * 这一行的模型候选 —— 现去服务商那边取（可用 60 秒缓存）。
     *
     * 取回来的清单**只进那一块候选**，不碰输入框里已经有的字：用户自己填的型号始终算数。
     * 取不到时如实写在提示行上，输入框照旧可用。
     *
     * @param {object} row
     * @param {{refresh?:boolean, fetch?:boolean, 开?:boolean}} [options]
     */
    async function populateLinkModels(row, options = {}) {
      const 框 = rowField(row, "model");
      if (!框) return [];
      const base = str(rowField(row, "base")?.value).replace(/\/+$/, "");
      const typedKey = str(rowField(row, "key")?.value);
      const 行号 = str(row.dataset.linkId);
      const requestId = (linkModelRequests.get(行号) || 0) + 1;
      linkModelRequests.set(行号, requestId);
      const 开着 = options.开 === true || rowField(row, "modelList")?.hidden === false;
      const token = typedKey ? secretToken(typedKey) : row.dataset.keyConfigured === "true" ? "saved" : "none";
      const cached = cachedModelRows(base, token, options.refresh !== true);
      if (cached) {
        说模型清单(row, formatText(localized("ui.settings.modelHintGot", "候选 {count} 个（服务商提供）；型号也可以自己填。"), { count: cached.length }));
        return paintLinkModelList(row, cached, 开着);
      }
      if (options.fetch === false || !base) return paintLinkModelList(row, [], 开着);
      说模型清单(row, localized("ui.settings.modelsLoading", "正在去服务商那边取模型清单…"));
      /**
       * 每一行都带上**自己的 id**：密钥永不下发到界面，所以由宿主按 id 配
       * "这条链路自己存着的那把钥匙"（`listModels({ id, base })`）。
       *
       * 三种形态各说各话：
       *   · 用户刚敲进输入框的钥匙 → 优先用它；
       *   · 本地地址 → **显式传空串**（本地服务不需要钥匙，且别回落成别的链路的）；
       *   · 其余（用着已保存的钥匙）→ 只报 id，钥匙由宿主配。
       */
      const local = isLocalApi(base);
      const params = { id: 行号, base, ...(typedKey ? { key: typedKey } : local ? { key: "" } : {}) };
      let result = null;
      try {
        result = await assistant?.listModels?.(params);
      } catch (error) {
        result = { ok: false, error: { message: error?.message || String(error) } };
      }
      if (linkModelRequests.get(行号) !== requestId) return [];
      const rows = result?.ok && Array.isArray(result.rows) && result.rows.length ? result.rows : null;
      if (rows) {
        rememberModelRows(base, token, rows);
        说模型清单(row, formatText(localized("ui.settings.modelHintGot", "候选 {count} 个（服务商提供）；型号也可以自己填。"), { count: rows.length }));
      } else {
        说模型清单(row, `${localized("ui.settings.modelFetchFailedKeep", "未能拉取模型列表（已保留当前模型，可手动填写）：")}${str(result?.error?.message || result?.error)}`, "local");
      }
      return paintLinkModelList(row, rows || [], 开着);
    }

    /** 每行一个请求号：重画/重排之后，迟到的响应不许回填到已经变了的那一行。 */
    const linkModelRequests = new Map();

    /**
     * **点模型那一格 = 摊开候选，顺带现去服务商那边取一次**（面板是动态生成的，监听挂在 `#linkList` 上做委托）。
     *
     * 这一格不用浏览器原生的 `<datalist>`：那一份弹出的时机不在我们手上，而候选是**异步**取回来的 ——
     * 取回来那一刻重画一次，原生弹出就被顶掉，用户点开又看着它消失。
     * 现在候选是自己画的一块：摊开 / 收着都由这里说了算，重画也不会把它关掉。
     */
    const refreshModelsOnOpen = event => {
      const 格 = event?.target?.closest?.('[data-link-field="model"]');
      const row = 格?.closest?.("[data-link-row]");
      if (!row) return;
      只留这一行(row);
      const 盒 = rowField(row, "modelList");
      const 已经有 = Boolean(盒 && 盒.querySelector("[data-model]"));
      if (已经有) { 开候选(row); populateLinkModels(row, { refresh: true, 开: true }); return; }
      populateLinkModels(row, { refresh: true, 开: true });
    };

    /** 「取列表」那个钮：不管有没有取过，都摊开并现取一次。 */
    function 取列表(row) {
      只留这一行(row);
      const 盒 = rowField(row, "modelList");
      if (盒 && !盒.querySelector("[data-model]")) 盒.replaceChildren();
      开候选(row);
      return populateLinkModels(row, { refresh: true, 开: true });
    }

    /** 点中一条候选：写进输入框，按"改完了"存一次（与手打一个型号走同一条路）。 */
    function 选模型(row, 名) {
      const 框 = rowField(row, "model");
      if (!框 || !名) return null;
      框.value = 名;
      row.dataset.savedModel = 名;
      框.dispatchEvent(new Event("change", { bubbles: true }));
      return 名;
    }

    /** 点别处 / 按 Esc：把摊开的那一块收起来。 */
    function 收候选OnOutside(event) {
      if (event?.type === "keydown") {
        if (event.key !== "Escape") return;
        for (const row of linkRows()) 收候选(row);
        return;
      }
      const 点在哪 = event?.target;
      for (const row of linkRows()) {
        if (rowField(row, "modelList")?.hidden !== false) continue;
        if (点在哪 && row.contains(点在哪)) continue;
        收候选(row);
      }
    }

    function currentVisionImage() {
      const current = visionTempStore?.current?.();
      if (!imageApp) {
        const id = current?.tempId || current?.imageId;
        return { ...(visionTempStore?.get?.(id) || {}), ...(imageStore?.preview?.(id) || images?.preview?.(id) || {}), ...(current || {}) };
      }
      return current?.ref ? withPreview(current, 'thumbnail') : null;
    }
    function withPreview(item, variant = 'thumbnail') {
      const preview = imageApp?.preview({ ref: item.ref, variant });
      return { ...item, imageId: item.imageId || item.ref.entryId, dataUrl: preview?.ok ? preview.data.url : '', thumbnailDataUrl: preview?.ok ? preview.data.url : '' };
    }
    function imageResult(result) {
      if (!result || result.ok === false) throw new Error(result?.error?.message || result?.error || '图片操作失败');
      return result.data;
    }
    async function imageWrite(key, operation) {
      if (imageWrites.has(key)) return null;
      imageWrites.add(key);
      try { return await operation(); } catch (error) { notify(error.message || String(error)); return null; }
      finally { imageWrites.delete(key); }
    }
    async function processSelectedVision(_name, input) {
      if (!imageApp) return runtime?.callTool?.('vision.processOne', input, { caller: 'ui', sessionId: currentTalkSessionId(), requestId: ui.visionRequestId }) || { ok: true, data: visionTempStore?.get?.(input.imageId)?.analysis || visionTempStore?.get?.(input.imageId)?.metadata || {} };
      const current = visionTempStore?.current?.();
      if (!current?.ref || current.ref.entryId !== input.imageId) return { ok: false, error: '原图片已不可用' };
      // 「停止」只告诉容器"停第 N 次"：控制器在容器那侧，`ui.visionAbort` 只用于界面状态。
      return assistant?.visionService?.processOne({ ...input, ref: current.ref }, { requestId: ui.visionRequestId, sessionId: currentTalkSessionId() });
    }
    async function selectVisionImage(item) {
      if (!imageApp) {
        const id = str(item?.imageId || item?.id);
        const active = visionTempStore?.setConversationReference?.(id, { sessionId: currentTalkSessionId(), refId: item?.refId });
        if (active) { clearVisionResult(); renderVisionPreview(); renderTalkVisionPanel(); setVisionOpen(true); }
        return active;
      }
      return imageWrite('vision-selection', async () => {
        cancelVisionRequest(true);
        const result = imageResult(await visionTempStore.setReference({ ref: item.ref }));
        clearVisionResult(); renderVisionPreview(); renderTalkVisionPanel(); setVisionOpen(true);
        const requestId = ++ui.visionRequestId;
        const controller = new AbortController(); ui.visionAbort = controller;
        await loadVisionMetadata(result.ref.entryId, requestId, controller);
        return result;
      });
    }
    function currentVisionId() { const current = visionTempStore?.current?.(); return str(current?.ref?.entryId || current?.tempId || current?.imageId); }
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
    function conversationImageMarkerSignature(session) {
      const turn = session?.turns?.at?.(-1);
      const messages = (session?.messages || []).filter(message => message.turnId === turn?.id);
      const ids = [];
      const add = value => {
        if (Array.isArray(value)) { value.forEach(add); return; }
        if (!value || typeof value !== 'object') return;
        if (value.type === 'session-image' && value.imageId) ids.push(String(value.imageId));
        for (const child of Object.values(value)) add(child);
      };
      for (const message of messages) {
        for (const part of message.parts || []) if (part?.imageId) ids.push(String(part.imageId));
        for (const call of message.toolCalls || []) add(call.result);
      }
      return `${str(session?.id)}\u0000${ids.join('\u0000')}`;
    }
    let conversationRepositoryRevision = 0;
    let conversationImageMarkerSnapshot = '';
    let sessionImageNumberSession = '';
    let sessionImageNumbers = new Map();
    let conversationImageRowsSession = '';
    let conversationImageRows = [];
    async function conversationRows(sessionId = currentTalkSessionId()) {
      if (!imageApp) return sessionId ? (imageRepository?.listConversation?.(sessionId)?.items || []) : [];
      const result = sessionId && await assistant?.listSessionImages?.({ sessionId });
      if (result?.ok === false) notify(result.error.message);
      return result?.data?.items || [];
    }
    /**
     * 登记一份草稿图的**元数据**并放进待发列表。
     *
     * ⚠️ 这是宿主侧唯一的"新增草稿图"入口。`ui.sendDrafts` 本身只是状态层权威的
     * 投影，但元数据（filename / refId / sessionId）只有这里知道，所以建草稿时
     * 顺手登记进 `ui.pendingDrafts`，投影按 id 复原时才有东西可取。
     *
     * @param {object} draft 至少带 `imageId`
     */
    function rememberPendingDraft(draft) {
      if (draft?.sessionId && draft.sessionId !== currentTalkSessionId()) return;
      const imageId = String(draft?.imageId || '');
      if (!imageId) return;
      const record = { ...draft, imageId };
      ui.pendingDrafts.set(imageId, record);
      if (!ui.sendDrafts.some(row => row.imageId === imageId)) ui.sendDrafts.push(record);
    }
    /**
     * **把宿主待发列表重建成状态层给的 id 列表**（挂载层投影时调）。
     * 语义与幂等判定见 `ctx.replaceDrafts` 的注释 —— 这里只做实现。
     * @param {ReadonlyArray<string>} ids 权威当前的附件 id（顺序照它）
     */
    function replaceDrafts(ids) {
      const next = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean);
      const current = ui.sendDrafts.map(draft => String(draft.imageId));
      if (next.length === current.length && next.every((id, index) => id === current[index])) return;
      ui.sendDrafts = next.map(imageId => ui.pendingDrafts.get(imageId) || { imageId, sessionId: currentTalkSessionId() });
      ui.conversationSelectionSnapshot = ui.conversationSelectionSnapshot
        .filter(draft => next.includes(String(draft.imageId)));
      renderPendingImageStrip();
      renderConversationRepository();
    }
    function renderPendingImageStrip() {
      const strip = $("#talkPendingStrip");
      const host = $("#talkImgRow");
      if (!strip || !host) return;
      const drafts = ui.sendDrafts.slice();
      host.replaceChildren();
      strip.style.display = drafts.length ? "" : "none";
      const clearBtn = $("#talkPendingClear");
      if (clearBtn) clearBtn.style.display = drafts.length ? "" : "none";
      drafts.forEach((draft, index) => {
        const asset = fullImageFor(draft.imageId) || {};
        const wrap = doc.createElement("div");
        wrap.className = "pending-image-card";
        wrap.dataset.imageId = draft.imageId;
        wrap.innerHTML = '<img loading="lazy" decoding="async" alt=""><span class="imgnum"></span><button type="button" class="imgdel" title="从发送区移除">✕</button>';
        $(".imgdel", wrap).title = localized("ui.ai.removePendingImage", "从发送区移除");
        $("img", wrap).src = asset.thumbnailDataUrl || asset.dataUrl || "";
        const resolved = assistant.resolveSessionImage({sessionId:currentTalkSessionId(),imageId:draft.imageId});
        const missing = draft.imageId.startsWith('missing:') ? assistant.getDraft().filter(p=>p.type==='image')[Number(draft.imageId.slice(8))]?.missing?.reason : resolved?.error?.message;
        if(missing) { wrap.title=missing; const note=doc.createElement('span');note.textContent=missing;wrap.append(note); }
        $("img", wrap).alt = missing || draft.filename || "图片";
        const 图号 = asset.slotNo || draft.slotNo || (sessionImageNumberSession === currentTalkSessionId() ? sessionImageNumbers.get(String(draft.imageId)) : null);
        $(".imgnum", wrap).textContent = 图号 ? String(图号) : '';
        $(".imgdel", wrap).onclick = event => { event.stopPropagation(); ui.sendDrafts.splice(index, 1); renderPendingImageStrip(); renderConversationRepository(); };
        host.appendChild(wrap);
      });
    }
    function inSendDraft(imageId) {
      return ui.sendDrafts.some(draft => draft.imageId === imageId);
    }
    async function renderConversationRepository() {
      const host = $("#talkImageRepository");
      if (!host) return;
      const sessionId = currentTalkSessionId();
      const revision = ++conversationRepositoryRevision;
      const rows = await conversationRows(sessionId);
      if (revision !== conversationRepositoryRevision || sessionId !== currentTalkSessionId()) return;
      conversationImageRowsSession = sessionId;
      conversationImageRows = rows;
      sessionImageNumberSession = sessionId;
      sessionImageNumbers = new Map(rows.map(item => [String(item.imageId), Number(item.slotNo) || null]));
      host.dataset.columns = preferences.get("conversation.columns", "two") === "single" ? "single" : "two";
      const count = $("#talkImageRepositoryCount");
      if (count) count.textContent = formatText(localized("ui.ai.pendingImages", "对话图片 {count} 张 / 待发送 {pending} 张"), { count: rows.length, pending: ui.sendDrafts.length });
      host.replaceChildren();
      if (!rows.length) { const empty = doc.createElement("div"); empty.className = "repo-empty"; empty.textContent = localized("ui.ai.repositoryEmpty", "No conversation images"); host.appendChild(empty); renderPendingImageStrip(); return; }
      rows.forEach(item => {
        const asset = fullImageFor(item.imageId) || {};
        const card = doc.createElement("article");
        card.className = "conversation-image-card";
        card.dataset.refId = item.refId;
        card.dataset.imageId = str(item.imageId);
        // 默认不允许拖动；仅识图模式下允许拖动"单张"图片到右侧识图区。
        card.draggable = ui.visionOpen === true;
        const inSend = inSendDraft(item.imageId);
        if (inSend) card.classList.add("is-pending");
        if (item.selected) card.classList.add("is-selected");
        card.innerHTML = '<img class="conversation-image-thumb" loading="lazy" decoding="async" alt=""><div class="conversation-image-meta"><strong class="conversation-image-slot"></strong><span class="conversation-image-title"></span><span class="conversation-image-source"></span><span class="conversation-image-candidate"></span></div><button type="button" class="conversation-image-delete" title="从对话区移除" aria-label="从对话区移除">✕</button>';
        const slotLabel = formatText(localized("ui.ai.imageSlot", "Image {slot}"), { slot: item.slotNo });
        const img = $(".conversation-image-thumb", card); img.src = asset.thumbnailDataUrl || asset.dataUrl || ""; img.alt = item.displayTitle || slotLabel;
        $(".conversation-image-delete", card).title = localized("ui.ai.removeConversationImage", "Remove from conversation");
        $(".conversation-image-slot", card).textContent = slotLabel;
        $(".conversation-image-title", card).textContent = item.displayTitle || asset.displayName || asset.filename || localized("ui.ai.imageFallback", "Image");
        $(".conversation-image-source", card).textContent = localized(`ui.ai.source.${item.source || "upload"}`, item.source || localized("ui.ai.source.upload", "Upload"));
        $(".conversation-image-candidate", card).textContent = item.candidateId ? `${localized("ui.ai.candidate", "Candidate")} ${item.candidateId}` : (inSend ? localized("ui.ai.pending", "待发送") : item.sent ? localized("ui.ai.sent", "Sent") : "");
        card.tabIndex = 0;
        card.setAttribute("role", "button");
        card.setAttribute("aria-pressed", inSend ? "true" : "false");
        card.setAttribute("aria-label", `${item.displayTitle || asset.displayName || asset.filename || item.imageId} · ${inSend ? localized("ui.ai.pending", "待发送") : localized("ui.ai.notPending", "点击加入发送区")}`);
        // 识图模式下锁定多选（点击不切换"加入发送区"）
        const toggleSend = event => { if (ui.visionSelectLock) return; if (event?.target?.closest?.("button")) return; const index = ui.sendDrafts.findIndex(draft => draft.imageId === item.imageId); if (index >= 0) ui.sendDrafts.splice(index, 1); else ui.sendDrafts.push({ imageId: item.imageId, refId: item.refId, sessionId: currentTalkSessionId() }); renderConversationRepository(); };
        card.addEventListener("click", toggleSend);
        card.addEventListener("keydown", event => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleSend(event); return; }
          /** `O` = open，给键盘用户的"看大图"。 */
          if (event.key === "o" || event.key === "O") { event.preventDefault(); openConversationImageViewer(item, asset); }
        });
        // 缩略图点开大图，并阻止冒泡（免得同时触发"加入发送区"）。
        img.classList.add("is-zoomable");
        img.title = localized("ui.ai.viewLarge", "点击查看大图");
        img.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          openConversationImageViewer(item, asset);
        });
        $(".conversation-image-delete", card).onclick = event => {
          event.stopPropagation();
          const targetSession = sessionId;
          const imageId = String(item.imageId);
          confirm(localized('ui.ai.removeConversationImageConfirm', '确定从当前对话移除这张图片吗？'), async () => {
            void imageWrite('remove-' + targetSession + '-' + imageId, async () => {
              imageResult(await assistant.removeSessionImage({ sessionId: targetSession, imageId }));
              if (targetSession !== currentTalkSessionId()) return;
              invalidateImageCache();
              renderConversationRepository(); renderTalk();
            });
          }, { confirmLabel: localized('ui.ai.removeConversationImage', '移除'), cancelLabel: localized('ui.common.cancel', '取消') });
        };
        card.addEventListener("dragstart", event => { if (ui.visionOpen !== true) return; const payload = JSON.stringify({ sessionId: currentTalkSessionId(), refId: item.refId, imageId: item.imageId }); event.dataTransfer?.setData("application/x-ai-tag-conversation-ref", payload); event.dataTransfer?.setData("application/x-ai-tag-image-id", item.imageId); event.dataTransfer?.setData("text/plain", item.imageId); if (event.dataTransfer) { event.dataTransfer.effectAllowed = "copy"; void item; } });
        host.appendChild(card);
      });
      renderPendingImageStrip();
    }
    async function addConversationImages(files, send = true) {
      const sessionId = currentTalkSessionId();
      if (!sessionId) return 0;
      if (!imageApp) {
        let added = 0;
        for (const file of files || []) {
          if (!file?.type?.startsWith('image/')) continue;
          const item = imageStore?.add?.({ dataUrl: await readFile(file), filename: file.name, source: 'file' });
          if (item?.id && imageRepository?.attachToConversation?.(sessionId, item.id, { source: 'upload', pending: send })) { if (send) rememberPendingDraft({ imageId: item.id, filename: file.name, sessionId }); added++; }
        }
        renderConversationRepository(); return added;
      }
      return imageWrite('upload-session-' + sessionId, async () => {
        let added = 0;
        for (const file of files || []) {
          if (!file?.type?.startsWith('image/')) continue;
          const result = imageResult(await assistant.uploadSessionImage({ sessionId, dataUrl: await readFile(file), filename: file.name, mime: file.type, pending: send }));
          if (send && sessionId === currentTalkSessionId() && !inSendDraft(result.imageId)) rememberPendingDraft({ ...result, sessionId });
          added++;
        }
        if (sessionId === currentTalkSessionId()) renderConversationRepository();
        return added;
      });
    }
    function galleryPreferences() {
      const valid = {
        order: ["oldest", "newest"],
      };
      const order = valid.order.includes(preferences.get("gallery.order", "oldest")) ? preferences.get("gallery.order", "oldest") : "oldest";
      ui.galleryOrder = order;
      return { order };
    }
    function galleryRows() {
      if (!imageApp) return imageRepository?.listGallery?.({ order: ui.galleryOrder, query: ui.galleryQuery })?.items || [];
      const result = imageApp?.listGallery({ galleryId: 'main', order: ui.galleryOrder, query: ui.galleryQuery });
      if (result?.ok === false) notify(result.error.message);
      const rows = (result?.data?.items || []).map(item => ({ ...item, imageId: item.ref.entryId }));
      for (const item of rows) galleryRefs.set(item.imageId, item.ref);
      return rows;
    }
    function galleryDownloadItem(item) {
      if (!imageApp) {
        if (item?.dataUrl) {
          const link = doc.createElement('a'); link.href = URL.createObjectURL(new Blob([item.dataUrl], { type: item.mime || 'image/png' })); link.download = item.filename || `${item.imageId}.png`; link.click(); return;
        }
        const bytesPromise = imageRepository?.getOriginalBytes?.(item.imageId) || item.dataUrl || '';
        return Promise.resolve(bytesPromise).then(bytes => {
          const link = doc.createElement('a');
          link.href = bytes instanceof Uint8Array ? URL.createObjectURL(new Blob([bytes], { type: item.mime || 'image/png' })) : String(bytes);
          link.download = item.filename || `${item.imageId}.png`; link.click();
        });
      }
      if (!item?.ref) return;
      return imageWrite('download-' + item.imageId, async () => {
        const original = imageResult(imageApp.read({ ref: item.ref, variant: 'original' }));
        const link = doc.createElement('a');
        link.href = URL.createObjectURL(new Blob([original.bytes], { type: original.mime }));
        link.download = original.filename || item.filename; link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 800);
      });
    }

    /**
     * 多会话时问用户"存到哪个会话"。
     *
     * ⚠️ 用 `chooseDialog`：**直接列出对话名称让你点**，当前对话已经提前选中。
     *
     * 两个不能用别的做法的理由：
     *   · `global.prompt` 在 Electron 渲染进程里不存在（`typeof global.prompt ===
     *     "function" ? … : "1"` 这种写法会永远走兜底值，用户的选择根本没被问过）；
     *   · 只给「对话编号」不行：编号对不上会话，用户无法判断选的是哪一个。
     */
    async function chooseGallerySession() {
      const sessions = assistant?.sessions?.() || [];
      if (!sessions.length) return null;
      const current = assistant?.currentSession?.();
      if (sessions.length === 1) return current || sessions[0];
      const currentTag = galleryText("chooseSessionCurrent", "（当前）");
      const pickedId = await chooseDialog({
        title: localized("ui.gallery.chooseSessionTitle", "选择要保存到的对话"),
        label: localized("ui.gallery.chooseSessionLabel", "保存到哪个对话？"),
        value: str(current?.id),
        hint: localized("ui.gallery.chooseSessionHint", "点一下要保存到的那个对话，再点「确定」。当前对话已提前选中。"),
        requiredMessage: localized("ui.gallery.chooseSessionRequired", "请选择一个对话"),
        options: sessions.map(item => ({
          value: str(item?.id),
          /**
           * 显示**名称**。没有标题的会话给一句人话（`未命名对话`），
           * 而不是把内部 id 甩给用户看。
           */
          label: `${str(item?.title) || galleryText("chooseSessionUntitled", "未命名对话")}${item?.id === current?.id ? currentTag : ""}`
        }))
      });
      if (typeof pickedId !== "string" || !pickedId) return null;
      return sessions.find(item => str(item?.id) === pickedId) || null;
    }
    /**
     * 单选列表弹窗：每一项是一行名称（可带一行说明），点一下选中、再点「确定」；
     * 双击直接确定，Esc 取消。
     *
     * @param {{title:string, label?:string, hint?:string, value?:string,
     *          options:Array<{value:string,label:string,description?:string}>,
     *          confirmLabel?:string, cancelLabel?:string, requiredMessage?:string}} options
     * @returns {Promise<string|null>} 选中项的 `value`；取消 / Esc / 关窗给 `null`
     */
    function chooseDialog(options = {}) {
      const createDialog = global.AppViews?.tagLocation?.createDialogTools;
      if (typeof createDialog !== "function") return Promise.resolve(null);
      const entries = (Array.isArray(options.options) ? options.options : [])
        .map(item => ({ value: str(item?.value), label: str(item?.label) || str(item?.value), description: str(item?.description) }))
        .filter(item => item.value);
      if (!entries.length) return Promise.resolve(null);
      return new Promise(resolve => {
        let done = false;
        const dialog = createDialog(doc, "prompt", event => {
          if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); event.stopImmediatePropagation(); finish(null); }
        });
        dialog.panel.classList.add("gallery-rename-dialog");
        dialog.title.textContent = str(options.title, "请选择");
        const form = doc.createElement("form");
        form.className = "gallery-rename-form";
        const label = doc.createElement("label");
        label.textContent = str(options.label, options.title) || "请选择";
        const list = doc.createElement("div");
        list.className = "gallery-choose-list";
        list.setAttribute("role", "listbox");
        const hint = doc.createElement("p");
        hint.className = "gallery-rename-hint";
        hint.textContent = str(options.hint);
        const error = doc.createElement("p");
        error.setAttribute("role", "alert");
        const actions = doc.createElement("div");
        actions.className = "gallery-rename-actions";
        const cancel = doc.createElement("button");
        cancel.type = "button";
        cancel.textContent = str(options.cancelLabel, localized("ui.common.cancel", "取消"));
        cancel.onclick = () => finish(null);
        const confirm = doc.createElement("button");
        confirm.type = "submit";
        confirm.dataset.action = "save";
        confirm.textContent = str(options.confirmLabel, galleryText("chooseSessionConfirm", "确定"));
        actions.append(cancel, confirm);
        /** 预选项：调用方给的 `value` 命中哪一项就选它，否则选第一项。 */
        let picked = entries.some(item => item.value === str(options.value)) ? str(options.value) : entries[0].value;
        const rows = entries.map(entry => {
          const button = doc.createElement("button");
          button.type = "button";
          button.className = "gallery-choose-item";
          button.dataset.value = entry.value;
          button.setAttribute("role", "option");
          const name = doc.createElement("span");
          name.className = "gallery-choose-name";
          name.textContent = entry.label;
          button.append(name);
          if (entry.description) {
            const meta = doc.createElement("span");
            meta.className = "gallery-choose-meta";
            meta.textContent = entry.description;
            button.append(meta);
          }
          button.onclick = () => pick(entry.value);
          button.ondblclick = () => { pick(entry.value); finish(entry.value); };
          list.append(button);
          return { entry, button };
        });
        function pick(value) {
          picked = value;
          for (const row of rows) {
            const on = row.entry.value === value;
            row.button.classList.toggle("is-picked", on);
            row.button.setAttribute("aria-selected", on ? "true" : "false");
          }
        }
        function finish(value) {
          if (done) return;
          done = true;
          dialog.dispose();
          resolve(value);
        }
        form.addEventListener("submit", event => {
          event.preventDefault();
          if (!entries.some(item => item.value === picked)) { error.textContent = str(options.requiredMessage, "请选择一项"); return; }
          finish(picked);
        });
        form.append(label, list, hint, error, actions);
        dialog.panel.append(form);
        pick(picked);
        dialog.open();
        (rows.find(row => row.entry.value === picked) || rows[0]).button.focus();
      });
    }
    function updateGalleryToolbar(rows) {
      const count = ui.gallerySelected.size;
      const send = $("#gallerySend");
      const del = $("#galleryDelete");
      const download = $("#galleryDownload");
      if (send) {
        send.textContent = count > 1 ? `${galleryText("sendBatch", "批量发送")}(${count})` : galleryText("send", "发送到对话仓库");
        send.classList.toggle("is-batch", count > 1);
        send.disabled = count === 0;
      }
      if (del) {
        del.textContent = count > 1 ? `${galleryText("deleteBatch", "批量删除")}(${count})` : galleryText("delete", "删除");
        del.classList.toggle("is-batch", count > 1);
        del.disabled = count === 0;
      }
      if (download) download.disabled = count === 0;
    }
    async function gallerySendSelectedItems() {
      const rows = galleryRows().filter(item => ui.gallerySelected.has(item.imageId));
      if (!rows.length) return notify(galleryText('selectFirst', '请先选择图片'));
      const target = await chooseGallerySession(); if (!target) return;
      if (!imageApp) {
        let attached = 0;
        for (const item of rows) if (imageRepository?.attachToConversation?.(target.id, item.imageId, { source: 'gallery' })) attached++;
        ui.gallerySelected.clear(); renderGallery(); if (attached) { renderConversationRepository(); renderTalk(); }
        return attached;
      }
      return imageWrite('gallery-send', async () => {
        for (const item of rows) {
          imageResult(await assistant.uploadSessionImage({ sessionId: target.id, galleryRef: item.ref, pending: false }));
          ui.gallerySelected.delete(item.imageId);
        }
        renderGallery(); if (target.id === currentTalkSessionId()) { renderConversationRepository(); renderTalk(); }
        notify('已发送到对话区');
      });
    }
    async function galleryDeleteSelectedItems() {
      if (!imageApp) {
        const rows = galleryRows().filter(item => ui.gallerySelected.has(item.imageId));
        if (!rows.length) return notify(galleryText('selectFirst', '请先选择图片'));
        if (!await galleryConfirm(galleryText('deleteConfirm', '确定删除吗？'), galleryText('deleteGo', '删除'), galleryText('common.cancel', '取消'), true)) return;
        rows.forEach(item => imageRepository?.removeFromGallery?.(item.imageId, { purge: false, retain: true }));
        ui.gallerySelected.clear(); renderGallery(); return;
      }
      return imageWrite('gallery-delete', async () => {
        const rows = galleryRows().filter(item => ui.gallerySelected.has(item.imageId));
        if (!rows.length) return notify(galleryText('selectFirst', '请先选择图片'));
        if (!await galleryConfirm('将所选图片移入系统回收站？引用它的历史消息将显示图片不可用。', galleryText('deleteGo', '删除'), galleryText('common.cancel', '取消'), true)) return;
        for (const item of rows) {
          imageResult(await imageApp.remove({ ref: item.ref }));
          ui.gallerySelected.delete(item.imageId); galleryRefs.delete(item.imageId); renderGallery();
        }
        renderTalk(); renderConversationRepository();
      });
    }
    /** 没有 `imageApp` 时的图库重命名兜底：走 `promptDialog`（Electron 没有 `prompt`）。 */
    async function renameGalleryItemFallback(item) {
      const name = await promptDialog({
        title: galleryText("rename", "重命名"),
        label: galleryText("libraryName", "图库名称"),
        value: str(item.displayName || item.filename),
        confirmLabel: localized("ui.common.save", "保存"),
        requiredMessage: galleryText("nameRequired", "请输入图库名称")
      });
      if (typeof name !== "string" || !name.trim()) return null;
      const result = imageRepository?.renameGalleryImage?.(item.imageId, name.trim());
      renderGallery();
      return result ?? true;
    }
    let galleryRenameDialog = null;
    function openGalleryRename(item) {
      if (galleryRenameDialog) { galleryRenameDialog.focus(); return; }
      let saving = false;
      const createDialog = global.AppViews?.tagLocation?.createDialogTools;
      if (typeof createDialog !== "function") { notify(galleryText("renameFailed", "无法打开重命名窗口")); return; }
      const dialog = createDialog(doc, "gallery-rename", event => {
        if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); event.stopImmediatePropagation(); if (!saving) close(); }
      });
      galleryRenameDialog = dialog;
      dialog.panel.classList.add("gallery-rename-dialog");
      dialog.title.textContent = galleryText("rename", "重命名");
      const form = doc.createElement("form");
      form.className = "gallery-rename-form";
      const label = doc.createElement("label");
      label.textContent = galleryText("libraryName", "图库名称");
      const input = doc.createElement("input");
      input.type = "text";
      input.maxLength = 180;
      input.value = item.displayName || item.filename || "";
      label.append(input);
      const hint = doc.createElement("p");
      hint.className = "gallery-rename-hint";
      hint.textContent = `${galleryText("originalFilename", "原文件名")}：${item.filename || item.imageId}`;
      const error = doc.createElement("p");
      error.setAttribute("role", "alert");
      const actions = doc.createElement("div");
      actions.className = "gallery-rename-actions";
      const cancel = doc.createElement("button");
      cancel.type = "button";
      cancel.textContent = localized("ui.common.cancel", "取消");
      cancel.onclick = () => close();
      const save = doc.createElement("button");
      save.type = "submit";
      save.dataset.action = "save";
      save.textContent = localized("ui.common.save", "保存");
      actions.append(cancel, save);
      form.append(label, hint, error, actions);
      dialog.panel.append(form);
      function close() { dialog.dispose(); if (galleryRenameDialog === dialog) galleryRenameDialog = null; }
      form.addEventListener("submit", async event => {
        event.preventDefault();
        if (saving) return;
        const displayName = input.value.trim();
        if (!displayName) { error.textContent = galleryText("nameRequired", "请输入图库名称"); input.focus(); return; }
        saving = true;
        save.disabled = cancel.disabled = input.disabled = true;
        error.textContent = "";
        try {
          const result = imageApp ? await imageApp.rename({ ref: item.ref, displayName }) : imageRepository?.renameGalleryImage?.(item.imageId, displayName);
          if (!result || result.ok === false || (item.ref && !result.data)) throw new Error(result?.error?.message || galleryText("renameFailed", "重命名失败"));
          close();
          renderGallery();
          const renamedCard = $$("#galleryGrid .gallery-card").find(card => card.dataset.imageId === item.imageId);
          (renamedCard?.querySelector('[data-action="rename"]') || $("#galleryQuery"))?.focus();
        } catch (cause) {
          error.textContent = cause?.message || galleryText("renameFailed", "重命名失败");
        } finally {
          saving = false;
          save.disabled = cancel.disabled = input.disabled = false;
        }
      });
      dialog.open();
      input.focus();
      input.select();
    }
    function renderGallery() {
      const host = $("#galleryGrid");
      if (!host) return;
      if ($("#galleryOrder")) $("#galleryOrder").value = ui.galleryOrder;
      host.replaceChildren();
      const rows = galleryRows();
      put("#galleryCount", galleryText("count", `${rows.length} 张`, { count: rows.length }));
      const available = new Set(rows.map(item => item.imageId));
      ui.gallerySelected = new Set([...ui.gallerySelected].filter(id => available.has(id)));
      updateGalleryToolbar(rows);
      if (!rows.length) {
        const empty = doc.createElement("div"); empty.className = "gallery-empty"; empty.textContent = galleryText("empty", "图片库为空"); host.appendChild(empty); return;
      }
      rows.forEach(item => {
        const card = doc.createElement("article");
        card.className = "gallery-card";
        card.dataset.imageId = item.imageId;
        card.tabIndex = 0;
        card.setAttribute("role", "button");
        card.setAttribute("aria-pressed", String(ui.gallerySelected.has(item.imageId)));
        if (ui.gallerySelected.has(item.imageId)) card.classList.add("is-selected");
        const preview = withPreview(item);
        const src = preview?.thumbnailDataUrl || preview?.dataUrl || "";
        const nameText = item.displayName || item.filename || item.imageId;
        const filenameText = item.filename || item.imageId;
        card.setAttribute("aria-label", nameText);
        card.innerHTML = '<div class="gallery-heading"><span class="gallery-name"></span><span class="gallery-selection" aria-hidden="true"></span></div><div class="gallery-thumb-wrap"><img class="gallery-thumb" loading="lazy" decoding="async" alt=""><span class="gallery-filename"></span></div><div class="gallery-actions"></div>';
        const nameEl = $(".gallery-name", card);
        nameEl.textContent = nameText;
        nameEl.title = nameText;
        $(".gallery-selection", card).append(workspaceIcon("check", "favorites"));
        $(".gallery-filename", card).textContent = filenameText;
        const img = $(".gallery-thumb", card); img.src = src; img.alt = nameText;
        const actions = $(".gallery-actions", card);
        for (const [action, icon, sprite, title] of [
          ["vision", "scan-line", "workspace", galleryText("identify", "识图")],
          ["conversation", "message-circle", "workspace", galleryText("send", "发送到对话仓库")],
          ["download", "download", "favorites", galleryText("downloadOne", "下载")],
          ["rename", "pencil", "favorites", galleryText("rename", "重命名")],
          ["delete", "trash-2", "favorites", galleryText("deleteTitle", "删除")]
        ]) {
          const button = doc.createElement("button");
          button.type = "button";
          button.className = `gb gb-${action === "conversation" ? "send" : action}`;
          button.dataset.action = action;
          button.title = title;
          button.setAttribute("aria-label", title);
          button.append(workspaceIcon(icon, sprite));
          actions.append(button);
        }
        const toggleSelection = () => {
          if (ui.gallerySelected.has(item.imageId)) ui.gallerySelected.delete(item.imageId); else ui.gallerySelected.add(item.imageId);
          const selected = ui.gallerySelected.has(item.imageId);
          card.classList.toggle("is-selected", selected);
          card.setAttribute("aria-pressed", String(selected));
          updateGalleryToolbar(rows);
        };
        card.addEventListener("keydown", event => {
          if (event.target !== card || !["Enter", " "].includes(event.key)) return;
          event.preventDefault();
          toggleSelection();
          card.focus();
        });
        card.addEventListener("click", event => {
          if (event.target.closest("[data-action]")) return;
          if (event.target === nameEl || nameEl.contains(event.target)) return;
          toggleSelection();
        });
        card.addEventListener("click", event => {
          const action = event.target.closest("[data-action]")?.dataset.action;
          if (!action) return;
          event.stopPropagation();
          if (action === "vision") { if (imageApp) void selectVisionImage(item); else { visionTempStore?.setLibraryReference?.(item.imageId); clearVisionResult(); renderVisionPreview(); renderTalkVisionPanel(); setVisionOpen(true); } }
          if (action === "conversation") { ui.gallerySelected.add(item.imageId); void gallerySendSelectedItems(); }
          if (action === "download") { galleryDownloadItem(item); }
          if (action === "rename") { if (imageApp) openGalleryRename(item); else { void renameGalleryItemFallback(item); } }
          if (action === "delete") { ui.gallerySelected.add(item.imageId); renderGallery(); void galleryDeleteSelectedItems(); }
        });
        host.appendChild(card);
      });
    }

    function galleryConfirm(message, okLabel = "确定", cancelLabel = "取消", danger = false) {
      return new Promise(resolve => {
        const overlay = doc.createElement("div");
        overlay.className = "modal show"; overlay.style.zIndex = "90";
        const box = doc.createElement("div"); box.className = "box";
        const msg = doc.createElement("div"); msg.style.cssText = "white-space:pre-line;color:var(--text);line-height:1.7"; msg.textContent = message;
        const actions = doc.createElement("div"); actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:14px";
        const cancel = doc.createElement("button"); cancel.type = "button"; cancel.className = "btn btn-secondary"; cancel.textContent = cancelLabel;
        const ok = doc.createElement("button"); ok.type = "button"; ok.className = danger ? "btn btn-danger" : "btn btn-primary"; ok.textContent = okLabel;
        const close = value => { overlay.remove(); try { doc.body.style.overflow = ""; } catch { /* ignore */ } resolve(value); };
        cancel.onclick = () => close(false);
        ok.onclick = () => close(true);
        overlay.addEventListener("click", event => { if (event.target === overlay) close(false); });
        actions.append(cancel, ok); box.append(msg, actions); overlay.append(box); doc.body.appendChild(overlay);
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
    let comfyPngImporting = false;
    async function importWorkflow(file) {
      if (!file) return;
      const isPng = file.type === "image/png" || /\.png$/i.test(file.name || "");
      if (isPng && comfyPngImporting) return;
      if (isPng) comfyPngImporting = true;
      try {
          const apply = async value => {
            if (!comfy?.importWorkflow) throw new Error('工作流导入不可用');
            await views.comfy?.flush?.();
            const imported = await comfy.importWorkflow(value, { name: file.name, source: { kind: 'file', filename: file.name } });
            if (imported?.ok === false) throw new Error(imported.error?.message || imported.reason || '工作流导入失败');
            await views.comfy?.render?.(undefined, true);
            return imported;
          };
        if (file.type === "application/json" || /\.json$/i.test(file.name || "")) {
          await apply(await readText(file));
          notify("工作流 JSON 已导入");
          return;
        }
        if (file.type === "image/png" || /\.png$/i.test(file.name || "")) {
          const metadata = await modules.parsePngMetadata?.(await readFile(file));
          const workflow = metadata?.promptJson || metadata?.workflowJson || metadata?.workflow;
          if (workflow) {
            await apply({ promptJson: metadata?.promptJson, workflowJson: metadata?.workflowJson || workflow });
            notify("已从 PNG 导入工作流");
          } else notify("PNG 中没有找到工作流");
        }
      } catch (error) {
        notify(error.message || String(error));
      } finally {
        if (isPng) comfyPngImporting = false;
      }
    }
    async function addImage(file) {
      if (!file?.type?.startsWith('image/')) return null;
      if (!imageApp) return imageStore?.add?.({ dataUrl: await readFile(file), filename: file.name, source: 'file' });
      return imageResult(await imageApp.uploadToGallery({ dataUrl: await readFile(file), filename: file.name, mime: file.type }));
    }
    function cancelVisionRequest(restoreControls = false) {
      const activeRequestId = ui.visionRequestId;
      ui.visionRequestId += 1;
      ui.visionAbort?.abort?.();
      // 控制器建在容器那侧：按同一个自增号告诉它停哪一次。
      // true = 真中断了一个在跑的请求；false = 那一号已跑完或不存在。
      try { assistant?.visionService?.cancel?.(activeRequestId); } catch { /* 停不掉也不该影响界面收尾 */ }
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
      let result = null;
      try {
        result = await processSelectedVision("vision.processOne", { imageId, mode: "metadata" }, { caller: "ui", sessionId: currentTalkSessionId(), requestId });
      } catch (error) {
        result = { ok: false, error: error?.message || String(error) };
      }
      if (requestId !== ui.visionRequestId || imageId !== currentVisionId()) return result;
      ui.visionResult = result?.ok === false ? result : (result?.data || null);
      ui.visionBusy = false;
      ui.visionAbort = null;
      renderVisionPreview();
      renderTalkVisionPanel();
      return result;
    }
    async function replaceVisionImage(file) {
      if (!file || !visionTempStore) return null;
      if (!imageApp) {
        const item = visionTempStore.replaceExternal({ dataUrl: await readFile(file), filename: file.name, mime: file.type || 'image/png' });
        renderVisionPreview(); renderTalkVisionPanel(); return item;
      }
      const uploadId = ++ui.visionUploadId;
      cancelVisionRequest(true);
      return imageWrite('vision-selection', async () => {
        const dataUrl = await readFile(file);
        if (uploadId !== ui.visionUploadId) return null;
        const item = imageApp
          ? imageResult(await imageApp.replaceVisionImage({ dataUrl, filename: file.name, mime: file.type, source: 'vision-input' }))
          : visionTempStore.replaceExternal({ dataUrl, filename: file.name, mime: file.type });
        if (imageApp) await visionTempStore.setReference({ ref: item.ref });
        if (uploadId !== ui.visionUploadId) return null;
        clearVisionResult(); renderVisionPreview(); renderTalkVisionPanel();
        const controller = new AbortController(); const requestId = ++ui.visionRequestId;
        ui.visionAbort = controller; ui.visionBusy = true;
        await loadVisionMetadata(item.ref.entryId, requestId, controller);
        return item;
      });
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
    function addFilesForContext(files, context, sourceNode) {
      ui.lastImageContext = context || "";
      if (context === "vision") return addVisionFiles(files);
      if (context === "conversation") {
        const node = sourceNode || null;
        const inRepository = Boolean(node && typeof node.closest === "function"
          && (node.closest("#talkImageRepository") || node.closest(".ai-conversation-repository")));
        // 直接落在左侧"对话图片仓库"= 立即进对话区；
        // 落在输入框/对话框 = 先进发送区草稿，发送后才进对话区。
        return inRepository ? addConversationImages(files) : addSendDraftImages(files);
      }
      return null;
    }
    function clipboardImageFiles(event) {
      const clipboard = event?.clipboardData;
      const files = [...(clipboard?.files || [])].filter(file => file?.type?.startsWith("image/"));
      for (const item of [...(clipboard?.items || [])]) {
        if (item?.kind !== "file" || !item.type?.startsWith("image/") || typeof item.getAsFile !== "function") continue;
        const file = item.getAsFile();
        if (!file || files.some(existing => existing === file || (existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified))) continue;
        files.push(file);
      }
      return files;
    }
    async function addSendDraftImages(files) { return addConversationImages(files, true); }
    function tagText(item) {
      const value = [item?.rawText, item?.tag, item?.name, item?.en]
        .find(part => (typeof part === 'string' && part) || typeof part === 'number');
      if (value !== undefined) return str(value);
      return typeof item === 'string' || typeof item === 'number' ? str(item) : '';
    }
    function embeddedTags() {
      const image = currentVisionImage();
      const fromImage = image?.metadata?.builtinTags || [];
      const fromResult = ui.visionResult?.builtinTags || [];
      return [...fromImage, ...fromResult].filter(item => tagText(item));
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
      // metadata 模式的 result.text 是 PNG 内置正向提示词，不属于 AI 描述；
      // AI 描述区只显示点过「AI 识图」之后写入的 description。
      const description = str(ui.visionDescription);
      host.replaceChildren();
      if (result.ok === false) {
        const error = doc.createElement('p'); error.className = 'tp-error'; error.setAttribute('role', 'alert');
        error.textContent = typeof result.error === 'string' ? result.error : result.error?.message;
        host.append(error);
      }
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
      const descriptions = tags?.describe?.(rows) || rows.map(item => ({ rawText: tagText(item), displayName: '', categoryId: '', probability: null }));
      const categoryRows = tags?.getCategories?.() || [];
      const categoryNames = new Map(categoryRows.map(row => [row.id, row.name]));
      const order = new Map(categoryRows.map((row, index) => [row.id, index]));
      const groups = new Map(), seen = new Set();
      for (const item of descriptions) {
        const key = str(item.rawText).toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const category = item.categoryId || 'unclassified';
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category).push(item);
      }
      for (const [category, items] of [...groups].sort((a, b) => (order.get(a[0]) ?? Infinity) - (order.get(b[0]) ?? Infinity))) {
        const section = doc.createElement('section'); section.className = 'vision-tag-group'; section.dataset.category = category;
        const heading = doc.createElement('h4');
        heading.textContent = `${category === 'unclassified' ? localized('ui.ai.unclassifiedTags', '待分类') : categoryLabel(category, categoryNames.get(category) || category)} (${items.length})`;
        const chips = doc.createElement('div'); chips.className = 'chips';
        for (const item of items) {
          const chip = doc.createElement('button'); chip.type = 'button'; chip.className = 'chip btn btn-chip vision-tag-chip'; chip.dataset.tag = item.rawText;
          chip.style.setProperty('--c', categoryColor(category)); chip.title = item.rawText;
          const en = doc.createElement('span'); en.className = 'en'; en.textContent = item.rawText; chip.append(en);
          if (item.displayName) { const zh = doc.createElement('span'); zh.className = 'zh'; zh.textContent = item.displayName; chip.append(zh); }
          if (typeof item.probability === 'number' && item.probability >= 0 && item.probability <= 1) {
            const confidence = doc.createElement('span'); confidence.className = 'vision-confidence'; confidence.textContent = `${Math.round(item.probability * 100)}%`;
            confidence.title = localized('ui.ai.recognitionProbability', '模型识别概率'); chip.append(confidence);
          }
          const feedback = doc.createElement('span'); feedback.className = 'cp'; feedback.textContent = localized('ui.tag.copyOnly', '仅复制'); chip.append(feedback);
          chip.onclick = async event => {
            if (event.target.closest('.cp')) {
              if (await copy(item.rawText)) {
                feedback.textContent = localized('ui.tag.copied', '已复制');
                notify(localized('ui.tag.copied', '已复制'));
              }
              return;
            }
            const id = await tags?.resolveText?.(item.rawText);
            if (!id) { notify(localized('ui.translation.tagNotResolvable', '这个写法没有唯一对应的站内 Tag')); return; }
            const result = await tags?.select?.(id, true);
            if (result?.ok === false) { notify(result.error?.message || localized('ui.tag.selectionFailed', '加入候选失败')); return; }
            renderTags(); renderSelection();
            feedback.textContent = localized('ui.ai.tagAdded', '已加入候选');
            notify(localized('ui.ai.tagAdded', '已加入候选'));
          };
          const wrap = doc.createElement('div'); wrap.className = 'tag-reference-wrap';
          wrap.append(chip, createTagReferenceButton(item.rawText)); chips.append(wrap);
        }
        section.append(heading, chips); host.append(section);
      }
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
        const result = await processSelectedVision("vision.processOne", { imageId, mode: "local", model: modelId }, { caller: "ui", sessionId: currentTalkSessionId(), requestId });
        if (!result) throw new Error("识图服务没有返回结果");
        if (requestId !== ui.visionRequestId || imageId !== currentVisionId()) return result;
        if (result.ok === false) {
          ui.visionResult = result;
          renderTalkVisionPanel();
          notify(typeof result.error === 'string' ? result.error : result.error?.message);
          return result;
        }
        ui.visionResult = result?.data || result?.analysis || null;
        const embedded = embeddedTags();
        const model = currentVisionImage()?.analysis?.tags || currentVisionImage()?.analysis?.modelTags || ui.visionResult?.modelTags || ui.visionResult?.tags || [];
        // 本地识图完成后展开本次模型结果，自动折叠此前的内置 Tag / AI 描述。
        talkVisionFold.model = model.length ? false : null;
        if (embedded.length) talkVisionFold.builtin = true;
        if (ui.visionDescription) talkVisionFold.description = true;
        renderTalkVisionPanel();
        return result?.data || result;
      } catch (error) {
        if (requestId === ui.visionRequestId && imageId === currentVisionId()) {
          ui.visionResult = { ok: false, error: { message: error.message || String(error) } };
          renderTalkVisionPanel(); notify(ui.visionResult.error.message);
        }
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
        // `capabilities.vision.ai` 的判据是"链路表里有没有一条填全的（地址 + 模型）"。
        if (capabilities.vision && capabilities.vision.ai !== true) throw new Error(capabilities.vision.aiError || "链路列表里还没有填全的链路（地址 + 模型），请到「API 设置」补一条");
        const result = await processSelectedVision("vision.processOne", { imageId, mode: "ai" }, { caller: "ui", sessionId: currentTalkSessionId(), requestId });
        if (!result) throw new Error("统一 Agent Runtime 不可用");
        if (ui.visionRequestId === requestId) {
          ui.visionResult = result?.data || null;
          const failure = result?.data?.error || result?.error;
          ui.visionDescription = result?.data?.text || result?.data?.description || result?.text || (typeof failure === "string" ? failure : failure?.message) || "没有返回描述";
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
    function talkContext(text, imageIds, config = settings()) {
      return {
        text,
        imageIds,
        locale: ui.locale,
        // 图片能力只在真正发请求的那一层判定（`primary-vision.js`），这里不复制结论。
        nsfwEnabled: Boolean(tagSnapshot().adult),
        includeAdult: Boolean(tagSnapshot().adult),
        currentCategory: tagSnapshot().category,
        tagRevision: tagSnapshot().revision,
        strict: config.strict !== false,
      };
    }
    /**
     * 停止按钮的唯一驱动源：可不可见、能不能按，只取决于"此刻有没有可取消的请求"，
     * 所以每次都回会话读，不由调用方设布尔值。
     * `hidden` 与 `disabled` 一起由同一个判据决定，两者永远一致。
     */
    function syncStopButton() {
      const stop = $("#talkStopBtn");
      if (!stop) return;
      let canCancel = false;
      let busy = false;
      let requestId = "";
      try {
        busy = assistant?.snapshot?.()?.busy === true;
        requestId = str(assistant?.current?.()?.requestId);
        canCancel = busy && Boolean(requestId);
      } catch { canCancel = false; }
      stop.hidden = !canCancel;
      stop.disabled = !canCancel;
      // 把判断依据写在按钮上（忙不忙、有没有活请求），便于直接读属性定位。
      stop.dataset.available = canCancel ? "1" : "0";
      stop.dataset.busy = busy ? "1" : "0";
      stop.dataset.requestId = requestId;
      stop.title = canCancel
        ? `停止这一轮（请求 ${requestId.slice(0, 12)}）`
        : busy ? "正在收尾，暂时无法取消" : "当前没有正在进行的请求";
      /* 可取消时高亮：ghost 让用户看不出它能按，而它唯一能打断 AI。 */
      stop.classList.toggle("btn-danger", canCancel);
      stop.classList.toggle("stop-active", canCancel);
      stop.classList.toggle("btn-ghost", !canCancel);
    }
    // 发送按钮的忙碌态：忙时不禁用，文案改成「（排队）」，插队走 `Ctrl+Enter`。
    function setTalkBusy(busy, label = "📤 发送") {
      const button = $("#talkSendBtn");
      if (button) {
        button.disabled = false;
        button.textContent = busy ? `${label}（排队）` : label;
      }
      syncStopButton();
      renderQueueDock();
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
    /**
     * **待发队列**（照 DSH 的 `QueueDock`）。
     *
     * 空队列不渲染；一条时把那条直接铺开（不画计数头）；多于一條才画可折叠的计数头。
     * 每行右侧三个按钮：编辑 / 插队 / 移除 —— 与 DSH 的 `QueueAction`
     * （`edit` / `steer` / `remove`）一一对应。
     */
    const queueUi = { collapsed: false, editing: "" };
    function queueItems() {
      try { return assistant?.queue?.() || []; } catch { return []; }
    }
    function renderQueueDock() {
      const dock = $("#talkQueue");
      if (!dock) return;
      const items = queueItems();
      if (!items.length) { dock.hidden = true; dock.replaceChildren(); return; }
      dock.hidden = false;

      const panel = doc.createElement("div");
      panel.className = "dsh-queue-panel";

      if (items.length > 1) {
        const head = doc.createElement("button");
        head.type = "button";
        head.className = "dsh-queue-head";
        head.setAttribute("aria-expanded", queueUi.collapsed ? "false" : "true");
        const lead = doc.createElement("span");
        lead.className = "dsh-queue-lead";
        lead.textContent = "📋";
        const count = doc.createElement("span");
        count.className = "dsh-queue-count";
        const steering = items.filter(row => row.mode === "steer").length;
        count.textContent = `${items.length} 条待发${steering ? `（${steering} 条插队）` : ""}`;
        const chevron = doc.createElement("span");
        chevron.className = "dsh-queue-chevron";
        chevron.textContent = queueUi.collapsed ? "▸" : "▾";
        head.append(lead, count, chevron);
        head.onclick = () => { queueUi.collapsed = !queueUi.collapsed; renderQueueDock(); };
        panel.appendChild(head);
      } else {
        queueUi.collapsed = false;
      }

      if (!queueUi.collapsed) {
        const list = doc.createElement("ol");
        list.className = "dsh-queue-list";
        for (const item of items) {
          const row = doc.createElement("li");
          row.className = "dsh-queue-row";

          if (Array.isArray(item.imageIds) && item.imageIds.length) {
            const thumbs = doc.createElement("span");
            thumbs.className = "dsh-queue-thumbs";
            for (const imageId of item.imageIds.slice(0, 3)) {
              const source = fullImageFor(imageId);
              const url = source?.thumbnailDataUrl || source?.dataUrl || "";
              if (!url) continue;
              const thumb = doc.createElement("img");
              thumb.className = "dsh-queue-thumb";
              thumb.src = url;
              thumb.alt = "待发图片";
              thumbs.appendChild(thumb);
            }
            row.appendChild(thumbs);
          }

          const editing = queueUi.editing === item.id;
          if (editing) {
            const editor = doc.createElement("textarea");
            editor.className = "dsh-queue-editor";
            editor.value = item.text;
            editor.setAttribute("aria-label", "编辑待发消息");
            row.appendChild(editor);
            queueActions(row, item, editor);
            /** 挂进 DOM 之后才能聚焦（否则 focus 会被后续 append 抢走）。 */
            requestAnimationFrame(() => { editor.focus(); editor.setSelectionRange(editor.value.length, editor.value.length); });
          } else {
            const preview = doc.createElement("span");
            preview.className = "dsh-queue-preview";
            preview.textContent = item.text || "（只有图片）";
            preview.title = item.text;
            row.appendChild(preview);
            queueActions(row, item, null);
          }
          list.appendChild(row);
        }
        panel.appendChild(list);
      }
      dock.replaceChildren(panel);
    }
    /** 一行的操作区：编辑 / 插队 / 移除。 */
    function queueActions(row, item, editor) {
      const actions = doc.createElement("span");
      actions.className = "dsh-queue-actions";
      const running = assistant?.snapshot?.().busy === true;
      const button = (icon, title, onClick) => {
        const el = doc.createElement("button");
        el.type = "button";
        el.className = "dsh-queue-action";
        el.textContent = icon;
        el.title = title;
        el.setAttribute("aria-label", title);
        el.onclick = onClick;
        actions.appendChild(el);
        return el;
      };
      if (editor) {
        button("✔", "保存", () => {
          const text = str(editor.value).trim();
          if (!text) return notify("内容不能为空");
          assistant?.updateQueue?.(item.id, { kind: "edit", content: [{ type: "text", text }] });
          queueUi.editing = "";
          renderQueueDock();
        });
        button("✖", "取消编辑", () => { queueUi.editing = ""; renderQueueDock(); });
      } else {
        button("✎", "编辑这条待发消息", () => { queueUi.editing = item.id; renderQueueDock(); });
        if (item.mode === "steer") {
          const badge = doc.createElement("span");
          badge.className = "dsh-queue-status";
          badge.textContent = "插队中…";
          actions.appendChild(badge);
        } else {
          /** 没有正在跑的请求时插队没有意义（DSH 同样回 `steer-unavailable`）。 */
          const steer = button("⚡", running ? "插队：让 AI 下一步就看到它" : "当前没有正在进行的请求", () => {
            const result = assistant?.updateQueue?.(item.id, { kind: "steer" });
            if (result && result.ok === false) notify(str(result.error?.message, "插队失败"));
            renderQueueDock();
          });
          if (!running) steer.disabled = true;
        }
        button("🗑", "移除这条待发消息", () => {
          assistant?.updateQueue?.(item.id, { kind: "remove" });
          if (queueUi.editing === item.id) queueUi.editing = "";
          renderQueueDock();
        });
      }
      row.appendChild(actions);
    }
    function generationCharacterChoice(option, onChoose) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "generation-character-choice";
      button.dataset.characterId = str(option?.id);
      const name = doc.createElement("strong");
      name.textContent = str(option?.name || option?.nameZh, str(option?.id));
      const detail = doc.createElement("span");
      const series = str(option?.series || option?.seriesName);
      const trigger = str(option?.trigger, str(option?.id));
      detail.textContent = [series, trigger].filter(Boolean).join(" · ");
      button.append(name, detail);
      button.onclick = () => onChoose({ ...option, id: button.dataset.characterId });
      return button;
    }
    function generationNeedsInput(message) {
      const pending = message.result?.needsInput;
      const notice = doc.createElement("section");
      notice.className = "generation-needs-input";
      const messageText = doc.createElement("p");
      messageText.textContent = pending?.message || "生成任务需要补充信息后继续";
      notice.appendChild(messageText);
      if (pending?.kind === "question") {
        /*
         * 提问卡结构：眉标 + 标题 / 整行可点的选项列表（序号 + 文案 + 可选徽章 + 描述）
         * / 自定义回答行 / 页脚（左等待状态、右「停止（不回答）」）。
         */
        notice.className = "dsh-ask";
        notice.setAttribute("role", "group");
        notice.setAttribute("aria-label", pending.message);

        const head = doc.createElement("div");
        head.className = "dsh-ask-head";
        const heading = doc.createElement("div");
        heading.className = "dsh-ask-heading";
        const eyebrow = doc.createElement("div");
        eyebrow.className = "dsh-ask-eyebrow";
        eyebrow.textContent = "AI 需要你确认";
        const title = doc.createElement("h3");
        title.className = "dsh-ask-title";
        title.textContent = str(pending.message, "请选择一个答案");
        heading.append(eyebrow, title);
        head.append(heading);

        const body = doc.createElement("div");
        body.className = "dsh-ask-body";

        const isCurrent = () => assistant?.currentSession?.()?.messages?.at(-1)?.id === message.id;
        const setDisabled = value => $$("button, textarea", notice).forEach(control => { control.disabled = value; });
        let settled = false;
        let timer = 0;
        const stopTimer = () => { if (timer) { clearTimeout(timer); timer = 0; } };
        const answer = async value => {
          const text = str(value).trim();
          if (!text) { input.focus(); return; }
          if (settled || !isCurrent() || ui.questionReplyBusy || assistant?.snapshot?.().busy) return;
          settled = true;
          stopTimer();
          ui.questionReplyBusy = true;
          setDisabled(true);
          try { await sendTalk({ text, questionReplyTo: message.id }); }
          finally { ui.questionReplyBusy = false; renderTalk(); }
        };
        /**
         * `ask_user` 给的是 `{ id, label }` **对象**，也可能给裸字符串 —— 两种都认。
         */
        const rows = (Array.isArray(pending.options) ? pending.options : []).map(row => (typeof row === "string"
          ? { id: row, label: row, default: false, description: "" }
          : { id: str(row?.id), label: str(row?.label) || str(row?.id), default: row?.default === true, description: str(row?.description) }))
          .filter(row => row.label);
        // 默认项：标了 `default: true` 用它，否则第一个。
        const marked = rows.findIndex(row => row.default);
        const defaultIndex = marked >= 0 ? marked : (rows.length ? 0 : -1);

        // 自定义回答行要在选项之前建好：它持有 `input`，`answer` 会用到。
        const input = doc.createElement("textarea");
        input.rows = 2;
        input.maxLength = 4000;
        input.placeholder = "也可以输入自己的答案…";
        input.setAttribute("aria-label", "自己的答案");

        if (rows.length) {
          const options = doc.createElement("div");
          options.className = "dsh-ask-options";
          // `role="radio"` 必须住在 `radiogroup` 里，否则辅助技术读不出来。
          options.setAttribute("role", "radiogroup");
          options.setAttribute("aria-label", str(pending.message, "请选择一个答案"));
          rows.forEach((row, index) => {
            const isDefault = index === defaultIndex;
            const button = doc.createElement("button");
            button.type = "button";
            button.className = `dsh-ask-option${isDefault ? " dsh-ask-option-selected" : ""}`;
            button.setAttribute("role", "radio");
            button.setAttribute("aria-checked", isDefault ? "true" : "false");
            // 单选选项用序号方块，多选才用勾选框。
            const mark = doc.createElement("span");
            mark.className = "dsh-ask-number";
            mark.textContent = String(index + 1);
            const copy = doc.createElement("span");
            copy.className = "dsh-ask-copy";
            const line = doc.createElement("span");
            line.className = "dsh-ask-line";
            const label = doc.createElement("span");
            label.className = "dsh-ask-label";
            label.textContent = row.label;
            line.appendChild(label);
            if (isDefault) {
              const badge = doc.createElement("span");
              badge.className = "dsh-ask-badge";
              badge.textContent = "推荐";
              line.appendChild(badge);
            }
            copy.appendChild(line);
            if (row.description) {
              const desc = doc.createElement("span");
              desc.className = "dsh-ask-desc";
              desc.textContent = row.description;
              copy.appendChild(desc);
            }
            button.append(mark, copy);
            /** 回传 `label`：模型自己写的文案，它认得出这是哪一项。 */
            button.onclick = () => answer(row.label);
            options.appendChild(button);
          });
          body.appendChild(options);
        }

        const custom = doc.createElement("div");
        custom.className = rows.length ? "dsh-ask-custom" : "dsh-ask-custom dsh-ask-block";
        const customMark = doc.createElement("span");
        customMark.className = "dsh-ask-number";
        customMark.textContent = rows.length ? String(rows.length + 1) : "✎";
        const field = doc.createElement("div");
        field.className = "dsh-ask-field";
        field.appendChild(input);
        custom.append(customMark, field);
        input.addEventListener("focus", () => custom.classList.add("dsh-ask-custom-active"));
        input.addEventListener("blur", () => custom.classList.remove("dsh-ask-custom-active"));
        body.appendChild(custom);

        const foot = doc.createElement("div");
        foot.className = "dsh-ask-foot";
        const feedback = doc.createElement("span");
        feedback.className = "dsh-ask-feedback";
        const actions = doc.createElement("div");
        actions.className = "dsh-ask-actions";
        const submit = doc.createElement("button");
        submit.type = "button";
        // 用项目统一的按钮模板（`.btn` + `.btn-*`）。
        submit.className = "btn btn-primary";
        submit.textContent = "提交答案";
        submit.onclick = () => answer(input.value);
        // AI 问完就停在这一轮，不留默认执行；不答就点「停止（不回答）」。
        const stop = doc.createElement("button");
        stop.type = "button";
        stop.className = "btn btn-ghost";
        stop.textContent = "停止（不回答）";
        stop.onclick = () => {
          if (settled || !isCurrent()) return;
          settled = true;
          stopTimer();
          setDisabled(true);
          // 取消本轮请求、不提交答案；进度文案交给这一轮的收尾统一写。
          assistant?.cancel?.();
          renderTalk();
        };
        actions.append(submit, stop);
        foot.append(feedback, actions);

        notice.append(head, body, foot);
        setDisabled(!isCurrent() || Boolean(ui.questionReplyBusy || assistant?.snapshot?.().busy));
        return notice;
      }
      if (pending?.kind === "candidate") {
        const choices = doc.createElement("div");
        choices.className = "generation-candidate-choices";
        let selecting = false;
        const setDisabled = disabled => $$('button', notice).forEach(button => { button.disabled = disabled; });
        for (const option of Array.isArray(pending.options) ? pending.options : []) {
          const candidateId = str(option?.candidateId || option?.id);
          if (!candidateId) continue;
          const button = doc.createElement("button");
          button.type = "button";
          button.className = "generation-candidate-choice btn btn-secondary";
          const image = fullImageFor(option.imageId);
          const source = candidateImageSource(option, image);
          if (source) {
            const preview = doc.createElement("img");
            preview.src = source; preview.alt = `候选 ${candidateId}`; preview.loading = "lazy";
            button.appendChild(preview);
          }
          const label = doc.createElement("span");
          label.textContent = [option.slotNo ? `图${option.slotNo}` : '', option.iteration ? `第${option.iteration}轮` : '', candidateId].filter(Boolean).join(' · ');
          button.appendChild(label);
          if (option.summary) { const summary = doc.createElement("small"); summary.textContent = option.summary; button.appendChild(summary); }
          button.onclick = async () => {
            if (selecting || assistant?.snapshot?.().busy) return;
            selecting = true; setDisabled(true);
            const labelText = $("#talkSendBtn")?.textContent || "📤 发送";
            setTalkBusy(true, labelText);
            try {
              const result = await assistant?.continueGeneration?.(message.id, candidateId, str(pending.feedback), { displayText: `选择${option.slotNo ? `图${option.slotNo}` : candidateId}继续优化`, onEvent: handleTalkToolEvent });
              if (result?.ok === false) notify(result.error?.message || "继续优化失败");
            } catch (error) { notify(error?.message || "继续优化失败"); }
            finally { setTalkBusy(false, labelText); selecting = false; renderTalk(); }
          };
          choices.appendChild(button);
        }
        notice.appendChild(choices);
        if (ui.characterSelectionBusy || message.status === "streaming" || assistant?.snapshot?.().busy) setDisabled(true);
        return notice;
      }
      if (pending?.kind !== "character") {
        // `storage` 类停顿也可恢复：走 `pendingRender.promptId` 取回原图，不重跑 GPU。
        // `COMFY_SUBMISSION_UNKNOWN` 仍排除：提交结果未知时不能自动续查。
        if (['connection', 'workflow', 'storage'].includes(pending?.kind) && message.result?.stopReason !== 'COMFY_SUBMISSION_UNKNOWN') {
          const resume = doc.createElement('button'); resume.type = 'button'; resume.className = 'generation-resume-connection btn btn-secondary';
          resume.textContent = localized('ui.ai.resumeDrawing', '恢复原任务');
          resume.onclick = async () => {
            if (resume.disabled || assistant?.snapshot?.().busy) return;
            if (settings().comfyOn !== true) return notify(localized('ui.ai.enableDrawingToResume', '请先确认连接并开启绘图，再恢复原任务'));
            resume.disabled = true;
            const label = $("#talkSendBtn")?.textContent || "📤 发送";
            setTalkBusy(true, label);
            try {
              const result = await assistant?.continueGeneration?.(message.id, '', '', { resumeOnly: true, onEvent: handleTalkToolEvent });
              if (result?.ok === false) notify(result.error?.message || '恢复失败');
            } catch (error) { notify(error?.message || '恢复失败'); }
            finally { setTalkBusy(false, label); renderTalk(); refreshCapabilitiesStatus(); }
          };
          notice.append(resume);
        }
        return notice;
      }
      const hint = doc.createElement("p");
      hint.className = "muted";
      hint.textContent = `待确认：${str(pending.query)}。已有作品角色可点击候选或重新搜索；原创人物可直接继续。`;
      notice.appendChild(hint);
      const choices = doc.createElement("div");
      choices.className = "generation-character-choices";
      const searchResults = doc.createElement("div");
      searchResults.className = "generation-character-search-results";
      let selecting = false;
      const setDisabled = disabled => {
        $$("button", notice).forEach(button => { button.disabled = disabled; });
        $$("input", notice).forEach(input => { input.disabled = disabled; });
      };
      const choose = async (option, original = false) => {
        if (selecting || ui.characterSelectionBusy) return;
        if (assistant?.snapshot?.().busy) return notify("当前请求仍在处理中");
        if (!assistant?.selectGenerationCharacter) return notify("当前版本不支持直接选择角色，请重新发送任务");
        const selectedId = str(option?.id);
        if (!original && !selectedId) return notify("该角色缺少可用标识");
        selecting = true;
        ui.characterSelectionBusy = true;
        setDisabled(true);
        const label = $("#talkSendBtn")?.textContent || "📤 发送";
        setTalkBusy(true, label);
        setTalkStatus(original ? "正在按原创人物恢复原任务…" : "正在确认角色并恢复原任务…");
        let result;
        try {
          result = await assistant.selectGenerationCharacter(message.id, selectedId, { onStart: renderTalk, onEvent: handleTalkToolEvent, selectedCharacter: option, original });
        } catch (error) {
          result = { ok: false, error: { message: error?.message || "角色选择失败" } };
        } finally {
          setTalkBusy(false, label);
          selecting = false;
          ui.characterSelectionBusy = false;
        }
        renderTalk();
        if (result?.ok === false) {
          notify(result.error?.message || "角色选择失败");
          concludeTalkStatus(compactTalkStatus(result, "角色选择失败"), "error");
          return;
        }
        const status = result?.data?.status;
        concludeTalkStatus(status === "needs_input" ? "等待补充信息" : status === "awaiting_feedback" ? "本轮完成，等待点评" : "完成", status === "error" ? "error" : status === "cancelled" ? "cancelled" : "done");
      };
      const appendChoices = (host, rows) => {
        host.replaceChildren();
        for (const option of Array.isArray(rows) ? rows : []) {
          if (!str(option?.id)) continue;
          host.appendChild(generationCharacterChoice(option, choose));
        }
      };
      appendChoices(choices, pending.options);
      notice.appendChild(choices);
      const originalButton = doc.createElement("button");
      originalButton.type = "button";
      originalButton.className = "generation-character-original btn btn-primary";
      originalButton.textContent = "这是原创人物，继续";
      originalButton.onclick = () => choose(null, true);
      notice.appendChild(originalButton);
      if (characters?.page) {
        const search = doc.createElement("div");
        search.className = "generation-character-search-row";
        const input = doc.createElement("input");
        input.className = "generation-character-search";
        input.type = "search";
        input.setAttribute("aria-label", "重新搜索角色");
        input.placeholder = "搜索角色名或作品名";
        input.value = str(pending.query);
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "generation-character-search-button btn btn-secondary";
        button.textContent = "搜索";
        const searchCharacters = async () => {
          const query = str(input.value);
          if (!query || selecting) return;
          button.disabled = true;
          try {
            const result = await Promise.resolve(characters.page({ query, limit: 10, includeAdult: tags?.stateSnapshot?.().includeAdult === true }));
            if (!notice.isConnected || selecting || ui.characterSelectionBusy) return;
            const rows = Array.isArray(result?.items) ? result.items.map(item => ({ id: str(item?.id), name: str(item?.nameZh || item?.name), series: str(item?.seriesName || item?.series), trigger: str(item?.trigger, str(item?.id)) })) : [];
            appendChoices(searchResults, rows);
            if (!searchResults.childElementCount) searchResults.textContent = "没有找到可选角色";
          } catch (error) {
            searchResults.textContent = error?.message || "角色搜索失败";
          } finally {
            button.disabled = selecting;
          }
        };
        button.onclick = searchCharacters;
        input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); searchCharacters(); } });
        search.append(input, button);
        notice.append(search, searchResults);
      }
      if (ui.characterSelectionBusy || message.status === "streaming" || assistant?.snapshot?.().busy) setDisabled(true);
      return notice;
    }
    let pendingSessionQuestion = null;
    let pendingSessionQuestionSession = '';
    let pendingSessionQuestionRequest = 0;
    let pendingSessionQuestionBusy = false;
    async function loadPendingSessionQuestion(sessionId) {
      const request = ++pendingSessionQuestionRequest;
      pendingSessionQuestionSession = sessionId;
      pendingSessionQuestion = null;
      const result = await assistant?.pendingQuestion?.(sessionId);
      if (request !== pendingSessionQuestionRequest || sessionId !== currentTalkSessionId()) return;
      if (result?.ok === false) return;
      const question = result?.data?.问题;
      pendingSessionQuestion = question ? { ...question, sessionId } : null;
      renderTalk();
    }
    function applyPendingQuestionChanges(changes) {
      if (!Array.isArray(changes)) return false;
      const sessionId = currentTalkSessionId();
      let changed = false;
      for (const item of changes) {
        if (String(item?.会话ID || '') !== sessionId) continue;
        pendingSessionQuestionRequest += 1;
        pendingSessionQuestionSession = sessionId;
        pendingSessionQuestion = item.问题 ? { ...item.问题, sessionId } : null;
        changed = true;
      }
      if (changed) renderTalk();
      return changed;
    }
    function renderPendingSessionQuestion() {
      const host = $('#talkConv');
      host?.querySelector(':scope > .session-question-card')?.remove();
      const question = pendingSessionQuestion;
      if (!host || !question || question.sessionId !== currentTalkSessionId()) return;
      const questionId = String(question.问题ID || '');
      const sessionId = question.sessionId;
      const card = doc.createElement('section');
      card.className = 'dsh-ask session-question-card';
      card.setAttribute('role', 'group');
      card.setAttribute('aria-label', str(question.问题, '请选择一个答案'));
      const head = doc.createElement('div'); head.className = 'dsh-ask-head';
      const heading = doc.createElement('div'); heading.className = 'dsh-ask-heading';
      const eyebrow = doc.createElement('div'); eyebrow.className = 'dsh-ask-eyebrow'; eyebrow.textContent = 'AI 需要你确认';
      const title = doc.createElement('h3'); title.className = 'dsh-ask-title'; title.textContent = str(question.问题, '请选择一个答案');
      heading.append(eyebrow, title); head.append(heading);
      const body = doc.createElement('div'); body.className = 'dsh-ask-body';
      const options = Array.isArray(question.选项) ? question.选项 : [];
      const disabled = value => card.querySelectorAll('button,textarea').forEach(control => { control.disabled = value; });
      const isCurrent = () => sessionId === currentTalkSessionId()
        && pendingSessionQuestion?.sessionId === sessionId
        && String(pendingSessionQuestion?.问题ID || '') === questionId;
      const answer = async value => {
        if (pendingSessionQuestionBusy || !isCurrent()) return;
        pendingSessionQuestionBusy = true; disabled(true);
        try {
          const result = await assistant.answerQuestion(sessionId, questionId, value);
          if (result?.ok === false) throw new Error(result.error?.message || result.error || '回答未提交');
          if (isCurrent()) { pendingSessionQuestion = null; renderTalk(); }
        } catch (error) { notify(error?.message || String(error)); disabled(false); }
        finally { pendingSessionQuestionBusy = false; }
      };
      if (options.length) {
        const list = doc.createElement('div'); list.className = 'dsh-ask-options';
        list.setAttribute('role', 'radiogroup'); list.setAttribute('aria-label', str(question.问题, '请选择一个答案'));
        options.forEach((option, index) => {
          const choice = doc.createElement('button'); choice.type = 'button'; choice.className = 'dsh-ask-option';
          choice.setAttribute('role', 'radio'); choice.setAttribute('aria-checked', 'false');
          const number = doc.createElement('span'); number.className = 'dsh-ask-number'; number.textContent = String(index + 1);
          const copy = doc.createElement('span'); copy.className = 'dsh-ask-copy';
          const label = doc.createElement('span'); label.className = 'dsh-ask-label'; label.textContent = String(option?.标识 || '');
          copy.append(label);
          if (option?.说明) { const detail = doc.createElement('span'); detail.className = 'dsh-ask-desc'; detail.textContent = String(option.说明); copy.append(detail); }
          choice.append(number, copy);
          choice.onclick = () => answer(String(option?.标识 || ''));
          list.append(choice);
        });
        body.append(list);
      }
      const custom = doc.createElement('div'); custom.className = options.length ? 'dsh-ask-custom' : 'dsh-ask-custom dsh-ask-block';
      const input = doc.createElement('textarea'); input.rows = 2; input.placeholder = '也可以输入自己的答案…'; input.setAttribute('aria-label', '自己的答案');
      const field = doc.createElement('div'); field.className = 'dsh-ask-field'; field.append(input); custom.append(field); body.append(custom);
      const foot = doc.createElement('div'); foot.className = 'dsh-ask-foot';
      const wait = doc.createElement('span'); wait.className = 'dsh-ask-wait'; wait.textContent = '等待你的回答';
      const actions = doc.createElement('div'); actions.className = 'dsh-ask-actions';
      const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.className = 'btn btn-secondary'; cancel.textContent = '停止（不回答）';
      cancel.onclick = async () => {
        if (pendingSessionQuestionBusy || !isCurrent()) return;
        pendingSessionQuestionBusy = true; disabled(true);
        try {
          const result = await assistant.cancelQuestion(sessionId, questionId);
          if (result?.ok === false) throw new Error(result.error?.message || result.error || '停止失败');
          if (isCurrent()) { pendingSessionQuestion = null; renderTalk(); }
        } catch (error) { notify(error?.message || String(error)); disabled(false); }
        finally { pendingSessionQuestionBusy = false; }
      };
      const submit = doc.createElement('button'); submit.type = 'button'; submit.className = 'btn btn-primary'; submit.textContent = '提交回答';
      submit.onclick = () => { if (input.value.trim()) answer(input.value.trim()); else input.focus(); };
      actions.append(cancel, submit); foot.append(wait, actions); card.append(head, body, foot); host.append(card);
    }
    /** 将当前会话状态投影到消息区。 */
    function renderTalk() {
      const follow = ui.comfyFollow['#talkConv'] !== false;
      syncStopButton(); ui.dshMount?.update();
      if (follow) talkScroll(true);
      const session = assistant.currentSession(), snapshot = assistant.snapshot(), turn = session?.turns.at(-1);
      const imageMarkerSnapshot = conversationImageMarkerSignature(session);
      if (imageMarkerSnapshot !== conversationImageMarkerSnapshot) {
        conversationImageMarkerSnapshot = imageMarkerSnapshot;
        void renderConversationRepository();
      }
      if (session?.id && pendingSessionQuestionSession !== session.id) void loadPendingSessionQuestion(session.id);
      const running = snapshot.busy, failed = turn?.status === 'failed';
      let text = session?.运行状态 === '停止中' ? '停止中…' : running ? 'AI 处理中…' : failed ? turn.error.reason : turn?.status === 'stopped' ? '已停止' : turn?.status === 'interrupted' ? turn.error.reason : turn ? '完成' : '可以开始新对话';
      if (snapshot.error) text = snapshot.error.reason;
      if (session?.未保存) text += ' · 未保存：' + session.保存错误.reason;
      const state = running ? 'running' : failed || snapshot.error ? 'error' : 'done';
      const status = $('#talkStatus'); if(status?.textContent !== text || status?.dataset.status !== state) concludeTalkStatus(text,state);
      if (status) {
        status.hidden = Boolean(turn) && !snapshot.error && !session?.未保存;
        if (status.hidden) status.textContent = '';
      }
      let info = $('#sessionFormatInfo');
      if (!info) { info=doc.createElement('details'); info.id='sessionFormatInfo'; const summary=doc.createElement('summary');summary.textContent='会话格式与存储';info.append(summary,doc.createElement('p'));$('#talkConv')?.before(info); }
      const p=info.querySelector('p'); if(p) p.textContent=assistant.格式说明();
      renderPendingSessionQuestion();
      if (follow && pendingSessionQuestion?.sessionId === session?.id) talkScroll(true);
    }
    function streamFrameStats() {
      return {
        count: perfFrames.count,
        avgMs: perfFrames.count ? Number((perfFrames.totalMs / perfFrames.count).toFixed(2)) : 0,
        maxMs: Number(perfFrames.maxMs.toFixed(2))
      };
    }
    function noteStreamingFrame(startedAt) {
      const ms = performance.now() - startedAt;
      perfFrames.count += 1; perfFrames.totalMs += ms;
      if (ms > perfFrames.maxMs) perfFrames.maxMs = ms;
      const now = Date.now();
      if (!perfFrames.reportedAt) { perfFrames.reportedAt = now; return; }
      if (now - perfFrames.reportedAt < 2000) return;
      const frames = perfFrames.count - perfFrames.reportedCount;
      const average = frames ? (perfFrames.totalMs - perfFrames.reportedTotalMs) / frames : 0;
      if (average >= 8 || perfFrames.maxMs >= 32) {
        console.info(`[perf] stream-frame 平均 ${average.toFixed(1)}ms · 最慢 ${perfFrames.maxMs.toFixed(1)}ms`
          + ` · 本窗口 ${frames} 帧 / ${((now - perfFrames.reportedAt) / 1000).toFixed(1)}s · 累计 ${perfFrames.count} 帧`);
      }
      perfFrames.reportedAt = now;
      perfFrames.reportedCount = perfFrames.count;
      perfFrames.reportedTotalMs = perfFrames.totalMs;
    }
    function updateStreamingTalk() {
      const startedAt = performance.now();
      try { renderTalk(); } finally { noteStreamingFrame(startedAt); }
    }
    async function conversationDeleteImpact(session) {
      const listed = await assistant.listSessionImages({sessionId:session?.id});
      const refs = listed?.data?.items || [];
      return {refs,message:'消息 ' + (session?.messageCount ?? session?.messages?.length ?? 0) + ' 条 · 会话图片 ' + refs.length + ' 张；选择保留图片时先复制到图库。'};
    }
    async function confirmDeleteConversation(session, onDone) {
      const impact = await conversationDeleteImpact(session);
      const title = session?.title || localized("ui.ai.newChatTitle", "新对话");
      confirm(`${formatText(localized("ui.ai.deleteConversation", "确定删除对话“{title}”吗？"), { title })}\n${impact.message}`, retainImages => onDone?.(retainImages), { showRetainImages: true, retainImagesDefault: false });
    }
    async function renameConversation(sessionId, currentTitle) {
      const next = await promptDialog({
        title: localized('ui.ai.renameTitle', '重命名这条对话'),
        label: localized('ui.ai.renameLabel', '对话标题'),
        value: str(currentTitle, '新对话'),
        confirmLabel: localized('ui.common.save', '保存'),
        requiredMessage: localized('ui.ai.renameRequired', '标题不能为空'),
      });
      if (typeof next !== 'string' || !next.trim()) return;
      const result = await assistant.renameSession(sessionId, next.trim());
      if (result?.ok === false) return notify(result.error.message);
      renderTalk(); renderManager();
    }
    /* ===== 图片查看器与右键菜单（ComfyUI 返图点开 / 下载 / 保存） ===== */
    /** 按会话、变体和图片标识缓存成功解析的图片地址。 */
    const imageCache = new Map();
    const imageMetadataCache = new Map();
    function invalidateImageCache() { imageCache.clear(); imageMetadataCache.clear(); }
    function imageMetadataFor(imageId) {
      const sessionId = currentTalkSessionId();
      const key = sessionId + '\u0000' + str(imageId);
      if (!imageMetadataCache.has(key)) {
        imageMetadataCache.set(key, assistant.readSessionImageMetadata({ sessionId, imageId }));
      }
      return imageMetadataCache.get(key);
    }
    function fullImageFor(imageId, variant = 'thumbnail') {
      const key = currentTalkSessionId() + '\u0000' + variant + '\u0000' + str(imageId);
      if (imageCache.has(key)) return imageCache.get(key);
      const resolved = resolveImageUncached(imageId, variant);
      if (resolved) imageCache.set(key, resolved);
      return resolved;
    }
    function resolveImageUncached(imageId, variant = 'thumbnail') {
      if (!imageApp) {
        const stored = imageStore?.get?.(imageId) || images?.get?.(imageId);
        if (stored?.dataUrl || stored?.thumbnailDataUrl || stored?.viewUrl) return stored;
        return imageStore?.preview?.(imageId) || images?.preview?.(imageId) || null;
      }
      const session = assistant?.resolveSessionImage?.({ sessionId: currentTalkSessionId(), imageId });
      if (session?.data) return withPreview(session.data, variant);
      const ref = galleryRefs.get(imageId); if (!ref) return null;
      const found = imageApp.get({ ref }); return found?.data ? withPreview(found.data, variant) : null;
    }
    function imageZoomSource(imageId, fallbackSource) {
      const stored = fullImageFor(imageId, "original");
      const source = stored?.dataUrl || stored?.viewUrl || fallbackSource || "";
      return { source, filename: stored?.filename || stored?.displayName || `${str(imageId) || "image"}.png`, mime: stored?.mime || "image/png", stored };
    }
    function galleryHasImage(imageId) {
      const image = fullImageFor(imageId); return image?.ref?.container?.type === 'gallery';
    }
    function conversationHasImage(imageId, sessionId = currentTalkSessionId()) {
      return Boolean(assistant?.resolveSessionImage?.({ sessionId, imageId })?.data);
    }
    function updateImgViewerActions() {
      const state = ui.imgViewer;
      if (!state) return;
      const galleryBtn = $("#imgViewerToGallery");
      if (galleryBtn) {
        const saved = galleryHasImage(state.imageId);
        galleryBtn.textContent = saved ? "已保存到图库" : "⭐ 保存到图库";
        galleryBtn.disabled = saved;
      }
      const convBtn = $("#imgViewerToConversation");
      if (convBtn) {
        const attached = conversationHasImage(state.imageId);
        convBtn.textContent = attached ? "已在对话区" : "💬 保存到对话区";
        convBtn.disabled = attached;
      }
      const meta = $("#imgViewerMeta");
      if (meta) meta.textContent = state.title ? `${state.title} · ${state.filename}` : state.filename;
    }
    function openImageViewer(options = {}) {
      const imageId = str(options.imageId);
      const zoom = imageZoomSource(imageId, options.source);
      if (!zoom.source) return notify("暂无图片数据，无法打开");
      ui.imgViewer = { imageId, filename: str(options.filename, zoom.filename), mime: str(options.mime, zoom.mime), title: str(options.title) };
      const img = $("#imgViewerImage");
      if (img) { img.src = zoom.source; img.alt = str(options.title, "图片"); }
      $("#imgViewer")?.classList.add("show");
      updateImgViewerActions();
    }
    /** 打开指定会话图片，查看器按图片标识加载原图。 */
    function openConversationImageViewer(item, asset = null) {
      const imageId = str(item?.imageId);
      if (!imageId) return;
      const label = str(item?.displayTitle || asset?.displayName || asset?.filename, imageId);
      openImageViewer({
        imageId,
        source: asset?.thumbnailDataUrl || asset?.dataUrl || "",
        title: Number(item?.slotNo) > 0 ? `会话图 ${Number(item.slotNo)}` : label,
        filename: str(asset?.filename, label),
        mime: str(asset?.mime, "image/png")
      });
    }
    function closeImageViewer() {
      $("#imgViewer")?.classList.remove("show");
      ui.imgViewer = null;
    }
    async function addImageToGallery(imageId) {
      const sessionId = currentTalkSessionId();
      return imageWrite('save-' + imageId, async () => {
        imageResult(await assistant.saveSessionImage({ sessionId, imageId }));
        renderGallery(); if (sessionId === currentTalkSessionId()) { renderConversationRepository(); renderTalk(); updateImgViewerActions(); }
        notify('已保存到图库'); return true;
      });
    }
    async function addImageToConversation(imageId) {
      const sessionId = currentTalkSessionId();
      if (conversationHasImage(imageId, sessionId)) return true;
      const item = fullImageFor(imageId); if (!item?.ref) return false;
      return imageWrite('copy-' + imageId, async () => {
        imageResult(await assistant.uploadSessionImage({ sessionId, galleryRef: item.ref, pending: false }));
        if (sessionId === currentTalkSessionId()) renderConversationRepository();
        notify('已保存到对话区'); return true;
      });
    }
    function downloadImage(imageId) { return galleryDownloadItem(fullImageFor(imageId)); }
    function showImageContextMenu(event, item) {
      const menu = $("#imgCtxMenu");
      if (!menu) return;
      ui.imageCtx = item;
      menu.style.display = "block";
      const padding = 8;
      const rect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(padding, Math.min(event.clientX, doc.defaultView?.innerWidth ? doc.defaultView.innerWidth - rect.width - padding : event.clientX))}px`;
      menu.style.top = `${Math.max(padding, Math.min(event.clientY, doc.defaultView?.innerHeight ? doc.defaultView.innerHeight - rect.height - padding : event.clientY))}px`;
    }
    function hideImageContextMenu() {
      const menu = $("#imgCtxMenu");
      if (menu) menu.style.display = "none";
      ui.imageCtx = null;
    }
    function candidateImage(candidate) { return fullImageFor(str(candidate?.imageId)); }
    /**
     * 候选图的图源解析：按 ① `fullImageFor`（会话 / 图库）② `ui.candidatePreviews`
     * （流式期 `candidate.ready` 带来的预览）③ 会话图片列表按 imageId 找，第一个有值的胜出。
     * 缩略图优先、原图兜底（几十张图时原图会让界面明显变卡）。
     */
    function candidateImageSource(candidate, resolved = null) {
      const imageId = str(candidate?.imageId);
      const fromResolved = str(resolved?.thumbnailDataUrl || resolved?.dataUrl || resolved?.viewUrl);
      if (fromResolved) return fromResolved;
      const candidateId = str(candidate?.id || candidate?.candidateId);
      const fromPreview = str(candidateId && ui.candidatePreviews[candidateId]);
      if (fromPreview) return fromPreview;
      if (!imageId) return "";
      const fromSession = sessionImageRefs().find(row => str(row?.imageId || row?.ref?.imageId) === imageId);
      return str(fromSession?.thumbnailDataUrl || fromSession?.dataUrl || fromSession?.viewUrl || fromSession?.ref?.thumbnailDataUrl);
    }
    /** 当前会话的图片列表快照（读不到就给空数组，调用方不必再判空）。 */
    function sessionImageRefs() {
      return conversationImageRowsSession === currentTalkSessionId() ? conversationImageRows : [];
    }
    function cleanPromptText(value) {
      const source = str(value).replace(/\r\n?/g, '\n').trim();
      if (!source) return '';
      const lines = source.split('\n').map(line => line.trim());
      while (lines.length && /^(?:```|~~~)[^\s]*$/.test(lines[0])) lines.shift();
      while (lines.length && /^(?:```|~~~)[^\s]*$/.test(lines.at(-1))) lines.pop();
      return lines.join('\n').trim();
    }
    function candidatePromptText(candidate) {
      const prompt = cleanPromptText(candidate?.prompt);
      const negative = settings().generateNegativeTags === true ? cleanPromptText(candidate?.negative) : "";
      return `${prompt}${negative ? `\n\n【负面提示词】\n${negative}` : ""}`;
    }
    /**
     * 思考行的**概要**：取第一行，去掉加粗标记，压成一行。
     *
     * 折叠时对外只显示它 —— 所以它要能回答"这一段在想什么"，
     * 而不是像工具行那样给参数（思考没有参数）。
     *
     * 概要与全文不同源：概要是**压缩**，不是截断 —— 中英混排时按字符数截
     * 会把一个词劈开，所以只取首行、再按长度加省略号。
     */
    /**
     * 首行（`\n` 之前）—— 与 DSH `ReasoningRow` 的 `firstLine` 同义。
     * 用原始字符串：`str()` 会 trim，那会把"以换行开头"的整段首行丢掉。
     */
    function firstLineOf(value) {
      const source = value == null ? "" : String(value);
      const newline = source.indexOf("\n");
      return newline === -1 ? source : source.slice(0, newline);
    }
    /**
     * 最后一个**已完成段落**的首行 —— 空行分段，段内还没出现换行就不算完成。
     * 流式期间概要取它，回退值是上一个已完成段落（与 DSH `latestCompletedParagraphFirstLine` 同义）。
     */
    function latestCompletedParagraphFirstLine(value) {
      const source = value == null ? "" : String(value);
      let summary = "";
      let paragraphStart = 0;
      const separator = /\r?\n(?:[\t ]*\r?\n)+/g;
      for (;;) {
        const nextParagraph = separator.exec(source);
        const paragraphEnd = nextParagraph === null ? source.length : nextParagraph.index + nextParagraph[0].indexOf("\n");
        const newline = source.indexOf("\n", paragraphStart);
        if (newline !== -1 && newline <= paragraphEnd) {
          const candidate = source.slice(paragraphStart, newline).trim();
          if (candidate) summary = candidate;
        }
        if (nextParagraph === null) return summary;
        paragraphStart = nextParagraph.index + nextParagraph[0].length;
      }
    }
    /**
     * 概要文本（与 DSH `ReasoningRow` 一致）：
     * 流式段取最后一段**已完成段落**的首行，跑完的取首行；截断交给 CSS 省略号，不在这里截。
     * 首行为空（整段以换行开头）时概要为空 —— 该行因此不可展开，与 DSH 同。
     */
    function thoughtOutlineOf(text, running = false) {
      const source = str(running ? latestCompletedParagraphFirstLine(text) : firstLineOf(text)).replace(/\*\*/g, "");
      return running ? source.trim() : source;
    }
    function executionTurnFor(message) {
      // 执行时间线只属于助手回合（用户消息上没有过程可言）。
      if (!message || message.role !== "assistant") return null;
      const projection = assistant?.agentProjection;
      if (typeof projection?.executionTimeline !== "function") return null;
      let rows = [];
      try { rows = projection.executionTimeline(currentTalkSessionId()) || []; } catch { rows = []; }
      if (!Array.isArray(rows) || !rows.length) return null;
      const requestId = str(message?.result?.requestId || message?.requestId);
      // 按 `messageId` 认这一轮（`turn/start` 带的就是助手消息 id），命中不了就退回
      // "最后那一轮" —— 只在流式期间兜底会让跑完之后的思考行整块消失。
      return rows.find(turn => turn.messageId === message?.id || (requestId && turn.requestId === requestId))
        || rows.at(-1)
        || null;
    }
    /**
     * 时间线里的一行：`图标 | 标题 · 摘要（唯一可省略的一段） | 箭头`，点击整行展开，
     * 展开后追加「参数」与「结果」两段。
     *
     * 状态不进可见文字：写进 `data-state`（给图标上色）与 `aria-label`（给读屏软件），
     * 折叠时那一行只有"这个工具 + 它干了什么"。
     */
    function agentRowParts(line) {
      line.className = "agent-row";
      const summary = doc.createElement("summary");
      const icon = doc.createElement("span"); icon.className = "agent-row-icon";
      const title = doc.createElement("span"); title.className = "agent-row-title";
      const sep = doc.createElement("span"); sep.className = "agent-row-sep";
      /** 摘要外面套一层 —— DSH 的 `.summary`（裁剪 + 渐隐）与 `.summaryText`（省略号）是两层。 */
      const textWrap = doc.createElement("span"); textWrap.className = "agent-row-summary";
      const text = doc.createElement("span"); text.className = "agent-row-summary-text";
      textWrap.appendChild(text);
      const state = doc.createElement("span"); state.className = "agent-row-state";
      const chevron = doc.createElement("span"); chevron.className = "agent-row-chevron"; chevron.textContent = "▶";
      summary.append(icon, title, sep, textWrap, state, chevron);
      const body = doc.createElement("div"); body.className = "agent-row-body";
      line.append(summary, body);
      return { summary, icon, title, sep, textWrap, text, state, chevron, body };
    }
    /** IO 卡片：一个框 + 若干段，每段「标签在左、内容在右」。段的顺序即传入顺序。 */
    function agentIoCard(sections, errorText = false) {
      const card = doc.createElement("div");
      card.className = "agent-io-card";
      let first = true;
      for (const [label, value] of sections) {
        if (value === null || value === undefined || value === "") continue;
        if (!first) {
          const divider = doc.createElement("span");
          divider.className = "agent-io-divider";
          divider.setAttribute("aria-hidden", "true");
          card.appendChild(divider);
        }
        first = false;
        const section = doc.createElement("div");
        section.className = "agent-io-section";
        const name = doc.createElement("span");
        name.className = "agent-io-label";
        name.textContent = label;
        const text = doc.createElement("span");
        text.className = "agent-io-text";
        /** 失败行的输出段用错误色（DSH 的 `ioText[data-error]` 同款做法）。 */
        if (errorText) text.dataset.error = "1";
        text.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
        section.append(name, text);
        card.appendChild(section);
      }
      return card.childElementCount ? card : null;
    }
    /**
     * 工具行的**摘要** —— 照 DSH 的优先级：
     *   失败了就显示失败原因（`errorSummary`），否则显示参数摘要。
     * 展开后的参数与结果单独占一段，不挤在这一行里。
     */
    function toolRowSummary(tool) {
      if (tool.status === "failed") return str(tool.error?.message || tool.error?.code, "调用失败");
      return toolPresentation.toolSummary(tool.name, tool.arguments) || str(tool.name);
    }
    /**
     * **工具行详情：按 `presentation` 渲染，认不出来才退回通用输入/输出。**
     *
     * 这是"Agent 效果"的核心 —— 照 DSH 的卡片规矩（`ui-tool/README.md` 的 Cards 一节）：
     *
     *   · 展开体显示的是**解释过的内容**（"查到了 8 个角色""生成了 2 张候选图"），
     *     而不是 `JSON.stringify(result)` 那一坨；
     *   · 卡片种类由工具自己的 `presentationMeta().card` 给（`trace.presentation`）；
     *   · **认不出来就退回通用「输入 / 输出」** —— "Unsupported or malformed inputs
     *     use flattened Tool result text"，不是报错，也不是硬塞 JSON。
     *
     * 失败时只显示失败原因（DSH 的 `errorSummary` 同款），不显示半截结果。
     */
    function toolRowDetail(tool) {
      /** 失败：只给原因。半截结果没有解读价值，还会让人误以为成功了。 */
      if (tool.status === "failed") {
        const reason = str(tool.error?.message || tool.error?.code, "调用失败");
        const card = agentIoCard([["失败原因", reason]], true);
        return card ? [card] : [];
      }
      const args = tool.arguments;
      const input = args && typeof args === "object" && Object.keys(args).length ? args : null;
      /** 工具自己给的解释（`presentationMeta`）—— 有它才谈得上"卡片"。 */
      const presentation = tool.presentation && typeof tool.presentation === "object" ? tool.presentation : null;
      const nodes = [];
      if (presentation) {
        const head = agentCardHead(presentation);
        if (head) nodes.push(head);
      }
      /** 卡片正文：把结果里**读得懂**的部分列出来，而不是整坨 JSON。 */
      const body = agentCardBody(tool, presentation);
      if (body) nodes.push(body);
      else {
        /** 认不出来：退回通用「输入 / 输出」（DSH 的最终兜底）。 */
        const card = agentIoCard([["输入", input], ["输出", tool.result]], false);
        if (card) nodes.push(card);
      }
      return nodes;
    }
    /**
     * 卡片抬头：工具给的标题 + 计数徽章。
     * 标题是工具自己写的（"查询标签：粉发"），界面不猜。
     */
    function agentCardHead(presentation) {
      const title = str(presentation.title);
      const count = Number(presentation.count);
      if (!title && !Number.isFinite(count)) return null;
      const head = doc.createElement("div");
      head.className = "agent-card-head";
      if (title) {
        const name = doc.createElement("strong");
        name.className = "agent-card-title";
        name.textContent = title;
        head.appendChild(name);
      }
      if (Number.isFinite(count)) {
        const badge = doc.createElement("span");
        badge.className = "agent-card-count";
        badge.textContent = `${count} 项`;
        head.appendChild(badge);
      }
      return head;
    }
    /**
     * 卡片正文：按**结果的形状**挑读得懂的部分。
     *
     * 不写"每个工具一张卡片" —— 那是 19 份重复实现。这里只看结果里有什么：
     * 列表就列条目，有 tags 就列 Tag，有图片就说几张图，其余关键字段列成"名：值"。
     * 全都不认识时返回 `null`，由调用方退回通用卡片。
     */
    function agentCardBody(tool, presentation = null) {
      const value = tool.result;
      if (!value || typeof value !== "object") return null;
      const rows = [];
      /** 列表类结果：`items` / `candidates` / `tags` —— 取前若干条列出来。 */
      const listKey = ["items", "candidates", "tags", "rows", "results"].find(key => Array.isArray(value[key]) && value[key].length);
      if (listKey) {
        const limit = 24;
        const entries = value[listKey].slice(0, limit).map(entry => {
          if (entry === null || entry === undefined) return "";
          if (typeof entry !== "object") return str(entry);
          /** 条目里挑一个"名字"字段；都没有就把整条压成一行 JSON。 */
          const label = str(entry.label || entry.name || entry.displayName || entry.title || entry.tag || entry.query || entry.id);
          const extra = str(entry.count ? `${entry.count} 项` : "", "");
          return [label, extra].filter(Boolean).join(" · ") || JSON.stringify(entry);
        }).filter(Boolean);
        if (entries.length) {
          const list = doc.createElement("ul");
          list.className = "agent-card-list";
          for (const line of entries) {
            const item = doc.createElement("li");
            item.textContent = line;
            list.appendChild(item);
          }
          if (value[listKey].length > limit) {
            const more = doc.createElement("li");
            more.className = "agent-card-more";
            more.textContent = `…还有 ${value[listKey].length - limit} 项`;
            list.appendChild(more);
          }
          rows.push(list);
        }
      }
      /**
       * 图片类结果：只说"有几张"（不画缩略图 —— 图在候选区已经画过）。
       * ⚠️ 候选列表已经逐张列出来时**不重复**说这句，否则同一件事看两遍。
       */
      const images = Array.isArray(value.artifacts) && value.artifacts.length ? value.artifacts
        : Array.isArray(value.imageIds) && value.imageIds.length ? value.imageIds : null;
      if (images && listKey !== "candidates") {
        const line = doc.createElement("p");
        line.className = "agent-card-note";
        line.textContent = `生成 ${images.length} 张图`;
        rows.push(line);
      }
      if (!rows.length) return null;
      const body = doc.createElement("div");
      body.className = "agent-card-body";
      for (const row of rows) body.appendChild(row);
      return body;
    }
    function updateExecutionTimeline(container, turn, message = null) {
      const list = $("ol", container);
      if (!list) return;
      /** `{ id, at }` 顺序表 —— 最后按它重排 DOM（思考与工具按发生时间交错）。 */
      const ordered = [];
      /**
       * ⚠️ **保留的旧行渲染器 —— 当前无调用方。**
       *
       * 现行实现是 `dsh-rows.js` 的 `toolRow()`（照抄 DSH `ToolRow.tsx`）。
       * 留在这里是因为本项目要求"新的先并存、验证后再切"，验证完成后整体删除。
       */
      // eslint-disable-next-line no-unused-vars
      const legacyEnsureRow = id => {
        let line = [...list.children].find(item => item.dataset.timelineNodeId === id);
        if (!line) { line = doc.createElement("li"); line.dataset.timelineNodeId = id; list.appendChild(line); }
        return line;
      };

      /**
       * **行句柄表** —— 每一行一个 `{ root, setText, setState, … }`，
       * 由 `dsh-rows.js` 返回。原语内部**不重建节点、只改变化的部分**，
       * 所以这张表必须跨帧留住。
       */
      const rowHandles = (list.__dshRowHandles ||= new Map());

      /** 建/取一行思考（照抄 DSH `ReasoningRow`）。 */
      const ensureThoughtRow = segment => {
        let handle = rowHandles.get(segment.id);
        if (!handle) {
          handle = dshRows.reasoningRow({
            text: segment.text,
            running: Boolean(segment.tail),
            disclosure: dshRows.createDisclosure()
          });
          handle.wrapper = doc.createElement("li");
          handle.wrapper.dataset.timelineNodeId = segment.id;
          handle.wrapper.appendChild(handle.root);
          list.appendChild(handle.wrapper);
          rowHandles.set(segment.id, handle);
        } else {
          handle.setText(segment.text);
          handle.setRunning(Boolean(segment.tail));
        }
        return handle.wrapper;
      };

      /** 建/取一行工具（照抄 DSH `ToolRow`）。 */
      const ensureToolRow = tool => {
        let handle = rowHandles.get(tool.id);
        const summary = toolRowSummary(tool);
        const failed = tool.status === "failed";
        const stopped = tool.status === "cancelled";
        const state = failed ? "error" : stopped ? "stopped" : tool.status === "running" ? "running" : "ok";
        if (!handle) {
          const icon = doc.createElement("span");
          icon.textContent = toolPresentation.toolIcon(tool.name);
          handle = dshRows.toolRow({
            toolName: str(tool.name),
            variant: "others",
            title: toolPresentation.toolLabel(tool.name, tool.arguments),
            icon,
            summary,
            state,
            statusText: toolPresentation.statusText(tool.status),
            input: tool.arguments,
            output: failed ? str(tool.error?.message || tool.error?.code, "调用失败") : tool.result,
            disclosure: dshRows.createDisclosure()
          });
          handle.wrapper = doc.createElement("li");
          handle.wrapper.dataset.timelineNodeId = tool.id;
          handle.wrapper.appendChild(handle.root);
          list.appendChild(handle.wrapper);
          rowHandles.set(tool.id, handle);
        } else {
          handle.setSummary(summary);
          handle.setState(state);
          /** 结果到达后补展开体（首次建行时 result 还是 null）。 */
          handle.setResult({
            input: tool.arguments,
            output: failed ? str(tool.error?.message || tool.error?.code, "调用失败") : tool.result
          });
        }
        return handle.wrapper;
      };
      /** ⚠️ **保留的旧思考行渲染器 —— 当前无调用方** —— 现行实现是 `ensureThoughtRow`（照抄 DSH `ReasoningRow`）。 */
      // eslint-disable-next-line no-unused-vars
      const legacyEnsureThought = segment => {
        const existing = [...list.children].find(item => item.dataset.timelineNodeId === segment.id);
        let line = existing;
        /**
         * **思考行：默认折叠，对外只显示概要；展开看全文。**
         *
         * 结构与工具行同形（`<details>` + `summary`），所以同一套 24px 行高、
         * 同一套箭头与展开行为 —— 轨迹读起来是一条整齐的列表。
         *
         * 概要是"这一行讲什么"：工具行给参数摘要，思考行就给**首行**（去掉
         * 加粗标记、压成一行）。概要为空时该行不可展开（`data-expandable="0"`）。
         */
        if (line && !line.querySelector(".agent-thought-body")) { line.remove(); line = null; }
        if (!line) {
          line = doc.createElement("li");
          line.dataset.timelineNodeId = segment.id;
          const summary = doc.createElement("summary");
          const icon = doc.createElement("span");
          icon.className = "agent-row-icon";
          icon.textContent = "💭";
          const title = doc.createElement("span");
          title.className = "agent-row-title";
          title.textContent = "思考";
          const sep = doc.createElement("span");
          sep.className = "agent-row-sep";
          const textWrap = doc.createElement("span");
          textWrap.className = "agent-row-summary";
          const text = doc.createElement("span");
          text.className = "agent-row-summary-text";
          textWrap.appendChild(text);
          const state = doc.createElement("span");
          state.className = "agent-row-state";
          const chevron = doc.createElement("span");
          chevron.className = "agent-row-chevron";
          chevron.textContent = "▶";
          summary.append(icon, title, sep, textWrap, state, chevron);
          const body = doc.createElement("div");
          body.className = "agent-row-body";
          const pre = doc.createElement("pre");
          pre.className = "agent-thought-text";
          body.appendChild(pre);
          line.append(summary, body);
          line.dataset.thought = "1";
          // 新建的 `li` 必须显式挂进列表，否则它不参与渲染。
          list.appendChild(line);
        }
        const text = line.querySelector(".agent-thought-text");
        if (text && text.textContent !== segment.text) text.textContent = segment.text;
        const summaryText = line.querySelector(".agent-row-summary-text");
        const outline = thoughtOutlineOf(segment.text, Boolean(segment.tail));
        if (summaryText && summaryText.textContent !== outline) summaryText.textContent = outline;
        line.className = "agent-row";
        line.dataset.expandable = outline ? "1" : "0";
        line.dataset.preview = outline ? "1" : "0";
        // 流式尾段（`segment.tail`）是唯一默认展开的一段，其余默认折叠只留概要。
        line.dataset.running = segment.tail ? "1" : "0";
        line.dataset.streaming = segment.tail ? "1" : "0";
        if (segment.tail && !line.dataset.touched) line.open = true;
        /** 用户手动拨过就记住，不由内容变化决定开合。 */
        if (!line.dataset.bound) {
          line.dataset.bound = "1";
          line.addEventListener("toggle", () => { if (line.open) line.dataset.touched = "1"; });
        }
        return line;
      };
      /**
       * 一条线性流：思考行与工具行**按发生时间排成同一条**，没有分组标题、没有折叠面板。
       */
      const entries = [
        ...(turn.steps || []).flatMap(step => (step.tools || []).map(tool => ({ kind: "tool", at: Number(tool.startedAt) || Number(step.startedAt) || 0, tool }))),
        /**
         * **思考段全部进列表**（含最后一段 tail）。
         *
         * ⚠️ 不能 `.filter(segment => !segment.tail)`：tail 段正是"AI 现在在想什么"，
         * 滤掉它正文里就看不到当前思考。全部思考都按时间排在这条线性流里，
         * 没有独立的「思考过程」折叠盒（见 `standaloneReasoning`）。
         */
        ...reasoningSegments(message).map(segment => ({ kind: "thought", at: segment.at, segment }))
      ].sort((a, b) => (a.at - b.at) || (a.kind === "thought" ? -1 : 1));
      for (const entry of entries) {
        if (entry.kind === "thought") { ensureThoughtRow(entry.segment); ordered.push({ id: entry.segment.id, at: entry.at }); continue; }
        const tool = entry.tool;
        /**
         * **工具行交给照抄的原语**（`dsh-rows.js` 的 `toolRow` ← DSH `ToolRow.tsx`）。
         *
         * `ensureToolRow` 内部走 `DisclosureRow` 原语，**结构与 DSH 一一对应**。
         * 下面那段自建 `<summary>` + `.agent-row-*` 的代码整块跳过
         * （保留在 `legacyEnsureRow` 里）。
         */
        const line = ensureToolRow(tool);
        ordered.push({ id: tool.id, at: Number(tool.startedAt) || 0 });
        continue;
        /* eslint-disable no-unreachable -- 上面 `continue` 之后是保留的旧实现 */
        const legacy = legacyEnsureRow(tool.id);
        legacy.className = "agent-row";
        let summary = legacy.querySelector("summary");
        if (!summary) {
          const parts = agentRowParts(legacy);
          legacy.dataset.expandable = "1";
          parts.icon.textContent = toolPresentation.toolIcon(tool.name);
          parts.title.textContent = toolPresentation.toolLabel(tool.name, tool.arguments);
          parts.text.textContent = toolRowSummary(tool);
          /** 状态不进可见文字，只给读屏软件（DSH 的 `ToolRow.state` 用法）。 */
          parts.state.textContent = "";
          parts.summary.setAttribute("aria-label", [parts.title.textContent, parts.text.textContent, toolPresentation.statusText(tool.status)].filter(Boolean).join(" · "));
          for (const node of toolRowDetail(tool)) parts.body.appendChild(node);
          /** 界面显示中文名；注册名与 callId 留在 tooltip 里 —— 排查时要能对回工具本身。 */
          legacy.title = [str(tool.name), str(tool.callId)].filter(Boolean).join(" · ");
        } else {
          /** 摘要在每一帧都可能变（失败原因/结果到达），所以每次都比一次文本。 */
          const text = legacy.querySelector(".agent-row-summary-text");
          const nextText = toolRowSummary(tool);
          if (text && text.textContent !== nextText) text.textContent = nextText;
          /** 结果到达后把详情补上（首次建行时 result 还是 null）。 */
          const body = legacy.querySelector(".agent-row-body");
          if (body && !body.childElementCount) for (const node of toolRowDetail(tool)) body.appendChild(node);
        }
        legacy.dataset.running = tool.status === "running" ? "1" : "0";
        const failed = tool.status === "failed";
        legacy.dataset.state = failed ? "error" : tool.status === "cancelled" ? "warning" : "done";
        ordered.push({ id: tool.id, at: Number(tool.startedAt) || 0 });
      }
      const keep = new Set(ordered.map(row => row.id));
      for (const line of [...list.children]) if (!keep.has(line.dataset.timelineNodeId)) line.remove();
      for (const row of ordered) {
        const line = [...list.children].find(item => item.dataset.timelineNodeId === row.id);
        if (line) list.appendChild(line);
      }
      /** 末尾一行小字：跑的时候显示在调什么，跑完自己隐藏。 */
      const running = (turn.steps || []).flatMap(step => step.tools || []).filter(tool => tool.status === "running").at(-1);
      const status = container.querySelector(".agent-stream-status");
      if (status) {
        status.textContent = running ? toolPresentation.runningText(running.name, running.arguments) : "";
        status.hidden = !running;
      }
    }
    /**
     * 过程列表里的条目数（**工具调用 + 最终回答**）—— 为 0 就是"什么都还没发生"。
     * ⚠️ 步骤标题行不单独成行（一个调用一行，见 `updateExecutionTimeline`），所以不计它。
     */
    function turnEntryCount(turn) {
      return (turn?.steps || []).reduce((sum, step) => sum + (step.tools || []).length, 0) + (turn?.answers || []).length;
    }
    /**
     * 往**过程流**里加一块：永远插在正文之前。
     *
     * 线性流的顺序就是"创建顺序"（= 事件到达顺序），而正文必须是最后一块 ——
     * 于是这里统一用"插到 `.body` 前面"，而不是 `appendChild`。
     * 宿主不是流容器（用户消息、旧结构）时退回 `appendChild`。
     */
    function appendToFlow(host, node, afterNode = null) {
      if (!host || !node) return;
      /** 期望位置：如果给了 `afterNode` 就紧跟它，否则"在 .body 之前、其余兄弟之后"。 */
      const anchor = afterNode || [...(host.children || [])].find(child => child.classList?.contains("body")) || null;
      /** ⚠️ **已经在正确位置就什么都不做。**
       *  重插一个已在 DOM 里的节点会先移除再插入，浏览器会因此重算 `:hover`
       *  并重启 CSS 过渡 —— 流式写入每约 50ms 走一次这里，悬停状态被反复重置，
       *  表现就是鼠标停在生成中的对话上会**频闪**。 */
      if (anchor ? node.nextElementSibling === anchor : host.lastElementChild === node) return;
      if (anchor) host.insertBefore(node, anchor); else host.appendChild(node);
    }
    /**
     * 把累加的思考按锚点切成若干段。锚点是每个展示事件上的 `reasoningAt`
     * （"此刻思考攒了多少字"）—— 数据层没有"每轮思考从哪开始"的结构。
     *
     * @param {object} message 会话消息
     * @returns {Array<{id:string,at:number,text:string,tail:boolean}>} `tail` 是最后一个锚点
     *          之后、还没对应任何事件的那段；没有锚点（老消息或整轮无展示事件）时返回一整段
     */
    /**
     * 把一条消息的推理切成"一条条思考"。
     *
     * **优先用 `message.thoughtSegments`**（运行时在推理到达时就冻结好的段落，
     * 只增不裁、`seq` 单调）—— 这样段的 id 永远稳定，界面就不会把已有的思考行
     * 删掉重建（重建会让思维链忽隐忽现）。
     *
     * 没有冻结段落时（老消息）才退回**按事件锚点切分**：
     * 锚点是"事件发生时已累积的思考长度"，靠它把整段推理按时间切开。
     * ⚠️ 这条兼容路径依赖 `message.events`，而它有 256 条上限 —— 老了会被裁，
     * 切分就会变。所以它只是兜底，不是主路径。
     */
    function reasoningSegments(message) {
      const reasoning = str(message?.reasoning);
      if (!reasoning) return [];
      /**
       * 主路径：冻结段落 + 当前还在累积的尾巴。
       *
       * 运行时的冻结时机是"工具调用到达"，所以**最后一段还没冻结** ——
       * 那一段就是"AI 现在在想什么"，作为 `tail` 补在末尾。
       */
      const frozen = Array.isArray(message?.thoughtSegments) ? message.thoughtSegments : [];
      if (frozen.length) {
        const segments = frozen.map((row, index) => ({
          id: `thought:${Number.isFinite(Number(row.seq)) ? Number(row.seq) : index}`,
          at: Number(row.at) || index,
          text: str(row.text),
          tail: false
        })).filter(segment => segment.text.trim());
        const consumed = frozen.reduce((sum, row) => sum + str(row.text).length, 0);
        const rest = reasoning.slice(consumed);
        if (rest.trim()) segments.push({ id: "thought:tail", at: Number.MAX_SAFE_INTEGER, text: rest, tail: true });
        if (segments.length) return segments;
      }
      const anchors = (message?.events || [])
        .filter(event => event && Number.isFinite(Number(event.reasoningAt)))
        .map((event, index) => ({
          id: `thought:${event.seq ?? event.at ?? index}`,
          at: Number(event.at) || 0,
          length: Math.max(0, Math.min(reasoning.length, Number(event.reasoningAt)))
        }))
        .filter(anchor => anchor.length > 0)
        .sort((a, b) => a.length - b.length);
      if (!anchors.length) return [{ id: "thought:all", at: 0, text: reasoning, tail: true }];
      const segments = [];
      let start = 0;
      for (const anchor of anchors) {
        if (anchor.length <= start) continue;
        const text = reasoning.slice(start, anchor.length);
        if (text.trim()) segments.push({ id: anchor.id, at: anchor.at, text, tail: false });
        start = anchor.length;
      }
      const rest = reasoning.slice(start);
      if (rest.trim()) segments.push({ id: "thought:tail", at: Number.MAX_SAFE_INTEGER, text: rest, tail: true });
      return segments;
    }
    /**
     * 独立"思考过程"框里该显示哪一段：
     * 有锚点时只显示**尾巴**（其余段落已经按时间插进过程列表里），否则显示整块。
     */
    function standaloneReasoning(message, fallback = "") {
      const segments = reasoningSegments(message);
      if (!segments.length) return str(fallback);
      /**
       * ⚠️ **有锚点时返回空串** —— 思考已经按时间排进线性流，再画独立盒子会看两遍。
       *
       * 只有"完全没有锚点"的老消息（`reasoningSegments` 会给一整段 tail）才需要
       * 这个独立盒子 —— 那种消息没有事件可供交错，流里排不出顺序。
       */
      const hasAnchors = segments.some(segment => !segment.tail);
      return hasAnchors ? "" : segments.map(segment => segment.text).join("\n\n");
    }
    function renderExecutionTimeline(row, message, turn = executionTurnFor(message)) {
      /**
       * 空回合不画流 —— 否则刚起手（或投影还没收到步骤）时会冒出一块空壳。
       *
       * ⚠️ 判据是**思考段 + 工具/回答**，不只是工具。
       *
       * 只按 `turnEntryCount(turn)`（工具数 + 回答数）判的话，**只思考、没调工具**
       * 的一轮整条流都不画 —— 思考被冻在 `thoughtSegments` 里却一条都显示不出来。
       */
      if (!turn || (!turnEntryCount(turn) && !reasoningSegments(message).length)) return null;
      /** 思考行由会话侧维护：已有流时就地更新，不重建（见 `updateActivityTimeline`）。 */
      const existing = row.querySelector?.(".draw-activity[data-timeline-kind='execution']");
      if (existing) { updateExecutionTimeline(existing, turn, message); return existing; }
      const stream = doc.createElement("div");
      stream.className = "draw-activity agent-stream";
      stream.dataset.timelineKind = "execution";
      /**
       * **线性流：没有分组、没有折叠。**
       *
       * 把所有工具行装进 `<details class="agent-group">` 的话，收起时只剩
       * 一行「工具调用 · N」—— 那就又变回"一张折叠面板"了。而 Agent 的调用
       * 就是**一行一行按发生顺序**排的：思考一行、工具一行、再思考一行……
       */
      const list = doc.createElement("ol");
      const status = doc.createElement("div");
      status.className = "agent-stream-status";
      status.hidden = true;
      stream.append(list, status);
      appendToFlow(row, stream);
      updateExecutionTimeline(stream, turn, message);
      return stream;
    }
    function renderActivityTimeline(row, message) {
      const execution = executionTurnFor(message);
      if (execution) return renderExecutionTimeline(row, message, execution);
      /*
       * 回退路径：把原始事件流折叠成与投影路径同一套行 ——
       * 事件先归并成"每次调用一条"（`tool/call`+`tool/result` 优先，退回 `tool.start`+`tool.complete`），
       * 每行是 `图标 · 中文名 · 参数摘要` 的可展开条目（状态不进可见文字），整组收进一个
       * 可折叠的「工具调用 · N」。
       */
      const activity = Array.isArray(message?.events) && message.events.length
        ? message.events
        : Array.isArray(message?.activity) ? message.activity : [];
      if (!activity.length) return null;

      const rows = activityRows(activity);
      if (!rows.length) return null;
      const stream = doc.createElement("div");
      stream.className = "draw-activity agent-stream";
      /** 同上：线性流，不分组、不折叠。 */
      const list = doc.createElement("ol");
      stream.appendChild(list);

      /** 行交给共用的渲染器（原地更新时也走它，保证两条路径同一套行）。 */
      syncActivityRows(list, rows, message);

      appendToFlow(row, stream);
      return stream;
    }
    /**
     * **原地同步轨迹行** —— 按 `data-timeline-node-id` 复用已有行。
     *
     * 只对"新增/删除"动 DOM：复用已有节点意味着浏览器不必重算 `:hover`、
     * 不会重启过渡，鼠标停在轨迹上也就不会频闪。
     */
    function syncActivityRows(list, rows, message) {
      /** 行 key 用列表里的**位置**：同一位置就是同一行（原地更新，不重建节点）。 */
      const keys = rows.map((item, index) => `${message.id}:act:${index}`);
      /**
       * ⚠️ **先把当前子节点快照下来再用。**
       *
       * 直接读 `list.children` 的话，遍历过程中我们自己在 `remove()` /
       * `appendChild()`，**读的是活的集合**，于是"按 key 找行"会漏找：
       * 漏找的结果是新建一行，而老行因为 key 不在 `keep` 里被删掉 ——
       * 表现为**同一件事的行反复消失重建**。
       */
      const live = [...list.children];
      const byKey = new Map(live.map(child => [child.dataset.timelineNodeId, child]));
      /** 删掉不需要的行。 */
      const keep = new Set(keys);
      for (const child of live) if (!keep.has(child.dataset.timelineNodeId)) child.remove();
      /** 按顺序补齐 / 复用。 */
      rows.forEach((item, index) => {
        const key = keys[index];
        let line = byKey.get(key) || null;
        if (line && !line.isConnected) line = null;
        if (!line) {
          line = doc.createElement("li");
          line.dataset.timelineNodeId = key;
          /**
           * **思考行与工具行同形**（都是 `<details>`，默认折叠、概要一行）——
           * 与投影路径的 `ensureThought` 同一套结构，两条路径产出同一种视觉。
           */
          if (item.thought) {
            line.className = "agent-row";
            const parts = agentRowParts(line);
            line.dataset.expandable = "1";
            parts.icon.textContent = "💭";
            parts.title.textContent = item.title;
            const pre = doc.createElement("pre");
            pre.className = "agent-thought-text";
            pre.textContent = str(item.plain);
            parts.body.appendChild(pre);
          } else {
            line.className = "agent-row";
            const parts = agentRowParts(line);
            line.dataset.expandable = "1";
            parts.icon.textContent = toolPresentation.toolIcon(item.name);
            parts.title.textContent = item.title;
            parts.summary.setAttribute('role', 'button');
            parts.summary.tabIndex = 0;
            const toggle = () => {
              const open = !line.hasAttribute('open');
              line.toggleAttribute('open', open);
              if (open) {
                parts.body.replaceChildren(...toolRowDetail(line.__activityTool || item.tool));
                line.dataset.detailsRendered = '1';
              }
            };
            parts.summary.addEventListener('click', toggle);
            parts.summary.addEventListener('keydown', event => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault(); toggle();
            });
          }
        }
        // 思考行也写摘要区：概要由全文推出（流式段取最后一段完成段落的首行），不是工具参数。
        if (item.thought) {
          const outline = thoughtOutlineOf(item.plain, Boolean(item.running));
          const outlineNode = line.querySelector(".agent-row-summary-text");
          if (outlineNode && outlineNode.textContent !== outline) outlineNode.textContent = outline;
          const thoughtSummary = line.querySelector(".agent-row-summary");
          if (thoughtSummary) thoughtSummary.setAttribute("aria-label", [item.title, outline].filter(Boolean).join(" · "));
          line.dataset.preview = outline ? "1" : "0";
          line.dataset.expandable = outline ? "1" : "0";
          line.dataset.running = item.running ? "1" : "0";
          return;
        }
        const parts = {
          text: line.querySelector(".agent-row-summary-text"),
          summary: line.querySelector(".agent-row-summary")
        };
        // 只在真的变了才写：相同内容重写也会让浏览器重算 `:hover`。
        if (parts.text && parts.text.textContent !== item.summary) parts.text.textContent = item.summary;
        const aria = [item.title, item.summary, item.stateWord].filter(Boolean).join(" · ");
        if (parts.summary && parts.summary.getAttribute("aria-label") !== aria) parts.summary.setAttribute("aria-label", aria);
        line.__activityTool = item.tool;
        if (line.hasAttribute('open')) {
          line.querySelector('.agent-row-body')?.replaceChildren(...toolRowDetail(item.tool));
          line.dataset.detailsRendered = '1';
        }
        line.dataset.running = item.running ? "1" : "0";
        line.dataset.state = item.stateWord === "失败" ? "error" : item.stateWord === "已取消" ? "warning" : "done";
        line.dataset.preview = item.summary ? "1" : "0";
      });
      /**
       * 排序：只在顺序真的不对时才搬节点。
       *
       * `insertBefore` 对"已经在目标位置"的节点是空操作，但**先做一次比较**
       * 更省：顺序没变时一次 DOM 都不动，也就不会重置 `:hover`。
       * 这里同样不能一边读活集合一边改它 —— 所以用上面那份快照。
       */
      rows.forEach((item, index) => {
        const line = byKey.get(keys[index]);
        if (!line || !line.isConnected) return;
        const current = list.children[index] || null;
        if (current !== line) list.insertBefore(line, current);
      });
    }
    /**
     * 把原始事件流归并成每次调用一行。
     *
     * 两套事件：`tool/call` + `tool/result`（带 `callId` / `arguments` / `error`，信息全）
     * 与 `tool.start` + `tool.complete`（只有 `name` / `args` / `result`）。
     * 优先用前者；没有 `callId` 时按出现顺序与工具名配对。
     */
    function activityRows(activity) {
      const byCallId = new Map();
      const order = [];
      for (const item of activity) {
        const type = str(item?.type);
        if (type === "thinking" || type === "reasoning") {
          const body = str(item.text || item.message);
          if (!body) continue;
          /**
           * 思考事件 → **铺开的思考行**（不是可折叠行）。
           *
           * `plain` 带上全文，由 `syncActivityRows` 走 `.agent-thought` 那条渲染分支；
           * 与投影路径的思考段是同一种形状 —— 两条路径产出同一套视觉。
           */
          order.push({
            thought: true, name: "", title: "思考",
            summary: body.replace(/\s+/g, " ").slice(0, 100),
            plain: body,
            running: false, stateWord: ""
          });
          continue;
        }
        if (type === "tool/call" || type === "tool.start" || type === "tool") {
          const callId = str(item.callId) || `loose-${order.length}`;
          const args = item.arguments || item.args || {};
          byCallId.set(callId, {
            thought: false,
            name: str(item.name),
            arguments: args,
            result: null, error: null,
            status: "running",
            title: toolPresentation.toolLabel(item.name, args),
            summary: "", detail: [], running: true, stateWord: "执行中"
          });
          order.push(callId);
          continue;
        }
        if (type === "tool/result" || type === "tool.complete") {
          const callId = str(item.callId);
          // 没有 callId 就退回到"最后一条还在跑的同名调用"。
          const key = callId && byCallId.has(callId)
            ? callId
            : [...order].reverse().find(id => {
              const row = byCallId.get(id);
              return row && row.name === str(item.name) && row.status === "running";
            });
          const target = key ? byCallId.get(key) : null;
          if (!target) continue;
          const failed = item.ok === false || item.result?.ok === false || Boolean(item.error);
          target.status = failed ? "failed" : "done";
          target.result = item.data ?? item.result ?? null;
          target.error = item.error || item.result?.error || null;
          continue;
        }
      }
      const rows = [];
      for (const entry of order) {
        const item = typeof entry === "string" && byCallId.has(entry) ? byCallId.get(entry) : entry;
        if (!item || typeof item !== "object") continue;
        if (!item.thought) {
          const tool = { name: item.name, arguments: item.arguments, status: item.status, result: item.result, error: item.error };
          item.summary = toolRowSummary(tool);
          item.tool = tool;
          item.running = item.status === "running";
          item.stateWord = toolPresentation.statusText(item.status);
        }
        rows.push(item);
      }
      return rows;
    }
    function updateActivityTimeline(messageSnapshot = null) {
      const host = $("#talkConv");
      const message = messageSnapshot || assistant?.currentSession?.()?.messages?.at(-1);
      if (!host || !message) return;
      const row = [...host.children].find(item => item.dataset?.messageId === message.id);
      if (!row) return;
      /** 过程块一律画进**过程流**（正文所在的那个容器），否则它会落到答案下面。 */
      const flow = $(".tflow", row) || row;
      const details = $(".draw-activity", row);
      const execution = executionTurnFor(message);
      if (execution) {
        if (!details || details.dataset.timelineKind !== "execution") {
          details?.remove();
          renderExecutionTimeline(flow, message, execution);
        } else updateExecutionTimeline(details, execution, message);
        return;
      }
      /*
       * 回退路径尽量复用已存在的组，不要每帧删掉重建（流式期间约 50ms 跑一次）。
       * 分组元素本身就是 `.draw-activity.agent-stream`，与回退路径产物同类，所以能交给
       * 同一个渲染器原地更新；只有"投影 ↔ 回退"互相切换（结构不同）时才先删。
       */
      /** 已有流就地同步行（不重建节点，避免重置悬停）；没有才新建。 */
      if (details) {
        const list = details.querySelector("ol");
        const activity = Array.isArray(message?.events) && message.events.length
          ? message.events
          : Array.isArray(message?.activity) ? message.activity : [];
        if (list && activity.length) { syncActivityRows(list, activityRows(activity), message); return; }
      }
      /**
       * ⚠️ **不要在这里删掉已有的过程流。**
       *
       * 删掉再重画的话，只要 `executionTurnFor` 这一刻返回空（投影还没收到这个
       * turn、或 messageId/requestId 一时对不上），**整条流连同已经画好的思考行
       * 就一起没了**，而且不会自己回来 —— 表现为"思维链输出完之后看不到内容"。
       *
       * 过程块是展示性的：宁可留着上一帧的样子，也不能整块消失。
       * 真要换结构（投影 ↔ 回退）时，交给 `renderActivityTimeline` 自己判断。
       */
      if (details && details.dataset.timelineKind === "execution") return;
      renderActivityTimeline(flow, message);
    }
    function updateStreamingCandidates() {
      const host = $("#talkConv");
      const session = assistant?.currentSession?.();
      const message = session?.messages?.at(-1);
      if (!host || !message) return;
      const row = [...host.children].find(item => item.dataset?.messageId === message.id);
      if (!row || !messageHasRender(message)) return;
      /**
       * 直接交给渲染器 —— 它是幂等的（自己会先移除旧的候选卡）。
       * 在调用点各删一次的话，三个调用点行为不一致，图会累加。
       */
      renderCandidateCards(row, message);
      const candidates = $(".draw-candidates", row);
      const below = $(".generation-public-replies", row) || $(".draw-final-prompt", row);
      if (candidates && below) row.insertBefore(candidates, below);
      talkScroll();
    }
    /** `message.candidates` 优先；没有就用 `candidatesFromImages()` 从 imageIds 归一。 */
    function messageCandidates(message) {
      if (Array.isArray(message?.candidates) && message.candidates.length) return message.candidates;
      if (Array.isArray(message?.result?.candidates) && message.result.candidates.length) return message.result.candidates;
      return candidatesFromImages(message);
    }
    /**
     * 把 `message.imageIds` 归一成候选行（补齐 `comfy.render` 那条只写 `imageIds` 的路）。
     *
     * `slotNo` 取会话图编号，拿不到就按顺序编号 —— 只用于显示与排序，不参与判断。
     *
     * @param {object} message 会话消息
     * @returns {Array} 候选行
     */
    function candidatesFromImages(message) {
      const ids = Array.isArray(message?.imageIds) ? message.imageIds.filter(id => typeof id === "string" && id) : [];
      if (!ids.length) return [];
      /** 单张图的 prompt 就是这一轮的最终 prompt（编排器那条路会给更细的每张 Tag）。 */
      const prompt = cleanPromptText(message?.result?.finalPrompt || message?.result?.prompt);
      const negative = cleanPromptText(message?.result?.negative);
      return ids.map((imageId, index) => {
        const resolved = fullImageFor(imageId);
        const slotNo = Number(resolved?.slotNo) || 0;
        return {
          id: str(resolved?.candidateId) || `image-${imageId}`,
          imageId,
          slotNo,
          iteration: index + 1,
          roundIndex: 1,
          prompt,
          negative,
          ...(slotNo > 0 ? {} : {})
        };
      });
    }
    /**
     * 画候选卡。**幂等**：已有候选卡先移除再画。
     *
     * ⚠️ 结尾是 `row.appendChild(host)`，无条件追加。三个调用点
     * （首建行 / 就地更新 / `updateStreamingCandidates`）在流式期间会反复触发，
     * 谁都不先删旧的话**每重绘一次就多一批图**。
     *
     * 把"先删旧"放在这里而不是各个调用点：幂等是渲染器自己的责任，
     * 靠调用点记得删迟早漏一个。
     */
    function renderCandidateCards(row, message) {
      const candidates = messageCandidates(message);
      if (!candidates.length) return false;
      /** 旧的先走 —— 放在最前，后面的提前 return 也不影响幂等。 */
      row.querySelector(":scope > .draw-candidates")?.remove();
      const selectedId = str(message.result?.finalCandidateId || message.result?.selectedCandidateId);
      const host = doc.createElement("div");
      host.className = "draw-candidates";
      const outcome = str(message.result?.outcome);
      const recreationMode = str(message.result?.recreationMode);
      const aspectRatioMode = str(message.result?.aspectRatioMode);
      if (outcome || recreationMode || aspectRatioMode) {
        const delivery = doc.createElement("section");
        delivery.className = "generation-delivery";
        delivery.dataset.outcome = outcome;
        const badges = doc.createElement("div");
        badges.className = "generation-delivery-badges";
        const addBadge = (kind, label) => {
          if (!label) return;
          const badge = doc.createElement("span");
          badge.className = `generation-delivery-badge ${kind}`;
          badge.textContent = label;
          badges.appendChild(badge);
        };
        const outcomeLabels = {
          primary_selected: localized("ui.ai.outcomePrimarySelected", "主 AI 选择的候选"),
          user_selected: localized("ui.ai.outcomeUserSelected", "用户最终选择")
        };
        const recreationLabels = {
          reference_image: localized("ui.ai.recreationReference", "参考图已进入工作流"),
          text_approximation: localized("ui.ai.recreationTextApproximation", "文本近似复刻")
        };
        const aspectLabels = {
          source_matched: localized("ui.ai.aspectSourceMatched", "已匹配原图宽高比"),
          workflow_fixed: localized("ui.ai.aspectWorkflowFixed", "工作流固定尺寸")
        };
        addBadge("outcome", outcomeLabels[outcome] || outcome);
        addBadge("recreation", recreationLabels[recreationMode]);
        addBadge("aspect", aspectLabels[aspectRatioMode]);
        delivery.appendChild(badges);
        host.appendChild(delivery);
      }
      const roundTracks = new Map();
      const ensureRoundTrack = roundIndex => {
        if (roundTracks.has(roundIndex)) return roundTracks.get(roundIndex);
        const group = doc.createElement("section");
        group.className = "draw-round";
        group.dataset.roundIndex = String(roundIndex);
        const roundHeading = doc.createElement("h4");
        roundHeading.className = "draw-round-heading";
        roundHeading.textContent = `第 ${roundIndex} 轮`;
        const track = doc.createElement("div");
        track.className = "draw-round-track";
        group.append(roundHeading, track);
        host.appendChild(group);
        roundTracks.set(roundIndex, track);
        return track;
      };
      candidates.forEach(candidate => {
        const roundIndex = Number(candidate.roundIndex) || 1;
        const roundTrack = ensureRoundTrack(roundIndex);
        const card = doc.createElement("article");
        card.className = "draw-candidate";
        if (candidate.id === selectedId || candidate.selected) card.classList.add("selected");
        const head = doc.createElement("div");
        head.className = "draw-candidate-head";
        const title = doc.createElement("strong");
        /** 名字与用户、AI 三方统一：有会话图编号就用它，没有才退回渲染次序。 */
        const slotNo = Number(candidate.slotNo) || 0;
        title.textContent = slotNo > 0 ? `会话图 ${slotNo}` : `第 ${Number(candidate.iteration) || 1} 次渲染`;
        const state = doc.createElement("span");
        state.className = "draw-candidate-state";
        state.textContent = candidate.id === selectedId || candidate.selected ? "最终选择" : "候选";
        head.append(title, state);
        card.appendChild(head);
        const image = candidateImage(candidate);
        const imageSource = candidateImageSource(candidate, image);
        if (imageSource) {
          const wrap = doc.createElement("div");
          wrap.className = "draw-candidate-image";
          wrap.dataset.imageId = str(candidate?.imageId || image?.imageId || "");
          wrap.title = "点击查看大图";
          const preview = doc.createElement("img");
          preview.src = imageSource;
          preview.alt = `第 ${Number(candidate.iteration) || 1} 次生成图片`;
          preview.loading = "lazy";
          /** 缩略图解码失败就退回原图，别留一个空白框。 */
          preview.addEventListener("error", () => {
            const fallback = image?.dataUrl || image?.viewUrl || "";
            if (fallback && preview.src !== fallback) preview.src = fallback;
          });
          wrap.appendChild(preview);
          wrap.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            openImageViewer({ imageId: wrap.dataset.imageId, source: image?.dataUrl || image?.viewUrl || imageSource, title: `第 ${Number(candidate.iteration) || 1} 次渲染` });
          });
          card.appendChild(wrap);
        } else {
          // 解析不到图源时画占位（带上 imageId 便于排查），不静默跳过。
          const placeholder = doc.createElement("div");
          placeholder.className = "draw-candidate-image is-missing";
          placeholder.dataset.imageId = str(candidate?.imageId);
          placeholder.textContent = candidate?.imageId
            ? `图片暂时读不出来（imageId=${str(candidate.imageId)}）`
            : "这张候选没有关联图片";
          card.appendChild(placeholder);
        }
        const tags = doc.createElement("details");
        tags.className = "draw-candidate-tags";
        const tagsSummary = doc.createElement("summary");
        tagsSummary.textContent = "查看本轮 Tag";
        const addTagSection = (labelText, value, kind) => {
          const section = doc.createElement("section"); section.className = `draw-candidate-tag-section ${kind}`;
          const header = doc.createElement("div"); header.className = "draw-candidate-tag-head";
          const label = doc.createElement("strong"); label.textContent = labelText;
          const button = doc.createElement("button"); button.type = "button"; button.className = "draw-candidate-tag-copy btn btn-secondary"; button.textContent = localized("ui.ai.copyTagSection", "复制"); button.disabled = !str(value);
          button.onclick = async event => { event.preventDefault(); if (await copy(value)) notify(`${labelText}已复制`); };
          const body = doc.createElement("pre"); body.textContent = str(value, "未使用");
          header.append(label, button); section.append(header, body); tags.appendChild(section);
        };
        tags.appendChild(tagsSummary);
        addTagSection(localized("ui.ai.positiveTags", "正向 Tag"), cleanPromptText(candidate.prompt), "positive");
        if (settings().generateNegativeTags === true) addTagSection(localized("ui.ai.negativeTags", "负向 Tag"), cleanPromptText(candidate.negative), "negative");
        card.appendChild(tags);
        const running = message.status === "streaming" || ["preparing", "compiling", "rendering", "evaluating", "revising", "selecting", "finishing"].includes(message.result?.status);
        if (running && message.result?.decisionRequired === true) {
          const decision = doc.createElement("div");
          decision.className = "draw-candidate-decision";
          decision.textContent = localized("ui.ai.primaryDecisionPending", "主 AI 正在判断下一步");
          card.appendChild(decision);
        }
        /**
         * 继续优化的入口按钮。`baseCandidateId` **不能**给默认值：AI 要整合各图优缺点
         * 或重新生成 Tag 时，"默认等于当前最终图"是错的。
         */
        const actions = doc.createElement("div");
        actions.className = "draw-candidate-actions";
        const choose = doc.createElement("button");
        choose.type = "button";
        choose.className = "draw-candidate-choose btn btn-primary";
        choose.textContent = candidate.id === selectedId || candidate.selected ? "已选为最终结果" : "设为最终结果";
        choose.disabled = candidate.id === selectedId || candidate.selected;
        choose.onclick = async () => {
          const result = assistant?.selectGenerationFinal ? await assistant.selectGenerationFinal(message.id, candidate.id) : assistant?.chooseCandidate?.(message.id, candidate.id, "user");
          if (result) { renderTalk(); notify(`已选择第 ${Number(candidate.iteration) || 1} 次结果`); }
        };
        actions.append(choose);
        card.appendChild(actions);
        roundTrack.appendChild(card);
      });
      row.appendChild(host);
      return true;
    }
    /**
     * 工具事件的进度文案。
     *
     * `seq` 由调用方给（`handleTalkToolEvent` 传本事件的序号），
     * 用于挡住**迟到的事件**把已经前进的文案压回去。`seq` 为 0 时不做防回退
     * （旧调用点与"直接给一句结论"的场景）。
     */
    function toolProgress(selector, event, seq = 0) {
      if (event?.type === "round.start") { setTalkStatus("AI 处理中…", seq); return; }
      if (!event) return;
      if (event.type === "ai-start") { setTalkStatus(`AI 正在思考（第 ${Number(event.round) || 1} 轮）…`, seq); return; }
      // 工具名一律走 `toolPresentation`（键是注册名）；`tool/call` / `tool/result`
      // 与 `tool.start` / `tool.complete` 两套事件都认。
      const args = event.args || event.arguments;
      if (event.type === "event" && event.event?.type === toolPresentation.PROGRESS_EVENT && event.name) {
        setTalkStatus(`${toolPresentation.toolLabel(event.name, args)} 排队中（队列 ${Number(event.event.queue) || 0}）…`, seq);
        return;
      }
      const action = toolPresentation.toolAction(event.type, event.name, args, event.error || event.result?.error);
      if (action) setTalkStatus(action.text, seq);
    }
    function compactTalkStatus(result, fallback = "请求失败") {
      if (result?.ok !== false) return fallback;
      const code = str(result.error?.code || result.code).toUpperCase();
      return code === "CANCELLED" ? "已取消" : code === "TIMEOUT" ? "请求超时" : code === "AUTH_FAILED" ? "认证失败" : code === "OUTPUT_INVALID" ? "输出格式无效" : fallback;
    }
    // 进度行的单一写入者：每条文案带单调递增序号，只接受更新的那一句，
    // 迟到的旧事件压不回已经前进的状态。
    let talkStatusSeq = 0;
    /**
     * 写进度文案。
     *
     * @param {string} value 文案（空串不写：`.talk-status:empty` 有自己的可见性规则）
     * @param {number} [minSeq] 这条文案所属事件的序号；比已写下的序号小就直接丢弃
     * @param {string} [state] 圆点颜色语义：`running` / `queued` / `done` / `cancelled` / `error`
     */
    function setTalkStatus(value, minSeq = 0, state = "running") {
      const el = $("#talkStatus");
      if (!el) return;
      const next = str(value);
      /** 空文案不写：`.talk-status:empty` 有自己的可见性规则，写空等于抹掉进度行。 */
      if (!next) return;
      if (Number(el.dataset.statusSeq || 0) > minSeq) return;
      talkStatusSeq += 1;
      el.dataset.statusSeq = String(talkStatusSeq);
      el.dataset.status = state;
      el.textContent = next;
      el.hidden = false;
    }
    /**
     * 出一个**结论性**文案（"完成""已取消"这类）：它必须压过任何在途事件。
     * 做法是把序号一次推高 1000，随后到达的旧事件序号必然更小，于是压不回来。
     */
    function concludeTalkStatus(value, state = "done") {
      const el = $("#talkStatus");
      if (!el) return;
      const next = str(value);
      if (!next) return;
      talkStatusSeq += 1000;
      el.dataset.statusSeq = String(talkStatusSeq);
      el.dataset.status = state;
      el.textContent = next;
    }
    function handleTalkToolEvent(event) {
      /** 本事件的序号：迟到的事件带着小序号，写不进去。 */
      const eventSeq = talkStatusSeq;
      toolProgress("#talkStatus", event, eventSeq);
      toolProgress("#talkStatus", event);
      updateActivityTimeline();
      const type = event?.type || "";
      if (type === "assistant.message") {
        updateStreamingTalk();
        /**
         * 程序播报顺带刷新**状态栏**：播报说什么，状态栏就说什么。
         */
        if (str(event.summary)) setTalkStatus(str(event.summary), eventSeq);
      }
      /**
       * **插队成功** —— 运行时已把这条消息并进本轮对话，会话里也落成了一条 user 消息。
       *
       * 必须显示出来：不显示的话用户根本判断不了"插进去没有"。
       * 从按下插队到真正生效，中间可能隔着几十秒的工具执行。
       *
       * 消息是服务端**先落库再广播**的，所以这里重绘拿到的是事实，不是乐观更新。
       */
      if (type === "user/steer" || type === "steer/applied") {
        const applied = str(event.payload && typeof event.payload === "object" ? event.payload.text : event.text);
        invalidateImageCache();
        renderTalk();
        renderQueueDock();
        if (applied) setTalkStatus(`已插队：${applied.slice(0, 40)}`, eventSeq);
      }
      if (type === "generation.started") setTalkStatus(event.outputType === "tags" ? "正在准备 Tag 生成任务…" : "正在准备绘图任务…", eventSeq);
      if (type === "source.inspected") setTalkStatus("参考原图分析完成", eventSeq);
      if (type === "prompt.compiled") setTalkStatus("Tag 已生成", eventSeq);
      if (type === "baseline.prompt") setTalkStatus(event.details?.source === "reference" ? "正在按参考图相关 Tag 生成首轮候选…" : "正在按当前绘图 Tag 生成候选…", eventSeq);
      if (type === "candidate.rendering") setTalkStatus(`正在生成第 ${Number(event.iteration) || 1} 张候选（尝试 ${Number(event.attempt) || 1}）…`, eventSeq);
      if (type === "candidate.ready" || type === "candidate-ready") {
        if (event.candidate?.id && event.candidate?.previewUrl) ui.candidatePreviews[event.candidate.id] = event.candidate.previewUrl;
        invalidateImageCache();
        updateStreamingCandidates();
        updateActivityTimeline();
        setTalkStatus(`已收到第 ${Number(event.iteration || event.candidate?.iteration) || 1} 张候选`, eventSeq);
      }
      if (type === "prompt.revised") setTalkStatus("已按修改意见修订 Tag，准备下一张候选…", eventSeq);
      if (type === "generation.needs_input") setTalkStatus(event.needsInput?.message || "生成任务需要补充信息", eventSeq);
      if (type === "generation.awaiting_feedback") setTalkStatus(event.decisionRequired ? "主 AI 正在判断下一步…" : "本轮完成，等待点评", eventSeq);
      /** 结论性事件：把序号推高，避免迟到的事件把"完成/失败/取消"压回中间态。 */
      if (type === "generation.completed") {
        /** 新图落盘了，清缓存让它们能被解析出来。 */
        invalidateImageCache();
        updateStreamingCandidates();
        concludeTalkStatus(event.outputType === "tags" ? "Tag 生成完成" : "绘图任务完成");
      }
      if (type === "generation.failed") concludeTalkStatus(event.error?.message || "生成任务失败", "error");
      if (type === "generation.cancelled") concludeTalkStatus("生成任务已取消", "cancelled");
      /**
       * 工具调用额度不足：程序已把**用户自己写的那段警告**追加进 system
       * （就在工具说明后面，见 `agent-runtime.js`），事件与它同源。
       * 状态栏显示事件里带的同一句话 —— 用户在活动流与状态栏两处都能看到这件事发生过。
       */
      if (type === "tool.budgetLow") setTalkStatus(event.message || `工具调用只剩 ${Number(event.remaining) || 0} 次：已要求 AI 立即交付`, eventSeq);
      if (event?.name === "comfy.render" && (type === "start" || type === "tool.start")) setTalkStatus("ComfyUI 渲染中…", eventSeq);
      if (event?.name === "comfy.render" && (type === "complete" || type === "tool.complete") && event.result?.ok !== false) setTalkStatus("已收到 ComfyUI 返图", eventSeq);
    }
    function talkScroll(force = false) {
      const host = $("#talkConv");
      if (!host) return;
      const key = "#talkConv";
      // `scroll` 事件不会因内部 reasoning `<pre>` 改变而触发：若上次是程序滚到底、
      // 而这次布局前 scrollTop 已被用户改变，先视为用户离底，避免流式更新抢回位置。
      if (!force && ui.comfyFollow[key] !== false && ui.talkScrollLastTop != null && host.scrollTop !== ui.talkScrollLastTop) {
        ui.comfyFollow[key] = false;
        return;
      }
      if (force || ui.comfyFollow[key] !== false) {
        host.scrollTop = host.scrollHeight;
        ui.talkScrollLastTop = host.scrollTop;
      }
    }
    function scrollTalkTo(position) {
      const host = $("#talkConv");
      if (!host) return;
      const top = position === "top" ? 0 : host.scrollHeight;
      ui.comfyFollow["#talkConv"] = position !== "top";
      if (typeof host.scrollTo === "function") host.scrollTo({ top, behavior: "smooth" });
      else host.scrollTop = top;
      ui.talkScrollLastTop = top;
    }
    let acceptingTalk = false;
    async function sendTalk(reply = null, attachmentIds = null) {
      if (acceptingTalk) return {ok:false,error:{code:'SESSION_BUSY',message:'SESSION_BUSY: 正在受理发送'}};
      const text = typeof reply?.text === 'string' ? reply.text : String($('#talkIn')?.value || '');
      const imageIds = Array.isArray(attachmentIds) ? [...attachmentIds] : ui.sendDrafts.map(d => d.imageId);
      const sessionId = currentTalkSessionId();
      if (!text.trim() && !imageIds.length) return {ok:false,error:{message:'请输入内容或先添加图片'}};
      acceptingTalk = true; setTalkBusy(true, '发送');
      try {
        await views.settings?.flush?.();
        const result = await assistant.run({sessionId,text,imageIds,...(reply?.parts ? {parts:reply.parts} : {})});
        if (result?.ok === false) notify(result.error?.message || '发送失败');
        renderTalk(); renderConversationRepository(); return result;
      } catch (error) {
        return { ok: false, error: { message: error.message || String(error) } };
      } finally { acceptingTalk = false; setTalkBusy(assistant.snapshot().busy, '发送'); }
    }
    function confirmClearConversation() {
      const session = assistant?.currentSession?.();
      if (!session) return;
      const message = formatText(localized("ui.ai.clearConversationConfirm", "确定清空当前对话的 {count} 条消息吗？对话图片将保留。"), { count: session.messages?.length || 0 });
      confirm(message, async () => {
        const result = await assistant.clearSession(session.id);
        if (result?.ok === false) return notify(result.error.message);
        renderManager(); renderTalk(); renderConversationRepository();
      });
    }
    async function openTagEditor(item) { const id = item?.id || item?.en; return tagEditor?.open(id ? { tagId: id, mode: 'taxonomy' } : { initialValues: { kind: 'tag', content: item?.en || '', displayName: item?.zh || '' }, mode: 'taxonomy' }); }
    async function openTagGroupEditor(item) { const id = item?.id; return tagGroupEditor?.open(id ? { groupId: id } : { initialValues: item || {} }); }
    async function exportSessionText() {
      const result = await assistant.exportSessions();
      if (typeof result !== 'string') { notify(result?.error?.message || '导出失败'); return ''; }
      return result;
    }
    function renderManager() {
      const host = $("#mgrGenList");
      if (!host) return;
      const sessionList = assistant?.sessions?.() || [];
      const current = sessionList.length ? assistant?.currentSession?.() : null;
      put("#mgrSessionCount", sessionList.length);
      put("#mgrMessageCount", sessionList.reduce((sum, session) => sum + session.messageCount, 0));
      put("#mgrGenCur", current?.title || "暂无当前对话");
      put("#mgrChatCur", current ? `${current.messages.length} 条消息` : "从助手页新建一条对话");
      if (!ui.managerList) {
        ui.managerList = global.ConversationManagement.createConversationList({
          document: doc,
          onOpen: async id => {
            const result = await assistant.switchSession(id);
            if (result?.ok === false) return notify(result.error.message);
            invalidateImageCache();
            renderTalk(); renderConversationRepository(); showAi('talk');
          },
          onRenameRequest: renameConversation,
          onDeleteRequest: id => {
            const session = assistant.sessions().find(row => row.id === id);
            confirmDeleteConversation(session, async retainImages => {
              const result = await assistant.deleteSession(id, { retainImages });
              if (result?.ok === false) notify(result.error.message);
              invalidateImageCache(); renderTalk(); renderConversationRepository();
            });
          },
        });
        host.replaceChildren(ui.managerList.root);
        $("#mgrExport").onclick = async () => {
          const text = await exportSessionText();
          if (!text) return;
          const blob = new Blob([text], {
            type: "application/json",
          });
          const link = doc.createElement("a");
          link.href = URL.createObjectURL(blob);
          link.download = "sessions.toolbox-session.json";
          link.click();
          setTimeout(() => URL.revokeObjectURL(link.href), 500);
        };
        $("#mgrImport").onclick = () => $("#mgrImportFile")?.click();
        $("#mgrImportFile").onchange = (event) => {
          const file = event.target.files?.[0];
          if (file)
            readText(file).then(async (value) => {
              const result = await assistant?.importSessions?.(value, false); if (result?.ok === false || result === false) return notify(result?.error?.message || "导入失败");
              renderManager();
            });
        };
        $("#mgrClear").onclick = confirmClearConversation;
        $("#mgrBack").onclick = () => showAi('talk');
      }
      ui.managerList.update({ sessions: sessionList, currentId: assistant.currentId() });
    }
    let aiTabRequestId = 0;
    function showAi(tab) {
      const requestId = ++aiTabRequestId;
      const nextTab = [
        "talk",
        "prompt",
        "api",
        "comfy",
        "mgr",
      ].includes(tab)
        ? tab
        : "talk";
      const origin = ui.route;
      const loading = ensureViews(aiViews(nextTab));
      if (loading) return loading.then(() => {
        if (disposed || requestId !== aiTabRequestId || ui.route !== origin) return false;
        return applyAiTab(nextTab);
      }).catch(error => { if (!disposed && requestId === aiTabRequestId) notify(error.message); return false; });
      return applyAiTab(nextTab);
    }
    function applyAiTab(nextTab) {
      if (ui.aiTab === "api" && nextTab !== "api") flushSettingsSave();
      if (ui.aiTab === "comfy" && nextTab !== "comfy") views.comfy?.flush?.().catch(error => notify(error?.message || String(error)));
      ui.aiTab = nextTab;
      if (ui.route === 'ai') show('#sidebar', nextTab !== 'mgr');
      doc.body.classList.toggle('conversation-manager-mode', ui.route === 'ai' && nextTab === 'mgr');
      if (ui.aiTab === "talk") ui.comfyFollow["#talkConv"] = true;
      const panelSelectors = {
        talk: "#tabTalk",
        prompt: "#tabPrompt",
        api: "#tabApi",
        comfy: "#tabComfy",
        mgr: "#tabMgr",
      };
      Object.values(panelSelectors).forEach((selector) => show(selector, false));
      show(panelSelectors[ui.aiTab], true);
      if (ui.aiTab === "talk" && !ui.talkRendered) {
        ui.talkRendered = true;
        renderTalk();
        renderConversationRepository();
      }
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
      if (ui.aiTab === "comfy") { views.comfy?.render(settings()).catch(error => notify(error?.message || String(error))); views.settings?.render(settings()); views.comfy?.refresh?.(); }
      if (ui.aiTab === "mgr") renderManager();
      ensureVisionPanePlacement();
      return true;
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
    let routeRequestId = 0;
    function route(next) {
      const requestId = ++routeRequestId;
      const required = next === 'ai' ? aiViews(ui.aiTab) : ['favorites', 'translation', 'characters'].includes(next) ? [next] : [];
      const enter = () => {
        if (disposed || requestId !== routeRequestId) return false;
        applyRoute(next); return true;
      };
      const loadAndEnter = () => {
        if (disposed || requestId !== routeRequestId) return false;
        const loading = ensureViews(required);
        return loading ? loading.then(enter).catch(error => { if (!disposed && requestId === routeRequestId) notify(error.message); return false; }) : enter();
      };
      if (catalog && next !== ui.route) return (async () => {
        if (await tagEditor?.requestClose?.() === false || await views.characters?.requestClose?.() === false) return false;
        if (ui.route === 'favorites' && await views.favorites?.leave?.() === false) return false;
        return loadAndEnter();
      })().catch(error => { if (!disposed && requestId === routeRequestId) notify(error.message); return false; });
      if (ui.route === "favorites" && next !== "favorites") {
        return Promise.resolve(views.favorites?.leave?.()).then(async saved => {
          if (saved === false || requestId !== routeRequestId) return false;
          return loadAndEnter();
        }).catch(error => { if (!disposed && requestId === routeRequestId) notify(error.message); return false; });
      }
      return loadAndEnter();
    }
    function applyRoute(route) {
      if (ui.route !== route) aiTabRequestId++;
      if (ui.route === "ai" && ui.aiTab === "api" && route !== "ai") flushSettingsSave();
      if (ui.route === "ai" && ui.aiTab === "comfy" && route !== "ai") views.comfy?.flush?.().catch(error => notify(error?.message || String(error)));
      if (ui.route === "translation" && route !== "translation") views.translation?.leave?.();
      if (ui.route !== route) {
        clearTimeout(ui.searchTimer);
        const input = $("#q");
        if (ui.route === "characters") ui.characterQuery = str(input?.value);
        if (route === "characters" && input) input.value = ui.characterQuery ?? "";
        if (route === "tags" && input) input.value = tagSnapshot().query;
      }
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
      doc.body.classList.toggle('conversation-manager-mode', ai && ui.aiTab === 'mgr');
      if (ai && !wasAi) ui.aiTab = wasGallery ? ui.aiTabBeforeGallery : ui.aiTab;
      const shell = $("#wrapEl");
      const aiView = $("#aiView");
      if (shell && aiView && aiView.parentElement !== shell)
        shell.appendChild(aiView);
      show("#workspaceModeBar", route === "tags" || route === "characters");
      show("#tagLibraryView", route === "tags");
      const charactersView = $("#charactersView");
      if (charactersView) {
        charactersView.hidden = route !== "characters";
        charactersView.style.display = route === "characters" ? "" : "none";
      }
      const galleryView = $("#galleryView");
      if (galleryView) { galleryView.hidden = route !== "gallery"; galleryView.style.display = route === "gallery" ? "" : "none"; }
      const favoriteView = $("#favoritesView");
      if (favoriteView) { favoriteView.hidden = route !== "favorites"; favoriteView.style.display = route === "favorites" ? "" : "none"; }
      show(".main", !ai);
      show("#aiView", ai);
      show("#aiCfgBtns", ai);
      show("#sidebar", !["translation", "gallery", "favorites"].includes(route));
      show("#catList", route === "tags" || route === "characters");
      show("#addTagBtn", route === "tags" && ui.tagArea === "tags");
      show("#addGroupBtn", route === "tags" && ui.tagArea === "groups");
      show("#sideAi", ai);
      // 选择栏是全局工作区底栏，切换翻译/AI 时仍保留当前 Tag 组合。
      show(".bar", route !== "gallery");
      const search = $("#searchWrap");
      if (search) {
        const searchHidden = ai || route === "gallery" || route === "favorites";
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
        if (active) views.translation?.enter?.();
      }
      doc.body.classList.toggle("aiview", ai);
      doc.body.classList.toggle("translation-mode", route === "translation");
      doc.body.classList.toggle("characters-mode", route === "characters");
      doc.body.classList.toggle("favorites-mode", route === "favorites");
      syncNavigationStates();
      ensureVisionPanePlacement();
      if (ai) {
        renderVisionPreview();
        renderTalkVisionPanel();
        scheduleCapabilitiesStatus();
        showAi(ui.aiTab);
      }
      if (route === "gallery") renderGallery();
      if (route === "favorites") views.favorites?.enter?.();
      if (route === "tags" && !wasTags) {
        // Off-screen catalog changes invalidate queries but do not redraw hidden
        // cards. Re-enter with current shared Tags and favorite memberships.
        renderCategories();
        renderTags();
      }
      if (route === "characters") {
        renderCategories();
        put("#catTitle", localized('ui.characters.library', '角色库'));
        put("#catCnt", String(Number(characters?.count?.() || 0)));
        syncTagModeTabs();
        renderCharacters();
      }
    }
    function applyTheme(value) {
      const theme = str(value, "light");
      const dark =
        theme === "dark" ||
        (theme === "auto" &&
          global.matchMedia?.("(prefers-color-scheme: dark)").matches);
      doc.body.classList.toggle("dark", dark);
      preferences.set("app.theme", theme);
      // 报给主进程的是**真正生效**的深浅色（`dark`）而不是 `theme` 字面量：`auto` 要落到实际外观。
      // 主进程据此更新窗口底色并写 `window-theme.json`，下次启动建窗口时用它避免闪白。
      try { global.AppLaunch?.theme?.(dark ? "dark" : "light"); } catch { /* 底色只是体验优化 */ }
      $$(".popitem[data-theme]").forEach((item) => {
        const check = $(".ck", item);
        if (check) check.textContent = item.dataset.theme === theme ? "✓" : "";
      });
    }
    function locale(id, options = {}) {
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
      doc.documentElement.lang = id;
      ui.locale = id;
      preferences.set("app.locale", id);
      const localizedTitle = localized("ui.document.title", doc.title);
      if (localizedTitle) doc.title = localizedTitle.replace(/V1\.4\.1/g, `V${modules.version || "1.4.92"}`);
      put("#brandSub", `V${modules.version || "1.4.92"}`);
      updateVersionBadge();
      decorateWorkspaceControls();
      if (options.render === false) return;
      syncNavigationStates();
      /**
       * 切语言要**重画链路表**：行里的按钮与标签都是 `localized()` 现取的文本，
       * 不像静态块那样有 `data-i18n` 属性可以再翻译一遍（这里是它的替代品，
       * 旧的 `syncApiMode()` 就是干这件事的）。`fetch: false`：切语言不该顺带发网络请求。
       */
      renderLinkList({ fetch: false });
      renderConversationRepository();
      renderCategories();
      if (ui.route === "characters") renderCharacters();
      else renderTags();
      views.favorites?.refreshLocale?.();
      renderSelection();
      renderTalkVisionPanel();
      setVisionOpen(ui.visionOpen);
      if (ui.route === "gallery") renderGallery();
      if (ui.aiTab === "prompt") renderPrompt();
    }

    function updateVersionParts(value) {
      const match = str(value).replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)$/);
      return match ? match.slice(1).map(Number) : [0, 0, 0];
    }
    function updateCompare(left, right) {
      const a = updateVersionParts(left), b = updateVersionParts(right);
      for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
      return 0;
    }
    function updateFormat(key, fallback, values = {}) { return formatText(localized(`ui.updates.${key}`, fallback), values); }
    function updateVersionBadge() {
      const current = ui.versionManager.currentVersion || str(modules.version);
      const newer = ui.versionManager.rows.some(row => row.installable && !row.current && updateCompare(row.version, current) > 0);
      const badge = $("#brandSub");
      badge?.classList.toggle("version-update-available", newer);
      if (badge) badge.title = newer ? updateFormat("available", "有新版本可用") : updateFormat("title", "查看版本和更新");
    }
    function renderVersionManager() {
      const modal = $("#versionModal"), list = $("#versionList"), state = ui.versionManager;
      if (!modal || !list) return;
      put("#versionCurrent", updateFormat("current", "当前版本：{version}", { version: `V${state.currentVersion || modules.version || "未知"}` }));
      const status = $("#versionStatus");
      if (status) { status.textContent = state.error || state.status || ""; status.classList.toggle("error", Boolean(state.error)); }
      const progress = $("#versionProgress");
      if (progress) { progress.hidden = !state.progress; progress.value = state.progress?.total ? Math.min(100, state.progress.received / state.progress.total * 100) : 0; }
      list.replaceChildren();
      if (!state.rows.length) {
        if (!state.error && !state.busy) { const empty = doc.createElement("p"); empty.className = "hint"; empty.textContent = updateFormat("none", "没有可用版本"); list.append(empty); }
        updateVersionBadge(); return;
      }
      for (const row of state.rows) {
        const item = doc.createElement("div"); item.className = `version-row${row.current ? " current" : ""}`; item.dataset.updateVersion = row.version;
        const info = doc.createElement("div");
        const title = doc.createElement("div"); title.className = "version-row-title"; title.textContent = `${row.name || ""} V${row.version} ${row.current ? `· ${updateFormat("using", "正在使用")}` : ""}`.trim();
        const meta = doc.createElement("div"); meta.className = "version-row-meta"; meta.textContent = [row.channel === "installed" ? updateFormat("local", "本地版本") : row.channel === "prerelease" ? updateFormat("prerelease", "测试版") : updateFormat("stable", "稳定版"), row.installed ? updateFormat("installed", "已安装") : "", row.publishedAt || ""].filter(Boolean).join(" · ");
        info.append(title, meta);
        const actions = doc.createElement("div"); actions.className = "version-row-actions";
        if (!row.current) {
          const button = doc.createElement("button"); button.type = "button"; button.className = "abtn btn btn-secondary"; button.dataset.updateAction = "install"; button.textContent = row.installed ? updateFormat("switch", "切换") : updateFormat("install", "下载并切换"); button.disabled = state.busy || (!row.installed && !row.installable); actions.append(button);
        }
        item.append(info, actions); list.append(item);
      }
      updateVersionBadge();
    }
    async function refreshVersionList() {
      const updates = modules.updates; if (!updates) return;
      ui.versionManager.busy = true; ui.versionManager.error = ""; ui.versionManager.status = updateFormat("checking", "正在检查 GitHub Releases…"); renderVersionManager();
      try {
        const state = await updates.getState?.() || {};
        ui.versionManager.currentVersion = str(state.activeVersion, str(modules.version));
        const installed = (state.installed || []).map(row => ({ version: row.version, channel: "installed", installed: true, current: row.version === ui.versionManager.currentVersion, installable: false, assets: {} }));
        ui.versionManager.rows = installed;
        renderVersionManager();
        const releases = await updates.listReleases?.() || [];
        ui.versionManager.rows = [...releases, ...installed.filter(row => !releases.some(release => release.version === row.version))];
        const newer = ui.versionManager.rows.some(row => row.installable && !row.current && updateCompare(row.version, ui.versionManager.currentVersion) > 0);
        ui.versionManager.status = newer ? "" : releases.some(row => row.installable)
          ? updateFormat("upToDate", "当前没有可用更新版本，已是最新版本。")
          : updateFormat("unpublished", "暂未发布支持在线更新的版本，当前版本可以继续使用。");
      } catch {
        ui.versionManager.status = "";
        ui.versionManager.error = updateFormat("offline", "暂时无法连接 GitHub，未能检查更新。请检查网络或代理后重试；仍可切换已安装版本。");
      }
      finally { ui.versionManager.busy = false; renderVersionManager(); }
    }
    async function installVersion(version) {
      const updates = modules.updates, row = ui.versionManager.rows.find(item => item.version === version);
      if (!updates || !row || row.current || ui.versionManager.busy) return;
      ui.versionManager.busy = true; ui.versionManager.error = ""; ui.versionManager.status = row.installed ? updateFormat("restarting", "版本已准备好，程序即将重启。") : updateFormat("checking", "正在准备版本…"); renderVersionManager();
      try {
        if (row.installed) await updates.switchInstalled(version);
        else {
          const staged = await updates.download(version);
          await updates.applyStaged(version, staged.stagedDirectory);
        }
        ui.versionManager.status = updateFormat("restarting", "版本已准备好，程序即将重启。");
      } catch (error) { ui.versionManager.error = updateFormat("failed", "版本切换失败：{message}", { message: error?.message || String(error) }); ui.versionManager.busy = false; renderVersionManager(); }
    }
    function openVersionManager() {
      if (!modules.updates) return notify("当前版本不支持版本管理");
      ui.versionManager.open = true; $("#versionModal")?.classList.add("show"); refreshVersionList();
    }
    function closeVersionManager() { if (ui.versionManager.busy) return; ui.versionManager.open = false; $("#versionModal")?.classList.remove("show"); }

    function toggleThemeMenu(event) {
      event?.stopPropagation?.();
      const pop = $("#themePop");
      if (pop) pop.hidden = !pop.hidden;
    }
    function toggleLocaleMenu(event) {
      event?.stopPropagation?.();
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
    function bindConversationColumnResize() {
      const grid = $("#sideAi");
      const grip = $("#talkColumnResize");
      if (!grid || !grip) return;
      const key = "ai.sessionColumnWidth";
      const stored = preferences.get(key);
      let preferred = typeof stored === "number" && Number.isFinite(stored) && stored > 0 ? stored : null;
      let drag = null;
      const defaultWidth = () => global.innerWidth <= 1100 ? 112 : 132;
      function paint(value = preferred) {
        const available = grid.getBoundingClientRect().width || (global.innerWidth <= 1100 ? 286 : 328);
        const max = Math.max(96, Math.min(280, available - 124));
        const width = Math.round(Math.max(96, Math.min(max, value ?? defaultWidth())));
        grid.style.setProperty("--ai-session-width", `${width}px`);
        grip.setAttribute("aria-valuemin", "96");
        grip.setAttribute("aria-valuemax", String(max));
        grip.setAttribute("aria-valuenow", String(width));
        grip.setAttribute("aria-valuetext", `${width} 像素`);
        return width;
      }
      function finish(save) {
        if (!drag) return;
        const previous = drag;
        drag = null;
        if (save) {
          preferred = Number.parseFloat(grid.style.getPropertyValue("--ai-session-width"));
          preferences.set(key, preferred);
        } else paint();
        doc.body.classList.remove("resizing-ai-columns");
        try { grip.releasePointerCapture?.(previous.id); } catch { /* capture already released */ }
      }
      listen(grip, "pointerdown", event => {
        if (event.button !== 0 || global.innerWidth <= 900 || ui.route !== "ai" || drag) return;
        event.preventDefault();
        drag = { id: event.pointerId, x: event.clientX, width: paint() };
        doc.body.classList.add("resizing-ai-columns");
        try { grip.setPointerCapture?.(event.pointerId); } catch { /* window listeners still track the drag */ }
      });
      listen(global, "pointermove", event => {
        if (!drag || event.pointerId !== drag.id) return;
        if (global.innerWidth <= 900 || ui.route !== "ai") return finish(false);
        paint(drag.width + event.clientX - drag.x);
      });
      listen(global, "pointerup", event => {
        if (drag && event.pointerId === drag.id) finish(global.innerWidth > 900 && ui.route === "ai");
      });
      listen(global, "pointercancel", event => { if (drag && event.pointerId === drag.id) finish(false); });
      listen(grip, "lostpointercapture", () => finish(false));
      listen(global, "blur", () => finish(false));
      listen(global, "resize", () => { finish(false); paint(); });
      listen(grip, "keydown", event => {
        if (global.innerWidth <= 900 || ui.route !== "ai" || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        preferred = paint(paint() + (event.key === "ArrowRight" ? 10 : -10));
        preferences.set(key, preferred);
      });
      listen(grip, "dblclick", () => {
        if (global.innerWidth <= 900 || ui.route !== "ai") return;
        finish(false);
        preferred = null;
        preferences.set(key, null);
        paint();
      });
      removeListeners.push(() => finish(false));
      paint();
    }
    function bindNavigation() {
      Object.entries(navActionConfig).forEach(([name, config]) => {
        const button = $(config.selector);
        if (!button || typeof config.run !== "function") return;
        button.dataset.navAction = name;
        listen(button, "click", event => {
          config.run(event);
          syncNavigationStates();
        });
      });
      syncNavigationStates();
    }

    function bind() {
      bindConversationColumnResize();
      listen($("#brandSub"), "click", openVersionManager);
      listen($("#brandSub"), "keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openVersionManager(); } });
      listen($("#versionModalClose"), "click", closeVersionManager);
      listen($("#versionModal"), "click", event => {
        if (event.target === $("#versionModal")) { closeVersionManager(); return; }
        const button = event.target.closest("[data-update-action=install]");
        const row = button?.closest("[data-update-version]");
        if (row) void installVersion(row.dataset.updateVersion);
      });
      if (modules.updates?.onEvent) ui.versionManager.offEvent = modules.updates.onEvent(event => {
        if (event?.type !== "progress") return;
        ui.versionManager.progress = event;
        renderVersionManager();
      });
      listen($("#tagModeTabs"), "click", async event => {
        const mode = event.target.closest("[data-tag-mode]")?.dataset.tagMode;
        if (!mode) return;
        if (mode === 'characters') { await route('characters'); return; }
        if (ui.route !== 'tags' && await route('tags') === false) return;
        ui.tagArea = mode === "groups" ? "groups" : "tags";
        ui.hiddenTagsOpen = false;
        ui.visible = 400;
        ui.selectedGroupId = "";
        ui.expandedGroups.clear();
        ui.tagPageCache.clear();
        renderTags();
      });
      const openGroupEditorFromSelection = async () => {
        const memberTagIds = selectedIds().filter(id => tags?.get?.(id)?.kind === "tag");
        if (memberTagIds.length < 2) return notify(localized("ui.tag.groupNeedSelection", "请先选择至少两个普通 Tag"));
        const result = await tagGroupEditor?.open?.({ initialValues: { content: memberTagIds.join(", "), displayName: "", memberTagIds } });
        if (result === false) notify(localized("ui.tag.groupCreateFailed", "创建标签组失败"));
      };
      listen($("#tagGroupCreateFromSelection"), "click", openGroupEditorFromSelection);
      listen($("#addGroupBtn"), "click", openGroupEditorFromSelection);
      listen($('#tagLibraryView > .toolbar'), 'click', event => {
        if (!event.target.closest('[data-hidden-tags-toggle]')) return;
        ui.hiddenTagsOpen = !ui.hiddenTagsOpen;
        ensureHiddenTagsButton();
        renderTags();
      });
      listen($('#chips'), 'click', async event => {
        const restore = event.target.closest('[data-hidden-tag-restore]');
        if (!restore) return;
        event.preventDefault(); event.stopPropagation();
        const id = restore.dataset.hiddenTagRestore;
        restore.disabled = true;
        const result = await catalog?.execute?.({ type: 'unhideTag', tagId: id });
        if (result?.ok === false) {
          restore.disabled = false;
          notify(result.error?.message || (ui.locale === 'en-US' ? 'Restore failed' : '恢复失败'));
          return;
        }
        notify(ui.locale === 'en-US' ? 'Tag restored' : '标签已恢复');
        ui.tagPageCache.clear();
        renderCategories();
        await renderHiddenTags();
      });
      listen($("#q"), "input", (event) => {
        ui.hiddenTagsOpen = false;
        ui.subcategory = "";
        ui.visible = 400;
        ui.tagPageCache.clear();
        clearTimeout(ui.searchTimer);
        ui.searchTimer = setTimeout(() => {
          if (ui.route === "characters") renderCharacters({ query: event.target.value });
          else {
            tags?.setQuery?.(event.target.value);
            renderTags();
          }
        }, 120);
      });
      listen($("#q"), "keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          clearTimeout(ui.searchTimer);
          executeSearch();
        }
      });
      listen($("#searchBtn"), "click", () => {
        clearTimeout(ui.searchTimer);
        executeSearch();
      });
      listen($("#clearQ"), "click", () => {
        $("#q").value = "";
        if (ui.route === "characters") {
          renderCharacters({ query: "" });
          return;
        }
        ui.subcategory = "";
        ui.tagPageCache.clear();
        tags?.setQuery?.("");
        renderTags();
      });
      listen($("#catList"), "click", (event) => {
        const characterButton = event.target.closest("[data-characters]");
        if (characterButton) {
          clearTimeout(ui.searchTimer);
          route("characters");
          return;
        }
        const button = event.target.closest("[data-cat]");
        if (!button) return;
        if (ui.route !== "tags") route("tags");
        clearTimeout(ui.searchTimer);
        ui.hiddenTagsOpen = false;
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
      listen($("#catList"), "contextmenu", (event) => {
        const button = event.target.closest("[data-custom-category]");
        if (!button) return;
        event.preventDefault(); event.stopPropagation();
        const category = tagSnapshot().categories.find(row => row.id === button.dataset.customCategory);
        const label = category?.name || button.textContent.trim() || '未命名分类';
        confirm(`删除自建分类“${label}”及其中的全部标签吗？`, async () => {
          const result = await command({ type: 'deleteCategory', categoryId: button.dataset.customCategory, mode: 'cascade' });
          if (result.ok) { tags?.setCategory?.('all'); ui.subcategory = ''; renderCategories(); renderTags(); }
        });
      });
      listen($("#subcatNav"), "click", (event) => {
        const remove = event.target.closest("[data-delete-subcategory]");
        if (remove) {
          event.preventDefault(); event.stopPropagation();
          confirm(localized('ui.custom.deleteSubcategoryConfirm', '确定删除这个自建子分类吗？'), async () => {
            const result = await command({ type: 'deleteSubcategory', subcategoryId: remove.dataset.deleteSubcategory });
            if (result.ok) { ui.subcategory = ''; renderSubcategoryNav(tagSnapshot()); renderTags(); }
          });
          return;
        }
        const button = event.target.closest("[data-subcategory]");
        if (!button) return;
        ui.subcategory = str(button.dataset.subcategory);
        ui.visible = 400;
        ui.tagPageCache.clear();
        renderSubcategoryNav(tagSnapshot());
        renderTags();
      });
      listen($("#chips"), "click", async (event) => {
        const groupJump = event.target.closest('[data-tag-group-jump]');
        if (groupJump) {
          event.preventDefault(); event.stopPropagation();
          ui.tagArea = 'groups'; ui.selectedGroupId = groupJump.dataset.tagGroupJump; ui.expandedGroups.clear(); ui.tagPageCache.clear(); tags?.setQuery?.(''); if ($('#q')) $('#q').value = ''; renderTags(); return;
        }
        const expand = event.target.closest("[data-tag-group-expand]");
        if (expand) {
          event.preventDefault(); event.stopPropagation();
          const id = expand.dataset.tagGroupExpand;
          ui.expandedGroups.has(id) ? ui.expandedGroups.delete(id) : ui.expandedGroups.add(id);
          renderTagGroups();
          return;
        }
        const edit = event.target.closest("[data-tag-edit]");
        if (edit) {
          event.preventDefault(); event.stopPropagation();
          openTagEditor(tags?.get?.(edit.dataset.tagEdit) || { id: edit.dataset.tagEdit, en: edit.dataset.tagEdit });
          return;
        }
        const groupEdit = event.target.closest("[data-tag-group-edit]");
        if (groupEdit) {
          event.preventDefault(); event.stopPropagation();
          openTagGroupEditor({ id: groupEdit.dataset.tagGroupEdit });
          return;
        }
        const restore = event.target.closest("[data-tag-restore]");
        if (restore) { event.preventDefault(); event.stopPropagation(); await command({ type: "restoreTag", tagId: restore.dataset.tagRestore }); renderCategories(); renderTags(); return; }
        const favorite = event.target.closest("[data-tag-favorite]");
        if (favorite) {
          event.preventDefault(); event.stopPropagation();
          await favoriteTag(favorite.dataset.tagFavorite);
          return;
        }
        const jump = event.target.closest("[data-character-jump]");
        if (jump) {
          event.preventDefault();
          clearTimeout(ui.searchTimer);
          const query = str(jump.dataset.characterJump);
          ui.characterQuery = query;
          $("#q").value = query;
          // route() 只在"页面模块还没加载"时才是异步的。无条件 await 会把
          // openCharacter() 推到微任务里，正文详情就不在本次点击内打开（用例
          // 与用户可见的跳转时序都依赖同步完成）。
          const entering = route("characters");
          if (entering && typeof entering.then === "function") entering.then(ok => { if (ok !== false) views.characters?.openCharacter?.(query); });
          else if (entering !== false) views.characters?.openCharacter?.(query);
          return;
        }
        const button = event.target.closest("[data-en]");
        if (!button) return;
        if (event.target.closest(".cp")) {
          await copyExact(tags?.copyText?.([button.dataset.en]) || button.dataset.en);
          showChipToast(button, localized("ui.tag.copied", "已复制"));
          return;
        }
        const id = button.dataset.en;
        const current = selectedIds().includes(id);
        const result = await tags?.select?.(id, !current); if (result?.ok === false) { notify(result.error?.message || "选择失败"); return; }
        await copyExact(tags?.copyText?.([id]) || id);
        showChipToast(button, localized("ui.tag.copied", "已复制"));
        syncSelectedClasses();
        renderSelection();
        syncTagModeTabs();
      });
      listen($("#selbox"), "click", async (event) => {
        const canonical = event.target.closest("[data-selection-key]");
        if (canonical) { const key = canonical.dataset.selectionKey, colon = key.indexOf(":"), kind = key.slice(0, colon), id = key.slice(colon + 1); const value = kind === "tag" ? { kind, tagId: id } : kind === "character" ? { kind, characterId: id, includeSeries: false, generalTagIds: [], specificTagIds: [] } : { kind, id, content: canonicalSelected().find(row => row.key === key)?.content || '', displayName: canonicalSelected().find(row => row.key === key)?.displayName || '', adult: Boolean(canonicalSelected().find(row => row.key === key)?.adult) }; await command({ type: "select", selected: false, value }); return; }
        const favoriteButton = event.target.closest("[data-remove-favorite]");
        if (favoriteButton) {
          await favorites?.setSelected?.(favoriteButton.dataset.removeFavorite, false);
           renderSelection(); syncTagModeTabs(); return;
        }
        const characterButton = event.target.closest("[data-remove-character]");
        if (characterButton) {
          await characters?.removeSelection?.(characterButton.dataset.removeCharacter);
          renderSelection(); syncTagModeTabs();
          return;
        }
        const button = event.target.closest("[data-remove]");
        if (button) {
          await tags?.select?.(button.dataset.remove, false);
          syncSelectedClasses();
          renderSelection(); syncTagModeTabs();
        }
      });
      listen($("#clearSel"), "click", async () => {
        if (catalog) await command({ type: "clearSelection" });
        else { await tags?.clearSelection?.(); await characters?.clearSelection?.(); await favorites?.clearSelected?.(); }
        syncSelectedClasses();
          renderSelection(); syncTagModeTabs();
      });
      listen($("#copyAll"), "click", async () => {
        if (await copyExact(combinedSelectionText()))
          notify("Prompt 已复制");
        else notify("复制失败，请检查剪贴板权限");
      });
      listen($("#aiNsfwChk"), "change", (event) => {
        tags?.setAdult?.(event.target.checked);
        renderCategories();
        if (ui.route === "characters") renderCharacters();
        else renderTags();
        renderSelection();
      });
      listen($("#saveFav"), "click", async () => {
        const rawText = combinedSelectionText();
        if (!rawText.trim()) return notify(localized("ui.favorites.selectFirst", "请先选择 Tag 或标签组"));
        await favoriteBundle(rawText);
      });
      $("#scrim")?.addEventListener("click", () => {
        setVisionOpen(false);
      });
      listen($("#addTagBtn"), "click", () => { if (ui.catalogFailed || ui.catalogPending) return; tagEditor?.open({}); });
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
            if (item?.ref) added += 1;
          }
          if (!added && event.target.files?.length) notify(galleryText("uploadFailed", "图片上传失败，请检查文件格式或权限"));
        } catch (error) {
          notify(error?.message || String(error));
        }
        event.target.value = "";
        renderGallery();
      });
      $("#galleryOrder")?.addEventListener("change", event => { ui.galleryOrder = ["oldest", "newest"].includes(event.target.value) ? event.target.value : "oldest"; preferences.set("gallery.order", ui.galleryOrder); renderGallery(); });
      $("#galleryQuery")?.addEventListener("input", event => { ui.galleryQuery = String(event.target.value || "").trim(); renderGallery(); });
      $("#gallerySend")?.addEventListener("click", gallerySendSelectedItems);
      $("#galleryDownload")?.addEventListener("click", () => {
        const selected = galleryRows().filter(item => ui.gallerySelected.has(item.imageId));
        if (!selected.length) return notify(galleryText("selectFirst", "请先选择图片"));
        selected.forEach(galleryDownloadItem);
      });
      $("#galleryDelete")?.addEventListener("click", () => void galleryDeleteSelectedItems());
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
      listen(doc, "click", (event) => {
        if (!event.target.closest(".popwrap")) {
          $("#themePop")?.setAttribute("hidden", "");
          $("#localePop")?.setAttribute("hidden", "");
        }
      });
      syncVisionPaneOffset();
      listen(global, "resize", () => {
        syncVisionPaneOffset();
      });
      $("#talkConv")?.addEventListener("scroll", event => {
        const host = event.currentTarget;
        ui.comfyFollow["#talkConv"] = host.scrollHeight - host.scrollTop - host.clientHeight < 40;
        ui.talkScrollLastTop = host.scrollTop;
      });
      $("#talkScrollTop")?.addEventListener("click", () => scrollTalkTo("top"));
      $("#talkScrollBottom")?.addEventListener("click", () => scrollTalkTo("bottom"));
      // 必须包一层箭头函数：直接传 `sendTalk` 会把点击事件对象当成 `reply`。
      $("#talkSendBtn")?.addEventListener("click", () => sendTalk());
      // 停止按钮只发起取消，进度文案由这一轮的收尾统一决定。
      $("#talkStopBtn")?.addEventListener("click", () => {
        const requested = assistant?.cancel?.();
        if (requested === false) concludeTalkStatus("当前没有正在进行的请求", "cancelled");
      });
      $("#talkIn")?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey) return;
        event.preventDefault();
        /**
         * `Ctrl/Cmd + Enter` = **插队**（让 AI 在这一轮的下一步就看到它）；
         * 单独 Enter = 普通发送（忙时自动变成排队）。对照 DSH 的
         * `input.send.steer` / `input.send.queue` 两个快捷键设置项。
         */
        sendTalk(event.ctrlKey || event.metaKey ? { mode: "steer" } : null);
      });
      $("#talkIn")?.addEventListener("input", resizeTalkInput);
      $("#talkNew")?.addEventListener("click", async () => {
        /** 换会话了，图片解析缓存必须清 —— 否则会拿上一个会话的 URL 去渲染。 */
        invalidateImageCache();
        const result = await assistant.newSession();
        if (result?.ok === false) return notify(result.error.message);
        ui.comfyFollow["#talkConv"] = true;
        renderTalk();
        renderConversationRepository();
      });
      $("#talkManage")?.addEventListener("click", () => showAi("mgr"));
      $("#talkClearImagesBtn")?.addEventListener("click", () => {
        const session = assistant?.currentSession?.();
        if (!session) return;
        confirm(localized("ui.ai.clearConversationImagesConfirm", "确定清空当前对话区的全部图片吗？"), async () => {
          if (!imageApp) {
            await assistant?.clearConversationImages?.({sessionId:session.id});
            renderTalk(); renderConversationRepository(); return;
          }
          const result = await assistant?.clearConversationImages?.({sessionId:session.id}); if (result?.ok === false) return notify(result.error.message);
          invalidateImageCache();
          renderTalk();
          renderConversationRepository();
        });
      });
      $("#talkClearBtn")?.addEventListener("click", confirmClearConversation);
      $("#talkImgBtn")?.addEventListener("click", () =>
        $("#talkImgFile")?.click(),
      );
      $("#talkImgFile")?.addEventListener("change", (event) =>
        addConversationImages(event.target.files)
          .catch(error => notify(error?.message || String(error)))
          .finally(() => { event.target.value = ""; }),
      );
      $("#talkRepositoryColumns")?.addEventListener("change", event => { const value = event.target.value === "single" ? "single" : "two"; preferences.set("conversation.columns", value); renderConversationRepository(); });
      $("#talkRepositoryClearPending")?.addEventListener("click", () => { ui.sendDrafts = []; renderConversationRepository(); });
      $("#talkPendingClear")?.addEventListener("click", () => { ui.sendDrafts = []; renderConversationRepository(); });
      // 图片查看器与右键菜单（ComfyUI 返图点开 / 下载 / 保存到对话区与图库）。
      $("#imgViewerClose")?.addEventListener("click", () => closeImageViewer());
      $("#imgViewer")?.addEventListener("click", event => { if (event.target === $("#imgViewer")) closeImageViewer(); });
      $("#imgViewerDownload")?.addEventListener("click", () => { const state = ui.imgViewer; if (state) downloadImage(state.imageId, state.filename, state.mime); });
      $("#imgViewerToConversation")?.addEventListener("click", () => addImageToConversation(ui.imgViewer?.imageId || ""));
      $("#imgViewerToGallery")?.addEventListener("click", () => { addImageToGallery(ui.imgViewer?.imageId || ""); updateImgViewerActions(); });
      $("#imgCtxMenu")?.addEventListener("click", event => {
        const action = event.target.closest?.("[data-ctx]")?.dataset.ctx;
        const item = ui.imageCtx;
        hideImageContextMenu();
        if (!item || !action) return;
        if (action === "download") downloadImage(item.imageId, item.filename, item.mime);
        if (action === "gallery") addImageToGallery(item.imageId);
      });
      listen(doc, "contextmenu", event => {
        const card = event.target.closest?.(".conversation-image-card");
        if (!card) { hideImageContextMenu(); return; }
        event.preventDefault();
        event.stopPropagation();
        const imageId = str(card.dataset.imageId);
        if (!imageId) return;
        const asset = fullImageFor(imageId);
        showImageContextMenu(event, { imageId, filename: asset?.filename || `${imageId}.png`, mime: asset?.mime || "image/png" });
      });
      listen(doc, "click", event => { if (!event.target.closest?.("#imgCtxMenu")) hideImageContextMenu(); });
      listen(doc.defaultView, "keydown", event => { if (event.key === "Escape") { closeImageViewer(); hideImageContextMenu(); } });
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
      $("#talkComfyOn")?.addEventListener("change", async event => {
        const toggle = event.target;
        const requested = toggle.checked;
        toggle.disabled = true;
        try {
          const saved = await assistant?.setSettings?.({ comfyOn: requested });
          if (!saved || saved.comfyOn !== requested) throw new Error("ComfyUI 绘图开关保存失败");
          toggle.checked = saved.comfyOn;
          syncComfyStatus(ui.comfyCapabilities);
          refreshCapabilitiesStatus({ force: true });
        } catch (error) {
          toggle.checked = settings().comfyOn === true;
          notify(error?.message || "ComfyUI 绘图开关保存失败");
        } finally { toggle.disabled = false; }
      });
      $("#imagesPerRound")?.addEventListener("change", async event => {
        const control = event.currentTarget;
        try {
          const value = Math.max(1, Math.floor(Number(control.value) || 1));
          const saved = await assistant?.setSettings?.({ imagesPerRound: value });
          if (!saved || Number(saved.imagesPerRound) !== value) throw new Error("每轮绘制数量保存失败");
          syncGenerationControls();
        } catch (error) {
          control.value = String(Number(settings().imagesPerRound) || 1);
          notify(error?.message || String(error));
        }
      });
      $("#tpStop")?.addEventListener("click", () => {
        if (!ui.visionBusy) return;
        cancelVisionRequest(true);
        ui.visionDescription = "AI 识图已停止";
        renderTalkVisionPanel();
        show("#tpStop", false);
      });
      $("#tpClearImg")?.addEventListener("click", async () => {
        ui.visionUploadId += 1;
        cancelVisionRequest(true);
        clearVisionResult();
        const result = await visionTempStore?.clear?.(); if (result?.ok === false) return notify(result.error.message);
        renderVisionPreview();
        renderTalkVisionPanel();
        refreshCapabilitiesStatus();
        show("#tpStop", false);
      });
      /**
       * ─────────────── 链路表的交互（全部委托在 `#linkList` 上） ───────────────
       *
       * 行是**动态生成**的（增删 / 上移下移都会动 DOM），所以监听器一律挂容器、
       * 按 `data-link-*` 分派 —— 挂在行上会在重排/删除时留下悬挂的监听器。
       *
       * 保存时机：`change`（失焦）立刻落盘；`input` 只记脏（由 `flushSettingsSave()`
       * 在切标签页/离开 AI 页时兜底），免得把半截地址写进设置。
       */
      $("#linkList")?.addEventListener("click", event => {
        /** 候选那一条：点中就是选它（走的是与手打型号同一条路）。 */
        const 候选 = event.target.closest?.("[data-model]");
        if (候选) {
          const row = 候选.closest?.("[data-link-row]");
          if (row) { 选模型(row, str(候选.dataset.model)); 收候选(row); }
          return null;
        }
        const button = event.target.closest?.("[data-link-action]");
        const row = event.target.closest?.("[data-link-row]");
        if (!button || !row) return;
        const id = str(row.dataset.linkId);
        const action = str(button.dataset.linkAction);
        if (action === "models") return 取列表(row);
        if (action === "up") return moveLinkRow(id, -1);
        if (action === "down") return moveLinkRow(id, 1);
        if (action === "remove") return removeLinkRow(id);
        if (action === "probe") return probeLinkRow(id);
        if (action === "test") return testLinkRow(id);
        if (action === "clearKey") {
          // 「清除已保存 Key」= 空串 + `clearKey: true`：表单投影把密钥投影成空串，
          // 而"空"也意味着"用户没动它"，所以要有这个显式标志来区分。
          const key = rowField(row, "key");
          if (key) key.value = "";
          row.dataset.clearKey = "true";
          saveLinkTable();
          notify(localized("ui.settings.linkKeyCleared", "已清除这条链路的 Key。"));
          return null;
        }
        return null;
      });
      $("#linkList")?.addEventListener("change", event => {
        const field = event.target.closest?.("[data-link-field]");
        const row = event.target.closest?.("[data-link-row]");
        if (!field || !row) return;
        const name = str(field.dataset.linkField);
        if (!["preset", "base", "key", "model"].includes(name)) return;
        if (name === "preset") {
          /** 预设 → 地址框（预设只是"填地址"的快捷方式，地址仍是可编辑的真值）。 */
          const base = str(field.value);
          if (base) setRowValue(rowField(row, "base"), base);
        }
        if (name === "base") syncLinkRowMode(row);
        saveLinkTable({ render: false });
        renderLinkBadges();
        syncLinkRowKeyStatus(row);
        /** 改完地址 / 模型 / Key，这一行的候选与能力结论都要重来一遍（缓存键含 base，换服务商不命中旧缓存）。 */
        const 重来 = name === "key" || name === "preset" || name === "base";
        populateLinkModels(row, { refresh: 重来 }).then(() => 顺带探一探(row));
      });
      $("#linkList")?.addEventListener("input", event => {
        const field = event.target.closest?.("[data-link-field]");
        if (!field || !["base", "key", "model"].includes(str(field.dataset.linkField))) return;
        if (str(field.dataset.linkField) === "key") syncLinkRowKeyStatus(field.closest?.("[data-link-row]"));
        markLinkTableDirty();
      });
      /**
       * **点模型那一格 = 摊开候选 + 现去服务商那边取一次**（实现在 `refreshModelsOnOpen`：
       * 键盘走捕获阶段的 `focus`；60 秒内取过的走缓存）。
       * 点别处 / 按 Esc 收起（候选是异步取回来的，所以收起由这两条说了算，不靠原生的弹出时机）。
       */
      $("#linkList")?.addEventListener("mousedown", refreshModelsOnOpen);
      $("#linkList")?.addEventListener("focus", refreshModelsOnOpen, true);
      listen(doc, "click", 收候选OnOutside);
      listen(doc.defaultView, "keydown", 收候选OnOutside);
      $("#linkAdd")?.addEventListener("click", addLinkRow);
      // `#aiStrict` 当前没有后端字段（`FORM_FIELDS` 里没有 `strict`，核心也没有消费者），
      // 所以不绑保存，避免让人以为它在生效。
      $("#aiTest")?.addEventListener("click", async () => {
        try {
          /** 全局「测试连接」= 链路从上到下各发一次最小请求，第一条通的算数。 */
          const result = await assistant?.testConnection?.();
          if (!result || result.ok === false) throw new Error(str(result?.error?.message || result?.text || result?.error, "AI 连接失败"));
          const link = result.link || result.data?.link || null;
          notify(link ? `AI 连接成功：这次走的是「${str(link.label || link.model, "链路")}」` : "AI 连接成功");
        } catch (error) {
          notify(error.message || String(error));
        }
      });
      $("#aiClearCfg")?.addEventListener("click", () => {
        // 「恢复默认」= 只剩一条空链路：数组里只留一条，其余 id 连同密钥一起删；
        // `clearKey: true` 是显式清除（只写 `key: ""` 会被当成"没输入" = 保留）。
        assistant?.setSettings?.({ links: [{ id: "link-1", label: "", base: "", model: "", clearKey: true }] });
        loadSettings();
      });
      $("#cfmNo")?.addEventListener("click", () => { ui.confirmAction = null; $("#cfmModal")?.classList.remove("show"); });
      $("#cfmYes")?.addEventListener("click", () => { const action = ui.confirmAction; const retain = Boolean($("#cfmRetainImages")?.checked); ui.confirmAction = null; $("#cfmModal")?.classList.remove("show"); action?.(retain); });
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
        const input = event.currentTarget;
        const file = event.target.files?.[0];
        if (!file || comfyPngImporting) return;
        input.disabled = true;
        try { await importWorkflow(file); }
        finally { input.disabled = false; input.value = ""; }
      });
      $("#comfyBack")?.addEventListener("click", () => showAi("talk"));
      $("#tabComfy")?.addEventListener("dragover", (event) => {
        if ([...(event.dataTransfer?.files || [])].some((file) => /\.json$|\.png$/i.test(file.name || ""))) event.preventDefault();
      });
      $("#tabComfy")?.addEventListener("drop", (event) => {
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
        zone.addEventListener("drop", async event => {
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
            if (context === 'conversation') await addImageToConversation(id);
            else if (!ref?.sessionId || ref.sessionId === currentTalkSessionId()) {
              const item = fullImageFor(id); if (item) await selectVisionImage(item);
            }
            return;
          }
          const files = [...(event.dataTransfer?.files || [])].filter(file => file?.type?.startsWith("image/"));
          if (!files.length) return;
          event.preventDefault();
          event.stopPropagation();
          Promise.resolve(addFilesForContext(files, context, event.target)).catch(error => notify(error?.message || String(error)));
        });
      });
      $("#tagPane")?.addEventListener("dragover", event => { if (event.dataTransfer?.types?.includes("application/x-ai-tag-image-id")) { event.preventDefault(); event.stopPropagation(); $("#tagPane").classList.add("image-drag-over"); } });
      $("#tagPane")?.addEventListener("dragleave", event => { if (!$("#tagPane").contains(event.relatedTarget)) $("#tagPane").classList.remove("image-drag-over"); });
      $("#tagPane")?.addEventListener("drop", async event => {
        $("#tagPane").classList.remove("image-drag-over");
        const conversationPayload = event.dataTransfer?.getData("application/x-ai-tag-conversation-ref");
        let reference; try { reference = conversationPayload ? JSON.parse(conversationPayload) : null; } catch { return; }
        if (reference?.sessionId && reference.sessionId !== currentTalkSessionId()) return;
        const id = reference?.imageId || event.dataTransfer?.getData('application/x-ai-tag-image-id');
        const item = fullImageFor(id); if (!item) return;
        event.preventDefault(); event.stopPropagation(); await selectVisionImage(item);
      });
      listen(document, "dragover", (event) => {
        if (event.dataTransfer?.types?.includes("Files"))
          event.preventDefault();
      });
      listen(document, "drop", (event) => {
        const files = [...(event.dataTransfer?.files || [])].filter((file) =>
          file.type?.startsWith("image/"),
        );
        if (!files.length) return;
        const context = imageContextFromEvent(event, { useActive: false });
        if (!context) return;
        event.preventDefault();
        event.stopPropagation();
        Promise.resolve(addFilesForContext(files, context, event.target)).catch(error => notify(error?.message || String(error)));
      });
      listen(document, "paste", (event) => {
        const files = clipboardImageFiles(event);
        if (files.length) {
          const context = imageContextFromEvent(event, { useActive: true });
          if (!context) return;
          event.preventDefault();
          event.stopPropagation();
          Promise.resolve(addFilesForContext(files, context, event.target)).catch(error => notify(error?.message || String(error)));
        }
      });
      listen(document, "keydown", (event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "k"
        ) {
          event.preventDefault();
          $("#q")?.focus();
        }
        if (event.key === "Escape") {
          setVisionOpen(false);
          $("#themePop")?.setAttribute("hidden", "");
          $("#localePop")?.setAttribute("hidden", "");
          $$(".modal.show").forEach((el) => el.classList.remove("show"));
        }
      });
    }
    function start(options = {}) {
      if (ui.started) return;
      ui.started = true;
      ui.catalogPending = options.catalogPending === true;
      const showStorageError = error => notify(`${localized("ui.common.storageWriteFailed", "保存失败，更改暂存在内存中。请检查磁盘空间或目录权限。")} (${error?.code || "STORAGE_WRITE_FAILED"})`);
      ui.unsubscribeStorage = preferencesStore?.onPersistenceError?.(showStorageError);
      ui.unsubscribeSessions = assistant.subscribe(event => {
        applyPendingQuestionChanges(event?.待答问题变更 || event?.data?.待答问题变更);
        renderTalk(); renderManager(); syncGenerationControls();
      });
      /** 会话列表、消息区与输入卡共用对话管理状态。 */
      ui.dshMount = mountDshViews();
      const persistence = preferencesStore?.persistenceStatus?.();
      if (persistence?.ok === false) showStorageError(persistence.error);
      restoreTags();
      /**
       * 成人标签开关：把上次的选择读回来。
       *
       * ⚠️ **「没存过」不等于「要关掉」** —— 只有用户真的选过才动标签库，
       * 否则会覆盖标签库自己的初值（`characters-view.test.cjs` 那条用例就是拿
       * `includeAdult: true` 起手的，强推 false 会把它的前提抹掉）。
       *
       * ⚠️ **只在启动时推一次也不够**：标签库是懒加载的，目录还没就绪时
       * `tags.*` 会走 `createLazyFace` 的兜底（`notReadyResult()`，**静默丢弃**）。
       * 所以真相留在界面侧（`ui.adult` / `ui.adultStored`），下面 `catalog.subscribe`
       * 里目录每次变化后再推一次（幂等）。
       */
      const storedAdult = preferences.get("app.adult", null);
      ui.adult = storedAdult === true;
      ui.adultStored = storedAdult !== null;
      if (ui.adultStored) tags?.setAdult?.(ui.adult);
      const theme = preferences.get(
        "app.theme",
        preferences.get("rewrite_theme", "light"),
      );
      applyTheme(theme);
      locale(preferences.get("app.locale", preferences.get("rewrite_locale", "zh-CN")), { render: false });
      hydrateViews();
      ui.unsubscribeCatalog = catalog?.subscribe?.(change => {
        ui.tagPageCache.clear();
        /** 目录就绪/变化后再推一次界面侧的真相（懒加载时启动那次会被静默丢弃，见 `start()`）。 */
        if (ui.adultStored) tags?.setAdult?.(ui.adult === true);
        if (change.changedTagIds.length || change.structureChanged) {
          if (ui.route === 'tags') { const scroll = $('#chips')?.scrollTop; renderCategories(); renderTags(); if ($('#chips')) $('#chips').scrollTop = scroll; }
          if (ui.route === 'favorites' && change.structureChanged) views.favorites?.render?.();
          if (ui.route === 'characters') views.characters?.refresh?.();
          if (ui.route === 'ai') renderTalkVisionPanel();
        }
        renderSelection();
      });
      bind();
      resizeTalkInput();
      renderQueueDock();
      loadSettings({ fetch: false, capabilities: false });
      setTimeout(() => { if (ui.started) refreshCapabilitiesStatus({ force: true }); }, 0);
      renderCategories(); renderTags();
      renderSelection();
      renderPrompt();
      renderVisionPreview();
      renderEmbeddedVision();
      views.agentStatus?.render({ status: "idle" });
      route("tags");
    }
    /**
     * **新版三块（侧栏 / 聊天区 / 输入卡）的挂载。**
     *
     * 这是本项目里唯一一处"接线"：把**已经存在的**真实入口交给挂载层，
     * 组件要的数据形状由 `src/view-bridge.js` 转（这里不自己映射字段）。
     *
     * 为什么数据源传的是箭头函数而不是快照：`sessions()` / `currentSession()`
     * 每次返回克隆，而 `update()` 会被会话订阅按补丁频率调到 —— 传快照会一直是旧的。
     * 挂载层每次 `update()` 现读一次，走的就是界面一直以来的那套数据。
     *
     * ⚠️ `send` / `stop` 走的是**既有函数**（`sendTalk` / `assistant.cancel`），
     * 不复制那条链路。
     */
    function mountDshViews() {
      if (typeof global.dshMount?.mountDshViews !== "function") return null;
      return global.dshMount.mountDshViews({
        document: doc,
        ctx: {
          sessions: () => assistant?.sessions?.() || [],
          currentSession: () => (assistant?.sessions?.() || []).length ? (assistant?.currentSession?.() || null) : null,
          currentId: () => currentTalkSessionId(),
          toolActions: () => modules.桌()?.动作表,
          processExpanded: (sessionId, turnId) => preferences.get(`ai.process.${sessionId}.${turnId}`, null),
          onToggleTurnProcess: (open, turnId) => preferences.set(`ai.process.${currentTalkSessionId()}.${turnId}`, open),
          saveDraft: input => assistant.saveDraft(input),
          readImage: imageId => assistant.resolveSessionImage({sessionId:currentTalkSessionId(),imageId}),
          isRunning: () => {
            try { return assistant?.snapshot?.()?.busy === true; } catch { return false; }
          },
          editMessage: input => assistant.editMessage(input),
          regenerate: async input => { await views.settings?.flush?.(); return assistant.regenerate(input); },
          queue: () => queueItems(),
          openSession: async sessionId => {
            const result = await assistant.switchSession(sessionId);
            if (result?.ok === false) return notify(result.error.message);
            invalidateImageCache();
            ui.comfyFollow["#talkConv"] = true;
            renderTalk(); renderConversationRepository();
          },
          /**
           * **发送**：状态层的 `defaultSink` 落到这里。
           *
           * ⚠️ 第二个参数是**提交那一刻的附件 id 快照**（`SessionInputShell`
           * 的 `defaultSink(text, attachmentIds, …)`）。**必须透传给 `sendTalk`**：
           * 附件在提交当场就被状态层清空了，此刻 `ui.sendDrafts` 已经是空的 ——
           * 再让 `sendTalk` 去读它，就是老 bug 2「只把图片发送出去，文字部分不会
           * 被发送」/「只发文字，图丢了」的翻版。
           */
          send: (reply, attachmentIds) => {
            const input = $("#talkIn");
            if (!input) { notify("输入框不存在，无法发送"); return Promise.resolve(null); }
            return sendTalk(reply, attachmentIds);
          },
          /**
           * **对话管理（改名 / 删除）** —— 接给新侧栏的 `onRenameRequest` / `onDeleteRequest`。
           *
           * 会话管理只做改名与删除，**没有 DSH 那种归档层**。
           *
           * 两处都复用旧侧栏**已有**的交互，不重写：
           *   · 改名走 `promptDialog` —— Electron 渲染进程不实现 `prompt`，
           *     所以必须用应用自己的输入弹窗
           *   · 删除走 `confirmDeleteConversation` —— 它带"影响面"提示
           *     （多少条消息、多少张图）并问是否保留图片
           */
          renameSession: renameConversation,
          deleteSession: (sessionId, title) => {
            const session = (assistant?.sessions?.() || []).find(row => row.id === sessionId)
              || { id: sessionId, title: str(title, "新对话"), messages: [] };
            confirmDeleteConversation(session, async retainImages => {
              const result = await assistant?.deleteSession?.(sessionId, { retainImages });
              if (result?.ok === false) return notify(result.error.message);
              renderTalk();
              renderConversationRepository();
              renderManager();
            });
          },
          stop: () => {
            const requested = assistant?.cancel?.();
            if (requested === false) concludeTalkStatus("当前没有正在进行的请求", "cancelled");
          },
          /**
           * **清空本次对话**（新卡片右下角的 ✕）—— 复用既有的
           * `confirmClearConversation()`：它带确认框、"清空 N 条消息"的影响面、
           * 并**明确保留对话图片**（`clearSession` 只清消息，不动图片库）。
           *
           * 那个函数只绑在旧按钮 `#talkClearBtn` 上，新卡片上没有这个入口 ——
           * 这里把它接上。
           */
          clearConversation: () => { confirmClearConversation(); },
          /**
           * **把 `ui.sendDrafts` 重建成状态层给的 id 列表**（挂载层在投影时调）。
           *
           * ⚠️ 这一份**不是**第二份权威：草稿（正文 + 附件）的唯一权威是
           * `dsh-input-state.js` 的 `SessionInputShell`，`ui.sendDrafts` 只是给
           * 既有链路读的**投影**：
           *   · `sendTalk()` 从它取本次要挂接的图片
           *   · 待发条 `#talkImgRow` 与图片仓库卡片从它取"哪些还没发"
           *
           * 所以这里只做两件事：**按 id 复原草稿对象**（保留 filename / refId /
           * sessionId —— 它们在建草稿时才有，重绘后仍需可用）+ **重绘两条待发 UI**。
           * **没有清空语义**：传进来什么就是什么，清空是传空数组的调用方的事
           * （提交事务在状态层里，不在这里）。
           *
           * 幂等：id 列表没变就直接返回 —— `renderPendingImageStrip()` 每次都
           * `replaceChildren`，不判等会让挂载层那个 `MutationObserver` 反复空转。
           */
          replaceDrafts: ids => { replaceDrafts(ids); },
          /**
           * 一次发送走完既有链路之后的收尾。
           * **不含任何草稿清理**（提交当场已经由状态层清完了）。
           */
          afterSend: () => { if (ui.dshMount) { ui.dshMount.update(); resizeTalkInput(); } },
          /**
           * **清空宿主草稿投影**（对外保留的入口，例如将来"清空本次对话"的入口）。
           *
           * ⚠️ 它**不是**发送路径的一部分 —— 提交的事务归状态层。这里只是
           * "把投影置空"的便捷写法，实现委托给 `replaceDrafts([])`，免得同一件事
           * （清空 + 重绘两条待发 UI）在两个地方各写一遍。
           *
           * **全仓当前无调用方**（`grep -r clearDrafts src/` 无命中）—— 保留它是为了
           * 让外部/将来的宿主代码还有一个语义明确的入口，而不是让调用方自己去动
           * `ui.sendDrafts`。
           */
          clearDrafts: () => {
            ui.conversationSelectionSnapshot = [];
            replaceDrafts([]);
          },
          updateQueue: (id, action) => {
            const result = assistant?.updateQueue?.(id, action);
            if (result && result.ok === false) notify(str(result.error?.message, "队列操作失败"));
            else renderQueueDock();
            return result;
          },
          /** ⚠️ 图片解析要绑**当前会话**：不绑就会拿别的会话的 URL 去渲染。 */
          resolveImage: (imageId, variant = "thumbnail") => fullImageFor(imageId, variant),
          readImageMetadata: imageId => imageMetadataFor(imageId),
          openImage: imageId => openImageViewer({ imageId }),
          /** 草稿图数量变化 —— 新卡片靠它决定"附件门"（对齐原版的上传中就绪判定）。 */
          /**
           * **`+` 按钮** —— 接项目原有的文件选择器。
           *
           * DSH 那个 `+` 打开的是 `ui-input-trigger` 的命令菜单（`/` 指令 + `@` 引用 +
           * 附件，控制器 27KB）。本项目没有那套命令系统，而 `+` 的实际用途就是**加图** ——
           * 所以接上原有的 `<input type=file id="talkImgFile">`：多选、去重、
           * 草稿条、发送挂接全部照旧，一行都不用重写。
           */
          onPickFiles: () => { const picker = $("#talkImgFile"); if (picker) picker.click(); },
          /**
           * 宿主此刻的草稿图**只读投影**（挂载层只在**首帧采纳**与提交后**核对**
           * 时读它；发送路径不依赖它取附件 —— 附件的权威在状态层）。
           */
          resolveAttachments: () => ui.sendDrafts.map(draft => ({ id: draft.imageId, kind: "image" })),
          /**
           * 从新卡片的附件列表里删一张草稿图。
           *
           * ⚠️ 项目里别处还在调这条路，但挂载层**不走它** —— 那边走状态层的
           * `removeAttachment`，然后由投影调 `replaceDrafts`。
           */
          removeDraft: imageId => {
            const index = ui.sendDrafts.findIndex(draft => draft.imageId === imageId);
            if (index >= 0) { ui.sendDrafts.splice(index, 1); renderPendingImageStrip(); }
          },
          draftsRoot: $("#talkImgRow"),
          /**
           * **上下文占用**：按轮次的用量在 `message.usage`（不是 `result.usage`），
           * 窗口大小来自链路的 `contextWindow`（用户在设置里填，未填 = 0）。
           *
           * ⚠️ 两者**缺一个，`contextMeter` 就整个隐藏** —— 那是刻意的：
           * 未知就隐藏，不显示 0% 或 100% 那种"看着精确其实是错的"。
           */
          meterSources: () => {
            const session = assistant?.currentSession?.() || null;
            const messages = Array.isArray(session?.messages) ? session.messages : [];
            let usage = null;
            for (let i = messages.length - 1; i >= 0; i -= 1) {
              const row = messages[i];
              if (row?.usage && typeof row.usage === "object") { usage = row.usage; break; }
              if (row?.result?.usage && typeof row.result.usage === "object") { usage = row.result.usage; break; }
            }
            let windowTokens = 0;
            try {
              const links = assistant?.getSettings?.()?.links;
              windowTokens = Number(Array.isArray(links) ? links[0]?.contextWindow : 0) || 0;
            } catch { windowTokens = 0; }
            return { usage, windowTokens };
          }
        },
        /**
         * 文案：组件默认给的是 DSH 英文档，这里是中文界面，所以整包换掉。
         * `localized` 的 key 现在还没有条目，全部落到中文兜底 —— key 先占好位，
         * 之后往 `locales/*.json` 里加条目即可，不用再动这里。
         */
        labels: {
          reasoningTitle: localized("ui.dsh.thinking", "思考"),
          reasoningRunning: localized("ui.dsh.thinkingRunning", "正在思考"),
          toolInput: localized("ui.dsh.toolInput", "输入"),
          toolOutput: localized("ui.dsh.toolOutput", "输出"),
          toolStatusRunning: localized("ui.dsh.toolRunning", "执行中"),
          toolStatusDone: localized("ui.dsh.toolDone", "已完成"),
          toolStatusError: localized("ui.dsh.toolError", "失败"),
          toolStatusStopped: localized("ui.dsh.toolStopped", "已取消"),
          copy: localized("ui.dsh.copy", "复制"),
          copied: localized("ui.dsh.copied", "已复制"),
          stopped: localized("ui.dsh.stopped", "已停止"),
          unknownBlock: localized("ui.dsh.unknownBlock", "未知内容"),
          deepDiving: localized("ui.dsh.deepDiving", "深度求索中"),
          deepDivingFor: localized("ui.dsh.deepDivingFor", "深度求索中 {duration} ···"),
          hourUnit: "小时", minuteUnit: "分", secondUnit: "秒",
          /**
           * **过程头与过程分组**（`TurnProcessNodeView` / `ChatGroupSeat`）。
           *
           * ⚠️ 三个 key 都要给中文，否则过程头显示英文 `Completed`、分组标题
           * 显示 `Process` —— 中文界面里冒英文。
           *
           * `turnProcessTook` 的英文档**自带尾空格**（`'Completed in '`），
           * 因为时长片段是紧接在它后面拼上去的；中文同理（"已完成，用时 "）。
           */
          turnProcessWorked: localized("ui.dsh.turnProcessWorked", "已完成"),
          turnProcessTook: localized("ui.dsh.turnProcessTook", "已完成，用时 "),
          turnProcessFailed: localized("ui.dsh.turnProcessFailed", "失败了"),
          groupLabel: localized("ui.dsh.processGroup", "过程")
        }
      });
    }
    function renderCatalogState(status) {
      ui.catalogFailed = status === 'failed';
      ui.catalogPending = status === 'booting';
      ui.hiddenTagsReady = status === 'ready';
      if (status === 'ready') {
        // The shell already owns its listeners. Refresh catalog data without
        // starting it again or changing the page selected during loading.
        ui.tagPageCache.clear();
        renderCategories(); renderTags();
        renderSelection();
        syncNavigationStates();
        if (ui.route === 'characters') renderCharacters();
        if (ui.route === 'favorites') views.favorites?.render?.();
        if (ui.route === 'ai') renderTalkVisionPanel();
      }
      if (ui.catalogFailed) {
        $('#chips')?.replaceChildren();
        $('#catList')?.replaceChildren();
        $('#selbox')?.replaceChildren();
      }
    }
    return {
      start,
      hydrateViews,
      renderCatalogState,
      route,
      views,
      showAi,
      /** 同步生成相关的设置控件（负面词开关、ComfyUI 开关）。 */
      refreshGenerationSettings() {
        const current = settings();
        if (ui.route === 'ai' && ui.aiTab === 'comfy') {
          const input = $('#generateNegativeTags');
          if (input) input.checked = current.generateNegativeTags === true;
          const enabled = $('#comfyOn');
          if (enabled) enabled.checked = current.comfyOn === true;
        }
        syncGenerationControls();
      },
      renderTags,
      renderSelection,
      tagEditor,
      tagGroupEditor,
      async flushSettings() { flushSettingsSave(); await views.settings?.flush?.(); await views.comfy?.flush?.(); },
      dispose() {
        disposed = true;
        removeListeners.splice(0).forEach(remove => remove());
        ui.versionManager.offEvent?.();
        ui.unsubscribeCatalog?.(); ui.unsubscribeStorage?.(); ui.unsubscribeSessions?.();
        clearTimeout(ui.searchTimer); clearTimeout(notify.timer);
        tagEditor?.dispose(); tagGroupEditor?.dispose(); tagLocation?.dispose();
        views.favorites?.destroy?.(); views.characters?.dispose?.();
        for (const view of Object.values(views)) view?.dispose?.();
      },
      showStartupError(error) { notify(`${localized("ui.common.storageWriteFailed", "标签库未就绪")} (${error?.code || "NOT_READY"})`); },
      renderPrompt,
      renderTalk,
      perf: Object.freeze({ streamFrames: streamFrameStats }),
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
