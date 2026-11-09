// 解析端到端验证:用真实 CSV(水电燃用量分析.csv)验证表头识别与数据提取
// 运行:npx tsx scripts/verify-parse.ts
import { readFileSync } from "node:fs";
import { parseWorkbookData, parsePastedText } from "../src/core/parse";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) {
    failed++;
    console.log(`✗ ${name}: 实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`);
  } else {
    console.log(`✓ ${name}: ${typeof actual === "object" ? JSON.stringify(actual) : actual}`);
  }
}

// ===== 1. 真实 CSV 文件(UTF-8,行尾多一个空列) =====
const csvBuf = readFileSync(new URL("./fixture-bills.csv", import.meta.url));
const r1 = parseWorkbookData(csvBuf);
console.log("映射:", r1.mapping);
check("月份数", r1.bills.length, 12);
check("首月", r1.bills[0].month, "2025-11");
check("首月电费", r1.bills[0].electricity, 106.7);
check("首月水费", r1.bills[0].water, 162);
check("首月气费", r1.bills[0].gas, 117);
check("2026-02 无水费", r1.bills.find((b) => b.month === "2026-02")?.water, undefined);
check("2026-01 水费", r1.bills.find((b) => b.month === "2026-01")?.water, 247.05);
check("needAiMap", r1.needAiMap, false);

// ===== 2. 粘贴文本(TSV,模拟 Excel 复制) =====
const tsv = "月份\t电费\t水费\t燃气费\n2024-01\t100\t50\t60\n2024-02\t110\t\t61";
const r2 = parsePastedText(tsv);
check("TSV 月份数", r2.bills.length, 2);
check("TSV 电费", r2.bills[1].electricity, 110);
check("TSV 无水费", r2.bills[1].water, undefined);

// ===== 3. 长表格式 =====
const long = "日期,项目,金额\n2025-01,电费,120\n2025-01,燃气费,80\n2025-01,水费,55\n2025-02,电费,130";
const r3 = parsePastedText(long);
check("长表月份数", r3.bills.length, 2);
check("长表合并电费", r3.bills[0].electricity, 120);
check("长表合并气费", r3.bills[0].gas, 80);
check("长表合并水费", r3.bills[0].water, 55);

// ===== 4. 无表头(列位置猜测) =====
const noHeader = "2025-01,100,55,60\n2025-02,110,56,61";
const r4 = parsePastedText(noHeader);
check("无表头月份数", r4.bills.length, 2);
check("无表头水费(第3列)", r4.bills[0].water, 55);

// ===== 5. 日期格式多样性 =====
const fmts = "日期,电费\n2025年1月,100\n2025/02,110\n2025.3,120";
const r5 = parsePastedText(fmts);
check("格式1(年月)", r5.bills[0].month, "2025-01");
check("格式2(斜杠)", r5.bills[1].month, "2025-02");
check("格式3(点)", r5.bills[2].month, "2025-03");

// ===== 6. 未知表头 → needAiMap =====
const weird = "AA,BB,CC\nx,y,z";
const r6 = parsePastedText(weird);
check("未知表头 needAiMap", r6.needAiMap, true);
check("AI 预览行数", r6.rawPreview?.rows.length ?? 0, 1);

console.log(failed === 0 ? "\n✅ 解析全部通过" : `\n❌ ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
