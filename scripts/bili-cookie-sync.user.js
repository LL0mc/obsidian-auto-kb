// ==UserScript==
// @name         B站 Cookie 同步 → Obsidian
// @namespace    https://github.com/LL0mc
// @version      1.0
// @description  在 bilibili.com 一键将 SESSDATA 同步到 Obsidian 仓库
// @author       opencode
// @match        *://*.bilibili.com/*
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict'

    const API_BASE = 'https://127.0.0.1:27124'
    const TOKEN   = 'YOUR_OBSIDIAN_TOKEN_HERE'
    const COOKIE_PATH = 'kb/raw/bilibili/_cookie.json'

    function getSessdata() {
        const m = document.cookie.match(/SESSDATA=([^;]+)/)
        return m ? m[1] : null
    }

    function syncCookie() {
        const sess = getSessdata()
        if (!sess) {
            flash('未登录 B站', 'red')
            return
        }
        const payload = {
            sessdata: sess,
            updated_at: new Date().toISOString(),
            from_url: location.href
        }
        GM_xmlhttpRequest({
            method: 'PUT',
            url: API_BASE + '/vault/' + COOKIE_PATH,
            headers: {
                'Authorization': 'Bearer ' + TOKEN,
                'Content-Type': 'text/plain'
            },
            data: JSON.stringify(payload, null, 2),
            onload: r => {
                if (r.status === 200 || r.status === 201) {
                    flash('Cookie 已同步 ✓', 'green')
                } else {
                    flash('失败: ' + r.status, 'red')
                }
            },
            onerror: () => flash('请求失败', 'red')
        })
    }

    // -- UI: floating button --
    const btn = document.createElement('div')
    btn.textContent = '⟳ Cookie'
    Object.assign(btn.style, {
        position: 'fixed', bottom: '80px', right: '20px', zIndex: 99999,
        background: '#00a1d6', color: '#fff', padding: '8px 14px',
        borderRadius: '20px', cursor: 'pointer', fontFamily: 'sans-serif',
        fontSize: '13px', boxShadow: '0 2px 8px rgba(0,0,0,.3)',
        userSelect: 'none'
    })
    btn.onclick = syncCookie
    document.body.appendChild(btn)

    function flash(msg, color) {
        const el = document.createElement('div')
        el.textContent = msg
        Object.assign(el.style, {
            position: 'fixed', top: '20px', right: '20px', zIndex: 99999,
            background: color || '#333', color: '#fff', padding: '10px 20px',
            borderRadius: '8px', fontFamily: 'monospace', fontSize: '14px',
            boxShadow: '0 2px 12px rgba(0,0,0,.3)'
        })
        document.body.appendChild(el)
        setTimeout(() => el.remove(), 2500)
    }
})()
