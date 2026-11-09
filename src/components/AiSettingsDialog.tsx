import { useState } from "react";
import { X, Eye, EyeOff, KeyRound } from "lucide-react";
import type { AiConfig } from "../lib/ai";
import { Toggle } from "./ui";

const PRESETS = [
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { name: "Moonshot", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { name: "本地 Ollama", baseUrl: "http://localhost:11434/v1", model: "qwen2.5:7b" },
];

export default function AiSettingsDialog({
  cfg,
  onSave,
  onClose,
}: {
  cfg: AiConfig;
  onSave: (c: AiConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AiConfig>({ ...cfg });
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-[520px] rounded-2xl border border-white/10 bg-[#12121a] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[17px] font-bold text-white">
            <KeyRound className="h-5 w-5 text-violet-300" /> AI 分析设置
          </h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <Toggle
            checked={draft.enabled}
            onChange={(v) => setDraft({ ...draft, enabled: v })}
            label="启用 AI 分析"
            hint="使用 OpenAI 兼容接口生成深度分析报告;密钥仅保存在本浏览器"
          />

          <div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => setDraft({ ...draft, baseUrl: p.baseUrl, model: p.model })}
                  className="rounded-full border border-white/10 px-2.5 py-1 text-[12px] text-white/55 transition-colors hover:border-violet-400/50 hover:text-violet-300"
                >
                  {p.name}
                </button>
              ))}
            </div>
            <label className="mb-1 block text-[12.5px] font-semibold text-white/60">Base URL(OpenAI 兼容,含 /v1)</label>
            <input
              value={draft.baseUrl}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
              placeholder="https://api.deepseek.com/v1"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[13.5px] text-white outline-none focus:border-violet-400/60"
            />
          </div>

          <div>
            <label className="mb-1 block text-[12.5px] font-semibold text-white/60">API Key</label>
            <div className="flex gap-2">
              <input
                type={showKey ? "text" : "password"}
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                placeholder="sk-..."
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[13.5px] tabular-nums text-white outline-none focus:border-violet-400/60"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="shrink-0 rounded-lg border border-white/10 px-2.5 text-white/45 hover:text-white"
                title={showKey ? "隐藏" : "显示"}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[12.5px] font-semibold text-white/60">模型</label>
              <input
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                placeholder="deepseek-chat"
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[13.5px] text-white outline-none focus:border-violet-400/60"
              />
            </div>
            <div>
              <label className="mb-1 block text-[12.5px] font-semibold text-white/60">Temperature</label>
              <input
                type="number"
                step={0.1}
                min={0}
                max={2}
                value={draft.temperature}
                onChange={(e) => setDraft({ ...draft, temperature: Number(e.target.value) })}
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[13.5px] tabular-nums text-white outline-none focus:border-violet-400/60"
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <span className="text-[11.5px] leading-snug text-white/35">
            🔒 密钥保存在浏览器 localStorage,仅经本地服务转发至你填写的接口
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-[13.5px] text-white/60 hover:text-white">
              取消
            </button>
            <button
              onClick={() => {
                onSave(draft);
                onClose();
              }}
              className="rounded-lg bg-violet-500 px-4 py-2 text-[13.5px] font-bold text-white transition-colors hover:bg-violet-400"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
