import type { EngineResult, ResourcePeriod, ResourceType, RuleSet } from "../core/types";
import { monthAdd, monthKey, monthLabel, parseMonth, predictNextCross } from "../core/engine";
import { Card, SectionTitle, RT_COLORS, TIER_COLORS } from "./ui";

const RT_META: Record<ResourceType, { name: string; icon: string; start: number }> = {
  electricity: { name: "电", icon: "⚡", start: 1 },
  gas: { name: "燃气", icon: "🔥", start: 9 },
  water: { name: "水", icon: "💧", start: 1 },
};

const TIER_NAME = ["一档", "二档", "三档"];

/** 周期内 12 个格子:从周期起点月起 */
function cycleMonths(period: ResourcePeriod, startMonth: number): { month: string; data?: ResourcePeriod["months"][number] }[] {
  const year = Number(period.cycleKey.replace(/\D/g, ""));
  const byMonth = new Map(period.months.map((m) => [m.month, m]));
  const out: { month: string; data?: ResourcePeriod["months"][number] }[] = [];
  for (let i = 0; i < 12; i++) {
    const total = year * 12 + (startMonth - 1) + i;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    const key = monthKey(y, m);
    out.push({ month: key, data: byMonth.get(key) });
  }
  return out;
}

function Lane({
  period,
  rt,
  rule,
  multiPerson,
}: {
  period: ResourcePeriod;
  rt: ResourceType;
  rule: RuleSet;
  multiPerson: boolean;
}) {
  const meta = RT_META[rt];
  const color = RT_COLORS[rt];
  const cells = cycleMonths(period, meta.start);
  const resRule = rt === "electricity" ? rule.electricity : rt === "gas" ? rule.gas : rule.water;
  const prediction = predictNextCross(period, resRule, multiPerson);
  const crossedMonths = new Set(period.events.map((e) => e.month));

  return (
    <div className="flex items-center gap-3">
      {/* 行头 */}
      <div className="w-[104px] shrink-0">
        <div className="text-[13px] font-bold text-white/75">{period.cycleKey}</div>
        <div className="text-[11.5px] tabular-nums text-white/35">
          {monthLabel(period.firstMonth)}~{monthLabel(period.lastMonth)}
        </div>
      </div>
      {/* 12 格 */}
      <div className="grid flex-1 gap-[4px]" style={{ gridTemplateColumns: "repeat(12, 1fr)" }}>
        {cells.map(({ month, data }) => {
          const isCross = data?.crossed;
          const isPredict = prediction?.month === month;
          const tier = data ? data.tierEnd - 1 : -1; // 结束档位着色(跨档月显示所达档)
          const bg =
            data
              ? isCross
                ? `linear-gradient(135deg, ${TIER_COLORS[data.tierStart - 1]}44 0 45%, ${TIER_COLORS[data.tierEnd - 1]}55 55% 100%)`
                : TIER_COLORS[tier] + "2e"
              : "transparent";
          return (
            <div
              key={month}
              title={
                data
                  ? `${monthLabel(month)}:${data.amount.toFixed(2)} 元 ≈ ${data.usage.toFixed(1)} ${rt === "electricity" ? "度" : "m³"}${isCross ? ` · 本月跨入${TIER_NAME[data.tierEnd - 1]}` : ""}`
                  : monthLabel(month) + ":无账单"
              }
              className={`relative flex h-[34px] cursor-default items-center justify-center rounded-md border text-[11.5px] font-bold transition-transform hover:scale-[1.08] hover:z-10 ${
                isPredict ? "border-dashed" : ""
              }`}
              style={{
                background: bg,
                borderColor: data ? (isCross ? TIER_COLORS[data.tierEnd - 1] : TIER_COLORS[tier] + "55") : "rgba(255,255,255,0.07)",
                borderWidth: isCross || isPredict ? 1.5 : 1,
                ...(isPredict ? { borderColor: TIER_COLORS[(prediction?.toTier ?? 2) - 1] } : {}),
              }}
            >
              {isCross && <span className="absolute -top-[7px] text-[9px]" style={{ color: TIER_COLORS[data!.tierEnd - 1] }}>▲</span>}
              {isPredict && <span className="absolute -top-[7px] text-[9px]" style={{ color: TIER_COLORS[(prediction?.toTier ?? 2) - 1] }}>?</span>}
              {data && (
                <span style={{ color: TIER_COLORS[tier] }}>
                  {monthLabel(month).split(".")[1]}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {/* 周期小计 */}
      <div className="w-[168px] shrink-0 text-right text-[11.5px] tabular-nums leading-snug text-white/45">
        <div>
          {period.totalUsage.toFixed(0)}
          {rt === "electricity" ? "度" : "m³"} · {period.totalAmount.toFixed(0)}元
        </div>
        <div>
          {period.events.length
            ? period.events.map((e) => `${monthLabel(e.month)}进${TIER_NAME[e.to - 1]}`).join("、")
            : "无跨档"}
        </div>
      </div>
    </div>
  );
}

export default function TierLanes({ result, ruleSet }: { result: EngineResult; ruleSet: RuleSet }) {
  const sections: { rt: ResourceType; periods: ResourcePeriod[] }[] = (
    ["gas", "electricity", "water"] as const
  ).map((rt) => ({ rt, periods: result[rt].periods }));

  return (
    <Card className="p-5">
      <SectionTitle
        icon={<span className="text-[15px]">🧭</span>}
        title="阶梯跳档地图"
        desc="每个结算周期一行(电/水 = 自然年,气 = 每年9月起);格子颜色 = 当月所处档位,▲ = 跨档月,虚线 = 按近期用量的预测"
      />
      {/* 图例 */}
      <div className="mb-3 flex flex-wrap items-center gap-4 text-[12px] text-white/50">
        {TIER_COLORS.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <i className="h-3 w-3 rounded" style={{ background: c + "2e", border: `1px solid ${c}55` }} />
            {TIER_NAME[i]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <i className="h-3 w-3 rounded border border-dashed" style={{ borderColor: TIER_COLORS[1] }} />
          预测跨档
        </span>
        <span>跨档月格子为双色(起始档 → 进入档)</span>
      </div>

      <div className="space-y-5 overflow-x-auto">
        {sections.map(({ rt, periods }) => (
          <div key={rt}>
            <div className="mb-2 flex items-center gap-2 text-[13.5px] font-bold" style={{ color: RT_COLORS[rt] }}>
              <span>{RT_META[rt].icon}</span> {RT_META[rt].name}
              <span className="text-[11.5px] font-normal text-white/35">
                周期起点 {RT_META[rt].start} 月 · {rt === "water" ? "双月账单" : "每月账单"}
              </span>
            </div>
            <div className="space-y-2">
              {periods.map((p) => (
                <Lane key={p.cycleKey} period={p} rt={rt} rule={ruleSet} multiPerson={result.options.multiPerson} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
