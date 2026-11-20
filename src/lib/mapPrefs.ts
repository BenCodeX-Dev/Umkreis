import type { MapProvider } from './maps.ts';

/**
 * Which map Umkreis draws itself. Only OpenStreetMap's public tiles work without an account;
 * Apple (MapKit JS) needs an Apple Developer Program membership plus a signed token, and
 * Google's Maps JavaScript API needs a key with billing. `null` = not decided yet: no tiles are
 * requested before the user agrees, because the tile server sees their IP and the map area.
 */
export type InAppMap = 'osm' | 'off';
export const MAP_VIEW_KEY = 'umkreis.mapView';
export const OPEN_IN_KEY = 'umkreis.openIn';

export const isInAppMapPref = (v: unknown): v is InAppMap | null => v === 'osm' || v === 'off' || v === null;
export const isMapProvider = (v: unknown): v is MapProvider => v === 'apple' || v === 'google' || v === 'here' || v === 'osm';

export const OPEN_IN_OPTIONS: ReadonlyArray<{ id: MapProvider; label: string }> = [
  { id: 'apple', label: 'Apple Karten' },
  { id: 'google', label: 'Google Maps' },
  { id: 'here', label: 'HERE WeGo' },
  { id: 'osm', label: 'OpenStreetMap' },
];

/** Apple Karten on Apple devices, Google Maps elsewhere – only a starting point, the user can change it. */
export function defaultOpenIn(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): MapProvider {
  return /Macintosh|iPhone|iPad/.test(userAgent) ? 'apple' : 'google';
}

/**
 * Street-level imagery per "open in" choice. Only Panoramax can be checked by Umkreis; for Apple
 * Look Around and Google Street View availability is only knowable through their developer APIs.
 */
export const STREET_LEVEL_NOTE: Record<MapProvider, string> = {
  apple: 'Ob Apple Look Around hier Bilder hat, lässt sich nur mit einem Apple-Entwicklerkonto (MapKit) prüfen – deshalb kein Link dorthin.',
  google: 'Ob Google Street View hier Bilder hat, lässt sich nur mit einem Google-API-Schlüssel prüfen – deshalb kein Link dorthin.',
  here: 'Für HERE WeGo prüft Umkreis keine Straßenbilder.',
  osm: 'OpenStreetMap selbst zeigt keine Straßenbilder; die freien Bilder kommen von Panoramax.',
};
