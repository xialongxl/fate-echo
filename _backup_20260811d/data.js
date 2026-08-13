// ============================================================
// js/data.js — 技能数据表（Fate_echo Phase 0）
// 52 技能 + 1 被动，**原样提取自** 末光咏叹 js/data.js（Idle_Game_ui_zero），
// 未做任何换算——cd/dur 保持毫秒、dmgMult/cost 保持原值。
// 回合制换算（ms→回合、领域 5 回合特例）由 Skill 类构造时完成（js/skill.js），
// 保证数据可追溯、与来源可对照。
// 效果类型（type）：gcd 主技能 / ogcd 瞬发 / buff / dot / debuff /
//                  domain 领域 / passive 被动
// ============================================================

export const SKILLS_DB = [
  { id: 's01', name: '魔力弹', reqLv: 1, type: 'gcd', cd: 0, cost: 0, dmgMult: 1.0, priority: 1, desc: '[GCD] 造成{dmgMult}%攻击力伤害（约{dmg}），无消耗无冷却。' },
  { id: 's02', name: '光辉护甲', reqLv: 3, type: 'buff', cd: 30000, cost: 15, dmgMult: 0, effects: [{ type: 'buff', stat: 'versa', val: 10, dur: 15000 }], priority: 9, desc: '[Buff] 提升共鸣10%，持续{dur}秒，消耗{cost}法力，冷却{cd}秒。' },
  { id: 's03', name: '星尘咏叹', reqLv: 3, type: 'gcd', cd: 2500, cost: 5, dmgMult: 1.8, priority: 5, desc: '[GCD] 造成{dmgMult}%攻击力伤害（约{dmg}），消耗{cost}法力，冷却{cd}秒。' },
  { id: 's04', name: '痛苦诅咒', reqLv: 5, type: 'dot', cd: 10000, cost: 10, dmgMult: 0.5, effects: [{ type: 'dot', dur: 12000, dps: 0.8, stateName: '恶咒', stateEmoji: '☠️' }], priority: 8, desc: '[DoT] 立即造成{dmgMult}%攻击力伤害（约{dmg}），后续每秒造成{dps}%攻击力伤害，持续{dur}秒，消耗{cost}法力，冷却{cd}秒。' },
  { id: 's05', name: '生命绽放', reqLv: 5, type: 'gcd', cd: 15000, cost: 20, dmgMult: 0, effects: [{ type: 'heal', val: 5.0 }], priority: 12, desc: '[治疗] 恢复{healMult}%攻击力的生命值（约{heal}），消耗{cost}法力，冷却{cd}秒。' },
  { id: 's06', name: '冰霜新星', reqLv: 10, type: 'gcd', cd: 8000, cost: 12, dmgMult: 2.2, priority: 6, desc: '[GCD] 造成{dmgMult}%攻击力伤害（约{dmg}），消耗{cost}法力，冷却{cd}秒。' },
  { id: 's07', name: '黑暗契约', reqLv: 12, type: 'ogcd', cd: 20000, cost: 0, dmgMult: 0, effects: [{ type: 'mp_recover_pct', val: 0.08 }], priority: 11, desc: '[oGCD] 瞬间恢复8%最大法力值（约{mpRecover}），无消耗，冷却{cd}秒。' },
  { id: 's08', name: '虚空箭', reqLv: 18, type: 'gcd', cd: 4000, cost: 8, dmgMult: 1.5, priority: 4, desc: '[GCD] 造成{dmgMult}%攻击力伤害（约{dmg}），消耗{cost}法力，冷却{cd}秒。' },
  { id: 's09', name: '灵魂燃烧', reqLv: 20, type: 'gcd', cd: 12000, cost: 20, dmgMult: 4.0, priority: 7, desc: '[GCD] 造成{dmgMult}%攻击力伤害（约{dmg}），消耗{cost}法力，冷却{cd}秒。' },
  { id: 's10', name: '月火术', reqLv: 22, type: 'dot', cd: 5000, cost: 8, dmgMult: 1.0, effects: [{ type: 'dot', dur: 10000, dps: 1.0, stateName: '灼烧', stateEmoji: '🔥' }], priority: 8, desc: '[DoT] 立即造成{dmgMult}%攻击力伤害（约{dmg}），后续每秒造成{dps}%攻击力伤害，持续{dur}秒，消耗{cost}法力，冷却{cd}秒。' },
  { id: 's11', name: '闪电链', reqLv: 25, type: 'gcd', cd: 6000, cost: 15, dmgMult: 2.5, priority: 5, desc: '[GCD] 造成{dmgMult}%攻击力伤害（约{dmg}），消耗{cost}法力，冷却{cd}秒。' },
  { id: 's12', name: '生命泉涌', reqLv: 25, type: 'buff', cd: 30000, cost: 20, dmgMult: 0, effects: [{ type: 'hot', pct: 0.05, dur: 10000 }], priority: 12, desc: '[治疗][Buff] 每秒恢复5%最大生命值（约{hotPerTick}），持续{dur}秒，消耗{cost}法力，冷却{cd}秒。' },
  { id: 's13', name: '魔力护盾', reqLv: 28, type: 'ogcd', cd: 40000, cost: 30, dmgMult: 0, effects: [{ type: 'shield', hpPct: 0.2, dur: 10000 }], priority: 11, desc: '[oGCD] 生成可吸收20%最大生命值伤害的护盾（约{shieldVal}），持续{dur}秒，消耗{cost}法力，冷却{cd}秒。' },
  { id: 's14', name: '炎爆术', reqLv: 30, type: 'gcd', cd: 15000, cost: 25, dmgMult: 5.5, priority: 7, desc: '[GCD] 造成{dmgMult}%攻击力伤害（约{dmg}），消耗{cost}法力，冷却{cd}秒。' },
  { id: 's15', name: '迅捷微风', reqLv: 32, type: 'buff', cd: 45000, cost: 10, dmgMult: 0, effects: [{ type: 'buff', stat: 'haste', val: 15, dur: 20000 }], priority: 10, desc: '[Buff] 提升冷却缩减15%，持续{dur}秒，消耗{cost}法力，冷却{cd}秒。' },
  { id: 's16', name: '暗言术·灭', reqLv: 35, type: 'ogcd', cd: 12000, cost: 0, dmgMult: 3.0, priority: 11, desc: '[oGCD] 造成{dmgMult}%攻击力伤害（约{dmg}），无消耗，冷却{cd}秒。' },
  { id: 's17', name: '神圣惩击', reqLv: 38, type: 'gcd', cd: 0, cost: 8, dmgMult: 1.2, priority: 2, desc: '[GCD] 造成{dmgMult}%攻击力伤害（约{dmg}），消耗{cost}法力，无冷却。' },
  { id: 's18', name: '死亡标记', reqLv: 40, type: 'debuff', cd: 30000, cost: 15, dmgMult: 0, effects: [{ type: 'vuln', val: 1.2, dur: 10000 }], priority: 15, desc: '[Debuff] 使目标受到的伤害提高20%，持续{dur}秒，消耗{cost}法力，冷却{cd}秒。' },
  { id: 's19', name: '再生祷言', reqLv: 40, type: 'buff', cd: 45000, cost: 15, dmgMult: 0, effects: [{ type: 'hot', pct: 0.03, dur: 15000 }], priority: 12, desc: '[治疗][Buff] 每秒恢复3%最大生命值（约{hotPerTick}），持续{dur}秒，消耗{cost}法力，冷却{cd}秒。' },
  { id: 's20', name: '血晶爆发', reqLv: 42, type: 'gcd', cd: 8000, cost: 15, dmgMult: 2.8, priority: 5, desc: '[GCD] 造成{dmgMult}%攻击力伤害（约{dmg}），消耗{cost}法力，冷却{cd}秒。' },
  { id: 's21', name: '星落', reqLv: 45, type: 'dot', cd: 20000, cost: 35, dmgMult: 2.0, effects: [{ type: 'dot', dur: 8000, dps: 2.5, stateName: '星尘', stateEmoji: '✨' }], priority: 9, desc: '[DoT] 立即造成{dmgMult}%攻击力伤害（约{dmg}），后续每秒造成{dps}%攻击力伤害，持续{dur}秒，消耗{cost}法力，冷却{cd}秒。' },
  { id: 's22', name: '奥术飞弹', reqLv: 50, type: 'gcd', cd: 5000, cost: 12, dmgMult: 2.5, priority: 6, desc: '[GCD] 造成{dmgMult}%攻击力伤害（约{dmg}），消耗{cost}法力，冷却{cd}秒。' },
  { id: 's23', name: '能量灌注', reqLv: 51, type: 'buff', cd: 60000, cost: 0, dmgMult: 0, effects: [{ type: 'buff', stat: 'haste', val: 30, dur: 15000 }], priority: 15, desc: '[Buff] 冷却缩减提升30%，持续{dur}秒，无消耗，冷却{cd}秒。' },
  { id: 's24', name: '神圣庇护', reqLv: 55, type: 'gcd', cd: 40000, cost: 50, dmgMult: 0, effects: [{ type: 'heal', val: 20 }], priority: 12, desc: '[治疗] 恢复{healMult}%攻击力的生命值（约{heal}），消耗{cost}法力，冷却{cd}秒。' },
  { id: 's25', name: '混沌箭', reqLv: 58, type: 'gcd', cd: 18000, cost: 30, dmgMult: 6.5, priority: 7, desc: '[GCD] 造成{dmgMult}%攻击力伤害（约{dmg}），消耗{cost}法力，冷却{cd}秒。' },
  { id: 's26', name: '暗影裂隙', reqLv: 60, type: 'ogcd', cd: 25000, cost: 20, dmgMult: 4.5, priority: 11, desc: '[oGCD] 造成{dmgMult}%攻击力伤害（约{dmg}），消耗{cost}法力，冷却{cd}秒。' },
  { id: 's27', name: '寒冰长矛', reqLv: 62, type: 'gcd', cd: 3000, cost: 10, dmgMult: 1.8, priority: 4, desc: '[GCD] 造成{dmgMult}%攻击力伤害（约{dmg}），消耗{cost}法力，冷却{cd}秒。' },
  { id: 's28', name: '时间扭曲', reqLv: 65, type: 'buff', cd: 120000, cost: 100, dmgMult: 0, effects: [{ type: 'buff', stat: 'haste', val: 50, dur: 20000 }], priority: 16, desc: '[Buff] 冷却缩减提升50%，持续{dur}秒，消耗{cost}法力，冷却{cd}秒。' },
  { id: 's29', name: '腐蚀之种', reqLv: 68, type: 'dot', cd: 15000, cost: 20, dmgMult: 1.5, effects: [{ type: 'dot', dur: 15000, dps: 1.5, stateName: '腐蚀', stateEmoji: '💀' }], priority: 8, desc: '[DoT] 立即造成{dmgMult}%攻击力伤害（约{dmg}），后续每秒造成{dps}%攻击力伤害，持续{dur}秒，消耗{cost}法力，冷却{cd}秒。' },
  { id: 's30', name: '真言术·慰', reqLv: 70, type: 'ogcd', cd: 15000, cost: 0, dmgMult: 2.0, effects: [{ type: 'mp_recover_pct', val: 0.05 }], priority: 11, desc: '[oGCD] 造成{dmgMult}%攻击力伤害（约{dmg}），并恢复5%最大法力值（约{mpRecover}），无消耗，冷却{cd}秒。' },
  { id: 's31', name: '狂暴之心', reqLv: 72, type: 'buff', cd: 45000, cost: 0, dmgMult: 0, effects: [{ type: 'buff', stat: 'crit', val: 20, dur: 10000 }], priority: 10, desc: '[Buff] 提升暴击率20%，持续{dur}秒，无消耗，冷却{cd}秒。' },
  { id: 's32', name: '龙破斩', reqLv: 75, type: 'gcd', cd: 24000, cost: 40, dmgMult: 8.0, priority: 7, desc: '[GCD] 造成{dmgMult}%攻击力伤害（约{dmg}），消耗{cost}法力，冷却{cd}秒。' },
  { id: 's33', name: '星光虹吸', reqLv: 76, type: 'dot', cd: 12000, cost: 15, dmgMult: 0.5, effects: [{ type: 'dot', dur: 10000, dps: 1.0, stateName: '虹吸', stateEmoji: '🩸' }], priority: 9, desc: '[DoT] 立即造成{dmgMult}%攻击力伤害（约{dmg}），后续每秒造成{dps}%攻击力伤害，持续{dur}秒，消耗{cost}法力，冷却{cd}秒。' },
  { id: 's34', name: '法力共鸣', reqLv: 77, type: 'ogcd', cd: 60000, cost: 0, dmgMult: 0, effects: [{ type: 'mp_recover_pct', val: 0.20 }], priority: 12, desc: '[oGCD] 瞬间恢复20%最大法力值（约{mpRecover}），无消耗，冷却{cd}秒。' },
  { id: 's35', name: '幻影连击', reqLv: 78, type: 'gcd', cd: 10000, cost: 25, dmgMult: 4.5, priority: 6, desc: '[GCD] 造成{dmgMult}%攻击力伤害（约{dmg}），消耗{cost}法力，冷却{cd}秒。' },
  { id: 's36', name: '灾厄降临', reqLv: 79, type: 'dot', cd: 30000, cost: 50, dmgMult: 3.0, effects: [{ type: 'dot', dur: 12000, dps: 3.0, stateName: '灾厄', stateEmoji: '🧿' }], priority: 10, desc: '[DoT] 立即造成{dmgMult}%攻击力伤害（约{dmg}），后续每秒造成{dps}%攻击力伤害，持续{dur}秒，消耗{cost}法力，冷却{cd}秒。' },
  { id: 's37', name: '破晓之光', reqLv: 80, type: 'gcd', cd: 20000, cost: 35, dmgMult: 5.0, priority: 6, desc: '[GCD] 造成{dmgMult}%攻击力伤害（约{dmg}），消耗{cost}法力，冷却{cd}秒。' },
  { id: 's38', name: '时间回溯', reqLv: 82, type: 'ogcd', cd: 180000, cost: 100, dmgMult: 0, effects: [{ type: 'cd_reset' }, { type: 'buff', stat: 'haste', val: 50, dur: 5000 }], priority: 19, desc: '[终焉][oGCD] 扭曲时间，重置所有常规技能冷却并大幅提升施法速度。消耗{cost}法力，冷却{cd}秒。' },
  { id: 's39', name: '终焉咏叹调', reqLv: 85, type: 'gcd', cd: 60000, cost: 80, dmgMult: 12.0, priority: 14, desc: '[终焉][GCD] 造成{dmgMult}%攻击力伤害（约{dmg}），消耗{cost}法力，冷却{cd}秒。' },
  { id: 's40', name: '灵魂献祭', reqLv: 87, type: 'gcd', cd: 180000, cost: 0, dmgMult: 0, effects: [{ type: 'hp_sacrifice', costPct: 0.5, dmgMult: 20 }, { type: 'buff', stat: 'dmg_up_pct', val: 30, dur: 10000 }], priority: 16, desc: '[终焉][GCD] 献祭生命精华，造成巨额伤害并进入强化状态。冷却{cd}秒。' },
  { id: 's41', name: '虚空化身', reqLv: 88, type: 'buff', cd: 180000, cost: 80, dmgMult: 0, effects: [{ type: 'dot_enhance', dur: 15000 }], priority: 18, desc: '[终焉][Buff] 化身虚空，接下来15秒内所有持续伤害的伤害提高100%，生效间隔缩短50%。消耗{cost}法力，冷却{cd}秒。' },
  { id: 's42', name: '星蚀·黑洞', reqLv: 90, type: 'dot', cd: 90000, cost: 100, dmgMult: 5.0, effects: [{ type: 'dot', dur: 15000, dps: 5.0, stateName: '星蚀', stateEmoji: '🌑' }], priority: 15, desc: '[终焉][DoT] 立即造成{dmgMult}%攻击力伤害（约{dmg}），后续每秒造成{dps}%攻击力伤害，持续{dur}秒，消耗{cost}法力，冷却{cd}秒。' },
  { id: 's43', name: '星辰坠落', reqLv: 93, type: 'gcd', cd: 180000, cost: 120, dmgMult: 0, effects: [{ type: 'channel_immune', dur: 8000 }, { type: 'dot', dur: 8000, dps: 4.0, stateName: '星尘', stateEmoji: '✨' }], priority: 17, desc: '[终焉][GCD] 召唤星辰坠落，持续轰击敌人的同时自身进入无敌状态。消耗{cost}法力，冷却{cd}秒。' },
  { id: 's44', name: '法则解构', reqLv: 95, type: 'debuff', cd: 120000, cost: 50, dmgMult: 0, effects: [{ type: 'vuln', val: 1.5, dur: 15000 }], priority: 17, desc: '[终焉][Debuff] 使目标受到的伤害提高50%，持续{dur}秒，消耗{cost}法力，冷却{cd}秒。' },
  { id: 's45', name: '命运轮转', reqLv: 96, type: 'ogcd', cd: 180000, cost: 0, dmgMult: 0, conditionMaxHPPct: 30, effects: [{ type: 'cond_full_heal' }, { type: 'buff', stat: 'dmg_up_pct', val: 50, dur: 15000 }], priority: 20, desc: '[终焉][oGCD] 绝境中逆转命运，瞬间恢复全部状态并大幅强化。冷却{cd}秒。' },
  { id: 's46', name: '无限魔阵', reqLv: 99, type: 'buff', cd: 150000, cost: 0, dmgMult: 0, effects: [{ type: 'buff', stat: 'versa', val: 50, dur: 20000 }, { type: 'mp_recover_pct', val: 1.0 }], priority: 18, desc: '[终焉][Buff] 提升共鸣50%，持续{dur}秒，并完全恢复法力值，无消耗，冷却{cd}秒。' },
  { id: 's47', name: '阿赖耶识·斩', reqLv: 100, type: 'ogcd', cd: 180000, cost: 150, dmgMult: 25.0, priority: 20, desc: '[终焉][oGCD] 造成{dmgMult}%攻击力伤害（约{dmg}），消耗{cost}法力，冷却{cd}秒。' },
  { id: 's48', name: '虚空领域', reqLv: 100, type: 'domain', cd: 300000, cost: 300, dmgMult: 0, effects: [{ type: 'domain', dur: 60000, dps: 5.0, domainType: 'void', stateName: '虚空领域', stateEmoji: '🌌' }], priority: 18, desc: '[终焉][领域] 展开虚空领域，每秒造成500%伤害。对生命低于50%的敌人伤害提高50%，低于30%时提高100%。消耗{cost}法力，冷却{cd}秒。' },
  { id: 's49', name: '海洋领域', reqLv: 100, type: 'domain', cd: 300000, cost: 300, dmgMult: 0, effects: [{ type: 'domain', dur: 60000, dps: 5.0, domainType: 'ocean', stateName: '海洋领域', stateEmoji: '🌊' }], priority: 18, desc: '[终焉][领域] 展开海洋领域，每秒造成500%伤害。敌人伤害降低20%，玩家受疗效果提高20%。消耗{cost}法力，冷却{cd}秒。' },
  { id: 's50', name: '烈焰领域', reqLv: 100, type: 'domain', cd: 300000, cost: 300, dmgMult: 0, effects: [{ type: 'domain', dur: 60000, dps: 5.0, domainType: 'flame', stateName: '烈焰领域', stateEmoji: '🔥' }], priority: 18, desc: '[终焉][领域] 展开烈焰领域，每秒造成500%伤害。伤害每2秒递增10%，最多叠加10次。消耗{cost}法力，冷却{cd}秒。' },
  { id: 's51', name: '死亡领域', reqLv: 100, type: 'domain', cd: 300000, cost: 300, dmgMult: 0, effects: [{ type: 'domain', dur: 60000, dps: 5.0, domainType: 'death', stateName: '死亡领域', stateEmoji: '💀' }], priority: 18, desc: '[终焉][领域] 展开死亡领域，每秒造成500%伤害。敌人身上每个负面效果使伤害提高15%。消耗{cost}法力，冷却{cd}秒。' },
  { id: 's52', name: '圣光领域', reqLv: 100, type: 'domain', cd: 300000, cost: 300, dmgMult: 0, effects: [{ type: 'domain', dur: 60000, dps: 5.0, domainType: 'holy', stateName: '圣光领域', stateEmoji: '✨' }], priority: 18, desc: '[终焉][领域] 展开圣光领域，每秒造成500%伤害。伤害的5%转化为生命回复，生命低于50%时转化比例翻倍。消耗{cost}法力，冷却{cd}秒。' },
  { id: 's_passive_01', name: '终焉之力', reqLv: 1, type: 'passive', cd: 0, cost: 0, dmgMult: 0, priority: 0, desc: '[被动] 造成伤害提高10%，受到伤害降低10%。' },
];

// 效果类型全集（14 种已实现；gcd/ogcd 是技能类型非效果类型；
// §3.4 回合制新增效果：打断/反击/连击 为提案 🔲 未实现）
export const EFFECT_TYPES = [
  'buff', 'dot', 'heal', 'hot', 'shield', 'mp_recover_pct', 'mp_recover',
  'vuln', 'cd_reset', 'hp_sacrifice', 'dot_enhance',
  'channel_immune', 'cond_full_heal', 'domain',
];

// 领域类型（5 种）
export const DOMAIN_TYPES = ['void', 'ocean', 'flame', 'death', 'holy'];

// 效果子字段必填校验（按效果类型）
const EFFECT_REQUIRED = {
  buff: ['stat', 'val', 'dur'],
  dot: ['dps', 'dur'],
  heal: ['val'],
  hot: ['pct', 'dur'],
  shield: ['hpPct', 'dur'],
  mp_recover_pct: ['val'],
  mp_recover: ['val'],
  vuln: ['val', 'dur'],
  cd_reset: [],
  hp_sacrifice: ['costPct', 'dmgMult'],
  dot_enhance: ['dur'],
  channel_immune: ['dur'],
  cond_full_heal: [],
  domain: ['dps', 'dur', 'domainType'],
};

// 数值型效果子字段（必须是有限数字且 ≥ 0；dur 亦在此列）
const EFFECT_NUMERIC = ['val', 'dps', 'dur', 'pct', 'hpPct', 'costPct', 'dmgMult'];

// 需要 dur > 0 的效果类型（dur=0 无持续意义，数据层直接拒绝——
// 契约补齐：handler 不再需要防御"0 回合永久效果"类问题）
const EFFECT_NEEDS_DUR = ['buff', 'dot', 'hot', 'shield', 'vuln', 'dot_enhance', 'channel_immune', 'domain'];

// 安全字符串化：Symbol/BigInt/循环引用等不抛异常（错误信息拼接用）
const fmt = (v) => {
  if (typeof v === 'symbol') return `Symbol(${v.description ?? ''})`;
  if (typeof v === 'bigint') return `${v}n`;
  try { return JSON.stringify(v); } catch { return String(v); }
};

// 校验：id 唯一、reqLv 合法、字段完整、效果子字段必填且数值合法（加载期自检）
// 任意畸形输入（db 非数组、条目为 null、字段为 Symbol/BigInt 等）不崩溃、只报错
export function validateSkillsDB(db = SKILLS_DB) {
  if (!Array.isArray(db)) {
    return { count: 0, errors: [`db 需为数组（收到 ${fmt(db)}）`] };
  }
  const ids = new Set();
  const errors = [];
  for (const s of db) {
    if (!s || typeof s !== 'object') {
      errors.push(`db 条目非法（需对象）: ${fmt(s)}`);
      continue;
    }
    if (!s.id || ids.has(s.id)) errors.push(`id 缺失或重复: ${fmt(s.id)}`);
    ids.add(s.id);
    if (!Number.isFinite(s.reqLv) || s.reqLv < 1) errors.push(`${fmt(s.id)} reqLv 非法: ${fmt(s.reqLv)}`);
    if (!Number.isFinite(s.cd) || s.cd < 0) errors.push(`${fmt(s.id)} cd 非法: ${fmt(s.cd)}`);
    if (!Number.isFinite(s.cost) || s.cost < 0) errors.push(`${fmt(s.id)} cost 非法: ${fmt(s.cost)}`);
    if (!Number.isFinite(s.dmgMult) || s.dmgMult < 0) errors.push(`${fmt(s.id)} dmgMult 非法: ${fmt(s.dmgMult)}`);
    if (s.priority !== undefined && !Number.isFinite(s.priority)) errors.push(`${fmt(s.id)} priority 非法: ${fmt(s.priority)}`);
    if (s.conditionMaxHPPct !== undefined && (!Number.isFinite(s.conditionMaxHPPct) || s.conditionMaxHPPct <= 0 || s.conditionMaxHPPct > 100)) {
      errors.push(`${fmt(s.id)} conditionMaxHPPct 非法（需 0<x≤100）: ${fmt(s.conditionMaxHPPct)}`);
    }
    if (!['gcd', 'ogcd', 'buff', 'dot', 'debuff', 'domain', 'passive'].includes(s.type)) {
      errors.push(`${fmt(s.id)} type 非法: ${fmt(s.type)}`);
    }
    if (s.effects !== undefined && !Array.isArray(s.effects)) {
      errors.push(`${fmt(s.id)} effects 非法（需数组）: ${typeof s.effects}`);
      continue;
    }
    for (const e of s.effects || []) {
      if (!e || typeof e !== 'object') {
        errors.push(`${fmt(s.id)} 效果条目非法（需对象）: ${fmt(e)}`);
        continue;
      }
      if (!EFFECT_TYPES.includes(e.type)) errors.push(`${fmt(s.id)} 效果类型未知: ${fmt(e.type)}`);
      if (e.type === 'domain' && !DOMAIN_TYPES.includes(e.domainType)) {
        errors.push(`${fmt(s.id)} 领域类型未知: ${fmt(e.domainType)}`);
      }
      // 子字段必填 + 数值合法性
      for (const f of EFFECT_REQUIRED[e.type] || []) {
        if (e[f] === undefined) errors.push(`${fmt(s.id)} 效果 ${fmt(e.type)} 缺字段 ${f}`);
        else if (EFFECT_NUMERIC.includes(f) && (!Number.isFinite(e[f]) || e[f] < 0)) {
          errors.push(`${fmt(s.id)} 效果 ${fmt(e.type)} 字段 ${f} 非法（需数字 ≥0）: ${fmt(e[f])}`);
        }
      }
      // 契约：需要持续的效果 dur 必须 > 0（dur=0 无意义，数据层拒绝）
      if (EFFECT_NEEDS_DUR.includes(e.type) && (!Number.isFinite(e.dur) || e.dur <= 0)) {
        errors.push(`${fmt(s.id)} 效果 ${fmt(e.type)} 需要 dur > 0: ${fmt(e.dur)}`);
      }
    }
  }
  return { count: db.length, errors };
}
