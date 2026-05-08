export default function TabAlerts({ data }) {
  return (
    <div className="space-y-6">
      <Card title={`Open alerts (${data.open?.length || 0})`}>
        <AlertTable items={data.open || []} />
      </Card>
      <Card title={`Recent alerts (last 30 days, ${data.recent?.length || 0})`}>
        <AlertTable items={data.recent || []} showAck />
      </Card>
    </div>
  )
}

function Card({ title, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      {children}
    </div>
  )
}

function AlertTable({ items, showAck }) {
  if (items.length === 0) return <div className="text-xs text-gray-400">None.</div>
  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase text-gray-400">
        <tr>
          <th className="text-left py-1.5">Date</th><th className="text-left">Type</th>
          <th className="text-left">Message</th>{showAck && <th className="text-left">Acked</th>}
        </tr>
      </thead>
      <tbody>
        {items.map(a => (
          <tr key={a._id} className="border-t border-gray-50">
            <td className="py-2 text-gray-500 text-xs">{new Date(a.createdAt).toLocaleString()}</td>
            <td className="py-2 text-gray-700 text-xs capitalize">{a.type || a.kind || "—"}</td>
            <td className="py-2 text-gray-800 text-xs">{a.message || a.title || "—"}</td>
            {showAck && <td className="py-2 text-gray-500 text-xs">{a.acknowledgedAt ? new Date(a.acknowledgedAt).toLocaleString() : a.status === "resolved" ? "auto-resolved" : "—"}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
