# voice_openai

Fills the `voice` slot. Ported from `ghost-ai/backend-api/src/services` —
`realtime-voice.service.js` (session handling) and `ai-orchestrator.service.js`
(transcript → action), with one thing changed.

## What changed, and why it is the whole point

`ai-orchestrator.service.js` decided what a caller could say with a constant:

    export const INTENTS = {
      UPDATE_HOURS: 'update_hours',
      SEND_SMS: 'send_sms',
      ADD_SPECIAL: 'add_special',
      UPDATE_MENU_PRICE: 'update_menu_price',
      MARK_SOLD_OUT: 'mark_sold_out',
      ...
      UNKNOWN: 'unknown'
    };

Eleven things, compiled in. Install a loyalty app and voice cannot reach it.
Grant a capability and voice does not know. Write a new package and it is
invisible until somebody edits that enum and redeploys.

Here `intent()` is handed the capability list and may only choose from it. The
list comes from `policy.js` already filtered by the caller's grants, so:

- a package installed this afternoon is speakable this afternoon
- a capability the caller was never granted cannot be reached by talking
- this file names no capability, and a test fails the build if it starts to

## The contract

    transcribe({ audio, mimeType })            -> { text, durationMs }
    intent({ transcript, capabilities })       -> { capability, input, confidence, say }
    speak({ text })                            -> { audio, mimeType }
    openSession({ callId, onTranscript })      -> session      (optional)
    closeSession({ callId })                   -> { durationMs, turns }

`intent` returns `capability: null` when nothing on offer fits — that is a real
answer, not a failure, and the caller hears `say` instead of a wrong action
being taken.

## Configuration

`defaultConfig` sets the models. Anything sensitive comes from the environment:
`OPENAI_API_KEY`. No key means `transcribe` and `intent` throw a clear error
rather than silently doing nothing.
