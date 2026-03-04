#!/usr/bin/env python3
"""
Скрыпт: ідэнтыфікацыя дакументаў і пераназванне ў асэнсаваныя імёны.
Рэжымы:
  --identify   толькі вывесці спіс з апісаннямі (без перайменавання)
  --rename     выканаць перайменаванне (стварыць новую структуру тэчак + mv)
  --dry-run    паказаць, што будзе зроблена без выканання
"""

import os
import sys
import shutil
import argparse
from pathlib import Path
import fitz  # PyMuPDF

ROOT = Path("/Users/serj/projects/poland")

def read_pdf_text(path: Path, pages: int = 2) -> str:
    try:
        doc = fitz.open(str(path))
        text = ""
        for i in range(min(pages, len(doc))):
            text += doc[i].get_text()
        return text.strip()
    except Exception:
        return ""

def month_pl_to_num(month: str) -> str:
    m = {
        "styczeń": "01", "stycznia": "01",
        "luty": "02", "lutego": "02",
        "marzec": "03", "marca": "03",
        "kwiecień": "04", "kwietnia": "04",
        "maj": "05", "maja": "05",
        "czerwiec": "06", "czerwca": "06",
        "lipiec": "07", "lipca": "07",
        "sierpień": "08", "sierpnia": "08",
        "wrzesień": "09", "września": "09",
        "październik": "10", "października": "10",
        "listopad": "11", "listopada": "11",
        "grudzień": "12", "grudnia": "12",
    }
    return m.get(month.lower(), "??")

def detect_zaliczka_month(text: str) -> str:
    import re
    m = re.search(r'podatek za okres\s*\n\s*(\w+)\s*(\d{4})', text, re.IGNORECASE)
    if m:
        return month_pl_to_num(m.group(1)), m.group(2)
    m = re.search(r'Zaliczka na podatek dochodowy za\s*\n?\s*(\w+)', text, re.IGNORECASE)
    if m:
        return month_pl_to_num(m.group(1)), "????"
    return "??", "????"

def detect_invoice_number(text: str):
    import re
    m = re.search(r'nr\s+(FS/[\d/A-Z]+)', text)
    if m:
        return m.group(1).replace("/", "-")
    return None

def detect_zus_trans_date(text: str):
    import re
    m = re.search(r'Data waluty\s*\n?\s*(\d{4}-\d{2}-\d{2})', text)
    if m:
        return m.group(1)
    return None

def detect_pit_period(text: str):
    import re
    m = re.search(r'Okres płatności\s*:\s*(\d{2})M(\d{2})', text)
    if m:
        return m.group(1), m.group(2)
    return None, None

# ─── Правілы перайменавання ───────────────────────────────────────────────────
# Кожны запіс: (source_path_relative, dest_path_relative, description)
# source_path_relative - адносна ROOT
# dest_path_relative   - адносна ROOT (новае імя і месца)

RENAME_MAP = [
    # ═══════════════════════════════════════════════════════
    # КАНТРАКТЫ / CONTRACT
    # ═══════════════════════════════════════════════════════
    ("ИП_Poland/контракт_ч1.pdf",
     "01_contract/01_klika-tech_independent-contractor-agreement_part1.pdf",
     "Кантракт з Klika Tech — частка 1 (умовы)"),
    ("ИП_Poland/контракт_ч2.pdf",
     "01_contract/02_klika-tech_independent-contractor-agreement_part2.pdf",
     "Кантракт з Klika Tech — частка 2 (non-compete)"),
    ("ИП поль]ша/contract/1. INDEPENDENT CONTRACTOR_Agreement.pdf",
     "01_contract/03_klika-tech_independent-contractor-agreement_full.pdf",
     "Кантракт з Klika Tech — поўная версія"),
    ("ИП поль]ша/contract/2. Confidentiality Agreement.pdf",
     "01_contract/04_klika-tech_confidentiality-agreement.pdf",
     "Klika Tech — Confidentiality Agreement"),
    ("ИП поль]ша/contract/3. Declaration of Commitment to Compliance.pdf",
     "01_contract/05_klika-tech_declaration-of-compliance.pdf",
     "Klika Tech — Declaration of Commitment to Compliance"),

    # ═══════════════════════════════════════════════════════
    # РЭГІСТРАЦЫЯ ІП (CEIDG / ZUS / VAT)
    # ═══════════════════════════════════════════════════════
    ("ИП_Poland/CEID.pdf",
     "02_registration/01_ceidg-vypis_2022.pdf",
     "Выпіс з CEIDG — рэгістрацыя ІП 2022"),
    ("ИП_Poland/zaświadczenie-2.pdf",
     "02_registration/02_ceidg-zaswiadczenie_2022.pdf",
     "Zaświadczenie CEIDG — даведка аб рэгістрацыі (2022)"),
    ("ip_poland/zaświadczenie.pdf",
     "02_registration/03_ceidg-zaswiadczenie_2023.pdf",
     "Zaświadczenie CEIDG (2023)"),
    ("внж_бухгалтер/zaświadczenie-2.pdf",
     "02_registration/04_ceidg-zaswiadczenie_bukhgalter.pdf",
     "Zaświadczenie CEIDG — копія ад бухгалтара"),
    ("zaświadczenie-2.pdf",
     "02_registration/05_ceidg-zaswiadczenie_extra.pdf",
     "Zaświadczenie CEIDG — дадатковая копія"),
    ("002337889_2023.pdf",
     "02_registration/06_ceidg-1-zayavka-na-izmeneniye_2023.pdf",
     "CEIDG-1 — заяўка на змену ў рэестры (2023)"),
    ("002024603_2024.pdf",
     "02_registration/07_ceidg-1-zayavka-na-izmeneniye_2024.pdf",
     "CEIDG-1 — заяўка на змену ў рэестры (2024)"),
    ("ИП_Poland/wniosek_VAT.pdf",
     "02_registration/08_vat-zayavka-na-registratsiyu.pdf",
     "Заяўка на рэгістрацыю VAT (Warszawa-Bemowo)"),
    ("ip_poland/UPL-1-5223230478_20220803.pdf",
     "02_registration/09_upl-1_pelномocnictwo-do-deklaratsiy_2022.pdf",
     "UPL-1 — даверанасць на падпісанне дэкларацый (2022, ад бухгалтара)"),
    ("ИП_Poland/upl-1.pdf",
     "02_registration/10_upl-1_pelномocnictwo-do-deklaratsiy_kopia.pdf",
     "UPL-1 — копія даверанасці на дэкларацыі"),
    ("ip_poland/ZUS-SIARHEI PETRASHKA_20220803.pdf",
     "02_registration/11_zus-pel_pelномocnictwo_2022.pdf",
     "ZUS PEL — даверанасць у ZUS (2022, ад бухгалтара)"),
    ("ИП_Poland/zus.pdf",
     "02_registration/12_zus-pel_pelномocnictwo_kopia.pdf",
     "ZUS PEL — копія даверанасці"),
    ("внж_бухгалтер/zza.pdf",
     "02_registration/13_zus-zza-registratsiya-zdrave_2022-07.pdf",
     "ZUS ZZA — рэгістрацыя медыцынскага страхавання (07.07.2022)"),
    ("zcna.pdf",
     "02_registration/14_zus-zcna-chlen-semi_kopia.pdf",
     "ZUS ZCNA — заяўленне на члена сям'і (копія)"),
    ("внж_бухгалтер/zcna .pdf",
     "02_registration/15_zus-zcna-chlen-semi_2022.pdf",
     "ZUS ZCNA — заяўленне на члена сям'і"),
    ("ip_poland/AML.pdf",
     "02_registration/16_aml-oswiadczenie.pdf",
     "AML — заява для бухгалтара (Anti-Money Laundering)"),
    ("ip_poland/Zgoda RODO.pdf",
     "02_registration/17_rodo-zgoda.pdf",
     "Згода на апрацоўку персанальных даных RODO"),
    ("Dane o ubezpieczeniu zdrowotnym.pdf",
     "02_registration/18_nfz-dane-ubezpieczenie-zdrowotne.pdf",
     "NFZ — даныя аб медыцынскім страхаванні (Mazowiecki OW NFZ)"),

    # ═══════════════════════════════════════════════════════
    # ФАКТУРЫ 2022
    # ═══════════════════════════════════════════════════════
    ("ИП_Poland/2022_20220803190826.pdf",
     "03_invoices/2022/invoice_2022-08_FS1_klika-tech.pdf",
     "Фактура FS/1/08/2022 — ліпень 2022, Klika Tech"),
    ("ИП_Poland/2022_20220831170841.pdf",
     "03_invoices/2022/invoice_2022-08_FS2_klika-tech.pdf",
     "Фактура FS/2/08/2022 — жнівень 2022, Klika Tech"),
    ("ИП_Poland/2022_20221003181020.pdf",
     "03_invoices/2022/invoice_2022-10_FS4_klika-tech.pdf",
     "Фактура FS/4/10/2022 — верасень 2022, Klika Tech"),
    ("ИП_Poland/invoice.12-2022.pdf",
     "03_invoices/2022/invoice_2022-12_FS6_klika-tech.pdf",
     "Фактура FS/6/12/2022 — снежань 2022, Klika Tech"),
    ("ip_poland/фактуры/2022_20220803190826.pdf",
     "03_invoices/2022/invoice_2022-08_FS1_klika-tech_kopia.pdf",
     "Фактура FS/1/08/2022 — копія"),

    # ═══════════════════════════════════════════════════════
    # ФАКТУРЫ 2023
    # ═══════════════════════════════════════════════════════
    ("2023_20230301080315.pdf",
     "03_invoices/2023/invoice_2023-03_FS2_klika-tech.pdf",
     "Фактура FS/2/03/2023 — люты 2023, Klika Tech"),
    ("2023_20230301080315-1.pdf",
     "03_invoices/2023/invoice_2023-03_FS2_klika-tech_kopia.pdf",
     "Фактура FS/2/03/2023 — копія"),
    ("ИП поль]ша/invoices/2023_20230131080127-1.pdf",
     "03_invoices/2023/invoice_2023-01_klika-tech.pdf",
     "Фактура студзень 2023, Klika Tech"),
    ("внж 2/updated_docs/factury/2023_20240102090131 (1).pdf",
     "03_invoices/2023/invoice_2023-12_klika-tech.pdf",
     "Фактура снежань 2023, Klika Tech"),

    # ═══════════════════════════════════════════════════════
    # ФАКТУРЫ 2024
    # ═══════════════════════════════════════════════════════
    ("внж 2/updated_docs/factury/2024_20240131090139 (1).pdf",
     "03_invoices/2024/invoice_2024-01_klika-tech.pdf",
     "Фактура студзень 2024, Klika Tech"),
    ("внж 2/update_04_2024/Invoice_siarhei-petrashka_03-2024.pdf",
     "03_invoices/2024/invoice_2024-03_klika-tech.pdf",
     "Фактура сакавік 2024, Klika Tech"),

    # ═══════════════════════════════════════════════════════
    # ФАКТУРЫ 2025
    # ═══════════════════════════════════════════════════════
    ("2025_20250717140758.pdf",
     "03_invoices/2025/invoice_2025-07_FS7_klika-tech.pdf",
     "Фактура FS/7/07/2025, Klika Tech"),
    ("2025_20250717140740.pdf",
     "03_invoices/2025/invoice_2025-07_FS8_klika-tech.pdf",
     "Фактура FS/8/07/2025, Klika Tech"),
    ("2025_20250717140754.pdf",
     "03_invoices/2025/invoice_2025-07_FS8_klika-tech_kopia.pdf",
     "Фактура FS/8/07/2025 — копія"),

    # ═══════════════════════════════════════════════════════
    # СПРАВАЗДАЧА (REPORT)
    # ═══════════════════════════════════════════════════════
    ("ИП_Poland/Report - Report.pdf",
     "04_reports/report_2022-11_november_klika-tech.pdf",
     "Contractor Report — лістапад 2022, 160 гадзін"),

    # ═══════════════════════════════════════════════════════
    # ZUS DRA ДЭКЛАРАЦЫІ 2022
    # ═══════════════════════════════════════════════════════
    ("внж_бухгалтер/dra 07.pdf",
     "05_zus/dra/2022/zus-dra_2022-07.pdf",
     "ZUS DRA — ліпень 2022"),
    ("внж_бухгалтер/dra 08.pdf",
     "05_zus/dra/2022/zus-dra_2022-08.pdf",
     "ZUS DRA — жнівень 2022"),
    ("внж_бухгалтер/dra 09.pdf",
     "05_zus/dra/2022/zus-dra_2022-09.pdf",
     "ZUS DRA — верасень 2022"),
    ("внж_бухгалтер/dra 10.pdf",
     "05_zus/dra/2022/zus-dra_2022-10.pdf",
     "ZUS DRA — кастрычнік 2022"),
    ("внж_бухгалтер/dra 11.pdf",
     "05_zus/dra/2022/zus-dra_2022-11.pdf",
     "ZUS DRA — лістапад 2022"),

    # ZUS DRA 2023
    ("внж 2/ноябрь/Deklaracja ZUSDRA 2023 11 01.pdf",
     "05_zus/dra/2023/zus-dra_2023-11.pdf",
     "ZUS DRA — лістапад 2023"),
    ("внж 2/updated_docs/Deklaracja ZUSDRA 2024 01 01.pdf",
     "05_zus/dra/2024/zus-dra_2024-01.pdf",
     "ZUS DRA — студзень 2024"),

    # UPP — пацвярджэнні ZUS
    ("внж_бухгалтер/upp_-503318878.pdf",
     "05_zus/upp/zus-upp_siarhei_1.pdf",
     "UPP — пацвярджэнне адпраўкі ў ZUS (Siarhei)"),
    ("внж_бухгалтер/upp_-502202457.pdf",
     "05_zus/upp/zus-upp_bukhgalter_1.pdf",
     "UPP — пацвярджэнне (бухгалтар Dzemyanishyn)"),
    ("внж_бухгалтер/upp_-501061210.pdf",
     "05_zus/upp/zus-upp_bukhgalter_2.pdf",
     "UPP — пацвярджэнне (бухгалтар Dzemyanishyn)"),
    ("внж_бухгалтер/upp_-499805054.pdf",
     "05_zus/upp/zus-upp_bukhgalter_3.pdf",
     "UPP — пацвярджэнне (бухгалтар Dzemyanishyn)"),

    # ZUS аплаты (bank transfers) 2022
    ("внж/выписки/zus/pko_trans_details_20230101_163237.pdf",
     "05_zus/payments/2022/zus-payment_2022-08_335pln.pdf",
     "Пераказ ZUS składki 335,94 PLN — 16.08.2022"),
    ("внж/выписки/zus/pko_trans_details_20230101_163258.pdf",
     "05_zus/payments/2022/zus-payment_2022-09_559pln.pdf",
     "Пераказ ZUS składki 559,89 PLN — 16.09.2022"),
    ("внж/выписки/zus/pko_trans_details_20230101_163309.pdf",
     "05_zus/payments/2022/zus-payment_2022-10_335pln.pdf",
     "Пераказ ZUS składki 335,94 PLN — 19.10.2022"),
    ("внж/выписки/zus/pko_trans_details_20230101_163320.pdf",
     "05_zus/payments/2022/zus-payment_2022-11_559pln.pdf",
     "Пераказ ZUS składki 559,89 PLN — 17.11.2022"),
    ("внж/выписки/zus/pko_trans_details_20230101_163331.pdf",
     "05_zus/payments/2022/zus-payment_2022-12_559pln.pdf",
     "Пераказ ZUS składki 559,89 PLN — 28.12.2022"),
    ("внж/выписки/zus/history_20230101_163852.pdf",
     "05_zus/payments/2022/zus-history_2022_pko.pdf",
     "Гісторыя аплат ZUS за 2022 (выпіска PKO)"),
    ("zus_december.pdf",
     "05_zus/payments/2022/zus-payment_2022-12_extra.pdf",
     "Пераказ ZUS снежань 2022 (асобны файл)"),

    # Zaświadczenie ZUS (не запазычанасць / не зала)
    ("внж 2/potwierdzenie.pdf",
     "05_zus/certificates/zus-potwierdzenie-niezalegania_2023-12.pdf",
     "ZUS — пацвярджэнне адсутнасці запазычанасці (18.12.2023)"),

    # ═══════════════════════════════════════════════════════
    # ПАДАТАК PIT / RYCZAŁT
    # ═══════════════════════════════════════════════════════
    # Zaliczki 2022
    ("внж_бухгалтер/zaliczka lipiec.pdf",
     "06_tax/zaliczki/2022/zaliczka-ryczalt_2022-07.pdf",
     "Залічка ryczałt — ліпень 2022"),
    ("внж_бухгалтер/zaliczka sierpień.pdf",
     "06_tax/zaliczki/2022/zaliczka-ryczalt_2022-08.pdf",
     "Залічка ryczałt — жнівень 2022"),
    ("внж_бухгалтер/zaliczka wrzesień.pdf",
     "06_tax/zaliczki/2022/zaliczka-ryczalt_2022-09.pdf",
     "Залічка ryczałt — верасень 2022"),
    ("внж_бухгалтер/zaliczka pażdziernik.pdf",
     "06_tax/zaliczki/2022/zaliczka-ryczalt_2022-10.pdf",
     "Залічка ryczałt — кастрычнік 2022"),
    ("внж_бухгалтер/zaliczka listopad.pdf",
     "06_tax/zaliczki/2022/zaliczka-ryczalt_2022-11.pdf",
     "Залічка ryczałt — лістапад 2022"),

    # Zaliczki 2023 (wfirma IDs -> months)
    ("внж 2/https_wfirma.pl_declaration_tax_view_32825425_print=1.pdf",
     "06_tax/zaliczki/2023/zaliczka-ryczalt_2023-01.pdf",
     "Залічка ryczałt — студзень 2023"),
    ("внж 2/https_wfirma.pl_declaration_tax_view_34382794_print=1.pdf",
     "06_tax/zaliczki/2023/zaliczka-ryczalt_2023-02.pdf",
     "Залічка ryczałt — люты 2023"),
    ("внж 2/https_wfirma.pl_declaration_tax_view_35044676_print=1.pdf",
     "06_tax/zaliczki/2023/zaliczka-ryczalt_2023-03.pdf",
     "Залічка ryczałt — сакавік 2023"),
    ("внж 2/https_wfirma.pl_declaration_tax_view_36644789_print=1.pdf",
     "06_tax/zaliczki/2023/zaliczka-ryczalt_2023-04.pdf",
     "Залічка ryczałt — красавік 2023"),
    ("внж 2/https_wfirma.pl_declaration_tax_view_37754225_print=1.pdf",
     "06_tax/zaliczki/2023/zaliczka-ryczalt_2023-05.pdf",
     "Залічка ryczałt — май 2023"),
    ("внж 2/https_wfirma.pl_declaration_tax_view_38511014_print=1.pdf",
     "06_tax/zaliczki/2023/zaliczka-ryczalt_2023-06.pdf",
     "Залічка ryczałt — чэрвень 2023"),
    ("внж 2/https_wfirma.pl_declaration_tax_view_39647795_print=1.pdf",
     "06_tax/zaliczki/2023/zaliczka-ryczalt_2023-07.pdf",
     "Залічка ryczałt — ліпень 2023"),
    ("внж 2/https_wfirma.pl_declaration_tax_view_40572857_print=1.pdf",
     "06_tax/zaliczki/2023/zaliczka-ryczalt_2023-08.pdf",
     "Залічка ryczałt — жнівень 2023"),
    ("внж 2/https_wfirma.pl_declaration_tax_view_41379275_print=1.pdf",
     "06_tax/zaliczki/2023/zaliczka-ryczalt_2023-09.pdf",
     "Залічка ryczałt — верасень 2023"),
    ("внж 2/https_wfirma.pl_declaration_tax_view_42494231_print=1.pdf",
     "06_tax/zaliczki/2023/zaliczka-ryczalt_2023-10.pdf",
     "Залічка ryczałt — кастрычнік 2023"),
    ("внж 2/ноябрь/https_wfirma.pl_declaration_tax_view_43508222_print=1.pdf",
     "06_tax/zaliczki/2023/zaliczka-ryczalt_2023-11.pdf",
     "Залічка ryczałt — лістапад 2023"),

    # Zaliczki 2024
    ("внж 2/updated_docs/https_wfirma.pl_declaration_tax_view_43508222_print=1.pdf",
     "06_tax/zaliczki/2023/zaliczka-ryczalt_2023-11_kopia.pdf",
     "Залічка ryczałt лістапад 2023 — копія"),
    ("внж 2/updated_docs/https_wfirma.pl_declaration_tax_view_44186447_print=1.pdf",
     "06_tax/zaliczki/2023/zaliczka-ryczalt_2023-12.pdf",
     "Залічка ryczałt — снежань 2023"),
    ("внж 2/updated_docs/https_wfirma.pl_declaration_tax_view_46439801_print=1.pdf",
     "06_tax/zaliczki/2024/zaliczka-ryczalt_2024-02.pdf",
     "Залічка ryczałt — люты 2024"),
    ("внж 2/update_04_2024/https_wfirma.pl_declaration_tax_view_47271863_print=1.pdf",
     "06_tax/zaliczki/2024/zaliczka-ryczalt_2024-03.pdf",
     "Залічка ryczałt — сакавік 2024"),
    ("внж 2/update_04_2024/https_wfirma.pl_declaration_tax_view_49093310_print=1.pdf",
     "06_tax/zaliczki/2024/zaliczka-ryczalt_2024-04.pdf",
     "Залічка ryczałt — красавік 2024"),

    # PIT аплаты (bank transfers 2022)
    ("внж/выписки/pit/pko_trans_details_20230101_163510.pdf",
     "06_tax/pit-payments/2022/pit28-payment_2022-07.pdf",
     "Пераказ PIT-28 ліпень 2022 — Urząd Skarbowy"),
    ("внж/выписки/pit/pko_trans_details_20230101_163546.pdf",
     "06_tax/pit-payments/2022/pit28-payment_2022-08.pdf",
     "Пераказ PIT-28 жнівень 2022 — Urząd Skarbowy"),
    ("внж/выписки/pit/pko_trans_details_20230101_163557.pdf",
     "06_tax/pit-payments/2022/pit28-payment_2022-09.pdf",
     "Пераказ PIT-28 верасень 2022 — Urząd Skarbowy"),
    ("внж/выписки/pit/pko_trans_details_20230101_163605.pdf",
     "06_tax/pit-payments/2022/pit28-payment_2022-10.pdf",
     "Пераказ PIT-28 кастрычнік 2022 — Urząd Skarbowy"),
    ("внж/выписки/pit/history_20230101_163927.pdf",
     "06_tax/pit-payments/2022/pit28-history_2022_pko.pdf",
     "Гісторыя аплат PIT за 2022 (выпіска PKO)"),

    # PIT дэкларацыі
    ("внж 2/Deklaracja PIT28 2022 KOREKTA.pdf",
     "06_tax/declarations/pit28_2022_korrekta.pdf",
     "PIT-28 за 2022 — КАРЭКТА"),
    ("внж 2/Wizualizacja_UPO_PIT28_2022.pdf",
     "06_tax/declarations/pit28_2022_upo-vizualizatsiya.pdf",
     "UPO PIT-28 за 2022 — візуалізацыя пацвярджэння"),

    # Zaświadczenie o niezaleganiu
    ("внж 2/Zaświadczenie_o_niezaleganiu_ZAS‑W_18-12-2023_09-42.pdf",
     "06_tax/certificates/zas-w_niezaleganie_2023-12.pdf",
     "ZAS-W — даведка аб адсутнасці запазычанасці (18.12.2023)"),
    ("ИП поль]ша/Отсканированный документ.pdf",
     "06_tax/certificates/zas-w_niezaleganie_2023-01.pdf",
     "ZAS-W — даведка аб адсутнасці запазычанасці (02.01.2023)"),
    ("Petrashka Siarhei.pdf",
     "06_tax/certificates/naczelnik_pismo_2024-02.pdf",
     "Пісьмо з Naczelnik US Warszawa-Bemowo (26.02.2024)"),
    ("ip_poland/Сканіраваны_20231012-1928.pdf",
     "06_tax/czynnosci/jpkv7m_czynnosci-sprawdzajace_2023-10.pdf",
     "Czynności sprawdzające JPK_V7M — ліст з US (03.10.2023)"),
    ("ip_poland/Сканіраваны_20231012-1929.pdf",
     "06_tax/czynnosci/jpkv7m_czynnosci-sprawdzajace_2023-10_p2.pdf",
     "Czynności sprawdzające JPK_V7M — ліст з US (03.10.2023) ч.2"),

    # ═══════════════════════════════════════════════════════
    # JPK VAT
    # ═══════════════════════════════════════════════════════
    ("внж_бухгалтер/Deklaracja JPKV7M 2022 11.pdf",
     "07_jpk-vat/jpkv7m_2022-11_deklaracja.pdf",
     "Дэкларацыя JPK_V7M — лістапад 2022"),
    ("внж_бухгалтер/UPO_JPKV7M_Listopad_2022/Wizualizacja_UPO_JPKV7M_Listopad_2022.pdf",
     "07_jpk-vat/jpkv7m_2022-11_upo-vizualizatsiya.pdf",
     "UPO JPK_V7M лістапад 2022 — візуалізацыя пацвярджэння"),
    ("внж_бухгалтер/UPO_JPKV7M_Listopad_2022/deklaracja_JPKV7M_Listopad_2022.xml",
     "07_jpk-vat/jpkv7m_2022-11_deklaracja.xml",
     "JPK_V7M лістапад 2022 — XML-дэкларацыя"),
    ("внж_бухгалтер/UPO_JPKV7M_Listopad_2022/UPO_JPKV7M_Listopad_2022.xml",
     "07_jpk-vat/jpkv7m_2022-11_upo.xml",
     "JPK_V7M лістапад 2022 — UPO XML"),
    ("внж 2/ноябрь/Deklaracja JPKV7M 2023 11.pdf",
     "07_jpk-vat/jpkv7m_2023-11_deklaracja.pdf",
     "Дэкларацыя JPK_V7M — лістапад 2023"),
    ("внж 2/ноябрь/Wizualizacja_UPO_JPKV7M_Listopad_2023.pdf",
     "07_jpk-vat/jpkv7m_2023-11_upo-vizualizatsiya.pdf",
     "UPO JPK_V7M лістапад 2023 — візуалізацыя"),
    ("внж 2/ноябрь/Wizualizacja_UPO_ZUSDRA_Listopad_2023.pdf",
     "07_jpk-vat/zusdra_2023-11_upo-vizualizatsiya.pdf",
     "UPO ZUS DRA лістапад 2023 — візуалізацыя"),
    ("внж 2/updated_docs/Deklaracja JPKV7M 2024 01.pdf",
     "07_jpk-vat/jpkv7m_2024-01_deklaracja.pdf",
     "Дэкларацыя JPK_V7M — студзень 2024"),

    # ═══════════════════════════════════════════════════════
    # ЭВІДЭНЦЫЯ ПРЫБЫТКАЎ
    # ═══════════════════════════════════════════════════════
    ("внж_бухгалтер/Ewidencja przychodow 2022 07.pdf",
     "08_ewidencja/2022/ewidencja-przychodow_2022-07.pdf",
     "Ewidencja przychodów — ліпень 2022"),
    ("внж_бухгалтер/Ewidencja przychodow 2022 08.pdf",
     "08_ewidencja/2022/ewidencja-przychodow_2022-08.pdf",
     "Ewidencja przychodów — жнівень 2022"),
    ("внж_бухгалтер/Ewidencja przychodow 2022 09.pdf",
     "08_ewidencja/2022/ewidencja-przychodow_2022-09.pdf",
     "Ewidencja przychodów — верасень 2022"),
    ("внж_бухгалтер/Ewidencja przychodow 2022 10-2.pdf",
     "08_ewidencja/2022/ewidencja-przychodow_2022-10.pdf",
     "Ewidencja przychodów — кастрычнік 2022"),
    ("внж_бухгалтер/Ewidencja przychodow 2022 11-3.pdf",
     "08_ewidencja/2022/ewidencja-przychodow_2022-11.pdf",
     "Ewidencja przychodów — лістапад 2022"),
    ("внж 2/Podsumowanie ewidencji przychodow 2023.pdf",
     "08_ewidencja/2023/podsumowanie-ewidencji_2023.pdf",
     "Paдзяленне прыбыткаў 2023 — гадавое зводнае"),
    ("внж 2/updated_docs/Podsumowanie ewidencji przychodow 2023.pdf",
     "08_ewidencja/2023/podsumowanie-ewidencji_2023_kopia.pdf",
     "Paдзяленне прыбыткаў 2023 — копія"),
    ("внж 2/updated_docs/Ewidencja przychodów 2024.pdf",
     "08_ewidencja/2024/ewidencja-przychodow_2024.pdf",
     "Ewidencja przychodów 2024"),
    ("внж 2/update_04_2024/Podsumowanie ewidencji przychodow 2024.pdf",
     "08_ewidencja/2024/podsumowanie-ewidencji_2024.pdf",
     "Paдзяленне прыбыткаў 2024 — зводнае"),

    # ═══════════════════════════════════════════════════════
    # БАНКАЎСКІЯ ВЫПІСКІ - Агульная гісторыя
    # ═══════════════════════════════════════════════════════
    ("внж/выписки/payments/history_20230101_164329.pdf",
     "09_bank/history/pko-history_2022_fakturny-rachunek_3str.pdf",
     "Гісторыя рахунку PKO (фактурны 9410...) 2022, 3 стар."),
    ("внж/выписки/payments/history_20230101_164920.pdf",
     "09_bank/history/pko-history_2022_fakturny-rachunek_7str.pdf",
     "Гісторыя рахунку PKO (фактурны 9410...) 2022, 7 стар."),
    ("внж/выписки/payments/history_20230101_165003.pdf",
     "09_bank/history/pko-history_2022_asabisty-rachunek_16str.pdf",
     "Гісторыя рахунку PKO (асабісты 8710...) 2022, 16 стар."),
    ("внж/выписки/payments/history_20230101_165257.pdf",
     "09_bank/history/pko-history_2022_asabisty-rachunek_16str_v2.pdf",
     "Гісторыя рахунку PKO (асабісты 8710...) 2022, 16 стар. v2"),

    # ═══════════════════════════════════════════════════════
    # БАНКАЎСКІЯ ВЫПІСКІ - УВАХОДНЫ ДАХОД (income)
    # ═══════════════════════════════════════════════════════
    ("внж 2/bank/income/pko_trans_details_20231219_091821.pdf",
     "09_bank/income/income-transfer_2023_01.pdf",
     "Пераказ — уваходны плацёж 2023 (Klika Tech)"),
    ("внж 2/bank/income/pko_trans_details_20231219_095117.pdf",
     "09_bank/income/income-transfer_2023_02.pdf",
     "Пераказ — уваходны плацёж 2023"),
    ("внж 2/bank/income/pko_trans_details_20231219_095138.pdf",
     "09_bank/income/income-transfer_2023_03.pdf",
     "Пераказ — уваходны плацёж 2023"),
    ("внж 2/bank/income/pko_trans_details_20231219_095148.pdf",
     "09_bank/income/income-transfer_2023_04.pdf",
     "Пераказ — уваходны плацёж 2023"),
    ("внж 2/bank/income/pko_trans_details_20231219_095159.pdf",
     "09_bank/income/income-transfer_2023_05.pdf",
     "Пераказ — уваходны плацёж 2023"),
    ("внж 2/bank/income/pko_trans_details_20231219_095214.pdf",
     "09_bank/income/income-transfer_2023_06.pdf",
     "Пераказ — уваходны плацёж 2023"),
    ("внж 2/bank/income/pko_trans_details_20231219_095246.pdf",
     "09_bank/income/income-transfer_2023_07.pdf",
     "Пераказ — уваходны плацёж 2023"),
    ("внж 2/bank/income/pko_trans_details_20231219_095259.pdf",
     "09_bank/income/income-transfer_2023_08.pdf",
     "Пераказ — уваходны плацёж 2023"),
    ("внж 2/bank/income/pko_trans_details_20231219_095311.pdf",
     "09_bank/income/income-transfer_2023_09.pdf",
     "Пераказ — уваходны плацёж 2023"),
    ("внж 2/bank/income/pko_trans_details_20231219_095332.pdf",
     "09_bank/income/income-transfer_2023_10.pdf",
     "Пераказ — уваходны плацёж 2023"),
    ("внж 2/bank/income/pko_trans_details_20231219_095344.pdf",
     "09_bank/income/income-transfer_2023_11.pdf",
     "Пераказ — уваходны плацёж 2023"),
    ("внж 2/bank/income/pko_trans_details_20231219_095356.pdf",
     "09_bank/income/income-transfer_2023_12.pdf",
     "Пераказ — уваходны плацёж 2023"),
    ("внж 2/bank/income/pko_trans_details_20231219_095415.pdf",
     "09_bank/income/income-transfer_2023_13.pdf",
     "Пераказ — уваходны плацёж 2023"),
    ("внж 2/bank/income/pko_trans_details_20231219_095424.pdf",
     "09_bank/income/income-transfer_2023_14.pdf",
     "Пераказ — уваходны плацёж 2023"),
    ("внж 2/bank/income/Подтверждение_операции_06.04.2023.pdf",
     "09_bank/income/income-transfer_2023-04-06_pryorbank.pdf",
     "Пацвярджэнне аперацыі з Приорбанк — 06.04.2023"),

    # ═══════════════════════════════════════════════════════
    # БАНКАЎСКІЯ ВЫПІСКІ — PIT payments 2023
    # ═══════════════════════════════════════════════════════
    ("внж 2/bank/pit/Подтверждение_операции_13.02.2023.pdf",
     "06_tax/pit-payments/2023/pit-payment_2023-02-13_pryorbank.pdf",
     "Пацвярджэнне аплаты PIT (Приорбанк) — 13.02.2023"),
    ("внж 2/bank/pit/pko_trans_details_20231219_091804.pdf",
     "06_tax/pit-payments/2023/pit28-payment_2023_01.pdf",
     "Пераказ PIT 2023 — 01"),
    ("внж 2/bank/pit/pko_trans_details_20231219_092009.pdf",
     "06_tax/pit-payments/2023/pit28-payment_2023_02.pdf",
     "Пераказ PIT 2023 — 02"),
    ("внж 2/bank/pit/pko_trans_details_20231219_092024.pdf",
     "06_tax/pit-payments/2023/pit28-payment_2023_03.pdf",
     "Пераказ PIT 2023 — 03"),
    ("внж 2/bank/pit/pko_trans_details_20231219_092037.pdf",
     "06_tax/pit-payments/2023/pit28-payment_2023_04.pdf",
     "Пераказ PIT 2023 — 04"),
    ("внж 2/bank/pit/pko_trans_details_20231219_092049.pdf",
     "06_tax/pit-payments/2023/pit28-payment_2023_05.pdf",
     "Пераказ PIT 2023 — 05"),
    ("внж 2/bank/pit/pko_trans_details_20231219_092103.pdf",
     "06_tax/pit-payments/2023/pit28-payment_2023_06.pdf",
     "Пераказ PIT 2023 — 06"),
    ("внж 2/bank/pit/pko_trans_details_20231219_092117.pdf",
     "06_tax/pit-payments/2023/pit28-payment_2023_07.pdf",
     "Пераказ PIT 2023 — 07"),
    ("внж 2/bank/pit/pko_trans_details_20231219_092139.pdf",
     "06_tax/pit-payments/2023/pit28-payment_2023_08.pdf",
     "Пераказ PIT 2023 — 08"),
    ("внж 2/bank/pit/pko_trans_details_20231219_092150.pdf",
     "06_tax/pit-payments/2023/pit28-payment_2023_09.pdf",
     "Пераказ PIT 2023 — 09"),
    ("внж 2/bank/pit/pko_trans_details_20231219_092206.pdf",
     "06_tax/pit-payments/2023/pit28-payment_2023_10.pdf",
     "Пераказ PIT 2023 — 10"),
    ("внж 2/bank/pit/pko_trans_details_20231219_092223.pdf",
     "06_tax/pit-payments/2023/pit28-payment_2023_11.pdf",
     "Пераказ PIT 2023 — 11"),
    ("внж 2/updated_docs/pko_trans_details_20240221_114800.pdf",
     "06_tax/pit-payments/2024/pit28-payment_2024_01.pdf",
     "Пераказ PIT 2024 — 01"),
    ("внж 2/updated_docs/pko_trans_details_20240221_114808.pdf",
     "06_tax/pit-payments/2024/pit28-payment_2024_02.pdf",
     "Пераказ PIT 2024 — 02"),
    ("внж 2/updated_docs/pko_trans_details_20240221_114816.pdf",
     "06_tax/pit-payments/2024/pit28-payment_2024_03.pdf",
     "Пераказ PIT 2024 — 03"),
    ("внж 2/updated_docs/pko_trans_details_20240221_114828.pdf",
     "06_tax/pit-payments/2024/pit28-payment_2024_04.pdf",
     "Пераказ PIT 2024 — 04"),
    ("внж 2/updated_docs/pko_trans_details_20240221_114902.pdf",
     "06_tax/pit-payments/2024/pit28-payment_2024_05.pdf",
     "Пераказ PIT 2024 — 05"),

    # ═══════════════════════════════════════════════════════
    # БАНКАЎСКІЯ ВЫПІСКІ — VAT payments 2023
    # ═══════════════════════════════════════════════════════
    ("внж 2/bank/vat/pko_trans_details_20231219_091735.pdf",
     "09_bank/vat/vat-payment_2023_01.pdf",
     "Пераказ VAT 2023 — 01"),
    ("внж 2/bank/vat/pko_trans_details_20231219_092651.pdf",
     "09_bank/vat/vat-payment_2023_02.pdf",
     "Пераказ VAT 2023 — 02"),
    ("внж 2/bank/vat/pko_trans_details_20231219_092708.pdf",
     "09_bank/vat/vat-payment_2023_03.pdf",
     "Пераказ VAT 2023 — 03"),
    ("внж 2/bank/vat/pko_trans_details_20231219_092724.pdf",
     "09_bank/vat/vat-payment_2023_04.pdf",
     "Пераказ VAT 2023 — 04"),
    ("внж 2/bank/vat/pko_trans_details_20231219_092740.pdf",
     "09_bank/vat/vat-payment_2023_05.pdf",
     "Пераказ VAT 2023 — 05"),
    ("внж 2/bank/vat/pko_trans_details_20231219_092850.pdf",
     "09_bank/vat/vat-payment_2023_06.pdf",
     "Пераказ VAT 2023 — 06"),
    ("внж 2/bank/vat/pko_trans_details_20231219_092907.pdf",
     "09_bank/vat/vat-payment_2023_07.pdf",
     "Пераказ VAT 2023 — 07"),
    ("внж 2/bank/vat/pko_trans_details_20231219_092940.pdf",
     "09_bank/vat/vat-payment_2023_08.pdf",
     "Пераказ VAT 2023 — 08"),
    ("внж 2/bank/vat/pko_trans_details_20231219_092956.pdf",
     "09_bank/vat/vat-payment_2023_09.pdf",
     "Пераказ VAT 2023 — 09"),
    ("внж 2/bank/vat/pko_trans_details_20231219_093020.pdf",
     "09_bank/vat/vat-payment_2023_10.pdf",
     "Пераказ VAT 2023 — 10"),
    ("внж 2/bank/vat/pko_trans_details_20231219_093037.pdf",
     "09_bank/vat/vat-payment_2023_11.pdf",
     "Пераказ VAT 2023 — 11"),
    ("внж 2/bank/vat/pko_trans_details_20231219_093052.pdf",
     "09_bank/vat/vat-payment_2023_12.pdf",
     "Пераказ VAT 2023 — 12"),
    ("внж 2/bank/vat/pko_trans_details_20231219_093135.pdf",
     "09_bank/vat/vat-payment_2023_13.pdf",
     "Пераказ VAT 2023 — 13"),

    # ZUS payments 2023
    ("внж 2/bank/zus/pko_trans_details_20231219_091743.pdf",
     "05_zus/payments/2023/zus-payment_2023_01.pdf",
     "Пераказ ZUS 2023 — 01"),
    ("внж 2/bank/zus/pko_trans_details_20231219_094436.pdf",
     "05_zus/payments/2023/zus-payment_2023_02.pdf",
     "Пераказ ZUS 2023 — 02"),
    ("внж 2/bank/zus/pko_trans_details_20231219_094451.pdf",
     "05_zus/payments/2023/zus-payment_2023_03.pdf",
     "Пераказ ZUS 2023 — 03"),
    ("внж 2/bank/zus/pko_trans_details_20231219_094505.pdf",
     "05_zus/payments/2023/zus-payment_2023_04.pdf",
     "Пераказ ZUS 2023 — 04"),
    ("внж 2/bank/zus/pko_trans_details_20231219_094527.pdf",
     "05_zus/payments/2023/zus-payment_2023_05.pdf",
     "Пераказ ZUS 2023 — 05"),
    ("внж 2/bank/zus/pko_trans_details_20231219_094537.pdf",
     "05_zus/payments/2023/zus-payment_2023_06.pdf",
     "Пераказ ZUS 2023 — 06"),
    ("внж 2/bank/zus/pko_trans_details_20231219_094559.pdf",
     "05_zus/payments/2023/zus-payment_2023_07.pdf",
     "Пераказ ZUS 2023 — 07"),
    ("внж 2/bank/zus/pko_trans_details_20231219_094640.pdf",
     "05_zus/payments/2023/zus-payment_2023_08.pdf",
     "Пераказ ZUS 2023 — 08"),
    ("внж 2/bank/zus/pko_trans_details_20231219_094703.pdf",
     "05_zus/payments/2023/zus-payment_2023_09.pdf",
     "Пераказ ZUS 2023 — 09"),
    ("внж 2/bank/zus/pko_trans_details_20231219_094729.pdf",
     "05_zus/payments/2023/zus-payment_2023_10.pdf",
     "Пераказ ZUS 2023 — 10"),
    ("внж 2/bank/zus/pko_trans_details_20231219_094738.pdf",
     "05_zus/payments/2023/zus-payment_2023_11.pdf",
     "Пераказ ZUS 2023 — 11"),
    ("внж 2/bank/zus/pko_trans_details_20231219_094747.pdf",
     "05_zus/payments/2023/zus-payment_2023_12.pdf",
     "Пераказ ZUS 2023 — 12"),
    ("внж 2/bank/zus/pko_trans_details_20231219_094806.pdf",
     "05_zus/payments/2023/zus-payment_2023_13.pdf",
     "Пераказ ZUS 2023 — 13"),
    ("внж 2/bank/zus/pko_trans_details_20231219_094818.pdf",
     "05_zus/payments/2023/zus-payment_2023_14.pdf",
     "Пераказ ZUS 2023 — 14"),
    ("pko_trans_details_20230226_152447.pdf",
     "09_bank/other/pko-payment_2023-02-26_siarhei-nadzeya.pdf",
     "Пераказ PKO (сумесны рахунак Siarhei+Nadzeya) — 26.02.2023"),

    # ═══════════════════════════════════════════════════════
    # ЖЫЛЛЁ / NAJM / HIPOTEK
    # ═══════════════════════════════════════════════════════
    ("old_VNG/Сканирование_20220628-0919.pdf",
     "10_housing/umowa-najmu-okazjonalnego_2022-06-27_gen-coopera.pdf",
     "Umowa najmu okazjonalnego — кв. Gen. Coopera 12A/8, 27.06.2022"),
    ("внж 2/договор_жилье.pdf",
     "10_housing/umowa-najmu-okazjonalnego_2022-06-27_gen-coopera_kopia.pdf",
     "Umowa najmu okazjonalnego — копія"),
    ("ip_poland/договор аренды.pdf",
     "10_housing/aneks-2_umowa-najmu_2024-03-10_gen-coopera.pdf",
     "Анекс №2 да дамовы найму — Gen. Coopera, 10.03.2024"),
    ("Aneks do Umowy najmu okazjonalnego .pdf",
     "10_housing/aneks-umowy-najmu-okazjonalnego.pdf",
     "Анекс да umowy najmu okazjonalnego"),
    ("Документ_2024-08-27_153621.pdf",
     "10_housing/umowa-przedwstepna_sprzedazy_herbu-oksza-12-41_2024-08-26.pdf",
     "Umowa przedwstępna — продаж кв. Herbu Oksza 12/41, 26.08.2024"),
    ("Договор Урсус (2).pdf",
     "10_housing/umowa-posrednictwa-zakup-nieruchomosci_ursus_2024.pdf",
     "Umowa pośrednictwa — куплі нерухомасці, Urсус, 2024"),
    ("domowa_hypotechna_2024-09-24_170655.pdf",
     "10_housing/umowa-kredyt-hipoteczny_mbank_KHB122682410_2024-09-24.pdf",
     "Іпатэчны крэдыт mBank — KHB122682410, 2024"),
    ("confirm_2024-09-18_152711.pdf",
     "10_housing/wniosek-kredyt-hipoteczny_mbank_KHB122682410_p1.pdf",
     "Заяўка на іпатэчны крэдыт mBank — частка 1"),
    ("confirm_2024-09-18_175802.pdf",
     "10_housing/wniosek-kredyt-hipoteczny_mbank_KHB122682410_p2.pdf",
     "Заяўка на іпатэчны крэдыт mBank — частка 2"),
    ("confirm_2_2024-09-18_180426.pdf",
     "10_housing/wniosek-kredyt-hipoteczny_mbank_KHB122682410_p3.pdf",
     "Заяўка на іпатэчны крэдыт mBank — частка 3"),

    # ═══════════════════════════════════════════════════════
    # ВНЖ 1 — ПОБЫТ ЧАСОВЫ (Siarhei, 2022-2023)
    # ═══════════════════════════════════════════════════════
    ("docks/ProceedingsDocument (5).pdf",
     "11_vnzh/siarhei/2022/wniosek-pobyt-czasowy_blank_v1.pdf",
     "Бланк заяўкі на побыт часовы (чысты, v1)"),
    ("docks/ProceedingsDocument (6).pdf",
     "11_vnzh/siarhei/2022/wniosek-pobyt-czasowy_blank_v2.pdf",
     "Бланк заяўкі на побыт часовы (чысты, v2)"),
    ("docks/wniosek.pdf",
     "11_vnzh/siarhei/2022/wniosek-pobyt-czasowy_blank_v3.pdf",
     "Бланк заяўкі на побыт часовы (чысты, v3)"),
    ("внж/anketa_example.pdf",
     "11_vnzh/siarhei/2022/ankieta-jdg_primer-s-podkazkami.pdf",
     "Прыклад анкеты JDG — з падказкамі на рускай"),
    ("внж/анкееееееа.doc",
     "11_vnzh/siarhei/2022/ankieta-jdg_zapouneny-variant-1.doc",
     "Анкета JDG — запоўнены варыянт 1"),
    ("внж/анкетаа.doc",
     "11_vnzh/siarhei/2022/ankieta-jdg_zapouneny-variant-2.doc",
     "Анкета JDG — запоўнены варыянт 2"),
    ("внж/ANKIETA PROM.docx",
     "11_vnzh/siarhei/2022/ankieta-prom.docx",
     "Анкета PROM"),

    # Пашпарт-даверанасці 2022
    ("внж/Варшава доверенность НОВАЯ NADZEYA.doc",
     "11_vnzh/nadzeya/2022/doverennost-varshava_nadzeya_2022-12.doc",
     "Даверанасць — Nadzeya, Варшава (28.12.2022)"),
    ("внж/Варшава_доверенность_НОВАЯ_SIARHEI_PETRASHKA.doc",
     "11_vnzh/siarhei/2022/doverennost-varshava_siarhei_2022-12.doc",
     "Даверанасць — Siarhei, Варшава (28.12.2022)"),
    ("docks/Варшава доверенность SIARHEI PETRASHKA.doc",
     "11_vnzh/siarhei/2022/doverennost-varshava_siarhei_2022-10.doc",
     "Даверанасць — Siarhei, Варшава (28.10.2022)"),
    ("docks/Варшава доверенность NADZEYA PETRASHKA.doc",
     "11_vnzh/nadzeya/2022/doverennost-varshava_nadzeya_2022-10.doc",
     "Даверанасць — Nadzeya, Варшава (28.10.2022)"),
    ("ip_poland/внж/Варшава доверенность НОВАЯ NADZEYA(2).doc",
     "11_vnzh/nadzeya/2022/doverennost-varshava_nadzeya_2022-12_v2.doc",
     "Даверанасць — Nadzeya, Варшава (варыянт 2)"),
    ("ip_poland/внж/Варшава_доверенность_НОВАЯ_SIARHEI_PETRASHKA(2).doc",
     "11_vnzh/siarhei/2022/doverennost-varshava_siarhei_2022-12_v2.doc",
     "Даверанасць — Siarhei, Варшава (варыянт 2)"),
    ("docks/oswiadczenie_o_liczbie_osob_na_utrzymaniu.docx",
     "11_vnzh/siarhei/2022/oswiadczenie-liczba-osob-na-utrzymaniu.docx",
     "Заява аб колькасці асоб на ўтрыманні"),
    ("внж 2/oswiadczenie_o_liczbie_osob_na_utrzymaniu.docx",
     "11_vnzh/siarhei/2023/oswiadczenie-liczba-osob-na-utrzymaniu.docx",
     "Заява аб колькасці асоб на ўтрыманні (2023)"),

    # Скрыншоты статусу
    ("внж/photo_2022-09-28_10-08-11.jpg",
     "11_vnzh/siarhei/2022/screenshot_google-maps_marszalkowska5.jpg",
     "Скрыншот Google Maps — адрас USC Marszałkowska 5"),
    ("внж/photo_2022-10-14_18-27-39.jpg",
     "11_vnzh/siarhei/2022/screenshot_2022-10-14_unknown.jpg",
     "Скрыншот (нечытальны) — 14.10.2022"),
    ("внж/photo_2022-11-21_11-24-05.jpg",
     "11_vnzh/siarhei/2022/screenshot_status-siarhei_vizit-2023-01-02.jpg",
     "Статус справы ВНЖ Siarhei — візіт 02.01.2023"),
    ("внж/photo_2022-11-21_11-26-09.jpg",
     "11_vnzh/nadzeya/2022/screenshot_status-nadzeya_vizit-2023-01-02.jpg",
     "Статус справы ВНЖ Nadzeya — візіт 02.01.2023"),

    # Рашэнне аб ВНЖ
    ("ip_poland/внж/Сканіраваны_20231224-1615.pdf",
     "11_vnzh/siarhei/2023/decyzja-pobyt-czasowy_2023-03.pdf",
     "DECYZJA — рашэнне аб часовым побыце (23.03.2023)"),

    # ═══════════════════════════════════════════════════════
    # ВНЖ 2 — POBYT CZASOWY (2023-2024, Siarhei)
    # ═══════════════════════════════════════════════════════
    ("внж 2/Ankieta_dotyczaca_prowadzonej_dzialalnosci_gospodarczej_wzor_JDG.pdf",
     "11_vnzh/siarhei/2023/ankieta-jdg_blank-wzor.pdf",
     "Анкета JDG — чысты ўзор (2023)"),
    ("внж 2/Ankieta_dotyczaca_prowadzonej_dzialalnosci_gospodarczej1 (1).doc",
     "11_vnzh/siarhei/2023/ankieta-jdg_zapouneny.doc",
     "Анкета JDG — запоўненая (2023)"),
    ("внж 2/e5c8711f-e51f-419e-a31d-3233deb13ca6.pdf",
     "11_vnzh/siarhei/2023/zawiadomienie_muw_ws-ii_2023-12-17.pdf",
     "Zawiadomienie з MUW — WSC-II-P.6151 (17.12.2023)"),
    ("Отсканированный документ 2.pdf",
     "11_vnzh/siarhei/2025/zawiadomienie_muw_2025-01-02.pdf",
     "Zawiadomienie з MUW — Siarhei Petrashka (02.01.2025)"),
    ("old_VNG/Отсканированный документ 11.pdf",
     "11_vnzh/others/zawiadomienie_muw_natalia-pratasevich_2025-01.pdf",
     "Zawiadomienie з MUW — Natalia Pratasevich (01.2025)"),
    ("Отсканированный документ.pdf",
     "11_vnzh/siarhei/2025/zawiadomienie_muw_2025-01-02_kopia.pdf",
     "Zawiadomienie з MUW (копія)"),
    ("old_VNG/Отсканированный документ.pdf",
     "11_vnzh/siarhei/2025/zawiadomienie_muw_2025-01-02_old-vng.pdf",
     "Zawiadomienie з MUW — копія з old_VNG"),

    # Wydruki (распісанне з WSC)
    ("внж 2/wydruki.pdf",
     "11_vnzh/siarhei/2023/wydruk-wsc_1.pdf",
     "Wydruk WSC (візіт / запіс) — 1"),
    ("внж 2/wydruki-2.pdf",
     "11_vnzh/siarhei/2023/wydruk-wsc_2.pdf",
     "Wydruk WSC — 2"),
    ("внж 2/wydruki-3.pdf",
     "11_vnzh/siarhei/2023/wydruk-wsc_3.pdf",
     "Wydruk WSC — 3"),
    ("внж 2/wydruki-4.pdf",
     "11_vnzh/siarhei/2023/wydruk-wsc_4.pdf",
     "Wydruk WSC — 4"),
    ("внж 2/update_04_2024/wydruki.pdf",
     "11_vnzh/siarhei/2024/wydruk-wsc_2024_1.pdf",
     "Wydruk WSC 2024 — 1"),
    ("внж 2/update_04_2024/wydruki-2.pdf",
     "11_vnzh/siarhei/2024/wydruk-wsc_2024_2.pdf",
     "Wydruk WSC 2024 — 2"),
    ("внж 2/update_04_2024/wydruki-3.pdf",
     "11_vnzh/siarhei/2024/wydruk-wsc_2024_3.pdf",
     "Wydruk WSC 2024 — 3"),
    ("внж 2/update_04_2024/wydruki-4.pdf",
     "11_vnzh/siarhei/2024/wydruk-wsc_2024_4.pdf",
     "Wydruk WSC 2024 — 4"),
    ("внж 2/updates/wydruki.pdf",
     "11_vnzh/siarhei/2024/wydruk-wsc_updates_1.pdf",
     "Wydruk WSC updates — 1"),
    ("внж 2/updates/wydruki-2.pdf",
     "11_vnzh/siarhei/2024/wydruk-wsc_updates_2.pdf",
     "Wydruk WSC updates — 2"),
    ("внж 2/updates/wydruki-3.pdf",
     "11_vnzh/siarhei/2024/wydruk-wsc_updates_3.pdf",
     "Wydruk WSC updates — 3"),
    ("внж 2/updates/wydruki-4.pdf",
     "11_vnzh/siarhei/2024/wydruk-wsc_updates_4.pdf",
     "Wydruk WSC updates — 4"),
    ("внж 2/updates/wydruki-5.pdf",
     "11_vnzh/siarhei/2024/wydruk-wsc_updates_5.pdf",
     "Wydruk WSC updates — 5"),
    ("внж 2/updates/wydruki-6.pdf",
     "11_vnzh/siarhei/2024/wydruk-wsc_updates_6.pdf",
     "Wydruk WSC updates — 6"),
    ("внж 2/updated_docs/wydruki.pdf",
     "11_vnzh/siarhei/2024/wydruk-wsc_updated-docs_1.pdf",
     "Wydruk WSC updated_docs — 1"),
    ("внж 2/updated_docs/wydruki-2.pdf",
     "11_vnzh/siarhei/2024/wydruk-wsc_updated-docs_2.pdf",
     "Wydruk WSC updated_docs — 2"),
    ("внж 2/updated_docs/wydruki-3.pdf",
     "11_vnzh/siarhei/2024/wydruk-wsc_updated-docs_3.pdf",
     "Wydruk WSC updated_docs — 3"),
    ("внж 2/updated_docs/wydruki-4.pdf",
     "11_vnzh/siarhei/2024/wydruk-wsc_updated-docs_4.pdf",
     "Wydruk WSC updated_docs — 4"),

    # ВНЖ — Надзея (Пеця_ВНЖ)
    ("Пеця_ВНЖ/ProceedingsDocument-2.pdf",
     "11_vnzh/nadzeya/2023/wniosek-pobyt-czasowy_blank.pdf",
     "Бланк заяўкі на побыт часовы — Nadzeya"),
    ("Пеця_ВНЖ/pobcz.pdf",
     "11_vnzh/nadzeya/2023/pobyt-czasowy_blank-v2.pdf",
     "Pobyt czasowy — бланк v2 (Nadzeya)"),
    ("2026/wniosek Nadzeya.pdf",
     "11_vnzh/nadzeya/2026/wniosek-pobyt-czasowy_nadzeya_2026.pdf",
     "Заяўка на побыт часовы — Nadzeya, 2026"),
    ("2026/Pełnomocnictwo Nadzeya.pages",
     "11_vnzh/nadzeya/2026/pelnomocnictwo-nadzeya_2026.pages",
     "Даверанасць Nadzeya 2026 (Apple Pages)"),

    # ВНЖ — бізнес-план / анкеты
    ("внж 2/biznesplan/Гайд по Бизнес-Плану JDG IT.pdf",
     "11_vnzh/siarhei/2023/biznesplan_gayd-jdg-it.pdf",
     "Гайд па бізнес-плане JDG IT"),
    ("внж 2/biznesplan/Ankieta_dotyczaca_prowadzonej_dzialalnosci_gospodarczej_wzor_JDG.pdf",
     "11_vnzh/siarhei/2023/biznesplan_ankieta-wzor.pdf",
     "Анкета JDG — узор (бізнес-план)"),
    ("внж 2/biznesplan/my_BP.docx",
     "11_vnzh/siarhei/2023/biznesplan_moj-biznes-plan.docx",
     "Мой бізнес-план"),
    ("внж 2/biznesplan/Ankieta_dotyczaca_prowadzonej_dzialalnosci_gospodarczej.docx",
     "11_vnzh/siarhei/2023/biznesplan_ankieta-zapounena.docx",
     "Анкета JDG — запоўненая (docx)"),
    ("ip_poland/внж/Updated_Biznes-plan Valery Varantsou.docx",
     "11_vnzh/others/biznesplan_valery-varantsou.docx",
     "Бізнес-план — Valery Varantsou (прыклад)"),
    ("ip_poland/внж/Updated_Opis działalności JDG Valery Varantsou.docx",
     "11_vnzh/others/opis-dzialalnosci_valery-varantsou.docx",
     "Апісанне дзейнасці JDG — Valery Varantsou (прыклад)"),
    ("ip_poland/внж/Ankieta_dotyczaca_prowadzonej_dzialalnosci_gospodarczej1 (1).docx",
     "11_vnzh/siarhei/2023/ankieta-jdg_zapouneny_v2.docx",
     "Анкета JDG — запоўненая варыянт 2 (docx)"),

    # ═══════════════════════════════════════════════════════
    # ДАКУМЕНТЫ ІНШЫХ ЛЮДЗЕЙ
    # ═══════════════════════════════════════════════════════
    ("c1171456-a325-11ed-a03d-393838383133.pdf",
     "12_others/agaton-ltd_invoice_petrascho-sergei.pdf",
     "Фактура ад Agaton Ltd (Кіпр) — Петрашко Сяргей"),
    ("Варшава.pdf",
     "12_others/podanie-karta-pobytu-bez-adresu.pdf",
     "Падання — выдача карты побыту без адресу прапіскі (бланк)"),
    ("old_VNG/customs_ru.pdf",
     "12_others/tamozhennaya-deklaratsiya_pasazhirskaya.pdf",
     "Пасажырская мытная дэкларацыя (РФ/ЕАЭС)"),

    # Банкаўскія чэкі з Беларусі
    ("checkFile_406194841_1941083781.pdf",
     "12_others/priorbank_kart-chek_2022-06-30_petrashou.pdf",
     "Чэк Приорбанк — Петрашко, 30.06.2022"),
    ("old_VNG/paymentCheck_Out1132860458871880244.pdf",
     "12_others/priorbank_kart-chek_2022-08-25_petrashou.pdf",
     "Чэк Приорбанк — Петрашко, 25.08.2022"),

    # ═══════════════════════════════════════════════════════
    # ДАКУМЕНТЫ — ФОТА / СКАНЫ
    # ═══════════════════════════════════════════════════════
    ("docks/договор_жилье.pdf",
     "10_housing/umowa-najmu-okazjonalnego_2022-06-27_gen-coopera_docks.pdf",
     "Umowa najmu — копія з docks"),
    ("docks/camphoto_758783491.jpeg",
     "11_vnzh/siarhei/2022/foto_dokument_1.jpeg",
     "Фота дакумента 1"),
    ("docks/IMG_0028.jpeg",
     "11_vnzh/siarhei/2022/foto_dokument_2.jpeg",
     "Фота дакумента 2"),
    ("docks/IMG_0029.jpeg",
     "11_vnzh/siarhei/2022/foto_dokument_3.jpeg",
     "Фота дакумента 3"),
    ("docks/IMG_0031.jpeg",
     "11_vnzh/siarhei/2022/foto_dokument_4.jpeg",
     "Фота дакумента 4"),
    ("docks/IMG_0033.jpeg",
     "11_vnzh/siarhei/2022/foto_dokument_5.jpeg",
     "Фота дакумента 5"),
    ("docks/IMG_0038.jpeg",
     "11_vnzh/siarhei/2022/foto_dokument_6.jpeg",
     "Фота дакумента 6"),
    ("docks/IMG_0039.jpeg",
     "11_vnzh/siarhei/2022/foto_dokument_7.jpeg",
     "Фота дакумента 7"),
    ("docks/IMG_0043.jpeg",
     "11_vnzh/siarhei/2022/foto_dokument_8.jpeg",
     "Фота дакумента 8"),
    ("docks/IMG_0044.jpeg",
     "11_vnzh/siarhei/2022/foto_dokument_9.jpeg",
     "Фота дакумента 9"),

    # Лагатып
    ("внж_бухгалтер/mcg logo mail.jpg",
     "00_meta/mcg-consult-group_logo.jpg",
     "Лагатып MCG Consult Group (бухгалтарская кампанія)"),
    ("внж 2/ноябрь/mcg logo mail.jpg",
     "00_meta/mcg-consult-group_logo_kopia.jpg",
     "Лагатып MCG — копія"),
    ("внж 2/updates/mcg logo mail.jpg",
     "00_meta/mcg-consult-group_logo_kopia2.jpg",
     "Лагатып MCG — копія 2"),

    # ═══════════════════════════════════════════════════════
    # РОЗНА
    # ═══════════════════════════════════════════════════════
    ("ssgenai_building_agents_labs.pdf",
     "00_meta/ssgenai_building-agents-labs.pdf",
     "AWS SSGenAI — матэрыялы курса Building Agents Labs"),
    ("ip_poland/Umowa-MCG-5223230478_20220803.docx",
     "02_registration/19_umowa-z-mcg_2022-08-03.docx",
     "Umowa з MCG (бухгалтар) — 03.08.2022"),
    ("ip_poland/Umowa-MCG-5223230478_20220803(1).docx",
     "02_registration/20_umowa-z-mcg_2022-08-03_v2.docx",
     "Umowa з MCG (бухгалтар) — варыянт 2"),
    ("внж 2/bank/Новый документ.docx",
     "09_bank/other/novy-dokument-bank.docx",
     "Новы дакумент (банк)"),
    ("внж 2/biznesplan/items.txt",
     "11_vnzh/siarhei/2023/biznesplan_items.txt",
     "Спіс элементаў бізнес-плана"),
]

# Файлы якія ІГНАРУЕМ (дублікаты, старыя папкі, сістэмныя)
IGNORE = {
    "ИП поль]ша/2022_20220803190826.pdf",
    "ИП поль]ша/2022_20220831170841.pdf",
    "ИП поль]ша/2022_20221003181020.pdf",
    "ИП поль]ша/invoice.12-2022.pdf",
    "ИП поль]ша/CEID.pdf",
    "ИП поль]ша/Report - Report.pdf",
    "ИП поль]ша/upl-1.pdf",
    "ИП поль]ша/zaświadczenie-2.pdf",
    "ИП поль]ша/zus.pdf",
    "ИП поль]ша/upc/Cennik uslug.pdf",
    "ИП поль]ша/upc/Formularz odstapienia od umowy.pdf",
    "ИП поль]ша/upc/Lista kanalow dla pakietow premium w aplikacji UPC TV Go.pdf",
    "ИП поль]ша/upc/Lista kanalow dla pakietu start.pdf",
    "ИП поль]ша/upc/Parametry techniczne uslug internetowych.pdf",
    "ИП поль]ша/upc/Polityka prywatnosci UPC.pdf",
    "ИП поль]ша/upc/Regulamin swiadczenia uslug przez UPC Polska.pdf",
    "ИП поль]ша/upc/Regulamin swiadczenia uslugi UPC TV Go.pdf",
    "ИП поль]ша/upc/Umowa o swiadczenie uslug - wzor.pdf",
    "ИП поль]ша/upc/upc_regulamin_promocji_internet_300_z_tv_start_z_bonusem_i_na_rok_2022-1_od20220825.pdf",
    "ИП поль]ша/payments/history_20230101_164329.pdf",
    "ИП поль]ша/payments/history_20230101_164920.pdf",
    "ИП поль]ша/payments/history_20230101_165003.pdf",
    "ИП поль]ша/payments/history_20230101_165257.pdf",
    "ИП поль]ша/pit/history_20230101_163927.pdf",
    "ИП поль]ша/pit/pko_trans_details_20230101_163510.pdf",
    "ИП поль]ша/pit/pko_trans_details_20230101_163546.pdf",
    "ИП поль]ша/pit/pko_trans_details_20230101_163557.pdf",
    "ИП поль]ша/pit/pko_trans_details_20230101_163605.pdf",
    "ИП поль]ша/zus/history_20230101_163852.pdf",
    "ИП поль]ша/zus/pko_trans_details_20230101_163237.pdf",
    "ИП поль]ша/zus/pko_trans_details_20230101_163258.pdf",
    "ИП поль]ша/zus/pko_trans_details_20230101_163309.pdf",
    "ИП поль]ша/zus/pko_trans_details_20230101_163320.pdf",
    "ИП поль]ша/zus/pko_trans_details_20230101_163331.pdf",
    "ИП поль]ша/invoices/2022_20220803190826.pdf",
    "ИП поль]ша/invoices/2022_20220831170841-1.pdf",
    "ИП поль]ша/invoices/2022_20221003181020-1.pdf",
    "ИП поль]ша/invoices/2022_20221230151226.pdf",
    "ИП поль]ша/invoices/document.pdf",
    "ИП поль]ша/invoices/document1.pdf",
    # дублікаты ў UPO_JPKV7M_Listopad_2022 2
    "внж_бухгалтер/UPO_JPKV7M_Listopad_2022 2/deklaracja_JPKV7M_Listopad_2022.xml",
    "внж_бухгалтер/UPO_JPKV7M_Listopad_2022 2/UPO_JPKV7M_Listopad_2022.xml",
    "внж_бухгалтер/UPO_JPKV7M_Listopad_2022 2/Wizualizacja_UPO_JPKV7M_Listopad_2022.pdf",
    "внж_бухгалтер/UPO_JPKV7M_Listopad_2022.zip",
    # дублікаты ў внж/выписки/invoices
    "внж/выписки/invoices/2022_20220803190826.pdf",
    "внж/выписки/invoices/2022_20220831170841-1.pdf",
    "внж/выписки/invoices/2022_20221003181020-1.pdf",
    "внж/выписки/invoices/document.pdf",
    "внж/выписки/invoices/document1.pdf",
    # дублікаты ў внж 2
    "внж 2/biznesplan/анкееееееа (2).doc",
    "внж 2/biznesplan/анкетаа (2).doc",
    "внж 2/biznesplan/анкееееееа.doc",
    "внж 2/biznesplan/анкетаа.doc",
    "внж 2/biznesplan/a5a98a186bbfabf6ffbf75f1c606bf53.docx",
    "внж 2/ноябрь/Podsumowanie ewidencji przychodow 2023.pdf",
    "внж 2/updates/Podsumowanie ewidencji przychodow 2024.pdf",
    "внж 2/updates/https_wfirma.pl_declaration_tax_view_46439801_print=1.pdf",
    "внж 2/updates/https_wfirma.pl_declaration_tax_view_47271863_print=1.pdf",
    # старая папка old_VNG (захоўваем толькі ўнікальнае)
    "old_VNG/dra 07.pdf",
    "old_VNG/dra 08.pdf",
    "old_VNG/dra 09.pdf",
    "old_VNG/dra 10.pdf",
    "old_VNG/dra 11.pdf",
    "old_VNG/Deklaracja JPKV7M 2022 11.pdf",
    "old_VNG/Ewidencja przychodow 2022 07.pdf",
    "old_VNG/Ewidencja przychodow 2022 08.pdf",
    "old_VNG/Ewidencja przychodow 2022 09.pdf",
    "old_VNG/Ewidencja przychodow 2022 10-2.pdf",
    "old_VNG/Ewidencja przychodow 2022 11-3.pdf",
    "old_VNG/zaliczka lipiec.pdf",
    "old_VNG/zaliczka sierpień.pdf",
    "old_VNG/zaliczka wrzesień.pdf",
    "old_VNG/zaliczka pażdziernik.pdf",
    "old_VNG/zaliczka listopad.pdf",
    "old_VNG/zcna .pdf",
    "old_VNG/zza.pdf",
    "old_VNG/upp_-499805054.pdf",
    "old_VNG/upp_-501061210.pdf",
    "old_VNG/upp_-502202457.pdf",
    "old_VNG/upp_-503318878.pdf",
    # ІП_Poland (стара папка — захавана ў новай структуры)
    "ИП_Poland/контракт_ч1.pdf",
    "ИП_Poland/контракт_ч2.pdf",
    "ИП_Poland/2022_20220803190826.pdf",
    "ИП_Poland/2022_20220831170841.pdf",
    "ИП_Poland/2022_20221003181020.pdf",
    "ИП_Poland/CEID.pdf",
    "ИП_Poland/invoice.12-2022.pdf",
    "ИП_Poland/Report - Report.pdf",
    "ИП_Poland/upl-1.pdf",
    "ИП_Poland/wniosek_VAT.pdf",
    "ИП_Poland/zaświadczenie-2.pdf",
    "ИП_Poland/zus.pdf",
    # Відэа
    "внж/IMG_5548.MOV",
    # Файлы з кропляным імем
    "Договд`_4(�`4`t`�`H__�K�__-1.pdf",
    "Договд`_4(�`4`t`�`H__�K�__.pdf",
    "Договд`_4(��X____;��_����K�__-1.pdf",
    # Зародак wydruki dup
    "внж 2/ноябрь/Podsumowanie ewidencji przychodow 2023.pdf",
}


def main():
    parser = argparse.ArgumentParser(description="Ідэнтыфікацыя і перайменаванне дакументаў")
    parser.add_argument("--identify", action="store_true", help="Вывесці спіс файлаў з апісаннямі")
    parser.add_argument("--dry-run", action="store_true", help="Паказаць дзеянні без выканання")
    parser.add_argument("--rename", action="store_true", help="Выканаць перайменаванне")
    parser.add_argument("--target", default="docs_renamed",
                        help="Мэтавая папка (па змаўчанні: docs_renamed)")
    args = parser.parse_args()

    if not any([args.identify, args.dry_run, args.rename]):
        args.identify = True

    target_root = ROOT / args.target

    if args.identify:
        print(f"\n{'='*70}")
        print("ПОЎНЫ СПІС ДАКУМЕНТАЎ ЗА ПЛАНАМ ПЕРАЙМЕНАВАННЯ")
        print(f"{'='*70}\n")
        current_section = ""
        for src_rel, dst_rel, desc in RENAME_MAP:
            section = dst_rel.split("/")[0]
            if section != current_section:
                current_section = section
                section_names = {
                    "00_meta": "⚙️  META / РОЗНАЕ",
                    "01_contract": "📄  КАНТРАКТЫ",
                    "02_registration": "🏢  РЭГІСТРАЦЫЯ ІП",
                    "03_invoices": "🧾  ФАКТУРЫ",
                    "04_reports": "📊  СПРАВАЗДАЧЫ",
                    "05_zus": "🏥  ZUS",
                    "06_tax": "💰  ПАДАТКІ (PIT/RYCZAŁT)",
                    "07_jpk-vat": "📋  JPK VAT",
                    "08_ewidencja": "📈  ЭВІДЭНЦЫЯ ПРЫБЫТКАЎ",
                    "09_bank": "🏦  БАНК",
                    "10_housing": "🏠  ЖЫЛЛЁ",
                    "11_vnzh": "🛂  ВНЖ (КАРТА ПОБЫТУ)",
                    "12_others": "🗂️  ІНШАЕ",
                }
                print(f"\n{section_names.get(section, section)}")
                print("-" * 60)
            src_path = ROOT / src_rel
            exists = "✅" if src_path.exists() else "❌"
            print(f"  {exists}  {src_rel}")
            print(f"      ➜  {dst_rel}")
            print(f"         {desc}")

    if args.dry_run or args.rename:
        print(f"\n{'='*70}")
        mode = "DRY RUN" if args.dry_run else "ВЫКАНАННЕ"
        print(f"{mode}: Перайменаванне ў {target_root}")
        print(f"{'='*70}\n")

        ok, skip, err = 0, 0, 0
        for src_rel, dst_rel, desc in RENAME_MAP:
            src = ROOT / src_rel
            dst = target_root / dst_rel
            if not src.exists():
                print(f"  ❌ НЕ ІСНУЕ: {src_rel}")
                err += 1
                continue
            print(f"  {'[DRY]' if args.dry_run else '[MV] '} {src_rel}")
            print(f"       → {dst_rel}")
            if args.rename:
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(str(src), str(dst))
            ok += 1

        print(f"\nВынік: {ok} файлаў, прапушчана: {skip}, памылак: {err}")
        if args.rename:
            print(f"\n✅ Файлы скапіраваны ў: {target_root}")
            print("   Зыходныя файлы НЕ выдалены. Пасля праверкі можна выдаліць.")


if __name__ == "__main__":
    main()
