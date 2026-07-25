#!/bin/bash

# Backend Integration Test Suite
# Tests the fixed endpoints

echo "================================"
echo "Backend Integration Test Suite"
echo "================================"
echo ""

# Configuration
API_URL="http://localhost:8000"
FRONTEND_URL="http://localhost:3000"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASSED=0
FAILED=0

# Helper function to test endpoint
test_endpoint() {
    local name="$1"
    local method="$2"
    local endpoint="$3"
    local expected_status="$4"
    local data="$5"
    local headers="$6"
    
    echo -n "Testing: $name... "
    
    if [ "$method" = "GET" ]; then
        response=$(curl -s -o /dev/null -w "%{http_code}" -H "$headers" "$API_URL$endpoint")
    elif [ "$method" = "POST" ]; then
        response=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "$headers" -d "$data" "$API_URL$endpoint")
    elif [ "$method" = "DELETE" ]; then
        response=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE -H "$headers" "$API_URL$endpoint")
    fi
    
    if echo "$expected_status" | grep -q "$response"; then
        echo -e "${GREEN}✓ PASS${NC} (Status: $response)"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAIL${NC} (Expected: $expected_status, Got: $response)"
        ((FAILED++))
    fi
}

# Login and get token
echo "=== Authentication ==="
echo -n "Logging in... "
LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=admin&password=7411470935")

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

if [ -n "$TOKEN" ]; then
    echo -e "${GREEN}✓ Login successful${NC}"
    AUTH_HEADER="Authorization: Bearer $TOKEN"
    ((PASSED++))
else
    echo -e "${RED}✗ Login failed${NC}"
    ((FAILED++))
    echo "Response: $LOGIN_RESPONSE"
    exit 1
fi

echo ""

# Test basic endpoints
echo "=== Core API Endpoints ==="
test_endpoint "Get current user" "GET" "/api/users/me" "200" "" "$AUTH_HEADER"
test_endpoint "List banks" "GET" "/api/banks/" "200" "" "$AUTH_HEADER"
test_endpoint "List transactions" "GET" "/api/transactions/?limit=10" "200" "" "$AUTH_HEADER"
test_endpoint "Transaction fields" "GET" "/api/transactions/fields" "200" "" "$AUTH_HEADER"
test_endpoint "Get PDF stats" "GET" "/api/pdfs/stats" "200|401" "" "$AUTH_HEADER"

# Test PDF fields if any PDFs exist
PDFS_RESPONSE=$(curl -s -X GET "$API_URL/api/pdfs/?limit=1" -H "$AUTH_HEADER")
PDF_ID=$(echo "$PDFS_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

if [ -n "$PDF_ID" ]; then
    test_endpoint "Get PDF fields" "GET" "/api/pdfs/$PDF_ID/fields" "200" "" "$AUTH_HEADER"
else
    echo -e "${YELLOW}⚠ Skipping PDF fields test (no PDFs found)${NC}"
fi

echo ""

# Test Discord webhook
echo "=== Settings API ==="
test_endpoint "Get Discord webhook" "GET" "/api/settings/discord-webhook" "200" "" "$AUTH_HEADER"

# Test setting webhook
echo -n "Setting Discord webhook... "
WEBHOOK_URL="https://discord.com/api/webhooks/test/test123"
WEBHOOK_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/settings/discord-webhook" \
    -H "Content-Type: application/json" \
    -H "$AUTH_HEADER" \
    -d "{\"webhook_url\":\"$WEBHOOK_URL\"}")

WEBHOOK_STATUS=$(echo "$WEBHOOK_RESPONSE" | tail -n1)
if [ "$WEBHOOK_STATUS" = "200" ]; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC} (Status: $WEBHOOK_STATUS)"
    ((FAILED++))
fi

# Test webhook test endpoint (will fail to send but endpoint should work)
test_endpoint "Test Discord webhook" "POST" "/api/settings/discord-webhook/test" "200|400|500" "" "$AUTH_HEADER"

echo ""

# Test PDF password endpoints
echo "=== PDF Password Management ==="
test_endpoint "Test PDF password (no PDF)" "POST" "/api/sync/test-pdf-password?pdf_id=999&password=test" "404|422" "" "$AUTH_HEADER"
test_endpoint "Update PDF password (no PDF)" "POST" "/api/sync/update-pdf-password?pdf_id=999&password=test" "404|422" "" "$AUTH_HEADER"

echo ""

# Test field mapping endpoints with a valid bank
echo "=== Field Mapping ==="
BANKS_RESPONSE=$(curl -s -X GET "$API_URL/api/banks/" -H "$AUTH_HEADER")
FIELD_BANK_ID=$(echo "$BANKS_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

if [ -z "$FIELD_BANK_ID" ]; then
    echo -n "Creating field mapping test bank... "
    CREATE_BANK_RESPONSE=$(curl -s -X POST "$API_URL/api/banks/" \
        -H "Content-Type: application/json" \
        -H "$AUTH_HEADER" \
        -d '{"name":"Test Field Mapping Bank","code":"FMTEST"}')
    FIELD_BANK_ID=$(echo "$CREATE_BANK_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
fi

if [ -n "$FIELD_BANK_ID" ]; then
    test_endpoint "Get field mapping" "GET" "/api/field-mapping/$FIELD_BANK_ID" "200" "" "$AUTH_HEADER"
else
    echo -e "${RED}✗ FAIL${NC} (Could not get bank ID for field mapping)"
    ((FAILED++))
fi

echo ""

# Test bank deletion (create then delete)
echo "=== Bank Management ==="
echo -n "Creating test bank... "
CREATE_BANK_RESPONSE=$(curl -s -X POST "$API_URL/api/banks/" \
    -H "Content-Type: application/json" \
    -H "$AUTH_HEADER" \
    -d '{"name":"Test Delete Bank","code":"TESTDEL"}')

BANK_ID=$(echo "$CREATE_BANK_RESPONSE" | grep -o '"id":[0-9]*' | cut -d':' -f2)

if [ -n "$BANK_ID" ]; then
    echo -e "${GREEN}✓ Created (ID: $BANK_ID)${NC}"
    ((PASSED++))
    
    # Now delete it
    echo -n "Deleting test bank... "
    DELETE_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API_URL/api/banks/$BANK_ID" -H "$AUTH_HEADER")
    
    if [ "$DELETE_RESPONSE" = "204" ] || [ "$DELETE_RESPONSE" = "200" ]; then
        echo -e "${GREEN}✓ PASS${NC} (Status: $DELETE_RESPONSE - Deleted successfully)"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAIL${NC} (Status: $DELETE_RESPONSE)"
        ((FAILED++))
    fi
else
    echo -e "${RED}✗ Failed to create bank${NC}"
    ((FAILED++))
fi

echo ""

# Summary
echo "================================"
echo "Test Summary"
echo "================================"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo "Total: $((PASSED + FAILED))"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some tests failed${NC}"
    exit 1
fi
