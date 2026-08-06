import axios from "../../../axiosConfig"
import { boCustomersURL } from "../../../routes/Url"
import { useConfirm } from "../../../components/ConfirmDialog"
import toast from "../../../utils/toast"

const STATUS_DOT = (status, lastSeen) => {
  const minutesAgo = lastSeen ? (Date.now() - new Date(lastSeen).getTime()) / 60_000 : Infinity
  if (status === "active" && minutesAgo < 5) return "bg-emerald-500"
  if (minutesAgo < 60) return "bg-amber-500"
  return "bg-red-500"
}

const ACTION_LABEL = {
  restart: { title: "Restart gateway?", body: "Sends a restart command over MQTT. The gateway will go offline briefly while it reboots.", confirmLabel: "Restart" },
  resync:  { title: "Resync gateway config?", body: "Pushes the latest config to the gateway over MQTT. Existing readings continue uninterrupted.", confirmLabel: "Resync" },
  unassign:{ title: "Unassign gateway from customer?", body: "Hardware stays in inventory; previous owner has a 24-hour re-claim window before anyone else can pair it.", confirmLabel: "Unassign" },
}

// Copy for the device-registration reset. Deliberately spells out the two
// caveats — the counter is keyed by source IP (the API doesn't trust
// X-Forwarded-For, so behind the proxy everyone shares one bucket) and the
// counter lives in memory per API process.
const RESET_ATTEMPTS = {
  title: "Reset device registration attempts?",
  body: "Clears the pairing rate limiter so the customer can register a device again straight away, instead of waiting out the 15-minute window. Affects the device pairing endpoints only — logins, PINs and signups keep their brute-force protection. The limit is counted per source IP and per API process, so this may also clear the counter for other customers behind the same connection.",
  confirmLabel: "Reset attempts",
}

export default function TabHardware({ data, customerId, role, onChange }) {
  const canAct = ["admin", "support"].includes(role)
  const { confirm } = useConfirm()

  const resetAttempts = async () => {
    if (!(await confirm(RESET_ATTEMPTS.body, { title: RESET_ATTEMPTS.title, confirmLabel: RESET_ATTEMPTS.confirmLabel, danger: false }))) return
    try {
      const { data: res } = await axios.post(`${boCustomersURL}/${customerId}/actions/reset-device-attempts`)
      toast.success(
        res.cleared
          ? `Cleared ${res.attempts} attempt${res.attempts === 1 ? "" : "s"} — the customer can pair a device now.`
          : "Nothing to clear — no pairing attempts are currently blocked."
      )
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed")
    }
  }

  const action = async (gwId, act) => {
    const meta = ACTION_LABEL[act] || { title: `${act} this gateway?`, body: "", confirmLabel: act }
    if (!(await confirm(meta.body, { title: meta.title, confirmLabel: meta.confirmLabel }))) return
    try {
      await axios.post(`${boCustomersURL}/${customerId}/gateways/${gwId}`, { action: act })
      toast.success(`Gateway ${act} sent.`)
      onChange()
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed")
    }
  }

  return (
    <div className="space-y-6">
      {canAct && (
        <Card title="Device pairing">
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm text-gray-500 leading-relaxed">
              If the customer sees <span className="font-medium text-gray-700">“Too many device registration attempts”</span> on
              the tablet, reset the counter here instead of waiting 15 minutes.
            </p>
            <button
              onClick={resetAttempts}
              className="flex-shrink-0 px-3 py-1.5 rounded-lg border border-gray-200 text-sm hover:bg-gray-50"
            >
              Reset attempts
            </button>
          </div>
        </Card>
      )}

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
        {(() => {
          // Build lookup maps so the sensors table can show the human-readable
          // appliance name and gateway MAC instead of opaque ObjectIds.
          const applianceById = new Map(data.appliances.map(a => [String(a._id), a]))
          const gatewayById = new Map(data.gateways.map(g => [String(g._id), g]))
          return (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-gray-400">
                <tr>
                  <th className="text-left py-1.5">MAC</th>
                  <th className="text-left">Appliance</th>
                  <th className="text-left">Gateway</th>
                  <th className="text-left">Status</th>
                  <th className="text-left">Battery</th>
                  <th className="text-left">RSSI</th>
                  <th className="text-left">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {data.sensors.map(s => {
                  const appliance = s.appliance_id ? applianceById.get(String(s.appliance_id)) : null
                  const gateway = s.gateway_id ? gatewayById.get(String(s.gateway_id)) : null
                  return (
                    <tr key={s._id} className="border-t border-gray-50">
                      <td className="py-2 font-mono text-xs">{s.mac}</td>
                      <td className="py-2 text-xs">
                        {appliance
                          ? <span className="text-gray-900">{appliance.name} <span className="text-gray-400">({appliance.type})</span></span>
                          : <span className="text-gray-400 italic">unassigned</span>}
                      </td>
                      <td className="py-2 font-mono text-xs">
                        {gateway ? gateway.mac : <span className="text-gray-400 italic font-sans">—</span>}
                      </td>
                      <td className="py-2"><span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${STATUS_DOT(s.status, s.last_seen)}`} />{s.status}</td>
                      <td className="py-2 text-xs">{s.battery_level != null ? `${s.battery_level}%` : "—"}</td>
                      <td className="py-2 text-xs">{s.signal_strength != null ? `${s.signal_strength} dBm` : "—"}</td>
                      <td className="py-2 text-gray-500 text-xs">{s.last_seen ? new Date(s.last_seen).toLocaleString() : "Never"}</td>
                    </tr>
                  )
                })}
                {data.sensors.length === 0 && <tr><td colSpan="7" className="py-6 text-center text-gray-400 text-sm">No sensors.</td></tr>}
              </tbody>
            </table>
          )
        })()}
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
