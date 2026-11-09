// 报告导出验证:内容完整性断言 + 生成样例文件
// 运行:npx tsx scripts/verify-report.ts
import { readFileSync, writeFileSync } from "node:fs";
import { analyzeBills } from "../src/core/engine";
import { shanghai } from "../src/core/rules/shanghai";
import { parseWorkbookData } from "../src/core/parse";
import { buildReportHtml, buildReportMarkdown } from "../src/lib/report";
import type { BillMonth } from "../src/core/types";

let failed = 0;
function check(name: string, actual: unknown, expected: string) {
  const ok = String(actual).includes(expected);
  if (!ok) {
    failed++;
    console.log(`✗ ${name}: 未找到期望内容 → ${expected.slice(0, 80)}`);
  } else {
    console.log(`✓ ${name}`);
  }
}
function checkNo(name: string, actual: unknown, bad: string) {
  const ok = !String(actual).includes(bad);
  if (!ok) {
    failed++;
    console.log(`✗ ${name}: 出现了不应存在的 ${bad}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

const bills: BillMonth[] = parseWorkbookData(readFileSync(new URL("./fixture-bills.csv", import.meta.url))).bills;
const result = analyzeBills(bills, shanghai, { multiPerson: true, peakRatio: 0.55 });
const aiSample = "## AI 测试标题\n\n- 建议一:**空调 +1°C**\n- 建议二:谷电充电";

const html = buildReportHtml({ bills, result, ruleSet: shanghai, aiReport: aiSample, generatedAt: "2026-11-09 16:00" });
const md = buildReportMarkdown({ bills, result, ruleSet: shanghai, aiReport: aiSample });

console.log(`HTML ${(html.length / 1024).toFixed(1)} KB · Markdown ${(md.length / 1024).toFixed(1)} KB\n`);

// ---- HTML 断言 ----
check("HTML:数据区间", html, "25.11 – 26.10");
check("HTML:规则集", html, "规则集:上海");
check("HTML:一户多人口标注", html, "一户多人口(5人)档");
check("HTML:总金额", html, "5,950.45");
check("HTML:电跨档事件(2026.3 tooltip)", html, "26.3:217.80 元 ≈ 70.8");
check("HTML:气三档(2026.8 tooltip)", html, "26.8:96.60 元");
check("HTML:年份锚点标签(26.1)", html, ">26.1</text>");
check("HTML:SVG 图表数量", String((html.match(/<svg /g) ?? []).length), "3");
check("HTML:泳道周期(电2026年度)", html, "2026年度");
check("HTML:泳道周期(气2025)", html, "2025");
check("HTML:5人口节省合计", html, "421.96");
check("HTML:AI 报告章节", html, "AI 测试标题");
check("HTML:口径附录", html, "口径与方法");
check("HTML:明细表(2026-09)", html, "26.9");
checkNo("HTML:无未定义值", html, "undefined");
checkNo("HTML:无 NaN", html, ">NaN<");

// ---- Markdown 断言 ----
check("MD:标题", md, "# 水电气阶梯分析报告");
check("MD:总金额", md, "5,950.45");
check("MD:明细表", md, "| 26.3 | 217.80 | 70.8");
check("MD:5人口表", md, "一户多人口价值");
check("MD:AI 章节", md, "AI 测试标题");
checkNo("MD:无未定义值", md, "undefined");

// ---- 生成样例供人工查看 ----
writeFileSync("/tmp/report-sample.html", html);
writeFileSync("/tmp/report-sample.md", md);
console.log("\n样例已写入 /tmp/report-sample.html 与 /tmp/report-sample.md");
console.log(failed === 0 ? "✅ 报告验证全部通过" : `❌ ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
