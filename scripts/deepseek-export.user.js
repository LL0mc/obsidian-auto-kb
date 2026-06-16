// ==UserScript==
// @name         DeepSeek Chat Exporter (Adapted for KB)
// @namespace    http://tampermonkey.net/
// @version      2.4.0
// @description  Export DeepSeek chat to structured Markdown for KB ingestion
// @author       Adapted for Obsidian KB
// @match        https://chat.deepseek.com/*
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  var API_HOST = 'https://chat.deepseek.com';
  var OBSIDIAN_API = 'https://127.0.0.1:27124';
  var OBSIDIAN_TOKEN = 'YOUR_OBSIDIAN_TOKEN_HERE';

  var SEL = {
    userMessage: '._9663006',
    userContent: '.fbb737a4',
    aiMessage: '._4f9bf79',
    thinkTime: '._5255ff8._4d41763',
    thinkChain: '.e1675d8b',
    answerMain: '.ds-markdown',
  };

  // === debug panel ===
  var debugEl = null;
  function log(msg) {
    if (!debugEl || !document.body.contains(debugEl)) {
      debugEl = document.createElement('div');
      debugEl.id = 'ds-debug';
      Object.assign(debugEl.style, {
        position: 'fixed', left: '16px', bottom: '160px', zIndex: 999999,
        padding: '8px 12px', background: 'rgba(0,0,0,0.85)', color: '#0f0',
        border: '1px solid #3964fe', borderRadius: '6px',
        fontSize: '11px', fontFamily: 'monospace', lineHeight: '1.5',
        whiteSpace: 'pre-wrap', maxWidth: '360px', maxHeight: '200px',
        overflowY: 'auto',
      });
      document.body.appendChild(debugEl);
    }
    var t = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    debugEl.textContent = (debugEl.textContent ? debugEl.textContent + '\n' : '') + t;
    debugEl.scrollTop = debugEl.scrollHeight;
  }

  // === Passive fetch logger (discovers API URLs the page calls) ===
  (function () {
    var orig = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/api/') !== -1 && url.indexOf('chat_history') !== -1) {
        log('[INTERCEPT] page called: ' + url.slice(0, 200));
      }
      return orig(input, init);
    };
  })();

  // === Core ===
  function getAuthToken() {
    log('localStorage keys: ' + Object.keys(localStorage).join(', '));
    var raw = localStorage.getItem('userToken');
    if (!raw) { log('userToken not found'); return null; }
    log('userToken raw[:50]: ' + raw.slice(0, 50));
    try {
      var parsed = JSON.parse(raw);
      log('userToken parsed keys: ' + Object.keys(parsed).join(', '));
      if (parsed.value) { log('token value length: ' + parsed.value.length); return parsed.value; }
      log('no .value in parsed token');
      return null;
    } catch (e) {
      log('token parse error: ' + e.message);
      return null;
    }
  }

  function getSessionId() {
    var url = window.location.href;
    log('URL: ' + url);
    var m = url.match(/\/s\/([^/?]+)/);
    if (m) { log('sessionId: ' + m[1]); return m[1]; }
    log('sessionId NOT FOUND in URL');
    return null;
  }

  function getChatTitle(sessionData) {
    if (sessionData && sessionData.chat_session && sessionData.chat_session.title) {
      return sessionData.chat_session.title;
    }
    var m = window.location.href.match(/\/s\/([^/?]+)/);
    return m ? 'DeepSeek Chat (' + m[1].slice(0, 8) + ')' : 'DeepSeek Chat';
  }

  function tryAPIs(sessionId, token, altToken, urls, idx) {
    if (idx >= urls.length) return Promise.reject(new Error('All endpoints failed'));
    var url = urls[idx];
    log('Trying [' + idx + ']: ' + url);
    // Try with both tokens
    var bearer = altToken && idx >= 3 ? altToken : token;
    return fetch(url, {
      credentials: 'include',
      headers: {
        'Authorization': 'Bearer ' + bearer,
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      }
    }).then(function (r) {
      log('Status ' + idx + ': ' + r.status + ' ' + r.statusText);
      // Show response headers
      var ct = r.headers.get('content-type') || 'none';
      log('Content-Type[' + idx + ']: ' + ct);
      return r.text().then(function (body) {
        var preview = body.slice(0, 300).replace(/\n/g, ' ').trim();
        log('Body[' + idx + '] preview: ' + preview);
        if (/^\s*</.test(body)) throw new Error('HTML response (not JSON)');
        try {
          var json = JSON.parse(body);
          if (json.data && json.data.biz_data && json.data.biz_data.chat_messages) {
            var count = json.data.biz_data.chat_messages.length;
            log('SUCCESS: ' + count + ' messages');
            return json.data.biz_data;
          }
          if (json.data && json.data.chat_messages) {
            var count2 = json.data.chat_messages.length;
            log('SUCCESS (alt format): ' + count2 + ' messages');
            return json.data;
          }
          if (Array.isArray(json.chat_messages)) {
            log('SUCCESS (flat): ' + json.chat_messages.length + ' msgs, trying alt');
            return json;
          }
          throw new Error('Unexpected JSON structure, keys: ' + Object.keys(json).join(','));
        } catch (e) {
          if (e.message === 'HTML response (not JSON)') throw e;
          throw new Error('JSON error: ' + e.message);
        }
      });
    }).catch(function (err) {
      log('Endpoint [' + idx + '] failed: ' + err.message);
      return tryAPIs(sessionId, token, altToken, urls, idx + 1);
    });
  }

  function apiFetchMessages(sessionId, token) {
    // Check for alternative auth tokens
    var altToken = null;
    try { var sj = localStorage.getItem('settingsJwt'); if (sj) { log('settingsJwt[:40]: ' + sj.slice(0, 40)); altToken = sj; } } catch (e) {}
    try { var st = localStorage.getItem('sessionToken'); if (st) log('sessionToken[:40]: ' + st.slice(0, 40)); } catch (e) {}
    try { var at = localStorage.getItem('authToken'); if (at) log('authToken[:40]: ' + at.slice(0, 40)); } catch (e) {}

    var sid = encodeURIComponent(sessionId);
    var endpoints = [
      API_HOST + '/api/v0/chat_history_messages?chat_session_id=' + sid + '&cache_version=0',
      API_HOST + '/api/v0/chat_history_messages?chat_session_id=' + sid,
      API_HOST + '/api/v0/chat/history_messages?chat_session_id=' + sid,
      API_HOST + '/api/chat_session/history?chat_session_id=' + sid,
      API_HOST + '/api/chat/history?chat_session_id=' + sid,
      API_HOST + '/api/conversation/history?session_id=' + sid,
      API_HOST + '/api/v0/chat_session/fetch_page?lte_cursor.pinned=false&limit=1',
    ];
    return tryAPIs(sessionId, token, altToken, endpoints, 0);
  }

  function apiFetchMessages(sessionId, token) {
    // Also log alternative tokens for debugging
    try { var sj = localStorage.getItem('settingsJwt'); if (sj) log('settingsJwt[:30]: ' + sj.slice(0, 30)); } catch (e) {}
    try { var st = localStorage.getItem('sessionToken'); if (st) log('sessionToken[:30]: ' + st.slice(0, 30)); } catch (e) {}

    var endpoints = [
      API_HOST + '/api/v0/chat_history_messages?chat_session_id=' + encodeURIComponent(sessionId) + '&cache_version=0',
      API_HOST + '/api/v0/chat_history_messages?chat_session_id=' + encodeURIComponent(sessionId),
      API_HOST + '/api/v1/chat_history_messages?chat_session_id=' + encodeURIComponent(sessionId),
      API_HOST + '/api/chat/history?chat_session_id=' + encodeURIComponent(sessionId),
      API_HOST + '/api/chat_session/history?chat_session_id=' + encodeURIComponent(sessionId),
    ];
    return tryAPIs(sessionId, token, endpoints, 0);
  }

  function apiToMessages(bizData) {
    if (!bizData || !Array.isArray(bizData.chat_messages) || bizData.chat_messages.length === 0) return null;
    return bizData.chat_messages.map(function (m) {
      if (m.role === 'user') return { role: 'user', content: m.content || '' };
      return { role: 'assistant', content: m.content || '', thinkingMd: m.chain_of_thought || '', thinkingText: '' };
    });
  }

  function cleanText(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }

  function collectFromDOM() {
    var msgs = [];
    var userEls = document.querySelectorAll(SEL.userMessage);
    var aiEls = document.querySelectorAll(SEL.aiMessage);
    log('DOM user els: ' + userEls.length + ', ai els: ' + aiEls.length);
    var all = [];
    userEls.forEach(function (el) { all.push({ el: el, role: 'user' }); });
    aiEls.forEach(function (el) { all.push({ el: el, role: 'assistant' }); });
    all.sort(function (a, b) {
      var p = a.el.compareDocumentPosition(b.el);
      return (p & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : (p & Node.DOCUMENT_POSITION_PRECEDING) ? 1 : 0;
    });
    for (var i = 0; i < all.length; i++) {
      var item = all[i];
      if (item.role === 'user') {
        var ce = item.el.querySelector(SEL.userContent);
        if (ce && ce.textContent.trim()) msgs.push({ role: 'user', content: ce.textContent.trim() });
      } else {
        var msg = { role: 'assistant', content: '', thinkingText: '', thinkingMd: '' };
        var te = item.el.querySelector(SEL.thinkTime);
        if (te) msg.thinkingText = cleanText(te);
        var tke = item.el.querySelector(SEL.thinkChain);
        if (tke) msg.thinkingMd = tke.textContent.replace(/\s+/g, ' ').trim();
        var ae = item.el.querySelector(SEL.answerMain);
        if (ae && !ae.closest(SEL.thinkChain)) msg.content = ae.textContent.replace(/\s+/g, ' ').trim();
        if (msg.content || msg.thinkingMd) msgs.push(msg);
      }
    }
    log('DOM collected: ' + msgs.length + ' messages');
    return msgs;
  }

  function findScrollContainer() {
    var areas = document.querySelectorAll('.ds-scroll-area--enabled, .ds-scroll-area');
    for (var si = 0; si < areas.length; si++) { if (areas[si].scrollHeight > areas[si].clientHeight + 2) { log('scroll container: .ds-scroll-area'); return areas[si]; } }
    var allDivs = document.querySelectorAll('div');
    for (var di = 0; di < allDivs.length; di++) {
      var d = allDivs[di];
      if (d.scrollHeight > d.clientHeight + 2) {
        var s = getComputedStyle(d);
        if (s.overflowY === 'auto' || s.overflowY === 'scroll') { log('scroll container: overflowY=' + s.overflowY); return d; }
      }
    }
    log('no scroll container found');
    return null;
  }

  function doScrollLoad() {
    return new Promise(function (resolve) {
      var sc = findScrollContainer();
      if (!sc) { resolve([]); return; }

      log('scrollHeight=' + sc.scrollHeight + ', clientHeight=' + sc.clientHeight);
      var allMsgs = new Map();
      var savedPos = sc.scrollTop;
      var startedAt = Date.now();
      var prevPos = -1;
      var stuckCount = 0;

      function done() {
        sc.scrollTop = savedPos;
        var result = Array.from(allMsgs.values());
        log('scroll done: ' + result.length + ' unique msgs');
        resolve(result);
      }

      function tick() {
        if (Date.now() - startedAt > 45000) { log('scroll timeout'); done(); return; }
        var fromDom = collectFromDOM();
        fromDom.forEach(function (m) { allMsgs.set(m.role + '::' + m.content.slice(0, 500), m); });
        var cur = sc.scrollTop;
        sc.scrollTop = cur - Math.max(sc.clientHeight * 0.6, 100);
        if (sc.scrollTop === prevPos) { stuckCount++; } else { stuckCount = 0; }
        prevPos = sc.scrollTop;
        if (sc.scrollTop <= 2 || stuckCount > 5) { done(); }
      }

      sc.scrollTop = sc.scrollHeight;
      var timer = setInterval(tick, 500);
      setTimeout(function () { clearInterval(timer); done(); }, 46000);
    });
  }

  function getOrderedMessages() {
    return new Promise(function (resolve) {
      var sessionId = getSessionId();
      var token = getAuthToken();

      if (sessionId && token) {
        log('Strategy 1: API call');
        apiFetchMessages(sessionId, token).then(function (bizData) {
          var msgs = apiToMessages(bizData);
          if (msgs && msgs.length > 0) { log('API SUCCESS: ' + msgs.length + ' msgs'); resolve({ messages: msgs, title: getChatTitle(bizData), source: 'api' }); return; }
          log('API returned 0 messages, fallback');
          fallbackWithScroll(resolve);
        }).catch(function (err) {
          log('API FAILED: ' + err.message);
          fallbackWithScroll(resolve);
        });
      } else {
        log('No sessionId or token, fallback');
        fallbackWithScroll(resolve);
      }
    });
  }

  function fallbackWithScroll(resolve) {
    var fromDom = collectFromDOM();
    if (fromDom.length > 4) { log('DOM fallback: ' + fromDom.length + ' msgs'); resolve({ messages: fromDom, title: getChatTitle(null), source: 'dom' }); return; }
    log('DOM only ' + fromDom.length + ' msgs, scrolling...');
    doScrollLoad().then(function (scrolled) {
      if (scrolled.length > fromDom.length) { resolve({ messages: scrolled, title: getChatTitle(null), source: 'dom+scroll' });
      } else if (fromDom.length > 0) { resolve({ messages: fromDom, title: getChatTitle(null), source: 'dom' });
      } else { resolve({ messages: [], title: getChatTitle(null), source: 'none' }); }
    });
  }

  function generateMd(result) {
    if (!result || !result.messages || result.messages.length === 0) return '';
    var md = '# ' + result.title + '\nSource: ' + window.location.href + '\n\n';
    for (var i = 0; i < result.messages.length; i++) {
      var msg = result.messages[i];
      if (msg.role === 'user') { md += '## User\n\n' + msg.content + '\n\n---\n\n'; } else {
        md += '## Assistant\n\n';
        if (msg.thinkingText) md += '_' + msg.thinkingText + '_\n\n';
        if (msg.thinkingMd) md += '> ' + msg.thinkingMd.replace(/\n/g, '\n> ') + '\n\n';
        md += msg.content + '\n\n---\n\n';
      }
    }
    return md;
  }

  function saveMd(md) {
    var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    var name = 'deepseek_' + ts + '.md';
    var path = 'kb/raw/deepseek/' + name;
    return fetch(OBSIDIAN_API + '/vault/' + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + OBSIDIAN_TOKEN, 'Content-Type': 'text/markdown' },
      body: md,
    }).then(function (r) { if (r.ok) return 'Saved to ' + path; throw new Error('HTTP ' + r.status); }).catch(function () {
      try { navigator.clipboard.writeText(md); } catch (e) {}
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
      a.download = name;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      return 'Obsidian offline - downloaded instead';
    });
  }

  function addButton() {
    if (document.getElementById('ds-export-btn')) return;
    var btn = document.createElement('div');
    btn.id = 'ds-export-btn';
    btn.textContent = 'Export';
    Object.assign(btn.style, {
      position: 'fixed', left: '16px', bottom: '100px', zIndex: 999999,
      padding: '8px 14px', background: '#3964fe', color: '#fff', border: 'none',
      borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '500',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)', userSelect: 'none', lineHeight: '1',
    });
    btn.addEventListener('mouseenter', function () { btn.style.background = '#2851e0'; });
    btn.addEventListener('mouseleave', function () { btn.style.background = '#3964fe'; });
    btn.addEventListener('click', function () {
      btn.textContent = 'Working...';
      log('=== Export started ===');
      getOrderedMessages().then(function (result) {
        if (!result.messages || result.messages.length === 0) { btn.textContent = 'Export'; log('FAIL: no messages'); alert('No messages found. Check debug panel (left side).'); return; }
        var md = generateMd(result);
        var count = result.messages.length;
        btn.textContent = 'Saving...';
        log('Export result: ' + count + ' msgs via ' + result.source);
        saveMd(md).then(function (msg) {
          btn.textContent = 'Export';
          alert(msg + ' (' + count + ' msgs via ' + result.source + ')\n\nDebug panel shows step-by-step details.');
        });
      });
    });
    document.body.appendChild(btn);
  }

  var id = setInterval(function () {
    if (document.querySelector(SEL.userMessage) || document.querySelector(SEL.aiMessage)) {
      clearInterval(id);
      addButton();
    }
  }, 500);

})();
