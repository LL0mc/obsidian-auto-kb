"""
DeepSeek conversation exporter.
Uses Playwright to open the conversation page in a real browser,
scans all messages, and saves as structured Markdown.
"""

import sys, re, time, json, os, argparse
from pathlib import Path
from playwright.sync_api import sync_playwright

OBSIDIAN_VAULT = Path(os.environ.get("OBSIDIAN_VAULT_PATH", r"D:\notebooks\Lmc\brew"))
OUTPUT_DIR = "kb/raw/deepseek"

SEL = {
    "userMsg": "._9663006",
    "userContent": ".fbb737a4",
    "aiMsg": "._4f9bf79",
    "thinkTime": "._5255ff8._4d41763",
    "thinkChain": ".e1675d8b",
    "answerWrapper": ".ds-assistant-message-main-content",
    "answerFallback": ".ds-markdown",
    "scrollArea": ".ds-scroll-area--enabled, .ds-scroll-area",
}

def html_to_md(html):
    if not html:
        return ""
    md = html
    md = re.sub(r'<pre><code>([\s\S]*?)</code></pre>', lambda m: '\n```\n' + unescape(m.group(1)) + '\n```\n', md)
    for i in range(1, 5):
        prefix = "#" * i
        md = re.sub(rf'<h{i}[^>]*>', f'\n{prefix} ', md, flags=re.I)
        md = re.sub(rf'</h{i}>', '\n', md, flags=re.I)
    md = re.sub(r'<strong>([\s\S]*?)</strong>', r'**\1**', md, flags=re.I)
    md = re.sub(r'<b>([\s\S]*?)</b>', r'**\1**', md, flags=re.I)
    md = re.sub(r'<em>([\s\S]*?)</em>', r'*\1*', md, flags=re.I)
    md = re.sub(r'<i>([\s\S]*?)</i>', r'*\1*', md, flags=re.I)
    md = re.sub(r'<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)</a>', r'[\2](\1)', md, flags=re.I)
    md = re.sub(r'<hr\s*/?>', '\n---\n', md)
    oi = [0]

    def ol_start(m):
        oi[0] = 1
        return "\n"

    def li_start(m):
        if oi[0] > 0:
            oi[0] += 1
            return f'\n{oi[0] - 1}. '
        return "\n- "
    md = re.sub(r'<ol[^>]*>', ol_start, md)
    md = re.sub(r'</ol>', '\n', md)
    md = re.sub(r'<li[^>]*>', li_start, md)
    md = re.sub(r'</li>', '', md)
    md = re.sub(r'<p[^>]*>', '\n', md)
    md = re.sub(r'</p>', '\n', md)
    md = re.sub(r'<br\s*/?>', '\n', md)
    md = re.sub(r'<code>([\s\S]*?)</code>', r'`\1`', md)
    md = re.sub(r'<[^>]+>', '', md)
    md = unescape(md)
    md = re.sub(r'\n{4,}', '\n\n\n', md)
    md = re.sub(r'[ \t]+$', '', md, flags=re.M)
    return md.strip()


def unescape(s):
    s = s.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
    s = s.replace("&quot;", '"').replace("&#39;", "'").replace("&#x27;", "'")
    s = s.replace("&#x2F;", "/")
    return s


def clean_text(el):
    return el.text_content().replace("\xa0", " ").strip() if el else ""


def extract_messages(page):
    messages = []
    container = page.query_selector(".ds-virtual-list-visible-items")
    if not container:
        print("[!] Chat container not found")
        return messages

    children = container.query_selector_all(":scope > *")
    for child in children:
        class_name = child.get_attribute("class") or ""

        # User message
        if "_9663006" in class_name:
            text_el = child.query_selector(SEL["userContent"])
            if text_el and text_el.text_content().strip():
                messages.append({"role": "user", "content": text_el.text_content().strip()})
            continue

        # AI message
        if "_4f9bf79" in class_name:
            msg = {"role": "assistant", "content": "", "thinkingText": "", "thinkingMd": ""}

            te = child.query_selector(SEL["thinkTime"])
            if te:
                msg["thinkingText"] = clean_text(te)

            tke = child.query_selector(SEL["thinkChain"])
            if tke:
                msg["thinkingMd"] = html_to_md(tke.inner_html())

            # Try primary answer wrapper
            ae = child.query_selector(SEL["answerWrapper"])
            if ae:
                msg["content"] = html_to_md(ae.inner_html())
            else:
                # Fallback: first .ds-markdown NOT inside thinking chain
                all_md = child.query_selector_all(SEL["answerFallback"])
                for md_el in all_md:
                    # Check if this is inside thinking chain
                    parent_chain = md_el.evaluate("el => el.closest('.e1675d8b') !== null")
                    if not parent_chain:
                        msg["content"] = html_to_md(md_el.inner_html())
                        break

            if msg["content"] or msg["thinkingMd"]:
                messages.append(msg)

    return messages


def scroll_to_load_all(page, timeout=60):
    """Scroll the virtual list to trigger loading of all items."""
    scroll_el = page.query_selector(SEL["scrollArea"])
    if not scroll_el:
        visible = page.query_selector(".ds-virtual-list-visible-items")
        if visible:
            scroll_el = visible.evaluate_handle("el => el.parentElement").as_element()
    if not scroll_el:
        print("[!] No scroll container found")
        return

    prev_count = 0
    stuck = 0
    start = time.time()

    while time.time() - start < timeout:
        children = page.query_selector_all(".ds-virtual-list-visible-items > *")
        count = len(children)
        if count > prev_count:
            print(f"  Messages in DOM: {count}")

        # Scroll to top to trigger loading of earlier items
        scroll_el.evaluate("el => el.scrollTop = 0")
        page.wait_for_timeout(1000)

        # Scroll down to load later items
        scroll_el.evaluate("el => el.scrollTop = el.scrollHeight")
        page.wait_for_timeout(1000)

        if count == prev_count and count > 0:
            stuck += 1
            if stuck > 5:
                break
        else:
            stuck = 0
            prev_count = count

        if count > 40:
            break

    print(f"  Final DOM count: {len(page.query_selector_all('.ds-virtual-list-visible-items > *'))}")


def generate_markdown(messages, title, url):
    md = f"# {title}\nSource: {url}\n\n"
    for msg in messages:
        if msg["role"] == "user":
            md += f"## User\n\n{msg['content']}\n\n---\n\n"
        else:
            md += "## Assistant\n\n"
            if msg["thinkingText"]:
                md += f"_{msg['thinkingText']}_\n\n"
            if msg["thinkingMd"]:
                md += "> " + msg["thinkingMd"].replace("\n", "\n> ") + "\n\n"
            md += f"{msg['content']}\n\n---\n\n"
    return md


def find_chrome_profile():
    """Find Chrome or Edge user profile for login persistence."""
    candidates = [
        (r"C:\Users\LMC\AppData\Local\Google\Chrome\User Data\Default", True),
        (r"C:\Users\LMC\AppData\Local\Microsoft\Edge\User Data\Default", False),
        (r"C:\Users\LMC\AppData\Local\Google\Chrome\User Data\Profile 1", True),
    ]
    for path, is_chrome in candidates:
        if os.path.isdir(path):
            return path, is_chrome
    return None, False


def main():
    parser = argparse.ArgumentParser(description="Export DeepSeek conversation to Markdown")
    parser.add_argument("url", nargs="?", help="DeepSeek conversation URL")
    parser.add_argument("--output", help="Output file path (default: auto)")
    parser.add_argument("--no-browser", action="store_true", help="Don't open browser, use saved HTML")
    args = parser.parse_args()

    # Ask for URL if not provided
    url = args.url
    if not url:
        url = input("DeepSeek conversation URL: ").strip()
        if not url:
            print("No URL provided")
            sys.exit(1)

    # Extract title from URL
    m = re.search(r"/s/([a-z0-9-]+)", url)
    session_id = m.group(1) if m else "unknown"
    title = f"DeepSeek Chat ({session_id[:8]})"

    print(f"Opening: {url}")
    print(f"Session: {session_id}")

    with sync_playwright() as p:
        profile_path, channel = find_chrome_profile()
        browser = None
        context = None

        if profile_path:
            print(f"Using Chrome profile: {profile_path}")
            try:
                launch_args = {
                    "user_data_dir": profile_path,
                    "headless": False,
                    "args": ["--no-sandbox"],
                }
                if is_chrome:
                    launch_args["channel"] = "chrome"
                context = p.chromium.launch_persistent_context(**launch_args)
                page = context.pages[0] if context.pages else context.new_page()
            except Exception as e:
                print(f"[!] Profile launch failed: {e}")
                print("[!] Chrome may be running. Close it or try a different profile.")
                browser = p.chromium.launch(headless=False)
                page = browser.new_page()
        else:
            print("[!] No Chrome profile found, launching fresh browser")
            print("[!] You may need to log in manually")
            browser = p.chromium.launch(headless=False)
            page = browser.new_page()

        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_timeout(3000)

        # Check if logged in
        if "/sign_in" in page.url:
            print("[!] Not logged in. Log in manually in the browser window (60s timeout)...")
            try:
                page.wait_for_url("**/a/chat/**", timeout=60000)
                page.wait_for_selector(".ds-virtual-list-visible-items", timeout=30000)
            except:
                print("[!] Timeout waiting for chat to load.")
                if context:
                    context.close()
                else:
                    browser.close()
                sys.exit(1)
        else:
            try:
                page.wait_for_selector(".ds-virtual-list-visible-items", timeout=15000)
            except:
                print("[!] Chat container not found, but may still load...")
                page.wait_for_timeout(3000)

        print("[+] Page loaded, scrolling to load all messages...")
        scroll_to_load_all(page)

        print("[+] Extracting messages...")
        messages = extract_messages(page)

        if context:
            context.close()
        else:
            browser.close()

    if not messages:
        print("[!] No messages extracted")
        sys.exit(1)

    print(f"[+] Extracted {len(messages)} messages")

    md = generate_markdown(messages, title, url)

    # Save
    ts = time.strftime("%Y-%m-%dT%H-%M-%S")
    fname = f"deepseek_{ts}.md"
    out_path = OBSIDIAN_VAULT / OUTPUT_DIR / fname
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(md, encoding="utf-8")
    print(f"[+] Saved: {out_path}")

    # Also try Obsidian REST API
    try:
        import requests
        OBSIDIAN_TOKEN = "YOUR_OBSIDIAN_TOKEN_HERE"
        r = requests.post(
            f"https://127.0.0.1:27124/vault/{OUTPUT_DIR}/{fname}",
            headers={"Authorization": f"Bearer {OBSIDIAN_TOKEN}", "Content-Type": "text/markdown"},
            data=md.encode("utf-8"),
            verify=False,
            timeout=10,
        )
        if r.ok:
            print(f"[+] Sent to Obsidian API: {OUTPUT_DIR}/{fname}")
    except Exception as e:
        print(f"[!] Obsidian API unavailable: {e}")
        print(f"[+] File saved locally at: {out_path}")


if __name__ == "__main__":
    main()
