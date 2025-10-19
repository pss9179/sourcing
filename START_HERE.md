# 🎯 START HERE - Complete Setup in 5 Minutes

## ✅ What You'll Get

Click ONE button on LinkedIn → Email automatically found → Added to your cadence with personalized template emails → Sends automatically

---

## 📋 Quick Setup Checklist

### ☐ Step 1: Get Apollo.io API Key (2 minutes)

1. Go to: https://app.apollo.io/
2. Sign up (FREE - no credit card)
3. Go to: Settings → Integrations → API
4. Copy your API key

### ☐ Step 2: Add API Key (30 seconds)

Open this file: `/Users/pranavsrigiriraju/Documents/sourcing/.env`

Find this line:
```
APOLLO_API_KEY=your_apollo_api_key_here
```

Replace with your key:
```
APOLLO_API_KEY=abc123xyz456...
```

Save the file!

### ☐ Step 3: Install Chrome Extension (2 minutes)

1. **Generate icons first:**
   - The file `/Users/pranavsrigiriraju/Documents/sourcing/chrome-extension/generate-icons.html` should be open in your browser
   - Right-click each canvas (3 of them)
   - "Save image as..." to: `/Users/pranavsrigiriraju/Documents/sourcing/chrome-extension/icons/`
   - Name them: `icon16.png`, `icon48.png`, `icon128.png`

2. **Install extension:**
   - Open Chrome
   - Go to: `chrome://extensions/`
   - Turn ON "Developer mode" (top-right toggle)
   - Click "Load unpacked"
   - Select folder: `/Users/pranavsrigiriraju/Documents/sourcing/chrome-extension`
   - Done! Extension appears in toolbar

### ☐ Step 4: Create Your First Template Cadence (3 minutes)

1. Go to: http://localhost:8081
2. Log in with Google
3. Drag "Email" nodes onto canvas
4. Click an email node and configure:

```
Subject: Quick question, {{firstName}}

Hi {{firstName}},

I noticed you're the {{title}} at {{company}} and wanted to reach out about [your value prop].

Would you be open to a quick 15-minute chat this week?

Best,
[Your Name]
```

5. Set timing (e.g., "Send immediately")
6. Add more email nodes for follow-ups if desired
7. Click "💾 Save Cadence"
8. Name it (e.g., "CEO Outreach")

---

## 🚀 YOU'RE READY! Here's How to Use It:

### The One-Click Process:

1. **Go to LinkedIn** → Find any profile (e.g., a CEO)
2. **Click the purple "Add to Cadence" button** (bottom-right of page)
3. **Watch the magic:**
   - Name auto-extracted ✅
   - Company auto-extracted ✅
   - Title auto-extracted ✅
   - **EMAIL AUTO-FOUND via Apollo** ✅
4. **Select your cadence** from dropdown
5. **Click "Add to Cadence"**
6. **DONE!** They're now in your automated sequence

### What Happens Next:

- Person added to your contacts
- All {{firstName}}, {{company}}, {{title}} variables replaced
- Emails scheduled based on your timing
- Emails send automatically
- Properly threaded in Gmail
- You just sit back and get replies! 🎉

---

## 💡 Pro Tips

### Make Multiple Template Cadences:
- "CEO Cold Outreach"
- "Investor Intro"
- "Partnership Proposal"
- "Recruiting Pitch"

Then pick the right one for each person!

### Template Variable Examples:

```
Hi {{firstName}},

I saw that {{company}} recently [event/news]. As the {{title}}, you might be interested in...
```

Variables available:
- `{{firstName}}` → John
- `{{lastName}}` → Doe  
- `{{fullName}}` → John Doe
- `{{company}}` → Acme Corp
- `{{title}}` → CEO
- `{{email}}` → john@acme.com

---

## ⚡ Speed Demo

**Without this tool:**
1. Find CEO on LinkedIn (2 min)
2. Google their email (5 min)
3. Open Gmail (1 min)
4. Write personalized email (5 min)
5. Send manually
6. Repeat for follow-ups
**Total: 13+ minutes per person**

**With this tool:**
1. Click button on LinkedIn
2. Select cadence
3. Done
**Total: 10 seconds per person**

---

## 🆘 Troubleshooting

**Extension not showing?**
- Make sure you're on a LinkedIn profile page (`/in/username`)
- Refresh the page
- Check `chrome://extensions/` - is it enabled?

**Email not auto-filling?**
- Check Apollo API key in `.env` file
- Make sure backend is running
- Even without Apollo, you'll get smart guesses!

**"Please login first"?**
- Go to http://localhost:8081
- Login with Google first
- Then try extension again

**Backend not running?**
```bash
cd /Users/pranavsrigiriraju/Documents/sourcing/backend
npm start
```

**Frontend not running?**
```bash
cd /Users/pranavsrigiriraju/Documents/sourcing
python3 -m http.server 8081
```

---

## 📈 Your Stats

With Apollo FREE tier:
- 50 emails/month = ~2 per day
- Perfect for testing!

Want more? Upgrade to:
- $49/mo = 1,000 emails (33/day)
- $99/mo = 3,000 emails (100/day)

---

## 🎓 Learn More

- Full docs: `EXTENSION_SETUP.md`
- Apollo setup: `APOLLO_SETUP.md`
- Template variables: See email config in app

---

## ✨ You're All Set!

Now go find some prospects on LinkedIn and watch the magic happen! 🚀

Questions? Issues? Everything is documented in the other .md files.

**Happy outreaching!** 📧


