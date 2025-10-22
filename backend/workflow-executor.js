// Proper linked list workflow execution
// curr pointer iterates through nodes, processes them one by one
// If delay: schedule next node after delay
// If reply: set curr.next = null and mark rest as cancelled

const db = require('./database'); // We'll need to set this up

// Global storage for active workflows (so we can cancel them)
const activeWorkflows = new Map(); // cadenceId -> { curr: node, cancelFlag: false }

async function executeWorkflow(nodes, connections, startNode, userId, contact, cadenceId, user) {
    console.log(`\n🚀 Starting linked list workflow execution for cadence ${cadenceId}`);

    // Build linked list structure
    const nodeMap = new Map();
    nodes.forEach(n => nodeMap.set(n.id, { ...n, next: null }));

    // Link nodes based on connections
    connections.forEach(conn => {
        const fromNode = nodeMap.get(conn.from);
        const toNode = nodeMap.get(conn.to);
        if (fromNode && toNode) {
            fromNode.next = toNode;
        }
    });

    // Start from head (Start node)
    let curr = nodeMap.get(startNode.id);

    // Thread tracking for ALL emails in this workflow
    let threadId = null;
    let firstMessageId = null;
    let firstSubject = null;

    // Store workflow state so we can cancel it
    activeWorkflows.set(cadenceId, {
        curr,
        cancelFlag: false,
        nodeMap
    });

    // Process nodes sequentially
    while (curr) {
        // Check if workflow was cancelled
        const workflowState = activeWorkflows.get(cadenceId);
        if (workflowState && workflowState.cancelFlag) {
            console.log(`🛑 Workflow ${cadenceId} was cancelled, stopping execution`);
            break;
        }

        // Process current node
        if (['email', 'followup-email', 'followup-email2', 'new-email'].includes(curr.type)) {
            const config = curr.config || {};

            if (config.subject && config.template) {
                // Calculate delay
                let delayMs = 0;
                if (config.delayType === 'seconds') {
                    delayMs = (config.delayValue || 0) * 1000;
                } else if (config.delayType === 'minutes') {
                    delayMs = (config.delayValue || 0) * 60 * 1000;
                } else if (config.delayType === 'days') {
                    delayMs = (config.delayValue || 0) * 24 * 60 * 60 * 1000;
                }

                const processedTo = contact ? contact.email : config.to;
                const processedSubject = config.subject;
                const processedBody = config.template;

                // Store first subject for threading
                if (!firstSubject) {
                    firstSubject = processedSubject;
                }

                // Use first subject for all follow-ups
                const emailSubject = threadId ? firstSubject : processedSubject;

                console.log(`\n📧 Processing email node: ${curr.id}`);
                console.log(`   Subject: ${emailSubject}`);
                console.log(`   Delay: ${delayMs}ms`);
                console.log(`   Thread: ${threadId || 'NEW'}`);

                if (delayMs > 0) {
                    // WAIT for the delay before moving to next node
                    console.log(`   ⏰ Waiting ${delayMs}ms before sending...`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));

                    // Check again if cancelled during delay
                    const state = activeWorkflows.get(cadenceId);
                    if (state && state.cancelFlag) {
                        console.log(`🛑 Cancelled during delay`);
                        break;
                    }
                }

                // Send the email
                try {
                    const result = await sendDirectEmail(user, processedTo, emailSubject, processedBody, threadId, firstMessageId);

                    // Capture thread info from FIRST email
                    if (!threadId) {
                        threadId = result.threadId;
                        firstMessageId = result.messageId;
                        console.log(`   ✅ First email sent! Thread established: ${threadId}`);
                        console.log(`   📧 Message-ID: ${firstMessageId}`);
                    } else {
                        console.log(`   ✅ Email sent in thread: ${threadId}`);
                    }

                    // Log to database
                    await logSentEmail(userId, contact ? contact.id : null, cadenceId, result.messageId, result.threadId, emailSubject, processedTo, curr.id);

                } catch (error) {
                    console.error(`   ❌ Failed to send: ${error.message}`);
                }
            }
        }

        // Move to next node
        curr = curr.next;
    }

    // Clean up
    activeWorkflows.delete(cadenceId);
    console.log(`\n✅ Workflow ${cadenceId} completed`);

    return { threadId, firstMessageId };
}

// Cancel workflow when reply detected
function cancelWorkflow(cadenceId) {
    const workflow = activeWorkflows.get(cadenceId);
    if (!workflow) {
        console.log(`⚠️  Workflow ${cadenceId} not found or already completed`);
        return;
    }

    console.log(`\n🛑 CANCELLING WORKFLOW ${cadenceId}`);

    // Set cancel flag
    workflow.cancelFlag = true;

    // Mark all remaining nodes as cancelled
    let curr = workflow.curr;
    const cancelledNodes = [];

    while (curr && curr.next) {
        cancelledNodes.push(curr.next.id);
        curr = curr.next;
    }

    console.log(`   📝 Marking ${cancelledNodes.length} nodes as cancelled: ${cancelledNodes.join(', ')}`);

    // Cut off the linked list
    if (workflow.curr) {
        workflow.curr.next = null;
        console.log(`   ✂️  Cut off linked list at current node`);
    }
}

module.exports = {
    executeWorkflow,
    cancelWorkflow,
    activeWorkflows
};
