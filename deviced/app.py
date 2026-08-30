"""deviced — the one process that owns the phone.

Everything above this speaks in steps. This is where a step becomes a touch on
real glass. It exists as a separate service for two reasons: the mature
accessibility-tree tooling is Python, and a phone is a single serialised
resource that needs exactly one owner, or two runs collide on the same screen.

It never accepts a coordinate. A selector is resolved through the ladder
resource-id -> content-desc -> text, most durable first, and the caller is told
which rung matched so a later repair knows which identifier the app moved.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from typing import Any

import uiautomator2 as u2
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="deviced")

# One lock per serial. Two runs may not drive the same screen at once; without
# this a fan-out to four apps interleaves taps and writes garbage everywhere.
_devices: dict[str, u2.Device] = {}
_locks: dict[str, asyncio.Lock] = {}

LADDER = ("id", "desc", "text")
_SELECTOR_KEY = {"id": "resourceId", "desc": "description", "text": "text"}


def device(serial: str) -> u2.Device:
    if not serial:
        raise HTTPException(400, "no serial given")
    if serial not in _devices:
        try:
            _devices[serial] = u2.connect(serial)
        except Exception as exc:
            raise HTTPException(503, f"cannot reach {serial}: {exc}") from exc
    return _devices[serial]


def lock(serial: str) -> asyncio.Lock:
    return _locks.setdefault(serial, asyncio.Lock())


# --- selectors ---------------------------------------------------------------

class Selector(BaseModel):
    id: str | None = None
    desc: str | None = None
    text: str | None = None
    cls: str | None = None

    def rungs(self) -> list[tuple[str, str]]:
        return [(by, getattr(self, by)) for by in LADDER if getattr(self, by)]


def locate(dev: u2.Device, selector: Selector, timeout_ms: int, by: str | None = None):
    """Walk the ladder. Returns (rung, element) or (None, None).

    A rung that matches is returned by name so the caller can record which of
    the three identifiers is still good. When one of them stops matching and
    the others still do, that is a rename, and the repair is one field."""
    rungs = selector.rungs()
    if by:
        rungs = [r for r in rungs if r[0] == by] or rungs
    if not rungs:
        return None, None
    deadline = time.monotonic() + timeout_ms / 1000
    while True:
        for rung, value in rungs:
            element = dev(**{_SELECTOR_KEY[rung]: value})
            if element.exists:
                return rung, element
        if time.monotonic() >= deadline:
            return None, None
        time.sleep(0.25)


# --- the screen fingerprint --------------------------------------------------

def hierarchy(dev: u2.Device) -> str:
    return dev.dump_hierarchy(compressed=False)


def resource_ids(xml: str) -> list[str]:
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return []
    ids = {
        node.attrib.get("resource-id", "")
        for node in root.iter()
    }
    ids.discard("")
    return sorted(ids)


def fingerprint_of(xml: str) -> str:
    """The identity of a screen: the sorted set of resource-ids on it.

    Ids, not text — text changes with the data (a shop's own name, today's
    date) and would make every screen unique. Ids change when the app's layout
    changes, which is exactly the event worth stopping for."""
    ids = resource_ids(xml)
    return hashlib.sha256("|".join(ids).encode()).hexdigest()[:16]


# --- request bodies ----------------------------------------------------------

class Base(BaseModel):
    serial: str

class Find(Base):
    selector: Selector
    timeout_ms: int = 8000
    by: str | None = None

class Tap(Base):
    selector: Selector
    by: str | None = None

class Type(Tap):
    text: str

class Open(Base):
    package: str
    timeout_ms: int = 8000


# --- routes ------------------------------------------------------------------

@app.get("/health")
async def health(serial: str) -> dict[str, Any]:
    dev = device(serial)
    info = dev.info
    try:
        battery = int(dev.shell("dumpsys battery | grep level").output.split(":")[-1].strip())
    except Exception:
        battery = None
    return {
        "ok": True,
        "serial": serial,
        "android_version": info.get("version"),
        "screen_on": info.get("screenOn"),
        "battery_level": battery,
    }


@app.post("/prepare")
async def prepare(body: Base) -> dict[str, Any]:
    """Settings that are automation stability, not cosmetics.

    Animations are the single largest source of flaky timing failures, and a
    dark screen fails every step there is."""
    dev = device(body.serial)
    async with lock(body.serial):
        for setting in (
            "settings put global window_animation_scale 0",
            "settings put global transition_animation_scale 0",
            "settings put global animator_duration_scale 0",
            "settings put global stay_on_while_plugged_in 7",
            "settings put system screen_off_timeout 1800000",
        ):
            dev.shell(setting)
        dev.screen_on()
    return {"prepared": True, "serial": body.serial}


@app.post("/fingerprint")
async def fingerprint(body: Base) -> dict[str, Any]:
    dev = device(body.serial)
    async with lock(body.serial):
        xml = hierarchy(dev)
    return {"fingerprint": fingerprint_of(xml), "ids": resource_ids(xml)}


@app.post("/open")
async def open_app(body: Open) -> dict[str, Any]:
    dev = device(body.serial)
    async with lock(body.serial):
        try:
            dev.app_start(body.package, wait=True, stop=False)
        except Exception as exc:
            return {"opened": False, "reason": str(exc)}
        deadline = time.monotonic() + body.timeout_ms / 1000
        while time.monotonic() < deadline:
            if dev.app_current().get("package") == body.package:
                break
            time.sleep(0.25)
        else:
            return {"opened": False, "reason": f"{body.package} did not come to the foreground"}
        xml = hierarchy(dev)
    challenge = challenge_in(xml)
    return {
        "opened": True,
        "fingerprint": fingerprint_of(xml),
        "challenge": challenge,
    }


@app.post("/find")
async def find(body: Find) -> dict[str, Any]:
    dev = device(body.serial)
    async with lock(body.serial):
        rung, element = locate(dev, body.selector, body.timeout_ms, body.by)
        xml = hierarchy(dev)
    if rung is None:
        return {
            "found": False,
            "fingerprint": fingerprint_of(xml),
            "tried": [{"by": b, "value": v} for b, v in body.selector.rungs()],
            "challenge": challenge_in(xml),
        }
    return {"found": True, "by": rung, "fingerprint": fingerprint_of(xml)}


@app.post("/tap")
async def tap(body: Tap) -> dict[str, Any]:
    dev = device(body.serial)
    async with lock(body.serial):
        rung, element = locate(dev, body.selector, 4000, body.by)
        if rung is None:
            raise HTTPException(404, f"nothing matching {body.selector.rungs()}")
        element.click()
    return {"tapped": True, "by": rung}


@app.post("/type")
async def type_text(body: Type) -> dict[str, Any]:
    dev = device(body.serial)
    async with lock(body.serial):
        rung, element = locate(dev, body.selector, 4000, body.by)
        if rung is None:
            raise HTTPException(404, f"nothing matching {body.selector.rungs()}")
        element.click()
        element.clear_text()
        element.set_text(body.text)
    return {"typed": True, "by": rung}


@app.post("/read")
async def read(body: Tap) -> dict[str, Any]:
    """Read a value back off the screen.

    This is the half of the map that makes verification possible. A write is not
    believed until this returns what was meant to be there."""
    dev = device(body.serial)
    async with lock(body.serial):
        rung, element = locate(dev, body.selector, 4000, body.by)
        if rung is None:
            raise HTTPException(404, f"nothing matching {body.selector.rungs()}")
        info = element.info
    value = info.get("text") or info.get("contentDescription") or ""
    return {"value": value, "by": rung}


@app.post("/back")
async def back(body: Base) -> dict[str, Any]:
    dev = device(body.serial)
    async with lock(body.serial):
        dev.press("back")
    return {"back": True}


@app.post("/screenshot")
async def screenshot(body: Base) -> dict[str, Any]:
    dev = device(body.serial)
    async with lock(body.serial):
        raw = dev.screenshot(format="raw")
        xml = hierarchy(dev)
        current = dev.app_current()
    return {
        "app": current.get("package"),
        "activity": current.get("activity"),
        "fingerprint": fingerprint_of(xml),
        "ids": resource_ids(xml),
        "png_base64": base64.b64encode(raw).decode(),
        "challenge": challenge_in(xml),
    }


@app.post("/packages")
async def packages(body: Base) -> dict[str, Any]:
    """Which build of each app is actually on the phone.

    A versionCode that moved invalidates every map for that package. This is the
    most common way a working system starts quietly writing wrong data: the app
    updated itself overnight and nobody was told."""
    dev = device(body.serial)
    out = []
    async with lock(body.serial):
        listed = dev.app_list()
        for package in listed:
            try:
                info = dev.app_info(package)
            except Exception:
                continue
            out.append({
                "package": package,
                "version_code": str(info.get("versionCode", "")),
                "version_name": info.get("versionName"),
            })
    return {"packages": out}


# --- challenges --------------------------------------------------------------

CHALLENGE_MARKS = (
    "verify it's you", "verify its you", "two-factor", "2-step verification",
    "enter the code", "confirm your identity", "unusual activity",
    "i'm not a robot", "captcha", "session expired", "sign in to continue",
)

def challenge_in(xml: str) -> str | None:
    """A logged-in session that gets challenged cannot be recovered by
    automation. Detecting it explicitly is what turns a mystery failure into a
    parked job and a message to the owner, who can take over through the
    mirror on the same device, with the same session."""
    haystack = re.sub(r"\s+", " ", xml).lower()
    for mark in CHALLENGE_MARKS:
        if mark in haystack:
            return mark
    return None
