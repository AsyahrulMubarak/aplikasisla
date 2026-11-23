(function () {
    'use strict';

    const storageKey = 'sla-appearance';
    const legacyStorageKey = 'sla-theme';
    const migrationKey = 'sla-appearance-auto-default-20261027';
    const root = document.documentElement;
    const dayMs = 86400000;
    const witaOffsetMs = 8 * 60 * 60 * 1000;
    const boundaries = [5, 11, 16, 18].map(function (hour) { return hour * 3600000; });
    const palettes = {
        pagi: { label: 'Pagi', color: '#edf6fa', text: '#163047', grid: '#d7e5ee', next: 'Siang pukul 11.00' },
        siang: { label: 'Siang', color: '#f1f5fa', text: '#1b2e4a', grid: '#dbe3ee', next: 'Sore pukul 16.00' },
        sore: { label: 'Sore', color: '#f9efe7', text: '#45352e', grid: '#ead9cd', next: 'Malam pukul 18.00' },
        malam: { label: 'Malam', color: '#0c1524', text: '#e4edf9', grid: '#304159', next: 'Pagi pukul 05.00' }
    };
    let storageUnavailable = false;
    let preference = readPreference();
    let checkTimer;
    let appliedAmbience;

    function validPreference(value) {
        if (!value || typeof value !== 'object' || value.version !== 1 ||
            (value.mode !== 'auto' && value.mode !== 'manual') ||
            !Object.prototype.hasOwnProperty.call(palettes, value.ambience)) return null;
        return { version: 1, mode: value.mode, ambience: value.ambience };
    }

    function readPreference() {
        const automatic = { version: 1, mode: 'auto', ambience: scheduledAmbience(new Date()) };
        try {
            // Reset existing preferences once for this rollout. Subsequent manual
            // choices keep the marker and must survive reloads and new tabs.
            if (localStorage.getItem(migrationKey) !== '1') {
                localStorage.setItem(storageKey, JSON.stringify(automatic));
                localStorage.setItem(legacyStorageKey, automatic.ambience === 'malam' ? 'dark' : 'light');
                localStorage.setItem(migrationKey, '1');
                return automatic;
            }
            const saved = localStorage.getItem(storageKey);
            if (saved) {
                try {
                    const value = validPreference(JSON.parse(saved));
                    if (value) return value;
                } catch (error) { /* A damaged preference falls back to the previous theme. */ }
            }
            const legacy = localStorage.getItem(legacyStorageKey);
            if (legacy === 'light' || legacy === 'dark') {
                return { version: 1, mode: 'manual', ambience: legacy === 'dark' ? 'malam' : 'siang' };
            }
        } catch (error) { storageUnavailable = true; }
        return automatic;
    }

    function witaTimeMs(date) {
        return ((date.getTime() + witaOffsetMs) % dayMs + dayMs) % dayMs;
    }

    function scheduledAmbience(date) {
        const time = witaTimeMs(date);
        if (time >= boundaries[0] && time < boundaries[1]) return 'pagi';
        if (time >= boundaries[1] && time < boundaries[2]) return 'siang';
        if (time >= boundaries[2] && time < boundaries[3]) return 'sore';
        return 'malam';
    }

    function resolvedAmbience(date) {
        if (!preference) return scheduledAmbience(date);
        return preference.mode === 'auto' ? scheduledAmbience(date) : preference.ambience;
    }

    function getPreference() {
        return preference ? Object.assign({}, preference) : {
            version: 1, mode: 'auto', ambience: resolvedAmbience(new Date())
        };
    }

    function updateCharts(ambience) {
        const Chart = window.Chart;
        if (!Chart || !Chart.defaults) return;
        const palette = palettes[ambience];
        Chart.defaults.color = palette.text;
        Chart.defaults.borderColor = palette.grid;
        Object.values(Chart.instances || {}).forEach(function (chart) {
            const legend = chart.options.plugins && chart.options.plugins.legend;
            if (legend && legend.labels) legend.labels.color = palette.text;
            Object.values(chart.options.scales || {}).forEach(function (scale) {
                if (scale.ticks) scale.ticks.color = palette.text;
                if (scale.grid) scale.grid.color = palette.grid;
            });
            chart.update('none');
        });
    }

    function scheduleCheck(date) {
        clearTimeout(checkTimer);
        if (!preference || preference.mode !== 'auto') return;
        const time = witaTimeMs(date);
        const next = boundaries.find(function (boundary) { return boundary > time; });
        const delay = next === undefined ? dayMs - time + boundaries[0] : next - time;
        // Check the wall clock each minute as well as at the exact boundary.
        checkTimer = setTimeout(applyTheme, Math.max(1, Math.min(delay, 60000)));
    }

    function applyTheme(forceCharts) {
        const date = new Date();
        const ambience = resolvedAmbience(date);
        const theme = ambience === 'malam' ? 'dark' : 'light';
        const palette = palettes[ambience];
        const automatic = !!preference && preference.mode === 'auto';
        const changed = ambience !== appliedAmbience;
        root.dataset.ambience = ambience;
        root.dataset.theme = theme;
        root.dataset.bsTheme = theme;
        const themeColor = document.querySelector('meta[name="theme-color"]');
        if (themeColor) themeColor.content = palette.color;

        const toggle = document.getElementById('lobby-theme-toggle');
        if (toggle) {
            toggle.setAttribute('aria-label', 'Tampilan: nuansa ' + palette.label + (automatic ? ', otomatis' : ', manual'));
            const label = toggle.querySelector('[data-theme-label]');
            if (label) label.textContent = palette.label + (automatic ? ' · Otomatis' : '');
        }
        const autoToggle = document.getElementById('lobby-theme-auto');
        if (autoToggle) autoToggle.checked = automatic;
        document.querySelectorAll('[data-ambience-choice]').forEach(function (button) {
            button.setAttribute('aria-pressed', String(button.dataset.ambienceChoice === ambience));
        });
        const status = document.getElementById('lobby-theme-status');
        if (status) status.textContent = automatic
            ? 'Otomatis · ' + palette.label + '. Berikutnya ' + palette.next + ' WITA.'
            : 'Pilihan tetap · ' + palette.label + (storageUnavailable
                ? '. Browser tidak mengizinkan penyimpanan; pilihan berlaku selama halaman ini terbuka.'
                : '. Tersimpan di browser ini sampai Anda menggantinya.');
        const summary = document.getElementById('lobby-ambience-summary');
        if (summary) summary.textContent = 'Nuansa ' + palette.label + ' · ' + (automatic ? 'Otomatis WITA' : 'Pilihan tetap');

        if (changed || forceCharts === true) updateCharts(ambience);
        appliedAmbience = ambience;
        scheduleCheck(date);
        if (changed) window.dispatchEvent(new CustomEvent('sla-appearance-applied', {
            detail: { ambience: ambience, theme: theme }
        }));
    }

    function savePreference(value) {
        const next = validPreference(value);
        if (!next) return false;
        preference = next;
        try {
            localStorage.setItem(storageKey, JSON.stringify(preference));
            // Keep pages using the previous controller compatible during an update.
            localStorage.setItem(legacyStorageKey, resolvedAmbience(new Date()) === 'malam' ? 'dark' : 'light');
            localStorage.setItem(migrationKey, '1');
            storageUnavailable = false;
        } catch (error) { storageUnavailable = true; }
        applyTheme();
        return true;
    }

    function setPanelOpen(open, restoreFocus) {
        const panel = document.getElementById('lobby-appearance-panel');
        const toggle = document.getElementById('lobby-theme-toggle');
        if (!panel || !toggle) return;
        panel.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        if (restoreFocus) toggle.focus();
    }

    window.SLATheme = Object.freeze({ getPreference: getPreference, refresh: applyTheme });
    // Runs in <head> to apply a saved ambience before the first paint.
    applyTheme();

    document.addEventListener('DOMContentLoaded', function () {
        const toggle = document.getElementById('lobby-theme-toggle');
        if (toggle) toggle.addEventListener('click', function () {
            setPanelOpen(toggle.getAttribute('aria-expanded') !== 'true');
        });
        const close = document.getElementById('lobby-theme-close');
        if (close) close.addEventListener('click', function () { setPanelOpen(false, true); });
        const autoToggle = document.getElementById('lobby-theme-auto');
        if (autoToggle) autoToggle.addEventListener('change', function () {
            savePreference({ version: 1, mode: autoToggle.checked ? 'auto' : 'manual', ambience: resolvedAmbience(new Date()) });
        });
        document.querySelectorAll('[data-ambience-choice]').forEach(function (button) {
            button.addEventListener('click', function () {
                savePreference({ version: 1, mode: 'manual', ambience: button.dataset.ambienceChoice });
            });
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && toggle && toggle.getAttribute('aria-expanded') === 'true') {
                setPanelOpen(false, true);
            }
        });
        applyTheme(true);
    });

    // KPI dispatches this only after its existing origin-, source-, and nonce-checked handoff.
    window.addEventListener('sla-theme-change', function (event) {
        if (event.detail === 'light' || event.detail === 'dark') {
            savePreference({ version: 1, mode: 'manual', ambience: event.detail === 'dark' ? 'malam' : 'siang' });
        } else savePreference(event.detail);
    });
    window.addEventListener('storage', function (event) {
        if (event.key === storageKey || event.key === legacyStorageKey || event.key === migrationKey || event.key === null) {
            preference = readPreference();
            applyTheme();
        }
    });
    window.addEventListener('focus', function () { applyTheme(); });
    window.addEventListener('pageshow', function () { applyTheme(true); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) applyTheme(); });
}());

/* Display-only compatibility for attendance pages already published online. */
(function () {
    'use strict';
    const statuses = [
        ['holiday', '#fecdd3', '#881337'], ['absent', '#1e293b', '#ffffff'],
        ['leave', '#bbf7d0', '#166534'], ['sick', '#bfdbfe', '#1e3a8a'],
        ['correction', '#fbcfe8', '#9d174d'], ['late', '#fef08a', '#713f12'],
        ['forgot-exit', '#e0f2fe', '#075985'], ['exit-penalty', '#e2e8f0', '#334155']
    ].map(function (item) {
        const rgb = item[1].slice(1).match(/../g).map(function (value) { return parseInt(value, 16); });
        return { key: item[0], background: item[1], text: item[2], rgb: 'rgb(' + rgb.join(', ') + ')' };
    });
    function applyStatus(element) {
        const background = element.style.backgroundColor || element.style.background;
        const status = statuses.find(function (item) {
            return background.includes(item.background) || background === item.rgb ||
                background.includes('--attendance-' + item.key + '-bg');
        });
        if (!status) return;
        // Longhand colors can also be copied by the existing mobile renderer.
        element.style.background = '';
        element.style.backgroundColor = 'var(--attendance-' + status.key + '-bg, ' + status.background + ')';
        element.style.color = 'var(--attendance-' + status.key + '-text, ' + status.text + ')';
    }
    function mount() {
        const heading = Array.from(document.querySelectorAll('h4')).find(function (element) {
            return element.textContent.includes('Legenda Warna');
        });
        const legend = heading && heading.parentElement.querySelector('ul');
        if (legend) {
            legend.classList.add('attendance-color-legend');
            legend.querySelectorAll('li > span').forEach(applyStatus);
        }
        const table = document.getElementById('tabel-absen');
        if (!table) return;
        const mobile = document.getElementById('mobile-attendance-list');
        function refresh() {
            table.querySelectorAll('tr, td').forEach(applyStatus);
            if (!mobile) return;
            const rows = Array.from(table.rows).filter(function (row) { return row.cells.length >= 10; });
            mobile.querySelectorAll('.attendance-day-card').forEach(function (card, index) {
                const row = rows[index];
                if (!row) return;
                card.style.color = row.style.color;
                const summary = card.querySelector('summary');
                if (summary && row.style.color) summary.style.backgroundColor = row.style.backgroundColor;
                const marker = [1, 2, 3, 4].map(function (column) { return row.cells[column].style.backgroundColor; })
                    .find(function (color) { return color.includes('--attendance-'); }) ||
                    (row.style.color ? row.style.backgroundColor : '');
                if (marker) {
                    card.style.borderLeftWidth = '4px';
                    card.style.borderLeftColor = marker;
                }
                card.querySelectorAll('.mobile-card-field.is-time .mobile-card-value').forEach(function (value, column) {
                    const source = row.cells[column + 1];
                    value.style.backgroundColor = source.style.backgroundColor ||
                        (row.style.color ? row.style.backgroundColor : '');
                    value.style.color = source.style.color || row.style.color;
                });
            });
        }
        refresh();
        // Only watch content replacement; applying colors cannot retrigger this observer.
        const observer = new MutationObserver(refresh);
        observer.observe(table, { childList: true, subtree: true });
        if (mobile) observer.observe(mobile, { childList: true, subtree: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
})();
