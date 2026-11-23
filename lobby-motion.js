(() => {
    const lobby = document.getElementById('main-lobby-wrapper');
    if (!lobby) return;

    const content = lobby.querySelector('.main-lobby-card');
    const panels = lobby.querySelectorAll('.lobby-panel:not(.lobby-appearance-panel)');
    const menuCards = lobby.querySelectorAll('.main-lobby-option');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = matchMedia('(any-pointer: fine)');
    let motionReady;
    let lenisReady;
    let stopMotion;
    let lenis;

    function loadScript(packagePath, integrity) {
        return new Promise(resolve => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/' + packagePath;
            script.integrity = 'sha384-' + integrity;
            script.crossOrigin = 'anonymous';
            script.onload = script.onerror = resolve;
            document.head.append(script);
        });
    }

    function lobbyIsActive() {
        return lobby.getAttribute('aria-hidden') === 'false' && !reducedMotion.matches;
    }

    function startMotion() {
        const { animateMini, hover } = window.Motion;
        const scrollTrigger = window.ScrollTrigger;
        const animations = new Map();
        const entered = new Set();
        const triggers = new Map();

        function play(element, keyframes, duration) {
            animations.get(element)?.stop();
            animations.set(element, animateMini(element, keyframes, { duration, ease: 'easeOut' }));
        }

        function enter(panel) {
            if (entered.has(panel)) return;
            entered.add(panel);
            play(panel, { opacity: [0.84, 1], transform: ['translateY(8px)', 'none'] }, 0.28);
        }

        function updatePanels() {
            const bounds = lobby.getBoundingClientRect();
            for (const panel of panels) {
                if (!panel.offsetHeight) {
                    triggers.get(panel)?.kill();
                    triggers.delete(panel);
                    continue;
                }
                if (entered.has(panel) || triggers.has(panel)) continue;

                const { top, bottom } = panel.getBoundingClientRect();
                if (top < bounds.bottom && bottom > bounds.top) {
                    enter(panel);
                } else if (scrollTrigger) {
                    triggers.set(panel, scrollTrigger.create({
                        trigger: panel,
                        scroller: lobby,
                        start: 'top bottom',
                        end: 'bottom top',
                        onEnter: () => enter(panel),
                        onEnterBack: () => enter(panel),
                    }));
                }
            }
            // Panel data and the appearance controls can change the scroll positions.
            if (triggers.size) scrollTrigger.refresh();
        }

        const stopHover = hover(menuCards, card => {
            if (card.disabled) return;
            play(card, { transform: 'translateY(-3px)' }, 0.16);
            return () => play(card, { transform: 'none' }, 0.18);
        });
        const layout = new ResizeObserver(updatePanels);
        layout.observe(lobby);
        layout.observe(content);
        panels.forEach(panel => layout.observe(panel));

        return () => {
            layout.disconnect();
            stopHover();
            triggers.forEach(trigger => trigger.kill());
            for (const [element, animation] of animations) {
                animation.cancel();
                element.style.removeProperty('transform');
                if (entered.has(element)) element.style.removeProperty('opacity');
            }
        };
    }

    async function enableMotion() {
        motionReady ??= Promise.all([
            loadScript('motion@12.23.24/dist/motion.js', 'nBgsjHMooWkZSws+BwZCIUfFVZTogsEqtZPFOlTYB/0EAQ2VEKdgw1WsP9A90HER'),
            loadScript('gsap@3.13.0/dist/gsap.min.js', 'HOvlOYPIs/zjoIkWUGXkVmXsjr8GuZLV+Q+rcPwmJOVZVpvTSXQChiN4t9Euv9Vc')
                .then(() => window.gsap && loadScript('gsap@3.13.0/dist/ScrollTrigger.min.js', 'P8VzCVnT9NBUkMrpcIZrJbA7EBjJvh/fJS6PmP+4nLIM284DtsImIv8D0fFjIkeh'))
                .then(() => {
                    if (window.ScrollTrigger) window.gsap.registerPlugin(window.ScrollTrigger);
                }),
        ]);
        await motionReady;
        if (lobbyIsActive() && !stopMotion && window.Motion) stopMotion = startMotion();
    }

    async function syncLenis() {
        if (!lobbyIsActive() || !finePointer.matches) {
            lenis?.destroy();
            lenis = null;
            return;
        }

        lenisReady ??= loadScript('lenis@1.3.17/dist/lenis.min.js', '4EgXbGZLDwcPHcRGrHOxm1OvumWUqhr/ts6eapdZnak6ORZAsSE3fMd0niykaSkw');
        await lenisReady;
        if (lenis || !lobbyIsActive() || !finePointer.matches || !window.Lenis) return;

        lenis = new window.Lenis({
            wrapper: lobby,
            content,
            autoRaf: true,
            syncTouch: false,
            allowNestedScroll: true,
            virtualScroll: ({ event }) => !event.shiftKey && lobby.scrollHeight > lobby.clientHeight,
        });
        lenis.on('scroll', () => window.ScrollTrigger?.update());
    }

    function syncLobby() {
        if (lobbyIsActive()) {
            void enableMotion();
        } else {
            stopMotion?.();
            stopMotion = null;
        }
        void syncLenis();
    }

    new MutationObserver(syncLobby).observe(lobby, { attributeFilter: ['aria-hidden'] });
    reducedMotion.addEventListener('change', syncLobby);
    finePointer.addEventListener('change', syncLenis);
    syncLobby();
})();
