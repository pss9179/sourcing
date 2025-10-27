const { google } = require('googleapis');
require('dotenv').config();

// Test script to diagnose email threading issues
async function testEmailThreading() {
    console.log('🔍 Testing Email Threading Differences...\n');
    
    // Simulate the threading logic for both cadence emails and AI responses
    console.log('📧 CADENCE EMAIL THREADING:');
    console.log('==========================');
    
    // This is how cadence emails are sent (from sendDirectEmail function)
    const cadenceThreading = {
        subject: 'Re: Your availability request',
        inReplyTo: '<response-message-id@mail.gmail.com>',
        references: '<your-original-message-id@mail.gmail.com> <response-message-id@mail.gmail.com>',
        messageId: '<generated-message-id@mail.gmail.com>',
        threadId: 'original-thread-id-12345'
    };
    
    console.log('✅ Cadence Email Headers:');
    console.log(`   Subject: ${cadenceThreading.subject}`);
    console.log(`   In-Reply-To: ${cadenceThreading.inReplyTo}`);
    console.log(`   References: ${cadenceThreading.references}`);
    console.log(`   Message-ID: ${cadenceThreading.messageId}`);
    console.log(`   Thread-ID: ${cadenceThreading.threadId}`);
    console.log('');
    
    console.log('🤖 AI SCHEDULING RESPONSE THREADING:');
    console.log('====================================');
    
    // This is how AI responses are currently sent (from sendSchedulingResponse function)
    const aiThreading = {
        subject: 'Re: Your availability request',
        inReplyTo: '<response-message-id@mail.gmail.com>',
        references: '<your-original-message-id@mail.gmail.com> <response-message-id@mail.gmail.com>',
        messageId: '<generated-message-id@mail.gmail.com>',
        threadId: 'original-thread-id-12345'
    };
    
    console.log('❌ AI Response Headers (Current):');
    console.log(`   Subject: ${aiThreading.subject}`);
    console.log(`   In-Reply-To: ${aiThreading.inReplyTo}`);
    console.log(`   References: ${aiThreading.references}`);
    console.log(`   Message-ID: ${aiThreading.messageId}`);
    console.log(`   Thread-ID: ${aiThreading.threadId}`);
    console.log('');
    
    // Let's check what the actual differences might be
    console.log('🔍 POTENTIAL ISSUES:');
    console.log('====================');
    
    console.log('1. Message-ID Format:');
    console.log('   - Cadence: Uses proper Gmail Message-ID format');
    console.log('   - AI Response: Uses custom generated Message-ID');
    console.log('');
    
    console.log('2. In-Reply-To Header:');
    console.log('   - Both use the same logic, but might have different Message-ID sources');
    console.log('');
    
    console.log('3. References Chain:');
    console.log('   - Both should be identical');
    console.log('');
    
    console.log('4. Thread ID Usage:');
    console.log('   - Both use the same threadId in Gmail API call');
    console.log('');
    
    // Let's simulate the actual email headers that would be generated
    console.log('📧 SIMULATED EMAIL HEADERS:');
    console.log('============================');
    
    console.log('CADENCE EMAIL:');
    console.log('From: user@example.com');
    console.log('To: contact@example.com');
    console.log(`Subject: ${cadenceThreading.subject}`);
    console.log('MIME-Version: 1.0');
    console.log('Content-Type: text/html; charset=utf-8');
    console.log(`In-Reply-To: ${cadenceThreading.inReplyTo}`);
    console.log(`References: ${cadenceThreading.references}`);
    console.log(`Message-ID: ${cadenceThreading.messageId}`);
    console.log('');
    
    console.log('AI RESPONSE EMAIL:');
    console.log('From: user@example.com');
    console.log('To: contact@example.com');
    console.log(`Subject: ${aiThreading.subject}`);
    console.log('MIME-Version: 1.0');
    console.log('Content-Type: text/html; charset=utf-8');
    console.log(`In-Reply-To: ${aiThreading.inReplyTo}`);
    console.log(`References: ${aiThreading.references}`);
    console.log(`Message-ID: ${aiThreading.messageId}`);
    console.log('');
    
    console.log('🎯 DIAGNOSIS:');
    console.log('=============');
    console.log('The headers look identical, but there might be differences in:');
    console.log('1. How the Message-IDs are generated');
    console.log('2. How the In-Reply-To values are determined');
    console.log('3. The actual Gmail API call parameters');
    console.log('');
    
    console.log('🔧 NEXT STEPS:');
    console.log('==============');
    console.log('1. Check the actual Message-ID generation in both functions');
    console.log('2. Verify the In-Reply-To header values are identical');
    console.log('3. Ensure the Gmail API call uses the same threading parameters');
    console.log('4. Test with real email data to see the actual differences');
}

// Run the test
testEmailThreading().catch(console.error);

