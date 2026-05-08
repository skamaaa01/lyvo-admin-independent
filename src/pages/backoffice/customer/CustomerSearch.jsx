import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import axios from "../../../axiosConfig"
import { boCustomersURL } from "../../../routes/Url"

const QUICK_FILTERS = [
  { key: "", label: "All" },
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

export default function CustomerSearch() {
  const navigate = useNavigate()
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState("")
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let alive = true
    setLoading(true)
    const params = new URLSearchParams()
    if (q.trim()) params.set("q", q.trim())
    if (filter) params.set("filter", filter)
    const t = setTimeout(() => {
      axios.get(`${boCustomersURL}?${params}`, { _silentToast: true })
        .then(({ data }) => { if (alive) { setItems(data.items); setLoading(false) } })
        .catch((err) => { if (alive) { setError(err.response?.data?.message || "Failed"); setLoading(false) } })
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [q, filter])

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Customer Support</h1>
      <p className="text-sm text-gray-500 mb-5">Search by email, company, customer ID, gateway/sensor MAC, or Stripe customer ID.</p>

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

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="text-left px-4 py-2.5">Email</th>
              <th className="text-left px-4 py-2.5">Name</th>
              <th className="text-left px-4 py-2.5">Plan</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">Tags</th>
              <th className="text-left px-4 py-2.5">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {items.map(c => (
              <tr key={c._id} onClick={() => navigate(c._id)} className="hover:bg-orange-50/30 cursor-pointer">
                <td className="px-4 py-2.5 font-medium text-gray-900">{c.email || "—"}</td>
                <td className="px-4 py-2.5 text-gray-700">{c.name || "—"}</td>
                <td className="px-4 py-2.5 text-gray-700">{c.plan}</td>
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[c.status] || "bg-gray-100 text-gray-600"}`}>
                    {c.status}
                  </span>
                  {c.suspended && <span className="ml-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700">SUSPENDED</span>}
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
            ))}
            {!loading && items.length === 0 && (
              <tr><td colSpan="6" className="px-4 py-10 text-center text-gray-400 text-sm">No customers match.</td></tr>
            )}
            {loading && (
              <tr><td colSpan="6" className="px-4 py-10 text-center text-gray-400 text-sm">Searching…</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
