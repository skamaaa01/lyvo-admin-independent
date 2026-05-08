import { useEffect, useState } from "react"
import axios from "../../../axiosConfig"
import { boCustomersURL } from "../../../routes/Url"

export default function TabAudit({ customerId }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    axios.get(`${boCustomersURL}/${customerId}/audit`, { _silentToast: true })
      .then(({ data }) => { if (alive) { setItems(data.items); setLoading(false) } })
      .catch(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [customerId])

  if (loading) return <div className="text-xs text-gray-400">Loading…</div>
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr><th className="text-left px-4 py-2">When</th><th className="text-left px-4 py-2">Agent</th><th className="text-left px-4 py-2">Action</th><th className="text-left px-4 py-2">IP</th></tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {items.map(i => (
            <tr key={i._id}>
              <td className="px-4 py-2 text-gray-500 whitespace-nowrap text-xs">{new Date(i.timestamp).toLocaleString()}</td>
              <td className="px-4 py-2 text-gray-700 text-xs">{i.user_email || "—"}</td>
              <td className="px-4 py-2 font-medium text-gray-900 text-xs">{i.action}</td>
              <td className="px-4 py-2 text-gray-400 text-xs">{i.ip_address || "—"}</td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan="4" className="px-4 py-6 text-center text-gray-400 text-sm">No actions logged yet.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
