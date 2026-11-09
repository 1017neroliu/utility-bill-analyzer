import { Users, PiggyBank } from "lucide-react";
import type { EngineResult, ResourceAnalysis, ResourceType, RuleSet } from "../core/types";
import { effectiveLimits } from "../core/engine";
import { Card, SectionTitle, RT_COLORS, TIER_COLORS } from "./ui";

const RT_META: Record<ResourceType, { name: string; unit: string; icon: string }> = {
  electricity: { name: "电", unit: "度", icon: "⚡" },
  gas: { name: "燃气", unit: "m³", icon: "🔥" },
  water: { name: "水", unit: "m³", icon: "💧" },
};
const TIER_NAME = ["一档", "二档", "三档"];

/** 档位进度条:最新周期用量 vs 档位边界 */
function ProgressRow({ analysis, rt, limits, unit }: { analysis: ResourceAnalysis; rt: ResourceType; limits: [number, number]; unit: string }) {
  const period = analysis.periods[analysis.periods.length - 1];
  if (!period) return null;
  const used = period.totalUsage;
  const scale = limits[1] * 1.25;
  const pct = (v: number) => (v / scale) * 100;
  const segs: { w: number; c: string }[] = [];
  // 一档内部分
  const inT1 = Math.min(used, limits[0]);
  const inT2 = Math.max(0, Math.min(used, limits[1]) - limits[0]);
  const inT3 = Math.max(0, used - limits[1]);
  const base = rt === "electricity" ? "#34d399" : RT_COLORS[rt];
  if (inT1 > 0) segs.push({ w: pct(inT1), c: TIER_COLORS[0] + "b3" });
  if (inT2 > 0) segs.push({ w: pct(inT2), c: TIER_COLORS[1] + "b3" });
  if (inT3 > 0) segs.push({ w: pct(inT3), c: TIER_COLORS[2] + "b3" });

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[13.5px] font-bold text-white/80">
          {RT_META[rt].icon} {RT_META[rt].name}
          <span className="ml-2 text-[11.5px] font-normal text-white/35">{period.cycleKey} 周期</span>
        </span>
        <span className="text-[12px] tabular-nums text-white/55">
          <b style={{ color: base }}>{used.toLocaleString("zh-CN", { maximumFractionDigits: 1 })}</b> / {limits[1].toLocaleString()} {unit}
        </span>
      </div>
      <div className="relative h-[18px] w-full overflow-hidden rounded-full border border-white/[0.07] bg-white/[0.04]">
        <div className="flex h-full">
          {segs.map((s, i) => (
            <div key={i} style={{ width: `${s.w}%`, background: s.c }} />
          ))}
        </div>
        <div className="absolute top-0 h-full w-[2px] bg-white/50" style={{ left: `${pct(limits[0])}%` }} />
        <div className="absolute top-0 h-full w-[2px] bg-white/50" style={{ left: `${pct(limits[1])}%` }} />
      </div>
      <div className="relative mt-0.5 h-[16px] text-[10.5px] text-white/35">
        <span className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${pct(limits[0])}%` }}>
          {limits[0].toLocaleString()}
        </span>
        <span className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${pct(limits[1])}%` }}>
          {limits[1].toLocaleString()}
        </span>
      </div>
    </div>
  );
}

export default function SavingsPanel({ result, ruleSet }: { result: EngineResult; ruleSet: RuleSet }) {
  const totalSaving = result.savings.reduce((s, x) => s + x.saving, 0);
  const applied = result.options.multiPerson;
  const limitsOf = (rt: ResourceType): [number, number] =>
    rt === "electricity"
      ? effectiveLimits(ruleSet.electricity, applied)
      : rt === "gas"
        ? effectiveLimits(ruleSet.gas, applied)
        : effectiveLimits(ruleSet.water, applied);

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
      {/* 档位进度 */}
      <Card className="p-5">
        <SectionTitle icon={<PiggyBank className="h-4 w-4 text-white/60" />} title="档位用量进度" desc="最新结算周期的累计用量落在哪一档" />
        <div className="space-y-5">
          {(["electricity", "gas", "water"] as const).map((rt) => (
            <ProgressRow key={rt} analysis={result[rt]} rt={rt} limits={limitsOf(rt)} unit={RT_META[rt].unit} />
          ))}
        </div>
      </Card>

      {/* 一户多人口价值 */}
      <Card className="p-5">
        <SectionTitle
          icon={<Users className="h-4 w-4 text-emerald-300" />}
          title="一户多人口(5人)价值测算"
          desc="用量是物理事实,不随档位改变;按当前用量的用量向量,对比申请与未申请两套档位的费用"
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] text-[13px]">
            <thead>
              <tr className="text-left text-[12px] uppercase tracking-wider text-white/40">
                <th className="pb-2 pr-2 font-semibold">资源</th>
                <th className="pb-2 px-2 font-semibold">当前({applied ? "5人口档" : "默认档"})</th>
                <th className="pb-2 px-2 font-semibold">{applied ? "若未申请" : "若申请"}</th>
                <th className="pb-2 pl-2 font-semibold">差额</th>
              </tr>
            </thead>
            <tbody>
              {result.savings.map((s) => (
                <tr key={s.resourceType} className="border-t border-white/[0.06]">
                  <td className="py-2.5 pr-2 font-bold" style={{ color: RT_COLORS[s.resourceType] }}>
                    {RT_META[s.resourceType].icon} {RT_META[s.resourceType].name}
                  </td>
                  <td className="py-2.5 px-2 tabular-nums text-white/70">{s.actualCost.toFixed(2)} 元</td>
                  <td className="py-2.5 px-2 tabular-nums text-white/50">
                    {s.alternativeCost.toFixed(2)} 元
                    {s.alternativeCrossMonths.length > 0 && (
                      <span className="ml-1 text-[11px] text-white/35">(跨档:{s.alternativeCrossMonths.map((m) => m.slice(2).replace("-", ".")).join("、")})</span>
                    )}
                  </td>
                  <td className="py-2.5 pl-2 tabular-nums font-bold text-emerald-400">
                    {s.saving >= 0 ? "省 " : "多付 "}
                    {Math.abs(s.saving).toFixed(2)} 元
                  </td>
                </tr>
              ))}
              <tr className="border-t border-emerald-400/20 bg-emerald-400/[0.05]">
                <td className="py-2.5 pr-2 font-bold text-emerald-300" colSpan={3}>
                  {applied ? "已生效的合计节省" : "申请后可节省的合计"}
                </td>
                <td className="py-2.5 pl-2 text-[15px] font-black tabular-nums text-emerald-400">
                  {Math.abs(totalSaving).toFixed(2)} 元
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[12.5px] leading-relaxed text-amber-300/85">
          {applied
            ? "⚠️ 一户多人口资格每 2 年需续办(随申办 →「阶梯水电气一户多人口一件事」),逾期未续办将恢复默认档计费。"
            : "💡 户籍人口满 5 人即可在随申办线上申请(电 +1,200 度/年、气 +150 m³/年、水 +100 m³/年);满 7 人还可选择执行居民阶梯平均价。"}
        </div>
      </Card>
    </div>
  );
}
