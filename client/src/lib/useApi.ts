import { useAuth } from "@clerk/clerk-react";
import { useMemo } from "react";
import * as api from "./api";

/** API helpers bound to the current Clerk session token (sent as a bearer header). */
export function useApi() {
  const { getToken } = useAuth();
  return useMemo(
    () => ({
      getChats: async () => api.getChats(await getToken()),
      createChat: async (title?: string) => api.createChat(await getToken(), title),
      deleteChat: async (id: string) => api.deleteChat(await getToken(), id),
      getMessages: async (chatId: string) => api.getMessages(await getToken(), chatId),
      getMemories: async () => api.getMemories(await getToken()),
      deleteMemory: async (id: string) => api.deleteMemory(await getToken(), id),
      getCalls: async () => api.getCalls(await getToken()),
      getCall: async (id: string) => api.getCall(await getToken(), id),
      uploadFile: async (file: File) => api.uploadFile(await getToken(), file),
      getFileBlob: async (id: string) => api.getFileBlob(await getToken(), id),
    }),
    [getToken]
  );
}
