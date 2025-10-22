const { google } = require('googleapis');
require('dotenv').config();

// Live debugging process for email threading
async function liveThreadingDebug() {
    console.log('🔍 LIVE THREADING DEBUG PROCESS');
    console.log('================================\n');
    
    console.log('📋 DEBUGGING CHECKLIST:');
    console.log('======================');
    console.log('Use this checklist to verify threading is working:');
    console.log('');
    
    console.log('1️⃣ BEFORE SENDING CADENCE EMAIL:');
    console.log('================================');
    console.log('   ✅ Check server logs for:');
    console.log('      - "📧 Email sent! Message ID: X, Thread ID: Y"');
    console.log('      - "📧 Actual Message-ID: <real-id@mail.gmail.com>"');
    console.log('   ✅ Note the Thread ID from the logs');
    console.log('   ✅ Verify email appears in Gmail');
    console.log('');
    
    console.log('2️⃣ WHEN CONTACT REPLIES:');
    console.log('========================');
    console.log('   ✅ Check server logs for:');
    console.log('      - "🔍 Checking thread [THREAD_ID] for responses..."');
    console.log('      - "📬 Thread contains X messages"');
    console.log('      - "📅 Scheduling analysis result: request_availability"');
    console.log('   ✅ Verify the Thread ID matches the original email');
    console.log('   ✅ Check that AI detects scheduling intent');
    console.log('');
    
    console.log('3️⃣ WHEN AI SENDS RESPONSE:');
    console.log('==========================');
    console.log('   ✅ Check server logs for:');
    console.log('      - "📧 Sending scheduling response to [email] in thread [THREAD_ID]"');
    console.log('      - "✅ Scheduling response email sent! Message ID: X, Thread ID: Y"');
    console.log('      - "📧 Actual Message-ID: <real-gmail-id@mail.gmail.com>"');
    console.log('   ✅ Verify Thread ID is SAME as original email');
    console.log('   ✅ Verify Message-ID is Gmail-generated (not custom)');
    console.log('');
    
    console.log('4️⃣ CHECK GMAIL THREADING:');
    console.log('==========================');
    console.log('   ✅ Open Gmail and find the original email');
    console.log('   ✅ Click on the email to expand the thread');
    console.log('   ✅ Verify AI response appears in SAME conversation');
    console.log('   ✅ Check that all emails show as one conversation');
    console.log('');
    
    console.log('🚨 RED FLAGS (If you see these, threading is broken):');
    console.log('====================================================');
    console.log('   ❌ AI response appears as separate email (not in thread)');
    console.log('   ❌ Different Thread IDs in logs');
    console.log('   ❌ Custom Message-ID in logs (timestamp-random format)');
    console.log('   ❌ "Error getting Message-ID" in logs');
    console.log('   ❌ AI response doesn\'t appear at all');
    console.log('');
    
    console.log('✅ SUCCESS INDICATORS:');
    console.log('======================');
    console.log('   ✅ AI response in same Gmail conversation');
    console.log('   ✅ Same Thread ID throughout the process');
    console.log('   ✅ Gmail-generated Message-ID in logs');
    console.log('   ✅ Natural conversation flow');
    console.log('');
    
    console.log('🔧 DEBUGGING COMMANDS:');
    console.log('======================');
    console.log('Run these commands to monitor the process:');
    console.log('');
    console.log('1. Monitor server logs:');
    console.log('   tail -f /path/to/server.log');
    console.log('');
    console.log('2. Check Gmail API calls:');
    console.log('   Look for "Gmail API working" messages');
    console.log('');
    console.log('3. Verify database entries:');
    console.log('   Check sent_emails table for proper thread_id');
    console.log('');
    
    console.log('📊 EXPECTED LOG SEQUENCE:');
    console.log('=========================');
    console.log('1. "📧 Email sent! Message ID: [id], Thread ID: [thread]"');
    console.log('2. "🔍 Checking thread [thread] for responses..."');
    console.log('3. "📅 Scheduling analysis result: request_availability"');
    console.log('4. "📧 Sending scheduling response to [email] in thread [thread]"');
    console.log('5. "✅ Scheduling response email sent! Message ID: [id], Thread ID: [thread]"');
    console.log('6. "📧 Actual Message-ID: <real-id@mail.gmail.com>"');
    console.log('');
    
    console.log('🎯 FINAL VERIFICATION:');
    console.log('======================');
    console.log('If you see the above log sequence with SAME Thread IDs,');
    console.log('and the AI response appears in the same Gmail conversation,');
    console.log('then threading is working correctly! 🎉');
    console.log('');
}

// Run the live debugging process
liveThreadingDebug().catch(console.error);
