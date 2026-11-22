import { useEffect, useState, type SubmitEvent } from 'react';
import { CATEGORIES } from '../../shared/categories.ts';
import type { GeocodeResult } from '../../shared/types.ts';
import {
  ApiError,
  checkSource,
  connectSource,
  geocodePlace,
  removeSource,
  sourceStatus,
  type ConnectCheck,
  type ConnectedSource,
  type ConnectState,
} from '../lib/api.ts';
import { readStored, writeStored } from '../lib/storage.ts';
import { Icon } from './Icon.tsx';
import { Modal } from './Modal.tsx';

interface Props {
  open: boolean;
  approval?: 'auto' | 'manual';
  onClose: () => void;
}

/** What this browser remembers about its own sign-ups. The key is the only way to manage them. */
interface Saved {
  id: string;
  key: string;
}

const STORE_KEY = 'umkreis.connections';
const META = (code: string) => `<meta name="umkreis-verification" content="${code}">`;

const STATE_LABEL: Record<ConnectState, string> = {
  pending: 'Wartet auf den Code',
  waiting: 'Bestätigt – wartet auf Freischaltung',
  active: 'Verbunden',
  withdrawn: 'Pausiert – Code fehlt',
  blocked: 'Gesperrt',
};

function loadSaved(): Saved[] {
  const v = readStored(STORE_KEY);
  return Array.isArray(v)
    ? v.filter((x): x is Saved => !!x && typeof x.id === 'string' && typeof x.key === 'string').slice(0, 20)
    : [];
}

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export function ConnectDialog(props: Props) {
  return (
    <Modal open={props.open} title="Kalender verbinden" onClose={props.onClose}>
      <ConnectFlow approval={props.approval} />
    </Modal>
  );
}

function ConnectFlow({ approval }: { approval?: 'auto' | 'manual' }) {
  const [saved, setSaved] = useState<Saved[]>(loadSaved);
  const [sources, setSources] = useState<Record<string, ConnectedSource>>({});
  const [checks, setChecks] = useState<Record<string, ConnectCheck | string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(saved.length === 0);
  const [gone, setGone] = useState(0);

  const persist = (list: Saved[]) => {
    setSaved(list);
    writeStored(STORE_KEY, list);
  };

  // Refresh the state of this browser's sign-ups each time the dialog opens.
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      loadSaved().map((s) =>
        sourceStatus(s.id, s.key).then(
          (src) => ({ s, src }),
          (err: unknown) => ({ s, src: null, missing: err instanceof ApiError && /gibt es nicht/.test(err.message) }),
        ),
      ),
    ).then((rows) => {
      if (cancelled) return;
      const found: Record<string, ConnectedSource> = {};
      for (const r of rows) if (r.src) found[r.s.id] = r.src;
      setSources(found);
      const missing = rows.filter((r) => 'missing' in r && r.missing).map((r) => r.s.id);
      if (missing.length) {
        setGone(missing.length);
        persist(loadSaved().filter((s) => !missing.includes(s.id)));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function check(s: Saved) {
    setBusy(s.id);
    try {
      const r = await checkSource(s.id, s.key);
      setSources((m) => ({ ...m, [s.id]: r.source }));
      setChecks((m) => ({ ...m, [s.id]: r.result }));
    } catch (err) {
      setChecks((m) => ({ ...m, [s.id]: errorText(err, 'Die Prüfung ist fehlgeschlagen.') }));
    } finally {
      setBusy(null);
    }
  }

  async function remove(s: Saved) {
    setBusy(s.id);
    try {
      await removeSource(s.id, s.key);
      persist(saved.filter((x) => x.id !== s.id));
    } catch (err) {
      setChecks((m) => ({ ...m, [s.id]: errorText(err, 'Entfernen ist fehlgeschlagen.') }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack connect">
      <p className="hint">
        Für Vereine, Bühnen und alle, die Veranstaltungen anbieten: Verbinde deinen Online-Kalender (iCal-Link) oder deine
        Veranstaltungsseite einmal – danach erscheinen neue Termine automatisch in Umkreis, mit Link zu deiner Seite. Du
        beweist mit einem Code, dass dir der Kalender gehört, und kannst die Verbindung jederzeit beenden.
      </p>
      {gone > 0 && <p className="alert alert-info">{gone === 1 ? 'Eine Anmeldung' : `${gone} Anmeldungen`} gibt es nicht mehr (nicht innerhalb von 48 Stunden bestätigt oder vom Betreiber entfernt).</p>}

      {saved.length > 0 && (
        <ul className="connect-list">
          {saved.map((s) => {
            const src = sources[s.id];
            const c = checks[s.id];
            return (
              <li key={s.id} className="connect-item">
                {src ? (
                  <>
                    <div className="connect-head">
                      <strong>{src.name}</strong>
                      <span className={`connect-state is-${src.status}`}>{STATE_LABEL[src.status]}</span>
                    </div>
                    <p className="hint connect-url">{src.url} · {src.area}</p>
                    {src.status !== 'active' && src.status !== 'blocked' && <CodeSteps source={src} />}
                  </>
                ) : (
                  <p className="hint">Wird geladen …</p>
                )}
                {typeof c === 'string' && <p className="alert alert-error" role="alert">{c}</p>}
                {c && typeof c !== 'string' && (
                  <p className={`alert ${c.codeFound ? 'alert-info' : 'alert-warn'}`} role="status">{c.message}</p>
                )}
                <div className="connect-actions">
                  {src?.status !== 'blocked' && (
                    <button type="button" className="btn btn-primary" onClick={() => check(s)} disabled={busy !== null}>
                      {busy === s.id ? 'Wird geprüft …' : 'Jetzt prüfen'}
                    </button>
                  )}
                  <button type="button" className="btn btn-quiet" onClick={() => remove(s)} disabled={busy !== null}>
                    Verbindung beenden
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {adding || saved.length === 0 ? (
        <ConnectForm
          approval={approval}
          onCreated={(src, key) => {
            setSources((m) => ({ ...m, [src.id]: src }));
            persist([{ id: src.id, key }, ...saved]);
            setAdding(false);
          }}
        />
      ) : (
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          <Icon name="calendar" /> Weiteren Kalender verbinden
        </button>
      )}
    </div>
  );
}

function CodeSteps({ source }: { source: ConnectedSource }) {
  const [copied, setCopied] = useState('');
  const web = source.format === 'web' || (!source.format && !/\.ics(\?|$)/i.test(source.url) && !/calendar|kalender|ical/i.test(source.url));
  const snippet = web ? META(source.code) : source.code;

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied('Kopiert.');
    } catch {
      setCopied('Kopieren nicht möglich – bitte markieren und kopieren.');
    }
  }

  return (
    <div className="stack-sm">
      {web ? (
        <p className="hint">
          Füge diese Zeile in den <code>&lt;head&gt;</code> deiner Seite ein (bei Baukästen meist unter „SEO“ oder „Code im
          Kopfbereich“). Die Termine liest Umkreis aus den schema.org-Daten der Seite, die viele Kalender-Erweiterungen für
          Suchmaschinen ausgeben (Seite per https erreichbar, höchstens 3 MB).
        </p>
      ) : (
        <p className="hint">
          Trag diesen Code in die Beschreibung des Kalenders ein (bei Google Kalender: Einstellungen des Kalenders → Beschreibung).
          Ein Code bei einem einzelnen Termin zählt nicht, weil manche Kalender Termine von allen annehmen.
          Kalenderdienste aktualisieren ihre Datei oft erst nach einigen Minuten bis Stunden; danach „Jetzt prüfen“.
        </p>
      )}
      <div className="code-box">
        <code>{snippet}</code>
        <button type="button" className="btn btn-quiet" onClick={copy}>Kopieren</button>
      </div>
      {copied && <p className="hint" role="status">{copied}</p>}
      <p className="hint">Lass den Code stehen, solange die Termine in Umkreis erscheinen sollen. Ohne Bestätigung verfällt die Anmeldung nach 48 Stunden.</p>
    </div>
  );
}

function ConnectForm({ approval, onCreated }: { approval?: 'auto' | 'manual'; onCreated: (s: ConnectedSource, key: string) => void }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [place, setPlace] = useState<GeocodeResult | null>(null);
  const [placeQuery, setPlaceQuery] = useState('');
  const [places, setPlaces] = useState<GeocodeResult[] | null>(null);
  const [category, setCategory] = useState('');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState<'place' | 'submit' | null>(null);
  const [error, setError] = useState('');

  async function findPlace() {
    if (placeQuery.trim().length < 2) {
      setError('Bitte mindestens zwei Zeichen für den Ort eingeben.');
      return;
    }
    setBusy('place');
    setError('');
    try {
      setPlaces((await geocodePlace(placeQuery.trim())).results);
    } catch (err) {
      setError(errorText(err, 'Die Ortssuche ist fehlgeschlagen.'));
    } finally {
      setBusy(null);
    }
  }

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!place) {
      setError('Bitte den Ort suchen und aus der Liste wählen.');
      return;
    }
    setBusy('submit');
    setError('');
    try {
      const r = await connectSource({ url: url.trim(), name: name.trim(), areaLabel: place.label, lat: place.lat, lon: place.lon, category: category || undefined, consent, website });
      onCreated(r.source, r.key);
    } catch (err) {
      setError(errorText(err, 'Die Anmeldung ist fehlgeschlagen.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <form className="stack-sm" onSubmit={submit}>
      <label className="label" htmlFor="cn-url">Adresse des Kalenders oder der Veranstaltungsseite</label>
      <input id="cn-url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… oder webcal://…" maxLength={500} />
      <p className="hint">Am besten der öffentliche iCal-Link (endet oft auf .ics; bei Google Kalender: „Öffentliche Adresse im iCal-Format“). Nur https.</p>

      <label className="label" htmlFor="cn-name">Name des Veranstalters</label>
      <input id="cn-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="z. B. Kulturverein Musterstadt" />

      <label className="label" htmlFor="cn-place">Ort der Veranstaltungen</label>
      {place ? (
        <div className="input-row">
          <p className="connect-place"><Icon name="pin" /> {place.label}</p>
          <button type="button" className="btn btn-quiet" onClick={() => setPlace(null)}>Ändern</button>
        </div>
      ) : (
        <>
          <div className="input-row">
            <input
              id="cn-place"
              type="search"
              value={placeQuery}
              onChange={(e) => setPlaceQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void findPlace();
                }
              }}
              placeholder="Stadt oder Postleitzahl"
              maxLength={80}
            />
            <button type="button" className="btn" onClick={findPlace} disabled={busy !== null}>
              {busy === 'place' ? 'Suche …' : 'Suchen'}
            </button>
          </div>
          {places && (places.length === 0 ? (
            <p className="hint">Kein Ort in Deutschland gefunden.</p>
          ) : (
            <ul className="choice-list">
              {places.slice(0, 5).map((r) => (
                <li key={`${r.label}-${r.lat}-${r.lon}`}>
                  <button type="button" className="choice" onClick={() => setPlace(r)}><Icon name="pin" /> {r.label}</button>
                </li>
              ))}
            </ul>
          ))}
          <p className="hint">Termine ohne genaue Ortsangabe werden ungefähr hier eingeordnet und so gekennzeichnet.</p>
        </>
      )}

      <label className="label" htmlFor="cn-cat">Art der Veranstaltungen (optional)</label>
      <select id="cn-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="">Aus jedem Termin erkennen</option>
        {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>

      <div className="visually-hidden" aria-hidden="true">
        <label htmlFor="cn-website">Bitte leer lassen</label>
        <input id="cn-website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      <label className="check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
        <span>
          Ich darf diese Termine veröffentlichen.
          <small>
            Umkreis zeigt Titel, Zeit, Ort, Preis, Beschreibung und einen Link zu deiner Seite und liest den Kalender regelmäßig
            neu. Entfernst du den Code oder beendest die Verbindung, verschwinden die Termine.
            {approval === 'manual' && ' Auf diesem Server schaltet der Betreiber neue Kalender von Hand frei.'}
          </small>
        </span>
      </label>

      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy !== null}>
        {busy === 'submit' ? 'Wird angemeldet …' : 'Kalender anmelden'}
      </button>
      <p className="hint">Zur Verwaltung merkt sich dieser Browser einen geheimen Schlüssel. Ohne ihn lässt sich die Anmeldung nur über den Code im Kalender beenden.</p>
    </form>
  );
}
