"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  ArrowDownUp,
  Search,
  Plus,
  X,
  CircleAlert,
  ShieldCheck,
  Building2,
  Inbox,
  Banknote,
  Download,
  Link2,
  Check,
} from "lucide-react";
import { CaseStatusBadge } from "@/components/landed/badges";
import { Loading } from "@/components/landed/primitives";
import { useCases, useNow, useRiskForAll, useSettings } from "@/lib/hooks";
import { RiskBadge } from "@/components/landed/RiskPanel";
import { usd, absDate, countdown } from "@/lib/format";
import { triggerLabel, stateLabel } from "@/lib/labels";
import { toCsv, downloadText } from "@/lib/csv";
import {
  isAttention,
  isBlocked,
  isClosed,
  matchesQueueFilter,
  nextCaseAction,
  selectQueue,
  parseQueueParams,
  queueParamsToSearch,
  isSavedViewActive,
  SAVED_VIEWS,
  type QueueFilter,
  type QueueSort,
  type QueueState,
} from "@/lib/case-queue";

const filters: { key: QueueFilter; label: string }[] = [
  { key: "all", label: "All cases" },
  { key: "attention", label: "Needs attention" },
  { key: "progress", label: "In progress" },
  { key: "ready", label: "Ready to pay" },
  { key: "blocked", label: "Blocked" },
  { key: "closed", label: "Closed" },
];

export default function CasesPage() {
  return (
    <Suspense fallback={<Loading label="Loading cases…" />}>
      <CasesQueue />
    </Suspense>
  );
}

function CasesQueue() {
  const cases = useCases();
  const risk = useRiskForAll();
  const now = useNow();
  const settings = useSettings();
  // Filter, sort, source and search live in the URL (?filter=&sort=&source=&q=) so a view can be linked and reloaded.
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const state = useMemo<QueueState>(() => parseQueueParams(sp), [sp]);
  const { filter, sort, source } = state;
  const [query, setQueryInput] = useState(state.query);
  const [copied, setCopied] = useState(false);
  function update(patch: Partial<QueueState>) {
    const search = queueParamsToSearch({ ...state, ...patch });
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  }
  const setFilter = (f: QueueFilter) => update({ filter: f });
  const setSort = (s: QueueSort) => update({ sort: s });
  const setSource = (s: string) => update({ source: s as QueueState["source"] });
  const setQuery = (q: string) => {
    setQueryInput(q);
    if (!q) update({ query: "" });
  };
  // Typed search reaches the URL after a short pause; the back button then restores the words too.
  useEffect(() => {
    if (query.trim() === state.query) return;
    const id = setTimeout(() => update({ query }), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  // When the URL's search text changes under us (back button, a pasted link), adopt it; adjusted during render, not in an effect.
  const [urlQuerySeen, setUrlQuerySeen] = useState(state.query);
  if (state.query !== urlQuerySeen) {
    setUrlQuerySeen(state.query);
    if (query.trim() !== state.query) setQueryInput(state.query);
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  const demoIds = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(settings?.demoCases ?? "[]");
      return new Set(
        Array.isArray(parsed)
          ? parsed.flatMap((v) =>
              typeof v?.caseId === "string" ? [v.caseId] : [],
            )
          : [],
      );
    } catch {
      return new Set<string>();
    }
  }, [settings]);
  const scoped = (cases ?? []).filter(
    (c) =>
      source === "all" ||
      (source === "demo" ? demoIds.has(c._id) : !demoIds.has(c._id)),
  );
  const rows = selectQueue(scoped, query, filter, sort);
  const attention = selectQueue(scoped, "", "attention", "priority");
  const blocked = scoped.filter((c) => isBlocked(c.state));
  const closed = scoped.filter((c) => isClosed(c.state));
  const stats = [
    {
      label: "Total cases",
      value: String(scoped.length),
      filter: "all" as QueueFilter,
      icon: Inbox,
    },
    {
      label: "Payments on hold",
      value: usd(blocked.reduce((n, c) => n + c.amountAtStakeCents, 0)),
      filter: "blocked" as QueueFilter,
      icon: ShieldCheck,
    },
    {
      label: "Needs attention",
      value: String(attention.length),
      filter: "attention" as QueueFilter,
      icon: CircleAlert,
    },
    {
      label: "Closed cases",
      value: String(closed.length),
      filter: "closed" as QueueFilter,
      icon: Building2,
    },
  ];
  function exportQueue() {
    const columns = [
      "Vendor",
      "Status",
      "Risk score",
      "Amount at stake (USD)",
      "Opened",
      "Record type",
    ];
    const values = rows.map((c) => [
      c.vendorName,
      stateLabel(c.state),
      risk?.[c._id]?.score ?? "",
      (c.amountAtStakeCents / 100).toFixed(2),
      new Date(c.openedAt),
      demoIds.has(c._id) ? "Demo" : "Live",
    ]);
    downloadText("landed-cases.csv", toCsv(columns, values));
  }
  return (
    <div className="ops-dashboard">
      <header className="ops-page-heading">
        <div>
          <h1>Verification cases</h1>
          <p className="ops-page-intro">
            A verification case opens whenever a vendor&apos;s bank account
            changes, and nothing is paid to the new account until the vendor&apos;s
            contact of record reads back a small probe deposit. &ldquo;Amount at
            stake&rdquo; is the total of that vendor&apos;s open invoices that would
            have gone to the unverified account.
          </p>
        </div>
        <div className="ops-heading-actions">
          <button
            type="button"
            className="ops-button"
            onClick={exportQueue}
            disabled={!rows.length}
          >
            <Download size={14} />
            Export
          </button>
          <Link href="/mailbox" className="ops-button ops-button-primary">
            <Plus size={15} />
            New verification
          </Link>
        </div>
      </header>
      <div className="ops-metrics">
        {stats.map(({ label, value, filter: target, icon: Icon }) => (
          <button
            key={label}
            className={`ops-metric ${label === "Needs attention" && attention.length ? "ops-metric-attention" : ""}`}
            onClick={() => setFilter(target)}
            type="button"
          >
            <span>
              {label}
              <Icon size={15} />
            </span>
            <strong>{cases === undefined ? "—" : value}</strong>
            <ArrowUpRight className="ops-metric-arrow" size={14} />
          </button>
        ))}
      </div>
      {attention.length > 0 && (
        <div className="ops-review-strip">
          <span className="ops-attention-icon">
            <CircleAlert size={18} />
          </span>
          <strong>
            {attention.length}{" "}
            {attention.length === 1 ? "case requires" : "cases require"} review
          </strong>
          <Link href={`/cases/${attention[0]._id}`}>
            Review next case <ArrowRight size={15} />
          </Link>
        </div>
      )}
      <section className="ops-queue" aria-label="Verification case queue">
        <div
          className="ops-queue-tabs"
          role="group"
          aria-label="Filter cases by status"
        >
          {filters.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
              <span>
                {scoped.filter((c) => matchesQueueFilter(c.state, key)).length}
              </span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs" role="group" aria-label="Saved views">
          <span className="text-muted-foreground">Saved views</span>
          {SAVED_VIEWS.map((v) => {
            const active = isSavedViewActive(v, state);
            const search = queueParamsToSearch({ ...state, filter: "all", sort: "priority", source: "all", ...v.state });
            return (
              <Link
                key={v.key}
                href={search ? `${pathname}?${search}` : pathname}
                replace
                scroll={false}
                aria-current={active ? "page" : undefined}
                title={v.hint}
                className={`rounded-full border px-2.5 py-0.5 ${active ? "border-slate-900 bg-slate-900 text-white" : "bg-card hover:bg-slate-50"}`}
              >
                {v.label}
              </Link>
            );
          })}
          <button type="button" className="ml-auto inline-flex items-center gap-1 rounded border px-2 py-0.5 hover:bg-slate-50" onClick={copyLink} aria-live="polite">
            {copied ? <Check size={12} aria-hidden /> : <Link2 size={12} aria-hidden />}
            {copied ? "Link copied" : "Copy link to this view"}
          </button>
        </div>
        <div className="ops-toolbar">
          <div className="ops-search-field">
            <Search size={15} />
            <input
              aria-label="Search cases"
              placeholder="Search vendors or case IDs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                type="button"
                aria-label="Clear case search"
                onClick={() => setQuery("")}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="ops-toolbar-selects">
            <select
              aria-label="Case record source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="all">All records</option>
              <option value="live">Live records</option>
              <option value="demo">Demo records</option>
            </select>
            <div className="ops-sort">
              <ArrowDownUp size={13} />
              <select
                aria-label="Sort cases"
                value={sort}
                onChange={(e) => setSort(e.target.value as QueueSort)}
              >
                <option value="priority">Priority first</option>
                <option value="newest">Newest first</option>
                <option value="amount">Highest amount</option>
              </select>
            </div>
          </div>
        </div>
        {cases === undefined ? (
          <div className="ops-queue-loading">
            <Loading label="Loading cases…" />
          </div>
        ) : (
          <>
            <div className="ops-table-scroll ops-desktop-records">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Status</th>
                    <th className="ops-hide-small">Risk</th>
                    <th className="ops-hide-small">Trigger</th>
                    <th className="ops-number">Amount at stake</th>
                    <th className="ops-hide-medium">Opened</th>
                    <th>Next action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c._id}>
                      <td>
                        <Link
                          className="ops-vendor-link"
                          href={`/cases/${c._id}`}
                        >
                          <span className="ops-vendor-avatar">
                            {c.vendorName
                              .split(" ")
                              .map((p) => p[0])
                              .slice(0, 2)
                              .join("")}
                          </span>
                          <span>
                            <strong>{c.vendorName}</strong>
                            <span className="ops-record-meta">
                              {demoIds.has(c._id) ? (
                                <span className="ops-demo-tag">Demo</span>
                              ) : (
                                <span className="ops-live-dot" />
                              )}
                              <span>#{c._id.slice(-7).toUpperCase()}</span>
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <CaseStatusBadge state={c.state} showToken={false} />
                        {c.state === "AWAITING_CONFIRMATION" &&
                          c.slaDeadlineAt &&
                          now > 0 && (
                            <span
                              className={
                                c.slaDeadlineAt < now
                                  ? "ops-deadline ops-overdue"
                                  : "ops-deadline"
                              }
                            >
                              {countdown(c.slaDeadlineAt, now)}
                            </span>
                          )}
                      </td>
                      <td className="ops-hide-small">
                        {risk?.[c._id] ? (
                          <RiskBadge score={risk[c._id].score} tier={risk[c._id].tier} title={risk[c._id].top} />
                        ) : (
                          <span className="text-xs text-muted-foreground">…</span>
                        )}
                      </td>
                      <td className="ops-hide-small">
                        {triggerLabel(c.triggerType)}
                      </td>
                      <td className="ops-number">
                        {usd(c.amountAtStakeCents)}
                      </td>
                      <td className="ops-hide-medium ops-date">
                        {absDate(c.openedAt)}
                      </td>
                      <td>
                        <Link
                          className={`ops-row-action ${isAttention(c.state) ? "ops-row-action-priority" : ""}`}
                          href={
                            c.state === "RECOVERY"
                              ? `/cases/${c._id}/package`
                              : `/cases/${c._id}`
                          }
                        >
                          {nextCaseAction(c.state)}
                          <ArrowUpRight size={13} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ops-mobile-records">
              {rows.map((c) => (
                <Link
                  key={c._id}
                  href={
                    c.state === "RECOVERY"
                      ? `/cases/${c._id}/package`
                      : `/cases/${c._id}`
                  }
                  className="ops-mobile-record"
                >
                  <div>
                    <strong>{c.vendorName}</strong>
                    <CaseStatusBadge state={c.state} showToken={false} />
                  </div>
                  <div>
                    <span>{usd(c.amountAtStakeCents)} at stake</span>
                    <span>
                      {nextCaseAction(c.state)}
                      <ArrowUpRight size={13} />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
            {!rows.length && (
              <div className="ops-no-results">
                <Search size={24} />
                <h2>
                  {query
                    ? "No matching cases"
                    : source === "live"
                      ? "No live cases"
                      : "No cases in this view"}
                </h2>
                <button
                  type="button"
                  className="ops-button"
                  onClick={() => {
                    setQueryInput("");
                    update({ query: "", filter: "all", source: "all" });
                  }}
                >
                  Reset filters
                </button>
                {source === "live" && (
                  <Link
                    className="ops-button ops-button-primary"
                    href="/mailbox"
                  >
                    Create verification
                  </Link>
                )}
              </div>
            )}
            <footer className="ops-table-footer">
              <span>
                {rows.length} of {scoped.length} cases
              </span>
              <span>
                {demoIds.size > 0 && source !== "live"
                  ? "Demo records included"
                  : "Live records"}
              </span>
            </footer>
          </>
        )}
      </section>
      <div className="ops-bottom-grid">
        <section className="ops-pipeline">
          <h2>Verification pipeline</h2>
          <div>
            {[
              {
                label: "Needs review",
                count: attention.length,
                filter: "attention" as QueueFilter,
              },
              {
                label: "In progress",
                count: scoped.filter((c) =>
                  matchesQueueFilter(c.state, "progress"),
                ).length,
                filter: "progress" as QueueFilter,
              },
              {
                label: "Ready to pay",
                count: scoped.filter((c) => c.state === "VERIFIED").length,
                filter: "ready" as QueueFilter,
              },
              {
                label: "Closed",
                count: closed.length,
                filter: "closed" as QueueFilter,
              },
            ].map(({ label, count, filter: target }) => (
              <button
                key={label}
                type="button"
                onClick={() => setFilter(target)}
              >
                <span>{label}</span>
                <strong>{count}</strong>
              </button>
            ))}
          </div>
        </section>
        <section className="ops-quick-actions">
          <h2>Workspace</h2>
          <Link href="/vendors">
            <Building2 size={15} />
            Vendor directory
            <ArrowRight size={14} />
          </Link>
          <Link href="/payment-run">
            <Banknote size={15} />
            Review payment run
            <ArrowRight size={14} />
          </Link>
          <Link href="/audit">
            <ShieldCheck size={15} />
            Audit log
            <ArrowRight size={14} />
          </Link>
        </section>
      </div>
    </div>
  );
}
