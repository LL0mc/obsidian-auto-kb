// ==UserScript==
// @name         DeepSeek Chat Exporter (Adapted for KB)
// @namespace    http://tampermonkey.net/
// @version      8.0.0
// @description  Export DeepSeek chat to structured Markdown for KB ingestion
// @author       Adapted for Obsidian KB
// @match        https://chat.deepseek.com/*
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // ================================================================
  // Phase 1: Intercept XHR + fetch to capture API responses
  // ================================================================
  var capturedMsgs = [];

  function extractFromResponse(data) {
    if (!data || typeof data !== 'object') return [];
    var bizData = null;
    try { bizData = data.data.data.biz_data; } catch (e) {}
    if (!bizData) try { bizData = data.data.biz_data; } catch (e) {}
    if (!bizData) try { bizData = data.biz_data; } catch (e) {}
    if (!bizData) try { bizData = data.data; } catch (e) {}

    var rawMsgs = null;
    if (bizData && bizData.messages) rawMsgs = bizData.messages;
    else if (Array.isArray(bizData)) rawMsgs = bizData;
    else if (Array.isArray(data.data)) rawMsgs = data.data;
    else if (Array.isArray(data)) rawMsgs = data;

    if (!rawMsgs || rawMsgs.length === 0) return [];

    return rawMsgs.map(function (m) {
      var role = (m.role || '').toUpperCase();
      var fragments = m.fragments || [];
      var content = '', thinkingParts = [];

      for (var j = 0; j < fragments.length; j++) {
        var frag = fragments[j];
        var ftype = frag.type || '';
        var c = frag.content || '';
        if (ftype === 'REQUEST') content = c;
        else if (ftype === 'RESPONSE') content = c;
        else if (ftype === 'THINK' && c) thinkingParts.push(c);
      }
      if (!content && m.content) content = m.content;

      if (role === 'USER' && content) return { role: 'user', content: content };
      if (role === 'ASSISTANT') return { role: 'assistant', content: content, thinkingMd: thinkingParts.join('\n\n') };
      return null;
    }).filter(Boolean);
  }

  function mergeMsgs(newMsgs) {
    var existing = new Set(capturedMsgs.map(function (m) { return m.content.slice(0, 100); }));
    newMsgs.forEach(function (m) {
      var key = m.content.slice(0, 100);
      if (!existing.has(key)) {
        capturedMsgs.push(m);
        existing.add(key);
      }
    });
  }

  // Intercept XHR
  var origXHROpen = XMLHttpRequest.prototype.open;
  var origXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._dsUrl = url;
    return origXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      try {
        var url = this._dsUrl || '';
        if (url.indexOf('/api/') !== -1 && this.status === 200) {
          var data = JSON.parse(this.responseText);
          var msgs = extractFromResponse(data);
          if (msgs.length > 0) mergeMsgs(msgs);
        }
      } catch (e) {}
    });
    return origXHRSend.apply(this, arguments);
  };

  // Intercept fetch (backup)
  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    return origFetch(input, init).then(function (response) {
      if (response.ok) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('/api/') !== -1) {
          response.clone().json().then(function (data) {
            var msgs = extractFromResponse(data);
            if (msgs.length > 0) mergeMsgs(msgs);
          }).catch(function () {});
        }
      }
      return response;
    }).catch(function (e) { throw e; });
  };

  // ================================================================
  // Phase 2: UI
  // ================================================================
  function initUI() {
    var SEL = { chatContainer: '.ds-virtual-list-visible-items' };

    function getChatTitle() {
      var m = window.location.href.match(/\/(?:s|share)\/([a-z0-9-]+)/);
      return m ? 'DeepSeek Chat (' + m[1].slice(0, 8) + ')' : 'DeepSeek Chat';
    }

    function generateMd(messages) {
      var md = '# ' + getChatTitle() + '\nSource: ' + window.location.href + '\n\n';
      for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
        if (msg.role === 'user') {
          md += '## User\n\n' + msg.content + '\n\n---\n\n';
        } else {
          md += '## Assistant\n\n';
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

      return fetch('https://127.0.0.1:27124/vault/' + path, {
        method: 'POST',
        headers: { Authorization: 'Bearer YOUR_OBSIDIAN_TOKEN_HERE', 'Content-Type': 'text/markdown' },
        body: md,
      }).then(function (r) { if (r.ok) return 'Saved to ' + path; throw new Error(); }).catch(function () {
        try { navigator.clipboard.writeText(md); } catch (e) {}
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
        a.download = name;
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
        return 'Downloaded ' + name;
      });
    }

    var btn = null;
    function addButton() {
      if (btn) return;
      btn = document.createElement('div');
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
        btn.textContent = 'Exporting...';
        btn.style.background = '#888';

        var msgs = capturedMsgs.slice();
        var source = 'XHR';

        if (msgs.length === 0) {
          // Retry: call API directly
          source = 'API-direct';
          var url = window.location.href;
          var shareMatch = url.match(/\/share\/([a-z0-9]+)/);
          var sessionMatch = url.match(/\/chat\/s\/([a-f0-9-]+)/);

          var apiPromise;
          if (shareMatch) {
            apiPromise = origFetch('/api/v0/share/content?share_id=' + shareMatch[1])
              .then(function (r) { return r.ok ? r.json() : null; });
          } else if (sessionMatch) {
            apiPromise = origFetch('/api/v0/chat/history_messages?chat_session_id=' + sessionMatch[1])
              .then(function (r) { return r.ok ? r.json() : null; });
          } else {
            apiPromise = Promise.resolve(null);
          }

          apiPromise.then(function (data) {
            if (data) msgs = extractFromResponse(data);
            finish();
          }).catch(function () { finish(); });
          return;
        }

        finish();

        function finish() {
          btn.textContent = 'Export';
          btn.style.background = '#3964fe';
          if (!msgs.length) { alert('No messages found.'); return; }
          var md = generateMd(msgs);
          saveMd(md).then(function (r) {
            if (r) alert(r + ' (' + msgs.length + ' msgs via ' + source + ')');
          });
        }
      });
      document.body.appendChild(btn);
    }

    var id = setInterval(function () {
      if (document.querySelector(SEL.chatContainer)) {
        clearInterval(id);
        addButton();
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
