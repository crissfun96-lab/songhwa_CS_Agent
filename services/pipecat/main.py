"""
Foxie Pipecat orchestrator — multi-channel voice agent with provider failover.

Replaces both:
  - services/ws-proxy (web browser → Gemini Live)
  - direct Vapi integration (Twilio phone → Gemini)

Architecture:
  Client (browser/phone) → LiveKit transport → Pipecat pipeline:
    Mic → VAD → STT (Mesolitica/Deepgram) → LLM (Gemini/OpenAI fallback)
    → TTS (Cartesia/ElevenLabs) → Speaker
  Tools call the Next.js app via HTTP — same 14 endpoints as web voice + WA.

Deploy: see services/pipecat/README.md for fly.io deployment.
"""
from __future__ import annotations
import asyncio
import os
import logging
import json
from typing import Any
import aiohttp

from pipecat.frames.frames import LLMMessagesFrame, TextFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineTask
from pipecat.processors.aggregators.llm_response import LLMUserResponseAggregator
from pipecat.services.deepgram import DeepgramSTTService
from pipecat.services.cartesia import CartesiaTTSService
from pipecat.services.google import GoogleLLMService
from pipecat.transports.network.fastapi_websocket import FastAPIWebsocketTransport, FastAPIWebsocketParams
from fastapi import FastAPI, WebSocket

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("foxie.pipecat")

APP_BASE_URL = os.environ.get("APP_BASE_URL", "https://songhwa-cs-agent.vercel.app")
TENANT_ID = os.environ.get("TENANT_ID", "songhwa")


async def fetch_tenant_config() -> dict[str, Any]:
    """Pull system prompt + tools from the Next.js app — same source as web voice."""
    async with aiohttp.ClientSession() as session:
        async with session.get(
            f"{APP_BASE_URL}/api/menu/config",
            headers={"X-Foxie-Tenant": TENANT_ID},
        ) as resp:
            data = await resp.json()
            return data["data"]


async def call_tool(name: str, args: dict, session_id: str) -> Any:
    """Server-side tool execution — calls the same endpoints as web voice."""
    async with aiohttp.ClientSession() as session:
        # Map tool name → endpoint (same pattern as src/lib/whatsapp/dispatcher.ts)
        if name == "get_business_status":
            async with session.get(f"{APP_BASE_URL}/api/business/status") as r:
                return (await r.json()).get("data", {})
        elif name == "search_menu":
            async with session.get(f"{APP_BASE_URL}/api/menu/search?q={args.get('query', '')}") as r:
                return (await r.json()).get("data", {})
        elif name == "create_reservation":
            headers = {"Content-Type": "application/json", "Origin": APP_BASE_URL}
            payload = {
                "sessionId": session_id,
                "name": args.get("name", ""),
                "phone": args.get("phone", ""),
                "date": args.get("date", ""),
                "time": args.get("time", ""),
                "pax": int(args.get("pax", 0)),
                "menuChoice": args.get("menu_choice", ""),
                "remarks": args.get("remarks", ""),
            }
            async with session.post(f"{APP_BASE_URL}/api/reservations", json=payload, headers=headers) as r:
                j = await r.json()
                return {"saved": j.get("success", False), **j}
        # ... add the remaining 12 tools using the same pattern as src/app/api/vapi/route.ts
        else:
            return {"error": f"Tool not yet implemented in Pipecat: {name}"}


async def run_session(websocket: WebSocket, session_id: str):
    """Per-call pipeline. Failover handled by Pipecat's FallbackAdapter if added."""
    config = await fetch_tenant_config()
    system_prompt = config["systemPrompt"]
    tools_decl = config["tools"]

    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            vad_enabled=True,
        ),
    )

    # Primary: Deepgram Nova-3 multilingual
    stt = DeepgramSTTService(api_key=os.environ["DEEPGRAM_API_KEY"], language="multi")

    # Primary: Gemini 2.0 Flash. Add FallbackAdapter to swap to OpenAI if Gemini errors.
    llm = GoogleLLMService(api_key=os.environ["GEMINI_API_KEY"], model="gemini-2.0-flash")

    # Primary: Cartesia Sonic-2 (low latency, multilingual)
    tts = CartesiaTTSService(
        api_key=os.environ["CARTESIA_API_KEY"],
        voice_id="729651dc-c6c3-4ee5-97fa-350da1f88600",
    )

    # System prompt + tool registration
    llm.register_function(None, lambda *args, **kw: call_tool(*args, **kw, session_id=session_id))
    # In a full implementation, iterate `tools_decl` and register each by name.

    # Pipeline: mic → STT → LLM → TTS → speaker
    pipeline = Pipeline([transport.input(), stt, llm, tts, transport.output()])
    task = PipelineTask(pipeline)
    runner = PipelineRunner()

    # Seed system message
    await task.queue_frames([LLMMessagesFrame([{"role": "system", "content": system_prompt}])])

    await runner.run(task)


app = FastAPI()


@app.get("/health")
async def health():
    return {"ok": True, "service": "foxie-pipecat", "tenant": TENANT_ID}


@app.websocket("/voice")
async def voice(websocket: WebSocket):
    await websocket.accept()
    session_id = f"pipecat_{websocket.headers.get('x-call-id', 'unknown')}"
    try:
        await run_session(websocket, session_id)
    except Exception as e:
        logger.exception("Session failed: %s", e)
        await websocket.close(code=1011)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
