// README 界面截图生成:打开页面 → 载入示例 → 按区域截图到 docs/screenshots/(仅开发用)
import puppeteer from "puppeteer-core";
import { execSync } from "node:child_process";

const OUT = "docs/screenshots";
// 先重新生成报告样例(与页面同一份示例数据)
execSync("npx tsx scripts/verify-report.ts", { stdio: "pipe" });

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--lang=zh-CN"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1.6 });
await page.setExtraHTTPHeaders({ "Accept-Language": "zh-CN,zh;q=0.9" });
await page.goto("http://localhost:8787", { waitUntil: "networkidle0" });

const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("载入示例数据"));
  if (b) { b.click(); return true; }
  return false;
});
if (!clicked) throw new Error("未找到载入示例按钮");
await new Promise((r) => setTimeout(r, 1500));

/** 按卡片内标题文本找卡片元素 */
async function cardByTitle(text: string) {
  return page.evaluateHandle((t) => {
    const h2 = [...document.querySelectorAll("h2")].find((x) => x.textContent?.includes(t));
    return h2?.closest(".rounded-2xl") ?? null;
  }, text);
}

// ① 输入面板
await (await cardByTitle("录入账单")).asElement()?.screenshot({ path: `${OUT}/01-input.png` });

// ② Dashboard:KPI 行 + 三联趋势图(取 KPI grid 的父容器)
const dash = await page.evaluateHandle(() => {
  const grid = document.querySelectorAll(".recharts-wrapper")[0]?.closest("div.grid");
  return grid?.parentElement ?? null;
});
await dash.asElement()?.screenshot({ path: `${OUT}/02-dashboard.png` });

// ③ 跳档地图
await (await cardByTitle("阶梯跳档地图")).asElement()?.screenshot({ path: `${OUT}/03-tiers.png` });

// ④ 进度 + 价值
const savings = await cardByTitle("一户多人口(5人)价值测算");
await savings.asElement()?.screenshot({ path: `${OUT}/04-savings.png` });

// ⑤ 总结建议(展开导出菜单)
await page.evaluate(() => {
  const s = document.querySelector("details summary") as HTMLElement | null;
  s?.click();
});
await new Promise((r) => setTimeout(r, 300));
const insightsCard = await page.evaluateHandle(() => {
  const sum = document.querySelector("details")?.closest(".rounded-2xl");
  return sum ?? null;
});
await insightsCard.asElement()?.screenshot({ path: `${OUT}/05-insights.png` });
await page.evaluate(() => (document.querySelector("details summary") as HTMLElement)?.click());

// ⑥ 导出的 HTML 报告(全页长图)
const rp = await browser.newPage();
await rp.setViewport({ width: 1000, height: 1000, deviceScaleFactor: 1.3 });
await rp.goto("file:///tmp/report-sample.html");
await new Promise((r) => setTimeout(r, 500));
await rp.screenshot({ path: `${OUT}/06-report.png`, fullPage: true });

await browser.close();
console.log("✅ 截图完成 → docs/screenshots/");
