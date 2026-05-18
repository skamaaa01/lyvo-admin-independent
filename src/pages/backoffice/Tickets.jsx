/**
 * Back-office cross-tenant ticket list + dashboard.
 * ─────────────────────────────────────────────────────────────────────────
 * Top: 6 metric cards (total / open / in-progress / solved / urgent open /
 * avg response time) — read from /api/admin/tickets/dashboard.
 *
 * Below: filterable table of every ticket across all tenants. Click a row
 * to open `/back-office/tickets/:id` (detail view).
 *
 * Reply / assign / status changes happen on the detail page. This list is
 * triage-focused — get the user to the ticket they care about quickly.
 */
import { useEffect, useState, useMemo } from "react"
import { NavLink, useSearchParams } from "react-router-dom"
import axios from "../../axiosConfig"
import { boTicketsURL, boTicketsDashboardURL } from "../../routes/Url"
import { boPath } from "./boPath"
import {
  FiSearch, FiInbox, FiAlertOctagon, FiClock, FiCheckCircle,
  FiActivity, FiTrendingUp, FiPaperclip,
} from "react-icons/fi"

const STATUSES   = ["open", "in_progress", "solved", "closed"]
const PRIORITIES = ["low", "normal", "urgent"]
const CATEGORIES = ["app_issue", "temperature_logs", "device_issue", "account_billing", "feature_request", "other"]

const STATUS_STYLE = {
  open:        "bg-blue-100 text-blue-800",
  in_progress: "bg-amber-100 text-amber-800",
  solved:      "bg-green-100 text-green-800",
  closed:      "bg-gray-200 text-gray-700",
}
const PRIORITY_STYLE = {
  low:    "text-gray-400",
  normal: "text-gray-600",
  urgent: "text-red-600 font-bold",
}

export default function Tickets({ user }) {
  const canAct = user?.role === "admin" || user?.role === "support"

  const [params, setParams] = useSearchParams()
  const status   = params.get("status")   || ""
  const priority = params.get("priority") || ""
  const category = params.get("category") || ""
  const q        = params.get("q")        || ""
  const page     = parseInt(params.get("page"), 10) || 1
  const unassignedOnly = params.get("unassigned") === "1"

  const [searchInput, setSearchInput] = useState(q)
  const [stats, setStats]   = useState(null)
  const [items, setItems]   = useState([])
  const [total, setTotal]   = useState(0)
  const [loading, setLoading] = useState(true)

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value); else next.delete(key)
    next.delete("page")
    setParams(next, { replace: true })
  }

  // Debounce search → URL
  useEffect(() => {
    const tm = setTimeout(() => { if (searchInput !== q) setFilter("q", searchInput.trim()) }, 400)
    return () => clearTimeout(tm)
  }, [searchInput]) // eslint-disable-line react-hooks/exhaustive-deps

  // Dashboard widgets — loaded once and on filter changes (cheap aggregation)
  useEffect(() => {
    axios.get(boTicketsDashboardURL, { _silentToast: true })
      .then(({ data }) => setStats(data))
      .catch(() => setStats(null))
  }, [])

  // List
  useEffect(() => {
    setLoading(true)
    const query = {}
    if (status)   query.status   = status
    if (priority) query.priority = priority
    if (category) query.category = category
    if (q)        query.q        = q
    if (unassignedOnly) query.unassigned = "1"
    if (page > 1) query.page = page
    axios.get(boTicketsURL, { params: query, _silentToast: true })
      .then(({ data }) => { setItems(data.items || []); setTotal(data.total || 0) })
      .catch(() => { setItems([]); setTotal(0) })
      .finally(() => setLoading(false))
  }, [status, priority, category, q, page, unassignedOnly])

  const fmtMs = (ms) => {
    if (!ms || ms < 0) return "—"
    const min = Math.round(ms / 60_000)
    if (min < 60)  return `${min}m`
    const h = Math.round(min / 60)
    if (h < 48)    return `${h}h`
    return `${Math.round(h / 24)}d`
  }
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Support Tickets</h1>
          <p className="text-xs text-gray-400 mt-1">Tickets from every customer tenant, sorted urgent first.</p>
        </div>
      </div>

      {/* Dashboard widgets */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total"        value={stats?.total ?? "—"}                  icon={FiInbox}        color="text-gray-600" />
        <StatCard label="Open"         value={stats?.open ?? 0}                     icon={FiActivity}     color="text-blue-600"
                  onClick={() => setFilter("status", "open")} active={status === "open"} />
        <StatCard label="In progress"  value={stats?.in_progress ?? 0}              icon={FiClock}        color="text-amber-600"
                  onClick={() => setFilter("status", "in_progress")} active={status === "in_progress"} />
        <StatCard label="Solved"       value={stats?.solved ?? 0}                   icon={FiCheckCircle}  color="text-green-600"
                  onClick={() => setFilter("status", "solved")} active={status === "solved"} />
        <StatCard label="Urgent (open)" value={stats?.urgent_open ?? 0}             icon={FiAlertOctagon} color="text-red-600"
                  onClick={() => { setFilter("priority", "urgent"); setFilter("status", "open") }} />
        <StatCard label="Avg response" value={fmtMs(stats?.avg_response_ms)}        icon={FiTrendingUp}   color="text-indigo-600" />
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-gray-100 rounded-2xl p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search by title, description, or ticket ID…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
          />
        </div>
        <select value={status} onChange={e => setFilter("status", e.target.value)}
          className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg">
          <option value="">Any status</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
        <select value={priority} onChange={e => setFilter("priority", e.target.value)}
          className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg">
          <option value="">Any priority</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={category} onChange={e => setFilter("category", e.target.value)}
          className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg">
          <option value="">Any category</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
        </select>
        <label className="inline-flex items-center gap-1.5 px-2 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={unassignedOnly}
            onChange={e => setFilter("unassigned", e.target.checked ? "1" : "")}
            className="accent-orange-500" />
          Unassigned only
        </label>
      </div>

      {/* List */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400 text-sm">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center">
            <FiInbox size={32} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No tickets match these filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-4 py-3">ID</th>
                  <th className="text-left px-4 py-3">Title</th>
                  <th className="text-left px-4 py-3">Account</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Priority</th>
                  <th className="text-left px-4 py-3">Assignee</th>
                  <th className="text-left px-4 py-3">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map(it => (
                  <tr key={it._id} className="hover:bg-orange-50/30 transition-colors">
                    <td className="px-4 py-3">
                      <NavLink to={boPath(`/tickets/${it._id}`)}
                        className="text-orange-600 hover:text-orange-700 font-mono text-xs font-bold">
                        {it.ticket_id}
                      </NavLink>
                    </td>
                    <td className="px-4 py-3 max-w-[300px]">
                      <NavLink to={boPath(`/tickets/${it._id}`)}
                        className="text-gray-800 hover:text-orange-600 font-medium truncate block">
                        {it.title}
                      </NavLink>
                      {it.attachment_count > 0 && (
                        <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] text-gray-400">
                          <FiPaperclip size={10} /> {it.attachment_count}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      <div className="font-semibold">{it.account?.username || "—"}</div>
                      <div className="text-gray-400">{it.account?.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 text-[11px] font-semibold rounded-full ${STATUS_STYLE[it.status] || ""}`}>
                        {it.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-xs ${PRIORITY_STYLE[it.priority] || ""}`}>{it.priority}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {it.assignee ? (it.assignee.name || it.assignee.email) : <span className="text-gray-300">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(it.last_message_at || it.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > items.length && (
        <div className="flex items-center justify-end gap-2 text-xs text-gray-500">
          <button disabled={page <= 1}
            onClick={() => setFilter("page", String(Math.max(1, page - 1)))}
            className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg disabled:opacity-40 hover:border-gray-300">← Prev</button>
          <span className="px-2">Page {page} of {Math.ceil(total / 50) || 1}</span>
          <button disabled={items.length < 50}
            onClick={() => setFilter("page", String(page + 1))}
            className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg disabled:opacity-40 hover:border-gray-300">Next →</button>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, icon: Icon, color, onClick, active }) {
  const Wrapper = onClick ? "button" : "div"
  return (
    <Wrapper
      onClick={onClick}
      className={`text-left bg-white border ${active ? "border-orange-300 ring-2 ring-orange-100" : "border-gray-100"} rounded-2xl p-3.5 flex flex-col gap-1 ${onClick ? "hover:border-gray-300 cursor-pointer" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">{label}</span>
        {Icon && <Icon size={14} className={color} />}
      </div>
      <div className="text-xl font-bold text-gray-800">{value}</div>
    </Wrapper>
  )
}
