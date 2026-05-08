import { Routes, Route } from "react-router-dom"
import CustomerSearch from "./customer/CustomerSearch"
import CustomerDetail from "./customer/CustomerDetail"

export default function CustomerSupport({ user }) {
  return (
    <Routes>
      <Route index element={<CustomerSearch user={user} />} />
      <Route path=":id" element={<CustomerDetail user={user} />} />
    </Routes>
  )
}
