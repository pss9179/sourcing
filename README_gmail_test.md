# Gmail Threading Test Script

This Python script systematically tests different Gmail API approaches to ensure emails thread correctly. It will iterate through various combinations until it finds one that works.

## Setup

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Get Google OAuth2 credentials:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one
   - Enable the Gmail API
   - Go to "Credentials" → "Create Credentials" → "OAuth client ID"
   - Choose "Desktop application"
   - Download the JSON file and save as `credentials.json` in this directory

3. **Run the test:**
   ```bash
   python gmail_threading_test.py
   ```

## What it tests

The script tests 6 different methods:

1. **Method 1**: `threadId` + `In-Reply-To` + `References` headers (based on your working cadence logic)
2. **Method 2**: `threadId` only (no threading headers)
3. **Method 3**: `In-Reply-To` + `References` only (no `threadId`)
4. **Method 4**: Create draft first, then send
5. **Method 5**: Plain text instead of HTML
6. **Method 6**: References chain (original + reply)

## How it works

1. Authenticates with Gmail API using OAuth2
2. Finds the most recent email from someone else in your inbox
3. Sends a test reply using each method
4. Waits 3 seconds for Gmail to process
5. Checks if the new message appears in the same thread
6. Reports which methods worked

## Expected output

```
🚀 Starting Gmail Threading Test Suite
==================================================
🔐 Authenticating with Gmail API...
✅ Authentication successful!
📧 Searching for recent incoming email...
📬 Found email: Re: Test Subject
   From: someone@example.com
   Thread ID: 19a044cc5d8caf93
   Message ID: <abc123@mail.gmail.com>

============================================================
🧪 Method 1: threadId + In-Reply-To + References
============================================================
🧪 Testing Method 1: threadId + In-Reply-To + References
   ✅ Email sent! Message ID: 19a044cc5d8caf94
🔍 Testing if message threaded correctly...
   📊 Thread now has 2 messages
   ✅ Threaded correctly!
🎉 SUCCESS! Method 1: threadId + In-Reply-To + References worked!
```

## Based on your working code

The script is based on your working `sendDirectEmail` function from `backend/server.js` which:

- Uses proper MIME format with CRLF (`\r\n`)
- Includes `From`, `To`, `Subject`, `MIME-Version`, `Content-Type` headers
- Uses `In-Reply-To` and `References` for threading
- Uses `threadId` in the request body
- Encodes the subject with UTF-8 base64 encoding

This should help identify exactly what's needed for proper Gmail threading in your AI scheduling responses.




