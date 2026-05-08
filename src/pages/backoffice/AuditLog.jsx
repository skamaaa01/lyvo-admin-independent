import { useEffect, useState } from "react"
import axios from "../../axiosConfig"
import { boAuditLogURL } from "../../routes/Url"

export default function AuditLogPage() {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState({ action: "", target_type: "" })

  useEffect(() => {
    let alive = true
    setLoading(true)
    const params = new URLSearchParams()
    params.set("limit", "100")
    if (filter.action) params.set("action", filter.action)
    if (filter.target_type) params.set("target_type", filter.target_type)
    axios.get(`${boAuditLogURL}?${params}`, { _silentToast: true })
      .then(({ data }) => { if (alive) { setItems(data.items); setTotal(data.total); setLoading(false) } })
      .catch((err) => { if (alive) { setError(err.response?.data?.message || "Failed to load"); setLoading(false) } })
    return () => { alive = false }
  }, [filter])

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Audit log</h1>
      <p className="text-sm text-gray-500 mb-5">{total.toLocaleString()} entries total. Showing latest 100 matching.</p>

      <div className="flex gap-2 mb-4">
        <input
          placeholder="Filter by action…"
          value={filter.action}
          onChange={(e) => setFilter(f => ({ ...f, action: e.target.value }))}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg w-56"
        />
        <input
          placeholder="Filter by target type…"
          value={filter.target_type}
          onChange={(e) => setFilter(f => ({ ...f, target_type: e.target.value }))}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg w-56"
        />
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}
      {loading ? (
        <div className="text-gray-400 text-sm">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">When</th>
                <th className="text-left px-4 py-2">User</th>
                <th className="text-left px-4 py-2">Action</th>
                <th className="text-left px-4 py-2">Target</th>
                <th className="text-left px-4 py-2">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map(item => (
                <tr key={item._id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{new Date(item.timestamp).toLocaleString()}</td>
                  <td className="px-4 py-2 text-gray-700">{item.user_email || "—"}</td>
                  <td className="px-4 py-2 font-medium text-gray-900">{item.action}</td>
                  <td className="px-4 py-2 text-gray-500">{item.target_type ? `${item.target_type}${item.target_id ? `:${item.target_id}` : ""}` : "—"}</td>
                  <td className="px-4 py-2 text-gray-400 text-xs">{item.ip_address || "—"}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan="5" className="px-4 py-8 text-center text-gray-400 text-sm">No entries match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
