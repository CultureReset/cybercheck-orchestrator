"""Transcription, and nothing else.

Whisper's job ends at text. What that text means is decided by
src/kernel/intent.js against a closed set of capabilities, where a wrong
reading is visible next to what it was turned into.

Keeping the two apart is why this stays debuggable: when the system does the
wrong thing you can see immediately whether it misheard or misunderstood.

Runs on CPU. small.en is real-time on an N100 with no GPU and no network, which
matters because this is a recording of a business owner in their own shop.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

from faster_whisper import WhisperModel
from fastapi import FastAPI, File, UploadFile
from pydantic import BaseModel

MODEL_SIZE = "small.en"

app = FastAPI(title="voice")
_model: WhisperModel | None = None


def model() -> WhisperModel:
    global _model
    if _model is None:
        _model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
    return _model


class Transcript(BaseModel):
    text: str
    seconds: float
    language: str
    confidence: float | None = None


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "model": MODEL_SIZE}


@app.post("/transcribe", response_model=Transcript)
async def transcribe(audio: UploadFile = File(...)) -> Transcript:
    suffix = Path(audio.filename or "clip.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as handle:
        handle.write(await audio.read())
        handle.flush()
        segments, info = model().transcribe(handle.name, beam_size=5, vad_filter=True)
        parts = list(segments)

    text = " ".join(part.text.strip() for part in parts).strip()
    # avg_logprob is per segment; the mean is a usable single number for the UI
    # to decide whether to make the owner read the confirmation more carefully.
    scores = [part.avg_logprob for part in parts if part.avg_logprob is not None]
    return Transcript(
        text=text,
        seconds=info.duration,
        language=info.language,
        confidence=sum(scores) / len(scores) if scores else None,
    )
