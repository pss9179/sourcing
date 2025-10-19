# CadenceFlow LinkedIn Chrome Extension - Complete Setup Guide

## 🎯 What This Does

The Chrome extension lets you:
1. Visit any LinkedIn profile (e.g., a CEO's profile)
2. Click one button to add them to a cadence
3. Automatically extract their name, company, title from LinkedIn
4. Auto-populate email templates with their info using variables like `{{firstName}}`, `{{company}}`, etc.
5. Have them ready to receive automated, personalized email sequences

## 📋 Prerequisites

- Chrome browser
- CadenceFlow backend running on `localhost:3000`
- CadenceFlow frontend running on `localhost:8081`
- Logged into CadenceFlow with Google OAuth

## 🚀 Installation Steps

### Step 1: Generate Extension Icons

1. Open `chrome-extension/generate-icons.html` in your browser
2. Right-click on each canvas (icon16, icon48, icon128)
3. Click "Save image as..." and save to `chrome-extension/icons/` folder with the correct names

### Step 2: Install Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" toggle in the top right
3. Click "Load unpacked"
4. Select the `chrome-extension` folder
5. The extension icon should appear in your toolbar

### Step 3: Set Up Authentication

1. Make sure you're logged into CadenceFlow (http://localhost:8081)
2. The extension needs to access the same `authToken` from localStorage
3. Currently, the extension expects the auth token to be stored in Chrome storage

To sync the auth token:
- After logging into CadenceFlow, the token is stored in `localStorage`
- The extension will need to retrieve this or you'll need to implement a sync mechanism

### Step 4: Create a Cadence with Templates

1. Go to CadenceFlow (http://localhost:8081)
2. Create a new workflow with email nodes
3. In each email configuration, use template variables:

```
Subject: Quick question, {{firstName}}

Hi {{firstName}},

I noticed you're the {{title}} at {{company}} and wanted to reach out...

Best regards,
Your Name
```

Available template variables:
- `{{firstName}}` - First name
- `{{lastName}}` - Last name
- `{{fullName}}` - Full name
- `{{company}}` - Company name
- `{{title}}` - Job title
- `{{email}}` - Email address

4. Save the cadence with a memorable name

## 📖 How to Use

### Adding Someone from LinkedIn:

1. Navigate to any LinkedIn profile page (e.g., `linkedin.com/in/some-ceo`)
2. Click the floating "Add to Cadence" button (bottom right, purple gradient)
3. The extension popup will open with:
   - Auto-extracted profile information (name, company, title)
   - Email input field (you'll need to provide the email)
   - Cadence selector dropdown
4. Enter their email address if not auto-detected
5. Select which cadence to add them to
6. Click "Add to Cadence"

### What Happens Next:

1. The person is added as a contact in your CadenceFlow database
2. The email sequence from the selected cadence is scheduled
3. All template variables (`{{firstName}}`, `{{company}}`, etc.) are automatically replaced with their actual information
4. Emails will send according to your configured schedule (immediate, minutes, days, or specific date/time)
5. All emails will be properly threaded in Gmail

## 🔧 Backend API Endpoints

The extension uses these new endpoints:

### `POST /api/contacts`
Creates a new contact with LinkedIn data:
```json
{
  "email": "john@company.com",
  "name": "John Doe",
  "company": "Acme Corp",
  "title": "CEO",
  "firstName": "John",
  "lastName": "Doe",
  "linkedinUrl": "https://linkedin.com/in/johndoe"
}
```

### `POST /api/cadences/:id/add-contact`
Adds a contact to a cadence and schedules emails:
```json
{
  "contactId": 123
}
```

## 🎨 Template Variables

Template variables are replaced when emails are sent:

| Variable | Description | Example |
|----------|-------------|---------|
| `{{firstName}}` | First name | John |
| `{{lastName}}` | Last name | Doe |
| `{{fullName}}` | Full name | John Doe |
| `{{company}}` | Company name | Acme Corp |
| `{{title}}` | Job title | CEO |
| `{{email}}` | Email address | john@company.com |

## 🐛 Troubleshooting

### Extension doesn't appear:
- Make sure Developer mode is enabled
- Check that all files are in the `chrome-extension` folder
- Reload the extension from `chrome://extensions/`

### "Add to Cadence" button doesn't show:
- Refresh the LinkedIn page
- Make sure you're on a profile page (`/in/username`)
- Check browser console for errors

### Profile data not extracting:
- LinkedIn's HTML structure changes frequently
- Check console logs for extraction errors
- You may need to update the selectors in `content.js`

### Authentication issues:
- Make sure you're logged into CadenceFlow first
- The extension needs access to the same auth token
- Check that the token is properly stored

### CORS errors:
- Backend CORS is configured to allow `chrome-extension://` origins
- Make sure backend server is running
- Check browser console for specific CORS errors

## 📝 Example Workflow

1. **Create a cadence** in CadenceFlow:
   - Email 1: "Hi {{firstName}}, noticed you're at {{company}}..."
   - Delay: 2 days
   - Email 2: "Following up on my previous email..."

2. **Visit a LinkedIn profile** of a CEO

3. **Click "Add to Cadence"** button

4. **Fill in email** (if not auto-detected)

5. **Select your cadence** from the dropdown

6. **Click "Add to Cadence"**

7. **Done!** The CEO will automatically receive:
   - Personalized email 1 immediately
   - Personalized email 2 after 2 days
   - All in the same Gmail thread

## 🔒 Privacy & Security

- The extension only accesses LinkedIn profile pages you visit
- No data is sent anywhere except your own backend
- Email addresses must be manually entered (cannot be scraped automatically from LinkedIn)
- All authentication uses your existing CadenceFlow login

## 🚧 Limitations

- Email addresses cannot be automatically extracted from LinkedIn (privacy/ToS)
- LinkedIn's HTML structure may change, requiring updates to selectors
- Extension only works on public LinkedIn profiles you can access
- Requires CadenceFlow backend to be running locally

## 💡 Tips

- Create multiple template cadences for different scenarios (sales, recruiting, networking)
- Test your templates with yourself first before using on real prospects
- Keep email bodies concise and personalized beyond just the variables
- Monitor your Gmail sending limits to avoid being flagged as spam


