import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const app = new Hono();

// ---- AI 代理:OpenAI 兼容 /chat/completions ----
// apiKey 只在浏览器与代理间传输,代理不落盘、不持久化任何数据。

function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(url)) url = "https://" + url;
  return url;
}

app.post("/api/ai/chat", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.baseUrl || !body?.apiKey || !body?.model || !Array.isArray(body?.messages)) {
    return c.json({ error: "缺少参数:baseUrl / apiKey / model / messages" }, 400);
  }
  const base = normalizeBaseUrl(String(body.baseUrl));
  const url = /\/chat\/completions$/.test(base) ? base : base + "/chat/completions";
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${String(body.apiKey)}`,
      },
      body: JSON.stringify({
        model: String(body.model),
        messages: body.messages,
        temperature: typeof body.temperature === "number" ? body.temperature : 0.4,
        stream: body.stream === true,
      }),
    });
  } catch (e) {
    return c.json({ error: `无法连接 AI 服务(${url}):${e instanceof Error ? e.message : String(e)}` }, 502);
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return c.json({ error: `上游返回 ${upstream.status}: ${text.slice(0, 500)}` }, 502);
  }

  if (body.stream === true && upstream.body) {
    return new Response(upstream.body, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  }
  const data = await upstream.json();
  return c.json(data);
});

app.get("/api/health", (c) => c.json({ ok: true, ts: Date.now() }));

// ---- 生产模式:托管前端构建产物 ----
const distDir = resolve(process.cwd(), "dist");
const isProd = existsSync(join(distDir, "index.html"));

if (isProd) {
  app.use("*", serveStatic({ root: "./dist" }));
  // SPA fallback
  app.get("*", (c) => {
    try {
      const html = readFileSync(join(distDir, "index.html"), "utf-8");
      return c.html(html);
    } catch {
      return c.text("dist/index.html 不存在,请先 npm run build", 404);
    }
  });
} else {
  app.get("/", (c) =>
    c.text("开发模式:请另开终端运行 `npm run dev`(Vite 默认 5173,已代理 /api 到本服务)"),
  );
}

const port = Number(process.env.PORT || 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[utility-bill-analyzer] API 服务已启动: http://localhost:${info.port}${isProd ? "(含前端静态托管)" : " (开发模式,请运行 npm run dev)"}`);
});
