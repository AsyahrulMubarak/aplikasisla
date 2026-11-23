'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../theme.js'), 'utf8');
const pref = (mode = 'auto', ambience = 'pagi') => ({ version: 1, mode, ambience });

function harness({ saved, legacy, migrated = false, now = '2026-10-27T08:00:00+08:00', dark = false, unavailable = false, store } = {}) {
    const storage = store || new Map();
    if (saved !== undefined) storage.set('sla-appearance', typeof saved === 'string' ? saved : JSON.stringify(saved));
    if (legacy) storage.set('sla-theme', legacy);
    if (migrated) storage.set('sla-appearance-auto-default-20261027', '1');
    const listeners = new Map(), documentListeners = new Map(), timers = new Map(), nodes = new Map();
    let currentTime = new Date(now).getTime(), nextTimer = 0, chartUpdates = 0;
    function node(id) {
        if (!nodes.has(id)) nodes.set(id, {
            dataset: {}, attrs: {}, checked: false, hidden: false, content: '', textContent: '', events: {},
            setAttribute(key, value) { this.attrs[key] = value; },
            getAttribute(key) { return this.attrs[key]; },
            querySelector(selector) {
                return id === 'lobby-theme-toggle' && selector === '[data-theme-label]' ? node('theme-label') : null;
            },
            addEventListener(event, callback) { this.events[event] = callback; },
            focus() { this.focused = true; }
        });
        return nodes.get(id);
    }
    const root = node('root');
    const lobbyIds = new Set([
        'lobby-theme-toggle', 'lobby-theme-auto', 'lobby-theme-status', 'lobby-ambience-summary',
        'lobby-appearance-panel', 'lobby-theme-close'
    ]);
    const choices = ['pagi', 'siang', 'sore', 'malam'].map(name => {
        const choice = node(name); choice.dataset.ambienceChoice = name; return choice;
    });
    class FixedDate extends Date {
        constructor(...args) { super(...(args.length ? args : [currentTime])); }
        static now() { return currentTime; }
    }
    const system = { matches: dark, change() {}, addEventListener(name, callback) { this.change = callback; } };
    const chart = { options: { plugins: { legend: { labels: {} } }, scales: { x: { ticks: {}, grid: {} } } }, update() { chartUpdates++; } };
    const win = {
        matchMedia: () => system,
        Chart: { defaults: {}, instances: { one: chart } },
        addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
        dispatchEvent(event) { (listeners.get(event.type) || []).forEach(fn => fn(event)); }
    };
    const document = {
        documentElement: root, hidden: false, readyState: 'loading',
        getElementById: id => lobbyIds.has(id) ? node(id) : null,
        querySelector: selector => selector === 'meta[name="theme-color"]' ? node('meta') : null,
        querySelectorAll: selector => selector === '[data-ambience-choice]' ? choices : [],
        addEventListener(name, fn) {
            if (!documentListeners.has(name)) documentListeners.set(name, []);
            documentListeners.get(name).push(fn);
        }
    };
    const emitDocument = event => (documentListeners.get(event.type) || []).forEach(fn => fn(event));
    const context = vm.createContext({
        window: win, document, Date: FixedDate, Object, JSON,
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        localStorage: { getItem(key) { if (unavailable) throw Error('blocked'); return storage.get(key) || null; }, setItem(key, value) { if (unavailable) throw Error('blocked'); storage.set(key, value); } },
        setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
        clearTimeout(id) { timers.delete(id); }
    });
    vm.runInContext(source, context);
    document.readyState = 'interactive';
    emitDocument({ type: 'DOMContentLoaded' });
    const emit = (type, detail) => win.dispatchEvent({ type, detail });
    return { node, root, storage, timers, system, win, chart,
        setTime(value) { currentTime = new Date(value).getTime(); },
        emit, choose(name) { node(name).events.click(); },
        automatic(value) { node('lobby-theme-auto').checked = value; node('lobby-theme-auto').events.change(); },
        refresh() { win.SLATheme.refresh(); },
        chartUpdates: () => chartUpdates, emitDocument
    };
}

test('all four WITA intervals include their start and exclude their end, independently of the device zone', () => {
    for (const [time, expected] of [
        ['00:00:00', 'malam'], ['04:59:59', 'malam'], ['05:00:00', 'pagi'], ['10:59:59', 'pagi'],
        ['11:00:00', 'siang'], ['15:59:59', 'siang'], ['16:00:00', 'sore'], ['17:59:59', 'sore'],
        ['18:00:00', 'malam'], ['23:59:59', 'malam']
    ]) {
        const h = harness({ saved: pref(), now: '2026-10-27T' + time + '+08:00' });
        assert.equal(h.root.dataset.ambience, expected, time);
        assert.equal(h.root.dataset.bsTheme, expected === 'malam' ? 'dark' : 'light');
    }
    assert.equal(harness({ saved: pref(), now: '2026-10-26T21:00:00Z' }).root.dataset.ambience, 'pagi');
});

test('a page left open switches at the exact boundary and updates charts once per ambience', () => {
    const h = harness({ now: '2026-10-27T10:59:59.500+08:00' });
    const timer = [...h.timers.values()][0];
    assert.equal(timer.delay, 500);
    h.setTime('2026-10-27T11:00:00+08:00'); timer.fn();
    assert.equal(h.root.dataset.ambience, 'siang');
    assert.equal(h.chart.options.scales.x.grid.color, '#dbe3ee');
    const updates = h.chartUpdates(); h.refresh();
    assert.equal(h.chartUpdates(), updates, 'unchanged ambience does not redraw charts');
    assert([...h.timers.values()].every(t => t.delay <= 60000));
});

test('manual selection disables automatic mode and survives reloads, midnight and OS changes', () => {
    const h = harness({ saved: pref() }); h.choose('sore');
    assert.equal(h.node('lobby-theme-auto').checked, false);
    assert.deepEqual(JSON.parse(h.storage.get('sla-appearance')), pref('manual', 'sore'));
    assert.equal(h.timers.size, 0);
    const reload = harness({ store: h.storage, dark: true, now: '2026-10-28T02:00:00+08:00' });
    assert.equal(reload.root.dataset.ambience, 'sore');
    reload.system.change(); assert.equal(reload.root.dataset.ambience, 'sore');
    reload.automatic(true); assert.equal(reload.root.dataset.ambience, 'malam');
    reload.automatic(false); reload.setTime('2026-10-28T12:00:00+08:00'); reload.emit('focus');
    assert.equal(reload.root.dataset.ambience, 'malam', 'turning off automatic latches the displayed ambience');
});

test('foreground and restored pages recover after device sleep or a changed clock', () => {
    const h = harness({ saved: pref() }); h.setTime('2026-10-27T18:30:00+08:00');
    h.emitDocument({ type: 'visibilitychange' }); assert.equal(h.root.dataset.ambience, 'malam');
    h.setTime('2026-10-28T06:00:00+08:00'); h.emit('pageshow'); assert.equal(h.root.dataset.ambience, 'pagi');
});

test('old light/dark and four-ambience preferences switch to automatic once; later manual choices survive reload', () => {
    const oldSettings = [{ legacy: 'light' }, { legacy: 'dark' }, ...['pagi', 'siang', 'sore', 'malam'].map(ambience => ({ saved: pref('manual', ambience) }))];
    for (const options of oldSettings) {
        const h = harness(options);
        assert.equal(h.root.dataset.ambience, 'pagi');
        assert.equal(h.win.SLATheme.getPreference().mode, 'auto');
        assert.equal(h.storage.get('sla-appearance-auto-default-20261027'), '1');
        assert.equal(JSON.parse(h.storage.get('sla-appearance')).mode, 'auto');
        h.choose('sore');
        const reload = harness({ store: h.storage, now: '2026-10-28T02:00:00+08:00' });
        assert.equal(reload.root.dataset.ambience, 'sore');
        assert.equal(reload.win.SLATheme.getPreference().mode, 'manual');
    }
});

test('an already migrated manual choice is respected on startup, focus and cross-tab synchronization', () => {
    const h = harness({ migrated: true, saved: pref('manual', 'malam') });
    assert.equal(h.root.dataset.ambience, 'malam');
    h.emit('focus');
    h.win.dispatchEvent({ type: 'storage', key: 'sla-appearance-auto-default-20261027' });
    assert.equal(h.root.dataset.ambience, 'malam');
    assert.equal(h.win.SLATheme.getPreference().mode, 'manual');
});

test('new and cleared browsers default to automatic WITA regardless of OS theme, including blocked storage', () => {
    for (const options of [{ dark: true }, { dark: false }, { unavailable: true }, { saved: '{invalid' }]) {
        const h = harness(options);
        assert.equal(h.root.dataset.ambience, 'pagi');
        assert.equal(h.node('lobby-theme-auto').checked, true);
        assert.equal(h.win.SLATheme.getPreference().mode, 'auto');
        assert.equal(h.timers.size, 1);
        h.setTime('2026-10-27T18:00:00+08:00'); h.emit('focus');
        assert.equal(h.root.dataset.ambience, 'malam');
    }
});

test('invalid stored data and handoffs are ignored; authenticated handoff preserves automatic mode', () => {
    const h = harness({ saved: '{invalid', legacy: 'dark' });
    for (const value of ['invalid', null, {}, { ...pref(), ambience: '__proto__' }, { ...pref(), version: 2 }]) {
        h.emit('sla-theme-change', value); assert.equal(h.root.dataset.ambience, 'pagi');
    }
    h.emit('sla-theme-change', pref()); assert.equal(h.root.dataset.ambience, 'pagi');
    assert.equal(h.win.SLATheme.getPreference().mode, 'auto');
    const copy = h.win.SLATheme.getPreference(); copy.mode = 'manual';
    assert.equal(h.win.SLATheme.getPreference().mode, 'auto');
    h.emit('sla-theme-change', 'dark'); assert.equal(h.root.dataset.ambience, 'malam');
});

test('cross-tab settings refresh from storage; blocked storage still permits all controls', () => {
    const h = harness(); h.storage.set('sla-appearance', JSON.stringify(pref('manual', 'sore')));
    h.win.dispatchEvent({ type: 'storage', key: 'sla-appearance' }); assert.equal(h.root.dataset.ambience, 'sore');
    const blocked = harness({ unavailable: true }); blocked.choose('malam');
    assert.equal(blocked.root.dataset.ambience, 'malam');
    blocked.automatic(true); assert.equal(blocked.root.dataset.ambience, 'pagi');
});

test('appearance settings support keyboard dismissal and restore focus', () => {
    const h = harness(); h.node('lobby-theme-toggle').events.click();
    assert.equal(h.node('lobby-appearance-panel').hidden, false);
    h.emitDocument({ type: 'keydown', key: 'Escape' });
    assert.equal(h.node('lobby-appearance-panel').hidden, true);
    assert.equal(h.node('lobby-theme-toggle').focused, true);
});
