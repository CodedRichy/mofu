import { Routes, Route } from 'react-router-dom'
import { Landing } from './pages/Landing'
import { Commands } from './pages/Commands'
import { Dashboard } from './pages/Dashboard'
import { GuildConfig } from './pages/GuildConfig'
import { Moderation } from './pages/Moderation'
import { Leveling } from './pages/Leveling'
import { Economy } from './pages/Economy'
import { Assistant } from './pages/Assistant'
import { Status } from './pages/Status'
import { Pricing } from './pages/Pricing'
import { Terms } from './pages/Terms'
import { Privacy } from './pages/Privacy'
import { Switch } from './pages/Switch'
import { NotFound } from './pages/NotFound'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/commands" element={<Commands />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/dashboard/:guildId" element={<GuildConfig />} />
      <Route path="/dashboard/:guildId/moderation" element={<Moderation />} />
      <Route path="/dashboard/:guildId/leveling" element={<Leveling />} />
      <Route path="/dashboard/:guildId/economy" element={<Economy />} />
      <Route path="/assistant" element={<Assistant />} />
      <Route path="/status" element={<Status />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/switch" element={<Switch />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
