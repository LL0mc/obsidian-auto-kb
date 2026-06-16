// ==UserScript==
// @name         DeepSeek Chat Exporter (Adapted for KB)
// @namespace    http://tampermonkey.net/
// @version      2.2.0
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

  function getAuthToken() {
    var raw = localStorage.getItem('userToken');
    if (!raw) { console.debug('[DSexport] no userToken in localStorage'); return null; }
    try { var v = JSON.parse(raw).value; console.debug('[DSexport] token found, length=' + v.length); return v; }
    catch (e) { console.debug('[DSexport] token parse failed', e); return null; }
  }

  function getSessionId() {
    var m = window.location.href.match(/\/s\/([^/?]+)/);
    if (m) { console.debug('[DSexport] sessionId=' + m[1]); return m[1]; }
    console.debug('[DSexport] no sessionId in URL: ' + window.location.href);
    return null;
  }

  function getChatTitle(sessionData) {
    if (sessionData && sessionData.chat_session && sessionData.chat_session.title) {
      return sessionData.chat_session.title;
    }
    var m = window.location.href.match(/\/s\/([^/?]+)/);
    return m ? 'DeepSeek Chat (' + m[1].slice(0, 8) + ')' : 'DeepSeek Chat';
  }

  function apiFetchMessages(sessionId, token) {
    var url = API_HOST + '/api/v0/chat_history_messages?chat_session_id=' + encodeURIComponent(sessionId) + '&cache_version=0';
    console.debug('[DSexport] fetching ' + url);
    return fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
    }).then(function (r) {
      console.debug('[DSexport] API response status=' + r.status);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (json) {
      if (json.code !== 0 || !json.data || json.data.biz_code !== 0) {
        throw new Error('API error: ' + (json.msg || (json.data && json.data.biz_msg) || 'unknown'));
      }
      var count = (json.data.biz_data.chat_messages || []).length;
      console.debug('[DSexport] API got ' + count + ' messages');
      return json.data.biz_data;
    });
  }

  function apiToMessages(bizData) {
    if (!bizData || !Array.isArray(bizData.chat_messages) || bizData.chat_messages.length === 0) return null;
    return bizData.chat_messages.map(function (m) {
      if (m.role === 'user') {
        return { role: 'user', content: m.content || '' };
      }
      return {
        role: 'assistant',
        content: m.content || '',
        thinkingMd: m.chain_of_thought || '',
        thinkingText: '',
      };
    });
  }

  function cleanText(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }

  function collectFromDOM() {
    var msgs = [];
    var userEls = document.querySelectorAll(SEL.userMessage);
    var aiEls = document.querySelectorAll(SEL.aiMessage);
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
    console.debug('[DSexport] DOM collected ' + msgs.length + ' messages');
    return msgs;
  }

  function findScrollContainer() {
    var areas = document.querySelectorAll('.ds-scroll-area--enabled, .ds-scroll-area');
    for (var si = 0; si < areas.length; si++) { if (areas[si].scrollHeight > areas[si].clientHeight + 2) return areas[si]; }
    return null;
  }

  function doScrollLoad() {
    return new Promise(function (resolve) {
      var sc = findScrollContainer();
      if (!sc) { console.debug('[DSexport] no scroll container found'); resolve([]); return; }

      var allMsgs = new Map();
      var savedPos = sc.scrollTop;
      var maxDuration = 60000;
      var startedAt = Date.now();
      var prevPos = -1;
      var stuckCount = 0;

      function done() {
        sc.scrollTop = savedPos;
        var result = Array.from(allMsgs.values());
        console.debug('[DSexport] scroll done, collected ' + result.length + ' unique messages');
        resolve(result);
      }

      function tick() {
        if (Date.now() - startedAt > maxDuration) { console.debug('[DSexport] scroll timeout'); done(); return; }

        var fromDom = collectFromDOM();
        fromDom.forEach(function (m) {
          allMsgs.set(m.role + '::' + m.content.slice(0, 500), m);
        });

        var cur = sc.scrollTop;
        sc.scrollTop = cur - Math.max(sc.clientHeight * 0.6, 100);

        if (sc.scrollTop === prevPos) { stuckCount++; } else { stuckCount = 0; }
        prevPos = sc.scrollTop;

        if (sc.scrollTop <= 2 || stuckCount > 5) { done(); }
      }

      sc.scrollTop = sc.scrollHeight;
      var timer = setInterval(tick, 400);
      setTimeout(function () { clearInterval(timer); done(); }, maxDuration + 1000);
    });
  }

  function getOrderedMessages() {
    return new Promise(function (resolve) {
      var sessionId = getSessionId();
      var token = getAuthToken();

      if (sessionId && token) {
        console.debug('[DSexport] Strategy 1: API call');
        apiFetchMessages(sessionId, token).then(function (bizData) {
          var msgs = apiToMessages(bizData);
          if (msgs && msgs.length > 0) {
            console.debug('[DSexport] API success: ' + msgs.length + ' messages');
            resolve({ messages: msgs, title: getChatTitle(bizData), source: 'api' });
            return;
          }
          console.debug('[DSexport] API returned empty messages, falling back');
          fallbackWithScroll(resolve);
        }).catch(function (err) {
          console.debug('[DSexport] API failed: ' + err.message);
          fallbackWithScroll(resolve);
        });
      } else {
        var reason = !sessionId ? 'no sessionId' : 'no token';
        console.debug('[DSexport] ' + reason + ', falling back');
        fallbackWithScroll(resolve);
      }
    });
  }

  function fallbackWithScroll(resolve) {
    var fromDom = collectFromDOM();
    if (fromDom.length > 4) {
      resolve({ messages: fromDom, title: getChatTitle(null), source: 'dom' });
      return;
    }
    console.debug('[DSexport] DOM only has ' + fromDom.length + ' msgs, trying scroll');
    doScrollLoad().then(function (scrolled) {
      if (scrolled.length > fromDom.length) {
        resolve({ messages: scrolled, title: getChatTitle(null), source: 'dom+scroll' });
      } else if (fromDom.length > 0) {
        resolve({ messages: fromDom, title: getChatTitle(null), source: 'dom' });
      } else {
        resolve({ messages: [], title: getChatTitle(null), source: 'none' });
      }
    });
  }

  function generateMd(result) {
    if (!result || !result.messages || result.messages.length === 0) return '';
    var md = '# ' + result.title + '\nSource: ' + window.location.href + '\n\n';
    for (var i = 0; i < result.messages.length; i++) {
      var msg = result.messages[i];
      if (msg.role === 'user') {
        md += '## User\n\n' + msg.content + '\n\n---\n\n';
      } else {
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
    }).then(function (r) {
      if (r.ok) return 'Saved to ' + path;
      throw new Error();
    }).catch(function () {
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
      getOrderedMessages().then(function (result) {
        if (!result.messages || result.messages.length === 0) { alert('No messages found.'); return; }
        var md = generateMd(result);
        var count = result.messages.length;
        if (!count) { alert('No messages found.'); return; }
        saveMd(md).then(function (msg) { alert(msg + ' (' + count + ' msgs via ' + result.source + ')'); });
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
