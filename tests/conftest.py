"""
conftest.py — pytest configuration
Patches weaviate, openai, watchdog before any test module imports ingest.py or media_ingest.py
"""
import sys
import types
import pytest
from unittest.mock import MagicMock, patch


def _make_mock_collection():
    """Create a mock Weaviate collection with data/aggregate sub-objects."""
    col = MagicMock()
    # col.data — insert_many, insert, delete_many, delete_by_id
    col.data.insert_many.return_value = None
    col.data.insert.return_value = None
    col.data.delete_many.return_value = None
    col.data.delete_by_id.return_value = None
    # col.aggregate.over_all()
    agg_result = MagicMock()
    agg_result.total_count = 0
    col.aggregate.over_all.return_value = agg_result
    # col.query.hybrid — for search tests
    col.query.hybrid.return_value = MagicMock(objects=[])
    return col


def _install_weaviate_mock():
    mock_col = _make_mock_collection()
    mock_client = MagicMock()
    mock_client.collections.get.return_value = mock_col

    # Build the weaviate module tree
    weaviate_mod = types.ModuleType("weaviate")
    weaviate_mod.connect_to_local = MagicMock(return_value=mock_client)
    weaviate_mod.util = MagicMock()
    weaviate_mod.util.generate_uuid5 = MagicMock(side_effect=lambda x: f"uuid-{x}")

    # weaviate.classes.data.DataObject — used in ingest.py insert_many
    classes_mod = types.ModuleType("weaviate.classes")
    data_mod = types.ModuleType("weaviate.classes.data")
    query_mod = types.ModuleType("weaviate.classes.query")

    data_mod.DataObject = MagicMock(side_effect=lambda **kwargs: kwargs)
    query_mod.Filter = MagicMock()

    classes_mod.data = data_mod
    classes_mod.query = query_mod

    weaviate_mod.classes = classes_mod

    sys.modules["weaviate"] = weaviate_mod
    sys.modules["weaviate.classes"] = classes_mod
    sys.modules["weaviate.classes.data"] = data_mod
    sys.modules["weaviate.classes.query"] = query_mod

    return mock_col, mock_client


def _install_openai_mock():
    mock_openai_client = MagicMock()
    mock_openai_client.embeddings.create.return_value = MagicMock(
        data=[MagicMock(embedding=[0.1] * 3072)]
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
_install_weaviate_mock()
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
