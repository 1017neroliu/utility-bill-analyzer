import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Upload, ClipboardPaste, Table2, Sparkles, FileSpreadsheet, Trash2, Plus, AlertTriangle } from "lucide-react";
import type { BillMonth, ParseResult } from "../core/types";
import { parsePastedText, parseWorkbookData, workbookToAoa, parseAoa, buildAiMapPrompt, applyAiMap, type AiColumnMap } from "../core/parse";
import { Card, SectionTitle, RT_COLORS } from "./ui";
import type { AiConfig } from "../lib/ai";

const SAMPLE: BillMonth[] = [
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

type Tab = "manual" | "upload" | "paste";

export default function InputPanel({
  bills,
  onBills,
  parseInfo,
  onParseInfo,
  aiCfg,
}: {
  bills: BillMonth[];
  onBills: (b: BillMonth[]) => void;
  parseInfo: ParseResult | null;
  onParseInfo: Dispatch<SetStateAction<ParseResult | null>>;
  aiCfg: AiConfig;
}) {
  const [tab, setTab] = useState<Tab>("manual");
  const [pasteText, setPasteText] = useState("");
  const [aiMapBusy, setAiMapBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const applyResult = (r: ParseResult) => {
    onParseInfo(r);
    if (r.bills.length > 0) onBills(r.bills);
  };

  async function aiMapFallback(aoa: unknown[][], raw: { headers: string[]; rows: string[][] }) {
    if (!aiCfg.enabled || !aiCfg.apiKey || !aiCfg.baseUrl) {
      onParseInfo((p) => p && { ...p, warnings: [...p.warnings, "开启 AI 分析并填写参数后,可自动识别非标准表格列"] });
      return;
    }
    setAiMapBusy(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: aiCfg.baseUrl,
          apiKey: aiCfg.apiKey,
          model: aiCfg.model,
          messages: [
            { role: "system", content: "你是数据表格结构识别助手。只输出严格 JSON,不要任何多余文字。" },
            { role: "user", content: buildAiMapPrompt(raw) },
          ],
          temperature: 0,
        }),
      });
      const data = await res.json();
      const text: string = data?.choices?.[0]?.message?.content ?? "";
      const jsonText = text.replace(/```json|```/g, "").trim();
      const map = JSON.parse(jsonText.slice(jsonText.indexOf("{"), jsonText.lastIndexOf("}") + 1)) as AiColumnMap;
      applyResult(applyAiMap(aoa, map));
    } catch (e) {
      onParseInfo((p) =>
        p
          ? { ...p, warnings: [...p.warnings, `AI 识别列失败:${e instanceof Error ? e.message : "请检查 AI 配置"}`] }
          : p,
      );
    } finally {
      setAiMapBusy(false);
    }
  }

  async function handleFile(file: File) {
    const buf = await file.arrayBuffer();
    const parsed = parseWorkbookData(buf);
    if (parsed.needAiMap && aiCfg.enabled) {
      const wb = workbookToAoa(buf);
      if (wb) {
        const raw = {
          headers: (wb.aoa[0] ?? []).map((c) => String(c ?? "")),
          rows: wb.aoa.slice(1, 6).map((r) => (r ?? []).map((c) => String(c ?? ""))),
        };
        onParseInfo(parsed);
        await aiMapFallback(wb.aoa, raw);
        return;
      }
    }
    applyResult(parsed);
  }

  const updateRow = (i: number, key: keyof BillMonth, value: string) => {
    const next = [...bills];
    if (key === "month") next[i] = { ...next[i], month: value };
    else next[i] = { ...next[i], [key]: value === "" ? undefined : Number(value) };
    onBills(next);
  };

  const tabs: { id: Tab; label: string; icon: typeof Table2 }[] = [
    { id: "manual", label: "手动输入", icon: Table2 },
    { id: "upload", label: "上传 CSV / Excel", icon: Upload },
    { id: "paste", label: "粘贴文本", icon: ClipboardPaste },
  ];

  return (
    <Card className="p-5">
      <SectionTitle
        icon={<FileSpreadsheet className="h-4 w-4 text-cyan-300" />}
        title="① 录入账单"
        desc="录入每月缴费金额(金额即可,用量与跳档由规则引擎自动反推);水费为双月账单时只在缴费月填金额"
        right={
          <button
            onClick={() => {
              onBills(SAMPLE.map((b) => ({ ...b })));
              onParseInfo(null);
            }}
            className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[13px] font-semibold text-cyan-300 transition-colors hover:bg-cyan-400/20"
          >
            载入示例数据
          </button>
        }
      />

      <div className="mb-4 flex gap-1.5 rounded-xl border border-white/[0.07] bg-black/20 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13.5px] font-semibold transition-colors ${
              tab === t.id ? "bg-white/[0.09] text-white" : "text-white/45 hover:text-white/70"
            }`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "manual" && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13.5px]">
            <thead>
              <tr className="text-left text-[12.5px] uppercase tracking-wider text-white/40">
                <th className="pb-2 pr-2 font-semibold">月份</th>
                <th className="pb-2 px-2 font-semibold" style={{ color: RT_COLORS.electricity }}>电费(元)</th>
                <th className="pb-2 px-2 font-semibold" style={{ color: RT_COLORS.water }}>水费(元)</th>
                <th className="pb-2 px-2 font-semibold" style={{ color: RT_COLORS.gas }}>燃气费(元)</th>
                <th className="pb-2 pl-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {bills.map((b, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2">
                    <input
                      type="text"
                      value={b.month}
                      onChange={(e) => updateRow(i, "month", e.target.value)}
                      placeholder="2025-11"
                      className="w-[110px] rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[13.5px] tabular-nums text-white outline-none placeholder:text-white/25 focus:border-cyan-400/50"
                    />
                  </td>
                  {(["electricity", "water", "gas"] as const).map((k) => (
                    <td key={k} className="py-1 px-2">
                      <input
                        type="number"
                        step="0.01"
                        value={b[k] ?? ""}
                        onChange={(e) => updateRow(i, k, e.target.value)}
                        placeholder="无账单"
                        className="w-[110px] rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[13.5px] tabular-nums text-white outline-none placeholder:text-white/25 focus:border-cyan-400/50"
                      />
                    </td>
                  ))}
                  <td className="py-1 pl-2">
                    <button
                      onClick={() => onBills(bills.filter((_, j) => j !== i))}
                      className="rounded-md p-1.5 text-white/30 transition-colors hover:bg-rose-400/10 hover:text-rose-400"
                      title="删除该行"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            onClick={() => {
              const last = bills[bills.length - 1];
              const nextMonth = last ? nextMonthOf(last.month) : "2026-01";
              onBills([...bills, { month: nextMonth }]);
            }}
            className="mt-2 flex items-center gap-1.5 rounded-lg border border-dashed border-white/15 px-3 py-1.5 text-[13px] text-white/50 transition-colors hover:border-white/30 hover:text-white/80"
          >
            <Plus className="h-4 w-4" /> 添加一个月
          </button>
        </div>
      )}

      {tab === "upload" && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFile(f);
          }}
          onClick={() => fileRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
            dragOver ? "border-cyan-400/60 bg-cyan-400/[0.06]" : "border-white/15 hover:border-white/30"
          }`}
        >
          <FileSpreadsheet className="mb-3 h-10 w-10 text-white/25" />
          <div className="text-[15px] font-semibold text-white/75">点击选择或拖拽文件到这里</div>
          <div className="mt-1.5 text-[13px] leading-relaxed text-white/40">
            支持 .xlsx / .xls / .csv · 自动识别表头(月份、电费、水费、燃气费)
            <br />
            支持宽表(每月一行)与长表(每月多行),12 / 24 / 36 个月均可
          </div>
          {aiMapBusy && (
            <div className="mt-3 flex items-center gap-2 text-[13px] text-cyan-300">
              <Sparkles className="h-4 w-4 animate-pulse" /> AI 正在识别表格结构…
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {tab === "paste" && (
        <div>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={8}
            placeholder={"直接粘贴表格文本(从 Excel 复制即可,支持 Tab / 逗号分隔),例如:\n日期,电费金额,水费金额,燃气金额\n2025.11,106.7,162,117\n2025.12,154.2,0,234"}
            className="w-full rounded-xl border border-white/10 bg-black/30 p-3.5 text-[13.5px] tabular-nums leading-relaxed text-white outline-none placeholder:text-white/25 focus:border-cyan-400/50"
          />
          <button
            onClick={() => applyResult(parsePastedText(pasteText))}
            disabled={!pasteText.trim()}
            className="mt-2 rounded-lg bg-cyan-500/80 px-4 py-2 text-[13.5px] font-bold text-black transition-colors hover:bg-cyan-400 disabled:opacity-30"
          >
            解析文本
          </button>
        </div>
      )}

      {/* 解析反馈 */}
      {parseInfo && (
        <div className="mt-4 space-y-1.5">
          {parseInfo.mapping && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.07] px-3 py-2 text-[13px] text-emerald-300">
              <Sparkles className="h-3.5 w-3.5 shrink-0" /> {parseInfo.mapping}
            </div>
          )}
          {parseInfo.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.07] px-3 py-2 text-[13px] text-amber-300/90">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function nextMonthOf(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return "2026-01";
  const total = Number(m[1]) * 12 + Number(m[2]);
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}
