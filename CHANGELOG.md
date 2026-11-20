# Änderungen

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
