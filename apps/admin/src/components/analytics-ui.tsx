"use client";
import React, { useMemo, useState } from "react";
import { formatCount, formatDay, formatDayShort, istClock, relativeDayLabel } from "@/lib/ist";

// Shared presentation layer for the Dashboard / Analytics / Marketing panels.
// One set of primitives so a KPI, a range switch, a bar and a breakdown row look
// and behave identically wherever they appear.
//
// Chart conventions (single-series throughout, so no legend is needed — the
// panel title names the measure): thin marks with 4px rounded tops anchored to a
// shared baseline, a 2px surface gap between adjacent bars, a recessive track
// behind every column so zero days stay visible, and a hover tooltip on every
// mark. Numbers are tabular so columns align.

/* ------------------------------------------------------------------ Live --- */

export function LiveStatus({
  updatedAt,
  live = true,
  error,
}: {
  updatedAt: number | null;
  live?: boolean;
  error?: string | null;
}) {
  const tone = error ? "var(--danger)" : live ? "var(--success)" : "var(--muted)";
  const label = error ? "Disconnected" : live ? "Live" : "Paused";
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--muted)]" aria-live="polite">
      <span className="relative flex h-2 w-2" aria-hidden="true">
        {live && !error && (
          <span
            className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping"
            style={{ background: tone }}
          />
        )}
        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: tone }} />
      </span>
      <span className="font-medium" style={{ color: tone }}>
        {label}
      </span>
      {updatedAt && (
        <span className="whitespace-nowrap tabular-nums">· {istClock(updatedAt)} IST</span>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- Range --- */

export interface RangeOption<T extends string> {
  key: T;
  label: string;
}

export function RangeTabs<T extends string>({
  options,
  value,
  onChange,
  ariaLabel = "Date range",
}: {
  options: readonly RangeOption<T>[];
  value: T;
  onChange: (key: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 rounded-xl border border-[var(--border)] bg-[var(--card)] p-1"
    >
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
              active
                ? "bg-[var(--primary)] text-[var(--on-primary)]"
                : "text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-[var(--foreground)]"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- Panel --- */

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] ${className}`}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3.5">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-[var(--foreground)]">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-[var(--muted)]">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-sm text-[var(--muted)]">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-xs text-[var(--muted)]/70">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------- Stat card --- */

export type Tone = "default" | "success" | "warning" | "danger";

const TONE_COLOR: Record<Tone, string> = {
  default: "var(--foreground)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
};

export function StatCard({
  label,
  value,
  hint,
  delta,
  deltaLabel,
  tone = "default",
  loading = false,
  invertDelta = false,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  /** Percent change vs the comparison period; null renders as "—". */
  delta?: number | null;
  deltaLabel?: string;
  tone?: Tone;
  loading?: boolean;
  /** For metrics where "up" is bad (errors, churn). */
  invertDelta?: boolean;
}) {
  const showDelta = delta !== undefined;
  const good = delta == null ? null : invertDelta ? delta <= 0 : delta >= 0;
  const deltaColor =
    good === null ? "var(--muted)" : good ? "var(--success)" : "var(--danger)";

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label}</p>
      {loading ? (
        <div className="mt-2 h-8 w-24 animate-pulse rounded bg-[var(--card-hover)]" />
      ) : (
        <p
          className="mt-1.5 text-2xl font-bold tabular-nums"
          style={{ color: TONE_COLOR[tone] }}
        >
          {value}
        </p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {showDelta && !loading && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums"
            style={{ color: deltaColor, background: `color-mix(in srgb, ${deltaColor} 12%, transparent)` }}
          >
            <span aria-hidden="true">{delta == null ? "–" : delta >= 0 ? "▲" : "▼"}</span>
            {delta == null ? "n/a" : `${Math.abs(delta).toFixed(delta >= 10 || delta <= -10 ? 0 : 1)}%`}
          </span>
        )}
        {(hint || deltaLabel) && (
          <span className="text-xs text-[var(--muted)]">{hint ?? deltaLabel}</span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- Bar chart --- */

export interface BarDatum {
  /** IST date (YYYY-MM-DD) — also the x label. */
  date: string;
  value: number;
}

/**
 * Single-series daily bar chart. Renders one column per day in the range —
 * including days with no data — so gaps read as zero rather than disappearing.
 */
export function DailyBarChart({
  data,
  format,
  height = 176,
  todayDate,
  label,
}: {
  /** Oldest first. */
  data: BarDatum[];
  format: (n: number) => string;
  height?: number;
  todayDate?: string;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = useMemo(() => Math.max(...data.map((d) => d.value), 1), [data]);
  const total = useMemo(() => data.reduce((a, d) => a + d.value, 0), [data]);

  if (data.length === 0) {
    return <EmptyState title="No days in this range." />;
  }

  const active = hover != null ? data[hover] : null;
  // Anchor the tooltip to the hovered column; clamp so it never leaves the box.
  const pct = data.length > 1 ? (hover ?? 0) / (data.length - 1) : 0.5;

  return (
    <div className="px-5 py-4">
      <div
        className="relative"
        role="img"
        aria-label={`${label}. ${data.length} days, total ${format(total)}, peak ${format(max)}.`}
      >
        {/* Gridlines — recessive, behind the marks. */}
        <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height }}>
          {[0, 0.5, 1].map((f) => (
            <div
              key={f}
              className="absolute inset-x-0 border-t border-[var(--border)]"
              style={{ top: `${f * 100}%`, opacity: f === 1 ? 1 : 0.5 }}
            />
          ))}
          {total > 0 && (
            <span className="absolute right-0 -top-0.5 -translate-y-full text-[10px] tabular-nums text-[var(--muted)]">
              peak {format(max)}
            </span>
          )}
        </div>

        {total === 0 && (
          <div
            className="pointer-events-none absolute inset-x-0 flex items-center justify-center"
            style={{ height }}
          >
            <span className="rounded-full border border-[var(--border)] bg-[var(--background-elev)] px-3 py-1 text-xs text-[var(--muted)]">
              Nothing recorded in this range
            </span>
          </div>
        )}

        <div className="relative flex items-end gap-[2px]" style={{ height }} onMouseLeave={() => setHover(null)}>
          {data.map((d, i) => {
            const h = (d.value / max) * 100;
            const isToday = todayDate && d.date === todayDate;
            return (
              <button
                key={d.date}
                type="button"
                tabIndex={-1}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                className="group relative flex h-full flex-1 cursor-default flex-col justify-end"
                aria-hidden="true"
              >
                {/* Track: keeps every day visible, including the zero ones. */}
                <span
                  className="absolute inset-0 rounded-[3px] transition-colors"
                  style={{ background: hover === i ? "var(--card-hover)" : "transparent" }}
                />
                <span
                  className="relative w-full rounded-t-[4px] transition-[filter,opacity]"
                  style={{
                    height: d.value > 0 ? `max(3px, ${h}%)` : "2px",
                    background: d.value > 0 ? "var(--primary)" : "var(--border)",
                    opacity: hover == null || hover === i ? 1 : 0.45,
                    outline: isToday && d.value > 0 ? "1px solid var(--gold-1)" : undefined,
                  }}
                />
              </button>
            );
          })}
        </div>

        {/* Baseline */}
        <div className="border-t border-[var(--border)]" />

        {active && (
          <div
            className="pointer-events-none absolute -top-1 z-10 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--background-elev)] px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: `${pct * 100}%`, transform: `translate(${-pct * 100}%, -100%)` }}
          >
            <span className="font-medium text-[var(--foreground)]">
              {relativeDayLabel(active.date, todayDate) ?? formatDay(active.date)}
            </span>
            <span className="ml-2 tabular-nums text-[var(--primary)]">{format(active.value)}</span>
          </div>
        )}
      </div>

      <div className="mt-2 flex justify-between text-xs text-[var(--muted)]">
        <span>{formatDayShort(data[0].date)}</span>
        {data.length > 2 && <span>{formatDayShort(data[Math.floor(data.length / 2)].date)}</span>}
        <span>{formatDayShort(data[data.length - 1].date)}</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Day cell --- */

/** Date cell used by every daily table: full IST date + a Today/Yesterday chip. */
export function DayCell({ date, todayDate }: { date: string; todayDate?: string }) {
  const rel = relativeDayLabel(date, todayDate);
  return (
    <span className="flex items-center gap-2">
      <span className="font-medium tabular-nums">{formatDay(date)}</span>
      {rel && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            rel === "Today"
              ? "bg-[var(--primary)]/15 text-[var(--primary)]"
              : "bg-[var(--muted)]/15 text-[var(--muted)]"
          }`}
        >
          {rel}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------ Share rows --- */

export interface BreakdownRow {
  key: string;
  label: string;
  count: number;
  revenue: number;
}

/**
 * Ranked breakdown with an inline share-of-total bar — the standard way to read
 * "which source drove this" at a glance without a second chart.
 */
export function Breakdown({
  title,
  rows,
  showRevenue,
  firstCol = "Source",
  max = 10,
  formatRevenue,
  emptyHint,
}: {
  title: string;
  rows: BreakdownRow[];
  showRevenue: boolean;
  firstCol?: string;
  max?: number;
  formatRevenue: (n: number) => string;
  emptyHint?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const total = rows.reduce((a, r) => a + r.count, 0);
  const shown = expanded ? rows : rows.slice(0, max);

  return (
    <Panel
      title={title}
      actions={
        rows.length > max ? (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="rounded-lg px-2 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--foreground)]"
          >
            {expanded ? "Show less" : `Show all ${rows.length}`}
          </button>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <EmptyState title="No data yet." hint={emptyHint} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="text-left text-xs text-[var(--muted)]">
                <th scope="col" className="px-5 py-2 font-medium">
                  {firstCol}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Conv.
                </th>
                <th scope="col" className="w-24 px-3 py-2 text-right font-medium">
                  Share
                </th>
                {showRevenue && (
                  <th scope="col" className="px-5 py-2 text-right font-medium">
                    Revenue
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const share = total ? (r.count / total) * 100 : 0;
                return (
                  <tr key={r.key} className="border-t border-[var(--border)]">
                    <td className="max-w-[220px] truncate px-5 py-2.5" title={r.label}>
                      {r.label}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatCount(r.count)}</td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center justify-end gap-2">
                        <span className="h-1.5 w-12 overflow-hidden rounded-full bg-[var(--border)]">
                          <span
                            className="block h-full rounded-full bg-[var(--primary)]"
                            style={{ width: `${share}%` }}
                          />
                        </span>
                        <span className="w-9 text-right text-xs tabular-nums text-[var(--muted)]">
                          {share.toFixed(0)}%
                        </span>
                      </span>
                    </td>
                    {showRevenue && (
                      <td className="px-5 py-2.5 text-right tabular-nums">
                        {formatRevenue(r.revenue)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------- Skeleton --- */

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="h-3 w-20 animate-pulse rounded bg-[var(--card-hover)]" />
          <div className="mt-3 h-7 w-24 animate-pulse rounded bg-[var(--card-hover)]" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonPanel({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="border-b border-[var(--border)] px-5 py-3.5">
        <div className="h-3.5 w-32 animate-pulse rounded bg-[var(--card-hover)]" />
      </div>
      <div className="divide-y divide-[var(--border)]">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center justify-between px-5 py-3">
            <div className="h-3 w-40 animate-pulse rounded bg-[var(--card-hover)]" />
            <div className="h-3 w-16 animate-pulse rounded bg-[var(--card-hover)]" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Banner --- */

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-[var(--danger)]/25 bg-[var(--danger)]/10 px-4 py-3 text-sm text-[var(--danger)]"
    >
      <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
      </svg>
      <span>{message}</span>
    </div>
  );
}
