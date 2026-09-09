import { NativeModule, requireNativeModule } from 'expo';
import { NativeSmsMessage, SmsCredentials } from './FinancetrackerNative.types';

// setSmsCredentials/getSmsCredentials/clearSmsCredentials/querySmsInbox are
// Android-only (SMS access has no iOS equivalent) -- callers on Android
// should check Platform.OS before using them (see mobile/src/utils/smsNative.ts).
// startTodaySpendActivity/updateTodaySpendActivity/endTodaySpendActivity/
// isLiveActivitySupported are iOS-only (Live Activity/Dynamic Island has no
// Android equivalent) -- callers should check Platform.OS before using those
// (see mobile/src/utils/liveActivity.ts).
declare class FinancetrackerNativeModule extends NativeModule<{}> {
  setSmsCredentials(serverUrl: string, apiKey: string): void;
  getSmsCredentials(): SmsCredentials;
  clearSmsCredentials(): void;
  querySmsInbox(sinceMillis: number, searchText: string, limit: number): NativeSmsMessage[];

  isLiveActivitySupported(): boolean;
  startTodaySpendActivity(spentToday: number, currencySymbol: string): boolean;
  updateTodaySpendActivity(spentToday: number, currencySymbol: string): void;
  endTodaySpendActivity(): void;
}

export default requireNativeModule<FinancetrackerNativeModule>('FinancetrackerNative');
