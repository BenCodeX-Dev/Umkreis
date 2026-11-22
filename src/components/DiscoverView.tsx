import { useEffect, useMemo, useState } from 'react';
import { CITIES } from '../../shared/cities.ts';
import type { MapTiles } from '../../shared/mapTiles.ts';
import type { CategoryId, EventItem, EventsRequest, GeocodeResult } from '../../shared/types.ts';
import { navigateTo, useDebouncedValue } from '../hooks/hooks.ts';
import { useEvents } from '../hooks/useEvents.ts';
import type { ServerStatus } from '../lib/api.ts';
import { RANGES, rangeWindow, type RangeId } from '../lib/dates.ts';
import { groupByDay, rankEvents } from '../lib/filter.ts';
import type { HomeLocation } from '../lib/location.ts';
import type { InAppMap } from '../lib/mapPrefs.ts';
import type { MapProvider } from '../lib/maps.ts';
import { findConflicts } from '../lib/quality.ts';
import { spotKey } from '../lib/spots.ts';
import { EventDetail } from './EventDetail.tsx';
import type { CardActions } from './EventCard.tsx';
import { EventList } from './EventList.tsx';
import { FilterBar, RadiusControl, type Filters } from './FilterBar.tsx';
import { Icon } from './Icon.tsx';
import { MapPanel } from './MapPanel.tsx';
import { EmptyState, ErrorState, LoadingState, type Suggestion } from './StatusMessage.tsx';

const CITY_RADIUS_KM = 25;

interface Props extends CardActions {
  scope: 'local' | 'de';
  home?: HomeLocation;
  radius: number;
  onRadiusChange: (km: number) => void;
  interests: CategoryId[];
  now: Date;
  status: ServerStatus | null;
  /** Map tile service; undefined while the server status is loading. */
  tiles?: MapTiles;
  onEditLocation: () => void;
  onEditInterests: () => void;
  mapView: InAppMap | null;
  onMapView: (v: InAppMap) => void;
  openIn: MapProvider;
  /** Fresh results, so saved copies of the same events can be updated. */
  onResults?: (events: EventItem[]) => void;
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const cardSelector = (id: string) => `[data-event-id="${CSS.escape(id)}"]`;

export function DiscoverView({ scope, home, radius, onRadiusChange, interests, now, status, tiles, onEditLocation, onEditInterests, mapView, onMapView, openIn, onResults, ...actions }: Props) {
  const [selected, setSelected] = useState<{ id: string; token: number } | null>(null);
  const [filters, setFilters] = useState<Filters>({ range: scope === 'local' ? 'heute' : '7tage', categories: [], text: '', sort: 'zeit' });
  const [city, setCity] = useState<GeocodeResult | null>(null);
  const patch = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));

  const debRadius = useDebouncedValue(radius, 350);
  const debText = useDebouncedValue(filters.text.trim(), 400);
  const win = rangeWindow(filters.range, now);
  const from = win.from.toISOString();
  const to = win.to.toISOString();

  let req: EventsRequest | null = null;
  if (scope === 'local') {
    if (home) req = { scope: 'local', lat: home.lat, lon: home.lon, radiusKm: debRadius, from, to };
  } else if (city) {
    req = { scope: 'local', lat: city.lat, lon: city.lon, radiusKm: CITY_RADIUS_KM, from, to, q: debText || undefined };
  } else {
    // Germany-wide results are capped server-side, so the search text is applied there too.
    req = { scope: 'de', from, to, q: debText || undefined };
  }

  // Without any source there is nothing to ask for; the banner above explains how to add one.
  const unconfigured = status?.mode === 'unconfigured';
  const { loading, data, previous, error, retry } = useEvents(unconfigured ? null : req);
  const shown = data ?? (loading ? previous : undefined);
  useEffect(() => {
    if (data) onResults?.(data.events);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const conflicts = useMemo(() => findConflicts(shown?.events ?? []), [shown]);

  const origin = scope === 'local' ? home : (home ?? city ?? undefined);
  const distanceSuffix = home ? 'entfernt' : city && scope === 'de' ? `von ${city.label}` : undefined;
  const sort = filters.sort === 'entfernung' && !origin ? 'zeit' : filters.sort;
  const ranked = shown
    ? rankEvents(shown.events, { categories: filters.categories, text: filters.text, sort, interests, home: origin, now, windowFrom: win.from })
    : [];
  const groups = groupByDay(ranked, sort, win.from);
  const idsKey = ranked.map((r) => r.event.id).join('|');
  const mapEvents = useMemo(() => ranked.map((r) => r.event), [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const selItem = selected ? ranked.find((r) => r.event.id === selected.id) : undefined;
  const sameSpot = selItem?.event.location
    ? ranked.map((r) => r.event).filter((o) => o.id !== selItem.event.id && o.location && spotKey(o.location) === spotKey(selItem.event.location!))
    : [];
  const mapCenter = scope === 'local' ? home : (city ?? undefined);
  const mapRadius = scope === 'local' ? debRadius : city ? CITY_RADIUS_KM : undefined;

  const select = (id: string, from: 'list' | 'map') => {
    setSelected((s) => ({ id, token: (s?.token ?? 0) + 1 }));
    if (from === 'map') {
      requestAnimationFrame(() => document.querySelector(cardSelector(id))?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }));
    }
  };
  const closeDetail = () => {
    const id = selected?.id;
    setSelected(null);
    if (id) requestAnimationFrame(() => document.querySelector<HTMLElement>(`${cardSelector(id)} .card-title-btn`)?.focus());
  };

  const phrase = RANGES.find((r) => r.id === filters.range)?.phrase ?? '';
  const where =
    scope === 'local' ? `im Umkreis von ${radius} km um ${home?.label ?? ''}` : city ? `in und um ${city.label} (${CITY_RADIUS_KM} km)` : 'in ganz Deutschland';
  const countText = `${ranked.length} ${ranked.length === 1 ? 'Veranstaltung' : 'Veranstaltungen'} ${phrase} ${where}`;

  const suggestions: Suggestion[] = [];
  if (filters.text) suggestions.push({ label: 'Suche zurücksetzen', onClick: () => patch({ text: '' }) });
  if (filters.categories.length) suggestions.push({ label: 'Alle Kategorien zeigen', onClick: () => patch({ categories: [] }) });
  if (scope === 'local' && radius < 50) {
    const next = radius < 25 ? 25 : 50;
    suggestions.push({ label: `Umkreis auf ${next} km erweitern`, onClick: () => onRadiusChange(next) });
  }
  const widerRange: RangeId | null = filters.range === 'heute' || filters.range === 'morgen' || filters.range === 'wochenende' ? '7tage' : filters.range === '7tage' ? '14tage' : null;
  if (filters.range === 'heute') suggestions.push({ label: 'Morgen ansehen', onClick: () => patch({ range: 'morgen' }) });
  if (widerRange) suggestions.push({ label: `Nächste ${widerRange === '7tage' ? '7' : '14'} Tage`, onClick: () => patch({ range: widerRange }) });
  if (scope === 'de' && city) suggestions.push({ label: 'Ganz Deutschland', onClick: () => setCity(null) });
  if (scope === 'local') suggestions.push({ label: 'Deutschlandweit suchen', onClick: () => navigateTo('deutschland') });

  const failed = shown?.sources.filter((s) => !s.ok) ?? [];
  const hasIcs = status?.sources.some((s) => s.kind === 'ics');
  const title =
    scope === 'local' ? (filters.range === 'heute' ? 'Heute in deiner Nähe' : 'In deiner Nähe') : 'Deutschlandweit entdecken';

  return (
    <section className="view" aria-labelledby={`title-${scope}`}>
      <header className="view-head">
        <div>
          <h1 id={`title-${scope}`} className="view-title">{title}</h1>
          {scope === 'local' && home && (
            <p className="view-sub">
              <Icon name="pin" /> {home.label}{' '}
              <button type="button" className="link-btn" onClick={onEditLocation}>ändern</button>
            </p>
          )}
          {scope === 'de' && (
            <p className="view-sub">Stöbere ohne eigenen Standort – oder wähle eine Stadt.</p>
          )}
        </div>
      </header>

      <div className="layout has-map">
        <div className="controls">
          {scope === 'local' && <RadiusControl value={radius} onChange={onRadiusChange} />}

          {scope === 'de' && (
            <div className="panel region">
              <span className="label" id={`region-${scope}`}>Region</span>
              <div className="chips" role="group" aria-labelledby={`region-${scope}`}>
                <button type="button" className="chip" aria-pressed={!city} onClick={() => setCity(null)}>Ganz Deutschland</button>
                {CITIES.map((c) => (
                  <button key={c.label} type="button" className="chip" aria-pressed={city?.label === c.label} onClick={() => setCity(c)}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <FilterBar value={filters} onChange={patch} canSortByDistance={!!origin} hasInterests={interests.length > 0} />

          {interests.length === 0 && (
            <p className="hint">
              <button type="button" className="link-btn" onClick={onEditInterests}>Interessen wählen</button>, damit passende
              Veranstaltungen hervorgehoben werden.
            </p>
          )}

          {status?.mode === 'live' && !hasIcs && scope === 'local' && (
            <p className="hint">
              Vereins- und Stadtteilveranstaltungen erscheinen, sobald iCal-Kalender (z. B. von Stadt oder Vereinen) eingerichtet sind.
              Bis dahin stammen die Ergebnisse nur aus den aktiven Quellen.
            </p>
          )}
        </div>

        <div className="feed">
          {unconfigured ? (
            <EmptyState
              title="Noch keine Veranstaltungen"
              text="Umkreis erfindet keine Einträge. Sobald eine Datenquelle eingerichtet ist (siehe Hinweis oben), erscheinen hier echte Termine."
              suggestions={[]}
            />
          ) : error ? (
            <ErrorState message={error.message} onRetry={retry} suggestions={suggestions.filter((s) => !s.label.startsWith('Suche'))} />
          ) : !shown ? (
            <LoadingState />
          ) : (
            <>
              <div className="result-bar">
                <p className="result-count" role="status">
                  {loading ? 'Aktualisiere …' : countText}
                </p>
              </div>
              {failed.length > 0 && (
                <p className="alert alert-warn">
                  Nicht alle Quellen haben geantwortet: {failed.map((s) => `${s.name}${s.message ? ` (${s.message})` : ''}`).join('; ')}.
                  Die Liste kann deshalb unvollständig sein.
                </p>
              )}
              {shown.truncated && (
                <p className="alert alert-info">
                  {req?.scope === 'de'
                    ? 'Für ganz Deutschland gibt es mehr Treffer als angezeigt; gezeigt wird eine zufällige Auswahl. Mehr Termine einer Gegend siehst du mit einer Stadt oder deinem Standort.'
                    : 'Es gibt mehr Treffer als angezeigt. Grenze Zeitraum, Umkreis oder Suche ein.'}
                </p>
              )}
              {groups.length === 0 ? (
                <EmptyState
                  title={`Keine Veranstaltungen ${phrase} gefunden`}
                  text={
                    shown.events.length > 0
                      ? 'Mit den aktuellen Filtern bleibt nichts übrig – oder die Veranstaltungen sind schon vorbei.'
                      : `Für diesen Zeitraum liegen ${where} keine Einträge aus den verbundenen Quellen vor.`
                  }
                  suggestions={suggestions}
                />
              ) : (
                <EventList
                  groups={groups}
                  now={now}
                  distanceSuffix={distanceSuffix}
                  busy={loading}
                  selectedId={selItem?.event.id}
                  onSelect={select}
                  conflicts={conflicts}
                  openIn={openIn}
                  {...actions}
                />
              )}
            </>
          )}
        </div>

        <aside className="mapcol" aria-label="Karte und Details">
          <MapPanel
            pref={mapView}
            onPref={onMapView}
            tiles={tiles}
            events={mapEvents}
            center={mapCenter}
            radiusKm={mapRadius}
            selectedId={selItem?.event.id}
            onSelect={select}
            fitKey={req ? JSON.stringify([req.scope, req.lat, req.lon, req.radiusKm, req.from, req.to]) : 'none'}
          />
          {selItem && (
            <EventDetail
              item={selItem}
              distanceSuffix={distanceSuffix}
              now={now}
              conflicts={conflicts.get(selItem.event.id)}
              sameSpot={sameSpot}
              openIn={openIn}
              onSelect={(id) => select(id, 'list')}
              onClose={closeDetail}
              focusToken={selected!.token}
              {...actions}
            />
          )}
        </aside>
      </div>
    </section>
  );
}
