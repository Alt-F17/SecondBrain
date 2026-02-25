# Second Brain - Neural Memory System

A powerful personal memory system with AI-powered semantic search, speech-to-text recording, and vector database storage. Remember everything from grocery lists to complex ideas with instant AI recall.

## Features

- 🎤 **Voice Recording & Transcription** - Record voice memos and automatically transcribe them using OpenAI Whisper
- 🔍 **Semantic Search** - Find memories by meaning, not just keywords (powered by vector embeddings)
- 📊 **Memory Visualization** - See your memory patterns, stats, and trends
- 🌙 **Space-Themed UI** - Beautiful, mobile-friendly interface with dark theme
- 💾 **Dual Storage** - Works with Pinecone (cloud) or local storage (fallback)
- 🏷️ **Flexible Organization** - Tag and categorize memories by type (notes, people, tasks, ideas, etc.)

## Architecture

```
┌─────────────────┐
│   Web Frontend  │ ← You interact here
│  (HTML/JS/CSS)  │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│   Express API   │ ← Node.js backend
│   (server.js)   │
└────────┬────────┘
         │
    ┌────┴────┐
    ↓         ↓
┌──────┐  ┌──────────┐
│OpenAI│  │ Pinecone │ ← Vector DB (optional)
│ API  │  │  or      │
└──────┘  │  Local   │
          └──────────┘
```

## How It Works

### 1. Memory Storage
When you save a memory:
1. Content is sent to the backend API
2. OpenAI generates a 1536-dimensional vector embedding of the content
3. Memory + embedding is stored in:
   - **Pinecone** (if configured) for fast semantic search
   - **Local JSON file** as a backup/fallback

### 2. Semantic Search
When you search:
1. Your search query is converted to an embedding
2. Pinecone finds the most similar memories using cosine similarity
3. Results are ranked by relevance (not just keyword matching)

**Example:** Searching for "burgundy sneakers" will find memories containing "red shoes" or "maroon footwear"

### 3. Voice Recording
1. Browser captures audio from your microphone
2. Audio is sent to OpenAI Whisper API
3. Transcription appears in the UI
4. You can save it as a memory with one click

## Quick Start

### Prerequisites
- Node.js 16+ installed
- OpenAI API key (required)
- Pinecone account (optional, but recommended)

### Installation

1. **Clone or download this repository**

2. **Install dependencies:**
```bash
npm install
```

3. **Configure environment variables:**
```bash
cp .env.example .env
```

Edit `.env` and add your API keys:
```env
OPENAI_API_KEY=sk-your-key-here
PINECONE_API_KEY=your-pinecone-key-here  # Optional
PINECONE_INDEX=second-brain
PORT=3000
```

4. **Start the server:**
```bash
npm start
```

5. **Open the web interface:**
Open `second-brain.html` in your browser, or serve it:
```bash
# Simple way to serve the HTML
python3 -m http.server 8080
# Then visit http://localhost:8080/second-brain.html
```

6. **Configure the frontend:**
- Go to the "Config" tab
- Set "Backend API URL" to `http://localhost:3000`
- Add your OpenAI API key for speech-to-text
- Click "Save Configuration"

## Usage Guide

### Recording a Memory

**Manual Entry:**
1. Go to "Record" tab
2. Select memory type (note, person, task, idea, product, etc.)
3. Type your content
4. Add tags (optional)
5. Click "Save Memory"

**Voice Recording:**
1. Click "🎤 Start Recording"
2. Speak your memory
3. Click "⏹️ Stop"
4. Review transcription
5. Click "Save as Memory"

### Searching Memories

1. Go to "Search" tab
2. Type your query (can be semantic, e.g., "shoes I wanted to buy")
3. Press Enter
4. Results show most relevant memories with similarity scores

### Visualizing Data

1. Go to "Visualize" tab
2. See stats: total memories, this week's count, most common type
3. Browse recent memories
4. View type distribution chart

## API Endpoints

### Health Check
```bash
GET /api/health
```

### Save Memory
```bash
POST /api/memories
Content-Type: application/json

{
  "type": "note",
  "content": "Remember to buy oat milk",
  "tags": ["grocery", "shopping"]
}
```

### Search Memories
```bash
POST /api/search
Content-Type: application/json

{
  "query": "grocery list",
  "limit": 10
}
```

### Get All Memories
```bash
GET /api/memories?limit=100&offset=0
```

### Get Memory by ID
```bash
GET /api/memories/:id
```

### Delete Memory
```bash
DELETE /api/memories/:id
```

### Export Data
```bash
GET /api/export
```

### Get Stats
```bash
GET /api/stats
```

## Connecting to Your Existing AI

To integrate this Second Brain with your existing OpenAI Realtime model:

### Option 1: API Integration
Make HTTP calls to the Second Brain API from your AI:

```javascript
// When user asks something, search relevant memories
const response = await fetch('http://localhost:3000/api/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    query: userMessage,
    limit: 5 
  })
});

const relevantMemories = await response.json();

// Add memories to your AI context
const contextWithMemories = `
Relevant memories:
${relevantMemories.map(m => `- ${m.content}`).join('\n')}

User query: ${userMessage}
`;

// Pass to your OpenAI model
```

### Option 2: Function Calling
Add Second Brain as a function/tool for your AI:

```javascript
const tools = [
  {
    type: "function",
    function: {
      name: "search_memories",
      description: "Search the user's personal memory database",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query"
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "save_memory",
      description: "Save important information to memory",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string" },
          type: { type: "string" },
          tags: { type: "array", items: { type: "string" } }
        },
        required: ["content"]
      }
    }
  }
];

// Your AI can now call these functions automatically
```

### Option 3: Automatic Memory Creation
Have your AI automatically save important facts:

```javascript
// After each conversation turn
const importantFacts = extractFactsFromConversation(userMessage, aiResponse);

for (const fact of importantFacts) {
  await fetch('http://localhost:3000/api/memories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'conversation',
      content: fact,
      tags: ['auto-saved']
    })
  });
}
```

## Setting Up Pinecone (Recommended)

1. Sign up at https://www.pinecone.io/ (free tier available)
2. Create a new index:
   - **Name:** `second-brain`
   - **Dimensions:** `1536` (for text-embedding-3-small)
   - **Metric:** `cosine`
   - **Pod Type:** `p1` (starter)
3. Copy your API key
4. Add to `.env` file
5. Restart the server

## Local-Only Mode

The system works without Pinecone! If you don't configure Pinecone:
- Memories are stored in `memories.json`
- Search uses keyword matching instead of semantic similarity
- Still fully functional, just less "intelligent" search

## Data Management

### Export Your Data
```bash
curl http://localhost:3000/api/export > backup.json
```

Or use the "Export All Data" button in the Config tab.

### Import Data
```bash
curl -X POST http://localhost:3000/api/import \
  -H "Content-Type: application/json" \
  -d @backup.json
```

### Backup Strategy
- Local memories are in `memories.json`
- Back this up regularly
- Export to JSON for portability
- Pinecone data persists in the cloud

## Troubleshooting

### "Backend Disconnected" Error
- Ensure server is running (`npm start`)
- Check API URL in Config tab is correct
- Verify port 3000 isn't blocked

### Transcription Not Working
- Verify OpenAI API key is set in Config tab
- Check browser microphone permissions
- Ensure you have credits in OpenAI account

### Search Returns No Results
- Check if memories are saved (go to Visualize tab)
- If using Pinecone, verify API key is correct
- Try keyword search with exact words from a memory

### Memory Not Saving
- Check browser console for errors
- Verify server is running
- Check OpenAI API key for embedding generation

## Advanced Configuration

### Custom Memory Types
Edit the `<select id="memory-type">` in `second-brain.html`:
```html
<option value="custom-type">My Custom Type</option>
```

### Change Embedding Model
In `server.js`, modify:
```javascript
const response = await openai.embeddings.create({
    model: 'text-embedding-3-large', // More accurate, 3072 dimensions
    input: text
});
```
(Remember to update Pinecone index dimensions!)

### Adjust Search Results
In search requests:
```javascript
{ query: "your query", limit: 20 } // Get top 20 instead of 10
```

## Performance & Limits

- **Storage:** Limited only by disk space (local) or Pinecone tier
- **Search Speed:** <100ms for millions of memories (Pinecone)
- **Embedding Cost:** ~$0.00002 per 1,000 tokens (OpenAI)
- **Transcription Cost:** ~$0.006 per minute (OpenAI Whisper)

## Security Notes

- API keys are stored in `.env` (never commit this file!)
- Frontend stores API keys in localStorage (OK for personal use)
- For production: use proper auth, HTTPS, environment-specific configs
- Memories are private to your instance

## Future Enhancements

Potential additions:
- Mobile app (React Native)
- Image memory support
- Collaborative memories (shared with others)
- Automatic fact extraction from conversations
- Memory consolidation (periodic summarization)
- Chrome extension for quick capture
- Integration with calendar, email, notes apps

## Contributing

Feel free to fork and modify! Some ideas:
- Add authentication
- Create React/Vue version
- Build iOS/Android apps
- Add more visualization charts
- Implement memory relationships/graph

## License

MIT License - do whatever you want with this!

## Credits

Built with:
- OpenAI (embeddings & speech-to-text)
- Pinecone (vector database)
- Express.js (backend)
- Vanilla JS (frontend - no frameworks!)

## Support

Issues or questions? Check:
1. This README
2. Browser console for errors
3. Server logs for backend issues
4. OpenAI/Pinecone documentation

---

**Remember:** Your second brain is only as good as what you feed it. Log consistently, search often, and watch it become indispensable! 🧠✨
