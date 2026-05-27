const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
}

export interface Message {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  attachments?: Attachment[];
}

export interface Memory {
  id: string;
  content: string;
  createdAt: string;
}

async function request<T>(path: string, token: string | null, options?: RequestInit): Promise<T> {
  const { headers: callerHeaders, ...restOptions } = options ?? {};
  const res = await fetch(`${API_URL}${path}`, {
    ...restOptions,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(callerHeaders as Record<string, string> | undefined),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }

  return res.json() as Promise<T>;
}

export function getChats(token: string | null): Promise<Chat[]> {
  return request<Chat[]>("/api/chats", token);
}

export function createChat(token: string | null, title?: string): Promise<Chat> {
  return request<Chat>("/api/chats", token, {
    method: "POST",
    body: JSON.stringify(title ? { title } : {}),
  });
}

export function deleteChat(token: string | null, id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/chats/${id}`, token, { method: "DELETE" });
}

export function getMessages(token: string | null, chatId: string): Promise<Message[]> {
  return request<Message[]>(`/api/chats/${chatId}/messages`, token);
}

export function getMemories(token: string | null): Promise<Memory[]> {
  return request<Memory[]>("/api/memory", token);
}

export function deleteMemory(token: string | null, id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/memory/${id}`, token, { method: "DELETE" });
}

export async function uploadFile(token: string | null, file: File): Promise<Attachment> {
  const form = new FormData();
  form.append("file", file);
  // Do NOT set Content-Type — the browser sets the multipart boundary.
  const res = await fetch(`${API_URL}/api/uploads`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ""}`);
  }
  return res.json() as Promise<Attachment>;
}

export async function getFileBlob(token: string | null, id: string): Promise<Blob> {
  const res = await fetch(`${API_URL}/api/files/${id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

export interface CallRow {
  id: string;
  personEmail: string | null;
  toNumber: string | null;
  status: string | null;
  durationSec: number;
  summary: string;
  createdAt: string;
}

export interface CallHistoryItem {
  id: string;
  durationSec: number;
  status: string | null;
  disconnectionReason: string | null;
  summary: string;
  transcript: string;
  createdAt: string;
}

export interface CallDetail {
  call: CallHistoryItem & { personEmail: string | null; toNumber: string | null };
  person: { email: string; summary: string } | null;
  history: CallHistoryItem[];
}

export function getCalls(token: string | null): Promise<CallRow[]> {
  return request<CallRow[]>("/api/calls", token);
}

export function getCall(token: string | null, id: string): Promise<CallDetail> {
  return request<CallDetail>(`/api/calls/${id}`, token);
}
