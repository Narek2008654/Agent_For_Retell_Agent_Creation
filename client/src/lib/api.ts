const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface Memory {
  id: string;
  content: string;
  createdAt: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const { headers: callerHeaders, ...restOptions } = options ?? {};
  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    ...restOptions,
    headers: {
      "Content-Type": "application/json",
      ...(callerHeaders as Record<string, string> | undefined),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }

  return res.json() as Promise<T>;
}

export function getChats(): Promise<Chat[]> {
  return request<Chat[]>("/api/chats");
}

export function createChat(title?: string): Promise<Chat> {
  return request<Chat>("/api/chats", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function deleteChat(id: string): Promise<void> {
  return request<void>(`/api/chats/${id}`, { method: "DELETE" });
}

export function getMessages(chatId: string): Promise<Message[]> {
  return request<Message[]>(`/api/chats/${chatId}/messages`);
}

export function getMemories(): Promise<Memory[]> {
  return request<Memory[]>("/api/memory");
}

export function deleteMemory(id: string): Promise<void> {
  return request<void>(`/api/memory/${id}`, { method: "DELETE" });
}
