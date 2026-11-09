import { useState } from "react";
import { Settings2, Users, ChevronDown, Zap, Flame, Droplets, Info } from "lucide-react";
import type { EngineOptions, RuleSet } from "../core/types";
import { effectiveLimits } from "../core/engine";
import { Card, SectionTitle, Toggle, NumberInput, RT_COLORS } from "./ui";

export default function RulesPanel({
  ruleSet,
  options,
  onChange,
}: {
  ruleSet: RuleSet;
  options: EngineOptions;
  onChange: (o: EngineOptions) => void;
}) {
  const [showPrices, setShowPrices] = useState(false);
  const eLimits = effectiveLimits(ruleSet.electricity, options.multiPerson);
  const gLimits = effectiveLimits(ruleSet.gas, options.multiPerson);
  const wLimits = effectiveLimits(ruleSet.water, options.multiPerson);

  const setOverride = (path: string, value: number | "") => {
    const overrides = { ...(options.priceOverrides ?? {}) };
    if (value === "") delete overrides[path];
    else overrides[path] = value;
    onChange({ ...options, priceOverrides: overrides });
  };

  const getVal = (path: string): number | "" => {
    const segs = path.split(".");
    let cur: unknown = ruleSet;
    for (const s of segs) {
      cur = (cur as Record<string, unknown>)[s];
      if (cur == null) return "";
    }
    return typeof cur === "number" ? cur : "";
  };

  return (
    <Card className="p-5">
      <SectionTitle icon={<Settings2 className="h-4 w-4 text-white/60" />} title="计费规则" desc={`规则集:上海(可编辑,适配价格调整与其他城市)`} />

      <div className="space-y-3">
        <Toggle
          checked={options.multiPerson}
          onChange={(v) => onChange({ ...options, multiPerson: v })}
          label="一户多人口(5人及以上)档"
          hint={`电 +1,200 度/年 · 气 +150 m³/年 · 水 +100 m³/年(每 2 年需续办)`}
        />

        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-3">
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-semibold text-white/85">峰电量占比</span>
            <span className="text-[13px] tabular-nums text-cyan-300">{Math.round(options.peakRatio * 100)}% : {100 - Math.round(options.peakRatio * 100)}%</span>
          </div>
          <input
            type="range"
            min={30}
            max={80}
            value={Math.round(options.peakRatio * 100)}
            onChange={(e) => onChange({ ...options, peakRatio: Number(e.target.value) / 100 })}
            className="mt-2.5 w-full accent-cyan-400"
          />
          <div className="mt-1 text-[12.5px] leading-snug text-white/40">
            电费只有总额时,按峰:谷比例反推电量;仅影响电量估计,不影响金额与跳档月份
          </div>
        </div>

        {/* 档位速览 */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-3">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-white/45">
            <Users className="h-3.5 w-3.5" /> 当前档位边界
          </div>
          <div className="space-y-1.5 text-[13px] tabular-nums">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5" style={{ color: RT_COLORS.electricity }}><Zap className="h-3.5 w-3.5" /> 电</span>
              <span className="text-white/65">{eLimits[0].toLocaleString()} / {eLimits[1].toLocaleString()} 度</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5" style={{ color: RT_COLORS.gas }}><Flame className="h-3.5 w-3.5" /> 气</span>
              <span className="text-white/65">{gLimits[0]} / {gLimits[1]} m³</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5" style={{ color: RT_COLORS.water }}><Droplets className="h-3.5 w-3.5" /> 水</span>
              <span className="text-white/65">{wLimits[0]} / {wLimits[1]} m³</span>
            </div>
          </div>
        </div>

        {/* 规则说明 */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-3">
          <div className="mb-1.5 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-white/45">
            <Info className="h-3.5 w-3.5" /> 上海规则要点
          </div>
          <ul className="space-y-1 text-[12.5px] leading-relaxed text-white/50">
            {ruleSet.notes.map((n, i) => (
              <li key={i} className="flex gap-1.5"><span className="text-white/25">·</span>{n}</li>
            ))}
          </ul>
        </div>

        {/* 价格编辑 */}
        <button
          onClick={() => setShowPrices(!showPrices)}
          className="flex w-full items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-[13.5px] font-semibold text-white/70 transition-colors hover:border-white/20"
        >
          <span className="flex items-center gap-2">高级:阶梯价格 / 档位编辑<span className="text-[11.5px] font-normal text-white/35">(适配其他城市)</span></span>
          <ChevronDown className={`h-4 w-4 transition-transform ${showPrices ? "rotate-180" : ""}`} />
        </button>
        {showPrices && (
          <div className="space-y-3 rounded-xl border border-white/[0.08] bg-black/20 p-3.5">
            <PriceEditor
              title="⚡ 电(峰价 / 谷价 / 未分时价 / 档位上限)"
              color={RT_COLORS.electricity}
              rows={[
                { label: "峰价", path: "electricity.peakPrice", arr: true },
                { label: "谷价", path: "electricity.valleyPrice", arr: true },
                { label: "未分时", path: "electricity.averagePrice", arr: true },
              ]}
              getVal={getVal}
              setVal={setOverride}
              limitsPath="electricity.tierLimits"
            />
            <PriceEditor
              title="🔥 燃气(单价 / 档位上限)"
              color={RT_COLORS.gas}
              rows={[{ label: "单价", path: "gas.price", arr: true }]}
              getVal={getVal}
              setVal={setOverride}
              limitsPath="gas.tierLimits"
            />
            <PriceEditor
              title="💧 水(单价 / 档位上限)"
              color={RT_COLORS.water}
              rows={[{ label: "单价", path: "water.price", arr: true }]}
              getVal={getVal}
              setVal={setOverride}
              limitsPath="water.tierLimits"
            />
            <button
              onClick={() => onChange({ ...options, priceOverrides: {} })}
              className="w-full rounded-lg border border-white/10 py-1.5 text-[12.5px] text-white/50 hover:text-white/80"
            >
              恢复默认价格
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}

function PriceEditor({
  title,
  color,
  rows,
  getVal,
  setVal,
  limitsPath,
}: {
  title: string;
  color: string;
  rows: { label: string; path: string; arr: boolean }[];
  getVal: (p: string) => number | "";
  setVal: (p: string, v: number | "") => void;
  limitsPath: string;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[12.5px] font-bold" style={{ color }}>{title}</div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.path} className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-[12.5px] text-white/50">{r.label}</span>
            {[0, 1, 2].map((i) => (
              <NumberInput
                key={i}
                step={0.001}
                value={getVal(`${r.path}.${i}`)}
                onChange={(v) => setVal(`${r.path}.${i}`, v)}
                className="w-[86px]"
              />
            ))}
          </div>
        ))}
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-[12.5px] text-white/50">档位</span>
          {[0, 1].map((i) => (
            <NumberInput
              key={i}
              step={1}
              value={getVal(`${limitsPath}.${i}`)}
              onChange={(v) => setVal(`${limitsPath}.${i}`, v)}
              className="w-[86px]"
            />
          ))}
          <span className="text-[11.5px] text-white/30">一/二档上限</span>
        </div>
      </div>
    </div>
  );
}
