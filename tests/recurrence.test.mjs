import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker, rule, series, baseEvent } from './helpers.mjs';
const w = await loadWorker();
const dates = (record, from, to, exceptions = new Map(), cancelled = false) =>
  w.expandSeries(record, from, to, exceptions, cancelled).map(e => e.start_at);

test('monthly first Monday spans the year with the six requested dates', () => {
  assert.deepEqual(dates(series(), '2026-11-01', '2027-04-30'),
    ['2026-11-02', '2026-12-07', '2027-01-04', '2027-02-01', '2027-03-01', '2027-04-05']);
  assert.equal(w.validateRecurrence(rule(), baseEvent).rule.by_weekday, '1MO');
});
test('empty weekday means same day of month, not ordinal weekday', () => {
  assert.deepEqual(dates(series({ by_weekday: null }), '2026-11-01', '2027-01-31'),
    ['2026-11-02', '2026-12-02', '2027-01-02']);
});
test('all five ordinal weekdays and last weekday for every month over five years', () => {
  for (let year = 2026; year <= 2031; year++) for (let month = 1; month <= 12; month++) {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 0; day < 7; day++) {
      const candidates = [];
      for (let d = 1; d <= last; d++) {
        const date = new Date(Date.UTC(year, month - 1, d));
        if (date.getUTCDay() === (day + 1) % 7) candidates.push(date.toISOString().slice(0,10));
      }
      for (const nth of [1,2,3,4,5,-1]) {
        const code = ['MO','TU','WE','TH','FR','SA','SU'][day];
        const anchor = candidates[nth === -1 ? candidates.length - 1 : nth - 1];
        if (!anchor) continue;
        assert.equal(w.occurrenceOrdinal(rule({by_weekday: String(nth) + code}), anchor, anchor), 1);
      }
    }
  }
});
test('fifth Mondays skip missing months and count actual occurrences', () => {
  assert.deepEqual(dates(series({start_at:'2026-11-30',by_weekday:'5MO',occurrence_count:3}), '2026-11-01','2027-07-31'),
    ['2026-11-30','2027-03-29','2027-05-31']);
});
test('last Mondays cross December and February', () => {
  assert.deepEqual(dates(series({start_at:'2026-11-30',by_weekday:'-1MO'}),'2026-11-01','2027-02-28'),
    ['2026-11-30','2026-12-28','2027-01-25','2027-02-22']);
});
test('monthly 31st skips short months and yearly leap dates skip non-leap years', () => {
  assert.deepEqual(dates(series({start_at:'2027-01-31',by_weekday:null,day_of_month:31}),'2027-01-01','2027-05-31'),
    ['2027-01-31','2027-03-31','2027-05-31']);
  assert.deepEqual(dates(series({start_at:'2028-02-29',frequency:'yearly',by_weekday:null}),'2028-01-01','2032-12-31'),
    ['2028-02-29','2032-02-29']);
});
test('daily interval, weekly multiple days, two and three week intervals', () => {
  assert.deepEqual(dates(series({frequency:'daily',by_weekday:null,interval_value:2,occurrence_count:3}),'2026-11-01','2026-11-30'),
    ['2026-11-02','2026-11-04','2026-11-06']);
  assert.deepEqual(dates(series({frequency:'weekly',by_weekday:'MO,WE',interval_value:2}),'2026-11-01','2026-11-30'),
    ['2026-11-02','2026-11-04','2026-11-16','2026-11-18','2026-11-30']);
  assert.deepEqual(dates(series({frequency:'weekly',by_weekday:'MO',interval_value:3}),'2026-11-01','2026-11-30'),
    ['2026-11-02','2026-11-23']);
});
test('until is inclusive; count and until both constrain output', () => {
  assert.deepEqual(dates(series({until_date:'2027-01-04'}),'2026-11-01','2027-04-30'),
    ['2026-11-02','2026-12-07','2027-01-04']);
  assert.deepEqual(dates(series({occurrence_count:2,until_date:'2027-01-04'}),'2026-11-01','2027-04-30'),
    ['2026-11-02','2026-12-07']);
});
test('cancel, restore, move into range and move outside range', () => {
  const r = series(), key = r.id + '|2026-12-07';
  assert.deepEqual(dates(r,'2026-12-01','2026-12-31',new Map([[key,{action:'cancelled'}]])),[]);
  assert.deepEqual(dates(r,'2026-12-01','2026-12-31'),['2026-12-07']);
  assert.deepEqual(dates(r,'2027-01-01','2027-01-31',new Map([[key,{action:'modified',override:{start_at:'2027-01-15'}}]])),
    ['2027-01-04','2027-01-15']);
  assert.deepEqual(dates(r,'2026-12-01','2026-12-31',new Map([[key,{action:'modified',override:{start_at:'2027-01-15'}}]])),[]);
  const cancelled = w.expandSeries(r,'2026-12-01','2026-12-31',new Map([[key,{action:'cancelled'}]]),true);
  assert.equal(cancelled[0].exception_action,'cancelled');
});
test('Hong Kong timed cross-day duration is preserved', () => {
  const r = series({start_at:'2026-11-02T23:30:00+08:00',end_at:'2026-11-03T01:00:00+08:00',all_day:0});
  const item=w.expandSeries(r,'2026-12-01','2026-12-31',new Map())[0];
  assert.equal(item.start_at,'2026-12-07T23:30:00+08:00');
  assert.equal(item.end_at,'2026-12-08T01:00:00+08:00');
});
test('invalid rules, mismatched anchors and unbounded public query ranges fail', () => {
  for (const by_weekday of ['0MO','6MO','-2MO','1XX']) assert.ok(w.validateRecurrence(rule({by_weekday}),baseEvent).error);
  assert.ok(w.validateRecurrence(rule({by_weekday:'2MO'}),baseEvent).error);
  assert.ok(w.readRange(new URL('https://example.test/?from=2026-01-01&to=2030-01-01')).error);
  assert.ok(w.readRange(new URL('https://example.test/?from=2026-02-30&to=2026-03-01')).error);
});
