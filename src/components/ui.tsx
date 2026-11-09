import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
  glow,
}: {
  children: ReactNode;
  className?: string;
  glow?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/[0.07] bg-white/[0.03] ${className}`}
      style={{
        boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.04), 0 20px 40px -24px rgba(0,0,0,0.6)",
        ...(glow ? { borderColor: glow + "33" } : {}),
      }}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ icon, title, desc, right }: { icon?: ReactNode; title: string; desc?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div className="flex items-center gap-2.5">
        {icon && (
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05]">{icon}</div>
        )}
        <div>
          <h2 className="text-[17px] font-bold text-white">{title}</h2>
          {desc && <div className="mt-0.5 text-[13px] leading-snug text-white/40">{desc}</div>}
        </div>
      </div>
      {right}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-3 text-left transition-colors hover:border-white/20"
    >
      <span>
        <span className="block text-[14px] font-semibold text-white/85">{label}</span>
        {hint && <span className="mt-0.5 block text-[12.5px] leading-snug text-white/40">{hint}</span>}
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-emerald-500/80" : "bg-white/15"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

export function NumberInput({
  value,
  onChange,
  step = 0.01,
  min,
  suffix,
  className = "",
}: {
  value: number | "";
  onChange: (v: number | "") => void;
  step?: number;
  min?: number;
  suffix?: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center rounded-lg border border-white/10 bg-black/30 focus-within:border-cyan-400/50 ${className}`}>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        className="w-full bg-transparent px-2.5 py-1.5 text-[14px] tabular-nums text-white outline-none"
      />
      {suffix && <span className="pr-2 text-[12px] text-white/35">{suffix}</span>}
    </span>
  );
}

export function Pill({ color, children, dashed }: { color: string; children: ReactNode; dashed?: boolean }) {
  return (
    <span
      className="whitespace-nowrap rounded-full px-2.5 py-[3px] text-[12px] font-bold"
      style={{
        color,
        background: color + "1f",
        border: `${dashed ? "1.5px dashed" : "1px solid"} ${color}66`,
      }}
    >
      {children}
    </span>
  );
}

export const RT_COLORS: Record<string, string> = {
  electricity: "#fbbf24",
  gas: "#fb7185",
  water: "#22d3ee",
};

export const TIER_COLORS = ["#34d399", "#fbbf24", "#fb7185"];
