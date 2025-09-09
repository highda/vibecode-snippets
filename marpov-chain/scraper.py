import os
import re
import sys
import subprocess
import argparse

try:
    import lyricsgenius
except ImportError:
    print("Knihovna 'lyricsgenius' nebyla nalezena. Instaluji...")
    try:
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'git+https://github.com/nlurker/LyricsGenius.git@fix-311-non-lyrics'])
        import lyricsgenius
        print("Instalace proběhla úspěšně.")
    except subprocess.CalledProcessError as e:
        print(f"Chyba při instalaci knihovny: {e}")
        sys.exit(1)

def stahni_a_uloz_texty_pisni(jmeno_umelce, cilovy_soubor, api_klic=None):
    if not api_klic:
        api_klic = os.environ.get("GENIUS_API_KEY")
        if not api_klic:
            api_klic = input("Zadej svůj Genius API klíč (nebo ho nastav jako proměnnou prostředí GENIUS_API_KEY): ")
            if not api_klic:
                print("Chyba: Nebyl zadán žádný API klíč. Ukončuji.")
                sys.exit(1)

    genius = lyricsgenius.Genius(api_klic)
    genius.remove_section_headers = True

    print(f"Hledám umělce '{jmeno_umelce}'...")
    try:
        umelec = genius.search_artist(jmeno_umelce, max_songs=None)
    except Exception as e:
        print(f"Chyba při stahování textů pro umělce '{jmeno_umelce}': {e}")
        return False
        
    if not umelec:
        print(f"Upozornění: Umělec '{jmeno_umelce}' nebyl nalezen. Ukončuji.")
        return False

    print(f"Stahuji texty písní pro umělce '{umelec.name}'...")
    with open(cilovy_soubor, "w", encoding="utf-8") as f:
        for pisen in umelec.songs:
            text = pisen.lyrics
            if text:
                text = re.sub(r'\(.*?\)|\[.*?\]|<.*?>|\{.*?\}', '', text)
                f.write(text.strip() + "\n\n")

    print(f"Hotovo! Texty byly uloženy do souboru '{cilovy_soubor}'.")
    return True

if __name__ == "__main__":
    analyzator = argparse.ArgumentParser(description='Stáhne texty písní umělce pomocí Genius API.')
    analyzator.add_argument('--umelec', type=str, default='Marpo', help='Jméno umělce.')
    analyzator.add_argument('--cilovy_soubor', type=str, default='lyrics.txt', help='Cesta k souboru pro uložení textů.')
    analyzator.add_argument('--api_klic', type=str, default=None, help='Genius API klíč (volitelné, lze zadat i z příkazové řádky nebo z proměnné prostředí).')
    argumenty = analyzator.parse_args()

    stahni_a_uloz_texty_pisni(argumenty.umelec, argumenty.cilovy_soubor, argumenty.api_klic)
