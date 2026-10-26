"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Search,
  X,
  Plus,
  Building2,
  CircleCheck,
  Minus,
} from "lucide-react";
import { Loading } from "@/components/landed/primitives";
import { useVendors } from "@/lib/hooks";
import { absDate } from "@/lib/format";

export default function VendorsPage() {
  const vendors = useVendors();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const needle = query.trim().toLowerCase();
  const rows = (vendors ?? []).filter(
    (v) =>
      (!needle || `${v.name} ${v.domain}`.toLowerCase().includes(needle)) &&
      (filter === "all" ||
        (filter === "open"
          ? v.openCases > 0
          : v.verifiedCount < v.accountCount)),
  );
  return (
    <div className="ops-dashboard">
      <header className="ops-page-heading">
        <h1>Vendors</h1>
        <Link href="/vendors/new" className="ops-button ops-button-primary">
          <Plus size={15} />
          Add vendor
        </Link>
      </header>
      <section className="ops-queue" aria-label="Vendor directory">
        <div className="ops-toolbar">
          <div className="ops-search-field">
            <Search size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search vendor name or domain"
              aria-label="Search vendors"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear vendor search"
                onClick={() => setQuery("")}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="ops-toolbar-selects">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter vendors"
            >
              <option value="all">All vendors</option>
              <option value="open">With open cases</option>
              <option value="unverified">Not every account version verified</option>
            </select>
          </div>
        </div>
        {vendors === undefined ? (
          <div className="ops-queue-loading">
            <Loading />
          </div>
        ) : (
          <>
            <div className="ops-table-scroll ops-desktop-records">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th title="Verified account versions over all versions on file, including superseded ones">
                      Verified / all versions
                    </th>
                    <th>Open cases</th>
                    <th className="ops-hide-small">Portal access</th>
                    <th className="ops-hide-medium">Onboarded</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((v) => (
                    <tr key={v._id}>
                      <td>
                        <Link
                          href={`/vendors/${v._id}`}
                          className="ops-vendor-link"
                        >
                          <span className="ops-vendor-avatar">
                            <Building2 size={16} />
                          </span>
                          <span>
                            <strong>{v.name}</strong>
                            <span className="ops-record-meta">{v.domain}</span>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <span className="ops-verified-count">
                          <CircleCheck size={13} />
                          {v.verifiedCount} / {v.accountCount}
                        </span>
                      </td>
                      <td>
                        {v.openCases > 0 ? (
                          <Link
                            href={`/vendors/${v._id}`}
                            className="ops-case-count"
                          >
                            {v.openCases} open
                          </Link>
                        ) : (
                          <Minus size={12} />
                        )}
                      </td>
                      <td className="ops-hide-small">
                        {v.hasPortalLogin ? "Enabled" : "Not enabled"}
                      </td>
                      <td className="ops-hide-medium ops-date">
                        {absDate(v.onboardedAt)}
                      </td>
                      <td>
                        <Link
                          className="ops-row-action"
                          href={`/vendors/${v._id}`}
                        >
                          View vendor
                          <ArrowUpRight size={13} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ops-mobile-records">
              {rows.map((v) => (
                <Link
                  key={v._id}
                  href={`/vendors/${v._id}`}
                  className="ops-mobile-record"
                >
                  <div>
                    <strong>{v.name}</strong>
                    <ArrowUpRight size={14} />
                  </div>
                  <div>
                    <span>
                      {v.verifiedCount} / {v.accountCount} account versions verified
                    </span>
                    <span>{v.openCases} open cases</span>
                  </div>
                </Link>
              ))}
            </div>
            {!rows.length && (
              <div className="ops-no-results">
                <Search size={24} />
                <h2>No matching vendors</h2>
                <button
                  type="button"
                  className="ops-button"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  Reset filters
                </button>
              </div>
            )}
            <footer className="ops-table-footer">
              <span>
                {rows.length} of {vendors.length} vendors
              </span>
              <span>
                {vendors.reduce((n, v) => n + v.openCases, 0)} open cases
              </span>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
