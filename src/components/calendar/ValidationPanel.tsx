import { Panel } from '../ui/panel'
import { SeverityBadge } from '../ui/badge'
import { localizeMessage } from '@/lib/calendar'
import type { ValidationIssue, ValidationSeverity } from '@/lib/calendar'

const SEVERITY_ORDER: ValidationSeverity[] = ['ERROR', 'MISSING', 'WARNING', 'INFORMATION']

const SEVERITY_COPY: Record<ValidationSeverity, string> = {
  ERROR: 'Blocks activation until fixed.',
  MISSING: 'Not yet entered — not an error, just not done yet.',
  WARNING: 'Worth a look, but nothing is broken.',
  INFORMATION: 'For your awareness.',
}

export function ValidationPanel({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) {
    return (
      <Panel title="Validation">
        <p className="text-sm text-muted-foreground">
          Nothing to report. Every fact is entered and every rule checks out.
        </p>
      </Panel>
    )
  }

  return (
    <Panel title="Validation">
      <div className="space-y-5">
        {SEVERITY_ORDER.map((severity) => {
          const group = issues.filter((i) => i.severity === severity)
          if (group.length === 0) return null
          return (
            <div key={severity}>
              <div className="mb-2 flex items-baseline gap-2">
                <SeverityBadge severity={severity} />
                <span className="text-xs text-muted-foreground">{SEVERITY_COPY[severity]}</span>
              </div>
              <ul className="space-y-1.5 border-l-2 border-border pl-3">
                {group.map((issue, i) => (
                  <li key={`${issue.code}-${i}`} className="text-sm text-foreground">
                    {localizeMessage(issue.message)}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
