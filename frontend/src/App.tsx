import { Navigate, Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import Room from './pages/Room'
import Evil from './pages/Evil'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/room/:code" element={<Room />} />
      <Route path="/evil" element={<Evil />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
