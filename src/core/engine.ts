import type {
  BillMonth,
  EngineOptions,
  EngineResult,
  ElectricityRule,
  MonthBreakdown,
  ResourceAnalysis,
  ResourcePeriod,
  RuleSet,
  SavingsItem,
  SimpleResourceRule,
  TierEvent,
  ResourceType,
} from "./types";

const EPS = 1e-9;

// ================= 月份工具 =================

export function parseMonth(m: string): { y: number; m: number } | null {
  const match = /^(\d{4})[-/.年](\d{1,2})月?$/.exec(m.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const mo = Number(match[2]);
  if (mo < 1 || mo > 12) return null;
  return { y, m: mo };
}

export function monthKey(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function monthAdd(month: string, n: number): string {
  const { y, m } = parseMonth(month)!;
  const total = y * 12 + (m - 1) + n;
  return monthKey(Math.floor(total / 12), (total % 12) + 1);
}

export function monthDiff(a: string, b: string): number {
  const pa = parseMonth(a)!;
  const pb = parseMonth(b)!;
  return pb.y * 12 + pb.m - (pa.y * 12 + pa.m);
}

export function monthLabel(m: string): string {
  const { y, m: mo } = parseMonth(m)!;
  return `${String(y).slice(2)}.${mo}`;
}

// ================= 阶梯分解:金额 → 用量 =================

export interface DecomposeInput {
  /** 周期内按时间升序的账单金额(元) */
  amounts: number[];
  /** 各档单价(对电=峰谷混合价) */
  prices: [number, number, number];
  /** 各档未分时价(仅电使用) */
  flatPrices?: [number, number, number];
  /** 阶梯上限(度/m³) */
  limits: [number, number];
  /** 跨档临界月超基数按未分时平均价(上海电) */
  crossTierFlatPrice?: boolean;
}

export interface DecomposeOutput {
  /** 每月:用量、起始/结束档位、是否跨档 */
  months: { usage: number; fromTier: number; toTier: number; crossed: boolean }[];
  cumUsage: number;
  tierUsage: [number, number, number];
  events: { index: number; from: number; to: number }[];
}

/**
 * 将一串账单金额按"年度累计阶梯"分解为各月用量。
 * 算法:逐月消耗金额;当前档剩余容量用尽则跨档;
 * 电在跨档临界月,超基数部分按未分时平均价(官方规则),次月恢复峰谷混合价。
 */
export function decomposeByAmount(input: DecomposeInput): DecomposeOutput {
  const { amounts, prices, limits } = input;
  const remain: [number, number, number] = [limits[0], limits[1] - limits[0], Infinity];
  let cur = 1; // 当前档位 1~3
  const tierUsage: [number, number, number] = [0, 0, 0];
  const events: { index: number; from: number; to: number }[] = [];
  const months: DecomposeOutput["months"] = [];
  let cum = 0;

  for (let i = 0; i < amounts.length; i++) {
    let left = amounts[i];
    let usageThis = 0;
    const fromTier = cur;
    let crossedThisMonth = false;
    while (left > EPS) {
      if (cur <= 2) {
        const cap = remain[cur - 1];
        const useFlat = !!input.crossTierFlatPrice && crossedThisMonth;
        const p = (useFlat ? input.flatPrices![cur - 1] : prices[cur - 1]);
        const moneyFull = cap * p;
        if (left < moneyFull - EPS) {
          const q = left / p;
          usageThis += q;
          remain[cur - 1] -= q;
          tierUsage[cur - 1] += q;
          left = 0;
        } else {
          const q = cap;
          usageThis += q;
          remain[cur - 1] = 0;
          tierUsage[cur - 1] += q;
          left -= moneyFull;
          crossedThisMonth = true;
          events.push({ index: i, from: cur, to: cur + 1 });
          cur += 1;
        }
      } else {
        const useFlat = !!input.crossTierFlatPrice && crossedThisMonth;
        const p = useFlat ? input.flatPrices![2] : prices[2];
        usageThis += left / p;
        tierUsage[2] += left / p;
        left = 0;
      }
    }
    cum += usageThis;
    months.push({ usage: usageThis, fromTier, toTier: cur, crossed: cur > fromTier });
  }

  return { months, cumUsage: cum, tierUsage, events };
}

// ================= 阶梯计价:用量 → 金额 =================

/**
 * 给定(假设不变的)月度用量向量,按另一套阶梯上限重新计价。
 * 用于 5人口价值测算:用量是物理事实,不随档位改变。
 */
export function costOfUsage(
  usages: number[],
  prices: [number, number, number],
  flatPrices: [number, number, number] | undefined,
  limits: [number, number],
  crossTierFlatPrice: boolean,
): { cost: number; crossMonths: number[] } {
  const remain: [number, number, number] = [limits[0], limits[1] - limits[0], Infinity];
  let cur = 1;
  let total = 0;
  const crossMonths: number[] = [];
  for (let i = 0; i < usages.length; i++) {
    let left = usages[i];
    let crossedThisMonth = false;
    while (left > EPS) {
      if (cur <= 2) {
        const cap = remain[cur - 1];
        const p = crossedThisMonth && crossTierFlatPrice ? flatPrices![cur - 1] : prices[cur - 1];
        if (cap === Infinity || left < cap - EPS) {
          total += left * p;
          if (cap !== Infinity) remain[cur - 1] -= left;
          left = 0;
        } else {
          total += cap * p;
          remain[cur - 1] = 0;
          left -= cap;
          if (!crossedThisMonth) {
            crossedThisMonth = true;
            crossMonths.push(i);
          }
          cur += 1;
        }
      } else {
        const p = crossedThisMonth && crossTierFlatPrice ? flatPrices![2] : prices[2];
        total += left * p;
        left = 0;
      }
    }
  }
  return { cost: total, crossMonths };
}

// ================= 有效规则(应用 5人口 与价格覆盖) =================

export function effectiveLimits(rule: { tierLimits: [number, number]; multiPersonExtraAnnual: number }, multiPerson: boolean): [number, number] {
  if (!multiPerson || rule.multiPersonExtraAnnual <= 0) return [...rule.tierLimits];
  return [rule.tierLimits[0] + rule.multiPersonExtraAnnual, rule.tierLimits[1] + rule.multiPersonExtraAnnual];
}

/** 把用户编辑的价格/档位覆盖应用规则(深拷贝);路径如 'electricity.peakPrice.0' */
export function applyPriceOverrides(ruleSet: RuleSet, overrides?: Record<string, number>): RuleSet {
  if (!overrides || Object.keys(overrides).length === 0) return ruleSet;
  const clone: RuleSet = JSON.parse(JSON.stringify(ruleSet));
  for (const [path, value] of Object.entries(overrides)) {
    const segs = path.split(".");
    let obj = clone as unknown as Record<string, unknown>;
    let valid = true;
    for (let i = 0; i < segs.length - 1; i++) {
      const next = obj[segs[i]];
      if (next == null || typeof next !== "object") {
        valid = false;
        break;
      }
      obj = next as Record<string, unknown>;
    }
    if (valid) obj[segs[segs.length - 1]] = value;
  }
  return clone;
}

function electricMixPrices(rule: ElectricityRule, peakRatio: number): [number, number, number] {
  const r = Math.min(1, Math.max(0, peakRatio));
  return [0, 1, 2].map((i) => rule.peakPrice[i] * r + rule.valleyPrice[i] * (1 - r)) as [number, number, number];
}

// ================= 周期分组 =================

export interface CycleGroup {
  cycleKey: string;
  bills: BillMonth[];
  /** 数据是否从周期首月开始(否则首段累计不完整) */
  startCovered: boolean;
}

/** 按结算周期起点月分组(要求 bills 已按月升序、月连续处理过) */
export function groupByCycle(bills: BillMonth[], cycleStartMonth: number): CycleGroup[] {
  const groups = new Map<string, BillMonth[]>();
  for (const b of bills) {
    const pm = parseMonth(b.month);
    if (!pm) continue;
    // 周期年份:账单月 >= 起点月 → 本年;否则属上一周期
    const cycleYear = pm.m >= cycleStartMonth ? pm.y : pm.y - 1;
    const key = String(cycleYear);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(b);
  }
  // 排序周期(升序),并检查每组首月是否为周期起点月
  const sorted = [...groups.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
  return sorted.map(([cycleKey, bills]) => {
    const startMonthKey = monthKey(Number(cycleKey), cycleStartMonth);
    const startCovered = bills[0].month === startMonthKey;
    return { cycleKey, bills, startCovered };
  });
}

// ================= 资源分析 =================

function pickAmount(b: BillMonth, rt: ResourceType): number | undefined {
  const v = b[rt];
  return v && v > EPS ? v : undefined;
}

function analyzeSimple(
  bills: BillMonth[],
  rule: SimpleResourceRule,
  multiPerson: boolean,
): ResourceAnalysis {
  const limits = effectiveLimits(rule, multiPerson);
  const groups = groupByCycle(bills, rule.cycleStartMonth);
  const periods: ResourcePeriod[] = [];
  for (const g of groups) {
    const amounts: number[] = [];
    const monthKeys: string[] = [];
    for (const b of g.bills) {
      const a = pickAmount(b, rule.kind);
      if (a !== undefined) {
        amounts.push(a);
        monthKeys.push(b.month);
      }
    }
    if (amounts.length === 0) continue;
    const dec = decomposeByAmount({
      amounts,
      prices: rule.price,
      limits,
    });
    const months: MonthBreakdown[] = dec.months.map((d, i) => ({
      month: monthKeys[i],
      amount: amounts[i],
      usage: d.usage,
      tierStart: d.fromTier,
      tierEnd: d.toTier,
      crossed: d.crossed,
      cumUsage: dec.months.slice(0, i + 1).reduce((s, x) => s + x.usage, 0),
    }));
    const events: TierEvent[] = dec.events.map((e) => ({
      month: monthKeys[e.index],
      from: e.from,
      to: e.to,
    }));
    const flatCost = months.reduce((s, m) => s + m.usage * rule.price[0], 0);
    const totalAmount = months.reduce((s, m) => s + m.amount, 0);
    periods.push({
      resourceType: rule.kind,
      cycleKey: g.cycleKey,
      firstMonth: monthKeys[0],
      lastMonth: monthKeys[monthKeys.length - 1],
      cycleStartCovered: g.startCovered,
      months,
      events,
      tierUsage: dec.tierUsage,
      totalUsage: dec.cumUsage,
      totalAmount,
      surcharge: totalAmount - flatCost,
    });
  }
  const tierUsage: [number, number, number] = [0, 0, 0];
  let totalAmount = 0;
  let totalUsage = 0;
  for (const p of periods) {
    for (let i = 0; i < 3; i++) tierUsage[i] += p.tierUsage[i];
    totalAmount += p.totalAmount;
    totalUsage += p.totalUsage;
  }
  return { resourceType: rule.kind, periods, totalAmount, totalUsage, tierUsage };
}

function analyzeElectric(
  bills: BillMonth[],
  rule: ElectricityRule,
  opts: EngineOptions,
): ResourceAnalysis {
  const limits = effectiveLimits(rule, opts.multiPerson);
  const mix = electricMixPrices(rule, opts.peakRatio);
  const groups = groupByCycle(bills, rule.cycleStartMonth);
  const periods: ResourcePeriod[] = [];
  for (const g of groups) {
    const amounts: number[] = [];
    const monthKeys: string[] = [];
    for (const b of g.bills) {
      const a = pickAmount(b, "electricity");
      if (a !== undefined) {
        amounts.push(a);
        monthKeys.push(b.month);
      }
    }
    if (amounts.length === 0) continue;
    const dec = decomposeByAmount({
      amounts,
      prices: mix,
      flatPrices: rule.averagePrice,
      limits,
      crossTierFlatPrice: rule.crossTierFlatPrice,
    });
    const months: MonthBreakdown[] = dec.months.map((d, i) => ({
      month: monthKeys[i],
      amount: amounts[i],
      usage: d.usage,
      tierStart: d.fromTier,
      tierEnd: d.toTier,
      crossed: d.crossed,
      cumUsage: dec.months.slice(0, i + 1).reduce((s, x) => s + x.usage, 0),
    }));
    const events: TierEvent[] = dec.events.map((e) => ({
      month: monthKeys[e.index],
      from: e.from,
      to: e.to,
    }));
    const flatCost = months.reduce((s, m) => s + m.usage * rule.averagePrice[0], 0);
    const totalAmount = months.reduce((s, m) => s + m.amount, 0);
    periods.push({
      resourceType: "electricity",
      cycleKey: `${g.cycleKey}年度`,
      firstMonth: monthKeys[0],
      lastMonth: monthKeys[monthKeys.length - 1],
      cycleStartCovered: g.startCovered,
      months,
      events,
      tierUsage: dec.tierUsage,
      totalUsage: dec.cumUsage,
      totalAmount,
      surcharge: totalAmount - flatCost,
    });
  }
  const tierUsage: [number, number, number] = [0, 0, 0];
  let totalAmount = 0;
  let totalUsage = 0;
  for (const p of periods) {
    for (let i = 0; i < 3; i++) tierUsage[i] += p.tierUsage[i];
    totalAmount += p.totalAmount;
    totalUsage += p.totalUsage;
  }
  return { resourceType: "electricity", periods, totalAmount, totalUsage, tierUsage };
}

// ================= 5人口价值测算 =================

function computeSavings(bills: BillMonth[], ruleSet: RuleSet, opts: EngineOptions): SavingsItem[] {
  const items: SavingsItem[] = [];

  const analyses: Record<ResourceType, ResourceAnalysis> = {
    electricity: analyzeElectric(bills, ruleSet.electricity, opts),
    gas: analyzeSimple(bills, ruleSet.gas, opts.multiPerson),
    water: analyzeSimple(bills, ruleSet.water, opts.multiPerson),
  };

  const configs: { rt: ResourceType; rule: SimpleResourceRule | ElectricityRule; analysis: ResourceAnalysis }[] = [
    { rt: "electricity", rule: ruleSet.electricity, analysis: analyses.electricity },
    { rt: "gas", rule: ruleSet.gas, analysis: analyses.gas },
    { rt: "water", rule: ruleSet.water, analysis: analyses.water },
  ];

  for (const { rt, rule, analysis } of configs) {
    // 对全部结算周期分别测算后求和(每周期独立重置)
    if (analysis.periods.length === 0) continue;
    const isElectric = rule.kind === "electricity";
    const eRule = rule as ElectricityRule;
    const sRule = rule as SimpleResourceRule;
    const mix = isElectric ? electricMixPrices(eRule, opts.peakRatio) : undefined;
    const prices = (isElectric ? mix! : sRule.price) as [number, number, number];
    const flat = isElectric ? eRule.averagePrice : undefined;
    const crossFlat = isElectric ? eRule.crossTierFlatPrice : false;

    // 相反状态:multiPerson=true → 测算"未申请"费用;false → 测算"申请后"费用
    const altLimits = effectiveLimits(rule, !opts.multiPerson);
    let altTotal = 0;
    let actualTotal = 0;
    const crossMonths: string[] = [];
    for (const period of analysis.periods) {
      const usages = period.months.map((m) => m.usage);
      if (usages.length === 0) continue;
      const alt = costOfUsage(usages, prices, flat, altLimits, crossFlat);
      altTotal += alt.cost;
      actualTotal += period.totalAmount;
      for (const i of alt.crossMonths) crossMonths.push(period.months[i].month);
    }
    items.push({
      resourceType: rt,
      actualCost: actualTotal,
      alternativeCost: altTotal,
      saving: altTotal - actualTotal,
      alternativeCrossMonths: crossMonths,
    });
  }
  return items;
}

// ================= 主入口 =================

export function analyzeBills(bills: BillMonth[], ruleSet: RuleSet, opts: EngineOptions): EngineResult {
  const sorted = [...bills]
    .filter((b) => parseMonth(b.month))
    .sort((a, b) => a.month.localeCompare(b.month));

  // 应用用户价格覆盖
  ruleSet = applyPriceOverrides(ruleSet, opts.priceOverrides);

  const warnings: string[] = [];
  if (sorted.length < 12) {
    warnings.push(`仅 ${sorted.length} 个月数据,建议至少 12 个月(一个完整阶梯周期)以获得可靠结论`);
  }
  // 缺月检查
  if (sorted.length >= 2) {
    const first = sorted[0].month;
    const last = sorted[sorted.length - 1].month;
    const span = monthDiff(first, last) + 1;
    if (span > sorted.length) {
      warnings.push(`数据区间 ${first} ~ ${last} 共 ${span} 个月,其中有 ${span - sorted.length} 个月无记录(已按无账单处理)`);
    }
  }

  const electricity = analyzeElectric(sorted, ruleSet.electricity, opts);
  const gas = analyzeSimple(sorted, ruleSet.gas, opts.multiPerson);
  const water = analyzeSimple(sorted, ruleSet.water, opts.multiPerson);

  // 周期不完整提示
  for (const [label, a] of [["电", electricity], ["燃气", gas], ["水", water]] as const) {
    for (const p of a.periods) {
      if (!p.cycleStartCovered) {
        warnings.push(`${label} ${p.cycleKey} 周期数据未从周期起点开始(${p.firstMonth} 起),跳档时点可能偏晚 0–1 个月`);
      }
    }
  }

  const savings = computeSavings(sorted, ruleSet, opts);
  const totalAmount = electricity.totalAmount + gas.totalAmount + water.totalAmount;

  return {
    ruleSetId: ruleSet.id,
    options: opts,
    electricity,
    gas,
    water,
    totalAmount,
    savings,
    warnings,
  };
}

// ================= 下一跳档预测 =================

/**
 * 基于最近账单的平均月用量,预测当前周期内下次跨档月份。
 * 仅当预测月份仍在当前结算周期内时返回,否则返回 null(下周期将从一档重新开始)。
 */
export function predictNextCross(
  period: ResourcePeriod,
  rule: { tierLimits: [number, number]; multiPersonExtraAnnual: number; cycleStartMonth: number; billingMonths: number },
  multiPerson: boolean,
): { month: string; toTier: number } | null {
  const limits = effectiveLimits(rule, multiPerson);
  const last = period.months[period.months.length - 1];
  if (!last || last.tierEnd >= 3) return null;
  const nextLimit = limits[last.tierEnd - 1];
  const remain = nextLimit - last.cumUsage;
  if (remain <= EPS) return null;
  // 平均每月用量:按账单间隔摊薄(双月账单按间隔摊到每月)
  let totalGap = 0;
  for (let i = 1; i < period.months.length; i++) {
    totalGap += monthDiff(period.months[i - 1].month, period.months[i].month);
  }
  const billCount = period.months.length;
  const avgGap = billCount > 1 ? Math.max(1, totalGap / (billCount - 1)) : rule.billingMonths;
  const usagePerMonth = period.totalUsage / billCount / avgGap;
  if (usagePerMonth <= EPS) return null;
  const monthsNeeded = Math.max(1, Math.ceil(remain / usagePerMonth));
  const predictMonth = monthAdd(last.month, monthsNeeded);
  // 预测月份必须仍在当前周期内(周期起点 = cycleKey 年的 cycleStartMonth 月)
  const cycleStartYear = Number(period.cycleKey.replace(/\D/g, ""));
  const pm = parseMonth(predictMonth)!;
  const monthsIntoCycle = (pm.y - cycleStartYear) * 12 + (pm.m - rule.cycleStartMonth);
  if (monthsIntoCycle < 0 || monthsIntoCycle >= 12) return null;
  return { month: predictMonth, toTier: last.tierEnd + 1 };
}
