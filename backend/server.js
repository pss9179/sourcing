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
    callbackURL: process.env.GOOGLE_REDIRECT_URI || "/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
    try {
        // Check if user exists
        const existingUser = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM users WHERE google_id = ?", [profile.id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (existingUser) {
            // Update tokens
            await new Promise((resolve, reject) => {
                db.run("UPDATE users SET access_token = ?, refresh_token = ? WHERE google_id = ?", 
                    [accessToken, refreshToken, profile.id], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
            });
            return done(null, existingUser);
        } else {
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
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/gmail.send'] 
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

// Start cadence execution
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

// Function to schedule cadence for a contact
function scheduleCadenceForContact(cadenceId, contactId, nodes, connections, startNode, userId) {
    // Get contact details
    db.get("SELECT * FROM contacts WHERE id = ? AND user_id = ?", [contactId, userId], (err, contact) => {
        if (err || !contact) {
            console.error('Contact not found:', err);
            return;
        }
        
        console.log(`Scheduling cadence for contact: ${contact.name} (${contact.email})`);
        
        // Process the entire workflow starting from the start node
        processWorkflowFromNode(cadenceId, contactId, nodes, connections, startNode, userId, 0);
    });
}

// Recursive function to process workflow from a given node
function processWorkflowFromNode(cadenceId, contactId, nodes, connections, currentNode, userId, currentDelay) {
    // If it's an email node, schedule it
    if (currentNode.type === 'email' || currentNode.type === 'followup-email' || currentNode.type === 'followup-email2' || currentNode.type === 'new-email') {
        const delayDays = currentNode.config?.delay || 0;
        const totalDelay = currentDelay + delayDays;
        
        console.log(`Scheduling ${currentNode.type} with ${totalDelay} days delay`);
        scheduleEmailForNode(cadenceId, contactId, currentNode, userId, totalDelay);
    }
    
    // Find all connections from this node
    const outgoingConnections = connections.filter(conn => conn.from === currentNode.id);
    
    // Process each outgoing connection
    outgoingConnections.forEach(connection => {
        const nextNode = nodes.find(node => node.id === connection.to);
        if (nextNode) {
            const nodeDelay = currentNode.config?.delay || 0;
            const newDelay = currentDelay + nodeDelay;
            processWorkflowFromNode(cadenceId, contactId, nodes, connections, nextNode, userId, newDelay);
        }
    });
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
            const nodemailer = require('nodemailer');
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
            
            // Create transporter using OAuth2
            const transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: {
                    type: 'OAuth2',
                    user: contact.user_email,
                    clientId: process.env.GOOGLE_CLIENT_ID,
                    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                    refreshToken: contact.refresh_token,
                    accessToken: contact.access_token
                    }
                });
                
                // Email options
                const mailOptions = {
                from: contact.user_email,
                    to: contact.email,
                    subject: subject,
                    html: `<p>${processedTemplate.replace(/\n/g, '<br>')}</p>`,
                    text: processedTemplate
                };
                
                // Send email
                const result = await transporter.sendMail(mailOptions);
                console.log('✅ Email sent successfully:', result.messageId);
                
                // Mark as sent
                db.run("UPDATE email_queue SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE contact_id = ? AND status = 'pending'", [contactId]);
                
            } catch (error) {
                console.error('❌ Error sending email:', error);
                console.error('Error details:', error.message);
                
            // If OAuth fails, try to refresh token
            if (error.code === 'EAUTH' && contact.refresh_token) {
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
                    
                    console.log('✅ Access token refreshed, retrying email...');
                    
                    // Retry sending email with new token
                    const transporter = nodemailer.createTransport({
                        service: 'gmail',
                        auth: {
                            type: 'OAuth2',
                            user: contact.user_email,
                            clientId: process.env.GOOGLE_CLIENT_ID,
                            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                            refreshToken: contact.refresh_token,
                            accessToken: credentials.access_token
                        }
                    });
                    
                    const retryResult = await transporter.sendMail(mailOptions);
                    console.log('✅ Email sent successfully after token refresh:', retryResult.messageId);
                    
                    // Mark as sent
                    db.run("UPDATE email_queue SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE contact_id = ? AND status = 'pending'", [contactId]);
                    return;
                    
                } catch (refreshError) {
                    console.error('❌ Failed to refresh token:', refreshError);
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

