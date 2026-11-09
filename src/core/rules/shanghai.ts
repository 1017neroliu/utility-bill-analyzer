import type { RuleSet } from "../types";

/**
 * 上海居民阶梯价格规则(2026-11 核实)
 *
 * 电:自然年累计;峰谷分时;第一档 0-3120 度(5人口 +1200 度/年 → 4320),
 *     第二档 3120-4800(+1200 → 6000);跨档临界月超基数部分按未分时平均价,
 *     次月恢复峰谷加价。
 * 气:每年 9 月-次年 8 月为一个结算周期(按抄表日略有偏移,此处按账单月近似);
 *     0-310 m³ 一档 3.00,+150 m³/年(5人口 → 460/670)。
 * 水:自然年累计,双月抄表缴费;综合水价(含水)4.05/5.8/8.79,
 *     +100 m³/年(5人口 → 320/400)。价格以当地账单为准,可在界面编辑。
 */
export const shanghai: RuleSet = {
  id: "shanghai",
  name: "上海",
  notes: [
    "电/水按自然年(1月1日–12月31日)累计,燃气按每年 9 月–次年 8 月结算",
    "一户多人口(5人及以上):电 +1,200 度/年、气 +150 m³/年、水 +100 m³/年;资格每 2 年需续办",
    "电跨档临界月:超基数电量按未分时平均价计(二档 +0.05 / 三档 +0.30),次月恢复峰谷加价",
    "水价为综合水价(含排水费);实际价格请以账单为准,可在下方高级设置中修改",
  ],
  electricity: {
    kind: "electricity",
    cycleStartMonth: 1,
    billingMonths: 1,
    peakPrice: [0.617, 0.677, 0.977],
    valleyPrice: [0.307, 0.337, 0.487],
    averagePrice: [0.617, 0.667, 0.917],
    tierLimits: [3120, 4800],
    multiPersonExtraAnnual: 1200,
    crossTierFlatPrice: true,
  },
  gas: {
    kind: "gas",
    label: "燃气",
    unit: "m³",
    cycleStartMonth: 9,
    billingMonths: 1,
    price: [3.0, 3.3, 4.2],
    tierLimits: [310, 520],
    multiPersonExtraAnnual: 150,
  },
  water: {
    kind: "water",
    label: "水",
    unit: "m³",
    cycleStartMonth: 1,
    billingMonths: 2,
    price: [4.05, 5.8, 8.79],
    tierLimits: [220, 300],
    multiPersonExtraAnnual: 100,
  },
};

/** 城市注册表:扩展全国时在这里追加 RuleSet */
export const ruleSets: RuleSet[] = [shanghai];

export function getRuleSet(id: string): RuleSet {
  return ruleSets.find((r) => r.id === id) ?? shanghai;
}
