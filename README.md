# Umkreis

Veranstaltungen, Partys, Konzerte, Märkte, Feste und Vereinstermine in der Nähe (Standard: 15 km, einstellbar 1–50 km) – heute und demnächst – als Liste und auf der Karte, plus eine deutschlandweite Entdecken-Ansicht. Läuft im Browser oder als Mac-App.

React + TypeScript + Vite für die Oberfläche, ein kleiner Node-Server als API-Proxy (Schlüssel bleiben serverseitig), für macOS ein schlankes natives Fenster darum. Keine Datenbank, kein Tracking. Änderungen pro Version: [CHANGELOG.md](CHANGELOG.md).

## Was die App kann

- **In der Nähe** – Veranstaltungen im gewählten Umkreis, nach Tagen gruppiert, sortierbar nach Zeit, Entfernung oder Interessen. Zeitraum: heute, morgen, Wochenende, 7 oder 14 Tage.
- **Deutschlandweit** – dieselben Filter ohne Umkreis, optional auf eine Stadt eingegrenzt.
- **Liste und Karte** – jede Veranstaltung mit bekannter Position erscheint als Stecknadel; Liste und Karte sind verbunden (Auswahl in einem markiert das andere). Mehrere Termine am selben Ort teilen sich eine Nadel mit Zahl.
- **Detailansicht** – Quelle, Ort, Datum und Uhrzeit, Entfernung, Preis, wann die Angaben zuletzt bei der Quelle abgerufen wurden, Link zur Originalanzeige, „Öffnen in …“ für den gewählten Kartendienst und – wo vorhanden – Straßenbilder.
- **Gemerkt** – vorgemerkte Veranstaltungen, nur auf diesem Gerät gespeichert.
- **Interessen** – gewählte Kategorien werden hervorgehoben, mit Begründung („passt zu deinem Interesse …“, „kostenlos“, „ganz in der Nähe“).
- **Pro Veranstaltung** – Kalendereintrag (`.ics` mit Erinnerung), Teilen, Link zur Originalanzeige und Kartenlinks zum Veranstaltungsort.

## Wie verlässlich die Angaben sind

Umkreis zeigt, was die Quellen melden – nicht mehr. Es gibt keine Garantie auf Vollständigkeit oder Richtigkeit, und „live“ ist nichts: Suchergebnisse werden bis zu 5 Minuten, iCal-Feeds bis zu 15 Minuten zwischengespeichert. Angezeigt wird immer der Zeitpunkt des tatsächlichen Abrufs bei der Quelle.

- **Zuletzt abgerufen** steht an jeder echten Veranstaltung. Älter als 24 Stunden → Marke „Älter als 24 Std.“ und ein Hinweis in der Detailansicht (z. B. bei gemerkten Einträgen).
- **Unvollständig** – fehlen Uhrzeit, Ort, Kartenposition oder Originalanzeige, nennt die Detailansicht genau das.
- **Widersprüchlich** – meldet eine zweite Quelle dieselbe Veranstaltung (gleicher Titel, gleicher Tag) mit anderer Uhrzeit, anderem Ort oder als abgesagt, wird das an beiden Einträgen angezeigt. Verglichen wird nur innerhalb der aktuellen Ergebnisse.
- **Ungefähre Lage** – Termine ohne eigene Koordinaten stehen an der Ortsmitte ihres Feeds (gestrichelte Nadel, Entfernung „zur Ortsmitte“).
- **Beispieldaten** – ohne eingerichtete Quelle zeigt Umkreis erfundene Einträge mit Banner, „Beispiel“-Marke, schraffierten Nadeln, ohne Links und mit simulierten Entfernungen.
- Fehlende Preise, Zeiten oder Entfernungen heißen „unbekannt“ und werden nie geschätzt.

## Darstellung

Helles, warmes Tagesdesign im skandinavischen Stil (Leinen, Birke, Falunrot, Safran) und eine warme, gedämpfte Nachtansicht (Walnuss, Kerzenlicht) – kein kaltes Schwarz. Alle Text-Farbpaare erfüllen WCAG AA (Kontrast ≥ 4,5 : 1, nachgemessen für beide Ansichten).

- **Automatisch** (Standard) folgt der Hell-/Dunkel-Einstellung des Geräts und wechselt mit ihr.
- **Tag** / **Nacht** lassen sich über den Sonne-/Mond-Knopf oben rechts oder unten unter „Darstellung“ fest einstellen. Die Wahl bleibt in diesem Browser gespeichert und wird vor dem ersten Zeichnen angewendet (kein Aufblitzen).

## Karte und Kartendienste

Kartenanzeige in der App und „Öffnen in …“ sind zwei getrennte Einstellungen (unten im Fuß der Seite). Kacheln, Bilder und Daten verschiedener Anbieter werden nie gemischt: Die eingebettete Karte nutzt nur OpenStreetMap, ein Klick auf „Öffnen in …“ übergibt nur das Ziel an den gewählten Dienst.

| Anbieter | In der App | Öffnen in … | Straßenbilder | Voraussetzungen |
|---|---|---|---|---|
| **OpenStreetMap** | ✓ (Leaflet, Kacheln der OSM Foundation) | ✓ | über Panoramax, wo vorhanden | keine; Nutzungsregeln der [Tile Policy](https://operations.osmfoundation.org/policies/tiles/) (Namensnennung, kein Massenabruf) |
| **Apple Karten** | – | ✓ (Standard auf dem Mac) | – | eingebettete Karte (MapKit JS) und Look Around bräuchten eine kostenpflichtige Apple-Developer-Mitgliedschaft und ein Token – nicht eingebaut |
| **Google Maps** | – | ✓ | – | eingebettete Karte und Street View bräuchten einen API-Schlüssel mit Abrechnung; Street View darf laut Google nicht mit fremden Karten kombiniert werden – nicht eingebaut |
| **HERE WeGo** | – | ✓ (nur bei genauer Position) | – | – |

- **Karte erst nach Zustimmung.** Beim ersten Mal fragt Umkreis, ob Kacheln von den OSM-Servern geladen werden dürfen (die sehen IP-Adresse und Kartenausschnitt). „Keine Karte“ ist jederzeit wählbar.
- **Öffnen in …** übergibt eine genaue Position (5 Nachkommastellen) oder – bei ungefährer Lage – eine Suche nach Ort und Adresse, mit Hinweis, den Treffer zu prüfen. Nie den eigenen Standort. Beispiel-Veranstaltungen haben keine Kartenlinks.
- **Straßenbilder** kommen von [Panoramax](https://panoramax.fr) (offene, OSM-nahe Bildersammlung, Lizenz je Bild, meist CC BY-SA 4.0). Erst auf Klick sucht der eigene Server im Umkreis von 50 m um den Veranstaltungsort; gibt es nichts, steht dort ausdrücklich „Nicht verfügbar: Panoramax hat im Umkreis von 50 m … keine Straßenbilder“. Vorschaubilder laufen über den eigenen Server, das volle Bild öffnet bei Panoramax. Nur innerhalb Deutschlands, nicht für ungefähre oder erfundene Orte.

URL-Formate laut Herstellerdokumentation: [Apple](https://developer.apple.com/documentation/mapkit/unified-map-urls), [Google](https://developers.google.com/maps/documentation/urls/get-started), [HERE](https://docs.here.com/wego-pro/docs/share-location-dl).

## Mac-App

Umkreis lässt sich als eigenständige Mac-App bauen und über Spotlight starten (⌘ Leertaste → „Umkreis“). Die App ist ein natives Fenster (AppKit + WebKit), das den mitgelieferten Node-Server nur auf `127.0.0.1` startet und die Oberfläche darin anzeigt – dieselbe App wie im Browser, ohne Browserleiste.

```bash
npm install
npm run mac        # baut build/mac.noindex/Umkreis.app und installiert nach ~/Applications
```

Nach `/Applications` statt `~/Applications`: `UMKREIS_INSTALL_DIR=/Applications npm run mac`. Nur bauen: `UMKREIS_NO_INSTALL=1 npm run mac`. Vor einer Neuinstallation die laufende App beenden.

- **Voraussetzungen zum Bauen:** macOS 13 oder neuer, Xcode-Befehlszeilenwerkzeuge (`swiftc`, `iconutil`), Node ≥ 22.18. Das Programm ist universell (Apple Silicon und Intel); getestet nur auf Apple Silicon.
- **Voraussetzung zum Ausführen: Node.js ≥ 22.18** muss auf dem Mac installiert sein (gesucht in `/opt/homebrew/bin`, `/usr/local/bin` und im Login-Shell-`PATH`; eigener Pfad über `UMKREIS_NODE`). Node wird nicht mitgeliefert. Fehlt es, zeigt die App eine Anleitung statt einer leeren Seite.
- **Echte Daten:** „Umkreis → Datenordner im Finder zeigen“ öffnet `~/Library/Application Support/Umkreis/`. Dort `.env` mit `TICKETMASTER_API_KEY=…` anlegen und/oder `feeds.example.json` nach `feeds.json` kopieren, dann die App neu starten (siehe `LIESMICH.txt` im Ordner).
- **Protokoll:** `~/Library/Logs/Umkreis/server.log` (ohne Koordinaten, wird bei jedem Start neu angelegt).
- **Verhalten:** Links zu Originalanzeigen und Kartendiensten öffnen außerhalb der App über macOS (Standardbrowser; ob Apple-Karten-Links direkt in Karten landen, hängt von der macOS-Version ab); Kalendereinträge öffnen Kalender, das vor dem Import selbst nachfragt. „Meinen aktuellen Standort verwenden“ fragt über die Ortungsdienste von macOS (Genauigkeit ca. 1 km). Die App nutzt fest Port 52715, damit gemerkte Einträge und Einstellungen erhalten bleiben; ist er belegt, sagt sie das.

### Signieren, Notarisierung, Weitergabe

Die gebaute App ist nur **ad hoc signiert**. Das reicht, um sie auf dem Mac zu starten, auf dem sie gebaut wurde. Sie ist **nicht** mit einer Developer ID signiert und **nicht** notarisiert und damit **nicht für die Weitergabe bereit**: Auf anderen Macs blockiert Gatekeeper eine heruntergeladene Kopie.

Für die Weitergabe bräuchte es:

1. eine Mitgliedschaft im [Apple Developer Program](https://developer.apple.com/programs/) (99 USD/Jahr) und ein „Developer ID Application“-Zertifikat,
2. Signieren mit Hardened Runtime (`codesign --options runtime --timestamp -s "Developer ID Application: …"`),
3. Notarisierung über `xcrun notarytool submit … --wait` und `xcrun stapler staple`,
4. eine Lösung für Node: entweder einen eigenen Node-Build mitliefern und mitsignieren oder die Voraussetzung dokumentieren. Der Homebrew-Node auf diesem Mac lässt sich nicht einfach einpacken, weil er gegen Homebrew-Bibliotheken gelinkt ist.

Nichts davon ist eingerichtet. Für den Mac App Store wäre zusätzlich eine Sandbox nötig, die einen mitgestarteten Node-Prozess erschwert.

## Im Browser starten

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
- Die eingebettete Karte lädt Kacheln erst nach Zustimmung von `tile.openstreetmap.org`; der OSM-Server sieht IP-Adresse und Kartenausschnitt, nicht den gespeicherten Standort. Straßenbilder werden erst auf Klick gesucht – der eigene Server fragt Panoramax mit der Position des Veranstaltungsorts, nicht mit deinem Standort.
- Kartenlinks sind normale Links: Erst beim Anklicken erfährt der gewählte Kartendienst den Veranstaltungsort (und, wie bei jedem Seitenaufruf, die IP-Adresse). Es gilt dann dessen Datenschutzerklärung.
- Die gewählte Darstellung, Kartenanzeige und „Öffnen in …“ liegen im `localStorage` (in der Mac-App im Speicher der App).

## Einschränkungen

- **Abdeckung hängt von den Quellen ab.** Ticketmaster listet vor allem Ticket-Veranstaltungen; Märkte, Flohmärkte und Vereinsfeste erscheinen nur, wenn passende iCal-Feeds eingetragen sind. Eine bundesweite offene Quelle dafür ist nicht eingebunden.
- Ticketmaster: höchstens 100 Treffer pro Anfrage (Hinweis „mehr Treffer als angezeigt“), Ratenlimit des kostenlosen Schlüssels (Werte laut Ticketmaster-Dokumentation). Ergebnisse werden 5 Minuten zwischengespeichert.
- ICS: Wiederholungen nach `DAILY`/`WEEKLY`/`MONTHLY`/`YEARLY` (inkl. `BYDAY`, `COUNT`, `UNTIL`, `EXDATE`). Andere Regeln (z. B. `HOURLY`, `BYSETPOS`) liefern nur den ersten Termin. Kategorien werden per Stichwort erraten. Grenzen pro Feed: 5 MB, 10 000 Termine, begrenzter Rechenaufwand für Wiederholungen – darüber erscheint der Hinweis „mehr Treffer als angezeigt“.
- Angaben (Zeiten, Preise, Absagen) stammen ungeprüft aus den Quellen – maßgeblich ist die verlinkte Originalanzeige.
- Ortssuche über Nominatim: nur auf Absenden, max. 1 Anfrage/s; bei Ausfall bleibt die Städte-Schnellauswahl.
- Ohne Server (rein statisch gehostet) funktioniert nur die Oberfläche, nicht die Datenabfrage.
- Kartenlinks: Die einheitlichen Apple-Karten-Links sind laut Apple für iOS 18.4 / macOS 15.4 und neuer dokumentiert; ältere Geräte öffnen sie im Browser (nicht auf allen Systemen geprüft). Die Adresssuche kann bei mehrdeutigen Namen einen falschen Ort treffen. Das OpenStreetMap-Suchformat ist nicht offiziell dokumentiert.
- Im Demo-Modus gibt es bewusst keine Kartenlinks und keine Straßenbilder – die Orte sind erfunden.
- Widersprüche werden nur zwischen Einträgen der aktuellen Ergebnisse erkannt, und nur bei gleichem Titel am gleichen Tag.
- Panoramax deckt Deutschland lückenhaft ab; meist gibt es keine Bilder. Abgefragt wird die öffentliche Instanz api.panoramax.xyz ohne Schlüssel; fällt sie aus, zeigt die Detailansicht einen Fehlerhinweis.
- Mac-App: nicht notarisiert, braucht ein installiertes Node.js, nur auf Apple Silicon unter macOS 27 getestet. Die Standortabfrage über die Ortungsdienste ist nicht durchgetestet (siehe CHANGELOG).
