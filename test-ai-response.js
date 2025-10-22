const fetch = require('node-fetch');

// Configuration
const API_BASE_URL = 'http://localhost:3000';
const CONTACT_EMAIL = 'bob.fisit.jeff@gmail.com';
const CONTACT_ID = 1; // From the database

// JWT token from your localStorage
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImlhdCI6MTc2MTAxNzUxMCwiZXhwIjoxNzYzNjA5NTEwfQ.UhhXAYgm4H1Xvihplw1ix-_SktKcw8vMXgLFM5uzpw8';

async function createAITestWorkflow() {
    console.log('🤖 Creating AI Response Test Workflow...\n');

    const nodes = [];
    const connections = [];

    // Create 5 email nodes with delays
    for (let i = 0; i < 5; i++) {
        const nodeId = `email-${Date.now()}-${i}`;
        nodes.push({
            id: nodeId,
            type: 'email',
            position: { x: 100, y: 100 + (i * 100) },
            data: {
                label: `Email ${i + 1}`
            },
            config: {
                to: CONTACT_EMAIL,
                subject: `AI Response Test - Follow Up ${i + 1}`,
                template: `Hi Bob,\n\nThis is follow-up email ${i + 1}. Just checking in!\n\nBest regards`,
                delayType: i === 0 ? 'immediate' : 'seconds',
                delayValue: i === 0 ? 0 : (i * 10) // 0s, 10s, 20s, 30s, 40s
            }
        });

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

    connections.unshift({
        from: startNode.id,
        to: nodes[0].id
    });

    nodes.unshift(startNode);

    try {
        // Execute the workflow WITH contact ID
        const createResponse = await fetch(`${API_BASE_URL}/api/cadences/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${JWT_TOKEN}`
            },
            body: JSON.stringify({
                nodes,
                connections,
                contactIds: [CONTACT_ID] // Include contact ID so emails are tracked
            })
        });

        if (!createResponse.ok) {
            throw new Error(`API request failed: ${createResponse.status} ${createResponse.statusText}`);
        }

        const result = await createResponse.json();
        console.log('✅ Workflow created and executed successfully!');
        console.log(`   Cadence ID: ${result.cadenceId}`);
        console.log(`   Emails sent: ${result.emailsSent}`);
        console.log(`\n📬 Check your inbox (${CONTACT_EMAIL})`);
        console.log(`\n📝 TESTING INSTRUCTIONS:`);
        console.log(`   1. Wait for the first email to arrive`);
        console.log(`   2. Reply FROM a different email address (not sg.suriya.v@gmail.com)`);
        console.log(`   3. In your reply, say:`);
        console.log(`      "Hey I'd love to chat! Send me over a Gcal for a meeting at 3pm tomorrow"`);
        console.log(`   4. Wait ~30 seconds for background polling to detect your reply`);
        console.log(`   5. The AI should:`);
        console.log(`      - Cancel remaining emails (2-5)`);
        console.log(`      - Send a response IN THE SAME THREAD`);
        console.log(`      - Create a Google Calendar invite`);
        console.log(`\n⚠️  IMPORTANT: Reply must come from a DIFFERENT email than sg.suriya.v@gmail.com`);
        console.log(`   Otherwise the system will skip it as "from self"`);

        return result.cadenceId;

    } catch (error) {
        console.error('❌ Error creating workflow:', error.message);
        throw error;
    }
}

console.log('🚀 AI RESPONSE & CALENDAR SCHEDULING TEST');
console.log('============================================================\n');

createAITestWorkflow()
    .then(() => {
        console.log('\n✅ Test setup complete!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    });
