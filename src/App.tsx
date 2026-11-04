import { useCallback, useEffect, useState } from 'react'
import { Activity, Check, ShieldCheck } from 'lucide-react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { CallPage } from './pages/CallPage'
import { SimulationPage } from './pages/SimulationPage'
import { useResponseNetwork } from './hooks/useResponseNetwork'

export default function App() {
  const { network, connected, connectionError, submit, control } = useResponseNetwork()
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try { return sessionStorage.getItem('aegis-selected-mission') } catch { return null }
  })
  const navigate = useNavigate()
  const location = useLocation()
  const isSimulation = location.pathname === '/simulation'
  const activeCount = network?.missions.filter((mission) => mission.state.stage !== 'completed').length ?? 0
  const mission = network?.missions.find((item) => item.id === selectedId) ?? network?.missions[network.missions.length - 1] ?? null

  useEffect(() => {
    if (selectedId) { try { sessionStorage.setItem('aegis-selected-mission', selectedId) } catch { /* Selection persistence is optional. */ } }
  }, [selectedId])

  useEffect(() => {
    document.title = `${isSimulation ? 'Live response' : 'Emergency call'} | Aegis Response`
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [isSimulation])

  const startMission = useCallback(async (transcript: string, requestId: string) => {
    const { id, details } = await submit(transcript, requestId)
    setSelectedId(id)
    return details
  }, [submit])

  const newCall = useCallback(() => {
    navigate('/')
  }, [navigate])

  return (
    <div className={`app-shell ${isSimulation ? 'simulation-shell' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <div className="header-inner">
          <Link to="/" className="brand" aria-label="Aegis Response, home">
            <span className="brand-mark"><span /><span /></span>
            <span className="aegis-wordmark">Aegis<span>Response</span></span>
          </Link>
          <nav className="page-navigation" aria-label="Main pages">
            <Link to="/" className={!isSimulation ? 'nav-link active' : 'nav-link'} aria-current={!isSimulation ? 'page' : undefined}>
              <span className="nav-step">{isSimulation ? <Check size={12} /> : '01'}</span> <span>Public emergency</span>
            </Link>
            <span className="nav-connector" />
            <Link to="/simulation" className={isSimulation ? 'nav-link active' : 'nav-link'} aria-current={isSimulation ? 'page' : undefined}>
              <span className="nav-step">02</span><span>Live response{activeCount > 0 && <span className="nav-active-count">{activeCount}</span>}</span>
            </Link>
          </nav>
          <span className="prototype-badge"><span /> Emergency simulation</span>
        </div>
      </header>

      {connectionError && <div className="network-connection-notice" role="status"><Activity size={15} />{connectionError}</div>}

      <Routes>
        <Route path="/" element={<CallPage onSubmit={startMission} />} />
        <Route path="/simulation" element={<SimulationPage network={network} mission={mission} connected={connected} onSelect={setSelectedId} onControl={control} onNewCall={newCall} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {isSimulation && <footer className="site-footer">
        <span>Aegis Response</span>
        <span className="footer-disclaimer"><ShieldCheck size={14} /> Simulation only. No emergency services are contacted.</span>
      </footer>}
    </div>
  )
}
