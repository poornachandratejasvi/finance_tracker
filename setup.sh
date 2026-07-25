#!/bin/bash

# Finance Tracker - Setup and Run Script

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}Finance Tracker - Setup & Run${NC}"
echo -e "${BLUE}======================================${NC}\n"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker is not installed${NC}"
    echo "Please install Docker from https://www.docker.com/"
    exit 1
fi
echo -e "${GREEN}✓ Docker is installed${NC}"

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}✗ Docker Compose is not installed${NC}"
    echo "Please install Docker Compose"
    exit 1
fi
echo -e "${GREEN}✓ Docker Compose is installed${NC}"

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "\n${YELLOW}⚠ .env file not found${NC}"
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo -e "${GREEN}✓ .env file created${NC}"
    echo -e "${YELLOW}⚠ Please edit .env file and configure your settings${NC}"
    echo "  - Set a secure SECRET_KEY"
    echo "  - Configure database credentials"
    echo "  - Add Gmail API credentials path"
    echo ""
    read -p "Press Enter after editing .env file to continue..."
fi

# Create necessary directories
echo -e "\n${BLUE}Creating necessary directories...${NC}"
mkdir -p backend/credentials
mkdir -p backend/uploads
echo -e "${GREEN}✓ Directories created${NC}"

# Check for Gmail API credentials
if [ ! -f "backend/credentials/credentials.json" ]; then
    echo -e "\n${YELLOW}⚠ Gmail API credentials not found${NC}"
    echo "To use Gmail integration:"
    echo "  1. Go to https://console.cloud.google.com/"
    echo "  2. Create a new project"
    echo "  3. Enable Gmail API"
    echo "  4. Create OAuth 2.0 credentials"
    echo "  5. Download credentials.json"
    echo "  6. Place it in backend/credentials/credentials.json"
    echo ""
    echo "You can skip this for now and add it later."
    read -p "Continue without Gmail credentials? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Run validation
echo -e "\n${BLUE}Running validation...${NC}"
python3 validate.py
if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Validation failed${NC}"
    exit 1
fi

# Ask if user wants to build
echo -e "\n${BLUE}Ready to build and start the application${NC}"
read -p "Build and start Docker containers? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Exiting..."
    exit 0
fi

# Stop existing containers
echo -e "\n${BLUE}Stopping existing containers...${NC}"
docker-compose down 2>/dev/null || true

# Build and start containers
echo -e "\n${BLUE}Building and starting containers...${NC}"
docker-compose up --build -d

# Wait for services to be ready
echo -e "\n${BLUE}Waiting for services to start...${NC}"
sleep 10

# Check if services are running
echo -e "\n${BLUE}Checking services...${NC}"
docker-compose ps

# Display access information
echo -e "\n${GREEN}======================================${NC}"
echo -e "${GREEN}Application Started Successfully!${NC}"
echo -e "${GREEN}======================================${NC}\n"

echo -e "${BLUE}Access the application:${NC}"
echo -e "  Frontend:     ${GREEN}http://localhost:3000${NC}"
echo -e "  Backend API:  ${GREEN}http://localhost:8000${NC}"
echo -e "  API Docs:     ${GREEN}http://localhost:8000/docs${NC}"
echo -e "  Database:     ${GREEN}localhost:5432${NC}"
echo -e "  Redis:        ${GREEN}localhost:6379${NC}"

echo -e "\n${BLUE}Useful commands:${NC}"
echo "  View logs:           docker-compose logs -f"
echo "  Stop containers:     docker-compose down"
echo "  Restart:             docker-compose restart"
echo "  Rebuild:             docker-compose up --build -d"

echo -e "\n${BLUE}Default admin credentials:${NC}"
echo "  Username: admin"
echo "  Password: ChangeThisPassword123!"
echo -e "  ${YELLOW}⚠ Please change these in production!${NC}"

echo -e "\n${BLUE}Next steps:${NC}"
echo "  1. Access the API docs: http://localhost:8000/docs"
echo "  2. Register a new user or login with admin"
echo "  3. Add Gmail account credentials"
echo "  4. Configure bank patterns"
echo "  5. Run sync to import transactions"

echo ""
