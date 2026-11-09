import * as XLSX from "xlsx";
import type { BillMonth, ParseResult, ResourceType } from "./types";
import { parseMonth, monthKey } from "./engine";

// ================= 月份解析 =================

export function normalizeMonth(cell: unknown): string | null {
  if (cell == null || cell === "") return null;
  if (cell instanceof Date) {
    return monthKey(cell.getFullYear(), cell.getMonth() + 1);
  }
  if (typeof cell === "number") {
    // 202511 整数形式
    if (Number.isInteger(cell) && cell >= 190001 && cell <= 299912) {
      const y = Math.floor(cell / 100);
      const m = cell % 100;
      if (m >= 1 && m <= 12) return monthKey(y, m);
    }
    // 2025.11 小数形式(Excel 中手输的月份;注意 2025.10 的尾零已丢失,存在歧义)
    if (!Number.isInteger(cell) && cell >= 1900 && cell <= 3000) {
      const [ys, ms] = String(cell).split(".");
      const y = Number(ys);
      const m = Number(ms);
      if (m >= 1 && m <= 12) return monthKey(y, m);
    }
    // Excel 日期序列号(1900 体系)
    if (cell > 20000 && cell < 80000) {
      const d = XLSX.SSF.parse_date_code(cell);
      if (d) return monthKey(d.y, d.m);
    }
    return null;
  }
  const s = String(cell).trim();
  // 2025.11 / 2025-11 / 2025/11 / 2025年11月 / 2025年11 / 2025-11-01 / 2025/11/01
  const m1 = /^(\d{4})\s*[.\-/年]\s*(\d{1,2})月?/.exec(s);
  if (m1) {
    const y = Number(m1[1]);
    const mo = Number(m1[2]);
    if (mo >= 1 && mo <= 12) return monthKey(y, mo);
  }
  // 25.11 / 25-11(两位年份)
  const m2 = /^(\d{2})\s*[.\-/]\s*(\d{1,2})$/.exec(s);
  if (m2) {
    const y = 2000 + Number(m2[1]);
    const mo = Number(m2[2]);
    if (mo >= 1 && mo <= 12) return monthKey(y, mo);
  }
  const d = new Date(s);
  if (!isNaN(d.getTime()) && /\d{4}/.test(s)) {
    return monthKey(d.getFullYear(), d.getMonth() + 1);
  }
  const pm = parseMonth(s);
  return pm ? monthKey(pm.y, pm.m) : null;
}

// ================= 金额解析 =================

function parseAmount(cell: unknown): number | undefined {
  if (cell == null || cell === "") return undefined;
  if (typeof cell === "number") return isFinite(cell) ? cell : undefined;
  let s = String(cell).trim();
  if (!s || s === "-" || s === "—") return undefined;
  s = s.replace(/[¥￥元$,\s]/g, "");
  // 括号负数
  if (/^\(.*\)$/.test(s)) s = "-" + s.slice(1, -1);
  const n = Number(s);
  return isFinite(n) ? n : undefined;
}

// ================= 表头关键词 =================

const RE_MONTH = /(月份|日期|时间|账期|账单月|date|month)/i;
const RE_ELEC = /(电费|电.*(金额|量)|^电$|electric)/i;
const RE_WATER = /(水费|水.*(金额|量)|^水$|water)/i;
const RE_GAS = /(燃气|煤气|天然气|gas)/i;
const RE_TYPE = /(类型|资源|项目|类别|品类|科目)/i;
const RE_AMOUNT = /(金额|费用|价钱|价格|amount|cost)/i;

function matchResource(text: string): ResourceType | null {
  if (RE_ELEC.test(text)) return "electricity";
  if (RE_WATER.test(text)) return "water";
  if (RE_GAS.test(text)) return "gas";
  return null;
}

// ================= AOA → 账单 =================

interface ColumnMap {
  mode: "wide" | "long";
  headerRow: number; // 表头行索引;-1 = 无表头
  month: number;
  electricity?: number;
  water?: number;
  gas?: number;
  type?: number; // 长表
  amount?: number; // 长表
}

function detectHeaderAndMap(aoa: unknown[][]): { map: ColumnMap; confidence: number } | null {
  const scanRows = Math.min(aoa.length, 6);
  let best: { map: ColumnMap; confidence: number } | null = null;

  for (let r = 0; r < scanRows; r++) {
    const row = aoa[r];
    if (!row || row.length < 2) continue;
    const texts = row.map((c) => (c == null ? "" : String(c).trim()));

    // ---- 长表检测:类型列 + 金额列 + 月份列 ----
    const monthColW = texts.findIndex((t) => RE_MONTH.test(t));
    const typeCol = texts.findIndex((t) => RE_TYPE.test(t));
    const amountCol = texts.findIndex((t) => RE_AMOUNT.test(t));
    if (monthColW >= 0 && typeCol >= 0 && amountCol >= 0) {
      const conf = 0.9;
      if (!best || conf > best.confidence) {
        best = { map: { mode: "long", headerRow: r, month: monthColW, type: typeCol, amount: amountCol }, confidence: conf };
      }
      continue;
    }

    // ---- 宽表检测:月份列 + 至少 1 个资源列 ----
    const cols: ColumnMap = { mode: "wide", headerRow: r, month: -1 };
    let hits = 0;
    texts.forEach((t, ci) => {
      if (RE_MONTH.test(t) && cols.month < 0) cols.month = ci;
      const res = matchResource(t);
      if (res === "electricity" && cols.electricity === undefined) { cols.electricity = ci; hits++; }
      if (res === "water" && cols.water === undefined) { cols.water = ci; hits++; }
      if (res === "gas" && cols.gas === undefined) { cols.gas = ci; hits++; }
    });
    if (cols.month >= 0 && hits >= 1) {
      const conf = 0.7 + hits * 0.1;
      if (!best || conf > best.confidence) best = { map: cols, confidence: conf };
    }
  }

  // ---- 无表头回退:第一列多为月份,其余按 [电, 水, 气] 顺序猜 ----
  if (!best) {
    const dataRows = aoa.filter((r) => r && r.length >= 2);
    const monthLike = dataRows.filter((r) => normalizeMonth(r[0]) !== null).length;
    if (dataRows.length > 0 && monthLike / dataRows.length > 0.6) {
      const nCols = Math.max(...dataRows.map((r) => r.length));
      const map: ColumnMap = { mode: "wide", headerRow: -1, month: 0 };
      if (nCols >= 4) { map.electricity = 1; map.water = 2; map.gas = 3; }
      else if (nCols === 3) { map.electricity = 1; map.gas = 2; }
      else if (nCols === 2) { map.electricity = 1; }
      return { map, confidence: 0.4 };
    }
    return null;
  }
  return best;
}

function extractBills(aoa: unknown[][], map: ColumnMap): { bills: BillMonth[]; warnings: string[]; mapping: string } {
  const warnings: string[] = [];
  const byMonth = new Map<string, BillMonth>();
  const bodyRows = aoa.slice(map.headerRow + 1);

  const resourceOfText = (t: string): ResourceType | null => matchResource(t);

  for (const row of bodyRows) {
    if (!row || row.length === 0) continue;
    const month = normalizeMonth(row[map.month]);
    if (!month) continue;

    const ensure = (): BillMonth => {
      if (!byMonth.has(month)) byMonth.set(month, { month });
      return byMonth.get(month)!;
    };

    if (map.mode === "long") {
      const typeText = String(row[map.type!] ?? "").trim();
      const res = resourceOfText(typeText);
      const amount = parseAmount(row[map.amount!]);
      if (!res) {
        if (typeText && amount !== undefined) warnings.push(`无法识别资源类型「${typeText}」,该行已跳过`);
        continue;
      }
      if (amount === undefined) continue;
      const b = ensure();
      b[res] = (b[res] ?? 0) + amount;
    } else {
      const setVal = (col: number | undefined, key: "electricity" | "water" | "gas") => {
        if (col === undefined || col < 0) return;
        const v = parseAmount(row[col]);
        if (v !== undefined && v !== 0) {
          // 0 视为无账单(CSV 中常用 0 填充无账单月)
          const b = ensure();
          b[key] = (b[key] ?? 0) + v;
        }
      };
      setVal(map.electricity, "electricity");
      setVal(map.water, "water");
      setVal(map.gas, "gas");
    }
  }

  // 同月重复行合并已在上面累加,给个提示
  const bills = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));

  // 空账单月清理:三资源全无值的月丢弃
  const cleaned = bills.filter((b) => b.electricity || b.water || b.gas);
  if (cleaned.length !== bills.length) {
    warnings.push(`已忽略 ${bills.length - cleaned.length} 个无任何金额的月份`);
  }

  const mappingDesc =
    map.mode === "long"
      ? `长表模式:第 ${map.headerRow + 1} 行表头,月份=第${map.month + 1}列,类型=第${(map.type ?? 0) + 1}列,金额=第${(map.amount ?? 0) + 1}列`
      : `宽表模式${map.headerRow >= 0 ? `(第 ${map.headerRow + 1} 行表头)` : "(无表头,按列位置识别)"}:月份=第${map.month + 1}列、` +
        [map.electricity !== undefined ? `电=第${map.electricity + 1}列` : "",
         map.water !== undefined ? `水=第${map.water + 1}列` : "",
         map.gas !== undefined ? `气=第${map.gas + 1}列` : ""].filter(Boolean).join("、");

  return { bills: cleaned, warnings, mapping: mappingDesc };
}

// ================= 文本分隔符解析(CSV/TSV 保真,不经数字转换) =================

function parseDelimited(text: string): unknown[][] {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const counts: Record<string, number> = { ",": 0, "\t": 0, ";": 0 };
  for (const ch of firstLine) if (ch in counts) counts[ch]++;
  const sep = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  return rows;
}

// ================= 对外入口 =================

/** 文本编码嗅探:UTF-8 优先,失败则按 GBK(国内 Excel 导出常见) */
function decodeText(data: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    try {
      return new TextDecoder("gbk").decode(data);
    } catch {
      return null;
    }
  }
}

/** 从 CSV/Excel 二进制提取第一个非空工作表的 AOA(供解析与 AI 映射兜底复用) */
export function workbookToAoa(data: ArrayBuffer | Uint8Array): { sheetName: string; aoa: unknown[][] } | null {
  // 统一转 Uint8Array:兼容 Node Buffer(pool 切片,裸 ArrayBuffer 会带偏移)与浏览器 ArrayBuffer
  const bytes = new Uint8Array(data as Uint8Array);
  const isBinary =
    (bytes[0] === 0x50 && bytes[1] === 0x4b) || // zip (xlsx)
    (bytes[0] === 0xd0 && bytes[1] === 0xcf); // OLE (xls)
  if (isBinary) {
    const wb = XLSX.read(bytes, { type: "array", cellDates: true });
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      if (!sheet) continue;
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false });
      const nonEmpty = aoa.filter((r) => r && r.some((c) => c !== "" && c != null));
      if (nonEmpty.length === 0) continue;
      return { sheetName: name, aoa: nonEmpty };
    }
    return null;
  }
  // CSV / TSV:自带解析器,保持字符串原样(避免 2025.10 被转成数字 2025.1 丢失尾零)
  const text = decodeText(bytes);
  if (text == null) throw new Error("无法识别文件编码(尝试过 UTF-8 / GBK)");
  const aoa = parseDelimited(text).filter((r) => r.some((c) => String(c).trim() !== ""));
  if (aoa.length === 0) return null;
  return { sheetName: "CSV", aoa };
}

/** 从 CSV/Excel 二进制内容解析账单 */
export function parseWorkbookData(data: ArrayBuffer | Uint8Array): ParseResult {
  let wb: { sheetName: string; aoa: unknown[][] } | null = null;
  try {
    wb = workbookToAoa(data);
  } catch (e) {
    return { bills: [], warnings: [`文件解析失败:${e instanceof Error ? e.message : String(e)}`], mapping: "", needAiMap: false };
  }
  if (!wb) return { bills: [], warnings: ["未找到有效数据行"], mapping: "", needAiMap: false };
  return parseAoa(wb.aoa, [], `工作表「${wb.sheetName}」`);
}

export function parseAoa(aoa: unknown[][], warnings: string[], sourceDesc: string): ParseResult {
  const detected = detectHeaderAndMap(aoa);
  if (!detected) {
    return {
      bills: [],
      warnings: [...warnings, `${sourceDesc}:未能识别月份列或金额列`],
      mapping: "",
      needAiMap: true,
      rawPreview: {
        headers: (aoa[0] ?? []).map((c) => String(c ?? "")),
        rows: aoa.slice(1, 6).map((r) => (r ?? []).map((c) => String(c ?? ""))),
      },
    };
  }
  const { bills, warnings: w2, mapping } = extractBills(aoa, detected.map);
  const allWarnings = [...warnings, ...w2];
  if (bills.length === 0) {
    return {
      bills,
      warnings: [...allWarnings, `${sourceDesc}:表头已识别但未提取到有效数据行`],
      mapping,
      needAiMap: true,
      rawPreview: {
        headers: (aoa[detected.map.headerRow >= 0 ? detected.map.headerRow : 0] ?? []).map((c) => String(c ?? "")),
        rows: aoa.slice(1, 6).map((r) => (r ?? []).map((c) => String(c ?? ""))),
      },
    };
  }
  return { bills, warnings: allWarnings, mapping: `${sourceDesc} · ${mapping} · 共 ${bills.length} 个月`, needAiMap: false };
}

/** 从粘贴的文本(CSV/TSV)解析 */
export function parsePastedText(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { bills: [], warnings: ["内容为空"], mapping: "", needAiMap: false };
  // 分隔符:tab 优先,其次逗号/分号
  const sep = lines[0].includes("\t") ? "\t" : lines[0].includes(",") ? "," : lines[0].includes(";") ? ";" : /\s{2,}/.test(lines[0]) ? /\s{2,}/ : ",";
  const aoa = lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, "")));
  return parseAoa(aoa, [], "粘贴文本");
}

// ================= AI 兜底映射 =================

export function buildAiMapPrompt(raw: { headers: string[]; rows: string[][] }): string {
  return [
    "下面是一个表格的前几行(可能是水电燃气账单)。请判断列含义,返回严格的 JSON(不要 markdown 代码块):",
    '{"mode":"wide","headerRow":0,"columns":{"month":0,"electricity":1,"water":2,"gas":3}}',
    "或长表:",
    '{"mode":"long","headerRow":0,"columns":{"month":0,"type":1,"amount":2}}',
    "mode=wide 时 columns 里只需包含存在的列;headerRow 为表头所在行号(从 0 计,无表头则 -1)。",
    "electricity=电费列,water=水费列,gas=燃气费列,month=月份列,type=资源类型列,amount=金额列。",
    "表格内容:",
    "表头: " + JSON.stringify(raw.headers),
    ...raw.rows.map((r, i) => `行${i + 1}: ${JSON.stringify(r)}`),
  ].join("\n");
}

export interface AiColumnMap {
  mode: "wide" | "long";
  headerRow: number;
  columns: Partial<{ month: number; electricity: number; water: number; gas: number; type: number; amount: number }>;
}

export function applyAiMap(aoa: unknown[][], ai: AiColumnMap): ParseResult {
  const map: ColumnMap = {
    mode: ai.mode === "long" ? "long" : "wide",
    headerRow: ai.headerRow ?? 0,
    month: ai.columns.month ?? 0,
    electricity: ai.columns.electricity,
    water: ai.columns.water,
    gas: ai.columns.gas,
    type: ai.columns.type,
    amount: ai.columns.amount,
  };
  return parseAoa(aoa, ["列映射来自 AI 识别"], "AI 映射");
}
