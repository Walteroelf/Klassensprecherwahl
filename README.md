# Klassensprecherwahl

**App öffnen:** https://walteroelf.github.io/Klassensprecherwahl/

Eine kleine Wahl-App für das iPad. Sie läuft komplett im Browser, ohne Internet, ohne Server und ohne Tracking.
Fotos, Namen und Stimmen bleiben ausschließlich auf dem iPad.

> **Stand: Stufe 2** (Einstellungen mit Code, Tafel, Schutzmechanismen).
> Probemodus, Stichwahl, Ergebnis-Countdown, Export und Barrierefreiheit folgen in Stufe 3.

## Inhalt dieser Anleitung

1. [Ausprobieren am Mac](#1-ausprobieren-am-mac)
2. [Auf das iPad bringen und installieren](#2-auf-das-ipad-bringen-und-installieren)
3. [Erster Start und Code](#3-erster-start-und-code)
4. [Wahl durchführen ohne Tafel](#4-wahl-durchführen-ohne-tafel)
5. [Wahl durchführen mit Tafel](#5-wahl-durchführen-mit-tafel)
6. [Geführten Zugriff einrichten (Wahlkabine sichern)](#6-geführten-zugriff-einrichten)
7. [Schutz vor Manipulation](#7-schutz-vor-manipulation)
8. [Alles löschen](#8-alles-löschen)
9. [Wenn etwas nicht klappt](#9-wenn-etwas-nicht-klappt)

## 1. Ausprobieren am Mac

Im Ordner der App im Terminal:

```bash
python3 -m http.server 8000
```

Dann im Browser `http://localhost:8000` öffnen (die Tafel unter `http://localhost:8000/board.html`).
Die automatischen Tests laufen unter `http://localhost:8000/tests/` und zeigen „Alle … Tests bestanden“.
Wer Node.js hat, kann sie auch mit `node --test tests/` starten.

## 2. Auf das iPad bringen und installieren

Die Installation braucht einmalig **https**. Empfohlen: GitHub Pages.

1. Den Ordner in ein GitHub-Projekt hochladen.
2. Im Projekt unter **Settings → Pages** den Zweig `main` und den Ordner `/ (root)` auswählen.
3. Auf dem iPad in **Safari** die Pages-Adresse öffnen (mit Internet, einmalig).
4. Teilen-Symbol → **Zum Home-Bildschirm**. Ab jetzt startet die App auch ohne Internet und im Vollbild.

Die App selbst enthält keine Verbindung zu GitHub und lädt nichts nach. Eine Sicherheitsregel in `index.html` und `board.html` verbietet das ausdrücklich.

**Neue Version einspielen:** In `sw.js` die Nummer bei `CACHE` erhöhen, sonst zeigt das iPad weiter die alte Version.

## 3. Erster Start und Code

- Beim ersten Start legst du deinen **sechsstelligen Code** fest (zweimal eingeben). Er wird nie im Klartext gespeichert, nur als Hash mit Salt.
- Nach dem Start zeigt die App immer die **Wahlkabine** mit ruhigem Wartebildschirm. Es gibt keinen sichtbaren Link in die Einstellungen.
- **Lehrerbereich öffnen:** Etwa **2 Sekunden lang auf das kleine Wahlurnen-Symbol oben links** drücken, danach den Code eingeben.
- Nach mehreren falschen Eingaben sperrt das Zahlenfeld (ab dem 3. Fehlversuch 1, 2, 4, 8 … Minuten, höchstens 30). Die Sperre bleibt auch nach einem Neuladen bestehen.
- **Code vergessen?** Dann gibt es keinen Zurücksetzen-Knopf (sonst könnte ihn jeder benutzen). Einzige Lösung: in den iPad-Einstellungen unter Safari die Website-Daten löschen. Dabei gehen alle Wahlen verloren.
- Den Code kannst du im Lehrerbereich unter **Sicherheit → Code ändern** ändern.

## 4. Wahl durchführen ohne Tafel

1. Lehrerbereich öffnen → **Neue Wahl anlegen**: Titel, Wahlmodus, Anzahl der Wähler, Kandidaten mit Foto (Kamera oder Mediathek), optional Wählerliste → **Speichern**.
2. **Nächsten Wähler freischalten** → das Kind wählt (Foto antippen → **Ja, wählen**). Danach sperrt die Kabine sofort.
3. Für den nächsten Wähler: wieder Logo lange drücken, Code eingeben, freischalten.
4. Sind alle durch: **Wahl abschließen**. Erst jetzt erscheint das Ergebnis mit dem Wahlprotokoll.
5. Das Ergebnis zeigst du nur auf dem iPad, bei Bedarf per AirPlay oder Bildschirmspiegelung auf die Tafel.

Wichtig: Mit **Zur Wahlkabine (sperren)** machst du eine Wahl zur aktiven Wahl der Kabine. Die Kabine zeigt immer die Wahl, die du zuletzt dort abgelegt hast.

## 5. Wahl durchführen mit Tafel

Die Tafel verbindet sich **direkt** mit dem iPad (WebRTC), ohne Server im Internet. Beide Geräte müssen im **selben WLAN** sein.
Es fließen nur Steuersignale und Zähler: „Nächster Wähler“, „Rückgängig“, die Phase („bereit“, „stimmt ab“, „Abgestimmt“) und die Zahl der abgegebenen Stimmen. **Nie** Einzelstimmen. Erst nach dem Abschluss bekommt die Tafel die Summen.

**Einmalig koppeln:**

1. Auf dem iPad: Lehrerbereich → Wahl öffnen → Haken bei **Tafel verwenden** → **Tafel verbinden**.
2. Auf der Tafel im Browser die Seite `board.html` der App öffnen. Sie zeigt einen QR-Code.
3. Mit der **Kamera-App des iPad** den QR-Code scannen, auf den erkannten Text tippen und **Kopieren** wählen.
4. In der Wahl-App den Text einfügen → **Antwort erzeugen**. Das iPad zeigt nun einen QR-Code und einen Text.
5. Auf der Tafel die Antwort einlesen: **QR-Code mit der Tafel-Kamera scannen** (wenn die Tafel eine Kamera und einen passenden Browser hat) oder den **Antworttext einfügen**.
6. Beide Geräte zeigen „verbunden“.

Warum nicht nur ein kurzer Code? Zwei Geräte ohne Server müssen ihre Netzwerkdaten austauschen. Die sind für einen kurzen Code zu lang. Der QR-Code ist die bequemste Art, sie zu übertragen.

**Im Betrieb** zeigt die Tafel Titel, den großen Knopf **Nächster Wähler**, den Fortschrittsbalken (abgegeben / fehlen noch) und nach jeder Stimme nur das Wort **Abgestimmt**.
Mit **Rückgängig** nimmst du eine Freischaltung zurück, wenn ein falscher Wähler aufgerufen wurde. Abgegebene Stimmen lassen sich nie zurücknehmen.
Nach 2 Minuten ohne Berührung sperrt sich die Kabine von selbst, die Tafel warnt 20 Sekunden vorher.

Hinweise: Manche Schul-WLANs trennen Geräte voneinander („Client-Isolation“). Dann klappt die Verbindung nicht. Frag die Schul-IT oder nutze die Wahl ohne Tafel. Wird die Verbindung getrennt (z. B. iPad neu geladen), einfach noch einmal koppeln.

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

Lehrerbereich → Übersicht → ganz unten **Alles löschen**. Es gibt eine doppelte Sicherheitsabfrage mit erneuter Code-Eingabe.
Danach sind Wahlen, Kandidaten, Fotos, Wählerlisten, Stimmen, Protokolle, Einstellungen und der Code entfernt: die komplette Datenbank wird gelöscht, auch lokale Zwischenspeicher. Nur die Programmdateien für den Offline-Start bleiben (sie enthalten keine persönlichen Daten). Die App startet danach wieder mit der Code-Einrichtung.

## 9. Wenn etwas nicht klappt

- **Foto-Aufnahme geht nicht:** In Safari/iPad-Einstellungen den Kamerazugriff erlauben.
- **Tafel verbindet nicht:** Gleiches WLAN? Client-Isolation? Den Verbindungstext vollständig kopiert, ohne Leerzeichen am Rand? Beide Seiten neu laden und noch einmal koppeln.
- **Alte Version auf dem iPad:** App vom Home-Bildschirm entfernen, in Safari die Seite neu öffnen und erneut zum Home-Bildschirm hinzufügen (oder `CACHE` in `sw.js` erhöhen).

## Dateien

```
index.html        Startseite der iPad-App (mit Datenschutz-Sicherheitsregel)
board.html        Tafelansicht
css/app.css       Gestaltung
js/dom.js         Hilfe zum Bauen der Bildschirme
js/logic.js       Zähllogik (ohne Oberfläche, getestet)
js/db.js          Lokale Speicherung (IndexedDB)
js/security.js    Code-Hash, Sperrzeit
js/qr.js          QR-Code-Erzeuger (lokal)
js/link.js        Direkte Verbindung iPad–Tafel (WebRTC)
js/app.js         iPad: Wahlkabine und Lehrerbereich
js/board.js       Tafel
sw.js, manifest.webmanifest, icons/   Offline-Betrieb und Home-Bildschirm
tests/            Automatische Tests
```
