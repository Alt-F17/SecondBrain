// ══════════════════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════════════════
let config = JSON.parse(localStorage.getItem('sb_config') || '{}');
config.apiUrl = config.apiUrl || window.location.origin;

// Whisper key fetched from server — never stored in frontend
let whisperKey = '';

let currentFilter = 'all';
let allResults    = [];
let mediaRecorder = null;
let audioChunks   = [];
let isRecording   = false;
let searchTimeout = null;
let memories      = JSON.parse(localStorage.getItem('sb_memories') || '[]');
let selectedType  = 'note';
let chatHistory   = [];
let isStreaming   = false;
let chatCount     = parseInt(localStorage.getItem('sb_chatcount') || '0');

// ══════════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('cfg-api-url').value = config.apiUrl;

    // Load saved model preference
    const savedModel = localStorage.getItem('sb_model') || 'claude-sonnet-4-6';
    document.getElementById('model-select').value = savedModel;
    updateModelBadge();

    // Fetch Whisper key from server (read from .env, never hardcoded here)
    try {
        const r = await fetch(`${config.apiUrl}/api/config/whisper-key`);
        const d = await r.json();
        whisperKey = d.key || '';
    } catch {}

    checkHealth();
    setupSearchInput();
    setupChatInput();
});

// ══════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════════════
function showPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(name + '-page').classList.add('active');
    document.getElementById('nav-' + name).classList.add('active');
    if (name === 'stats')  loadStats();
    if (name === 'graph')  loadGraph();
    if (name === 'search') document.getElementById('search-input').focus();
}

// ══════════════════════════════════════════════════════════════════════════════
// CHAT
// ══════════════════════════════════════════════════════════════════════════════
function setupChatInput() {
    const input = document.getElementById('chat-input');
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    });
}

function updateModelBadge() {
    const val   = document.getElementById('model-select').value;
    const badge = document.getElementById('model-badge');
    const isOpenAI = val.startsWith('gpt');
    badge.textContent = isOpenAI ? 'openai' : 'claude';
    badge.className   = `model-badge ${isOpenAI ? 'openai' : 'claude'}`;
    localStorage.setItem('sb_model', val);
}

async function sendChat() {
    if (isStreaming) return;
    const input = document.getElementById('chat-input');
    const msg   = input.value.trim();
    if (!msg) return;

    input.value = '';
    input.style.height = 'auto';
    isStreaming = true;
    document.getElementById('chat-send').disabled = true;

    const container = document.getElementById('chat-messages');
    const empty = container.querySelector('.empty-state');
    if (empty) empty.remove();

    appendUserMsg(msg);
    chatHistory.push({ role: 'user', content: msg });

    const thinkId = 'think-' + Date.now();
    container.insertAdjacentHTML('beforeend', `
        <div class="msg-wrap msg-thinking" id="${thinkId}">
            <div class="thinking-dots"><span></span><span></span><span></span></div>
            <span>retrieving context...</span>
        </div>`);
    scrollChat();

    try {
        const selectedModel = document.getElementById('model-select').value;
        const res = await fetch(`${config.apiUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg, history: chatHistory.slice(-10), model: selectedModel })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        document.getElementById(thinkId)?.remove();

        const aiWrap = document.createElement('div');
        aiWrap.className = 'msg-wrap msg-ai';
        aiWrap.innerHTML = `<div class="msg-ai-label">⬡ second brain</div><div class="msg-ai-content" id="ai-content-cur"></div><div class="msg-sources" id="ai-sources-cur"></div>`;
        container.appendChild(aiWrap);
        scrollChat();

        const contentEl = document.getElementById('ai-content-cur');
        const sourcesEl = document.getElementById('ai-sources-cur');
        const cursor    = document.createElement('span');
        cursor.className = 'cursor';
        contentEl.appendChild(cursor);

        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let fullText  = '';
        let sources   = [];
        let savedMemory = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const line of decoder.decode(value).split('\n')) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const data = JSON.parse(line.slice(6));
                    if (data.type === 'delta') {
                        fullText += data.text;
                        contentEl.textContent = fullText;
                        contentEl.appendChild(cursor);
                        scrollChat();
                    } else if (data.type === 'done') {
                        sources     = data.sources || [];
                        savedMemory = data.savedMemory || null;
                    } else if (data.type === 'error') {
                        throw new Error(data.message);
                    }
                } catch {}
            }
        }

        cursor.remove();

        // Strip SAVE_MEMORY from visible text (server handles the save)
        fullText = fullText.replace(/\nSAVE_MEMORY:\{[^\n]+\}/, '').trimEnd();
        contentEl.innerHTML = renderCitations(fullText, sources);

        // Store source map on aiWrap so citations can open correct modal
        aiWrap._sources = sources;

        // Search query pill
        if (msg) {
            const queryPill = document.createElement('div');
            queryPill.className = 'msg-query';
            queryPill.innerHTML = `<span class="msg-query-text">searched: "${escHtml(msg)}"</span>`;
            aiWrap.insertBefore(queryPill, contentEl);
        }

        // Source chips
        if (sources.length) {
            sourcesEl.innerHTML = sources.map(s => {
                const label = s.fileName || s.source?.split('/').pop() || s.source;
                const score = s.score ? `${Math.round(s.score * 100)}%` : '';
                return `<div class="source-chip" title="${s.source}" onclick="openCiteBySource('${encodeURIComponent(s.source)}', window._lastSources)">
                    <div class="chip-dot ${s.collection}"></div>
                    <span class="chip-label">${label}</span>
                    <span class="chip-score">${score}</span>
                </div>`;
            }).join('');
        }

        // Keep a reference for citation clicks
        window._lastSources = sources;

        // Memory saved confirmation
        if (savedMemory) {
            const ind = document.createElement('div');
            ind.className = 'msg-memory-saved';
            ind.textContent = `memory saved: "${savedMemory.content.slice(0, 70)}${savedMemory.content.length > 70 ? '…' : ''}"`;
            aiWrap.appendChild(ind);
            // Also update local cache
            memories.push({ id: Date.now().toString(), ...savedMemory, timestamp: new Date().toISOString() });
            localStorage.setItem('sb_memories', JSON.stringify(memories));
            showToast('memory saved ✓', 'success');
        }

        // Remove cur suffix from IDs
        contentEl.id = 'ai-c-' + Date.now();
        sourcesEl.id = 'ai-s-' + Date.now();

        chatHistory.push({ role: 'assistant', content: fullText });
        if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);

        // Save graph edges
        if (sources.length > 1) {
            fetch(`${config.apiUrl}/api/graph/edge`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sources, query: msg })
            }).catch(() => {});
        }

        chatCount++;
        localStorage.setItem('sb_chatcount', chatCount);

    } catch (err) {
        document.getElementById(thinkId)?.remove();
        const errWrap = document.createElement('div');
        errWrap.className = 'msg-wrap msg-ai';
        errWrap.innerHTML = `<div class="msg-ai-label" style="color:var(--error)">⚠ error</div><div class="msg-ai-content" style="color:var(--error)">${escHtml(err.message)}</div>`;
        container.appendChild(errWrap);
        showToast('chat failed', 'error');
    }

    isStreaming = false;
    document.getElementById('chat-send').disabled = false;
    scrollChat();
}

function appendUserMsg(msg) {
    const container = document.getElementById('chat-messages');
    const el = document.createElement('div');
    el.className = 'msg-wrap';
    el.innerHTML = `<div class="msg-user">${escHtml(msg)}</div>`;
    container.appendChild(el);
    scrollChat();
}

function scrollChat() {
    const c = document.getElementById('chat-messages');
    c.scrollTop = c.scrollHeight;
}

function renderCitations(text, sources) {
    return escHtml(text).replace(/\[(File|Memory) #(\d+)([^\]]*)\]/g, (match, type, num) => {
        const idx = parseInt(num) - 1;
        return `<span class="cite" onclick="openCiteModal(${idx}, window._lastSources)" title="click to view source">${match}</span>`;
    });
}

function openCiteModal(idx, sources) {
    if (!sources || !sources[idx]) return;
    const src = sources[idx];
    showCiteModal(src);
}

function openCiteBySource(encodedPath, sources) {
    if (!sources) return;
    const path = decodeURIComponent(encodedPath);
    const src = sources.find(s => s.source === path);
    if (src) showCiteModal(src);
}

function showCiteModal(src) {
    const label = src.fileName || src.source?.split('/').pop() || src.source;
    document.getElementById('cite-modal-title').textContent = label;
    document.getElementById('cm-collection').textContent = src.collection || '—';
    document.getElementById('cm-score').textContent = src.score ? `${Math.round(src.score * 100)}%` : '—';
    document.getElementById('cm-index').textContent = src.index != null ? `#${src.index}` : '—';

    // Render chunk content with simple paragraph highlighting
    const content = src.content || '(no content)';
    const snippet = src.snippet || '';
    // Highlight the matching snippet if present
    let rendered = escHtml(content);
    if (snippet) {
        const escapedSnippet = escHtml(snippet.trim().slice(0, 60));
        if (escapedSnippet) {
            rendered = rendered.replace(escapedSnippet, `<mark>${escapedSnippet}</mark>`);
        }
    }
    document.getElementById('cite-modal-content').innerHTML = rendered;
    document.getElementById('cite-modal-path').textContent = src.source || '';
    document.getElementById('cite-modal').classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeCiteModal(e) {
    if (e && e.target !== document.getElementById('cite-modal') && e.target !== document.getElementById('cite-modal-close')) return;
    document.getElementById('cite-modal').classList.remove('open');
    document.body.style.overflow = '';
}

function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ══════════════════════════════════════════════════════════════════════════════
// SEARCH
// ══════════════════════════════════════════════════════════════════════════════
function setupSearchInput() {
    const input = document.getElementById('search-input');
    input.addEventListener('input', e => {
        const val = e.target.value.trim();
        document.getElementById('search-clear').style.display = val ? 'block' : 'none';
        clearTimeout(searchTimeout);
        if (val.length >= 2) searchTimeout = setTimeout(() => doSearch(val), 350);
        else if (!val) showSearchEmpty();
    });
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { clearTimeout(searchTimeout); const v = e.target.value.trim(); if (v) doSearch(v); }
    });
}

function setFilter(btn) {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderResults(allResults);
}

function clearSearch() {
    document.getElementById('search-input').value = '';
    document.getElementById('search-clear').style.display = 'none';
    allResults = [];
    showSearchEmpty();
}

function showSearchEmpty() {
    document.getElementById('search-results').innerHTML = `<div class="empty-state"><span class="big">🔍</span>search your memories<br>and synced files</div>`;
}

async function doSearch(query) {
    document.getElementById('search-results').innerHTML = `<div class="empty-state"><div class="spinner" style="margin:0 auto"></div></div>`;
    try {
        const res = await fetch(`${config.apiUrl}/api/search`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, limit: 20 })
        });
        if (!res.ok) throw new Error();
        allResults = await res.json();
        renderResults(allResults);
    } catch {
        const q = query.toLowerCase();
        allResults = memories.filter(m => m.content?.toLowerCase().includes(q) || m.tags?.some(t => t.toLowerCase().includes(q)));
        renderResults(allResults);
    }
}

function renderResults(results) {
    const container = document.getElementById('search-results');
    const filtered = currentFilter === 'all' ? results : results.filter(r => {
        if (currentFilter === 'memory') return r.collection === 'second-brain';
        if (currentFilter === 'file')   return r.collection === 'lifedb';
        if (currentFilter === 'code')   return r.collection === 'repos';
        if (currentFilter === 'media')  return r.collection === 'media';
        return r.type === currentFilter;
    });

    if (!filtered.length) { container.innerHTML = `<div class="empty-state"><span class="big">∅</span>nothing found</div>`; return; }

    container.innerHTML = filtered.map((r, i) => {
        const typeStr = r.collection === 'repos' ? 'code' : r.collection === 'lifedb' ? 'file' : r.collection === 'media' ? (r.type || 'image') : (r.type || 'note');
        const score   = r.score ? `${Math.round(r.score * 100)}%` : '';
        const source  = (r.collection !== 'second-brain' && r.source)
            ? `<span class="result-source">📂 ${r.source}</span>` : '';
        const ts   = r.timestamp ? `<div class="result-timestamp">${new Date(r.timestamp).toLocaleString()}</div>` : '';
        const tags = (r.tags||[]).filter(Boolean).length
            ? `<div class="result-tags">${r.tags.filter(Boolean).map(t=>`<span class="result-tag">${t}</span>`).join('')}</div>` : '';
        // Thumbnail for media results
        const thumb = (r.collection === 'media' && r.thumbPath)
            ? `<img class="result-thumb" src="/thumbnails/${r.thumbPath.split('/').pop()}" loading="lazy" onerror="this.style.display='none'">`
            : '';

        return `<div class="result-card" style="animation-delay:${i*0.035}s" onclick="toggleExpand(this,${i})">
            ${thumb}
            <div class="result-meta">
                <span class="result-type ${typeStr}">${typeStr}</span>
                ${score ? `<span class="result-score">${score}</span>` : ''}
            </div>
            ${source}
            <div class="result-content" id="rc-${i}">${escHtml((r.content||'').slice(0, 300))}</div>
            ${tags}${ts}
        </div>`;
    }).join('');
}

function toggleExpand(card, i) {
    const c = document.getElementById(`rc-${i}`);
    card.classList.toggle('expanded', c.classList.toggle('expanded'));
}

// ══════════════════════════════════════════════════════════════════════════════
// CAPTURE
// ══════════════════════════════════════════════════════════════════════════════
function selectType(btn) {
    document.querySelectorAll('.type-pill').forEach(p => p.classList.remove('selected'));
    btn.classList.add('selected');
    selectedType = btn.dataset.type;
}

async function saveMemory() {
    const content = document.getElementById('memory-content').value.trim();
    if (!content) { showToast('content required', 'error'); return; }
    const tags = document.getElementById('memory-tags').value.split(',').map(t=>t.trim()).filter(Boolean);
    const memory = { id: Date.now().toString(), type: selectedType, content, tags, timestamp: new Date().toISOString() };
    try {
        const res = await fetch(`${config.apiUrl}/api/memories`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(memory)
        });
        if (!res.ok) throw new Error();
        const saved = await res.json();
        memories.push(saved);
        localStorage.setItem('sb_memories', JSON.stringify(memories));
        showToast('memory saved ✓', 'success');
        document.getElementById('memory-content').value = '';
        document.getElementById('memory-tags').value = '';
    } catch {
        memories.push(memory);
        localStorage.setItem('sb_memories', JSON.stringify(memories));
        showToast('saved locally', 'success');
        document.getElementById('memory-content').value = '';
    }
}

async function toggleRecording() {
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks   = [];
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = async () => { await transcribe(new Blob(audioChunks, { type: 'audio/webm' })); };
            mediaRecorder.start();
            isRecording = true;
            document.getElementById('record-btn').classList.add('recording');
            document.getElementById('record-label').textContent = 'tap to stop';
        } catch { showToast('microphone access denied', 'error'); }
    } else {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
        isRecording = false;
        document.getElementById('record-btn').classList.remove('recording');
        document.getElementById('record-label').textContent = 'transcribing...';
        document.getElementById('record-btn').disabled = true;
    }
}

async function transcribe(blob) {
    const btn = document.getElementById('record-btn');
    if (!whisperKey) { showToast('whisper key not available — check server .env', 'error'); btn.disabled = false; document.getElementById('record-label').textContent = 'start recording'; return; }
    try {
        const form = new FormData();
        form.append('file', blob, 'recording.webm');
        form.append('model', 'whisper-1');
        const res  = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST', headers: { 'Authorization': `Bearer ${whisperKey}` }, body: form
        });
        const data = await res.json();
        const box  = document.getElementById('transcript-box');
        box.textContent = data.text;
        box.style.display = 'block';
        document.getElementById('save-transcript-btn').style.display = 'block';
        showToast('transcription ready', 'success');
    } catch { showToast('transcription failed', 'error'); }
    btn.disabled = false;
    document.getElementById('record-label').textContent = 'start recording';
}

function saveTranscript() {
    const text = document.getElementById('transcript-box').textContent;
    document.getElementById('memory-content').value = text;
    document.getElementById('transcript-box').style.display = 'none';
    document.getElementById('save-transcript-btn').style.display = 'none';
    document.getElementById('memory-content').focus();
    showToast('transcript ready to save', 'success');
}

// ══════════════════════════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════════════════════════
async function loadStats() {
    try {
        const res = await fetch(`${config.apiUrl}/api/stats`);
        const s   = await res.json();
        document.getElementById('stat-total').textContent   = s.total        ?? '—';
        document.getElementById('stat-week').textContent    = s.thisWeek     ?? '—';
        document.getElementById('stat-vectors').textContent = s.memoriesVectors ?? '—';
        document.getElementById('stat-lifedb').textContent  = s.lifedbVectors ?? '—';
        document.getElementById('stat-repos').textContent   = s.reposVectors  ?? '—';
        document.getElementById('stat-media').textContent   = s.mediaVectors  ?? '—';

        const max = Math.max(...Object.values(s.typeCounts || {}), 1);
        document.getElementById('bar-chart').innerHTML = Object.entries(s.typeCounts || {})
            .sort((a,b) => b[1]-a[1])
            .map(([type, count]) => `
                <div class="bar-row">
                    <span class="bar-label">${type}</span>
                    <div class="bar-track"><div class="bar-fill" style="width:${(count/max)*100}%"></div></div>
                    <span class="bar-count">${count}</span>
                </div>`).join('');

        const recRes  = await fetch(`${config.apiUrl}/api/memories?limit=5`);
        const recData = await recRes.json();
        document.getElementById('recent-list').innerHTML = (recData.results||[]).map(m => `
            <div class="result-card">
                <div class="result-meta"><span class="result-type ${m.type||'note'}">${m.type||'note'}</span></div>
                <div class="result-content">${escHtml(m.content||'')}</div>
                <div class="result-timestamp">${new Date(m.timestamp).toLocaleString()}</div>
            </div>`).join('') || '<div class="empty-state" style="padding:20px">no memories yet</div>';
    } catch { document.getElementById('stat-total').textContent = 'err'; }
}

// ══════════════════════════════════════════════════════════════════════════════
// GRAPH
// ══════════════════════════════════════════════════════════════════════════════
async function loadGraph() {
    try {
        const res  = await fetch(`${config.apiUrl}/api/graph`);
        const data = await res.json();
        document.getElementById('g-nodes').textContent = data.nodes?.length || 0;
        document.getElementById('g-edges').textContent = data.edges?.length || 0;
        if (!data.nodes?.length) { document.getElementById('graph-empty').style.display = 'flex'; return; }
        document.getElementById('graph-empty').style.display = 'none';
        renderGraph(data);
    } catch {}
}

function renderGraph(data) {
    const canvas  = document.getElementById('graph-canvas');
    const tooltip = document.getElementById('graph-tooltip');
    const W = canvas.clientWidth, H = canvas.clientHeight;

    d3.select('#graph-canvas svg').remove();
    const svg = d3.select('#graph-canvas').append('svg').attr('width', W).attr('height', H);
    const g   = svg.append('g');
    svg.call(d3.zoom().scaleExtent([0.3, 3]).on('zoom', e => g.attr('transform', e.transform)));

    const colorMap = { 'second-brain': '#ce93d8', 'lifedb': '#4fc3f7', 'repos': '#80cbc4', 'media': '#ffb74d' };

    const link = g.append('g').selectAll('line').data(data.edges).join('line')
        .attr('stroke', '#2a2a2a')
        .attr('stroke-width', d => Math.min(1 + (d.weight||1) * 0.5, 4))
        .attr('stroke-opacity', 0.7);

    const node = g.append('g').selectAll('circle').data(data.nodes).join('circle')
        .attr('r', d => Math.min(5 + (d.hits||1) * 1.5, 16))
        .attr('fill', d => colorMap[d.collection] || '#555')
        .attr('fill-opacity', 0.85)
        .attr('stroke', '#0c0c0c').attr('stroke-width', 1.5)
        .style('cursor', 'pointer')
        .on('mousemove', (e, d) => {
            const rect = canvas.getBoundingClientRect();
            tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
            tooltip.style.top  = (e.clientY - rect.top  - 10) + 'px';
            tooltip.style.opacity = 1;
            tooltip.querySelector('.tt-name').textContent = d.label || d.id;
            tooltip.querySelector('.tt-meta').textContent = `${d.collection} · ${d.hits||1} hit${d.hits!==1?'s':''}`;
        })
        .on('mouseleave', () => { tooltip.style.opacity = 0; })
        .call(d3.drag()
            .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y; })
            .on('drag',  (e, d) => { d.fx=e.x; d.fy=e.y; })
            .on('end',   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx=null; d.fy=null; })
        );

    g.append('g').selectAll('text').data(data.nodes.filter(n => (n.hits||1) >= 3)).join('text')
        .text(d => (d.label||d.id).slice(0, 20))
        .attr('font-size', '9px').attr('font-family', "'IBM Plex Mono', monospace")
        .attr('fill', '#666').attr('dy', '0.35em').attr('x', 10);

    const nodeById = new Map(data.nodes.map(n => [n.id, n]));
    const simLinks = data.edges.map(e => ({ source: nodeById.get(e.source)||e.source, target: nodeById.get(e.target)||e.target, weight: e.weight||1 }));

    const sim = d3.forceSimulation(data.nodes)
        .force('link',    d3.forceLink(simLinks).id(d=>d.id).distance(80))
        .force('charge',  d3.forceManyBody().strength(-120))
        .force('center',  d3.forceCenter(W/2, H/2))
        .force('collide', d3.forceCollide(20))
        .on('tick', () => {
            link.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y).attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
            node.attr('cx',d=>d.x).attr('cy',d=>d.y);
            g.selectAll('text').attr('x',d=>d.x+10).attr('y',d=>d.y);
        });
}

function clearGraphData() {
    if (!confirm('Reset graph data?')) return;
    fetch(`${config.apiUrl}/api/graph`, { method: 'DELETE' }).catch(() => {});
    showToast('graph reset', 'success');
    loadGraph();
}

// ══════════════════════════════════════════════════════════════════════════════
// HEALTH
// ══════════════════════════════════════════════════════════════════════════════
async function checkHealth() {
    const dot = document.getElementById('status-dot');
    try {
        const res  = await fetch(`${config.apiUrl}/api/health`);
        const data = await res.json();
        dot.className = 'online';
        setBadge('cfg-api-status',      'online',                  'ok');
        setBadge('cfg-weaviate-status',  data.weaviate  ? 'ok':'offline', data.weaviate  ?'ok':'err');
        setBadge('cfg-lifedb-status',   data.lifedb    ? 'ok':'offline', data.lifedb    ?'ok':'err');
        setBadge('cfg-repos-status',    data.repos     ? 'ok':'offline', data.repos     ?'ok':'err');
        setBadge('cfg-media-status',    data.media     ? 'ok':'offline', data.media     ?'ok':'err');
        setBadge('cfg-openai-status',   data.openai    ? 'ok':'missing', data.openai    ?'ok':'err');
        setBadge('cfg-anthropic-status',data.anthropic ? 'ok':'missing', data.anthropic ?'ok':'err');
    } catch {
        dot.className = 'error';
        setBadge('cfg-api-status', 'offline', 'err');
    }
}

function setBadge(id, text, cls) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className   = `status-badge ${cls}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════════════════
function saveConfig() {
    config.apiUrl = document.getElementById('cfg-api-url').value.trim();
    localStorage.setItem('sb_config', JSON.stringify(config));
    showToast('config saved ✓', 'success');
    checkHealth();
}

function exportData() {
    const blob = new Blob([JSON.stringify(memories, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `second-brain-${Date.now()}.json`;
    a.click();
}

function clearData() {
    if (!confirm('Delete ALL local memories?')) return;
    memories = [];
    localStorage.removeItem('sb_memories');
    localStorage.removeItem('sb_chatcount');
    chatCount = 0;
    showToast('local data cleared', 'success');
}

// ══════════════════════════════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════════════════════════════
let toastTimer;
function showToast(msg, type = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.className = '', 2800);
}