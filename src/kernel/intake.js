import { q, one } from '../db.js';
import { request } from './executor.js';
import { route } from './router.js';
// Natural language in, a capability call out.
//
//   "we close at 10 tonight"  ->  business.set_temporary_closure { closes: 22:00, ... }
//
// Nothing in this file executes anything. parse() is pure: the same text with
// the same clock and the same zone gives the same intent every time, so an
// intent can be replayed from the recorded utterance without a model running.
//
// Rules first, model second. A model is asked only when no rule matched, and
// what it returns is a proposal that a person confirms — never an auto-run.
// The device driver below this is expensive and hard to undo; a wrong guess
// there costs a real edit on a real Facebook page.
const CAPABILITIES = new Set([
  'business.set_temporary_closure',
  'business.set_hours',
  'business.set_fact',
]);
const WEEKDAYS = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};
// --- time and zone -----------------------------------------------------------
// "tonight" is meaningless without the business's own clock, so every date in
// here is resolved in the business timezone and stored as an instant.
function zoneOffsetMs(timeZone, at) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at).map(p => [p.type, p.value])
  );
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
  );
  return asUTC - at.getTime();
}
export function instantOf({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  // Two passes: the first offset is read at the wrong instant on a DST edge.
  const once = wall - zoneOffsetMs(timeZone, new Date(wall));
  return new Date(wall - zoneOffsetMs(timeZone, new Date(once)));
}
export function civilDate(at, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    }).formatToParts(at).map(p => [p.type, p.value])
  );
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    weekday: WEEKDAYS[parts.weekday.toLowerCase()],
  };
}
function addDays(date, n) {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
}
function nextWeekday(from, weekday) {
  return addDays(from, (weekday - from.weekday + 7) % 7);
}
const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
// A bare hour has no meridiem, and the reading is not symmetric: a shop that
// "closes at 10" means 10pm, one that "opens at 9" means 9am. We resolve it and
// then say so — the assumption rides along on the record instead of vanishing.
function resolveHour(hour, minute, meridiem, sense) {
  if (meridiem === 'am') return { time: hhmm(hour === 12 ? 0 : hour, minute), assumed: null };
  if (meridiem === 'pm') return { time: hhmm(hour === 12 ? 12 : hour + 12, minute), assumed: null };
  if (hour === 12) return { time: hhmm(12, minute), assumed: null };
  if (hour === 0 || hour > 12) return { time: hhmm(hour, minute), assumed: null };
  const pm = sense === 'closes' ? hour < 12 : hour < 6;
  if (!pm) return { time: hhmm(hour, minute), assumed: `read "${hour}" as ${hhmm(hour, minute)} (am)` };
  return { time: hhmm(hour + 12, minute), assumed: `read "${hour}" as ${hhmm(hour + 12, minute)} (pm)` };
}
const TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?`;
// The trigger regexes have to see a word time too, or "open at noon" reads as
// a sentence about nothing. namedTime() resolves whichever form matched.
const CLOCK = String.raw`(?:noon|midday|midnight|${TIME})`;
function readTime(match, sense) {
  if (!match) return null;
  const [, h, m, mer] = match;
  const meridiem = mer ? (mer[0].toLowerCase() === 'a' ? 'am' : 'pm') : null;
  return resolveHour(Number(h), Number(m ?? 0), meridiem, sense);
}
function namedTime(text, sense) {
  if (/\bnoon\b|\bmidday\b/.test(text)) return { time: '12:00', assumed: null };
  if (/\bmidnight\b/.test(text)) return { time: '00:00', assumed: null };
  const m = text.match(new RegExp(TIME));
  return readTime(m, sense);
}
// --- day resolution ----------------------------------------------------------
// Returns either a single dated day (temporary) or a recurring weekday (regular).
// "Fridays" and "every Friday" recur; "Friday" on its own means the next one.
function readDay(text, today) {
  const recurring = text.match(/\b(?:every\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s\b/)
    ?? text.match(/\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/);
  if (recurring) return { kind: 'regular', weekday: WEEKDAYS[recurring[1]] };
  if (/\b(from now on|going forward|permanently|regular hours|normal hours)\b/.test(text)) {
    const named = text.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (named) return { kind: 'regular', weekday: WEEKDAYS[named[1]] };
  }
  if (/\b(today|tonight|this evening|this afternoon|this morning)\b/.test(text)) return { kind: 'temporary', date: today };
  if (/\btomorrow\b/.test(text)) return { kind: 'temporary', date: addDays(today, 1) };
  const named = text.match(/\b(?:on\s+|this\s+|next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/);
  if (named) return { kind: 'temporary', date: nextWeekday(today, WEEKDAYS[named[1]]) };
  return null;
}
function readReason(text) {
  const m = text.match(/\bfor\s+(?:the\s+)?([a-z0-9' -]{3,40}?)\s*[.!,]?$/);
  return m ? m[1].trim() : null;
}
// --- the rules ---------------------------------------------------------------
export function parse(text, { now = new Date(), timeZone = 'UTC' } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return unclear('nothing to parse', 'What would you like to change?');
  const lower = raw.toLowerCase().replace(/\s+/g, ' ');
  const today = civilDate(now, timeZone);
  const day = readDay(lower, today);
  const assumptions = [];
  const phone = lower.match(/\b(?:phone|number|call us(?: at)?)\b[^0-9+]{0,20}(\+?[0-9][0-9().\- ]{6,18}[0-9])/);
  if (phone) {
    return {
      understood: true, source: 'rules', capability: 'business.set_fact',
      input: { key: 'contact.phone', value: normalizePhone(phone[1]) },
      assumptions, matched: 'phone',
    };
  }
  const closedAllDay = /\b(?:we(?:'re| are)? )?closed\b/.test(lower)
    && !/\bclosed?\s+(?:at|from|until|til|till)\b/.test(lower)
    && !new RegExp(String.raw`\bclos\w*\s+(?:at\s+)?${CLOCK}`).test(lower);
  const closes = lower.match(new RegExp(String.raw`\bclos(?:e|es|ing|ed)?\s*(?:up\s*)?(?:at|by)?\s*${CLOCK}`));
  const opens = lower.match(new RegExp(String.raw`\bopen(?:s|ing)?\s*(?:up\s*)?(?:at|from)?\s*${CLOCK}`));
  const range = lower.match(new RegExp(String.raw`\b${TIME}\s*(?:to|until|til|till|-|–|—)\s*${TIME}`));
  const touchesHours = closedAllDay || closes || opens || range || /\bhours\b/.test(lower);
  if (!touchesHours) {
    return unclear('no rule matched', 'I could not tell what to change. Try "we close at 10 tonight".');
  }
  if (!day) {
    return unclear('no day named',
      'Which day? "tonight", "tomorrow", or "Fridays" for every week.');
  }
  let opensAt = null, closesAt = null;
  if (range) {
    const a = readTime([null, range[1], range[2], range[3]], 'opens');
    const b = readTime([null, range[4], range[5], range[6]], 'closes');
    opensAt = a?.time ?? null; closesAt = b?.time ?? null;
    for (const x of [a, b]) if (x?.assumed) assumptions.push(x.assumed);
  } else {
    if (opens) {
      const a = namedTime(opens[0], 'opens');
      opensAt = a?.time ?? null;
      if (a?.assumed) assumptions.push(a.assumed);
    }
    if (closes) {
      const b = namedTime(closes[0], 'closes');
      closesAt = b?.time ?? null;
      if (b?.assumed) assumptions.push(b.assumed);
    }
  }
  if (!closedAllDay && !opensAt && !closesAt) {
    return unclear('hours mentioned but no time found',
      'What time? For example "we close at 10 tonight".');
  }
  if (day.kind === 'regular') {
    return {
      understood: true, source: 'rules', capability: 'business.set_hours',
      input: { days: [{ weekday: day.weekday, opens: opensAt, closes: closesAt, closed: closedAllDay }] },
      mergeWeekdays: true, assumptions, matched: closedAllDay ? 'regular-closed' : 'regular-hours',
    };
  }
  // A dated change never touches the weekly pattern. It is a window with a
  // start and an end, so the regular hours come back on their own afterwards.
  const startsAt = instantOf({ ...day.date, hour: 0, minute: 0 }, timeZone);
  const endsAt = instantOf({ ...addDays(day.date, 1), hour: 0, minute: 0 }, timeZone);
  return {
    understood: true, source: 'rules', capability: 'business.set_temporary_closure',
    input: {
      startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
      opens: opensAt, closes: closesAt, closed: closedAllDay,
      reason: readReason(lower),
    },
    assumptions, matched: closedAllDay ? 'temporary-closed' : 'temporary-hours',
  };
}
function unclear(why, question) {
  return { understood: false, source: 'rules', why, question, assumptions: [] };
}
function normalizePhone(raw) {
  const digits = raw.replace(/[^0-9+]/g, '');
  if (digits.startsWith('+')) return digits;
  return digits.length === 10 ? `+1${digits}` : digits;
}
// --- the model fallback ------------------------------------------------------
// Only reached when every rule missed. The answer is a proposal, not an action:
// intake() will not run a model-derived intent without confirm: true.
const PROMPT = `Turn the business owner's message into one JSON object and nothing else.
Allowed capability values: business.set_temporary_closure, business.set_hours, business.set_fact.
Shape: {"capability": "...", "input": {...}, "why": "one short sentence"}
Times are 24-hour "HH:MM". Weekdays are 0=Sunday..6=Saturday.
If the message does not name a change you can express, answer {"capability": null, "why": "..."}.
Message: `;
export async function propose({ ctx, text }) {
  let answer;
  try {
    const out = await route({ ctx, task: { need: 'cheap', prompt: PROMPT + JSON.stringify(String(text)) } });
    answer = JSON.parse(firstObject(out.output));
  } catch (e) {
    return unclear(`model unavailable: ${e.message}`,
      'I could not read that. Try "we close at 10 tonight".');
  }
  if (!answer?.capability || !CAPABILITIES.has(answer.capability)) {
    return unclear('model named no usable capability',
      answer?.why ? `${answer.why} Try "we close at 10 tonight".` : 'I could not read that.');
  }
  if (!answer.input || typeof answer.input !== 'object' || Array.isArray(answer.input)) {
    return unclear('model returned no input object', 'I could not read that.');
  }
  return {
    understood: true, source: 'model', capability: answer.capability, input: answer.input,
    needsConfirmation: true, why: answer.why ?? null, assumptions: [],
  };
}
// A model asked for JSON often wraps it in prose or a fence. Take the object.
function firstObject(text) {
  const s = String(text ?? '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in model output');
  return s.slice(start, end + 1);
}
// --- the entry point ---------------------------------------------------------
// Parse, record what was said, then hand the intent to the executor — which is
// what grants, verification, receipts and device fan-out already hang off.
export async function intake({ ctx, text, channel = 'text', transcriptOf = null, confirm = false, useModel = true }) {
  const timeZone = await timeZoneFor(ctx.businessId);
  let intent = parse(text, { now: new Date(), timeZone });
  if (!intent.understood && intent.why === 'no rule matched' && useModel) {
    intent = await propose({ ctx, text });
  }
  if (!intent.understood) {
    const record = await recordIntake({ ctx, channel, text, transcriptOf, intent, executionId: null });
    return { ...intent, timeZone, intakeId: record.id };
  }
  if (intent.needsConfirmation && !confirm) {
    const record = await recordIntake({ ctx, channel, text, transcriptOf, intent, executionId: null });
    return {
      ...intent, timeZone, intakeId: record.id, executed: false,
      question: 'Is this what you meant?',
    };
  }
  const input = intent.mergeWeekdays
    ? { ...intent.input, days: await mergeIntoWeek({ businessId: ctx.businessId, days: intent.input.days }) }
    : intent.input;
  const out = await request({ ctx, capability: intent.capability, input });
  const record = await recordIntake({
    ctx, channel, text, transcriptOf, intent,
    executionId: out.execution?.id ?? null,
  });
  // Awaiting approval is not executed. A grant set to 'ask' stops here, and
  // saying otherwise would make the caller report a change that has not run.
  const executed = !out.error && out.awaitingApproval !== true;
  return { ...intent, timeZone, intakeId: record.id, executed, input, ...out };
}
async function timeZoneFor(businessId) {
  const row = await one(
    `select timezone from location
      where business_id = $1 and timezone is not null
      order by is_primary desc limit 1`, [businessId]
  );
  return row?.timezone ?? 'UTC';
}
// set_hours replaces the whole week, so a one-day change has to carry the other
// six days with it or they are deleted. The patch is applied over what is there.
export async function mergeIntoWeek({ businessId, days, locationId = null }) {
  const rows = await q(
    `select weekday, opens, closes, closed from regular_hours
      where business_id = $1 and (location_id = $2 or ($2 is null and location_id is null))
      order by weekday`, [businessId, locationId]
  );
  const week = new Map(rows.map(r => [Number(r.weekday), {
    weekday: Number(r.weekday), opens: trimTime(r.opens), closes: trimTime(r.closes), closed: r.closed === true,
  }]));
  for (const d of days) week.set(Number(d.weekday), { ...d, weekday: Number(d.weekday) });
  return [...week.values()].sort((a, b) => a.weekday - b.weekday);
}
function trimTime(value) {
  if (value === null || value === undefined) return null;
  const s = String(value);
  return s.length >= 5 ? s.slice(0, 5) : s;
}
async function recordIntake({ ctx, channel, text, transcriptOf, intent, executionId }) {
  const { understood, question = null, source = null, ...rest } = intent;
  return one(
    `insert into intake_request
       (business_id, person_id, channel, utterance, transcript_of, parsed, source, understood, question, execution_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [ctx.businessId, ctx.person?.id ?? null, channel, String(text ?? ''), transcriptOf,
     JSON.stringify(rest), source, understood === true, question, executionId]
  );
}
export async function history(businessId, limit = 50) {
  return q(
    `select id, channel, utterance, source, understood, question, execution_id, created_at
       from intake_request where business_id = $1 order by created_at desc limit ${Number(limit)}`,
    [businessId]
  );
}
