import { CITIES } from '../../shared/cities.ts';
import { offsetPoint } from '../../shared/geo.ts';
import { localDayKey, localParts, startOfLocalDay, zonedToUtc } from '../../shared/time.ts';
import type { CategoryId, EventItem, GeoPoint, PriceInfo } from '../../shared/types.ts';
import type { EventProvider } from './types.ts';

/**
 * Sample data for demo mode. Every item is flagged `isDemo`, has no link and is
 * described as invented — it must never be presented as a real event.
 */
interface Template { title: string; category: CategoryId; venue: string; hour: number; durationH?: number; price?: PriceInfo }

const T: Template[] = [
  { title: 'Wochenmarkt mit regionalen Erzeugern', category: 'markt', venue: 'Marktplatz', hour: 8, durationH: 5, price: { currency: 'EUR', free: true } },
  { title: 'Jazz-Abend im Gewölbekeller', category: 'konzert', venue: 'Gewölbekeller', hour: 20, price: { currency: 'EUR', min: 12 } },
  { title: 'Repair-Café: Reparieren statt wegwerfen', category: 'community', venue: 'Bürgerhaus', hour: 15, durationH: 3 },
  { title: 'Flohmarkt am Fluss', category: 'markt', venue: 'Uferpromenade', hour: 9, durationH: 6 },
  { title: 'Indie-Party: Hits der 2000er', category: 'party', venue: 'Club am Bahnhof', hour: 22, price: { currency: 'EUR', min: 8 } },
  { title: 'Lichterfest im Stadtpark', category: 'festival', venue: 'Stadtpark', hour: 17, durationH: 5 },
  { title: 'Altstadtführung bei Nacht', category: 'kultur', venue: 'Treffpunkt Rathaus', hour: 19, price: { currency: 'EUR', min: 10, max: 14 } },
  { title: 'Lauftreff für Einsteiger', category: 'sport', venue: 'Sportplatz Nord', hour: 18 },
  { title: 'Puppentheater: Der kleine Drache', category: 'familie', venue: 'Stadtbücherei', hour: 15, price: { currency: 'EUR', min: 5 } },
  { title: 'Lesung: Neue Stimmen aus der Region', category: 'kultur', venue: 'Buchhandlung am Eck', hour: 19 },
  { title: 'Nachbarschaftsfrühstück', category: 'community', venue: 'Gemeindezentrum', hour: 10, durationH: 2 },
  { title: 'Chorkonzert in der Stadtkirche', category: 'konzert', venue: 'Stadtkirche', hour: 18, price: { currency: 'EUR', free: true } },
];

/** Distances (km) and bearings chosen so some samples fall outside 15 km, showing the radius filter. */
const DISTANCES = [0.8, 2.5, 4.2, 7.5, 11, 14, 19, 28, 45];

export function createDemoProvider(now: () => Date = () => new Date()): EventProvider {
  return {
    id: 'demo',
    name: 'Demo-Daten (erfunden)',
    kind: 'demo',
    async fetchEvents(q) {
      const today = startOfLocalDay(now());
      const nowHour = localParts(now()).h;
      const events: EventItem[] = [];
      for (let day = 0; day < 31; day++) {
        const dayStart = startOfLocalDay(today, day);
        if (dayStart >= q.to) break;
        const p = localParts(dayStart);
        for (let k = 0; k < 4; k++) {
          const n = day * 4 + k;
          const t = T[(n * 5 + day) % T.length];
          let center: GeoPoint, area: string;
          if (q.center) {
            center = q.center;
            area = 'Beispielort';
          } else {
            const city = CITIES[n % CITIES.length];
            center = city;
            area = city.label;
          }
          const dist = DISTANCES[n % DISTANCES.length];
          const angle = (n * 137.5 * Math.PI) / 180;
          const hour = day === 0 ? Math.min(23, Math.max(t.hour, nowHour + 1 + k)) : t.hour;
          const start = zonedToUtc(p.y, p.m, p.d, hour, k % 2 ? 30 : 0);
          events.push({
            id: `demo:${q.center ? `${q.center.lat},${q.center.lon}` : 'de'}:${localDayKey(dayStart)}:${k}`,
            source: 'demo',
            sourceName: 'Demo-Daten (erfunden)',
            isDemo: true,
            title: t.title,
            start: start.toISOString(),
            end: t.durationH ? new Date(start.getTime() + t.durationH * 3_600_000).toISOString() : undefined,
            timeKnown: true,
            venue: `${t.venue} (Beispiel)`,
            area,
            location: offsetPoint(center, dist * Math.cos(angle), dist * Math.sin(angle)),
            category: t.category,
            price: t.price,
            description: 'Beispieleintrag im Demo-Modus. Diese Veranstaltung ist erfunden und findet nicht statt.',
          });
        }
      }
      return { events };
    },
  };
}
