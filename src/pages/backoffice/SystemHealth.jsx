import { useEffect, useState } from "react"
import axios from "../../axiosConfig"
import { boSystemHealthURL } from "../../routes/Url"

const fmtBytes = (b) => {
  if (b == null) return "—"
  const u = ["B", "KB", "MB", "GB", "TB"]
  let i = 0
  let n = b
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(1)} ${u[i]}`
}
const fmtSeconds = (s) => {
  if (s == null) return "—"
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const mins = Math.floor((s % 3600) / 60)
  return [days && `${days}d`, hours && `${hours}h`, `${mins}m`].filter(Boolean).join(" ")
}

export default function SystemHealth() {
  const [data, setData] = useState(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let alive = true
    const load = () =>
      axios.get(boSystemHealthURL, { _silentToast: true })
        .then(({ data }) => { if (alive) setData(data) })
        .catch((err) => { if (alive) setError(err.response?.data?.message || "Failed to load") })
    load()
    const t = setInterval(load, 15_000) // poll every 15s
    return () => { alive = false; clearInterval(t) }
  }, [])

  if (error) {
    return <div className="p-8 text-red-600 text-sm">{error}</div>
  }
  if (!data) {
    return <div className="p-8 text-gray-400 text-sm">Loading…</div>
  }

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">System health</h1>

      <Section title="Server">
        <Row label="Uptime" value={fmtSeconds(data.server.uptimeSeconds)} />
        <Row label="Hostname" value={data.server.hostname} />
        <Row label="Node" value={`${data.server.nodeVersion} on ${data.server.platform}`} />
        <Row label="CPU count" value={data.server.cpuCount} />
        <Row label="Load avg (1/5/15m)" value={data.server.loadAverage.map(n => n.toFixed(2)).join(" / ")} />
        <Row label="System memory used" value={`${data.server.memory.systemUsedPct}%`} status={data.server.memory.systemUsedPct > 85 ? "danger" : data.server.memory.systemUsedPct > 70 ? "warn" : "ok"} />
        <Row label="Heap used / total" value={`${fmtBytes(data.server.memory.heapUsedBytes)} / ${fmtBytes(data.server.memory.heapTotalBytes)}`} />
      </Section>

      <Section title="Database">
        <Row label="Connected" value={data.database.connected ? "Yes" : "No"} status={data.database.connected ? "ok" : "danger"} />
        <Row label="Database" value={data.database.name || "—"} />
        <Row label="Host" value={data.database.host || "—"} />
        <Row label="Collections" value={`${data.database.collections.length} listed`} />
      </Section>

      <Section title="External services">
        <Row label="Stripe API key" value={data.external.stripeConfigured ? "Configured" : "Missing"} status={data.external.stripeConfigured ? "ok" : "warn"} />
        <Row label="MQTT broker" value={data.external.mqttConfigured ? "Configured" : "Missing"} status={data.external.mqttConfigured ? "ok" : "warn"} />
        <Row label="Email provider" value={data.external.sendgridConfigured ? "Configured" : "Missing"} status={data.external.sendgridConfigured ? "ok" : "warn"} />
      </Section>

      <p className="text-xs text-gray-400">Polled every 15s. Last update: {new Date(data.timestamp).toLocaleTimeString()}</p>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">{title}</h2>
      <dl className="divide-y divide-gray-50 text-sm">{children}</dl>
    </div>
  )
}

function Row({ label, value, status }) {
  const dot = status === "ok" ? "bg-emerald-500" : status === "warn" ? "bg-amber-500" : status === "danger" ? "bg-red-500" : "bg-transparent"
  return (
    <div className="flex items-center py-2">
      <dt className="w-1/3 text-gray-500">{label}</dt>
      <dd className="flex-1 flex items-center gap-2 text-gray-900">
        {status && <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />}
        <span>{value}</span>
      </dd>
    </div>
  )
}
