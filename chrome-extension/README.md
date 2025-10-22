# CadenceFlow Chrome Extension

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked"
4. Select the `chrome-extension` folder
5. The extension will now appear in your toolbar!

## Usage

1. Make sure you're logged into CadenceFlow (http://localhost:3000)
2. Navigate to any LinkedIn profile page
3. Click the "Add to Cadence" button that appears in the bottom right
4. Fill in the email address (if not auto-detected)
5. Select which cadence to add them to
6. Click "Add to Cadence"

The person will be automatically added with their LinkedIn data!

## Template Variables

Use these variables in your email templates and they'll be automatically replaced:

- `{{firstName}}` - Person's first name
- `{{lastName}}` - Person's last name
- `{{fullName}}` - Person's full name
- `{{company}}` - Company name
- `{{title}}` - Job title
- `{{email}}` - Email address

Example email:
```
Hi {{firstName}},

I noticed you're the {{title}} at {{company}}...
```

## Icons

Place your icon files in the `icons` folder:
- icon16.png (16x16)
- icon48.png (48x48)
- icon128.png (128x128)


