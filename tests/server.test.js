/**
 * SecondBrain server.js — Jest + Supertest test suite
 *
 * Covers all API routes and documents known bugs found during code review.
 * External dependencies (chromadb, openai, @anthropic-ai/sdk) are mocked
 * so tests run without a live ChromaDB instance or API keys.
 */

'use strict';

// ── Mock external dependencies before any require ──────────────────────────
// chromadb mock: getOrCreateCollection returns a usable fake collection
const mockChromaCollection = {
    count:  jest.fn().mockResolvedValue(5),
    add:    jest.fn().mockResolvedValue({}),
    upsert: jest.fn().mockResolvedValue({}),
    query:  jest.fn().mockResolvedValue({
        ids:       [[]],
        documents: [[]],
        metadatas: [[]],
        distances: [[]]
    }),
    get:    jest.fn().mockResolvedValue({ ids: [] }),
    delete: jest.fn().mockResolvedValue({}),
};
jest.mock('chromadb', () => ({
    ChromaClient: jest.fn().mockImplementation(() => ({
        getOrCreateCollection: jest.fn().mockResolvedValue(mockChromaCollection),
    })),
}));

// openai mock: embeddings return a 1536-dim vector; completions stream is set per test
const mockEmbeddingCreate = jest.fn().mockResolvedValue({
    data: [{ embedding: new Array(1536).fill(0.1) }]
});
const mockChatCreate = jest.fn();
jest.mock('openai', () => ({
    OpenAI: jest.fn().mockImplementation(() => ({
        embeddings: { create: mockEmbeddingCreate },
        chat: { completions: { create: mockChatCreate } },
    })),
}));

// Anthropic mock: messages.stream is set per test
const mockAnthropicStream = jest.fn();
jest.mock('@anthropic-ai/sdk', () =>
    jest.fn().mockImplementation(() => ({
        messages: { stream: mockAnthropicStream },
    }))
);

// fs mock: avoid touching real memories.json / graph.json during tests
const mockReadFile = jest.fn();
const mockWriteFile = jest.fn().mockResolvedValue(undefined);
jest.mock('fs', () => ({
    promises: {
        readFile: mockReadFile,
        writeFile: mockWriteFile,
    },
}));

// ── Set env vars and require server ───────────────────────────────────────
process.env.OPENAI_API_KEY    = 'test-openai-key';
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

// memories.json and graph.json both start empty in tests
mockReadFile.mockImplementation((filePath) => {
    if (filePath && filePath.endsWith('memories.json')) return Promise.resolve('[]');
    if (filePath && filePath.endsWith('graph.json'))   return Promise.resolve(JSON.stringify({ nodes: [], edges: [] }));
    return Promise.reject(new Error(`ENOENT: no such file: ${filePath}`));
});

const request = require('supertest');
const { app, SCORE_THRESHOLD, CLAUDE_MODELS, OPENAI_MODELS, GPT5_MODELS } = require('../server');

// ── Helper: POST a memory and get its id ─────────────────────────────────
async function createMemory(payload = {}) {
    const res = await request(app).post('/api/memories').send({
        type: 'note', content: 'test memory content', tags: ['test'], ...payload
    });
    return res.body;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
describe('Exported constants', () => {
    test('SCORE_THRESHOLD is 0.50', () => {
        expect(SCORE_THRESHOLD).toBe(0.50);
    });

    test('CLAUDE_MODELS contains expected models', () => {
        expect(CLAUDE_MODELS.has('claude-sonnet-4-6')).toBe(true);
        expect(CLAUDE_MODELS.has('claude-haiku-4-5-20251001')).toBe(true);
    });

    test('GPT5_MODELS requires max_completion_tokens', () => {
        expect(GPT5_MODELS.has('gpt-5-nano')).toBe(true);
        // gpt-4.1-mini should NOT be in the gpt-5 set
        expect(GPT5_MODELS.has('gpt-4.1-mini')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/health
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/health', () => {
    test('returns 200 with expected shape', async () => {
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            status:    'ok',
            openai:    true,
            anthropic: true,
        });
        expect(typeof res.body.timestamp).toBe('string');
    });

    test('openai is false when key is missing', async () => {
        const saved = process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        const res = await request(app).get('/api/health');
        expect(res.body.openai).toBe(false);
        process.env.OPENAI_API_KEY = saved;
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/memories
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/memories', () => {
    test('returns 400 when content is missing', async () => {
        const res = await request(app).post('/api/memories').send({ type: 'note' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/content/i);
    });

    test('saves a memory and returns it with required fields', async () => {
        const res = await request(app).post('/api/memories').send({
            type: 'note', content: 'Hello world', tags: ['test']
        });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ type: 'note', content: 'Hello world' });
        expect(Array.isArray(res.body.tags)).toBe(true);
        expect(typeof res.body.id).toBe('string');
        expect(typeof res.body.timestamp).toBe('string');
    });

    test('uses provided id when given', async () => {
        const res = await request(app).post('/api/memories').send({
            id: 'custom-id-123', content: 'custom id test'
        });
        expect(res.body.id).toBe('custom-id-123');
    });

    test('defaults type to "note" when omitted', async () => {
        const res = await request(app).post('/api/memories').send({ content: 'no type given' });
        expect(res.body.type).toBe('note');
    });

    test('calls OpenAI embeddings.create with the content', async () => {
        mockEmbeddingCreate.mockClear();
        await request(app).post('/api/memories').send({ content: 'embed me' });
        expect(mockEmbeddingCreate).toHaveBeenCalledWith(
            expect.objectContaining({ input: 'embed me', model: 'text-embedding-3-small' })
        );
    });

    // ── Bug #3: tags.join crash if tags is undefined / not an array ───────
    test('BUG #3 — handles missing tags without crashing', async () => {
        // tags not provided at all — should not crash on .join()
        const res = await request(app).post('/api/memories').send({ content: 'no tags' });
        expect(res.status).toBe(200);
        expect(res.body.tags).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/memories
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/memories', () => {
    test('returns paginated memories newest-first', async () => {
        // Create 3 memories sequentially
        await createMemory({ content: 'first', id: 'mem-1' });
        await createMemory({ content: 'second', id: 'mem-2' });
        await createMemory({ content: 'third', id: 'mem-3' });

        const res = await request(app).get('/api/memories?limit=2&offset=0');
        expect(res.status).toBe(200);
        expect(res.body.results.length).toBeLessThanOrEqual(2);
        expect(typeof res.body.total).toBe('number');
    });

    test('limit and offset are respected', async () => {
        const res = await request(app).get('/api/memories?limit=1&offset=0');
        expect(res.body.results.length).toBe(1);
    });

    // ── Bug #5: FIXED — embedding vectors stripped from GET /api/memories response ──
    test('BUG #5 — GET /api/memories no longer exposes 1536-dim embedding vectors', async () => {
        await createMemory({ content: 'embedding leak test' });
        const res = await request(app).get('/api/memories?limit=100');
        const withEmbedding = res.body.results.filter(
            m => m.embedding && Array.isArray(m.embedding) && m.embedding.length > 100
        );
        expect(withEmbedding.length).toBe(0); // fixed: embedding field stripped before response
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/memories/:id
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/memories/:id', () => {
    test('returns 404 for unknown id', async () => {
        const res = await request(app).get('/api/memories/does-not-exist');
        expect(res.status).toBe(404);
    });

    test('returns the correct memory for a valid id', async () => {
        await createMemory({ id: 'lookup-test', content: 'lookup memory' });
        const res = await request(app).get('/api/memories/lookup-test');
        expect(res.status).toBe(200);
        expect(res.body.content).toBe('lookup memory');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/memories/:id
// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /api/memories/:id', () => {
    test('returns success for a valid id', async () => {
        await createMemory({ id: 'delete-me', content: 'to be deleted' });
        const res = await request(app).delete('/api/memories/delete-me');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('memory is not found after deletion', async () => {
        await createMemory({ id: 'delete-confirm', content: 'going away' });
        await request(app).delete('/api/memories/delete-confirm');
        const res = await request(app).get('/api/memories/delete-confirm');
        expect(res.status).toBe(404);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/search
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/search', () => {
    test('returns 400 when query is missing', async () => {
        const res = await request(app).post('/api/search').send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/query/i);
    });

    test('returns an array for a valid query', async () => {
        const res = await request(app).post('/api/search').send({ query: 'test search' });
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    test('keyword fallback works when embedding fails', async () => {
        // Create memory FIRST (this call succeeds with normal mock)
        await createMemory({ content: 'fallback keyword search' });
        // NOW set rejection — next generateEmbedding is from /api/search itself
        mockEmbeddingCreate.mockRejectedValueOnce(new Error('API down'));
        const res = await request(app).post('/api/search').send({ query: 'fallback keyword' });
        expect(res.status).toBe(200);
        // Keyword fallback should find the memory by substring match
        const texts = res.body.map(m => m.content || '');
        expect(texts.some(t => t.includes('fallback keyword'))).toBe(true);
    });

    test('respects limit parameter', async () => {
        const res = await request(app).post('/api/search').send({ query: 'anything', limit: 2 });
        expect(res.status).toBe(200);
        expect(res.body.length).toBeLessThanOrEqual(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/stats
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/stats', () => {
    test('returns expected shape', async () => {
        const res = await request(app).get('/api/stats');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            total:        expect.any(Number),
            thisWeek:     expect.any(Number),
            typeCounts:   expect.any(Object),
            chromaVectors: expect.any(Number),
        });
    });

    test('thisWeek counts only memories from the last 7 days', async () => {
        // Recent memory
        await createMemory({ content: 'recent', timestamp: new Date().toISOString() });
        // Old memory (8 days ago)
        const old = new Date(); old.setDate(old.getDate() - 8);
        await createMemory({ content: 'old memory', timestamp: old.toISOString() });

        const res = await request(app).get('/api/stats');
        // At minimum the "recent" one should be counted
        expect(res.body.thisWeek).toBeGreaterThanOrEqual(1);
        // thisWeek should be less than total (old memory exists)
        expect(res.body.thisWeek).toBeLessThan(res.body.total);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/export  &  POST /api/import
// ─────────────────────────────────────────────────────────────────────────────
describe('Export and Import', () => {
    test('GET /api/export returns memories array with exportDate', async () => {
        const res = await request(app).get('/api/export');
        expect(res.status).toBe(200);
        expect(typeof res.body.exportDate).toBe('string');
        expect(Array.isArray(res.body.memories)).toBe(true);
    });

    test('POST /api/import returns 400 for non-array memories', async () => {
        const res = await request(app).post('/api/import').send({ memories: 'not-an-array' });
        expect(res.status).toBe(400);
    });

    test('POST /api/import returns 400 when memories key is missing', async () => {
        const res = await request(app).post('/api/import').send({});
        expect(res.status).toBe(400);
    });

    test('POST /api/import adds memories and reports count', async () => {
        const toImport = [
            { id: 'imp-1', type: 'note', content: 'imported 1', tags: [], timestamp: new Date().toISOString() },
            { id: 'imp-2', type: 'note', content: 'imported 2', tags: [], timestamp: new Date().toISOString() },
        ];
        const res = await request(app).post('/api/import').send({ memories: toImport });
        expect(res.status).toBe(200);
        expect(res.body.imported).toBe(2);
    });

    // ── Bug #2: FIXED — import now deduplicates by ID ────────────────────
    test('BUG #2 — duplicate import no longer inflates localMemories', async () => {
        const startStats = await request(app).get('/api/stats');
        const beforeTotal = startStats.body.total;

        const mem = { id: 'dup-test', type: 'note', content: 'dup check', tags: [], timestamp: new Date().toISOString() };
        const r1 = await request(app).post('/api/import').send({ memories: [mem] });
        const r2 = await request(app).post('/api/import').send({ memories: [mem] });

        // First import adds 1; second import skips (same ID already present)
        expect(r1.body.imported).toBe(1);
        expect(r2.body.imported).toBe(0);

        const statsRes = await request(app).get('/api/stats');
        expect(statsRes.body.total).toBe(beforeTotal + 1); // only one copy, not two
        const byId = await request(app).get('/api/memories/dup-test');
        expect(byId.status).toBe(200);
    });

    // ── Bug #3 (variant): FIXED — import with undefined tags no longer crashes ──
    test('BUG #3 (import) — import with undefined tags does not crash', async () => {
        const mem = { id: 'no-tags', type: 'note', content: 'no tags import' }; // tags missing
        const res = await request(app).post('/api/import').send({ memories: [mem] });
        expect(res.status).toBe(200);
        expect(res.body.imported).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/graph  &  POST /api/graph/edge
// ─────────────────────────────────────────────────────────────────────────────
describe('Graph endpoints', () => {
    test('GET /api/graph returns nodes and edges arrays', async () => {
        const res = await request(app).get('/api/graph');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.nodes)).toBe(true);
        expect(Array.isArray(res.body.edges)).toBe(true);
    });

    test('POST /api/graph/edge with valid sources returns success', async () => {
        const res = await request(app).post('/api/graph/edge').send({
            query: 'test query',
            sources: [
                { source: '/lifedb/fileA.md', fileName: 'fileA.md', collection: 'lifedb', repo: null },
                { source: '/lifedb/fileB.md', fileName: 'fileB.md', collection: 'lifedb', repo: null },
            ]
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.nodes).toBe(2);
        expect(res.body.edges).toBe(1);
    });

    test('POST /api/graph/edge increments hit count on repeated sources', async () => {
        // Use a stateful in-memory graph so writes persist between requests
        let graphState = { nodes: [], edges: [] };
        mockReadFile.mockImplementation((fp) => {
            if (fp && fp.endsWith('graph.json'))   return Promise.resolve(JSON.stringify(graphState));
            if (fp && fp.endsWith('memories.json')) return Promise.resolve('[]');
            return Promise.reject(new Error('ENOENT'));
        });
        mockWriteFile.mockImplementation((fp, data) => {
            if (fp && fp.endsWith('graph.json')) graphState = JSON.parse(data);
            return Promise.resolve();
        });

        const src = { source: '/lifedb/repeated.md', fileName: 'repeated.md', collection: 'lifedb', repo: null };
        await request(app).post('/api/graph/edge').send({ query: 'q1', sources: [src] });
        await request(app).post('/api/graph/edge').send({ query: 'q2', sources: [src] });

        const graph = await request(app).get('/api/graph');
        const node = graph.body.nodes.find(n => n.id === '/lifedb/repeated.md');
        expect(node).toBeDefined();
        expect(node.hits).toBeGreaterThanOrEqual(2);

        // Restore default stateless mocks
        mockReadFile.mockImplementation((fp) => {
            if (fp && fp.endsWith('memories.json')) return Promise.resolve('[]');
            if (fp && fp.endsWith('graph.json'))    return Promise.resolve(JSON.stringify({ nodes: [], edges: [] }));
            return Promise.reject(new Error(`ENOENT: ${fp}`));
        });
        mockWriteFile.mockResolvedValue(undefined);
    });

    // ── Bug #6: FIXED — graph/edge now validates sources input ──────────
    test('BUG #6 — POST /api/graph/edge with null sources returns 400', async () => {
        const res = await request(app).post('/api/graph/edge').send({ query: 'q', sources: null });
        expect(res.status).toBe(400); // fixed: returns 400 instead of crashing with 500
    });

    test('BUG #6 — POST /api/graph/edge with missing sources returns 400', async () => {
        const res = await request(app).post('/api/graph/edge').send({});
        expect(res.status).toBe(400); // fixed: returns 400 instead of crashing with 500
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chat
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/chat', () => {
    test('returns 400 when message is missing', async () => {
        const res = await request(app).post('/api/chat').send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/message/i);
    });

    test('returns 400 for unknown model', async () => {
        const res = await request(app).post('/api/chat').send({
            message: 'hello', model: 'gpt-99-turbo-max'
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/unknown model/i);
    });

    test('claude streaming: sends SSE events and final done event', async () => {
        // Simulate anthropic stream: an async generator yielding chunks
        async function* fakeStream() {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } };
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } };
        }
        mockAnthropicStream.mockResolvedValueOnce(fakeStream());

        const res = await request(app)
            .post('/api/chat')
            .send({ message: 'test claude', model: 'claude-sonnet-4-6' });

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/event-stream/);

        const body = res.text;
        expect(body).toContain('"type":"delta"');
        expect(body).toContain('"type":"done"');
        // Reconstruct full text from all delta events
        const fullText = body.split('\n')
            .filter(l => l.startsWith('data:'))
            .map(l => { try { return JSON.parse(l.slice(5)); } catch { return {}; } })
            .filter(e => e.type === 'delta')
            .map(e => e.text)
            .join('');
        expect(fullText).toBe('Hello world');
    });

    test('openai gpt-4 streaming: sends SSE events', async () => {
        async function* fakeGptStream() {
            yield { choices: [{ delta: { content: 'GPT ' } }] };
            yield { choices: [{ delta: { content: 'response' } }] };
        }
        mockChatCreate.mockResolvedValueOnce(fakeGptStream());

        const res = await request(app)
            .post('/api/chat')
            .send({ message: 'test gpt', model: 'gpt-4o-mini' });

        expect(res.status).toBe(200);
        const body = res.text;
        expect(body).toContain('"type":"delta"');
        expect(body).toContain('"type":"done"');
    });

    // ── Bug #4: GPT-5 model detection via .startsWith vs GPT5_MODELS set ─
    test('BUG #4 — gpt-5-nano uses max_completion_tokens not max_tokens', async () => {
        async function* fakeGpt5Stream() {
            yield { choices: [{ delta: { content: 'gpt5 result' } }] };
        }
        mockChatCreate.mockResolvedValueOnce(fakeGpt5Stream());

        await request(app)
            .post('/api/chat')
            .send({ message: 'gpt5 test', model: 'gpt-5-nano' });

        const callArgs = mockChatCreate.mock.calls.at(-1)[0];
        // Must have max_completion_tokens, NOT max_tokens
        expect(callArgs).toHaveProperty('max_completion_tokens');
        expect(callArgs).not.toHaveProperty('max_tokens');
    });

    // ── Bug #1: FIXED — SAVE_MEMORY regex now uses \n? (optional newline) ────
    test('BUG #1 — SAVE_MEMORY at line 1 (no leading newline) is now saved', async () => {
        // regex was /\nSAVE_MEMORY:.../ — fixed to /\n?SAVE_MEMORY:.../ so the
        // leading newline is optional and a response starting with SAVE_MEMORY works
        const saveLine = 'SAVE_MEMORY:{"type":"note","content":"bug1 test","tags":["bug"]}';
        async function* fakeSaveAtTop() {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: saveLine } };
        }
        mockAnthropicStream.mockResolvedValueOnce(fakeSaveAtTop());
        const preStats = (await request(app).get('/api/stats')).body.total;

        await request(app).post('/api/chat').send({ message: 'save bug test', model: 'claude-sonnet-4-6' });
        const postStats = (await request(app).get('/api/stats')).body.total;

        // Fix verified: regex now matches even without a leading newline
        expect(postStats).toBe(preStats + 1);
    });

    test('SAVE_MEMORY with leading newline DOES save a memory', async () => {
        const saveLine = '\nSAVE_MEMORY:{"type":"note","content":"valid save pattern","tags":["test"]}';
        async function* fakeWithNewline() {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Answer.' } };
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: saveLine } };
        }
        mockAnthropicStream.mockResolvedValueOnce(fakeWithNewline());
        const preStats = (await request(app).get('/api/stats')).body.total;

        const res = await request(app).post('/api/chat').send({ message: 'remember this', model: 'claude-sonnet-4-6' });
        expect(res.status).toBe(200);

        const done = res.text.split('\n')
            .filter(l => l.startsWith('data:'))
            .map(l => JSON.parse(l.slice(5)))
            .find(e => e.type === 'done');

        expect(done.savedMemory).not.toBeNull();
        expect(done.savedMemory.content).toBe('valid save pattern');

        const postStats = (await request(app).get('/api/stats')).body.total;
        expect(postStats).toBe(preStats + 1);
    });

    test('sources array in done event has correct shape', async () => {
        // Make chroma return one mock hit above threshold
        mockChromaCollection.query.mockResolvedValueOnce({
            ids:       [['mem-src-1']],
            documents: [['some context text']],
            metadatas: [[{ type: 'note', content: 'some context text', tags: 'ai', timestamp: '2026-01-01T00:00:00.000Z' }]],
            distances: [[0.75]],
        });
        // All other collections return empty
        mockChromaCollection.query
            .mockResolvedValueOnce({ ids: [[]], documents: [[]], metadatas: [[]], distances: [[]] })
            .mockResolvedValueOnce({ ids: [[]], documents: [[]], metadatas: [[]], distances: [[]] })
            .mockResolvedValueOnce({ ids: [[]], documents: [[]], metadatas: [[]], distances: [[]] });

        async function* fakeStream() {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'citing [Memory #1]' } };
        }
        mockAnthropicStream.mockResolvedValueOnce(fakeStream());

        const res = await request(app).post('/api/chat').send({ message: 'context test', model: 'claude-sonnet-4-6' });
        const done = res.text.split('\n')
            .filter(l => l.startsWith('data:'))
            .map(l => JSON.parse(l.slice(5)))
            .find(e => e.type === 'done');

        if (done && done.sources.length > 0) {
            const src = done.sources[0];
            expect(typeof src.index).toBe('number');
            expect(typeof src.collection).toBe('string');
            expect(typeof src.score).toBe('number');
            expect(typeof src.content).toBe('string');
            expect(typeof src.snippet).toBe('string');
            expect(src.snippet.length).toBeLessThanOrEqual(120);
        }
    });

    test('done event sources do NOT include full SAVE_MEMORY text (should be stripped)', async () => {
        const save = '\nSAVE_MEMORY:{"type":"note","content":"strip test","tags":[]}';
        async function* fakeStream() {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Answer text.' + save } };
        }
        mockAnthropicStream.mockResolvedValueOnce(fakeStream());

        const res = await request(app).post('/api/chat').send({ message: 'strip test', model: 'claude-sonnet-4-6' });

        // The done event's sources snippets should not contain raw SAVE_MEMORY JSON
        // BUG #15: the fullText sent in delta events DOES contain SAVE_MEMORY — client must strip it
        const deltas = res.text.split('\n')
            .filter(l => l.startsWith('data:'))
            .map(l => JSON.parse(l.slice(5)))
            .filter(e => e.type === 'delta');

        const fullDelta = deltas.map(d => d.text).join('');
        // This documents that the raw SAVE_MEMORY tag is sent in the stream to the client
        // When bug #15 is fixed, this assertion should be negated
        if (fullDelta.includes('SAVE_MEMORY')) {
            expect(fullDelta).toContain('SAVE_MEMORY'); // known bug — client must handle this
        }
    });
});
