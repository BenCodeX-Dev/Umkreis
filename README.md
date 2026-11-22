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
- **Keine Quelle, keine Einträge** – ohne eingerichtete Quelle bleibt die Liste leer, und ein Hinweis erklärt, wie man eine Quelle einrichtet. Umkreis erfindet nichts.
- Fehlende Preise, Zeiten oder Entfernungen heißen „unbekannt“ und werden nie geschätzt.

## Darstellung

Helles, warmes Tagesdesign im skandinavischen Stil (Leinen, Birke, Falunrot, Safran) und eine warme, gedämpfte Nachtansicht (Walnuss, Kerzenlicht) – kein kaltes Schwarz. Alle Text-Farbpaare erfüllen WCAG AA (Kontrast ≥ 4,5 : 1, nachgemessen für beide Ansichten).

- **Automatisch** (Standard) folgt der Hell-/Dunkel-Einstellung des Geräts und wechselt mit ihr.
- **Tag** / **Nacht** lassen sich über den Sonne-/Mond-Knopf oben rechts oder unten unter „Darstellung“ fest einstellen. Die Wahl bleibt in diesem Browser gespeichert und wird vor dem ersten Zeichnen angewendet (kein Aufblitzen).

## Karte und Kartendienste

Kartenanzeige in der App und „Öffnen in …“ sind zwei getrennte Einstellungen (unten im Fuß der Seite). Kacheln, Bilder und Daten verschiedener Anbieter werden nie gemischt: Die eingebettete Karte nutzt nur OpenStreetMap, ein Klick auf „Öffnen in …“ übergibt nur das Ziel an den gewählten Dienst.

| Anbieter | Karte in der App | „Öffnen in …“ | Straßenbilder |
|---|---|---|---|
| **OpenStreetMap** | ✓ | ✓ | ✓ (Panoramax) |
| **Apple Karten** | nein ¹ | ✓ (Standard) | nein ¹ |
| **Google Maps** | nein ² | ✓ | nein ² |
| **HERE WeGo** | nein | ✓ ³ | nein |

1. Eingebettete Apple-Karte (MapKit JS) und Look Around bräuchten eine kostenpflichtige Apple-Developer-Mitgliedschaft und ein Token.
2. Eingebettete Google-Karte und Street View bräuchten einen API-Schlüssel mit Abrechnung; Street View darf laut Google nicht mit fremden Karten kombiniert werden.
3. Nur bei genauer Position.

Die Karte in der App nutzt Leaflet mit Kacheln der OSM Foundation. Deren [Tile Policy](https://operations.osmfoundation.org/policies/tiles/) verlangt Namensnennung und verbietet Massenabruf – für eine öffentliche Seite mit vielen Besuchern einen eigenen Kacheldienst einstellen (`MAP_TILE_URL`, siehe „Öffentlich betreiben“).

- **Karte erst nach Zustimmung.** Beim ersten Mal fragt Umkreis, ob Kacheln von den OSM-Servern geladen werden dürfen (die sehen IP-Adresse und Kartenausschnitt). „Keine Karte“ ist jederzeit wählbar.
- **Öffnen in …** übergibt eine genaue Position (5 Nachkommastellen) oder – bei ungefährer Lage – eine Suche nach Ort und Adresse, mit Hinweis, den Treffer zu prüfen. Nie den eigenen Standort.
- **Straßenbilder** kommen von [Panoramax](https://panoramax.fr) (offene, OSM-nahe Bildersammlung, Lizenz je Bild, meist CC BY-SA 4.0). Erst auf Klick sucht der eigene Server im Umkreis von 50 m um den Veranstaltungsort; gibt es nichts, steht dort ausdrücklich „Nicht verfügbar: Panoramax hat im Umkreis von 50 m … keine Straßenbilder“. Vorschaubilder laufen über den eigenen Server, das volle Bild öffnet bei Panoramax. Nur innerhalb Deutschlands, nicht für ungefähre Orte.

URL-Formate laut Herstellerdokumentation: [Apple](https://developer.apple.com/documentation/mapkit/unified-map-urls), [Google](https://developers.google.com/maps/documentation/urls/get-started), [HERE](https://docs.here.com/wego-pro/docs/share-location-dl).

## Mac-App

Umkreis lässt sich als eigenständige Mac-App bauen und über Spotlight starten (⌘ Leertaste → „Umkreis“). Die App ist ein natives Fenster (AppKit + WebKit), das den mitgelieferten Node-Server nur auf `127.0.0.1` startet und die Oberfläche darin anzeigt – dieselbe App wie im Browser, ohne Browserleiste.

```bash
npm install
npm run mac        # baut build/mac.noindex/Umkreis.app und installiert nach ~/Applications
```

Nach `/Applications` statt `~/Applications`: `UMKREIS_INSTALL_DIR=/Applications npm run mac`. Nur bauen: `UMKREIS_NO_INSTALL=1 npm run mac`. Vor einer Neuinstallation die laufende App beenden.

- **Voraussetzungen zum Bauen:** macOS 13 oder neuer, Xcode-Befehlszeilenwerkzeuge (`swiftc`, `iconutil`), Node ≥ 22.18. Das Programm ist universell (Apple Silicon und Intel); getestet nur auf Apple Silicon.
- **Node.js ist dabei:** `npm run mac` legt die offizielle Node.js-LTS-Version für Apple Silicon von nodejs.org bei (≈ 58 MB Download, einmalig in `build/node-cache`; die App wird ≈ 143 MB groß). Das Archiv wird gegen eine im Skript festgeschriebene SHA-256-Prüfsumme geprüft und sonst verworfen; die Prüfsumme stammt aus der mit einem Node.js-Release-Schlüssel signierten `SHASUMS256.txt`. Auf Intel-Macs oder mit `UMKREIS_BUNDLE_NODE=0` braucht die App ein installiertes Node.js ≥ 22.18 (gesucht in `/opt/homebrew/bin`, `/usr/local/bin` und im Login-Shell-`PATH`; eigener Pfad über `UMKREIS_NODE`, hat Vorrang). Fehlt es, zeigt die App eine Anleitung statt einer leeren Seite. Für Sicherheitsupdates von Node `NODE_VERSION` und `NODE_SHA256` in `scripts/build-mac.sh` anheben und neu bauen.
- **Echte Daten:** „Umkreis → Datenordner im Finder zeigen“ öffnet `~/Library/Application Support/Umkreis/`. Dort `.env` mit `TICKETMASTER_API_KEY=…` anlegen und/oder `feeds.example.json` nach `feeds.json` kopieren, dann die App neu starten (siehe `LIESMICH.txt` im Ordner).
- **Protokoll:** `~/Library/Logs/Umkreis/server.log` (ohne Koordinaten, wird bei jedem Start neu angelegt).
- **Verhalten:** Links zu Originalanzeigen und Kartendiensten öffnen außerhalb der App über macOS (Standardbrowser; ob Apple-Karten-Links direkt in Karten landen, hängt von der macOS-Version ab); Kalendereinträge öffnen Kalender, das vor dem Import selbst nachfragt. „Meinen aktuellen Standort verwenden“ fragt über die Ortungsdienste von macOS (Genauigkeit ca. 1 km). Die App nutzt fest Port 52715, damit gemerkte Einträge und Einstellungen erhalten bleiben; ist er belegt, sagt sie das.

### Signieren, Notarisierung, Weitergabe

Die gebaute App ist nur **ad hoc signiert**. Das reicht, um sie auf dem Mac zu starten, auf dem sie gebaut wurde. Sie ist **nicht** mit einer Developer ID signiert und **nicht** notarisiert und damit **nicht für die Weitergabe bereit**: Auf anderen Macs blockiert Gatekeeper eine heruntergeladene Kopie.

Für die Weitergabe bräuchte es:

1. eine Mitgliedschaft im [Apple Developer Program](https://developer.apple.com/programs/) (99 USD/Jahr) und ein „Developer ID Application“-Zertifikat,
2. Signieren mit Hardened Runtime (`codesign --options runtime --timestamp -s "Developer ID Application: …"`),
3. Notarisierung über `xcrun notarytool submit … --wait` und `xcrun stapler staple`,
4. für das mitgelieferte Node.js: Es trägt bereits die Developer-ID-Signatur (mit Hardened Runtime) der Node.js-Entwickler. Ob die Notarisierung das so annimmt oder Node mit dem eigenen Zertifikat (und JIT-Berechtigung) neu signiert werden muss, ist nicht geprüft.

Nichts davon ist eingerichtet. Für den Mac App Store wäre zusätzlich eine Sandbox nötig, die einen mitgestarteten Node-Prozess erschwert.

## Im Browser starten

Voraussetzung: Node ≥ 22.18 (läuft TypeScript direkt aus).

```bash
npm install
cp .env.example .env      # Ticketmaster-Schlüssel eintragen – ohne Quelle bleibt die Liste leer
npm run dev               # http://localhost:5173 (UI + /api im selben Prozess)
```

Produktion:

```bash
npm run build
npm start                 # http://127.0.0.1:8787, liefert dist/ + /api mit strikter CSP
```

Prüfen: `npm run check` (Typecheck, Lint, Tests, Build). Auf GitHub läuft dieselbe Prüfung bei jedem Push und Pull Request (Node 22.18 und aktuelles LTS); Dependabot schlägt wöchentlich Updates für npm-Pakete und Actions vor.

## Öffentlich betreiben

Umkreis ist ein einzelner Node-Prozess ohne Datenbank. Für eine Website, die andere nutzen:

1. **Host mit dauerhaft laufendem Node ≥ 22.18** (eigener Server/VPS oder eine Plattform für Node-Dienste). Dort `npm ci && npm run build && npm start`, mit Prozess-Manager (z. B. systemd), der bei Absturz neu startet. Rein statisches Hosting reicht nicht – die API muss mitlaufen.
2. **HTTPS:** TLS und HSTS am Reverse-Proxy (z. B. Caddy, nginx) oder an der Plattform. Server dahinter auf `HOST=127.0.0.1`, `ALLOWED_HOSTS=dein-name.de`, `TRUST_PROXY=1`.
3. **Kartenkacheln:** Die freien Kacheln der OSM Foundation sind nicht für viel Verkehr gedacht. `MAP_TILE_URL` (nur `https`, mit `{z}`, `{x}`, `{y}`) und `MAP_TILE_ATTRIBUTION` auf einen eigenen oder gebuchten Kacheldienst setzen; dessen Host kommt automatisch in die CSP, Zustimmungstext und Fußzeile nennen ihn.
4. **Ortssuche:** Der öffentliche Nominatim-Dienst erlaubt höchstens 1 Anfrage pro Sekunde für alle Besucher zusammen. `GEOCODER_USER_AGENT` mit Kontakt setzen; bei mehr Verkehr `GEOCODER_URL` auf einen eigenen oder gebuchten Nominatim-kompatiblen Dienst.
5. **Impressum und Datenschutzerklärung:** `config/impressum.example.txt` → `config/impressum.txt` und `config/datenschutz.example.txt` → `config/datenschutz.txt` kopieren und ausfüllen. Sie erscheinen als Links in der Fußzeile. Ohne Impressum warnt der Server beim Start, wenn er nicht nur auf 127.0.0.1 läuft. Die Vorlagen beschreiben, was Umkreis selbst tut; Hoster-Protokolle und Rechtsgrundlagen selbst prüfen – keine Rechtsberatung.
6. **Bedingungen der Quellen** prüfen: Ticketmaster-Nutzungsbedingungen, Lizenzen der iCal-Kalender; destination.one nur PD/CC0 (siehe unten).

## Datenquellen

| Quelle | Deckt ab | Einrichtung |
|---|---|---|
| **destination.one Open Data** | Märkte, Ausstellungen, Führungen, Konzerte, Feste aus den Veranstaltungsdatenbanken deutscher Tourismusregionen | Ohne Schlüssel, standardmäßig an. Abschalten mit `DESTINATION_ONE=off` |
| **Ticketmaster Discovery API** | Konzerte, Partys, Sport, Kultur mit Ticketverkauf | Kostenlosen Schlüssel holen auf developer.ticketmaster.com, in `.env` als `TICKETMASTER_API_KEY` |
| **iCal/ICS-Feeds** | Wochenmärkte, Vereins-, Stadt- und Gemeindekalender | `config/feeds.example.json` nach `config/feeds.json` kopieren und öffentliche `.ics`-Adressen eintragen |

**destination.one:** Daten von [open.destination.one](https://open.destination.one) (Open-Data-Schnittstelle der Tourismusregionen). Umkreis übernimmt nur Einträge unter Public Domain oder CC0. Einträge unter CC BY / CC BY-SA werden ausgelassen, weil dort meist kein Urheber genannt ist, den man korrekt angeben könnte. Die Abdeckung ist regional sehr unterschiedlich: Manche Gegenden liefern Hunderte Termine, andere fast keine. Pro Anfrage werden höchstens 300 Einträge geladen; gibt es mehr, meldet die App „gekürzt“.

**Bekannte öffentliche iCal-Feeds** (Abo-Adressen, die der Anbieter selbst zum Abonnieren anbietet): szene-Radar für Karlsruhe (`https://karlsruhe.szene-radar.de/ical/feed.ics`) und Freiburg (`https://freiburg.szene-radar.de/ical/feed.ics`), Konzerte und Clubabende.

Eine einzige Quelle für „alle“ Veranstaltungen in Deutschland gibt es nicht. Weitere Möglichkeiten: Ticketmaster (eigener kostenloser Schlüssel) und der DZT Knowledge Graph (Schlüssel auf Antrag, noch nicht angebunden).

Feed-Eintrag (`config/feeds.json`):

```json
{ "id": "stadt-musterstadt", "name": "Veranstaltungen Musterstadt",
  "url": "https://…/kalender.ics", "website": "https://…/veranstaltungen",
  "category": "markt", "area": { "label": "Musterstadt", "lat": 49.87, "lon": 8.65 } }
```

- `category` (optional): Standard, wenn ein Termin keine erkennbare Kategorie hat – `konzert`, `party`, `markt`, `festival`, `community`, `kultur`, `sport`, `familie`, `sonstiges`.
- `area` (optional, empfohlen): Ortsmitte für Termine ohne `GEO`-Angabe. Solche Entfernungen werden als „(Ortsmitte)“ gekennzeichnet. Feeds ohne `area` und ohne `GEO` erscheinen nur deutschlandweit, nicht in der Umkreissuche.
- `area.radiusKm` (optional, 1–500, Standard 50): Wie weit Termine des Kalenders von der Ortsmitte entfernt liegen dürfen. Eine `GEO`-Angabe weiter weg – oder außerhalb Deutschlands – gilt als unplausibel (Tippfehler, vertauschte Werte, falsche Angaben) und wird nicht verwendet; der Termin bekommt dann die Ortsmitte als ungefähre Lage, und die Detailansicht sagt, warum. Für landesweite Kalender `radiusKm` entsprechend erhöhen.
- Nur Feeds verwenden, deren Nutzung erlaubt ist (öffentlich angebotene Kalender-Abos). Kein Scraping.

Weitere Variablen: siehe [.env.example](.env.example) (`GEOCODER_URL`, `GEOCODER_USER_AGENT`, `PORT`, `HOST`, `ALLOWED_HOSTS`, `TRUST_PROXY`, `MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION`, `IMPRESSUM_FILE`, `PRIVACY_FILE`). Wer `HOST` auf `0.0.0.0` oder eine öffentliche Adresse setzt, muss `ALLOWED_HOSTS` mit dem eigenen Hostnamen setzen – sonst warnt der Server beim Start und beantwortet jeden Hostnamen. Für den öffentlichen Nominatim-Dienst muss `GEOCODER_USER_AGENT` die eigene Installation mit Kontakt angeben.

## Datenschutz

- Standort nur auf Wunsch: Ortssuche, Schnellauswahl oder – nach Klick – Gerätestandort (grobe Genauigkeit).
- Koordinaten werden im Browser und auf dem Server auf 2 Nachkommastellen (≈ 1 km) gerundet, per POST übertragen (nie in URLs) und nicht protokolliert. Keine Rückwärts-Geokodierung.
- Gespeichert wird der Standort nur mit Haken „Standort auf diesem Gerät merken“; „Standort entfernen“ löscht ihn. Interessen und gemerkte Veranstaltungen liegen nur im `localStorage` dieses Browsers.
- Keine Cookies, keine Analyse, keine externen Schriften oder Skripte. Schriften (Newsreader, Instrument Sans) werden mit ausgeliefert.
- Die eingebettete Karte lädt Kacheln erst nach Zustimmung von `tile.openstreetmap.org` (oder dem mit `MAP_TILE_URL` eingestellten Dienst); der Kachelserver sieht IP-Adresse und Kartenausschnitt, nicht den gespeicherten Standort. Straßenbilder werden erst auf Klick gesucht – der eigene Server fragt Panoramax mit der Position des Veranstaltungsorts, nicht mit deinem Standort.
- Kartenlinks sind normale Links: Erst beim Anklicken erfährt der gewählte Kartendienst den Veranstaltungsort (und, wie bei jedem Seitenaufruf, die IP-Adresse). Es gilt dann dessen Datenschutzerklärung.
- Die gewählte Darstellung, Kartenanzeige und „Öffnen in …“ liegen im `localStorage` (in der Mac-App im Speicher der App).

## Sicherheit

Was eingebaut ist – keine Zertifizierung, keine Garantie; Funde bitte melden.

- **Daten aus Quellen gelten als nicht vertrauenswürdig.** Titel und Texte werden als reiner Text dargestellt (HTML wird entfernt), Links nur mit `http`/`https` übernommen. Unter jeder Originalanzeige steht, zu welcher Domain der Link führt (bei `http` mit Hinweis auf die unverschlüsselte Verbindung) – Umkreis prüft nicht, ob die Seite wirklich zum Veranstalter gehört. Internationalisierte Domains erscheinen in der `xn--`-Form, damit Doppelgänger-Domains auffallen.
- **Abrufe von Bildadressen aus Fremddaten** (Panoramax-Vorschaubilder) gehen nur per `https` an öffentliche IP-Adressen; Adressen im eigenen Netz (127.0.0.1, 192.168.x.x usw.) werden auch dann abgelehnt, wenn ein öffentlicher Name dorthin zeigt.
- **Missbrauchsschutz der API:** Pro Client 60 Anfragen auf einmal, danach 1 pro Sekunde, für alle zusammen 300 bzw. 5 pro Sekunde; darüber antwortet der Server mit `429` und `Retry-After`. Höchstens 5 Ortssuchen warten gleichzeitig auf Nominatim, weitere bekommen sofort die Städte-Schnellauswahl. Gleiche Anfragen, die gleichzeitig eintreffen, teilen sich einen Abruf bei der Quelle. Hinter einem eigenen Reverse-Proxy `TRUST_PROXY=1` setzen, damit jeder Client nach der vom Proxy gemeldeten Adresse (letzter `X-Forwarded-For`-Eintrag) zählt – nur, wenn der Server ausschließlich über diesen Proxy erreichbar ist; sonst teilen sich alle Clients ein Kontingent.
- **Host-Prüfung** gegen DNS-Rebinding (`ALLOWED_HOSTS`, auf 127.0.0.1/localhost automatisch), strikte CSP, `Cross-Origin-Resource-Policy`/`-Opener-Policy: same-origin`, `nosniff`, `frame-ancestors 'none'`.
- **Ortsangaben der Quellen** werden auf Plausibilität geprüft: `GEO` aus iCal-Feeds nur innerhalb Deutschlands und im Umkreis des Kalendergebiets (`area.radiusKm`). Ob eine plausible Position stimmt, kann Umkreis nicht prüfen.
- **Standort** gilt als nicht vertrauenswürdige, grobe Angabe: Er wird überall auf ≈ 1 km gerundet (auch in der Mac-App, bevor er die Seite erreicht) und nur für die Umkreissuche benutzt. Ein vorgetäuschter Gerätestandort lässt sich nicht erkennen; er verändert nur die eigene Suche.
- **Verschlüsselung:** Abrufe bei Ticketmaster, Nominatim, Panoramax und die Kartenkacheln laufen über HTTPS; iCal-Feeds so verschlüsselt, wie ihre Adresse es vorgibt (`https` verwenden, wo angeboten). Die Mac-App spricht mit ihrem Server nur über 127.0.0.1 – diese Verbindung verlässt den Rechner nicht. Der Node-Server selbst spricht nur HTTP: Wer Umkreis öffentlich betreibt, braucht TLS (und HSTS) am Host oder Reverse-Proxy. Der Server speichert nichts dauerhaft, nur kurzlebige Zwischenspeicher im Arbeitsspeicher. Gemerktes und Einstellungen liegen unverschlüsselt im Browser-Speicher des Geräts – geschützt durch die Geräteverschlüsselung (z. B. FileVault), nicht durch Umkreis.
- **Schlüssel** stehen nur in `.env` (nie im Repository; `.gitignore`). Die Mac-App macht ihren Datenordner und die `.env` darin bei jedem Start nur für den eigenen Benutzer lesbar.
- **Mac-App:** Das Fenster lädt nur die eigene Adresse; alle anderen Links öffnen im Standardbrowser, Downloads außer Kalenderdateien werden nur im Finder gezeigt, nicht geöffnet.

## Einschränkungen

- **Abdeckung hängt von den Quellen ab.** Ticketmaster listet vor allem Ticket-Veranstaltungen; Märkte, Flohmärkte und Vereinsfeste erscheinen nur, wenn passende iCal-Feeds eingetragen sind. Eine bundesweite offene Quelle dafür ist nicht eingebunden.
- Ticketmaster: höchstens 100 Treffer pro Anfrage (Hinweis „mehr Treffer als angezeigt“), Ratenlimit des kostenlosen Schlüssels (Werte laut Ticketmaster-Dokumentation). Ergebnisse werden 5 Minuten zwischengespeichert.
- ICS: Wiederholungen nach `DAILY`/`WEEKLY`/`MONTHLY`/`YEARLY` (inkl. `BYDAY`, `COUNT`, `UNTIL`, `EXDATE`). Andere Regeln (z. B. `HOURLY`, `BYSETPOS`) liefern nur den ersten Termin. Kategorien werden per Stichwort erraten. Grenzen pro Feed: 5 MB, 10 000 Termine, begrenzter Rechenaufwand für Wiederholungen – darüber erscheint der Hinweis „mehr Treffer als angezeigt“.
- Angaben (Zeiten, Preise, Absagen) stammen ungeprüft aus den Quellen – maßgeblich ist die verlinkte Originalanzeige.
- Ortssuche über Nominatim: nur auf Absenden, max. 1 Anfrage/s; bei Ausfall bleibt die Städte-Schnellauswahl.
- Ohne Server (rein statisch gehostet) funktioniert nur die Oberfläche, nicht die Datenabfrage.
- Kartenlinks: Die einheitlichen Apple-Karten-Links sind laut Apple für iOS 18.4 / macOS 15.4 und neuer dokumentiert; ältere Geräte öffnen sie im Browser (nicht auf allen Systemen geprüft). Die Adresssuche kann bei mehrdeutigen Namen einen falschen Ort treffen. Das OpenStreetMap-Suchformat ist nicht offiziell dokumentiert.
- Widersprüche werden nur zwischen Einträgen der aktuellen Ergebnisse erkannt, und nur bei gleichem Titel am gleichen Tag.
- Panoramax deckt Deutschland lückenhaft ab; meist gibt es keine Bilder. Abgefragt wird die öffentliche Instanz api.panoramax.xyz ohne Schlüssel; fällt sie aus, zeigt die Detailansicht einen Fehlerhinweis.
- Mac-App: nicht notarisiert, bringt Node.js nur für Apple Silicon mit (Intel braucht ein installiertes Node.js), nur auf Apple Silicon unter macOS 27 getestet. Die Standortabfrage über die Ortungsdienste ist nicht durchgetestet (siehe CHANGELOG).
