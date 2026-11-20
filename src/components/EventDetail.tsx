import { useEffect, useRef, useState } from 'react';
import { categoryLabel } from '../../shared/categories.ts';
import type { EventItem } from '../../shared/types.ts';
import { ApiError, fetchStreetLevel, type StreetLevel as StreetLevelResult } from '../lib/api.ts';
import { downloadIcs } from '../lib/calendar.ts';
import { formatLongDate, formatTime, formatUntil } from '../lib/dates.ts';
import type { RankedEvent } from '../lib/filter.ts';
import { formatDistance, formatPrice, STATUS_LABEL } from '../lib/format.ts';
import { STREET_LEVEL_NOTE } from '../lib/mapPrefs.ts';
import { mapTarget, preferLink, type MapProvider } from '../lib/maps.ts';
import { formatCheckedAt, freshness, linkTarget, missingDetails } from '../lib/quality.ts';
import type { CardActions } from './EventCard.tsx';
import { Icon } from './Icon.tsx';

interface Props extends CardActions {
  item: RankedEvent;
  distanceSuffix?: string;
  now: Date;
  conflicts?: string[];
  /** Other events at exactly the same map position. */
  sameSpot: EventItem[];
  openIn: MapProvider;
  onSelect: (id: string) => void;
  onClose: () => void;
  /** Bumped on every selection so focus moves here even when the same event is chosen again. */
  focusToken: number;
}

const takenFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' });

function positionNote(e: EventItem): string {
  if (e.locationRejected)
    return e.location
      ? 'Die Quelle nennt eine Kartenposition außerhalb ihres Kalendergebiets – sie wird nicht verwendet. Gezeigt wird nur der Mittelpunkt des Kalendergebiets.'
      : 'Die Quelle nennt eine Kartenposition außerhalb Deutschlands – sie wird nicht verwendet.';
  if (!e.location) return 'Die Quelle nennt keine Kartenposition.';
  if (e.locationApprox) return 'Nur ungefähre Lage: Mittelpunkt des Kalendergebiets, nicht der Veranstaltungsort.';
  return 'Kartenposition laut Quelle.';
}

export function EventDetail({ item, distanceSuffix, now, conflicts, sameSpot, openIn, onSelect, onClose, focusToken, isSaved, onToggleSave, onShare }: Props) {
  const e = item.event;
  const heading = useRef<HTMLHeadingElement>(null);
  const fresh = freshness(e, now);
  const missing = missingDetails(e);
  const map = mapTarget(e);
  const links = map ? preferLink(map, openIn) : null;
  const target = e.url ? linkTarget(e.url) : null;
  const until = formatUntil(e);
  const saved = isSaved(e.id);
  const time = formatTime(e);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [focusToken]);

  const warnings: string[] = [];
  if (fresh.kind === 'checked' && fresh.stale) warnings.push('Seit über 24 Stunden nicht neu abgerufen – die Angaben können sich inzwischen geändert haben.');
  if (missing.length) warnings.push(`Die Quelle nennt keine Angabe zu: ${missing.join(', ')}.`);
  for (const c of conflicts ?? []) warnings.push(`Abweichung: ${c}.`);

  return (
    <section
      id="event-detail"
      className="detail"
      aria-labelledby="event-detail-title"
      onKeyDown={(ev) => {
        if (ev.key === 'Escape') onClose();
      }}
    >
      <div className="detail-top">
        <span className={`tag cat-${e.category}`}>{categoryLabel(e.category)}</span>
        {e.status && <span className="badge badge-warn">{STATUS_LABEL[e.status]}</span>}
        <button type="button" className="icon-btn detail-close" aria-label="Details schließen" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      <h2 id="event-detail-title" className="detail-title" ref={heading} tabIndex={-1}>{e.title}</h2>

      <dl className="facts">
        <div>
          <dt><Icon name="clock" /><span>Wann</span></dt>
          <dd>
            {formatLongDate(e.start)}
            {e.allDay ? ', ganztägig' : e.timeKnown ? `, ${time} Uhr` : ' – Uhrzeit nicht angegeben'}
            {until && <span className="sub">{until}</span>}
          </dd>
        </div>
        <div>
          <dt><Icon name="pin" /><span>Wo</span></dt>
          <dd>
            {e.venue || e.address || e.area ? (
              <>
                {e.venue && <span className="venue">{e.venue}</span>}
                {(e.address ?? e.area) && <span className="sub">{e.address ?? e.area}</span>}
              </>
            ) : (
              <span className="muted">Ort nicht angegeben</span>
            )}
            <span className="sub">{positionNote(e)}</span>
          </dd>
        </div>
        {distanceSuffix && (
          <div>
            <dt><Icon name="route" /><span>Entfernung</span></dt>
            <dd>
              {item.distanceKm === undefined ? (
                <span className="muted">unbekannt – keine Position</span>
              ) : (
                <>
                  {formatDistance(item.distanceKm, e.locationApprox)} {distanceSuffix}
                  <span className="sub">
                    Luftlinie
                    {distanceSuffix === 'entfernt' ? ', gemessen von deinem auf ca. 1 km gerundeten Standort' : ''}
                  </span>
                </>
              )}
            </dd>
          </div>
        )}
        <div>
          <dt><Icon name="ticket" /><span>Preis</span></dt>
          <dd className={e.price ? undefined : 'muted'}>{formatPrice(e.price)}</dd>
        </div>
        <div>
          <dt><Icon name="external" /><span>Quelle</span></dt>
          <dd>
            {e.sourceName}
            <span className="sub">
              {fresh.kind === 'unknown'
                ? 'Abrufzeit unbekannt.'
                : `Zuletzt abgerufen: ${formatCheckedAt(fresh.at, now)}. Wann der Veranstalter den Eintrag zuletzt geändert hat, teilt die Quelle nicht mit.`}
            </span>
          </dd>
        </div>
      </dl>

      {warnings.length > 0 && (
        <ul className="alert alert-warn detail-warnings">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      {e.description && <p className="detail-desc">{e.description}</p>}

      <div className="detail-actions">
        {e.url ? (
          <a className="btn btn-primary" href={e.url} target="_blank" rel="noopener noreferrer">
            {e.urlLabel ?? 'Zur Originalanzeige'} <Icon name="external" />
            <span className="visually-hidden"> (öffnet in neuem Fenster)</span>
          </a>
        ) : (
          <p className="muted">Die Quelle verlinkt keine Originalanzeige.</p>
        )}
        {links && (
          <a className="btn" href={links.primary.href} target="_blank" rel="noopener noreferrer">
            <Icon name="map" /> In {links.primary.label} öffnen
            <span className="visually-hidden"> (öffnet in neuem Fenster)</span>
          </a>
        )}
      </div>
      {target && (
        <p className="detail-maplinks">
          Der Link führt zu <strong>{target.host}</strong>
          {target.insecure ? ' über eine unverschlüsselte Verbindung (http)' : ''}. Umkreis prüft nicht, ob diese Seite zum Veranstalter gehört.
        </p>
      )}
      {links && (
        <p className="detail-maplinks">
          Oder in{' '}
          {links.others.map((l, i) => (
            <span key={l.provider}>
              {i > 0 && (i === links.others.length - 1 ? ' oder ' : ', ')}
              <a href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
            </span>
          ))}
          .{' '}
          {map!.by === 'coordinates'
            ? 'Übergeben wird nur die Position des Veranstaltungsorts, nie dein Standort.'
            : 'Gesucht wird nach der angegebenen Adresse – Treffer bitte prüfen.'}
        </p>
      )}

      <div className="card-actions detail-tools">
        <button type="button" className="btn btn-small btn-ghost" aria-pressed={saved} onClick={() => onToggleSave(e)}>
          <Icon name="bookmark" filled={saved} /> {saved ? 'Gemerkt' : 'Merken'}
        </button>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => downloadIcs(e)}>
          <Icon name="calendar" /> Kalender
        </button>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => onShare(e)}>
          <Icon name="share" /> Teilen
        </button>
      </div>

      {sameSpot.length > 0 && (
        <div className="detail-section">
          <h3>Am selben Ort{e.locationApprox ? ' (ungefähre Lage)' : ''}</h3>
          <ul className="same-spot">
            {sameSpot.slice(0, 8).map((o) => (
              <li key={o.id}>
                <button type="button" className="link-btn" onClick={() => onSelect(o.id)}>{o.title}</button>
                <span className="muted"> – {formatLongDate(o.start)}{o.timeKnown && !o.allDay ? `, ${formatTime(o)} Uhr` : ''}</span>
              </li>
            ))}
          </ul>
          {sameSpot.length > 8 && <p className="muted">und {sameSpot.length - 8} weitere</p>}
        </div>
      )}

      <StreetLevel key={e.id} event={e} openIn={openIn} />
    </section>
  );
}

type SlState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; result: StreetLevelResult } | { kind: 'error'; message: string };

function StreetLevel({ event: e, openIn }: { event: EventItem; openIn: MapProvider }) {
  const [state, setState] = useState<SlState>({ kind: 'idle' });
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const check = () => {
    if (!e.location) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setState({ kind: 'loading' });
    fetchStreetLevel(e.location, c.signal).then(
      (result) => setState({ kind: 'done', result }),
      (err: unknown) => {
        if (c.signal.aborted) return;
        setState({ kind: 'error', message: err instanceof ApiError ? err.message : 'Die Suche nach Straßenbildern ist fehlgeschlagen.' });
      },
    );
  };

  let body;
  if (!e.location || e.locationApprox)
    body = <p className="muted">Nicht verfügbar: Ohne genaue Position von der Quelle lässt sich nicht prüfen, ob es hier Straßenbilder gibt.</p>;
  else if (state.kind === 'idle' || state.kind === 'loading')
    body = (
      <>
        <button type="button" className="btn btn-small" onClick={check} disabled={state.kind === 'loading'}>
          {state.kind === 'loading' ? 'Suche läuft …' : 'Bei Panoramax nachsehen'}
        </button>
        <p className="hint">Panoramax ist eine freie Sammlung von Straßenfotos aus der OpenStreetMap-Community. Umkreis fragt dort nur nach der Position des Veranstaltungsorts.</p>
      </>
    );
  else if (state.kind === 'error')
    body = (
      <p className="muted">
        {state.message}{' '}
        <button type="button" className="link-btn" onClick={check}>Erneut versuchen</button>
      </p>
    );
  else if (!state.result.available)
    body = <p className="muted">Nicht verfügbar: Panoramax hat im Umkreis von {state.result.radiusM} m um diese Position keine Straßenbilder.</p>;
  else {
    const p = state.result.picture;
    const taken = p.takenAt ? takenFmt.format(new Date(p.takenAt)) : undefined;
    body = (
      <figure className="streetlevel">
        <a href={p.viewerUrl} target="_blank" rel="noopener noreferrer">
          <img src={p.thumbPath} alt={`Straßenfoto bis ${state.result.radiusM} m vom Veranstaltungsort${taken ? `, aufgenommen am ${taken}` : ''}`} loading="lazy" />
        </a>
        <figcaption>
          Foto bis {state.result.radiusM} m entfernt{taken ? `, aufgenommen am ${taken}` : ''}
          {p.producer ? ` von ${p.producer}` : ''}. Lizenz:{' '}
          {p.licenseUrl ? <a href={p.licenseUrl} target="_blank" rel="noopener noreferrer">{p.license}</a> : p.license}.{' '}
          <a href={p.viewerUrl} target="_blank" rel="noopener noreferrer">Bei Panoramax ansehen</a>. Das Bild zeigt nicht zwingend den Eingang.
        </figcaption>
      </figure>
    );
  }

  return (
    <div className="detail-section">
      <h3>Straßenbilder</h3>
      {body}
      {openIn !== 'osm' && <p className="hint">{STREET_LEVEL_NOTE[openIn]}</p>}
    </div>
  );
}
