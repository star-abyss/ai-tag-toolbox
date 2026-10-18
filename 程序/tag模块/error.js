'use strict';
/*
 * 标签模块 · 错误码表。
 *
 *   ERR.码       全部错误码
 *   ERR.理由     失败理由原文 → 码
 *   ERR.取码(理由)  给一句失败理由，找它的码
 *
 * 门面的失败信封是 { ok:false, reason, code }：reason 是理由原文（一个字都不改），
 * code 由 理由 那张表查出来。表里没有的理由落回 TAG_ACTION_FAILED：
 * 内部件报的读写失败（'权限' / '磁盘满' / '被占用' / '未知'）、冻结键（'读不懂'）、
 * 以及任何没走到这里的抛错。门面自己产的码只有 TAG_NO_SUCH_ACTION 与 TAG_ACTION_FAILED。
 */

/** 全部错误码。 */
const 码 = Object.freeze({
  /** 动作名不在动作表里。 */
  NO_SUCH_ACTION: 'TAG_NO_SUCH_ACTION',
  /** 动作自己抛错；理由不在表里时的落点。 */
  ACTION_FAILED: 'TAG_ACTION_FAILED',
  /** 记录不存在，或它不在那个库里。 */
  RECORD_MISSING: 'TAG_RECORD_MISSING',
  /** 名称不能为空。 */
  NAME_REQUIRED: 'TAG_NAME_REQUIRED',
  /** 原有记录只能隐藏，不能删。 */
  RECORD_READONLY: 'TAG_RECORD_READONLY',
  /** 它不在隐藏库里。 */
  NOT_HIDDEN: 'TAG_NOT_HIDDEN',
  /** 它没有被改过。 */
  NOT_MODIFIED: 'TAG_NOT_MODIFIED',
  /** 来源库里已经有这个 ID 了。 */
  ID_TAKEN: 'TAG_ID_TAKEN',
  /** 页不存在。 */
  PAGE_MISSING: 'TAG_PAGE_MISSING',
  /** 类不存在。 */
  CLASS_MISSING: 'TAG_CLASS_MISSING',
  /** 页或类不存在。 */
  PAGE_OR_CLASS_MISSING: 'TAG_PAGE_OR_CLASS_MISSING',
  /** 这个类不在这页底下。 */
  CLASS_NOT_IN_PAGE: 'TAG_CLASS_NOT_IN_PAGE',
  /** 页名不能为空。 */
  PAGE_NAME_REQUIRED: 'TAG_PAGE_NAME_REQUIRED',
  /** 类名不能为空。 */
  CLASS_NAME_REQUIRED: 'TAG_CLASS_NAME_REQUIRED',
  /** 位置只有分类 / 收藏两种。 */
  BAD_POSITION_ROOT: 'TAG_BAD_POSITION_ROOT',
  /** 要一个 ID 列表。 */
  NEED_ID_LIST: 'TAG_NEED_ID_LIST',
});

/** 失败理由原文 → 码。同一句原文只出现在一处，所以可以直接当键。 */
const 理由 = Object.freeze({
  '记录不存在': 码.RECORD_MISSING,
  '名称不能为空': 码.NAME_REQUIRED,
  '原有的记录不能删，只能隐藏': 码.RECORD_READONLY,
  '它不在隐藏库里': 码.NOT_HIDDEN,
  '它没有被改过': 码.NOT_MODIFIED,
  '来源库里已经有这个 ID 了': 码.ID_TAKEN,
  '页不存在': 码.PAGE_MISSING,
  '类不存在': 码.CLASS_MISSING,
  '页或类不存在': 码.PAGE_OR_CLASS_MISSING,
  '这个类不在这页底下': 码.CLASS_NOT_IN_PAGE,
  '页名不能为空': 码.PAGE_NAME_REQUIRED,
  '类名不能为空': 码.CLASS_NAME_REQUIRED,
  '位置只有这两种：分类 / 收藏': 码.BAD_POSITION_ROOT,
  '要一个 ID 列表': 码.NEED_ID_LIST,
});

/** 动作名不对时那句理由的前缀：`没有这个动作：<名字>`。 */
const 无此动作 = '没有这个动作：';

/**
 * 给一句失败理由，找它的码。
 * @param {string} [话] 理由原文
 * @returns {string} 错误码；动作名不对是 NO_SUCH_ACTION，其余不在表里的落回 ACTION_FAILED
 */
function 取码(话) {
  const 话串 = typeof 话 === 'string' ? 话 : '';
  if (话串.startsWith(无此动作)) return 码.NO_SUCH_ACTION;
  return 理由[话串] || 码.ACTION_FAILED;
}

module.exports = { ERR: Object.freeze({ ...码, 理由, 取码 }) };
