# SecondBrain — Full Project Context
> Feed this file to GitHub Copilot (or any AI assistant) to get full project awareness.
> Last updated: Phase 6 complete, Phase 7 pending.

---

## What This Is

A self-hosted personal knowledge system. Every file, memory, photo, and line of code Felix has ever touched becomes searchable via AI chat. Runs on a Mac Mini in Felix's home, accessible anywhere over Tailscale VPN.

**The pitch:** "Find that whiteboard photo from Berlin" or "What authentication pattern did I use in my last Node project?" both work — because everything is embedded, indexed, and queryable.

---

## Infrastructure

| Detail | Value |
|---|---|
| Machine | Mac Mini 2012, i7, 4GB RAM + 2GB swap, 428GB disk |
| OS | Ubuntu Server 24.04 |
| User | `felix` |
| Hostname | `theta` |
| Tailscale IP | `100.68.4.105` |
| App directory | `/home/felix/SecondBrain/` |
| Python venv | `/home/felix/chroma-env/` |
| nginx cert | `/etc/ssl/certs/theta-selfsigned.crt` (self-signed, 10yr) |

### Access
```bash
ssh felix@100.68.4.105        # over Tailscale
https://100.68.4.105          # UI (accept self-signed cert once)
```

---

## Services (all systemd --user)

| Service | Binary | Role | Port |
|---|---|---|---|
| `chroma.service` | Python | ChromaDB vector database | 8000 |
| `second-brain.service` | Node.js | Express API (`server.js`) | 3000 |
| `nginx` | system | Reverse proxy, HTTPS termination, static files | 443 / 80→443 |
| `syncthing.service` | Go | Syncs laptop → `~/lifedb/` | — |
| `lifedb-ingest.service` | Python | Watches `~/lifedb/`, embeds text/code → ChromaDB | — |
| `repo-ingest.service` | Python | Indexes `~/repos/` GitHub repos → ChromaDB | — |
| `media-ingest.service` | Python | Watches `~/lifedb/`, Vision/Whisper → ChromaDB | — |

### Useful commands
```bash
# Status all
systemctl --user status chroma second-brain syncthing lifedb-ingest repo-ingest media-ingest

# Restart API after editing server.js
systemctl --user restart second-brain

# Live logs
journalctl --user -u second-brain -f
journalctl --user -u media-ingest -f

# Manual media scan
source ~/chroma-env/bin/activate && python3 ~/SecondBrain/media_ingest.py scan && deactivate

# nginx
sudo nginx -t && sudo systemctl reload nginx

# Vector counts
source ~/chroma-env/bin/activate
python3 -c "
import chromadb
c = chromadb.HttpClient(host='localhost', port=8000)
for col in c.list_collections():
    print(f'{col.name}: {col.count()} vectors')
"
deactivate
```

---

## File Structure

```
/home/felix/SecondBrain/
├── server.js             ← Node.js Express API (main backend)
├── second-brain.html     ← Single-file PWA frontend
├── ingest.py             ← Text/code ingestion (lifedb collection)
├── repo_ingest.py        ← GitHub repo ingestion (repos collection)
├── media_ingest.py       ← Photo/audio/video ingestion (media collection)
├── memories.json         ← Local JSON fallback for memories
├── graph.json            ← Knowledge graph (nodes + edges), built from chat
├── media_state.json      ← Tracks which media files have been processed
├── thumbnails/           ← JPEG thumbnails generated from photos/videos
│   └── <md5hash>.jpg
└── .env                  ← Secrets (NEVER commit, NEVER hardcode in frontend)
    ├── OPENAI_API_KEY=sk-...
    └── ANTHROPIC_API_KEY=sk-ant-...

/home/felix/lifedb/       ← Syncthing target — laptop files land here
/home/felix/repos/        ← Cloned GitHub repos, indexed by repo_ingest.py
/home/felix/chroma-env/   ← Python virtualenv (always activate before running Python)
```

---

## ChromaDB Collections

All collections use **inner product (`ip`) space** — distance is raw (0–1), higher = more similar. Do NOT invert or subtract from 1.

| Collection | Variable | Contents | Source |
|---|---|---|---|
| `second-brain` | `chromaCollection` | Manual memories + chat-auto-saved memories | Capture tab, chat SAVE_MEMORY |
| `lifedb` | `lifedbCollection` | Text/code files synced from laptop | `ingest.py` watching `~/lifedb/` |
| `repos` | `reposCollection` | GitHub repo code chunks | `repo_ingest.py` indexing `~/repos/` |
| `media` | `mediaCollection` | Photo descriptions, audio transcripts, video frames | `media_ingest.py` |

**Embedding model:** `text-embedding-3-small` (OpenAI, 1536 dimensions)  
**Score threshold:** `SCORE_THRESHOLD = 0.50` — results below are discarded  
**Search strategy:** `Promise.all` across all 4 collections simultaneously, merged, sorted by score, sliced to limit

### ChromaDB metadata schemas

**second-brain** (memories):
```json
{ "type": "note|task|idea|person|reference|conversation", "content": "...", "tags": "tag1,tag2", "timestamp": "ISO8601" }
```

**lifedb** (files):
```json
{ "source_path": "/home/felix/lifedb/...", "file_name": "readme.md", "file_type": "markdown", "modified": "ISO8601" }
```

**repos** (code):
```json
{ "source_path": "/home/felix/repos/myrepo/src/auth.js", "file_name": "auth.js", "file_type": "javascript", "repo": "myrepo" }
```

**media** (photos/audio/video):
```json
{ "source_path": "/home/felix/lifedb/photos/berlin.jpg", "file_name": "berlin.jpg", "file_type": "image|audio|video", "modified": "ISO8601", "thumb_path": "/home/felix/SecondBrain/thumbnails/<hash>.jpg" }
```

---

## server.js — Complete API Reference

**Runtime:** Node.js, Express, CommonJS  
**Port:** 3000 (proxied through nginx on 443)  
**Dependencies:** `express`, `cors`, `openai`, `chromadb`, `@anthropic-ai/sdk`, `dotenv`

### AI Clients
```javascript
const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
```

### Model Sets
```javascript
const CLAUDE_MODELS = new Set(['claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
const OPENAI_MODELS = new Set(['gpt-5-nano', 'gpt-4.1-mini', 'gpt-4o-mini']);
const GPT5_MODELS   = new Set(['gpt-5-nano']); // requires max_completion_tokens not max_tokens
```

> **CRITICAL:** GPT-5 family models (`gpt-5-nano`) require `max_completion_tokens` in the API call. GPT-4 family uses `max_tokens`. Mixing these causes HTTP 400 → caught as 500.

### Endpoints

#### `GET /api/health`
Returns status of all services and API keys.
```json
{
  "status": "ok",
  "chroma": true,
  "lifedb": true,
  "repos": true,
  "media": false,
  "openai": true,
  "anthropic": true,
  "timestamp": "2026-03-01T..."
}
```

#### `GET /api/config/whisper-key`
Returns the OpenAI API key for use by the frontend's Whisper transcription.  
**Security:** Key is read from `.env` at request time. Never hardcoded in HTML, never stored in localStorage.
```json
{ "key": "sk-..." }
```

#### `POST /api/chat`
RAG chat with SSE streaming. Retrieves context from all 4 collections, streams response, auto-saves memories.

Request:
```json
{ "message": "string", "history": [{"role": "user|assistant", "content": "..."}], "model": "claude-sonnet-4-6" }
```

SSE stream events:
```
data: {"type": "delta", "text": "chunk of response"}
data: {"type": "done", "query": "original message", "sources": [...], "savedMemory": null|{...}}
data: {"type": "error", "message": "..."}
```

Sources shape in `done` event:
```json
{
  "index": 1,
  "source": "/home/felix/lifedb/notes/auth.md",
  "collection": "lifedb",
  "score": 0.82,
  "fileName": "auth.md",
  "repo": null,
  "thumbPath": null,
  "content": "full chunk text used as context",
  "snippet": "first 120 chars of chunk, newlines removed"
}
```

#### `POST /api/search`
Parallel semantic search across all 4 collections.

Request: `{ "query": "string", "limit": 10 }`  
Response: array of hit objects (same shape as sources above, minus `index`/`snippet`)

#### `POST /api/memories`
Save a memory to ChromaDB + `memories.json`.

Request:
```json
{ "id": "optional", "type": "note", "content": "...", "tags": ["tag1"], "timestamp": "ISO8601" }
```

#### `GET /api/memories`
Returns paginated local memories, sorted newest first.  
Query params: `limit` (default 100), `offset` (default 0)

#### `GET /api/memories/:id` / `DELETE /api/memories/:id`
Get or delete a specific memory by ID. Delete removes from both ChromaDB and `memories.json`.

#### `GET /api/stats`
Vector counts per collection + memory breakdown.
```json
{
  "total": 42, "thisWeek": 5,
  "typeCounts": {"note": 30, "task": 12},
  "chromaVectors": 42, "lifedbVectors": 51,
  "reposVectors": 10446, "mediaVectors": 0
}
```

#### `GET /api/export` / `POST /api/import`
Export all memories as JSON. Import accepts `{ "memories": [...] }`.

#### `GET /api/graph`
Returns `graph.json` — `{ nodes: [], edges: [] }`.

#### `POST /api/graph/edge`
Called automatically after each chat response that has 2+ sources. Builds the knowledge graph by tracking co-citations.

Request: `{ "sources": [...], "query": "original message" }`

Node shape: `{ id, label, collection, repo, hits }`  
Edge shape: `{ id, source, target, weight, query }`

### Memory auto-save from chat (SAVE_MEMORY pattern)
The system prompt instructs the model to append this at the end of its response when it detects new personal info or explicit save requests:
```
SAVE_MEMORY:{"type":"note","content":"concise summary","tags":["tag1"]}
```
The server strips this from `fullText` before sending the `done` event, parses it, embeds it, and saves to ChromaDB + `memories.json`. The `savedMemory` field in the `done` event tells the frontend to show the confirmation indicator.

### Local fallback
`memories.json` stores all memories locally as a fallback. ChromaDB is the primary store but `memories.json` always gets written too. On startup, memories are loaded from `memories.json` for the GET endpoints.

---

## second-brain.html — Frontend Architecture

**Single file, no build step, no framework.**  
Served directly by nginx from `/home/felix/SecondBrain/second-brain.html`.

### Design system
```css
--bg:         #0c0c0c   /* pure black background */
--bg1:        #141414   /* card backgrounds */
--bg2:        #1c1c1c   /* input backgrounds */
--bg3:        #242424   /* hover states */
--border:     #2a2a2a
--border2:    #333
--text:       #e8e8e8
--text2:      #888
--text3:      #555      /* dim/muted */
--accent:     #82b97b   /* sage green — primary action color */
--accent-dim: #5c8457
--file:       #4fc3f7   /* lifedb results — light blue */
--memory:     #ce93d8   /* second-brain results — purple */
--repo:       #80cbc4   /* repos results — teal */
--media:      #ffb74d   /* media results — amber */
--error:      #ef5350
--success:    #66bb6a
--mono:       'IBM Plex Mono', monospace
--sans:       'IBM Plex Sans', sans-serif
```

### Tabs (6 total)
| Tab | ID | Default |
|---|---|---|
| Chat | `#chat-page` | ✅ yes |
| Search | `#search-page` | — |
| Capture | `#record-page` | — |
| Stats | `#stats-page` | — |
| Graph | `#graph-page` | — |
| Config | `#config-page` | — |

### Chat tab — detailed flow
1. User types in `#chat-input` (textarea, Enter sends, Shift+Enter newline)
2. User message bubble appended, thinking indicator shown
3. `POST /api/chat` with `{ message, history: last 10 turns, model }`
4. SSE stream opens — `delta` events update `contentEl.textContent` with streaming cursor
5. On `done` event:
   - `SAVE_MEMORY:{...}` stripped from `fullText` (server already saved it)
   - `renderCitations(fullText, sources)` — wraps `[File #N]` and `[Memory #N]` in clickable `<span class="cite">` elements
   - Source chips rendered below response (collection dot + filename + score %)
   - Search query pill rendered: `⌕ searched: "original message"`
   - If `savedMemory` present: inline confirmation + toast
   - `window._lastSources` set for citation click lookups
   - Graph edge saved if 2+ sources
6. `chatHistory` array maintained (last 20 turns), sent as context on next message

### Citation modal
Clicking any `[File #N]` span or source chip opens a bottom-sheet modal:
- Header: filename
- Meta bar: collection, score %, citation index
- Body: full chunk content (the exact text the model read), with first 60 chars of snippet highlighted in green `<mark>`
- Footer: full file path
- Close: tap backdrop or × button

### Model selector
Dropdown above chat input. Groups: Claude (Sonnet 4.6, Haiku 4.5) and OpenAI (gpt-5-nano, gpt-4.1-mini, gpt-4o-mini). Selection persisted in `localStorage('sb_model')`. Badge next to dropdown shows "claude" (purple) or "openai" (blue).

### Voice capture (Capture tab)
1. `navigator.mediaDevices.getUserMedia({ audio: true })` — requires HTTPS (self-signed cert)
2. `MediaRecorder` captures to `audio/webm`
3. On stop: `POST` blob to `https://api.openai.com/v1/audio/transcriptions` with `whisper-1`
4. Whisper key fetched from `/api/config/whisper-key` on page load — never hardcoded
5. Transcript appears in box → "use transcript" fills the content textarea → user saves as memory

### Knowledge graph (Graph tab)
- D3.js v7 force-directed simulation
- Nodes: files/memories that appeared as sources in chat, sized by hit count, colored by collection
- Edges: co-citations — files that appeared together as context get an edge, weight increases each time
- Labels on nodes with 3+ hits
- Drag/zoom/pan supported
- Data persisted in `graph.json` on server, loaded fresh each time Graph tab is opened

### State in localStorage
```javascript
sb_config   // { apiUrl: "https://100.68.4.105" }
sb_model    // "claude-sonnet-4-6"
sb_memories // local cache of memories array
sb_chatcount // integer
```

---

## Ingestion Pipelines

### ingest.py (lifedb — text/code)
- Watchdog observer on `~/lifedb/`
- 200+ supported file extensions with language-aware chunking
- Skips binary files, respects `.gitignore` patterns
- Chunks: ~500 tokens with overlap
- Embeds with `text-embedding-3-small`, upserts to `lifedb` collection
- Metadata: `source_path`, `file_name`, `file_type`, `modified`

### repo_ingest.py (repos — code)
- Scans `~/repos/` — supports flat (`~/repos/myrepo/`) and namespaced (`~/repos/user/myrepo/`) structures
- Language-aware chunking (functions, classes as natural boundaries)
- Stores in `repos` collection with `repo` field set to repo name

### media_ingest.py (media — photos/audio/video)
- **Images:** resize to max 1024px → `gpt-4o-mini` Vision API description → embed → store
- **Audio:** `whisper-1` transcription → prepend `[Audio transcript]` → embed → store
- **Video:** `ffmpeg` extracts 1 frame per 30s (max 10 frames) → Vision per frame → combined description → embed → store
- **Thumbnails:** PIL saves `320×320` JPEG to `~/SecondBrain/thumbnails/<md5hash>.jpg`
- **State:** `media_state.json` tracks `{ filepath: md5hash }` to skip unchanged files
- **Startup:** runs `full_scan()` then switches to watchdog for new files
- **Service startup tip:** if initial scan hangs (many photos), comment out `full_scan()` in the `else:` branch and run `python3 media_ingest.py scan` manually

---

## nginx Configuration

```nginx
# /etc/nginx/sites-available/second-brain

server {
    listen 80;
    server_name 100.68.4.105;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name 100.68.4.105;

    ssl_certificate     /etc/ssl/certs/theta-selfsigned.crt;
    ssl_certificate_key /etc/ssl/private/theta-selfsigned.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # Frontend
    location / {
        root /home/felix/SecondBrain;
        index second-brain.html;
        try_files $uri $uri/ /second-brain.html;
    }

    # API — SSE requires these exact settings
    location /api/ {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection '';
        proxy_set_header   Host $host;
        proxy_buffering    off;
        proxy_cache        off;
        chunked_transfer_encoding on;
    }

    # Thumbnails
    location /thumbnails/ {
        alias /home/felix/SecondBrain/thumbnails/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

> **SSE critical:** `proxy_buffering off` and `proxy_cache off` are mandatory. Without them, nginx buffers the stream and the frontend hangs waiting for the full response.

---

## AI Models Reference

| Model | Provider | String | Used For | Token Param |
|---|---|---|---|---|
| `text-embedding-3-small` | OpenAI | — | All embeddings | — |
| `claude-sonnet-4-6` | Anthropic | `claude-sonnet-4-6` | Chat (default, best quality) | `max_tokens` |
| `claude-haiku-4-5-20251001` | Anthropic | `claude-haiku-4-5-20251001` | Chat (fast) | `max_tokens` |
| `gpt-5-nano` | OpenAI | `gpt-5-nano` | Chat (cheapest) | **`max_completion_tokens`** ⚠️ |
| `gpt-4.1-mini` | OpenAI | `gpt-4.1-mini` | Chat (mid-range) | `max_tokens` |
| `gpt-4o-mini` | OpenAI | `gpt-4o-mini` | Chat (mid-range) | `max_tokens` |
| `gpt-4o-mini` | OpenAI | — | Vision API in media_ingest.py | — |
| `whisper-1` | OpenAI | — | Audio transcription | — |

---

## Security Model

- **API keys:** Only in `.env` on the server. Never in HTML, never in `localStorage`, never in git.
- **Whisper key:** Frontend fetches from `GET /api/config/whisper-key` at page load. Endpoint reads from `process.env.OPENAI_API_KEY` at request time.
- **Network:** Everything runs on Tailscale. The server is not exposed to the public internet.
- **HTTPS:** Self-signed cert for microphone access. Users accept the warning once per browser.
- **No auth:** Single-user system on a private VPN — no login required by design.

---

## Phases

### Completed
| Phase | What |
|---|---|
| 1 | ChromaDB + Node.js API + PWA frontend |
| 2 | Syncthing replacing OneDrive, `~/lifedb/` auto-sync |
| 3 | Python ingestion, 200+ filetypes, language-aware chunking |
| 4 | GitHub repo indexing, 10,446+ vectors |
| 5 | Streaming RAG chat, D3 graph, model selector, memory-from-chat, sage green UI |
| 6 | HTTPS + mic, Vision/Whisper/video ingestion, 4th collection, thumbnails in search |

### Remaining
| Phase | Plan |
|---|---|
| 7 | Persistent conversation memory across sessions + entity extraction (people, projects, dates) |
| 8 | Tinder-style file review (90-day unused queue, swipe keep/delete) |
| 9 | Proactive daily digest (calendar cross-reference, push notifications) |
| 10 | Full NLP knowledge graph with entity extraction |
| 11 | React Native mobile app (background sync, native camera) |

---

## Known Issues / Gotchas

| Issue | Cause | Fix |
|---|---|---|
| `gpt-5-nano` 500 error | `max_tokens` not accepted by GPT-5 family | Use `max_completion_tokens` for `GPT5_MODELS` set |
| media-ingest hangs on start | `full_scan()` runs synchronously before watchdog | Comment out `full_scan()` in `else:` branch, run manually |
| Mic permission denied | HTTP not HTTPS | Access via `https://` — accept cert warning once |
| nginx 403 on `/` | `second-brain.html` not set as index | Add `index second-brain.html;` to nginx location block |
| SSE streaming hangs | nginx buffering | Must have `proxy_buffering off` and `proxy_cache off` |
| ChromaDB `ip` space scores | Raw distance, not cosine | Higher = more similar. Do NOT do `1 - score` |
| Citations not clickable | `renderCitations` not receiving `sources` arg | Call as `renderCitations(fullText, sources)` |

---

## Development Workflow (VS Code Remote SSH)

```
Windows VS Code → Remote-SSH extension → felix@100.68.4.105 → /home/felix/SecondBrain/
```

Edit `server.js` → `Ctrl+S` → in integrated terminal:
```bash
systemctl --user restart second-brain
journalctl --user -u second-brain -f
```

The frontend (`second-brain.html`) is served as a static file by nginx — save and hard-refresh (`Ctrl+Shift+R`) in browser. No restart needed for HTML-only changes.

---

## Quick Test Curl Commands

```bash
# Health
curl -sk https://localhost/api/health | python3 -m json.tool

# Whisper key endpoint
curl -sk https://localhost/api/config/whisper-key

# Search
curl -sk -X POST https://localhost/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "authentication", "limit": 3}' | python3 -m json.tool

# Chat (SSE)
curl -sk -X POST https://localhost/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "what have I been working on?", "model": "claude-haiku-4-5-20251001"}' \
  --no-buffer

# Save memory
curl -sk -X POST https://localhost/api/memories \
  -H "Content-Type: application/json" \
  -d '{"type": "note", "content": "test memory from curl", "tags": ["test"]}'

# Stats
curl -sk https://localhost/api/stats | python3 -m json.tool

# Graph
curl -sk https://localhost/api/graph | python3 -m json.tool
```
