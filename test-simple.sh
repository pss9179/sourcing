#!/bin/bash

# Simple workflow test script using curl
# Replace this token with your actual token from localStorage
TOKEN="YOUR_TOKEN_HERE"

BASE_URL="http://localhost:3000"
TEST_EMAIL="bob.fisit.jeff@gmail.com"

echo "🚀 WORKFLOW TESTS"
echo "================================"
echo ""

# Test 1: Create and run a simple workflow
echo "🧪 TEST 1: Email Threading & Status"
echo "--------------------------------"

# Create workflow
WORKFLOW_JSON='{
  "name": "Test Threading",
  "nodes": [
    {
      "id": "node-start",
      "type": "start",
      "title": "Start"
    },
    {
      "id": "node-email-1",
      "type": "email",
      "title": "Email 1",
      "config": {
        "to": "'$TEST_EMAIL'",
        "subject": "Test Email",
        "template": "First email",
        "delayType": "immediate"
      }
    },
    {
      "id": "node-email-2",
      "type": "email",
      "title": "Email 2",
      "config": {
        "to": "'$TEST_EMAIL'",
        "subject": "Different Subject",
        "template": "Second email (should be in same thread)",
        "delayType": "seconds",
        "delayValue": 5
      }
    }
  ],
  "connections": [
    {"from": "node-start", "to": "node-email-1"},
    {"from": "node-email-1", "to": "node-email-2"}
  ]
}'

echo "Creating workflow..."
RESPONSE=$(curl -s -X POST "$BASE_URL/api/cadences" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "$WORKFLOW_JSON")

CADENCE_ID=$(echo $RESPONSE | grep -o '"id":[0-9]*' | grep -o '[0-9]*')

if [ -z "$CADENCE_ID" ]; then
  echo "❌ Failed to create workflow"
  echo "Response: $RESPONSE"
  exit 1
fi

echo "✅ Created workflow with ID: $CADENCE_ID"
echo ""

# Execute workflow
echo "Executing workflow..."
curl -s -X POST "$BASE_URL/api/cadences/$CADENCE_ID/execute" \
  -H "Authorization: Bearer $TOKEN" > /dev/null

echo "✅ Workflow started"
echo ""

# Check initial status
sleep 2
echo "📊 Checking initial status (should be: Email 1 = SENT, Email 2 = PENDING)..."
STATUS=$(curl -s "$BASE_URL/api/cadences/$CADENCE_ID/execution-status" \
  -H "Authorization: Bearer $TOKEN")

echo "$STATUS" | grep -q '"status":"sent"' && echo "  ✅ Found SENT status"
echo "$STATUS" | grep -q '"status":"pending"' && echo "  ✅ Found PENDING status"
echo ""

# Wait for second email
echo "⏳ Waiting 7 seconds for second email to send..."
sleep 7

echo "📊 Checking final status (both should be SENT)..."
STATUS=$(curl -s "$BASE_URL/api/cadences/$CADENCE_ID/execution-status" \
  -H "Authorization: Bearer $TOKEN")

SENT_COUNT=$(echo "$STATUS" | grep -o '"status":"sent"' | wc -l | tr -d ' ')
echo "  Found $SENT_COUNT emails with SENT status"

if [ "$SENT_COUNT" = "2" ]; then
  echo "  ✅ PASS: Both emails sent"
else
  echo "  ❌ FAIL: Expected 2 sent emails, got $SENT_COUNT"
fi
echo ""

# Check email logs for threading
echo "📧 Checking email logs for threading..."
LOGS=$(curl -s "$BASE_URL/api/email-logs?cadence_id=$CADENCE_ID" \
  -H "Authorization: Bearer $TOKEN")

echo "$LOGS" | grep -o '"thread_id":"[^"]*"' | sort -u | wc -l | {
  read THREAD_COUNT
  THREAD_COUNT=$(echo $THREAD_COUNT | tr -d ' ')
  if [ "$THREAD_COUNT" = "1" ]; then
    echo "  ✅ PASS: All emails in same thread"
  else
    echo "  ❌ FAIL: Emails in $THREAD_COUNT different threads"
  fi
}

# Check for Re: prefix
echo ""
echo "📝 Checking subject lines..."
FIRST_SUBJECT=$(echo "$LOGS" | grep -o '"subject":"[^"]*"' | head -1 | cut -d'"' -f4)
SECOND_SUBJECT=$(echo "$LOGS" | grep -o '"subject":"[^"]*"' | tail -1 | cut -d'"' -f4)

echo "  First email subject: $FIRST_SUBJECT"
echo "  Second email subject: $SECOND_SUBJECT"

if [[ ! "$FIRST_SUBJECT" =~ ^Re: ]]; then
  echo "  ✅ PASS: First email does NOT have Re: prefix"
else
  echo "  ❌ FAIL: First email has Re: prefix"
fi

if [[ "$SECOND_SUBJECT" =~ ^Re: ]]; then
  echo "  ✅ PASS: Second email has Re: prefix"
else
  echo "  ❌ FAIL: Second email missing Re: prefix"
fi

echo ""
echo "================================"
echo "✅ Tests complete!"
echo ""
echo "💡 Check your email inbox at $TEST_EMAIL to verify:"
echo "   1. Both emails are in the same thread"
echo "   2. First email subject: 'Test Email'"
echo "   3. Second email subject: 'Re: Test Email'"
