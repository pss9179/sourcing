const fs = require('fs');
const path = require('path');

// Verify that the threading fix has been applied correctly
async function verifyThreadingFix() {
    console.log('🔍 VERIFYING THREADING FIX');
    console.log('===========================\n');
    
    try {
        // Read the server.js file to check for the fixes
        const serverPath = path.join(__dirname, 'server.js');
        const serverContent = fs.readFileSync(serverPath, 'utf8');
        
        console.log('✅ CHECKING FOR THREADING FIXES:');
        console.log('===============================\n');
        
        // Check 1: Custom Message-ID removed
        const hasCustomMessageId = serverContent.includes('Date.now()}-${Math.random().toString(36).substr(2, 9)}@mail.gmail.com');
        console.log(`1. Custom Message-ID removed: ${hasCustomMessageId ? '❌ STILL PRESENT' : '✅ REMOVED'}`);
        
        // Check 2: Message-ID retrieval added
        const hasMessageIdRetrieval = serverContent.includes('Get the actual Message-ID from the sent email\'s headers');
        console.log(`2. Message-ID retrieval added: ${hasMessageIdRetrieval ? '✅ PRESENT' : '❌ MISSING'}`);
        
        // Check 3: Proper encoding method
        const hasProperEncoding = serverContent.includes('.replace(/\\+/g, \'-\').replace(/\\//g, \'_\').replace(/=+$/, \'\')');
        console.log(`3. Proper encoding method: ${hasProperEncoding ? '✅ PRESENT' : '❌ MISSING'}`);
        
        // Check 4: Threading headers present
        const hasThreadingHeaders = serverContent.includes('In-Reply-To: ${responseMessageId}') && 
                                   serverContent.includes('References: ${yourOriginalMessageId} ${responseMessageId}');
        console.log(`4. Threading headers present: ${hasThreadingHeaders ? '✅ PRESENT' : '❌ MISSING'}`);
        
        // Check 5: Thread ID usage in Gmail API
        const hasThreadIdUsage = serverContent.includes('threadId: originalThreadId');
        console.log(`5. Thread ID usage: ${hasThreadIdUsage ? '✅ PRESENT' : '❌ MISSING'}`);
        
        console.log('\n📊 FIX VERIFICATION SUMMARY:');
        console.log('============================');
        
        const fixesApplied = [
            !hasCustomMessageId,
            hasMessageIdRetrieval,
            hasProperEncoding,
            hasThreadingHeaders,
            hasThreadIdUsage
        ];
        
        const appliedCount = fixesApplied.filter(Boolean).length;
        const totalCount = fixesApplied.length;
        
        console.log(`✅ Fixes Applied: ${appliedCount}/${totalCount}`);
        
        if (appliedCount === totalCount) {
            console.log('\n🎉 ALL THREADING FIXES APPLIED SUCCESSFULLY!');
            console.log('==========================================');
            console.log('The AI scheduling responses should now:');
            console.log('✅ Appear in the same email thread');
            console.log('✅ Use proper Gmail Message-IDs');
            console.log('✅ Work identically to cadence emails');
            console.log('');
            console.log('🧪 READY FOR TESTING:');
            console.log('=====================');
            console.log('1. Send a cadence email to a contact');
            console.log('2. Have them reply with scheduling intent');
            console.log('3. Check Gmail - AI response should be in same thread');
            console.log('4. Use the debugging checklist to verify');
        } else {
            console.log('\n❌ SOME FIXES MISSING:');
            console.log('=====================');
            console.log('Please check the server.js file for missing fixes.');
        }
        
        console.log('\n📋 DEBUGGING CHECKLIST:');
        console.log('========================');
        console.log('When testing, look for these log messages:');
        console.log('1. "📧 Sending scheduling response to [email] in thread [thread]"');
        console.log('2. "✅ Scheduling response email sent! Message ID: [id], Thread ID: [thread]"');
        console.log('3. "📧 Actual Message-ID: <real-gmail-id@mail.gmail.com>"');
        console.log('');
        console.log('If you see the same Thread ID throughout and Gmail-generated Message-ID,');
        console.log('then the threading fix is working correctly! 🎯');
        
    } catch (error) {
        console.error('❌ Error verifying threading fix:', error.message);
    }
}

// Run the verification
verifyThreadingFix().catch(console.error);

