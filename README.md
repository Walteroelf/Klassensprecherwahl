# Klassensprecherwahl

Eine kleine Wahl-App für iPads und Mac. Sie läuft komplett im Browser, ohne Internet, ohne Server und ohne Tracking.
Fotos, Namen und Stimmen bleiben ausschließlich auf deinen Geräten im Klassenzimmer. Die Stimmen werden nur auf dem Hauptgerät gezählt.

> **Stand: Stufe 3** (alle geplanten Funktionen): Kern, Code, Hauptgerät mit Wahlkabinen, dazu Probemodus, Stichwahl,
> Ergebnis-Countdown, Export, Barrierefreiheit, Vorlesen und Kandidaten-Vorschau.

## Inhalt dieser Anleitung

1. [Ausprobieren am Mac](#1-ausprobieren-am-mac)
2. [Auf das iPad bringen und installieren](#2-auf-das-ipad-bringen-und-installieren)
3. [Startbildschirm, Code und Rollen](#3-startbildschirm-code-und-rollen)
4. [Eine Wahl vorbereiten](#4-eine-wahl-vorbereiten-hauptgerät)
5. [Wahl mit bis zu drei Wahlkabinen](#5-wahl-durchführen-mit-bis-zu-drei-wahlkabinen)
6. [Geführten Zugriff einrichten (Wahlkabine sichern)](#6-geführten-zugriff-einrichten)
7. [Schutz vor Manipulation](#7-schutz-vor-manipulation)
8. [Alles löschen](#8-alles-löschen)
9. [Wenn etwas nicht klappt](#9-wenn-etwas-nicht-klappt)
10. [Extras (Stufe 3)](#10-extras-stufe-3)

## 1. Ausprobieren am Mac

Im Ordner der App im Terminal:

```bash
python3 -m http.server 8000
```

Dann im Browser `http://localhost:8000` öffnen. Zum Ausprobieren der Kabinen am Mac das Hauptgerät unter `localhost:8000` und die Kabine unter `127.0.0.1:8000` öffnen (getrennte Speicher, Verbinden per Text).
Die automatischen Tests laufen unter `http://localhost:8000/tests/` (Zähllogik) und `http://localhost:8000/tests/qrscan.html` (QR-Leser) und zeigen „Alle … Tests bestanden“.
Wer Node.js hat, kann sie auch mit `node --test tests/` starten.

## 2. Auf das iPad bringen und installieren

Die Installation braucht einmalig **https**. Empfohlen: GitHub Pages.

1. Den Ordner in ein GitHub-Projekt hochladen.
2. Im Projekt unter **Settings → Pages** den Zweig `main` und den Ordner `/ (root)` auswählen.
3. Auf dem iPad in **Safari** die Pages-Adresse öffnen (mit Internet, einmalig).
4. Teilen-Symbol → **Zum Home-Bildschirm**. Ab jetzt startet die App auch ohne Internet und im Vollbild.

Die App selbst enthält keine Verbindung zu GitHub und lädt nichts nach. Eine Sicherheitsregel in `index.html` verbietet das ausdrücklich.

**Neue Version einspielen:** In `sw.js` die Nummer bei `CACHE` erhöhen, sonst zeigt das iPad weiter die alte Version.

## 3. Startbildschirm, Code und Rollen

Beim Start zeigt die App nur das **Hauptgerät** (Lehrkraft): Wahl einrichten, Kabinen verbinden, Kinder freischalten, Wahl abschließen, Ergebnis zeigen. Das kann ein Lehrer-iPad oder ein MacBook sein und lässt sich auf die Tafel spiegeln.
Ein iPad für die Kinder wird über den kleinen Knopf **Als Wahlkabine verwenden** unten auf dem Startbildschirm zur Wahlkabine. Dort gibt es nur Wartebildschirm und Wahl, keine Einstellungen und keinen Code.

- Beim allerersten Öffnen des Hauptgeräts legst du deinen **sechsstelligen Code** fest (zweimal eingeben). Er wird nie im Klartext gespeichert, nur als Hash mit Salt. Die Wahlkabinen brauchen keinen Code.
- Die **installierte App** (vom Home-Bildschirm) startet direkt in ihrer Rolle: als Wahlkabine sofort mit dem Verbinden-Bildschirm. In einem normalen Browser-Tab erscheint immer die Startauswahl.
- **Wahlkabine beenden:** Etwa **2 Sekunden auf das kleine Wahlurnen-Symbol oben links** drücken und bestätigen. Auf dem Wartebildschirm steht dazu ein kleiner Hinweis (abschaltbar unter *Weitere Einstellungen → Anzeige und Vorlesen*).
- Nach mehreren falschen Code-Eingaben sperrt das Zahlenfeld (ab dem 3. Fehlversuch 1, 2, 4, 8 … Minuten, höchstens 30). Die Sperre bleibt auch nach einem Neuladen bestehen.
- **Code vergessen?** Es gibt bewusst keinen Zurücksetzen-Knopf. Einzige Lösung: in den Safari-Einstellungen die Website-Daten löschen. Dabei gehen alle Wahlen dieses Geräts verloren.
- Den Code änderst du unter *Weitere Einstellungen → Code ändern*. Eine **Kurzanleitung** steht auf der Seite „Meine Wahlen“.

## 4. Eine Wahl vorbereiten (Hauptgerät)

Das Hauptgerät führt dich in **drei Schritten**; oben steht immer „Als Nächstes: …“.

1. **Wahl einrichten:** Neue Wahl anlegen mit Titel, Modus, Kandidaten mit Foto (Kamera oder Mediathek), die **Wählerzahl (optional)**. Ohne Zahl gibt es keine Obergrenze, und du schließt die Wahl selbst ab. Wenn du eine Wählerliste anlegst (ein Name pro Zeile), wird die Zahl **automatisch** auf die Zahl der Zeilen gesetzt. Neue Kandidaten erscheinen oben in der Liste; im Gruppenmodus wählst du die Gruppe mit Knöpfen nebeneinander. Die Gruppen-Einstellung erscheint nur im Modus „Eine Stimme je Gruppe“. Standard sind zwei Gruppen (Mädchen, Jungen); eine dritte und vierte Gruppe lassen sich optional hinzufügen.
2. **Kinder wählen lassen:** *Kabinen verbinden und Wahl durchführen* (siehe Abschnitt 5).
3. **Wahl abschließen:** Das Ergebnis ist zunächst **verdeckt**. Du legst fest, welche Plätze gezeigt werden (nur der Sieger, Platz 1 bis 2, 1 bis 3 oder alle), und startest den Countdown. Die Auswahl gilt auch für PDF und Bild. Alle Zahlen siehst nur du über *Alle Zahlen ansehen*. Dort stehen auch Gleichstand und Stichwahl.

Ohne zweites Gerät geht es auch: Mit *Dieses Gerät als Wahlkabine* wird das Hauptgerät selbst zur gesperrten Kabine. Dort steht dann die Zahl der bisher abgegebenen Stimmzettel. Pro Kind: Wahlurnen-Symbol oben links 2 Sekunden halten, Code eingeben, *Nächstes Kind freischalten*.

## 5. Wahl durchführen mit bis zu drei Wahlkabinen

Das **Hauptgerät zählt alle Stimmen**. Jede Kabine ist nur eine Eingabe: Sie bekommt die Kandidaten (nur im Arbeitsspeicher), wird einzeln freigeschaltet und schickt am Ende den Stimmzettel zurück. Nach jedem Kind sperrt sie sich, bis du sie am Hauptgerät wieder freischaltest. Die Kabinen zeigen nie ein Ergebnis.

Die Geräte verbinden sich **direkt** (WebRTC), ohne Server im Internet. Alle müssen im **selben WLAN** sein.
Übertragen werden: die Wahl (Namen, Fotos, Einstellungen), „freischalten“/„sperren“ und der **Stimmzettel** einer Kabine. Gespeichert werden am Hauptgerät nur Zähler pro Kandidat: keine Zeit, keine Reihenfolge, keine Zuordnung zu Kabine oder Kind.

**Jede Kabine einmal verbinden (am einfachsten):**

1. **Hauptgerät:** Bei Schritt 2 auf *Kabinen verbinden und Wahl durchführen* tippen, dann bei einer Kabine auf **Verbinden**. Es erscheint ein QR-Code.
2. **iPad:** Die normale **Kamera-App** auf den QR-Code richten und den Link antippen. Safari öffnet sich, und das iPad ist sofort die Wahlkabine. Es zeigt gleich seinen eigenen QR-Code.
3. **iPad:** Den iPad mit dem Bildschirm vor die **Kamera des Hauptgeräts** halten (dort **Kamera starten** tippen).
4. Sobald „Kabine N verbunden“ erscheint, ist die Wahl auf der Kabine angekommen. Das iPad zeigt den gesperrten Wartebildschirm.

Dieser Weg braucht beim iPad **Internet** (die Seite wird über den Link geladen) und läuft in Safari statt in der installierten App. Die Kabine speichert nichts, das ist kein Nachteil. Den Geführten Zugriff kannst du auch in Safari nutzen.

**Ohne Internet (installierte App):** Auf dem iPad die App vom Home-Bildschirm öffnen → *Als Wahlkabine verwenden* → **Kamera starten** → auf den QR-Code des Hauptgeräts richten. Danach wie oben ab Schritt 3.

Hat ein Gerät keine Kamera, geht es auch mit Text: Unter **Ohne Kamera** den Text kopieren und einfügen.

**Im Betrieb** zeigt das Hauptgerät (z. B. auf der Tafel) den Fortschritt und für jede Kabine den Zustand: *frei*, *wählt gerade*, *sperrt gleich automatisch*, *hat gewählt*. Ein Kind aufrufen und bei einer freien Kabine auf **Kind freischalten** tippen. Hast du eine Wählerliste angelegt, erscheint sie dabei: Tippe das Kind an, das in die Kabine geht. Es wird abgehakt (nur „war dran“, nie was oder wo es gewählt hat). Die Liste mit allen Haken steht darunter, ein Tipp korrigiert einen Haken. Mit **Rückgängig** verschwindet auch der Haken wieder. Ohne Liste schaltest du direkt frei. Die Reihenfolge der Fotos ist bei jeder Freischaltung zufällig.
Mit **Rückgängig** nimmst du eine Freischaltung zurück, wenn das falsche Kind aufgerufen wurde. Abgegebene Stimmen lassen sich nie zurücknehmen.
Nach 2 Minuten ohne Berührung sperrt sich eine Kabine von selbst. Insgesamt werden nie mehr Kabinen freigeschaltet, als Wähler eingetragen sind.
Am Ende **Wahl abschließen** (am Hauptgerät, mit Sicherheitsabfrage). Die Kabinen zeigen dann „Die Wahl ist beendet“, das Ergebnis erscheint nur am Hauptgerät.

Hinweise:
- Die Kamera liest die Codes direkt in der App (kein Online-Dienst). Bei Erstnutzung fragt Safari einmalig nach dem Kamerazugriff: **Erlauben**.
- Der **WLAN-Betrieb ist Pflicht** für die Wahl mit Kabinen. Manche Schul-WLANs trennen Geräte voneinander („Client-Isolation“), dann klappt es nicht. Frag die Schul-IT oder nutze die Wahl mit dem Hauptgerät als Kabine.
- **Verbindung weg** (iPad eingeschlafen, App neu geladen): Die Kabine zeigt „Keine Verbindung“ und muss neu verbunden werden (Schritt 1 bis 3 für diese Kabine). Eine nicht abgeschickte Stimme geht dabei verloren, das Kind wählt nach erneutem Freischalten noch einmal. Eine Stimme zählt erst, wenn die Kabine „Danke“ zeigt.
- Bei den iPads am besten die **automatische Sperre** ausschalten (Einstellungen → Anzeige & Helligkeit → Automatische Sperre → Nie) und den Geführten Zugriff nutzen (nächster Abschnitt).

## 6. Geführten Zugriff einrichten

Der Geführte Zugriff sperrt das iPad auf die Wahl-App: Home-Taste, App-Wechsel und Seitenwechsel funktionieren dann nicht mehr.

**Einmal einrichten:**

1. **Einstellungen → Bedienungshilfen → Geführter Zugriff** öffnen und einschalten.
2. **Code-Einstellungen → Code für Geführten Zugriff festlegen** (das ist ein anderer Code als der Wahl-Code).
3. Optional: **Zeitlimit** und **Anzeigeautomatik** ausschalten, damit sich der Bildschirm nicht sperrt.

**Vor der Wahl starten:**

1. Die Wahl-App vom Home-Bildschirm öffnen (Wartebildschirm sichtbar).
2. Die **Seitentaste dreimal schnell drücken** (bei iPads mit Home-Taste: die Home-Taste dreimal).
3. Unten links **Optionen** antippen, **Tastatur** ausschalten, **Berührung** an lassen → **Fertig** → **Starten**.

**Beenden:** Seitentaste (oder Home-Taste) dreimal drücken, Code für Geführten Zugriff eingeben, **Beenden** antippen.

Den Lehrerbereich der Wahl-App erreichst du auch im Geführten Zugriff über das Logo und den Wahl-Code.

## 7. Schutz vor Manipulation

- Es werden nie mehr Stimmzettel angenommen, als Wähler eingetragen sind, und pro Freischaltung genau einer.
- Gespeichert werden nur **Zähler pro Kandidat** (kein Zeitstempel, keine Reihenfolge, keine Zuordnung zu Personen).
- Nach jeder Stimme wird der Stand sofort gesichert. Nach einem Neuladen gilt die Freischaltung nicht mehr, und der Wartebildschirm erscheint.
- Beim Abschluss prüft die App, ob Stimmen, Stimmzettel und Freischaltungen zusammenpassen, und warnt sonst deutlich.
- Das **Wahlprotokoll** enthält nur Zahlen: freigeschaltete Wähler, abgegebene Stimmzettel, gezählte Stimmen, Enthaltungen und den Zeitpunkt des Abschlusses.
- Der Lehrerbereich ist nur mit Code erreichbar. Beim Verlassen der Kabine wird er wieder geschlossen.
- Verlässt die App den Bildschirm, während ein Wähler freigeschaltet ist, wird die Freischaltung zurückgenommen.

## 8. Alles löschen

Lehrerbereich → *Weitere Einstellungen* → ganz unten **Alles löschen**. Es gibt eine doppelte Sicherheitsabfrage mit erneuter Code-Eingabe.
Danach sind Wahlen, Kandidaten, Fotos, Wählerlisten, Stimmen, Protokolle, Einstellungen und der Code entfernt: die komplette Datenbank wird gelöscht, auch lokale Zwischenspeicher. Nur die Programmdateien für den Offline-Start bleiben (sie enthalten keine persönlichen Daten). Die App startet danach wieder mit der Code-Einrichtung.

## 9. Wenn etwas nicht klappt

- **Foto-Aufnahme geht nicht:** „Foto aufnehmen“ öffnet die Live-Kamera (Mac und iPad, mit „Kamera wechseln“ für Front- und Rückkamera). Dafür muss der Browser den Kamerazugriff erlauben (Safari: Einstellungen für diese Website → Kamera → Erlauben). Sonst bleibt „Aus Mediathek“.
- **Kabine verbindet nicht:** Gleiches WLAN? Client-Isolation? Kamera erlaubt? Der QR-Code wird besser gelesen, wenn er groß und ruhig im Bild steht und der Bildschirm nicht spiegelt (Helligkeit hoch). Sonst „Ohne Kamera“ den Text kopieren. Beide Seiten neu laden und noch einmal koppeln.
- **Alte Version auf dem iPad:** App vom Home-Bildschirm entfernen, in Safari die Seite neu öffnen und erneut zum Home-Bildschirm hinzufügen (oder `CACHE` in `sw.js` erhöhen).

## 10. Extras (Stufe 3)

**Probemodus** (Lehrerbereich → *Weitere Einstellungen* → *Probemodus mit Beispielkandidaten*, oder in einer Wahl unter *Mehr …* → *Probemodus mit diesen Kandidaten*)
- Zeigt den Schülern den Ablauf. Solange er läuft, zeigt das Gerät ein orangefarbenes Banner **TESTWAHL**. Der Probemodus läuft nur auf dem Hauptgerät (ohne Kabinen).
- Die Teststimmen leben nur im Arbeitsspeicher und werden nie in die echte Wahl oder in den Speicher geschrieben. Nach *Probemodus beenden* siehst du das Probeergebnis. Mit *Probemodus beenden und Teststimmen löschen* ist alles weg. Ein Neuladen beendet den Probemodus ebenfalls.

**Stichwahl**
- Bei Gleichstand (um jeden Platz mit mindestens einer Stimme, in Gruppenwahlen je Gruppe einzeln) erscheint im Ergebnis ein Knopf *Stichwahl starten*.
- Die Stichwahl ist eine eigene Wahl nur mit den punktgleichen Kandidaten: eine Stimme pro Wähler, dieselbe Wählerzahl, eigene Zähler, dieselben Schutzregeln. Die Hauptwahl bleibt unverändert. Danach wie gewohnt in der Wahlkabine ablegen (*Zur Wahlkabine*).
- Endet auch die Stichwahl unentschieden, kannst du erneut eine Stichwahl starten.

**Ergebnis-Countdown**
- *Ergebnis-Countdown starten* im Ergebnis am Hauptgerät: Die Plätze werden von hinten nach vorn enthüllt, jeweils per Tippen auf **Weiter**. Der gerade aufgedeckte Platz steht groß oben im Bild, der Weiter-Knopf bleibt unten sichtbar, gescrollt werden muss nicht. Mit **Alle sofort zeigen** überspringst du den Countdown.

**Export für das Klassenbuch**
- Im Ergebnis: **PDF speichern** oder **Bild speichern** legt die Datei lokal ab. Am Mac in Chrome oder Edge öffnet sich ein Speichern-Fenster mit freier Ortswahl (z. B. Schreibtisch), in Safari landet die Datei im Ordner „Downloads“, am iPad in der App „Dateien“. **PDF teilen oder drucken …** öffnet das Teilen-Menü (AirDrop, Mail, Drucken).
- Der Export enthält Titel, Datum, Kandidaten **mit Foto** und Summen, nur für die gewählten Plätze, niemals Einzelstimmen. Das PDF enthält die Seite als Bild.

**Barrierefreiheit** (Lehrerbereich → *Weitere Einstellungen* → *Anzeige und Vorlesen*)
- **Große Schrift** und **Hoher Kontrast** gelten für die ganze App.
- **Vorlesen** liest Anweisungen, Namen und die Bestätigungsfrage vor. Es nutzt nur die Sprachausgabe des Geräts und nur auf dem Gerät gespeicherte deutsche Stimmen, keinen Online-Dienst. Fehlt eine deutsche Stimme, lässt sich die Option nicht einschalten: In den iPad-Einstellungen unter *Bedienungshilfen → Gesprochene Inhalte → Stimmen* eine deutsche Stimme laden. Bei eingeschaltetem Vorlesen hat jede Kandidatenkarte einen 🔊-Knopf.

**Kandidaten-Vorschau**
- In der Wahl, Schritt 1: *Kandidaten zeigen*. Es erscheinen nur Fotos und Namen der Kandidaten (zum Prüfen oder Zeigen). Das Gerät wird dabei nicht zur Wahlkabine; *Zurück* führt in die Wahl.

**Wählerliste mit Abhaken**
- Im Menü der Wahl hakst du ab, wer schon dran war. Die Liste ist von den Stimmen getrennt und wird beim Abschluss gelöscht.



## Dateien

```
index.html        Startseite der App (mit Datenschutz-Sicherheitsregel)
css/app.css       Gestaltung
js/dom.js         Hilfe zum Bauen der Bildschirme
js/logic.js       Zähllogik (ohne Oberfläche, getestet)
js/db.js          Lokale Speicherung (IndexedDB)
js/security.js    Code-Hash, Sperrzeit
js/qr.js          QR-Code-Erzeuger (lokal)
js/qrscan.js      QR-Code-Leser für die Kamera (lokal)
js/link.js        Direkte Verbindung Hauptgerät–Kabine (WebRTC)
js/reveal.js      Ergebnis-Countdown
js/export.js      Export als Bild oder PDF
js/app.js         Hauptgerät und Wahlkabine
sw.js, manifest.webmanifest, icons/   Offline-Betrieb und Home-Bildschirm
tests/            Automatische Tests
```
