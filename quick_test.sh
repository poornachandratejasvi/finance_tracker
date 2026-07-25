#!/bin/bash
# Quick test script to verify all fixes

echo "================================"
echo "TESTING ALL FIXES - QUICK CHECK"
echo "================================"
echo ""

# Test 1: Backend health
echo "1. Testing backend health..."
HEALTH=$(curl -s http://localhost:8000/health)
if [[ $HEALTH == *"healthy"* ]]; then
    echo "   ✅ Backend is healthy"
else
    echo "   ❌ Backend is down"
    exit 1
fi

# Test 2: Frontend serving
echo ""
echo "2. Testing frontend..."
FRONTEND=$(curl -s http://localhost:3000 | head -5)
if [[ $FRONTEND == *"DOCTYPE html"* ]]; then
    echo "   ✅ Frontend is serving"
else
    echo "   ❌ Frontend is down"
    exit 1
fi

# Test 3: Check for SQL errors in backend logs
echo ""
echo "3. Checking for SQL errors..."
SQL_ERRORS=$(docker logs finance_tracker_backend 2>&1 | tail -100 | grep -i "TypeError.*case")
if [[ -z "$SQL_ERRORS" ]]; then
    echo "   ✅ No SQL case() errors found"
else
    echo "   ❌ SQL errors still present:"
    echo "$SQL_ERRORS"
fi

# Test 4: Check duplicate removal endpoint exists
echo ""
echo "4. Testing duplicate endpoints..."
DUPLICATES_ENDPOINT=$(docker exec finance_tracker_backend grep -r "remove-duplicates" /app/app/api/endpoints/ 2>/dev/null)
if [[ ! -z "$DUPLICATES_ENDPOINT" ]]; then
    echo "   ✅ Duplicate removal endpoint exists"
else
    echo "   ❌ Duplicate removal endpoint not found"
fi

# Test 5: Check bank_type column
echo ""
echo "5. Testing bank_type column..."
BANK_TYPE=$(docker exec -i finance_tracker_db psql -U financeuser -d financedb -c "\d banks" 2>/dev/null | grep bank_type)
if [[ ! -z "$BANK_TYPE" ]]; then
    echo "   ✅ bank_type column exists"
else
    echo "   ❌ bank_type column not found"
fi

# Test 6: Check Discord integration
echo ""
echo "6. Testing Discord integration..."
DISCORD=$(docker exec finance_tracker_backend ls /app/app/services/discord_notifier.py 2>/dev/null)
if [[ ! -z "$DISCORD" ]]; then
    echo "   ✅ Discord notifier file exists"
else
    echo "   ❌ Discord notifier not found"
fi

# Test 7: Check if comprehensive filters exist in dashboard
echo ""
echo "7. Testing analytics filters..."
FILTERS=$(docker exec finance_tracker_backend grep -A 5 "category:" /app/app/api/endpoints/dashboard.py 2>/dev/null)
if [[ ! -z "$FILTERS" ]]; then
    echo "   ✅ Comprehensive filters added to analytics"
else
    echo "   ❌ Filters not found in analytics"
fi

echo ""
echo "================================"
echo "MANUAL UI TESTS REQUIRED:"
echo "================================"
echo "Open http://localhost:3000 and verify:"
echo ""
echo "1. Analytics Page:"
echo "   - Banks dropdown is populated"
echo "   - New filters: Category, Type, Min/Max Amount"
echo "   - Filters update charts when changed"
echo "   - Data shows by default"
echo ""
echo "2. Transactions Page:"
echo "   - 'Find Duplicates' button exists"
echo "   - 'Remove Duplicates' button exists"
echo "   - 'PDF Source' column shows PDF filenames"
echo "   - 'Account Type' column shows Savings/Credit/Other"
echo ""
echo "3. Banks Page:"
echo "   - Can add multiple emails (comma-separated)"
echo "   - Account Type dropdown shows Savings/Credit Card/Other"
echo "   - Values persist after save"
echo ""
echo "4. Field Mapping Page:"
echo "   - Banks dropdown is populated"
echo ""
echo "5. Resync PDFs:"
echo "   - Click resync → Should show success or 'No PDFs found'"
echo "   - Check Discord for notification (if webhook configured)"
echo ""
echo "================================"
