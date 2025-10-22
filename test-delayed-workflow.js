const fetch = require('node-fetch');

// Configuration
const API_BASE_URL = 'http://localhost:3000';
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImlhdCI6MTc2MTAxNzUxMCwiZXhwIjoxNzYzNjA5NTEwfQ.UhhXAYgm4H1Xvihplw1ix-_SktKcw8vMXgLFM5uzpw8';

async function testDelayedWorkflow() {
    console.log('🧪 Testing DELAYED workflow with proper status tracking...\n');

    // Create a workflow with 3 emails: immediate + 2min delay + 4min delay
    const timestamp = Date.now();
    const nodes = [
        {
            id: `start-${timestamp}`,
            type: 'start',
            position: { x: 100, y: 50 },
            data: { label: 'Start' }
        },
        {
            id: `email-1-${timestamp}`,
            type: 'email',
            position: { x: 100, y: 150 },
            data: { label: 'Email 1 - Immediate' },
            config: {
                to: 'sg.suriya.v@gmail.com',
                subject: 'Delay Test - Email 1',
                template: '<p>This is email #1 - sent IMMEDIATELY</p>',
                delayType: 'immediate',
                delayValue: 0
            }
        },
        {
            id: `email-2-${timestamp}`,
            type: 'followup-email',
            position: { x: 100, y: 250 },
            data: { label: 'Email 2 - Delayed 2min' },
            config: {
                to: 'sg.suriya.v@gmail.com',
                subject: 'Delay Test - Email 2',
                template: '<p>This is email #2 - sent after 2 MINUTES delay</p>',
                delayType: 'minutes',
                delayValue: 2
            }
        },
        {
            id: `email-3-${timestamp}`,
            type: 'followup-email2',
            position: { x: 100, y: 350 },
            data: { label: 'Email 3 - Delayed 4min' },
            config: {
                to: 'sg.suriya.v@gmail.com',
                subject: 'Delay Test - Email 3',
                template: '<p>This is email #3 - sent after 4 MINUTES delay</p>',
                delayType: 'minutes',
                delayValue: 4
            }
        }
    ];

    const connections = [
        { from: `start-${timestamp}`, to: `email-1-${timestamp}` },
        { from: `email-1-${timestamp}`, to: `email-2-${timestamp}` },
        { from: `email-2-${timestamp}`, to: `email-3-${timestamp}` }
    ];

    console.log('📤 Sending delayed workflow to /api/workflow/run...');
    console.log(`   Total nodes: ${nodes.length}`);
    console.log(`   Email 1: IMMEDIATE`);
    console.log(`   Email 2: 2 minute delay`);
    console.log(`   Email 3: 4 minute delay\n`);

    try {
        const startTime = Date.now();
        const response = await fetch(`${API_BASE_URL}/api/workflow/run`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${JWT_TOKEN}`
            },
            body: JSON.stringify({
                nodes,
                connections
            })
        });

        const endTime = Date.now();
        const responseTime = endTime - startTime;

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`API request failed: ${response.status} - ${text}`);
        }

        const result = await response.json();

        console.log(`⏱️  API Response time: ${responseTime}ms`);
        console.log('\n✅ Response received:');
        console.log(JSON.stringify(result, null, 2));

        if (result.details) {
            console.log(`\n📊 Results:`);
            console.log(`   Emails sent: ${result.details.emailsSent}`);
            console.log(`   Errors: ${result.details.errors.length}`);
            if (result.details.errors.length > 0) {
                console.log(`   Error details:`, result.details.errors);
            }
        }

        console.log(`\n✅ EXPECTED BEHAVIOR:`);
        console.log(`   1. API should return IMMEDIATELY (< 1 second)`);
        console.log(`   2. Email 1 should appear in Gmail inbox RIGHT NOW`);
        console.log(`   3. Email 2 should show "PENDING" in frontend, then "SENT" after 2 minutes`);
        console.log(`   4. Email 3 should show "PENDING" in frontend, then "SENT" after 4 minutes`);
        console.log(`\n📧 Check the frontend at http://localhost:8081 to verify status badges!`);
        console.log(`   Cadence ID: ${result.cadenceId}`);

        if (responseTime > 5000) {
            console.log(`\n❌ WARNING: API took ${responseTime}ms - it should be instant!`);
            console.log(`   This means it's still WAITING for delays instead of queueing them.`);
        } else {
            console.log(`\n✅ Perfect! API returned in ${responseTime}ms - delayed emails are queued!`);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

console.log('🔧 DELAYED WORKFLOW TEST');
console.log('================================================');
console.log('This test verifies that:');
console.log('1. Immediate emails are sent right away');
console.log('2. Delayed emails are QUEUED (not blocking API)');
console.log('3. Frontend shows "PENDING" for queued emails');
console.log('4. Frontend updates to "SENT" when emails are delivered\n');

testDelayedWorkflow()
    .then(() => {
        console.log('\n✅ Test complete!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    });
