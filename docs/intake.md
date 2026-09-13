# Intake

The owner says a sentence. The platform has to turn it into a capability call
or refuse to act. That is all this layer does.

    "Update my hours. We close at 10 PM tonight."
                        |
                        v
    business.set_temporary_closure
      startsAt 2026-05-05T05:00:00Z   (the owner's Tuesday, in their zone)
      endsAt   2026-05-06T05:00:00Z
      closes   22:00
                        |
                        v
    executor -> grants -> verify -> receipt -> device fan-out

Everything after the first arrow already existed. `src/kernel/intake.js` is the
first arrow.

## Rules first, model second

`parse()` is pure. Given the same text, the same clock and the same timezone it
returns the same intent, with no model involved and no network call. A recorded
utterance can therefore be re-parsed later and compared against what the
platform did with it at the time.

A model is asked only when every rule missed, and what it returns is a
*proposal*: `intake()` will not run a model-derived intent unless the caller
passes `confirm: true`. The reason is the layer underneath — a wrong guess ends
as a real edit on a real Facebook page, which is expensive to notice and
expensive to undo. Discovery and repair are worth a model. A nightly hours
change is not.

If no model provider is bound, the fallback returns a question rather than an
error. Nothing in intake requires a model to be configured.

## It asks rather than guesses

Two refusals matter more than any rule:

| Message | Result |
| --- | --- |
| `update my hours, we close at 10` | no day named — asks which day |
| `change my hours tonight` | no time found — asks what time |

Neither executes anything. Both are recorded. This is the same posture the
device driver already takes when an appmap step cannot find its target: stop
and say so, do not pick something nearby.

## The one place it does resolve an ambiguity

A bare hour has no meridiem, and the natural reading is not symmetric — a shop
that "closes at 10" means 22:00, one that "opens at 9" means 09:00. Intake
resolves it and then records that it did:

    assumptions: ['read "10" as 22:00 (pm)']

The assumption is stored on the `intake_request` row, so a wrong reading is
visible next to the utterance that produced it instead of disappearing into a
timestamp.

## Time is resolved in the business's own zone

"Tonight" is meaningless without a clock. The zone comes from the primary
`location` row, falling back to UTC, and every date becomes an instant through
`instantOf()`, which does a two-pass offset read so a DST edge lands correctly.
The same sentence in Chicago and in UTC produces two different windows, and the
tests assert exactly that.

## A single-day change does not wipe the week

`business.set_hours` replaces every `regular_hours` row for the business. A
sentence about Fridays therefore carries the other six days with it:
`mergeIntoWeek()` reads what is there and applies the patch over it. Without
this, "on Fridays we're open 9 to 10" would leave a business open one day a
week.

Dated changes never touch the weekly pattern at all — they become a bounded
`temporary_hours` window, so the regular hours return on their own.

## What is recorded

`intake_request` (migration `db/005_intake.sql`) holds the utterance, the
channel it arrived on, the parsed intent with its assumptions, whether a rule
or a model produced it, the question asked back when nothing ran, and the
`execution_id` when something did.

A receipt proves an execution happened. This proves the execution was the one
that was asked for.

## Surface

    POST /api/b/:slug/request     { text, channel?, transcriptOf?, confirm? }
    GET  /api/b/:slug/requests

`POST /request` is `POST /invoke` reached from a sentence instead of a
capability key. It goes through the same executor, the same grants and the same
verification.

## What is not here

- **Speech to text.** `channel: 'voice'` and `transcriptOf` are the seam for it.
  Intake takes text. Whisper, or anything else, writes that text.
- **Anything beyond hours and phone.** The rules cover temporary hours, weekly
  hours, all-day closures and `contact.phone`. Every other canonical key falls
  to the model path, which proposes rather than acts.
- **Multi-location routing.** A sentence applies to the business, not to one of
  several locations.

## Tests

    npm test        # 21 tests, pg-mem only, no network
    npm run verify  # lines 11 and 12 are this layer
