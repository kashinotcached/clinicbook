import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { addDays, fmtDate, today } from '../logic'
import { fmtTime, slotsFrom } from '../slots'

/**
 * Open days with free appointment times, starting a few days before `target` (e.g. when the next session is due).
 * Closed days and full times are left out; tapping a time picks it.
 */
export function SlotPicker({
  target,
  date,
  time,
  excludeVisitId,
  onPick,
}: {
  target: string
  date: string
  time: string
  excludeVisitId?: string
  onPick: (date: string, time: string) => void
}) {
  const t = today()
  const start = target > t ? (addDays(target, -3) > t ? addDays(target, -3) : t) : t
  const [days, setDays] = useState(21)
  const [open, setOpen] = useState<string | null>(null)
  const slots = useLiveQuery(() => slotsFrom(start, days, excludeVisitId), [start, days, excludeVisitId])
  if (!slots) return <div className="slot-picker" />

  const openDays = slots.filter((d) => !d.closed && d.times.some((x) => x.free))
  const targetDay = slots.find((d) => d.date === target)
  const shown = open ?? (openDays.some((d) => d.date === date) ? date : (openDays[0]?.date ?? ''))
  const day = slots.find((d) => d.date === shown)
  const label = (d: string) => new Date(d + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

  return (
    <div className="slot-picker">
      <div className="slot-head">
        <span className="field-label">Free appointments</span>
        {target > t && <span className="sub">due {fmtDate(target)}</span>}
      </div>
      {targetDay?.closed && <p className="slot-note">{fmtDate(target)}: {targetDay.closed}.</p>}
      {openDays.length === 0 ? (
        <p className="slot-note">No free time in these days. Check Settings → Clinic hours, or show more days.</p>
      ) : (
        <div className="slot-days" role="listbox" aria-label="Day">
          {openDays.map((d) => {
            const free = d.times.filter((x) => x.free).length
            return (
              <button
                key={d.date}
                role="option"
                aria-selected={d.date === shown}
                className={'slot-day' + (d.date === target ? ' due' : '')}
                onClick={() => setOpen(d.date)}
              >
                <strong>{label(d.date)}</strong>
                <small>
                  {d.date === t ? 'today · ' : d.date === target ? 'due · ' : ''}
                  {free} free
                </small>
              </button>
            )
          })}
          <button className="slot-day more" onClick={() => setDays(days + 21)}>
            <strong>More</strong>
            <small>next 3 weeks</small>
          </button>
        </div>
      )}
      {day && !day.closed && (
        <div className="slot-times">
          {day.times
            .filter((x) => x.free)
            .map((x) => (
              <button
                key={x.time}
                className={'slot-time' + (day.date === date && x.time === time ? ' on' : '')}
                onClick={() => onPick(day.date, x.time)}
              >
                {fmtTime(x.time)}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
