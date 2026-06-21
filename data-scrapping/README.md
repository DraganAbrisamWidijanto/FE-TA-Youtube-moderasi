# YouTube Scraping — Kode Pengumpulan Dataset Skripsi

Kode ini digunakan untuk mengumpulkan data video YouTube berbahasa Indonesia yang menjadi dataset pada skripsi **"Klasifikasi Kelayakan Konten Video YouTube Berbahasa Indonesia Menggunakan IndoBERT dengan Informasi Tekstual dan Metadata"**.

## Apa yang Di-scrape?

Untuk setiap video, kode ini mengambil:
- **Informasi Tekstual**: Judul, Deskripsi, Tags
- **Metadata**: Likes, Dislikes, Views, Comments count, Durasi
- **Top 20 Komentar** (via YouTube Data API v3)
- **Transkrip** (via `yt-dlp` untuk auto-generated subtitle bahasa Indonesia)

Output per video: 1 baris dengan 11 kolom (lihat struktur di bawah).

## Struktur File

```
github_version/
├── scrape_youtube.py     # Kode utama (semua logic scraping + Streamlit FE)
├── .env                  # (PRIVAT) Credential asli - JANGAN di-push
├── .env.example          # Template credential untuk setup
├── .gitignore            # File/folder yang di-exclude dari Git
├── requirements.txt      # Daftar dependencies Python
└── README.md             # File ini
```

## Setup Lokal (di PC / server)

1. **Clone repo ini:**
   ```bash
   git clone <URL_REPO>
   cd <nama-folder>
   ```

2. **Buat virtual environment (opsional tapi disarankan):**
   ```bash
   python -m venv venv
   source venv/bin/activate        # Linux/Mac
   venv\Scripts\activate           # Windows
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Setup credential:**
   - Copy `.env.example` jadi `.env`:
     ```bash
     cp .env.example .env
     ```
   - Isi `.env` dengan credential asli Anda:
     ```
     YOUTUBE_API_KEY=AIzaSy...dari_Google_Cloud_Console
     NGROK_AUTHTOKEN=...dari_ngrok_dashboard
     ```
   - Dapatkan `YOUTUBE_API_KEY` di: https://console.cloud.google.com/apis/credentials
   - Dapatkan `NGROK_AUTHTOKEN` di: https://dashboard.ngrok.com/get-started/your-authtoken

5. **Test apakah setup berhasil:**
   ```bash
   python scrape_youtube.py
   ```
   Akan scrape 1 video sample (`https://www.youtube.com/watch?v=zddr8H9tsfI`) dan print hasilnya.

## Setup di Google Colab

1. **Simpan credential di Colab Secrets:**
   - Buka ikon 🔑 di sidebar kiri Colab
   - Tambahkan 2 secret:
     - `YOUTUBE_API_KEY` = `<nilai>`
     - `NGROK_AUTHTOKEN` = `<nilai>`
   - Toggle "Notebook access" ON

2. **Tambah cell setup di awal notebook:**
   ```python
   !pip install -r requirements.txt
   from google.colab import userdata
   import os
   os.environ['YOUTUBE_API_KEY'] = userdata.get('YOUTUBE_API_KEY')
   os.environ['NGROK_AUTHTOKEN'] = userdata.get('NGROK_AUTHTOKEN')
   ```

3. **Run `scrape_youtube.py`** (upload file via panel Files di Colab, atau copy-paste ke cell).

## Cara Pakai

### Mode 1: CLI / batch (untuk scraping dataset besar)

Edit `scrape_youtube.py` bagian `if __name__ == "__main__":` lalu loop:

```python
import pandas as pd

video_urls = [
    "https://www.youtube.com/watch?v=VIDEO_ID_1",
    "https://www.youtube.com/watch?v=VIDEO_ID_2",
    # dst...
]

results = []
for url in video_urls:
    row = scrape_one_video(url)
    if row:
        results.append(row)

df = pd.DataFrame(results)
df.to_excel("dataset_scraped.xlsx", index=False)
```

### Mode 2: Streamlit FE (untuk demo / testing per video)

```bash
streamlit run scrape_youtube.py
```

Akan membuka UI di browser dengan 2 mode:
- **Single link**: input 1 link, langsung scrape + tampilkan
- **Multi-link**: input beberapa link (pisahkan koma), batch scrape dengan progress bar

### Mode 3: Colab + pyngrok (untuk demo tanpa setup lokal)

```python
# Setelah setup credential
!ngrok authtoken $NGROK_AUTHTOKEN
from pyngrok import ngrok
!streamlit run scrape_youtube.py &>/dev/null &
public_url = ngrok.connect(8501)
print("Akses aplikasi di:", public_url)
```

## Struktur Output (per video)

| Kolom | Tipe | Keterangan |
|---|---|---|
| Video URL | str | URL asli |
| Video Title | str | Judul video |
| Video Description | str | Deskripsi (HTML dibersihkan) |
| Video Tags | str | Tags dipisah koma |
| Likes Count | int | Jumlah like |
| Dislikes Count | int | Jumlah dislike (dari ReturnYouTubeDislike API) |
| View Count | int | Jumlah view |
| Total Comments | int | Total komentar (statistik YouTube) |
| Video Duration | int | Durasi dalam detik (ISO 8601 dikonversi) |
| Top 20 Comments | str | 20 komentar teratas dipisah newline |
| Transcript | str | Transkrip dari auto-generated subtitle ID |

## Keamanan

- ✅ API key dan ngrok token disimpan di `.env` (tidak di-hardcode)
- ✅ `.env` masuk `.gitignore` (tidak akan ter-commit ke GitHub)
- ✅ `.env.example` jadi template (aman di-push ke public)
- ⚠️ **JANGAN PERNAH** share file `.env` Anda. Jika tidak sengaja ter-push, segera **revoke** API key dan ngrok token, lalu generate yang baru.

## Credits

- Google YouTube Data API v3
- `yt-dlp` untuk auto-generated subtitle Indonesia
- `pyngrok` untuk expose Streamlit dari Colab
- `ReturnYouTubeDislike API` untuk dislike count

---

**Lisensi:** MIT (atau sesuai kebijakan skripsi Anda)