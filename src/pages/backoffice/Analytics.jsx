import { useEffect, useState } from "react"
import axios from "../../axiosConfig"
import { boAnalyticsURL } from "../../routes/Url"
import { useNavigate } from "react-router-dom"
import { ResponsiveSankey } from "@nivo/sankey"
import { boPath } from "./boPath"
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"

// Leaflet's default marker icons assume a webpack/CRA bundler. With Vite the
// asset URLs need to be wired manually — otherwise markers show as broken
// boxes. Point to the CDN copies that ship with leaflet's dist.
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
})

const fmtMoney = (n) => `£${(n || 0).toLocaleString()}`

export default function Analytics() {
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    let alive = true
    Promise.all([
      axios.get(`${boAnalyticsURL}/top-metrics`, { _silentToast: true }),
      axios.get(`${boAnalyticsURL}/funnel`, { _silentToast: true }),
      axios.get(`${boAnalyticsURL}/plan-distribution`, { _silentToast: true }),
      axios.get(`${boAnalyticsURL}/plan-migration`, { _silentToast: true }),
      axios.get(`${boAnalyticsURL}/cohort-retention`, { _silentToast: true }),
      axios.get(`${boAnalyticsURL}/revenue-breakdown`, { _silentToast: true }),
      axios.get(`${boAnalyticsURL}/fleet-health`, { _silentToast: true }),
      axios.get(`${boAnalyticsURL}/compliance-delivery`, { _silentToast: true }),
      axios.get(`${boAnalyticsURL}/churn`, { _silentToast: true }),
      axios.get(`${boAnalyticsURL}/engagement`, { _silentToast: true }),
      axios.get(`${boAnalyticsURL}/onboarding-pipeline`, { _silentToast: true }),
      axios.get(`${boAnalyticsURL}/power-users`, { _silentToast: true }),
      axios.get(`${boAnalyticsURL}/geography`, { _silentToast: true }),
    ]).then(([top, funnel, plan, migration, cohort, rev, fleet, compl, churn, eng, onb, power, geo]) => {
      if (!alive) return
      setData({
        top: top.data, funnel: funnel.data, plan: plan.data, migration: migration.data, cohort: cohort.data, rev: rev.data,
        fleet: fleet.data, compl: compl.data, churn: churn.data, eng: eng.data, onb: onb.data, power: power.data, geo: geo.data,
      })
      setLoading(false)
    }).catch(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading analytics…</div>
  const { top, funnel, plan, migration, cohort, rev, fleet, compl, churn, eng, onb, power, geo } = data

  return (
    <div className="p-8 space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="MRR" value={fmtMoney(top?.mrr.value)} />
        <Kpi label="Paying customers" value={top?.payingCustomers.value} />
        <Kpi label="Trial users" value={top?.trialUsers.value} sub={`${top?.trialUsers.conversionPct || 0}% conv`} />
        <Kpi label="Trial → Paid (30d)" value={`${top?.trialConversion.last30Pct || 0}%`} />
        <Kpi label="Logo churn (30d)" value={`${top?.logoChurnPct.last30 || 0}%`} />
        <Kpi label="NRR (30d)" value={`${top?.netRevenueRetentionPct.last30 || 100}%`} />
      </div>

      {/* MRR sparkline */}
      <Card title="MRR — last 12 months">
        <Sparkline points={top?.mrr.sparkline || []} />
      </Card>

      {/* Funnel */}
      <Card title="Growth funnel">
        <ul className="space-y-1">
          {funnel?.stages.map((s, i) => {
            const prev = i > 0 ? funnel.stages[i - 1].count : null
            const pct = prev ? Math.round((s.count / prev) * 100) : null
            const w = funnel.stages[0].count ? Math.round((s.count / funnel.stages[0].count) * 100) : 0
            return (
              <li key={s.key} className="flex items-center gap-3">
                <div className="w-64 text-sm text-gray-600">{s.label}</div>
                <div className="flex-1 bg-gray-100 rounded h-6 overflow-hidden">
                  <div className="bg-orange-500 h-full" style={{ width: `${w}%` }} />
                </div>
                <div className="w-24 text-sm font-semibold text-gray-900 text-right">{s.count}</div>
                {pct != null && <div className="w-12 text-xs text-gray-400 text-right">{pct}%</div>}
              </li>
            )
          })}
        </ul>
      </Card>

      {/* Plan distribution + revenue */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Current plan distribution">
          <BarTable rows={plan?.distribution.map(p => ({ name: p.name, value: p.count }))} />
        </Card>
        <Card title="Revenue by plan (MRR)">
          <BarTable rows={rev?.byPlan.map(p => ({ name: p.name, value: p.mrr, fmt: fmtMoney }))} />
          <p className="mt-3 text-xs text-gray-400">ARPU: {fmtMoney(rev?.arpu)} · Total MRR: {fmtMoney(rev?.totalMrr)}</p>
        </Card>
      </div>

      {/* Plan migration Sankey */}
      <Card title={`Plan migration — last ${migration?.days || 90} days`}>
        {migration?.links?.length > 0 ? (
          <div style={{ height: 320 }}>
            <ResponsiveSankey
              data={{ nodes: migration.nodes, links: migration.links }}
              margin={{ top: 20, right: 120, bottom: 20, left: 80 }}
              align="justify"
              colors={{ scheme: "category10" }}
              nodeOpacity={1}
              nodeThickness={16}
              nodeBorderWidth={0}
              linkOpacity={0.45}
              linkHoverOpacity={0.7}
              labelPosition="outside"
              labelPadding={12}
            />
          </div>
        ) : (
          <p className="text-xs text-gray-400">No migrations in window. Sankey populates once trial users transition to paid plans (or cancel).</p>
        )}
      </Card>

      {/* Cohort retention */}
      <Card title="Cohort retention">
        <table className="w-full text-xs">
          <thead><tr><th className="text-left py-1 px-1">Cohort</th><th className="text-left py-1 px-1">Signups</th>
            {Array.from({ length: cohort?.months || 6 }, (_, i) => <th key={i} className="text-left py-1 px-1">M{i}</th>)}</tr></thead>
          <tbody>
            {(cohort?.cohorts || []).map(c => (
              <tr key={c.cohort} className="border-t border-gray-50">
                <td className="py-1 px-1 font-mono">{c.cohort}</td>
                <td className="py-1 px-1">{c.signups}</td>
                {c.retentionPct.map((p, i) => (
                  <td key={i} className="py-1 px-1">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      p >= 80 ? "bg-emerald-100 text-emerald-700" :
                      p >= 50 ? "bg-amber-100 text-amber-700" :
                      p > 0 ? "bg-red-100 text-red-700" : "bg-gray-50 text-gray-400"
                    }`}>{p}%</span>
                  </td>
                ))}
              </tr>
            ))}
            {(!cohort?.cohorts?.length) && <tr><td colSpan={2 + (cohort?.months || 6)} className="py-4 text-center text-gray-400">No cohort data yet.</td></tr>}
          </tbody>
        </table>
      </Card>

      {/* Fleet health */}
      <Card title="Hardware fleet health">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Stat label="Gateways" value={`${fleet?.gateways.online}/${fleet?.gateways.total}`} sub="online" />
          <Stat label="Sensors" value={`${fleet?.sensors.online}/${fleet?.sensors.total}`} sub={`${fleet?.sensors.lowBattery} low batt`} />
          <Stat label="Readings 24h" value={(fleet?.readings.last24h || 0).toLocaleString()} sub={`${(fleet?.readings.last7d || 0).toLocaleString()} / 7d`} />
          <Stat label="Alerts 24h" value={fleet?.alerts.last24h || 0} sub={`${fleet?.alerts.last7d || 0} / 7d`} />
        </div>
      </Card>

      {/* Compliance delivery */}
      <Card title="Compliance delivery (this week)">
        <div className="flex gap-6 mb-4 text-sm">
          <Stat label="Meeting" value={`${compl?.summary.meetingPct || 0}%`} />
          <Stat label="At risk" value={`${compl?.summary.atRiskPct || 0}%`} />
          <Stat label="Failing" value={`${compl?.summary.failingPct || 0}%`} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <CustomerList title="Failing" tone="red" items={compl?.buckets.failing} onClick={(c) => navigate(boPath(`/customers/${c._id}`))} />
          <CustomerList title="At risk" tone="amber" items={compl?.buckets.atRisk} onClick={(c) => navigate(boPath(`/customers/${c._id}`))} />
          <CustomerList title="Meeting" tone="green" items={compl?.buckets.meeting} onClick={(c) => navigate(boPath(`/customers/${c._id}`))} />
        </div>
      </Card>

      {/* Churn */}
      <Card title="Churn (last 30 days)">
        <div className="flex gap-6 mb-3 text-sm">
          <Stat label="Cancellations" value={churn?.count || 0} />
          <Stat label="Lost MRR" value={fmtMoney(churn?.revenue)} />
          <Stat label="Median tenure" value={churn?.medianTenureDays != null ? `${churn.medianTenureDays}d` : "—"} />
        </div>
        <BarTable rows={churn?.byPlan.map(p => ({ name: p.name, value: p.count }))} />
        <ul className="mt-3 text-xs text-gray-600 space-y-1 max-h-40 overflow-auto">
          {(churn?.customers || []).map(c => (
            <li key={c._id} className="hover:underline cursor-pointer" onClick={() => navigate(boPath(`/customers/${c._id}`))}>
              {c.name} ({c.email}) · {c.plan} · {c.tenureDays}d · {new Date(c.cancelledAt).toLocaleDateString()}
            </li>
          ))}
        </ul>
      </Card>

      {/* Onboarding pipeline */}
      <Card title="Onboarding pipeline (where trial users are stuck)">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(onb?.groups || []).map(g => (
            <div key={g.key} className="border border-gray-100 rounded-lg p-3">
              <div className="text-xs uppercase text-gray-400">{g.label}</div>
              <div className="text-xl font-bold text-gray-900">{g.customers.length}</div>
              <div className="text-xs text-orange-600">{g.action}</div>
              <ul className="mt-2 text-xs text-gray-600 max-h-32 overflow-auto">
                {g.customers.slice(0, 5).map(c => (
                  <li key={c._id} className="hover:underline cursor-pointer truncate" onClick={() => navigate(boPath(`/customers/${c._id}`))}>{c.email}</li>
                ))}
                {g.customers.length > 5 && <li className="text-gray-400">+{g.customers.length - 5} more</li>}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      {/* Geography */}
      <Card title="Geography">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <div style={{ height: 320 }} className="rounded-lg overflow-hidden border border-gray-100">
              <MapContainer center={[51.5, -1]} zoom={5} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {(geo?.markers || []).map((m, i) => (
                  <Marker key={i} position={[m.lat, m.lng]}>
                    <Popup>
                      <div className="text-xs">
                        <div className="font-semibold">{m.customer || "—"}</div>
                        <div>{m.city || ""}, {m.country}</div>
                        <div className="font-mono mt-1">{m.gateway}</div>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
            {geo?.note && <p className="mt-2 text-xs text-gray-400">{geo.note}</p>}
          </div>
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Customers by country</h4>
            {(geo?.byCountry || []).length > 0 ? (
              <table className="w-full text-sm">
                <tbody>
                  {geo.byCountry.map(r => (
                    <tr key={r.country} className="border-t border-gray-50">
                      <td className="py-1.5 text-gray-700">{r.country}</td>
                      <td className="py-1.5 text-right font-medium">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-gray-400">No country data — gateway IPs aren't being recorded yet.</p>
            )}
          </div>
        </div>
      </Card>

      {/* Power users */}
      <Card title="Top 20 power users">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-gray-400">
            <tr><th className="text-left py-1.5">Customer</th><th className="text-left">Score</th><th className="text-left">Gateways</th><th className="text-left">Sensors</th><th className="text-left">Readings 7d</th></tr>
          </thead>
          <tbody>
            {(power?.items || []).map(c => (
              <tr key={c._id} className="border-t border-gray-50 hover:bg-orange-50/30 cursor-pointer" onClick={() => navigate(boPath(`/customers/${c._id}`))}>
                <td className="py-2 text-gray-800">{c.email}</td>
                <td className="py-2 font-semibold">{c.score}</td>
                <td className="py-2 text-xs">{c.gateways}</td>
                <td className="py-2 text-xs">{c.sensors}</td>
                <td className="py-2 text-xs">{c.readings7}</td>
              </tr>
            ))}
            {(!power?.items?.length) && <tr><td colSpan="5" className="py-4 text-center text-gray-400">No data yet.</td></tr>}
          </tbody>
        </table>
      </Card>

      <p className="text-xs text-gray-400">Engagement: {eng?.note}</p>
    </div>
  )
}

function Kpi({ label, value, sub }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
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

function Stat({ label, value, sub }) {
  return (
    <div>
      <div className="text-xs uppercase text-gray-400">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  )
}

function BarTable({ rows = [] }) {
  if (!rows.length) return <div className="text-xs text-gray-400">No data.</div>
  const max = Math.max(...rows.map(r => r.value || 0))
  return (
    <ul className="space-y-1">
      {rows.map(r => (
        <li key={r.name} className="flex items-center gap-3 text-sm">
          <div className="w-32 text-gray-600">{r.name}</div>
          <div className="flex-1 bg-gray-100 rounded h-5 overflow-hidden">
            <div className="bg-orange-400 h-full" style={{ width: `${max > 0 ? (r.value / max) * 100 : 0}%` }} />
          </div>
          <div className="w-20 text-right text-gray-900 font-medium">{r.fmt ? r.fmt(r.value) : r.value}</div>
        </li>
      ))}
    </ul>
  )
}

function CustomerList({ title, tone, items = [], onClick }) {
  const tones = { red: "border-red-100 bg-red-50", amber: "border-amber-100 bg-amber-50", green: "border-emerald-100 bg-emerald-50" }
  return (
    <div className={`border rounded-lg p-3 ${tones[tone]}`}>
      <div className="text-xs font-semibold text-gray-700 mb-2">{title} ({items.length})</div>
      <ul className="text-xs space-y-0.5 max-h-40 overflow-auto">
        {items.slice(0, 30).map(c => (
          <li key={c._id} onClick={() => onClick(c)} className="cursor-pointer hover:underline truncate">{c.email} · {c.pct}%</li>
        ))}
      </ul>
    </div>
  )
}

function Sparkline({ points = [] }) {
  if (!points.length) return <div className="text-xs text-gray-400">No data.</div>
  const W = 600, H = 80, P = 6
  const xs = points.map((_, i) => P + i * ((W - 2 * P) / Math.max(1, points.length - 1)))
  const max = Math.max(...points.map(p => p.mrr || 0), 1)
  const ys = points.map(p => H - P - ((p.mrr || 0) / max) * (H - 2 * P))
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ")
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20">
      <path d={d} fill="none" stroke="#fb923c" strokeWidth="2" />
      {xs.map((x, i) => <circle key={i} cx={x} cy={ys[i]} r="2.5" fill="#fb923c" />)}
    </svg>
  )
}
