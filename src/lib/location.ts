import { coarsen, isInGermanyBounds, isValidPoint } from '../../shared/geo.ts';
import type { GeoPoint } from '../../shared/types.ts';

export interface HomeLocation extends GeoPoint {
  label: string;
  source: 'manual' | 'device';
}

export function isHomeLocation(v: unknown): v is HomeLocation {
  const h = v as HomeLocation;
  return isValidPoint(v) && typeof h.label === 'string' && (h.source === 'manual' || h.source === 'device');
}

/** Asks the browser for an approximate position (only after the user chose this) and rounds it to ~1 km. */
export function requestDeviceLocation(): Promise<HomeLocation> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Dein Browser unterstützt keine Standortabfrage. Bitte gib einen Ort ein.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = coarsen({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        if (!isInGermanyBounds(point)) {
          reject(new Error('Dein Standort scheint außerhalb Deutschlands zu liegen. Bitte gib einen Ort in Deutschland ein.'));
          return;
        }
        resolve({ ...point, label: 'Aktueller Standort (ungefähr)', source: 'device' });
      },
      (err) => {
        const msg =
          err.code === err.PERMISSION_DENIED
            ? 'Der Standortzugriff wurde nicht erlaubt. Du kannst stattdessen einen Ort eingeben.'
            : err.code === err.TIMEOUT
              ? 'Die Standortabfrage hat zu lange gedauert. Bitte erneut versuchen oder einen Ort eingeben.'
              : 'Der Standort konnte nicht ermittelt werden. Bitte gib einen Ort ein.';
        reject(new Error(msg));
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 },
    );
  });
}
