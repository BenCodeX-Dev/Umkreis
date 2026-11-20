import { useId, useState } from 'react';
import { categoryLabel } from '../../shared/categories.ts';
import type { EventItem } from '../../shared/types.ts';
import { downloadIcs } from '../lib/calendar.ts';
import { formatShortDate, formatTime, formatUntil, startedBefore } from '../lib/dates.ts';
import type { RankedEvent } from '../lib/filter.ts';
import { formatDistance, formatPrice, STATUS_LABEL } from '../lib/format.ts';
import { mapTarget, type MapProvider } from '../lib/maps.ts';
import { formatCheckedAt, freshness, missingDetails } from '../lib/quality.ts';
import { Icon } from './Icon.tsx';

export interface CardActions {
  isSaved: (id: string) => boolean;
  onToggleSave: (e: EventItem) => void;
  onShare: (e: EventItem) => void;
}

/** Shared by every card in one list: selection, cross-source conflicts and the preferred map app. */
export interface ListContext {
  now: Date;
  selectedId?: string;
  onSelect?: (id: string, from: 'list') => void;
  conflicts?: Map<string, string[]>;
  openIn?: MapProvider;
}

interface Props extends CardActions, ListContext {
  item: RankedEvent;
  /** e.g. "entfernt" or "von Köln"; omitted when there is no reference point. */
  /** Day the card is listed under; ongoing events that began earlier show their start date. */
  dayKey: string;
  distanceSuffix?: string;
}

export function EventCard({ item, dayKey, distanceSuffix, isSaved, onToggleSave, onShare, now, selectedId, onSelect, conflicts, openIn }: Props) {
  const e = item.event;
  const selected = selectedId === e.id;
  const fresh = freshness(e, now);
  const conflict = conflicts?.get(e.id);
  const missing = missingDetails(e).filter((m) => m === 'Uhrzeit' || m === 'Ort');
  const titleId = useId();
  const mapId = useId();
  const [mapOpen, setMapOpen] = useState(false);
  const map = mapTarget(e);
  const saved = isSaved(e.id);
  const until = formatUntil(e);
  const address = e.address ?? e.area;
  const timeIsText = e.allDay || !e.timeKnown;
  const links = map && openIn ? [...map.links].sort((a, b) => Number(b.provider === openIn) - Number(a.provider === openIn)) : map?.links;
  const cls = ['card', `cat-${e.category}`, item.matchesInterest && 'is-highlight', e.status === 'cancelled' && 'is-cancelled', selected && 'is-selected']
    .filter(Boolean)
    .join(' ');

  return (
    <article className={cls} aria-labelledby={titleId} data-event-id={e.id}>
      <div className="card-when">
        <time dateTime={e.start}>
          {startedBefore(e, dayKey) && <span className="when-date">seit {formatShortDate(e.start)}</span>}
          <span className={timeIsText ? 'when-time is-text' : 'when-time'}>{formatTime(e)}</span>
        </time>
        {until && <span className="when-until">{until}</span>}
      </div>

      <div className="card-body">
        <div className="card-top">
          <span className="tag">{categoryLabel(e.category)}</span>
          {e.status && <span className="badge badge-warn">{STATUS_LABEL[e.status]}</span>}
          {conflict && <span className="badge badge-flag" title={conflict.join('; ')}>Quellen widersprechen sich</span>}
          {fresh.kind === 'checked' && fresh.stale && <span className="badge badge-flag">Älter als 24 Std.</span>}
          {missing.length > 0 && <span className="badge badge-quiet">Ohne {missing.join(' und ')}</span>}
        </div>

        <h3 id={titleId} className="card-title">
          {onSelect ? (
            <button type="button" className="card-title-btn" aria-expanded={selected} aria-controls={selected ? 'event-detail' : undefined} onClick={() => onSelect(e.id, 'list')}>
              {e.title}
            </button>
          ) : (
            e.title
          )}
        </h3>

        {item.matchesInterest && item.reasons.length > 0 && (
          <p className="reason">
            <Icon name="star" filled />
            <span>Hervorgehoben: {item.reasons.join(', ')}</span>
          </p>
        )}

        <ul className="meta">
          <li>
            <Icon name="pin" />
            {e.venue || address ? (
              <span className="place">
                {e.venue && <span className="venue">{e.venue}</span>}
                {address && <span className="address">{address}</span>}
              </span>
            ) : (
              <span className="muted">Ort nicht angegeben</span>
            )}
          </li>
          {distanceSuffix && (
            <li>
              <Icon name="route" />
              <span className={item.distanceKm === undefined ? 'muted' : undefined}>
                {formatDistance(item.distanceKm, e.locationApprox)}
                {item.distanceKm !== undefined && ` ${distanceSuffix}`}
              </span>
            </li>
          )}
          <li>
            <Icon name="ticket" />
            <span className={e.price ? undefined : 'muted'}>{formatPrice(e.price)}</span>
          </li>
        </ul>

        {e.description && <p className="desc">{e.description}</p>}

        <div className="card-actions">
          <button type="button" className="btn btn-small btn-ghost" aria-pressed={saved} aria-describedby={titleId} onClick={() => onToggleSave(e)}>
            <Icon name="bookmark" filled={saved} /> {saved ? 'Gemerkt' : 'Merken'}
          </button>
          <button type="button" className="btn btn-small btn-ghost" aria-describedby={titleId} onClick={() => downloadIcs(e)}>
            <Icon name="calendar" /> Kalender
          </button>
          <button type="button" className="btn btn-small btn-ghost" aria-describedby={titleId} onClick={() => onShare(e)}>
            <Icon name="share" /> Teilen
          </button>
          {map && (
            <button
              type="button"
              className="btn btn-small btn-ghost"
              aria-expanded={mapOpen}
              aria-controls={mapId}
              aria-describedby={titleId}
              onClick={() => setMapOpen((o) => !o)}
            >
              <Icon name="map" /> Karte
            </button>
          )}
          {e.url ? (
            <a className="btn btn-small btn-link" href={e.url} target="_blank" rel="noopener noreferrer">
              {e.urlLabel ?? 'Zur Originalanzeige'} <Icon name="external" />
              <span className="visually-hidden"> (öffnet in neuem Tab)</span>
            </a>
          ) : (
            <span className="no-link">Keine Originalanzeige verfügbar</span>
          )}
        </div>
        {map && (
          <div className="maplinks" id={mapId} hidden={!mapOpen}>
            <span className="maplinks-label">Ort öffnen in</span>
            {links!.map((l) => (
              <a key={l.provider} href={l.href} target="_blank" rel="noopener noreferrer">
                {l.label}
                <span className="visually-hidden"> (öffnet in neuem Tab)</span>
              </a>
            ))}
            <span className="maplinks-note">
              {map.by === 'coordinates'
                ? 'Position laut Datenquelle. Es wird nur der Veranstaltungsort übergeben, nie dein Standort.'
                : 'Suche nach der angegebenen Adresse – Treffer bitte prüfen. Dein Standort wird nicht übergeben.'}
            </span>
          </div>
        )}
        <p className="source">
          Quelle: {e.sourceName}
          {fresh.kind === 'checked' && <> – abgerufen {formatCheckedAt(fresh.at, now)}</>}
        </p>
      </div>
    </article>
  );
}
