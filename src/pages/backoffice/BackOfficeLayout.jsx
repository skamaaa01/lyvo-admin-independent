import { useEffect, useState } from "react"
import { NavLink, Routes, Route, Navigate, useNavigate } from "react-router-dom"
import {
  FiGrid,
  FiUsers,
  FiActivity,
  FiTag,
  FiShield,
  FiLogOut,
  FiZap,
  FiClipboard,
  FiUser,
  FiUserPlus,
  FiHelpCircle,
  FiDollarSign,
} from "react-icons/fi"
import axios from "../../axiosConfig"
import { boLogoutURL, boMeURL } from "../../routes/Url"
import BackOfficeDashboard from "./BackOfficeDashboard"
import SystemHealth from "./SystemHealth"
import AuditLogPage from "./AuditLog"
import CustomerSupport from "./CustomerSupport"
import Analytics from "./Analytics"
import Campaigns from "./Campaigns"
import Profile from "./Profile"
import BackOfficeUsers from "./BackOfficeUsers"
import Tickets from "./Tickets"
import TicketDetail from "./TicketDetail"
import Plans from "./Plans"
import { boPath } from "./boPath"

// Role -> visible nav entries. Enforced server-side too — UI is just hint.
// `to` paths run through boPath() so they work both at admin.lyvo.app/...
// and at lyvo.app/back-office/... in dev.
const NAV = [
  { to: boPath("/dashboard"), label: "Dashboard", icon: FiGrid, roles: ["admin", "support", "readonly"] },
  { to: boPath("/customers"), label: "Customer Support", icon: FiUsers, roles: ["admin", "support", "readonly"] },
  { to: boPath("/tickets"), label: "Tickets", icon: FiHelpCircle, roles: ["admin", "support", "readonly"] },
  { to: boPath("/analytics"), label: "Analytics", icon: FiActivity, roles: ["admin", "readonly"] },
  { to: boPath("/campaigns"), label: "Campaigns", icon: FiTag, roles: ["admin", "readonly"] },
  { to: boPath("/plans"), label: "Plans & Pricing", icon: FiDollarSign, roles: ["admin", "readonly"] },
  { to: boPath("/system-health"), label: "System Health", icon: FiShield, roles: ["admin"] },
  { to: boPath("/audit-log"), label: "Audit Log", icon: FiClipboard, roles: ["admin", "readonly"] },
  { to: boPath("/users"), label: "Users", icon: FiUserPlus, roles: ["admin", "support", "readonly"] },
  { to: boPath("/profile"), label: "Profile", icon: FiUser, roles: ["admin", "support", "readonly"] },
]

export default function BackOfficeLayout() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    axios.get(boMeURL, { _silentToast: true })
      .then(({ data }) => { if (alive) { setUser(data.user); setLoading(false) } })
      .catch(() => { if (alive) navigate(boPath("/login"), { replace: true }) })
    return () => { alive = false }
  }, [navigate])

  async function handleLogout() {
    try { await axios.post(boLogoutURL, {}, { _silentToast: true }) } catch (_) {}
    window.location.replace(boPath("/login"))
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">Loading…</div>
  }
  if (!user) return null

  const visibleNav = NAV.filter(n => n.roles.includes(user.role))

  const linkCls = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
      isActive ? "bg-orange-500 text-white shadow-sm" : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
    }`

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col">
        <div className="px-5 py-5 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
              <FiZap size={15} className="text-white" />
            </div>
            <div>
              <p className="text-gray-800 font-extrabold text-sm tracking-tight leading-none">LYVO</p>
              <p className="text-orange-500 text-[10px] font-medium mt-0.5">BACK OFFICE</p>
            </div>
          </div>
          <div className="mt-3 text-[11px] text-gray-500">
            <div className="font-medium text-gray-700">{user.name}</div>
            <div className="capitalize">{user.role}</div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {visibleNav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={linkCls}>
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-gray-100">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:text-red-500 hover:bg-red-50 transition-all"
          >
            <FiLogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-gray-50">
        <Routes>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<BackOfficeDashboard user={user} />} />
          <Route path="customers/*" element={<CustomerSupport user={user} />} />
          <Route path="analytics" element={<Analytics user={user} />} />
          <Route path="campaigns" element={<Campaigns user={user} />} />
          <Route path="plans" element={<Plans user={user} />} />
          <Route path="system-health" element={<SystemHealth user={user} />} />
          <Route path="audit-log" element={<AuditLogPage user={user} />} />
          <Route path="users" element={<BackOfficeUsers user={user} />} />
          <Route path="tickets" element={<Tickets user={user} />} />
          <Route path="tickets/:id" element={<TicketDetail user={user} />} />
          <Route path="profile" element={<Profile user={user} />} />
          <Route path="*" element={<Navigate to="dashboard" replace />} />
        </Routes>
      </main>
    </div>
  )
}
