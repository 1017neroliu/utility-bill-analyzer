// AI 配置:仅存浏览器 localStorage;请求经本地后端代理转发
export interface AiConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
}

const KEY = "utility-bill-analyzer/ai-config";

export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false,
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "",
  model: "deepseek-chat",
  temperature: 0.4,
};

export function loadAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_AI_CONFIG;
    return { ...DEFAULT_AI_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_AI_CONFIG;
  }
}

export function saveAiConfig(cfg: AiConfig) {
  localStorage.setItem(KEY, JSON.stringify(cfg));
}

export const SYSTEM_PROMPT = `你是资深的家庭能源账单分析师,精通中国居民阶梯电价/气价/水价政策(尤其上海:电/水按自然年累计、燃气按每年9月至次年8月结算、电峰谷分时、一户多人口政策)。
用户会提供:每月账单金额明细,以及由精确规则引擎计算好的「用量反推 + 跳档定位 + 档位分布 + 一户多人口价值」分析 JSON。
要求:
1. 严格基于提供的引擎计算结果进行解读,不要重新计算或修改任何数字,不要编造数据;
2. 用 Markdown 输出,包含:①用量画像与季节规律 ②跳档复盘(时间点与档位)③费用结构与阶梯加价分析 ④可执行的节能省钱建议(具体到行为,如地暖温度、空调设置、谷电迁移) ⑤下一结算周期展望与提醒;
3. 全程使用中文,简洁专业,适当使用表格与加粗强调关键数字;
4. 涉及"一户多人口"时提醒:资格每 2 年需续办(随申办可办);
5. 若数据不足 12 个月或周期不完整,请指出结论的局限性。`;

/** 把引擎结果精简为 AI 可读的 JSON(控制 token) */
export function buildAnalysisPrompt(payload: unknown): string {
  return [
    "请基于以下数据分析(注意:用量与跳档均为规则引擎精确计算结果):",
    JSON.stringify(payload),
  ].join("\n");
}

/** 流式调用 /api/ai/chat,onDelta 逐段回调,返回完整文本 */
export async function streamAiChat(
  cfg: AiConfig,
  messages: { role: string; content: string }[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      temperature: cfg.temperature,
      stream: true,
      messages,
    }),
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `请求失败(${res.status})`);
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const delta: string = json?.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        // 忽略不完整行
      }
    }
  }
  return full;
}
