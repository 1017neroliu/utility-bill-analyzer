import { useMemo, useState } from "react";
import { Zap, MapPin, Settings2, ArrowDown, Sparkles } from "lucide-react";
import type { BillMonth, EngineOptions, ParseResult } from "./core/types";
import { analyzeBills } from "./core/engine";
import { ruleSets } from "./core/rules/shanghai";
import InputPanel from "./components/InputPanel";
import RulesPanel from "./components/RulesPanel";
import Dashboard from "./components/Dashboard";
import TierLanes from "./components/TierLanes";
import SavingsPanel from "./components/SavingsPanel";
import InsightsPanel from "./components/InsightsPanel";
import AiSettingsDialog from "./components/AiSettingsDialog";
import { loadAiConfig, saveAiConfig, type AiConfig } from "./lib/ai";
import { Card } from "./components/ui";

export default function App() {
  const [ruleSetId, setRuleSetId] = useState("shanghai");
  const [options, setOptions] = useState<EngineOptions>({ multiPerson: true, peakRatio: 0.55 });
  const [bills, setBills] = useState<BillMonth[]>([]);
  const [parseInfo, setParseInfo] = useState<ParseResult | null>(null);
  const [aiCfg, setAiCfg] = useState<AiConfig>(() => loadAiConfig());
  const [aiDialog, setAiDialog] = useState(false);

  const ruleSet = ruleSets.find((r) => r.id === ruleSetId) ?? ruleSets[0];
  const result = useMemo(
    () => (bills.some((b) => b.electricity || b.gas || b.water) ? analyzeBills(bills, ruleSet, options) : null),
    [bills, ruleSet, options],
  );
  const hasResult = result !== null && bills.length > 0;

  const updateAi = (cfg: AiConfig) => {
    setAiCfg(cfg);
    saveAiConfig(cfg);
  };

  return (
    <div
      className="min-h-screen"
      style={{
        background:
          "radial-gradient(1000px 520px at 88% -6%, rgba(251,146,60,0.10), transparent 60%), radial-gradient(900px 500px at -5% 30%, rgba(34,211,238,0.07), transparent 60%), radial-gradient(900px 600px at 60% 110%, rgba(168,85,247,0.06), transparent 60%), #0a0a0f",
      }}
    >
      <div className="mx-auto max-w-[1440px] px-5 py-7 lg:px-8">
        {/* Header */}
        <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.3em] text-white/40">
              <Zap className="h-3.5 w-3.5 text-amber-300" /> Utility Bill Lens
            </div>
            <h1 className="mt-2 text-[32px] font-black leading-tight tracking-tight text-white lg:text-[38px]">
              家庭水电气{" "}
              <span
                style={{
                  background: "linear-gradient(180deg,#fef3c7 0%,#fbbf24 45%,#fb7185 100%)",
                  WebkitBackgroundClip: "text",
                  color: "transparent",
                }}
              >
                阶梯分析
              </span>
            </h1>
            <p className="mt-1.5 text-[13.5px] text-white/45">
              金额输入 → 用量反推 → 跳档定位 → 省钱测算 → AI 深度报告(可选)
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
              <MapPin className="h-4 w-4 text-white/40" />
              <select
                value={ruleSetId}
                onChange={(e) => setRuleSetId(e.target.value)}
                className="bg-transparent text-[13.5px] font-semibold text-white/80 outline-none"
              >
                {ruleSets.map((r) => (
                  <option key={r.id} value={r.id} className="bg-[#12121a]">
                    {r.name}
                  </option>
                ))}
                <option disabled className="bg-[#12121a] text-white/30">
                  更多城市接入中(可用高级设置自定义价格)
                </option>
              </select>
            </div>
            <button
              onClick={() => setAiDialog(true)}
              className="flex items-center gap-1.5 rounded-xl border border-violet-400/25 bg-violet-400/[0.08] px-3.5 py-2 text-[13.5px] font-semibold text-violet-300 transition-colors hover:bg-violet-400/15"
            >
              <Sparkles className="h-4 w-4" /> AI {aiCfg.enabled ? "已开启" : "未开启"}
            </button>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
          {/* 主列 */}
          <div className="min-w-0 space-y-5">
            <InputPanel
              bills={bills}
              onBills={setBills}
              parseInfo={parseInfo}
              onParseInfo={setParseInfo}
              aiCfg={aiCfg}
            />

            {hasResult && result && (
              <>
                <ArrowDown className="mx-auto h-5 w-5 animate-bounce text-white/20" />
                <Dashboard result={result} />
                <TierLanes result={result} ruleSet={ruleSet} />
                <SavingsPanel result={result} ruleSet={ruleSet} />
                <InsightsPanel bills={bills} result={result} ruleSet={ruleSet} aiCfg={aiCfg} onOpenAiSettings={() => setAiDialog(true)} />
              </>
            )}

            {!hasResult && (
              <Card className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <div className="text-5xl">⚡🔥💧</div>
                <div className="mt-4 text-[16px] font-bold text-white/70">录入账单后,这里将自动生成全部分析</div>
                <div className="mt-2 max-w-[520px] text-[13.5px] leading-relaxed text-white/40">
                  支持 12 / 24 / 36 个月及以上数据。引擎按官方结算周期(电/水自然年、燃气每年9月起)自动分组,
                  从缴费金额反推用量、定位每一次跳档、测算一户多人口的价值。
                  可先点「载入示例数据」查看效果。
                </div>
              </Card>
            )}
          </div>

          {/* 侧栏 */}
          <div className="space-y-5 lg:sticky lg:top-6 lg:self-start">
            <RulesPanel ruleSet={ruleSet} options={options} onChange={setOptions} />
            {result && result.warnings.length > 0 && (
              <Card className="p-4">
                <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-amber-300/90">
                  <Settings2 className="h-3.5 w-3.5" /> 数据质量提示
                </div>
                <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-white/50">
                  {result.warnings.map((w, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="text-amber-400/50">·</span>
                      {w}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>

        <footer className="mt-10 border-t border-white/[0.06] pt-4 text-[12.5px] text-white/25">
          阶梯价格以当地账单为准(可在高级设置中修改)· 所有计算在浏览器本地完成,数据不出本机 ·
          AI 模式下仅发送账单金额与引擎统计结果至你自己配置的接口
        </footer>
      </div>

      {aiDialog && <AiSettingsDialog cfg={aiCfg} onSave={updateAi} onClose={() => setAiDialog(false)} />}
    </div>
  );
}
