// 页面图表横坐标验证:打开页面 → 载入示例 → 截图三联图(仅开发用)
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1.5 });
await page.goto("http://localhost:8787", { waitUntil: "networkidle0" });

// 点击「载入示例数据」
const clicked = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")];
  const b = btns.find((x) => x.textContent?.includes("载入示例数据"));
  if (b) { b.click(); return true; }
  return false;
});
console.log("点击载入示例:", clicked);
await new Promise((r) => setTimeout(r, 1200));

// 截三联图区域(第一个含 recharts 的卡)
const card = await page.evaluateHandle(() => {
  const charts = document.querySelectorAll(".recharts-wrapper");
  return charts[0]?.closest(".rounded-2xl") ?? null;
});
const el = card.asElement();
if (el) {
  await el.screenshot({ path: "/tmp/chart-elec.png" });
  const cards = await page.$$(".recharts-wrapper");
  console.log("图表数:", cards.length);
  // 再截燃气图(第二张)
  const gas = await page.evaluateHandle(() => document.querySelectorAll(".recharts-wrapper")[1]?.closest(".rounded-2xl") ?? null);
  await gas.asElement()?.screenshot({ path: "/tmp/chart-gas.png" });
  // 记录 x 轴渲染的 tick 文本
  const ticks = await page.evaluate(() =>
    [...document.querySelectorAll(".recharts-wrapper")].slice(0, 2).map((w) =>
      [...w.querySelectorAll(".recharts-cartesian-axis-tick text")]
        .map((t) => t.textContent)
        .join("|"),
    ),
  );
  console.log("X轴 tick(电):", ticks[0]);
  console.log("X轴 tick(气):", ticks[1]);
} else {
  console.log("未找到图表!");
}
await browser.close();
