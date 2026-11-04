import { useEffect, useRef, useState } from 'react'
import { ArrowRight, AudioLines, CircleAlert, LoaderCircle, Mic, Phone, Square } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmergencySummary } from '../components/EmergencySummary'
import { useEmergencyCall } from '../hooks/useEmergencyCall'
import { extractEmergency } from '../lib/extraction'
import type { EmergencyDetails } from '../lib/types'

export function CallPage({ onSubmit }: { onSubmit: (transcript: string, requestId: string) => Promise<EmergencyDetails> }) {
  const [language, setLanguage] = useState<'en' | 'ta'>('en')
  const call = useEmergencyCall({ language })
  const [processing, setProcessing] = useState(false)
  const [details, setDetails] = useState<EmergencyDetails | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(false)
  const [clarifyingLocation, setClarifyingLocation] = useState(false)
  const previousReport = useRef('')
  const mounted = useRef(true)
  const submission = useRef<{ transcript: string; id: string } | null>(null)
  const transcriptBox = useRef<HTMLDivElement>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { if (transcriptBox.current) transcriptBox.current.scrollTop = transcriptBox.current.scrollHeight }, [call.transcript])

  async function finishCall() {
    setProcessing(true); setError('')
    try {
      if (!retry) {
        const transcript = await call.stop()
        if (!transcript.trim()) throw new Error('No speech was recognised. Start a new call and speak into your microphone.')
        const complete = clarifyingLocation && previousReport.current
          ? `${previousReport.current}\nCorrection: the emergency location is ${transcript}`
          : transcript
        submission.current = { transcript: complete, id: crypto.randomUUID() }
      }
      if (!submission.current) return
      setRetry(true)
      const result = await onSubmit(submission.current.transcript, submission.current.id)
      if (mounted.current) { setDetails(result); setRetry(false); setClarifyingLocation(false); previousReport.current = '' }
    } catch (failure) {
      if (mounted.current) {
        setError(failure instanceof Error ? failure.message : 'Unable to process this call. Please try again.')
        if (failure instanceof Error && 'code' in failure && failure.code === 'LOCATION_UNRESOLVED') {
          previousReport.current = submission.current?.transcript ?? ''
          setClarifyingLocation(true); setRetry(false)
        }
      }
    } finally { if (mounted.current) setProcessing(false) }
  }

  return <main id="main-content" className="public-page voice-page">
    <section className="voice-call" aria-labelledby="call-heading">
      <div className="voice-title"><span className="small-label">PUBLIC EMERGENCY CALL</span><h1 id="call-heading">Help starts with your voice.</h1><p>Tell us what happened, where you are, and who needs help.</p></div>
      <div className={`speech-input ${call.active ? 'is-recording' : ''}`} aria-label="Microphone speech input">
        <span className="microphone-orb"><Mic size={30} strokeWidth={1.6} /></span>
        <div><strong>{processing ? 'Finalising your emergency report' : call.connecting ? 'Connecting to Mistral…' : call.active ? 'Listening. Take your time.' : details ? 'Your call has been received.' : 'Speak naturally. We’re ready.'}</strong><p>Tamil · English</p></div>
        <span className="recording-time">{call.active ? `${String(Math.floor(call.seconds / 60)).padStart(2, '0')}:${String(call.seconds % 60).padStart(2, '0')}` : <AudioLines size={25} />}</span>
      </div>
      <button className={`call-action ${call.active || call.connecting ? 'stop' : ''} ${processing ? 'processing' : ''}`} disabled={processing} onClick={() => {
        if (call.active || call.connecting || retry) void finishCall()
        else { setDetails(null); setError(''); submission.current = null; void call.start() }
      }}>{processing ? <LoaderCircle size={19} className="spin" /> : call.active || call.connecting ? <Square size={17} fill="currentColor" /> : <Phone size={19} />}{processing ? 'PROCESSING CALL' : call.active || call.connecting ? 'STOP CALL' : retry ? 'RETRY RESPONSE' : clarifyingLocation ? 'CLARIFY LOCATION' : 'CALL EMERGENCY'}</button>
      <p className="voice-help">{clarifyingLocation ? 'Your emergency report is saved. Say only the correct location, city and landmark, then stop.' : call.active ? 'Speech is transcribed live by Mistral. Stop when you have finished.' : 'Microphone audio is sent to Mistral for transcription. Simulation only.'}</p>
      <div className="language-picker"><span className="small-label">Language</span><button type="button" aria-pressed={language === 'en'} className={language === 'en' ? 'selected' : ''} onClick={() => setLanguage('en')}>English</button><button type="button" aria-pressed={language === 'ta'} className={language === 'ta' ? 'selected' : ''} onClick={() => setLanguage('ta')}>தமிழ்</button></div>
    </section>

    <section className="voice-transcript" aria-labelledby="transcript-heading"><div className="voice-section-heading"><h2 id="transcript-heading"><AudioLines size={18} /> Live transcript</h2><span className={`capture-badge ${call.active ? 'capturing' : ''}`}><span />{call.active ? 'Live · Mistral' : details ? 'Call complete' : 'Waiting for speech'}</span></div>
      <div ref={transcriptBox} className={`transcript-output ${call.transcript ? 'has-text' : ''}`} role="log" aria-live="polite" aria-label="Live transcript" aria-relevant="text">{call.transcript || 'Your actual spoken words will appear here as you speak.'}</div>
      {(error || call.notice) && <div className="inline-notice error" role="alert"><CircleAlert size={17} /><span>{error || call.notice}</span></div>}
    </section>

    <section className="voice-details" aria-labelledby="extracted-heading"><div className="voice-section-heading"><h2 id="extracted-heading">Extracted emergency details</h2><span className="small-label">{details ? details.understanding === 'ai' ? 'MISTRAL AI' : 'LOCAL EXTRACTION' : 'AFTER YOUR CALL'}</span></div>
      <EmergencySummary details={details ?? extractEmergency('')} />
      {details?.extractionNote && <p className="extraction-note">{details.extractionNote}</p>}
      {details && <Link className="primary-button follow-response" to="/simulation">Follow emergency response <ArrowRight size={17} /></Link>}
    </section>
  </main>
}
