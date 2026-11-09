import { Zap, Flame, Droplets, Wallet, BarChart3 } from "lucide-react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import type { EngineResult, ResourceAnalysis, ResourceType } from "../core/types";
import { monthLabel } from "../core/engine";
import { Card, SectionTitle, RT_COLORS } from "./ui";

const RT_META: Record<ResourceType, { name: string; unit: string; icon: typeof Zap }> = {
  electricity: { name: "电", unit: "度", icon: Zap },
  gas: { name: "燃气", unit: "m³", icon: Flame },
  water: { name: "水", unit: "m³", icon: Droplets },
};

function fmt(n: number, d = 0) {
  return n.toLocaleString("zh-CN", { maximumFractionDigits: d });
}

export default function Dashboard({ result }: { result: EngineResult }) {
  const monthsCount = Math.max(
    ...(["electricity", "gas", "water"] as const).map((rt) =>
      result[rt].periods.reduce((s, p) => s + p.months.length, 0),
    ),
  );

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={<Wallet className="h-4 w-4 text-white/60" />}
          label="总支出"
          value={fmt(result.totalAmount, 2)}
          unit="元"
          sub={`月均 ≈ ${fmt(result.totalAmount / monthsCount)} 元`}
        />
        {(["electricity", "gas", "water"] as const).map((rt) => {
          const a = result[rt];
          const meta = RT_META[rt];
          return (
            <KpiCard
              key={rt}
              icon={<meta.icon className="h-4 w-4" style={{ color: RT_COLORS[rt] }} />}
              label={`${meta.name}费`}
              value={fmt(a.totalAmount, 2)}
              unit="元"
              sub={`≈ ${fmt(a.totalUsage, 1)} ${meta.unit} · 占比 ${((a.totalAmount / result.totalAmount) * 100).toFixed(1)}%`}
              color={RT_COLORS[rt]}
            />
          );
        })}
      </div>

      {/* 趋势图 ×3 */}
      <div className="grid gap-3 lg:grid-cols-3">
        {(["electricity", "gas", "water"] as const).map((rt) => (
          <ResourceChart key={rt} analysis={result[rt]} rt={rt} />
        ))}
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, unit, sub, color }: { icon: React.ReactNode; label: string; value: string; unit: string; sub: string; color?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-[13px] text-white/45">
        {icon}
        {label}
      </div>
      <div className="mt-2.5 text-[26px] font-black tabular-nums leading-none" style={{ color: color ?? "#fff" }}>
        {value}
        <span className="ml-1 text-[13px] font-bold text-white/40">{unit}</span>
      </div>
      <div className="mt-2 text-[12.5px] tabular-nums text-white/45">{sub}</div>
    </Card>
  );
}

function ResourceChart({ analysis, rt }: { analysis: ResourceAnalysis; rt: ResourceType }) {
  const meta = RT_META[rt];
  const color = RT_COLORS[rt];
  // 跨周期数据:X 轴按月拼接;周期边界画参考线
  const data: { month: string; tick: string; amount: number; usage: number; cycle: string }[] = [];
  for (const p of analysis.periods) {
    p.months.forEach((m) => {
      const long = monthLabel(m.month);
      // X 轴全部用月份数字(数据区间在卡头副标题、周期重置点有参考线标注),避免拥挤
      data.push({
        month: long,
        tick: long.split(".")[1],
        amount: m.amount,
        usage: Math.round(m.usage * 10) / 10,
        cycle: p.cycleKey,
      });
    });
  }
  const boundaries = analysis.periods.slice(1).map((p) => monthLabel(p.months[0]?.month ?? p.firstMonth));

  return (
    <Card className="p-4">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <meta.icon className="h-4 w-4" style={{ color }} />
          <span className="text-[14.5px] font-bold text-white">{meta.name}费 · 金额与反推用量</span>
        </div>
        <BarChart3 className="h-4 w-4 text-white/20" />
      </div>
      <div className="text-[12px] text-white/35">
        {data[0]?.month}~{data[data.length - 1]?.month} · 柱 = 账单金额(元) · 线 = 反推用量({meta.unit})
      </div>
      <div className="mt-2 h-[210px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id={`bar-${rt}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.9} />
                <stop offset="100%" stopColor={color} stopOpacity={0.3} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="tick"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 12.5 }}
              // 全部为月份数字短标签;≤14 个月强制全显(总宽远小于绘图区),更长数据自动抽稀
              interval={data.length <= 14 ? 0 : "preserveStartEnd"}
              minTickGap={2}
            />
            <YAxis yAxisId="amt" tickLine={false} axisLine={false} tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 12 }} width={44} />
            <YAxis yAxisId="use" orientation="right" tickLine={false} axisLine={false} tick={{ fill: `${color}99`, fontSize: 12 }} width={40} />
            <Tooltip
              contentStyle={{
                background: "rgba(10,10,15,0.92)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 10,
                fontSize: 13,
              }}
              labelStyle={{ color: "rgba(255,255,255,0.6)" }}
              labelFormatter={(_, payload) => String(payload?.[0]?.payload?.month ?? "")}
              formatter={(value: number, name: string) => [value, name === "amount" ? "金额(元)" : `用量(${meta.unit})`]}
            />
            {boundaries.map((b) => (
              <ReferenceLine key={b} x={b} yAxisId="amt" stroke="rgba(255,255,255,0.25)" strokeDasharray="4 3" label={{ value: "周期重置", fill: "rgba(255,255,255,0.4)", fontSize: 11, position: "top" }} />
            ))}
            <Bar yAxisId="amt" dataKey="amount" fill={`url(#bar-${rt})`} radius={[4, 4, 0, 0]} maxBarSize={26} />
            <Line yAxisId="use" type="monotone" dataKey="usage" stroke={color} strokeWidth={2} dot={false} strokeOpacity={0.9} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
