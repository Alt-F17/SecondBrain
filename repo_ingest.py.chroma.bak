#!/usr/bin/env python3
"""
LifeDB Repo Ingestion — Phase 4
Indexes all cloned GitHub repos into ChromaDB 'repos' collection.
Language-aware chunking, ip space similarity, 4GB RAM conservative.
"""

import os
import sys
import hashlib
import json
import time
import logging
import subprocess
from pathlib import Path
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
log = logging.getLogger("repo-ingest")

# ── Config ────────────────────────────────────────────────────────────────────
REPOS_PATH    = Path.home() / "repos"
CHROMA_HOST   = "localhost"
CHROMA_PORT   = 8000
COLLECTION    = "repos"
EMBED_MODEL   = "text-embedding-3-small"
CHUNK_CHARS   = 1800
CHUNK_OVERLAP = 200
BATCH_SIZE    = 10
MAX_FILE_MB   = 5
STATE_FILE    = Path.home() / "SecondBrain" / ".repo_ingest_state.json"
PULL_INTERVAL = 3600  # re-pull repos every hour

OPENAI_KEY = os.getenv("OPENAI_API_KEY")

# ── Supported file types ──────────────────────────────────────────────────────
SUPPORTED = {
    # ── Python ────────────────────────────────────────────────────────────────
    ".py", ".pyw", ".pyi",

    # ── JavaScript / TypeScript ───────────────────────────────────────────────
    ".js", ".mjs", ".cjs",
    ".jsx", ".tsx", ".ts",
    ".vue", ".svelte", ".astro",
    ".coffee",

    # ── Systems languages ─────────────────────────────────────────────────────
    ".c", ".h",
    ".cpp", ".cc", ".cxx", ".hpp", ".hxx",
    ".rs",
    ".go",
    ".zig",
    ".v",
    ".odin",

    # ── JVM ───────────────────────────────────────────────────────────────────
    ".java",
    ".kt", ".kts",
    ".scala", ".sc",
    ".groovy", ".gradle",
    ".clj", ".cljs", ".cljc",

    # ── .NET ──────────────────────────────────────────────────────────────────
    ".cs",
    ".fs", ".fsi", ".fsx",
    ".vb",

    # ── Mobile ────────────────────────────────────────────────────────────────
    ".swift",
    ".dart",

    # ── Scripting ─────────────────────────────────────────────────────────────
    ".rb", ".rake", ".gemspec",
    ".php", ".phtml",
    ".pl", ".pm",
    ".lua",
    ".tcl",
    ".awk",
    ".sh", ".bash", ".zsh",
    ".fish", ".ksh", ".dash",
    ".bat", ".cmd",
    ".ps1", ".psm1", ".psd1",
    ".applescript", ".scpt",

    # ── Functional ────────────────────────────────────────────────────────────
    ".hs", ".lhs",
    ".ex", ".exs",
    ".erl", ".hrl",
    ".ml", ".mli",
    ".elm",
    ".purs",
    ".rkt",
    ".lisp", ".el",
    ".scm",

    # ── Data science / academic ───────────────────────────────────────────────
    ".r", ".rmd", ".qmd",
    ".jl",
    ".ipynb",
    ".m",

    # ── Web / markup ──────────────────────────────────────────────────────────
    ".html", ".htm", ".xhtml",
    ".css", ".scss", ".sass", ".less", ".styl",
    ".xml", ".xsl", ".xslt",
    ".svg",
    ".webmanifest",

    # ── Templates ─────────────────────────────────────────────────────────────
    ".j2", ".jinja", ".jinja2",
    ".erb",
    ".mustache", ".hbs",
    ".ejs",
    ".pug", ".jade",
    ".twig",
    ".liquid",

    # ── Database / query ──────────────────────────────────────────────────────
    ".sql", ".psql", ".mysql",
    ".graphql", ".gql",
    ".sparql",
    ".cypher",

    # ── API / schema / serialization ──────────────────────────────────────────
    ".proto",
    ".thrift",
    ".avro",
    ".wsdl",
    ".raml",
    ".har",

    # ── Config & data formats ─────────────────────────────────────────────────
    ".json", ".jsonl", ".ndjson",
    ".json5",
    ".yaml", ".yml",
    ".toml",
    ".ini", ".cfg", ".conf",
    ".properties",
    ".env", ".env.example", ".env.local", ".env.production",
    ".csv", ".tsv",
    ".plist",
    ".editorconfig",

    # ── Infrastructure as code ────────────────────────────────────────────────
    ".tf", ".tfvars",
    ".hcl",
    ".bicep",
    ".pkl",
    ".nix",
    ".dhall",

    # ── CI/CD & DevOps ────────────────────────────────────────────────────────
    ".dockerfile",
    ".containerfile",
    ".vagrantfile",
    ".jenkinsfile",

    # ── Package managers / build ──────────────────────────────────────────────
    ".gemspec",
    ".podspec",
    ".cabal",
    ".opam",

    # ── Documentation & writing ───────────────────────────────────────────────
    ".md", ".mdx", ".markdown",
    ".rst",
    ".adoc", ".asciidoc",
    ".tex", ".latex", ".bib",
    ".org",
    ".wiki",
    ".txt", ".text",
    ".log",
    ".man",

    # ── Game dev ──────────────────────────────────────────────────────────────
    ".gd",
    ".hlsl", ".glsl", ".wgsl",
    ".shader",

    # ── Version control / project meta ────────────────────────────────────────
    ".gitignore", ".gitattributes",
    ".npmrc", ".yarnrc", ".nvmrc",
    ".eslintrc", ".prettierrc",
    ".stylelintrc", ".babelrc",
    ".browserslistrc",

    # ── Misc developer ────────────────────────────────────────────────────────
    ".makefile",
    ".cmake",
    ".diff", ".patch",
    ".reg",
    ".cer", ".pem",
}

# ── Extensionless filenames ───────────────────────────────────────────────────
SUPPORTED_FILENAMES = {
    "Dockerfile", "Makefile", "Vagrantfile", "Jenkinsfile",
    "Containerfile", "Procfile", "Caddyfile",
    "README", "LICENSE", "CHANGELOG", "CONTRIBUTING", "AUTHORS",
    "CODEOWNERS", ".env", ".gitignore", ".gitattributes",
    "nginx.conf", "apache.conf", ".htaccess", "robots.txt",
    "requirements.txt", "Pipfile", "Gemfile", "Podfile",
    "package.json", "composer.json", "pom.xml", "build.gradle",
    "CMakeLists.txt", "Cargo.toml", "go.mod", "go.sum",
    "mix.exs", "rebar.config", "stack.yaml", "cabal.project",
}

# ── Skip directories ──────────────────────────────────────────────────────────
SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv",
    "dist", "build", ".next", ".nuxt", "coverage", ".cache",
    "vendor", "target", ".gradle", ".idea", ".vscode",
    ".terraform", ".serverless", "tmp", "temp", "logs"
}

# ── Clients ───────────────────────────────────────────────────────────────────
import chromadb
from openai import OpenAI

chroma_client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
collection = chroma_client.get_or_create_collection(
    name=COLLECTION,
    metadata={"hnsw:space": "ip"}
)
openai_client = OpenAI(api_key=OPENAI_KEY)

# ── State ─────────────────────────────────────────────────────────────────────
def load_state():
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except Exception:
            return {}
    return {}

def save_state(state):
    STATE_FILE.write_text(json.dumps(state))

def file_hash(path):
    try:
        return hashlib.md5(Path(path).read_bytes()).hexdigest()
    except Exception:
        return None

# ── Git operations ────────────────────────────────────────────────────────────
def get_repo_name(repo_path):
    parts = repo_path.parts
    repos_idx = next((i for i, p in enumerate(parts) if p == 'repos'), None)
    if repos_idx and repos_idx + 2 < len(parts):
        return f"{parts[repos_idx+1]}/{parts[repos_idx+2]}"
    return repo_path.name

def pull_repo(repo_path):
    try:
        result = subprocess.run(
            ["git", "pull", "--ff-only"],
            cwd=repo_path,
            capture_output=True,
            timeout=30
        )
        if result.returncode == 0:
            output = result.stdout.decode().strip()
            if output != "Already up to date.":
                log.info(f"📥 Updated: {repo_path.name} — {output}")
            return True
    except subprocess.TimeoutExpired:
        log.warning(f"⏱️  Pull timeout: {repo_path.name}")
    except Exception as e:
        log.warning(f"⚠️  Pull failed: {repo_path.name} — {e}")
    return False

def find_repos():
    repos = []
    for entry in REPOS_PATH.iterdir():
        if not entry.is_dir() or entry.name.startswith('.'):
            continue
        if (entry / '.git').exists():
            # Flat structure — repo directly in ~/repos/
            repos.append(entry)
        else:
            # Namespaced — entry is an owner dir, look one level deeper
            for repo_dir in entry.iterdir():
                if repo_dir.is_dir() and (repo_dir / '.git').exists():
                    repos.append(repo_dir)
    return repos


# ── Text extraction ───────────────────────────────────────────────────────────
def extract_text(path):
    ext = path.suffix.lower()
    try:
        if ext == ".ipynb":
            nb = json.loads(path.read_text(encoding="utf-8", errors="ignore"))
            cells = []
            for cell in nb.get("cells", []):
                source = "".join(cell.get("source", []))
                if source.strip():
                    cell_type = cell.get("cell_type", "")
                    prefix = f"[{cell_type}]\n" if cell_type else ""
                    cells.append(prefix + source)
            return "\n\n".join(cells)
        else:
            return path.read_text(encoding="utf-8", errors="ignore")
    except Exception as e:
        log.warning(f"Could not read {path.name}: {e}")
        return None

# ── Chunking ──────────────────────────────────────────────────────────────────
def chunk_code(text, path):
    ext = Path(path).suffix.lower()
    chunks = []

    if ext in {".py", ".pyw", ".pyi"}:
        import re
        sections = re.split(r'\n(?=(?:def |class |async def |@))', text)
        for s in sections:
            if s.strip():
                chunks.extend(_split(s))

    elif ext in {".js", ".mjs", ".cjs", ".jsx", ".tsx", ".ts", ".vue", ".svelte", ".astro"}:
        import re
        sections = re.split(r'\n(?=(?:function |class |const |export |async function |module\.))', text)
        for s in sections:
            if s.strip():
                chunks.extend(_split(s))

    elif ext in {".rs"}:
        import re
        sections = re.split(r'\n(?=(?:fn |pub fn |impl |struct |enum |trait |pub struct |pub enum ))', text)
        for s in sections:
            if s.strip():
                chunks.extend(_split(s))

    elif ext in {".go"}:
        import re
        sections = re.split(r'\n(?=(?:func |type |var |const ))', text)
        for s in sections:
            if s.strip():
                chunks.extend(_split(s))

    elif ext in {".java", ".kt", ".kts", ".scala", ".sc", ".cs", ".fs", ".swift", ".dart"}:
        import re
        sections = re.split(r'\n(?=(?:public |private |protected |class |interface |fun |func |def ))', text)
        for s in sections:
            if s.strip():
                chunks.extend(_split(s))

    elif ext in {".md", ".mdx", ".markdown", ".rst", ".org", ".adoc", ".asciidoc"}:
        import re
        sections = re.split(r'\n(?=#{1,3} )', text)
        for s in sections:
            if s.strip():
                chunks.extend(_split(s))

    elif ext == ".ipynb":
        for section in text.split("\n\n"):
            if section.strip():
                chunks.extend(_split(section))

    else:
        chunks = _split(text)

    return [c.strip() for c in chunks if len(c.strip()) > 40]

def _split(text):
    chunks = []
    start = 0
    while start < len(text):
        end = start + CHUNK_CHARS
        chunk = text[start:end]
        if end < len(text):
            for sep in ['\n\n', '\n', '. ', ' ']:
                idx = chunk.rfind(sep)
                if idx > CHUNK_CHARS // 2:
                    chunk = text[start:start + idx + len(sep)]
                    end = start + idx + len(sep)
                    break
        if chunk.strip():
            chunks.append(chunk)
        start = end - CHUNK_OVERLAP
    return chunks

# ── Embedding ─────────────────────────────────────────────────────────────────
def embed_batch(texts):
    try:
        response = openai_client.embeddings.create(
            model=EMBED_MODEL,
            input=texts
        )
        return [item.embedding for item in response.data]
    except Exception as e:
        log.error(f"Embedding failed: {e}")
        return None

# ── Core ingest ───────────────────────────────────────────────────────────────
def ingest_file(path, repo_name, state):
    path = Path(path)

    # ── Gate check — extension OR known filename ──────────────────────────────
    ext = path.suffix.lower()
    if ext not in SUPPORTED and path.name not in SUPPORTED_FILENAMES:
        return

    if not path.is_file() or path.stat().st_size == 0:
        return
    if path.stat().st_size > MAX_FILE_MB * 1024 * 1024:
        return

    current_hash = file_hash(path)
    if not current_hash:
        return

    state_key = str(path)
    if state.get(state_key) == current_hash:
        return

    text = extract_text(path)
    if not text or len(text.strip()) < 40:
        return

    chunks = chunk_code(text, path)
    if not chunks:
        return

    try:
        rel_path = str(path.relative_to(REPOS_PATH))
    except ValueError:
        rel_path = str(path)

    file_type = ext.lstrip(".") or "text"

    # Delete old chunks
    try:
        existing = collection.get(where={"source_path": rel_path})
        if existing["ids"]:
            collection.delete(ids=existing["ids"])
    except Exception:
        pass

    # Embed and upsert
    total = 0
    for i in range(0, len(chunks), BATCH_SIZE):
        batch = chunks[i:i + BATCH_SIZE]
        embeddings = embed_batch(batch)
        if not embeddings:
            continue

        ids = [
            hashlib.md5(f"{rel_path}_{i+j}_{current_hash}".encode()).hexdigest()
            for j in range(len(batch))
        ]

        metadatas = [{
            "source_path": rel_path,
            "file_name": path.name,
            "file_type": file_type,
            "repo": repo_name,
            "chunk_index": i + j,
        } for j in range(len(batch))]

        try:
            collection.add(
                ids=ids,
                embeddings=embeddings,
                documents=batch,
                metadatas=metadatas
            )
            total += len(batch)
        except Exception as e:
            log.error(f"Upsert failed: {e}")

        time.sleep(0.1)

    state[state_key] = current_hash
    log.info(f"✅ {rel_path} → {total} chunks")

def remove_file_from_index(path, state):
    try:
        rel_path = str(path.relative_to(REPOS_PATH))
        existing = collection.get(where={"source_path": rel_path})
        if existing["ids"]:
            collection.delete(ids=existing["ids"])
    except Exception:
        pass
    state.pop(str(path), None)

# ── Bulk scan ─────────────────────────────────────────────────────────────────
def scan_repo(repo_path, repo_name, state):
    files = []
    for f in repo_path.rglob("*"):
        if any(part in SKIP_DIRS for part in f.parts):
            continue
        if not f.is_file():
            continue
        ext = f.suffix.lower()
        if ext in SUPPORTED or f.name in SUPPORTED_FILENAMES:
            files.append(f)

    log.info(f"  📁 {repo_name}: {len(files)} files to check")
    for f in files:
        ingest_file(f, repo_name, state)

def bulk_scan(state):
    repos = find_repos()
    log.info(f"Found {len(repos)} repos in {REPOS_PATH}")

    for repo_path in repos:
        repo_name = get_repo_name(repo_path)
        log.info(f"Scanning: {repo_name}")
        scan_repo(repo_path, repo_name, state)
        save_state(state)

    total = collection.count()
    log.info(f"✅ Bulk scan complete — {total} total vectors in 'repos' collection")

# ── Periodic pull + rescan ────────────────────────────────────────────────────
def run_forever(state):
    log.info(f"👀 Pulling repo updates every {PULL_INTERVAL // 60} minutes...")
    while True:
        time.sleep(PULL_INTERVAL)
        log.info("🔄 Pulling latest changes...")
        repos = find_repos()
        for repo_path in repos:
            pulled = pull_repo(repo_path)
            if pulled:
                repo_name = get_repo_name(repo_path)
                scan_repo(repo_path, repo_name, state)
                save_state(state)

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    log.info("🧠 LifeDB Repo Ingestion Pipeline")
    log.info(f"   Repos path : {REPOS_PATH}")
    log.info(f"   Collection : {COLLECTION} (ip space)")
    log.info(f"   Embed model: {EMBED_MODEL}")
    log.info(f"   Extensions : {len(SUPPORTED)} supported")
    log.info(f"   Filenames  : {len(SUPPORTED_FILENAMES)} supported")

    if not OPENAI_KEY:
        log.error("OPENAI_API_KEY not set")
        sys.exit(1)

    if not REPOS_PATH.exists():
        log.error(f"Repos path does not exist: {REPOS_PATH}")
        log.error("Run: mkdir -p ~/repos && gh repo list ... | xargs gh repo clone")
        sys.exit(1)

    state = load_state()
    bulk_scan(state)
    run_forever(state)
