const fetch = require('node-fetch');

// Configuration
const API_BASE_URL = 'http://localhost:3000';
const USER_EMAIL = 'bob.fisit.jeff@gmail.com';

// JWT token from your localStorage
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImlhdCI6MTc2MTAxNzUxMCwiZXhwIjoxNzYzNjA5NTEwfQ.UhhXAYgm4H1Xvihplw1ix-_SktKcw8vMXgLFM5uzpw8';

// Helper function to create a workflow with 10 email nodes
async function createTestWorkflow() {
    console.log('📧 Creating test workflow with 10 email nodes...\n');

    const nodes = [];
    const connections = [];

    // Create 10 email nodes
    for (let i = 0; i < 10; i++) {
        const nodeId = `email-${Date.now()}-${i}`;
        nodes.push({
            id: nodeId,
            type: 'email',
            position: { x: 100, y: 100 + (i * 100) },
            data: {
                label: `Email ${i + 1}`
            },
            config: {
                to: USER_EMAIL,
                subject: `Threading Test - All Immediate`,
                template: `This is email ${i + 1} of 10 in the workflow. All emails sent immediately to test threading.`,
                delayType: 'immediate',
                delayValue: 0 // All emails sent immediately
            }
        });

        // Connect each node to the next one
        if (i > 0) {
            connections.push({
                from: nodes[i - 1].id,
                to: nodes[i].id
            });
        }
    }

    // Add start node
    const startNode = {
        id: `start-${Date.now()}`,
        type: 'start',
        position: { x: 100, y: 0 },
        data: { label: 'Start' }
    };

    // Connect start to first email
    connections.unshift({
        from: startNode.id,
        to: nodes[0].id
    });

    nodes.unshift(startNode);

    try {
        // Create the cadence
        const createResponse = await fetch(`${API_BASE_URL}/api/cadences/execute`, {
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

        if (!createResponse.ok) {
            throw new Error(`API request failed: ${createResponse.status} ${createResponse.statusText}`);
        }

        const result = await createResponse.json();
        console.log('✅ Workflow created and executed successfully!');
        console.log(`   Cadence ID: ${result.cadenceId}`);
        console.log(`   Emails sent: ${result.emailsSent}`);
        console.log(`\n📬 Check your inbox (${USER_EMAIL}) for the test emails`);
        console.log(`\n📝 INSTRUCTIONS:`);
        console.log(`   1. Wait for the first email to arrive`);
        console.log(`   2. Reply to the first email with a scheduling request like:`);
        console.log(`      "Hey I'd love to chat! Send me over a Gcal for a meeting at 3pm tomorrow"`);
        console.log(`   3. The background polling (every 30s) will detect your reply`);
        console.log(`   4. Remaining emails (2-10) should be cancelled`);
        console.log(`   5. Check the frontend to see cancelled badges on nodes`);
        console.log(`   6. You should receive an AI response with calendar invite IN THE SAME THREAD`);
        console.log(`\n⏰ Background polling will check for replies every 30 seconds`);

        return result.cadenceId;

    } catch (error) {
        console.error('❌ Error creating workflow:', error.message);
        throw error;
    }
}

// Run the test
console.log('🚀 REPLY CANCELLATION & AI SCHEDULING TEST');
console.log('============================================================\n');

createTestWorkflow()
    .then(() => {
        console.log('\n✅ Test setup complete!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    });
