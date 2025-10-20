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
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests) or from allowed origins
        if (!origin || origin === 'http://localhost:8081' || origin.startsWith('chrome-extension://')) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
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
        title TEXT,
        first_name TEXT,
        last_name TEXT,
        linkedin_url TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);
    
    // Add new columns to existing contacts table if they don't exist
    db.run(`ALTER TABLE contacts ADD COLUMN title TEXT`, () => {});
    db.run(`ALTER TABLE contacts ADD COLUMN first_name TEXT`, () => {});
    db.run(`ALTER TABLE contacts ADD COLUMN last_name TEXT`, () => {});
    db.run(`ALTER TABLE contacts ADD COLUMN linkedin_url TEXT`, () => {});

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
    passport.authenticate('google', { failureRedirect: 'http://localhost:8081/login' }),
    (req, res) => {
        // Generate JWT token with 30 day expiration
        const token = jwt.sign({ userId: req.user.id }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '30d' });
        res.redirect(`http://localhost:8081/?token=${token}`);
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
    const { email, name, company, title, firstName, lastName, linkedinUrl } = req.body;
    
    db.run(`INSERT INTO contacts (user_id, email, name, company, title, first_name, last_name, linkedin_url) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.userId, email, name, company, title || null, firstName || null, lastName || null, linkedinUrl || null],
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

// Find email using Apollo.io API
app.post('/api/find-email', authenticateToken, async (req, res) => {
    const { firstName, lastName, company, domain } = req.body;
    
    try {
        // Try RocketReach API
        if (process.env.ROCKETREACH_API_KEY) {
            console.log(`🔍 Looking up email for ${firstName} ${lastName} via RocketReach`);
            
            try {
                // RocketReach lookup
                const searchResponse = await axios.post('https://api.rocketreach.co/v2/api/lookupProfile', {
                    name: `${firstName} ${lastName}`,
                    current_employer: company
                }, {
                    headers: {
                        'Api-Key': process.env.ROCKETREACH_API_KEY,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (searchResponse.data && searchResponse.data.emails && searchResponse.data.emails.length > 0) {
                    const email = searchResponse.data.emails[0].email;
                    console.log(`✅ Found email via RocketReach: ${email}`);
                    return res.json({
                        email: email,
                        source: 'rocketreach',
                        confidence: 'high'
                    });
                }
            } catch (rocketError) {
                console.log('RocketReach error:', rocketError.response?.data || rocketError.message);
            }
        }
        
        // Fallback: Generate educated guesses
        if (domain) {
            // Clean names - remove special characters, spaces, parentheses
            const cleanFirst = firstName.toLowerCase().replace(/[^a-z]/g, '');
            const cleanLast = lastName.toLowerCase().replace(/[^a-z]/g, '');
            
            const patterns = [
                `${cleanFirst}.${cleanLast}@${domain}`,
                `${cleanFirst}${cleanLast}@${domain}`,
                `${cleanFirst.charAt(0)}${cleanLast}@${domain}`,
                `${cleanFirst}@${domain}`
            ];
            
            console.log(`💡 Suggesting email patterns for ${domain} (cleaned: ${cleanFirst} ${cleanLast})`);
            return res.json({
                suggestions: patterns,
                source: 'pattern',
                confidence: 'low',
                message: 'Using email pattern guesses.'
            });
        }
        
        res.json({ 
            email: null, 
            message: 'Could not find email. Please enter manually.' 
        });
        
    } catch (error) {
        console.error('Error finding email:', error.response?.data || error.message);
        res.status(500).json({ 
            error: 'Failed to find email',
            details: error.response?.data?.message || error.message 
        });
    }
});

// Add contact to a cadence
app.post('/api/cadences/:id/add-contact', authenticateToken, async (req, res) => {
    const cadenceId = req.params.id;
    const { contactId } = req.body;
    
    try {
        // Get the cadence
        const cadence = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM cadences WHERE id = ? AND user_id = ?', [cadenceId, req.user.userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!cadence) {
            return res.status(404).json({ error: 'Cadence not found' });
        }
        
        // Get the contact
        const contact = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM contacts WHERE id = ? AND user_id = ?', [contactId, req.user.userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!contact) {
            return res.status(404).json({ error: 'Contact not found' });
        }
        
        // Parse cadence workflow
        const nodes = JSON.parse(cadence.nodes);
        const connections = JSON.parse(cadence.connections);
        
        // Find the start node
        const startNode = nodes.find(n => n.type === 'start');
        
        // Schedule emails from the cadence with template replacement
        await processWorkflowExecution(nodes, connections, startNode, req.user.userId, contact);
        
        res.json({ 
            message: 'Contact added to cadence successfully',
            contact: contact.name,
            cadence: cadence.name
        });
        
    } catch (error) {
        console.error('Error adding contact to cadence:', error);
        res.status(500).json({ error: 'Failed to add contact to cadence' });
    }
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

// Template variable replacement function
function replaceTemplateVariables(text, contact) {
    if (!text || !contact) return text;
    
    const variables = {
        '{{firstName}}': contact.first_name || contact.name?.split(' ')[0] || '',
        '{{lastName}}': contact.last_name || contact.name?.split(' ').slice(1).join(' ') || '',
        '{{fullName}}': contact.name || '',
        '{{company}}': contact.company || '',
        '{{title}}': contact.title || '',
        '{{email}}': contact.email || ''
    };
    
    let result = text;
    for (const [variable, value] of Object.entries(variables)) {
        result = result.replace(new RegExp(variable, 'g'), value);
    }
    
    return result;
}

// New simplified workflow execution
async function processWorkflowExecution(nodes, connections, startNode, userId, contact = null) {
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
    
    // Collect all email nodes in order
    const emailSequence = [];
    const visited = new Set();
    
    function collectEmails(currentNode) {
        if (visited.has(currentNode.id)) return;
        visited.add(currentNode.id);
        
        // If it's an email node, add to sequence
        if (['email', 'followup-email', 'followup-email2', 'new-email'].includes(currentNode.type)) {
            const config = currentNode.config || {};
            
            // Check if we have required fields (allow missing 'to' if we have a contact)
            const hasRequiredFields = config.subject && config.template && (config.to || (contact && contact.email));
            
            if (hasRequiredFields) {
                // Calculate delay in milliseconds
                let delayMs = 0;
                if (config.delayType === 'immediate' || !config.delayType) {
                    delayMs = 0;
                } else if (config.delayType === 'minutes') {
                    delayMs = (config.delayValue || 0) * 60 * 1000;
                } else if (config.delayType === 'days') {
                    delayMs = (config.delayValue || 0) * 24 * 60 * 60 * 1000;
                } else if (config.delayType === 'specific') {
                    const targetDate = new Date(config.delayValue);
                    const now = new Date();
                    delayMs = Math.max(0, targetDate - now);
                }
                
                // Apply template variable replacement if contact is provided
                const processedSubject = contact ? replaceTemplateVariables(config.subject, contact) : config.subject;
                const processedBody = contact ? replaceTemplateVariables(config.template, contact) : config.template;
                const processedTo = contact ? contact.email : config.to;
                
                console.log(`📧 Email node configured: to=${processedTo}, subject=${processedSubject}`);
                
                emailSequence.push({
                    node: currentNode,
                    to: processedTo,
                    subject: processedSubject,
                    body: processedBody,
                    delayMs: delayMs
                });
            } else {
                console.log(`⚠️ Skipping email node - missing required fields:`, {
                    hasSubject: !!config.subject,
                    hasTemplate: !!config.template,
                    hasTo: !!(config.to || (contact && contact.email))
                });
            }
        }
        
        // Process connected nodes
        const outgoing = connections.filter(conn => conn.from === currentNode.id);
        for (const connection of outgoing) {
            const nextNode = nodes.find(n => n.id === connection.to);
            if (nextNode) {
                collectEmails(nextNode);
            }
        }
    }
    
    collectEmails(startNode);
    console.log(`📧 Found ${emailSequence.length} emails in sequence`);
    
    // Generate a fake Message-ID for threading (will be used for ALL emails)
    // Format: <uniqueId@mail.gmail.com>
    const fakeMessageId = `<${Date.now()}.${Math.random().toString(36).substring(7)}@mail.gmail.com>`;
    console.log(`📧 Generated shared Message-ID for threading: ${fakeMessageId}`);
    
    // Send emails in sequence with threading
    let threadId = null;
    
    // ALWAYS send the first email immediately to establish thread
    if (emailSequence.length > 0) {
        const firstEmail = emailSequence[0];
        console.log(`\n📧 Email 1/${emailSequence.length}: ${firstEmail.subject}`);
        console.log(`   To: ${firstEmail.to}`);
        console.log(`   Delay: ${firstEmail.delayMs}ms (immediate - establishing thread)`);
        console.log(`   Thread ID: New thread`);
        console.log(`   Using Message-ID: ${fakeMessageId}`);
        
        try {
            const result = await sendDirectEmail(user, firstEmail.to, firstEmail.subject, firstEmail.body, null, fakeMessageId);
            threadId = result.threadId;
            console.log(`   ✅ Thread established: ${threadId}`);
            results.emailsSent++;
        } catch (error) {
            console.error(`   ❌ Failed to send first email: ${error.message}`);
            results.errors.push(error.message);
            return results; // Can't continue without thread
        }
    }
    
    // Send remaining emails with proper threading using the SAME fake Message-ID
    for (let i = 1; i < emailSequence.length; i++) {
        const email = emailSequence[i];
        
        console.log(`\n📧 Email ${i + 1}/${emailSequence.length}: ${email.subject}`);
        console.log(`   To: ${email.to}`);
        console.log(`   Delay: ${email.delayMs}ms`);
        console.log(`   Thread ID: ${threadId}`);
        console.log(`   Using same Message-ID: ${fakeMessageId}`);
        
        // Capture threadId and messageId in the closure
        const capturedThreadId = threadId;
        const capturedMessageId = fakeMessageId; // Use the SAME fake Message-ID for all emails!
        
        if (email.delayMs === 0) {
            // Send immediately
            try {
                const result = await sendDirectEmail(user, email.to, email.subject, email.body, capturedThreadId, capturedMessageId);
                console.log(`   ✅ Email sent in thread: ${result.threadId}`);
                results.emailsSent++;
            } catch (error) {
                console.error(`   ❌ Failed to send email: ${error.message}`);
                results.errors.push(error.message);
            }
        } else {
            // Schedule for later
            const scheduledDate = new Date(Date.now() + email.delayMs);
            console.log(`   ⏰ Scheduling for ${scheduledDate.toLocaleString()}`);
            
            setTimeout(async () => {
                try {
                    await sendDirectEmail(user, email.to, email.subject, email.body, capturedThreadId, capturedMessageId);
                    console.log(`   ✅ Scheduled email sent to ${email.to} in thread ${capturedThreadId}`);
                } catch (error) {
                    console.error(`   ❌ Failed to send scheduled email: ${error.message}`);
                }
            }, email.delayMs);
            
            results.emailsSent++;
        }
    }
    
    return results;
}

// Send email directly using Gmail API
async function sendDirectEmail(user, to, subject, body, threadId = null, inReplyToMessageId = null) {
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
    
    // Add "Re:" prefix for follow-up emails
    const emailSubject = (threadId && !subject.startsWith('Re:')) ? `Re: ${subject}` : subject;
    
    // Create email with proper MIME format
    const utf8Subject = `=?utf-8?B?${Buffer.from(emailSubject).toString('base64')}?=`;
    const messageParts = [
        `From: ${user.email}`,
        `To: ${to}`,
        `Subject: ${utf8Subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=utf-8'
    ];
    
    // ALWAYS add In-Reply-To and References when we have a fake Message-ID
    // This makes ALL emails (including the first) reply to the same fake message
    if (inReplyToMessageId) {
        messageParts.push(`In-Reply-To: ${inReplyToMessageId}`);
        messageParts.push(`References: ${inReplyToMessageId}`);
        console.log(`   📎 Adding threading headers: In-Reply-To: ${inReplyToMessageId}`);
    }
    
    messageParts.push('');
    messageParts.push(body);
    const message = messageParts.join('\r\n'); // CRITICAL: Use CRLF for MIME
    
    // Encode message
    const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    
    // Send email with threadId if provided
    const requestBody = { raw: encodedMessage };
    if (threadId) {
        requestBody.threadId = threadId;
        console.log(`   🧵 Continuing thread: ${threadId}`);
    }
    
    const result = await gmail.users.messages.send({
        userId: 'me',
        requestBody: requestBody
    });
    
    console.log(`   ✅ Email sent! Message ID: ${result.data.id}, Thread ID: ${result.data.threadId}`);
    
    // Generate the SMTP Message-ID in Gmail's format
    // Gmail uses a specific format based on the message ID
    const messageId = `<${result.data.id}@mail.gmail.com>`;
    
    console.log(`   📧 SMTP Message-ID: ${messageId}`);
    
    return { 
        id: result.data.id, 
        threadId: result.data.threadId,
        messageId: messageId
    };
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

