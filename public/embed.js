// SPDX-License-Identifier: AGPL-3.0-or-later
// AutoDeck Maps: a modified version of A2B by Thaqif Syarafuddin bin Roslan (https://github.com/thaqif0709/a2b).
//
// Embed mode, for the Map widget on AutoDeck's car Home (the page inside an iframe, or ?embed=1).
// Runs before app.js. In embed mode:
//  - the welcome is skipped (the car has no time for it) and <html> gets the "embed" class for a compact layout;
//  - the position comes from AutoDeck (the car's GPS) by postMessage, since an iframe in the car's web view gets no
//    location of its own; after a few seconds without one it falls back to the browser's;
//  - typing goes through AutoDeck's car keyboard: focusing a text field asks the parent to open it, and the parent
//    sends the text back.
//
// Messages from the parent:  {type:'autodeck-location', lat, lng, acc?, heading?, speed?}
//                            {type:'autodeck-text', text, submit?}   (the whole field's new value)
//                            {type:'autodeck-pan', dx, dy}   (a car swipe over the widget)
//                            {type:'autodeck-keyboard-closed'}
// Messages to the parent:    {type:'autodeck-maps-ready'}
//                            {type:'autodeck-touch'}   (a touch on the map)
//                            {type:'autodeck-keyboard', open:true|false, value, hint}
(() => {
  const params = new URLSearchParams(location.search);
  const framed = window.top !== window;
  if (!framed && !params.has('embed')) return;

  document.documentElement.classList.add('embed');
  try { localStorage.setItem('a2b.welcomed', 'true'); } catch { /* private mode: the welcome shows, harmless */ }

  const toParent = (msg) => { if (framed) parent.postMessage(msg, '*'); };

  // ---- Location from the car ----
  const real = navigator.geolocation;
  const watchers = new Map();
  let nextId = 1;
  let last = null;
  let fromCar = false;
  const fix = (d) => ({
    coords: {
      latitude: d.lat, longitude: d.lng, accuracy: d.acc ?? 10, altitude: null, altitudeAccuracy: null,
      heading: Number.isFinite(d.heading) ? d.heading : null, speed: Number.isFinite(d.speed) ? d.speed : null,
    },
    timestamp: Date.now(),
  });
  addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'autodeck-location' && Number.isFinite(d.lat) && Number.isFinite(d.lng)) {
      fromCar = true;
      last = fix(d);
      for (const w of watchers.values()) w.ok(last);
    } else if (d.type === 'autodeck-text') {
      typeInto(d.text ?? '', d.submit === true);
    } else if (d.type === 'autodeck-pan' && window.__autodeckMap) {
      // The car's swipes reach the Home page, not this frame: the page passes them on.
      window.__autodeckMap.panBy([d.dx || 0, d.dy || 0], { duration: 0 });
    } else if (d.type === 'autodeck-keyboard-closed') {
      if (document.activeElement && isText(document.activeElement)) document.activeElement.blur();
    }
  });
  const shim = {
    watchPosition(ok, err, opts) {
      const id = nextId++;
      const w = { ok, err, opts, realId: null };
      watchers.set(id, w);
      if (last) setTimeout(() => ok(last), 0);
      // No word from the car (an old AutoDeck, or the page opened on its own): the browser's own location.
      setTimeout(() => {
        if (!fromCar && watchers.has(id) && real) w.realId = real.watchPosition(ok, err, opts);
      }, framed ? 4000 : 0);
      return id;
    },
    clearWatch(id) {
      const w = watchers.get(id);
      if (w?.realId != null) real.clearWatch(w.realId);
      watchers.delete(id);
    },
    getCurrentPosition(ok, err, opts) {
      if (last) return setTimeout(() => ok(last), 0);
      const id = shim.watchPosition((p) => { shim.clearWatch(id); ok(p); }, err, opts);
    },
  };
  try { Object.defineProperty(navigator, 'geolocation', { value: shim, configurable: true }); } catch { /* keep the real one */ }

  // ---- Typing through the car keyboard ----
  const isText = (el) => el instanceof HTMLInputElement
    ? ['text', 'search', 'email', 'url', 'tel', 'number', ''].includes(el.type)
    : el instanceof HTMLTextAreaElement;
  let field = null;
  // No phone keyboard on the car screen: the car keyboard does the typing. Set before the tap focuses the field.
  if (framed) {
    const noSoftKeyboard = (el) => { if (isText(el)) el.inputMode = 'none'; };
    document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('input, textarea').forEach(noSoftKeyboard));
    document.addEventListener('pointerdown', (e) => noSoftKeyboard(e.target), true);
  }
  document.addEventListener('focusin', (e) => {
    if (!framed || !isText(e.target)) return;
    field = e.target;
    toParent({ type: 'autodeck-keyboard', open: true, value: field.value, hint: field.placeholder || '' });
  });
  document.addEventListener('focusout', (e) => {
    if (!framed || e.target !== field) return;
    // Only when focus leaves for good (the car keyboard steals no focus inside this page).
    setTimeout(() => { if (document.activeElement !== field) toParent({ type: 'autodeck-keyboard', open: false }); }, 0);
  });
  function typeInto(text, submit) {
    const el = field && document.contains(field) ? field : document.getElementById('search-input');
    if (!el) return;
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    if (submit) {
      for (const type of ['keydown', 'keyup']) el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      el.form?.requestSubmit?.();
    }
  }

  // A touch on the map: the Home page then passes the next swipes here instead of turning its page.
  addEventListener('pointerdown', () => toParent({ type: 'autodeck-touch' }), true);
  addEventListener('load', () => toParent({ type: 'autodeck-maps-ready' }));
})();
