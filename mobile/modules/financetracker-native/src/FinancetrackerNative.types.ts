export interface SmsCredentials {
  serverUrl: string | null;
  apiKey: string | null;
}

export interface NativeSmsMessage {
  id: string;
  sender: string;
  body: string;
  date: number; // epoch millis
}
