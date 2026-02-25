# Connecting Your AI Model to Second Brain

This guide explains how to integrate Second Brain with your existing OpenAI Realtime model or any AI application.

## Architecture Overview

```
Your AI Model ←→ Second Brain API ←→ Vector Database
     │                  │                    │
     │                  │                    │
  Handles          Manages              Stores
conversation      memories            embeddings
```

## Integration Methods

### Method 1: Simple API Calls (Recommended for Starting)

Add memory search to your AI's context before each response:

```javascript
// In your AI conversation loop
async function handleUserMessage(userMessage) {
    // 1. Search for relevant memories
    const memories = await fetch('http://localhost:3000/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            query: userMessage,
            limit: 5  // Get top 5 relevant memories
        })
    }).then(r => r.json());

    // 2. Build context with memories
    const memoryContext = memories.length > 0 
        ? `\n\nRelevant memories from your past:\n${memories.map(m => 
            `- [${m.type}] ${m.content}`
          ).join('\n')}\n`
        : '';

    // 3. Send to your AI model
    const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
            {
                role: "system",
                content: `You are a helpful assistant with access to the user's personal memories.${memoryContext}`
            },
            {
                role: "user",
                content: userMessage
            }
        ]
    });

    return response.choices[0].message.content;
}
```

### Method 2: Function Calling (Recommended for Production)

Let your AI decide when to search or save memories:

```javascript
const tools = [
    {
        type: "function",
        function: {
            name: "search_memory",
            description: "Search the user's personal memory database for relevant information",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "What to search for in memories"
                    },
                    limit: {
                        type: "number",
                        description: "Maximum number of results (default 5)"
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
            description: "Save important information to the user's memory",
            parameters: {
                type: "object",
                properties: {
                    content: {
                        type: "string",
                        description: "The information to remember"
                    },
                    type: {
                        type: "string",
                        enum: ["note", "person", "task", "idea", "product", "reference", "conversation"],
                        description: "Type of memory"
                    },
                    tags: {
                        type: "array",
                        items: { type: "string" },
                        description: "Tags for organization"
                    }
                },
                required: ["content"]
            }
        }
    }
];

// Implement the functions
async function searchMemory(query, limit = 5) {
    const response = await fetch('http://localhost:3000/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit })
    });
    return await response.json();
}

async function saveMemory(content, type = "note", tags = []) {
    const response = await fetch('http://localhost:3000/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, type, tags })
    });
    return await response.json();
}

// Use with OpenAI
const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages: messages,
    tools: tools,
    tool_choice: "auto"
});

// Handle function calls
if (response.choices[0].message.tool_calls) {
    for (const toolCall of response.choices[0].message.tool_calls) {
        if (toolCall.function.name === "search_memory") {
            const args = JSON.parse(toolCall.function.arguments);
            const results = await searchMemory(args.query, args.limit);
            // Add results to conversation context
        } else if (toolCall.function.name === "save_memory") {
            const args = JSON.parse(toolCall.function.arguments);
            await saveMemory(args.content, args.type, args.tags);
        }
    }
}
```

### Method 3: Automatic Memory Extraction

Automatically save important facts from conversations:

```javascript
async function extractAndSaveMemories(userMessage, aiResponse) {
    // Use AI to extract facts
    const extractionPrompt = `
Extract important facts from this conversation that should be remembered:

User: ${userMessage}
AI: ${aiResponse}

Return a JSON array of facts to remember, each with:
{
  "content": "the fact",
  "type": "person|task|idea|note|product|reference",
  "tags": ["tag1", "tag2"]
}

Only extract genuinely important information worth remembering.
    `;

    const extraction = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: extractionPrompt }],
        response_format: { type: "json_object" }
    });

    const facts = JSON.parse(extraction.choices[0].message.content).facts;

    // Save each fact
    for (const fact of facts) {
        await fetch('http://localhost:3000/api/memories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: fact.content,
                type: fact.type,
                tags: [...fact.tags, 'auto-extracted']
            })
        });
    }
}

// Call after each conversation turn
await extractAndSaveMemories(userMessage, aiResponse);
```

## OpenAI Realtime API Specific Integration

For the Realtime API (voice conversations):

```javascript
import { RealtimeClient } from '@openai/realtime-api-beta';

const client = new RealtimeClient({
    apiKey: process.env.OPENAI_API_KEY,
});

// Add memory context before each response
client.on('conversation.item.created', async (event) => {
    if (event.item.role === 'user') {
        const userMessage = event.item.content[0].transcript;
        
        // Search memories
        const memories = await searchMemory(userMessage, 3);
        
        // Inject memory context
        if (memories.length > 0) {
            const memoryText = `Relevant memories: ${memories.map(m => m.content).join('; ')}`;
            
            await client.sendUserMessageContent([{
                type: 'input_text',
                text: memoryText
            }]);
        }
    }
});

// Auto-save important conversation moments
client.on('conversation.item.created', async (event) => {
    if (event.item.role === 'assistant') {
        const aiMessage = event.item.content[0].transcript;
        
        // Ask AI if this is worth remembering
        const shouldSave = await decideIfWorthSaving(aiMessage);
        
        if (shouldSave.save) {
            await saveMemory(shouldSave.content, shouldSave.type, shouldSave.tags);
        }
    }
});
```

## Complete Example: Enhanced Chatbot

```javascript
class MemoryEnhancedChatbot {
    constructor(openaiApiKey, memoryApiUrl = 'http://localhost:3000') {
        this.openai = new OpenAI({ apiKey: openaiApiKey });
        this.memoryApi = memoryApiUrl;
        this.conversationHistory = [];
    }

    async chat(userMessage) {
        // 1. Search for relevant memories
        const memories = await this.searchMemories(userMessage);
        
        // 2. Build enhanced system prompt
        const systemPrompt = this.buildSystemPrompt(memories);
        
        // 3. Add user message to history
        this.conversationHistory.push({
            role: 'user',
            content: userMessage
        });

        // 4. Get AI response
        const response = await this.openai.chat.completions.create({
            model: 'gpt-4',
            messages: [
                { role: 'system', content: systemPrompt },
                ...this.conversationHistory
            ],
            tools: this.getTools(),
            tool_choice: 'auto'
        });

        const message = response.choices[0].message;

        // 5. Handle function calls
        if (message.tool_calls) {
            await this.handleToolCalls(message.tool_calls);
        }

        // 6. Add AI response to history
        this.conversationHistory.push({
            role: 'assistant',
            content: message.content
        });

        // 7. Auto-save important facts
        await this.autoSaveImportantFacts(userMessage, message.content);

        return message.content;
    }

    async searchMemories(query) {
        const response = await fetch(`${this.memoryApi}/api/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, limit: 5 })
        });
        return await response.json();
    }

    buildSystemPrompt(memories) {
        let prompt = "You are a helpful AI assistant with access to the user's personal memories.";
        
        if (memories.length > 0) {
            prompt += "\n\nRelevant memories:";
            memories.forEach((m, i) => {
                prompt += `\n${i + 1}. [${m.type}] ${m.content}`;
                if (m.tags.length > 0) {
                    prompt += ` (tags: ${m.tags.join(', ')})`;
                }
            });
        }
        
        return prompt;
    }

    getTools() {
        return [
            {
                type: "function",
                function: {
                    name: "search_memory",
                    description: "Search user's memories",
                    parameters: {
                        type: "object",
                        properties: {
                            query: { type: "string" }
                        },
                        required: ["query"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "save_memory",
                    description: "Save to user's memory",
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
    }

    async handleToolCalls(toolCalls) {
        for (const call of toolCalls) {
            const args = JSON.parse(call.function.arguments);
            
            if (call.function.name === 'search_memory') {
                await this.searchMemories(args.query);
            } else if (call.function.name === 'save_memory') {
                await fetch(`${this.memoryApi}/api/memories`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(args)
                });
            }
        }
    }

    async autoSaveImportantFacts(userMsg, aiMsg) {
        // Extract facts worth remembering
        const extraction = await this.openai.chat.completions.create({
            model: 'gpt-4',
            messages: [{
                role: 'user',
                content: `Extract important facts to remember from this exchange:
                
User: ${userMsg}
AI: ${aiMsg}

Return JSON: { "facts": [{ "content": "...", "type": "...", "tags": [...] }] }
Only include genuinely important information.`
            }],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(extraction.choices[0].message.content);
        
        for (const fact of result.facts || []) {
            await fetch(`${this.memoryApi}/api/memories`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fact)
            });
        }
    }
}

// Usage
const bot = new MemoryEnhancedChatbot(process.env.OPENAI_API_KEY);
const response = await bot.chat("What were those shoes I wanted to buy?");
console.log(response);
```

## Testing Your Integration

1. **Start Second Brain API:**
```bash
npm start
```

2. **Test memory creation:**
```javascript
const response = await fetch('http://localhost:3000/api/memories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        type: 'test',
        content: 'This is a test memory',
        tags: ['test']
    })
});
console.log(await response.json());
```

3. **Test search:**
```javascript
const results = await fetch('http://localhost:3000/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'test' })
}).then(r => r.json());
console.log(results);
```

4. **Test from your AI:**
```javascript
// Run a complete conversation with memory integration
const userMessage = "Remember that I like oat milk";
const response = await bot.chat(userMessage);
console.log(response);

// Verify it saved
const search = await bot.chat("What kind of milk do I like?");
console.log(search); // Should reference oat milk
```

## Best Practices

1. **Context Management:**
   - Don't send ALL memories every time (use limit parameter)
   - Only search when relevant to the conversation
   - Use semantic search to find truly related memories

2. **Auto-Save Strategy:**
   - Be selective about what you auto-save
   - Avoid saving generic responses
   - Tag auto-saved memories differently

3. **Performance:**
   - Cache frequent searches
   - Batch memory operations when possible
   - Use webhooks for async saving

4. **Privacy:**
   - Inform users when memories are being saved
   - Provide easy deletion options
   - Never save sensitive data (passwords, etc.)

## Troubleshooting

**Problem:** AI not finding relevant memories
- Check if embeddings are being generated (look in server logs)
- Verify Pinecone is configured correctly
- Try more specific search queries

**Problem:** Too many irrelevant memories
- Reduce the `limit` parameter
- Improve memory tagging
- Add filtering by memory type

**Problem:** Slow response times
- Enable caching for common queries
- Use smaller embedding models
- Implement request batching

## Next Steps

1. Deploy both the API and frontend
2. Add authentication for multi-user support
3. Create custom memory types for your use case
4. Build automatic memory consolidation
5. Add memory relationship graphs

Your AI now has a perfect memory! 🧠✨
