// ===== 核心类型定义 =====
// 设计原则:规则全部数据化(档位、单价、周期、账单频率、一户多人口增量),
// 新增城市 = 新增一个 RuleSet 文件,引擎零改动。

export type ResourceType = "electricity" | "gas" | "water";

/** 一个账单月:month 格式 'YYYY-MM';金额为该月账单总额,undefined/0 表示该月无账单 */
export interface BillMonth {
  month: string; // 'YYYY-MM'
  electricity?: number;
  gas?: number;
  water?: number;
}

/** 电价规则:峰谷分时 + 年度累计阶梯 */
export interface ElectricityRule {
  kind: "electricity";
  /** 结算周期起点月:1 = 自然年(上海) */
  cycleStartMonth: number;
  /** 账单频率(月):1 = 每月 */
  billingMonths: number;
  /** 各档峰段单价(元/度) [一档, 二档, 三档] */
  peakPrice: [number, number, number];
  /** 各档谷段单价 [一档, 二档, 三档] */
  valleyPrice: [number, number, number];
  /** 各档未分时单价(跨档临界月超基数部分按此价计) [0.617, 0.667, 0.917] */
  averagePrice: [number, number, number];
  /** 阶梯上限(默认户) [一档上限, 二档上限],如 [3120, 4800] */
  tierLimits: [number, number];
  /** 一户多人口每户每年增加的额度(如上海电 +1200 度/年),0 = 不支持 */
  multiPersonExtraAnnual: number;
  /** 跨档临界月超基数部分是否按未分时平均价计(上海真实规则) */
  crossTierFlatPrice: boolean;
}

/** 气/水规则:单价阶梯(无峰谷) */
export interface SimpleResourceRule {
  kind: "gas" | "water";
  cycleStartMonth: number; // 气 = 9(上海), 水 = 1
  billingMonths: number; // 气 = 1, 水 = 2
  /** 各档单价 [一档, 二档, 三档] */
  price: [number, number, number];
  tierLimits: [number, number];
  multiPersonExtraAnnual: number;
  /** 资源显示名 */
  label: string;
  unit: string;
}

export type ResourceRule = ElectricityRule | SimpleResourceRule;

export interface RuleSet {
  id: string;
  name: string;
  /** 电价水费是否含排水费等说明 */
  notes: string[];
  electricity: ElectricityRule;
  gas: SimpleResourceRule;
  water: SimpleResourceRule;
}

/** 引擎可调参数(用户可改) */
export interface EngineOptions {
  /** 是否按"一户多人口(5人及以上)"档位 */
  multiPerson: boolean;
  /** 峰电量占比(0~1),用于把电费金额反推为电量;仅影响电量估计,不影响金额 */
  peakRatio: number;
  /** 价格覆盖(用户编辑单价后覆盖内置规则),键如 'electricity.peakPrice.0' */
  priceOverrides?: Record<string, number>;
}

// ===== 引擎输出 =====

/** 周期内单月分解结果 */
export interface MonthBreakdown {
  month: string;
  amount: number;
  /** 反推用量(电=度,气/水=m³) */
  usage: number;
  /** 当月起始档位(1~3) */
  tierStart: number;
  /** 当月结束档位(1~3) */
  tierEnd: number;
  /** 当月是否发生跨档 */
  crossed: boolean;
  /** 周期内累计用量 */
  cumUsage: number;
}

export interface TierEvent {
  month: string;
  from: number;
  to: number;
}

/** 一个结算周期的分析结果 */
export interface ResourcePeriod {
  resourceType: ResourceType;
  /** 周期标识,如 '2025'/'2025-09起' */
  cycleKey: string;
  /** 周期起止(数据可见范围) */
  firstMonth: string;
  lastMonth: string;
  /** 数据是否覆盖完整周期(起点是否从周期首月开始) */
  cycleStartCovered: boolean;
  months: MonthBreakdown[];
  events: TierEvent[];
  /** 各档用量 [一档, 二档, 三档] */
  tierUsage: [number, number, number];
  totalUsage: number;
  totalAmount: number;
  /** 该周期内阶梯加价支出(相对全部按一档价) */
  surcharge: number;
}

export interface ResourceAnalysis {
  resourceType: ResourceType;
  periods: ResourcePeriod[];
  /** 全部周期合计 */
  totalAmount: number;
  totalUsage: number;
  /** 全部周期各档用量 */
  tierUsage: [number, number, number];
}

/** 5人口价值测算(对最近一个完整可见周期或全部数据) */
export interface SavingsItem {
  resourceType: ResourceType;
  /** 实际缴纳(按当前开关状态计算) */
  actualCost: number;
  /** 若未申请/申请(与当前开关相反状态)同样用量下的费用 */
  alternativeCost: number;
  saving: number;
  /** 相反状态下的跨档月份(提前量) */
  alternativeCrossMonths: string[];
}

export interface EngineResult {
  ruleSetId: string;
  options: EngineOptions;
  electricity: ResourceAnalysis;
  gas: ResourceAnalysis;
  water: ResourceAnalysis;
  totalAmount: number;
  /** 一户多人口价值测算 */
  savings: SavingsItem[];
  warnings: string[];
}

/** 解析结果 */
export interface ParseResult {
  bills: BillMonth[];
  warnings: string[];
  /** 识别到的表头映射描述 */
  mapping: string;
  /** 是否需要 AI 兜底映射 */
  needAiMap: boolean;
  /** AI 映射所需的原始信息 */
  rawPreview?: { headers: string[]; rows: string[][] };
}
