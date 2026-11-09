import { useMemo, useRef, useState } from "react";
import { Sparkles, Play, Square, Cog, MessageSquareText, Bot, FileDown, FileText, Code2 } from "lucide-react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { BillMonth, EngineResult, RuleSet } from "../core/types";
import { buildInsights } from "../core/insights";
import { buildReportHtml, buildReportMarkdown, downloadFile, monthSpanLabel } from "../lib/report";
import { Card, SectionTitle } from "./ui";
import { SYSTEM_PROMPT, buildAnalysisPrompt, streamAiChat, type AiConfig } from "../lib/ai";

function mdToHtml(md: string): string {
  return DOMPurify.sanitize(marked.parse(md, { async: false }) as string);
}

/** 引擎结果 → AI 输入(精简) */
function buildAiPayload(result: EngineResult, ruleSet: RuleSet): unknown {
  const resource = (rt: "electricity" | "gas" | "water") => ({
    periods: result[rt].periods.map((p) => ({
      cycle: p.cycleKey,
      span: `${p.firstMonth}~${p.lastMonth}`,
      cycleStartCovered: p.cycleStartCovered,
      totalUsage: +p.totalUsage.toFixed(1),
      totalAmount: +p.totalAmount.toFixed(2),
      tierUsage: p.tierUsage.map((x) => +x.toFixed(1)),
      surcharge: +p.surcharge.toFixed(2),
      events: p.events.map((e) => ({ month: e.month, enterTier: e.to })),
      months: p.months.map((m) => ({
        month: m.month,
        amount: m.amount,
        usage: +m.usage.toFixed(1),
        tier: m.tierEnd,
        crossed: m.crossed,
      })),
    })),
  });
  return {
    ruleSet: { id: ruleSet.id, name: ruleSet.name, notes: ruleSet.notes },
    options: { multiPerson: result.options.multiPerson, peakRatio: result.options.peakRatio },
    totalAmount: +result.totalAmount.toFixed(2),
    savings: result.savings.map((s) => ({
      resource: s.resourceType,
      actual: +s.actualCost.toFixed(2),
      alternative: +s.alternativeCost.toFixed(2),
      saving: +s.saving.toFixed(2),
      alternativeCrossMonths: s.alternativeCrossMonths,
    })),
    electricity: resource("electricity"),
    gas: resource("gas"),
    water: resource("water"),
    warnings: result.warnings,
  };
}

export default function InsightsPanel({
  bills,
  result,
  ruleSet,
  aiCfg,
  onOpenAiSettings,
}: {
  bills: BillMonth[];
  result: EngineResult;
  ruleSet: RuleSet;
  aiCfg: AiConfig;
  onOpenAiSettings: () => void;
}) {
  const builtinHtml = useMemo(() => mdToHtml(buildInsights(result, ruleSet)), [result, ruleSet]);

  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runAi = async () => {
    if (!aiCfg.apiKey || !aiCfg.baseUrl) {
      setAiError("请先填写 AI 参数(baseUrl / apiKey / model)");
      onOpenAiSettings();
      return;
    }
    setAiBusy(true);
    setAiError(null);
    setAiText("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamAiChat(
        aiCfg,
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildAnalysisPrompt(buildAiPayload(result, ruleSet)) },
        ],
        (delta) => setAiText((t) => t + delta),
        controller.signal,
      );
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setAiError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setAiBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <Card className="p-5">
      <SectionTitle
        icon={<MessageSquareText className="h-4 w-4 text-white/60" />}
        title="总结与建议"
        desc="内置规则式结论即时生成;开启 AI 后可生成更深入的个性化分析报告"
        right={
          <div className="flex items-center gap-2">
            {/* 导出报告下拉 */}
            <details className="relative">
              <summary
                className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-400/[0.08] px-3 py-1.5 text-[13px] font-bold text-emerald-300 transition-colors hover:bg-emerald-400/15 [&::-webkit-details-marker]:hidden"
                title="导出完整分析报告"
              >
                <FileDown className="h-3.5 w-3.5" /> 导出报告
              </summary>
              <div className="absolute right-0 top-full z-20 mt-1 w-[250px] overflow-hidden rounded-xl border border-white/10 bg-[#15151f] shadow-2xl">
                <button
                  onClick={() =>
                    downloadFile(
                      `水电气阶梯分析报告_${monthSpanLabel(bills)}.html`,
                      buildReportHtml({ bills, result, ruleSet, aiReport: aiText || undefined }),
                      "text/html",
                    )
                  }
                  className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  <span>
                    <span className="block text-[13.5px] font-bold text-white/90">HTML 完整报告</span>
                    <span className="block text-[11.5px] leading-snug text-white/40">含图表、跳档地图、明细表,双击即可查看,可打印为 PDF</span>
                  </span>
                </button>
                <button
                  onClick={() =>
                    downloadFile(
                      `水电气阶梯分析报告_${monthSpanLabel(bills)}.md`,
                      buildReportMarkdown({ bills, result, ruleSet, aiReport: aiText || undefined }),
                      "text/markdown",
                    )
                  }
                  className="flex w-full items-start gap-2.5 border-t border-white/[0.06] px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <Code2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
                  <span>
                    <span className="block text-[13.5px] font-bold text-white/90">Markdown 简报</span>
                    <span className="block text-[11.5px] leading-snug text-white/40">含全部明细表,便于二次编辑与存档</span>
                  </span>
                </button>
              </div>
            </details>
            <button
              onClick={onOpenAiSettings}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[13px] text-white/60 transition-colors hover:border-white/25 hover:text-white/90"
            >
              <Cog className="h-3.5 w-3.5" /> AI 设置{aiCfg.enabled ? "" : "(关)"}
            </button>
            {aiCfg.enabled && (
              aiBusy ? (
                <button
                  onClick={() => abortRef.current?.abort()}
                  className="flex items-center gap-1.5 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-1.5 text-[13px] font-bold text-rose-300"
                >
                  <Square className="h-3.5 w-3.5" /> 停止
                </button>
              ) : (
                <button
                  onClick={() => void runAi()}
                  className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-violet-500 px-3.5 py-1.5 text-[13px] font-bold text-black transition-opacity hover:opacity-85"
                >
                  <Sparkles className="h-3.5 w-3.5" /> AI 深度分析
                </button>
              )
            )}
          </div>
        }
      />

      {/* 内置结论 */}
      <div className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
        <div className="mb-1 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider text-white/35">
          <Bot className="h-3.5 w-3.5" /> 规则引擎结论(即时计算)
        </div>
        <div className="md-body" dangerouslySetInnerHTML={{ __html: builtinHtml }} />
      </div>

      {/* AI 报告 */}
      {aiCfg.enabled && (aiBusy || aiText || aiError) && (
        <div className="mt-4 rounded-xl border border-violet-400/20 bg-violet-400/[0.04] p-4">
          <div className="mb-1 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider text-violet-300/70">
            <Sparkles className="h-3.5 w-3.5" /> AI 分析报告
            <span className="ml-1 font-normal normal-case tracking-normal text-white/30">
              {aiCfg.model} · {aiCfg.baseUrl.replace(/^https?:\/\//, "").slice(0, 30)}
            </span>
          </div>
          {aiError && (
            <div className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[13px] text-rose-300">{aiError}</div>
          )}
          {aiBusy && !aiText && <div className="flex items-center gap-2 text-[13.5px] text-white/50">AI 正在思考…</div>}
          {aiText && (
            <div
              className={`md-body ${aiBusy ? "ai-cursor" : ""}`}
              dangerouslySetInnerHTML={{ __html: mdToHtml(aiText) }}
            />
          )}
        </div>
      )}

      {!aiCfg.enabled && (
        <div className="mt-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-[12.5px] text-white/40">
          💡 在「AI 设置」中开启并填写 OpenAI 兼容接口参数(baseUrl / apiKey / model)后,可生成更深度的个性化报告;密钥仅保存在本浏览器,经本地服务代理转发,不上传第三方。
        </div>
      )}
    </Card>
  );
}
