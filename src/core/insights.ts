import type { EngineResult, ResourceAnalysis, ResourcePeriod } from "./types";
import { monthDiff, monthLabel, predictNextCross } from "./engine";
import type { RuleSet } from "./types";

const RT_META: Record<string, { name: string; unit: string; icon: string }> = {
  electricity: { name: "电", unit: "度", icon: "⚡" },
  gas: { name: "燃气", unit: "m³", icon: "🔥" },
  water: { name: "水", unit: "m³", icon: "💧" },
};

const TIER_NAME = ["一档", "二档", "三档"];

function fmt(n: number, digits = 0): string {
  return n.toLocaleString("zh-CN", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** 从全部周期提取按月排序的用量序列(用于季节检测) */
function monthlySeries(a: ResourceAnalysis): { month: string; usage: number; amount: number }[] {
  return a.periods.flatMap((p) => p.months.map((m) => ({ month: m.month, usage: m.usage, amount: m.amount })));
}

function seasonTest(series: { month: string; usage: number }[]) {
  const winter: number[] = [];
  const summer: number[] = [];
  const spring: number[] = [];
  for (const s of series) {
    const mo = Number(s.month.slice(5, 7));
    if ([11, 12, 1, 2].includes(mo)) winter.push(s.usage);
    else if ([6, 7, 8, 9].includes(mo)) summer.push(s.usage);
    else if ([3, 4, 5, 10].includes(mo)) spring.push(s.usage);
  }
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return { winter: avg(winter), summer: avg(summer), spring: avg(spring), winterN: winter.length, summerN: summer.length };
}

function periodLine(p: ResourcePeriod): string {
  const evParts = p.events.map((e) => `**${monthLabel(e.month)}** 进入${TIER_NAME[e.to - 1]}`).join("、");
  const ev = evParts ? `;跳档:${evParts}` : ";未发生跳档";
  const cov = p.cycleStartCovered ? "" : "(数据未覆盖周期起点,时点可能有 ±1 个月偏差)";
  return `- **${p.cycleKey}**(${monthLabel(p.firstMonth)} ~ ${monthLabel(p.lastMonth)}):用量 ${fmt(p.totalUsage, 1)} ${RT_META[p.resourceType].unit}、费用 ${fmt(p.totalAmount, 2)} 元${ev}${cov}`;
}

export function buildInsights(result: EngineResult, ruleSet: RuleSet): string {
  const parts: string[] = [];
  const monthsCount = Math.max(
    result.electricity.periods.reduce((s, p) => s + p.months.length, 0),
    result.gas.periods.reduce((s, p) => s + p.months.length, 0),
    result.water.periods.reduce((s, p) => s + p.months.length, 0),
  );

  // ---- 概览 ----
  parts.push("## 一、总览\n");
  const mp = result.options.multiPerson ? "一户多人口(5人)档" : "默认档";
  parts.push(
    `共 ${monthsCount} 个月账单,总支出 **${fmt(result.totalAmount, 2)} 元**(按上海规则 · ${mp} · 峰谷比 ${Math.round(result.options.peakRatio * 100)}:${100 - Math.round(result.options.peakRatio * 100)})。\n`,
  );
  const rows: string[] = [];
  for (const rt of ["electricity", "gas", "water"] as const) {
    const a = result[rt];
    const meta = RT_META[rt];
    const share = result.totalAmount > 0 ? ((a.totalAmount / result.totalAmount) * 100).toFixed(1) : "0";
    rows.push(`| ${meta.icon} ${meta.name} | ${fmt(a.totalAmount, 2)} 元 | ${share}% | ≈ ${fmt(a.totalUsage, 1)} ${meta.unit} | ${fmt(a.tierUsage[0], 1)} / ${fmt(a.tierUsage[1], 1)} / ${fmt(a.tierUsage[2], 1)} |`);
  }
  parts.push("| 资源 | 费用 | 占比 | 折合用量 | 各档用量(一/二/三) |");
  parts.push("|---|---|---|---|---|");
  parts.push(...rows, "");

  // ---- 每个资源的周期与跳档 ----
  parts.push("## 二、结算周期与跳档复盘\n");
  for (const rt of ["electricity", "gas", "water"] as const) {
    const a = result[rt];
    const meta = RT_META[rt];
    parts.push(`### ${meta.icon} ${meta.name}\n`);
    for (const p of a.periods) parts.push(periodLine(p));
    // 预测
    const lastPeriod = a.periods[a.periods.length - 1];
    if (lastPeriod) {
      const rule = rt === "electricity" ? ruleSet.electricity : rt === "gas" ? ruleSet.gas : ruleSet.water;
      const pred = predictNextCross(lastPeriod, rule, result.options.multiPerson);
      if (pred) {
        parts.push(`- 📌 预测:按近期用量节奏,预计 **${monthLabel(pred.month)}** 进入${TIER_NAME[pred.toTier - 1]}\n`);
      }
    }
    parts.push("");
  }

  // ---- 季节特征 ----
  parts.push("## 三、季节特征\n");
  const gasSeason = seasonTest(monthlySeries(result.gas));
  const elecSeason = seasonTest(monthlySeries(result.electricity));
  if (gasSeason.winterN >= 2 && gasSeason.summerN >= 2 && gasSeason.summer > 0) {
    const ratio = gasSeason.winter / gasSeason.summer;
    if (ratio >= 1.5) {
      parts.push(`- 🔥 **燃气冬高夏低**:冬季月均 ${fmt(gasSeason.winter, 1)} m³,是夏季(${fmt(gasSeason.summer, 1)} m³)的 **${fmt(ratio, 1)} 倍** —— 地暖/采暖是燃气支出主导因素。`);
    } else {
      parts.push(`- 🔥 燃气冬季月均 ${fmt(gasSeason.winter, 1)} m³ vs 夏季 ${fmt(gasSeason.summer, 1)} m³,季节差异不显著(可能以炊事/热水为主)。`);
    }
  }
  if (elecSeason.summerN >= 2 && elecSeason.spring > 0) {
    const ratio = elecSeason.summer / Math.max(elecSeason.spring, 1);
    if (ratio >= 1.6) {
      parts.push(`- ⚡ **夏季空调高峰**:夏月均 ${fmt(elecSeason.summer, 1)} 度,是春秋(${fmt(elecSeason.spring, 1)} 度)的 **${fmt(ratio, 1)} 倍**。`);
    }
  }
  const waterSeries = monthlySeries(result.water);
  if (waterSeries.length >= 3) {
    const usages = waterSeries.map((w) => w.usage);
    const mean = usages.reduce((a, b) => a + b, 0) / usages.length;
    const sd = Math.sqrt(usages.reduce((a, b) => a + (b - mean) ** 2, 0) / usages.length);
    const cv = mean > 0 ? sd / mean : 0;
    parts.push(
      cv < 0.3
        ? `- 💧 **用水平稳**:单张账单 ${fmt(Math.min(...usages), 1)} ~ ${fmt(Math.max(...usages), 1)} m³,波动系数 ${(cv * 100).toFixed(0)}%。`
        : `- 💧 用水波动较大(波动系数 ${(cv * 100).toFixed(0)}%),可关注高用水账单覆盖的月份。`,
    );
  }
  parts.push("");

  // ---- 一户多人口价值 ----
  parts.push("## 四、一户多人口(5人)价值测算\n");
  const names: Record<string, string> = { electricity: "⚡ 电", gas: "🔥 燃气", water: "💧 水" };
  const altLabel = result.options.multiPerson ? "若未申请(同样用量)" : "若申请(同样用量)";
  parts.push("| 资源 | 当前费用 | " + altLabel + " | 差额 |");
  parts.push("|---|---|---|---|");
  let totalSaving = 0;
  for (const s of result.savings) {
    totalSaving += s.saving;
    const crossInfo = s.alternativeCrossMonths.length
      ? `(跨档月:${s.alternativeCrossMonths.map(monthLabel).join("、")})`
      : "";
    parts.push(`| ${names[s.resourceType]} | ${fmt(s.actualCost, 2)} 元 | ${fmt(s.alternativeCost, 2)} 元 | **${s.saving >= 0 ? "省" : "多付"} ${fmt(Math.abs(s.saving), 2)} 元** ${crossInfo} |`);
  }
  parts.push(`\n> ${result.options.multiPerson
    ? `当前按 5人口档计费,合计已**节省 ≈ ${fmt(totalSaving, 2)} 元/周期**。⚠️ 资格每 2 年需续办,逾期取消。`
    : `若申请一户多人口(5人及以上),按当前用量合计可**省 ≈ ${fmt(totalSaving, 2)} 元/周期**(约 ${fmt(totalSaving / 12, 0)} 元/月)。随申办可线上办理。`}\n`);

  // ---- 建议 ----
  parts.push("## 五、建议\n");
  const tips: string[] = [];
  if (gasSeason.winter / Math.max(gasSeason.summer, 1) >= 1.5) {
    tips.push("**冬天管住地暖 = 管住燃气费**:地暖设定 18–20°C、出门/夜间切低温运行、避免频繁启停,通常可省 10–15% 采暖燃气。");
  }
  if (elecSeason.summer / Math.max(elecSeason.spring, 1) >= 1.6) {
    tips.push("**夏天空调是电费大头**:温度 +1°C、配合风扇循环、定期清洁滤网,可省 6–10% 夏季电费。");
  }
  if (result.options.peakRatio < 0.65) {
    tips.push("**用好峰谷价差**:谷段(22:00–次日 6:00)电价约为峰段一半,把热水器加热、洗衣、洗碗机等可移动负荷安排到谷段。");
  }
  const gasLast = result.gas.periods[result.gas.periods.length - 1];
  if (gasLast && gasLast.events.some((e) => e.to === 3)) {
    tips.push("**燃气已触三档(4.2 元/m³)**:地暖季末段(2–3 月)留意账单累计气量,高耗气活动(长时间热水)尽量错开。");
  }
  tips.push("**关注 11–12 月账单**:电/水按自然年累计,年末跨档加价属正常现象,次年 1 月基数重新累计,不是用量突然增加。");
  parts.push(...tips.map((t, i) => `${i + 1}. ${t}`), "");
  return parts.join("\n");
}
