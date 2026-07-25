import os
import base64
import pickle
import re
from typing import List, Optional, Dict
from datetime import datetime
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import logging

logger = logging.getLogger(__name__)

# Gmail API scopes
SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token'


def credentials_from_dict(data: dict) -> Credentials:
    """Rebuild a google Credentials object from a stored dict, INCLUDING expiry.

    Restoring ``expiry`` is essential: without it ``creds.expired`` is always False, the
    proactive-refresh path never runs, and any freshly minted access token is discarded —
    which is what forced users to re-authorize roughly daily.
    """
    creds = Credentials(
        token=data.get('token'),
        refresh_token=data.get('refresh_token'),
        token_uri=data.get('token_uri') or DEFAULT_TOKEN_URI,
        client_id=data.get('client_id'),
        client_secret=data.get('client_secret'),
        scopes=data.get('scopes') or SCOPES,
    )
    expiry = data.get('expiry')
    if isinstance(expiry, str):
        try:
            expiry = datetime.fromisoformat(expiry)
        except ValueError:
            expiry = None
    if expiry is not None:
        # google-auth compares expiry against a naive UTC now; strip any tzinfo.
        if getattr(expiry, 'tzinfo', None) is not None:
            expiry = expiry.replace(tzinfo=None)
        creds.expiry = expiry
    return creds


class GmailService:
    """Service to interact with Gmail API"""
    
    def __init__(self, credentials_path: str = None, token_path: str = None):
        self.credentials_path = credentials_path
        self.token_path = token_path
        self.service = None
    
    def authenticate_with_credentials(self, creds: Credentials) -> bool:
        """Authenticate with provided credentials object.
        Returns True on success. Sets self.credentials_refreshed if a refresh occurred."""
        self.credentials_refreshed = False
        try:
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
                self.credentials_refreshed = True

            self.service = build('gmail', 'v1', credentials=creds, cache_discovery=False)
            self._active_creds = creds
            return True
        except Exception as e:
            logger.error(f"Failed to authenticate with credentials: {e}")
            return False

    def get_refreshed_credentials_dict(self) -> Optional[dict]:
        """Return the CURRENT serialisable credentials dict (including expiry).

        Returns the dict unconditionally (not only when an explicit refresh happened) so
        callers always persist the latest access token + expiry — this captures tokens
        minted by the API client's implicit 401-refresh, which would otherwise be lost.
        """
        creds = getattr(self, '_active_creds', None)
        if not creds:
            return None
        expiry = getattr(creds, 'expiry', None)
        return {
            'token': creds.token,
            'refresh_token': creds.refresh_token,
            'token_uri': creds.token_uri or DEFAULT_TOKEN_URI,
            'client_id': creds.client_id,
            'client_secret': creds.client_secret,
            'scopes': list(creds.scopes) if creds.scopes else None,
            'expiry': expiry.isoformat() if expiry else None,
        }

    def test_connection(self, creds: Credentials) -> Optional[str]:
        """Validate Gmail credentials by fetching the account profile."""
        try:
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())

            service = build('gmail', 'v1', credentials=creds, cache_discovery=False)
            profile = service.users().getProfile(userId='me').execute()
            return profile.get('emailAddress')
        except Exception as e:
            logger.error(f"Failed to validate Gmail credentials: {e}")
            return None
    
    def authenticate(self) -> bool:
        """Authenticate with Gmail API"""
        creds = None
        
        # Load existing token
        if os.path.exists(self.token_path):
            with open(self.token_path, 'rb') as token:
                creds = pickle.load(token)
        
        # Refresh or create new credentials
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                if not os.path.exists(self.credentials_path):
                    logger.error(f"Credentials file not found: {self.credentials_path}")
                    return False
                
                flow = InstalledAppFlow.from_client_secrets_file(
                    self.credentials_path, SCOPES
                )
                creds = flow.run_local_server(port=0)
            
            # Save credentials
            os.makedirs(os.path.dirname(self.token_path), exist_ok=True)
            with open(self.token_path, 'wb') as token:
                pickle.dump(creds, token)
        
        # Build service
        self.service = build('gmail', 'v1', credentials=creds)
        return True
    
    def search_messages(
        self,
        query: str,
        max_results: int = 100,
        after_date: Optional[datetime] = None
    ) -> List[Dict]:
        """
        Search for messages matching query
        
        Args:
            query: Gmail search query
            max_results: Maximum number of results
            after_date: Only return messages after this date
        
        Returns:
            List of message dictionaries
        """
        if not self.service:
            if not self.authenticate():
                return []
        
        try:
            # Add date filter if provided
            if after_date:
                date_str = after_date.strftime('%Y/%m/%d')
                query = f"{query} after:{date_str}"

            logger.info(f"Searching Gmail with query: {query}")

            # Paginate: Gmail returns at most 100 message ids per page. Without following
            # nextPageToken only the first page is ever processed, silently dropping the
            # rest of the matching statements.
            message_ids = []
            page_token = None
            while len(message_ids) < max_results:
                results = self.service.users().messages().list(
                    userId='me',
                    q=query,
                    maxResults=min(100, max_results - len(message_ids)),
                    pageToken=page_token,
                ).execute()
                message_ids.extend(results.get('messages', []))
                page_token = results.get('nextPageToken')
                if not page_token:
                    break

            if not message_ids:
                logger.info("No messages found")
                return []

            logger.info(f"Found {len(message_ids)} messages")

            # Get full message details
            detailed_messages = []
            for message in message_ids[:max_results]:
                msg_detail = self.get_message(message['id'])
                if msg_detail:
                    detailed_messages.append(msg_detail)

            return detailed_messages

        except HttpError as error:
            # Do NOT swallow into an empty list — that makes a transient failure (e.g.
            # 429/5xx) look like "no new emails" and reports the sync as a success.
            # Propagate so the caller records the sync as failed.
            logger.error(f"Gmail API error for query '{query}': {error}")
            raise
    
    def get_message(self, message_id: str) -> Optional[Dict]:
        """Get full message details"""
        if not self.service:
            return None
        
        try:
            message = self.service.users().messages().get(
                userId='me',
                id=message_id,
                format='full'
            ).execute()
            
            return self._parse_message(message)
        
        except HttpError as error:
            logger.error(f"Error fetching message {message_id}: {error}")
            return None
    
    def _parse_message(self, message: Dict) -> Dict:
        """Parse Gmail message into simplified format"""
        headers = message['payload']['headers']
        
        # Extract headers
        subject = next((h['value'] for h in headers if h['name'].lower() == 'subject'), '')
        sender = next((h['value'] for h in headers if h['name'].lower() == 'from'), '')
        date_str = next((h['value'] for h in headers if h['name'].lower() == 'date'), '')
        
        # Parse date
        try:
            from email.utils import parsedate_to_datetime
            date = parsedate_to_datetime(date_str)
        except Exception:
            from app.core.time_utils import utcnow
            date = utcnow()
        
        # Check for attachments
        attachments = []
        if 'parts' in message['payload']:
            for part in message['payload']['parts']:
                if part.get('filename') and part['filename'].lower().endswith('.pdf'):
                    attachments.append({
                        'filename': part['filename'],
                        'mimeType': part.get('mimeType', ''),
                        'attachmentId': part['body'].get('attachmentId', '')
                    })
        
        return {
            'id': message['id'],
            'threadId': message['threadId'],
            'subject': subject,
            'sender': sender,
            'date': date,
            'snippet': message.get('snippet', ''),
            'attachments': attachments,
            'has_attachments': len(attachments) > 0
        }
    
    def get_attachment(self, message_id: str, attachment_id: str) -> Optional[bytes]:
        """Download attachment from message"""
        if not self.service:
            return None
        
        try:
            attachment = self.service.users().messages().attachments().get(
                userId='me',
                messageId=message_id,
                id=attachment_id
            ).execute()
            
            data = attachment['data']
            file_data = base64.urlsafe_b64decode(data)
            return file_data
        
        except HttpError as error:
            logger.error(f"Error downloading attachment: {error}")
            return None
    
    def search_bank_emails(
        self,
        email_patterns: List[str],
        after_date: Optional[datetime] = None,
        max_results: int = 100
    ) -> List[Dict]:
        """
        Search for bank statement emails
        
        Args:
            email_patterns: List of email patterns to search for (e.g., ['*@bank.com'])
            after_date: Only return messages after this date
            max_results: Maximum number of results
        
        Returns:
            List of matching messages
        """
        all_messages = []
        
        for pattern in email_patterns:
            # Convert pattern to Gmail search query
            query = f"from:{pattern} has:attachment filename:pdf"
            messages = self.search_messages(query, max_results, after_date)
            all_messages.extend(messages)
        
        return all_messages
    
    def extract_password_hints(self, message_body: str) -> Dict[str, str]:
        """
        Extract potential password hints from email body
        
        Returns:
            Dictionary with potential password components
        """
        hints = {}
        
        # Common password patterns in bank emails
        patterns = {
            'dob': r'(?:date\s+of\s+birth|DOB|birth\s+date)[:\s]+(\d{2}[-/]\d{2}[-/]\d{4}|\d{8})',
            'last_4_digits': r'(?:last\s+4\s+digits|card\s+ending)[:\s]+(\d{4})',
            'account_number': r'(?:account\s+number)[:\s]+(\d+)',
            'pan': r'(?:PAN|pan\s+number)[:\s]+([A-Z]{5}\d{4}[A-Z])',
        }
        
        for key, pattern in patterns.items():
            match = re.search(pattern, message_body, re.IGNORECASE)
            if match:
                hints[key] = match.group(1)
        
        return hints
