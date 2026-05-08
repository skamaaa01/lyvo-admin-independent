import axios from "../../../axiosConfig"
import { boCustomersURL } from "../../../routes/Url"

const STATUS_DOT = (status, lastSeen) => {
  const minutesAgo = lastSeen ? (Date.now() - new Date(lastSeen).getTime()) / 60_000 : Infinity
  if (status === "active" && minutesAgo < 5) return "bg-emerald-500"
  if (minutesAgo < 60) return "bg-amber-500"
  return "bg-red-500"
}

export default function TabHardware({ data, customerId, role, onChange }) {
  const canAct = ["admin", "support"].includes(role)
  const action = async (gwId, act) => {
    if (!confirm(`${act} this gateway?`)) return
    try {
      await axios.post(`${boCustomersURL}/${customerId}/gateways/${gwId}`, { action: act })
      onChange()
    } catch (e) { alert(e.response?.data?.message || "Failed") }
  }

  return (
    <div className="space-y-6">
      <Card title={`Gateways (${data.gateways.length})`}>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-gray-400">
            <tr>
              <th className="text-left py-1.5">MAC</th><th className="text-left">Status</th>
              <th className="text-left">Firmware</th><th className="text-left">Last seen</th>
              {canAct && <th />}
            </tr>
          </thead>
          <tbody>
            {data.gateways.map(g => (
              <tr key={g._id} className="border-t border-gray-50">
                <td className="py-2 font-mono text-xs">{g.mac}</td>
                <td className="py-2"><span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${STATUS_DOT(g.status, g.last_seen)}`} />{g.status}</td>
                <td className="py-2 text-gray-500 text-xs">{g.firmware || "—"}</td>
                <td className="py-2 text-gray-500 text-xs">{g.last_seen ? new Date(g.last_seen).toLocaleString() : "Never"}</td>
                {canAct && (
                  <td className="py-2 text-xs space-x-2">
                    <button onClick={() => action(g._id, "restart")} className="text-blue-600 hover:underline">Restart</button>
                    <button onClick={() => action(g._id, "resync")} className="text-blue-600 hover:underline">Resync</button>
                    <button onClick={() => action(g._id, "unassign")} className="text-red-600 hover:underline">Unassign</button>
                  </td>
                )}
              </tr>
            ))}
            {data.gateways.length === 0 && <tr><td colSpan="5" className="py-6 text-center text-gray-400 text-sm">No gateways.</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card title={`Sensors (${data.sensors.length})`}>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-gray-400">
            <tr>
              <th className="text-left py-1.5">MAC</th><th className="text-left">Appliance</th>
              <th className="text-left">Status</th><th className="text-left">Battery</th>
              <th className="text-left">RSSI</th><th className="text-left">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {data.sensors.map(s => (
              <tr key={s._id} className="border-t border-gray-50">
                <td className="py-2 font-mono text-xs">{s.mac}</td>
                <td className="py-2 text-gray-500 text-xs">{s.appliance_id ? String(s.appliance_id).slice(-6) : "—"}</td>
                <td className="py-2"><span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${STATUS_DOT(s.status, s.last_seen)}`} />{s.status}</td>
                <td className="py-2 text-xs">{s.battery_level != null ? `${s.battery_level}%` : "—"}</td>
                <td className="py-2 text-xs">{s.signal_strength != null ? `${s.signal_strength} dBm` : "—"}</td>
                <td className="py-2 text-gray-500 text-xs">{s.last_seen ? new Date(s.last_seen).toLocaleString() : "Never"}</td>
              </tr>
            ))}
            {data.sensors.length === 0 && <tr><td colSpan="6" className="py-6 text-center text-gray-400 text-sm">No sensors.</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card title={`Appliances (${data.appliances.length})`}>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-gray-400">
            <tr>
              <th className="text-left py-1.5">Name</th><th className="text-left">Type</th>
              <th className="text-left">Sampling/day</th><th className="text-left">Range</th>
              <th className="text-left">Mode</th>
            </tr>
          </thead>
          <tbody>
            {data.appliances.map(a => (
              <tr key={a._id} className="border-t border-gray-50">
                <td className="py-2 text-gray-900">{a.name}</td>
                <td className="py-2 text-gray-500 text-xs">{a.type}</td>
                <td className="py-2 text-xs">{a.recording_count_per_day || 1}×</td>
                <td className="py-2 text-xs">{a.temp_min != null && a.temp_max != null ? `${a.temp_min}…${a.temp_max} °C` : "—"}</td>
                <td className="py-2 text-xs capitalize">{a.monitoring_mode}</td>
              </tr>
            ))}
            {data.appliances.length === 0 && <tr><td colSpan="5" className="py-6 text-center text-gray-400 text-sm">No appliances.</td></tr>}
          </tbody>
        </table>
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
