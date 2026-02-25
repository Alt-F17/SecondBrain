const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const { ChromaClient } = require('chromadb');
const dotenv = require('dotenv');
const fs = require('fs').promises;
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Initialize Chroma (local vector database)
let chromaCollection;
const CHROMA_PATH = path.join(__dirname, 'chroma_data');

const initChroma = async () => {
    try {
        const client = new ChromaClient({ path: CHROMA_PATH });
        
        // Get or create collection
        chromaCollection = await client.getOrCreateCollection({
            name: 'second-brain',
            metadata: { description: 'Personal memory storage' }
        });
        
        const count = await chromaCollection.count();
        console.log(`✅ Chroma initialized (${count} vectors stored)`);
    } catch (error) {
        console.error('❌ Chroma initialization failed:', error.message);
        console.log('📝 Will use local JSON storage only');
    }
};

// Local storage fallback
const STORAGE_FILE = path.join(__dirname, 'memories.json');
let localMemories = [];

const loadLocalMemories = async () => {
    try {
        const data = await fs.readFile(STORAGE_FILE, 'utf-8');
        localMemories = JSON.parse(data);
        console.log(`📚 Loaded ${localMemories.length} memories from local storage`);
    } catch (error) {
        localMemories = [];
        console.log('📝 Starting with empty local storage');
    }
};

const saveLocalMemories = async () => {
    try {
        await fs.writeFile(STORAGE_FILE, JSON.stringify(localMemories, null, 2));
    } catch (error) {
        console.error('Failed to save local memories:', error);
    }
};

// Generate embedding
async function generateEmbedding(text) {
    try {
        const response = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: text
        });
        return response.data[0].embedding;
    } catch (error) {
        console.error('Embedding generation failed:', error.message);
        return null;
    }
}

// Routes

// Health check
app.get('/api/health', async (req, res) => {
    let chromaStatus = false;
    if (chromaCollection) {
        try {
            await chromaCollection.count();
            chromaStatus = true;
        } catch (e) {
            chromaStatus = false;
        }
    }
    
    res.json({
        status: 'ok',
        chroma: chromaStatus,
        openai: !!process.env.OPENAI_API_KEY,
        timestamp: new Date().toISOString()
    });
});

// Save memory
app.post('/api/memories', async (req, res) => {
    try {
        const { id, type, content, tags, timestamp } = req.body;

        if (!content) {
            return res.status(400).json({ error: 'Content is required' });
        }

        // Generate embedding
        const embedding = await generateEmbedding(content);

        const memory = {
            id: id || Date.now().toString(),
            type: type || 'note',
            content,
            tags: tags || [],
            timestamp: timestamp || new Date().toISOString(),
            embedding
        };

        // Save to Chroma if available
        if (chromaCollection && embedding) {
            try {
                await chromaCollection.add({
                    ids: [memory.id],
                    embeddings: [embedding],
                    metadatas: [{
                        type: memory.type,
                        content: memory.content,
                        tags: memory.tags.join(','),
                        timestamp: memory.timestamp
                    }],
                    documents: [memory.content]
                });
                console.log(`✅ Saved to Chroma: ${memory.id}`);
            } catch (error) {
                console.error('Chroma save failed:', error.message);
            }
        }

        // Always save locally as backup
        localMemories.push(memory);
        await saveLocalMemories();

        res.json(memory);
    } catch (error) {
        console.error('Save memory error:', error);
        res.status(500).json({ error: 'Failed to save memory' });
    }
});

// Search memories
app.post('/api/search', async (req, res) => {
    try {
        const { query, limit = 10 } = req.body;

        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }

        // Try Chroma semantic search first
        if (chromaCollection) {
            try {
                const queryEmbedding = await generateEmbedding(query);
                
                if (queryEmbedding) {
                    const searchResults = await chromaCollection.query({
                        queryEmbeddings: [queryEmbedding],
                        nResults: limit,
                        include: ['metadatas', 'documents', 'distances']
                    });

                    const results = searchResults.ids[0].map((id, i) => ({
                        id: id,
                        type: searchResults.metadatas[0][i].type,
                        content: searchResults.metadatas[0][i].content,
                        tags: searchResults.metadatas[0][i].tags ? 
                            searchResults.metadatas[0][i].tags.split(',').filter(t => t) : [],
                        timestamp: searchResults.metadatas[0][i].timestamp,
                        // Convert distance to similarity score
                        score: 1 / (1 + searchResults.distances[0][i])
                    }));

                    console.log(`🔍 Chroma search: ${results.length} results`);
                    return res.json(results);
                }
            } catch (error) {
                console.error('Chroma search failed:', error.message);
            }
        }

        // Fallback to local keyword search
        const lowerQuery = query.toLowerCase();
        const results = localMemories
            .filter(m => 
                m.content.toLowerCase().includes(lowerQuery) ||
                m.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
            )
            .slice(0, limit);

        console.log(`🔍 Local search: ${results.length} results`);
        res.json(results);
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Get all memories
app.get('/api/memories', async (req, res) => {
    try {
        const { limit = 100, offset = 0 } = req.query;
        const results = localMemories
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(offset, offset + parseInt(limit));
        
        res.json({
            total: localMemories.length,
            results
        });
    } catch (error) {
        console.error('Get memories error:', error);
        res.status(500).json({ error: 'Failed to retrieve memories' });
    }
});

// Get memory by ID
app.get('/api/memories/:id', async (req, res) => {
    try {
        const memory = localMemories.find(m => m.id === req.params.id);
        
        if (!memory) {
            return res.status(404).json({ error: 'Memory not found' });
        }
        
        res.json(memory);
    } catch (error) {
        console.error('Get memory error:', error);
        res.status(500).json({ error: 'Failed to retrieve memory' });
    }
});

// Delete memory
app.delete('/api/memories/:id', async (req, res) => {
    try {
        const id = req.params.id;
        
        // Remove from local storage
        localMemories = localMemories.filter(m => m.id !== id);
        await saveLocalMemories();
        
        // Remove from Chroma if available
        if (chromaCollection) {
            try {
                await chromaCollection.delete({ ids: [id] });
                console.log(`🗑️  Deleted from Chroma: ${id}`);
            } catch (error) {
                console.error('Chroma delete failed:', error.message);
            }
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Delete memory error:', error);
        res.status(500).json({ error: 'Failed to delete memory' });
    }
});

// Stats endpoint
app.get('/api/stats', async (req, res) => {
    try {
        const total = localMemories.length;
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        
        const thisWeek = localMemories.filter(m => new Date(m.timestamp) > weekAgo).length;
        
        const typeCounts = {};
        localMemories.forEach(m => {
            typeCounts[m.type] = (typeCounts[m.type] || 0) + 1;
        });

        let chromaCount = 0;
        if (chromaCollection) {
            try {
                chromaCount = await chromaCollection.count();
            } catch (e) {}
        }
        
        res.json({
            total,
            thisWeek,
            typeCounts,
            chromaVectors: chromaCount,
            oldestMemory: localMemories.length > 0 ? 
                Math.min(...localMemories.map(m => new Date(m.timestamp))) : null
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

// Export all data
app.get('/api/export', async (req, res) => {
    try {
        res.json({
            exportDate: new Date().toISOString(),
            totalMemories: localMemories.length,
            memories: localMemories
        });
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: 'Export failed' });
    }
});

// Import data
app.post('/api/import', async (req, res) => {
    try {
        const { memories } = req.body;
        
        if (!Array.isArray(memories)) {
            return res.status(400).json({ error: 'Invalid data format' });
        }
        
        let chromaImported = 0;
        
        // Process each memory
        for (const memory of memories) {
            if (!memory.embedding) {
                memory.embedding = await generateEmbedding(memory.content);
            }
            
            // Save to Chroma if available
            if (chromaCollection && memory.embedding) {
                try {
                    await chromaCollection.add({
                        ids: [memory.id],
                        embeddings: [memory.embedding],
                        metadatas: [{
                            type: memory.type,
                            content: memory.content,
                            tags: memory.tags.join(','),
                            timestamp: memory.timestamp
                        }],
                        documents: [memory.content]
                    });
                    chromaImported++;
                } catch (error) {
                    console.error('Chroma import failed:', error.message);
                }
            }
        }
        
        // Add to local storage
        localMemories.push(...memories);
        await saveLocalMemories();
        
        res.json({ 
            success: true, 
            imported: memories.length,
            chromaImported: chromaImported
        });
    } catch (error) {
        console.error('Import error:', error);
        res.status(500).json({ error: 'Import failed' });
    }
});

// Initialize and start server
async function start() {
    await loadLocalMemories();
    await initChroma();
    
    app.listen(PORT, () => {
        console.log(`\n🚀 Second Brain API running on http://localhost:${PORT}`);
        console.log(`📊 Local memories: ${localMemories.length}`);
        console.log(`🔌 Chroma: ${chromaCollection ? 'Connected (local)' : 'Not available'}`);
        console.log(`🤖 OpenAI: ${process.env.OPENAI_API_KEY ? 'Configured' : 'Not configured'}\n`);
    });
}

start();
