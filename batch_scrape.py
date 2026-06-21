"""Batch scraper: scrape banyak URL dengan nomor urut otomatis.

Berguna untuk menghasilkan dataset final dengan kolom 'No' terisi.
"""
from scrape_youtube import scrape_one_video
import pandas as pd
import time


def batch_scrape(urls, output_excel=None, delay_sec=0.5):
    """
    Scrape daftar URL, kembalikan DataFrame dengan kolom sesuai
    Tabel 3.3 skripsi.

    Parameters
    ----------
    urls : list[str]
        Daftar URL YouTube.
    output_excel : str, optional
        Path file Excel untuk simpan hasil.
    delay_sec : float
        Jeda antar scrape (default 0.5s untuk sopan ke API YouTube).

    Returns
    -------
    pd.DataFrame
    """
    results = []
    total = len(urls)
    print(f"=== Batch scrape: {total} URL ===\n")

    for idx, url in enumerate(urls, start=1):
        t0 = time.time()
        row = scrape_one_video(url, row_no=idx)
        elapsed = time.time() - t0
        if row:
            results.append(row)
            print(f"[{idx:3d}/{total}] OK  - {elapsed:.2f}s - {row['Video Title'][:50]}")
        else:
            print(f"[{idx:3d}/{total}] FAIL - {elapsed:.2f}s - {url}")

        if delay_sec > 0 and idx < total:
            time.sleep(delay_sec)

    df = pd.DataFrame(results)
    print(f"\nBerhasil: {len(results)}/{total}")

    if output_excel:
        df.to_excel(output_excel, index=False)
        print(f"Disimpan: {output_excel}")

    return df


# Contoh pemakaian:
if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python batch_scrape.py <urls.txt> [output.xlsx]")
        print("  urls.txt = file berisi 1 URL per baris")
        sys.exit(1)

    urls_file = sys.argv[1]
    output = sys.argv[2] if len(sys.argv) > 2 else "dataset.xlsx"

    with open(urls_file, "r", encoding="utf-8") as f:
        urls = [line.strip() for line in f if line.strip()]

    batch_scrape(urls, output_excel=output)