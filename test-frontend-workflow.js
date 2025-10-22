const fetch = require('node-fetch');

// Configuration
const API_BASE_URL = 'http://localhost:3000';
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImlhdCI6MTc2MTAxNzUxMCwiZXhwIjoxNzYzNjA5NTEwfQ.UhhXAYgm4H1Xvihplw1ix-_SktKcw8vMXgLFM5uzpw8';

async function testFrontendWorkflow() {
    console.log('🧪 Testing frontend workflow (mimicking /api/workflow/run)...\n');

    // Create a simple workflow like the frontend does
    const timestamp = Date.now();
    const nodes = [
        {
            id: `node-1`,
            type: 'start',
            position: { x: 100, y: 50 },
            data: { label: 'Start' }
        },
        {
            id: `node-2`,
            type: 'email',
            position: { x: 100, y: 150 },
            data: { label: 'Test Email' },
            config: {
                to: 'sg.suriya.v@gmail.com',
                subject: 'Frontend Test',
                template: 'This is a test from frontend workflow',
                delayType: 'immediate',
                delayValue: 0
            }
        }
    ];

    const connections = [
        { from: 'node-1', to: 'node-2' }
    ];

    console.log('📤 Sending workflow to /api/workflow/run...');
    console.log(`   Nodes: ${nodes.length}`);
    console.log(`   Connections: ${connections.length}`);
    console.log(`   Email config:`, nodes[1].config);

    try {
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

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`API request failed: ${response.status} - ${text}`);
        }

        const result = await response.json();
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

        console.log(`\n📧 Check your Gmail inbox: sg.suriya.v@gmail.com`);
        console.log(`   If you DON'T see the email, then the bug is reproduced!`);

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

console.log('🔧 FRONTEND WORKFLOW DEBUG TEST');
console.log('================================================\n');
console.log('This script mimics exactly what the frontend does');
console.log('when you click "Run Workflow"\n');

testFrontendWorkflow()
    .then(() => {
        console.log('\n✅ Test complete!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    });
