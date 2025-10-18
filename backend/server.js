const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const OpenAI = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: 'http://localhost:8080', // Frontend URL
    credentials: true
}));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// Database setup
const db = new sqlite3.Database('./cadenceflow.db');

// Initialize database tables
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        google_id TEXT UNIQUE,
        email TEXT UNIQUE,
        name TEXT,
        picture TEXT,
        access_token TEXT,
        refresh_token TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Cadences table
    db.run(`CREATE TABLE IF NOT EXISTS cadences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT,
        nodes TEXT, -- JSON string of workflow nodes
        connections TEXT, -- JSON string of connections
        is_active BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Contacts table
    db.run(`CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        email TEXT,
        name TEXT,
        company TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Email queue table
    db.run(`CREATE TABLE IF NOT EXISTS email_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        contact_id INTEGER,
        cadence_id INTEGER,
        node_id TEXT,
        subject TEXT,
        template TEXT,
        scheduled_for DATETIME,
        sent_at DATETIME,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (contact_id) REFERENCES contacts (id),
        FOREIGN KEY (cadence_id) REFERENCES cadences (id)
    )`);
});

// Initialize API clients
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Pinecone only if API key is available
let pinecone = null;
if (process.env.PINECONE_API_KEY) {
    pinecone = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY,
    });
}

// VAPI API configuration
const VAPI_BASE_URL = process.env.VAPI_BASE_URL || 'https://api.vapi.ai';
const VAPI_PRIVATE_KEY = process.env.VAPI_PRIVATE_KEY;

// Google OAuth configuration
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_REDIRECT_URI || "/auth/google/callback",
    accessType: 'offline',
    prompt: 'consent'
}, async (accessToken, refreshToken, profile, done) => {
    try {
        console.log('\n🔐 Google OAuth Strategy Callback');
        console.log('   Profile ID:', profile.id);
        console.log('   Email:', profile.emails[0].value);
        console.log('   Access Token received:', !!accessToken);
        console.log('   Refresh Token received:', !!refreshToken);
        
        if (!refreshToken) {
            console.warn('⚠️  WARNING: No refresh token received from Google!');
            console.warn('   This may happen if user already authorized the app.');
            console.warn('   User needs to revoke access and re-authorize.');
        }
        
        // Check if user exists
        const existingUser = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM users WHERE google_id = ?", [profile.id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (existingUser) {
            console.log('   Updating existing user...');
            // Update tokens - only update refresh_token if we got one
            const updateQuery = refreshToken 
                ? "UPDATE users SET access_token = ?, refresh_token = ? WHERE google_id = ?"
                : "UPDATE users SET access_token = ? WHERE google_id = ?";
            const updateParams = refreshToken 
                ? [accessToken, refreshToken, profile.id]
                : [accessToken, profile.id];
                
            await new Promise((resolve, reject) => {
                db.run(updateQuery, updateParams, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
            });
            console.log('   ✅ User updated');
            return done(null, existingUser);
        } else {
            console.log('   Creating new user...');
            // Create new user
            const newUser = await new Promise((resolve, reject) => {
                db.run("INSERT INTO users (google_id, email, name, picture, access_token, refresh_token) VALUES (?, ?, ?, ?, ?, ?)",
                    [profile.id, profile.emails[0].value, profile.displayName, profile.photos[0].value, accessToken, refreshToken],
                    function(err) {
                        if (err) reject(err);
                        else resolve({ 
                            id: this.lastID, 
                            google_id: profile.id, 
                            email: profile.emails[0].value, 
                            name: profile.displayName, 
                            picture: profile.photos[0].value,
                            access_token: accessToken,
                            refresh_token: refreshToken
                        });
                    });
            });
            console.log('   ✅ New user created');
            return done(null, newUser);
        }
    } catch (error) {
        return done(error, null);
    }
}));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser((id, done) => {
    db.get("SELECT * FROM users WHERE id = ?", [id], (err, user) => {
        if (err) {
            return done(err, null);
        }
        if (!user) {
            return done(null, false);
        }
        return done(null, user);
    });
});

// Routes

// Auth routes
app.get('/auth/google', passport.authenticate('google', { 
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/gmail.send'],
    accessType: 'offline',
    prompt: 'consent'
}));

app.get('/auth/google/callback', 
    passport.authenticate('google', { failureRedirect: 'http://localhost:8080/login' }),
    (req, res) => {
        // Generate JWT token
        const token = jwt.sign({ userId: req.user.id }, process.env.JWT_SECRET || 'your-secret-key');
        res.redirect(`http://localhost:8080/?token=${token}`);
    }
);

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

// API Routes

// Get user profile
app.get('/api/user', authenticateToken, (req, res) => {
    db.get("SELECT id, email, name, picture FROM users WHERE id = ?", [req.user.userId], (err, user) => {
        if (err) {
            res.status(500).json({ error: 'Database error' });
        } else {
            res.json(user);
        }
    });
});

// Save cadence
app.post('/api/cadences', authenticateToken, (req, res) => {
    const { name, nodes, connections } = req.body;
    
    db.run("INSERT INTO cadences (user_id, name, nodes, connections) VALUES (?, ?, ?, ?)",
        [req.user.userId, name, JSON.stringify(nodes), JSON.stringify(connections)],
        function(err) {
            if (err) {
                res.status(500).json({ error: 'Failed to save cadence' });
            } else {
                res.json({ id: this.lastID, message: 'Cadence saved successfully' });
            }
        });
});

// Get user's cadences
app.get('/api/cadences', authenticateToken, (req, res) => {
    db.all("SELECT * FROM cadences WHERE user_id = ? ORDER BY created_at DESC", [req.user.userId], (err, cadences) => {
        if (err) {
            res.status(500).json({ error: 'Database error' });
        } else {
            const parsedCadences = cadences.map(cadence => ({
                ...cadence,
                nodes: JSON.parse(cadence.nodes),
                connections: JSON.parse(cadence.connections)
            }));
            res.json(parsedCadences);
        }
    });
});

// Add contact
app.post('/api/contacts', authenticateToken, (req, res) => {
    const { email, name, company } = req.body;
    
    db.run("INSERT INTO contacts (user_id, email, name, company) VALUES (?, ?, ?, ?)",
        [req.user.userId, email, name, company],
        function(err) {
            if (err) {
                res.status(500).json({ error: 'Failed to add contact' });
            } else {
                res.json({ id: this.lastID, message: 'Contact added successfully' });
            }
        });
});

// Get contacts
app.get('/api/contacts', authenticateToken, (req, res) => {
    db.all("SELECT * FROM contacts WHERE user_id = ? ORDER BY created_at DESC", [req.user.userId], (err, contacts) => {
        if (err) {
            res.status(500).json({ error: 'Database error' });
        } else {
            res.json(contacts);
        }
    });
});

// Delete contact
app.delete('/api/contacts/:id', authenticateToken, (req, res) => {
    const contactId = req.params.id;
    
    db.run("DELETE FROM contacts WHERE id = ? AND user_id = ?", [contactId, req.user.userId], function(err) {
        if (err) {
            res.status(500).json({ error: 'Database error' });
        } else if (this.changes === 0) {
            res.status(404).json({ error: 'Contact not found' });
        } else {
            res.json({ message: 'Contact deleted successfully' });
        }
    });
});

// Run workflow directly (new simplified endpoint)
app.post('/api/workflow/run', authenticateToken, async (req, res) => {
    const { nodes, connections } = req.body;
    
    console.log('\n🚀 RUNNING WORKFLOW');
    console.log(`   User ID: ${req.user.userId}`);
    console.log(`   Nodes: ${nodes.length}`);
    console.log(`   Connections: ${connections.length}`);
    
    // Validate workflow
    const startNode = nodes.find(node => node.type === 'start');
    if (!startNode) {
        return res.status(400).json({ error: 'Workflow must have a Start node' });
    }
    
    // Process workflow from start node
    try {
        const results = await processWorkflowExecution(nodes, connections, startNode, req.user.userId);
        
        res.json({ 
            success: true,
            message: `Workflow executed! ${results.emailsSent} email(s) sent successfully.`,
            details: results
        });
    } catch (error) {
        console.error('❌ Workflow execution error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Execute cadence with current workflow (no save required)
app.post('/api/cadences/execute', authenticateToken, (req, res) => {
    const { nodes, connections, contactIds } = req.body;
    
    console.log('\n🚀 EXECUTING CADENCE FROM CURRENT WORKFLOW');
    console.log(`   User ID: ${req.user.userId}`);
    console.log(`   Nodes: ${nodes.length}`);
    console.log(`   Connections: ${connections.length}`);
    console.log(`   Contacts: ${contactIds.length}`);
    
    // Validate workflow
    const startNode = nodes.find(node => node.type === 'start');
    if (!startNode) {
        return res.status(400).json({ error: 'Workflow must have a Start node' });
    }
    
    const hasEmailNode = nodes.some(node => 
        node.type === 'email' || node.type === 'followup-email' || 
        node.type === 'followup-email2' || node.type === 'new-email'
    );
    if (!hasEmailNode) {
        return res.status(400).json({ error: 'Workflow must have at least one Email node' });
    }
    
    let totalEmailsScheduled = 0;
    
    // Schedule emails for each contact
    contactIds.forEach(contactId => {
        console.log(`\n📋 Scheduling cadence for contact ${contactId}...`);
        const emailCount = scheduleCadenceForContact(null, contactId, nodes, connections, startNode, req.user.userId);
        totalEmailsScheduled += emailCount;
    });
    
    console.log(`\n✅ Total emails scheduled: ${totalEmailsScheduled}`);
    
    // Process immediate emails (0-day delays)
    setTimeout(() => {
        processEmailsImmediately();
    }, 1000);
    
    res.json({ 
        message: 'Cadence started successfully',
        emailsScheduled: totalEmailsScheduled
    });
});

// Start cadence execution (for saved cadences)
app.post('/api/cadences/:id/start', authenticateToken, (req, res) => {
    const cadenceId = req.params.id;
    const { contactIds } = req.body;
    
    // Get cadence details
    db.get("SELECT * FROM cadences WHERE id = ? AND user_id = ?", [cadenceId, req.user.userId], (err, cadence) => {
        if (err || !cadence) {
            return res.status(404).json({ error: 'Cadence not found' });
        }
        
        const nodes = JSON.parse(cadence.nodes);
        const connections = JSON.parse(cadence.connections);
        
        // Find start node
        const startNode = nodes.find(node => node.type === 'start');
        if (!startNode) {
            return res.status(400).json({ error: 'Cadence must start with a start node' });
        }
        
        // Schedule emails for each contact
        contactIds.forEach(contactId => {
            scheduleCadenceForContact(cadenceId, contactId, nodes, connections, startNode, req.user.userId);
        });
        
        // Process immediate emails (0-day delays)
        setTimeout(() => {
            processEmailsImmediately();
        }, 1000); // Wait 1 second for emails to be queued
        
        res.json({ message: 'Cadence started successfully' });
    });
});

// New simplified workflow execution
async function processWorkflowExecution(nodes, connections, startNode, userId) {
    const results = { emailsSent: 0, errors: [] };
    
    // Get user for email sending
    const user = await new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE id = ?", [userId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
    
    if (!user || !user.access_token) {
        throw new Error('User not authenticated with Google');
    }
    
    // Process workflow from start node
    const visited = new Set();
    
    async function processNode(currentNode, delay = 0) {
        if (visited.has(currentNode.id)) return;
        visited.add(currentNode.id);
        
        // If it's an email node, send the email
        if (['email', 'followup-email', 'followup-email2', 'new-email'].includes(currentNode.type)) {
            const config = currentNode.config || {};
            
            if (config.to && config.subject && config.template) {
                try {
                    console.log(`\n📧 Sending email from node: ${currentNode.title}`);
                    console.log(`   To: ${config.to}`);
                    console.log(`   Subject: ${config.subject}`);
                    console.log(`   Delay: ${delay} days`);
                    
                    // If delay is 0, send immediately
                    if (delay === 0) {
                        await sendDirectEmail(user, config.to, config.subject, config.template);
                        results.emailsSent++;
                        console.log(`   ✅ Email sent immediately`);
                    } else {
                        // Schedule for future (days from now)
                        const scheduledDate = new Date();
                        scheduledDate.setDate(scheduledDate.getDate() + delay);
                        console.log(`   ⏰ Scheduled for ${delay} days from now (${scheduledDate.toLocaleString()})`);
                        
                        // Store in a simple queue (you could use a proper job queue in production)
                        setTimeout(async () => {
                            try {
                                await sendDirectEmail(user, config.to, config.subject, config.template);
                                console.log(`   ✅ Scheduled email sent to ${config.to}`);
                            } catch (error) {
                                console.error(`   ❌ Failed to send scheduled email: ${error.message}`);
                            }
                        }, delay * 24 * 60 * 60 * 1000); // Convert days to milliseconds
                        
                        results.emailsSent++;
                    }
                } catch (error) {
                    console.error(`❌ Failed to send email: ${error.message}`);
                    results.errors.push(error.message);
                }
            }
        }
        
        // Process connected nodes
        const outgoing = connections.filter(conn => conn.from === currentNode.id);
        for (const connection of outgoing) {
            const nextNode = nodes.find(n => n.id === connection.to);
            if (nextNode) {
                const nodeDelay = currentNode.config?.delay || 0;
                await processNode(nextNode, delay + nodeDelay);
            }
        }
    }
    
    await processNode(startNode);
    return results;
}

// Send email directly using Gmail API
async function sendDirectEmail(user, to, subject, body) {
    const { google } = require('googleapis');
    
    // Create OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    
    oauth2Client.setCredentials({
        access_token: user.access_token,
        refresh_token: user.refresh_token
    });
    
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    // Create email
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const messageParts = [
        `From: ${user.email}`,
        `To: ${to}`,
        `Subject: ${utf8Subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=utf-8',
        '',
        body
    ];
    const message = messageParts.join('\n');
    
    // Encode message
    const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    
    // Send email
    const result = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
            raw: encodedMessage
        }
    });
    
    console.log(`   ✅ Email sent! Message ID: ${result.data.id}`);
    return result.data;
}

// Function to schedule cadence for a contact
function scheduleCadenceForContact(cadenceId, contactId, nodes, connections, startNode, userId) {
    // Get contact details
    db.get("SELECT * FROM contacts WHERE id = ? AND user_id = ?", [contactId, userId], (err, contact) => {
        if (err || !contact) {
            console.error('Contact not found:', err);
            return 0;
        }
        
        console.log(`✅ Scheduling cadence for contact: ${contact.name} (${contact.email})`);
        
        // Process the entire workflow starting from the start node
        const emailCount = processWorkflowFromNode(cadenceId, contactId, nodes, connections, startNode, userId, 0);
        console.log(`   → ${emailCount} emails scheduled for this contact`);
        return emailCount;
    });
    
    // Count emails in the workflow
    let emailCount = 0;
    const countEmails = (currentNode, visited = new Set()) => {
        if (visited.has(currentNode.id)) return;
        visited.add(currentNode.id);
        
        if (currentNode.type === 'email' || currentNode.type === 'followup-email' || 
            currentNode.type === 'followup-email2' || currentNode.type === 'new-email') {
            emailCount++;
        }
        
        const outgoing = connections.filter(conn => conn.from === currentNode.id);
        outgoing.forEach(conn => {
            const nextNode = nodes.find(n => n.id === conn.to);
            if (nextNode) countEmails(nextNode, visited);
        });
    };
    countEmails(startNode);
    return emailCount;
}

// Recursive function to process workflow from a given node
function processWorkflowFromNode(cadenceId, contactId, nodes, connections, currentNode, userId, currentDelay, visited = new Set()) {
    // Prevent infinite loops
    if (visited.has(currentNode.id)) return 0;
    visited.add(currentNode.id);
    
    let emailCount = 0;
    
    // If it's an email node, schedule it
    if (currentNode.type === 'email' || currentNode.type === 'followup-email' || currentNode.type === 'followup-email2' || currentNode.type === 'new-email') {
        const delayDays = currentNode.config?.delay || 0;
        const totalDelay = currentDelay + delayDays;
        
        console.log(`   📧 Scheduling ${currentNode.type} with ${totalDelay} day(s) delay`);
        scheduleEmailForNode(cadenceId, contactId, currentNode, userId, totalDelay);
        emailCount++;
    }
    
    // Find all connections from this node
    const outgoingConnections = connections.filter(conn => conn.from === currentNode.id);
    
    // Process each outgoing connection
    outgoingConnections.forEach(connection => {
        const nextNode = nodes.find(node => node.id === connection.to);
        if (nextNode) {
            const nodeDelay = currentNode.config?.delay || 0;
            const newDelay = currentDelay + nodeDelay;
            emailCount += processWorkflowFromNode(cadenceId, contactId, nodes, connections, nextNode, userId, newDelay, visited);
        }
    });
    
    return emailCount;
}

// Function to schedule email for a specific node
function scheduleEmailForNode(cadenceId, contactId, node, userId, delayDays) {
    if (node.type !== 'email' && node.type !== 'followup-email' && node.type !== 'followup-email2' && node.type !== 'new-email') {
        return;
    }
    
    const scheduledFor = new Date();
    if (delayDays > 0) {
        scheduledFor.setDate(scheduledFor.getDate() + delayDays);
    }
    // If delayDays is 0, send immediately
    
    // Convert to SQLite datetime format
    const sqliteDateTime = scheduledFor.toISOString().replace('T', ' ').replace('Z', '');
    
    db.run("INSERT INTO email_queue (user_id, contact_id, cadence_id, node_id, subject, template, scheduled_for) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [userId, contactId, cadenceId, node.id, node.config?.subject || 'No Subject', node.config?.template || '', sqliteDateTime],
        function(err) {
            if (err) {
                console.error('Error scheduling email:', err);
            } else {
                console.log(`Email scheduled for ${delayDays === 0 ? 'immediate' : delayDays + ' days'} delivery`);
            }
        });
}

// Email sending function using user's Gmail OAuth
async function sendEmail(userId, contactId, subject, template) {
    console.log(`📧 Attempting to send email: "${subject}" to contact ${contactId}`);
    
    // Get contact details and user's Gmail credentials
    db.get(`
        SELECT c.*, u.email as user_email, u.access_token, u.refresh_token 
        FROM contacts c 
        JOIN users u ON c.user_id = u.id 
        WHERE c.id = ? AND c.user_id = ?
    `, [contactId, userId], async (err, result) => {
        if (err || !result) {
            console.error('❌ Contact or user not found:', err);
            return;
        }
        
        const contact = result;
        console.log(`📧 Sending email to: ${contact.name} (${contact.email})`);
                
                // Replace template variables
                const processedTemplate = template
                    .replace(/\{\{name\}\}/g, contact.name || 'there')
                    .replace(/\{\{email\}\}/g, contact.email)
                    .replace(/\{\{company\}\}/g, contact.company || 'your company');
                
                console.log('📧 Processed template:', processedTemplate);
                
        // Check if user has Gmail access token
        if (!contact.access_token) {
            console.log('📧 DEMO MODE: User not authenticated with Gmail');
            console.log('📧 To:', contact.email);
            console.log('📧 Subject:', subject);
            console.log('📧 Content:', processedTemplate);
            console.log('📧 User needs to login with Google to send emails');
            
            // Mark as sent for demo purposes
            db.run("UPDATE email_queue SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE contact_id = ? AND status = 'pending'", [contactId]);
            return;
        }
        
        try {
            const { google } = require('googleapis');
            
            // Create OAuth2 client
            const oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                process.env.GOOGLE_REDIRECT_URI
            );
            
            // Set credentials
            oauth2Client.setCredentials({
                access_token: contact.access_token,
                refresh_token: contact.refresh_token
            });
            
            console.log('📮 Using Gmail API to send cadence email...');
            const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
            
            // Create email in RFC 2822 format
            const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
            const messageParts = [
                `From: ${contact.user_email}`,
                `To: ${contact.email}`,
                `Subject: ${utf8Subject}`,
                'MIME-Version: 1.0',
                'Content-Type: text/html; charset=utf-8',
                '',
                processedTemplate
            ];
            const message = messageParts.join('\n');
            
            // Encode message in base64
            const encodedMessage = Buffer.from(message)
                .toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
            
            console.log('✉️  Sending via Gmail API...');
                
                // Send email
            const result = await gmail.users.messages.send({
                userId: 'me',
                requestBody: {
                    raw: encodedMessage
                }
            });
            console.log('✅ ✅ ✅ CADENCE EMAIL SENT SUCCESSFULLY! ✅ ✅ ✅');
            console.log('   Message ID:', result.data.id);
                
                // Mark as sent
                db.run("UPDATE email_queue SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE contact_id = ? AND status = 'pending'", [contactId]);
                
            } catch (error) {
                console.error('❌ ❌ ❌ CADENCE EMAIL FAILED! ❌ ❌ ❌');
                console.error('   Error type:', error.code);
                console.error('   Error details:', error.message);
                
            // If OAuth fails (401), try to refresh token
            if (error.code === 401 && contact.refresh_token) {
                try {
                    console.log('🔄 Attempting to refresh access token...');
                    const { google } = require('googleapis');
                    
                    const oauth2Client = new google.auth.OAuth2(
                        process.env.GOOGLE_CLIENT_ID,
                        process.env.GOOGLE_CLIENT_SECRET,
                        process.env.GOOGLE_REDIRECT_URI
                    );
                    
                    oauth2Client.setCredentials({
                        refresh_token: contact.refresh_token
                    });
                    
                    const { credentials } = await oauth2Client.refreshAccessToken();
                    
                    // Update user's access token
                    db.run("UPDATE users SET access_token = ? WHERE id = ?", [credentials.access_token, userId]);
                    
                    console.log('✅ Token refreshed, retrying cadence email...');
                    
                    // Update auth with new token
                    oauth2Client.setCredentials({
                        access_token: credentials.access_token,
                        refresh_token: contact.refresh_token
                    });
                    
                    // Retry sending email with Gmail API
                    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
                    const retryResult = await gmail.users.messages.send({
                        userId: 'me',
                        requestBody: {
                            raw: encodedMessage
                        }
                    });
                    
                    console.log('✅ ✅ ✅ CADENCE EMAIL SENT AFTER TOKEN REFRESH! ✅ ✅ ✅');
                    console.log('   Message ID:', retryResult.data.id);
                    
                    // Mark as sent
                    db.run("UPDATE email_queue SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE contact_id = ? AND status = 'pending'", [contactId]);
                    return;
                    
                } catch (refreshError) {
                    console.error('❌ Failed to refresh token:', refreshError.message);
                }
            }
            
            // If all else fails, log the email details
                console.log('📧 FALLBACK: Email details logged instead of sending');
                console.log('📧 To:', contact.email);
                console.log('📧 Subject:', subject);
                console.log('📧 Content:', processedTemplate);
                
                // Mark as sent anyway for demo purposes
                db.run("UPDATE email_queue SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE contact_id = ? AND status = 'pending'", [contactId]);
            }
    });
}

// Cron job to process email queue
// Process emails every minute
cron.schedule('* * * * *', () => {
    console.log('Processing email queue...');
    
    db.all("SELECT * FROM email_queue WHERE status = 'pending' AND scheduled_for <= datetime('now')", (err, emails) => {
        if (err) {
            console.error('Error fetching email queue:', err);
            return;
        }
        
        console.log(`Found ${emails.length} emails to send`);
        
        emails.forEach(email => {
            console.log(`Sending email to contact ${email.contact_id}: ${email.subject}`);
            sendEmail(email.user_id, email.contact_id, email.subject, email.template);
            
            // Mark as sent
            db.run("UPDATE email_queue SET status = 'sent' WHERE id = ?", [email.id]);
        });
    });
});

// Function to process emails immediately (for 0-day delays)
function processEmailsImmediately() {
    console.log('Processing immediate emails...');
    
    db.all("SELECT * FROM email_queue WHERE status = 'pending' AND scheduled_for <= datetime('now')", (err, emails) => {
        if (err) {
            console.error('Error fetching immediate emails:', err);
            return;
        }
        
        console.log(`Found ${emails.length} immediate emails to send`);
        
        emails.forEach(email => {
            console.log(`Sending immediate email to contact ${email.contact_id}: ${email.subject}`);
            sendEmail(email.user_id, email.contact_id, email.subject, email.template);
            
            // Mark as sent
            db.run("UPDATE email_queue SET status = 'sent' WHERE id = ?", [email.id]);
        });
    });
}

// AI-powered email generation
app.post('/api/generate-email', authenticateToken, async (req, res) => {
    try {
        const { contact, context, tone } = req.body;
        
        const prompt = `Generate a professional email for:
        Contact: ${contact.name} (${contact.email}) at ${contact.company || 'their company'}
        Context: ${context || 'General outreach'}
        Tone: ${tone || 'Professional and friendly'}
        
        Please generate a subject line and email body that would be appropriate for this outreach.`;

        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 500,
        });

        const generatedContent = completion.choices[0].message.content;
        
        // Extract subject and body
        const subjectMatch = generatedContent.match(/Subject:\s*(.+)/i);
        const subject = subjectMatch ? subjectMatch[1].trim() : 'Follow-up';
        
        const bodyMatch = generatedContent.match(/Body:\s*([\s\S]+)/i) || 
                         generatedContent.match(/(?:Email|Message):\s*([\s\S]+)/i);
        const body = bodyMatch ? bodyMatch[1].trim() : generatedContent;

        res.json({
            subject,
            body,
            generatedContent
        });
    } catch (error) {
        console.error('Error generating email:', error);
        res.status(500).json({ error: 'Failed to generate email' });
    }
});

// Vector search for similar contacts
app.post('/api/search-similar-contacts', authenticateToken, async (req, res) => {
    try {
        const { query, limit = 5 } = req.body;
        
        // Generate embedding for the query
        const embeddingResponse = await openai.embeddings.create({
            model: "text-embedding-ada-002",
            input: query,
        });
        
        const queryEmbedding = embeddingResponse.data[0].embedding;
        
        // Search in Pinecone
        const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
        const searchResponse = await index.query({
            vector: queryEmbedding,
            topK: limit,
            includeMetadata: true
        });
        
        res.json({
            results: searchResponse.matches,
            query
        });
    } catch (error) {
        console.error('Error searching contacts:', error);
        res.status(500).json({ error: 'Failed to search contacts' });
    }
});

// VAPI voice agent integration
app.post('/api/vapi/call', authenticateToken, async (req, res) => {
    try {
        const { phoneNumber, message, contactId } = req.body;
        
        const response = await axios.post(`${VAPI_BASE_URL}/call`, {
            phoneNumber,
            message,
            contactId,
            // Add other VAPI parameters as needed
        }, {
            headers: {
                'Authorization': `Bearer ${VAPI_PRIVATE_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('Error making VAPI call:', error);
        res.status(500).json({ error: 'Failed to initiate call' });
    }
});

// Store contact embeddings in Pinecone
app.post('/api/contacts/:id/embed', authenticateToken, async (req, res) => {
    try {
        const contactId = req.params.id;
        
        // Get contact details
        const contact = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM contacts WHERE id = ? AND user_id = ?", [contactId, req.user.userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!contact) {
            return res.status(404).json({ error: 'Contact not found' });
        }
        
        // Create text for embedding
        const contactText = `${contact.name} ${contact.email} ${contact.company || ''}`.trim();
        
        // Generate embedding
        const embeddingResponse = await openai.embeddings.create({
            model: "text-embedding-ada-002",
            input: contactText,
        });
        
        const embedding = embeddingResponse.data[0].embedding;
        
        // Store in Pinecone
        const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
        await index.upsert([{
            id: `contact_${contactId}`,
            values: embedding,
            metadata: {
                contactId,
                userId: req.user.userId,
                name: contact.name,
                email: contact.email,
                company: contact.company
            }
        }]);
        
        res.json({ message: 'Contact embedded successfully' });
    } catch (error) {
        console.error('Error embedding contact:', error);
        res.status(500).json({ error: 'Failed to embed contact' });
    }
});

// Send test email endpoint
app.post('/api/send-test-email', authenticateToken, async (req, res) => {
    try {
        const { to, subject, body } = req.body;
        
        console.log('\n🧪 TEST EMAIL REQUEST RECEIVED');
        console.log('   From User ID:', req.user.userId);
        console.log('   To:', to);
        console.log('   Subject:', subject);
        
        // Get user details
        const user = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM users WHERE id = ?", [req.user.userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!user) {
            console.error('❌ User not found');
            return res.status(404).json({ error: 'User not found' });
        }
        
        console.log('✅ User found:', user.email);
        console.log('   Has access token:', !!user.access_token);
        console.log('   Has refresh token:', !!user.refresh_token);
        
        if (!user.access_token) {
            console.error('❌ User not authenticated with Gmail');
            return res.status(401).json({ error: 'Please login with Google to send emails' });
        }
        
        // Setup OAuth2 client and nodemailer (outside try block so accessible for token refresh)
        const nodemailer = require('nodemailer');
        const { google } = require('googleapis');
        
        console.log('📦 Creating OAuth2 client...');
        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );
        
        oauth2Client.setCredentials({
            access_token: user.access_token,
            refresh_token: user.refresh_token
        });
        
        // Prepare email options (outside try block for retry logic)
        const mailOptions = {
            from: user.email,
            to: to,
            subject: subject,
            html: `<p>${body.replace(/\n/g, '<br>')}</p>`,
            text: body
        };
        
        // Prepare email message (outside try block for retry logic)
        const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
        const messageParts = [
            `From: ${user.email}`,
            `To: ${to}`,
            `Subject: ${utf8Subject}`,
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=utf-8',
            '',
            body
        ];
        const message = messageParts.join('\n');
        
        // Encode message in base64
        const encodedMessage = Buffer.from(message)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        
        // Send email using Gmail API (more reliable than SMTP with OAuth)
        try {
            console.log('📮 Using Gmail API to send email...');
            
            const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
            
            console.log('✉️  Sending via Gmail API...');
            console.log('   From:', user.email);
            console.log('   To:', to);
            
            const result = await gmail.users.messages.send({
                userId: 'me',
                requestBody: {
                    raw: encodedMessage
                }
            });
            
            console.log('✅ ✅ ✅ TEST EMAIL SENT SUCCESSFULLY! ✅ ✅ ✅');
            console.log('   Message ID:', result.data.id);
            console.log('   Thread ID:', result.data.threadId);
            console.log('='.repeat(80));
            
            res.json({ 
                success: true, 
                messageId: result.data.id,
                message: 'Email sent successfully via Gmail API!' 
            });
            
        } catch (emailError) {
            console.error('❌ ❌ ❌ EMAIL SENDING FAILED! ❌ ❌ ❌');
            console.error('   Error type:', emailError.code);
            console.error('   Error message:', emailError.message);
            if (emailError.response) {
                console.error('   Response:', emailError.response.data);
            }
            console.error('='.repeat(80));
            
            // Try to refresh token if OAuth failed
            if (emailError.code === 401 && user.refresh_token) {
                try {
                    console.log('🔄 Attempting to refresh access token...');
                    const { credentials } = await oauth2Client.refreshAccessToken();
                    
                    // Update user's access token
                    await new Promise((resolve, reject) => {
                        db.run("UPDATE users SET access_token = ? WHERE id = ?", 
                            [credentials.access_token, req.user.userId],
                            (err) => err ? reject(err) : resolve()
                        );
                    });
                    
                    console.log('✅ Token refreshed, retrying email send...');
                    
                    // Update oauth client with new token
                    oauth2Client.setCredentials({
                        access_token: credentials.access_token,
                        refresh_token: user.refresh_token
                    });
                    
                    // Retry with new token
                    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
                    const retryResult = await gmail.users.messages.send({
                        userId: 'me',
                        requestBody: {
                            raw: encodedMessage
                        }
                    });
                    
                    console.log('✅ ✅ ✅ EMAIL SENT AFTER TOKEN REFRESH! ✅ ✅ ✅');
                    console.log('   Message ID:', retryResult.data.id);
                    
                    return res.json({ 
                        success: true, 
                        messageId: retryResult.data.id,
                        message: 'Email sent successfully after token refresh!' 
                    });
                } catch (refreshError) {
                    console.error('❌ Token refresh failed:', refreshError.message);
                }
            }
            
            res.status(500).json({ 
                error: 'Failed to send email', 
                details: emailError.message 
            });
        }
        
    } catch (error) {
        console.error('❌ Error in test email endpoint:', error);
        res.status(500).json({ error: 'Failed to send test email' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        services: {
            openai: !!process.env.OPENAI_API_KEY,
            pinecone: !!process.env.PINECONE_API_KEY,
            vapi: !!process.env.VAPI_PRIVATE_KEY,
            google: !!process.env.GOOGLE_CLIENT_ID
        }
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
});

