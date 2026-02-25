#!/bin/bash

# Second Brain Setup Script
# Run this to quickly set up your second brain system

echo "🧠 Second Brain Setup"
echo "===================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found. Please install Node.js 16+ first.${NC}"
    echo "Visit: https://nodejs.org/"
    exit 1
fi

echo -e "${GREEN}✅ Node.js found: $(node --version)${NC}"

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm not found.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ npm found: $(npm --version)${NC}"
echo ""

# Install dependencies
echo -e "${BLUE}📦 Installing dependencies...${NC}"
npm install

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to install dependencies${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Dependencies installed${NC}"
echo ""

# Set up .env file
if [ ! -f .env ]; then
    echo -e "${BLUE}⚙️  Creating .env file...${NC}"
    cp .env.example .env
    echo -e "${GREEN}✅ .env file created${NC}"
    echo ""
    echo -e "${BLUE}📝 Please edit .env and add your API keys:${NC}"
    echo "   - OPENAI_API_KEY (required)"
    echo "   - PINECONE_API_KEY (optional but recommended)"
    echo ""
    echo "Then run: npm start"
else
    echo -e "${GREEN}✅ .env file already exists${NC}"
fi

echo ""
echo -e "${BLUE}🚀 Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Edit .env and add your API keys"
echo "2. Run: npm start"
echo "3. Open second-brain.html in your browser"
echo "4. Configure API URL in the Config tab"
echo ""
echo "For detailed instructions, see README.md"
echo ""
