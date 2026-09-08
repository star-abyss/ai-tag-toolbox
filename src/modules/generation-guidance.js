'use strict';

// Shared by compilation, revision and review so source observations and the
// intended result use the same priority even with a saved custom prompt.
const SOURCE_REFERENCE_GUIDANCE = [
  '【任务依据｜优先于上方默认复刻规则】',
  '用户原始要求及本次明确反馈定义目标，优先于角色资料、参考原图、识图蓝图和此前评价。',
  '参考原图与视觉蓝图描述的是原图事实；其中的 mustPreserve 也是识图建议，不会自动成为用户硬约束。',
  '根据用户要求区分需要改变与需要保留的部分：换角色时，不要把原图人物的身份、发色、眼色、服装和配件误认成目标角色的特征；用户明确要求保留原图服装、改变目标发色等时，服从该要求。姿势、视角、构图和场景也按用户要求保留或改变。'
].join('\n');

const CHARACTER_REFERENCE_GUIDANCE = [
  '【角色资料使用规则】',
  'characterReferences 中的姓名、出处和外貌描述目标角色，不描述被替换的原图人物。',
  '外貌与角色专用 Tag 是可选参考，不是逐项验收清单；文生图子代理自行根据人数、景别、可见范围、遮挡、构图和模型特点选择、压缩、改写或删除。多人可只留区分特征；上半身可省略靴子等画外信息，不自动补回，不永久锁定任何参考 Tag。',
  '评价以可见画面的角色辨识、用户目标与构图为准，不因可选词缺失而判错，不为展示画外配件改变裁剪范围。用户明确指定的外貌变化优先于角色库默认特征。',
  '评价建议若与用户要求或目标角色资料冲突，先核对并忽略错误建议；不得用原图人物的外貌重新解释目标角色，也不得仅为了更像原图而撤销用户要求的替换。此前评价是意见，不是角色事实来源。'
].join('\n');

module.exports = { SOURCE_REFERENCE_GUIDANCE, CHARACTER_REFERENCE_GUIDANCE };
