export default function TabActivity({ data }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card title="Latest activity">
        <Row label="Last subscription update" value={data.lastSubUpdate ? new Date(data.lastSubUpdate).toLocaleString() : "—"} />
        <Row label="Latest reading" value={data.latestReading ? `${data.latestReading.value ?? data.latestReading.temperature ?? "—"} (${new Date(data.latestReading.recorded_at || data.latestReading.createdAt).toLocaleString()})` : "—"} />
      </Card>
      <Card title="Members – last login">
        <table className="w-full text-sm">
          <tbody>
            {(data.memberLastLogins || []).map(m => (
              <tr key={m.email} className="border-t border-gray-50">
                <td className="py-2 text-gray-700">{m.email || "—"}</td>
                <td className="py-2 text-gray-500 text-xs capitalize">{m.role}</td>
                <td className="py-2 text-gray-500 text-xs">{m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-gray-400 lg:col-span-2">Pageview tracking, time-on-app and engagement scoring will populate once the analytics ingest is wired (Phase 3 dependency).</p>
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
function Row({ label, value }) {
  return (
    <div className="flex py-1.5 text-sm">
      <span className="w-44 text-gray-500">{label}</span>
      <span className="text-gray-900">{value}</span>
    </div>
  )
}
