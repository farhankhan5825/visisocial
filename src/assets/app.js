/* VisiSocial console. Same-origin script only (CSP). Pages work without it; this adds
   tracing (finding -> source items and back), filters, search and the capture animation. */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  // Sizes from data attributes (inline styles are blocked by the CSP).
  all('[data-w]').forEach(function (el) {
    el.style.width = Math.max(0, Math.min(100, Number(el.getAttribute('data-w')) || 0)) + '%';
  });
  all('[data-h]').forEach(function (el) {
    el.style.height = Math.max(8, Math.min(100, Number(el.getAttribute('data-h')) || 0)) + '%';
  });

  var streamBody = document.querySelector('[data-stream]');
  var findingsBody = document.querySelector('[data-findings]');
  if (!streamBody || !findingsBody) return;
  var srows = all('.srow', streamBody);
  var frows = all('.frow', findingsBody);
  var detail = document.querySelector('[data-detail]');
  var evidenceDrawer = document.querySelector('[data-evidence-drawer]');

  // The capture fills, then findings resolve. Once per session, so it never gets in the way.
  var seen = false;
  try {
    seen = sessionStorage.getItem('vs-animated') === '1';
    sessionStorage.setItem('vs-animated', '1');
  } catch (e) {
    seen = true;
  }
  if (!reduce && !seen) {
    document.body.classList.add('animate');
    srows.forEach(function (r, i) {
      r.style.animationDelay = Math.min(i * 14, 900) + 'ms';
    });
    var base = Math.min(srows.length * 14, 900) + 150;
    frows.forEach(function (r, i) {
      r.style.animationDelay = base + i * 45 + 'ms';
    });
  }

  function showDetail(id) {
    if (!detail) return;
    all('article', detail).forEach(function (a) {
      var match = id ? a.getAttribute('data-for') === id : a.hasAttribute('data-default');
      a.classList.toggle('hidden', !match);
    });
  }
  function clear() {
    srows.forEach(function (r) {
      r.classList.remove('lit', 'sel');
    });
    frows.forEach(function (r) {
      r.classList.remove('lit', 'sel');
    });
    streamBody.classList.remove('dimmed');
    showDetail(null);
  }

  function selectFinding(row, scroll) {
    if (evidenceDrawer) evidenceDrawer.open = true;
    var wasSelected = row.classList.contains('sel');
    clear();
    if (wasSelected) {
      history.replaceState(null, '', location.pathname);
      return;
    }
    row.classList.add('sel');
    var ids = (row.getAttribute('data-sources') || '').split(' ').filter(Boolean);
    // A graph selection must remain traceable after a stream or findings filter.
    srows.forEach(function (r) {
      r.classList.remove('hidden');
    });
    frows.forEach(function (r) {
      r.classList.remove('hidden');
    });
    kind = 'all';
    query = '';
    if (search) search.value = '';
    all('button[data-kind], [data-layer-filter]').forEach(function (b) {
      b.setAttribute(
        'aria-pressed',
        (b.getAttribute('data-kind') || b.getAttribute('data-layer-filter')) === 'all'
          ? 'true'
          : 'false'
      );
    });
    var first = null;
    srows.forEach(function (r) {
      var hit = ids.indexOf(r.getAttribute('data-id')) >= 0;
      r.classList.toggle('lit', hit);
      if (hit && !first) first = r;
    });
    if (ids.length) streamBody.classList.add('dimmed');
    if (first && scroll !== false) {
      streamBody.scrollTop = first.offsetTop - streamBody.offsetTop - 40;
    }
    showDetail(row.getAttribute('data-fid'));
    history.replaceState(null, '', '#' + row.getAttribute('data-fid'));
  }

  frows.forEach(function (row) {
    row.addEventListener('click', function (e) {
      e.preventDefault();
      selectFinding(row);
    });
  });
  all('[data-trace]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var row = frows.find(function (f) {
        return f.getAttribute('data-fid') === link.getAttribute('data-trace');
      });
      if (!row) return;
      e.preventDefault();
      clear();
      selectFinding(row);
      evidenceDrawer.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
    });
  });

  // Selecting an item lights up every finding that used it.
  srows.forEach(function (row) {
    function pick() {
      var was = row.classList.contains('sel');
      clear();
      if (was) return;
      row.classList.add('sel');
      var id = row.getAttribute('data-id');
      frows.forEach(function (f) {
        var ids = (f.getAttribute('data-sources') || '').split(' ');
        f.classList.toggle('lit', ids.indexOf(id) >= 0);
      });
    }
    row.addEventListener('click', pick);
    row.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pick();
      }
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      clear();
      history.replaceState(null, '', location.pathname);
    }
  });

  // Stream filters: kind and free text.
  var kind = 'all';
  var query = '';
  function applyStream() {
    srows.forEach(function (r) {
      var okKind = kind === 'all' || r.getAttribute('data-kind') === kind;
      var okText = !query || r.textContent.toLowerCase().indexOf(query) >= 0;
      r.classList.toggle('hidden', !(okKind && okText));
    });
  }
  all('button[data-kind]').forEach(function (b) {
    if (b.tagName !== 'BUTTON') return;
    b.addEventListener('click', function () {
      kind = b.getAttribute('data-kind');
      all('button[data-kind]').forEach(function (x) {
        x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      });
      applyStream();
    });
  });
  var search = document.querySelector('[data-search]');
  if (search)
    search.addEventListener('input', function () {
      query = search.value.trim().toLowerCase();
      applyStream();
    });

  // Findings filter by layer.
  all('[data-layer-filter]').forEach(function (b) {
    b.addEventListener('click', function () {
      var layer = b.getAttribute('data-layer-filter');
      all('[data-layer-filter]').forEach(function (x) {
        x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      });
      frows.forEach(function (r) {
        r.classList.toggle('hidden', layer !== 'all' && r.getAttribute('data-layer') !== layer);
      });
    });
  });

  // Open a finding named in the URL (#F03), e.g. from a shared link.
  if (location.hash) {
    var target = findingsBody.querySelector(
      '[data-fid="' + location.hash.slice(1).replace(/[^A-Za-z0-9]/g, '') + '"]'
    );
    if (target) selectFinding(target, true);
  }
})();
