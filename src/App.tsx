import { useCallback, useEffect, useState } from 'react';
import { isCategoryId } from '../shared/categories.ts';
import type { CategoryId, EventItem, GeocodeResult } from '../shared/types.ts';
import { DiscoverView } from './components/DiscoverView.tsx';
import { Icon } from './components/Icon.tsx';
import { InterestsDialog } from './components/InterestsDialog.tsx';
import { LocationDialog } from './components/LocationDialog.tsx';
import { Onboarding } from './components/Onboarding.tsx';
import { SavedView } from './components/SavedView.tsx';
import { useHashRoute, useNotice, useNow, usePersistentState, useTheme, type Route } from './hooks/hooks.ts';
import { fetchStatus, sanitizeEvent, type ServerStatus } from './lib/api.ts';
import { formatShortDate, formatTime, isOver } from './lib/dates.ts';
import { isHomeLocation, type HomeLocation } from './lib/location.ts';
import { defaultOpenIn, isInAppMapPref, isMapProvider, MAP_VIEW_KEY, OPEN_IN_KEY, OPEN_IN_OPTIONS, type InAppMap } from './lib/mapPrefs.ts';
import type { MapProvider } from './lib/maps.ts';
import { readStored, removeStored, writeStored } from './lib/storage.ts';
import type { ThemePref } from './lib/theme.ts';

const HOME_KEY = 'umkreis.home';
const MAX_SAVED = 200;

const isRadius = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 50;
const isCategoryList = (v: unknown): v is CategoryId[] => Array.isArray(v) && v.every(isCategoryId);
const isSavedMap = (v: unknown): v is Record<string, EventItem> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((e) => sanitizeEvent(e) !== null);

const NAV: Array<{ route: Route; label: string }> = [
  { route: 'nah', label: 'In der Nähe' },
  { route: 'deutschland', label: 'Deutschlandweit' },
  { route: 'gemerkt', label: 'Gemerkt' },
];

const MAP_VIEW_OPTIONS: { id: InAppMap; label: string }[] = [
  { id: 'osm', label: 'OpenStreetMap' },
  { id: 'off', label: 'Keine Karte' },
];

const THEME_OPTIONS: { id: ThemePref; label: string }[] = [
  { id: 'auto', label: 'Automatisch' },
  { id: 'day', label: 'Tag' },
  { id: 'night', label: 'Nacht' },
];

function loadHome(): HomeLocation | undefined {
  const v = readStored(HOME_KEY);
  return isHomeLocation(v) ? v : undefined;
}

export function App() {
  const route = useHashRoute();
  const now = useNow();
  const [home, setHome] = useState<HomeLocation | undefined>(loadHome);
  const [rememberHome, setRememberHome] = useState(() => loadHome() !== undefined);
  const [radius, setRadius] = usePersistentState('umkreis.radius', 15, isRadius);
  const [interests, setInterests] = usePersistentState<CategoryId[]>('umkreis.interests', [], isCategoryList);
  const [saved, setSaved] = usePersistentState<Record<string, EventItem>>('umkreis.saved', {}, isSavedMap);
  const [dialog, setDialog] = useState<'location' | 'interests' | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [notice, notify] = useNotice();
  const { pref: themePref, setPref: setThemePref, theme } = useTheme();
  const [mapView, setMapView] = usePersistentState<InAppMap | null>(MAP_VIEW_KEY, null, isInAppMapPref);
  const [openIn, setOpenIn] = usePersistentState<MapProvider>(OPEN_IN_KEY, defaultOpenIn(), isMapProvider);

  // The home location is only persisted after an explicit opt-in.
  useEffect(() => {
    if (home && rememberHome) writeStored(HOME_KEY, home);
    else removeStored(HOME_KEY);
  }, [home, rememberHome]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchStatus(ctrl.signal).then((s) => {
      if (!ctrl.signal.aborted) setStatus(s);
    });
    return () => ctrl.abort();
  }, []);

  const setLocation = (h: HomeLocation, remember: boolean) => {
    setHome(h);
    setRememberHome(remember);
    setDialog(null);
    notify(`Standort gesetzt: ${h.label}${remember ? ' (auf diesem Gerät gemerkt)' : ''}`);
  };
  const pickCity = (c: GeocodeResult) => setLocation({ lat: c.lat, lon: c.lon, label: c.label, source: 'manual' }, false);
  const clearLocation = () => {
    setHome(undefined);
    setRememberHome(false);
    setDialog(null);
    notify('Standort entfernt.');
  };

  const isSaved = (id: string) => id in saved;
  const onToggleSave = (e: EventItem) => {
    if (saved[e.id]) {
      setSaved((s) => {
        const next = { ...s };
        delete next[e.id];
        return next;
      });
      notify('Aus „Gemerkt“ entfernt.');
    } else if (Object.keys(saved).length >= MAX_SAVED) {
      notify(`Es können höchstens ${MAX_SAVED} Veranstaltungen gemerkt werden. Entferne zuerst vergangene.`);
    } else {
      setSaved((s) => ({ ...s, [e.id]: e }));
      notify('Gemerkt – zu finden unter „Gemerkt“.');
    }
  };
  // Saved copies take over newer details (time, place, status, last check) whenever the event shows up in a search again.
  const refreshSaved = useCallback(
    (events: EventItem[]) =>
      setSaved((s) => {
        let next: Record<string, EventItem> | null = null;
        for (const e of events) {
          const old = s[e.id];
          if (old && !e.isDemo && e.checkedAt && e.checkedAt !== old.checkedAt) (next ??= { ...s })[e.id] = e;
        }
        return next ?? s;
      }),
    [setSaved],
  );
  const removePast = () => setSaved((s) => Object.fromEntries(Object.entries(s).filter(([, e]) => !isOver(e, now))));

  const onShare = async (e: EventItem) => {
    const text = `${e.isDemo ? '[Beispiel – keine echte Veranstaltung] ' : ''}${e.title} – ${formatShortDate(e.start)}, ${formatTime(e)}${e.venue ? `, ${e.venue}` : ''}`;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share(e.url ? { title: e.title, text, url: e.url } : { title: e.title, text });
        return;
      }
      await navigator.clipboard.writeText(e.url ? `${text}\n${e.url}` : text);
      notify(e.url ? 'Link zur Originalanzeige kopiert.' : 'Beschreibung kopiert.');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      notify('Teilen ist in diesem Browser nicht möglich.');
    }
  };

  const savedList = Object.values(saved);
  const cardActions = { isSaved, onToggleSave, onShare };
  const common = {
    ...cardActions,
    radius,
    onRadiusChange: setRadius,
    interests,
    now,
    status,
    home,
    onEditLocation: () => setDialog('location'),
    onEditInterests: () => setDialog('interests'),
    mapView,
    onMapView: setMapView,
    openIn,
    onResults: refreshSaved,
  };

  return (
    <>
      <a className="skip-link" href="#main">Zum Inhalt springen</a>
      <header className="site-header">
        <div className="container header-inner">
          <a className="brand" href="#nah" aria-label="Umkreis – Startseite">
            <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
              <circle cx="16" cy="16" r="13" />
              <circle cx="16" cy="16" r="6.5" className="brand-inner" />
              <circle cx="16" cy="16" r="2.4" className="brand-dot" />
            </svg>
            <span>Umkreis</span>
          </a>
          <div className="header-actions">
            <button type="button" className="pill" onClick={() => setDialog('location')}>
              <Icon name="pin" />
              <span className="pill-text">{home ? home.label : 'Standort wählen'}</span>
              {home && <span className="pill-meta">{radius} km</span>}
            </button>
            <button type="button" className="pill" onClick={() => setDialog('interests')}>
              <Icon name="star" filled={interests.length > 0} />
              <span>Interessen{interests.length > 0 ? ` (${interests.length})` : ''}</span>
            </button>
          </div>
          <button
            type="button"
            className="pill pill-icon theme-toggle"
            aria-label={theme === 'night' ? 'Tagesansicht einschalten' : 'Nachtansicht einschalten'}
            title={theme === 'night' ? 'Tagesansicht' : 'Nachtansicht'}
            onClick={() => setThemePref(theme === 'night' ? 'day' : 'night')}
          >
            <Icon name={theme === 'night' ? 'sun' : 'moon'} />
          </button>
        </div>
        <nav className="container tabs" aria-label="Ansichten">
          {NAV.map((n) => (
            <a key={n.route} href={`#${n.route}`} className="tab" aria-current={route === n.route ? 'page' : undefined}>
              {n.label}
              {n.route === 'gemerkt' && savedList.length > 0 && <span className="count">{savedList.length}</span>}
            </a>
          ))}
        </nav>
      </header>

      {status?.mode === 'demo' && (
        <div className="demo-banner" role="note">
          <div className="container">
            <strong>Demo-Modus:</strong> Es ist keine Datenquelle eingerichtet. Alle Einträge sind erfundene Beispiele mit
            simulierten Orten und Entfernungen – keine echten Veranstaltungen.
          </div>
        </div>
      )}

      <main id="main" className={`container main${route !== 'gemerkt' && (home || route === 'deutschland') ? ' is-wide' : ''}`} tabIndex={-1}>
        {route === 'gemerkt' ? (
          <SavedView saved={savedList} home={home} interests={interests} now={now} onRemovePast={removePast} openIn={openIn} {...cardActions} />
        ) : route === 'deutschland' ? (
          <DiscoverView key="de" scope="de" {...common} />
        ) : home ? (
          <DiscoverView key="local" scope="local" {...common} />
        ) : (
          <Onboarding onChooseLocation={() => setDialog('location')} onPickCity={pickCity} />
        )}
      </main>

      <footer className="site-footer">
        <div className="container footer-inner">
          <fieldset className="theme-choice">
            <legend>Darstellung</legend>
            <div className="segmented">
              {THEME_OPTIONS.map((o) => (
                <label key={o.id} className="segment">
                  <input type="radio" name="theme" checked={themePref === o.id} onChange={() => setThemePref(o.id)} />
                  <span>{o.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="theme-choice">
            <legend>Karte in der App</legend>
            <div className="segmented">
              {MAP_VIEW_OPTIONS.map((o) => (
                <label key={o.id} className="segment">
                  <input type="radio" name="mapview" checked={(mapView ?? 'off') === o.id} onChange={() => setMapView(o.id)} />
                  <span>{o.label}</span>
                </label>
              ))}
            </div>
            <p className="hint">
              Apple Maps (MapKit JS) bräuchte ein kostenpflichtiges Apple-Entwicklerkonto samt Token, Google Maps einen
              API-Schlüssel mit Abrechnung – beides ist hier nicht eingerichtet.
            </p>
          </fieldset>
          <fieldset className="theme-choice">
            <legend>Orte öffnen in</legend>
            <div className="segmented">
              {OPEN_IN_OPTIONS.map((o) => (
                <label key={o.id} className="segment">
                  <input type="radio" name="openin" checked={openIn === o.id} onChange={() => setOpenIn(o.id)} />
                  <span>{o.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p>
            <strong>Datenquellen:</strong>{' '}
            {status
              ? status.sources.map((s) => s.name).join(', ') || 'keine'
              : 'unbekannt'}
            . Alle Angaben ohne Gewähr – maßgeblich ist die verlinkte Originalanzeige.
          </p>
          <p>
            Ortssuche: Daten ©{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap-Mitwirkende</a>{' '}
            (ODbL), über Nominatim. Karte: Kacheln der OpenStreetMap Foundation. Straßenbilder: Panoramax
            (Lizenz je Bild, meist CC BY-SA 4.0).
          </p>
          <p>
            <strong>Datenschutz:</strong> Kein Tracking, keine Analyse, keine externen Schriften. Standorte werden auf ca. 1 km gerundet,
            nur im Hintergrund an den eigenen Server übermittelt und nur nach deiner Zustimmung lokal gespeichert. Interessen,
            gemerkte Veranstaltungen und die Darstellung bleiben in diesem Browser. Kartenlinks übergeben dem gewählten Kartendienst
            nur den Veranstaltungsort, nie deinen Standort. Die Karte lädt erst nach deiner Zustimmung Kacheln von
            tile.openstreetmap.org – dabei sehen deren Server deine IP-Adresse und den Kartenausschnitt. Straßenbilder werden nur
            auf Knopfdruck über den eigenen Server bei Panoramax gesucht, mit der Position des Veranstaltungsorts.
          </p>
        </div>
      </footer>

      <p className="toast" role="status" aria-live="polite">{notice}</p>

      <LocationDialog
        open={dialog === 'location'}
        home={home}
        remember={rememberHome}
        onClose={() => setDialog(null)}
        onSave={setLocation}
        onClear={clearLocation}
      />
      <InterestsDialog
        open={dialog === 'interests'}
        interests={interests}
        onClose={() => setDialog(null)}
        onSave={(v) => {
          setInterests(v);
          setDialog(null);
          notify(v.length ? 'Interessen gespeichert.' : 'Keine Interessen gewählt – nichts wird hervorgehoben.');
        }}
      />
    </>
  );
}
