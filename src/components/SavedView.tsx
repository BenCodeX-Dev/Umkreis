import { navigateTo } from '../hooks/hooks.ts';
import type { CategoryId, EventItem } from '../../shared/types.ts';
import { startOfLocalDay } from '../../shared/time.ts';
import { isOver } from '../lib/dates.ts';
import { groupByDay, rankEvents } from '../lib/filter.ts';
import type { HomeLocation } from '../lib/location.ts';
import type { CardActions, ListContext } from './EventCard.tsx';
import { EventList } from './EventList.tsx';
import { EmptyState } from './StatusMessage.tsx';

interface Props extends CardActions, Pick<ListContext, 'openIn'> {
  saved: EventItem[];
  home?: HomeLocation;
  interests: CategoryId[];
  now: Date;
  onRemovePast: () => void;
}

export function SavedView({ saved, home, interests, now, onRemovePast, ...actions }: Props) {
  const today = startOfLocalDay(now);
  const ranked = rankEvents(saved, { categories: [], text: '', sort: 'zeit', interests, home, now, windowFrom: today });
  const groups = groupByDay(ranked, 'zeit', today);
  const pastCount = saved.filter((e) => isOver(e, now)).length;

  return (
    <section className="view" aria-labelledby="title-saved">
      <header className="view-head">
        <div>
          <h1 id="title-saved" className="view-title">Gemerkt</h1>
          <p className="view-sub">Nur in diesem Browser gespeichert. Angaben können sich ändern – prüfe vor dem Losgehen die Originalanzeige.</p>
        </div>
      </header>

      {pastCount > 0 && (
        <p className="alert alert-info">
          {pastCount} gemerkte {pastCount === 1 ? 'Veranstaltung ist' : 'Veranstaltungen sind'} vorbei.{' '}
          <button type="button" className="link-btn" onClick={onRemovePast}>Vergangene entfernen</button>
        </p>
      )}

      {groups.length === 0 ? (
        <EmptyState
          title="Noch nichts Kommendes gemerkt"
          text="Tippe bei einer Veranstaltung auf „Merken“, um sie hier wiederzufinden."
          suggestions={[{ label: 'Veranstaltungen in der Nähe', onClick: () => navigateTo('nah') }]}
        />
      ) : (
        <EventList groups={groups} now={now} distanceSuffix={home ? 'entfernt' : undefined} {...actions} />
      )}
    </section>
  );
}
