"""
Foxie Pipecat orchestrator — multi-channel voice agent with provider failover.

Replaces both:
  - services/ws-proxy (web browser → Gemini Live)
  - direct Vapi integration (Twilio phone → Gemini)

Architecture:
  Client (browser/phone) → LiveKit transport → Pipecat pipeline:
    Mic → VAD → STT (Deepgram) → LLM (Gemini primary, OpenAI fallback)
    → TTS (Cartesia) → Speaker
  Tools call the Next.js app via HTTP — same 14 endpoints as web voice + WA.

All internal HTTP calls forward `X-Foxie-Tenant: <TENANT_ID>` plus
`X-Foxie-Internal-Secret: $FOXIE_INTERNAL_SECRET` so `resolveTenantId()`
on the receiving Next.js app honors the tenant context — matching how the
Vapi bridge and the WhatsApp dispatcher propagate tenancy.

Deploy: see services/pipecat/README.md for fly.io deployment.

Environment:
  Required:
    APP_BASE_URL         Next.js deployment (e.g. https://songhwa-cs-agent.vercel.app)
    DEEPGRAM_API_KEY     STT primary
    CARTESIA_API_KEY     TTS primary
    GEMINI_API_KEY       LLM primary
  Optional:
    TENANT_ID            Defaults to "songhwa"
    FOXIE_INTERNAL_SECRET   Required if calling routes that resolve tenant via header
    OPENAI_API_KEY       LLM fallback (init-time failover if Gemini unavailable)
    CARTESIA_VOICE_ID    Default Cartesia voice
    PORT                 Defaults to 8080
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any
from urllib.parse import quote

import aiohttp
from fastapi import FastAPI, WebSocket
from pipecat.frames.frames import LLMMessagesFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineTask
from pipecat.services.cartesia import CartesiaTTSService
from pipecat.services.deepgram import DeepgramSTTService
from pipecat.services.google import GoogleLLMService
from pipecat.transports.network.fastapi_websocket import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("foxie.pipecat")

APP_BASE_URL = os.environ.get(
    "APP_BASE_URL", "https://songhwa-cs-agent.vercel.app"
).rstrip("/")
TENANT_ID = os.environ.get("TENANT_ID", "songhwa")
INTERNAL_SECRET = os.environ.get("FOXIE_INTERNAL_SECRET", "").strip()


# ── Internal-call helpers ───────────────────────────────────────────


def _internal_headers() -> dict[str, str]:
    """Headers for internal-call propagation — tenant context + secret."""
    headers = {
        "Content-Type": "application/json",
        "Origin": APP_BASE_URL,
        "User-Agent": f"foxie-pipecat/{TENANT_ID}",
        "X-Foxie-Tenant": TENANT_ID,
    }
    if INTERNAL_SECRET:
        headers["X-Foxie-Internal-Secret"] = INTERNAL_SECRET
    return headers


async def _get(path: str) -> dict[str, Any]:
    async with aiohttp.ClientSession() as session:
        async with session.get(
            f"{APP_BASE_URL}{path}", headers=_internal_headers()
        ) as r:
            return await r.json()


async def _post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{APP_BASE_URL}{path}", headers=_internal_headers(), json=body
        ) as r:
            return await r.json()


async def _patch(path: str, body: dict[str, Any]) -> dict[str, Any]:
    async with aiohttp.ClientSession() as session:
        async with session.patch(
            f"{APP_BASE_URL}{path}", headers=_internal_headers(), json=body
        ) as r:
            return await r.json()


async def _delete(path: str, body: dict[str, Any]) -> dict[str, Any]:
    async with aiohttp.ClientSession() as session:
        async with session.delete(
            f"{APP_BASE_URL}{path}", headers=_internal_headers(), json=body
        ) as r:
            return await r.json()


def _enc(value: Any) -> str:
    return quote(str(value), safe="")


# ── Tool dispatch ────────────────────────────────────────────────────


async def fetch_tenant_config() -> dict[str, Any]:
    """Pull system prompt + tool declarations from Next.js — same source as web voice."""
    j = await _get("/api/menu/config")
    return j.get("data", {})


async def call_tool(
    name: str, args: dict[str, Any], session_id: str
) -> dict[str, Any]:
    """
    Server-side tool dispatch. Mirrors src/app/api/vapi/route.ts so all
    channels (web, phone via Vapi, phone via Pipecat, WA) use the same logic.
    """
    try:
        if name == "lookup_customer":
            phone = str(args.get("phone", ""))
            if phone:
                qs = f"phone={_enc(phone)}"
            else:
                qs = f"name={_enc(args.get('name', ''))}"
            j = await _get(f"/api/customers?{qs}")
            return j.get("data", {"found": False})

        if name == "get_business_status":
            j = await _get("/api/business/status")
            return j.get("data", {})

        if name == "search_menu":
            j = await _get(f"/api/menu/search?q={_enc(args.get('query', ''))}")
            return j.get("data", {"results": []})

        if name == "get_dish_details":
            j = await _get(f"/api/menu/dish?id={_enc(args.get('id', ''))}")
            return j.get("data", {"error": "not_found"})

        if name == "get_active_promos":
            j = await _get("/api/menu/promos")
            return {"promos": j.get("data", [])}

        if name == "check_allergens":
            j = await _get(f"/api/menu/allergens?id={_enc(args.get('id', ''))}")
            return j.get("data", {})

        if name == "check_availability":
            url = (
                f"/api/availability"
                f"?date={_enc(args.get('date'))}"
                f"&time={_enc(args.get('time'))}"
                f"&pax={_enc(args.get('pax'))}"
            )
            j = await _get(url)
            return j.get("data", {})

        if name == "save_reservation_draft":
            j = await _post(
                "/api/reservations/draft",
                {
                    "sessionId": session_id,
                    "name": args.get("name"),
                    "phone": args.get("phone"),
                    "date": args.get("date"),
                    "time": args.get("time"),
                    "pax": args.get("pax"),
                    "menuChoice": args.get("menu_choice"),
                    "remarks": args.get("remarks"),
                },
            )
            return j.get("data", {"saved": False})

        if name == "find_reservation":
            phone = _enc(args.get("phone", ""))
            date_q = f"&date={_enc(args['date'])}" if args.get("date") else ""
            j = await _get(f"/api/reservations/find?phone={phone}{date_q}")
            return {
                "count": j.get("count", 0),
                "reservations": j.get("data", []),
            }

        if name == "create_reservation":
            payload = {
                "sessionId": session_id,
                "name": str(args.get("name", "")),
                "phone": str(args.get("phone", "")),
                "date": str(args.get("date", "")),
                "time": str(args.get("time", "")),
                "pax": int(args.get("pax", 0) or 0),
                "menuChoice": str(args.get("menu_choice", "")),
                "remarks": str(args.get("remarks", "")),
            }
            j = await _post("/api/reservations", payload)
            if j.get("success"):
                return {
                    "saved": True,
                    "message": (
                        f"Booking confirmed for {payload['name']}, "
                        f"{payload['pax']} pax on {payload['date']} at "
                        f"{payload['time']}. Staff notified."
                    ),
                }
            return {"saved": False, **j}

        if name == "update_reservation":
            id_ = str(args.get("id", ""))
            payload: dict[str, Any] = {"sessionId": session_id}
            for key in ("phone", "date", "time", "pax", "reason"):
                if args.get(key) is not None:
                    payload[key] = args[key]
            if args.get("menu_choice") is not None:
                payload["menuChoice"] = args["menu_choice"]
            if args.get("remarks") is not None:
                payload["remarks"] = args["remarks"]
            return await _patch(f"/api/reservations/{_enc(id_)}", payload)

        if name == "cancel_reservation":
            id_ = str(args.get("id", ""))
            return await _delete(
                f"/api/reservations/{_enc(id_)}",
                {
                    "sessionId": session_id,
                    "phone": args.get("phone"),
                    "reason": args.get("reason"),
                },
            )

        if name == "file_complaint":
            j = await _post("/api/complaints", args)
            return j.get("data", {"filed": False})

        if name == "request_human_callback":
            j = await _post("/api/callbacks", args)
            return j.get("data", {"queued": False})

        if name == "request_human_handoff":
            payload = {**args, "channel": "phone", "vapiCallId": session_id}
            j = await _post("/api/handoff", payload)
            return j.get("data", {"handoff_failed": True})

        return {"error": f"Unknown tool: {name}"}

    except aiohttp.ClientError as exc:
        logger.exception("Tool %s network error: %s", name, exc)
        return {"error": f"network_error: {exc}"}
    except Exception as exc:
        logger.exception("Tool %s failed: %s", name, exc)
        return {"error": str(exc)[:200]}


# ── LLM provider failover ──────────────────────────────────────────


def build_llm_with_fallback() -> Any:
    """
    Build LLM service with init-time provider failover.

    Primary: Gemini 2.0 Flash.
    Fallback: OpenAI gpt-4o-mini if OPENAI_API_KEY is set.

    Init-time failover catches the common case (key missing or rotated).
    Runtime failover (mid-call provider switch) is a future enhancement —
    requires wrapping LLMService in a state-machine that detects errors and
    re-routes the next turn. Tracked in docs/plans/.
    """
    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
    openai_key = os.environ.get("OPENAI_API_KEY", "").strip()

    if gemini_key:
        try:
            logger.info("LLM: using Gemini 2.0 Flash (primary)")
            return GoogleLLMService(api_key=gemini_key, model="gemini-2.0-flash")
        except Exception as exc:
            logger.warning("Gemini init failed (%s) — trying OpenAI fallback", exc)

    if openai_key:
        # Import here so projects without OpenAI installed don't fail import-time
        from pipecat.services.openai import OpenAILLMService

        logger.info("LLM: using OpenAI gpt-4o-mini (fallback)")
        return OpenAILLMService(api_key=openai_key, model="gpt-4o-mini")

    raise RuntimeError(
        "No LLM provider configured. Set GEMINI_API_KEY (preferred) "
        "or OPENAI_API_KEY in environment."
    )


# ── Pipeline ──────────────────────────────────────────────────────


async def run_session(websocket: WebSocket, session_id: str) -> None:
    """Per-call pipeline. STT → LLM → TTS with provider failover at init."""
    config = await fetch_tenant_config()
    system_prompt: str = config.get("systemPrompt", "")
    tools_decl: list[dict[str, Any]] = config.get("tools", [])

    logger.info(
        "Session %s starting (tenant=%s, tools=%d, prompt=%d chars)",
        session_id, TENANT_ID, len(tools_decl), len(system_prompt),
    )

    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            vad_enabled=True,
        ),
    )

    stt = DeepgramSTTService(
        api_key=os.environ["DEEPGRAM_API_KEY"], language="multi"
    )

    llm = build_llm_with_fallback()

    tts = CartesiaTTSService(
        api_key=os.environ["CARTESIA_API_KEY"],
        voice_id=os.environ.get(
            "CARTESIA_VOICE_ID", "729651dc-c6c3-4ee5-97fa-350da1f88600"
        ),
    )

    # Register each declared tool by name. The handler closes over the
    # tool name + session_id so the LLM can call them transparently.
    for tool in tools_decl:
        tool_name = tool.get("name")
        if not tool_name:
            continue

        async def handler(params: Any, _name: str = tool_name) -> dict[str, Any]:
            args = getattr(params, "arguments", {}) or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except json.JSONDecodeError:
                    args = {}
            return await call_tool(_name, args, session_id)

        llm.register_function(tool_name, handler)

    pipeline = Pipeline([
        transport.input(),
        stt,
        llm,
        tts,
        transport.output(),
    ])

    task = PipelineTask(pipeline)
    runner = PipelineRunner()

    if system_prompt:
        await task.queue_frames([
            LLMMessagesFrame([{"role": "system", "content": system_prompt}])
        ])

    await runner.run(task)


# ── FastAPI app ───────────────────────────────────────────────────


app = FastAPI(title="Foxie Pipecat Orchestrator")


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "service": "foxie-pipecat", "tenant": TENANT_ID}


@app.websocket("/voice")
async def voice(websocket: WebSocket) -> None:
    await websocket.accept()
    session_id = (
        f"pipecat_{websocket.headers.get('x-call-id', 'unknown')}"
    )
    try:
        await run_session(websocket, session_id)
    except Exception as exc:
        logger.exception("Session failed: %s", exc)
        await websocket.close(code=1011)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080"))
    )
