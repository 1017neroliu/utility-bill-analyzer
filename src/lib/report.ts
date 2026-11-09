// 分析报告导出:自包含 HTML(内嵌样式 + SVG 图表,可打印为 PDF)与 Markdown 简报
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { BillMonth, EngineResult, ResourceAnalysis, ResourceType, RuleSet } from "../core/types";
import { monthLabel, monthDiff, predictNextCross } from "../core/engine";
import { buildInsights } from "../core/insights";

const RT_META: Record<ResourceType, { name: string; unit: string; icon: string }> = {
  electricity: { name: "电", unit: "度", icon: "⚡" },
  gas: { name: "燃气", unit: "m³", icon: "🔥" },
  water: { name: "水", unit: "m³", icon: "💧" },
};
const RT_COLOR: Record<ResourceType, string> = {
  electricity: "#b45309",
  gas: "#e11d48",
  water: "#0891b2",
};
const TIER_COLORS = ["#059669", "#d97706", "#e11d48"];
const TIER_NAME = ["一档", "二档", "三档"];
const CYCLE_START: Record<ResourceType, number> = { electricity: 1, gas: 9, water: 1 };

export interface ReportInput {
  bills: BillMonth[];
  result: EngineResult;
  ruleSet: RuleSet;
  /** AI 分析报告(Markdown,可选) */
  aiReport?: string;
  generatedAt?: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmt(n: number, d = 0): string {
  return n.toLocaleString("zh-CN", { maximumFractionDigits: d, minimumFractionDigits: 0 });
}
function mdToHtml(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  // 浏览器环境消毒;Node(测试/服务端)无 DOM 时跳过
  return typeof window !== "undefined" && typeof DOMPurify.sanitize === "function" ? DOMPurify.sanitize(raw) : raw;
}

// ================= SVG 柱状图(金额趋势) =================

function barChartSvg(
  data: { label: string; full: string; value: number; usage: number; unit: string; crossed?: boolean; tier?: number }[],
  color: string,
  title: string,
  unit: string,
): string {
  const W = 760;
  const H = 210;
  const padL = 52;
  const padR = 10;
  const padT = 16;
  const padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(...data.map((d) => d.value), 1);
  const niceMax = max <= 1 ? 1 : Math.ceil(max / 10 ** Math.floor(Math.log10(max)) * 10 ** Math.floor(Math.log10(max)) * 1.05);
  const band = innerW / data.length;
  const barW = Math.min(30, band * 0.6);
  const y = (v: number) => padT + innerH * (1 - v / niceMax);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: niceMax * f, yv: y(niceMax * f) }));
  const labelStep = data.length > 16 ? Math.ceil(data.length / 13) : 1;
  const peakIdx = data.reduce((m, d, i) => (d.value > data[m].value ? i : m), 0);

  const bars = data
    .map((d, i) => {
      const x = padL + i * band + (band - barW) / 2;
      const yv = y(d.value);
      const h = padT + innerH - yv;
      const stroke = d.crossed ? TIER_COLORS[(d.tier ?? 2) - 1] : "none";
      const sw = d.crossed ? 1.6 : 0;
      const showLabel = i % labelStep === 0;
      const label = showLabel
        ? `<text x="${x + barW / 2}" y="${H - 8}" text-anchor="middle" font-size="9.5" fill="rgba(0,0,0,0.45)">${esc(d.label)}</text>`
        : "";
      const peak =
        i === peakIdx
          ? `<text x="${x + barW / 2}" y="${yv - 4}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${color}">${fmt(d.value, 0)}</text>`
          : "";
      const cross = d.crossed ? `<text x="${x + barW / 2}" y="${yv - 14}" text-anchor="middle" font-size="9" font-weight="700" fill="${TIER_COLORS[(d.tier ?? 2) - 1]}">▲</text>` : "";
      const tip = `<title>${esc(d.full)}:${d.value.toFixed(2)} 元 ≈ ${d.usage.toFixed(1)} ${esc(unit)}${d.crossed ? "(跨档)" : ""}</title>`;
      return `<g>${tip}<rect x="${x.toFixed(1)}" y="${yv.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="3" fill="${color}" fill-opacity="0.78" stroke="${stroke}" stroke-width="${sw}"/></g>${label}${peak}${cross}`;
    })
    .join("");

  const grid = ticks
    .map(
      (t) =>
        `<line x1="${padL}" y1="${t.yv.toFixed(1)}" x2="${W - padR}" y2="${t.yv.toFixed(1)}" stroke="rgba(0,0,0,0.08)" stroke-width="1"/>` +
        `<text x="${padL - 6}" y="${(t.yv + 3).toFixed(1)}" text-anchor="end" font-size="9.5" fill="rgba(0,0,0,0.4)">${fmt(t.v, 0)}</text>`,
    )
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">
    <text x="${padL}" y="11" font-size="11" font-weight="700" fill="${color}">${esc(title)}</text>
    ${grid}${bars}
    <text x="${W - padR}" y="${H - 8}" text-anchor="end" font-size="9" fill="rgba(0,0,0,0.35)">单位:${esc(unit)} · ▲=跨档月</text>
  </svg>`;
}

// ================= 泳道跳档地图 =================

function laneHtml(period: ResourceAnalysis["periods"][number], rt: ResourceType): string {
  const startMonth = CYCLE_START[rt];
  const year = Number(period.cycleKey.replace(/\D/g, ""));
  const byMonth = new Map(period.months.map((m) => [m.month, m]));
  const cells: string[] = [];
  for (let i = 0; i < 12; i++) {
    const total = year * 12 + (startMonth - 1) + i;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const d = byMonth.get(key);
    if (d) {
      const c = TIER_COLORS[d.tierEnd - 1];
      const bg = d.crossed
        ? `background:linear-gradient(135deg,${TIER_COLORS[d.tierStart - 1]}33 0 45%,${TIER_COLORS[d.tierEnd - 1]}44 55% 100%);border:1.5px solid ${c};`
        : `background:${c}22;border:1px solid ${c}55;color:${c};`;
      cells.push(
        `<div class="rpt-cell" style="${bg}" title="${esc(`${monthLabel(key)}:${d.amount.toFixed(2)} 元 ≈ ${d.usage.toFixed(1)} ${RT_META[rt].unit}`)}">${d.crossed ? '<span style="position:absolute;top:-7px;font-size:9px;color:' + c + '">▲</span>' : ""}${monthLabel(key).split(".")[1]}</div>`,
      );
    } else {
      cells.push(`<div class="rpt-cell" style="background:transparent;border:1px dashed rgba(0,0,0,0.1);color:rgba(0,0,0,0.25)">·</div>`);
    }
  }
  const evText = period.events.length
    ? period.events.map((e) => `${monthLabel(e.month)}进${TIER_NAME[e.to - 1]}`).join("、")
    : "无跨档";
  return `<div class="rpt-lane">
    <div class="rpt-lane-head"><b>${esc(period.cycleKey)}</b><span>${monthLabel(period.firstMonth)}~${monthLabel(period.lastMonth)}</span></div>
    <div class="rpt-cells">${cells.join("")}</div>
    <div class="rpt-lane-sum">${fmt(period.totalUsage, 1)}${RT_META[rt].unit} · ${fmt(period.totalAmount, 0)}元<br/><span>${esc(evText)}</span></div>
  </div>`;
}

// ================= HTML 报告 =================

export function buildReportHtml(input: ReportInput): string {
  const { bills, result, ruleSet, aiReport } = input;
  const generatedAt = input.generatedAt ?? new Date().toLocaleString("zh-CN", { hour12: false });
  const first = bills[0]?.month ?? "";
  const last = bills[bills.length - 1]?.month ?? "";
  const monthsCount = Math.max(
    ...(["electricity", "gas", "water"] as const).map((rt) => result[rt].periods.reduce((s, p) => s + p.months.length, 0)),
  );
  const mp = result.options.multiPerson ? "一户多人口(5人)档" : "默认档";

  // ---- 总览卡 ----
  const kpiCards = [
    `<div class="rpt-kpi"><span>总支出</span><b>${fmt(result.totalAmount, 2)}<i>元</i></b><small>月均 ≈ ${fmt(result.totalAmount / monthsCount)} 元</small></div>`,
    ...(["electricity", "gas", "water"] as const).map((rt) => {
      const a = result[rt];
      return `<div class="rpt-kpi"><span style="color:${RT_COLOR[rt]}">${RT_META[rt].icon} ${RT_META[rt].name}费</span><b style="color:${RT_COLOR[rt]}">${fmt(a.totalAmount, 2)}<i>元</i></b><small>≈ ${fmt(a.totalUsage, 1)} ${RT_META[rt].unit} · 占比 ${((a.totalAmount / result.totalAmount) * 100).toFixed(1)}%</small></div>`;
    }),
  ].join("");

  // ---- 明细表 ----
  const detailTable = (rt: ResourceType): string => {
    const a = result[rt];
    const rows = a.periods
      .flatMap((p) =>
        p.months.map((m) => {
          const cross = m.crossed ? `<b style="color:${TIER_COLORS[m.tierEnd - 1]}">↑进${TIER_NAME[m.tierEnd - 1]}</b>` : TIER_NAME[m.tierEnd - 1];
          return `<tr><td class="tnum">${monthLabel(m.month)}</td><td class="tnum">${m.amount.toFixed(2)}</td><td class="tnum">${fmt(m.usage, 1)}</td><td class="tnum">${fmt(m.cumUsage, 1)}</td><td>${cross}</td><td class="dim">${esc(p.cycleKey)}</td></tr>`;
        }),
      )
      .join("");
    return `<table class="rpt-table"><thead><tr><th>月份</th><th>金额(元)</th><th>反推用量(${RT_META[rt].unit})</th><th>周期累计</th><th>档位</th><th>结算周期</th></tr></thead><tbody>${rows}</tbody></table>`;
  };

  // ---- 趋势图(金额 + 跨档标记) ----
  const chart = (rt: ResourceType): string => {
    const a = result[rt];
    const data: { label: string; full: string; value: number; usage: number; unit: string; crossed?: boolean; tier?: number }[] = [];
    for (const p of a.periods) {
      p.months.forEach((m, mi) => {
        const long = monthLabel(m.month);
        // 全局首月与每周期首月用完整标签,其余用月份数字
        data.push({
          label: data.length === 0 || mi === 0 ? long : long.split(".")[1],
          full: long,
          value: m.amount,
          usage: m.usage,
          unit: RT_META[rt].unit,
          crossed: m.crossed,
          tier: m.tierEnd,
        });
      });
    }
    return barChartSvg(data, RT_COLOR[rt], `${RT_META[rt].icon} ${RT_META[rt].name}费逐月金额`, "元");
  };

  // ---- 泳道 ----
  const lanes = (["gas", "electricity", "water"] as const)
    .map((rt) => {
      const rows = result[rt].periods.map((p) => laneHtml(p, rt)).join("");
      const head = result[rt].periods
        .slice(0, 1)
        .map(() => `<div class="rpt-lane"><div class="rpt-lane-head dim">周期</div><div class="rpt-cells">${Array.from({ length: 12 }, (_, i) => `<div class="rpt-cell dim" style="border:none;background:none">${String((CYCLE_START[rt] + i - 1) % 12 + 1)}月</div>`).join("")}</div><div class="rpt-lane-sum dim"></div></div>`)
        .join("");
      return `<div class="rpt-section-sm" style="color:${RT_COLOR[rt]}">${RT_META[rt].icon} ${RT_META[rt].name}(周期起点 ${CYCLE_START[rt]} 月${rt === "water" ? " · 双月账单" : ""})</div>${head}${rows}`;
    })
    .join('<div class="rpt-gap"></div>');

  // ---- 档位进度 ----
  const limitsOf = (rt: ResourceType): [number, number] => {
    const rule = rt === "electricity" ? ruleSet.electricity : rt === "gas" ? ruleSet.gas : ruleSet.water;
    const extra = result.options.multiPerson ? rule.multiPersonExtraAnnual : 0;
    return [rule.tierLimits[0] + extra, rule.tierLimits[1] + extra];
  };
  const progress = (["electricity", "gas", "water"] as const)
    .map((rt) => {
      const a = result[rt];
      const p = a.periods[a.periods.length - 1];
      if (!p) return "";
      const [l1, l2] = limitsOf(rt);
      const used = p.totalUsage;
      const scale = l2 * 1.25;
      const pct = (v: number) => (v / scale) * 100;
      const segs: string[] = [];
      const inT1 = Math.min(used, l1);
      const inT2 = Math.max(0, Math.min(used, l2) - l1);
      const inT3 = Math.max(0, used - l1 === 0 ? 0 : used - l2 > 0 ? used - l2 : Math.max(0, used - l1));
      const t2v = Math.max(0, Math.min(used, l2) - l1);
      const t3v = Math.max(0, used - l2);
      if (inT1 > 0) segs.push(`<div style="width:${pct(inT1).toFixed(2)}%;background:${TIER_COLORS[0]}b3"></div>`);
      if (t2v > 0) segs.push(`<div style="width:${pct(t2v).toFixed(2)}%;background:${TIER_COLORS[1]}b3"></div>`);
      if (t3v > 0) segs.push(`<div style="width:${pct(t3v).toFixed(2)}%;background:${TIER_COLORS[2]}b3"></div>`);
      void inT2; void inT3;
      return `<div class="rpt-progress-row">
        <div class="rpt-progress-head"><b style="color:${RT_COLOR[rt]}">${RT_META[rt].icon} ${RT_META[rt].name}</b><span class="dim">${esc(p.cycleKey)}</span></div>
        <div class="rpt-progress"><div class="rpt-progress-fill">${segs.join("")}</div><i style="left:${pct(l1).toFixed(2)}%"></i><i style="left:${pct(l2).toFixed(2)}%"></i></div>
        <div class="rpt-progress-scale"><span style="left:${pct(l1).toFixed(2)}%">${l1.toLocaleString()}</span><span style="left:${pct(l2).toFixed(2)}%">${l2.toLocaleString()}</span></div>
        <div class="rpt-progress-right tnum"><b style="color:${RT_COLOR[rt]}">${fmt(used, 1)}</b> / ${l2.toLocaleString()} ${RT_META[rt].unit}</div>
      </div>`;
    })
    .join("");

  // ---- 5人口价值 ----
  const savingsRows = result.savings
    .map((s) => {
      const cross = s.alternativeCrossMonths.length ? `<span class="dim">(跨档:${s.alternativeCrossMonths.map(monthLabel).join("、")})</span>` : "";
      return `<tr><td style="color:${RT_COLOR[s.resourceType]}"><b>${RT_META[s.resourceType].icon} ${RT_META[s.resourceType].name}</b></td><td class="tnum">${fmt(s.actualCost, 2)} 元</td><td class="tnum">${fmt(s.alternativeCost, 2)} 元 ${cross}</td><td class="tnum" style="color:#059669"><b>${s.saving >= 0 ? "省" : "多付"} ${fmt(Math.abs(s.saving), 2)} 元</b></td></tr>`;
    })
    .join("");
  const totalSaving = result.savings.reduce((s, x) => s + x.saving, 0);
  const savingsNote = result.options.multiPerson
    ? `当前按 5人口档计费,合计已节省 ≈ ${fmt(totalSaving, 2)} 元(基于已录入数据的全部结算周期)。⚠️ 一户多人口资格每 2 年需续办(随申办 →「阶梯水电气一户多人口一件事」),逾期未续办将恢复默认档计费。`
    : `若申请一户多人口(5人及以上),按当前用量合计可省 ≈ ${fmt(totalSaving, 2)} 元(约 ${fmt(totalSaving / 12, 0)} 元/月);户籍满 7 人还可选择执行居民阶梯平均价。随申办可线上办理。`;

  // ---- 预测汇总 ----
  const predictions = (["gas", "electricity", "water"] as const)
    .map((rt) => {
      const a = result[rt];
      const p = a.periods[a.periods.length - 1];
      if (!p) return "";
      const rule = rt === "electricity" ? ruleSet.electricity : rt === "gas" ? ruleSet.gas : ruleSet.water;
      const pred = predictNextCross(p, rule, result.options.multiPerson);
      return pred ? `<li>${RT_META[rt].icon} ${RT_META[rt].name}:按近期用量节奏,预计 <b>${monthLabel(pred.month)}</b> 进入${TIER_NAME[pred.toTier - 1]}</li>` : "";
    })
    .filter(Boolean)
    .join("");

  const warnings = result.warnings.length
    ? `<div class="rpt-note">${result.warnings.map((w) => `⚠️ ${esc(w)}`).join("<br/>")}</div>`
    : "";

  const insightsHtml = mdToHtml(buildInsights(result, ruleSet));
  const aiHtml = aiReport ? mdToHtml(aiReport) : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>水电气阶梯分析报告 · ${esc(first)} ~ ${esc(last)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #eef0f3; color: #1f2328; font-family: Inter, system-ui, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif; font-size: 14px; line-height: 1.65; }
  .rpt-page { max-width: 960px; margin: 0 auto; padding: 32px 24px 48px; }
  .rpt-header { background: linear-gradient(135deg, #0f172a, #1e293b); color: #fff; border-radius: 16px; padding: 26px 30px; }
  .rpt-header .kick { font-size: 12px; letter-spacing: .25em; opacity: .55; font-weight: 700; }
  .rpt-header h1 { margin: 8px 0 6px; font-size: 26px; }
  .rpt-header .meta { font-size: 13px; opacity: .75; }
  .rpt-header .chips { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
  .rpt-chip { border: 1px solid rgba(255,255,255,.25); border-radius: 999px; padding: 3px 12px; font-size: 12px; }
  .rpt-card { background: #fff; border: 1px solid #e5e8ec; border-radius: 14px; padding: 20px 22px; margin-top: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
  .rpt-card h2 { font-size: 17px; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 1px solid #eef0f3; }
  .rpt-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
  .rpt-kpi { border: 1px solid #e5e8ec; border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 2px; }
  .rpt-kpi span { font-size: 12.5px; color: #6b7280; }
  .rpt-kpi b { font-size: 22px; font-variant-numeric: tabular-nums; }
  .rpt-kpi i { font-style: normal; font-size: 12px; color: #9ca3af; margin-left: 3px; }
  .rpt-kpi small { font-size: 12px; color: #6b7280; font-variant-numeric: tabular-nums; }
  .rpt-table { width: 100%; border-collapse: collapse; font-size: 12.8px; }
  .rpt-table th, .rpt-table td { border: 1px solid #e8eaee; padding: 5px 9px; text-align: left; }
  .rpt-table th { background: #f5f6f8; font-size: 12px; color: #4b5563; white-space: nowrap; }
  .rpt-table tr:nth-child(even) td { background: #fafbfc; }
  .tnum { font-variant-numeric: tabular-nums; }
  .dim { color: #9ca3af; font-size: 12px; }
  .rpt-section-sm { font-size: 13.5px; font-weight: 700; margin: 4px 0 6px; }
  .rpt-gap { height: 14px; }
  .rpt-lane { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .rpt-lane-head { width: 128px; flex: none; font-size: 12.5px; line-height: 1.35; }
  .rpt-lane-head b { display: block; font-size: 13px; color: #1f2328; }
  .rpt-lane-head span { color: #9ca3af; font-size: 11px; font-variant-numeric: tabular-nums; }
  .rpt-cells { display: grid; grid-template-columns: repeat(12, 1fr); gap: 4px; flex: 1; }
  .rpt-cell { position: relative; height: 32px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 11.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .rpt-lane-sum { width: 168px; flex: none; font-size: 11.5px; color: #6b7280; text-align: right; font-variant-numeric: tabular-nums; line-height: 1.45; }
  .rpt-progress-row { display: grid; grid-template-columns: 1fr 150px; gap: 4px 14px; margin-bottom: 16px; }
  .rpt-progress-head { grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; }
  .rpt-progress { position: relative; height: 16px; border-radius: 999px; background: #f0f1f4; border: 1px solid #e5e8ec; overflow: hidden; }
  .rpt-progress-fill { display: flex; height: 100%; }
  .rpt-progress-fill div { height: 100%; }
  .rpt-progress i { position: absolute; top: 0; width: 2px; height: 100%; background: rgba(0,0,0,.4); }
  .rpt-progress-scale { position: relative; height: 14px; font-size: 10.5px; color: #9ca3af; }
  .rpt-progress-scale span { position: absolute; transform: translateX(-50%); font-variant-numeric: tabular-nums; }
  .rpt-progress-right { align-self: center; font-size: 12.5px; color: #4b5563; }
  .rpt-note { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 10px 14px; font-size: 12.5px; color: #92400e; }
  .rpt-md { font-size: 13.5px; color: #374151; }
  .rpt-md h1, .rpt-md h2, .rpt-md h3 { color: #111827; margin: 1em 0 .5em; }
  .rpt-md table { border-collapse: collapse; font-size: 12.8px; }
  .rpt-md th, .rpt-md td { border: 1px solid #e8eaee; padding: 5px 10px; }
  .rpt-md th { background: #f5f6f8; }
  .rpt-md blockquote { border-left: 3px solid #059669; background: #ecfdf5; margin: .8em 0; padding: .6em 1em; border-radius: 0 8px 8px 0; }
  .rpt-md ul, .rpt-md ol { padding-left: 1.4em; }
  .rpt-footer { margin-top: 20px; padding-top: 12px; border-top: 1px solid #e5e8ec; font-size: 11.5px; color: #9ca3af; display: flex; justify-content: space-between; }
  @media print {
    body { background: #fff; }
    .rpt-page { max-width: none; padding: 0; }
    .rpt-card, .rpt-header { box-shadow: none; break-inside: avoid; }
    @page { margin: 14mm; }
  }
</style>
</head>
<body>
<div class="rpt-page">
  <div class="rpt-header">
    <div class="kick">UTILITY BILL LENS · 家庭水电气阶梯分析</div>
    <h1>水电气阶梯分析报告</h1>
    <div class="meta">数据区间 ${esc(monthLabel(first))} – ${esc(monthLabel(last))} · 共 ${monthsCount} 个月账单 · 生成于 ${esc(generatedAt)}</div>
    <div class="chips">
      <span class="rpt-chip">规则集:${esc(ruleSet.name)}</span>
      <span class="rpt-chip">${esc(mp)}</span>
      <span class="rpt-chip">峰谷比 ${Math.round(result.options.peakRatio * 100)}:${100 - Math.round(result.options.peakRatio * 100)}</span>
      <span class="rpt-chip">电/水 = 自然年 · 气 = 9月至次年8月</span>
    </div>
  </div>

  <div class="rpt-card"><h2>一、总览</h2><div class="rpt-kpis">${kpiCards}</div></div>

  <div class="rpt-card"><h2>二、金额趋势与跳档标记</h2>
    ${chart("electricity")}<div class="rpt-gap"></div>${chart("gas")}<div class="rpt-gap"></div>${chart("water")}
  </div>

  <div class="rpt-card"><h2>三、阶梯跳档地图</h2>
    <div class="dim" style="margin-bottom:10px">格子颜色 = 当月所处档位(${TIER_COLORS.map((c, i) => `<b style="color:${c}">${TIER_NAME[i]}</b>`).join(" / ")});双色格 = 当月发生跨档(▲);悬停可查看金额与用量</div>
    ${lanes}
    ${predictions ? `<div class="rpt-note" style="margin-top:12px"><b>下期跳档预测:</b><ul style="margin:4px 0 0;padding-left:1.3em">${predictions}</ul></div>` : ""}
  </div>

  <div class="rpt-card"><h2>四、月度明细</h2>
    <div class="rpt-section-sm" style="color:${RT_COLOR.electricity}">⚡ 电</div>${detailTable("electricity")}
    <div class="rpt-section-sm" style="color:${RT_COLOR.gas}">🔥 燃气</div>${detailTable("gas")}
    <div class="rpt-section-sm" style="color:${RT_COLOR.water}">💧 水</div>${detailTable("water")}
  </div>

  <div class="rpt-card"><h2>五、档位用量进度(最新周期)</h2>${progress}</div>

  <div class="rpt-card"><h2>六、一户多人口(5人)价值测算</h2>
    <table class="rpt-table"><thead><tr><th>资源</th><th>当前(${result.options.multiPerson ? "5人口档" : "默认档"})</th><th>${result.options.multiPerson ? "若未申请" : "若申请"}(同样用量)</th><th>差额</th></tr></thead>
    <tbody>${savingsRows}<tr><td colspan="3" style="color:#059669;font-weight:700">合计</td><td class="tnum" style="color:#059669"><b>${fmt(Math.abs(totalSaving), 2)} 元</b></td></tr></tbody></table>
    <div class="rpt-note" style="margin-top:10px">${esc(savingsNote)}</div>
  </div>

  <div class="rpt-card"><h2>七、总结与建议</h2><div class="rpt-md">${insightsHtml}</div></div>

  ${aiHtml ? `<div class="rpt-card"><h2>八、AI 深度分析</h2><div class="rpt-md">${aiHtml}</div></div>` : ""}

  <div class="rpt-card"><h2>附录:口径与方法</h2>
    <ul style="margin:0;padding-left:1.4em;color:#4b5563;font-size:13px">
      ${ruleSet.notes.map((n) => `<li>${esc(n)}</li>`).join("")}
      <li>用量由账单金额按「周期累计阶梯 + 对应档位单价」分段反推;电量依赖峰谷比假设(${Math.round(result.options.peakRatio * 100)}:${100 - Math.round(result.options.peakRatio * 100)}),该假设仅影响电量估计,不影响金额与跳档月份</li>
      <li>金额为缴费金额;用量与跳档按结算周期(电/水自然年、燃气每年9月起)独立累计</li>
    </ul>
    ${warnings}
  </div>

  <div class="rpt-footer"><span>Utility Bill Lens · 生成于 ${esc(generatedAt)}</span><span>数据来源:用户录入账单 · 本地计算</span></div>
</div>
</body>
</html>`;
}

// ================= Markdown 简报 =================

export function buildReportMarkdown(input: ReportInput): string {
  const { bills, result, ruleSet, aiReport } = input;
  const first = bills[0]?.month ?? "";
  const last = bills[bills.length - 1]?.month ?? "";
  const detailTable = (rt: ResourceType): string => {
    const a = result[rt];
    const head = `| 月份 | 金额(元) | 用量(${RT_META[rt].unit}) | 周期累计 | 档位 | 周期 |`;
    const sep = "|---|---:|---:|---:|---|---|";
    const rows = a.periods
      .flatMap((p) =>
        p.months.map((m) => {
          const tier = m.crossed ? `**↑进${TIER_NAME[m.tierEnd - 1]}**` : TIER_NAME[m.tierEnd - 1];
          return `| ${monthLabel(m.month)} | ${m.amount.toFixed(2)} | ${fmt(m.usage, 1)} | ${fmt(m.cumUsage, 1)} | ${tier} | ${p.cycleKey} |`;
        }),
      )
      .join("\n");
    return [head, sep, rows].join("\n");
  };
  const detail = (["electricity", "gas", "water"] as const)
    .map((rt) => `### ${RT_META[rt].icon} ${RT_META[rt].name}\n\n${detailTable(rt)}`)
    .join("\n\n");

  const savingsRows = result.savings
    .map(
      (s) =>
        `| ${RT_META[s.resourceType].name} | ${fmt(s.actualCost, 2)} | ${fmt(s.alternativeCost, 2)} | ${s.saving >= 0 ? "省" : "多付"} ${fmt(Math.abs(s.saving), 2)} 元 |`,
    )
    .join("\n");

  const parts: string[] = [];
  parts.push(`# 水电气阶梯分析报告\n`);
  parts.push(
    `> 数据区间 **${monthLabel(first)} – ${monthLabel(last)}** · 规则集:${ruleSet.name} · ${result.options.multiPerson ? "一户多人口(5人)档" : "默认档"} · 峰谷比 ${Math.round(result.options.peakRatio * 100)}:${100 - Math.round(result.options.peakRatio * 100)}\n`,
  );
  parts.push(`## 总览\n\n| 资源 | 费用(元) | 折合用量 |\n|---|---:|---:|`);
  for (const rt of ["electricity", "gas", "water"] as const) {
    parts.push(`| ${RT_META[rt].name} | ${result[rt].totalAmount.toFixed(2)} | ≈ ${fmt(result[rt].totalUsage, 1)} ${RT_META[rt].unit} |`);
  }
  parts.push(`| **合计** | **${result.totalAmount.toFixed(2)}** | |`);
  parts.push(`\n## 月度明细\n\n${detail}`);
  parts.push(`\n## 一户多人口价值(全部周期合计 ${fmt(Math.abs(result.savings.reduce((s, x) => s + x.saving, 0)), 2)} 元)\n\n| 资源 | 当前 | ${result.options.multiPerson ? "若未申请" : "若申请"} | 差额 |\n|---|---:|---:|---:|`);
  parts.push(savingsRows);
  parts.push(`\n---\n\n${buildInsights(result, ruleSet)}`);
  if (aiReport) parts.push(`\n---\n\n# AI 深度分析\n\n${aiReport}`);
  parts.push(`\n---\n\n*生成于 ${new Date().toLocaleString("zh-CN", { hour12: false })} · Utility Bill Lens · 用量由金额按阶梯规则反推*`);
  return parts.join("\n");
}

/** 触发浏览器下载 */
export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function monthSpanLabel(bills: BillMonth[]): string {
  if (bills.length === 0) return "";
  const f = bills[0].month;
  const l = bills[bills.length - 1].month;
  return `${monthLabel(f)}-${monthLabel(l)}(${monthDiff(f, l) + 1}个月)`;
}
