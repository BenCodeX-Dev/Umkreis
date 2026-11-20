import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef } from 'react';
import type { EventItem, GeoPoint } from '../../shared/types.ts';
import { groupSpots, type MapSpot } from '../lib/spots.ts';

/**
 * OpenStreetMap's public tile server. Usage policy (https://operations.osmfoundation.org/policies/tiles/):
 * visible attribution, no bulk or offline downloading, honour caching. Nothing here prefetches tiles.
 */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap-Mitwirkende</a>';
const GERMANY: L.LatLngBoundsExpression = [
  [47.27, 5.87],
  [55.06, 15.04],
];

interface Props {
  events: EventItem[];
  /** Search centre – already rounded to ~1 km for the user's own location. */
  center?: GeoPoint;
  radiusKm?: number;
  selectedId?: string;
  onSelect: (id: string, from: 'map') => void;
  /** Changes whenever the search itself changes; the map then re-frames. */
  fitKey: string;
}

function pinLabel(s: MapSpot): string {
  const first = s.events[0];
  const where = first.venue ?? first.area ?? 'Ort';
  const what = s.events.length === 1 ? first.title : `${s.events.length} Veranstaltungen`;
  return `${what} – ${where}${s.approx ? ' (ungefähre Lage)' : ''}`;
}

function pinIcon(s: MapSpot, selected: boolean): L.DivIcon {
  const n = s.events.length;
  const cls = [
    'map-pin',
    `cat-${s.events[0].category}`,
    n > 1 && 'has-count',
    s.approx && 'is-approx',
    selected && 'is-selected',
    s.events.every((e) => e.status === 'cancelled') && 'is-cancelled',
  ]
    .filter(Boolean)
    .join(' ');
  const size = selected ? 34 : 24;
  // Only a number goes into the markup – titles and venues are set as properties, never as HTML.
  return L.divIcon({ className: cls, html: n > 1 ? `<span>${n > 99 ? '99+' : n}</span>` : '', iconSize: [size, size] });
}

export default function EventMap({ events, center, radiusKm, selectedId, onSelect, fitKey }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const pins = useRef<L.LayerGroup | null>(null);
  const overlay = useRef<L.LayerGroup | null>(null);
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);

  const spots = useMemo(() => groupSpots(events), [events]);

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { minZoom: 5, maxZoom: 19, zoomSnap: 0.5, scrollWheelZoom: true });
    m.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(m);
    m.fitBounds(GERMANY);
    overlay.current = L.layerGroup().addTo(m);
    pins.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = pins.current = overlay.current = null;
    };
  }, []);

  // Search area: the circle the server filtered by.
  useEffect(() => {
    const o = overlay.current;
    if (!o) return;
    o.clearLayers();
    if (!center) return;
    if (radiusKm) L.circle([center.lat, center.lon], { radius: radiusKm * 1000, className: 'map-radius', interactive: false }).addTo(o);
    L.marker([center.lat, center.lon], {
      icon: L.divIcon({ className: 'map-center', iconSize: [14, 14] }),
      interactive: false,
      keyboard: false,
      title: 'Suchmittelpunkt',
    }).addTo(o);
  }, [center?.lat, center?.lon, radiusKm]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const layer = pins.current;
    if (!layer) return;
    layer.clearLayers();
    for (const s of spots) {
      const selected = !!selectedId && s.events.some((e) => e.id === selectedId);
      const marker = L.marker([s.point.lat, s.point.lon], {
        icon: pinIcon(s, selected),
        title: pinLabel(s),
        alt: pinLabel(s),
        riseOnHover: true,
        zIndexOffset: selected ? 1000 : s.approx ? -100 : 0,
      });
      marker.on('click', () => {
        // Clicking a shared pin again steps through the events at that spot.
        const i = s.events.findIndex((e) => e.id === selectedId);
        select.current(s.events[(i + 1) % s.events.length].id, 'map');
      });
      marker.addTo(layer);
    }
  }, [spots, selectedId]);

  const hasSpots = spots.length > 0;
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (center && radiusKm) {
      m.fitBounds(L.latLng(center.lat, center.lon).toBounds(radiusKm * 2000), { padding: [16, 16] });
    } else if (hasSpots) {
      m.fitBounds(L.latLngBounds(spots.map((s) => [s.point.lat, s.point.lon])), { padding: [32, 32], maxZoom: 13 });
    } else {
      m.fitBounds(GERMANY);
    }
  }, [fitKey, hasSpots]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current;
    const e = selectedId ? events.find((x) => x.id === selectedId) : undefined;
    if (m && e?.location) m.panInside([e.location.lat, e.location.lon], { padding: [48, 48] });
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className="map-canvas" role="region" aria-label="Karte der Veranstaltungen (OpenStreetMap)" />;
}
