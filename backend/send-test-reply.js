const { google } = require('googleapis');
require('dotenv').config({ path: './.env' });

// Thread ID from the test workflow
const THREAD_ID = '19a07cc580a25bbb';
const FIRST_MESSAGE_ID = '<CAKzP543fMfHgBpUCFO15Jaw=TqBnzNhm09abYBXP8fUCH6=TCA@mail.gmail.com>';

async function sendReply() {
    console.log('📧 Sending test reply to workflow email...\n');

    try {
        // Load user from database to get tokens
        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('./cadenceflow.db');

        const user = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM users WHERE id = 1", (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!user || !user.access_token) {
            throw new Error('User not authenticated');
        }

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

        // Create the reply email
        const replyBody = "Hey I'd love to chat! Send me over a Gcal for a meeting at 3pm tomorrow";
        const subject = 'Re: Reply Cancellation Test - Email 1';

        const messageParts = [
            `From: ${user.email}`,
            `To: ${user.email}`,
            `Subject: ${subject}`,
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=utf-8',
            `In-Reply-To: ${FIRST_MESSAGE_ID}`,
            `References: ${FIRST_MESSAGE_ID}`,
            '',
            replyBody
        ];

        const message = messageParts.join('\r\n');
        const encodedMessage = Buffer.from(message)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        console.log(`📤 Sending reply in thread: ${THREAD_ID}`);
        console.log(`📝 Reply text: "${replyBody}"\n`);

        const result = await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage,
                threadId: THREAD_ID
            }
        });

        console.log(`✅ Reply sent successfully!`);
        console.log(`   Message ID: ${result.data.id}`);
        console.log(`   Thread ID: ${result.data.threadId}`);
        console.log(`\n⏰ Waiting for background polling to detect reply (checks every 30s)...`);
        console.log(`📊 Watch the server logs for:`);
        console.log(`   - Reply detection`);
        console.log(`   - Workflow cancellation`);
        console.log(`   - AI scheduling response`);
        console.log(`   - Calendar invite creation`);
        console.log(`\n💡 Check your Gmail inbox - the AI response should appear in the same thread!`);

        db.close();

    } catch (error) {
        console.error('❌ Error sending reply:', error.message);
        process.exit(1);
    }
}

sendReply();
