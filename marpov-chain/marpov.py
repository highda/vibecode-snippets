import random
import re
import argparse
from collections import defaultdict, Counter
import sys
import os
import scraper

def sestav_marpov_chain(text, kontextove_okno=1):
    text = re.sub(r'[^\w\s]', '', text.lower(), flags=re.UNICODE)
    slova = text.split()
    marpov_model = defaultdict(list)
    for i in range(len(slova) - kontextove_okno):
        klic = tuple(slova[i:i + kontextove_okno])
        dalsi_slovo = slova[i + kontextove_okno]
        marpov_model[klic].append(dalsi_slovo)
    return marpov_model

def sestav_strukturni_modely(text):
    radky = [radek.strip() for radek in text.split('\n') if radek.strip()]
    model_delky_radku = Counter()
    model_pozice_carky = Counter()
    for radek in radky:
        slova_a_interpunkce = re.findall(r"[\w']+|[.,!?;]", radek.lower(), flags=re.UNICODE)
        pocet_slov = 0
        carka_nalezena_na_radku = False
        for i, token in enumerate(slova_a_interpunkce):
            if token == ',':
                model_pozice_carky[pocet_slov] += 1
                carka_nalezena_na_radku = True
            else:
                pocet_slov += 1
        if pocet_slov > 0:
            model_delky_radku[pocet_slov] += 1
            if not carka_nalezena_na_radku:
                model_pozice_carky[0] += 1
    return model_delky_radku, model_pozice_carky

def ziskej_nahodne_z_counteru(counter):
    celkem = sum(counter.values())
    if celkem == 0:
        return None
    nahodna_hodnota = random.randint(1, celkem)
    for klic, pocet in counter.items():
        nahodna_hodnota -= pocet
        if nahodna_hodnota <= 0:
            return klic
    return None

def generuj_text(marpov_chain_slova, model_delky_radku, model_pozice_carky, celkovy_pocet_radku=15, kontextove_okno=1):
    vsechna_slova = list(set(k for key in marpov_chain_slova.keys() for k in key) | set(v for values in marpov_chain_slova.values() for v in values))
    
    if not vsechna_slova or not model_delky_radku:
        return "Chyba: Nedostatek dat pro generování."

    prumerna_delka_radku = sum(k * v for k, v in model_delky_radku.items()) / sum(model_delky_radku.values())
    celkovy_pocet_slov = int(prumerna_delka_radku * celkovy_pocet_radku)
    
    vygenerovana_slova = []
    
    if kontextove_okno > 0:
        vygenerovana_slova = [random.choice(vsechna_slova) for _ in range(kontextove_okno)]
    
    aktualni_kontext = tuple(vygenerovana_slova[-kontextove_okno:])
    
    marpov_model_weighted = {k: Counter(v) for k, v in marpov_chain_slova.items()}
    
    while len(vygenerovana_slova) < celkovy_pocet_slov:
        
        for i in range(kontextove_okno, 0, -1):
            kontext_pro_vyhledavani = tuple(vygenerovana_slova[-i:])
            if kontext_pro_vyhledavani in marpov_model_weighted:
                moznosti, vahy = zip(*marpov_model_weighted[kontext_pro_vyhledavani].items())
                dalsi_slovo = random.choices(moznosti, weights=vahy, k=1)[0]
                vygenerovana_slova.append(dalsi_slovo)
                break
        else:
            if marpov_chain_slova:
                nahodny_klic = random.choice(list(marpov_chain_slova.keys()))
                vygenerovana_slova.extend(list(nahodny_klic))
            else:
                break
    
    vygenerovane_radky = []
    index_slova = 0
    for _ in range(celkovy_pocet_radku):
        delka_radku = ziskej_nahodne_z_counteru(model_delky_radku)
        if delka_radku is None or delka_radku == 0:
            delka_radku = 5
        
        if index_slova >= len(vygenerovana_slova):
            break

        slova_radku = vygenerovana_slova[index_slova : index_slova + delka_radku]
        index_slova += delka_radku

        if not slova_radku:
            continue

        pozice_carky = ziskej_nahodne_z_counteru(model_pozice_carky)
        if pozice_carky is not None and pozice_carky > 0 and pozice_carky <= len(slova_radku):
            slovo_s_carkou = slova_radku[pozice_carky - 1] + ','
            slova_radku[pozice_carky - 1] = slovo_s_carkou
            
        vygenerovane_radky.append(' '.join(slova_radku))
            
    return '\n'.join(vygenerovane_radky)

if __name__ == "__main__":
    analyzator = argparse.ArgumentParser(description='Brutálně zabíjíš!')
    analyzator.add_argument('--vstupni_soubor', type=str, default='lyrics.txt', help='Cesta k souboru s texty pro trénování. Použij scraper.py pro získání textů, nebo vlož vlastní.')
    analyzator.add_argument('--kontextove_okno', type=int, default=2, help='Počet předchozích slov pro udání velikosti kontextu Marpovova řetězce.')
    analyzator.add_argument('--celkovy_pocet_radku', type=int, default=15, help='Počet řádků k vygenerování.')
    argumenty = analyzator.parse_args()
    
    if argumenty.vstupni_soubor == 'lyrics.txt' and not os.path.exists(argumenty.vstupni_soubor):
        print(f"Upozornění: Soubor '{argumenty.vstupni_soubor}' nebyl nalezen. Automaticky spouštím stahování textů.")
        try:
            scraper.stahni_a_uloz_texty_pisni(jmeno_umelce="Marpo", cilovy_soubor=argumenty.vstupni_soubor)
        except Exception as e:
            print(f"Chyba při stahování textů: {e}")
            print("Zkus to spustit znovu, a pokud to nepomůže, spusť 'scraper.py' samostatně.")
            sys.exit(1)

    try:
        with open(argumenty.vstupni_soubor, "r", encoding="utf-8") as soubor:
            text_pisne = soubor.read()
            text_pisne = re.sub(r'\([^\n]*?\)|\[[^\n]*?\]|<[^\n]*?>|\{[^\n]*?\}', '', text_pisne, flags=re.MULTILINE)
    except FileNotFoundError:
        print(f"Chyba: Soubor '{argumenty.vstupni_soubor}' nebyl nalezen. Zadej prosím platnou cestu k souboru.")
        sys.exit(1)
    
    print("Generuji Marpov chain...")
    marpov_chain_slova = sestav_marpov_chain(text_pisne, kontextove_okno=argumenty.kontextove_okno)
    
    print("Generuji modely pro strukturu...")
    model_delky_radku, model_pozice_carky = sestav_strukturni_modely(text_pisne)
    
    if not marpov_chain_slova or not model_delky_radku:
        print("Chyba: Nepodařilo se sestavit modely z poskytnutého textu. Zkontroluj prosím vstupní soubor.")
    else:
        print(f"\n--- Generuji {argumenty.celkovy_pocet_radku} řádků textu písně ---")
        vygenerovany_text = generuj_text(
            marpov_chain_slova,
            model_delky_radku,
            model_pozice_carky,
            celkovy_pocet_radku=argumenty.celkovy_pocet_radku,
            kontextove_okno=argumenty.kontextove_okno
        )

        print(vygenerovany_text)
