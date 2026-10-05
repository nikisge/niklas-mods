# Claude Code Mods (aus dem Video)

Vier Mods für Claude Code ab Version 2.1.287. Laufen im Terminal und im Code-Tab der Desktop-App.

| Mod | Was er macht | Bedienung |
|---|---|---|
| **arbeitsliste** | Eigenes To-do-Feld neben dem Chat, getrennt von normalen Nachrichten. Du tippst Aufgaben rein, während Claude arbeitet, ohne es zu unterbrechen. Ist Claude fertig, nimmt es sich das nächste To-do selbst, eins pro Durchlauf. Oben siehst du live Claudes eigenen Plan mit Fortschrittsbalken. Bei Abbruch pausiert die Liste. | `/todo` springt ins To-do-Feld (tippen, Enter, Esc zurück zum Chat; Strg+X Tab springt wieder rein). Außerdem `/todo Aufgabe`, `/todo pause`, `/todo weiter`, `/todo leeren` |
| **cache-watcher** | Eine Zeile über dem Prompt: wie lange der Prompt-Cache noch warm ist, Kontext, 5-Stunden- und Wochenlimit, API-Wert der Session. 5 Minuten bevor der Cache kalt wird: Ton, Hinweis und eine rote Warnzeile mit den Knöpfen **Warm halten** (schickt einen Mini-Prompt, der den Cache für eine weitere Stunde hält) und **Komprimieren**. | läuft von selbst. Cache-Dauer oben in `cache-watcher/hooks/register.tsx` (`CACHE_MINUTES`, Standard 60 für Abos; per API 5 eintragen) |
| **peitsche** | Spaß-Mod. `/peitsche` öffnet das Peitschen-Feld: Die Peitsche schwingt mit echter Physik und knallt bei schnellem Zug. Triffst du Clawd, während Claude arbeitet, zuckt er zusammen, der Spinner wird zu „Schuftet unter der Peitsche“ und Claude bekommt mit dem nächsten Tool-Ergebnis die Ansage, schneller zu machen. | `/peitsche`, dann **H** = zuschlagen, **W/A/S/D** = Hand bewegen. Mit Maus (Vollbild-Terminal): gedrückt halten und schwingen |
| **snake** | Snake spielen, während Claude arbeitet. Pausiert von selbst, sobald Claude fertig ist, damit du nichts verpasst. Rekord bleibt gespeichert. | `/snake`, dann **W/A/S/D** steuern, **P** Pause, **N** neu. Schließen: **Esc**, **Q** oder nochmal `/snake`; geht von selbst zu, wenn Claude fertig ist |

## Installieren

```bash
claude plugin marketplace add nikisge/niklas-mods
claude plugin install arbeitsliste@niklas-mods --scope user
claude plugin install cache-watcher@niklas-mods --scope user
claude plugin install peitsche@niklas-mods --scope user
claude plugin install snake@niklas-mods --scope user
```

Du brauchst nur die, die du willst. Danach Claude Code neu starten.

Updates holen: `claude plugin marketplace update niklas-mods`, dann `claude plugin update <name>@niklas-mods`.

Nur eine Session lang ausprobieren: `claude --plugin-dir ./arbeitsliste`

Wieder weg: `claude plugin uninstall <name>@niklas-mods` oder in `/plugin` deaktivieren.

## Sicherheit

Mods laufen ohne Sandbox mit deinen Rechten. Installiere nur Mods aus Quellen, denen du vertraust.
Vorher anschauen, was ein Mod abgreift und aufruft:

```bash
claude plugin validate ./arbeitsliste
```

## Die anderen Mods aus dem Video

- **You Should Know** (eingebaut): `/plugin enable cc-plugin-you-should-know@builtin`
- **Next Steps** (Anthropic, nur im Terminal):
  `claude plugin marketplace add anthropics/claude-plugins-community`, dann
  `claude plugin install next-steps@claude-community`
- **Blast Radius** (Anthropic-Beispiel):
  `git clone https://github.com/anthropics/claude-code-playground.git`,
  `cd claude-code-playground/claude-code/mods`, `claude plugin marketplace add ./`,
  `claude plugin install blast-radius@claude-code-playground-mods --scope user`
