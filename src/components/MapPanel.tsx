import { lazy, Suspense } from 'react';
import { DEFAULT_TILES, type MapTiles } from '../../shared/mapTiles.ts';
import type { EventItem, GeoPoint } from '../../shared/types.ts';
import type { InAppMap } from '../lib/mapPrefs.ts';
import { Icon } from './Icon.tsx';

// Leaflet is only downloaded once the user has agreed to load map tiles.
const EventMap = lazy(() => import('./EventMap.tsx'));

interface Props {
  pref: InAppMap | null;
  onPref: (p: InAppMap) => void;
  events: EventItem[];
  center?: GeoPoint;
  radiusKm?: number;
  selectedId?: string;
  onSelect: (id: string, from: 'map') => void;
  fitKey: string;
  /** Undefined while the server status is still loading – no tile request goes out before the host is known. */
  tiles?: MapTiles;
}

export function MapPanel({ pref, onPref, tiles, ...map }: Props) {
  const placed = map.events.filter((e) => e.location).length;
  const approx = map.events.filter((e) => e.location && e.locationApprox).length;

  if (pref !== 'osm') {
    return (
      <div className="map-gate">
        <Icon name="map" />
        {pref === null ? (
          <>
            <p className="map-gate-title">Veranstaltungen auch auf der Karte zeigen?</p>
            <p>
              Die Karte kommt{' '}
              {!tiles ? 'von einem externen Kartendienst' : tiles.host === DEFAULT_TILES.host ? 'von den Servern der OpenStreetMap Foundation' : `vom Kartendienst ${tiles.host}`}.
              Der Kartendienst sieht dabei deine IP-Adresse und welchen Kartenausschnitt du ansiehst – nicht deinen gespeicherten Standort.
            </p>
          </>
        ) : (
          <p className="map-gate-title">Die Karte ist ausgeschaltet.</p>
        )}
        <div className="map-gate-actions">
          <button type="button" className="btn btn-primary btn-small" onClick={() => onPref('osm')}>Karte anzeigen</button>
          {pref === null && (
            <button type="button" className="btn btn-small" onClick={() => onPref('off')}>Ohne Karte</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="map-frame">
      <Suspense fallback={<div className="map-canvas map-loading">Karte wird geladen …</div>}>
        {tiles ? <EventMap {...map} tiles={tiles} /> : <div className="map-canvas map-loading">Karte wird geladen …</div>}
      </Suspense>
      <p className="map-legend">
        {map.events.length === 0
          ? 'Keine Veranstaltungen auf der Karte.'
          : placed === map.events.length
            ? `${placed} ${placed === 1 ? 'Eintrag' : 'Einträge'} auf der Karte.`
            : `${placed} von ${map.events.length} auf der Karte – für die übrigen nennt die Quelle keine Position.`}
        {approx > 0 && ' Gestrichelte Kreise: nur ungefähre Lage (Mittelpunkt des Kalendergebiets).'}
      </p>
    </div>
  );
}
