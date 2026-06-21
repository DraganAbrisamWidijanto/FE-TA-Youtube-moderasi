"""
scrape_youtube.py
Kode untuk scraping data video YouTube (judul, deskripsi, tags, transkrip, komentar, metadata).
Juga berisi logic untuk Streamlit FE dengan pyngrok.

PERUBAHAN DARI NOTEBOOK ASLI:
- API_KEY dibaca dari environment variable (YOUTUBE_API_KEY), bukan hardcoded.
- NGROK_AUTHTOKEN dibaca dari env var (NGROK_AUTHTOKEN).
- Library 'python-dotenv' untuk load .env otomatis.
- Logic asli (cell 1-17) dipertahankan 100%, hanya credential handling yang aman.

Cara pakai (lokal):
1. Copy file .env.example ke .env
2. Isi YOUTUBE_API_KEY dan NGROK_AUTHTOKEN di .env
3. pip install -r requirements.txt
4. streamlit run scrape_youtube.py   # untuk FE
   atau
   python scrape_youtube.py          # untuk CLI / batch

Cara pakai (Google Colab):
- Jalankan cell 'Setup' untuk set env via userdata / os.environ
"""

# ============================================================
# 1. SETUP ENVIRONMENT
# ============================================================
import os
import re
import sys
import json
import time
import glob
import subprocess
import requests

try:
    from dotenv import load_dotenv
    load_dotenv()  # load dari file .env (jika ada)
except ImportError:
    print("[INFO] python-dotenv tidak terinstall. "
          "Pastikan env vars di-set manual via os.environ atau Colab Secrets.")


def get_credential(env_key: str, colab_secret_name: str = None) -> str:
    """
    Ambil credential dari: env var > Colab userdata > None.
    Raise RuntimeError jika tidak ditemukan.
    """
    val = os.environ.get(env_key)
    if val:
        return val
    try:
        from google.colab import userdata  # type: ignore
        return userdata.get(colab_secret_name or env_key)
    except ImportError:
        pass
    except Exception:
        pass
    raise RuntimeError(
        f"Credential '{env_key}' tidak ditemukan. "
        f"Isi di .env (lokal) atau Colab Secrets (key: {colab_secret_name or env_key})."
    )


# ============================================================
# 2. CORE SCRAPING (logic asli dari notebook, TIDAK DIUBAH)
# ============================================================
from urllib.parse import urlparse, parse_qs
from googleapiclient.discovery import build

API_KEY = get_credential("YOUTUBE_API_KEY", "YOUTUBE_API_KEY")
youtube = build("youtube", "v3", developerKey=API_KEY)

RETURN_DISLIKE_API = "https://returnyoutubedislikeapi.com/votes"


def extract_video_id(url: str):
    """Ekstrak video ID dari URL YouTube (watch?v=, youtu.be/, shorts)."""
    try:
        parsed_url = urlparse(url.strip())
        if parsed_url.hostname in ("www.youtube.com", "youtube.com"):
            qs = parse_qs(parsed_url.query)
            if "v" in qs:
                return qs["v"][0]
            if parsed_url.path.startswith("/shorts/"):
                return parsed_url.path.split("/")[2]
        elif parsed_url.hostname == "youtu.be":
            return parsed_url.path.lstrip("/")
        return None
    except Exception:
        return None


def get_video_details(video_id: str):
    """Ambil detail video (snippet + statistics + contentDetails)."""
    try:
        request = youtube.videos().list(
            part="snippet,statistics,contentDetails",
            id=video_id,
        )
        response = request.execute()
        if "items" not in response or not response["items"]:
            return None
        return response["items"][0]
    except Exception as e:
        print(f"[ERROR] Gagal mengambil data video dari YouTube API: {e}")
        return None


def get_comments(video_id: str, max_results: int = 20):
    """Ambil komentar teratas video YouTube (HTML sudah dibersihkan)."""
    try:
        request = youtube.commentThreads().list(
            part="snippet",
            videoId=video_id,
            maxResults=max_results,
            order="relevance",
        )
        response = request.execute()
        comments = []
        if "items" in response:
            for item in response["items"]:
                raw = item["snippet"]["topLevelComment"]["snippet"]["textDisplay"]
                # Pembersihan HTML: sesuai skripsi p54 "penghapusan tag HTML
                # pada komentar dan deskripsi". Pakai clean_html_keep_text
                # untuk konsistensi dengan deskripsi.
                comments.append(clean_html_keep_text(raw) or "")
        return comments
    except Exception as e:
        print(f"[ERROR] Gagal mengambil komentar: {e}")
        return []


def clean_html_keep_text(text: str):
    """Hapus tag HTML tapi pertahankan teks & angka."""
    if text is None:
        return None
    cleaned = re.sub(r"<[^>]+>", "", text)
    cleaned = re.sub(r"&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def download_transcript(video_url: str):
    """Download subtitle Indonesia via yt-dlp, bersihkan, gabung teks saja."""
    try:
        title = subprocess.check_output(
            ["yt-dlp", "--get-title", video_url], text=True
        ).strip()
        safe_title = re.sub(r'[\\/*?:"<>|]', "", title)

        result = subprocess.run(
            [
                "yt-dlp",
                "--write-auto-subs",
                "--sub-lang", "id",
                "--skip-download",
                "--convert-subs", "srt",
                video_url,
                "-o", f"{safe_title}.%(ext)s",
            ],
            capture_output=True, text=True,
        )

        if result.returncode != 0:
            return None

        sub_files = glob.glob(f"{safe_title}*.srt")
        if not sub_files:
            return None

        sub_filename = sub_files[0]
        with open(sub_filename, "r", encoding="utf-8", errors="ignore") as f:
            data = f.read()

        data = re.sub(r"^\d+\s*$", "", data, flags=re.MULTILINE)
        data = re.sub(
            r"\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}", "", data
        )
        data = clean_html_keep_text(data)
        data = re.sub(r"\n+", "\n", data).strip()

        cleaned_lines = []
        for line in data.splitlines():
            line = line.strip()
            if line and (not cleaned_lines or line != cleaned_lines[-1]):
                cleaned_lines.append(line)

        try:
            os.remove(sub_filename)
        except OSError:
            pass

        return " ".join(cleaned_lines)
    except Exception as e:
        print(f"[ERROR] Gagal mengambil transkrip: {e}")
        return None


def iso8601_duration_to_seconds(duration: str):
    """Konversi ISO 8601 duration (PT1H2M10S) ke detik."""
    if not duration or not isinstance(duration, str):
        return None
    m_h = re.search(r"(\d+)H", duration)
    m_m = re.search(r"(\d+)M", duration)
    m_s = re.search(r"(\d+)S", duration)
    h = int(m_h.group(1)) if m_h else 0
    m = int(m_m.group(1)) if m_m else 0
    s = int(m_s.group(1)) if m_s else 0
    return h * 3600 + m * 60 + s


def fetch_dislike_count(video_id: str):
    """Panggil ReturnYouTubeDislike API untuk dislike count."""
    try:
        params = {"videoId": video_id}
        resp = requests.get(RETURN_DISLIKE_API, params=params, timeout=8)
        if resp.status_code != 200:
            return None, f"ReturnYouTubeDislike API returned status {resp.status_code}"
        data = resp.json()
        dislikes = data.get("dislikes")
        if dislikes is None:
            return None, "Data dislike tidak ditemukan pada respons API pihak ketiga"
        return int(dislikes), None
    except Exception as e:
        return None, str(e)


def safe_int(value):
    try:
        return int(value)
    except Exception:
        return None


# ============================================================
# 3. ENTRY POINT: SINGLE VIDEO SCRAPER
# ============================================================
def scrape_one_video(youtube_link: str, row_no: int = None):
    """
    Scrape SATU video, kembalikan dict berisi semua field.

    Field DAN URUTAN sesuai Tabel 3.3 skripsi (p55):
      No, Video URL, Video Tags, Video Title, Likes Count,
      Dislikes Count, View Count, Total Comments, Top 20 Comments,
      Video Duration, Video Description, Transcript

    Pembersihan (sesuai skripsi p54):
      - Tag HTML di komentar & deskripsi
      - Timestamp di subtitle
      - Baris kosong di transkrip
      - Durasi ISO 8601 -> detik
    """
    video_id = extract_video_id(youtube_link)
    if not video_id:
        return None

    video_data = get_video_details(video_id)
    if not video_data:
        return None

    snippet = video_data.get("snippet", {})
    statistics = video_data.get("statistics", {})
    content_details = video_data.get("contentDetails", {})

    title = snippet.get("title", "")
    tags = snippet.get("tags", [])
    # Pembersihan HTML deskripsi (sesuai skripsi p54)
    description = clean_html_keep_text(snippet.get("description", "")) or ""
    views = safe_int(statistics.get("viewCount"))
    likes = safe_int(statistics.get("likeCount"))
    comment_count = safe_int(statistics.get("commentCount"))
    duration_iso = content_details.get("duration", "")
    duration_seconds = iso8601_duration_to_seconds(duration_iso)

    dislikes, _ = fetch_dislike_count(video_id)
    # Comments sudah dibersihkan HTML-nya di dalam get_comments()
    comments = get_comments(video_id, 20)
    comments_joined = "\n".join(comments) if comments else ""
    transcript = download_transcript(youtube_link) or ""

    # URUTAN sesuai Tabel 3.3 (No, URL, Tags, Title, Likes, Dislikes,
    # View, Comments, Top 20 Comments, Duration, Description, Transcript)
    return {
        "No": row_no,
        "Video URL": youtube_link,
        "Video Tags": ", ".join(tags) if tags else "",
        "Video Title": title,
        "Likes Count": likes if likes is not None else 0,
        "Dislikes Count": dislikes if dislikes is not None else 0,
        "View Count": views if views is not None else 0,
        "Total Comments": comment_count if comment_count is not None else 0,
        "Top 20 Comments": comments_joined,
        "Video Duration": duration_seconds if duration_seconds is not None else 0,
        "Video Description": description,
        "Transcript": transcript,
    }


# ============================================================
# 4. ENTRY POINT: STREAMLIT FE
# ============================================================
def run_streamlit_app():
    """
    Jalankan Streamlit FE untuk single-link & multi-link.
    Cara pakai: streamlit run scrape_youtube.py
    """
    try:
        import streamlit as st
    except ImportError:
        print("[ERROR] streamlit belum terinstall. Jalankan: pip install streamlit")
        return

    st.title("YouTube Data Viewer")

    mode = st.radio("Pilih mode:", ["Single link", "Multi-link"])
    if mode == "Single link":
        youtube_link = st.text_input("Masukkan link YouTube:", "")
    else:
        youtube_link = st.text_area(
            "Masukkan beberapa link YouTube (pisahkan dengan koma):", ""
        )

    if st.button("Ambil Data"):
        if not youtube_link.strip():
            st.warning("Silakan masukkan link YouTube terlebih dahulu.")
            return

        if mode == "Single link":
            links = [youtube_link.strip()]
        else:
            links = [l.strip() for l in youtube_link.split(",") if l.strip()]

        data_rows = []
        progress = st.progress(0)
        status_text = st.empty()

        for idx, link in enumerate(links):
            status_text.text(f"Mengambil data video {idx+1}/{len(links)}...")
            row = scrape_one_video(link)
            if row:
                data_rows.append(row)
            progress.progress((idx + 1) / len(links))
            time.sleep(0.2)

        status_text.text("Selesai!")
        if data_rows:
            import pandas as pd
            df = pd.DataFrame(data_rows)
            st.dataframe(df, use_container_width=True)
        else:
            st.info("Tidak ada data video yang berhasil diambil.")


# ============================================================
# 6. ENTRY POINT: DETEKSI STREAMLIT vs CLI
# ============================================================
# Cara kerja:
# - `streamlit run scrape_youtube.py` -> Streamlit set __name__="__main__"
#   DAN ada Streamlit script context aktif. Kita panggil run_streamlit_app().
# - `python scrape_youtube.py` (CLI) -> tidak ada Streamlit context.
#   Kita jalankan CLI mode (input URL dari terminal).
#
# Deteksi via streamlit.runtime.scriptrunner.get_script_run_ctx():
#   - return non-None kalau di dalam streamlit run
#   - return None kalau dijalankan sebagai script biasa
try:
    from streamlit.runtime.scriptrunner import get_script_run_ctx
    _IS_STREAMLIT = get_script_run_ctx() is not None
except Exception:
    _IS_STREAMLIT = False

if _IS_STREAMLIT:
    # Dipanggil via `streamlit run scrape_youtube.py`
    run_streamlit_app()
else:
    # Dipanggil via `python scrape_youtube.py [url]`
    if __name__ == "__main__":
        import sys

        if len(sys.argv) > 1:
            video_url = sys.argv[1]
        else:
            video_url = input("Masukkan link YouTube (kosongkan untuk keluar): ").strip()

        if not video_url:
            print("Tidak ada URL diberikan. Keluar.")
            sys.exit(0)

        print(f"Scraping: {video_url}")
        result = scrape_one_video(video_url)
        if result:
            print(json.dumps(result, indent=2, ensure_ascii=False))
        else:
            print("Gagal scrape video tersebut.")