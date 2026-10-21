// 日本時間で実際のホーム用関数を実行し、イベントの日時境界を検証する。
process.env.TZ = 'Asia/Tokyo';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
let now = '2026-10-21T20:00:00';
class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
}
const context = vm.createContext({
    Date: Clock,
    document: { readyState: 'loading', addEventListener() {} },
});
const source = fs.readFileSync(path.join(root, 'js/pages/home/home.js'), 'utf8');
vm.runInContext(source.replace("    if (document.readyState === 'loading') {", `
    globalThis.api = { getEventEntries_, isOngoingEvent_, isEndedEvent_, getEventsOnDate_,
        getMonthEvents_, getOngoingEvents_, getUpcomingEvents_, formatEventRange_ };
    if (document.readyState === 'loading') {`), context);
const api = context.api;
const data = JSON.parse(fs.readFileSync(path.join(root, 'public/home-data.json'), 'utf8'));
let ranged = 0;
for (const item of data.events) {
    assert.ok(Number.isFinite(new Date(item.startAt || item.date).getTime()), item.title);
    if (!item.endAt) continue;
    ranged++;
    assert.ok(new Date(item.startAt || item.date) <= new Date(item.endAt), item.title);
}
const entries = api.getEventEntries_(data.events);
const target = entries.find(e => e.item.title === 'イベント開催記念ログインボーナス後半');
assert.ok(target);
assert.equal(target.item.startAt, '2026-10-15T04:00');
assert.equal(target.item.endAt, '2026-11-01T04:00');
assert.equal(api.formatEventRange_(target.item), '2026.10.15 ～ 2026.11.01');
for (const [time, ongoing, ended] of [
    ['2026-10-15T03:59:59', false, false],
    ['2026-10-15T04:00:00', true, false],
    ['2026-10-21T20:00:00', true, false],
    ['2026-11-01T03:59:59', true, false],
    ['2026-11-01T04:00:00', false, true],
    ['2026-11-02T00:00:00', false, true],
]) {
    now = time;
    assert.equal(api.isOngoingEvent_(target), ongoing, time);
    assert.equal(api.isEndedEvent_(target), ended, time);
    assert.equal(api.getOngoingEvents_(entries).includes(target), ongoing, time);
}
for (const [day, visible] of [
    ['2026-10-14', false], ['2026-10-15', true], ['2026-10-31', true],
    ['2026-11-01', true], ['2026-11-02', false],
]) assert.equal(api.getEventsOnDate_(entries, day).includes(target), visible, day);
for (const month of ['2026-10-01', '2026-11-01']) {
    assert.ok(api.getMonthEvents_(entries, new Date(month)).includes(target));
}
now = '2026-10-15T03:59:59';
assert.ok(api.getUpcomingEvents_(entries, new Date('2026-10-15T00:00'), 7).includes(target));
now = '2026-10-15T04:00:00';
assert.ok(!api.getUpcomingEvents_(entries, new Date('2026-10-15T00:00'), 7).includes(target));
// 日付のみの終了指定は終日、0時終了は前日まで、終了指定なしは従来どおり開催中に含めない。
for (const [item, time, ongoing] of [
    [{ date: '2026-10-01', endAt: '2026-10-15' }, '2026-10-15T23:59:59', true],
    [{ date: '2026-10-01', endAt: '2026-10-15' }, '2026-10-16T00:00:00', false],
    [{ date: '2026-10-01', endAt: '2026-10-15T00:00' }, '2026-10-15T00:00:00', false],
    [{ date: '2026-10-01' }, '2026-10-01T12:00:00', false],
]) {
    now = time;
    assert.equal(api.isOngoingEvent_(api.getEventEntries_([item])[0]), ongoing);
}
console.log(`PASS: ${data.events.length}件（終了指定${ranged}件）の期間整合性、日時境界、日別・月別抽出、既存形式`);
