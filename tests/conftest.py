"""
conftest.py — pytest configuration
Patches chromadb, openai, watchdog before any test module imports ingest.py or media_ingest.py
"""
import sys
import types
import pytest
from unittest.mock import MagicMock, patch


def _make_mock_collection():
    col = MagicMock()
    col.count.return_value = 0
    col.add.return_value = None
    col.upsert.return_value = None
    col.get.return_value = {"ids": []}
    col.delete.return_value = None
    col.query.return_value = {
        "ids": [[]],
        "documents": [[]],
        "metadatas": [[]],
        "distances": [[]]
    }
    return col


def _install_chromadb_mock():
    mock_col = _make_mock_collection()
    mock_client = MagicMock()
    mock_client.get_or_create_collection.return_value = mock_col
    mock_client.get_collection.return_value = mock_col

    chroma_mod = types.ModuleType("chromadb")
    chroma_mod.HttpClient = MagicMock(return_value=mock_client)

    sys.modules["chromadb"] = chroma_mod
    return mock_col, mock_client


def _install_openai_mock():
    mock_openai_client = MagicMock()
    mock_openai_client.embeddings.create.return_value = MagicMock(
        data=[MagicMock(embedding=[0.1] * 1536)]
    )
    mock_openai_client.chat.completions.create.return_value = MagicMock(
        choices=[MagicMock(message=MagicMock(content="Mock description"))]
    )
    mock_openai_client.audio.transcriptions.create.return_value = "Mock transcript"

    openai_mod = types.ModuleType("openai")
    openai_mod.OpenAI = MagicMock(return_value=mock_openai_client)

    sys.modules["openai"] = openai_mod
    return mock_openai_client


def _install_watchdog_mock():
    for mod_name in [
        "watchdog", "watchdog.observers", "watchdog.events"
    ]:
        mod = types.ModuleType(mod_name)
        sys.modules[mod_name] = mod

    observer_cls = MagicMock()
    sys.modules["watchdog.observers"].Observer = observer_cls

    handler_cls = MagicMock()
    handler_cls.__bases__ = (object,)
    sys.modules["watchdog.events"].FileSystemEventHandler = handler_cls

    return observer_cls


# Install mocks BEFORE any ingest module is loaded
_install_chromadb_mock()
_install_openai_mock()
_install_watchdog_mock()

# Also mock PIL and dotenv for media_ingest.py
pil_mod = types.ModuleType("PIL")
pil_mod.Image = MagicMock()
sys.modules["PIL"] = pil_mod
sys.modules["PIL.Image"] = pil_mod.Image

dotenv_mod = types.ModuleType("dotenv")
dotenv_mod.load_dotenv = MagicMock()
sys.modules["dotenv"] = dotenv_mod


@pytest.fixture(autouse=True)
def set_env(monkeypatch, tmp_path):
    """Provide env vars and redirect state files to tmp_path for every test."""
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    # Override HOME so ~/lifedb and ~/SecondBrain paths point into tmp_path
    monkeypatch.setenv("HOME", str(tmp_path))
    lifedb = tmp_path / "lifedb"
    lifedb.mkdir()
    (tmp_path / "SecondBrain").mkdir()
    return tmp_path
