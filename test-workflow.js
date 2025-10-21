#!/usr/bin/env node

const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3000';
const AUTH_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImlhdCI6MTc2MTAxNzUxMCwiZXhwIjoxNzYzNjA5NTEwfQ.UhhXAYgm4H1Xvihplw1ix-_SktKcw8vMXgLFM5uzpw8'; // Update this with a valid token

const TEST_EMAIL = 'bob.fisit.jeff@gmail.com';

// Helper to wait
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to make authenticated requests
async function apiRequest(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${AUTH_TOKEN}`,
            'Content-Type': 'application/json'
        }
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(`${BASE_URL}${endpoint}`, options);
    if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

// Test 1: Email threading - all emails should be in same thread
async function testEmailThreading() {
    console.log('\n🧪 TEST 1: Email Threading');
    console.log('=' .repeat(60));

    const workflow = {
        nodes: [
            {
                id: 'node-start',
                type: 'start',
                title: 'Start'
            },
            {
                id: 'node-email-1',
                type: 'email',
                title: 'Email 1',
                config: {
                    to: TEST_EMAIL,
                    subject: 'Threading Test',
                    template: 'This is the first email',
                    delayType: 'immediate'
                }
            },
            {
                id: 'node-email-2',
                type: 'email',
                title: 'Email 2',
                config: {
                    to: TEST_EMAIL,
                    subject: 'Different Subject', // Should be ignored
                    template: 'This is the second email (should be in same thread)',
                    delayType: 'seconds',
                    delayValue: 3
                }
            }
        ],
        connections: [
            { from: 'node-start', to: 'node-email-1' },
            { from: 'node-email-1', to: 'node-email-2' }
        ]
    };

    // Save workflow
    const savedWorkflow = await apiRequest('/api/cadences', 'POST', {
        name: 'Threading Test',
        nodes: workflow.nodes,
        connections: workflow.connections
    });

    console.log(`✅ Created workflow with ID: ${savedWorkflow.id}`);

    // Run workflow
    await apiRequest(`/api/cadences/execute`, 'POST', {
        nodes: workflow.nodes,
        connections: workflow.connections,
        contactIds: []
    });
    console.log('✅ Workflow execution started');

    // Check status immediately
    await sleep(1000);
    let status = await apiRequest(`/api/cadences/${savedWorkflow.id}/execution-status`);
    console.log('\n📊 Initial Status:');
    status.emails.forEach(email => {
        console.log(`   Node ${email.nodeId}: ${email.status}`);
    });

    // Expected: Email 1 = SENT, Email 2 = PENDING
    const email1Status = status.emails.find(e => e.nodeId === 'node-email-1');
    const email2Status = status.emails.find(e => e.nodeId === 'node-email-2');

    if (email1Status?.status === 'sent' && email2Status?.status === 'pending') {
        console.log('✅ PASS: Email 1 is SENT, Email 2 is PENDING');
    } else {
        console.log(`❌ FAIL: Expected Email 1=sent, Email 2=pending. Got Email 1=${email1Status?.status}, Email 2=${email2Status?.status}`);
    }

    // Wait for second email to send
    console.log('\n⏳ Waiting 5 seconds for second email to send...');
    await sleep(5000);

    status = await apiRequest(`/api/cadences/${savedWorkflow.id}/execution-status`);
    console.log('\n📊 Final Status:');
    status.emails.forEach(email => {
        console.log(`   Node ${email.nodeId}: ${email.status}`);
    });

    const email2Final = status.emails.find(e => e.nodeId === 'node-email-2');
    if (email2Final?.status === 'sent') {
        console.log('✅ PASS: Email 2 is now SENT');
    } else {
        console.log(`❌ FAIL: Expected Email 2=sent. Got ${email2Final?.status}`);
    }

    // Check email logs to verify threading
    const logs = await apiRequest(`/api/email-logs?cadence_id=${savedWorkflow.id}`);
    console.log('\n📧 Email Logs:');
    logs.forEach(log => {
        console.log(`   ${log.subject} - Thread: ${log.thread_id}`);
    });

    if (logs.length === 2 && logs[0].thread_id === logs[1].thread_id) {
        console.log('✅ PASS: Both emails are in the same thread');
    } else {
        console.log('❌ FAIL: Emails are NOT in the same thread');
    }

    // Check subjects
    if (logs[0].subject && !logs[0].subject.startsWith('Re:')) {
        console.log('✅ PASS: First email does NOT have "Re:" prefix');
    } else {
        console.log('❌ FAIL: First email incorrectly has "Re:" prefix');
    }

    if (logs[1].subject && logs[1].subject.startsWith('Re:')) {
        console.log('✅ PASS: Second email has "Re:" prefix');
    } else {
        console.log('❌ FAIL: Second email missing "Re:" prefix');
    }

    return savedWorkflow.id;
}

// Test 2: Workflow breaking on reply
async function testWorkflowBreaking() {
    console.log('\n🧪 TEST 2: Workflow Breaking on Reply');
    console.log('=' .repeat(60));

    const workflow = {
        nodes: [
            {
                id: 'node-start',
                type: 'start',
                title: 'Start'
            },
            ...Array.from({ length: 5 }, (_, i) => ({
                id: `node-email-${i + 1}`,
                type: 'email',
                title: `Email ${i + 1}`,
                config: {
                    to: TEST_EMAIL,
                    subject: 'Reply Test',
                    template: `This is email ${i + 1}`,
                    delayType: 'seconds',
                    delayValue: (i + 1) * 5 // 5s, 10s, 15s, 20s, 25s
                }
            }))
        ],
        connections: [
            { from: 'node-start', to: 'node-email-1' },
            ...Array.from({ length: 4 }, (_, i) => ({
                from: `node-email-${i + 1}`,
                to: `node-email-${i + 2}`
            }))
        ]
    };

    // Save workflow
    const savedWorkflow = await apiRequest('/api/cadences', 'POST', {
        name: 'Reply Breaking Test',
        nodes: workflow.nodes,
        connections: workflow.connections
    });

    console.log(`✅ Created workflow with ID: ${savedWorkflow.id}`);

    // Run workflow
    await apiRequest(`/api/cadences/execute`, 'POST', {
        nodes: workflow.nodes,
        connections: workflow.connections,
        contactIds: []
    });
    console.log('✅ Workflow execution started');

    // Wait for first 2 emails
    await sleep(12000);

    let status = await apiRequest(`/api/cadences/${savedWorkflow.id}/execution-status`);
    console.log('\n📊 Status after 12 seconds:');
    status.emails.forEach(email => {
        console.log(`   Node ${email.nodeId}: ${email.status}`);
    });

    // Expected: Email 1-2 = SENT, Email 3-5 = PENDING
    const sentCount = status.emails.filter(e => e.status === 'sent').length;
    const pendingCount = status.emails.filter(e => e.status === 'pending').length;

    if (sentCount === 2 && pendingCount === 3) {
        console.log('✅ PASS: 2 emails SENT, 3 emails PENDING');
    } else {
        console.log(`❌ FAIL: Expected 2 sent, 3 pending. Got ${sentCount} sent, ${pendingCount} pending`);
    }

    console.log('\n📧 NOTE: To test workflow breaking, manually reply to one of the emails in Gmail');
    console.log('   Then run the reply detection check and verify remaining emails are cancelled');
    console.log('   This requires manual interaction with Gmail, so skipping automated test');

    return savedWorkflow.id;
}

// Test 3: Immediate vs delayed sending
async function testImmediateVsDelayed() {
    console.log('\n🧪 TEST 3: Immediate vs Delayed Sending');
    console.log('=' .repeat(60));

    const workflow = {
        nodes: [
            {
                id: 'node-start',
                type: 'start',
                title: 'Start'
            },
            {
                id: 'node-email-1',
                type: 'email',
                title: 'Immediate Email',
                config: {
                    to: TEST_EMAIL,
                    subject: 'Immediate Test',
                    template: 'This sends immediately',
                    delayType: 'immediate'
                }
            },
            {
                id: 'node-email-2',
                type: 'email',
                title: 'Delayed Email',
                config: {
                    to: TEST_EMAIL,
                    subject: 'Delayed Test',
                    template: 'This sends after 10 seconds',
                    delayType: 'seconds',
                    delayValue: 10
                }
            }
        ],
        connections: [
            { from: 'node-start', to: 'node-email-1' },
            { from: 'node-email-1', to: 'node-email-2' }
        ]
    };

    const savedWorkflow = await apiRequest('/api/cadences', 'POST', {
        name: 'Immediate vs Delayed Test',
        nodes: workflow.nodes,
        connections: workflow.connections
    });

    console.log(`✅ Created workflow with ID: ${savedWorkflow.id}`);

    await apiRequest(`/api/cadences/${savedWorkflow.id}/execute`, 'POST');
    console.log('✅ Workflow execution started');

    // Check immediately
    await sleep(1000);
    let status = await apiRequest(`/api/cadences/${savedWorkflow.id}/execution-status`);
    console.log('\n📊 Status immediately after execution:');
    status.emails.forEach(email => {
        console.log(`   Node ${email.nodeId}: ${email.status}`);
    });

    const immediate = status.emails.find(e => e.nodeId === 'node-email-1');
    const delayed = status.emails.find(e => e.nodeId === 'node-email-2');

    if (immediate?.status === 'sent' && delayed?.status === 'pending') {
        console.log('✅ PASS: Immediate email is SENT, Delayed email is PENDING');
    } else {
        console.log(`❌ FAIL: Expected immediate=sent, delayed=pending. Got immediate=${immediate?.status}, delayed=${delayed?.status}`);
    }

    // Wait for delayed email
    console.log('\n⏳ Waiting 12 seconds for delayed email...');
    await sleep(12000);

    status = await apiRequest(`/api/cadences/${savedWorkflow.id}/execution-status`);
    console.log('\n📊 Status after delay:');
    status.emails.forEach(email => {
        console.log(`   Node ${email.nodeId}: ${email.status}`);
    });

    const delayedFinal = status.emails.find(e => e.nodeId === 'node-email-2');
    if (delayedFinal?.status === 'sent') {
        console.log('✅ PASS: Delayed email is now SENT');
    } else {
        console.log(`❌ FAIL: Expected delayed=sent. Got ${delayedFinal?.status}`);
    }

    return savedWorkflow.id;
}

// Main test runner
async function runAllTests() {
    console.log('\n🚀 STARTING AUTOMATED WORKFLOW TESTS');
    console.log('=' .repeat(60));
    console.log(`Using email: ${TEST_EMAIL}`);
    console.log(`Base URL: ${BASE_URL}`);

    try {
        // Verify server is running
        await fetch(`${BASE_URL}/api/health`);
        console.log('✅ Server is running');
    } catch (error) {
        console.error('❌ Server is not running. Please start the server first.');
        process.exit(1);
    }

    const results = {
        threading: null,
        breaking: null,
        timing: null
    };

    try {
        results.threading = await testEmailThreading();
    } catch (error) {
        console.error('❌ Threading test failed:', error.message);
    }

    await sleep(2000);

    try {
        results.breaking = await testWorkflowBreaking();
    } catch (error) {
        console.error('❌ Breaking test failed:', error.message);
    }

    await sleep(2000);

    try {
        results.timing = await testImmediateVsDelayed();
    } catch (error) {
        console.error('❌ Timing test failed:', error.message);
    }

    console.log('\n' + '=' .repeat(60));
    console.log('📋 TEST SUMMARY');
    console.log('=' .repeat(60));
    console.log(`Threading Test: ${results.threading ? '✅ Completed' : '❌ Failed'}`);
    console.log(`Breaking Test: ${results.breaking ? '✅ Completed' : '❌ Failed'}`);
    console.log(`Timing Test: ${results.timing ? '✅ Completed' : '❌ Failed'}`);
    console.log('\n💡 Check your email inbox to verify threading visually');
    console.log('💡 Check the server logs for detailed execution info');
}

// Run tests
runAllTests().catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
});
