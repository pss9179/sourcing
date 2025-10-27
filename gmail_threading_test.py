#!/usr/bin/env python3
"""
Gmail Threading Test Script

This script systematically tests different Gmail API approaches to ensure
emails thread correctly. It will iterate through various combinations until
it finds one that works.

Based on the working cadence logic from backend/server.js:
- Uses proper MIME format with CRLF (\r\n)
- Includes From, To, Subject, MIME-Version, Content-Type headers
- Uses In-Reply-To and References for threading
- Uses threadId in the request body
"""

import os
import time
import base64
import json
from datetime import datetime
from typing import Optional, Dict, List, Tuple

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# Gmail API scopes
SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 
          'https://www.googleapis.com/auth/gmail.send']

class GmailThreadingTester:
    def __init__(self):
        self.service = None
        self.credentials = None
        
    def authenticate(self):
        """Authenticate with Gmail API using OAuth2"""
        print("🔐 Authenticating with Gmail API...")
        
        # Try to load existing credentials
        if os.path.exists('token.json'):
            self.credentials = Credentials.from_authorized_user_file('token.json', SCOPES)
        
        # If no valid credentials, get new ones
        if not self.credentials or not self.credentials.valid:
            if self.credentials and self.credentials.expired and self.credentials.refresh_token:
                print("🔄 Refreshing expired credentials...")
                self.credentials.refresh(Request())
            else:
                print("🌐 Starting OAuth flow...")
                flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
                self.credentials = flow.run_local_server(port=0)
            
            # Save credentials for next time
            with open('token.json', 'w') as token:
                token.write(self.credentials.to_json())
        
        self.service = build('gmail', 'v1', credentials=self.credentials)
        print("✅ Authentication successful!")
    
    def find_recent_incoming_email(self) -> Optional[Dict]:
        """Find the most recent email from someone else in inbox"""
        print("📧 Searching for recent incoming email...")
        
        try:
            # Search for emails in inbox that are not from self
            results = self.service.users().messages().list(
                userId='me',
                q='in:inbox -from:me',
                maxResults=10
            ).execute()
            
            messages = results.get('messages', [])
            if not messages:
                print("❌ No incoming emails found in inbox")
                return None
            
            # Get the most recent message
            message_id = messages[0]['id']
            message = self.service.users().messages().get(
                userId='me',
                id=message_id,
                format='full'
            ).execute()
            
            # Extract headers
            headers = message['payload'].get('headers', [])
            from_header = next((h['value'] for h in headers if h['name'] == 'From'), 'Unknown')
            subject_header = next((h['value'] for h in headers if h['name'] == 'Subject'), 'No Subject')
            message_id_header = next((h['value'] for h in headers if h['name'] == 'Message-ID'), None)
            thread_id = message['threadId']
            
            print(f"📬 Found email: {subject_header}")
            print(f"   From: {from_header}")
            print(f"   Thread ID: {thread_id}")
            print(f"   Message ID: {message_id_header}")
            
            return {
                'id': message_id,
                'thread_id': thread_id,
                'message_id': message_id_header,
                'from': from_header,
                'subject': subject_header,
                'raw_message': message
            }
            
        except HttpError as error:
            print(f"❌ Error finding email: {error}")
            return None
    
    def get_thread_messages(self, thread_id: str) -> List[Dict]:
        """Get all messages in a thread"""
        try:
            thread = self.service.users().threads().get(
                userId='me',
                id=thread_id,
                format='full'
            ).execute()
            
            messages = []
            for message in thread['messages']:
                headers = message['payload'].get('headers', [])
                from_header = next((h['value'] for h in headers if h['name'] == 'From'), 'Unknown')
                subject_header = next((h['value'] for h in headers if h['name'] == 'Subject'), 'No Subject')
                message_id_header = next((h['value'] for h in headers if h['name'] == 'Message-ID'), None)
                
                messages.append({
                    'id': message['id'],
                    'message_id': message_id_header,
                    'from': from_header,
                    'subject': subject_header
                })
            
            return messages
        except HttpError as error:
            print(f"❌ Error getting thread: {error}")
            return []
    
    def create_email_message(self, to: str, subject: str, body: str, 
                           in_reply_to: Optional[str] = None, 
                           references: Optional[str] = None,
                           use_html: bool = True) -> str:
        """Create a properly formatted email message"""
        
        # Add Re: prefix if not already present and we're replying
        if in_reply_to and not subject.startswith('Re:'):
            subject = f"Re: {subject}"
        
        # Encode subject for UTF-8
        utf8_subject = f"=?utf-8?B?{base64.b64encode(subject.encode('utf-8')).decode('ascii')}?="
        
        # Build message parts
        message_parts = [
            f"To: {to}",
            f"Subject: {utf8_subject}",
            "MIME-Version: 1.0",
            f"Content-Type: {'text/html' if use_html else 'text/plain'}; charset=utf-8"
        ]
        
        # Add threading headers if provided
        if in_reply_to:
            message_parts.append(f"In-Reply-To: {in_reply_to}")
        if references:
            message_parts.append(f"References: {references}")
        
        # Add body
        message_parts.extend(['', body])
        
        # Join with CRLF (critical for MIME format)
        return '\r\n'.join(message_parts)
    
    def send_email_method_1(self, to: str, subject: str, body: str, 
                           thread_id: str, in_reply_to: str) -> bool:
        """Method 1: Use threadId + In-Reply-To + References headers"""
        print("🧪 Testing Method 1: threadId + In-Reply-To + References")
        
        try:
            message = self.create_email_message(
                to=to,
                subject=subject,
                body=body,
                in_reply_to=in_reply_to,
                references=in_reply_to  # Use same as In-Reply-To for simplicity
            )
            
            # Encode message
            encoded_message = base64.urlsafe_b64encode(message.encode('utf-8')).decode('ascii')
            
            # Send with threadId
            result = self.service.users().messages().send(
                userId='me',
                body={
                    'raw': encoded_message,
                    'threadId': thread_id
                }
            ).execute()
            
            print(f"   ✅ Email sent! Message ID: {result['id']}")
            return True
            
        except HttpError as error:
            print(f"   ❌ Error: {error}")
            return False
    
    def send_email_method_2(self, to: str, subject: str, body: str, 
                           thread_id: str, in_reply_to: str) -> bool:
        """Method 2: Use threadId only (no threading headers)"""
        print("🧪 Testing Method 2: threadId only (no threading headers)")
        
        try:
            message = self.create_email_message(
                to=to,
                subject=subject,
                body=body
                # No threading headers
            )
            
            encoded_message = base64.urlsafe_b64encode(message.encode('utf-8')).decode('ascii')
            
            result = self.service.users().messages().send(
                userId='me',
                body={
                    'raw': encoded_message,
                    'threadId': thread_id
                }
            ).execute()
            
            print(f"   ✅ Email sent! Message ID: {result['id']}")
            return True
            
        except HttpError as error:
            print(f"   ❌ Error: {error}")
            return False
    
    def send_email_method_3(self, to: str, subject: str, body: str, 
                           thread_id: str, in_reply_to: str) -> bool:
        """Method 3: Use In-Reply-To + References only (no threadId)"""
        print("🧪 Testing Method 3: In-Reply-To + References only (no threadId)")
        
        try:
            message = self.create_email_message(
                to=to,
                subject=subject,
                body=body,
                in_reply_to=in_reply_to,
                references=in_reply_to
            )
            
            encoded_message = base64.urlsafe_b64encode(message.encode('utf-8')).decode('ascii')
            
            result = self.service.users().messages().send(
                userId='me',
                body={
                    'raw': encoded_message
                    # No threadId
                }
            ).execute()
            
            print(f"   ✅ Email sent! Message ID: {result['id']}")
            return True
            
        except HttpError as error:
            print(f"   ❌ Error: {error}")
            return False
    
    def send_email_method_4(self, to: str, subject: str, body: str, 
                           thread_id: str, in_reply_to: str) -> bool:
        """Method 4: Create draft first, then send"""
        print("🧪 Testing Method 4: Create draft first, then send")
        
        try:
            message = self.create_email_message(
                to=to,
                subject=subject,
                body=body,
                in_reply_to=in_reply_to,
                references=in_reply_to
            )
            
            encoded_message = base64.urlsafe_b64encode(message.encode('utf-8')).decode('ascii')
            
            # Create draft
            draft = self.service.users().drafts().create(
                userId='me',
                body={
                    'message': {
                        'raw': encoded_message,
                        'threadId': thread_id
                    }
                }
            ).execute()
            
            print(f"   📝 Draft created: {draft['id']}")
            
            # Send draft
            result = self.service.users().drafts().send(
                userId='me',
                body={
                    'id': draft['id']
                }
            ).execute()
            
            print(f"   ✅ Email sent! Message ID: {result['message']['id']}")
            return True
            
        except HttpError as error:
            print(f"   ❌ Error: {error}")
            return False
    
    def send_email_method_5(self, to: str, subject: str, body: str, 
                           thread_id: str, in_reply_to: str) -> bool:
        """Method 5: Use plain text instead of HTML"""
        print("🧪 Testing Method 5: Plain text instead of HTML")
        
        try:
            message = self.create_email_message(
                to=to,
                subject=subject,
                body=body,
                in_reply_to=in_reply_to,
                references=in_reply_to,
                use_html=False
            )
            
            encoded_message = base64.urlsafe_b64encode(message.encode('utf-8')).decode('ascii')
            
            result = self.service.users().messages().send(
                userId='me',
                body={
                    'raw': encoded_message,
                    'threadId': thread_id
                }
            ).execute()
            
            print(f"   ✅ Email sent! Message ID: {result['id']}")
            return True
            
        except HttpError as error:
            print(f"   ❌ Error: {error}")
            return False
    
    def send_email_method_6(self, to: str, subject: str, body: str, 
                           thread_id: str, in_reply_to: str) -> bool:
        """Method 6: Use References chain (original + reply)"""
        print("🧪 Testing Method 6: References chain (original + reply)")
        
        try:
            # For this test, we'll use the thread's first message as the original
            thread_messages = self.get_thread_messages(thread_id)
            if len(thread_messages) < 2:
                print("   ❌ Need at least 2 messages in thread for References chain")
                return False
            
            # Get the first message's Message-ID as the original
            original_message_id = thread_messages[0]['message_id']
            if not original_message_id:
                print("   ❌ Could not find original message ID")
                return False
            
            # Create References chain: original + reply
            references_chain = f"{original_message_id} {in_reply_to}"
            
            message = self.create_email_message(
                to=to,
                subject=subject,
                body=body,
                in_reply_to=in_reply_to,
                references=references_chain
            )
            
            encoded_message = base64.urlsafe_b64encode(message.encode('utf-8')).decode('ascii')
            
            result = self.service.users().messages().send(
                userId='me',
                body={
                    'raw': encoded_message,
                    'threadId': thread_id
                }
            ).execute()
            
            print(f"   ✅ Email sent! Message ID: {result['id']}")
            return True
            
        except HttpError as error:
            print(f"   ❌ Error: {error}")
            return False
    
    def test_threading(self, original_email: Dict) -> bool:
        """Test if the new message appears in the same thread"""
        print("🔍 Testing if message threaded correctly...")
        
        # Wait a moment for Gmail to process
        time.sleep(3)
        
        # Get updated thread
        updated_messages = self.get_thread_messages(original_email['thread_id'])
        
        print(f"   📊 Thread now has {len(updated_messages)} messages")
        
        # Check if we have more messages than before
        if len(updated_messages) > 1:  # We started with 1, so >1 means our message was added
            print("   ✅ Threaded correctly!")
            return True
        else:
            print("   ❌ New thread created (not threaded)")
            return False
    
    def run_test_suite(self):
        """Run the complete test suite"""
        print("🚀 Starting Gmail Threading Test Suite")
        print("=" * 50)
        
        # Authenticate
        self.authenticate()
        
        # Find a recent email to reply to
        original_email = self.find_recent_incoming_email()
        if not original_email:
            print("❌ Cannot proceed without an incoming email to reply to")
            return
        
        print(f"\n📧 Will reply to: {original_email['subject']}")
        print(f"   From: {original_email['from']}")
        print(f"   Thread ID: {original_email['thread_id']}")
        
        # Test message content
        test_subject = "Test Reply - Gmail Threading Test"
        test_body = f"""
        <p>This is a test reply to verify Gmail threading.</p>
        <p>Sent at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
        <p>If you see this message in the same thread as the original email, threading is working correctly!</p>
        """
        
        # Extract email address from From header
        from_email = original_email['from']
        if '<' in from_email and '>' in from_email:
            from_email = from_email.split('<')[1].split('>')[0]
        
        # Test methods
        methods = [
            ("Method 1: threadId + In-Reply-To + References", self.send_email_method_1),
            ("Method 2: threadId only", self.send_email_method_2),
            ("Method 3: In-Reply-To + References only", self.send_email_method_3),
            ("Method 4: Create draft first", self.send_email_method_4),
            ("Method 5: Plain text", self.send_email_method_5),
            ("Method 6: References chain", self.send_email_method_6),
        ]
        
        successful_methods = []
        
        for method_name, method_func in methods:
            print(f"\n{'='*60}")
            print(f"🧪 {method_name}")
            print('='*60)
            
            try:
                # Send the test email
                success = method_func(
                    to=from_email,
                    subject=test_subject,
                    body=test_body,
                    thread_id=original_email['thread_id'],
                    in_reply_to=original_email['message_id']
                )
                
                if success:
                    # Test if it threaded correctly
                    if self.test_threading(original_email):
                        print(f"🎉 SUCCESS! {method_name} worked!")
                        successful_methods.append(method_name)
                    else:
                        print(f"⚠️  {method_name} sent but didn't thread correctly")
                else:
                    print(f"❌ {method_name} failed to send")
                    
            except Exception as e:
                print(f"❌ {method_name} failed with exception: {e}")
            
            # Wait between tests
            time.sleep(2)
        
        # Summary
        print(f"\n{'='*60}")
        print("📊 TEST SUMMARY")
        print('='*60)
        
        if successful_methods:
            print(f"✅ {len(successful_methods)} method(s) worked:")
            for method in successful_methods:
                print(f"   • {method}")
        else:
            print("❌ No methods worked - Gmail threading may have issues")
        
        print(f"\n💡 Recommendation: Use the first successful method for your application")

def main():
    """Main function"""
    print("Gmail Threading Test Script")
    print("This script will test different Gmail API approaches to ensure emails thread correctly.")
    print()
    
    # Check for credentials file
    if not os.path.exists('credentials.json'):
        print("❌ credentials.json not found!")
        print("Please download your OAuth2 credentials from Google Cloud Console and save as 'credentials.json'")
        return
    
    # Run the test suite
    tester = GmailThreadingTester()
    tester.run_test_suite()

if __name__ == "__main__":
    main()




