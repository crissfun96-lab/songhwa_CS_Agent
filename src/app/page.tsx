"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ─── Constants ──────────────────────────────────────────────
const MODEL = "gemini-3.1-flash-live-preview";
const SEND_SAMPLE_RATE = 16000;
const RECEIVE_SAMPLE_RATE = 24000;
const BUFFER_SIZE = 4096;
const BUILD_VERSION = "v10-menu-live";

// ─── Types ──────────────────────────────────────────────────
type ConnectionState = "idle" | "connecting" | "connected" | "error";

interface Reservation {
  id: string;
  name: string;
  phone: string;
  date: string;
  time: string;
  pax: number;
  menuChoice: string;
  remarks: string;
  createdAt: string;
}

interface AgentConfig {
  systemPrompt: string;
  tools: unknown[];
}

type ToolArgs = Record<string, unknown>;

// ─── Audio Helpers ──────────────────────────────────────────
// floatTo16BitPCM + downsampleBuffer moved into the AudioWorklet
// (public/audio-processor.worklet.js) where they run on the audio thread.

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ─── API Helpers ──────────────────────────────────────────
async function fetchReservations(): Promise<Reservation[]> {
  // Public GET removed for PDPA compliance.
  // List populates from successful creates in this session only.
  return [];
}

async function fetchAgentConfig(): Promise<AgentConfig | null> {
  try {
    const res = await fetch("/api/menu/config");
    const data = await res.json();
    return data.success ? data.data : null;
  } catch {
    return null;
  }
}

// ─── Tool Dispatcher ────────────────────────────────────────
// Each of the 11 tools declared server-side maps to one HTTP call.
// Returns the result as a JSON string (what Gemini Live expects).
async function callTool(
  name: string,
  args: ToolArgs,
  sessionId: string,
): Promise<string> {
  const enc = encodeURIComponent;

  try {
    switch (name) {
      case "lookup_customer": {
        const n = String(args.name ?? "");
        const res = await fetch(`/api/customers?name=${enc(n)}`);
        const j = await res.json();
        return j.success ? JSON.stringify(j.data) : JSON.stringify({ found: false, message: "Lookup failed" });
      }

      case "get_business_status": {
        const res = await fetch(`/api/business/status`);
        const j = await res.json();
        return JSON.stringify(j.data ?? j);
      }

      case "search_menu": {
        const q = String(args.query ?? "");
        const res = await fetch(`/api/menu/search?q=${enc(q)}`);
        const j = await res.json();
        return JSON.stringify(j.data ?? { results: [] });
      }

      case "get_dish_details": {
        const id = String(args.id ?? "");
        const res = await fetch(`/api/menu/dish?id=${enc(id)}`);
        const j = await res.json();
        return JSON.stringify(j.data ?? { error: j.error });
      }

      case "get_active_promos": {
        const res = await fetch(`/api/menu/promos`);
        const j = await res.json();
        return JSON.stringify(j.data ?? []);
      }

      case "check_allergens": {
        const id = String(args.id ?? "");
        const res = await fetch(`/api/menu/allergens?id=${enc(id)}`);
        const j = await res.json();
        return JSON.stringify(j.data ?? { error: j.error });
      }

      case "check_availability": {
        const date = String(args.date ?? "");
        const time = String(args.time ?? "");
        const pax = String(args.pax ?? "");
        const res = await fetch(`/api/availability?date=${enc(date)}&time=${enc(time)}&pax=${enc(pax)}`);
        const j = await res.json();
        return JSON.stringify(j.data ?? { error: j.error });
      }

      case "save_reservation_draft": {
        const res = await fetch(`/api/reservations/draft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            name: args.name ?? null,
            phone: args.phone ?? null,
            date: args.date ?? null,
            time: args.time ?? null,
            pax: args.pax ?? null,
            menuChoice: args.menu_choice ?? null,
            remarks: args.remarks ?? null,
          }),
        });
        const j = await res.json();
        return JSON.stringify(j.data ?? { ok: j.success });
      }

      case "find_reservation": {
        const phone = String(args.phone ?? "");
        const date = args.date ? `&date=${enc(String(args.date))}` : "";
        const res = await fetch(`/api/reservations/find?phone=${enc(phone)}${date}`);
        const j = await res.json();
        const count = j.count ?? 0;
        const reservations = j.data ?? [];
        if (count === 0) {
          return `No reservation found under phone ${phone}. Ask customer to verify phone number digit-by-digit. If still not found, the customer may have booked under a different number.`;
        }
        const summary = reservations.map((r: Record<string, unknown>, i: number) =>
          `(${i + 1}) ID=${r.id} · ${r.name} · ${r.date} at ${r.time} · ${r.pax} pax · status=${r.status}${r.menu_choice ? ` · menu: ${r.menu_choice}` : ""}${r.remarks ? ` · remarks: ${r.remarks}` : ""}`
        ).join("\n");
        return `FOUND ${count} reservation(s) for phone ${phone}:\n${summary}\n\nConfirm WHICH one the customer wants to change by reading back date + time + pax. Use the id from above when calling update_reservation or cancel_reservation. Remember to pass phone=${phone} in those calls.`;
      }

      case "update_reservation": {
        const id = String(args.id ?? "");
        const payload: Record<string, unknown> = { sessionId };
        if (args.phone) payload.phone = String(args.phone);
        if (args.date) payload.date = String(args.date);
        if (args.time) payload.time = String(args.time);
        if (args.pax !== undefined) payload.pax = Number(args.pax);
        if (args.menu_choice !== undefined) payload.menuChoice = String(args.menu_choice);
        if (args.remarks !== undefined) payload.remarks = String(args.remarks);
        if (args.reason) payload.reason = String(args.reason);

        const res = await fetch(`/api/reservations/${enc(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (j.success) {
          return `Updated — ${j.summary}. Confirm the new details with the customer.`;
        }
        return JSON.stringify({ updated: false, ...j });
      }

      case "cancel_reservation": {
        const id = String(args.id ?? "");
        const res = await fetch(`/api/reservations/${enc(id)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            phone: args.phone ? String(args.phone) : undefined,
            reason: args.reason ? String(args.reason) : undefined,
          }),
        });
        const j = await res.json();
        if (j.success) {
          return `Cancelled successfully — ${j.summary}. Tell customer their booking is cancelled.`;
        }
        return JSON.stringify({ cancelled: false, ...j });
      }

      case "create_reservation": {
        const payload = {
          sessionId,
          name: String(args.name ?? ""),
          phone: String(args.phone ?? ""),
          date: String(args.date ?? ""),
          time: String(args.time ?? ""),
          pax: Number(args.pax ?? 0),
          menuChoice: String(args.menu_choice ?? ""),
          remarks: String(args.remarks ?? ""),
        };
        const res = await fetch(`/api/reservations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (j.success) {
          return `Reservation saved successfully for ${payload.name}, ${payload.pax} guests on ${payload.date} at ${payload.time}. Staff has been notified via Telegram.`;
        }
        // Preserve error code + alternatives so agent can handle gracefully
        return JSON.stringify({ saved: false, ...j });
      }

      case "file_complaint": {
        const res = await fetch(`/api/complaints`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: String(args.name ?? ""),
            phone: String(args.phone ?? ""),
            category: String(args.category ?? "other"),
            description: String(args.description ?? ""),
            severity: args.severity ? String(args.severity) : undefined,
            visit_date: args.visit_date ? String(args.visit_date) : undefined,
          }),
        });
        const j = await res.json();
        if (j.success) {
          return `Complaint filed. Ticket ID: ${j.data.ticket_id}. Severity: ${j.data.severity}. Response promised: ${j.data.response_eta}. Tell customer the ticket ID for reference.`;
        }
        return JSON.stringify({ filed: false, ...j });
      }

      case "request_human_callback": {
        const res = await fetch(`/api/callbacks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: String(args.name ?? ""),
            phone: String(args.phone ?? ""),
            reason: String(args.reason ?? ""),
            urgency: args.urgency ? String(args.urgency) : "medium",
          }),
        });
        const j = await res.json();
        if (j.success) {
          return `Callback requested. Ticket ID: ${j.data.ticket_id}. Staff will call back within ${j.data.eta_minutes} minutes. Tell customer the ticket ID.`;
        }
        return JSON.stringify({ queued: false, ...j });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({
      error: err instanceof Error ? err.message.slice(0, 200) : "Tool call failed",
    });
  }
}

// ─── Component ──────────────────────────────────────────────
export default function SonghwaAgentPage() {
  const [state, setState] = useState<ConnectionState>("idle");
  const [statusText, setStatusText] = useState("Loading agent config...");
  const [volume, setVolume] = useState(0);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  // Session ID — generated once per component mount
  const sessionIdRef = useRef<string>(
    `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
  );

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // AudioWorklet replaces the deprecated ScriptProcessorNode (Bug #9 fix)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const setupCompleteRef = useRef(false);
  // Tracks the currently-playing audio source so we can stop it on barge-in
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Load reservations + agent config on mount
  useEffect(() => {
    Promise.all([fetchReservations(), fetchAgentConfig()]).then(([res, cfg]) => {
      setReservations(res);
      if (cfg) {
        setAgentConfig(cfg);
        setStatusText("Tap the mic to start");
      } else {
        setConfigError("Could not load agent config. Check /api/menu/config.");
        setStatusText("Configuration error");
        setState("error");
      }
    });
  }, []);

  const log = useCallback((msg: string) => {
    console.log(`[Songhwa] ${msg}`);
    setDebugLog((prev) => [
      ...prev.slice(-79),
      `${new Date().toLocaleTimeString()} ${msg}`,
    ]);
  }, []);

  // ── Handle function calls from Gemini (dispatches to all 11 tools) ──
  const handleFunctionCall = useCallback(
    async (name: string, args: ToolArgs, callId: string) => {
      log(`Tool: ${name}(${JSON.stringify(args).slice(0, 80)})`);
      const ws = wsRef.current;

      const result = await callTool(name, args, sessionIdRef.current);
      log(`Tool ${name} → ${result.slice(0, 80)}`);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            toolResponse: {
              functionResponses: [{ id: callId, response: { result } }],
            },
          }),
        );
      }

      // Append newly-created reservation to local list (no public GET)
      if (name === "create_reservation") {
        try {
          const parsed = typeof result === "string" ? JSON.parse(result) : null;
          const saved = parsed == null || parsed.saved !== false;
          if (saved && args.name && args.phone && args.date && args.time && args.pax) {
            setReservations((prev) => [
              {
                id: `session_${Date.now()}`,
                name: String(args.name),
                phone: String(args.phone),
                date: String(args.date),
                time: String(args.time),
                pax: Number(args.pax),
                menuChoice: String(args.menu_choice ?? ""),
                remarks: String(args.remarks ?? ""),
                createdAt: new Date().toISOString(),
              },
              ...prev,
            ]);
          }
        } catch {
          // ignore parse errors — result might not be JSON (e.g., a plain string)
        }
      }
    },
    [log],
  );

  // ── Playback engine ──
  const playNextChunk = useCallback(() => {
    if (!playbackContextRef.current || audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsAiSpeaking(false);
      currentSourceRef.current = null;
      return;
    }

    isPlayingRef.current = true;
    setIsAiSpeaking(true);
    const chunk = audioQueueRef.current.shift()!;
    const int16 = new Int16Array(chunk);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 0x8000;
    }

    const ctx = playbackContextRef.current;
    const audioBuffer = ctx.createBuffer(1, float32.length, RECEIVE_SAMPLE_RATE);
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.onended = () => {
      if (currentSourceRef.current === source) currentSourceRef.current = null;
      playNextChunk();
    };
    currentSourceRef.current = source;
    source.start();
  }, []);

  // ── Barge-in: stop AI mid-sentence when user starts speaking ──
  const stopPlayback = useCallback(() => {
    audioQueueRef.current = [];
    try {
      currentSourceRef.current?.stop();
    } catch {
      // already stopped
    }
    currentSourceRef.current = null;
    isPlayingRef.current = false;
    setIsAiSpeaking(false);
  }, []);

  const enqueueAudio = useCallback(
    (data: ArrayBuffer) => {
      audioQueueRef.current.push(data);
      if (!isPlayingRef.current) {
        playNextChunk();
      }
    },
    [playNextChunk],
  );

  // ── Volume meter ──
  const updateVolume = useCallback(() => {
    if (!analyserRef.current) return;
    const data = new Uint8Array(analyserRef.current.fftSize);
    analyserRef.current.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    setVolume(Math.sqrt(sum / data.length));
    animFrameRef.current = requestAnimationFrame(updateVolume);
  }, []);

  // ── Start mic (uses modern AudioWorklet — was ScriptProcessorNode, Bug #9) ──
  const startMicCapture = useCallback(
    async (ws: WebSocket) => {
      log("Starting mic capture...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      let audioCtx = audioContextRef.current;
      if (!audioCtx || audioCtx.state === "closed") {
        audioCtx = new AudioContext();
        audioContextRef.current = audioCtx;
      }
      if (audioCtx.state === "suspended") await audioCtx.resume();
      log(`Mic ready (${audioCtx.sampleRate}Hz, state: ${audioCtx.state})`);

      // Load the worklet module ONCE per AudioContext.
      // /audio-processor.worklet.js lives in public/ (served at site root).
      try {
        await audioCtx.audioWorklet.addModule("/audio-processor.worklet.js");
      } catch (err) {
        log(`AudioWorklet load failed: ${String(err).slice(0, 80)}`);
        throw err;
      }

      const sourceNode = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      sourceNode.connect(analyser);

      const workletNode = new AudioWorkletNode(audioCtx, "pcm-processor", {
        processorOptions: {
          targetSampleRate: SEND_SAMPLE_RATE,
          bufferSize: BUFFER_SIZE,
        },
      });
      workletNodeRef.current = workletNode;

      let chunkCount = 0;
      workletNode.port.onmessage = (event) => {
        if (ws.readyState !== WebSocket.OPEN || !setupCompleteRef.current) return;
        // Full-duplex: ALWAYS stream mic to Gemini.
        // Echo cancellation (getUserMedia constraint) prevents TTS feedback.
        // Gemini's VAD + serverContent.interrupted handles barge-in.
        const pcmBuffer = event.data as ArrayBuffer;
        const base64 = arrayBufferToBase64(pcmBuffer);
        ws.send(
          JSON.stringify({
            realtimeInput: {
              audio: { data: base64, mimeType: "audio/pcm;rate=16000" },
            },
          }),
        );
        chunkCount++;
        if (chunkCount === 1) log("Streaming audio ✓");
        if (chunkCount % 100 === 0) log(`Audio chunks: ${chunkCount}`);
      };

      // Worklet only runs when its output is connected somewhere.
      // Route through a muted gain so it processes without playing the mic out.
      const muteGain = audioCtx.createGain();
      muteGain.gain.value = 0;
      sourceNode.connect(workletNode);
      workletNode.connect(muteGain).connect(audioCtx.destination);

      let playCtx = playbackContextRef.current;
      if (!playCtx || playCtx.state === "closed") {
        playCtx = new AudioContext({ sampleRate: RECEIVE_SAMPLE_RATE });
        playbackContextRef.current = playCtx;
      }
      if (playCtx.state === "suspended") await playCtx.resume();

      updateVolume();
      setState("connected");
      setStatusText("Listening... speak now!");
      log("Session active ✓");
    },
    [log, updateVolume],
  );

  // ── Connect ──
  const startSession = useCallback(async () => {
    if (!agentConfig) {
      setStatusText("Agent config not loaded. Try refreshing.");
      return;
    }

    setState("connecting");
    setStatusText("Connecting...");
    setupCompleteRef.current = false;
    setDebugLog([]);
    log(`Session ID: ${sessionIdRef.current}`);

    try {
      const preAudioCtx = new AudioContext();
      await preAudioCtx.resume();
      audioContextRef.current = preAudioCtx;

      const prePlayCtx = new AudioContext({ sampleRate: RECEIVE_SAMPLE_RATE });
      await prePlayCtx.resume();
      playbackContextRef.current = prePlayCtx;
      log(`Audio ready (${preAudioCtx.sampleRate}Hz → ${RECEIVE_SAMPLE_RATE}Hz)`);
    } catch (audioErr) {
      log(`Audio init warning: ${String(audioErr).slice(0, 60)}`);
    }

    try {
      // Preferred: connect through our WS proxy so the API key stays server-side.
      // Falls back to ephemeral token, then raw API key (legacy — fixes Bug #2 only
      // when NEXT_PUBLIC_WS_PROXY_URL is set).
      const proxyUrl = process.env.NEXT_PUBLIC_WS_PROXY_URL?.trim();
      let wsUrl: string;

      if (proxyUrl) {
        log(`Using WS proxy: ${proxyUrl}`);
        wsUrl = proxyUrl;
      } else {
        log("Fetching token...");
        const tokenRes = await fetch("/api/songhwa-token", { method: "POST" });
        const tokenData = await tokenRes.json();

        if (tokenData.token) {
          log("Got ephemeral token");
          wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${tokenData.token}`;
        } else if (tokenData.apiKey) {
          log("Using API key session (insecure — set NEXT_PUBLIC_WS_PROXY_URL to fix Bug #2)");
          wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${tokenData.apiKey}`;
        } else {
          throw new Error(tokenData.error || "No credentials returned");
        }
      }

      log("Opening WebSocket...");
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        log(`Connected. Using live config: ${agentConfig.tools.length} tools, ${agentConfig.systemPrompt.length} char prompt`);
        const setupMsg = {
          setup: {
            model: `models/${MODEL}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: "Kore" },
                },
              },
            },
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: false,
                startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
                endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
                prefixPaddingMs: 100,
                silenceDurationMs: 1000,
              },
            },
            systemInstruction: {
              parts: [{ text: agentConfig.systemPrompt }],
            },
            tools: [{ functionDeclarations: agentConfig.tools }],
          },
        };
        ws.send(JSON.stringify(setupMsg));
        log(`Setup sent (tools: ${agentConfig.tools.length})`);

        setTimeout(() => {
          if (!setupCompleteRef.current && ws.readyState === WebSocket.OPEN) {
            log("Timeout — starting mic...");
            setupCompleteRef.current = true;
            startMicCapture(ws);
          }
        }, 2000);
      };

      ws.onmessage = async (event) => {
        try {
          let text: string;
          if (typeof event.data === "string") {
            text = event.data;
          } else if (event.data instanceof Blob) {
            text = await event.data.text();
          } else if (event.data instanceof ArrayBuffer) {
            text = new TextDecoder().decode(event.data);
          } else {
            return;
          }
          const response = JSON.parse(text);
          const keys = Object.keys(response);

          if (response.setupComplete !== undefined) {
            log("Setup complete!");
            if (!setupCompleteRef.current) {
              setupCompleteRef.current = true;
              startMicCapture(ws);
            }
            return;
          }

          if (response.toolCall) {
            log("Tool call received!");
            const functionCalls = response.toolCall.functionCalls || [];
            for (const fc of functionCalls) {
              handleFunctionCall(fc.name, fc.args || {}, fc.id || "");
            }
            return;
          }

          // Barge-in: Gemini detected user speech mid-response → drop the rest
          if (response.serverContent?.interrupted) {
            log("Interrupted by user — stopping AI playback");
            stopPlayback();
          }

          if (response.serverContent?.modelTurn?.parts) {
            for (const part of response.serverContent.modelTurn.parts) {
              if (part.inlineData?.data) {
                enqueueAudio(base64ToArrayBuffer(part.inlineData.data));
              }
              if (part.functionCall) {
                handleFunctionCall(
                  part.functionCall.name,
                  part.functionCall.args || {},
                  part.functionCall.id || "",
                );
              }
            }
          }

          if (response.error) {
            log(`Error: ${JSON.stringify(response.error).slice(0, 150)}`);
            setState("error");
            setStatusText("Server error. Tap to retry.");
          }

          if (
            !keys.includes("serverContent") &&
            !keys.includes("setupComplete") &&
            !keys.includes("toolCall") &&
            !keys.includes("sessionResumptionUpdate")
          ) {
            log(`MSG: ${keys.join(", ")}`);
          }
        } catch (e) {
          log(`Parse: ${String(e).slice(0, 80)}`);
        }
      };

      ws.onerror = () => {
        log("WebSocket error");
        setState("error");
        setStatusText("Connection error. Tap to retry.");
      };

      ws.onclose = (e) => {
        log(`Closed (${e.code})`);
        setState("idle");
        setStatusText("Session ended. Tap to start.");
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      log(`Failed: ${msg}`);
      setState("error");
      setStatusText(`Error: ${msg}. Tap to retry.`);
    }
  }, [log, enqueueAudio, startMicCapture, handleFunctionCall, agentConfig, stopPlayback]);

  // ── Disconnect ──
  const stopSession = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    setupCompleteRef.current = false;
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try {
      currentSourceRef.current?.stop();
    } catch {
      // already stopped
    }
    currentSourceRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    playbackContextRef.current?.close();
    playbackContextRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    setIsAiSpeaking(false);
    setVolume(0);
    setState("idle");
    setStatusText("Tap the mic to start");
  }, []);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioContextRef.current?.close();
      playbackContextRef.current?.close();
      wsRef.current?.close();
    };
  }, []);

  // ── Render ──
  const pulseScale = state === "connected" ? 1 + volume * 2 : 1;
  const btnBg =
    state === "connected"
      ? isAiSpeaking
        ? "linear-gradient(135deg, #f59e0b, #d97706)"
        : "linear-gradient(135deg, #22c55e, #16a34a)"
      : state === "connecting"
        ? "linear-gradient(135deg, #3b82f6, #2563eb)"
        : state === "error"
          ? "linear-gradient(135deg, #ef4444, #dc2626)"
          : "linear-gradient(135deg, #64748b, #475569)";
  const glow =
    state === "connected"
      ? isAiSpeaking
        ? "0 0 60px rgba(234,179,8,0.6)"
        : "0 0 60px rgba(34,197,94,0.5)"
      : "0 0 30px rgba(148,163,184,0.3)";

  const toolCount = useMemo(() => agentConfig?.tools.length ?? 0, [agentConfig]);

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "linear-gradient(180deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        color: "#fff",
        padding: "24px 16px 100px",
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center", marginTop: 32, marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>松花韩食</h1>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", margin: "4px 0 0", letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Songhwa Voice Agent
        </p>
        {agentConfig && (
          <p style={{ fontSize: 10, color: "rgba(34,197,94,0.6)", margin: "8px 0 0" }}>
            Live menu • {toolCount} tools
          </p>
        )}
      </div>

      {configError && (
        <div style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 8, padding: 12, marginBottom: 16, maxWidth: 380, fontSize: 12, color: "#fca5a5" }}>
          {configError}
        </div>
      )}

      {/* Mic Button */}
      <button
        onClick={state === "connected" ? stopSession : startSession}
        disabled={state === "connecting" || !agentConfig}
        style={{
          width: 130, height: 130, borderRadius: "50%", border: "none",
          background: btnBg, cursor: state === "connecting" ? "wait" : agentConfig ? "pointer" : "not-allowed",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: glow, transform: `scale(${pulseScale})`,
          transition: "transform 0.1s ease-out, box-shadow 0.2s ease",
          WebkitTapHighlightColor: "transparent",
          opacity: agentConfig ? 1 : 0.5,
        }}
      >
        {state === "connected" ? (
          <svg width="40" height="40" viewBox="0 0 24 24" fill="white"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
        ) : state === "connecting" ? (
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        ) : (
          <svg width="40" height="40" viewBox="0 0 24 24" fill="white">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" />
            <line x1="12" y1="19" x2="12" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round" />
            <line x1="8" y1="23" x2="16" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </button>

      <p style={{ marginTop: 20, fontSize: 15, color: "rgba(255,255,255,0.8)", textAlign: "center" }}>
        {statusText}
      </p>
      {isAiSpeaking && (
        <p style={{ fontSize: 12, color: "#f59e0b", animation: "pulse 1.5s ease-in-out infinite" }}>
          Agent speaking...
        </p>
      )}

      {/* Reservations List */}
      <div style={{ width: "100%", maxWidth: 420, marginTop: 32 }}>
        <div style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
            Reservations ({reservations.length})
          </h2>
        </div>

        {reservations.length === 0 ? (
          <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: "20px 16px", textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
            No reservations yet. Talk to the agent to make one.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {reservations.map((r) => (
              <div
                key={r.id}
                style={{
                  background: "rgba(255,255,255,0.08)",
                  borderRadius: 10,
                  padding: "14px 16px",
                  borderLeft: "3px solid #22c55e",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</span>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
                    {r.pax} pax
                  </span>
                </div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.6 }}>
                  <div>📅 {r.date} at {r.time}</div>
                  <div>📞 {r.phone}</div>
                  {r.menuChoice && <div>🍽️ {r.menuChoice}</div>}
                  {r.remarks && <div>📝 {r.remarks}</div>}
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 6 }}>
                  Saved {new Date(r.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Debug Toggle */}
      <button
        onClick={() => setShowDebug((p) => !p)}
        style={{
          marginTop: 24, fontSize: 11, color: "rgba(255,255,255,0.3)",
          background: "none", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6, padding: "4px 12px", cursor: "pointer",
        }}
      >
        {showDebug ? "Hide" : "Show"} Debug Log
      </button>

      {showDebug && debugLog.length > 0 && (
        <div
          style={{
            marginTop: 8, width: "100%", maxWidth: 420, maxHeight: 200,
            overflow: "auto", background: "rgba(0,0,0,0.5)", borderRadius: 8,
            padding: "8px 12px", fontSize: 10, fontFamily: "monospace",
            color: "rgba(255,255,255,0.4)", lineHeight: 1.6,
          }}
        >
          {debugLog.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={{ position: "fixed", bottom: 16, textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.1)" }}>
        <p style={{ margin: 0 }}>{BUILD_VERSION}</p>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </div>
  );
}
