# Umkreis

Veranstaltungen, Partys, Konzerte, Märkte, Feste und Vereinstermine in der Nähe (Standard: 15 km, einstellbar 1–50 km) – heute und demnächst – plus eine deutschlandweite Entdecken-Ansicht.

React + TypeScript + Vite im Browser, ein kleiner Node-Server als API-Proxy (Schlüssel bleiben serverseitig). Keine Datenbank, kein Tracking. Änderungen pro Version: [CHANGELOG.md](CHANGELOG.md).

## Was die App kann

- **In der Nähe** – Veranstaltungen im gewählten Umkreis, nach Tagen gruppiert, sortierbar nach Zeit, Entfernung oder Interessen. Zeitraum: heute, morgen, Wochenende, 7 oder 14 Tage.
- **Deutschlandweit** – dieselben Filter ohne Umkreis, optional auf eine Stadt eingegrenzt.
- **Gemerkt** – vorgemerkte Veranstaltungen, nur in diesem Browser gespeichert.
- **Interessen** – gewählte Kategorien werden hervorgehoben, mit Begründung („passt zu deinem Interesse …“, „kostenlos“, „ganz in der Nähe“).
- **Pro Veranstaltung** – Kalendereintrag (`.ics` mit Erinnerung), Teilen, Link zur Originalanzeige und Kartenlinks zum Veranstaltungsort.
- **Ehrliche Angaben** – fehlende Preise, Zeiten oder Entfernungen heißen „unbekannt“; Entfernungen zur Ortsmitte sind als solche markiert; Beispieldaten sind durchgehend als Beispiel gekennzeichnet.

## Darstellung

Helles, warmes Tagesdesign im skandinavischen Stil (Leinen, Birke, Falunrot, Safran) und eine warme, gedämpfte Nachtansicht (Walnuss, Kerzenlicht) – kein kaltes Schwarz. Alle Text-Farbpaare erfüllen WCAG AA (Kontrast ≥ 4,5 : 1, nachgemessen für beide Ansichten).

- **Automatisch** (Standard) folgt der Hell-/Dunkel-Einstellung des Geräts und wechselt mit ihr.
- **Tag** / **Nacht** lassen sich über den Sonne-/Mond-Knopf oben rechts oder unten unter „Darstellung“ fest einstellen. Die Wahl bleibt in diesem Browser gespeichert und wird vor dem ersten Zeichnen angewendet (kein Aufblitzen).

## Kartenlinks

„Karte“ an einer Veranstaltung öffnet den Ort in **Apple Karten**, **Google Maps**, **HERE WeGo** oder **OpenStreetMap** (neuer Tab, keine eingebettete Karte, kein Kartenskript).

- Liefert die Quelle eine genaue Position, wird diese übergeben (auf 5 Nachkommastellen gekürzt).
- Ist die Position nur ungefähr (z. B. Ortsmitte eines Feeds), wird stattdessen nach Veranstaltungsort und Adresse gesucht – mit Hinweis, den Treffer zu prüfen. HERE wird dann nicht angeboten, weil der verwendete Linktyp Koordinaten braucht.
- Ohne Adresse oder Ortsangabe und bei Beispiel-Veranstaltungen gibt es keine Kartenlinks.
- Übergeben wird immer nur das Ziel, nie der eigene Standort.

URL-Formate laut Herstellerdokumentation: [Apple](https://developer.apple.com/documentation/mapkit/unified-map-urls), [Google](https://developers.google.com/maps/documentation/urls/get-started), [HERE](https://docs.here.com/wego-pro/docs/share-location-dl).

## Starten

Voraussetzung: Node ≥ 22.18 (läuft TypeScript direkt aus).

```bash
npm install
cp .env.example .env      # optional – ohne Quelle startet der Demo-Modus
npm run dev               # http://localhost:5173 (UI + /api im selben Prozess)
```

Produktion:

```bash
npm run build
npm start                 # http://127.0.0.1:8787, liefert dist/ + /api mit strikter CSP
```

Prüfen: `npm run check` (Typecheck, Lint, Tests, Build).

## Datenquellen

| Quelle | Deckt ab | Einrichtung |
|---|---|---|
| **Ticketmaster Discovery API** | Konzerte, Partys, Sport, Kultur mit Ticketverkauf | Kostenlosen Schlüssel holen auf developer.ticketmaster.com, in `.env` als `TICKETMASTER_API_KEY` |
| **iCal/ICS-Feeds** | Wochenmärkte, Vereins-, Stadt- und Gemeindekalender | `config/feeds.example.json` nach `config/feeds.json` kopieren und öffentliche `.ics`-Adressen eintragen |
| **Demo** | nichts Echtes | Nur aktiv, wenn keine Quelle eingerichtet ist (`DEMO_MODE=auto`). Einträge sind als „Beispiel“ markiert, haben keinen Link und simulierte Entfernungen. |

Feed-Eintrag (`config/feeds.json`):

```json
{ "id": "stadt-musterstadt", "name": "Veranstaltungen Musterstadt",
  "url": "https://…/kalender.ics", "website": "https://…/veranstaltungen",
  "category": "markt", "area": { "label": "Musterstadt", "lat": 49.87, "lon": 8.65 } }
```

- `category` (optional): Standard, wenn ein Termin keine erkennbare Kategorie hat – `konzert`, `party`, `markt`, `festival`, `community`, `kultur`, `sport`, `familie`, `sonstiges`.
- `area` (optional, empfohlen): Ortsmitte für Termine ohne `GEO`-Angabe. Solche Entfernungen werden als „(Ortsmitte)“ gekennzeichnet. Feeds ohne `area` und ohne `GEO` erscheinen nur deutschlandweit, nicht in der Umkreissuche.
- Nur Feeds verwenden, deren Nutzung erlaubt ist (öffentlich angebotene Kalender-Abos). Kein Scraping.

Weitere Variablen: siehe [.env.example](.env.example) (`DEMO_MODE`, `GEOCODER_URL`, `GEOCODER_USER_AGENT`, `PORT`, `HOST`). Für den öffentlichen Nominatim-Dienst muss `GEOCODER_USER_AGENT` die eigene Installation mit Kontakt angeben.

## Datenschutz

- Standort nur auf Wunsch: Ortssuche, Schnellauswahl oder – nach Klick – Gerätestandort (grobe Genauigkeit).
- Koordinaten werden im Browser und auf dem Server auf 2 Nachkommastellen (≈ 1 km) gerundet, per POST übertragen (nie in URLs) und nicht protokolliert. Keine Rückwärts-Geokodierung.
- Gespeichert wird der Standort nur mit Haken „Standort auf diesem Gerät merken“; „Standort entfernen“ löscht ihn. Interessen und gemerkte Veranstaltungen liegen nur im `localStorage` dieses Browsers.
- Keine Cookies, keine Analyse, keine externen Schriften oder Skripte. Schriften (Newsreader, Instrument Sans) werden mit ausgeliefert.
- Kartenlinks sind normale Links: Erst beim Anklicken erfährt der gewählte Kartendienst den Veranstaltungsort (und, wie bei jedem Seitenaufruf, die IP-Adresse). Es gilt dann dessen Datenschutzerklärung.
- Die gewählte Darstellung (Automatisch/Tag/Nacht) liegt im `localStorage`.

## Einschränkungen

- **Abdeckung hängt von den Quellen ab.** Ticketmaster listet vor allem Ticket-Veranstaltungen; Märkte, Flohmärkte und Vereinsfeste erscheinen nur, wenn passende iCal-Feeds eingetragen sind. Eine bundesweite offene Quelle dafür ist nicht eingebunden.
- Ticketmaster: höchstens 100 Treffer pro Anfrage (Hinweis „mehr Treffer als angezeigt“), Ratenlimit des kostenlosen Schlüssels (Werte laut Ticketmaster-Dokumentation). Ergebnisse werden 5 Minuten zwischengespeichert.
- ICS: Wiederholungen nach `DAILY`/`WEEKLY`/`MONTHLY`/`YEARLY` (inkl. `BYDAY`, `COUNT`, `UNTIL`, `EXDATE`). Andere Regeln (z. B. `HOURLY`, `BYSETPOS`) liefern nur den ersten Termin. Kategorien werden per Stichwort erraten. Grenzen pro Feed: 5 MB, 10 000 Termine, begrenzter Rechenaufwand für Wiederholungen – darüber erscheint der Hinweis „mehr Treffer als angezeigt“.
- Angaben (Zeiten, Preise, Absagen) stammen ungeprüft aus den Quellen – maßgeblich ist die verlinkte Originalanzeige.
- Ortssuche über Nominatim: nur auf Absenden, max. 1 Anfrage/s; bei Ausfall bleibt die Städte-Schnellauswahl.
- Ohne Server (rein statisch gehostet) funktioniert nur die Oberfläche, nicht die Datenabfrage.
- Kartenlinks: Die einheitlichen Apple-Karten-Links sind laut Apple für iOS 18.4 / macOS 15.4 und neuer dokumentiert; ältere Geräte öffnen sie im Browser (nicht auf allen Systemen geprüft). Die Adresssuche kann bei mehrdeutigen Namen einen falschen Ort treffen. Das OpenStreetMap-Suchformat ist nicht offiziell dokumentiert.
- Im Demo-Modus gibt es bewusst keine Kartenlinks – die Orte sind erfunden.
