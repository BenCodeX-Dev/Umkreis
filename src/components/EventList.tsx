import { formatDayHeading } from '../lib/dates.ts';
import type { DayGroup } from '../lib/filter.ts';
import { EventCard, type CardActions, type ListContext } from './EventCard.tsx';

interface Props extends CardActions, ListContext {
  groups: DayGroup[];
  distanceSuffix?: string;
  busy?: boolean;
}

export function EventList({ groups, now, distanceSuffix, busy, ...actions }: Props) {
  return (
    <div className={busy ? 'results is-busy' : 'results'} aria-busy={busy || undefined}>
      {groups.map((g) => (
        <section key={g.dayKey} className="day" aria-labelledby={`day-${g.dayKey}`}>
          <DayHeading id={`day-${g.dayKey}`} dayKey={g.dayKey} now={now} count={g.items.length} />
          <ul className="cards">
            {g.items.map((it) => (
              <li key={it.event.id}>
                <EventCard item={it} dayKey={g.dayKey} distanceSuffix={distanceSuffix} now={now} {...actions} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DayHeading({ id, dayKey, now, count }: { id: string; dayKey: string; now: Date; count: number }) {
  const { lead, date } = formatDayHeading(dayKey, now);
  return (
    <h2 id={id} className="day-heading">
      <span className="day-lead">{lead}</span>
      <span className="day-date">{date}</span>
      <span className="day-count">
        {count}
        <span className="visually-hidden"> {count === 1 ? 'Veranstaltung' : 'Veranstaltungen'}</span>
      </span>
    </h2>
  );
}
