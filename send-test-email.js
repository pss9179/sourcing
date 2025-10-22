const fetch = require('node-fetch');

// Configuration
const API_BASE_URL = 'http://localhost:3000';
const CONTACT_EMAIL = 'bob.fisit.jeff@gmail.com';

// JWT token
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImlhdCI6MTc2MTAxNzUxMCwiZXhwIjoxNzYzNjA5NTEwfQ.UhhXAYgm4H1Xvihplw1ix-_SktKcw8vMXgLFM5uzpw8';

async function sendTestEmail() {
    console.log('📧 Sending test email for AI response testing...\n');

    const nodes = [];
    const connections = [];

    // Create 3 email nodes - first immediate, rest delayed
    for (let i = 0; i < 3; i++) {
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
                subject: `AI Calendar Test`,
                template: `Hi Bob,\n\nThis is follow-up email ${i + 1}.\n\nJust checking in to see if you'd like to schedule a call!\n\nBest regards,\nSuriya`,
                delayType: i === 0 ? 'immediate' : 'seconds',
                delayValue: i === 0 ? 0 : (i * 30) // 0s, 30s, 60s
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
        const createResponse = await fetch(`${API_BASE_URL}/api/cadences/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${JWT_TOKEN}`
            },
            body: JSON.stringify({
                nodes,
                connections,
                contactIds: [1] // Bob's contact ID
            })
        });

        if (!createResponse.ok) {
            const text = await createResponse.text();
            throw new Error(`API request failed: ${createResponse.status} - ${text}`);
        }

        const result = await createResponse.json();
        console.log('✅ Email sent successfully!');
        console.log(`   Cadence ID: ${result.cadenceId}`);
        console.log(`   Emails: 1 sent immediately, 2 scheduled (30s, 60s)`);
        console.log(`\n📬 Check your inbox: ${CONTACT_EMAIL}`);
        console.log(`\n📝 WHAT TO DO:`);
        console.log(`   1. Open the email in Gmail`);
        console.log(`   2. Click REPLY`);
        console.log(`   3. Reply FROM: bob.fisit.jeff@gmail.com`);
        console.log(`   4. In your reply, type:`);
        console.log(`      "Hey I'd love to chat! Send me over a Gcal for a meeting at 3pm tomorrow"`);
        console.log(`   5. Send the reply`);
        console.log(`\n⏰ The system will:`);
        console.log(`   - Detect your reply within 30 seconds`);
        console.log(`   - Cancel the 2 pending follow-up emails`);
        console.log(`   - Send an AI response IN THE SAME THREAD`);
        console.log(`   - Create a Google Calendar invite for 3pm tomorrow`);

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

sendTestEmail();
