const express = require('express');
const path = require('path');
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
        if (!origin || origin === 'http://localhost:3000' || origin.startsWith('chrome-extension://')) {
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

// Serve static files from the parent directory (where index.html is located)
app.use(express.static(path.join(__dirname, '..')));

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

    // Email responses table
    db.run(`CREATE TABLE IF NOT EXISTS email_responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        contact_id INTEGER,
        cadence_id INTEGER,
        original_message_id TEXT,
        response_message_id TEXT,
        response_subject TEXT,
        response_body TEXT,
        response_from TEXT,
        response_date DATETIME,
        is_read BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (contact_id) REFERENCES contacts (id),
        FOREIGN KEY (cadence_id) REFERENCES cadences (id)
    )`);

    // Email logs table (for tracking sent emails)
    db.run(`CREATE TABLE IF NOT EXISTS email_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        contact_id INTEGER,
        cadence_id INTEGER,
        node_id TEXT,
        message_id TEXT UNIQUE,
        thread_id TEXT,
        subject TEXT,
        sent_to TEXT,
        sent_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (contact_id) REFERENCES contacts (id),
        FOREIGN KEY (cadence_id) REFERENCES cadences (id)
    )`);

    // Add node_id column if it doesn't exist (for existing databases)
    db.run(`ALTER TABLE email_logs ADD COLUMN node_id TEXT`, () => {});

    // Cadence contacts table
    db.run(`CREATE TABLE IF NOT EXISTS cadence_contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cadence_id INTEGER,
        contact_id INTEGER,
        status TEXT DEFAULT 'active',
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (cadence_id) REFERENCES cadences (id),
        FOREIGN KEY (contact_id) REFERENCES contacts (id)
    )`);

    // Cadence progress table
    db.run(`CREATE TABLE IF NOT EXISTS cadence_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cadence_id INTEGER,
        contact_id INTEGER,
        current_node_id TEXT,
        status TEXT DEFAULT 'active',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (cadence_id) REFERENCES cadences (id),
        FOREIGN KEY (contact_id) REFERENCES contacts (id)
    )`);

    // User settings table
    db.run(`CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER PRIMARY KEY,
        ai_auto_reply BOOLEAN DEFAULT 1,
        ai_draft_mode BOOLEAN DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);
});

// Helper function to log sent emails
function logSentEmail(userId, contactId, cadenceId, messageId, threadId, subject, sentTo, nodeId = null) {
    return new Promise((resolve, reject) => {
        db.run(`
            INSERT INTO email_logs (user_id, contact_id, cadence_id, node_id, message_id, thread_id, subject, sent_to, sent_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [userId, contactId, cadenceId, nodeId, messageId, threadId, subject, sentTo], function(err) {
            if (err) {
                console.error('Error logging sent email:', err);
                reject(err);
            } else {
                console.log(`📧 Email logged with ID: ${this.lastID}`);
                resolve(this.lastID);
            }
        });
    });
}

// Helper function to log email responses
function logEmailResponse(userId, contactId, cadenceId, originalMessageId, responseMessageId, responseSubject, responseBody, responseFrom, responseDate) {
    return new Promise((resolve, reject) => {
        db.run(`
            INSERT INTO email_responses (user_id, contact_id, cadence_id, original_message_id, response_message_id, response_subject, response_body, response_from, response_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [userId, contactId, cadenceId, originalMessageId, responseMessageId, responseSubject, responseBody, responseFrom, responseDate], function(err) {
            if (err) {
                console.error('Error logging email response:', err);
                reject(err);
            } else {
                console.log(`📬 Response logged with ID: ${this.lastID}`);
                resolve(this.lastID);
            }
        });
    });
}

// Helper function to cancel pending emails in a cadence when a reply is received
function cancelPendingEmails(userId, contactId, cadenceId) {
    return new Promise((resolve, reject) => {
        db.run(`
            UPDATE email_queue
            SET status = 'cancelled'
            WHERE user_id = ?
            AND contact_id = ?
            AND cadence_id = ?
            AND status = 'pending'
            AND sent_at IS NULL
        `, [userId, contactId, cadenceId], function(err) {
            if (err) {
                console.error('Error cancelling pending emails:', err);
                reject(err);
            } else {
                const cancelledCount = this.changes;
                if (cancelledCount > 0) {
                    console.log(`🚫 Cancelled ${cancelledCount} pending email(s) for contact ${contactId} in cadence ${cadenceId}`);
                }
                resolve(cancelledCount);
            }
        });
    });
}

// Helper function to determine if an email is a legitimate reply (not auto-reply or bounce)
function isLegitimateReply(subject, from) {
    if (!subject || !from) return false;
    
    const subjectLower = subject.toLowerCase();
    const fromLower = from.toLowerCase();
    
    // Check for auto-reply indicators
    const autoReplyIndicators = [
        'out of office',
        'out of the office',
        'auto-reply',
        'automatic reply',
        'vacation',
        'away',
        'no-reply',
        'noreply',
        'mail delivery failure',
        'undeliverable',
        'delivery status notification',
        'bounce',
        'returned mail',
        'mail system error'
    ];
    
    // Check if it's an auto-reply
    for (const indicator of autoReplyIndicators) {
        if (subjectLower.includes(indicator) || fromLower.includes(indicator)) {
            return false;
        }
    }
    
    // Check for legitimate reply patterns
    const replyPatterns = [
        /^re:\s*/i,
        /^re\[\d+\]:\s*/i,
        /^fwd:\s*/i,
        /^fwd\[\d+\]:\s*/i
    ];
    
    // Must contain "Re:" or "Fwd:" or be a direct reply
    const hasReplyPrefix = replyPatterns.some(pattern => pattern.test(subject));
    
    // Check for external email indicators that might break threading
    const externalIndicators = ['[external]', '[external email]', '[student]', '[staff]'];
    const hasExternalIndicator = externalIndicators.some(indicator => 
        subjectLower.includes(indicator.toLowerCase())
    );
    
    // If it has external indicators, check if it still looks like a reply
    if (hasExternalIndicator) {
        // Look for "Re:" after the external indicator
        const reIndex = subjectLower.indexOf('re:');
        const externalIndex = subjectLower.indexOf('[external');
        return reIndex > externalIndex;
    }
    
    return hasReplyPrefix;
}

// Helper function to extract message body from Gmail API payload
function extractMessageBody(payload) {
    let body = '';
    
    if (payload.body && payload.body.data) {
        body = Buffer.from(payload.body.data, 'base64').toString();
    } else if (payload.parts) {
        for (const part of payload.parts) {
            if (part.mimeType === 'text/plain' && part.body && part.body.data) {
                body = Buffer.from(part.body.data, 'base64').toString();
                break;
            } else if (part.mimeType === 'text/html' && part.body && part.body.data) {
                // Fallback to HTML if no plain text
                const htmlBody = Buffer.from(part.body.data, 'base64').toString();
                // Simple HTML to text conversion
                body = htmlBody.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
                break;
            }
        }
    }
    
    return body.substring(0, 2000); // Limit body length
}

// Function to check for email responses
async function checkForEmailResponses(userId) {
    console.log(`🔍 Checking for email responses for user ${userId}...`);
    
    try {
        // Get user's Gmail credentials
        const user = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM users WHERE id = ?", [userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!user || !user.access_token) {
            console.log('❌ User not authenticated with Gmail');
            return { responsesFound: 0, errors: ['User not authenticated'] };
        }

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

        // First, let's test Gmail API access by checking recent emails
        console.log('🧪 Testing Gmail API access...');
        try {
            const testResponse = await gmail.users.messages.list({
                userId: 'me',
                q: 'in:inbox',
                maxResults: 5
            });
            console.log(`✅ Gmail API working - found ${testResponse.data.messages ? testResponse.data.messages.length : 0} recent emails in inbox`);
        } catch (testError) {
            console.error('❌ Gmail API test failed:', testError.message);
        }

        // Get all sent emails for this user
        const sentEmails = await new Promise((resolve, reject) => {
            db.all(`
                SELECT el.*, c.email as contact_email, c.name as contact_name
                FROM email_logs el
                JOIN contacts c ON el.contact_id = c.id
                WHERE el.user_id = ? AND el.sent_at > datetime('now', '-30 days')
                ORDER BY el.sent_at DESC
            `, [userId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        console.log(`📧 Found ${sentEmails.length} sent emails to check for responses`);

        let responsesFound = 0;
        const errors = [];

        for (const sentEmail of sentEmails) {
            try {
                console.log(`🔍 Checking thread ${sentEmail.thread_id} for responses...`);
                
                // Method 1: Get the entire thread and check all messages (recommended approach)
                console.log(`📧 Getting full thread details for thread: ${sentEmail.thread_id}`);
                const threadResponse = await gmail.users.threads.get({
                    userId: 'me',
                    id: sentEmail.thread_id,
                    format: 'full'
                });
                
                console.log(`📬 Thread contains ${threadResponse.data.messages ? threadResponse.data.messages.length : 0} messages`);

                if (threadResponse.data.messages && threadResponse.data.messages.length > 0) {
                    console.log(`📬 Processing ${threadResponse.data.messages.length} messages in thread`);
                    
                    for (const message of threadResponse.data.messages) {
                        // Skip the original sent message
                        if (message.id === sentEmail.message_id) {
                            console.log(`⏭️  Skipping original sent message: ${message.id}`);
                            continue;
                        }

                        // Check if we already logged this response
                        const existingResponse = await new Promise((resolve, reject) => {
                            db.get(`
                                SELECT id FROM email_responses 
                                WHERE response_message_id = ? AND user_id = ?
                            `, [message.id, userId], (err, row) => {
                                if (err) reject(err);
                                else resolve(row);
                            });
                        });

                        if (existingResponse) {
                            console.log(`⏭️  Message ${message.id} already logged, skipping`);
                            continue; // Already logged this response
                        }

                        // Get message details from thread data
                        const headers = message.payload.headers;
                        const fromHeader = headers.find(h => h.name === 'From');
                        const subjectHeader = headers.find(h => h.name === 'Subject');
                        const dateHeader = headers.find(h => h.name === 'Date');
                        const inReplyToHeader = headers.find(h => h.name === 'In-Reply-To');
                        const messageIdHeader = headers.find(h => h.name === 'Message-ID');

                        const subject = subjectHeader ? subjectHeader.value : 'No Subject';
                        const from = fromHeader ? fromHeader.value : 'Unknown';
                        const date = dateHeader ? new Date(dateHeader.value) : new Date();
                        
                        // Get the responder's Message-ID (this is what we reply to)
                        const responseMessageId = messageIdHeader ? messageIdHeader.value : `<${message.id}@mail.gmail.com>`;
                        
                        // Get your original Message-ID (for References chain)
                        // Use the sent email's Message-ID, ensuring it's in proper format
                        const yourOriginalMessageId = sentEmail.message_id ? 
                            (sentEmail.message_id.startsWith('<') ? sentEmail.message_id : `<${sentEmail.message_id}@mail.gmail.com>`) :
                            `<${sentEmail.message_id}@mail.gmail.com>`;
                        
                        // Check if this is a reply from someone other than the sender
                        if (from.toLowerCase().includes(user.email.toLowerCase())) {
                            console.log(`⏭️  Skipping message from self: ${from}`);
                            continue;
                        }
                        
                        // Check if this is a legitimate reply (not auto-reply or bounce)
                        if (!isLegitimateReply(subject, from)) {
                            console.log(`⏭️  Skipping auto-reply/bounce: ${subject}`);
                            continue;
                        }
                        
                        // Extract email body using helper function
                        const body = extractMessageBody(message.payload);

                            // Log the response
                            await logEmailResponse(
                                userId,
                                sentEmail.contact_id,
                                sentEmail.cadence_id,
                                sentEmail.message_id,
                                message.id,
                                subject,
                                body,
                                from,
                                date
                            );

                            responsesFound++;
                            console.log(`✅ New response logged: ${from} - ${subject}`);

                            // Cancel all pending emails in this cadence for this contact
                            try {
                                const cancelledCount = await cancelPendingEmails(userId, sentEmail.contact_id, sentEmail.cadence_id);
                                if (cancelledCount > 0) {
                                    console.log(`🛑 Workflow broken: Cancelled ${cancelledCount} pending follow-up email(s) because contact responded`);
                                }
                            } catch (cancelError) {
                                console.error('❌ Error cancelling pending emails:', cancelError);
                            }

                            // Check for scheduling intent and handle automatically
                            try {
                                await handleSchedulingResponse(userId, from, body, sentEmail.contact_id, sentEmail.thread_id, responseMessageId, yourOriginalMessageId, subject);
                            } catch (schedulingError) {
                                console.error('❌ Error handling scheduling response:', schedulingError);
                            }
                    }
                }
            } catch (error) {
                console.error(`Error checking responses for email ${sentEmail.message_id}:`, error.message);
                errors.push(`Error checking email ${sentEmail.message_id}: ${error.message}`);
                
                // Try fallback search by subject
                try {
                    console.log(`🔄 Trying fallback search for subject: "${sentEmail.subject}"`);
                    const fallbackQuery = `subject:"${sentEmail.subject}" -from:${user.email}`;
                    const fallbackResponse = await gmail.users.messages.list({
                        userId: 'me',
                        q: fallbackQuery,
                        maxResults: 5
                    });
                    
                    if (fallbackResponse.data.messages && fallbackResponse.data.messages.length > 0) {
                        console.log(`✅ Fallback search found ${fallbackResponse.data.messages.length} potential responses`);
                        
                        for (const message of fallbackResponse.data.messages) {
                            try {
                                const messageDetails = await gmail.users.messages.get({
                                    userId: 'me',
                                    id: message.id,
                                    format: 'full'
                                });
                                
                                const headers = messageDetails.data.payload.headers;
                                const subjectHeader = headers.find(h => h.name === 'Subject');
                                const fromHeader = headers.find(h => h.name === 'From');
                                const dateHeader = headers.find(h => h.name === 'Date');
                                
                                const subject = subjectHeader ? subjectHeader.value : 'No Subject';
                                const from = fromHeader ? fromHeader.value : 'Unknown';
                                const date = dateHeader ? new Date(dateHeader.value) : new Date();
                                
                                // Check if this is a legitimate reply
                                if (!isLegitimateReply(subject, from)) {
                                    console.log(`⏭️  Skipping auto-reply/bounce in fallback: ${subject}`);
                                    continue;
                                }
                                
                                // Check if already logged
                                const existingResponse = await new Promise((resolve, reject) => {
                                    db.get(`SELECT id FROM email_responses WHERE response_message_id = ? AND user_id = ?`, 
                                        [message.id, userId], (err, row) => {
                                        if (err) reject(err);
                                        else resolve(row);
                                    });
                                });
                                
                                if (existingResponse) {
                                    console.log(`⏭️  Fallback message ${message.id} already logged, skipping`);
                                    continue;
                                }
                                
                                const body = extractMessageBody(messageDetails.data.payload);
                                
                                await logEmailResponse(
                                    userId,
                                    sentEmail.contact_id,
                                    sentEmail.cadence_id,
                                    sentEmail.message_id,
                                    message.id,
                                    subject,
                                    body,
                                    from,
                                    date
                                );

                                responsesFound++;
                                console.log(`✅ New response logged via fallback: ${from} - ${subject}`);

                                // Cancel all pending emails in this cadence for this contact
                                try {
                                    const cancelledCount = await cancelPendingEmails(userId, sentEmail.contact_id, sentEmail.cadence_id);
                                    if (cancelledCount > 0) {
                                        console.log(`🛑 Workflow broken: Cancelled ${cancelledCount} pending follow-up email(s) because contact responded`);
                                    }
                                } catch (cancelError) {
                                    console.error('❌ Error cancelling pending emails:', cancelError);
                                }
                            } catch (msgError) {
                                console.error(`Error processing fallback message ${message.id}:`, msgError.message);
                            }
                        }
                    }
                } catch (fallbackError) {
                    console.error('Fallback search also failed:', fallbackError.message);
                }
            }
        }

        console.log(`✅ Response check complete. Found ${responsesFound} new responses.`);
        return { responsesFound, errors };

    } catch (error) {
        console.error('Error checking for email responses:', error);
        return { responsesFound: 0, errors: [error.message] };
    }
}

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
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar'],
    accessType: 'offline',
    prompt: 'consent'
}));

app.get('/auth/google/callback', 
    passport.authenticate('google', { failureRedirect: 'http://localhost:3000/login' }),
    (req, res) => {
        // Generate JWT token with 30 day expiration
        const token = jwt.sign({ userId: req.user.id }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '30d' });
        res.redirect(`http://localhost:3000/?token=${token}`);
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

// Get user settings
app.get('/api/settings', authenticateToken, (req, res) => {
    db.get("SELECT ai_auto_reply, ai_draft_mode FROM user_settings WHERE user_id = ?", [req.user.userId], (err, settings) => {
        if (err) {
            console.error('Error getting user settings:', err);
            res.status(500).json({ error: 'Database error' });
        } else {
            // Return default settings if none exist
            const defaultSettings = {
                ai_auto_reply: true,
                ai_draft_mode: false
            };
            res.json(settings || defaultSettings);
        }
    });
});

// Update user settings
app.put('/api/settings', authenticateToken, (req, res) => {
    const { ai_auto_reply, ai_draft_mode } = req.body;
    
    db.run(`
        INSERT OR REPLACE INTO user_settings (user_id, ai_auto_reply, ai_draft_mode)
        VALUES (?, ?, ?)
    `, [req.user.userId, ai_auto_reply, ai_draft_mode], function(err) {
        if (err) {
            console.error('Error updating user settings:', err);
            res.status(500).json({ error: 'Database error' });
        } else {
            res.json({ message: 'Settings updated successfully' });
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

// Update cadence
app.put('/api/cadences/:id', authenticateToken, (req, res) => {
    const cadenceId = req.params.id;
    const { name, nodes, connections } = req.body;
    
    db.run("UPDATE cadences SET name = ?, nodes = ?, connections = ? WHERE id = ? AND user_id = ?",
        [name, JSON.stringify(nodes), JSON.stringify(connections), cadenceId, req.user.userId],
        function(err) {
            if (err) {
                console.error('Error updating cadence:', err);
                res.status(500).json({ error: 'Failed to update cadence' });
            } else if (this.changes === 0) {
                res.status(404).json({ error: 'Cadence not found or access denied' });
            } else {
                res.json({ message: 'Cadence updated successfully' });
            }
        });
});

// Get user's cadences with contact counts
app.get('/api/cadences', authenticateToken, async (req, res) => {
    try {
        const cadences = await new Promise((resolve, reject) => {
            db.all("SELECT * FROM cadences WHERE user_id = ? ORDER BY created_at DESC", [req.user.userId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        // Get contact count for each cadence
        const cadencesWithCounts = await Promise.all(cadences.map(async (cadence) => {
            const count = await new Promise((resolve, reject) => {
                db.get("SELECT COUNT(*) as count FROM cadence_contacts WHERE cadence_id = ?", [cadence.id], (err, row) => {
                    if (err) reject(err);
                    else resolve(row.count);
                });
            });
            
            return {
                ...cadence,
                nodes: JSON.parse(cadence.nodes),
                connections: JSON.parse(cadence.connections),
                contactCount: count
            };
        }));
        
        res.json(cadencesWithCounts);
    } catch (error) {
        console.error('Error getting cadences:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Add contact
app.post('/api/contacts', authenticateToken, (req, res) => {
    const { email, name, company, title, firstName, lastName, linkedinUrl } = req.body;
    
    // Check if contact already exists (by email only)
    // TEMPORARY: Bypass duplicate check for test email
    if (email === 'pss9179@stern.nyu.edu') {
        console.log(`🧪 Test mode: Bypassing duplicate check for test email: ${email}`);
        // Skip duplicate check and proceed to insert
    } else {
        db.get(`SELECT * FROM contacts WHERE user_id = ? AND email = ?`,
            [req.user.userId, email],
        (err, existing) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (existing) {
                // Contact already exists - return the existing contact
                console.log(`⚠️ Contact already exists: ${email}`);
                return res.json({ 
                    id: existing.id, 
                    message: 'Contact already exists',
                    alreadyExists: true 
                });
            }
            
            // Insert new contact
                insertNewContact();
            });
        return;
    }
    
    // Function to insert new contact
    function insertNewContact() {
            db.run(`INSERT INTO contacts (user_id, email, name, company, title, first_name, last_name, linkedin_url) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [req.user.userId, email, name, company, title || null, firstName || null, lastName || null, linkedinUrl || null],
        function(err) {
            if (err) {
                    console.error('Error adding contact:', err);
                res.status(500).json({ error: 'Failed to add contact' });
            } else {
                        console.log(`✅ New contact added: ${email}`);
                        res.json({ id: this.lastID, message: 'Contact added successfully', alreadyExists: false });
            }
                });
    }
    
    // Call insertNewContact for test email or after duplicate check
    insertNewContact();
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

// Parse and verify company name using GPT
app.post('/api/parse-company', authenticateToken, async (req, res) => {
    const { rawCompanyName, personName, personTitle } = req.body;
    
    try {
        console.log(`🔍 Parsing company name: "${rawCompanyName}" for ${personName} (${personTitle})`);
        
        if (!process.env.OPENAI_API_KEY) {
            return res.json({
                success: false,
                error: 'OpenAI API key not configured'
            });
        }

        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        const prompt = `You are a professional data parser specializing in LinkedIn company name extraction and verification.

TASK: Parse and clean the raw company name, then verify if it's a real company.

RAW COMPANY NAME: "${rawCompanyName}"
PERSON: ${personName}
TITLE: ${personTitle}

INSTRUCTIONS:
1. Clean the company name by removing:
   - Common suffixes like "Inc.", "LLC", "Corp", "Ltd", "Co.", "Company"
   - Extra words like "at", "and", "the"
   - Parentheses and extra punctuation
   - Location names (cities, states, countries)

2. Standardize the name to its most recognizable form
3. Check if this looks like a real, legitimate company
4. If it seems like a typo, suggest the most likely correct company name

EXAMPLES:
- "CEO at Sumitomo Inc." → "Sumitomo"
- "Software Engineer at Google LLC" → "Google" 
- "Manager at Apple Inc." → "Apple"
- "Sumitimo" → "Sumitomo" (typo correction)
- "Microsoft Corporation" → "Microsoft"
- "Amazon Web Services" → "Amazon"

RESPOND WITH JSON ONLY:
{
  "cleanedName": "The cleaned company name",
  "isRealCompany": true/false,
  "confidence": "high/medium/low",
  "suggestedCorrection": "If typo detected, suggest correct name",
  "reasoning": "Brief explanation of your decision"
}`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "You are a professional data parser. Always respond with valid JSON only."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.1,
            max_tokens: 300
        });

        const response = completion.choices[0].message.content.trim();
        console.log(`🤖 GPT Response: ${response}`);
        
        let parsedResponse;
        try {
            parsedResponse = JSON.parse(response);
        } catch (parseError) {
            console.error('❌ Failed to parse GPT response as JSON:', response);
            return res.json({
                success: false,
                error: 'Failed to parse AI response',
                fallback: rawCompanyName
            });
        }

        // If GPT suggests a correction and has high confidence, use it
        const finalCompanyName = parsedResponse.suggestedCorrection && 
                                parsedResponse.confidence === 'high' 
                                ? parsedResponse.suggestedCorrection 
                                : parsedResponse.cleanedName;

        console.log(`✅ Final company name: "${finalCompanyName}" (confidence: ${parsedResponse.confidence})`);

        res.json({
            success: true,
            originalName: rawCompanyName,
            cleanedName: finalCompanyName,
            isRealCompany: parsedResponse.isRealCompany,
            confidence: parsedResponse.confidence,
            reasoning: parsedResponse.reasoning
        });

    } catch (error) {
        console.error('❌ Error parsing company name:', error);
        res.json({
            success: false,
            error: error.message,
            fallback: rawCompanyName
        });
    }
});

// Find email using Hunter.io API
app.post('/api/find-email', authenticateToken, async (req, res) => {
    const { firstName, lastName, company, domain } = req.body;
    
    try {
        // Hunter.io API temporarily disabled for testing
        if (false && process.env.HUNTER_API_KEY && domain) {
            console.log(`🔍 Looking up email for ${firstName} ${lastName} at ${domain} via Hunter.io`);
            
            try {
                // Hunter.io domain search
                const searchResponse = await axios.get(`https://api.hunter.io/v2/domain-search`, {
                    params: {
                        domain: domain,
                        api_key: process.env.HUNTER_API_KEY,
                        limit: 10
                    }
                });
                
                if (searchResponse.data && searchResponse.data.data && searchResponse.data.data.emails) {
                    const emails = searchResponse.data.data.emails;
                    
                    // Look for exact name match first
                    const exactMatch = emails.find(email => {
                        const emailName = email.value.split('@')[0].toLowerCase();
                        const firstNameLower = firstName.toLowerCase();
                        const lastNameLower = lastName.toLowerCase();
                        
                        return emailName.includes(firstNameLower) && emailName.includes(lastNameLower);
                    });
                    
                    if (exactMatch) {
                        console.log(`✅ Found exact email match via Hunter.io: ${exactMatch.value}`);
                    return res.json({
                            email: exactMatch.value,
                            source: 'hunter.io',
                            confidence: 'high',
                            verification: exactMatch.verification
                        });
                    }
                    
                    // If no exact match, return the first email found
                    if (emails.length > 0) {
                        console.log(`✅ Found email via Hunter.io: ${emails[0].value}`);
                        return res.json({
                            email: emails[0].value,
                            source: 'hunter.io',
                            confidence: 'medium',
                            verification: emails[0].verification
                        });
                    }
                }
            } catch (hunterError) {
                console.log('Hunter.io error:', hunterError.response?.data || hunterError.message);
            }
        }
        
        // Test mode: Always suggest test email for easy testing
        console.log(`🧪 Test mode: Suggesting test email for ${firstName} ${lastName}`);
            return res.json({
            suggestions: [
                'pss9179@stern.nyu.edu',  // Your test email
                'test@example.com',
                'testuser@company.com'
            ],
            source: 'test-mode',
                confidence: 'low',
            message: 'Test mode: Use one of the suggested test emails for testing response detection.'
            });
        
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

// Get contacts in a cadence
app.get('/api/cadences/:id/contacts', authenticateToken, (req, res) => {
    const cadenceId = req.params.id;
    
    db.all(`
        SELECT c.* FROM contacts c
        INNER JOIN cadence_contacts cc ON c.id = cc.contact_id
        WHERE cc.cadence_id = ? AND c.user_id = ?
        ORDER BY cc.added_at DESC
    `, [cadenceId, req.user.userId], (err, contacts) => {
        if (err) {
            console.error('Error getting cadence contacts:', err);
            res.status(500).json({ error: 'Database error' });
        } else {
            res.json(contacts);
        }
    });
});

// Get cadence progress (contacts and their current positions)
app.get('/api/cadences/:id/progress', authenticateToken, (req, res) => {
    const cadenceId = req.params.id;
    
    db.all(`
        SELECT 
            c.id as contact_id,
            c.name as contact_name,
            c.email as contact_email,
            cp.current_node_id,
            cp.status as progress_status,
            cp.updated_at
        FROM contacts c
        INNER JOIN cadence_contacts cc ON c.id = cc.contact_id
        LEFT JOIN cadence_progress cp ON c.id = cp.contact_id AND cp.cadence_id = ?
        WHERE cc.cadence_id = ? AND c.user_id = ?
        ORDER BY cp.updated_at DESC
    `, [cadenceId, cadenceId, req.user.userId], (err, progress) => {
        if (err) {
            console.error('Error getting cadence progress:', err);
            res.status(500).json({ error: 'Database error' });
        } else {
            res.json(progress);
        }
    });
});

// Update contact progress in cadence
app.post('/api/cadences/:id/progress', authenticateToken, (req, res) => {
    const cadenceId = req.params.id;
    const { contactId, currentNodeId, status = 'active' } = req.body;
    
    db.run(`
        INSERT OR REPLACE INTO cadence_progress (cadence_id, contact_id, current_node_id, status, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [cadenceId, contactId, currentNodeId, status], function(err) {
        if (err) {
            console.error('Error updating cadence progress:', err);
            res.status(500).json({ error: 'Database error' });
        } else {
            res.json({ message: 'Progress updated successfully' });
        }
    });
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
        
        // Record the cadence-contact relationship
        await new Promise((resolve, reject) => {
            db.run(`INSERT OR IGNORE INTO cadence_contacts (cadence_id, contact_id) VALUES (?, ?)`,
                [cadenceId, contactId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
        
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

    // Create a temporary cadence record to track this execution
    const cadenceName = `Test Run - ${new Date().toLocaleString()}`;
    db.run(
        'INSERT INTO cadences (user_id, name, nodes, connections, is_active) VALUES (?, ?, ?, ?, 1)',
        [req.user.userId, cadenceName, JSON.stringify(nodes), JSON.stringify(connections)],
        async function(err) {
            if (err) {
                console.error('Error creating cadence record:', err);
                return res.status(500).json({ error: 'Failed to create cadence' });
            }

            const cadenceId = this.lastID;
    
    // Process workflow from start node
    try {
                const results = await processWorkflowExecution(nodes, connections, startNode, req.user.userId, null, cadenceId);
        
        res.json({ 
            success: true,
            message: `Workflow executed! ${results.emailsSent} email(s) sent successfully.`,
                    details: results,
                    cadenceId: cadenceId
        });
    } catch (error) {
        console.error('❌ Workflow execution error:', error);
        res.status(500).json({ error: error.message });
    }
        }
    );
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
    
    // Create a temporary cadence record to track this execution
    const cadenceName = `Workflow Execution - ${new Date().toLocaleString()}`;
    db.run(
        'INSERT INTO cadences (user_id, name, nodes, connections, is_active) VALUES (?, ?, ?, ?, 1)',
        [req.user.userId, cadenceName, JSON.stringify(nodes), JSON.stringify(connections)],
        function(err) {
            if (err) {
                console.error('Error creating cadence record:', err);
                return res.status(500).json({ error: 'Failed to create cadence' });
            }

            const cadenceId = this.lastID;
    let totalEmailsScheduled = 0;
    
    // Schedule emails for each contact
    contactIds.forEach(contactId => {
        console.log(`\n📋 Scheduling cadence for contact ${contactId}...`);
                const emailCount = scheduleCadenceForContact(cadenceId, contactId, nodes, connections, startNode, req.user.userId);
        totalEmailsScheduled += emailCount;
    });
    
    console.log(`\n✅ Total emails scheduled: ${totalEmailsScheduled}`);
    
    // Process immediate emails (0-day delays)
    setTimeout(() => {
        processEmailsImmediately();
    }, 1000);
    
    res.json({ 
        message: 'Cadence started successfully',
                emailsScheduled: totalEmailsScheduled,
                cadenceId: cadenceId
    });
        }
    );
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
async function processWorkflowExecution(nodes, connections, startNode, userId, contact = null, cadenceId = null) {
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
                } else if (config.delayType === 'seconds') {
                    delayMs = (config.delayValue || 0) * 1000;
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
    
    // Simple linked list traversal - just send emails in order
    let threadId = null;
    let firstSubject = null; // Track first email's subject for threading
    let firstMessageId = null; // Track first email's Message-ID for threading

    for (let i = 0; i < emailSequence.length; i++) {
        const email = emailSequence[i];
        const isFirstEmail = (i === 0);
        
        // Use first email's subject for all follow-ups (for proper Gmail threading)
        const emailSubject = isFirstEmail ? email.subject : firstSubject;

        console.log(`\n📧 Email ${i + 1}/${emailSequence.length}: ${emailSubject}`);
        console.log(`   To: ${email.to}`);
        console.log(`   Delay: ${email.delayMs}ms`);
        console.log(`   Thread ID: ${threadId || 'New thread'}`);
        
        if (email.delayMs === 0) {
            // Send immediately
            try {
                const result = await sendDirectEmail(user, email.to, emailSubject, email.body, threadId, firstMessageId);
                if (isFirstEmail) {
                    threadId = result.threadId; // Capture thread ID from first email
                    firstSubject = email.subject; // Capture first subject
                    firstMessageId = result.messageId; // Capture first email's Message-ID for threading
                    console.log(`   🧵 First email Message-ID: ${firstMessageId}`);
                }
                console.log(`   ✅ Email sent${threadId ? ' in thread: ' + result.threadId : ''}`);

                // Log the sent email
                await logSentEmail(userId, contact ? contact.id : null, cadenceId, result.messageId, result.threadId, emailSubject, email.to, email.node.id);
                
                // Update progress tracking
                if (contact && cadenceId) {
                    await new Promise((resolve, reject) => {
                        db.run(`
                            INSERT OR REPLACE INTO cadence_progress (cadence_id, contact_id, current_node_id, status, updated_at)
                            VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP)
                        `, [cadenceId, contact.id, email.node.id], function(err) {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                }
                
                results.emailsSent++;
            } catch (error) {
                console.error(`   ❌ Failed to send email: ${error.message}`);
                results.errors.push(error.message);
            }
        } else {
            // Schedule for later
            const scheduledDate = new Date(Date.now() + email.delayMs);
            console.log(`   ⏰ Scheduling for ${scheduledDate.toLocaleString()}`);

            // Add to email_queue for tracking
            await new Promise((resolve, reject) => {
                db.run(`
                    INSERT INTO email_queue (user_id, contact_id, cadence_id, node_id, subject, template, scheduled_for, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
                `, [userId, contact ? contact.id : null, cadenceId, email.node.id, emailSubject, email.body, scheduledDate.toISOString()], function(err) {
                    if (err) reject(err);
                    else {
                        console.log(`   📝 Added to email_queue with ID: ${this.lastID}`);
                        resolve(this.lastID);
                    }
                });
            });

            // Capture thread ID, subject, and first Message-ID for closure
            const capturedThreadId = threadId;
            const capturedSubject = emailSubject;
            const capturedFirstMessageId = firstMessageId;
            
            setTimeout(async () => {
                try {
                    const result = await sendDirectEmail(user, email.to, capturedSubject, email.body, capturedThreadId, capturedFirstMessageId);
                    console.log(`   ✅ Scheduled email sent in thread: ${result.threadId}`);

                    // Update email_queue status
                    await new Promise((resolve, reject) => {
                        db.run(`
                            UPDATE email_queue
                            SET status = 'sent', sent_at = CURRENT_TIMESTAMP
                            WHERE cadence_id = ? AND node_id = ? AND user_id = ? AND status = 'pending'
                        `, [cadenceId, email.node.id, userId], (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });

                    // Log the sent email
                    await logSentEmail(userId, contact ? contact.id : null, cadenceId, result.messageId, result.threadId, capturedSubject, email.to, email.node.id);
                    
                    // Update progress tracking
                    if (contact && cadenceId) {
                        await new Promise((resolve, reject) => {
                            db.run(`
                                INSERT OR REPLACE INTO cadence_progress (cadence_id, contact_id, current_node_id, status, updated_at)
                                VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP)
                            `, [cadenceId, contact.id, email.node.id], function(err) {
                                if (err) reject(err);
                                else resolve();
                            });
                        });
                    }
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
    
    // Use exact subject as passed (no "Re:" prefix)
    const emailSubject = subject;
    
    // Create email with proper MIME format
    const utf8Subject = `=?utf-8?B?${Buffer.from(emailSubject).toString('base64')}?=`;
    const contentType = detectEmailContentType(body);
    
    // Convert plain text to HTML if needed for better Gmail rendering
    let emailBody = body;
    if (contentType === 'text/plain') {
        emailBody = convertTextToHtml(body);
    }
    
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
    messageParts.push(emailBody);
    const message = messageParts.join('\r\n'); // CRITICAL: Use CRLF for MIME
    
    // Log the raw message before encoding to verify HTML formatting
    console.log(`📝 Raw message before encoding (text/html):`);
    console.log(message);
    
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
    
    // Get the actual Message-ID from the sent email's headers
    let messageId = `<${result.data.id}@mail.gmail.com>`; // fallback
    
    try {
        const sentMessage = await gmail.users.messages.get({
            userId: 'me',
            id: result.data.id
        });
        
        const headers = sentMessage.data.payload.headers;
        const messageIdHeader = headers.find(h => h.name === 'Message-ID');
        if (messageIdHeader) {
            messageId = messageIdHeader.value;
            console.log(`   📧 Actual Message-ID: ${messageId}`);
        } else {
            console.log(`   📧 Using fallback Message-ID: ${messageId}`);
        }
    } catch (error) {
        console.log(`   📧 Error getting Message-ID, using fallback: ${messageId}`);
    }
    
    // Log the sent email for response tracking
    // Note: This function doesn't have access to contactId, so we'll need to pass it
    // For now, we'll log with contactId as null and update later if needed
    try {
        console.log(`📧 Logging sent email (direct): messageId=${result.data.id}, threadId=${result.data.threadId}`);
        // We need to get the user ID and contact info to log properly
        // This will be handled by the calling function
    } catch (logError) {
        console.error('❌ Error logging sent email (direct):', logError);
    }
    
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
    
    // For the first email step (delayDays === 0), create a Gmail draft
    if (delayDays === 0) {
        console.log(`📝 Creating Gmail draft for first email step`);
        createGmailDraftForCadence(userId, contactId, node, cadenceId);
    }
    
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
            console.log('   Thread ID:', result.data.threadId);
                
                // Log the sent email for response tracking
                try {
                    console.log(`📧 Logging sent email: userId=${userId}, contactId=${contactId}, messageId=${result.data.id}, threadId=${result.data.threadId}`);
                    await logSentEmail(userId, contactId, null, result.data.id, result.data.threadId, subject, contact.email);
                    console.log('✅ Email logged successfully');
                } catch (logError) {
                    console.error('❌ Error logging sent email:', logError);
                }
                
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
                    console.log('   Thread ID:', retryResult.data.threadId);
                    
                    // Log the sent email for response tracking
                    try {
                        console.log(`📧 Logging sent email (retry): userId=${userId}, contactId=${contactId}, messageId=${retryResult.data.id}, threadId=${retryResult.data.threadId}`);
                        await logSentEmail(userId, contactId, null, retryResult.data.id, retryResult.data.threadId, subject, contact.email);
                        console.log('✅ Email logged successfully (retry)');
                    } catch (logError) {
                        console.error('❌ Error logging sent email (retry):', logError);
                    }
                    
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
// Email response tracking endpoints
app.post('/api/check-responses', authenticateToken, async (req, res) => {
    try {
        console.log(`🔍 Manual response check triggered for user ${req.user.userId}`);
        const result = await checkForEmailResponses(req.user.userId);
        res.json({
            success: true,
            responsesFound: result.responsesFound,
            errors: result.errors,
            message: `Found ${result.responsesFound} new responses`
        });
    } catch (error) {
        console.error('Error checking responses:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to check for responses',
            details: error.message 
        });
    }
});

// Google Calendar integration
app.get('/api/calendar/events', authenticateToken, async (req, res) => {
    try {
        // Get user's Google OAuth tokens
        const user = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM users WHERE id = ?", [req.user.userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!user || !user.access_token) {
            return res.status(401).json({ error: 'User not authenticated with Google' });
        }

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

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        // Get upcoming events
        const response = await calendar.events.list({
            calendarId: 'primary',
            timeMin: new Date().toISOString(),
            maxResults: 10,
            singleEvents: true,
            orderBy: 'startTime',
        });

        const events = response.data.items || [];
        
        res.json({
            success: true,
            events: events.map(event => ({
                id: event.id,
                summary: event.summary || 'No Title',
                start: event.start?.dateTime || event.start?.date,
                end: event.end?.dateTime || event.end?.date,
                location: event.location,
                description: event.description
            }))
        });

    } catch (error) {
        console.error('Error fetching calendar events:', error);
        res.status(500).json({ 
            error: 'Failed to fetch calendar events',
            details: error.message 
        });
    }
});

// AI-powered scheduling assistant
app.post('/api/scheduling/analyze-response', authenticateToken, async (req, res) => {
    try {
        const { responseText, contactEmail, contactName } = req.body;
        
        console.log(`🤖 Analyzing response for scheduling intent: ${contactEmail}`);
        
        // Use GPT to analyze scheduling intent and extract times
        const gptResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4',
                messages: [
                    {
                        role: 'system',
                        content: `You are an AI scheduling assistant. Analyze the following email response to determine if the person is asking for scheduling/meeting availability or suggesting specific times.

Respond with a JSON object containing:
- schedulingType: "none", "request_availability", "book_specific_time", or "general_scheduling"
- suggestedTimes: array of specific times mentioned (if any) in natural language format
- confidence: number between 0-1

SCHEDULING INDICATORS:
- "available", "free", "schedule", "meet", "call", "chat", "talk"
- "tomorrow", "next week", "Monday", "Tuesday", etc.
- "morning", "afternoon", "evening"
- "2pm", "10am", "6pm", etc.
- "when are you free", "what time works", "let's schedule"

EXAMPLES:
- "I'm available next week" → {"schedulingType": "request_availability", "suggestedTimes": [], "confidence": 0.9}
- "How about Tuesday at 2pm?" → {"schedulingType": "book_specific_time", "suggestedTimes": ["Tuesday at 2pm"], "confidence": 0.95}
- "I can do tomorrow morning or Friday afternoon" → {"schedulingType": "book_specific_time", "suggestedTimes": ["tomorrow morning", "Friday afternoon"], "confidence": 0.9}
- "Let's schedule a call" → {"schedulingType": "request_availability", "suggestedTimes": [], "confidence": 0.8}
- "Thanks for the email" → {"schedulingType": "none", "suggestedTimes": [], "confidence": 0.8}
- "I'm interested but busy this week" → {"schedulingType": "none", "suggestedTimes": [], "confidence": 0.7}`
                    },
                    {
                        role: 'user',
                        content: `Analyze this email response: "${responseText}"`
                    }
                ],
                temperature: 0.1
            })
        });
        
        if (!gptResponse.ok) {
            console.log('❌ Failed to call GPT for scheduling analysis');
            return res.json({ schedulingType: 'none', suggestedTimes: [], confidence: 0 });
        }
        
        const gptData = await gptResponse.json();
        const analysis = JSON.parse(gptData.choices[0].message.content);
        
        console.log(`📅 GPT scheduling analysis: ${analysis.schedulingType} (confidence: ${analysis.confidence})`);
        
        res.json({
            success: true,
            schedulingType: analysis.schedulingType,
            suggestedTimes: analysis.suggestedTimes,
            confidence: analysis.confidence
        });
        
    } catch (error) {
        console.error('Error analyzing scheduling response:', error);
        res.status(500).json({ 
            error: 'Failed to analyze scheduling response',
            details: error.message 
        });
    }
});

// Get availability for scheduling
app.get('/api/scheduling/availability', authenticateToken, async (req, res) => {
    try {
        const { days = 14 } = req.query;
        
        // Get user's Google OAuth tokens
        const user = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM users WHERE id = ?", [req.user.userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!user || !user.access_token) {
            return res.status(401).json({ error: 'User not authenticated with Google' });
        }

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

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        // Get events for the next N days
        const timeMin = new Date();
        const timeMax = new Date();
        timeMax.setDate(timeMax.getDate() + parseInt(days));

        const response = await calendar.events.list({
            calendarId: 'primary',
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });

        const events = response.data.items || [];
        
        // Generate available 30-minute slots
        const availableSlots = generateAvailableSlots(events, parseInt(days));
        
        res.json({
            success: true,
            availableSlots,
            totalSlots: availableSlots.length,
            daysChecked: parseInt(days)
        });

    } catch (error) {
        console.error('Error fetching availability:', error);
        res.status(500).json({ 
            error: 'Failed to fetch availability',
            details: error.message 
        });
    }
});

// Fetch availability from Google Calendar
app.post('/api/scheduling/availability', authenticateToken, async (req, res) => {
    try {
        const { timeRange, timezone = 'EDT' } = req.body;
        
        console.log(`📅 Fetching availability for ${timeRange} in ${timezone}`);
        
        // Get user's Google OAuth tokens
        const user = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM users WHERE id = ?", [req.user.userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!user || !user.access_token) {
            return res.status(401).json({ error: 'User not authenticated with Google' });
        }

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

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        // Parse time range and get start/end dates
        let startDate, endDate;
        const now = new Date();
        
        if (timeRange.toLowerCase().includes('next week')) {
            // Next week (Monday to Friday)
            const nextMonday = new Date(now);
            nextMonday.setDate(now.getDate() + (1 + 7 - now.getDay()) % 7);
            nextMonday.setHours(9, 0, 0, 0);
            
            const nextFriday = new Date(nextMonday);
            nextFriday.setDate(nextMonday.getDate() + 4);
            nextFriday.setHours(17, 0, 0, 0);
            
            startDate = nextMonday;
            endDate = nextFriday;
        } else if (timeRange.toLowerCase().includes('week of')) {
            // Extract date from "Week of October 7th" format
            const dateMatch = timeRange.match(/(\w+)\s+(\d+)(?:st|nd|rd|th)?/i);
            if (dateMatch) {
                const month = dateMatch[1];
                const day = parseInt(dateMatch[2]);
                const currentYear = now.getFullYear();
                
                const monthIndex = new Date(`${month} 1, ${currentYear}`).getMonth();
                const weekStart = new Date(currentYear, monthIndex, day);
                weekStart.setHours(9, 0, 0, 0);
                
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekStart.getDate() + 4);
                weekEnd.setHours(17, 0, 0, 0);
                
                startDate = weekStart;
                endDate = weekEnd;
            } else {
                // Default to next week if parsing fails
                const nextMonday = new Date(now);
                nextMonday.setDate(now.getDate() + (1 + 7 - now.getDay()) % 7);
                nextMonday.setHours(9, 0, 0, 0);
                
                const nextFriday = new Date(nextMonday);
                nextFriday.setDate(nextMonday.getDate() + 4);
                nextFriday.setHours(17, 0, 0, 0);
                
                startDate = nextMonday;
                endDate = nextFriday;
            }
        } else {
            // Default to next week
            const nextMonday = new Date(now);
            nextMonday.setDate(now.getDate() + (1 + 7 - now.getDay()) % 7);
            nextMonday.setHours(9, 0, 0, 0);
            
            const nextFriday = new Date(nextMonday);
            nextFriday.setDate(nextMonday.getDate() + 4);
            nextFriday.setHours(17, 0, 0, 0);
            
            startDate = nextMonday;
            endDate = nextFriday;
        }

        // Get busy times from calendar
        const freeBusyResponse = await calendar.freebusy.query({
            resource: {
                timeMin: startDate.toISOString(),
                timeMax: endDate.toISOString(),
                items: [{ id: 'primary' }]
            }
        });

        const busyTimes = freeBusyResponse.data.calendars.primary.busy || [];
        
        // Generate available time slots (9 AM - 5 PM, 30-minute slots)
        const availableSlots = [];
        const current = new Date(startDate);
        
        while (current < endDate) {
            const slotStart = new Date(current);
            const slotEnd = new Date(slotStart.getTime() + 30 * 60000);
            
            // Check if this slot conflicts with busy times
            const isBusy = busyTimes.some(busy => {
                const busyStart = new Date(busy.start);
                const busyEnd = new Date(busy.end);
                return (slotStart < busyEnd && slotEnd > busyStart);
            });
            
            if (!isBusy && slotStart.getHours() >= 9 && slotEnd.getHours() <= 17) {
                const dayName = slotStart.toLocaleDateString('en-US', { weekday: 'long' });
                const dateStr = slotStart.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
                const timeStr = slotStart.toLocaleTimeString('en-US', { 
                    hour: 'numeric', 
                    minute: '2-digit',
                    hour12: true 
                });
                const endTimeStr = slotEnd.toLocaleTimeString('en-US', { 
                    hour: 'numeric', 
                    minute: '2-digit',
                    hour12: true 
                });
                
                availableSlots.push({
                    start: slotStart.toISOString(),
                    end: slotEnd.toISOString(),
                    display: `${dayName} (${dateStr}) - ${timeStr} - ${endTimeStr}`
                });
            }
            
            current.setTime(current.getTime() + 30 * 60000);
        }

        console.log(`✅ Found ${availableSlots.length} available slots`);
        
        res.json({
            success: true,
            timeRange: timeRange,
            timezone: timezone,
            availableSlots: availableSlots.slice(0, 8) // Limit to 8 slots
        });

    } catch (error) {
        console.error('❌ Error fetching availability:', error);
        res.status(500).json({ error: 'Failed to fetch availability' });
    }
});

// Create calendar invite
app.post('/api/scheduling/create-meeting', authenticateToken, async (req, res) => {
    try {
        const { contactEmail, contactName, startTime, duration = 30, subject = 'Meeting' } = req.body;
        
        console.log(`📅 Creating meeting with ${contactName} (${contactEmail}) at ${startTime}`);
        
        // Get user's Google OAuth tokens
        const user = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM users WHERE id = ?", [req.user.userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!user || !user.access_token) {
            return res.status(401).json({ error: 'User not authenticated with Google' });
        }

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

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        // Create the event
        const startDateTime = new Date(startTime);
        const endDateTime = new Date(startDateTime.getTime() + duration * 60000);

        const event = {
            summary: subject,
            description: `Meeting between you and ${contactName}`,
            start: {
                dateTime: startDateTime.toISOString(),
                timeZone: 'America/New_York',
            },
            end: {
                dateTime: endDateTime.toISOString(),
                timeZone: 'America/New_York',
            },
            attendees: [
                { email: contactEmail, displayName: contactName },
                { email: user.email, displayName: user.name || 'You' }
            ],
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'email', minutes: 24 * 60 },
                    { method: 'popup', minutes: 10 },
                ],
            },
        };

        const response = await calendar.events.insert({
            calendarId: 'primary',
            resource: event,
            sendUpdates: 'all'
        });

        console.log(`✅ Meeting created: ${response.data.id}`);
        
        res.json({
            success: true,
            eventId: response.data.id,
            meetingLink: response.data.htmlLink,
            startTime: startDateTime.toISOString(),
            endTime: endDateTime.toISOString(),
            attendees: [contactEmail, user.email]
        });

    } catch (error) {
        console.error('Error creating meeting:', error);
        res.status(500).json({ 
            error: 'Failed to create meeting',
            details: error.message 
        });
    }
});

app.get('/api/responses', authenticateToken, (req, res) => {
    const { limit = 50, offset = 0, unread_only = false } = req.query;
    
    let query = `
        SELECT er.*, c.name as contact_name, c.email as contact_email, c.company as contact_company,
               cad.name as cadence_name
        FROM email_responses er
        JOIN contacts c ON er.contact_id = c.id
        LEFT JOIN cadences cad ON er.cadence_id = cad.id
        WHERE er.user_id = ?
    `;
    
    const params = [req.user.userId];
    
    if (unread_only === 'true') {
        query += ' AND er.is_read = 0';
    }
    
    query += ' ORDER BY er.response_date DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    db.all(query, params, (err, responses) => {
        if (err) {
            console.error('Error fetching responses:', err);
            res.status(500).json({ error: 'Database error' });
        } else {
            res.json(responses);
        }
    });
});

app.get('/api/responses/stats', authenticateToken, (req, res) => {
    const queries = [
        // Total responses
        `SELECT COUNT(*) as total FROM email_responses WHERE user_id = ?`,
        // Unread responses
        `SELECT COUNT(*) as unread FROM email_responses WHERE user_id = ? AND is_read = 0`,
        // Responses this week
        `SELECT COUNT(*) as this_week FROM email_responses WHERE user_id = ? AND response_date > datetime('now', '-7 days')`,
        // Response rate
        `SELECT 
            (SELECT COUNT(*) FROM email_responses WHERE user_id = ?) as responses,
            (SELECT COUNT(*) FROM email_logs WHERE user_id = ?) as emails_sent`
    ];
    
    const userId = req.user.userId;
    
    Promise.all([
        new Promise((resolve, reject) => {
            db.get(queries[0], [userId], (err, row) => {
                if (err) reject(err);
                else resolve(row.total);
            });
        }),
        new Promise((resolve, reject) => {
            db.get(queries[1], [userId], (err, row) => {
                if (err) reject(err);
                else resolve(row.unread);
            });
        }),
        new Promise((resolve, reject) => {
            db.get(queries[2], [userId], (err, row) => {
                if (err) reject(err);
                else resolve(row.this_week);
            });
        }),
        new Promise((resolve, reject) => {
            db.get(queries[3], [userId, userId], (err, row) => {
                if (err) reject(err);
                else {
                    const responseRate = row.emails_sent > 0 ? (row.responses / row.emails_sent * 100).toFixed(1) : 0;
                    resolve(responseRate);
                }
            });
        })
    ]).then(([total, unread, thisWeek, responseRate]) => {
        res.json({
            total,
            unread,
            thisWeek,
            responseRate: parseFloat(responseRate)
        });
    }).catch(err => {
        console.error('Error fetching response stats:', err);
        res.status(500).json({ error: 'Database error' });
    });
});

// Get workflow execution status for a cadence/contact
app.get('/api/cadences/:cadenceId/execution-status', authenticateToken, (req, res) => {
    const cadenceId = req.params.cadenceId;
    const contactId = req.query.contactId;
    const userId = req.user.userId;

    console.log(`📊 Fetching execution status for cadence ${cadenceId}`);

    // First, get the cadence to extract node information
    db.get('SELECT nodes FROM cadences WHERE id = ? AND user_id = ?', [cadenceId, userId], (err, cadence) => {
        if (err || !cadence) {
            console.error('Error fetching cadence:', err);
            return res.status(500).json({ error: 'Cadence not found' });
        }

        const nodes = JSON.parse(cadence.nodes);
        const emailNodes = nodes.filter(n => ['email', 'followup-email', 'followup-email2', 'new-email'].includes(n.type));

        console.log(`   Found ${emailNodes.length} email nodes in cadence`);

        // Get sent emails from email_logs (for immediately sent emails)
        const logsQuery = `SELECT * FROM email_logs WHERE cadence_id = ? AND user_id = ?`;

        // Get queued emails from email_queue (for scheduled emails)
        const queueQuery = `SELECT * FROM email_queue WHERE cadence_id = ? AND user_id = ?`;

        const params = [cadenceId, userId];

        Promise.all([
            new Promise((resolve, reject) => {
                db.all(logsQuery, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            }),
            new Promise((resolve, reject) => {
                db.all(queueQuery, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            })
        ]).then(([sentEmails, queuedEmails]) => {
            console.log(`   Sent emails: ${sentEmails.length}, Queued emails: ${queuedEmails.length}`);

            // Create status for each email node
            const nodeStatuses = {};

            emailNodes.forEach(node => {
                // Check if this node has sent emails (match by node_id)
                const sent = sentEmails.filter(e => e.node_id === node.id);

                // Check if this node has queued emails (match by node_id)
                const queued = queuedEmails.filter(e => e.node_id === node.id);

                const sentCount = sent.length;
                const pendingCount = queued.filter(e => e.status === 'pending').length;
                const cancelledCount = queued.filter(e => e.status === 'cancelled').length;

                if (sentCount > 0 || pendingCount > 0 || cancelledCount > 0) {
                    nodeStatuses[node.id] = {
                        nodeId: node.id,
                        sent: sentCount,
                        pending: pendingCount,
                        cancelled: cancelledCount
                    };
                }
            });

            console.log(`   Node statuses:`, nodeStatuses);

            // Format response
            res.json({
                cadenceId: parseInt(cadenceId),
                contacts: [{
                    contactId: null,
                    contactEmail: null,
                    contactName: 'Test Run',
                    emails: Object.values(nodeStatuses).map(ns => ({
                        nodeId: ns.nodeId,
                        // Priority: cancelled > pending > sent
                        // If there are ANY pending or cancelled, show that instead of sent
                        status: ns.cancelled > 0 ? 'cancelled' : (ns.pending > 0 ? 'pending' : 'sent'),
                        sentAt: ns.sent > 0 && ns.pending === 0 ? new Date() : null
                    })),
                    hasReplied: false,
                    workflowBroken: false
                }],
                nodeStatuses: nodeStatuses
            });
        }).catch(err => {
            console.error('Error fetching email status:', err);
            res.status(500).json({ error: 'Database error' });
        });
    });
});

// Get email logs for a cadence
app.get('/api/email-logs', authenticateToken, (req, res) => {
    const cadenceId = req.query.cadence_id;
    const userId = req.user.userId;

    if (!cadenceId) {
        return res.status(400).json({ error: 'cadence_id is required' });
    }

    db.all(`
        SELECT * FROM email_logs
        WHERE user_id = ? AND cadence_id = ?
        ORDER BY sent_at ASC
    `, [userId, cadenceId], (err, rows) => {
        if (err) {
            console.error('Error fetching email logs:', err);
            res.status(500).json({ error: 'Database error' });
        } else {
            res.json(rows);
        }
    });
});

app.put('/api/responses/:id/read', authenticateToken, (req, res) => {
    const responseId = req.params.id;

    db.run(
        'UPDATE email_responses SET is_read = 1 WHERE id = ? AND user_id = ?',
        [responseId, req.user.userId],
        function(err) {
            if (err) {
                console.error('Error marking response as read:', err);
                res.status(500).json({ error: 'Database error' });
            } else if (this.changes === 0) {
                res.status(404).json({ error: 'Response not found' });
            } else {
                res.json({ success: true, message: 'Response marked as read' });
            }
        }
    );
});

// Test endpoint for response tracking system
app.post('/api/test-response-tracking', authenticateToken, async (req, res) => {
    try {
        console.log('🧪 Testing response tracking system...');
        
        // 1. Create a test contact
        const testContact = await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO contacts (user_id, email, name, company, first_name, last_name)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [req.user.userId, 'test@example.com', 'Test User', 'Test Company', 'Test', 'User'], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID });
            });
        });
        
        // 2. Create a test cadence
        const testCadence = await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO cadences (user_id, name, nodes, connections, is_active)
                VALUES (?, ?, ?, ?, ?)
            `, [req.user.userId, 'Test Cadence', '[]', '[]', 1], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID });
            });
        });
        
        // 3. Log a sent email
        const sentEmail = await logSentEmail(
            req.user.userId,
            testContact.id,
            testCadence.id,
            'test-message-123',
            'test-thread-456',
            'Test Subject',
            'test@example.com'
        );
        
        // 4. Simulate a response
        const testResponse = await logEmailResponse(
            req.user.userId,
            testContact.id,
            testCadence.id,
            'test-message-123',
            'response-message-789',
            'Re: Test Subject',
            'Thanks for reaching out! I am interested in learning more.',
            'Test User <test@example.com>',
            new Date()
        );
        
        // 5. Test the stats endpoint
        const statsResponse = await fetch(`http://localhost:3000/api/responses/stats`, {
            headers: { 'Authorization': `Bearer ${req.headers.authorization.split(' ')[1]}` }
        });
        const stats = await statsResponse.json();
        
        // 6. Test the responses endpoint
        const responsesResponse = await fetch(`http://localhost:3000/api/responses`, {
            headers: { 'Authorization': `Bearer ${req.headers.authorization.split(' ')[1]}` }
        });
        const responses = await responsesResponse.json();
        
        console.log('✅ Response tracking test completed successfully!');
        
        res.json({
            success: true,
            message: 'Response tracking system test completed',
            testData: {
                contactId: testContact.id,
                cadenceId: testCadence.id,
                sentEmailId: sentEmail,
                responseId: testResponse,
                stats: stats,
                responseCount: responses.length
            }
        });
        
    } catch (error) {
        console.error('❌ Response tracking test failed:', error);
        res.status(500).json({
            success: false,
            error: 'Test failed',
            details: error.message
        });
    }
});

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

// Test endpoint for time parsing
app.post('/api/test/parse-time', async (req, res) => {
    try {
        const { timeStr } = req.body;
        console.log(`🧪 Testing time parsing for: "${timeStr}"`);
        
        const parsedTime = await parseSuggestedTime(timeStr);
        console.log(`🧪 Parsed result:`, parsedTime);
        
        res.json({ success: true, parsedTime });
    } catch (error) {
        console.error('❌ Error in test time parsing:', error);
        res.json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
    
    // Start background response checking
    startResponsePolling();
});

// Helper function to extract suggested times from text
function extractSuggestedTimes(text) {
    const timePatterns = [
        /(\d{1,2}):?(\d{2})?\s*(am|pm)/gi,
        /(\d{1,2})\s*(am|pm)/gi,
        /(morning|afternoon|evening)/gi
    ];
    
    const times = [];
    const textLower = text.toLowerCase();
    
    // Extract specific times
    timePatterns.forEach(pattern => {
        const matches = text.match(pattern);
        if (matches) {
            times.push(...matches);
        }
    });
    
    // Extract day mentions
    const dayPatterns = [
        /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/gi,
        /(tomorrow|today)/gi
    ];
    
    dayPatterns.forEach(pattern => {
        const matches = text.match(pattern);
        if (matches) {
            times.push(...matches);
        }
    });
    
    return [...new Set(times)]; // Remove duplicates
}

// Helper function to generate available 30-minute slots
function generateAvailableSlots(events, days) {
    const slots = [];
    const now = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);
    
    // Business hours: 9 AM to 6 PM
    const startHour = 9;
    const endHour = 18;
    
    // Convert events to time ranges for easier checking
    const busyTimes = events.map(event => {
        const start = new Date(event.start?.dateTime || event.start?.date);
        const end = new Date(event.end?.dateTime || event.end?.date);
        return { start, end };
    });
    
    // Generate slots for each day
    for (let day = 0; day < days; day++) {
        const currentDate = new Date(now);
        currentDate.setDate(currentDate.getDate() + day);
        
        // Skip weekends for now (you can modify this)
        if (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
            continue;
        }
        
        // Generate 30-minute slots for business hours
        for (let hour = startHour; hour < endHour; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                const slotStart = new Date(currentDate);
                slotStart.setHours(hour, minute, 0, 0);
                
                const slotEnd = new Date(slotStart);
                slotEnd.setMinutes(slotEnd.getMinutes() + 30);
                
                // Skip if slot is in the past
                if (slotStart <= now) continue;
                
                // Check if slot conflicts with existing events
                const hasConflict = busyTimes.some(busy => 
                    (slotStart < busy.end && slotEnd > busy.start)
                );
                
                if (!hasConflict) {
                    slots.push({
                        start: slotStart.toISOString(),
                        end: slotEnd.toISOString(),
                        display: slotStart.toLocaleString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                        }),
                        date: slotStart.toDateString(),
                        time: slotStart.toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                        })
                    });
                }
            }
        }
    }
    
    return slots.slice(0, 20); // Return first 20 available slots
}

// Main scheduling response handler
async function handleSchedulingResponse(userId, fromEmail, responseText, contactId, threadId, responseMessageId, yourOriginalMessageId, originalSubject) {
    console.log(`🤖 Analyzing scheduling response from ${fromEmail} in thread ${threadId}`);
    
    try {
        // Get contact details
        const contact = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM contacts WHERE id = ?", [contactId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!contact) {
            console.log('❌ Contact not found for scheduling response');
            return;
        }
        
        // Check user settings for AI auto-reply
        const userSettings = await new Promise((resolve, reject) => {
            db.get("SELECT ai_auto_reply, ai_draft_mode FROM user_settings WHERE user_id = ?", [userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        // Default to auto-reply ON, draft mode OFF if no settings exist
        const isDraftMode = userSettings?.ai_draft_mode === 1;
        const autoReplyEnabled = userSettings?.ai_auto_reply !== 0; // null/undefined = enabled
        
        console.log('🔍 User settings for AI response:', userSettings);
        console.log('🔍 Auto-reply enabled?', autoReplyEnabled);
        console.log('🔍 Draft mode enabled?', isDraftMode);
        
        if (!autoReplyEnabled) {
            console.log('🤖 AI auto-reply disabled, skipping scheduling response');
            return;
        }
        
        // Analyze the response for scheduling intent
        const analysisResponse = await fetch(`http://localhost:3000/api/scheduling/analyze-response`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${generateTestToken(userId)}`
            },
            body: JSON.stringify({
                responseText,
                contactEmail: fromEmail,
                contactName: contact.name || contact.first_name || 'Contact'
            })
        });
        
        if (!analysisResponse.ok) {
            console.log('❌ Failed to analyze scheduling response');
            return;
        }
        
        const analysis = await analysisResponse.json();
        console.log(`📅 Scheduling analysis result: ${analysis.schedulingType}`);
        
        if (analysis.schedulingType === 'none') {
            console.log('⏭️ No scheduling intent detected, skipping');
            return;
        }
        
        // Handle different scheduling types (pass threading info and original subject)
        if (analysis.schedulingType === 'request_availability') {
            await handleAvailabilityRequest(userId, fromEmail, contact, analysis, threadId, responseMessageId, yourOriginalMessageId, originalSubject);
        } else if (analysis.schedulingType === 'book_specific_time') {
            await handleSpecificTimeBooking(userId, fromEmail, contact, analysis, threadId, responseMessageId, yourOriginalMessageId, originalSubject);
        } else if (analysis.schedulingType === 'general_scheduling') {
            await handleGeneralSchedulingRequest(userId, fromEmail, contact, analysis, threadId, responseMessageId, yourOriginalMessageId, originalSubject);
        }
        
    } catch (error) {
        console.error('❌ Error in handleSchedulingResponse:', error);
    }
}

// Handle when someone asks for your availability
async function handleAvailabilityRequest(userId, fromEmail, contact, analysis, threadId, responseMessageId, yourOriginalMessageId, originalSubject) {
    console.log(`📅 Handling availability request from ${contact.name} in thread ${threadId}`);
    
    try {
        // Extract time range from the response text using GPT
        const timeRangeResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `Extract the time range from this availability request. Return a JSON object with:
- timeRange: "Next Week", "Week of October 7th", "This Week", etc.
- timezone: "EDT", "PST", "EST", etc. (default to "EDT" if not specified)

Examples:
- "I'm available next week" → {"timeRange": "Next Week", "timezone": "EDT"}
- "What's your availability for the week of October 7th?" → {"timeRange": "Week of October 7th", "timezone": "EDT"}
- "When are you free this week?" → {"timeRange": "This Week", "timezone": "EDT"}
- "I'm free next week in PST" → {"timeRange": "Next Week", "timezone": "PST"}`
                    },
                    {
                        role: 'user',
                        content: `Extract time range from: "next week"`
                    }
                ],
                temperature: 0.1
            })
        });
        
        let timeRange = "Next Week";
        let timezone = "EDT";
        
        if (timeRangeResponse.ok) {
            const timeRangeData = await timeRangeResponse.json();
            const parsed = JSON.parse(timeRangeData.choices[0].message.content);
            timeRange = parsed.timeRange || "Next Week";
            timezone = parsed.timezone || "EDT";
        }
        
        console.log(`📅 Fetching availability for ${timeRange} in ${timezone}`);
        
        // Get your availability using the new GCal API
        const availabilityResponse = await fetch(`http://localhost:3000/api/scheduling/availability`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${generateTestToken(userId)}`
            },
            body: JSON.stringify({
                timeRange: timeRange,
                timezone: timezone
            })
        });
        
        if (!availabilityResponse.ok) {
            console.log('❌ Failed to get availability');
            return;
        }
        
        const availability = await availabilityResponse.json();
        
        if (availability.availableSlots.length === 0) {
            console.log('❌ No available slots found');
            return;
        }
        
        // Generate availability response email with proper formatting
        const availabilityText = generateAvailabilityEmail(availability.availableSlots, contact.name, timeRange, timezone);
        
        // Send the availability response in thread using original subject
        await sendSchedulingResponse(userId, fromEmail, originalSubject, availabilityText, threadId, responseMessageId, yourOriginalMessageId);
        
        console.log(`✅ Availability response sent to ${contact.name} in thread ${threadId}`);
        
    } catch (error) {
        console.error('❌ Error handling availability request:', error);
    }
}

// Handle when someone suggests a specific time
async function handleSpecificTimeBooking(userId, fromEmail, contact, analysis, threadId, responseMessageId, yourOriginalMessageId, originalSubject) {
    console.log(`📅 Handling specific time booking from ${contact.name} in thread ${threadId}`);
    
    try {
        // Parse suggested times from the analysis
        const suggestedTimes = analysis.suggestedTimes || [];
        console.log(`📅 Suggested times: ${suggestedTimes.join(', ')}`);
        
        // Try to create a calendar invite for the suggested time
        let calendarEvent = null;
        let meetingTime = null;
        
        if (suggestedTimes.length > 0) {
            // Parse the first suggested time and create a meeting
            const timeStr = suggestedTimes[0];
            meetingTime = await parseSuggestedTime(timeStr);
            
            if (meetingTime) {
                console.log(`📅 Creating calendar invite for: ${meetingTime.start} - ${meetingTime.end}`);
                
                // Get user details for meeting name
                const user = await new Promise((resolve, reject) => {
                    db.get("SELECT * FROM users WHERE id = ?", [userId], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });
                
                // Create calendar event
                const createMeetingResponse = await fetch(`http://localhost:3000/api/scheduling/create-meeting`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${generateTestToken(userId)}`
                    },
                    body: JSON.stringify({
                        contactEmail: fromEmail,
                        contactName: contact.name,
                        startTime: meetingTime.start,
                        endTime: meetingTime.end,
                        subject: `${user?.name || 'You'} <> ${contact.name} Chat`
                    })
                });
                
                if (createMeetingResponse.ok) {
                    calendarEvent = await createMeetingResponse.json();
                    console.log(`✅ Calendar invite created: ${calendarEvent.eventId}`);
                } else {
                    console.log('❌ Failed to create calendar invite');
                }
            }
        }
        
        // Send confirmation with calendar invite details
        let confirmationText;
        if (calendarEvent && meetingTime) {
            confirmationText = `<p style="margin:0 0 16px; line-height:1.5;">Hi ${contact.name},</p>
<p style="margin:0 0 16px; line-height:1.5;">Perfect! I've scheduled our meeting for ${meetingTime.display}. I've sent you a calendar invite with all the details. Looking forward to speaking with you!</p>
<p style="margin:0 0 16px; line-height:1.5;">Best,<br><strong>Pranav</strong></p>`;
        } else {
            confirmationText = `<p style="margin:0 0 16px; line-height:1.5;">Hi ${contact.name},</p>
<p style="margin:0 0 16px; line-height:1.5;">That time works for me! Let me check my calendar and send you a few specific options.</p>
<p style="margin:0 0 16px; line-height:1.5;">Best,<br><strong>Pranav</strong></p>`;
        }
        
        await sendSchedulingResponse(userId, fromEmail, originalSubject, confirmationText, threadId, responseMessageId, yourOriginalMessageId);
        
        console.log(`✅ Time confirmation sent to ${contact.name} in thread ${threadId}`);
        
    } catch (error) {
        console.error('❌ Error handling specific time booking:', error);
    }
}

// Handle general scheduling requests
async function handleGeneralSchedulingRequest(userId, fromEmail, contact, analysis, threadId, responseMessageId, yourOriginalMessageId, originalSubject) {
    console.log(`📅 Handling general scheduling request from ${contact.name} in thread ${threadId}`);
    
    try {
        // Get availability and send it
        await handleAvailabilityRequest(userId, fromEmail, contact, analysis, threadId, responseMessageId, yourOriginalMessageId, originalSubject);
        
    } catch (error) {
        console.error('❌ Error handling general scheduling request:', error);
    }
}

// Helper function to detect email content type
function detectEmailContentType(body) {
    // Check if body contains HTML tags
    const htmlTagRegex = /<[^>]+>/;
    return htmlTagRegex.test(body) ? 'text/html' : 'text/plain';
}

// Helper function to convert plain text to HTML with proper Gmail formatting
function convertTextToHtml(text) {
    // Split by double line breaks to create paragraphs
    const paragraphs = text.split(/\r\n\r\n|\n\n/);
    
    return paragraphs.map(paragraph => {
        // Clean up single line breaks within paragraphs and convert to <br>
        const cleanParagraph = paragraph.replace(/\r\n|\n/g, '<br>');
        return `<p style="margin:0 0 16px; line-height:1.5;">${cleanParagraph}</p>`;
    }).join('');
}

// Generate availability email text
function generateAvailabilityEmail(availableSlots, contactName, timeRange = "Next Week", timezone = "EDT") {
    const slots = availableSlots.slice(0, 8); // Show first 8 slots
    
    let emailHtml = `<p style="margin:0 0 16px; line-height:1.5;">Hi ${contactName},</p>
<p style="margin:0 0 16px; line-height:1.5;">Thanks for the invitation! I've listed my availability below for ${timeRange.toLowerCase()}. Please let me know if any of these times are unsatisfactory and if so, I would be more than happy to provide further availability that better suits your schedule. Looking forward to chatting!</p>
<p style="margin:0 0 16px; line-height:1.5;"><strong>${timeRange} (All ${timezone})</strong></p>`;
    
    slots.forEach((slot, index) => {
        emailHtml += `<p style="margin:0 0 16px; line-height:1.5;">${slot.display}</p>`;
    });
    
    emailHtml += `<p style="margin:0 0 16px; line-height:1.5;">Best,<br><strong>Pranav</strong></p>`;
    
    return emailHtml;
}

// Helper function to get the latest inbound message ID from a thread
async function getLatestInboundMessageId(gmail, threadId, userEmail) {
    try {
        console.log(`   🔍 Fetching latest inbound message from thread ${threadId}`);
        
        const thread = await gmail.users.threads.get({
            userId: 'me',
            id: threadId
        });
        
        const messages = thread.data.messages || [];
        console.log(`   📬 Thread contains ${messages.length} messages`);
        
        // Find the most recent message that's NOT from us
        for (let i = messages.length - 1; i >= 0; i--) {
            const message = messages[i];
            const headers = message.payload.headers;
            
            // Get the From header
            const fromHeader = headers.find(h => h.name === 'From');
            if (!fromHeader) continue;
            
            // Check if this message is NOT from us
            if (!fromHeader.value.includes(userEmail)) {
                // Get the Message-ID header
                const messageIdHeader = headers.find(h => h.name === 'Message-ID');
                if (messageIdHeader) {
                    console.log(`   📧 Found latest inbound Message-ID: ${messageIdHeader.value}`);
                    return messageIdHeader.value;
                }
            }
        }
        
        console.log(`   ⚠️ No inbound messages found in thread, using original responseMessageId`);
        return null;
    } catch (error) {
        console.log(`   ❌ Error fetching latest inbound message: ${error.message}`);
        return null;
    }
}

// Send scheduling response email
async function sendSchedulingResponse(userId, toEmail, subject, body, originalThreadId, responseMessageId, yourOriginalMessageId) {
    try {
        console.log(`📧 Sending scheduling response to ${toEmail} in thread ${originalThreadId}`);
        
        // Get user details
        const user = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM users WHERE id = ?", [userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!user || !user.access_token) {
            console.log('❌ User not authenticated for sending scheduling response');
            return;
        }
        
        // Check user settings for draft mode
        const userSettings = await new Promise((resolve, reject) => {
            db.get("SELECT ai_draft_mode FROM user_settings WHERE user_id = ?", [userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        console.log('🔍 User settings for draft mode:', userSettings);
        const isDraftMode = userSettings && userSettings.ai_draft_mode === 1;
        console.log('🔍 Is draft mode enabled?', isDraftMode);
        
        if (isDraftMode) {
            console.log('📝 Draft mode enabled, creating draft instead of sending');
            await createGmailDraft(user, toEmail, subject, body, originalThreadId, responseMessageId, yourOriginalMessageId);
            return;
        }
        
        // Send the email using Gmail API
        const { google } = require('googleapis');
        
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
        
        // Get the latest inbound message ID for proper threading
        const latestInboundMessageId = await getLatestInboundMessageId(gmail, originalThreadId, user.email);
        const messageIdToReplyTo = latestInboundMessageId || responseMessageId;
        
        // Create email message with proper threading headers
        const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
        const messageParts = [
            `From: ${user.email}`,
            `To: ${toEmail}`,
            `Subject: ${utf8Subject}`,
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=utf-8'
        ];
        
        // Add threading headers - reply to the latest inbound message
        if (messageIdToReplyTo) {
            messageParts.push(`In-Reply-To: ${messageIdToReplyTo}`);
            messageParts.push(`References: ${messageIdToReplyTo}`);
            console.log(`   📎 Adding threading headers: In-Reply-To: ${messageIdToReplyTo}`);
        }
        
        messageParts.push('');
        messageParts.push(body);
        const message = messageParts.join('\r\n'); // Use \r\n for proper MIME format
        
        // Log the raw message before encoding to verify HTML formatting
        console.log(`📝 Raw message before encoding (text/html):`);
        console.log(message);
        
        const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        
        const result = await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage,
                threadId: originalThreadId
            }
        });
        
        console.log(`✅ Scheduling response email sent! Message ID: ${result.data.id}, Thread ID: ${result.data.threadId}`);
        
        // Get the actual Message-ID from the sent email's headers (same as cadence emails)
        let messageId = `<${result.data.id}@mail.gmail.com>`; // fallback
        
        try {
            const sentMessage = await gmail.users.messages.get({
                userId: 'me',
                id: result.data.id
            });
            
            const headers = sentMessage.data.payload.headers;
            const messageIdHeader = headers.find(h => h.name === 'Message-ID');
            if (messageIdHeader) {
                messageId = messageIdHeader.value;
                console.log(`   📧 Actual Message-ID: ${messageId}`);
            } else {
                console.log(`   📧 Using fallback Message-ID: ${messageId}`);
            }
        } catch (error) {
            console.log(`   📧 Error getting Message-ID, using fallback: ${messageId}`);
        }
        
    } catch (error) {
        console.error('❌ Error sending scheduling response:', error);
    }
}

// Create Gmail draft for scheduled emails
async function createGmailDraft(user, toEmail, subject, body, originalThreadId, responseMessageId, yourOriginalMessageId) {
    try {
        console.log(`📝 Creating Gmail draft for ${toEmail} in thread ${originalThreadId}`);
        
        const { google } = require('googleapis');
        
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
        
        // Get the latest inbound message ID for proper threading
        const latestInboundMessageId = await getLatestInboundMessageId(gmail, originalThreadId, user.email);
        const messageIdToReplyTo = latestInboundMessageId || responseMessageId;
        
        // Create email message with proper threading headers
        const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
        const messageParts = [
            `From: ${user.email}`,
            `To: ${toEmail}`,
            `Subject: ${utf8Subject}`,
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=utf-8'
        ];
        
        // Add threading headers - reply to the latest inbound message
        if (messageIdToReplyTo) {
            messageParts.push(`In-Reply-To: ${messageIdToReplyTo}`);
            messageParts.push(`References: ${messageIdToReplyTo}`);
            console.log(`   📎 Adding threading headers: In-Reply-To: ${messageIdToReplyTo}`);
        }
        
        messageParts.push('');
        messageParts.push(body);
        const message = messageParts.join('\r\n'); // Use \r\n for proper MIME format
        
        // Log the raw message before encoding to verify HTML formatting
        console.log(`📝 Raw draft message before encoding (text/html):`);
        console.log(message);
        
        const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        
        const result = await gmail.users.drafts.create({
            userId: 'me',
            requestBody: {
                message: {
                    raw: encodedMessage,
                    threadId: originalThreadId
                }
            }
        });
        
        console.log(`✅ Gmail draft created! Draft ID: ${result.data.id}, Thread ID: ${result.data.message.threadId}`);
        
    } catch (error) {
        console.error('❌ Error creating Gmail draft:', error);
    }
}

// Create Gmail draft for cadence first email step
async function createGmailDraftForCadence(userId, contactId, node, cadenceId) {
    try {
        console.log(`📝 Creating Gmail draft for cadence first email step`);
        
        // Get user details
        const user = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM users WHERE id = ?", [userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!user || !user.access_token) {
            console.log('❌ User not authenticated for creating Gmail draft');
            return;
        }
        
        // Get contact details
        const contact = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM contacts WHERE id = ? AND user_id = ?", [contactId, userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!contact) {
            console.log('❌ Contact not found for Gmail draft');
            return;
        }
        
        const { google } = require('googleapis');
        
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
        
        // Create email message
        const subject = node.config?.subject || 'No Subject';
        const template = node.config?.template || '';
        
        // Convert template to HTML if it's plain text
        const htmlBody = template.includes('<p') ? template : convertTextToHtml(template);
        
        const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
        const messageParts = [
            `From: ${user.email}`,
            `To: ${contact.email}`,
            `Subject: ${utf8Subject}`,
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=utf-8',
            '',
            htmlBody
        ];
        
        const message = messageParts.join('\r\n');
        
        // Log the raw message before encoding
        console.log(`📝 Raw cadence draft message before encoding (text/html):`);
        console.log(message);
        
        const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        
        const result = await gmail.users.drafts.create({
            userId: 'me',
            requestBody: {
                message: {
                    raw: encodedMessage
                }
            }
        });
        
        console.log(`✅ Gmail draft created for cadence! Draft ID: ${result.data.id}`);
        
    } catch (error) {
        console.error('❌ Error creating Gmail draft for cadence:', error);
    }
}

// Parse suggested time string into calendar format using GPT
async function parseSuggestedTime(timeStr) {
    console.log(`🕐 Parsing suggested time with GPT: "${timeStr}"`);

    // Let GPT handle all time parsing including tomorrow

    try {
        const gptResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4',
                messages: [
                    {
                        role: 'system',
                        content: `You are a time parsing assistant. Convert natural language time expressions into specific calendar times.

CURRENT CONTEXT: Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} (${new Date().toISOString().split('T')[0]})

Return ONLY a JSON object with this exact format:
{
  "start": "2024-01-15T14:00:00-04:00",
  "end": "2024-01-15T15:00:00-04:00", 
  "display": "Monday, January 15th at 2:00 PM EDT"
}

RULES:
- Use EDT timezone (-04:00) for all times
- Default meeting duration is 1 hour
- If no specific time mentioned, assume 2:00 PM
- If only date mentioned, assume 2:00 PM
- For "tomorrow", calculate the next day
- For "next Monday/Tuesday/etc", find the next occurrence of that day
- For "this Friday/Monday/etc", find the next occurrence this week
- For "morning", use 10:00 AM
- For "afternoon", use 2:00 PM
- For "evening", use 6:00 PM

EXAMPLES:
- "tomorrow at 2pm" → Calculate tomorrow's date at 2:00 PM EDT
- "next Monday at 10am" → Calculate next Monday at 10:00 AM EDT  
- "Friday afternoon" → Calculate this Friday at 2:00 PM EDT
- "Tuesday morning" → Calculate this Tuesday at 10:00 AM EDT
- "tomorrow morning" → Calculate tomorrow at 10:00 AM EDT
- "next week Tuesday" → Calculate next Tuesday at 2:00 PM EDT`
                    },
                    {
                        role: 'user',
                        content: `Parse this time: "${timeStr}"`
                    }
                ],
                temperature: 0.1
            })
        });
        
        if (!gptResponse.ok) {
            console.log('❌ Failed to call GPT for time parsing, using fallback');
            return parseSuggestedTimeFallback(timeStr);
        }
        
                const gptData = await gptResponse.json();
                const parsedTime = JSON.parse(gptData.choices[0].message.content);

                console.log(`📅 GPT parsed time: ${parsedTime.display}`);
                console.log(`📅 GPT start time: ${parsedTime.start}`);
                console.log(`📅 GPT end time: ${parsedTime.end}`);
                return parsedTime;
        
    } catch (error) {
        console.error('❌ Error parsing time with GPT:', error);
        return parseSuggestedTimeFallback(timeStr);
    }
}

// Fallback time parsing function
function parseSuggestedTimeFallback(timeStr) {
    console.log(`🕐 Using fallback time parsing: "${timeStr}"`);
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Handle different time formats
    let targetDate = new Date(today);
    let hour = 14; // Default to 2 PM
    let minute = 0;
    
    // Parse day of week
    const dayMap = {
        'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5
    };
    
    const lowerTimeStr = timeStr.toLowerCase();
    
    // Check for specific days
    for (const [day, dayNum] of Object.entries(dayMap)) {
        if (lowerTimeStr.includes(day)) {
            const daysUntilTarget = (dayNum - today.getDay() + 7) % 7;
            if (daysUntilTarget === 0) daysUntilTarget = 7; // Next week if today
            targetDate.setDate(today.getDate() + daysUntilTarget);
            break;
        }
    }
    
    // Check for "tomorrow"
    if (lowerTimeStr.includes('tomorrow')) {
        targetDate.setDate(today.getDate() + 1);
    }
    
    // Check for "next week"
    if (lowerTimeStr.includes('next week')) {
        targetDate.setDate(today.getDate() + 7);
    }
    
    // Parse time
    if (lowerTimeStr.includes('2pm') || lowerTimeStr.includes('2 pm')) {
        hour = 14;
    } else if (lowerTimeStr.includes('6pm') || lowerTimeStr.includes('6 pm') || lowerTimeStr.includes('6:00 pm')) {
        hour = 18;
    } else if (lowerTimeStr.includes('morning')) {
        hour = 10;
    } else if (lowerTimeStr.includes('afternoon')) {
        hour = 14;
    } else if (lowerTimeStr.includes('evening')) {
        hour = 18;
    }
    
    // Set the meeting time
    targetDate.setHours(hour, minute, 0, 0);
    
    // Create 30-minute meeting
    const endTime = new Date(targetDate.getTime() + 30 * 60 * 1000);
    
    const result = {
        start: targetDate.toISOString(),
        end: endTime.toISOString(),
        display: targetDate.toLocaleString('en-US', { 
            weekday: 'long', 
            month: 'short', 
            day: 'numeric', 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
        })
    };
    
    console.log(`📅 Fallback parsed time: ${result.display}`);
    return result;
}

// Generate test token for internal API calls
function generateTestToken(userId) {
    const jwt = require('jsonwebtoken');
    return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

// Background response polling
function startResponsePolling() {
    console.log('🔄 Starting background response polling (every 30 seconds)...');
    
    // Check immediately on startup
    setTimeout(() => {
        checkAllUsersForResponses();
    }, 5000); // Wait 5 seconds for server to fully start
    
    // Then check every 30 seconds
    setInterval(() => {
        checkAllUsersForResponses();
    }, 30000); // 30 seconds
}

// Check all users for responses
async function checkAllUsersForResponses() {
    try {
        console.log('🔍 Background check: Looking for email responses...');
        
        // Get all users with Google OAuth tokens
        const users = await new Promise((resolve, reject) => {
            db.all(`SELECT id, email FROM users WHERE access_token IS NOT NULL`, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        console.log(`👥 Found ${users.length} users to check for responses`);
        
        let totalResponsesFound = 0;
        for (const user of users) {
            try {
                const result = await checkForEmailResponses(user.id);
                totalResponsesFound += result.responsesFound;
                
                if (result.responsesFound > 0) {
                    console.log(`📬 User ${user.email}: Found ${result.responsesFound} new responses`);
                }
            } catch (error) {
                console.error(`❌ Error checking responses for user ${user.email}:`, error.message);
            }
        }
        
        if (totalResponsesFound > 0) {
            console.log(`🎉 Background check complete: Found ${totalResponsesFound} total new responses`);
        } else {
            console.log('✅ Background check complete: No new responses found');
        }
        
    } catch (error) {
        console.error('❌ Error in background response checking:', error);
    }
}

