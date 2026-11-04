import { Activity, ClipboardList, HeartPulse, MapPin, Phone, ShieldAlert, Users, Zap } from 'lucide-react'
import type { EmergencyDetails } from '../lib/types'
import { requiredCapabilities } from '../lib/response'

export function SeverityBadge({ severity }: { severity: EmergencyDetails['severity'] }) {
  return <span className={`severity-badge severity-${severity.toLowerCase()}`}><span />{severity === 'Undetermined' ? 'Awaiting details' : `${severity} priority`}</span>
}

export function EmergencySummary({ details, compact = false }: { details: EmergencyDetails; compact?: boolean }) {
  const fields = [
    { icon: MapPin, label: 'Emergency location', value: details.location, placeholder: 'Listening for a location…' },
    { icon: Zap, label: 'Emergency type', value: details.category === 'Unclassified' ? null : details.category, placeholder: 'Not yet identified' },
    { icon: Users, label: 'People involved', value: details.victims === null ? null : `${details.victims} ${details.victims === 1 ? 'person' : 'people'} reported`, placeholder: 'Not yet specified' },
    { icon: HeartPulse, label: 'Unconscious', value: details.unconscious === null ? null : `${details.unconscious} reported`, placeholder: details.conditions.includes('Unconscious') ? 'Reported · count unspecified' : 'Not specified' },
    { icon: Phone, label: 'Caller contact number', value: details.callerContact, placeholder: 'Not provided' },
    { icon: Activity, label: 'Patient condition', value: details.conditions.length ? details.conditions.join(' · ') : null, placeholder: 'Not yet specified' },
    { icon: HeartPulse, label: 'Required medical assistance', value: details.transcript ? details.medicalRequired ? requiredCapabilities(details).join(' · ') : 'Rescue / assessment only' : null, placeholder: 'Determined after your call' },
    { icon: ShieldAlert, label: 'Response priority', value: details.severity === 'Undetermined' ? null : details.severity, placeholder: 'Awaiting details' },
    { icon: ClipboardList, label: 'Additional details', value: details.notes.length ? details.notes.join(' · ') : null, placeholder: 'No additional details yet' },
  ]
  return <div className={`extracted-grid ${compact ? 'compact' : ''}`}>
    {fields.map(({ icon: Icon, label, value, placeholder }) => <div className={`extracted-field ${value ? 'has-value' : ''}`} key={label}>
      <Icon size={15} />
      <div><span className="field-label">{label}</span><span className={`field-value ${value ? '' : 'placeholder'}`}>{value ?? placeholder}</span></div>
    </div>)}
  </div>
}
