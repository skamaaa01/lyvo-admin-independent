export default function BackOfficeDashboard({ user }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900">Welcome, {user.name}</h1>
      <p className="mt-2 text-sm text-gray-500">
        Phase 1 of the back office is live. Use the sidebar to navigate.
        Customer Support, Analytics, Campaigns and GDPR tooling roll out in subsequent phases.
      </p>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Role" value={user.role} />
        <Card title="Last login" value={user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "—"} />
        <Card title="Session timeout" value="4 hours of inactivity" />
      </div>
    </div>
  )
}

function Card({ title, value }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-gray-400">{title}</div>
      <div className="mt-2 text-lg font-semibold text-gray-900 capitalize">{value}</div>
    </div>
  )
}
