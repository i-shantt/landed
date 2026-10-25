"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
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
} from "lucide-react";
import { CaseStatusBadge } from "@/components/landed/badges";
import { Loading } from "@/components/landed/primitives";
import { useCases, useNow, useSettings } from "@/lib/hooks";
import { usd, absDate, countdown } from "@/lib/format";
import { triggerLabel, stateLabel } from "@/lib/labels";
import {
  isAttention,
  isBlocked,
  isClosed,
  matchesQueueFilter,
  nextCaseAction,
  selectQueue,
  type QueueFilter,
  type QueueSort,
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
  const cases = useCases();
  const now = useNow();
  const settings = useSettings();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [sort, setSort] = useState<QueueSort>("priority");
  const [source, setSource] = useState("all");
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
      "Amount at stake (USD)",
      "Opened",
      "Record type",
    ];
    const values = rows.map((c) => [
      c.vendorName,
      stateLabel(c.state),
      (c.amountAtStakeCents / 100).toFixed(2),
      new Date(c.openedAt).toISOString(),
      demoIds.has(c._id) ? "Demo" : "Live",
    ]);
    const csv = [columns, ...values]
      .map((row) =>
        row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "landed-cases.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="ops-dashboard">
      <header className="ops-page-heading">
        <div>
          <h1>Verification cases</h1>
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
                          c.slaDeadlineAt && (
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
                    setQuery("");
                    setFilter("all");
                    setSource("all");
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
