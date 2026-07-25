"""
Comprehensive API endpoint tests for Finance Tracker
"""
import pytest
import sys
import os

# Add parent directory to sys.path  
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from datetime import datetime, timedelta

from main import app
from core.database import Base, get_db
from models.models import User, Bank, Transaction, BankEmail, GmailAccount, PDFStatement
from core.security import get_password_hash

# Test database setup
SQLALCHEMY_TEST_DATABASE_URL = "sqlite:///./test.db"
engine = create_engine(SQLALCHEMY_TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)

# Test fixtures
@pytest.fixture(scope="function", autouse=True)
def setup_database():
    """Create fresh database for each test"""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)

@pytest.fixture
def test_user():
    """Create test user"""
    db = TestingSessionLocal()
    user = User(
        username="testuser",
        email="test@example.com",
        hashed_password=get_password_hash("testpass123"),
        role="USER"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.close()
    return user

@pytest.fixture
def admin_user():
    """Create admin user"""
    db = TestingSessionLocal()
    user = User(
        username="admin",
        email="admin@example.com",
        hashed_password=get_password_hash("admin123"),
        role="ADMIN"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.close()
    return user

@pytest.fixture
def auth_headers(test_user):
    """Get authentication headers"""
    response = client.post(
        "/api/auth/login",
        data={"username": "testuser", "password": "testpass123"}
    )
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def admin_headers(admin_user):
    """Get admin authentication headers"""
    response = client.post(
        "/api/auth/login",
        data={"username": "admin", "password": "admin123"}
    )
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def test_bank(test_user):
    """Create test bank"""
    db = TestingSessionLocal()
    bank = Bank(
        user_id=test_user.id,
        name="Test Bank",
        code="TEST",
        account_number="1234567890"
    )
    db.add(bank)
    db.commit()
    db.refresh(bank)
    db.close()
    return bank


# ==================== Authentication Tests ====================

class TestAuthentication:
    """Test authentication endpoints"""
    
    def test_register_user(self):
        """Test user registration"""
        response = client.post(
            "/api/auth/register",
            json={
                "username": "newuser",
                "email": "newuser@example.com",
                "password": "password123"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == "newuser"
        assert data["email"] == "newuser@example.com"
        assert "id" in data
    
    def test_register_duplicate_username(self, test_user):
        """Test registration with duplicate username"""
        response = client.post(
            "/api/auth/register",
            json={
                "username": "testuser",
                "email": "another@example.com",
                "password": "password123"
            }
        )
        assert response.status_code == 400
        assert "already registered" in response.json()["detail"]
    
    def test_login_success(self, test_user):
        """Test successful login"""
        response = client.post(
            "/api/auth/login",
            data={"username": "testuser", "password": "testpass123"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
    
    def test_login_wrong_password(self, test_user):
        """Test login with wrong password"""
        response = client.post(
            "/api/auth/login",
            data={"username": "testuser", "password": "wrongpassword"}
        )
        assert response.status_code == 401
    
    def test_get_current_user(self, test_user, auth_headers):
        """Test getting current user info"""
        response = client.get("/api/users/me", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == "testuser"
        assert data["email"] == "test@example.com"


# ==================== Bank Tests ====================

class TestBanks:
    """Test bank endpoints"""
    
    def test_create_bank(self, test_user, auth_headers):
        """Test creating a bank"""
        response = client.post(
            "/api/banks/",
            headers=auth_headers,
            json={
                "name": "HDFC Bank",
                "code": "HDFC",
                "account_number": "9876543210"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "HDFC Bank"
        assert data["code"] == "HDFC"
        assert data["account_number"] == "9876543210"
    
    def test_list_banks(self, test_user, test_bank, auth_headers):
        """Test listing banks"""
        response = client.get("/api/banks/", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 1
        assert data[0]["name"] == "Test Bank"
    
    def test_get_bank(self, test_user, test_bank, auth_headers):
        """Test getting single bank"""
        response = client.get(f"/api/banks/{test_bank.id}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_bank.id
        assert data["name"] == "Test Bank"
    
    def test_update_bank(self, test_user, test_bank, auth_headers):
        """Test updating bank (admin only)"""
        response = client.put(
            f"/api/banks/{test_bank.id}",
            headers=auth_headers,
            json={"name": "Updated Bank Name"}
        )
        # Should fail for regular user
        assert response.status_code == 403
    
    def test_delete_bank(self, admin_user, admin_headers):
        """Test deleting bank (admin only)"""
        # Create a bank first
        db = TestingSessionLocal()
        bank = Bank(
            user_id=admin_user.id,
            name="Bank to Delete",
            code="DELETE"
        )
        db.add(bank)
        db.commit()
        bank_id = bank.id
        db.close()
        
        # Delete it
        response = client.delete(f"/api/banks/{bank_id}", headers=admin_headers)
        assert response.status_code == 200
        
        # Verify it's deleted
        response = client.get(f"/api/banks/{bank_id}", headers=admin_headers)
        assert response.status_code == 404


# ==================== Transaction Tests ====================

class TestTransactions:
    """Test transaction endpoints"""
    
    def test_list_transactions(self, test_user, auth_headers):
        """Test listing transactions"""
        response = client.get("/api/transactions/", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
    
    def test_create_transaction(self, test_user, test_bank, auth_headers):
        """Test creating a transaction"""
        response = client.post(
            "/api/transactions/",
            headers=auth_headers,
            json={
                "bank_id": test_bank.id,
                "date": "2026-01-15",
                "description": "Test Transaction",
                "amount": 100.50,
                "transaction_type": "DEBIT"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["description"] == "Test Transaction"
        assert data["amount"] == 100.50
    
    def test_update_transaction(self, test_user, test_bank, auth_headers):
        """Test updating a transaction"""
        # Create transaction first
        db = TestingSessionLocal()
        transaction = Transaction(
            user_id=test_user.id,
            bank_id=test_bank.id,
            date=datetime(2026, 1, 15),
            description="Original Description",
            amount=50.00,
            transaction_type="DEBIT"
        )
        db.add(transaction)
        db.commit()
        transaction_id = transaction.id
        db.close()
        
        # Update it
        response = client.put(
            f"/api/transactions/{transaction_id}",
            headers=auth_headers,
            json={"description": "Updated Description"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["description"] == "Updated Description"
    
    def test_delete_transaction(self, test_user, test_bank, auth_headers):
        """Test deleting a transaction"""
        # Create transaction first
        db = TestingSessionLocal()
        transaction = Transaction(
            user_id=test_user.id,
            bank_id=test_bank.id,
            date=datetime(2026, 1, 15),
            description="To be deleted",
            amount=25.00,
            transaction_type="DEBIT"
        )
        db.add(transaction)
        db.commit()
        transaction_id = transaction.id
        db.close()
        
        # Delete it
        response = client.delete(f"/api/transactions/{transaction_id}", headers=auth_headers)
        assert response.status_code == 200


# ==================== Settings Tests ====================

class TestSettings:
    """Test settings endpoints"""
    
    def test_get_discord_webhook(self, test_user, auth_headers):
        """Test getting Discord webhook settings"""
        response = client.get("/api/settings/discord-webhook", headers=auth_headers)
        assert response.status_code == 200
    
    def test_update_discord_webhook(self, test_user, auth_headers):
        """Test updating Discord webhook"""
        response = client.post(
            "/api/settings/discord-webhook",
            headers=auth_headers,
            json={"webhook_url": "https://discord.com/api/webhooks/test"}
        )
        assert response.status_code == 200
    
    def test_discord_webhook_test_without_url(self, test_user, auth_headers):
        """Test Discord webhook test without URL configured"""
        response = client.post("/api/settings/discord-webhook/test", headers=auth_headers)
        # Should fail if no webhook configured
        assert response.status_code in [400, 500]


# ==================== PDF Management Tests ====================

class TestPDFManagement:
    """Test PDF management endpoints"""
    
    def test_list_pdfs(self, test_user, auth_headers):
        """Test listing PDFs"""
        response = client.get("/api/pdfs/", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
    
    def test_get_pdf_stats(self, test_user, auth_headers):
        """Test getting PDF statistics"""
        response = client.get("/api/pdfs/stats", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "total" in data
        assert "processed" in data
        assert "failed" in data


# ==================== Sync Tests ====================

class TestSync:
    """Test sync endpoints"""
    
    def test_sync_status_no_active_sync(self, test_user, auth_headers):
        """Test sync status when no sync is running"""
        response = client.get("/api/sync/status", headers=auth_headers)
        # Should return 404 if no sync running
        assert response.status_code in [200, 404]
    
    def test_get_sync_logs(self, test_user, auth_headers):
        """Test getting sync logs"""
        response = client.get("/api/sync/logs", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)


# ==================== Password Tests ====================

class TestPasswordFunctionality:
    """Test PDF password functionality"""
    
    def test_test_pdf_password_endpoint_exists(self, test_user, auth_headers):
        """Verify test-pdf-password endpoint exists"""
        # This will fail if no PDF exists, but endpoint should respond
        response = client.post(
            "/api/sync/test-pdf-password?pdf_id=999&password=test",
            headers=auth_headers
        )
        # Should be 404 (PDF not found) not 405 (Method not allowed)
        assert response.status_code in [404, 422]
    
    def test_update_pdf_password_endpoint_exists(self, test_user, auth_headers):
        """Verify update-pdf-password endpoint exists"""
        response = client.post(
            "/api/sync/update-pdf-password?pdf_id=999&password=test",
            headers=auth_headers
        )
        # Should be 404 (PDF not found) not 405 (Method not allowed)
        assert response.status_code in [404, 422]


# ==================== Run Tests ====================

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
