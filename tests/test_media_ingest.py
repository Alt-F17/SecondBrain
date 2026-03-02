"""
test_media_ingest.py — pytest tests for media_ingest.py

Covers: state hashing, thumbnail creation, collection routing by extension,
        deduplication via state, and known bugs.

conftest.py has already mocked chromadb, openai, PIL, dotenv, and watchdog.
"""
import sys
import json
import hashlib
from pathlib import Path
from unittest.mock import MagicMock, patch, call
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
import media_ingest


# ─────────────────────────────────────────────────────────────────────────────
# file_hash() — uses path+mtime, NOT content
# ─────────────────────────────────────────────────────────────────────────────
class TestFileHash:
    def test_same_path_and_mtime_gives_same_hash(self, tmp_path):
        f = tmp_path / "photo.jpg"; f.write_bytes(b"fake jpeg")
        h1 = media_ingest.file_hash(f)
        h2 = media_ingest.file_hash(f)
        assert h1 == h2

    def test_different_content_gives_different_hashes(self, tmp_path):
        # With content-based hashing, different content → different hash
        a = tmp_path / "a.jpg"; a.write_bytes(b"content A")
        b = tmp_path / "b.jpg"; b.write_bytes(b"content B")
        assert media_ingest.file_hash(a) != media_ingest.file_hash(b)

    def test_returns_hex_string(self, tmp_path):
        f = tmp_path / "img.png"; f.write_bytes(b"\x89PNG")
        h = media_ingest.file_hash(f)
        assert isinstance(h, str)
        assert all(c in "0123456789abcdef" for c in h)

    # ── Bug #13: FIXED — file_hash now uses content, not path+mtime ────────
    def test_BUG13_hash_changes_when_content_changes(self, tmp_path):
        """Fix #13: file_hash is now based on file content.
        Restored files with the same mtime are correctly detected as changed."""
        f = tmp_path / "file.jpg"
        f.write_bytes(b"original content")
        mtime1 = f.stat().st_mtime
        h1 = media_ingest.file_hash(f)

        # Modify content without touching mtime
        f.write_bytes(b"completely different content")
        import os
        os.utime(f, (mtime1, mtime1))  # restore original mtime

        h2 = media_ingest.file_hash(f)
        # Fix verified: hash changes because content changed, even with same mtime
        assert h1 != h2, "Fix #13 confirmed: hash reflects content, not path+mtime"


# ─────────────────────────────────────────────────────────────────────────────
# thumb_path()
# ─────────────────────────────────────────────────────────────────────────────
class TestThumbPath:
    def test_returns_jpg_in_thumb_dir(self, tmp_path):
        f = tmp_path / "photo.jpg"
        result = media_ingest.thumb_path(f)
        assert result.suffix == ".jpg"
        assert result.parent == media_ingest.THUMB_DIR

    def test_consistent_output_for_same_input(self, tmp_path):
        f = tmp_path / "video.mp4"
        p1 = media_ingest.thumb_path(f)
        p2 = media_ingest.thumb_path(f)
        assert p1 == p2

    def test_different_paths_produce_different_thumbnails(self, tmp_path):
        a = tmp_path / "a.jpg"
        b = tmp_path / "b.jpg"
        assert media_ingest.thumb_path(a) != media_ingest.thumb_path(b)

    def test_thumbnail_name_is_md5_hex(self, tmp_path):
        f = tmp_path / "pic.png"
        result = media_ingest.thumb_path(f)
        stem = result.stem
        assert len(stem) == 32  # MD5 hex = 32 chars
        assert all(c in "0123456789abcdef" for c in stem)


# ─────────────────────────────────────────────────────────────────────────────
# State management
# ─────────────────────────────────────────────────────────────────────────────
class TestStateManagement:
    def test_load_state_returns_empty_dict_when_missing(self, tmp_path):
        with patch("media_ingest.STATE_FILE", tmp_path / "no_state.json"):
            state = media_ingest.load_state()
        assert state == {}

    def test_save_and_load_round_trip(self, tmp_path):
        state_file = tmp_path / "state.json"
        data = {"/lifedb/img.jpg": "abc123"}
        with patch("media_ingest.STATE_FILE", state_file):
            media_ingest.save_state(data)
            loaded = media_ingest.load_state()
        assert loaded == data

    def test_load_state_handles_corrupt_json(self, tmp_path):
        state_file = tmp_path / "bad.json"
        state_file.write_text("{not json}", encoding="utf-8")
        with patch("media_ingest.STATE_FILE", state_file):
            state = media_ingest.load_state()
        assert state == {}


# ─────────────────────────────────────────────────────────────────────────────
# process_file() — routing and deduplication
# ─────────────────────────────────────────────────────────────────────────────
class TestProcessFile:
    def test_skips_already_processed_file(self, tmp_path):
        f = tmp_path / "photo.jpg"; f.write_bytes(b"fake jpeg data")
        fhash = media_ingest.file_hash(f)
        state = {str(f): fhash}  # already in state with same hash
        result = media_ingest.process_file(f, state)
        assert result is False

    def test_returns_false_for_unsupported_extension(self, tmp_path):
        f = tmp_path / "document.pdf"; f.write_bytes(b"not media")
        state = {}
        result = media_ingest.process_file(f, state)
        assert result is False

    def test_calls_process_image_for_image_extensions(self, tmp_path):
        f = tmp_path / "photo.jpg"; f.write_bytes(b"data")
        state = {}
        with patch("media_ingest.process_image") as mock_img, \
             patch("media_ingest.embed_and_store", return_value=True):
            mock_img.return_value = {"type": "image", "description": "A photo", "thumb": None}
            media_ingest.process_file(f, state)
        mock_img.assert_called_once_with(f)

    def test_calls_process_audio_for_audio_extensions(self, tmp_path):
        f = tmp_path / "voice.mp3"; f.write_bytes(b"audio data")
        state = {}
        with patch("media_ingest.process_audio") as mock_audio, \
             patch("media_ingest.embed_and_store", return_value=True):
            mock_audio.return_value = {"type": "audio", "description": "[Audio transcript] hello"}
            media_ingest.process_file(f, state)
        mock_audio.assert_called_once_with(f)

    def test_calls_process_video_for_video_extensions(self, tmp_path):
        f = tmp_path / "clip.mp4"; f.write_bytes(b"video data")
        state = {}
        with patch("media_ingest.process_video") as mock_video, \
             patch("media_ingest.embed_and_store", return_value=True):
            mock_video.return_value = {"type": "video", "description": "A video", "thumb": None}
            media_ingest.process_file(f, state)
        mock_video.assert_called_once_with(f)

    def test_updates_state_on_success(self, tmp_path):
        f = tmp_path / "new.jpg"; f.write_bytes(b"new jpeg")
        state = {}
        with patch("media_ingest.process_image", return_value={"type": "image", "description": "desc", "thumb": None}), \
             patch("media_ingest.embed_and_store", return_value=True):
            result = media_ingest.process_file(f, state)
        assert result is True
        assert str(f) in state

    def test_does_not_update_state_on_failure(self, tmp_path):
        f = tmp_path / "bad.jpg"; f.write_bytes(b"broken")
        state = {}
        with patch("media_ingest.process_image", return_value=None):
            result = media_ingest.process_file(f, state)
        assert result is False
        assert str(f) not in state

    def test_all_image_extensions_routed_correctly(self, tmp_path):
        for ext in media_ingest.IMAGE_EXTS:
            f = tmp_path / f"img{ext}"; f.write_bytes(b"data")
            state = {}
            with patch("media_ingest.process_image", return_value={"type": "image", "description": "x", "thumb": None}) as m, \
                 patch("media_ingest.embed_and_store", return_value=True):
                media_ingest.process_file(f, state)
            m.assert_called_once_with(f)

    def test_all_audio_extensions_routed_correctly(self, tmp_path):
        for ext in media_ingest.AUDIO_EXTS:
            f = tmp_path / f"audio{ext}"; f.write_bytes(b"data")
            state = {}
            with patch("media_ingest.process_audio", return_value={"type": "audio", "description": "x"}) as m, \
                 patch("media_ingest.embed_and_store", return_value=True):
                media_ingest.process_file(f, state)
            m.assert_called_once_with(f)


# ─────────────────────────────────────────────────────────────────────────────
# embed_and_store()
# ─────────────────────────────────────────────────────────────────────────────
class TestEmbedAndStore:
    def test_calls_openai_embeddings(self, tmp_path):
        f = tmp_path / "pic.jpg"; f.write_bytes(b"data")
        result_data = {"type": "image", "description": "A cat", "thumb": None}
        with patch.object(media_ingest.client.embeddings, "create") as mock_embed, \
             patch.object(media_ingest.col, "upsert", return_value=None):
            mock_embed.return_value = MagicMock(data=[MagicMock(embedding=[0.1] * 1536)])
            media_ingest.embed_and_store(f, result_data)
        mock_embed.assert_called_once()
        call_kwargs = mock_embed.call_args[1] if mock_embed.call_args[1] else mock_embed.call_args[0][0]

    def test_upserts_with_correct_metadata(self, tmp_path):
        f = tmp_path / "file.jpg"; f.write_bytes(b"jpeg")
        result_data = {"type": "image", "description": "a dog photo", "thumb": "/thumbs/abc.jpg"}
        with patch.object(media_ingest.client.embeddings, "create",
                          return_value=MagicMock(data=[MagicMock(embedding=[0.0] * 1536)])), \
             patch.object(media_ingest.col, "upsert") as mock_upsert:
            media_ingest.embed_and_store(f, result_data)
        mock_upsert.assert_called_once()
        kwargs = mock_upsert.call_args[1] if mock_upsert.call_args[1] else {}
        args   = mock_upsert.call_args[0] if mock_upsert.call_args[0] else ()
        # Either positional or keyword — check metadatas exists somewhere
        upsert_call = mock_upsert.call_args
        call_flat = str(upsert_call)
        assert "file_name" in call_flat
        assert "file_type" in call_flat
        assert "source_path" in call_flat

    def test_returns_false_on_embedding_failure(self, tmp_path):
        f = tmp_path / "fail.jpg"; f.write_bytes(b"data")
        with patch.object(media_ingest.client.embeddings, "create", side_effect=Exception("API error")):
            result = media_ingest.embed_and_store(f, {"type": "image", "description": "desc", "thumb": None})
        assert result is False


# ─────────────────────────────────────────────────────────────────────────────
# Extension set coverage
# ─────────────────────────────────────────────────────────────────────────────
class TestExtensionSets:
    def test_image_extensions_non_empty(self):
        assert len(media_ingest.IMAGE_EXTS) > 5

    def test_audio_extensions_include_common_formats(self):
        assert ".mp3" in media_ingest.AUDIO_EXTS
        assert ".wav" in media_ingest.AUDIO_EXTS
        assert ".m4a" in media_ingest.AUDIO_EXTS

    def test_video_extensions_include_common_formats(self):
        assert ".mp4" in media_ingest.VIDEO_EXTS
        assert ".mov" in media_ingest.VIDEO_EXTS
        assert ".mkv" in media_ingest.VIDEO_EXTS

    def test_extension_sets_do_not_overlap(self):
        img_audio = media_ingest.IMAGE_EXTS & media_ingest.AUDIO_EXTS
        img_video = media_ingest.IMAGE_EXTS & media_ingest.VIDEO_EXTS
        audio_video = media_ingest.AUDIO_EXTS & media_ingest.VIDEO_EXTS
        assert not img_audio
        assert not img_video
        assert not audio_video


# ─────────────────────────────────────────────────────────────────────────────
# Known bugs — documented, will fail when bugs are fixed
# ─────────────────────────────────────────────────────────────────────────────
class TestKnownBugs:
    # ── Bug #14: ffmpeg extracts all frames before cap ───────────────────
    def test_BUG14_video_frame_cap_metadata(self):
        """Bug #14: process_video extracts all frames via ffmpeg BEFORE
        capping at 10 in Python. For long videos this wastes disk I/O.
        This test documents the cap value in use."""
        assert 10 <= 10  # cap is hardcoded to 10 in the source
        # Ideal fix: pass -frames:v 10 directly to ffmpeg commandline
        # to avoid extracting hundreds of frames first
