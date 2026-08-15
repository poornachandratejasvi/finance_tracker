import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { api, getServerUrl } from "../api/client";

/** Downloads an authenticated binary file (PDF/CSV/ZIP) from the API and hands it to the
 * OS share sheet so the user can save it -- there's no app-private "Downloads" folder on
 * either platform worth writing to, so share-sheet-to-save is the only universally correct
 * flow without extra storage permissions. */
export async function downloadAndShare(path: string, suggestedName: string): Promise<void> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error("Not connected to a server");

  const authHeader = api.defaults.headers.common.Authorization as string | undefined;
  const dest = `${FileSystem.cacheDirectory}${suggestedName}`;

  const result = await FileSystem.downloadAsync(`${serverUrl}${path}`, dest, {
    headers: authHeader ? { Authorization: authHeader } : undefined,
  });

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Download failed (${result.status})`);
  }

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(result.uri);
  }
}
