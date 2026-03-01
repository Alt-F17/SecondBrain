const express  = require('express');
const cors     = require('cors');
const { OpenAI } = require('openai');
const { ChromaClient } = require('chromadb');
const Anthropic = require('@anthropic-ai/sdk');
const dotenv   = require('dotenv');
const fs       = require('fs').promises;
const path     = require('path');

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── AI clients ────────────────────────────────────────────────────────────────
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CLAUDE_MODELS = new Set(['claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
const OPENAI_MODELS = new Set(['gpt-5-nano', 'gpt-4.1-mini', 'gpt-4o-mini']);
const GPT5_MODELS   = new Set(['gpt-5-nano']); // needs max_completion_tokens not max_tokens

// ── ChromaDB collections ──────────────────────────────────────────────────────
let chromaClient;
let chromaCollection;  // second-brain (memories)
let lifedbCollection;  // lifedb       (synced files)
let reposCollection;   // repos        (github repos)
let mediaCollection;   // media        (photos, audio, video)

const SCORE_THRESHOLD = 0.50;

const initChroma = async () => {
    try {
        chromaClient = new ChromaClient({ path: process.env.CHROMA_URL || 'http://localhost:8000' });

        chromaCollection = await chromaClient.getOrCreateCollection({
            name: 'second-brain',
            metadata: { 'hnsw:space': 'ip' }
        });
        console.log(`✅ Memories  : ${await chromaCollection.count()} vectors`);

        for (const [name, setter] of [
            ['lifedb', v => lifedbCollection = v],
            ['repos',  v => reposCollection  = v],
            ['media',  v => mediaCollection  = v],
        ]) {
            try {
                const col = await chromaClient.getOrCreateCollection({ name, metadata: { 'hnsw:space': 'ip' } });
                setter(col);
                console.log(`✅ ${name.padEnd(8)}: ${await col.count()} vectors`);
            } catch { console.log(`📝 ${name} collection not available yet`); }
        }

    } catch (err) {
        console.error('❌ Chroma init failed:', err.message);
    }
};

// ── Local storage ─────────────────────────────────────────────────────────────
const STORAGE_FILE = path.join(__dirname, 'memories.json');
let localMemories = [];

const loadLocalMemories = async () => {
    try {
        localMemories = JSON.parse(await fs.readFile(STORAGE_FILE, 'utf-8'));
        console.log(`📚 Loaded ${localMemories.length} local memories`);
    } catch { localMemories = []; }
};

const saveLocalMemories = async () => {
    try { await fs.writeFile(STORAGE_FILE, JSON.stringify(localMemories, null, 2)); } catch {}
};

// ── Embedding ─────────────────────────────────────────────────────────────────
async function generateEmbedding(text) {
    try {
        const r = await openai.embeddings.create({ model: 'text-embedding-3-small', input: text });
        return r.data[0].embedding;
    } catch (e) { console.error('Embedding failed:', e.message); return null; }
}

// ── Parallel search ───────────────────────────────────────────────────────────
async function searchAllCollections(queryEmbedding, limit) {
    const n = Math.max(5, Math.ceil(limit * 0.6));

    const query = (col) => col ? col.query({
        queryEmbeddings: [queryEmbedding],
        nResults: n,
        include: ['metadatas', 'documents', 'distances']
    }).catch(() => null) : Promise.resolve(null);

    const [memRaw, lifeRaw, reposRaw, mediaRaw] = await Promise.all([
        query(chromaCollection),
        query(lifedbCollection),
        query(reposCollection),
        query(mediaCollection),
    ]);

    const hits = [];

    const push = (raw, mapper) => {
        if (!raw?.ids?.[0]) return;
        raw.ids[0].forEach((id, i) => {
            const score = raw.distances[0][i];
            if (score >= SCORE_THRESHOLD) hits.push(mapper(id, i, score, raw));
        });
    };

    push(memRaw, (id, i, score, r) => ({
        id, score, source: 'memory', collection: 'second-brain',
        type: r.metadatas[0][i]?.type || 'note',
        content: r.metadatas[0][i]?.content || r.documents[0][i],
        tags: r.metadatas[0][i]?.tags ? r.metadatas[0][i].tags.split(',').filter(Boolean) : [],
        timestamp: r.metadatas[0][i]?.timestamp || null,
    }));

    push(lifeRaw, (id, i, score, r) => ({
        id, score, collection: 'lifedb',
        type: r.metadatas[0][i]?.file_type || 'file',
        content: r.documents[0][i],
        tags: [], timestamp: r.metadatas[0][i]?.modified || null,
        source: r.metadatas[0][i]?.source_path || 'unknown',
        fileName: r.metadatas[0][i]?.file_name || null,
    }));

    push(reposRaw, (id, i, score, r) => ({
        id, score, collection: 'repos',
        type: r.metadatas[0][i]?.file_type || 'code',
        content: r.documents[0][i],
        tags: [r.metadatas[0][i]?.repo || ''].filter(Boolean),
        timestamp: null,
        source: r.metadatas[0][i]?.source_path || 'unknown',
        fileName: r.metadatas[0][i]?.file_name || null,
        repo: r.metadatas[0][i]?.repo || null,
    }));

    push(mediaRaw, (id, i, score, r) => ({
        id, score, collection: 'media',
        type: r.metadatas[0][i]?.file_type || 'image',
        content: r.documents[0][i],
        tags: [], timestamp: r.metadatas[0][i]?.modified || null,
        source: r.metadatas[0][i]?.source_path || 'unknown',
        fileName: r.metadatas[0][i]?.file_name || null,
        thumbPath: r.metadatas[0][i]?.thumb_path || null,
    }));

    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health
app.get('/api/health', async (req, res) => {
    const ping = async (col) => { try { await col?.count(); return !!col; } catch { return false; } };
    res.json({
        status: 'ok',
        chroma: await ping(chromaCollection),
        lifedb: await ping(lifedbCollection),
        repos:  await ping(reposCollection),
        media:  await ping(mediaCollection),
        openai: !!process.env.OPENAI_API_KEY,
        anthropic: !!process.env.ANTHROPIC_API_KEY,
        timestamp: new Date().toISOString()
    });
});

// Whisper key — read from .env, never hardcoded in frontend
app.get('/api/config/whisper-key', (req, res) => {
    res.json({ key: process.env.OPENAI_API_KEY || '' });
});

// Save memory
app.post('/api/memories', async (req, res) => {
    try {
        const { id, type, content, tags, timestamp } = req.body;
        if (!content) return res.status(400).json({ error: 'Content is required' });

        const embedding = await generateEmbedding(content);
        const memory = {
            id: id || Date.now().toString(),
            type: type || 'note', content,
            tags: tags || [],
            timestamp: timestamp || new Date().toISOString(),
            embedding
        };

        if (chromaCollection && embedding) {
            try {
                await chromaCollection.add({
                    ids: [memory.id], embeddings: [embedding],
                    metadatas: [{ type: memory.type, content, tags: memory.tags.join(','), timestamp: memory.timestamp }],
                    documents: [content]
                });
                console.log(`✅ Saved to Chroma: ${memory.id}`);
            } catch (e) { console.error('Chroma save failed:', e.message); }
        }

        localMemories.push(memory);
        await saveLocalMemories();
        res.json(memory);
    } catch (e) { res.status(500).json({ error: 'Failed to save memory' }); }
});

// Search
app.post('/api/search', async (req, res) => {
    try {
        const { query, limit = 10 } = req.body;
        if (!query) return res.status(400).json({ error: 'Query required' });

        const emb = await generateEmbedding(query);
        if (emb) {
            const results = await searchAllCollections(emb, limit);
            console.log(`🔍 Semantic: ${results.length} results`);
            return res.json(results);
        }

        // Keyword fallback
        const q = query.toLowerCase();
        res.json(localMemories.filter(m =>
            m.content?.toLowerCase().includes(q) || m.tags?.some(t => t.toLowerCase().includes(q))
        ).slice(0, limit));
    } catch (e) { res.status(500).json({ error: 'Search failed' }); }
});

// Get memories
app.get('/api/memories', async (req, res) => {
    try {
        const { limit = 100, offset = 0 } = req.query;
        const results = [...localMemories]
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(Number(offset), Number(offset) + parseInt(limit));
        res.json({ total: localMemories.length, results });
    } catch (e) { res.status(500).json({ error: 'Failed to retrieve memories' }); }
});

// Get memory by ID
app.get('/api/memories/:id', async (req, res) => {
    const memory = localMemories.find(m => m.id === req.params.id);
    if (!memory) return res.status(404).json({ error: 'Not found' });
    res.json(memory);
});

// Delete memory
app.delete('/api/memories/:id', async (req, res) => {
    try {
        localMemories = localMemories.filter(m => m.id !== req.params.id);
        await saveLocalMemories();
        try { await chromaCollection?.delete({ ids: [req.params.id] }); } catch {}
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed to delete' }); }
});

// Stats
app.get('/api/stats', async (req, res) => {
    try {
        const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
        const typeCounts = {};
        localMemories.forEach(m => { typeCounts[m.type] = (typeCounts[m.type] || 0) + 1; });

        const count = async (col) => { try { return await col?.count() || 0; } catch { return 0; } };

        res.json({
            total: localMemories.length,
            thisWeek: localMemories.filter(m => new Date(m.timestamp) > weekAgo).length,
            typeCounts,
            chromaVectors: await count(chromaCollection),
            lifedbVectors: await count(lifedbCollection),
            reposVectors:  await count(reposCollection),
            mediaVectors:  await count(mediaCollection),
        });
    } catch (e) { res.status(500).json({ error: 'Stats failed' }); }
});

// Export / Import
app.get('/api/export', (req, res) => res.json({ exportDate: new Date().toISOString(), memories: localMemories }));

app.post('/api/import', async (req, res) => {
    try {
        const { memories } = req.body;
        if (!Array.isArray(memories)) return res.status(400).json({ error: 'Invalid format' });
        let chromaImported = 0;
        for (const m of memories) {
            if (!m.embedding) m.embedding = await generateEmbedding(m.content);
            if (chromaCollection && m.embedding) {
                try {
                    await chromaCollection.add({ ids: [m.id], embeddings: [m.embedding], metadatas: [{ type: m.type, content: m.content, tags: m.tags.join(','), timestamp: m.timestamp }], documents: [m.content] });
                    chromaImported++;
                } catch {}
            }
        }
        localMemories.push(...memories);
        await saveLocalMemories();
        res.json({ success: true, imported: memories.length, chromaImported });
    } catch (e) { res.status(500).json({ error: 'Import failed' }); }
});

// ── Chat — RAG with model selector ───────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
    try {
        const { message, history = [], model = 'claude-sonnet-4-6' } = req.body;
        if (!message) return res.status(400).json({ error: 'Message required' });

        const useClaude = CLAUDE_MODELS.has(model);
        const useOpenAI = OPENAI_MODELS.has(model);
        if (!useClaude && !useOpenAI) return res.status(400).json({ error: `Unknown model: ${model}` });

        // Retrieve context
        let context = [];
        const emb = await generateEmbedding(message);
        if (emb) context = await searchAllCollections(emb, 8);

        const contextBlock = context.length
            ? context.map((h, i) => `${h.collection === 'second-brain' ? `[Memory #${i+1}]` : `[File #${i+1}: ${h.source}]`}\n${h.content}`).join('\n\n---\n\n')
            : 'No relevant context found in your Second Brain.';

        const systemPrompt = `You are Felix's Second Brain — a personal AI with access to his memories, files, and code repos.

Rules:
1. Ground answers in the provided context, cite with [Memory #N] or [File #N: path]
2. Be direct and concise — Felix is a developer
3. Never hallucinate — say so if context doesn't contain the answer
4. Show actual code from context when relevant

MEMORY CREATION:
- If Felix says "remember", "save this", "note that", or shares new personal info not in context → save a memory
- Append this JSON at the END of your response on its own line:
  SAVE_MEMORY:{"type":"note","content":"<concise summary>","tags":["tag1","tag2"]}
- Only save genuinely new, useful info. Keep content to 1-3 sentences.

Context:
${contextBlock}`;

        const messages = [
            ...history.slice(-10).map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: message }
        ];

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        let fullText = '';

        if (useClaude) {
            const stream = await anthropic.messages.stream({ model, max_tokens: 2048, system: systemPrompt, messages });
            for await (const chunk of stream) {
                if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
                    fullText += chunk.delta.text;
                    res.write(`data: ${JSON.stringify({ type: 'delta', text: chunk.delta.text })}\n\n`);
                }
            }
        } else {
            // gpt-5 family uses max_completion_tokens; gpt-4 family uses max_tokens
            const isGpt5 = model.startsWith('gpt-5');
            const streamParams = {
                model,
                stream: true,
                messages: [{ role: 'system', content: systemPrompt }, ...messages],
                ...(isGpt5
                    ? { max_completion_tokens: 2048 }
                    : { max_tokens: 2048 }
                )
            };
            const stream = await openai.chat.completions.create(streamParams);
            for await (const chunk of stream) {
                const text = chunk.choices[0]?.delta?.content || '';
                if (text) { fullText += text; res.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`); }
            }
        }

        // Extract and save SAVE_MEMORY command if present
        let savedMemory = null;
        const memMatch = fullText.match(/\nSAVE_MEMORY:(\{[^\n]+\})/);
        if (memMatch) {
            try {
                const memData = JSON.parse(memMatch[1]);
                if (memData.content) {
                    const memory = { id: Date.now().toString(), type: memData.type || 'note', content: memData.content, tags: memData.tags || [], timestamp: new Date().toISOString() };
                    const memEmb = await generateEmbedding(memory.content);
                    if (chromaCollection && memEmb) {
                        await chromaCollection.add({ ids: [memory.id], embeddings: [memEmb], metadatas: [{ type: memory.type, content: memory.content, tags: memory.tags.join(','), timestamp: memory.timestamp }], documents: [memory.content] });
                    }
                    localMemories.push({ ...memory, embedding: memEmb });
                    await saveLocalMemories();
                    savedMemory = { type: memory.type, content: memory.content, tags: memory.tags };
                    console.log(`🧠 Memory saved from chat: "${memory.content.slice(0, 60)}"`);
                }
            } catch (e) { console.error('Memory parse failed:', e.message); }
        }

        res.write(`data: ${JSON.stringify({
            type: 'done',
            query: message,
            sources: context.map((h, i) => ({
                index:      i + 1,
                source:     h.source,
                collection: h.collection,
                score:      h.score,
                fileName:   h.fileName   || null,
                repo:       h.repo       || null,
                thumbPath:  h.thumbPath  || null,
                content:    h.content    || '',          // full chunk for modal
                snippet:    (h.content || '').slice(0, 120).replace(/\n/g, ' ') // preview
            })),
            savedMemory
        })}\n\n`);
        res.end();
        console.log(`💬 [${model}] "${message.slice(0, 50)}" → ${context.length} chunks`);

    } catch (e) {
        console.error('Chat error:', e);
        if (!res.headersSent) res.status(500).json({ error: 'Chat failed', details: e.message });
        else { res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`); res.end(); }
    }
});

// ── Graph ─────────────────────────────────────────────────────────────────────
const GRAPH_FILE = path.join(__dirname, 'graph.json');

app.get('/api/graph', async (req, res) => {
    try {
        let data = { nodes: [], edges: [] };
        try { data = JSON.parse(await fs.readFile(GRAPH_FILE, 'utf-8')); } catch {}
        res.json(data);
    } catch { res.status(500).json({ error: 'Failed to load graph' }); }
});

app.post('/api/graph/edge', async (req, res) => {
    try {
        const { sources, query } = req.body;
        let data = { nodes: [], edges: [] };
        try { data = JSON.parse(await fs.readFile(GRAPH_FILE, 'utf-8')); } catch {}

        const nodeIds = new Set(data.nodes.map(n => n.id));
        sources.forEach(s => {
            if (!nodeIds.has(s.source)) {
                data.nodes.push({ id: s.source, label: s.fileName || s.source.split('/').pop(), collection: s.collection, repo: s.repo || null, hits: 1 });
                nodeIds.add(s.source);
            } else {
                const n = data.nodes.find(n => n.id === s.source);
                if (n) n.hits = (n.hits || 1) + 1;
            }
        });

        for (let i = 0; i < sources.length; i++) {
            for (let j = i + 1; j < sources.length; j++) {
                const eid = [sources[i].source, sources[j].source].sort().join('||');
                const ex = data.edges.find(e => e.id === eid);
                if (ex) ex.weight = (ex.weight || 1) + 1;
                else data.edges.push({ id: eid, source: sources[i].source, target: sources[j].source, weight: 1, query: query?.slice(0, 80) || '' });
            }
        }

        await fs.writeFile(GRAPH_FILE, JSON.stringify(data, null, 2));
        res.json({ success: true, nodes: data.nodes.length, edges: data.edges.length });
    } catch { res.status(500).json({ error: 'Failed to save graph edge' }); }
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
    await loadLocalMemories();
    await initChroma();
    app.listen(PORT, () => {
        console.log(`\n🚀 Second Brain API  http://localhost:${PORT}`);
        console.log(`🔌 second-brain : ${chromaCollection ? 'ok' : 'unavailable'}`);
        console.log(`🧠 lifedb       : ${lifedbCollection ? 'ok' : 'unavailable'}`);
        console.log(`📦 repos        : ${reposCollection  ? 'ok' : 'unavailable'}`);
        console.log(`📸 media        : ${mediaCollection  ? 'ok' : 'unavailable'}`);
        console.log(`🤖 OpenAI       : ${process.env.OPENAI_API_KEY    ? 'ok' : 'MISSING'}`);
        console.log(`🧬 Anthropic    : ${process.env.ANTHROPIC_API_KEY ? 'ok' : 'MISSING'}`);
        console.log(`🎯 Threshold    : ${SCORE_THRESHOLD}\n`);
    });
}

start();
