import React from "react";

function joinClasses(...classes) {
  return classes.filter(Boolean).join(" ");
}

export function ActionButton({
  children,
  variant = "primary",
  className = "",
  type = "button",
  ...props
}) {
  const variants = {
    primary:
    "border-transparent bg-[linear-gradient(135deg,#4f46e5_0%,#2563eb_60%,#06b6d4_100%)] text-white shadow-[0_16px_28px_rgba(37,99,235,0.26)] hover:translate-y-[-1px] hover:shadow-[0_20px_34px_rgba(37,99,235,0.3)]",
    secondary:
    "border-white/65 bg-white/90 text-slate-700 shadow-[0_10px_22px_rgba(15,23,42,0.08)] hover:bg-white",
    ghost:
    "border-transparent bg-white/10 text-slate-700 hover:bg-white/20",
    danger:
    "border-transparent bg-[linear-gradient(135deg,#ef4444_0%,#dc2626_100%)] text-white shadow-[0_14px_26px_rgba(220,38,38,0.2)] hover:translate-y-[-1px]"
  };

  return (
    <button
      type={type}
      className={joinClasses(
        "inline-flex items-center justify-center gap-2 rounded-xl border px-3.5 py-2 text-[13px] font-semibold transition duration-200 disabled:cursor-not-allowed disabled:opacity-60 sm:rounded-2xl sm:px-4",
        variants[variant] || variants.primary,
        className
      )}
      {...props}>
      
      {children}
    </button>);

}

export function StatusBadge({ children, tone = "neutral", className = "" }) {
  const tones = {
    neutral: "bg-slate-900/5 text-slate-600",
    blue: "bg-sky-500/12 text-sky-700",
    indigo: "bg-indigo-500/12 text-indigo-700",
    green: "bg-emerald-500/12 text-emerald-700",
    amber: "bg-amber-500/16 text-amber-700",
    red: "bg-rose-500/14 text-rose-700"
  };

  return (
    <span
      className={joinClasses(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] sm:px-3",
        tones[tone] || tones.neutral,
        className
      )}>
      
      {children}
    </span>);

}

export function HeroStat({ icon, label, value, meta, tone = "blue" }) {
  const tones = {
    blue: "from-sky-500/16 to-cyan-500/8 text-sky-700 ring-sky-500/15",
    indigo: "from-indigo-500/16 to-violet-500/8 text-indigo-700 ring-indigo-500/15",
    green: "from-emerald-500/16 to-lime-500/8 text-emerald-700 ring-emerald-500/15",
    amber: "from-amber-500/16 to-orange-500/8 text-amber-700 ring-amber-500/15",
    red: "from-rose-500/16 to-red-500/8 text-rose-700 ring-rose-500/15"
  };

  return (
    <div className="rounded-[22px] border border-white/65 bg-white/92 p-3.5 shadow-[0_16px_35px_rgba(15,23,42,0.08)] sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            {label}
          </div>
          <div className="mt-2.5 text-[1.8rem] font-semibold tracking-tight text-slate-900 sm:text-3xl">
            {value}
          </div>
          {meta ?
          <div className="mt-2 text-xs text-slate-500">{meta}</div> :
          null}
        </div>

        {icon ?
        <div
          className={joinClasses(
            "flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br ring-1 sm:h-11 sm:w-11",
            tones[tone] || tones.blue
          )}>
          
            {icon}
          </div> :
        null}
      </div>
    </div>);

}

export function SegmentedTabs({ items, value, onChange, className = "" }) {
  return (
    <div
      className={joinClasses(
        "inline-flex flex-wrap gap-1 rounded-[20px] border border-white/60 bg-white/88 p-1 shadow-[0_14px_28px_rgba(15,23,42,0.08)]",
        className
      )}>
      
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={joinClasses(
              "inline-flex items-center gap-2 rounded-[16px] px-3 py-1.5 text-[13px] font-semibold transition sm:px-4 sm:py-2",
              active ?
              "bg-[linear-gradient(135deg,#4f46e5_0%,#2563eb_100%)] text-white shadow-[0_10px_24px_rgba(79,70,229,0.22)]" :
              "text-slate-500 hover:text-slate-800"
            )}>
            
            {item.icon}
            <span>{item.label}</span>
          </button>);

      })}
    </div>);

}

export function PageShell({
  eyebrow,
  title,
  description,
  actions,
  stats,
  children,
  className = ""
}) {
  return (
    <div className={joinClasses("space-y-4", className)}>
      <section className="tm-hero-panel overflow-hidden">
        <div className="tm-hero-grid">
          <div className="space-y-3">
            {eyebrow ? <StatusBadge tone="blue">{eyebrow}</StatusBadge> : null}
            <div>
              <h1 className="flex flex-wrap items-end gap-x-3 gap-y-1 text-[25px] font-semibold tracking-tight text-slate-950 md:text-[30px]">
                <span>{title}</span>
              </h1>
              {description ?
              <p className="mt-2.5 max-w-3xl text-[13px] leading-6 text-slate-600 md:text-[14px]">
                  {description}
                </p> :
              null}
            </div>
          </div>

          {actions ? <div className="justify-self-end">{actions}</div> : null}
        </div>

        {stats?.length ?
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {stats.map((stat) =>
          <HeroStat key={stat.label} {...stat} />
          )}
          </div> :
        null}
      </section>

      {children}
    </div>);

}

export function SectionCard({
  title,
  subtitle,
  actions,
  children,
  className = "",
  bodyClassName = ""
}) {
  return (
    <section className={joinClasses("tm-section-card", className)}>
      {(title || subtitle || actions) &&
      <div className="flex flex-col gap-3 border-b border-slate-200/80 px-4 py-3.5 md:flex-row md:items-start md:justify-between sm:px-5 sm:py-4">
          <div>
            {title ?
          <h2 className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
                {title}
              </h2> :
          null}
            {subtitle ?
          <p className="mt-1 text-[13px] text-slate-500 sm:text-sm">{subtitle}</p> :
          null}
          </div>

          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      }

      <div className={joinClasses("px-4 py-4 sm:px-5 sm:py-5", bodyClassName)}>{children}</div>
    </section>);

}

export function FieldShell({ label, children, hint }) {
  return (
    <label className="block space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
        {label}
      </div>
      {children}
      {hint ? <div className="text-xs text-slate-400">{hint}</div> : null}
    </label>);

}

export function EmptyState({ title, description }) {
  return (
    <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/90 px-5 py-8 text-center">
      <div className="text-sm font-semibold text-slate-700">{title}</div>
      {description ?
      <div className="mt-2 text-sm text-slate-500">{description}</div> :
      null}
    </div>);

}

export function MetricStrip({ items }) {
  if (!items?.length) return null;

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) =>
      <div
        key={item.label}
        className="rounded-[20px] border border-white/75 bg-white/92 px-3.5 py-3.5 shadow-[0_14px_30px_rgba(15,23,42,0.06)] sm:px-4 sm:py-4">
        
          <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
            {item.label}
          </div>
          <div className="mt-2 text-[1.8rem] font-semibold tracking-tight text-slate-900 sm:text-3xl">
            {item.value}
          </div>
          {item.meta ?
        <div className="mt-1 text-xs text-slate-500">{item.meta}</div> :
        null}
        </div>
      )}
    </div>);

}

export { joinClasses };
