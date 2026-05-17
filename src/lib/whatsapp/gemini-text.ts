// Thin REST wrapper around Gemini 2.5 Flash text-mode + function calling.
// No SDK — direct HTTP so we don't add deps.

import type { ConvMessage } from "./conversation";

const MODEL = "gemini-2.5-flash";
const ENDPOINT = (key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;

export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

export interface GeminiContent {
  role: "user" | "model" | "function";
  parts: GeminiPart[];
}

export interface GeminiResponse {
  text: string | null;
  functionCall: { name: string; args: Record<string, unknown> } | null;
  finishReason: string;
}

// Map our conversation message format to Gemini's content format
export function toGeminiContents(messages: ConvMessage[]): GeminiContent[] {
  return messages.map((m) => {
    const parts: GeminiPart[] = [];
    if (m.text !== undefined) parts.push({ text: m.text });
    if (m.functionCall) parts.push({ functionCall: m.functionCall });
    if (m.functionResponse) parts.push({ functionResponse: m.functionResponse });
    return {
      role: m.role === "user" ? "user" : m.role === "function" ? "function" : "model",
      parts,
    };
  });
}

export async function callGemini(opts: {
  systemPrompt: string;
  tools: unknown[];
  contents: GeminiContent[];
}): Promise<GeminiResponse> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const body = {
    systemInstruction: { parts: [{ text: opts.systemPrompt }] },
    contents: opts.contents,
    tools: [{ functionDeclarations: opts.tools }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 800,
    },
    // Don't let Gemini block normal restaurant conversations
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
    ],
  };

  const res = await fetch(ENDPOINT(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];

  let text: string | null = null;
  let functionCall: { name: string; args: Record<string, unknown> } | null = null;
  for (const part of parts) {
    if (typeof part?.text === "string" && part.text.trim()) {
      text = (text ?? "") + part.text;
    }
    if (part?.functionCall && !functionCall) {
      functionCall = {
        name: part.functionCall.name,
        args: part.functionCall.args ?? {},
      };
    }
  }

  return {
    text: text?.trim() || null,
    functionCall,
    finishReason: candidate?.finishReason ?? "unknown",
  };
}
