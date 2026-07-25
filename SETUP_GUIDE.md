# Finance Tracker - Setup Guide

## Prerequisites

Before starting, ensure you have the following installed:

1. **Docker** (version 20.10 or higher)
   - Download from: https://www.docker.com/get-started
   
2. **Docker Compose** (version 2.0 or higher)
   - Usually comes with Docker Desktop
   
3. **Python 3.11+** (for validation scripts)
   - Download from: https://www.python.org/downloads/

4. **Node.js 18+** (for frontend development)
   - Download from: https://nodejs.org/

## Gmail API Setup

To enable email integration, you need to set up Gmail API credentials:

### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Enter project name: "Finance Tracker"
4. Click "Create"

### Step 2: Enable Gmail API

1. In the Cloud Console, go to "APIs & Services" → "Library"
2. Search for "Gmail API"
3. Click "Enable"

### Step 3: Create OAuth Credentials

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. If prompted, configure OAuth consent screen:
   - User Type: External
   - App name: Finance Tracker
   - User support email: your email
   - Developer contact: your email
4. Application type: Desktop app
5. Name: Finance Tracker Desktop
6. Click "Create"
7. Download the credentials JSON file
8. Rename it to `credentials.json`
9. Place it in `backend/credentials/credentials.json`

### Step 4: Add Test Users (Development)

1. Go to "APIs & Services" → "OAuth consent screen"
2. Click "Add Users" under "Test users"
3. Add the Gmail accounts you want to use
4. Click "Save"

## Quick Start

### Option 1: Automated Setup (Recommended)

```bash
# Make setup script executable
chmod +x setup.sh

# Run setup script
./setup.sh
```

The script will:
- Validate your environment
- Create necessary directories
- Copy .env.example to .env
- Build and start Docker containers
- Display access information

### Option 2: Manual Setup

#### 1. Create Environment File

```bash
cp .env.example .env
```

Edit `.env` and configure:
- `SECRET_KEY`: Generate a secure random string
- `DATABASE_URL`: PostgreSQL connection (default is fine for Docker)
- `ADMIN_PASSWORD`: Change the default admin password
- Other settings as needed

#### 2. Create Directories

```bash
mkdir -p backend/credentials backend/uploads
```

#### 3. Add Gmail Credentials

Place your `credentials.json` in `backend/credentials/`

#### 4. Build and Start

```bash
docker-compose up --build -d
```

#### 5. Check Status

```bash
docker-compose ps
docker-compose logs -f
```

## Validation

Before starting the application, run validation:

```bash
# Make validation script executable
chmod +x validate.py

# Run validation
python3 validate.py
```

This checks:
- Directory structure
- Required files
- Python syntax
- Docker configuration
- Environment variables

## Testing PDF Parsing

Test the PDF parsing functionality with sample PDFs:

```bash
# Make test script executable
chmod +x test_pdf_parsing.py

# Run PDF parsing tests
python3 test_pdf_parsing.py
```

This will:
- Test both sample PDFs (scbank.pdf and yes.pdf)
- Extract text and transactions
- Generate JSON reports
- Show sample transactions

## Accessing the Application

Once started, access:

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs
- **Database**: localhost:5432
- **Redis**: localhost:6379

### Default Admin Credentials

```
Username: admin
Password: 7411470935
```

**⚠️ IMPORTANT:** Change these credentials immediately in production!

## First-Time Setup

### 1. Login to API

Go to http://localhost:8000/docs

Click "Authorize" and use admin credentials

### 2. Add Gmail Account

1. Go to `/api/v1/banks/gmail-accounts/`
2. Click "POST" to add new account
3. Provide email and OAuth credentials
4. Complete authorization flow

### 3. Configure Banks

For each bank you want to track:

1. Create bank entry at `/api/v1/banks/`
   ```json
   {
     "name": "HDFC Bank",
     "code": "HDFC",
     "logo_url": "optional"
   }
   ```

2. Create bank configuration at `/api/v1/banks/{bank_id}/config`
   ```json
   {
     "bank_id": 1,
     "email_pattern": "*@alerts.hdfcbank.com",
     "subject_pattern": "statement",
     "pdf_field_mapping": "{}",
     "password_hints": "{}"
   }
   ```

### 4. Run First Sync

1. Go to `/api/v1/sync/`
2. Click "POST" to start sync
3. Monitor progress at `/api/v1/sync/status/{sync_log_id}`

### 5. View Transactions

Access `/api/v1/transactions/` to see imported transactions

### 6. Manage Duplicates

Check `/api/v1/transactions/duplicates` for duplicate groups

## Common Tasks

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f db
```

### Restart Services

```bash
# All services
docker-compose restart

# Specific service
docker-compose restart backend
```

### Stop Application

```bash
docker-compose down
```

### Rebuild After Changes

```bash
docker-compose up --build -d
```

### Access Database

```bash
# Using docker exec
docker-compose exec db psql -U financeuser -d financedb

# Using local psql
psql -h localhost -U financeuser -d financedb
```

### Access Backend Shell

```bash
docker-compose exec backend bash
```

### Run Backend Tests

```bash
docker-compose exec backend pytest
```

## Development Mode

### Backend Development

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run development server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend Development

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm start
```

## Troubleshooting

### Port Already in Use

If ports 3000, 8000, 5432, or 6379 are in use:

1. Stop conflicting services
2. Or modify ports in `docker-compose.yml`

### Database Connection Error

```bash
# Check if database is running
docker-compose ps db

# Restart database
docker-compose restart db

# Check logs
docker-compose logs db
```

### Gmail API Authentication Error

1. Ensure `credentials.json` is in `backend/credentials/`
2. Check that Gmail API is enabled in Google Cloud Console
3. Verify test users are added in OAuth consent screen
4. Delete `backend/credentials/token.json` and re-authenticate

### PDF Password Protected

The system will detect password-protected PDFs and prompt for password. Common formats:

- DOB (DDMMYYYY)
- Last 4 digits of card
- Account number
- PAN number

### No Transactions Found

1. Check bank configuration patterns
2. Verify Gmail account has statements
3. Check sync logs at `/api/v1/sync/status/`
4. Review PDF parsing logs in backend logs

## Production Deployment

For production deployment:

1. **Change default passwords**
   - Admin password
   - Database password
   - Redis password (if adding authentication)

2. **Set secure SECRET_KEY**
   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

3. **Use production database**
   - Consider managed PostgreSQL (AWS RDS, Google Cloud SQL, etc.)

4. **Enable HTTPS**
   - Use nginx or Caddy as reverse proxy
   - Get SSL certificates (Let's Encrypt)

5. **Set environment to production**
   ```
   DEBUG=False
   ```

6. **Configure backups**
   - Database backups
   - Upload directory backups

7. **Set up monitoring**
   - Application logs
   - Error tracking (Sentry)
   - Performance monitoring

8. **Secure Gmail credentials**
   - Use secrets management (AWS Secrets Manager, etc.)
   - Rotate credentials regularly

## Support

For issues:
1. Check logs: `docker-compose logs -f`
2. Verify configuration: `python3 validate.py`
3. Test PDF parsing: `python3 test_pdf_parsing.py`
4. Check API documentation: http://localhost:8000/docs

## Additional Resources

- FastAPI Documentation: https://fastapi.tiangolo.com/
- Gmail API Documentation: https://developers.google.com/gmail/api
- Docker Documentation: https://docs.docker.com/
- React Documentation: https://react.dev/
