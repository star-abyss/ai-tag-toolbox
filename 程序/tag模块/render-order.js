'use strict';
/*
 * 渲染顺序 —— 出词按什么次序吐（设计见 渲染顺序.md）。
 *
 *   表一 · tag 页渲染顺序    哪些页出、什么先后
 *   表二 · 角色渲染顺序      ① 角色名 ② 作品（从类读）③ 特征（按表一）
 *
 * 顺序的三层依据：
 *   页序    本文件的 页序 常量（盘上只有"按页 ID 升序"，那是给人看的排列）
 *   类序    页.类列表 的数组顺序
 *   格内序  类格文件的数组顺序
 *
 * 本文件只读位置与记录，不写任何东西，也不认识盘与文件。
 */

/**
 * 表一：在表里的页按这个先后出词。
 * 分组是四个大顺序 —— 作品 → 发色 → 其他外貌 → 服装；表外的页一律不出。
 * `页序` 里没有的页 = 不进渲染表。
 */
const 页序 = [
  14,   // 作品
  36,   // 头发（发色在它底下的类里）
  16,   // 身材与身体
  25,   // 表情
  29,   // 眼睛
  122,  // 动作与姿势
  46,   // 角色特征
  7,    // 人物与角色
  196,  // 动物
  184,  // 食物与饮料
  179,  // 特效与魔法
  177,  // 氛围与光影
  133,  // 场景与环境
  146,  // 视角与镜头
  172,  // 时间与天气
  150,  // 画风与风格
  51,   // 服装
  87,   // 鞋袜
  98,   // 道具与装饰
  227,  // 角色专属词
  208,  // 其他
  224,  // wd_general
];

/** 页序里的页号 → 第几位（越小越先出）。 */
const 页位 = new Map(页序.map((id, i) => [String(id), i]));

/** 作品那一段用哪一页的类来读（表二 ②）。 */
const 作品页ID = '14';

/** 角色那一页（它底下的类不进渲染表）。 */
const 角色页ID = '222';

function createRender({ positions, get, 查词 = () => null }) {
  /** 成员 ID → { 页ID, 页名, 类名, 页序, 类序, 格内序 }。 */
  let 索引 = null;

  /** 页位次（越小越先出）。 */
  function 页位次(页ID) {
    return 页位.has(String(页ID)) ? 页位.get(String(页ID)) : Number.MAX_SAFE_INTEGER;
  }

  /** 只读一格：{ 页ID, 页名, 类名, 页序, 类序, 格内序 }，取不到给 null。 */
  function 找位置(标识) {
    const 表 = 要索引();
    return 表.get(String(标识)) || null;
  }

  /**
   * 某一页底下"谁落在哪个类里"，一次给全。
   * 页「角色组」有 4050 个类，逐个类去问成员要几千趟，这一条一趟就够。
   * @param {string|number} 页ID
   * @returns {Array<{成员:string, 页ID:string, 页名:string, 类ID:string, 类名:string}>}
   */
  function 一页归属(页ID) {
    const 根 = positions.list('分类', 页ID);
    if (!根.ok) return [];
    const 出 = [];
    for (const 类 of 根.page.类列表 || []) {
      const 成员 = positions.members('分类', 页ID, 类.ID);
      if (!Array.isArray(成员)) continue;
      for (const m of 成员) {
        出.push({
          成员: String(m),
          页ID: String(根.page.ID),
          页名: 根.page.页名,
          类ID: String(类.ID),
          类名: 类.类名,
        });
      }
    }
    return 出;
  }

  function 建索引() {
    const 表 = new Map();
    const 根 = positions.list('分类');
    const 页列表 = 根.ok && Array.isArray(根.pages) ? 根.pages : [];
    for (const 页 of 页列表) {
      for (const 类 of 页.类列表 || []) {
        const 成员 = positions.members('分类', 页.ID, 类.ID);
        if (!Array.isArray(成员)) continue;
        成员.forEach((id, i) => {
          const 键 = String(id);
          // 一个东西在多个类里时取先读到的那一处（与"同档内取第一条"同一条做法）
          if (表.has(键)) return;
          表.set(键, {
            页ID: String(页.ID),
            页名: 页.页名,
            类ID: String(类.ID),
            类名: 类.类名,
            页序: 页位次(页.ID),
            类序: (页.类列表 || []).findIndex((c) => String(c.ID) === String(类.ID)),
            格内序: i,
          });
        });
      }
    }
    return 表;
  }

  function 要索引() {
    if (!索引) 索引 = 建索引();
    return 索引;
  }

  /** 位置一变，索引作废。 */
  function invalidate() {
    索引 = null;
  }

  /** 表一：在表里的页，按渲染先后。 */
  function pages() {
    const 根 = positions.list('分类');
    const 页列表 = 根.ok && Array.isArray(根.pages) ? 根.pages : [];
    return 页列表
      .filter((页) => 页位.has(String(页.ID)))
      .sort((a, b) => 页位次(a.ID) - 页位次(b.ID))
      .map((页, i) => ({
        页ID: String(页.ID),
        页名: 页.页名,
        页序: i,
        类们: (页.类列表 || []).map((类, j) => ({ 类ID: String(类.ID), 类名: 类.类名, 类序: j })),
      }));
  }

  /** 表一：给一批词或 ID，按 页序 → 类序 → 格内序 排好。
   * 库里没有的、没有页可归的，排最后（保持进来的先后）。重复的留着。
   * @param {Array<string|number|{标识:string|number}>} 词们
   */
  function sort(词们) {
    const 表 = 要索引();
    const 有序 = [];
    const 没页 = [];
    const 逐个 = Array.isArray(词们) ? 词们 : [];
    for (const 词 of 逐个) {
      const 标识 = 词 && typeof 词 === 'object' && Object.prototype.hasOwnProperty.call(词, '标识')
        ? 词.标识 : null;
      const 明确标识 = 标识 !== null && 标识 !== undefined;
      const 原词 = typeof 词 === 'string' || typeof 词 === 'number'
        ? String(词) : String(明确标识 ? 标识 : '');
      const 记录 = 明确标识 ? get(标识) : (typeof 词 === 'string' ? 查词(词) : null);
      const 位 = 记录 ? 表.get(String(记录.ID)) : null;
      const 一项 = {
        词: 明确标识 && 记录 ? String(记录.名称).split(',')[0] : 原词,
        标识: 记录 ? 记录.ID : null,
        中文名: 记录 && 记录.中文名 ? String(记录.中文名).split(',')[0] : null,
        在库里: Boolean(记录),
        页ID: 位 ? 位.页ID : null,
        页名: 位 ? 位.页名 : null,
        类名: 位 ? 位.类名 : null,
      };
      if (位 && 位.页序 !== Number.MAX_SAFE_INTEGER) 有序.push({ ...一项, 键: 位 });
      else 没页.push(一项);
    }
    有序.sort((a, b) => (a.键.页序 - b.键.页序)
      || (a.键.类序 - b.键.类序)
      || (a.键.格内序 - b.键.格内序));
    return 有序.map(({ 键, ...一 }) => 一).concat(没页);
  }

  /** 作品的名字 → 页「作品」里那个类的 ID。 */
  function 作品类ID(作品名) {
    const 根 = positions.list('分类', 作品页ID);
    if (!根.ok) return null;
    const 类 = (根.page.类列表 || [])[0];
    return 类 ? String(类.ID) : null;
  }

  /** 表二：一个角色的三段 —— ① 角色名 ② 作品 ③ 特征（按表一）。
   * 作品从"它在页「角色组」的哪个类里"读；落在「未分类」的就没有作品那一段。
   */
  function words(标识) {
    const 记录 = get(标识);
    if (!记录) return { ok: false, reason: '记录不存在' };
    const 角色名 = String(记录.名称).split(',')[0];
    const 成 = Array.isArray(记录.成员) ? 记录.成员 : [];

    // ② 作品：这一条摆在页「角色组」的哪个类里
    let 作品 = null;
    const 根 = positions.list('分类', 角色页ID);
    if (根.ok) {
      for (const 类 of 根.page.类列表 || []) {
        if (类.类名 === '未分类') continue;
        const 成员 = positions.members('分类', 角色页ID, 类.ID);
        if (Array.isArray(成员) && 成员.some((m) => String(m) === String(记录.ID))) {
          作品 = 类.类名;
          break;
        }
      }
    }

    // ③ 特征：成员里除作品外的那些，按表一排
    const 特征ID = 成.filter((m) => !(作品判据 && 作品判据(String(m))))
      .map((标识) => ({ 标识 }));
    const 排好的 = sort(特征ID);
    const 块们 = [];
    for (const 一 of 排好的) {
      if (!一.页名) continue;
      const 末 = 块们[块们.length - 1];
      if (末 && 末.页名 === 一.页名) 末.词们.push(一.词);
      else 块们.push({ 页ID: 一.页ID, 页名: 一.页名, 词们: [一.词] });
    }
    return {
      ok: true,
      角色名,
      作品,
      块们,
      没页的词: 排好的.filter((一) => !一.页名).map((一) => 一.词),
    };
  }

  /** 一条 ID 是不是作品：作品集由装配时递进来（本文件不认识别的东西）。 */
  let 作品判据 = () => false;

  function 设作品判据(fn) {
    作品判据 = typeof fn === 'function' ? fn : () => false;
  }

  return { pages, sort, words, 找位置, 一页归属, invalidate, 设作品判据, 页序, 作品页ID, 角色页ID, 作品类ID };
}

module.exports = { createRender, 页序, 作品页ID, 角色页ID };
