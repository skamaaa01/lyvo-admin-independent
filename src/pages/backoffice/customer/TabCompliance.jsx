import { useParams } from "react-router-dom"
import { boCustomersURL } from "../../../routes/Url"

export default function TabCompliance({ data }) {
  const { id } = useParams()
  if (!data) return <div className="text-sm text-gray-400">No data.</div>
  const indicator =
    data.score == null ? "—" :
    data.score >= 90 ? "EHO-ready" :
    data.score >= 70 ? "Needs attention" : "Critical gaps"

  const reportUrl = (() => {
    const to = new Date()
    const from = new Date(Date.now() - 30 * 86400_000)
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() })
    return `${boCustomersURL}/${id}/compliance-report?${params}`
  })()

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-100 p-5 flex flex-wrap gap-8 items-center justify-between">
        <div className="flex flex-wrap gap-8 items-center">
          <div>
            <div className="text-xs uppercase text-gray-400">Compliance score (30d)</div>
            <div className="text-3xl font-bold text-gray-900">{data.score == null ? "—" : `${data.score}%`}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-gray-400">Status</div>
            <div className="text-sm font-semibold text-gray-700">{indicator}</div>
          </div>
        </div>
        <a href={reportUrl} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-700">Generate compliance report</a>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Per-appliance compliance</h3>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-gray-400">
            <tr><th className="text-left py-1.5">Appliance</th><th className="text-left">Type</th><th className="text-left">Expected</th><th className="text-left">Actual</th><th className="text-left">%</th></tr>
          </thead>
          <tbody>
            {(data.perAppliance || []).map(a => (
              <tr key={a._id} className="border-t border-gray-50">
                <td className="py-2 text-gray-900">{a.name}</td>
                <td className="py-2 text-gray-500 text-xs">{a.type}</td>
                <td className="py-2 text-xs">{a.expected}</td>
                <td className="py-2 text-xs">{a.actual}</td>
                <td className={`py-2 text-xs font-semibold ${a.pct >= 90 ? "text-emerald-600" : a.pct >= 70 ? "text-amber-600" : "text-red-600"}`}>{a.pct == null ? "—" : `${a.pct}%`}</td>
              </tr>
            ))}
            {(data.perAppliance || []).length === 0 && <tr><td colSpan="5" className="py-6 text-center text-gray-400 text-sm">No appliances configured.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
