import { NativeModule, requireNativeModule } from 'expo';
import { NativeSmsMessage, SmsCredentials } from './FinancetrackerNative.types';

// Android-only (see expo-module.config.json) -- SMS access has no iOS
// equivalent. Callers on iOS should check Platform.OS before importing/using
// this at all (see mobile/src/utils/smsNative.ts, which wraps that check).
declare class FinancetrackerNativeModule extends NativeModule<{}> {
  setSmsCredentials(serverUrl: string, apiKey: string): void;
  getSmsCredentials(): SmsCredentials;
  clearSmsCredentials(): void;
  querySmsInbox(sinceMillis: number, searchText: string, limit: number): NativeSmsMessage[];
}

export default requireNativeModule<FinancetrackerNativeModule>('FinancetrackerNative');
