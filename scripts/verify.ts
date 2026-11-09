// 引擎准确性验证(基线 = 官方结算周期口径:电/水自然年、气 9月至次年8月)
// 连续口径的手算锚点:
//   电:2025周期(11-12月)= 260.9元/546.4度;2026周期(1-10月)= 2044.9元/4282.5度(未跨档,距4320度差37度)
//   气:周期1(25.11-26.8账单)= 2127元 → 一档460+二档210+三档(2127-2073)/4.2=12.86;周期2(26.9-10)= 177元/59m³
//   水:2026周期 = 1178.65元/291.0m³(未跨档);2025周期 = 162元/40m³
//   5人口节省(全部周期):电 117.7(跨档平均价口径)/54.1(关)、气 180、水 124.3
// 运行:npx tsx scripts/verify.ts
import { analyzeBills } from "../src/core/engine";
import { shanghai } from "../src/core/rules/shanghai";
import type { BillMonth } from "../src/core/types";

const bills: BillMonth[] = [
  { month: "2025-11", electricity: 106.7, water: 162, gas: 117 },
  { month: "2025-12", electricity: 154.2, gas: 234 },
  { month: "2026-01", electricity: 163.7, water: 247.05, gas: 447 },
  { month: "2026-02", electricity: 128.6, gas: 423 },
  { month: "2026-03", electricity: 157, water: 206.55, gas: 217.8 },
  { month: "2026-04", electricity: 109.1, gas: 188.4 },
  { month: "2026-05", electricity: 138.2, water: 226.8, gas: 168 },
  { month: "2026-06", electricity: 198, gas: 121.8 },
  { month: "2026-07", electricity: 412.9, water: 238.95, gas: 113.4 },
  { month: "2026-08", electricity: 394.7, gas: 96.6 },
  { month: "2026-09", electricity: 226.3, water: 259.3, gas: 78 },
  { month: "2026-10", electricity: 116.4, gas: 99 },
];

let failed = 0;
function check(name: string, actual: unknown, expected: unknown, tol = 0.2) {
  const ok =
    typeof expected === "number"
      ? Math.abs((actual as number) - expected) <= tol
      : actual === expected;
  if (!ok) {
    failed++;
    console.log(`✗ ${name}: 实际=${actual} 期望=${expected}`);
  } else {
    console.log(`✓ ${name}: ${typeof actual === "number" ? (actual as number).toFixed(2) : actual}`);
  }
}

const r1 = analyzeBills(bills, shanghai, { multiPerson: true, peakRatio: 0.55 });
const r1noFlat = analyzeBills(
  bills,
  { ...shanghai, electricity: { ...shanghai.electricity, crossTierFlatPrice: false } },
  { multiPerson: true, peakRatio: 0.55 },
);

console.log("== 电(5人口 4320/6000,峰谷 55:45)==");
check("全年电费", r1.electricity.totalAmount, 2305.8, 0.01);
check("全年电量", r1.electricity.totalUsage, 4828.9, 1);
const e2025 = r1.electricity.periods.find((p) => p.cycleKey === "2025年度")!;
const e2026 = r1.electricity.periods.find((p) => p.cycleKey === "2026年度")!;
check("2025周期电量(11-12月)", e2025.totalUsage, 546.4, 0.5);
check("2026周期电量(1-10月)", e2026.totalUsage, 4282.5, 1);
check("2026周期无跨档(差37度)", e2026.events.length, 0);
check("2026-09 用量", e2026.months.find((m) => m.month === "2026-09")!.usage, 226.3 / 0.4775, 0.5);
check("平均价开关不影响(本数据官方口径下电无跨档)", r1.electricity.totalUsage, r1noFlat.electricity.totalUsage, 0.01);

console.log("== 气(5人口 460/670,周期=每年9月起)==");
check("全年气费", r1.gas.totalAmount, 2304, 0.01);
check("全年气量", r1.gas.totalUsage, 741.9, 0.5);
const g1 = r1.gas.periods.find((p) => p.cycleKey === "2025")!;
const g2 = r1.gas.periods.find((p) => p.cycleKey === "2026")!;
check("周期1用量", g1.totalUsage, 682.9, 0.5);
check("周期1跨档", g1.events.map((e) => `${e.month}:${e.to}`).join(","), "2026-03:2,2026-08:3");
check("周期1三档用量", g1.tierUsage[2], 2127 - 2073 === 0 ? 0 : 54 / 4.2, 0.3);
check("周期2(新周期)用量", g2.totalUsage, 59, 0.5);
check("周期2无跨档", g2.events.length, 0);
check("各档用量(跨周期累计)", r1.gas.tierUsage.map((x) => Math.round(x)).join("/"), "519/210/13");

console.log("== 水(5人口 320/400,双月账单)==");
check("全年水费", r1.water.totalAmount, 1340.65, 0.01);
check("全年水量", r1.water.totalUsage, 331.0, 0.5);
const w2026 = r1.water.periods.find((p) => p.cycleKey === "2026")!;
check("2026周期水量", w2026.totalUsage, 291.0, 0.5);
check("2026周期无跨档(差29m³)", w2026.events.length, 0);

console.log("== 5人口价值(全部周期,用量不变按未申请重算)==");
const sav = Object.fromEntries(r1.savings.map((s) => [s.resourceType, s]));
check("电节省(跨档平均价口径)", sav.electricity.saving, 117.7, 1);
check("电未申请跨档月", sav.electricity.alternativeCrossMonths.join(","), "2026-08");
check("气节省", sav.gas.saving, 180, 0.5);
check("气未申请跨档月", sav.gas.alternativeCrossMonths.join(","), "2026-02,2026-04");
check("水节省", sav.water.saving, 124.3, 1);
check("水未申请跨档月", sav.water.alternativeCrossMonths.join(","), "2026-07");

console.log("== 未申请 5人口(默认档 3120/4800、310/520、220/300)==");
const r2 = analyzeBills(bills, shanghai, { multiPerson: false, peakRatio: 0.55 });
check("默认档气量", r2.gas.totalUsage, 699.0, 0.5);
const gCross2 = r2.gas.periods.find((p) => p.cycleKey === "2025")!.events;
check("气跨档(默认档)", gCross2.map((e) => `${e.month}:${e.to}`).join(","), "2026-02:2,2026-04:3");
// 申请后(从默认档反推)的价值:反过来测算应同样为正
check("申请价值=气", sav.gas.saving, 180, 0.5);

console.log("== 跨档平均价规则单独验证(构造跨档场景)==");
// 构造:一年 12 个月,每月 400 元,总额 4800 元 → 一档 4320 度(mix 0.4775 → 2062.8 元)后跨档
const billsCross: BillMonth[] = Array.from({ length: 12 }, (_, i) => ({
  month: `2026-${String(i + 1).padStart(2, "0")}`,
  electricity: 400,
}));
const rc = analyzeBills(billsCross, shanghai, { multiPerson: true, peakRatio: 0.55 });
const pc = rc.electricity.periods[0];
const crossMonth = pc.months.find((m) => m.crossed)!;
check("跨档月", crossMonth.month, "2026-06", 0);
// 跨档月:一档部分(2062.8-2000=62.8元 → 131.5度) + 超基数部分按平均价 0.667
check("跨档月用量", crossMonth.usage, 62.8 / 0.4775 + 337.2 / 0.667, 2);
const nextMonth = pc.months[pc.months.indexOf(crossMonth) + 1];
check("次月恢复峰谷混合价", nextMonth.usage, 400 / 0.524, 0.5);
const rcNoFlat = analyzeBills(
  billsCross,
  { ...shanghai, electricity: { ...shanghai.electricity, crossTierFlatPrice: false } },
  { multiPerson: true, peakRatio: 0.55 },
);
const crossMonthNF = rcNoFlat.electricity.periods[0].months.find((m) => m.crossed)!;
check("关闭平均价:跨档月全按混合价", crossMonthNF.usage, 62.8 / 0.4775 + 337.2 / 0.524, 2);

console.log(failed === 0 ? "\n✅ 全部通过" : `\n❌ ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
