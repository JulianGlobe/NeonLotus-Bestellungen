# Neon Lotus Verwaltungsbot

Komplettpaket für Discord, Railway und die separate Personalverwaltung im Browser.

## Railway Variablen

Pflicht:
- `DISCORD_TOKEN`
- `CLIENT_ID`
- `GUILD_ID`
- `DASHBOARD_PASSWORD`

Optional:
- `DASHBOARD_SECRET` — zusätzliche geheime Zeichenfolge für die Login-Cookies
- `PORT` — Railway setzt den Port normalerweise automatisch

## SQLite / Railway Volume

Das Railway Volume sollte auf:

`/app/data`

gemountet sein.

Die Datenbank liegt dann unter:

`/app/data/neonlotus.db`

## Personalverwaltung

Nach dem Deploy erreichst du die Personalverwaltung über:

`https://DEINE-RAILWAY-DOMAIN/personal`

Beim ersten Aufruf erscheint ein Passwort-Login.
Das Passwort ist der Wert aus `DASHBOARD_PASSWORD`.

Die Personalverwaltung ist aktuell absichtlich **read-only**:
- Mitarbeiterübersicht + Suche
- aktueller Neon-Lotus-Rang
- aktueller Sakura-Rang
- vollständige Sanktionen mit Datum, Betrag, Status und Grund
- Verkäufe
- Abmeldungen
- vollständiger Personalverlauf

Der frühere Discord-Befehl `/akte` wurde vollständig entfernt.

## Discord-Befehle

- `/ping`
- `/einstellung`
- `/uprank`
- `/downrank`
- `/kündigung`
- `/sanktion`
- `/verkauf`
- `/abmeldung`
- `/kasse`
- `/lager`
- `/ankündigung`
- `/termineinladung`

## Deploy

1. Inhalt dieses Pakets in GitHub ersetzen.
2. In Railway `DASHBOARD_PASSWORD` als neue Variable anlegen.
3. Optional `DASHBOARD_SECRET` anlegen.
4. Deploy abwarten.
5. Railway-Domain öffnen und `/personal` anhängen.


## Dashboard V2

Die geschützte Personalverwaltung wurde erweitert.

Navigation:
- Übersicht
- Personal
- Sanktionen
- Abmeldungen
- Verkäufe
- Kasse
- Lager

Die Oberfläche bleibt bewusst read-only. Änderungen werden weiterhin über Discord-Befehle durchgeführt.

Direkter Aufruf:
`https://DEINE-RAILWAY-DOMAIN/personal`


## Gesprächseinladungen

`/termineinladung` wird ab dieser Version zusätzlich dauerhaft in SQLite gespeichert.

In der Personalverwaltung:
- zeigt die Personalübersicht die Anzahl der Gesprächseinladungen pro Person,
- zeigt die jeweilige Personalakte Datum, Anlass, Hinweis, Einladenden und Thread-Status,
- zeigt die Dashboard-Übersicht die neuesten Gesprächseinladungen.

Bestehende Termineinladungen von vor diesem Update können nicht rückwirkend rekonstruiert werden.
