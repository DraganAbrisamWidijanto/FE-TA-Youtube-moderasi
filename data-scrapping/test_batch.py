"""Quick batch test: loop same URL 10 kali untuk validasi batch logic."""
import pandas as pd
import time
from batch_scrape import batch_scrape

URL = "https://www.youtube.com/watch?v=XaXXBFwgDJU"
N = 10

print(f"=== Batch scrape: {N}x URL yang sama ===\n")
t0 = time.time()
urls = [URL] * N
df = batch_scrape(urls, output_excel="batch_test_output.xlsx", delay_sec=0)
elapsed = time.time() - t0

print(f"\n=== RINGKASAN ===")
print(f"Total URL discrape: {N}")
print(f"Berhasil:           {len(df)}")
print(f"Total waktu:        {elapsed:.2f}s")
print(f"Rata-rata:          {elapsed/N:.2f}s/video")
print(f"Kolom output:       {list(df.columns)}")

# Verifikasi konsistensi antar scrape
if len(df) > 1:
    n_unique = df.drop(columns=["No"]).drop_duplicates().shape[0]
    print(f"\nRow unik (tanpa No): {n_unique} (kalau 1 = konsisten)")

# Sample row
print(f"\n=== Sample row pertama ===")
print(f"No: {df.iloc[0]['No']}")
print(f"Video URL: {df.iloc[0]['Video URL'][:50]}...")
print(f"Title: {df.iloc[0]['Video Title']}")
print(f"Top 20 Comments (50 char pertama):")
print(f"  {df.iloc[0]['Top 20 Comments'][:100]}")