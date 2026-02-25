# Second Brain - Quick Start Guide

Get up and running in 5 minutes!

## 🚀 Fastest Setup (3 commands)

```bash
# 1. Install dependencies
npm install

# 2. Create and edit .env file
cp .env.example .env
# Edit .env and add: OPENAI_API_KEY=your-key-here

# 3. Start the server
npm start
```

Then open `second-brain.html` in your browser!

## 📋 Prerequisites Checklist

- [ ] Node.js 16+ installed (`node --version`)
- [ ] OpenAI API key ([get one here](https://platform.openai.com/api-keys))
- [ ] (Optional) Pinecone account ([sign up free](https://www.pinecone.io/))

## 🎯 Step-by-Step Setup

### Step 1: Get Your API Keys

**OpenAI (Required):**
1. Go to https://platform.openai.com/api-keys
2. Create new secret key
3. Copy it (starts with `sk-`)

**Pinecone (Optional but recommended):**
1. Sign up at https://www.pinecone.io/
2. Create a new index:
   - Name: `second-brain`
   - Dimensions: `1536`
   - Metric: `cosine`
3. Copy your API key from Settings

### Step 2: Configure Environment

```bash
# Copy the example env file
cp .env.example .env

# Edit .env file
nano .env  # or use any text editor
```

Add your keys:
```env
OPENAI_API_KEY=sk-your-key-here
PINECONE_API_KEY=your-pinecone-key-here  # Optional
PINECONE_INDEX=second-brain
PORT=3000
```

### Step 3: Install and Run

```bash
# Install dependencies
npm install

# Start the server
npm start
```

You should see:
```
🚀 Second Brain API running on http://localhost:3000
📊 Local memories: 0
🔌 Pinecone: Connected
🤖 OpenAI: Configured
```

### Step 4: Open the Web Interface

**Option A: Direct file**
- Open `second-brain.html` in Chrome/Firefox

**Option B: Local server** (recommended)
```bash
# In a new terminal
python3 -m http.server 8080
# Visit http://localhost:8080/second-brain.html
```

### Step 5: Configure Frontend

1. Click "Config" tab
2. Set "Backend API URL" to `http://localhost:3000`
3. Add your OpenAI API key (for voice transcription)
4. Click "Save Configuration"
5. Click "Test Connection" - should show "Connected"

## ✅ Verification

### Test 1: Save a Memory
1. Go to "Record" tab
2. Type "Test memory" in Content
3. Click "Save Memory"
4. Should see green success message

### Test 2: Search
1. Go to "Search" tab
2. Type "test"
3. Press Enter
4. Should see your test memory

### Test 3: Voice Recording
1. Go to "Record" tab → Voice Recording section
2. Click "🎤 Start Recording"
3. Allow microphone access
4. Speak something
5. Click "⏹️ Stop"
6. Should see transcription appear

## 🐳 Docker Setup (Alternative)

If you prefer Docker:

```bash
# Build and run with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

## 🔧 Troubleshooting

### "Cannot connect to backend"
- Ensure server is running (`npm start`)
- Check if port 3000 is available
- Verify API URL in Config tab

### "Transcription failed"
- Check OpenAI API key in Config tab
- Verify you have credits in OpenAI account
- Check browser console for errors

### "Module not found" errors
```bash
# Delete and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Port 3000 already in use
```bash
# Change port in .env
PORT=3001

# Or find and kill the process
lsof -ti:3000 | xargs kill -9
```

## 📱 Mobile Access

To access from your phone:

1. Find your computer's IP:
```bash
# Mac/Linux
ifconfig | grep "inet " | grep -v 127.0.0.1

# Windows
ipconfig
```

2. Update frontend config to use your IP:
```
http://192.168.1.x:3000  # Replace with your IP
```

3. Open on phone:
```
http://192.168.1.x:8080/second-brain.html
```

## 🎓 Usage Tips

### Memory Types
- **Note**: General information
- **Person**: Facts about people ("Sarah prefers email")
- **Task**: Things to do
- **Idea**: Creative thoughts
- **Product**: Items you want to buy/remember
- **Reference**: Important links or resources
- **Conversation**: Things discussed

### Effective Tagging
Good tags:
- `important`, `urgent`
- `work`, `personal`
- `shopping`, `health`
- `project-name`

### Voice Recording Tips
- Speak clearly and at normal pace
- Pause for 1 second before stopping
- Review transcription before saving
- Quiet environment = better accuracy

### Search Tricks
Semantic search understands meaning:
- "shoes I wanted" finds "burgundy sneakers I saw"
- "what Sarah likes" finds "Sarah prefers email communication"
- "grocery needs" finds your shopping list

## 🔐 Security Notes

For personal use (default setup):
- ✅ Runs locally on your machine
- ✅ Data stored in local JSON file
- ✅ API keys in .env (never committed)

For production/shared use:
- ⚠️ Add authentication
- ⚠️ Use HTTPS
- ⚠️ Secure API endpoints
- ⚠️ Don't expose .env file

## 📊 What Gets Stored

**Locally (always):**
- `memories.json` - All your memories
- `.env` - Your API keys (keep private!)

**In Pinecone (if configured):**
- Vector embeddings of your memories
- Metadata (type, tags, timestamp)
- NOT the full content (that's in memories.json)

## 🔄 Backup Your Data

### Export from UI
1. Go to Config tab
2. Click "Export All Data"
3. Save the JSON file

### Manual backup
```bash
# Copy memories file
cp memories.json memories-backup-$(date +%Y%m%d).json
```

## 🆘 Get Help

1. Check the full [README.md](README.md)
2. See [AI_INTEGRATION_GUIDE.md](AI_INTEGRATION_GUIDE.md) for AI integration
3. Check browser console for errors (F12)
4. Check server logs in terminal

## 🎉 You're Ready!

Your second brain is now running! Start by:
1. Recording some memories
2. Testing the search
3. Trying voice recording
4. Exploring the visualizations

For AI integration, see [AI_INTEGRATION_GUIDE.md](AI_INTEGRATION_GUIDE.md)

Happy remembering! 🧠✨
