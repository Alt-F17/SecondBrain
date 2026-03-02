#!/usr/bin/env python3
"""
media_ingest.py — Phase 6 media ingestion
Watches ~/lifedb/ for images, audio, video
Describes with Vision API / Whisper, embeds, stores in ChromaDB 'media' collection
"""

from dotenv import load_dotenv
load_dotenv()
import os
import sys
import time
import json
import hashlib
import base64
import subprocess
import tempfile
from pathlib import Path
from datetime import datetime

import chromadb
from openai import OpenAI
from PIL import Image
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# ── Config ────────────────────────────────────────────────────────────────────
LIFEDB_PATH  = Path.home() / 'lifedb'
CHROMA_HOST  = 'localhost'
CHROMA_PORT  = 8000
COLLECTION   = 'media'
STATE_FILE   = Path.home() / 'SecondBrain' / 'media_state.json'
THUMB_DIR    = Path.home() / 'SecondBrain' / 'thumbnails'
MAX_IMG_PX   = 1024    # resize images larger than this before sending to Vision
VIDEO_INTERVAL = 30    # extract 1 frame per N seconds of video

IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp', '.tiff', '.tif'}
AUDIO_EXTS = {'.mp3', '.m4a', '.wav', '.ogg', '.flac', '.aac', '.opus', '.wma'}
VIDEO_EXTS = {'.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.flv', '.wmv'}

client   = OpenAI(api_key=os.environ.get('OPENAI_API_KEY'))
chroma   = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
THUMB_DIR.mkdir(parents=True, exist_ok=True)

# Get or create media collection
try:
    col = chroma.get_collection(COLLECTION)
    print(f'✅ media collection: {col.count()} vectors')
except Exception:
    col = chroma.create_collection(COLLECTION, metadata={'hnsw:space': 'ip'})
    print(f'✅ Created media collection')

# ── State tracking (skip already-processed files) ────────────────────────────
def load_state():
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {}

def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2))

def file_hash(path: Path) -> str:
    # Bug #13 fix: hash the actual file content so restored/replaced files
    # with the same mtime are correctly detected as changed
    h = hashlib.md5()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            h.update(chunk)
    return h.hexdigest()

# ── Thumbnail generation ──────────────────────────────────────────────────────
def make_thumbnail(src: Path, dest: Path, size=(320, 320)):
    try:
        img = Image.open(src)
        img.thumbnail(size, Image.LANCZOS)
        if img.mode in ('RGBA', 'P'):
            img = img.convert('RGB')
        img.save(dest, 'JPEG', quality=75)
        return True
    except Exception as e:
        print(f'  ⚠ Thumbnail failed: {e}')
        return False

def thumb_path(file_path: Path) -> Path:
    safe = hashlib.md5(str(file_path).encode()).hexdigest()
    return THUMB_DIR / f'{safe}.jpg'

# ── Image processing ──────────────────────────────────────────────────────────
def process_image(path: Path) -> dict | None:
    try:
        print(f'  📸 Describing image: {path.name}')

        # Resize if needed
        img = Image.open(path)
        if max(img.size) > MAX_IMG_PX:
            img.thumbnail((MAX_IMG_PX, MAX_IMG_PX), Image.LANCZOS)

        # Convert to JPEG bytes
        with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp:
            if img.mode in ('RGBA', 'P'):
                img = img.convert('RGB')
            img.save(tmp.name, 'JPEG', quality=85)
            with open(tmp.name, 'rb') as f:
                img_b64 = base64.b64encode(f.read()).decode()
        os.unlink(tmp.name)

        # Vision API description
        response = client.chat.completions.create(
            model='gpt-4o-mini',
            max_tokens=400,
            messages=[{
                'role': 'user',
                'content': [
                    {
                        'type': 'image_url',
                        'image_url': {'url': f'data:image/jpeg;base64,{img_b64}', 'detail': 'low'}
                    },
                    {
                        'type': 'text',
                        'text': 'Describe this image in detail for search indexing. Include: what is shown, any text visible, colors, objects, people, setting, mood. Be specific and thorough. Start directly with the description, no preamble.'
                    }
                ]
            }]
        )
        description = response.choices[0].message.content.strip()

        # Make thumbnail
        thumb = thumb_path(path)
        make_thumbnail(path, thumb)

        return {
            'type': 'image',
            'description': description,
            'thumb': str(thumb) if thumb.exists() else None
        }
    except Exception as e:
        print(f'  ✗ Image failed: {e}')
        return None

# ── Audio processing ──────────────────────────────────────────────────────────
def process_audio(path: Path) -> dict | None:
    try:
        print(f'  🎵 Transcribing audio: {path.name}')
        with open(path, 'rb') as f:
            response = client.audio.transcriptions.create(
                model='gpt-4o-mini-transcribe',
                file=f,
                response_format='text'
            )
        transcript = response.strip() if isinstance(response, str) else response
        if not transcript:
            return None
        return {
            'type': 'audio',
            'description': f'[Audio transcript] {transcript}'
        }
    except Exception as e:
        print(f'  ✗ Audio failed: {e}')
        return None

# ── Video processing ──────────────────────────────────────────────────────────
def process_video(path: Path) -> dict | None:
    try:
        print(f'  🎬 Processing video: {path.name}')

        # Get video duration
        result = subprocess.run([
            'ffprobe', '-v', 'quiet', '-print_format', 'json',
            '-show_streams', str(path)
        ], capture_output=True, text=True)
        info = json.loads(result.stdout)
        duration = 0
        for stream in info.get('streams', []):
            if stream.get('codec_type') == 'video':
                duration = float(stream.get('duration', 0))
                break

        if duration == 0:
            duration = 60  # fallback

        # Extract frames every VIDEO_INTERVAL seconds
        with tempfile.TemporaryDirectory() as tmpdir:
            subprocess.run([
                'ffmpeg', '-i', str(path),
                '-vf', f'fps=1/{VIDEO_INTERVAL}',
                '-q:v', '3',
                f'{tmpdir}/frame_%04d.jpg'
            ], capture_output=True)

            frames = sorted(Path(tmpdir).glob('frame_*.jpg'))
            if not frames:
                return None

            # Cap at 10 frames to control cost
            frames = frames[:10]
            descriptions = []

            for i, frame in enumerate(frames):
                timestamp = i * VIDEO_INTERVAL
                with open(frame, 'rb') as f:
                    img_b64 = base64.b64encode(f.read()).decode()
                response = client.chat.completions.create(
                    model='gpt-4o-mini',
                    max_tokens=150,
                    messages=[{
                        'role': 'user',
                        'content': [
                            {'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{img_b64}', 'detail': 'low'}},
                            {'type': 'text', 'text': f'Frame at {timestamp}s. Describe briefly what is shown.'}
                        ]
                    }]
                )
                desc = response.choices[0].message.content.strip()
                descriptions.append(f'[{timestamp}s] {desc}')

            # Make thumbnail from first frame
            thumb = thumb_path(path)
            make_thumbnail(frames[0], thumb)

            full_description = f'[Video: {path.name}, {int(duration)}s]\n' + '\n'.join(descriptions)
            return {
                'type': 'video',
                'description': full_description,
                'thumb': str(thumb) if thumb.exists() else None
            }

    except Exception as e:
        print(f'  ✗ Video failed: {e}')
        return None

# ── Embed and store ───────────────────────────────────────────────────────────
def embed_and_store(path: Path, result: dict):
    try:
        text = result['description']
        embedding_response = client.embeddings.create(
            model='text-embedding-3-small',
            input=text
        )
        embedding = embedding_response.data[0].embedding

        chunk_id = f'media_{hashlib.md5(str(path).encode()).hexdigest()}'

        col.upsert(
            ids=[chunk_id],
            embeddings=[embedding],
            documents=[text],
            metadatas=[{
                'source_path': str(path),
                'file_name': path.name,
                'file_type': result['type'],
                'modified': datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
                'thumb_path': result.get('thumb') or '',
                'collection': 'media'
            }]
        )
        print(f'  ✅ Stored in ChromaDB: {path.name}')
        return True
    except Exception as e:
        print(f'  ✗ Store failed: {e}')
        return False

# ── Process a single file ─────────────────────────────────────────────────────
def process_file(path: Path, state: dict) -> bool:
    ext = path.suffix.lower()
    fhash = file_hash(path)

    if state.get(str(path)) == fhash:
        return False  # already processed, unchanged

    result = None
    if ext in IMAGE_EXTS:
        result = process_image(path)
    elif ext in AUDIO_EXTS:
        result = process_audio(path)
    elif ext in VIDEO_EXTS:
        result = process_video(path)

    if result:
        if embed_and_store(path, result):
            state[str(path)] = fhash
            return True
    return False

# ── Full scan ─────────────────────────────────────────────────────────────────
def full_scan():
    state = load_state()
    media_files = [
        p for p in LIFEDB_PATH.rglob('*')
        if p.is_file() and p.suffix.lower() in (IMAGE_EXTS | AUDIO_EXTS | VIDEO_EXTS)
    ]
    print(f'🔍 Found {len(media_files)} media files in {LIFEDB_PATH}')
    processed = 0
    for path in media_files:
        print(f'Processing: {path.relative_to(LIFEDB_PATH)}')
        if process_file(path, state):
            processed += 1
            save_state(state)
    print(f'✅ Scan complete: {processed} new/updated files processed')

# ── Watchdog handler ──────────────────────────────────────────────────────────
class MediaHandler(FileSystemEventHandler):
    def __init__(self):
        self.state = load_state()

    def on_created(self, event):
        if event.is_directory:
            return
        path = Path(event.src_path)
        if path.suffix.lower() in (IMAGE_EXTS | AUDIO_EXTS | VIDEO_EXTS):
            time.sleep(1)  # wait for file to finish writing
            print(f'📥 New media: {path.name}')
            if process_file(path, self.state):
                save_state(self.state)

    def on_modified(self, event):
        self.on_created(event)

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'watch'

    if mode == 'scan':
        full_scan()
    else:
        print(f'🚀 media_ingest watching {LIFEDB_PATH}')
        full_scan()  # process existing files first
        handler  = MediaHandler()
        observer = Observer()
        observer.schedule(handler, str(LIFEDB_PATH), recursive=True)
        observer.start()
        try:
            while True:
                time.sleep(10)
        except KeyboardInterrupt:
            observer.stop()
        observer.join()
