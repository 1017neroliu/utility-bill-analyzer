// 报告视觉冒烟:headless Chrome 渲染样例报告并截图(仅开发用)
import puppeteer from "puppeteer-core";

const chromePath = "/usr/bin/google-chrome";
console.log("chrome:", chromePath);

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 900, deviceScaleFactor: 1.5 });
await page.goto("file:///tmp/report-sample.html");
await new Promise((r) => setTimeout(r, 600));
const h = await page.evaluate(() => document.body.scrollHeight);
console.log("页面高度:", h);

// 头部 + 总览 + 图表
await page.screenshot({ path: "/tmp/report-shot-1.png", clip: { x: 0, y: 0, width: 1024, height: 1300 } });
// 泳道跳档地图
const laneEl = await page.$(".rpt-card:nth-of-type(3)");
if (laneEl) await laneEl.screenshot({ path: "/tmp/report-shot-2.png" });
// 价值测算 + 进度
const cards = await page.$$(".rpt-card");
if (cards[4]) await cards[4].screenshot({ path: "/tmp/report-shot-3.png" });
await browser.close();
console.log("✅ 截图完成:/tmp/report-shot-{1,2,3}.png");
