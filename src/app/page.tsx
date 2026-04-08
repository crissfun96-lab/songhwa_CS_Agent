"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─── Constants ──────────────────────────────────────────────
const MODEL = "gemini-3.1-flash-live-preview";
const SEND_SAMPLE_RATE = 16000;
const RECEIVE_SAMPLE_RATE = 24000;
const BUFFER_SIZE = 4096;
const STORAGE_KEY = "songhwa_reservations";
const CUSTOMERS_KEY = "songhwa_customers";
const BUILD_VERSION = "v8-echo-fix";

const SONGHWA_SYSTEM_PROMPT = `You are the friendly AI phone assistant for Songhwa Korean Cuisine (松花韩食 / 송화한식), a premium Korean BBQ restaurant in Kuala Lumpur, Malaysia. "Songhwa" means pine blossom — inspired by Korea's national tree. Our motto: "Natural, True and Timeless Taste of Korea."

Your personality: Warm, professional, helpful. Keep answers SHORT — this is a voice call.

LANGUAGE RULE (CRITICAL):
- Detect which language the customer speaks (English, Bahasa Malaysia, Mandarin Chinese, or mixed).
- ALWAYS reply in the SAME language the customer uses.
- If they mix languages, reply in their primary language.
- If they switch language mid-conversation, switch with them immediately.

═══════════════════════════════════════════
RESTAURANT INFORMATION (MUST BE 100% ACCURATE)
═══════════════════════════════════════════

LOCATION:
- Address: Level 8, Millerz Square, Unit 08-05, 357 Jalan Klang Lama (Old Klang Road), 58000 Kuala Lumpur
- Building: Millerz Tower E, Podium Level 8
- Nearest landmark: Millerz Square mall, Old Klang Road

OPERATING HOURS:
- Lunch: 11:30 AM – 3:00 PM (daily)
- Dinner: 5:30 PM – 10:00 PM (daily, last order 9:30 PM)
- Open 7 days a week including public holidays (unless announced otherwise)
- If customer asks about availability outside these hours, say "Sorry, we're only open for lunch from 11:30 AM to 3 PM, and dinner from 5:30 PM to 10 PM."

CONTACT:
- WhatsApp: +60 11-5430 2561
- Instagram: @songhwa_millerz
- Facebook: SongHwa Korean Cuisine 송화한식

PARKING:
- Millerz Square basement parking available
- First 15 minutes: FREE
- Daytime: RM 2 per 2 hours, then RM 2 per subsequent hour
- Evening flat rate (after 5 PM): RM 3 per entry — very affordable for dinner
- EV charging available in the building

DIRECTIONS:
- By car: Search "Songhwa Korean Cuisine Millerz Square" on Google Maps or Waze
- Located along Old Klang Road (Jalan Klang Lama), one of KL's main roads
- The restaurant is on Level 8 — take the lift from the basement or ground floor

PAYMENT METHODS:
- Cash, Visa, Mastercard accepted
- For e-wallet (Touch n Go, GrabPay), suggest customer check with staff on arrival

HALAL STATUS (CRITICAL — answer honestly):
- Songhwa is NON-HALAL. We serve pork dishes (BBQ Pork Belly, Pork Backbone Stew, etc.)
- If asked "Is it halal?", say clearly: "No, Songhwa is non-halal. We do serve pork items on our menu."

RATINGS:
- Google: 4.7/5 stars (nearly 2,000 reviews)
- Tripadvisor: 5.0/5
- Korean idols Taemin, Epik High, and Winner have dined here

ATMOSPHERE:
- Korean-style interior with warm lighting and wooden accents
- Tabletop BBQ grills for a fun, interactive dining experience
- Kids friendly — families welcome
- Great for group dining, birthday celebrations, date nights, and gatherings
- No formal dress code — casual dining

═══════════════════════════════════════════
MENU (ALL PRICES IN RM — RINGGIT MALAYSIA)
═══════════════════════════════════════════

VALUE SETS (all include 3 refillable banchan/side dishes, seasonal fruit, Korean Corn Silk Tea):

Individual Sets:
- M5: BBQ Beef Set — RM88 (comes with LA Galbi; upgrade to Premium Beef Ribeye +RM23)
- M6: BBQ Lamb Set — RM65 (marinated lamb ribs, yang-galbi style)
- M7: BBQ Pork Belly Set — RM55 (samgyeopsal, our most popular individual set)
- M8: BBQ Chicken/Fish Set — RM45 (great budget option)

Group Full Course Meals (best value — includes BBQ meats, stew, sides, dessert):
- M1: Full Course 8-10 pax — RM588 (SUPER VALUE for large groups)
- M2: Full Course 4-5 pax — RM358 (BEST SELLER — most popular for families and friends)
- M3: Full Course 2-3 pax — RM168 (perfect for small groups)
- M4: Royal Course 2 pax — RM128 (COUPLE'S CHOICE — romantic date option)

Add-ons: Rice +RM3, Steamed Egg +RM4.80, Choux Cream +RM8.80, Soju +RM21

A LA CARTE BBQ:
- BBQ Pork Belly / Samgyeopsal (150g) — RM38
- BBQ Marinated Lamb / Yang-galbi (200g) — RM45
- LA-style Korean BBQ Short Ribs / La Galbi (200g) — RM74
- Premium Beef Ribeye or Sirloin / Kkotsal (150g) — RM98

STEWS & SOUPS (served with rice and banchan):
- Kimchi Soup / Kimchi Jjigae — RM26
- Spicy Soft Tofu Soup / Sundubu Jjigae — RM26
- Pork Backbone Stew / Gamjatang — RM32
- Ginseng Chicken Soup / Samgyetang (serves 2) — RM50

RICE & NOODLES:
- Stone Pot Rice / Dolsot Bap — RM30
- Stone Pot Braised Pork Ribs (2-3 pax) — RM78

APPETIZERS & SIDES:
- Seafood Pancake / Haemul Pajeon — RM32
- Korean Fried Chicken / Dakgangjeong (8 pcs) — RM25

COMPLIMENTARY:
- Free soy pudding dessert for every dine-in customer
- Refillable banchan (side dishes including kimchi) with every meal

MENU RECOMMENDATIONS BY GROUP SIZE:
- Solo/2 pax date: M4 Royal Course (RM128) or 2x individual sets
- 2-3 friends: M3 Full Course (RM168) — great value
- Family of 4-5: M2 Full Course (RM358) — our best seller
- Big group 8-10: M1 Full Course (RM588) — super value, everything included
- Budget option: M8 Chicken/Fish Set (RM45) or Kimchi Jjigae (RM26)

DIETARY NOTES:
- Vegetarian: Limited options. Sundubu Jjigae (tofu soup) can be requested without meat, but stock may contain seafood/anchovy base. Please inform staff of dietary needs.
- Allergies: Please inform us in advance so our kitchen can accommodate.
- All BBQ is cooked by the customer at the table on our charcoal/gas grills.

DELIVERY:
- Available on GrabFood and FoodPanda (search "Songhwa Korean Cuisine")
- Dine-in recommended for the full BBQ experience

DISCOUNTS:
- Book through Eatigo app for up to 50% off a la carte items during off-peak slots (early lunch at 11:30 AM, early dinner at 5:30 PM)

═══════════════════════════════════════════
CUSTOMER MEMORY (IMPORTANT — use this to personalize)
═══════════════════════════════════════════

1. Early in the conversation, ask for the customer's FULL NAME (first name and last name).
2. IMMEDIATELY call lookup_customer with their name to check if they're a returning customer.
3. If found, greet them warmly! Example: "Welcome back, Mr. Tan! Great to hear from you again. Last time you had the M2 Full Course set for 4 people. Would you like to book again?"
4. Reference their previous visits, favorite orders, or preferences when making suggestions.
5. If NOT found, proceed normally — they're a new customer. Say something like: "Welcome to Songhwa! It's great to have a new guest."

═══════════════════════════════════════════
PHONE NUMBER HANDLING (CRITICAL — numbers are tricky in voice)
═══════════════════════════════════════════

- When the customer says their phone number, repeat it back SLOWLY, digit by digit.
- Example: Customer says "0143609330" → You say: "Let me confirm your number: zero-one-four-three-six-zero-nine-three-three-zero. Is that correct?"
- If they say it's wrong, ask them to say it again SLOWLY, one digit at a time.
- Malaysian phone numbers are typically 10-11 digits starting with 01. If you have more digits, something is wrong — ask again.
- NEVER guess or add extra digits. Only use EXACTLY what the customer confirms.

═══════════════════════════════════════════
RESERVATION RULES (CRITICAL — follow exactly)
═══════════════════════════════════════════

1. To make a reservation, you MUST collect ALL of these: customer name, phone number, date, time, number of guests.
2. VALIDATE the time: Only accept reservations during operating hours (Lunch 11:30 AM - 3:00 PM, Dinner 5:30 PM - 10:00 PM). If customer requests a time outside hours, politely suggest the nearest available slot.
3. ALSO ask: "Would you like to pre-order any set menu?" or "Any special requests?" — capture their menu choice and any remarks.
4. If any of the 5 required fields is missing, ask for it.
5. After collecting ALL details, read them back clearly, INCLUDING any menu choice or remarks. Example: "Let me confirm: [Name], phone [Phone], [Date] at [Time], [Pax] guests, you'd like the M2 Full Course set, and you mentioned a birthday celebration. Is that correct?"
6. ONLY call create_reservation AFTER the customer confirms.
7. If something is wrong, ask them to correct it, then read back again.
8. After saving, say: "Your reservation has been saved! We look forward to seeing you at Songhwa, Level 8 Millerz Square."
9. Put the menu choice and any special requests into the "remarks" field when calling create_reservation.

═══════════════════════════════════════════
GENERAL RULES
═══════════════════════════════════════════

1. Greet in the customer's detected language. Default English: "Thank you for calling Songhwa Korean Cuisine! How can I help you?"
2. Be concise — short sentences, natural voice.
3. Suggest a set meal if they seem undecided — recommend based on group size. For returning customers, suggest what they had before or something new.
4. When giving directions, say: "We're at Level 8, Millerz Square on Old Klang Road. Just search Songhwa Korean Cuisine on Google Maps or Waze."
5. If customer asks about parking, mention the RM 3 flat evening rate.
6. NEVER make up information. If you don't know something, say "Let me check with our staff. You can also WhatsApp us at 011-5430 2561."
7. If customer asks for the WhatsApp number, give: 011-5430 2561.
8. If customer asks about halal status, be honest: "We are non-halal and serve pork dishes."
9. For large groups (10+), suggest they WhatsApp to arrange seating.`;

const RESERVATION_TOOL = {
  name: "create_reservation",
  description:
    "Save a confirmed restaurant reservation. ONLY call this AFTER reading back all details to the customer and receiving their verbal confirmation.",
  parameters: {
    type: "OBJECT",
    properties: {
      name: {
        type: "STRING",
        description: "Customer's full name",
      },
      phone: {
        type: "STRING",
        description: "Customer's phone number",
      },
      date: {
        type: "STRING",
        description: "Reservation date (e.g. '2026-03-28' or 'Saturday March 28')",
      },
      time: {
        type: "STRING",
        description: "Reservation time (e.g. '7:00 PM' or '19:00')",
      },
      pax: {
        type: "INTEGER",
        description: "Number of guests",
      },
      menu_choice: {
        type: "STRING",
        description: "Menu set or dishes the customer wants to pre-order (e.g. 'M2 Full Course', 'M5 BBQ Beef Set x2', 'M7 Pork Belly + M8 Chicken')",
      },
      remarks: {
        type: "STRING",
        description: "Any special requests, dietary needs, occasion (birthday, anniversary), seating preference, or other notes from the customer",
      },
    },
    required: ["name", "phone", "date", "time", "pax"],
  },
};

const LOOKUP_CUSTOMER_TOOL = {
  name: "lookup_customer",
  description:
    "Look up a customer by name to check if they are a returning customer. Call this early in the conversation after getting their name. Returns their visit history and past reservation details if found.",
  parameters: {
    type: "OBJECT",
    properties: {
      name: {
        type: "STRING",
        description: "Customer's full name (first and last name) to look up",
      },
    },
    required: ["name"],
  },
};

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

interface CustomerProfile {
  name: string;
  phone: string;
  visitCount: number;
  lastVisit: string;
  favoriteOrders: string[];
  reservations: { date: string; time: string; pax: number; menuChoice: string; remarks: string }[];
}

// ─── Audio Helpers ──────────────────────────────────────────
function floatTo16BitPCM(float32Array: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function downsampleBuffer(
  buffer: Float32Array,
  inputRate: number,
  outputRate: number,
): Float32Array {
  if (inputRate === outputRate) return buffer;
  const ratio = inputRate / outputRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const index = Math.round(i * ratio);
    result[i] = buffer[Math.min(index, buffer.length - 1)];
  }
  return result;
}

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

function loadReservations(): Reservation[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveReservations(reservations: Reservation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reservations));
}

function loadCustomers(): CustomerProfile[] {
  try {
    const data = localStorage.getItem(CUSTOMERS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveCustomers(customers: CustomerProfile[]) {
  localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(customers));
}

function lookupCustomerByName(name: string): CustomerProfile | null {
  const customers = loadCustomers();
  const needle = name.toLowerCase().trim();
  return (
    customers.find((c) => c.name.toLowerCase().trim() === needle) ??
    customers.find((c) => c.name.toLowerCase().includes(needle) || needle.includes(c.name.toLowerCase())) ??
    null
  );
}

function upsertCustomer(
  name: string,
  phone: string,
  menuChoice: string,
  remarks: string,
  date: string,
  time: string,
  pax: number,
) {
  const customers = loadCustomers();
  const needle = name.toLowerCase().trim();
  const idx = customers.findIndex((c) => c.name.toLowerCase().trim() === needle);

  const visit = { date, time, pax, menuChoice, remarks };

  if (idx >= 0) {
    // Returning customer — update immutably
    const existing = customers[idx];
    const updated: CustomerProfile = {
      ...existing,
      phone: phone || existing.phone,
      visitCount: existing.visitCount + 1,
      lastVisit: new Date().toISOString(),
      favoriteOrders: menuChoice
        ? [...new Set([...existing.favoriteOrders, menuChoice])]
        : existing.favoriteOrders,
      reservations: [...existing.reservations, visit],
    };
    const newCustomers = [...customers.slice(0, idx), updated, ...customers.slice(idx + 1)];
    saveCustomers(newCustomers);
  } else {
    // New customer
    const profile: CustomerProfile = {
      name,
      phone,
      visitCount: 1,
      lastVisit: new Date().toISOString(),
      favoriteOrders: menuChoice ? [menuChoice] : [],
      reservations: [visit],
    };
    saveCustomers([...customers, profile]);
  }
}

// ─── Component ──────────────────────────────────────────────
export default function SonghwaAgentPage() {
  const [state, setState] = useState<ConnectionState>("idle");
  const [statusText, setStatusText] = useState("Tap the mic to start");
  const [volume, setVolume] = useState(0);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const setupCompleteRef = useRef(false);

  // Load reservations on mount
  useEffect(() => {
    setReservations(loadReservations());
  }, []);

  const log = useCallback((msg: string) => {
    console.log(`[Songhwa] ${msg}`);
    setDebugLog((prev) => [
      ...prev.slice(-79),
      `${new Date().toLocaleTimeString()} ${msg}`,
    ]);
  }, []);

  // ── Handle function calls from Gemini ──
  const handleFunctionCall = useCallback(
    (name: string, args: Record<string, unknown>, callId: string) => {
      log(`Function call: ${name}(${JSON.stringify(args).slice(0, 100)})`);

      if (name === "lookup_customer") {
        const customerName = String(args.name || "");
        const found = lookupCustomerByName(customerName);
        const ws = wsRef.current;

        if (found) {
          log(`Customer found: ${found.name} (${found.visitCount} visits)`);
          const recentOrders = found.favoriteOrders.slice(-3).join(", ") || "none recorded";
          const lastReservation = found.reservations[found.reservations.length - 1];
          const lastVisitInfo = lastReservation
            ? `Last visit: ${lastReservation.date}, ${lastReservation.pax} pax, ordered ${lastReservation.menuChoice || "not specified"}`
            : "No previous reservation details";

          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                toolResponse: {
                  functionResponses: [
                    {
                      id: callId,
                      response: {
                        result: JSON.stringify({
                          found: true,
                          name: found.name,
                          phone: found.phone,
                          visitCount: found.visitCount,
                          lastVisit: found.lastVisit,
                          favoriteOrders: recentOrders,
                          lastVisitInfo,
                        }),
                      },
                    },
                  ],
                },
              }),
            );
          }
        } else {
          log(`Customer not found: ${customerName}`);
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                toolResponse: {
                  functionResponses: [
                    {
                      id: callId,
                      response: {
                        result: JSON.stringify({
                          found: false,
                          message: `No customer record found for "${customerName}". This is a new customer.`,
                        }),
                      },
                    },
                  ],
                },
              }),
            );
          }
        }
        return;
      }

      if (name === "create_reservation") {
        const resName = String(args.name || "");
        const resPhone = String(args.phone || "");
        const resDate = String(args.date || "");
        const resTime = String(args.time || "");
        const resPax = Number(args.pax || 0);
        const resMenu = String(args.menu_choice || "");
        const resRemarks = String(args.remarks || "");

        const reservation: Reservation = {
          id: `res_${Date.now()}`,
          name: resName,
          phone: resPhone,
          date: resDate,
          time: resTime,
          pax: resPax,
          menuChoice: resMenu,
          remarks: resRemarks,
          createdAt: new Date().toISOString(),
        };

        // Save reservation to state + localStorage
        setReservations((prev) => {
          const updated = [reservation, ...prev];
          saveReservations(updated);
          return updated;
        });

        // Upsert customer profile for memory
        upsertCustomer(resName, resPhone, resMenu, resRemarks, resDate, resTime, resPax);

        log(`Reservation saved: ${resName} - ${resDate} ${resTime} | Customer profile updated`);

        // Send function response back to Gemini
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              toolResponse: {
                functionResponses: [
                  {
                    id: callId,
                    response: {
                      result: `Reservation saved successfully for ${resName}, ${resPax} guests on ${resDate} at ${resTime}. Customer profile updated.`,
                    },
                  },
                ],
              },
            }),
          );
        }
        return;
      }

      log(`Unknown function: ${name}`);
    },
    [log],
  );

  // ── Playback engine ──
  const playNextChunk = useCallback(() => {
    if (!playbackContextRef.current || audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsAiSpeaking(false);
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
    source.onended = () => playNextChunk();
    source.start();
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

  // ── Start mic ──
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

      // Reuse pre-created AudioContext from click handler (iOS gesture fix)
      let audioCtx = audioContextRef.current;
      if (!audioCtx || audioCtx.state === "closed") {
        audioCtx = new AudioContext();
        audioContextRef.current = audioCtx;
      }
      if (audioCtx.state === "suspended") await audioCtx.resume();
      log(`Mic ready (${audioCtx.sampleRate}Hz, state: ${audioCtx.state})`);

      const sourceNode = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      sourceNode.connect(analyser);

      const processor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);
      processorRef.current = processor;

      let chunkCount = 0;
      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN || !setupCompleteRef.current)
          return;
        // Mute mic while AI is speaking to prevent echo self-interruption
        if (isPlayingRef.current) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const downsampled = downsampleBuffer(
          inputData,
          audioCtx.sampleRate,
          SEND_SAMPLE_RATE,
        );
        const pcm = floatTo16BitPCM(downsampled);
        const base64 = arrayBufferToBase64(pcm);
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

      sourceNode.connect(processor);
      processor.connect(audioCtx.destination);

      // Reuse pre-created playback context
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
    setState("connecting");
    setStatusText("Connecting...");
    setupCompleteRef.current = false;
    setDebugLog([]);

    // Pre-create AudioContexts on user gesture (iOS Safari requirement)
    // Must happen synchronously in the click handler, not in async callbacks
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
      log("Fetching token...");
      const tokenRes = await fetch("/api/songhwa-token", { method: "POST" });
      const tokenData = await tokenRes.json();

      let wsUrl: string;
      if (tokenData.token) {
        log("Got ephemeral token");
        wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${tokenData.token}`;
      } else if (tokenData.apiKey) {
        const cleanKey = tokenData.apiKey.trim();
        log("Using API key");
        wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${cleanKey}`;
      } else {
        throw new Error("No credentials returned");
      }

      log("Opening WebSocket...");
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        log("Connected, sending setup...");
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
              parts: [{ text: SONGHWA_SYSTEM_PROMPT }],
            },
            tools: [{ functionDeclarations: [RESERVATION_TOOL, LOOKUP_CUSTOMER_TOOL] }],
          },
        };
        ws.send(JSON.stringify(setupMsg));
        log("Setup sent (with reservation + customer lookup tools)");

        // Fallback: start mic after 2s if no setupComplete
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

          // Setup complete
          if (response.setupComplete !== undefined) {
            log("Setup complete!");
            if (!setupCompleteRef.current) {
              setupCompleteRef.current = true;
              startMicCapture(ws);
            }
            return;
          }

          // Function calls from AI
          if (response.toolCall) {
            log("Tool call received!");
            const functionCalls =
              response.toolCall.functionCalls || [];
            for (const fc of functionCalls) {
              handleFunctionCall(fc.name, fc.args || {}, fc.id || "");
            }
            return;
          }

          // Audio response
          if (response.serverContent?.modelTurn?.parts) {
            for (const part of response.serverContent.modelTurn.parts) {
              // Audio data
              if (part.inlineData?.data) {
                enqueueAudio(base64ToArrayBuffer(part.inlineData.data));
              }
              // Function call inside serverContent
              if (part.functionCall) {
                handleFunctionCall(
                  part.functionCall.name,
                  part.functionCall.args || {},
                  part.functionCall.id || "",
                );
              }
            }
          }

          // Turn complete
          if (response.serverContent?.turnComplete) {
            // noop
          }

          // Errors
          if (response.error) {
            log(`Error: ${JSON.stringify(response.error).slice(0, 150)}`);
            setState("error");
            setStatusText("Server error. Tap to retry.");
          }

          // Log non-audio messages (filter sessionResumptionUpdate noise)
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
  }, [log, enqueueAudio, startMicCapture, handleFunctionCall]);

  // ── Disconnect ──
  const stopSession = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    setupCompleteRef.current = false;
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
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

  const clearReservations = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setReservations([]);
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
      </div>

      {/* Mic Button */}
      <button
        onClick={state === "connected" ? stopSession : startSession}
        disabled={state === "connecting"}
        style={{
          width: 130, height: 130, borderRadius: "50%", border: "none",
          background: btnBg, cursor: state === "connecting" ? "wait" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: glow, transform: `scale(${pulseScale})`,
          transition: "transform 0.1s ease-out, box-shadow 0.2s ease",
          WebkitTapHighlightColor: "transparent",
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

      {/* ─── Reservations List ─── */}
      <div style={{ width: "100%", maxWidth: 420, marginTop: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
            Reservations ({reservations.length})
          </h2>
          {reservations.length > 0 && (
            <button
              onClick={clearReservations}
              style={{ fontSize: 11, color: "#ef4444", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}
            >
              Clear All
            </button>
          )}
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

      {/* ─── Debug Toggle ─── */}
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
