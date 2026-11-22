# Änderungen

## Unveröffentlicht

### Neu

- **Offene Daten von destination.one** als Quelle ohne Schlüssel, standardmäßig an (`DESTINATION_ONE=off` schaltet sie ab). Wiederkehrende Termine (wöchentliche Märkte, tägliche Ausstellungen, „jeden 1. Dienstag“) werden für den gewählten Zeitraum in einzelne Termine aufgelöst. Nur Einträge unter Public Domain oder CC0 werden übernommen.
- **Eigener Kartendienst:** `MAP_TILE_URL` und `MAP_TILE_ATTRIBUTION` ersetzen die OSM-Kacheln, z. B. für eine öffentliche Seite mit viel Verkehr. Nur `https`-Vorlagen mit `{z}`, `{x}`, `{y}`; der Host wird automatisch in die Content-Security-Policy übernommen und im Zustimmungstext genannt.
- **Impressum und Datenschutzerklärung** als Links in der Fußzeile, aus `config/impressum.txt` und `config/datenschutz.txt` (Vorlagen liegen bei). Der Server warnt beim Start, wenn er öffentlich erreichbar ist und kein Impressum hat.
- **GitHub-Prüfung:** `npm audit` und `npm run check` bei jedem Push und Pull Request auf Node 22.18 und aktuellem LTS; Dependabot für npm-Pakete und Actions.

### Geändert

- **Demo-Modus entfernt.** Ohne eingerichtete Quelle zeigt Umkreis keine erfundenen Beispiele mehr, sondern einen Hinweis, wie man einen Ticketmaster-Schlüssel oder iCal-Kalender einrichtet; die Liste bleibt leer. `DEMO_MODE` wird nicht mehr gelesen. Früher gemerkte Beispiel-Einträge werden beim Laden entfernt.
- **Gemerkte Einträge:** Ein beschädigter Eintrag im Speicher verwirft nicht mehr die ganze Liste, sondern nur sich selbst.

### Sicherheit

- **Vorschaubilder nur von öffentlichen Adressen:** Bildadressen aus Panoramax-Daten werden nur per `https` an öffentliche IP-Adressen abgerufen (geprüft wird die DNS-Antwort, verbunden wird genau mit der geprüften Adresse). Vorher konnte eine präparierte Bildadresse den Server Anfragen ins lokale Netz stellen lassen. Eine Gegenstelle mit ungültigem HTTP-Status bringt den Server nicht mehr zum Absturz.
- **Ratenbegrenzung** für alle API-Aufrufe, die Fremddienste erreichen (`429` mit `Retry-After`), und höchstens 5 wartende Ortssuchen. Hinter einem eigenen Reverse-Proxy zählt sie mit `TRUST_PROXY=1` pro Client. Gleichzeitige gleiche Anfragen teilen sich einen Abruf bei der Quelle.
- **Host-Prüfung auch bei `npm start`:** Ohne `ALLOWED_HOSTS` gelten auf 127.0.0.1/localhost automatisch nur die eigenen Namen; auf anderen Adressen warnt der Server beim Start.
- `Cross-Origin-Resource-Policy` und `Cross-Origin-Opener-Policy` (`same-origin`) für Seite und API.
- **Unplausible Ortsangaben aus iCal-Feeds** (außerhalb Deutschlands oder weiter als `area.radiusKm`, Standard 50 km, von der Ortsmitte des Kalenders) werden nicht mehr als Kartenposition übernommen; die Detailansicht sagt das. `area` muss in Deutschland liegen.
- Die Detailansicht nennt die Ziel-Domain jeder Originalanzeige und warnt bei `http`.
- Kalenderexport: Ein einzelnes Wagenrücklauf-Zeichen in Quelldaten kann keine zusätzlichen Kalenderfelder mehr einschleusen.
- Server-Protokoll: Quellen-Fehler werden mit fester Formatzeichenkette geschrieben, protokollierte Pfade auf 200 Zeichen gekürzt.
- Mac-App: rundet den Gerätestandort schon nativ auf ≈ 1 km, lädt keine `data:`/`blob:`-Seiten mehr ins Fenster und macht Datenordner und `.env` nur für den eigenen Benutzer lesbar.

## 0.2.0 – 2026-11-20

Karte, Mac-App und nachvollziehbare Angaben.

### Neu

- **Mac-App:** `npm run mac` baut `Umkreis.app` (natives Fenster mit AppKit + WebKit, startet den mitgelieferten Server nur auf `127.0.0.1`) und installiert sie nach `~/Applications`; danach per Spotlight startbar. Eigenes Symbol, deutsche Menüs, Datenordner für `.env` und `feeds.json` unter `~/Library/Application Support/Umkreis/`. Externe Links öffnen außerhalb der App, Kalendereinträge in Kalender. Startfehler (Node fehlt, Port belegt, Server beendet) werden im Fenster erklärt.
- **Liste und Karte:** Eingebettete OpenStreetMap-Karte (Leaflet) neben der Liste, mit Suchkreis, Stecknadeln je Ort (Zahl bei mehreren Terminen) und gegenseitiger Auswahl. Lädt erst nach Zustimmung; „Keine Karte“ ist wählbar.
- **Detailansicht:** Quelle, Ort, Datum und Uhrzeit, Entfernung, Preis, Zeitpunkt des letzten Abrufs, Link zur Originalanzeige, „Öffnen in …“ und weitere Termine am selben Ort. Schließen mit Esc; der Fokus kehrt zur Liste zurück.
- **Kartendienst wählbar:** „Öffnen in“ Apple Karten (Standard auf Apple-Geräten), Google Maps, HERE WeGo oder OpenStreetMap; getrennt von der Kartenanzeige in der App. Anbieter werden nicht gemischt.
- **Straßenbilder** über Panoramax, auf Klick und nur, wo im Umkreis von 50 m Bilder existieren; sonst steht ausdrücklich „Nicht verfügbar“.
- **Verlässlichkeit:** Jede echte Veranstaltung zeigt, wann sie zuletzt abgerufen wurde; Hinweise bei Angaben älter als 24 Stunden, bei fehlenden Details und bei Widersprüchen zwischen Quellen (Uhrzeit, Ort, Absage). Gemerkte Einträge werden aufgefrischt, wenn sie in neuen Ergebnissen wieder auftauchen.

### Datenschutz und Sicherheit

- Die Content-Security-Policy erlaubt zusätzlich nur Bilder von `tile.openstreetmap.org`. Straßenbilder und deren Vorschauen laufen über den eigenen Server.
- Panoramax wird nur mit der Position des Veranstaltungsorts (nur in Deutschland) gefragt, nie mit dem eigenen Standort.
- Die Mac-App startet den Server nur auf `127.0.0.1` mit fester Host-Prüfung; der Server endet mit der App (auch nach Absturz).

### Bekannte Einschränkungen

- Die Mac-App ist nur ad hoc signiert, nicht notarisiert und nicht zur Weitergabe bereit (Details im README). Sie braucht ein installiertes Node.js ≥ 22.18.
- In der Mac-App sind Start, Server, Spotlight-Eintrag, Fehlerseite bei belegtem Port und das Beenden geprüft. Nicht von Hand durchgeklickt wurden: Standortabfrage über die Ortungsdienste, Öffnen externer Links und Kalender-Import aus der App.
- Apple-Karten- und Google-Karten werden nicht eingebettet (bräuchten kostenpflichtige Konten bzw. Schlüssel), Street View und Look Around fehlen daher.
- Widersprüche werden nur innerhalb der aktuellen Ergebnisse erkannt.

## 0.1.0 – 2026-11-20

Erste veröffentlichte Version.

### Neu

- **Drei Ansichten:** „In der Nähe“ (Umkreis 1–50 km, Standard 15 km), „Deutschlandweit“ (optional auf eine Stadt eingegrenzt) und „Gemerkt“.
- **Filter:** Zeitraum (heute, morgen, Wochenende, 7 oder 14 Tage), Kategorien, Freitextsuche (ohne Rücksicht auf Akzente), Sortierung nach Zeit, Entfernung oder Interessen. Auf dem Handy lassen sich die Filter einklappen.
- **Interessen:** Gewählte Kategorien werden hervorgehoben, jeweils mit Begründung.
- **Pro Veranstaltung:** Merken, Kalendereintrag (`.ics` mit Erinnerung eine Stunde vorher), Teilen, Link zur Originalanzeige.
- **Kartenlinks:** „Karte“ öffnet den Veranstaltungsort in Apple Karten, Google Maps, HERE WeGo oder OpenStreetMap. Genaue Positionen werden direkt übergeben, ungefähre Positionen durch eine Adresssuche ersetzt. Übergeben wird nur das Ziel, nie der eigene Standort; Beispiel-Veranstaltungen haben keine Kartenlinks.
- **Tag- und Nachtansicht:** Helles, warmes skandinavisches Tagesdesign und eine warme, gedämpfte Nachtansicht. „Automatisch“ folgt dem Gerät; „Tag“ und „Nacht“ lassen sich über den Sonne-/Mond-Knopf im Kopf oder unter „Darstellung“ im Fuß fest wählen. Die Wahl wird vor dem ersten Zeichnen angewendet.
- **Datenquellen:** Ticketmaster Discovery API und frei eintragbare iCal/ICS-Feeds (z. B. Wochenmärkte, Vereins- und Stadtkalender). Ohne eingerichtete Quelle startet ein klar gekennzeichneter Demo-Modus.
- **Ortssuche** über Nominatim/OpenStreetMap, Städte-Schnellauswahl und – auf Wunsch – grober Gerätestandort.

### Datenschutz und Sicherheit

- Standorte werden auf ca. 1 km gerundet, nur per POST an den eigenen Server übertragen und nicht protokolliert.
- Keine Cookies, keine Analyse, keine externen Schriften oder Skripte; strikte Content-Security-Policy im Produktionsbetrieb.
- iCal-Feeds werden begrenzt verarbeitet: Der Download bricht über 5 MB ab (auch ohne Größenangabe des Servers), pro Feed zählen höchstens 10 000 Termine, und Wiederholungsregeln haben pro Anfrage ein festes Rechenbudget. Wird eine Grenze erreicht, erscheint „Es gibt mehr Treffer als angezeigt“.
- Interessen, gemerkte Veranstaltungen, Darstellung und – nur mit Zustimmung – der Standort bleiben im `localStorage` dieses Browsers.

### Bekannte Einschränkungen

- Was angezeigt wird, hängt von den eingerichteten Quellen ab. Märkte und Vereinsfeste erscheinen nur mit passenden iCal-Feeds.
- Ticketmaster liefert höchstens 100 Treffer pro Anfrage.
- ICS-Wiederholungsregeln werden nur teilweise ausgewertet (siehe README).
- Apple-Kartenlinks sind laut Apple für iOS 18.4 / macOS 15.4 und neuer dokumentiert; ältere Geräte sind nicht geprüft. Die Adresssuche kann bei mehrdeutigen Namen danebenliegen.
- Ohne den Node-Server (rein statisch gehostet) funktioniert nur die Oberfläche.
