import { NativeModule, requireNativeModule } from 'expo';
import { NativeSmsMessage, SmsCredentials } from './FinancetrackerNative.types';

// setSmsCredentials/getSmsCredentials/clearSmsCredentials/querySmsInbox are
// Android-only (SMS access has no iOS equivalent) -- callers on Android
// should check Platform.OS before using them (see mobile/src/utils/smsNative.ts).
declare class FinancetrackerNativeModule extends NativeModule<{}> {
  setSmsCredentials(serverUrl: string, apiKey: string): void;
  getSmsCredentials(): SmsCredentials;
  clearSmsCredentials(): void;
  querySmsInbox(sinceMillis: number, searchText: string, limit: number): NativeSmsMessage[];
}

export default requireNativeModule<FinancetrackerNativeModule>('FinancetrackerNative');
