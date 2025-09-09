# Marpov chain

-----

Pokus o replikaci Marpových textů pomocí **Markovových řetězců** s možností stáhnout dataset z Genius API (protože copyright, duh). Naučí se (ne moc dobře), jak má Marpo stavět věty, aby pak vygeneroval vlastní texty.

Hlavní skript přečte všechny texty Marpa, vytvoří si Marpovův řetězec a Marpo modely. Pak vygeneruje nový, naprosto unikátní, ale pořád tak nějak Marpův text.

-----

## Požadavky a instalace

  * **Python 3.6+**
  * **Genius API klíč**: Pro stažení textů.
  * **Knihovny**: O instalaci knihovny `lyricsgenius` se postará skript sám, nemusíš se starat. Fork a branch (čti scraper.py) je třeba dodržet.

-----

## Použití

Nejjednodušší způsob je spustit Marpov chain přímo:

```bash
python marpov.py
```

Skript zkontroluje, jestli už máš Marpa v `lyrics.txt`. Pokud ne, automaticky je stáhne. Pak už jen začne generovat Marpoviny.

### Volitelné parametry

Pro experimentoví s počtem řádků, velikostí kontextu okna (což má celkem vliv na kvalitu), lze použít argumenty:

| Argument | Výchozí hodnota | Popis |
|---|---|---|
| `--vstupni_soubor` | `lyrics.txt` | Zdrojová data, srdce Marpa. |
| `--kontextove_okno`| `1` | Počet slov pro zapamatování při výběru dalšího slova. Větší číslo = víc Marpo, míň random. |
| `--celkovy_pocet_radku`| `15` | Kolik řádků Marpovin vygenerovat. |

**Příklad:** 20 řádků Marpovin s kontextem 3.

```bash
python marpov.py --kontextove_okno 3 --celkovy_pocet_radku 20
```

-----

Stáhnout texty Marpa jde i bez generování, stačí použít `scraper.py` přímo. Případně jde třeba změnit umělce (ačkoli to pak už nebude Marpo):

```bash
python scraper.py --umelec "Karel Gott" --cilovy_soubor "gott_lyrics.txt"
```

A pak už jen Marpova nasměruješ na nový soubor:

```bash
python marpov.py --vstupni_soubor "gott_lyrics.txt"

```

