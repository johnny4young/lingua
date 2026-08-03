(function () {
  function safeLocalStorageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  }

  function bindLanguageSelects() {
    document.querySelectorAll('[data-language-select]').forEach((select) => {
      if (!(select instanceof HTMLSelectElement)) return;
      if (select.dataset.bound === 'true') return;
      select.dataset.bound = 'true';
      select.addEventListener('change', () => {
        const option = select.selectedOptions[0];
        const locale = option && option.dataset.locale;
        const href = select.value;
        if (!locale || !href || !href.startsWith('/') || href.startsWith('//')) return;
        safeLocalStorageSet('lingua-locale', locale);
        window.location.assign(href);
      });
    });
  }

  function bindThemeToggle() {
    const toggle = document.getElementById('theme-toggle');
    toggle && toggle.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      safeLocalStorageSet('lingua-theme', next);
    });
  }

  function bindMobileNav() {
    const navBtn = document.getElementById('nav-toggle');
    const mobileNav = document.getElementById('mobile-nav');
    navBtn && navBtn.addEventListener('click', () => {
      const open = mobileNav && mobileNav.hasAttribute('hidden');
      if (open) {
        mobileNav.removeAttribute('hidden');
        navBtn.setAttribute('aria-expanded', 'true');
      } else if (mobileNav) {
        mobileNav.setAttribute('hidden', '');
        navBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function updateOsLabels() {
    const ua = navigator.userAgent;
    document.querySelectorAll('[data-os-label]').forEach((label) => {
      if (!(label instanceof HTMLElement)) return;
      const os = label.dataset;
      let text = os.osGeneric || label.textContent || '';
      if (/Macintosh|Mac OS X|iPhone|iPad/i.test(ua)) text = os.osMacos || text;
      else if (/Windows/i.test(ua)) text = os.osWindows || text;
      else if (/Linux|X11/i.test(ua)) text = os.osLinux || text;
      label.textContent = text;
    });
  }

  function bindHeroRunner() {
    document.querySelectorAll('[data-hero-runner]').forEach((root) => {
      if (!(root instanceof HTMLElement)) return;
      const tabs = Array.from(root.querySelectorAll('.hero-tab')).filter((tab) => tab instanceof HTMLButtonElement);
      const panels = Array.from(root.querySelectorAll('.hero-panel')).filter((panel) => panel instanceof HTMLElement);

      function activate(lang) {
        tabs.forEach((tab) => {
          const active = tab.dataset.lang === lang;
          tab.classList.toggle('is-active', active);
          tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        panels.forEach((panel) => {
          const active = panel.dataset.lang === lang;
          if (active) {
            panel.hidden = false;
            requestAnimationFrame(() => panel.classList.add('is-active'));
          } else {
            panel.classList.remove('is-active');
            window.setTimeout(() => {
              if (!panel.classList.contains('is-active')) panel.hidden = true;
            }, 220);
          }
        });
      }

      tabs.forEach((tab) => {
        tab.addEventListener('pointerenter', () => {
          if (tab.dataset.lang) activate(tab.dataset.lang);
        });
        tab.addEventListener('click', () => {
          if (tab.dataset.lang) activate(tab.dataset.lang);
        });
        tab.addEventListener('keydown', (event) => {
          const index = tabs.indexOf(tab);
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            tabs[(index + 1) % tabs.length].focus();
            tabs[(index + 1) % tabs.length].click();
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            tabs[(index - 1 + tabs.length) % tabs.length].focus();
            tabs[(index - 1 + tabs.length) % tabs.length].click();
          }
        });
      });
    });
  }

  function bindKineticHero() {
    const hero = document.querySelector('[data-kinetic-hero]');
    if (!(hero instanceof HTMLElement)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    hero.addEventListener('pointermove', (event) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = hero.getBoundingClientRect();
        const x = ((event.clientX - bounds.left) / bounds.width) * 100;
        const y = ((event.clientY - bounds.top) / bounds.height) * 100;
        hero.style.setProperty('--pointer-x', `${Math.max(0, Math.min(100, x)).toFixed(2)}%`);
        hero.style.setProperty('--pointer-y', `${Math.max(0, Math.min(100, y)).toFixed(2)}%`);
      });
    });
    hero.addEventListener('pointerleave', () => {
      hero.style.removeProperty('--pointer-x');
      hero.style.removeProperty('--pointer-y');
    });
  }

  function bindHistoryLeadTips() {
    // Release-history feature chips: a chip in the right half of its
    // list anchors its hover tooltip to the right so long changelog
    // descriptions never overflow the viewport. Chips have no layout
    // while the <details> is closed, so placement runs on open (and
    // again on resize for the open rows).
    const detailsNodes = Array.from(document.querySelectorAll('.history-item details'));
    if (detailsNodes.length === 0) return;

    function placeTips(list) {
      const mid = list.clientWidth / 2;
      list.querySelectorAll('li').forEach((chip) => {
        chip.classList.toggle('tip-right', chip.offsetLeft + chip.offsetWidth / 2 > mid);
      });
    }

    detailsNodes.forEach((node) => {
      node.addEventListener('toggle', () => {
        if (!node.open) return;
        const list = node.querySelector('.history-leads');
        if (list) placeTips(list);
      });
    });

    let resizeFrame = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        detailsNodes.forEach((node) => {
          if (!node.open) return;
          const list = node.querySelector('.history-leads');
          if (list) placeTips(list);
        });
      });
    });
  }

  function bindCheckoutReference() {
    const wrapper = document.querySelector('[data-checkout-reference]');
    if (!wrapper) return;
    const slot = wrapper.querySelector('[data-checkout-id]');
    if (!slot) return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('checkout_id') || '';
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(raw)) return;
    slot.textContent = raw;
    wrapper.hidden = false;
  }

  function normalizeSearchValue(value) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase()
      .trim();
  }

  function bindCliSearch() {
    const roots = Array.from(document.querySelectorAll('[data-cli-search]'));
    if (roots.length === 0) return;

    roots.forEach((root) => {
      if (!(root instanceof HTMLElement) || root.dataset.bound === 'true') return;
      const input = root.querySelector('input[type="search"]');
      const clear = root.querySelector('[data-cli-search-clear]');
      const results = root.querySelector('[data-cli-search-results]');
      const indexNode = document.querySelector('[data-cli-search-index]');
      if (!(input instanceof HTMLInputElement) || !(clear instanceof HTMLButtonElement) || !(results instanceof HTMLElement) || !(indexNode instanceof HTMLTextAreaElement)) return;

      let items = [];
      try {
        const parsed = JSON.parse(indexNode.value || '[]');
        if (Array.isArray(parsed)) items = parsed;
      } catch {
        return;
      }

      function render() {
        const query = normalizeSearchValue(input.value);
        clear.hidden = query.length === 0;
        results.replaceChildren();
        results.hidden = query.length === 0;
        if (query.length === 0) return;

        const terms = query.split(/\s+/).filter(Boolean);
        const matches = items
          .filter((item) => {
            const haystack = normalizeSearchValue(`${item.title} ${item.description} ${item.searchText}`);
            return terms.every((term) => haystack.includes(term));
          })
          .slice(0, 7);

        if (matches.length === 0) {
          const empty = document.createElement('p');
          empty.textContent = root.dataset.noResults || 'No results.';
          results.append(empty);
          return;
        }

        results.setAttribute('aria-label', root.dataset.resultsLabel || 'Search results');
        matches.forEach((item) => {
          const link = document.createElement('a');
          link.href = item.href;
          const title = document.createElement('strong');
          title.textContent = item.title;
          const description = document.createElement('span');
          description.textContent = item.description;
          link.append(title, description);
          results.append(link);
        });
      }

      input.addEventListener('input', render);
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        input.value = '';
        render();
      });
      clear.addEventListener('click', () => {
        input.value = '';
        render();
        input.focus();
      });
      root.dataset.bound = 'true';
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      const visibleInput = roots
        .map((root) => root.querySelector('input[type="search"]'))
        .find((input) => input instanceof HTMLInputElement && input.offsetParent !== null);
      if (!(visibleInput instanceof HTMLInputElement)) return;
      event.preventDefault();
      visibleInput.focus();
    });
  }

  function bindCliCodeCopy() {
    document.querySelectorAll('[data-cli-docs]').forEach((root) => {
      if (!(root instanceof HTMLElement)) return;
      const idleLabel = root.dataset.copyLabel || 'Copy';
      const successLabel = root.dataset.copySuccess || 'Copied';
      const errorLabel = root.dataset.copyError || 'Copy failed';
      root.querySelectorAll('.cli-prose pre').forEach((pre) => {
        if (!(pre instanceof HTMLElement) || pre.dataset.copyBound === 'true') return;
        const code = pre.querySelector('code');
        if (!(code instanceof HTMLElement)) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cli-copy-button';
        button.textContent = idleLabel;
        button.setAttribute('aria-label', idleLabel);
        button.setAttribute('aria-live', 'polite');
        let resetTimer;
        const setLabel = (label) => {
          button.textContent = label;
          button.setAttribute('aria-label', label);
        };
        button.addEventListener('click', async () => {
          try {
            if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('clipboard unavailable');
            await navigator.clipboard.writeText(code.textContent || '');
            setLabel(successLabel);
          } catch {
            setLabel(errorLabel);
          }
          window.clearTimeout(resetTimer);
          resetTimer = window.setTimeout(() => {
            setLabel(idleLabel);
          }, 1600);
        });
        pre.append(button);
        pre.dataset.copyBound = 'true';
      });
    });
  }

  function init() {
    bindLanguageSelects();
    bindThemeToggle();
    bindMobileNav();
    updateOsLabels();
    bindHeroRunner();
    bindKineticHero();
    bindHistoryLeadTips();
    bindCheckoutReference();
    bindCliSearch();
    bindCliCodeCopy();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
