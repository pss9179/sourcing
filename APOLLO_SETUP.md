# 🚀 Quick Setup - Auto Email Finding with Apollo.io

## Step 1: Get Your Apollo.io API Key (FREE)

1. Go to https://app.apollo.io/
2. Sign up for a FREE account
3. Go to Settings → Integrations → API
4. Copy your API key

**Free Tier Includes:**
- 50 email lookups per month
- No credit card required

## Step 2: Add API Key to Your .env File

Open `/Users/pranavsrigiriraju/Documents/sourcing/.env` and replace:

```
APOLLO_API_KEY=your_apollo_api_key_here
```

With your actual key:

```
APOLLO_API_KEY=abc123xyz...
```

## Step 3: That's It!

Backend server has been restarted automatically. Now when you:

1. Visit a LinkedIn profile
2. Click "Add to Cadence"
3. **Email is AUTO-FILLED** ✨

No more manual entry!

## How It Works

1. Extension extracts: Name, Company, Domain from LinkedIn
2. Sends to your backend
3. Backend calls Apollo.io API
4. Apollo returns the email
5. Email field auto-populates!

## If Apollo Fails

- Shows **email pattern guesses** (first.last@company.com)
- You can edit/verify before submitting
- Still way faster than manual lookup!

## Testing Without Apollo

Even without an API key, the system will:
- Generate smart email pattern guesses
- Show multiple suggestions
- Let you pick the most likely one

## Upgrade Later

When you need more than 50 emails/month:
- Basic: $49/mo for 1,000 credits
- Professional: $99/mo for 3,000 credits
- Organization: $149/mo for 6,000 credits

Each email lookup = 1 credit

---

## 🎯 Full Workflow Now

1. **Visit LinkedIn** → `linkedin.com/in/any-ceo`
2. **Click "Add to Cadence"** (purple button)
3. **Email AUTO-FILLS** (via Apollo)
4. **Select Cadence** from dropdown
5. **Click "Add to Cadence"**
6. **DONE!** 🎉

They're now in your automated sequence with personalized emails using {{firstName}}, {{company}}, etc.

---

## Troubleshooting

**Email not auto-filling?**
- Check your Apollo API key in `.env`
- Restart backend server
- Check browser console for errors

**"Apollo API not configured" message?**
- Get your free API key from https://app.apollo.io/
- Add it to `.env` file
- Restart backend

**Wrong email found?**
- You can always edit it before clicking "Add to Cadence"
- Apollo is ~70-80% accurate

**Rate limits hit?**
- Free tier: 50/month
- Upgrade at https://app.apollo.io/settings/plans


