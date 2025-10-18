# CadenceFlow - Sales Outreach Automation Platform

A powerful drag-and-drop workflow builder for creating and managing email cadences with AI-powered email generation and automated sending through users' own Gmail accounts.

## 🚀 Features

- **Drag-and-Drop Workflow Builder**: Visual interface for creating email cadences
- **Google OAuth Integration**: Secure authentication using users' Google accounts
- **Email Sending**: Send emails through users' own Gmail accounts (no shared credentials needed)
- **Contact Management**: Add, view, and manage your contact lists
- **AI-Powered Email Generation**: Generate professional emails using OpenAI
- **Real-time Processing**: Automated email queue processing with cron jobs
- **Modern UI**: Responsive design with intuitive workflow canvas

## 🛠️ Tech Stack

### Frontend
- HTML5, CSS3, JavaScript (ES6+)
- Drag-and-drop workflow canvas
- Responsive design with modern UI components

### Backend
- Node.js with Express.js
- SQLite database for data persistence
- Google OAuth 2.0 for authentication
- Nodemailer for email sending
- OpenAI API for AI-powered email generation
- Node-cron for scheduled email processing

## 📋 Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Google Cloud Console account (for OAuth setup)
- OpenAI API key (optional, for AI features)

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/pss9179/sourcing.git
cd sourcing
```

### 2. Install Dependencies

```bash
cd backend
npm install
```

### 3. Environment Setup

Create a `.env` file in the `backend` directory:

```env
# Google OAuth Configuration
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-here
SESSION_SECRET=your-session-secret-here

# OpenAI API (Optional)
OPENAI_API_KEY=your-openai-api-key-here

# Application Settings
NODE_ENV=development
PORT=3000
```

### 4. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Gmail API and Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URI: `http://localhost:3000/auth/google/callback`
6. Add scopes: `profile`, `email`, `https://www.googleapis.com/auth/gmail.send`
7. Add test users in OAuth consent screen

### 5. Start the Application

```bash
# Start backend server
cd backend
npm start

# In a new terminal, start frontend server
cd ../
python3 -m http.server 8081
```

### 6. Access the Application

- Frontend: http://localhost:8081
- Backend API: http://localhost:3000
- Health Check: http://localhost:3000/api/health

## 📧 How It Works

1. **User Authentication**: Users login with their Google account
2. **Workflow Creation**: Drag and drop components to build email cadences
3. **Contact Management**: Add contacts to your database
4. **Email Scheduling**: Set up automated email sequences with delays
5. **AI Generation**: Use OpenAI to generate professional email content
6. **Automated Sending**: Emails are sent through users' own Gmail accounts

## 🔧 API Endpoints

### Authentication
- `GET /auth/google` - Google OAuth login
- `GET /auth/google/callback` - OAuth callback

### User Management
- `GET /api/user` - Get user profile
- `GET /api/contacts` - Get user's contacts
- `POST /api/contacts` - Add new contact
- `DELETE /api/contacts/:id` - Delete contact

### Cadence Management
- `GET /api/cadences` - Get user's cadences
- `POST /api/cadences` - Save new cadence
- `POST /api/cadences/:id/start` - Start cadence execution

### AI Features
- `POST /api/generate-email` - Generate email with AI
- `POST /api/search-similar-contacts` - Search contacts with AI

## 🎨 Workflow Components

### Core Components
- **Start**: Beginning of workflow
- **End**: End of workflow
- **Wait**: Delay between actions

### Email Components
- **Email**: Initial outreach email
- **Follow-up Email**: Follow-up messages
- **New Email**: Additional email types

### Communication Components
- **Voice Call**: Phone call integration
- **Voicemail**: Voicemail drop
- **LinkedIn**: LinkedIn outreach

### Logic Components
- **If/Else**: Conditional branching
- **Task**: Manual tasks

## 🔒 Security Features

- JWT-based authentication
- OAuth 2.0 with Google
- Environment variable protection
- SQL injection prevention
- CORS configuration

## 📱 Responsive Design

The application is fully responsive and works on:
- Desktop computers
- Tablets
- Mobile devices

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

If you encounter any issues or have questions:

1. Check the [Issues](https://github.com/pss9179/sourcing/issues) page
2. Create a new issue with detailed description
3. Include error logs and steps to reproduce

## 🚀 Deployment

### Environment Variables for Production

```env
NODE_ENV=production
PORT=3000
GOOGLE_CLIENT_ID=your-production-client-id
GOOGLE_CLIENT_SECRET=your-production-client-secret
GOOGLE_REDIRECT_URI=https://yourdomain.com/auth/google/callback
JWT_SECRET=your-production-jwt-secret
SESSION_SECRET=your-production-session-secret
OPENAI_API_KEY=your-openai-api-key
```

### Database

The application uses SQLite by default. For production, consider:
- PostgreSQL
- MySQL
- MongoDB

## 📈 Roadmap

- [ ] Voice call integration with VAPI
- [ ] LinkedIn API integration
- [ ] Advanced analytics dashboard
- [ ] Team collaboration features
- [ ] Email template library
- [ ] A/B testing for emails
- [ ] CRM integrations

---

**Built with ❤️ for sales teams and entrepreneurs**
