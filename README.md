# Finance Tracker - Multi-Bank Transaction Management System

A comprehensive finance tracking application similar to Wallet by BudgetBakers that automatically extracts bank transactions from email statements.

## Features

1. **Multi-Gmail Account Integration** - Read emails from multiple Gmail accounts
2. **Automated PDF Detection** - Find and extract bank statement PDFs from emails
3. **Password-Protected PDF Support** - Handle encrypted PDFs with user-provided passwords
4. **Transaction Extraction** - Parse PDF statements and extract transaction details
5. **Bank & Category Filtering** - View and filter transactions by bank and category
6. **Smart Labeling** - Auto-label transactions based on keywords
7. **Transaction Editing** - Modify transaction details via GUI
8. **Sync Functionality** - Check for new statements and missing data
9. **Duplicate Detection** - Identify and manage duplicate transactions
10. **Role-Based Access Control** - Admin and multi-user support with RBAC
11. **Docker Support** - Lightweight containerized deployment
12. **PDF Format Mapping** - Learn and remember PDF formats for auto-mapping
13. **User-Friendly UI** - Modern, intuitive interface

## Tech Stack

- **Backend**: Python with FastAPI
- **Frontend**: React with Material-UI
- **Database**: PostgreSQL
- **Cache**: Redis
- **Email**: Gmail API
- **PDF Processing**: pdfplumber, PyPDF2
- **Authentication**: JWT with bcrypt
- **Containerization**: Docker & Docker Compose

## Project Structure

```
finance-tracker/
├── backend/
│   ├── app/
│   │   ├── api/              # API endpoints
│   │   ├── core/             # Core configurations
│   │   ├── models/           # Database models
│   │   ├── schemas/          # Pydantic schemas
│   │   ├── services/         # Business logic
│   │   ├── utils/            # Utility functions
│   │   └── main.py           # Application entry point
│   ├── alembic/              # Database migrations
│   ├── tests/                # Unit tests
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/       # React components
│   │   ├── pages/            # Page components
│   │   ├── services/         # API services
│   │   ├── hooks/            # Custom hooks
│   │   └── App.js
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml
└── .env.example
```

## Quick Start

### Prerequisites
- Docker and Docker Compose installed
- Gmail API credentials (for email integration) — see [Gmail API Setup](#gmail-api-setup) below

### Option A: Pull prebuilt images (fastest, recommended)

No local build tools needed — `docker-compose.prod.yml` pulls the published images
instead of building from source.

```bash
git clone https://github.com/poornachandratejasvi/finance_tracker.git && cd finance_tracker
cp .env.example .env
# Edit .env with your configuration (admin credentials, secret keys, etc.)

docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Images are multi-arch (amd64 + arm64) and published to GHCR on every release. Pin a
specific version instead of `latest`:
```bash
IMAGE_TAG=v0.2.0 docker compose -f docker-compose.prod.yml up -d
```
Browse available versions/tags: https://github.com/poornachandratejasvi/finance_tracker/pkgs/container/finance_tracker-backend

### Option B: Build from source (for development)

```bash
git clone https://github.com/poornachandratejasvi/finance_tracker.git && cd finance_tracker
cp .env.example .env
# Edit .env with your configuration

docker-compose up --build
```
This bind-mounts `./backend` and `./frontend` into the containers, so code edits are
picked up without rebuilding — see [Development](#development) below.

### Option C: Behind an existing Traefik reverse proxy

If you already run Traefik (e.g. the common `t2_proxy` external-network setup with a
wildcard cert), use `docker-compose.traefik.yml` instead — no ports are published on the
host, only Traefik reaches the app.

```bash
git clone https://github.com/poornachandratejasvi/finance_tracker.git && cd finance_tracker
cp .env.example .env
# Edit .env:
#   TRAEFIK_DOMAIN=finance.yourdomain.com
#   TRAEFIK_NETWORK=t2_proxy   # only if your network name differs
#   REACT_APP_API_URL=https://finance.yourdomain.com
#   BACKEND_URL=https://finance.yourdomain.com
#   FRONTEND_URL=https://finance.yourdomain.com
#   ALLOWED_ORIGINS=https://finance.yourdomain.com

docker compose -f docker-compose.traefik.yml pull
docker compose -f docker-compose.traefik.yml up -d
```

Google OAuth (Gmail linking, Drive backup, Google sign-in) requires HTTPS for any
non-loopback redirect, and a "Web application" (not "Desktop") OAuth client type. If you
place `credentials.json` after the stack is already up, copy it directly into the named
volume instead of a bind mount:
```bash
docker cp credentials.json $(docker compose -f docker-compose.traefik.yml ps -q backend):/app/credentials/credentials.json
docker compose -f docker-compose.traefik.yml restart backend worker beat
```

### Access the application

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

### Gmail API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable Gmail API
4. Create OAuth 2.0 credentials
5. Download credentials.json and place in `backend/credentials/`
6. Run the Gmail authorization flow on first use

## Usage

### Adding Gmail Accounts

1. Navigate to Settings > Email Accounts
2. Click "Add Account"
3. Complete Gmail OAuth flow
4. Account will be added and synced automatically

### Managing Bank Configurations

1. Go to Settings > Bank Configurations
2. Add new bank with email patterns
3. Configure PDF field mappings
4. System will auto-learn PDF formats

### Processing Transactions

1. Click "Sync" to fetch new emails
2. System automatically:
   - Detects bank emails
   - Extracts PDF attachments
   - Prompts for password if needed
   - Parses transactions
   - Detects duplicates

### Filtering & Labeling

- Use filter bar to filter by bank, date, category, or amount
- Create labels and assign to transactions
- Set up auto-labeling rules with keywords

### Managing Duplicates

1. Navigate to Duplicates tab
2. Review detected duplicates
3. Accept or delete as needed

## API Documentation

Once running, visit http://localhost:8000/docs for interactive API documentation.

## Development

### Backend Development

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend Development

```bash
cd frontend
npm install
npm start
```

### Running Tests

```bash
# Backend tests
cd backend
pytest

# Frontend tests
cd frontend
npm test
```

## Configuration

### Environment Variables

See `.env.example` for all available configuration options.

Key variables:
- `DATABASE_URL`: PostgreSQL connection string
- `SECRET_KEY`: JWT secret key
- `GMAIL_CREDENTIALS_PATH`: Path to Gmail API credentials
- `REDIS_URL`: Redis connection string

## Security

- All passwords are hashed using bcrypt
- JWT tokens for authentication
- PDF passwords are encrypted in database
- Role-based access control (RBAC)
- Secure OAuth2 flows for Gmail

## Contributing

Contributions are welcome! Please follow the standard GitHub flow:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License

## Support

For issues and questions, please open a GitHub issue.
