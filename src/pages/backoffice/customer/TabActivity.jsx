export default function TabActivity({ data }) {
  const score = data?.engagementScore ?? 0
  const scoreColor =
    score >= 70 ? "text-emerald-600" :
    score >= 40 ? "text-amber-600"   :
                  "text-red-600"
  const scoreBar =
    score >= 70 ? "bg-emerald-500" :
    score >= 40 ? "bg-amber-500"   :
                  "bg-red-500"

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Engagement score — KPI card */}
      <Card title="Engagement score">
        <div className="flex items-baseline gap-2">
          <span className={`text-4xl font-extrabold ${scoreColor}`}>{score}</span>
          <span className="text-gray-400 text-sm">/ 100</span>
        </div>
        <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full ${scoreBar} transition-all`} style={{ width: `${score}%` }} />
        </div>
        {data.atRisk && (
          <p className="mt-3 text-xs text-red-600 font-medium">⚠ At-risk — low engagement or no recent login</p>
        )}
        <p className="mt-2 text-[11px] text-gray-400 leading-relaxed">
          Composite of reading cadence, active members, alert acknowledgement, and recent activity.
        </p>
      </Card>

      {/* Last 7 days */}
      <Card title="Last 7 days">
        <Stat label="Readings recorded" value={fmtN(data.readings7)} />
        <Stat label="Active members" value={fmtN(data.activeMembers7)} />
        <Stat label="Days since last login" value={data.daysSinceLastLogin == null ? "—" : `${data.daysSinceLastLogin}d`} />
      </Card>

      {/* Last 30 days */}
      <Card title="Last 30 days">
        <Stat label="Readings recorded" value={fmtN(data.readings30)} />
        <Stat label="Alerts triggered" value={fmtN(data.alerts30)} />
        <Stat label="Alerts acknowledged" value={fmtN(data.alertsAcked30)} />
        <Stat label="Acknowledgement rate" value={data.ackRate == null ? "—" : `${data.ackRate}%`} />
        <Stat label="Active members" value={fmtN(data.activeMembers30)} />
        <Stat label="Support notes" value={fmtN(data.notes30)} />
      </Card>

      {/* Latest reading */}
      <Card title="Latest temperature reading" wide>
        {data.latestReading ? (
          <div className="text-sm text-gray-700">
            <span className="font-bold text-gray-900">
              {data.latestReading.value ?? data.latestReading.temperature ?? "—"}°C
            </span>
            <span className="ml-2 text-gray-500">
              {new Date(data.latestReading.recorded_at || data.latestReading.createdAt).toLocaleString()}
            </span>
          </div>
        ) : (
          <p className="text-sm text-gray-400">No readings recorded yet.</p>
        )}
      </Card>

      {/* Members — last login per user */}
      <Card title="Members – last login" wide>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-gray-400">
            <tr>
              <th className="text-left py-1.5">Email</th>
              <th className="text-left">Role</th>
              <th className="text-left">Last login</th>
            </tr>
          </thead>
          <tbody>
            {(data.memberLastLogins || []).map(m => (
              <tr key={m.email} className="border-t border-gray-50">
                <td className="py-2 text-gray-700">{m.email || "—"}</td>
                <td className="py-2 text-gray-500 text-xs capitalize">{m.role}</td>
                <td className="py-2 text-gray-500 text-xs">{m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString() : "—"}</td>
              </tr>
            ))}
            {(data.memberLastLogins || []).length === 0 && (
              <tr><td colSpan="3" className="py-4 text-center text-gray-400 text-xs">No members.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <p className="text-xs text-gray-400 lg:col-span-3">
        Pageview / time-on-app metrics need a separate event-ingest pipeline and will populate once that's wired.
        Everything above is computed live from data the platform already collects.
      </p>
    </div>
  )
}

function fmtN(n) {
  if (n == null) return "—"
  return Number(n).toLocaleString()
}

function Card({ title, children, wide }) {
  return (
    <div className={`bg-white rounded-xl border border-gray-100 p-5 ${wide ? "lg:col-span-3" : ""}`}>
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      {children}
    </div>
  )
}
function Stat({ label, value }) {
  return (
    <div className="flex items-baseline justify-between py-1.5 text-sm border-b border-gray-50 last:border-b-0">
      <span className="text-gray-500">{label}</span>
      <span className="font-semibold text-gray-900">{value}</span>
    </div>
  )
}
