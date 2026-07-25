#!/bin/bash

# First, login
echo "Getting auth token..."
TOKEN=$(curl -s -X POST "http://localhost:8000/api/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=admin123" | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")

if [ -z "$TOKEN" ]; then
  echo "Failed to get token"
  exit 1
fi

echo "Token obtained"

# List of PDF IDs to reprocess
PDF_IDS=(1 2 3 4 5 50 51 52)

for PDF_ID in "${PDF_IDS[@]}"; do
  echo ""
  echo "=== Reprocessing PDF $PDF_ID ==="
  
  RESPONSE=$(curl -s -X POST "http://localhost:8000/api/pdfs/$PDF_ID/reprocess" \
    -H "Authorization: Bearer $TOKEN")
  
  echo "$RESPONSE" | python3 -c "
import sys, json
try:
  data = json.load(sys.stdin)
  if 'message' in data:
    print('✓', data['message'])
  elif 'detail' in data:
    print('✗ Error:', data['detail'])
  else:
    print(json.dumps(data, indent=2))
except:
  print('Failed to parse response')
"
  
  sleep 1
done

echo ""
echo "=== Done ==="
