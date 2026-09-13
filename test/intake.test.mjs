import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parse, civilDate, instantOf } from '../src/kernel/intake.js';
// A fixed clock, so "tonight" means the same thing on every run.
// 2026-05-05T18:30:00Z is Tuesday evening in Chicago (13:30 CDT).
const NOW = new Date('2026-05-05T18:30:00Z');
const CHICAGO = 'America/Chicago';
const at = (text, timeZone = CHICAGO) => parse(text, { now: NOW, timeZone });
test('the worked example: a spoken hours change for tonight', () => {
  const out = at('Update my hours. We close at 10 PM tonight.');
  assert.equal(out.understood, true);
  assert.equal(out.source, 'rules');
  assert.equal(out.capability, 'business.set_temporary_closure');
  assert.equal(out.input.closes, '22:00');
  assert.equal(out.input.closed, false);
  assert.equal(out.input.opens, null);
  // The window is the business's own Tuesday, not a UTC day.
  assert.equal(out.input.startsAt, '2026-05-05T05:00:00.000Z');
  assert.equal(out.input.endsAt, '2026-05-06T05:00:00.000Z');
});
test('a bare hour resolves and says that it did', () => {
  const out = at('we close at 10 tonight');
  assert.equal(out.input.closes, '22:00');
  assert.deepEqual(out.assumptions, ['read "10" as 22:00 (pm)']);
});
test('an explicit meridiem assumes nothing', () => {
  assert.deepEqual(at('we close at 10pm tonight').assumptions, []);
  assert.equal(at('we open at 6 a.m. tomorrow').input.opens, '06:00');
});
test('the same words in another timezone are another instant', () => {
  const chicago = at('we close at 10 tonight').input.startsAt;
  const utc = at('we close at 10 tonight', 'UTC').input.startsAt;
  assert.notEqual(chicago, utc);
  assert.equal(utc, '2026-05-05T00:00:00.000Z');
});
test('tomorrow is the next day in the business timezone', () => {
  const out = at('we open at 9 tomorrow');
  assert.equal(out.input.opens, '09:00');
  assert.equal(out.input.startsAt, '2026-05-06T05:00:00.000Z');
});
test('closed all day carries its reason and no times', () => {
  const out = at("we're closed Monday for the holiday");
  assert.equal(out.capability, 'business.set_temporary_closure');
  assert.equal(out.input.closed, true);
  assert.equal(out.input.opens, null);
  assert.equal(out.input.closes, null);
  assert.equal(out.input.reason, 'holiday');
  // Monday after Tuesday 2026-05-05 is 2026-05-11.
  assert.equal(out.input.startsAt, '2026-05-11T05:00:00.000Z');
});
test('a plural weekday is the weekly pattern, not one date', () => {
  const out = at("on Fridays we're open 9 to 10");
  assert.equal(out.capability, 'business.set_hours');
  assert.equal(out.mergeWeekdays, true);
  assert.deepEqual(out.input.days, [{ weekday: 5, opens: '09:00', closes: '22:00', closed: false }]);
});
test('"every Monday" is also the weekly pattern', () => {
  assert.equal(at('every Monday we close at 8').input.days[0].weekday, 1);
});
test('noon and midnight are times', () => {
  assert.equal(at('we open at noon tomorrow').input.opens, '12:00');
  assert.equal(at('we close at midnight tonight').input.closes, '00:00');
});
test('a missing day is a question, never a guess', () => {
  const out = at('update my hours, we close at 10');
  assert.equal(out.understood, false);
  assert.equal(out.why, 'no day named');
  assert.match(out.question, /Which day/);
  assert.equal(out.capability, undefined);
});
test('a missing time is a question, never a guess', () => {
  const out = at('change my hours tonight');
  assert.equal(out.understood, false);
  assert.equal(out.why, 'hours mentioned but no time found');
});
test('an unrelated message matches no rule', () => {
  const out = at('how did we do last weekend');
  assert.equal(out.understood, false);
  assert.equal(out.why, 'no rule matched');
});
test('empty input is not an intent', () => {
  assert.equal(parse('').understood, false);
  assert.equal(parse(null).understood, false);
});
test('a phone number becomes a canonical fact', () => {
  const out = at('our phone number is (251) 555-0134');
  assert.equal(out.capability, 'business.set_fact');
  assert.deepEqual(out.input, { key: 'contact.phone', value: '+12515550134' });
});
test('civilDate and instantOf agree across a DST boundary', () => {
  // 2026-03-08 is the US spring-forward. Midnight local is still 06:00Z.
  const before = instantOf({ year: 2026, month: 3, day: 7, hour: 0 }, CHICAGO);
  const after = instantOf({ year: 2026, month: 3, day: 9, hour: 0 }, CHICAGO);
  assert.equal(before.toISOString(), '2026-03-07T06:00:00.000Z');
  assert.equal(after.toISOString(), '2026-03-09T05:00:00.000Z');
  assert.equal(civilDate(NOW, CHICAGO).weekday, 2);
});
// --- against a real database -------------------------------------------------
test('intake runs the capability and records what was said', async (t) => {
  const db = await import('../src/db.js');
  await import('../src/kernel/canonical.js');
  const { intake, mergeIntoWeek, history } = await import('../src/kernel/intake.js');
  const { grant } = await import('../src/kernel/policy.js');
  await db.connect({ schemaDir: path.resolve('db') });
  const biz = await db.one(`insert into business (slug, display_name) values ('intake-co','Intake Co') returning *`);
  const person = await db.one(`insert into person (email, display_name) values ('o@intake.co','Owner') returning *`);
  const mem = await db.one(
    `insert into membership (person_id, business_id, role) values ($1,$2,'owner') returning *`,
    [person.id, biz.id]);
  await db.one(
    `insert into location (business_id, label, timezone, is_primary) values ($1,'Main',$2,true) returning *`,
    [biz.id, CHICAGO]);
  for (const cap of ['business.set_temporary_closure', 'business.set_hours', 'business.set_fact']) {
    await grant({ businessId: biz.id, role: 'owner', capability: cap, disposition: 'auto' });
  }
  const ctx = { businessId: biz.id, business: biz, person, membership: mem };
  await t.test('a understood request executes and verifies', async () => {
    const out = await intake({ ctx, text: 'Update my hours. We close at 10 PM tonight.' });
    assert.equal(out.understood, true);
    assert.equal(out.executed, true);
    assert.equal(out.execution.state, 'succeeded');
    assert.equal(out.verification, 'verified');
    assert.equal(out.timeZone, CHICAGO);
    const row = await db.one(`select * from temporary_hours where business_id = $1`, [biz.id]);
    assert.equal(String(row.closes).slice(0, 5), '22:00');
    assert.equal(row.closed, false);
  });
  await t.test('an unclear request executes nothing and still leaves a record', async () => {
    const before = await db.q(`select id from execution where business_id = $1`, [biz.id]);
    const out = await intake({ ctx, text: 'we close at 10', useModel: false });
    assert.equal(out.understood, false);
    assert.ok(out.intakeId);
    const after = await db.q(`select id from execution where business_id = $1`, [biz.id]);
    assert.equal(after.length, before.length);
    const record = await db.one(`select * from intake_request where id = $1`, [out.intakeId]);
    assert.equal(record.understood, false);
    assert.equal(record.execution_id, null);
    assert.equal(record.utterance, 'we close at 10');
  });
  await t.test('the utterance is kept beside the execution it caused', async () => {
    const rows = await history(biz.id);
    const understood = rows.find(r => r.understood === true);
    assert.ok(understood.execution_id, 'an understood intake points at its execution');
    assert.match(understood.utterance, /close at 10 PM tonight/);
  });
  await t.test('a grant set to ask stops before executing', async () => {
    const other = await db.one(`insert into business (slug, display_name) values ('ask-co','Ask Co') returning *`);
    const askMem = await db.one(
      `insert into membership (person_id, business_id, role) values ($1,$2,'owner') returning *`,
      [person.id, other.id]);
    await grant({ businessId: other.id, role: 'owner', capability: 'business.set_temporary_closure', disposition: 'ask' });
    const askCtx = { businessId: other.id, business: other, person, membership: askMem };
    const out = await intake({ ctx: askCtx, text: 'we close at 9 tomorrow' });
    assert.equal(out.understood, true);
    assert.equal(out.awaitingApproval, true);
    assert.equal(out.executed, false, 'awaiting approval is not executed');
    const rows = await db.q(`select * from temporary_hours where business_id = $1`, [other.id]);
    assert.equal(rows.length, 0, 'nothing was written before the approval');
  });
  await t.test('a one-day change keeps the other six days', async () => {
    for (let weekday = 0; weekday < 7; weekday++) {
      await db.one(
        `insert into regular_hours (business_id, weekday, opens, closes, closed)
         values ($1,$2,'08:00','17:00',false) returning *`, [biz.id, weekday]);
    }
    const merged = await mergeIntoWeek({ businessId: biz.id, days: [{ weekday: 5, opens: '09:00', closes: '22:00', closed: false }] });
    assert.equal(merged.length, 7);
    assert.deepEqual(merged[5], { weekday: 5, opens: '09:00', closes: '22:00', closed: false });
    assert.equal(merged[0].opens, '08:00');
    assert.equal(merged[6].closes, '17:00');
    const out = await intake({ ctx, text: "on Fridays we're open 9 to 10" });
    assert.equal(out.executed, true);
    const week = await db.q(`select weekday, opens, closes from regular_hours where business_id = $1 order by weekday`, [biz.id]);
    assert.equal(week.length, 7, 'the week survives a single-day change');
    assert.equal(String(week[5].closes).slice(0, 5), '22:00');
    assert.equal(String(week[1].closes).slice(0, 5), '17:00');
  });
});
