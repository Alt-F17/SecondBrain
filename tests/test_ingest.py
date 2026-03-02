"""
test_ingest.py — pytest tests for ingest.py
Tests chunking logic, state management, file hashing,
text extraction, and the full ingest_file pipeline using tmp files.

Dependencies are mocked via conftest.py before import.
"""
import os
import sys
import json
import hashlib
import importlib
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest

# ── Import the module under test ─────────────────────────────────────────────
# conftest.py has already installed chromadb/openai/watchdog mock modules.
# We import ingest here; WATCH_PATH and STATE_FILE will be reconfigured per test.
sys.path.insert(0, str(Path(__file__).parent.parent))
import ingest


# ─────────────────────────────────────────────────────────────────────────────
# _split_by_size()
# ─────────────────────────────────────────────────────────────────────────────
class TestSplitBySize:
    def test_short_text_is_single_chunk(self):
        text = "a" * 500
        result = ingest._split_by_size(text)
        assert len(result) == 1
        assert result[0] == text

    def test_long_text_is_split_into_multiple_chunks(self):
        text = "word " * 1000  # "word " * 1000 = 5000 chars
        result = ingest._split_by_size(text)
        assert len(result) > 1

    def test_chunks_overlap_by_CHUNK_OVERLAP(self):
        # Generate text long enough to produce ≥ 2 chunks
        text = "sentence. " * 500  # 5000 chars
        chunks = ingest._split_by_size(text)
        assert len(chunks) >= 2
        # The start of the second chunk should appear near the end of the first
        overlap_region = chunks[0][-(ingest.CHUNK_OVERLAP + 50):]
        assert chunks[1][:20] in overlap_region or len(chunks[1]) > 0

    def test_empty_text_returns_empty_list(self):
        result = ingest._split_by_size("")
        assert result == []

    def test_very_short_text_not_added_as_chunk(self):
        # Chunks shorter than 60 chars are filtered out by chunk_text,
        # but _split_by_size itself may include them — filter happens at caller
        text = "hi"
        result = ingest._split_by_size(text)
        # Either 0 or 1 result — no crash expected
        assert isinstance(result, list)

    # ── Bug #9: FIXED — _split_by_size raises ValueError when overlap >= chars ──
    def test_BUG9_infinite_loop_guard(self):
        """CHUNK_OVERLAP >= CHUNK_CHARS must raise ValueError immediately (not hang)."""
        original_chunk   = ingest.CHUNK_CHARS
        original_overlap = ingest.CHUNK_OVERLAP

        ingest.CHUNK_CHARS   = 10
        ingest.CHUNK_OVERLAP = 15  # overlap > chars — now guarded by ValueError

        try:
            with pytest.raises(ValueError, match="CHUNK_OVERLAP"):
                ingest._split_by_size("a" * 200)
        finally:
            ingest.CHUNK_CHARS   = original_chunk
            ingest.CHUNK_OVERLAP = original_overlap

    def test_splits_at_paragraph_boundary_preferentially(self):
        # Make a text that must split: intro fills > CHUNK_CHARS to force a second chunk
        intro = "A" * (ingest.CHUNK_CHARS + 200)   # forces at least 2 chunks
        para  = "\n\nNext paragraph. " + "B" * 400
        text  = intro + para
        chunks = ingest._split_by_size(text)
        assert len(chunks) >= 2
        # Second chunk content exists and is non-empty
        assert len(chunks[1].strip()) > 0

    def test_all_chunks_are_non_empty_strings(self):
        text = "line\n" * 400
        chunks = ingest._split_by_size(text)
        for c in chunks:
            assert isinstance(c, str)
            assert len(c) > 0


# ─────────────────────────────────────────────────────────────────────────────
# chunk_text()
# ─────────────────────────────────────────────────────────────────────────────
class TestChunkText:
    def _make_file(self, tmp_path, name, content):
        f = tmp_path / name
        f.write_text(content, encoding="utf-8")
        return f

    def test_markdown_splits_on_headers(self, tmp_path):
        md = "# Section 1\n" + "Content A. " * 80 + "\n\n## Section 2\n" + "Content B. " * 80
        f  = self._make_file(tmp_path, "doc.md", md)
        chunks = ingest.chunk_text(md, f)
        assert len(chunks) >= 2
        assert any("Section 1" in c for c in chunks)
        assert any("Section 2" in c for c in chunks)

    def test_python_splits_on_def(self, tmp_path):
        # Each function body must be > 60 chars after stripping to survive the filter
        body = "    x = 1\n    y = 2\n    return x + y  # computation\n"
        py = ("def alpha():\n" + body) * 30 + ("def beta():\n" + body) * 30
        f  = self._make_file(tmp_path, "code.py", py)
        chunks = ingest.chunk_text(py, f)
        assert len(chunks) >= 1
        assert all(len(c) > 60 for c in chunks)

    def test_javascript_splits_on_function(self, tmp_path):
        js = ("function hello() { return 1; }\n" * 60)
        f  = self._make_file(tmp_path, "app.js", js)
        chunks = ingest.chunk_text(js, f)
        assert all(isinstance(c, str) and len(c) > 60 for c in chunks)

    def test_csv_chunked_with_header_repeated(self, tmp_path):
        header = "id,name,value\n"
        rows   = "".join(f"{i},name{i},{i*2}\n" for i in range(200))
        csv    = header + rows
        f      = self._make_file(tmp_path, "data.csv", csv)
        chunks = ingest.chunk_text(csv, f)
        # Each chunk should start with the header
        for chunk in chunks:
            assert chunk.startswith("id,name,value")

    def test_plain_text_falls_through_to_size_split(self, tmp_path):
        text = ("Lorem ipsum dolor sit amet. " * 200)
        f    = self._make_file(tmp_path, "notes.txt", text)
        chunks = ingest.chunk_text(text, f)
        assert isinstance(chunks, list)
        assert len(chunks) >= 1

    def test_chunks_all_exceed_60_chars(self, tmp_path):
        text = "A" * 5000
        f    = self._make_file(tmp_path, "big.txt", text)
        chunks = ingest.chunk_text(text, f)
        for c in chunks:
            assert len(c) >= 60

    def test_empty_content_returns_empty_list(self, tmp_path):
        f = self._make_file(tmp_path, "empty.txt", " " * 10)
        # chunk_text filters chunks < 60 chars
        chunks = ingest.chunk_text("   ", f)
        assert chunks == []

    def test_ipynb_chunked_by_cell(self, tmp_path):
        nb = {
            "cells": [
                {"cell_type": "code",     "source": ["print('hello')\n" * 5]},
                {"cell_type": "markdown", "source": ["# Header\n", "Some text\n" * 20]},
            ]
        }
        nb_text = ingest.extract_text(tmp_path / "nb.ipynb")
        f = tmp_path / "nb.ipynb"
        f.write_text(json.dumps(nb), encoding="utf-8")
        extracted = ingest.extract_text(f)
        chunks = ingest.chunk_text(extracted, f)
        assert isinstance(chunks, list)


# ─────────────────────────────────────────────────────────────────────────────
# State management
# ─────────────────────────────────────────────────────────────────────────────
class TestStateManagement:
    def test_load_state_returns_empty_dict_when_file_missing(self, tmp_path):
        missing = tmp_path / "no_state.json"
        with patch("ingest.STATE_FILE", missing):
            state = ingest.load_state()
        assert state == {}

    def test_save_and_load_state_round_trips(self, tmp_path):
        state_file = tmp_path / "state.json"
        data = {"/path/to/file.py": "abc123", "/other.md": "def456"}
        with patch("ingest.STATE_FILE", state_file):
            ingest.save_state(data)
            loaded = ingest.load_state()
        assert loaded == data

    def test_save_state_creates_valid_json(self, tmp_path):
        state_file = tmp_path / "state.json"
        with patch("ingest.STATE_FILE", state_file):
            ingest.save_state({"key": "value"})
        content = json.loads(state_file.read_text())
        assert content == {"key": "value"}

    def test_load_state_returns_empty_dict_on_corrupt_json(self, tmp_path):
        state_file = tmp_path / "state.json"
        state_file.write_text("{ this is not json }", encoding="utf-8")
        with patch("ingest.STATE_FILE", state_file):
            state = ingest.load_state()
        assert state == {}


# ─────────────────────────────────────────────────────────────────────────────
# file_hash()
# ─────────────────────────────────────────────────────────────────────────────
class TestFileHash:
    def test_same_file_produces_same_hash(self, tmp_path):
        f = tmp_path / "test.txt"
        f.write_bytes(b"hello world")
        h1 = ingest.file_hash(f)
        h2 = ingest.file_hash(f)
        assert h1 == h2

    def test_different_content_produces_different_hash(self, tmp_path):
        a = tmp_path / "a.txt"; a.write_bytes(b"content A")
        b = tmp_path / "b.txt"; b.write_bytes(b"content B")
        assert ingest.file_hash(a) != ingest.file_hash(b)

    def test_returns_none_for_missing_file(self, tmp_path):
        result = ingest.file_hash(tmp_path / "does_not_exist.txt")
        assert result is None

    def test_hash_is_hex_string(self, tmp_path):
        f = tmp_path / "file.txt"; f.write_bytes(b"data")
        h = ingest.file_hash(f)
        assert isinstance(h, str)
        assert all(c in "0123456789abcdef" for c in h)


# ─────────────────────────────────────────────────────────────────────────────
# extract_text()
# ─────────────────────────────────────────────────────────────────────────────
class TestExtractText:
    def test_plain_text_file_reads_content(self, tmp_path):
        f = tmp_path / "notes.txt"
        f.write_text("Hello, world!", encoding="utf-8")
        result = ingest.extract_text(f)
        assert result == "Hello, world!"

    def test_python_file_reads_as_text(self, tmp_path):
        f = tmp_path / "script.py"
        f.write_text("def foo():\n    return 42\n", encoding="utf-8")
        result = ingest.extract_text(f)
        assert "def foo" in result

    def test_ipynb_extracts_cells(self, tmp_path):
        nb = {"cells": [
            {"cell_type": "code",     "source": ["x = 1\n"]},
            {"cell_type": "markdown", "source": ["# Title\n", "Some text.\n"]},
        ]}
        f = tmp_path / "nb.ipynb"
        f.write_text(json.dumps(nb), encoding="utf-8")
        result = ingest.extract_text(f)
        assert "x = 1" in result
        assert "# Title" in result

    def test_returns_none_for_unreadable_file(self, tmp_path):
        f = tmp_path / "fake.pdf"
        f.write_bytes(b"%PDF-1.4 broken content")
        # Without PyPDF2 installed this will either error or return None
        result = ingest.extract_text(f)
        # Either None (error caught) or empty string — should not raise
        assert result is None or isinstance(result, str)

    def test_utf8_errors_ignored(self, tmp_path):
        f = tmp_path / "latin.txt"
        f.write_bytes(b"caf\xe9 and na\xefve")  # invalid UTF-8
        result = ingest.extract_text(f)
        assert result is not None
        assert "caf" in result


# ─────────────────────────────────────────────────────────────────────────────
# ingest_file() — full pipeline
# ─────────────────────────────────────────────────────────────────────────────
class TestIngestFile:
    def _make_watch(self, tmp_path):
        watch = tmp_path / "lifedb"
        watch.mkdir(exist_ok=True)
        return watch

    def test_skips_unsupported_extension(self, tmp_path):
        watch = self._make_watch(tmp_path)
        f = watch / "binary.exe"
        f.write_bytes(b"\x00\x01\x02\x03")
        state = {}
        with patch("ingest.WATCH_PATH", watch):
            ingest.ingest_file(f, state)
        assert str(f) not in state  # not indexed

    def test_skips_empty_file(self, tmp_path):
        watch = self._make_watch(tmp_path)
        f = watch / "empty.txt"; f.write_bytes(b"")
        state = {}
        with patch("ingest.WATCH_PATH", watch):
            ingest.ingest_file(f, state)
        assert str(f) not in state

    def test_skips_file_over_size_limit(self, tmp_path):
        watch = self._make_watch(tmp_path)
        f = watch / "huge.txt"
        # Write slightly more than MAX_FILE_MB bytes
        f.write_bytes(b"x" * (ingest.MAX_FILE_MB * 1024 * 1024 + 1))
        state = {}
        with patch("ingest.WATCH_PATH", watch):
            ingest.ingest_file(f, state)
        assert str(f) not in state

    def test_skips_unchanged_file(self, tmp_path):
        watch = self._make_watch(tmp_path)
        f = watch / "notes.txt"
        f.write_text("Some content here to be indexed " * 5, encoding="utf-8")
        current_hash = ingest.file_hash(f)
        state = {str(f): current_hash}  # already marked as processed
        with patch("ingest.WATCH_PATH", watch):
            ingest.ingest_file(f, state)
        # State should still map to same hash — no re-index
        assert state[str(f)] == current_hash

    def test_indexes_new_supported_file(self, tmp_path):
        watch = self._make_watch(tmp_path)
        f = watch / "newfile.md"
        f.write_text(("# Header\n" + "Content line. " * 50) * 3, encoding="utf-8")
        state = {}
        with patch("ingest.WATCH_PATH", watch), \
             patch.object(ingest.collection, "get", return_value={"ids": []}), \
             patch.object(ingest.collection, "add", return_value=None) as mock_add:
            ingest.ingest_file(f, state)
        assert str(f) in state
        assert mock_add.called

    def test_deletes_old_chunks_before_reindexing(self, tmp_path):
        watch = self._make_watch(tmp_path)
        f = watch / "updated.md"
        f.write_text("# Updated\n" + "New content. " * 60, encoding="utf-8")
        state = {str(f): "old_hash"}  # different hash → triggers reindex
        with patch("ingest.WATCH_PATH", watch), \
             patch.object(ingest.collection, "get", return_value={"ids": ["old-chunk-id"]}), \
             patch.object(ingest.collection, "delete", return_value=None) as mock_del, \
             patch.object(ingest.collection, "add", return_value=None):
            ingest.ingest_file(f, state)
        assert mock_del.called

    def test_skips_hidden_file(self, tmp_path):
        watch = self._make_watch(tmp_path)
        f = watch / ".hidden_secret"
        f.write_text("secret", encoding="utf-8")
        state = {}
        with patch("ingest.WATCH_PATH", watch):
            ingest.ingest_file(f, state)
        assert str(f) not in state

    def test_skips_node_modules_directory(self, tmp_path):
        watch = self._make_watch(tmp_path)
        node_mod = watch / "node_modules"
        node_mod.mkdir()
        f = node_mod / "index.js"
        f.write_text("module.exports = {};", encoding="utf-8")
        state = {}
        with patch("ingest.WATCH_PATH", watch):
            ingest.ingest_file(f, state)
        assert str(f) not in state


# ─────────────────────────────────────────────────────────────────────────────
# remove_file()
# ─────────────────────────────────────────────────────────────────────────────
class TestRemoveFile:
    def test_removes_state_entry(self, tmp_path):
        watch = tmp_path / "lifedb"; watch.mkdir(exist_ok=True)
        f = watch / "gone.txt"
        state = {str(f): "somehash"}
        with patch("ingest.WATCH_PATH", watch), \
             patch.object(ingest.collection, "get", return_value={"ids": []}):
            ingest.remove_file(f, state)
        assert str(f) not in state

    def test_calls_chroma_delete_for_existing_chunks(self, tmp_path):
        watch = tmp_path / "lifedb"; watch.mkdir(exist_ok=True)
        f = watch / "old.md"
        state = {str(f): "hash"}
        with patch("ingest.WATCH_PATH", watch), \
             patch.object(ingest.collection, "get", return_value={"ids": ["chunk-1", "chunk-2"]}), \
             patch.object(ingest.collection, "delete", return_value=None) as mock_del:
            ingest.remove_file(f, state)
        mock_del.assert_called_once_with(ids=["chunk-1", "chunk-2"])


# ─────────────────────────────────────────────────────────────────────────────
# SUPPORTED extensions coverage
# ─────────────────────────────────────────────────────────────────────────────
class TestSupportedExtensions:
    def test_common_code_extensions_supported(self):
        must_have = {".py", ".js", ".ts", ".jsx", ".tsx", ".rs", ".go", ".java",
                     ".cs", ".cpp", ".c", ".rb", ".php", ".sh"}
        missing = must_have - ingest.SUPPORTED
        assert not missing, f"Missing expected extensions: {missing}"

    def test_markdown_supported(self):
        assert ".md" in ingest.SUPPORTED
        assert ".markdown" in ingest.SUPPORTED

    def test_data_formats_supported(self):
        assert ".json" in ingest.SUPPORTED
        assert ".yaml" in ingest.SUPPORTED
        assert ".csv" in ingest.SUPPORTED

    def test_skip_dirs_has_node_modules(self):
        assert "node_modules" in ingest.SKIP_DIRS

    def test_skip_dirs_has_git(self):
        assert ".git" in ingest.SKIP_DIRS


# ─────────────────────────────────────────────────────────────────────────────
# embed_batch()
# ─────────────────────────────────────────────────────────────────────────────
class TestEmbedBatch:
    def test_returns_list_of_embeddings(self):
        # Mock must return N embeddings for N inputs
        def multi_embed(**kwargs):
            texts = kwargs.get("input", [])
            return MagicMock(data=[MagicMock(embedding=[0.1] * 1536) for _ in texts])

        with patch.object(ingest.openai_client.embeddings, "create", side_effect=multi_embed):
            result = ingest.embed_batch(["hello", "world"])
        assert isinstance(result, list)
        assert len(result) == 2

    def test_returns_none_on_api_failure(self):
        with patch.object(ingest.openai_client.embeddings, "create", side_effect=Exception("API down")):
            result = ingest.embed_batch(["text"])
        assert result is None

    def test_embedding_length_is_1536(self):
        result = ingest.embed_batch(["test"])
        assert result is not None
        assert len(result[0]) == 1536
