// ==UserScript==
// @name         DeepSeek Chat Exporter (Adapted for KB)
// @namespace    http://tampermonkey.net/
// @version      10.0.0
// @description  Export DeepSeek chat to structured Markdown for KB ingestion
// @author       Adapted for Obsidian KB
// @match        https://chat.deepseek.com/*
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // ================================================================
  // Read from IndexedDB (private chat pages)
  // ================================================================
  function fetchFromIndexedDB() {
    return new Promise(function (resolve) {
      try {
        var url = window.location.href;
        var sessionMatch = url.match(/\/chat\/s\/([a-f0-9-]+)/);
        if (!sessionMatch) { resolve(null); return; }

        var sessionId = sessionMatch[1];
        var req = indexedDB.open('deepseek-chat', 1);
        req.onsuccess = function (e) {
          var db = e.target.result;
          var tx = db.transaction('history-message', 'readonly');
          var store = tx.objectStore('history-message');
          var getAll = store.getAll();
          getAll.onsuccess = function () {
            var data = getAll.result;
            var target = data.find(function (d) {
              return d.data && d.data.chat_session && d.data.chat_session.id === sessionId;
            });
            db.close();
            if (!target || !target.data || !target.data.chat_messages) { resolve(null); return; }
            var chatMsgs = target.data.chat_messages;
            var msgById = {};
            chatMsgs.forEach(function (m) { msgById[m.message_id] = m; });
            var latest = chatMsgs.reduce(function (a, b) { return a.message_id > b.message_id ? a : b; });
            var chain = [];
            var cur = latest;
            while (cur) {
              chain.push(cur);
              cur = cur.parent_id ? msgById[cur.parent_id] : null;
            }
            chain.reverse();
            var title = target.data.chat_session ? target.data.chat_session.title : '';
            resolve({ title: title, msgs: extractFromChatMessages(chain) });
          };
          getAll.onerror = function () { db.close(); resolve(null); };
        };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }

  // ================================================================
  // Intercept API responses (share pages + XHR)
  // ================================================================
  var capturedMsgs = [];

  function extractFromResponse(data) {
    if (!data || typeof data !== 'object') return { title: '', msgs: [] };
    var bizData = null;
    try { bizData = data.data.data.biz_data; } catch (e) {}
    if (!bizData) try { bizData = data.data.biz_data; } catch (e) {}
    if (!bizData) try { bizData = data.biz_data; } catch (e) {}
    if (!bizData) try { bizData = data.data; } catch (e) {}

    var title = '';
    if (bizData) {
      if (bizData.chat_session && bizData.chat_session.title) title = bizData.chat_session.title;
      else if (bizData.title) title = bizData.title;
    }

    var rawMsgs = null;
    if (bizData && bizData.messages) rawMsgs = bizData.messages;
    else if (bizData && bizData.chat_messages) rawMsgs = bizData.chat_messages;
    else if (Array.isArray(bizData)) rawMsgs = bizData;
    else if (Array.isArray(data.data)) rawMsgs = data.data;
    else if (Array.isArray(data)) rawMsgs = data;

    if (!rawMsgs || rawMsgs.length === 0) return { title: title, msgs: [] };
    return { title: title, msgs: extractFromChatMessages(rawMsgs) };
  }

  function extractFromChatMessages(rawMsgs) {
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
          var result = extractFromResponse(data);
          if (result.msgs.length > 0) {
            var existing = new Set(capturedMsgs.map(function (m) { return m.content.slice(0, 100); }));
            result.msgs.forEach(function (m) {
              var key = m.content.slice(0, 100);
              if (!existing.has(key)) { capturedMsgs.push(m); existing.add(key); }
            });
          }
        }
      } catch (e) {}
    });
    return origXHRSend.apply(this, arguments);
  };

  // Intercept fetch
  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    return origFetch(input, init).then(function (response) {
      if (response.ok) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('/api/') !== -1) {
          response.clone().json().then(function (data) {
            var result = extractFromResponse(data);
            if (result.msgs.length > 0) {
              var existing = new Set(capturedMsgs.map(function (m) { return m.content.slice(0, 100); }));
              result.msgs.forEach(function (m) {
                var key = m.content.slice(0, 100);
                if (!existing.has(key)) { capturedMsgs.push(m); existing.add(key); }
              });
            }
          }).catch(function () {});
        }
      }
      return response;
    }).catch(function (e) { throw e; });
  };

  // ================================================================
  // UI
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

    function downloadFile(name, content) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }));
      a.download = name;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    }

    var statusEl = null;
    function showStatus(text, color) {
      if (!statusEl) {
        statusEl = document.createElement('div');
        Object.assign(statusEl.style, {
          position: 'fixed', left: '16px', bottom: '72px', zIndex: 999999,
          padding: '4px 10px', borderRadius: '6px', fontSize: '12px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          color: '#fff', background: color || '#333', userSelect: 'none', lineHeight: '1',
          boxShadow: '0 1px 4px rgba(0,0,0,0.2)', transition: 'opacity 0.3s',
        });
        document.body.appendChild(statusEl);
      }
      statusEl.textContent = text;
      statusEl.style.background = color || '#333';
      statusEl.style.opacity = '1';
      clearTimeout(statusEl._timer);
      statusEl._timer = setTimeout(function () { statusEl.style.opacity = '0'; }, 3000);
    }

    function saveMd(md, title) {
      var name;
      if (title) {
        name = title.replace(/[\\/:*?"<>|]/g, '_').substring(0, 80) + '.md';
      } else {
        var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        name = 'deepseek_' + ts + '.md';
      }
      var path = 'kb/raw/deepseek/' + name;

      return fetch('https://127.0.0.1:27124/vault/' + path, {
        method: 'PUT',
        headers: { Authorization: 'Bearer YOUR_OBSIDIAN_TOKEN_HERE', 'Content-Type': 'text/markdown' },
        body: md
      }).then(function (r) {
        if (r.ok) return 'saved';
        throw new Error('Status ' + r.status);
      }).catch(function () {
        downloadFile(name, md);
        return 'downloaded';
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
        btn.textContent = '...';
        btn.style.background = '#888';
        doExport();
      });
      document.body.appendChild(btn);
    }

    function doExport() {
      var isPrivate = /\/chat\/s\//.test(window.location.href);

      if (isPrivate) {
        fetchFromIndexedDB().then(function (result) {
          if (result && result.msgs.length > 0) {
            finish(result.msgs, result.title);
            return;
          }
          // No IndexedDB data: just notify, no share fallback
          btn.textContent = 'Export';
          btn.style.background = '#3964fe';
          showStatus('无数据', '#666');
        });
        return;
      }

      // Share pages: use captured XHR or direct API
      if (capturedMsgs.length > 0) {
        finish(capturedMsgs.slice(), '');
        return;
      }

      var shareMatch = window.location.href.match(/\/share\/([a-z0-9]+)/);
      if (shareMatch) {
        origFetch('/api/v0/share/content?share_id=' + shareMatch[1])
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            var result = data ? extractFromResponse(data) : { title: '', msgs: [] };
            finish(result.msgs, result.title);
          })
          .catch(function () {
            btn.textContent = 'Export';
            btn.style.background = '#3964fe';
            showStatus('获取失败', '#f44336');
          });
        return;
      }

      btn.textContent = 'Export';
      btn.style.background = '#3964fe';
    }

    function finish(msgs, title) {
      if (!msgs.length) {
        btn.textContent = 'Export';
        btn.style.background = '#3964fe';
        showStatus('无消息', '#666');
        return;
      }
      var md = generateMd(msgs);
      saveMd(md, title).then(function (status) {
        var label = status === 'saved' ? '推送' : '下载';
        btn.textContent = msgs.length + ' msgs';
        btn.style.background = '#4caf50';
        showStatus(label + ' ' + msgs.length + ' 条到 Obsidian', '#4caf50');
        setTimeout(function () {
          btn.textContent = 'Export';
          btn.style.background = '#3964fe';
        }, 2000);
      });
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
