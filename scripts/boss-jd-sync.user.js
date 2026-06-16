// ==UserScript==
// @name         Boss直聘 → Obsidian JD 同步器
// @namespace    https://github.com/LL0mc
// @version      1.3
// @description  一键将Boss直聘岗位JD保存到Obsidian求职助理 vault targets/
// @author       opencode
// @match        https://www.zhipin.com/job_detail/*
// @match        https://www.zhipin.com/web/geek/job*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict'

    const OAPI = 'https://127.0.0.1:27124'
    const OAPI_KEY = GM_getValue('obsidian_token', 'YOUR_OBSIDIAN_TOKEN_HERE')
    const TARGET_DIR = 'w_求职AI助理/targets'

    let btn = null, logEl = null

    function initUI() {
        if (document.getElementById('boss-ob-panel')) return
        const panel = document.createElement('div')
        panel.id = 'boss-ob-panel'
        panel.innerHTML = `
<div id="boss-ob-btn" style="position:fixed;bottom:100px;right:20px;z-index:99999;background:#5e9cf3;color:#fff;padding:10px 16px;border-radius:24px;cursor:pointer;font:bold 13px/1 sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.35);user-select:none">📋 → Obsidian</div>
<div id="boss-ob-dbg" style="position:fixed;bottom:150px;right:20px;z-index:99999;background:#555;color:#fff;padding:6px 10px;border-radius:16px;cursor:pointer;font:11px/1 sans-serif;box-shadow:0 1px 6px rgba(0,0,0,.3);display:none">🔍 Dump Page</div>
<div id="boss-ob-log" style="position:fixed;bottom:190px;right:20px;z-index:99999;background:#1a1a2e;color:#e0e0e0;padding:12px 16px;border-radius:10px;font:12px/1.6 monospace;min-width:340px;max-width:440px;max-height:350px;overflow-y:auto;box-shadow:0 2px 12px rgba(0,0,0,.4);display:none"></div>`
        document.body.appendChild(panel)
        btn = document.getElementById('boss-ob-btn')
        logEl = document.getElementById('boss-ob-log')
        const dbg = document.getElementById('boss-ob-dbg')
        btn.onclick = onSyncClick
        dbg.onclick = onDump
        // Show debug button on detail pages
        if (isDetailPage()) dbg.style.display = 'block'
    }

    function log(m, ok) {
        if (!logEl) return
        logEl.style.display = 'block'
        const c = ok === true ? '#4caf50' : ok === false ? '#f44336' : '#ffa726'
        logEl.innerHTML += `<div style="color:${c};padding:2px 0">${m}</div>`
        logEl.scrollTop = logEl.scrollHeight
    }
    function logClear() { if (logEl) { logEl.innerHTML = ''; logEl.style.display = 'none' } }

    GM_registerMenuCommand('设置 Obsidian Token...', () => {
        const curr = GM_getValue('obsidian_token', OAPI_KEY)
        const v = prompt('粘贴 Obsidian Local REST API Token', curr)
        if (v !== null && v.trim()) { GM_setValue('obsidian_token', v.trim()); alert('已保存！') }
    })

    function getJobId() {
        const m = location.pathname.match(/job_detail\/([^.]+)/)
        return m ? m[1] : null
    }

    function isDetailPage() {
        return /job_detail/.test(location.pathname)
    }

    /* ====== DEBUG: dump page structure to file ====== */
    function onDump() {
        const lines = []
        lines.push('URL: ' + location.href)
        lines.push('Title: ' + document.title)
        lines.push('')
        lines.push('=== PAGE TEXT (first 8000 chars) ===')
        lines.push((document.body.innerText || '').slice(0, 8000))
        lines.push('')
        lines.push('=== META TAGS ===')
        for (const m of document.querySelectorAll('meta')) {
            const name = m.getAttribute('name') || m.getAttribute('property') || ''
            const content = m.getAttribute('content') || ''
            if (name && content) lines.push(name + ': ' + content.slice(0, 300))
        }
        lines.push('')
        lines.push('=== JSON-LD ===')
        for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
            lines.push(s.textContent.slice(0, 1500))
        }
        lines.push('')
        lines.push('=== SCRIPTS with job data ===')
        for (const s of document.querySelectorAll('script')) {
            const t = (s.textContent || '').slice(0, 600)
            if (/job|position|salary|招聘|岗位/.test(t)) lines.push((s.id || '?') + ': ' + t)
        }
        lines.push('')
        lines.push('=== ALL SCRIPT IDs ===')
        for (const s of document.querySelectorAll('script')) {
            if (s.id) lines.push(s.id)
        }

        const text = lines.join('\n')
        const a = document.createElement('a')
        a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
        a.download = 'boss-page-dump.txt'
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 5000)
        log('✅ 页面结构已导出为 boss-page-dump.txt', true)
    }

    /* ====== EXTRACTION ====== */

    /* Strategy 1: Boss直聘 API */
    async function fetchFromApi(jobId) {
        try {
            const r = await fetch(`https://www.zhipin.com/wapi/zpgeek/job/detail.json?jobId=${jobId}`, {
                credentials: 'include',
                headers: { 'Referer': 'https://www.zhipin.com/' }
            })
            if (!r.ok) return null
            const d = await r.json()
            if (d.code === 0 && d.zpData) return d.zpData
            if (d.code === 0 && d.data) return d.data
            return null
        } catch (_) {
            return null
        }
    }

    /* Strategy 1b: extract company from JSON-LD (most accurate) */
    function extractCompanyFromJsonLd() {
        for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
            try {
                const data = JSON.parse(s.textContent)
                const item = data.hiringOrganization || (data['@graph'] && data['@graph'].find(g => g.hiringOrganization))
                if (item) {
                    const name = item.hiringOrganization?.name || item.name
                    if (name) return name
                }
                // Some Boss pages nest it differently
                if (data.name && data.description) {
                    const org = data.hiringOrganization
                    if (org && org.name) return org.name
                }
            } catch (_) { /* skip invalid JSON */ }
        }
        return ''
    }

    /* Strategy 2: extract from visible page text + regex */
    function extractFromText() {
        const text = document.body.innerText || ''
        const title = document.title.replace(/ - Boss直聘$/, '').replace(/ - 招聘$/, '').trim()

        // Job role: try <title> first, then first large heading
        let role = title
        const h1 = document.querySelector('h1')
        if (h1 && h1.textContent.trim().length > 1) role = h1.textContent.trim()

        // Company: JSON-LD → DOM → regex
        let company = extractCompanyFromJsonLd()
        // 2. DOM selectors
        if (!company) {
            const coEl = document.querySelector('.job-detail-header [class*="company"] a, .job-detail-header [class*="name"], .company-info .company-name, .job-header .company')
            if (coEl) company = coEl.textContent.trim()
        }
        // 3. Look for English brand names
        if (!company) {
            const brandMatch = text.match(/\b([A-Z][a-zA-Z0-9_]{2,20}(?:\s[A-Z][a-zA-Z0-9_]{2,20})?)\s*(?:正在热招|热招|招聘|[\d.]+[kK])/)
            if (brandMatch) company = brandMatch[1].trim()
        }
        // 4. Chinese name near salary
        if (!company) {
            const cnMatch = text.match(/([^\n]{2,15}(?:科技|技术|有限|股份|集团|工作室))\s*(?:正在热招|热招|招聘|[\d.]+[kK])/)
            if (cnMatch) company = cnMatch[1].trim()
        }
        // 5. General fallback: first non-slogan line
        if (!company) {
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.length >= 2 && l.length <= 20)
            const coLine = lines.find(l => /[A-Za-z0-9_]/.test(l) && !/职责|要求|负责|任职|学历|经验|薪资|地址/.test(l))
            if (coLine) company = coLine
        }

        // Salary
        let salary = ''
        const salMatch = text.match(/(\d{2,3}[kK]?\s*[-~–]\s*\d{2,3}[kK]?(?:·\d+[薪])?)/)
        if (salMatch) salary = salMatch[1]

        // Location
        let location = ''
        const locMatch = text.match(/(?:工作地址|地点|位置)[：:]\s*([^\n]+)/)
        if (locMatch) location = locMatch[1].trim()
        if (!location) {
            const locMatch2 = text.match(/(上海|北京|深圳|广州|杭州|成都|武汉|南京|苏州|重庆)[^\n]{0,30}(?:区|路|大厦|广场|中心)/)
            if (locMatch2) location = locMatch2[0].trim()
        }

        // JD text: find the longest section that looks like job description
        let jdText = ''
        const sections = text.split(/\n{2,}/)
        let best = ''
        for (const s of sections) {
            const t = s.trim()
            if (t.length > 200 && (t.includes('职责') || t.includes('要求') || t.includes('负责') || t.includes('任职')) && t.length > best.length) {
                best = t
            }
        }
        if (best) jdText = best
        if (!jdText) {
            // Fallback: take the longest paragraph
            const paras = text.split('\n').filter(p => p.trim().length > 80)
            if (paras.length) jdText = paras.sort((a, b) => b.length - a.length)[0].trim()
        }

        // Tags
        const tags = []
        for (const pat of [/(\d{1,2}年[^\n]{0,10})/, /(本科|硕士|博士|大专)/, /(经验[^\n]{0,10})/]) {
            const m = text.match(pat)
            if (m && !tags.includes(m[1].trim())) tags.push(m[1].trim())
        }

        return { role, company, salary, location, tags, jdText }
    }

    /* ====== BUILD MARKDOWN ====== */
    function buildMd(data) {
        const today = new Date().toISOString().slice(0, 10)
        const coShort = (data.company || '').replace(/[（(].*[）)]/g, '').trim() || 'Unknown'
        const roleShort = (data.role || '').replace(/[<>:"/\\|?*]/g, '').trim()
        let fname = `Auto-${coShort}-${roleShort}`.replace(/\s+/g, ' ')
        fname = fname.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim()
        if (fname.length > 120) fname = fname.slice(0, 120)

        const lines = ['---']
        lines.push(`company: ${data.company || ''}`)
        lines.push(`role: ${data.role || ''}`)
        lines.push(`category: AI产品经理`)
        lines.push(`source: Boss直聘`)
        lines.push(`url: ${data.url || location.href}`)
        lines.push(`date_searched: ${today}`)
        lines.push(`status: 待评估`)
        lines.push(`location: ${data.location || ''}`)
        lines.push(`salary: ${data.salary || ''}`)
        lines.push(`tags:`)
        const tags = data.tags && data.tags.length ? data.tags : ['AI']
        for (const t of tags.slice(0, 8)) {
            lines.push(`  - ${t.trim()}`)
        }
        lines.push('---')
        lines.push('')
        lines.push(`# ${data.role || ''}`)
        lines.push('')
        if (data.company) lines.push(`**公司**: ${data.company}`)
        if (data.salary) lines.push(`**薪资**: ${data.salary}`)
        if (data.location) lines.push(`**地点**: ${data.location}`)
        lines.push(`**来源**: [Boss直聘](${data.url || location.href})`)
        lines.push(`**抓取日期**: ${today}`)
        lines.push('')
        lines.push('---')
        lines.push('')
        if (data.jdText) {
            lines.push('## 职位描述')
            lines.push('')
            lines.push(data.jdText)
            lines.push('')
        }
        lines.push('---')
        lines.push(`_从 Boss直聘 自动抓取于 ${today}_`)
        lines.push(`_文件名: ${fname}.md_`)

        return { md: lines.join('\n'), fname }
    }

    /* ====== SYNC ====== */
    async function pushToObsidian(md, fname) {
        const path = `${TARGET_DIR}/${fname}.md`
        const token = GM_getValue('obsidian_token', OAPI_KEY)
        try {
            const res = await fetch(`${OAPI}/vault/${encodeURI(path)}`, {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'text/markdown'
                },
                body: md
            })
            if (res.ok) return { ok: true, path }
            const text = await res.text().catch(() => '')
            return { ok: false, msg: `HTTP ${res.status}: ${text.slice(0, 100)}` }
        } catch (e) {
            return { ok: false, msg: `连接失败: ${e.message}` }
        }
    }

    function downloadFallback(md, fname) {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }))
        a.download = `${fname}.md`
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    }

    /* ====== MAIN ====== */
    async function onSyncClick() {
        logClear()
        if (!isDetailPage()) {
            log('不在职位详情页', false)
            return
        }

        const jobId = getJobId()
        if (!jobId) {
            log('无法解析职位 ID', false)
            return
        }
        log(`职位 ID: ${jobId}`)

        let data = null

        // Strategy 1: API
        log('尝试 Boss直聘 API...')
        const apiData = await fetchFromApi(jobId)
        if (apiData) {
            log('✓ API 成功', true)
            data = {
                role: apiData.jobName || apiData.job?.name || apiData.name || '',
                company: apiData.brandName || apiData.brand?.brandName || apiData.company?.name || '',
                salary: apiData.salaryDesc || apiData.salary || apiData.job?.salaryDesc || '',
                location: apiData.cityName || apiData.address || apiData.job?.cityName || '',
                tags: [
                    ...(apiData.jobLabels || []),
                    ...(apiData.skillLabels || []),
                    apiData.experienceDesc,
                    apiData.degreeDesc,
                    apiData.experience,
                    apiData.degree
                ].filter(Boolean),
                jdText: apiData.jobDetail || apiData.job?.detail || apiData.detail || apiData.description || '',
                url: location.href
            }
            log(`✓ 职位: ${data.role}`, true)
            if (data.company) log(`✓ 公司: ${data.company}`, true)
        }

        // Strategy 2: Text regex
        if (!data || !data.role) {
            log('API 不可用，尝试文本解析...')
            data = extractFromText()
            data.url = location.href
            if (data.role) log(`✓ 职位: ${data.role}`, true)
            if (data.company) log(`✓ 公司: ${data.company}`, true)
        }

        if (!data || !data.role) {
            log('❌ 无法提取职位信息', false)
            log('💡 点击 "🔍 Dump Page" 按钮导出页面结构给我排查', false)
            return
        }

        log('生成 Markdown...')
        const { md, fname } = buildMd(data)
        log(`✓ 文件名: ${fname}.md`, true)

        log('推送到 Obsidian...')
        const result = await pushToObsidian(md, fname)
        if (result.ok) {
            log(`✓ 已保存到 ${TARGET_DIR}/${fname}.md`, true)
            btn.style.background = '#4caf50'
            setTimeout(() => { btn.style.background = '#5e9cf3' }, 3000)
        } else {
            log(`❌ Obsidian 推送失败: ${result.msg}`, false)
            log('回退: 下载文件...')
            downloadFallback(md, fname)
            log('✓ 已下载（请手动复制到 vault targets/）', true)
        }
    }

    /* ====== INIT ====== */
    if (isDetailPage()) {
        setTimeout(initUI, 1500)
    } else {
        let lastUrl = location.href
        setInterval(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href
                if (isDetailPage()) setTimeout(initUI, 1500)
            }
        }, 800)
    }

    const origPush = history.pushState
    history.pushState = function() { origPush.apply(this, arguments); checkUrl() }
    window.addEventListener('popstate', checkUrl)
    function checkUrl() {
        setTimeout(() => {
            if (isDetailPage()) { initUI(); lastUrl = location.href }
        }, 500)
    }
})()
