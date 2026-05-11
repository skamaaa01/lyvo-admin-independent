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
const fmtMs = (ms) => ms == null ? "—" : ms < 1 ? "<1 ms" : `${ms} ms`

// Walk the health snapshot and produce a list of critical conditions to
// surface in the red banner at the top of the page. Mirrors the spec's
// "Critical alerts (top of page)" list. Each entry is { key, label }.
function computeCriticals(d) {
  const out = []
  if (!d) return out
  // Mongo
  if (!d.database?.connected) out.push({ key: "mongo", label: "MongoDB connection lost" })
  // API error rate >5%
  const er = d.api?.last1h?.errorRate
  if (er != null && er > 5) {
    out.push({ key: "api-errors", label: `API error rate at ${er}% over the last hour` })
  }
  // Disk usage >85%
  const used = d.server?.disk?.usedPct
  if (used != null && used > 85) {
    out.push({ key: "disk", label: `Disk usage at ${used}%` })
  }
  // SSL <7 days
  for (const c of d.ssl || []) {
    if (c.daysLeft != null && c.daysLeft <= 7) {
      out.push({ key: `ssl-${c.host}`, label: `SSL cert for ${c.host} expires in ${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"}` })
    }
    if (c.error) {
      out.push({ key: `ssl-err-${c.host}`, label: `SSL check for ${c.host} failed: ${c.error}` })
    }
  }
  // PM2 process down or restart-looping
  for (const p of d.pm2 || []) {
    if (p.status && p.status !== "online") {
      out.push({ key: `pm2-${p.name}`, label: `Process ${p.name} is ${p.status}` })
    } else if (p.unstableRestarts > 0) {
      out.push({ key: `pm2-flap-${p.name}`, label: `Process ${p.name} is restart-looping (${p.unstableRestarts} unstable restarts)` })
    }
  }
  // Alert engine stale (last cycle > 30 min ago)
  if (d.alertEngine?.lastFinishedAt) {
    const ageMs = Date.now() - new Date(d.alertEngine.lastFinishedAt).getTime()
    if (ageMs > 30 * 60_000) {
      out.push({ key: "alert-engine", label: `Alert engine hasn't run in ${Math.round(ageMs / 60_000)} min` })
    }
  }
  if (d.alertEngine?.lastError) {
    out.push({ key: "alert-engine-err", label: `Alert engine error: ${d.alertEngine.lastError}` })
  }
  return out
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
    const t = setInterval(load, 15_000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  if (error) return <div className="p-8 text-red-600 text-sm">{error}</div>
  if (!data) return <div className="p-8 text-gray-400 text-sm">Loading…</div>

  const criticals = computeCriticals(data)

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">System health</h1>

      {/* Critical alert banners — only render when something is actually wrong. */}
      {criticals.length > 0 && (
        <div className="space-y-2">
          {criticals.map(c => (
            <div key={c.key} className="bg-red-600 text-white rounded-xl px-4 py-3 text-sm font-medium flex items-center gap-3 shadow">
              <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse" />
              <span>{c.label}</span>
            </div>
          ))}
        </div>
      )}

      <Section title="Server">
        <Row label="Uptime" value={fmtSeconds(data.server.uptimeSeconds)} />
        <Row label="Hostname" value={data.server.hostname} />
        <Row label="Node" value={`${data.server.nodeVersion} on ${data.server.platform}`} />
        <Row label="CPU count" value={data.server.cpuCount} />
        <Row label="Load avg (1/5/15m)" value={data.server.loadAverage.map(n => n.toFixed(2)).join(" / ")} />
        <Row label="System memory used" value={`${data.server.memory.systemUsedPct}%`} status={data.server.memory.systemUsedPct > 85 ? "danger" : data.server.memory.systemUsedPct > 70 ? "warn" : "ok"} />
        <Row label="Heap used / total" value={`${fmtBytes(data.server.memory.heapUsedBytes)} / ${fmtBytes(data.server.memory.heapTotalBytes)}`} />
        {data.server.disk ? (
          <Row
            label={`Disk (${data.server.disk.target})`}
            value={`${data.server.disk.usedPct}% — ${fmtBytes(data.server.disk.usedBytes)} of ${fmtBytes(data.server.disk.totalBytes)} (${fmtBytes(data.server.disk.availBytes)} free)`}
            status={data.server.disk.usedPct > 85 ? "danger" : data.server.disk.usedPct > 70 ? "warn" : "ok"}
          />
        ) : (
          <Row label="Disk" value="Unavailable on this Node version" />
        )}
      </Section>

      <Section title="API metrics — last 1 hour">
        <Row label="Active in-flight requests" value={data.api?.inFlight ?? 0} />
        <Row label="Requests / minute (5m avg)" value={data.api?.requestsPerMinute ?? 0} />
        {data.api?.last1h ? (
          <>
            <Row label="Sample size" value={`${data.api.last1h.count.toLocaleString()} requests`} />
            <Row
              label="Latency p50 / p95 / p99"
              value={`${fmtMs(data.api.last1h.p50)} / ${fmtMs(data.api.last1h.p95)} / ${fmtMs(data.api.last1h.p99)}`}
              status={data.api.last1h.p95 > 1000 ? "warn" : "ok"}
            />
            <Row
              label="Error rate"
              value={`${data.api.last1h.errorRate}%`}
              status={data.api.last1h.errorRate > 5 ? "danger" : data.api.last1h.errorRate > 1 ? "warn" : "ok"}
            />
          </>
        ) : (
          <p className="text-xs text-gray-400 py-2">No traffic in the last hour.</p>
        )}
        {data.api?.topErrorEndpoints?.length > 0 && (
          <div className="pt-3 mt-2 border-t border-gray-50">
            <div className="text-xs uppercase text-gray-400 mb-2">Top error endpoints</div>
            <table className="w-full text-xs">
              <tbody>
                {data.api.topErrorEndpoints.map(r => (
                  <tr key={r.route} className="border-t border-gray-50">
                    <td className="py-1 font-mono">{r.route}</td>
                    <td className="py-1 text-right text-red-600 font-semibold">{r.errorRate}% err</td>
                    <td className="py-1 text-right text-gray-400">{r.count}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.api?.slowestEndpoints?.length > 0 && (
          <div className="pt-3 mt-2 border-t border-gray-50">
            <div className="text-xs uppercase text-gray-400 mb-2">Slowest endpoints (p95)</div>
            <table className="w-full text-xs">
              <tbody>
                {data.api.slowestEndpoints.slice(0, 5).map(r => (
                  <tr key={r.route} className="border-t border-gray-50">
                    <td className="py-1 font-mono">{r.route}</td>
                    <td className="py-1 text-right text-gray-700 font-semibold">{fmtMs(r.p95)}</td>
                    <td className="py-1 text-right text-gray-400">{r.count}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Database">
        <Row label="Connected" value={data.database.connected ? "Yes" : "No"} status={data.database.connected ? "ok" : "danger"} />
        <Row label="Database" value={data.database.name || "—"} />
        <Row label="Host" value={data.database.host || "—"} />
        <Row label="Collections" value={`${data.database.collections.length} listed`} />
      </Section>

      <Section title="External services">
        <Row label="Stripe API key" value={data.external.stripeConfigured ? "Configured" : "Missing"} status={data.external.stripeConfigured ? "ok" : "warn"} />
        <Row
          label="Stripe webhook"
          value={
            !data.external.stripeWebhook?.lastReceivedAt
              ? "No events received yet"
              : `Last event: ${new Date(data.external.stripeWebhook.lastReceivedAt).toLocaleString()} · ${data.external.stripeWebhook.totalSuccess}✓ / ${data.external.stripeWebhook.totalFailed}✗`
          }
          status={
            data.external.stripeWebhook?.healthy === false ? "warn"
              : data.external.stripeWebhook?.lastError ? "warn"
              : data.external.stripeWebhook?.lastReceivedAt ? "ok"
              : "warn"
          }
          extra={data.external.stripeWebhook?.lastError ? <span className="text-xs text-red-600 ml-2 truncate" title={data.external.stripeWebhook.lastError}>· {data.external.stripeWebhook.lastError.slice(0, 60)}</span> : null}
        />
        <Row
          label="MQTT broker"
          value={
            !data.external.mqtt?.configured
              ? "Not configured"
              : data.external.mqtt.connected
                ? `Connected → ${data.external.mqtt.brokerUrl}`
                : `Configured but disconnected → ${data.external.mqtt.brokerUrl}`
          }
          status={
            !data.external.mqtt?.configured ? "warn"
              : data.external.mqtt.connected ? "ok" : "danger"
          }
        />
        {data.external.mqtt?.connected && (
          <Row
            label="MQTT message rate"
            value={`${data.external.mqtt.msgsPerSec} msg/s · ${data.external.mqtt.msgsLast1min} in last 1m · ${data.external.mqtt.msgsLast5min} in last 5m`}
            status={data.external.mqtt.msgsLast5min === 0 ? "warn" : "ok"}
          />
        )}
        <Row label="Email provider" value={data.external.sendgridConfigured ? "Configured" : "Missing"} status={data.external.sendgridConfigured ? "ok" : "warn"} />
      </Section>

      <Section title="Hardware fleet">
        <Row
          label="Gateways"
          value={`${data.fleet?.gatewaysOnline ?? 0} online / ${data.fleet?.gatewaysTotal ?? 0} total`}
          status={
            !data.fleet?.gatewaysTotal ? "warn"
              : data.fleet.gatewaysOffline === 0 ? "ok"
              : data.fleet.gatewaysOnline === 0 ? "danger" : "warn"
          }
        />
        <Row
          label="Sensors"
          value={`${data.fleet?.sensorsOnline ?? 0} broadcasting / ${data.fleet?.sensorsTotal ?? 0} assigned`}
          status={
            !data.fleet?.sensorsTotal ? "warn"
              : data.fleet.sensorsOffline === 0 ? "ok"
              : data.fleet.sensorsOnline === 0 ? "danger" : "warn"
          }
        />
      </Section>

      <Section title="Alert engine">
        <Row
          label="Last cycle"
          value={
            data.alertEngine?.lastFinishedAt
              ? `${new Date(data.alertEngine.lastFinishedAt).toLocaleTimeString()} · ${data.alertEngine.lastDurationMs} ms`
              : data.alertEngine?.running ? "Running now…" : "Never run"
          }
          status={
            data.alertEngine?.lastError ? "danger"
              : data.alertEngine?.lastFinishedAt && (Date.now() - new Date(data.alertEngine.lastFinishedAt).getTime()) > 10 * 60_000 ? "warn"
              : data.alertEngine?.lastFinishedAt ? "ok" : "warn"
          }
        />
        <Row label="Alerts fired in last cycle" value={data.alertEngine?.alertsFiredLastCycle ?? 0} />
        <Row label="Alerts auto-resolved in last cycle" value={data.alertEngine?.alertsResolvedLastCycle ?? 0} />
        <Row label="Total runs since boot" value={data.alertEngine?.totalRuns ?? 0} />
        {data.alertEngine?.lastError && (
          <Row label="Last error" value={data.alertEngine.lastError} status="danger" />
        )}
      </Section>

      <Section title="Processes (PM2)">
        {!data.pm2 ? (
          <p className="text-xs text-gray-400 py-2">
            PM2 not detected. Run the API under <code className="px-1 bg-gray-50 rounded">pm2 start server.js</code> to see process inventory here.
          </p>
        ) : data.pm2.length === 0 ? (
          <p className="text-xs text-gray-400 py-2">No PM2 processes registered.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-gray-400">
              <tr>
                <th className="text-left py-1.5">Name</th>
                <th className="text-left">Status</th>
                <th className="text-left">Uptime</th>
                <th className="text-right">Restarts</th>
                <th className="text-right">Memory</th>
                <th className="text-right">CPU</th>
              </tr>
            </thead>
            <tbody>
              {data.pm2.map(p => (
                <tr key={p.name} className="border-t border-gray-50">
                  <td className="py-2 font-mono text-xs">{p.name}</td>
                  <td className="py-2">
                    <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${p.status === "online" ? "bg-emerald-500" : "bg-red-500"}`} />
                    {p.status || "—"}
                  </td>
                  <td className="py-2 text-xs text-gray-500">{p.uptimeMs ? fmtSeconds(Math.round(p.uptimeMs / 1000)) : "—"}</td>
                  <td className={`py-2 text-right text-xs ${p.unstableRestarts > 0 ? "text-red-600 font-semibold" : "text-gray-500"}`}>
                    {p.restarts}{p.unstableRestarts > 0 ? ` (${p.unstableRestarts} unstable)` : ""}
                  </td>
                  <td className="py-2 text-right text-xs">{fmtBytes(p.memoryBytes)}</td>
                  <td className="py-2 text-right text-xs">{p.cpuPct != null ? `${p.cpuPct}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="SSL certificates">
        {(data.ssl || []).length === 0 ? (
          <p className="text-xs text-gray-400 py-2">
            Set the <code className="px-1 bg-gray-50 rounded">SSL_CHECK_HOSTS</code> env var (comma-separated) to monitor cert expiry.
          </p>
        ) : (
          data.ssl.map(c => (
            <Row
              key={c.host}
              label={c.host}
              value={
                c.error
                  ? `Unreachable (${c.error})`
                  : c.daysLeft != null
                    ? `${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"} left · expires ${new Date(c.validTo).toLocaleDateString()}${c.issuer ? ` · ${c.issuer}` : ""}`
                    : "—"
              }
              status={
                c.error ? "danger"
                  : c.daysLeft == null ? "warn"
                  : c.daysLeft <= 7 ? "danger"
                  : c.daysLeft <= 30 ? "warn"
                  : "ok"
              }
            />
          ))
        )}
      </Section>

      <Section title="Scheduled tasks (cron)">
        {(data.crons || []).length === 0 ? (
          <p className="text-xs text-gray-400 py-2">
            No cron data — `node job.js` may not be running. Crons are owned by a separate process.
          </p>
        ) : (
          data.crons.map(c => (
            <Row
              key={c.name}
              label={c.name}
              value={
                c.running
                  ? "Running now…"
                  : c.lastSuccessAt
                    ? `Last success: ${new Date(c.lastSuccessAt).toLocaleString()}${c.consecutiveFailures > 0 ? ` · ${c.consecutiveFailures} failure${c.consecutiveFailures > 1 ? "s" : ""} since` : ""}`
                    : "Never run"
              }
              status={c.healthy ? "ok" : c.lastError ? "danger" : "warn"}
              extra={c.lastError ? <span className="text-xs text-red-600 ml-2 truncate" title={c.lastError}>· last error: {c.lastError.slice(0, 80)}</span> : null}
            />
          ))
        )}
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

function Row({ label, value, status, extra }) {
  const dot = status === "ok" ? "bg-emerald-500" : status === "warn" ? "bg-amber-500" : status === "danger" ? "bg-red-500" : "bg-transparent"
  return (
    <div className="flex items-center py-2">
      <dt className="w-1/3 text-gray-500">{label}</dt>
      <dd className="flex-1 flex items-center gap-2 text-gray-900 min-w-0">
        {status && <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />}
        <span className="truncate">{value}</span>
        {extra}
      </dd>
    </div>
  )
}
