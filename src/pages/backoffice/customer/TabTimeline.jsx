const KIND_DOT = {
  signup: "bg-blue-500", trial_start: "bg-amber-500", subscribed: "bg-emerald-500",
  first_gateway: "bg-purple-500", first_sensor: "bg-indigo-500", note: "bg-gray-500",
}

export default function TabTimeline({ timeline }) {
  if (!timeline || timeline.length === 0) return <div className="text-xs text-gray-400">No events recorded.</div>
  return (
    <ol className="relative ml-4 border-l-2 border-gray-100">
      {timeline.map((ev, i) => (
        <li key={i} className="pl-5 pb-5 relative">
          <span className={`absolute -left-[7px] top-1 w-3 h-3 rounded-full border-2 border-white ${KIND_DOT[ev.kind] || "bg-gray-400"}`} />
          <div className="text-xs text-gray-400">{ev.at ? new Date(ev.at).toLocaleString() : "—"}</div>
          <div className="text-sm text-gray-800">{ev.label}</div>
        </li>
      ))}
    </ol>
  )
}
