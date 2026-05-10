import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import axios from "../../../axiosConfig"
import { boCustomersURL } from "../../../routes/Url"

// Note: `all_users` is admin/readonly only on the backend, so we conditionally
// include it in the filter list based on the signed-in role.
const QUICK_FILTERS_BASE = [
  { key: "", label: "Customers" },
  { key: "trial", label: "Trial users" },
  { key: "trial_recent", label: "Trial (last 7d)" },
  { key: "past_due", label: "Past due" },
  { key: "cancelled_30", label: "Cancelled (30d)" },
  { key: "renewal_14", label: "Renewing in 14d" },
  { key: "no_recent_login", label: "No login 14d+" },
]

const STATUS_BADGE = {
  trial: "bg-amber-50 text-amber-700",
  active: "bg-emerald-50 text-emerald-700",
  past_due: "bg-red-50 text-red-700",
  cancelled: "bg-gray-100 text-gray-600",
  expired: "bg-gray-100 text-gray-500",
  suspended: "bg-purple-50 text-purple-700",
}

const ROLE_BADGE = {
  admin: "bg-orange-50 text-orange-700",
  manager: "bg-blue-50 text-blue-700",
  staff: "bg-gray-100 text-gray-600",
}

// Matches the backend default. Smaller page = faster first paint; users
// click "Load more" if they want the rest.
const PAGE_SIZE = 50

export default function CustomerSearch({ user }) {
  const navigate = useNavigate()
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState("")
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState("")

  // The all_users view is gated server-side too, but only show the chip to
  // roles who can actually use it.
  const canSeeAllUsers = user?.role === "admin" || user?.role === "readonly"
  const QUICK_FILTERS = canSeeAllUsers
    ? [...QUICK_FILTERS_BASE, { key: "all_users", label: "All users (incl. members)" }]
    : QUICK_FILTERS_BASE

  // Initial / refresh fetch — resets pagination back to offset 0 whenever
  // the search query or filter changes.
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError("")
    const params = new URLSearchParams()
    if (q.trim()) params.set("q", q.trim())
    if (filter) params.set("filter", filter)
    params.set("limit", String(PAGE_SIZE))
    params.set("offset", "0")
    const t = setTimeout(() => {
      axios.get(`${boCustomersURL}?${params}`, { _silentToast: true })
        .then(({ data }) => {
          if (!alive) return
          setItems(data.items)
          setTotal(data.total ?? data.items.length)
          setLoading(false)
        })
        .catch((err) => { if (alive) { setError(err.response?.data?.message || "Failed"); setLoading(false) } })
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [q, filter])

  // Append the next page on Load more click. Uses items.length as the
  // offset so it works regardless of how many pages are already loaded.
  const loadMore = async () => {
    setLoadingMore(true)
    const params = new URLSearchParams()
    if (q.trim()) params.set("q", q.trim())
    if (filter) params.set("filter", filter)
    params.set("limit", String(PAGE_SIZE))
    params.set("offset", String(items.length))
    try {
      const { data } = await axios.get(`${boCustomersURL}?${params}`, { _silentToast: true })
      setItems(prev => [...prev, ...data.items])
      setTotal(data.total ?? items.length + data.items.length)
    } catch (e) {
      setError(e.response?.data?.message || "Failed to load more")
    } finally {
      setLoadingMore(false)
    }
  }

  const isAllUsersMode = filter === "all_users"
  const hasMore = items.length < total

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Customer Support</h1>
      <p className="text-sm text-gray-500 mb-5">
        Search by email, company, customer ID, gateway/sensor MAC, or Stripe customer ID.
        {canSeeAllUsers && " Switch to “All users” to see every account in the system, including managers and staff."}
      </p>

      <div className="flex flex-col gap-3 mb-5">
        <input
          autoFocus
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-400"
        />
        <div className="flex flex-wrap gap-2">
          {QUICK_FILTERS.map(qf => (
            <button
              key={qf.key}
              onClick={() => setFilter(qf.key)}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                filter === qf.key
                  ? "bg-orange-500 border-orange-500 text-white"
                  : "bg-white border-gray-200 text-gray-600 hover:border-orange-300"
              }`}
            >
              {qf.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="text-red-600 text-sm mb-3">{error}</div>}

      {/* Result count — sets expectations when there are more matches than
          the current page can display. "X of Y" makes silent truncation
          impossible. */}
      {!loading && (
        <div className="text-xs text-gray-500 mb-2">
          {total === 0
            ? "No results."
            : items.length < total
              ? `Showing ${items.length.toLocaleString()} of ${total.toLocaleString()} results`
              : `${total.toLocaleString()} result${total === 1 ? "" : "s"}`
          }
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="text-left px-4 py-2.5">Email</th>
              <th className="text-left px-4 py-2.5">Name</th>
              {isAllUsersMode && <th className="text-left px-4 py-2.5">Account role</th>}
              <th className="text-left px-4 py-2.5">{isAllUsersMode ? "Customer / Plan" : "Plan"}</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">Tags</th>
              <th className="text-left px-4 py-2.5">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {items.map(c => {
              // For sub-users, click navigates to the parent tenant's detail
              // page (we manage data per-tenant). For tenant admins, clicks
              // go to their own detail.
              const targetId = c.parentCustomerId || c._id
              const isMember = c.kind === "member"
              return (
                <tr
                  key={c.userId || c._id}
                  onClick={() => navigate(targetId)}
                  className={`hover:bg-orange-50/30 cursor-pointer ${isMember ? "bg-blue-50/20" : ""}`}
                >
                  <td className="px-4 py-2.5 font-medium text-gray-900">
                    {c.email || "—"}
                    {isMember && (
                      <div className="text-[10px] text-gray-500 mt-0.5">
                        member of <span className="font-medium text-gray-700">{c.parentCustomerEmail}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">{c.name || "—"}</td>
                  {isAllUsersMode && (
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${ROLE_BADGE[c.userRole] || "bg-gray-100 text-gray-600"}`}>
                        {c.userRole}
                      </span>
                    </td>
                  )}
                  <td className="px-4 py-2.5 text-gray-700">
                    {isMember ? <span className="text-gray-400 italic">— (parent)</span> : c.plan}
                  </td>
                  <td className="px-4 py-2.5">
                    {isMember ? (
                      <span className="text-gray-400 text-xs">—</span>
                    ) : (
                      <>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[c.status] || "bg-gray-100 text-gray-600"}`}>
                          {c.status}
                        </span>
                        {c.suspended && <span className="ml-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700">SUSPENDED</span>}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {(c.tags || []).slice(0, 3).map(t => (
                        <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-blue-700">{t}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}</td>
                </tr>
              )
            })}
            {!loading && items.length === 0 && (
              <tr><td colSpan={isAllUsersMode ? 7 : 6} className="px-4 py-10 text-center text-gray-400 text-sm">No results.</td></tr>
            )}
            {loading && (
              <tr><td colSpan={isAllUsersMode ? 7 : 6} className="px-4 py-10 text-center text-gray-400 text-sm">Searching…</td></tr>
            )}
          </tbody>
        </table>
        {hasMore && (
          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between">
            <span className="text-xs text-gray-500">
              {items.length.toLocaleString()} of {total.toLocaleString()} loaded
            </span>
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="px-4 py-1.5 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : `Load next ${Math.min(PAGE_SIZE, total - items.length)}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
