var discord = (function() {
	//#region node_modules/wxt/dist/utils/define-content-script.mjs
	function defineContentScript(definition) {
		return definition;
	}
	//#endregion
	//#region node_modules/wxt/dist/browser.mjs
	/**
	* Contains the `browser` export which you should use to access the extension
	* APIs in your project:
	*
	* ```ts
	* import { browser } from 'wxt/browser';
	*
	* browser.runtime.onInstalled.addListener(() => {
	*   // ...
	* });
	* ```
	*
	* @module wxt/browser
	*/
	var browser = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
	//#endregion
	//#region utils/sanitize-content.ts
	/**
	* Turn the already-rendered children of a Discord `message-content-…` element
	* into a sanitized HTML string we control the styling of.
	*
	* Discord has already parsed the markdown — bold is `<strong>`, code is
	* `<code>`, mentions are `<span class="mention_…">`, custom emoji are `<img>`,
	* and so on. We rebuild that tree using a tag whitelist with our own
	* `dfcc-*` classes, dropping Discord's hashed classes and anything we don't
	* recognize. The result is safe to feed to `dangerouslySetInnerHTML`.
	*/
	/** Sanitize the children of a Discord message-content element. */
	function sanitizeContent(root) {
		let out = "";
		for (const child of root.childNodes) out += serialize(child);
		return out;
	}
	function serialize(node) {
		if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent ?? "");
		if (node.nodeType !== Node.ELEMENT_NODE) return "";
		const el = node;
		const children = () => {
			let s = "";
			for (const child of el.childNodes) s += serialize(child);
			return s;
		};
		switch (el.tagName.toLowerCase()) {
			case "br": return "<br>";
			case "strong":
			case "b": return `<strong>${children()}</strong>`;
			case "em":
			case "i": return `<em>${children()}</em>`;
			case "s":
			case "del":
			case "strike": return `<s>${children()}</s>`;
			case "u": return `<u>${children()}</u>`;
			case "code": return `<code class="dfcc-code">${children()}</code>`;
			case "pre": return `<pre class="dfcc-codeblock">${children()}</pre>`;
			case "blockquote": return `<blockquote class="dfcc-quote">${children()}</blockquote>`;
			case "ol": return `<ol class="dfcc-list">${children()}</ol>`;
			case "ul": return `<ul class="dfcc-list">${children()}</ul>`;
			case "li": return `<li>${children()}</li>`;
			case "h1": return `<div class="dfcc-h1">${children()}</div>`;
			case "h2": return `<div class="dfcc-h2">${children()}</div>`;
			case "h3": return `<div class="dfcc-h3">${children()}</div>`;
			case "a": return `<a href="${escapeAttr(sanitizeUrl(el.getAttribute("href") ?? ""))}" class="dfcc-link">${children()}</a>`;
			case "img": {
				const src = el.src;
				const alt = el.getAttribute("alt") ?? "";
				if (!src || src.includes("\"") || !/^https?:/i.test(src)) return "";
				return `<img src="${src}" alt="${escapeAttr(alt)}" class="dfcc-emoji">`;
			}
			case "span": {
				const cls = el.getAttribute("class") ?? "";
				if (/mention/i.test(cls)) return `<span class="dfcc-mention">${children()}</span>`;
				if (/spoiler/i.test(cls)) return `<span class="dfcc-spoiler">${children()}</span>`;
				return children();
			}
			case "div":
			case "p": return children();
			case "script":
			case "style":
			case "iframe":
			case "object":
			case "embed": return "";
			default: return children();
		}
	}
	var ENTITY_MAP = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;",
		"'": "&#39;"
	};
	function escapeHtml(s) {
		return s.replace(/[&<>"']/g, (c) => ENTITY_MAP[c]);
	}
	function escapeAttr(s) {
		return escapeHtml(s);
	}
	/** Allow http(s) / mailto / discord deep links / anchors only — block javascript:, data:, etc. */
	function sanitizeUrl(url) {
		if (!url) return "#";
		if (/^(https?:|mailto:|discord:|#)/i.test(url)) return url;
		return "#";
	}
	//#endregion
	//#region utils/dom-scraper.ts
	/**
	* Reads structured message data out of the Discord DOM.
	*
	* Discord's CSS class names are hashed (`message_a1b2c3`), so selectors lean on
	* stable bits: element ids (`chat-messages-…`, `message-content-…`), the
	* `<time datetime>` attribute, and `[class*="…"]` substring matches.
	*/
	var MSG_SELECTOR$1 = "li[id^=\"chat-messages-\"]";
	/** Extract the trailing message id from a `chat-messages-<channel>-<id>` element. */
	function messageIdOf(li) {
		return li.id.slice(li.id.lastIndexOf("-") + 1);
	}
	/**
	* Scrape every message currently mounted in the Discord message list, in
	* document order. Grouped (consecutive same-author) messages don't repeat the
	* avatar/header in the DOM, so the author is carried forward.
	*/
	function scrapeAllMessages() {
		const out = [];
		let carried = null;
		for (const li of document.querySelectorAll(MSG_SELECTOR$1)) {
			const header = li.querySelector("[class*=\"header_\"] [class*=\"username\"]");
			const groupStart = header != null;
			if (groupStart) carried = {
				name: header.textContent?.trim() || "Unknown",
				avatarUrl: ownAvatar(li) ?? "",
				roleColor: header.style.color || null,
				bot: li.querySelector("[class*=\"botTag\"]") != null
			};
			const author = carried ?? {
				name: "Unknown",
				avatarUrl: "",
				roleColor: null,
				bot: false
			};
			const contentEl = li.querySelector("[id^=\"message-content-\"]");
			const time = li.querySelector("time");
			out.push({
				id: messageIdOf(li),
				author,
				timestamp: time?.getAttribute("datetime") ?? "",
				timestampLabel: time?.textContent?.trim() ?? "",
				contentHtml: contentEl ? sanitizeContent(contentEl) : "",
				edited: li.querySelector("[class*=\"edited\"]") != null,
				reply: scrapeReply(li),
				reactions: scrapeReactions(li),
				attachments: scrapeAttachments(li),
				groupStart
			});
		}
		return out;
	}
	/** The message's own avatar — skipping the tiny avatar in a reply preview. */
	function ownAvatar(li) {
		for (const img of li.querySelectorAll("img[class*=\"avatar\"]")) if (!img.closest("[class*=\"repliedMessage\"]")) return img.src;
		return null;
	}
	function scrapeReply(li) {
		const el = li.querySelector("[class*=\"repliedMessage\"]");
		if (!el) return null;
		const author = el.querySelector("[class*=\"username\"]");
		const text = el.querySelector("[class*=\"repliedTextContent\"], [class*=\"repliedTextPreview\"]");
		return {
			authorName: author?.textContent?.trim() ?? "",
			content: (text ?? el).textContent?.trim() ?? ""
		};
	}
	function scrapeReactions(li) {
		const out = [];
		for (const r of li.querySelectorAll("[class*=\"reaction_\"]")) {
			const img = r.querySelector("img");
			const count = r.querySelector("[class*=\"reactionCount\"]");
			out.push({
				emoji: img?.alt ?? "",
				emojiUrl: img?.src ?? null,
				count: Number.parseInt(count?.textContent ?? "1", 10) || 1
			});
		}
		return out;
	}
	function scrapeAttachments(li) {
		const out = [];
		for (const img of li.querySelectorAll("img")) {
			if (!/\/attachments\//.test(img.src)) continue;
			if (img.closest("[class*=\"repliedMessage\"]") || img.closest("[class*=\"reaction_\"]")) continue;
			out.push({
				url: img.src,
				width: img.naturalWidth || null,
				height: img.naturalHeight || null
			});
		}
		return out;
	}
	/** Best-effort name of the current channel / DM. */
	function getSourceName() {
		const heading = document.querySelector("section[aria-label] h1, [class*=\"title_\"] h1, h1[class*=\"title\"]");
		if (heading?.textContent?.trim()) return heading.textContent.trim();
		return document.title.replace(/^\(\d+\)\s*/, "").replace(/\s*[|•]\s*Discord.*$/i, "").trim() || "Discord";
	}
	//#endregion
	//#region entrypoints/discord.content.ts
	var MSG_SELECTOR = "li[id^=\"chat-messages-\"]";
	var discord_content_default = defineContentScript({
		matches: ["https://discord.com/*", "https://*.discord.com/*"],
		main() {
			injectStyles();
			const session = new CaptureSession();
			browser.runtime.onMessage.addListener((message) => {
				if (message.type === "TOGGLE_CAPTURE") session.toggle();
			});
		}
	});
	/**
	* Drives the on-page capture flow: the user clicks a start message, then an end
	* message, and everything between them is scraped and sent to the background.
	*/
	var CaptureSession = class {
		mode = "idle";
		startId = null;
		banner = null;
		hovered = null;
		toggle() {
			if (this.mode === "idle") this.begin();
			else this.cancel();
		}
		begin() {
			this.mode = "start";
			this.startId = null;
			this.banner = document.body.appendChild(Object.assign(document.createElement("div"), { className: "dfcc-banner" }));
			this.updateBanner();
			document.addEventListener("mousemove", this.onMove, true);
			document.addEventListener("click", this.onClick, true);
			document.addEventListener("keydown", this.onKey, true);
		}
		cancel() {
			this.mode = "idle";
			this.startId = null;
			this.clearHover();
			document.querySelectorAll(".dfcc-start").forEach((el) => el.classList.remove("dfcc-start"));
			document.removeEventListener("mousemove", this.onMove, true);
			document.removeEventListener("click", this.onClick, true);
			document.removeEventListener("keydown", this.onKey, true);
			this.banner?.remove();
			this.banner = null;
		}
		onKey = (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				this.cancel();
			}
		};
		onMove = (e) => {
			const li = e.target?.closest(MSG_SELECTOR) ?? null;
			if (li === this.hovered) return;
			this.clearHover();
			if (li) {
				li.classList.add("dfcc-hover");
				this.hovered = li;
			}
		};
		clearHover() {
			this.hovered?.classList.remove("dfcc-hover");
			this.hovered = null;
		}
		onClick = (e) => {
			const li = e.target?.closest(MSG_SELECTOR);
			if (!li) return;
			e.preventDefault();
			e.stopPropagation();
			if (this.mode === "start") {
				this.startId = messageIdOf(li);
				li.classList.add("dfcc-start");
				this.mode = "end";
				this.updateBanner();
			} else if (this.mode === "end") this.finish(messageIdOf(li));
		};
		finish(endId) {
			const all = scrapeAllMessages();
			let i = all.findIndex((m) => m.id === this.startId);
			let j = all.findIndex((m) => m.id === endId);
			if (i === -1 || j === -1) {
				this.setBanner("⚠️ 메시지를 찾지 못했어요 — 구간이 화면 밖으로 벗어났을 수 있어요. 다시 클릭해 주세요.");
				return;
			}
			if (i > j) [i, j] = [j, i];
			const messages = all.slice(i, j + 1);
			messages[0] = {
				...messages[0],
				groupStart: true
			};
			const capture = {
				source: getSourceName(),
				capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
				messages
			};
			browser.runtime.sendMessage({
				type: "CAPTURE_RESULT",
				capture
			});
			this.mode = "idle";
			this.setBanner(`✅ ${messages.length}개 메시지 캡쳐 완료 — 에디터를 여는 중…`);
			window.setTimeout(() => this.cancel(), 1600);
		}
		updateBanner() {
			this.setBanner(this.mode === "start" ? "1 / 2  ·  캡쳐를 시작할 메시지를 클릭하세요    (Esc: 취소)" : "2 / 2  ·  캡쳐를 끝낼 메시지를 클릭하세요    (Esc: 취소)");
		}
		setBanner(text) {
			if (this.banner) this.banner.textContent = text;
		}
	};
	function injectStyles() {
		const style = document.createElement("style");
		style.textContent = `
    .dfcc-banner {
      position: fixed; top: 18px; left: 50%; transform: translateX(-50%);
      z-index: 2147483647; pointer-events: none;
      background: #5865f2; color: #fff;
      font: 600 14px/1.4 -apple-system, system-ui, sans-serif;
      padding: 11px 20px; border-radius: 10px;
      box-shadow: 0 8px 28px rgba(0, 0, 0, .45);
    }
    .dfcc-hover {
      outline: 2px solid #5865f2 !important; outline-offset: -2px;
      background: rgba(88, 101, 242, .10) !important; cursor: crosshair !important;
    }
    .dfcc-start {
      outline: 2px solid #3ba55d !important; outline-offset: -2px;
      background: rgba(59, 165, 93, .14) !important;
    }
  `;
		document.head.appendChild(style);
	}
	//#endregion
	//#region node_modules/wxt/dist/utils/internal/logger.mjs
	function print$1(method, ...args) {
		if (typeof args[0] === "string") method(`[wxt] ${args.shift()}`, ...args);
		else method("[wxt]", ...args);
	}
	/** Wrapper around `console` with a "[wxt]" prefix */
	var logger$1 = {
		debug: (...args) => print$1(console.debug, ...args),
		log: (...args) => print$1(console.log, ...args),
		warn: (...args) => print$1(console.warn, ...args),
		error: (...args) => print$1(console.error, ...args)
	};
	//#endregion
	//#region node_modules/wxt/dist/utils/internal/custom-events.mjs
	var WxtLocationChangeEvent = class WxtLocationChangeEvent extends Event {
		static EVENT_NAME = getUniqueEventName("wxt:locationchange");
		constructor(newUrl, oldUrl) {
			super(WxtLocationChangeEvent.EVENT_NAME, {});
			this.newUrl = newUrl;
			this.oldUrl = oldUrl;
		}
	};
	/**
	* Returns an event name unique to the extension and content script that's
	* running.
	*/
	function getUniqueEventName(eventName) {
		return `${browser?.runtime?.id}:discord:${eventName}`;
	}
	//#endregion
	//#region node_modules/wxt/dist/utils/internal/location-watcher.mjs
	var supportsNavigationApi = typeof globalThis.navigation?.addEventListener === "function";
	/**
	* Create a util that watches for URL changes, dispatching the custom event when
	* detected. Stops watching when content script is invalidated. Uses Navigation
	* API when available, otherwise falls back to polling.
	*/
	function createLocationWatcher(ctx) {
		let lastUrl;
		let watching = false;
		return { run() {
			if (watching) return;
			watching = true;
			lastUrl = new URL(location.href);
			if (supportsNavigationApi) globalThis.navigation.addEventListener("navigate", (event) => {
				const newUrl = new URL(event.destination.url);
				if (newUrl.href === lastUrl.href) return;
				window.dispatchEvent(new WxtLocationChangeEvent(newUrl, lastUrl));
				lastUrl = newUrl;
			}, { signal: ctx.signal });
			else ctx.setInterval(() => {
				const newUrl = new URL(location.href);
				if (newUrl.href !== lastUrl.href) {
					window.dispatchEvent(new WxtLocationChangeEvent(newUrl, lastUrl));
					lastUrl = newUrl;
				}
			}, 1e3);
		} };
	}
	//#endregion
	//#region node_modules/wxt/dist/utils/content-script-context.mjs
	/**
	* Implements
	* [`AbortController`](https://developer.mozilla.org/en-US/docs/Web/API/AbortController).
	* Used to detect and stop content script code when the script is invalidated.
	*
	* It also provides several utilities like `ctx.setTimeout` and
	* `ctx.setInterval` that should be used in content scripts instead of
	* `window.setTimeout` or `window.setInterval`.
	*
	* To create context for testing, you can use the class's constructor:
	*
	* ```ts
	* import { ContentScriptContext } from 'wxt/utils/content-scripts-context';
	*
	* test('storage listener should be removed when context is invalidated', () => {
	*   const ctx = new ContentScriptContext('test');
	*   const item = storage.defineItem('local:count', { defaultValue: 0 });
	*   const watcher = vi.fn();
	*
	*   const unwatch = item.watch(watcher);
	*   ctx.onInvalidated(unwatch); // Listen for invalidate here
	*
	*   await item.setValue(1);
	*   expect(watcher).toBeCalledTimes(1);
	*   expect(watcher).toBeCalledWith(1, 0);
	*
	*   ctx.notifyInvalidated(); // Use this function to invalidate the context
	*   await item.setValue(2);
	*   expect(watcher).toBeCalledTimes(1);
	* });
	* ```
	*/
	var ContentScriptContext = class ContentScriptContext {
		static SCRIPT_STARTED_MESSAGE_TYPE = getUniqueEventName("wxt:content-script-started");
		id;
		abortController;
		locationWatcher = createLocationWatcher(this);
		constructor(contentScriptName, options) {
			this.contentScriptName = contentScriptName;
			this.options = options;
			this.id = Math.random().toString(36).slice(2);
			this.abortController = new AbortController();
			this.stopOldScripts();
			this.listenForNewerScripts();
		}
		get signal() {
			return this.abortController.signal;
		}
		abort(reason) {
			return this.abortController.abort(reason);
		}
		get isInvalid() {
			if (browser.runtime?.id == null) this.notifyInvalidated();
			return this.signal.aborted;
		}
		get isValid() {
			return !this.isInvalid;
		}
		/**
		* Add a listener that is called when the content script's context is
		* invalidated.
		*
		* @example
		*   browser.runtime.onMessage.addListener(cb);
		*   const removeInvalidatedListener = ctx.onInvalidated(() => {
		*     browser.runtime.onMessage.removeListener(cb);
		*   });
		*   // ...
		*   removeInvalidatedListener();
		*
		* @returns A function to remove the listener.
		*/
		onInvalidated(cb) {
			this.signal.addEventListener("abort", cb);
			return () => this.signal.removeEventListener("abort", cb);
		}
		/**
		* Return a promise that never resolves. Useful if you have an async function
		* that shouldn't run after the context is expired.
		*
		* @example
		*   const getValueFromStorage = async () => {
		*     if (ctx.isInvalid) return ctx.block();
		*
		*     // ...
		*   };
		*/
		block() {
			return new Promise(() => {});
		}
		/**
		* Wrapper around `window.setInterval` that automatically clears the interval
		* when invalidated.
		*
		* Intervals can be cleared by calling the normal `clearInterval` function.
		*/
		setInterval(handler, timeout) {
			const id = setInterval(() => {
				if (this.isValid) handler();
			}, timeout);
			this.onInvalidated(() => clearInterval(id));
			return id;
		}
		/**
		* Wrapper around `window.setTimeout` that automatically clears the interval
		* when invalidated.
		*
		* Timeouts can be cleared by calling the normal `setTimeout` function.
		*/
		setTimeout(handler, timeout) {
			const id = setTimeout(() => {
				if (this.isValid) handler();
			}, timeout);
			this.onInvalidated(() => clearTimeout(id));
			return id;
		}
		/**
		* Wrapper around `window.requestAnimationFrame` that automatically cancels
		* the request when invalidated.
		*
		* Callbacks can be canceled by calling the normal `cancelAnimationFrame`
		* function.
		*/
		requestAnimationFrame(callback) {
			const id = requestAnimationFrame((...args) => {
				if (this.isValid) callback(...args);
			});
			this.onInvalidated(() => cancelAnimationFrame(id));
			return id;
		}
		/**
		* Wrapper around `window.requestIdleCallback` that automatically cancels the
		* request when invalidated.
		*
		* Callbacks can be canceled by calling the normal `cancelIdleCallback`
		* function.
		*/
		requestIdleCallback(callback, options) {
			const id = requestIdleCallback((...args) => {
				if (!this.signal.aborted) callback(...args);
			}, options);
			this.onInvalidated(() => cancelIdleCallback(id));
			return id;
		}
		addEventListener(target, type, handler, options) {
			if (type === "wxt:locationchange") {
				if (this.isValid) this.locationWatcher.run();
			}
			target.addEventListener?.(type.startsWith("wxt:") ? getUniqueEventName(type) : type, handler, {
				...options,
				signal: this.signal
			});
		}
		/**
		* @internal
		* Abort the abort controller and execute all `onInvalidated` listeners.
		*/
		notifyInvalidated() {
			this.abort("Content script context invalidated");
			logger$1.debug(`Content script "${this.contentScriptName}" context invalidated`);
		}
		stopOldScripts() {
			document.dispatchEvent(new CustomEvent(ContentScriptContext.SCRIPT_STARTED_MESSAGE_TYPE, { detail: {
				contentScriptName: this.contentScriptName,
				messageId: this.id
			} }));
			if (!this.options?.noScriptStartedPostMessage) window.postMessage({
				type: ContentScriptContext.SCRIPT_STARTED_MESSAGE_TYPE,
				contentScriptName: this.contentScriptName,
				messageId: this.id
			}, "*");
		}
		verifyScriptStartedEvent(event) {
			const isSameContentScript = event.detail?.contentScriptName === this.contentScriptName;
			const isFromSelf = event.detail?.messageId === this.id;
			return isSameContentScript && !isFromSelf;
		}
		listenForNewerScripts() {
			const cb = (event) => {
				if (!(event instanceof CustomEvent) || !this.verifyScriptStartedEvent(event)) return;
				this.notifyInvalidated();
			};
			document.addEventListener(ContentScriptContext.SCRIPT_STARTED_MESSAGE_TYPE, cb);
			this.onInvalidated(() => document.removeEventListener(ContentScriptContext.SCRIPT_STARTED_MESSAGE_TYPE, cb));
		}
	};
	//#endregion
	//#region \0virtual:wxt-content-script-isolated-world-entrypoint?/Users/ad1225/Documents/viram/discord-fancy-chat-capture/entrypoints/discord.content.ts
	function print(method, ...args) {
		if (typeof args[0] === "string") method(`[wxt] ${args.shift()}`, ...args);
		else method("[wxt]", ...args);
	}
	/** Wrapper around `console` with a "[wxt]" prefix */
	var logger = {
		debug: (...args) => print(console.debug, ...args),
		log: (...args) => print(console.log, ...args),
		warn: (...args) => print(console.warn, ...args),
		error: (...args) => print(console.error, ...args)
	};
	//#endregion
	return (async () => {
		try {
			const { main, ...options } = discord_content_default;
			return await main(new ContentScriptContext("discord", options));
		} catch (err) {
			logger.error(`The content script "discord" crashed on startup!`, err);
			throw err;
		}
	})();
})();

discord;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGlzY29yZC5qcyIsIm5hbWVzIjpbImJyb3dzZXIiLCJwcmludCIsImxvZ2dlciJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uL25vZGVfbW9kdWxlcy93eHQvZGlzdC91dGlscy9kZWZpbmUtY29udGVudC1zY3JpcHQubWpzIiwiLi4vLi4vLi4vbm9kZV9tb2R1bGVzL0B3eHQtZGV2L2Jyb3dzZXIvc3JjL2luZGV4Lm1qcyIsIi4uLy4uLy4uL25vZGVfbW9kdWxlcy93eHQvZGlzdC9icm93c2VyLm1qcyIsIi4uLy4uLy4uL3V0aWxzL3Nhbml0aXplLWNvbnRlbnQudHMiLCIuLi8uLi8uLi91dGlscy9kb20tc2NyYXBlci50cyIsIi4uLy4uLy4uL2VudHJ5cG9pbnRzL2Rpc2NvcmQuY29udGVudC50cyIsIi4uLy4uLy4uL25vZGVfbW9kdWxlcy93eHQvZGlzdC91dGlscy9pbnRlcm5hbC9sb2dnZXIubWpzIiwiLi4vLi4vLi4vbm9kZV9tb2R1bGVzL3d4dC9kaXN0L3V0aWxzL2ludGVybmFsL2N1c3RvbS1ldmVudHMubWpzIiwiLi4vLi4vLi4vbm9kZV9tb2R1bGVzL3d4dC9kaXN0L3V0aWxzL2ludGVybmFsL2xvY2F0aW9uLXdhdGNoZXIubWpzIiwiLi4vLi4vLi4vbm9kZV9tb2R1bGVzL3d4dC9kaXN0L3V0aWxzL2NvbnRlbnQtc2NyaXB0LWNvbnRleHQubWpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vI3JlZ2lvbiBzcmMvdXRpbHMvZGVmaW5lLWNvbnRlbnQtc2NyaXB0LnRzXG5mdW5jdGlvbiBkZWZpbmVDb250ZW50U2NyaXB0KGRlZmluaXRpb24pIHtcblx0cmV0dXJuIGRlZmluaXRpb247XG59XG4vLyNlbmRyZWdpb25cbmV4cG9ydCB7IGRlZmluZUNvbnRlbnRTY3JpcHQgfTtcbiIsIi8vICNyZWdpb24gc25pcHBldFxuZXhwb3J0IGNvbnN0IGJyb3dzZXIgPSBnbG9iYWxUaGlzLmJyb3dzZXI/LnJ1bnRpbWU/LmlkXG4gID8gZ2xvYmFsVGhpcy5icm93c2VyXG4gIDogZ2xvYmFsVGhpcy5jaHJvbWU7XG4vLyAjZW5kcmVnaW9uIHNuaXBwZXRcbiIsImltcG9ydCB7IGJyb3dzZXIgYXMgYnJvd3NlciQxIH0gZnJvbSBcIkB3eHQtZGV2L2Jyb3dzZXJcIjtcbi8vI3JlZ2lvbiBzcmMvYnJvd3Nlci50c1xuLyoqXG4qIENvbnRhaW5zIHRoZSBgYnJvd3NlcmAgZXhwb3J0IHdoaWNoIHlvdSBzaG91bGQgdXNlIHRvIGFjY2VzcyB0aGUgZXh0ZW5zaW9uXG4qIEFQSXMgaW4geW91ciBwcm9qZWN0OlxuKlxuKiBgYGB0c1xuKiBpbXBvcnQgeyBicm93c2VyIH0gZnJvbSAnd3h0L2Jyb3dzZXInO1xuKlxuKiBicm93c2VyLnJ1bnRpbWUub25JbnN0YWxsZWQuYWRkTGlzdGVuZXIoKCkgPT4ge1xuKiAgIC8vIC4uLlxuKiB9KTtcbiogYGBgXG4qXG4qIEBtb2R1bGUgd3h0L2Jyb3dzZXJcbiovXG5jb25zdCBicm93c2VyID0gYnJvd3NlciQxO1xuLy8jZW5kcmVnaW9uXG5leHBvcnQgeyBicm93c2VyIH07XG4iLCIvKipcbiAqIFR1cm4gdGhlIGFscmVhZHktcmVuZGVyZWQgY2hpbGRyZW4gb2YgYSBEaXNjb3JkIGBtZXNzYWdlLWNvbnRlbnQt4oCmYCBlbGVtZW50XG4gKiBpbnRvIGEgc2FuaXRpemVkIEhUTUwgc3RyaW5nIHdlIGNvbnRyb2wgdGhlIHN0eWxpbmcgb2YuXG4gKlxuICogRGlzY29yZCBoYXMgYWxyZWFkeSBwYXJzZWQgdGhlIG1hcmtkb3duIOKAlCBib2xkIGlzIGA8c3Ryb25nPmAsIGNvZGUgaXNcbiAqIGA8Y29kZT5gLCBtZW50aW9ucyBhcmUgYDxzcGFuIGNsYXNzPVwibWVudGlvbl/igKZcIj5gLCBjdXN0b20gZW1vamkgYXJlIGA8aW1nPmAsXG4gKiBhbmQgc28gb24uIFdlIHJlYnVpbGQgdGhhdCB0cmVlIHVzaW5nIGEgdGFnIHdoaXRlbGlzdCB3aXRoIG91ciBvd25cbiAqIGBkZmNjLSpgIGNsYXNzZXMsIGRyb3BwaW5nIERpc2NvcmQncyBoYXNoZWQgY2xhc3NlcyBhbmQgYW55dGhpbmcgd2UgZG9uJ3RcbiAqIHJlY29nbml6ZS4gVGhlIHJlc3VsdCBpcyBzYWZlIHRvIGZlZWQgdG8gYGRhbmdlcm91c2x5U2V0SW5uZXJIVE1MYC5cbiAqL1xuXG4vKiogU2FuaXRpemUgdGhlIGNoaWxkcmVuIG9mIGEgRGlzY29yZCBtZXNzYWdlLWNvbnRlbnQgZWxlbWVudC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZUNvbnRlbnQocm9vdDogRWxlbWVudCk6IHN0cmluZyB7XG4gIGxldCBvdXQgPSAnJztcbiAgZm9yIChjb25zdCBjaGlsZCBvZiByb290LmNoaWxkTm9kZXMpIG91dCArPSBzZXJpYWxpemUoY2hpbGQpO1xuICByZXR1cm4gb3V0O1xufVxuXG5mdW5jdGlvbiBzZXJpYWxpemUobm9kZTogTm9kZSk6IHN0cmluZyB7XG4gIGlmIChub2RlLm5vZGVUeXBlID09PSBOb2RlLlRFWFRfTk9ERSkge1xuICAgIHJldHVybiBlc2NhcGVIdG1sKG5vZGUudGV4dENvbnRlbnQgPz8gJycpO1xuICB9XG4gIGlmIChub2RlLm5vZGVUeXBlICE9PSBOb2RlLkVMRU1FTlRfTk9ERSkgcmV0dXJuICcnO1xuICBjb25zdCBlbCA9IG5vZGUgYXMgRWxlbWVudDtcbiAgY29uc3QgY2hpbGRyZW4gPSAoKSA9PiB7XG4gICAgbGV0IHMgPSAnJztcbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGVsLmNoaWxkTm9kZXMpIHMgKz0gc2VyaWFsaXplKGNoaWxkKTtcbiAgICByZXR1cm4gcztcbiAgfTtcblxuICBzd2l0Y2ggKGVsLnRhZ05hbWUudG9Mb3dlckNhc2UoKSkge1xuICAgIGNhc2UgJ2JyJzpcbiAgICAgIHJldHVybiAnPGJyPic7XG5cbiAgICBjYXNlICdzdHJvbmcnOlxuICAgIGNhc2UgJ2InOlxuICAgICAgcmV0dXJuIGA8c3Ryb25nPiR7Y2hpbGRyZW4oKX08L3N0cm9uZz5gO1xuXG4gICAgY2FzZSAnZW0nOlxuICAgIGNhc2UgJ2knOlxuICAgICAgcmV0dXJuIGA8ZW0+JHtjaGlsZHJlbigpfTwvZW0+YDtcblxuICAgIGNhc2UgJ3MnOlxuICAgIGNhc2UgJ2RlbCc6XG4gICAgY2FzZSAnc3RyaWtlJzpcbiAgICAgIHJldHVybiBgPHM+JHtjaGlsZHJlbigpfTwvcz5gO1xuXG4gICAgY2FzZSAndSc6XG4gICAgICByZXR1cm4gYDx1PiR7Y2hpbGRyZW4oKX08L3U+YDtcblxuICAgIGNhc2UgJ2NvZGUnOlxuICAgICAgLy8gVGhlIGNvZGVibG9jayBjYXNlICg8cHJlPjxjb2RlPikgaXMgaGFuZGxlZCBieSA8cHJlPjsgaW5saW5lIDxjb2RlPlxuICAgICAgLy8gZ2V0cyB0aGUgaW5saW5lLWNvZGUgY2xhc3MuXG4gICAgICByZXR1cm4gYDxjb2RlIGNsYXNzPVwiZGZjYy1jb2RlXCI+JHtjaGlsZHJlbigpfTwvY29kZT5gO1xuXG4gICAgY2FzZSAncHJlJzpcbiAgICAgIHJldHVybiBgPHByZSBjbGFzcz1cImRmY2MtY29kZWJsb2NrXCI+JHtjaGlsZHJlbigpfTwvcHJlPmA7XG5cbiAgICBjYXNlICdibG9ja3F1b3RlJzpcbiAgICAgIHJldHVybiBgPGJsb2NrcXVvdGUgY2xhc3M9XCJkZmNjLXF1b3RlXCI+JHtjaGlsZHJlbigpfTwvYmxvY2txdW90ZT5gO1xuXG4gICAgY2FzZSAnb2wnOlxuICAgICAgcmV0dXJuIGA8b2wgY2xhc3M9XCJkZmNjLWxpc3RcIj4ke2NoaWxkcmVuKCl9PC9vbD5gO1xuICAgIGNhc2UgJ3VsJzpcbiAgICAgIHJldHVybiBgPHVsIGNsYXNzPVwiZGZjYy1saXN0XCI+JHtjaGlsZHJlbigpfTwvdWw+YDtcbiAgICBjYXNlICdsaSc6XG4gICAgICByZXR1cm4gYDxsaT4ke2NoaWxkcmVuKCl9PC9saT5gO1xuXG4gICAgY2FzZSAnaDEnOlxuICAgICAgcmV0dXJuIGA8ZGl2IGNsYXNzPVwiZGZjYy1oMVwiPiR7Y2hpbGRyZW4oKX08L2Rpdj5gO1xuICAgIGNhc2UgJ2gyJzpcbiAgICAgIHJldHVybiBgPGRpdiBjbGFzcz1cImRmY2MtaDJcIj4ke2NoaWxkcmVuKCl9PC9kaXY+YDtcbiAgICBjYXNlICdoMyc6XG4gICAgICByZXR1cm4gYDxkaXYgY2xhc3M9XCJkZmNjLWgzXCI+JHtjaGlsZHJlbigpfTwvZGl2PmA7XG5cbiAgICBjYXNlICdhJzoge1xuICAgICAgY29uc3QgaHJlZiA9IHNhbml0aXplVXJsKGVsLmdldEF0dHJpYnV0ZSgnaHJlZicpID8/ICcnKTtcbiAgICAgIHJldHVybiBgPGEgaHJlZj1cIiR7ZXNjYXBlQXR0cihocmVmKX1cIiBjbGFzcz1cImRmY2MtbGlua1wiPiR7Y2hpbGRyZW4oKX08L2E+YDtcbiAgICB9XG5cbiAgICBjYXNlICdpbWcnOiB7XG4gICAgICBjb25zdCBzcmMgPSAoZWwgYXMgSFRNTEltYWdlRWxlbWVudCkuc3JjO1xuICAgICAgY29uc3QgYWx0ID0gZWwuZ2V0QXR0cmlidXRlKCdhbHQnKSA/PyAnJztcbiAgICAgIC8vIFVSTHMgdGhhdCB3b3VsZCBicmVhayB0aGUgYXR0cmlidXRlIG9yIGFyZW4ndCBzYWZlIOKGkiBkcm9wIHRoZSBpbWFnZS5cbiAgICAgIGlmICghc3JjIHx8IHNyYy5pbmNsdWRlcygnXCInKSB8fCAhL15odHRwcz86L2kudGVzdChzcmMpKSByZXR1cm4gJyc7XG4gICAgICByZXR1cm4gYDxpbWcgc3JjPVwiJHtzcmN9XCIgYWx0PVwiJHtlc2NhcGVBdHRyKGFsdCl9XCIgY2xhc3M9XCJkZmNjLWVtb2ppXCI+YDtcbiAgICB9XG5cbiAgICBjYXNlICdzcGFuJzoge1xuICAgICAgY29uc3QgY2xzID0gZWwuZ2V0QXR0cmlidXRlKCdjbGFzcycpID8/ICcnO1xuICAgICAgaWYgKC9tZW50aW9uL2kudGVzdChjbHMpKSByZXR1cm4gYDxzcGFuIGNsYXNzPVwiZGZjYy1tZW50aW9uXCI+JHtjaGlsZHJlbigpfTwvc3Bhbj5gO1xuICAgICAgaWYgKC9zcG9pbGVyL2kudGVzdChjbHMpKSByZXR1cm4gYDxzcGFuIGNsYXNzPVwiZGZjYy1zcG9pbGVyXCI+JHtjaGlsZHJlbigpfTwvc3Bhbj5gO1xuICAgICAgcmV0dXJuIGNoaWxkcmVuKCk7IC8vIHVud3JhcCB1bmtub3duIHNwYW5zXG4gICAgfVxuXG4gICAgY2FzZSAnZGl2JzpcbiAgICBjYXNlICdwJzpcbiAgICAgIC8vIERpc2NvcmQgd3JhcHMgcGFyYWdyYXBocy9ibG9ja3MgaW4gZGl2cyB3ZSBkb24ndCBuZWVkIHRvIHByZXNlcnZlLlxuICAgICAgcmV0dXJuIGNoaWxkcmVuKCk7XG5cbiAgICBjYXNlICdzY3JpcHQnOlxuICAgIGNhc2UgJ3N0eWxlJzpcbiAgICBjYXNlICdpZnJhbWUnOlxuICAgIGNhc2UgJ29iamVjdCc6XG4gICAgY2FzZSAnZW1iZWQnOlxuICAgICAgcmV0dXJuICcnO1xuXG4gICAgZGVmYXVsdDpcbiAgICAgIC8vIFN0cmlwIHRoZSB0YWcsIGtlZXAgdGhlIHRleHQgaW5zaWRlLlxuICAgICAgcmV0dXJuIGNoaWxkcmVuKCk7XG4gIH1cbn1cblxuY29uc3QgRU5USVRZX01BUDogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgJyYnOiAnJmFtcDsnLFxuICAnPCc6ICcmbHQ7JyxcbiAgJz4nOiAnJmd0OycsXG4gICdcIic6ICcmcXVvdDsnLFxuICBcIidcIjogJyYjMzk7Jyxcbn07XG5cbmZ1bmN0aW9uIGVzY2FwZUh0bWwoczogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHMucmVwbGFjZSgvWyY8PlwiJ10vZywgKGMpID0+IEVOVElUWV9NQVBbY10hKTtcbn1cblxuZnVuY3Rpb24gZXNjYXBlQXR0cihzOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gZXNjYXBlSHRtbChzKTtcbn1cblxuLyoqIEFsbG93IGh0dHAocykgLyBtYWlsdG8gLyBkaXNjb3JkIGRlZXAgbGlua3MgLyBhbmNob3JzIG9ubHkg4oCUIGJsb2NrIGphdmFzY3JpcHQ6LCBkYXRhOiwgZXRjLiAqL1xuZnVuY3Rpb24gc2FuaXRpemVVcmwodXJsOiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoIXVybCkgcmV0dXJuICcjJztcbiAgaWYgKC9eKGh0dHBzPzp8bWFpbHRvOnxkaXNjb3JkOnwjKS9pLnRlc3QodXJsKSkgcmV0dXJuIHVybDtcbiAgcmV0dXJuICcjJztcbn1cbiIsIi8qKlxuICogUmVhZHMgc3RydWN0dXJlZCBtZXNzYWdlIGRhdGEgb3V0IG9mIHRoZSBEaXNjb3JkIERPTS5cbiAqXG4gKiBEaXNjb3JkJ3MgQ1NTIGNsYXNzIG5hbWVzIGFyZSBoYXNoZWQgKGBtZXNzYWdlX2ExYjJjM2ApLCBzbyBzZWxlY3RvcnMgbGVhbiBvblxuICogc3RhYmxlIGJpdHM6IGVsZW1lbnQgaWRzIChgY2hhdC1tZXNzYWdlcy3igKZgLCBgbWVzc2FnZS1jb250ZW50LeKApmApLCB0aGVcbiAqIGA8dGltZSBkYXRldGltZT5gIGF0dHJpYnV0ZSwgYW5kIGBbY2xhc3MqPVwi4oCmXCJdYCBzdWJzdHJpbmcgbWF0Y2hlcy5cbiAqL1xuXG5pbXBvcnQgeyBzYW5pdGl6ZUNvbnRlbnQgfSBmcm9tICcuL3Nhbml0aXplLWNvbnRlbnQnO1xuaW1wb3J0IHR5cGUge1xuICBDYXB0dXJlZEF0dGFjaG1lbnQsXG4gIENhcHR1cmVkQXV0aG9yLFxuICBDYXB0dXJlZE1lc3NhZ2UsXG4gIENhcHR1cmVkUmVhY3Rpb24sXG4gIENhcHR1cmVkUmVwbHksXG59IGZyb20gJy4vdHlwZXMnO1xuXG5jb25zdCBNU0dfU0VMRUNUT1IgPSAnbGlbaWRePVwiY2hhdC1tZXNzYWdlcy1cIl0nO1xuXG4vKiogRXh0cmFjdCB0aGUgdHJhaWxpbmcgbWVzc2FnZSBpZCBmcm9tIGEgYGNoYXQtbWVzc2FnZXMtPGNoYW5uZWw+LTxpZD5gIGVsZW1lbnQuICovXG5leHBvcnQgZnVuY3Rpb24gbWVzc2FnZUlkT2YobGk6IEhUTUxFbGVtZW50KTogc3RyaW5nIHtcbiAgcmV0dXJuIGxpLmlkLnNsaWNlKGxpLmlkLmxhc3RJbmRleE9mKCctJykgKyAxKTtcbn1cblxuLyoqXG4gKiBTY3JhcGUgZXZlcnkgbWVzc2FnZSBjdXJyZW50bHkgbW91bnRlZCBpbiB0aGUgRGlzY29yZCBtZXNzYWdlIGxpc3QsIGluXG4gKiBkb2N1bWVudCBvcmRlci4gR3JvdXBlZCAoY29uc2VjdXRpdmUgc2FtZS1hdXRob3IpIG1lc3NhZ2VzIGRvbid0IHJlcGVhdCB0aGVcbiAqIGF2YXRhci9oZWFkZXIgaW4gdGhlIERPTSwgc28gdGhlIGF1dGhvciBpcyBjYXJyaWVkIGZvcndhcmQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzY3JhcGVBbGxNZXNzYWdlcygpOiBDYXB0dXJlZE1lc3NhZ2VbXSB7XG4gIGNvbnN0IG91dDogQ2FwdHVyZWRNZXNzYWdlW10gPSBbXTtcbiAgbGV0IGNhcnJpZWQ6IENhcHR1cmVkQXV0aG9yIHwgbnVsbCA9IG51bGw7XG5cbiAgZm9yIChjb25zdCBsaSBvZiBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PihNU0dfU0VMRUNUT1IpKSB7XG4gICAgY29uc3QgaGVhZGVyID0gbGkucXVlcnlTZWxlY3RvcjxIVE1MRWxlbWVudD4oJ1tjbGFzcyo9XCJoZWFkZXJfXCJdIFtjbGFzcyo9XCJ1c2VybmFtZVwiXScpO1xuICAgIGNvbnN0IGdyb3VwU3RhcnQgPSBoZWFkZXIgIT0gbnVsbDtcblxuICAgIGlmIChncm91cFN0YXJ0KSB7XG4gICAgICBjYXJyaWVkID0ge1xuICAgICAgICBuYW1lOiBoZWFkZXIudGV4dENvbnRlbnQ/LnRyaW0oKSB8fCAnVW5rbm93bicsXG4gICAgICAgIGF2YXRhclVybDogb3duQXZhdGFyKGxpKSA/PyAnJyxcbiAgICAgICAgcm9sZUNvbG9yOiBoZWFkZXIuc3R5bGUuY29sb3IgfHwgbnVsbCxcbiAgICAgICAgYm90OiBsaS5xdWVyeVNlbGVjdG9yKCdbY2xhc3MqPVwiYm90VGFnXCJdJykgIT0gbnVsbCxcbiAgICAgIH07XG4gICAgfVxuICAgIGNvbnN0IGF1dGhvcjogQ2FwdHVyZWRBdXRob3IgPVxuICAgICAgY2FycmllZCA/PyB7IG5hbWU6ICdVbmtub3duJywgYXZhdGFyVXJsOiAnJywgcm9sZUNvbG9yOiBudWxsLCBib3Q6IGZhbHNlIH07XG5cbiAgICBjb25zdCBjb250ZW50RWwgPSBsaS5xdWVyeVNlbGVjdG9yPEhUTUxFbGVtZW50PignW2lkXj1cIm1lc3NhZ2UtY29udGVudC1cIl0nKTtcbiAgICBjb25zdCB0aW1lID0gbGkucXVlcnlTZWxlY3RvcigndGltZScpO1xuXG4gICAgb3V0LnB1c2goe1xuICAgICAgaWQ6IG1lc3NhZ2VJZE9mKGxpKSxcbiAgICAgIGF1dGhvcixcbiAgICAgIHRpbWVzdGFtcDogdGltZT8uZ2V0QXR0cmlidXRlKCdkYXRldGltZScpID8/ICcnLFxuICAgICAgdGltZXN0YW1wTGFiZWw6IHRpbWU/LnRleHRDb250ZW50Py50cmltKCkgPz8gJycsXG4gICAgICBjb250ZW50SHRtbDogY29udGVudEVsID8gc2FuaXRpemVDb250ZW50KGNvbnRlbnRFbCkgOiAnJyxcbiAgICAgIGVkaXRlZDogbGkucXVlcnlTZWxlY3RvcignW2NsYXNzKj1cImVkaXRlZFwiXScpICE9IG51bGwsXG4gICAgICByZXBseTogc2NyYXBlUmVwbHkobGkpLFxuICAgICAgcmVhY3Rpb25zOiBzY3JhcGVSZWFjdGlvbnMobGkpLFxuICAgICAgYXR0YWNobWVudHM6IHNjcmFwZUF0dGFjaG1lbnRzKGxpKSxcbiAgICAgIGdyb3VwU3RhcnQsXG4gICAgfSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqIFRoZSBtZXNzYWdlJ3Mgb3duIGF2YXRhciDigJQgc2tpcHBpbmcgdGhlIHRpbnkgYXZhdGFyIGluIGEgcmVwbHkgcHJldmlldy4gKi9cbmZ1bmN0aW9uIG93bkF2YXRhcihsaTogSFRNTEVsZW1lbnQpOiBzdHJpbmcgfCBudWxsIHtcbiAgZm9yIChjb25zdCBpbWcgb2YgbGkucXVlcnlTZWxlY3RvckFsbDxIVE1MSW1hZ2VFbGVtZW50PignaW1nW2NsYXNzKj1cImF2YXRhclwiXScpKSB7XG4gICAgaWYgKCFpbWcuY2xvc2VzdCgnW2NsYXNzKj1cInJlcGxpZWRNZXNzYWdlXCJdJykpIHJldHVybiBpbWcuc3JjO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG5mdW5jdGlvbiBzY3JhcGVSZXBseShsaTogSFRNTEVsZW1lbnQpOiBDYXB0dXJlZFJlcGx5IHwgbnVsbCB7XG4gIGNvbnN0IGVsID0gbGkucXVlcnlTZWxlY3RvcjxIVE1MRWxlbWVudD4oJ1tjbGFzcyo9XCJyZXBsaWVkTWVzc2FnZVwiXScpO1xuICBpZiAoIWVsKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgYXV0aG9yID0gZWwucXVlcnlTZWxlY3RvcjxIVE1MRWxlbWVudD4oJ1tjbGFzcyo9XCJ1c2VybmFtZVwiXScpO1xuICBjb25zdCB0ZXh0ID0gZWwucXVlcnlTZWxlY3RvcjxIVE1MRWxlbWVudD4oXG4gICAgJ1tjbGFzcyo9XCJyZXBsaWVkVGV4dENvbnRlbnRcIl0sIFtjbGFzcyo9XCJyZXBsaWVkVGV4dFByZXZpZXdcIl0nLFxuICApO1xuICByZXR1cm4ge1xuICAgIGF1dGhvck5hbWU6IGF1dGhvcj8udGV4dENvbnRlbnQ/LnRyaW0oKSA/PyAnJyxcbiAgICBjb250ZW50OiAodGV4dCA/PyBlbCkudGV4dENvbnRlbnQ/LnRyaW0oKSA/PyAnJyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gc2NyYXBlUmVhY3Rpb25zKGxpOiBIVE1MRWxlbWVudCk6IENhcHR1cmVkUmVhY3Rpb25bXSB7XG4gIGNvbnN0IG91dDogQ2FwdHVyZWRSZWFjdGlvbltdID0gW107XG4gIGZvciAoY29uc3QgciBvZiBsaS5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignW2NsYXNzKj1cInJlYWN0aW9uX1wiXScpKSB7XG4gICAgY29uc3QgaW1nID0gci5xdWVyeVNlbGVjdG9yPEhUTUxJbWFnZUVsZW1lbnQ+KCdpbWcnKTtcbiAgICBjb25zdCBjb3VudCA9IHIucXVlcnlTZWxlY3RvcjxIVE1MRWxlbWVudD4oJ1tjbGFzcyo9XCJyZWFjdGlvbkNvdW50XCJdJyk7XG4gICAgb3V0LnB1c2goe1xuICAgICAgZW1vamk6IGltZz8uYWx0ID8/ICcnLFxuICAgICAgZW1vamlVcmw6IGltZz8uc3JjID8/IG51bGwsXG4gICAgICBjb3VudDogTnVtYmVyLnBhcnNlSW50KGNvdW50Py50ZXh0Q29udGVudCA/PyAnMScsIDEwKSB8fCAxLFxuICAgIH0pO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbmZ1bmN0aW9uIHNjcmFwZUF0dGFjaG1lbnRzKGxpOiBIVE1MRWxlbWVudCk6IENhcHR1cmVkQXR0YWNobWVudFtdIHtcbiAgY29uc3Qgb3V0OiBDYXB0dXJlZEF0dGFjaG1lbnRbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGltZyBvZiBsaS5xdWVyeVNlbGVjdG9yQWxsPEhUTUxJbWFnZUVsZW1lbnQ+KCdpbWcnKSkge1xuICAgIGlmICghL1xcL2F0dGFjaG1lbnRzXFwvLy50ZXN0KGltZy5zcmMpKSBjb250aW51ZTtcbiAgICBpZiAoaW1nLmNsb3Nlc3QoJ1tjbGFzcyo9XCJyZXBsaWVkTWVzc2FnZVwiXScpIHx8IGltZy5jbG9zZXN0KCdbY2xhc3MqPVwicmVhY3Rpb25fXCJdJykpIGNvbnRpbnVlO1xuICAgIG91dC5wdXNoKHtcbiAgICAgIHVybDogaW1nLnNyYyxcbiAgICAgIHdpZHRoOiBpbWcubmF0dXJhbFdpZHRoIHx8IG51bGwsXG4gICAgICBoZWlnaHQ6IGltZy5uYXR1cmFsSGVpZ2h0IHx8IG51bGwsXG4gICAgfSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqIEJlc3QtZWZmb3J0IG5hbWUgb2YgdGhlIGN1cnJlbnQgY2hhbm5lbCAvIERNLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldFNvdXJjZU5hbWUoKTogc3RyaW5nIHtcbiAgY29uc3QgaGVhZGluZyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3I8SFRNTEVsZW1lbnQ+KFxuICAgICdzZWN0aW9uW2FyaWEtbGFiZWxdIGgxLCBbY2xhc3MqPVwidGl0bGVfXCJdIGgxLCBoMVtjbGFzcyo9XCJ0aXRsZVwiXScsXG4gICk7XG4gIGlmIChoZWFkaW5nPy50ZXh0Q29udGVudD8udHJpbSgpKSByZXR1cm4gaGVhZGluZy50ZXh0Q29udGVudC50cmltKCk7XG4gIHJldHVybiAoXG4gICAgZG9jdW1lbnQudGl0bGVcbiAgICAgIC5yZXBsYWNlKC9eXFwoXFxkK1xcKVxccyovLCAnJylcbiAgICAgIC5yZXBsYWNlKC9cXHMqW3zigKJdXFxzKkRpc2NvcmQuKiQvaSwgJycpXG4gICAgICAudHJpbSgpIHx8ICdEaXNjb3JkJ1xuICApO1xufVxuIiwiaW1wb3J0IHsgZ2V0U291cmNlTmFtZSwgbWVzc2FnZUlkT2YsIHNjcmFwZUFsbE1lc3NhZ2VzIH0gZnJvbSAnQC91dGlscy9kb20tc2NyYXBlcic7XG5pbXBvcnQgdHlwZSB7IENhcHR1cmUsIFJ1bnRpbWVNZXNzYWdlIH0gZnJvbSAnQC91dGlscy90eXBlcyc7XG5cbmNvbnN0IE1TR19TRUxFQ1RPUiA9ICdsaVtpZF49XCJjaGF0LW1lc3NhZ2VzLVwiXSc7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbnRlbnRTY3JpcHQoe1xuICBtYXRjaGVzOiBbJ2h0dHBzOi8vZGlzY29yZC5jb20vKicsICdodHRwczovLyouZGlzY29yZC5jb20vKiddLFxuICBtYWluKCkge1xuICAgIGluamVjdFN0eWxlcygpO1xuICAgIGNvbnN0IHNlc3Npb24gPSBuZXcgQ2FwdHVyZVNlc3Npb24oKTtcbiAgICBicm93c2VyLnJ1bnRpbWUub25NZXNzYWdlLmFkZExpc3RlbmVyKChtZXNzYWdlOiBSdW50aW1lTWVzc2FnZSkgPT4ge1xuICAgICAgaWYgKG1lc3NhZ2UudHlwZSA9PT0gJ1RPR0dMRV9DQVBUVVJFJykgc2Vzc2lvbi50b2dnbGUoKTtcbiAgICB9KTtcbiAgfSxcbn0pO1xuXG4vKipcbiAqIERyaXZlcyB0aGUgb24tcGFnZSBjYXB0dXJlIGZsb3c6IHRoZSB1c2VyIGNsaWNrcyBhIHN0YXJ0IG1lc3NhZ2UsIHRoZW4gYW4gZW5kXG4gKiBtZXNzYWdlLCBhbmQgZXZlcnl0aGluZyBiZXR3ZWVuIHRoZW0gaXMgc2NyYXBlZCBhbmQgc2VudCB0byB0aGUgYmFja2dyb3VuZC5cbiAqL1xuY2xhc3MgQ2FwdHVyZVNlc3Npb24ge1xuICBwcml2YXRlIG1vZGU6ICdpZGxlJyB8ICdzdGFydCcgfCAnZW5kJyA9ICdpZGxlJztcbiAgcHJpdmF0ZSBzdGFydElkOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBiYW5uZXI6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgaG92ZXJlZDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcblxuICB0b2dnbGUoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMubW9kZSA9PT0gJ2lkbGUnKSB0aGlzLmJlZ2luKCk7XG4gICAgZWxzZSB0aGlzLmNhbmNlbCgpO1xuICB9XG5cbiAgcHJpdmF0ZSBiZWdpbigpOiB2b2lkIHtcbiAgICB0aGlzLm1vZGUgPSAnc3RhcnQnO1xuICAgIHRoaXMuc3RhcnRJZCA9IG51bGw7XG4gICAgdGhpcy5iYW5uZXIgPSBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKE9iamVjdC5hc3NpZ24oZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JyksIHtcbiAgICAgIGNsYXNzTmFtZTogJ2RmY2MtYmFubmVyJyxcbiAgICB9KSk7XG4gICAgdGhpcy51cGRhdGVCYW5uZXIoKTtcbiAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCB0aGlzLm9uTW92ZSwgdHJ1ZSk7XG4gICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCB0aGlzLm9uQ2xpY2ssIHRydWUpO1xuICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCB0aGlzLm9uS2V5LCB0cnVlKTtcbiAgfVxuXG4gIGNhbmNlbCgpOiB2b2lkIHtcbiAgICB0aGlzLm1vZGUgPSAnaWRsZSc7XG4gICAgdGhpcy5zdGFydElkID0gbnVsbDtcbiAgICB0aGlzLmNsZWFySG92ZXIoKTtcbiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcuZGZjYy1zdGFydCcpLmZvckVhY2goKGVsKSA9PiBlbC5jbGFzc0xpc3QucmVtb3ZlKCdkZmNjLXN0YXJ0JykpO1xuICAgIGRvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIHRoaXMub25Nb3ZlLCB0cnVlKTtcbiAgICBkb2N1bWVudC5yZW1vdmVFdmVudExpc3RlbmVyKCdjbGljaycsIHRoaXMub25DbGljaywgdHJ1ZSk7XG4gICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIHRoaXMub25LZXksIHRydWUpO1xuICAgIHRoaXMuYmFubmVyPy5yZW1vdmUoKTtcbiAgICB0aGlzLmJhbm5lciA9IG51bGw7XG4gIH1cblxuICBwcml2YXRlIG9uS2V5ID0gKGU6IEtleWJvYXJkRXZlbnQpOiB2b2lkID0+IHtcbiAgICBpZiAoZS5rZXkgPT09ICdFc2NhcGUnKSB7XG4gICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICB0aGlzLmNhbmNlbCgpO1xuICAgIH1cbiAgfTtcblxuICBwcml2YXRlIG9uTW92ZSA9IChlOiBNb3VzZUV2ZW50KTogdm9pZCA9PiB7XG4gICAgY29uc3QgbGkgPSAoZS50YXJnZXQgYXMgSFRNTEVsZW1lbnQgfCBudWxsKT8uY2xvc2VzdDxIVE1MRWxlbWVudD4oTVNHX1NFTEVDVE9SKSA/PyBudWxsO1xuICAgIGlmIChsaSA9PT0gdGhpcy5ob3ZlcmVkKSByZXR1cm47XG4gICAgdGhpcy5jbGVhckhvdmVyKCk7XG4gICAgaWYgKGxpKSB7XG4gICAgICBsaS5jbGFzc0xpc3QuYWRkKCdkZmNjLWhvdmVyJyk7XG4gICAgICB0aGlzLmhvdmVyZWQgPSBsaTtcbiAgICB9XG4gIH07XG5cbiAgcHJpdmF0ZSBjbGVhckhvdmVyKCk6IHZvaWQge1xuICAgIHRoaXMuaG92ZXJlZD8uY2xhc3NMaXN0LnJlbW92ZSgnZGZjYy1ob3ZlcicpO1xuICAgIHRoaXMuaG92ZXJlZCA9IG51bGw7XG4gIH1cblxuICBwcml2YXRlIG9uQ2xpY2sgPSAoZTogTW91c2VFdmVudCk6IHZvaWQgPT4ge1xuICAgIGNvbnN0IGxpID0gKGUudGFyZ2V0IGFzIEhUTUxFbGVtZW50IHwgbnVsbCk/LmNsb3Nlc3Q8SFRNTEVsZW1lbnQ+KE1TR19TRUxFQ1RPUik7XG4gICAgaWYgKCFsaSkgcmV0dXJuO1xuICAgIC8vIFN3YWxsb3cgdGhlIGNsaWNrIHNvIERpc2NvcmQgZG9lc24ndCByZWFjdCB0byBpdC5cbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcblxuICAgIGlmICh0aGlzLm1vZGUgPT09ICdzdGFydCcpIHtcbiAgICAgIHRoaXMuc3RhcnRJZCA9IG1lc3NhZ2VJZE9mKGxpKTtcbiAgICAgIGxpLmNsYXNzTGlzdC5hZGQoJ2RmY2Mtc3RhcnQnKTtcbiAgICAgIHRoaXMubW9kZSA9ICdlbmQnO1xuICAgICAgdGhpcy51cGRhdGVCYW5uZXIoKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMubW9kZSA9PT0gJ2VuZCcpIHtcbiAgICAgIHRoaXMuZmluaXNoKG1lc3NhZ2VJZE9mKGxpKSk7XG4gICAgfVxuICB9O1xuXG4gIHByaXZhdGUgZmluaXNoKGVuZElkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBhbGwgPSBzY3JhcGVBbGxNZXNzYWdlcygpO1xuICAgIGxldCBpID0gYWxsLmZpbmRJbmRleCgobSkgPT4gbS5pZCA9PT0gdGhpcy5zdGFydElkKTtcbiAgICBsZXQgaiA9IGFsbC5maW5kSW5kZXgoKG0pID0+IG0uaWQgPT09IGVuZElkKTtcbiAgICBpZiAoaSA9PT0gLTEgfHwgaiA9PT0gLTEpIHtcbiAgICAgIHRoaXMuc2V0QmFubmVyKCfimqDvuI8g66mU7Iuc7KeA66W8IOywvuyngCDrqrvtlojslrTsmpQg4oCUIOq1rOqwhOydtCDtmZTrqbQg67CW7Jy866GcIOuyl+yWtOuCrOydhCDsiJgg7J6I7Ja07JqULiDri6Tsi5wg7YG066at7ZW0IOyjvOyEuOyalC4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKGkgPiBqKSBbaSwgal0gPSBbaiwgaV07XG5cbiAgICBjb25zdCBtZXNzYWdlcyA9IGFsbC5zbGljZShpLCBqICsgMSk7XG4gICAgLy8gVGhlIGZpcnN0IG1lc3NhZ2Ugb2YgdGhlIHNlbGVjdGlvbiBhbHdheXMgc2hvd3MgaXRzIGhlYWRlciwgZXZlbiBpZiBpdFxuICAgIC8vIHdhcyBtaWQtZ3JvdXAgaW4gdGhlIG9yaWdpbmFsIGNvbnZlcnNhdGlvbi5cbiAgICBtZXNzYWdlc1swXSA9IHsgLi4ubWVzc2FnZXNbMF0sIGdyb3VwU3RhcnQ6IHRydWUgfTtcblxuICAgIGNvbnN0IGNhcHR1cmU6IENhcHR1cmUgPSB7XG4gICAgICBzb3VyY2U6IGdldFNvdXJjZU5hbWUoKSxcbiAgICAgIGNhcHR1cmVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIG1lc3NhZ2VzLFxuICAgIH07XG4gICAgdm9pZCBicm93c2VyLnJ1bnRpbWUuc2VuZE1lc3NhZ2UoeyB0eXBlOiAnQ0FQVFVSRV9SRVNVTFQnLCBjYXB0dXJlIH0gc2F0aXNmaWVzIFJ1bnRpbWVNZXNzYWdlKTtcblxuICAgIHRoaXMubW9kZSA9ICdpZGxlJztcbiAgICB0aGlzLnNldEJhbm5lcihg4pyFICR7bWVzc2FnZXMubGVuZ3RofeqwnCDrqZTsi5zsp4Ag7Lqh7LOQIOyZhOujjCDigJQg7JeQ65SU7YSw66W8IOyXrOuKlCDspJHigKZgKTtcbiAgICB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB0aGlzLmNhbmNlbCgpLCAxNjAwKTtcbiAgfVxuXG4gIHByaXZhdGUgdXBkYXRlQmFubmVyKCk6IHZvaWQge1xuICAgIHRoaXMuc2V0QmFubmVyKFxuICAgICAgdGhpcy5tb2RlID09PSAnc3RhcnQnXG4gICAgICAgID8gJzEgLyAyICDCtyAg7Lqh7LOQ66W8IOyLnOyeke2VoCDrqZTsi5zsp4Drpbwg7YG066at7ZWY7IS47JqUICAgIChFc2M6IOy3qOyGjCknXG4gICAgICAgIDogJzIgLyAyICDCtyAg7Lqh7LOQ66W8IOuBneuCvCDrqZTsi5zsp4Drpbwg7YG066at7ZWY7IS47JqUICAgIChFc2M6IOy3qOyGjCknLFxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIHNldEJhbm5lcih0ZXh0OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5iYW5uZXIpIHRoaXMuYmFubmVyLnRleHRDb250ZW50ID0gdGV4dDtcbiAgfVxufVxuXG5mdW5jdGlvbiBpbmplY3RTdHlsZXMoKTogdm9pZCB7XG4gIGNvbnN0IHN0eWxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3R5bGUnKTtcbiAgc3R5bGUudGV4dENvbnRlbnQgPSBgXG4gICAgLmRmY2MtYmFubmVyIHtcbiAgICAgIHBvc2l0aW9uOiBmaXhlZDsgdG9wOiAxOHB4OyBsZWZ0OiA1MCU7IHRyYW5zZm9ybTogdHJhbnNsYXRlWCgtNTAlKTtcbiAgICAgIHotaW5kZXg6IDIxNDc0ODM2NDc7IHBvaW50ZXItZXZlbnRzOiBub25lO1xuICAgICAgYmFja2dyb3VuZDogIzU4NjVmMjsgY29sb3I6ICNmZmY7XG4gICAgICBmb250OiA2MDAgMTRweC8xLjQgLWFwcGxlLXN5c3RlbSwgc3lzdGVtLXVpLCBzYW5zLXNlcmlmO1xuICAgICAgcGFkZGluZzogMTFweCAyMHB4OyBib3JkZXItcmFkaXVzOiAxMHB4O1xuICAgICAgYm94LXNoYWRvdzogMCA4cHggMjhweCByZ2JhKDAsIDAsIDAsIC40NSk7XG4gICAgfVxuICAgIC5kZmNjLWhvdmVyIHtcbiAgICAgIG91dGxpbmU6IDJweCBzb2xpZCAjNTg2NWYyICFpbXBvcnRhbnQ7IG91dGxpbmUtb2Zmc2V0OiAtMnB4O1xuICAgICAgYmFja2dyb3VuZDogcmdiYSg4OCwgMTAxLCAyNDIsIC4xMCkgIWltcG9ydGFudDsgY3Vyc29yOiBjcm9zc2hhaXIgIWltcG9ydGFudDtcbiAgICB9XG4gICAgLmRmY2Mtc3RhcnQge1xuICAgICAgb3V0bGluZTogMnB4IHNvbGlkICMzYmE1NWQgIWltcG9ydGFudDsgb3V0bGluZS1vZmZzZXQ6IC0ycHg7XG4gICAgICBiYWNrZ3JvdW5kOiByZ2JhKDU5LCAxNjUsIDkzLCAuMTQpICFpbXBvcnRhbnQ7XG4gICAgfVxuICBgO1xuICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHN0eWxlKTtcbn1cbiIsIi8vI3JlZ2lvbiBzcmMvdXRpbHMvaW50ZXJuYWwvbG9nZ2VyLnRzXG5mdW5jdGlvbiBwcmludChtZXRob2QsIC4uLmFyZ3MpIHtcblx0aWYgKGltcG9ydC5tZXRhLmVudi5NT0RFID09PSBcInByb2R1Y3Rpb25cIikgcmV0dXJuO1xuXHRpZiAodHlwZW9mIGFyZ3NbMF0gPT09IFwic3RyaW5nXCIpIG1ldGhvZChgW3d4dF0gJHthcmdzLnNoaWZ0KCl9YCwgLi4uYXJncyk7XG5cdGVsc2UgbWV0aG9kKFwiW3d4dF1cIiwgLi4uYXJncyk7XG59XG4vKiogV3JhcHBlciBhcm91bmQgYGNvbnNvbGVgIHdpdGggYSBcIlt3eHRdXCIgcHJlZml4ICovXG5jb25zdCBsb2dnZXIgPSB7XG5cdGRlYnVnOiAoLi4uYXJncykgPT4gcHJpbnQoY29uc29sZS5kZWJ1ZywgLi4uYXJncyksXG5cdGxvZzogKC4uLmFyZ3MpID0+IHByaW50KGNvbnNvbGUubG9nLCAuLi5hcmdzKSxcblx0d2FybjogKC4uLmFyZ3MpID0+IHByaW50KGNvbnNvbGUud2FybiwgLi4uYXJncyksXG5cdGVycm9yOiAoLi4uYXJncykgPT4gcHJpbnQoY29uc29sZS5lcnJvciwgLi4uYXJncylcbn07XG4vLyNlbmRyZWdpb25cbmV4cG9ydCB7IGxvZ2dlciB9O1xuIiwiaW1wb3J0IHsgYnJvd3NlciB9IGZyb20gXCJ3eHQvYnJvd3NlclwiO1xuLy8jcmVnaW9uIHNyYy91dGlscy9pbnRlcm5hbC9jdXN0b20tZXZlbnRzLnRzXG52YXIgV3h0TG9jYXRpb25DaGFuZ2VFdmVudCA9IGNsYXNzIFd4dExvY2F0aW9uQ2hhbmdlRXZlbnQgZXh0ZW5kcyBFdmVudCB7XG5cdHN0YXRpYyBFVkVOVF9OQU1FID0gZ2V0VW5pcXVlRXZlbnROYW1lKFwid3h0OmxvY2F0aW9uY2hhbmdlXCIpO1xuXHRjb25zdHJ1Y3RvcihuZXdVcmwsIG9sZFVybCkge1xuXHRcdHN1cGVyKFd4dExvY2F0aW9uQ2hhbmdlRXZlbnQuRVZFTlRfTkFNRSwge30pO1xuXHRcdHRoaXMubmV3VXJsID0gbmV3VXJsO1xuXHRcdHRoaXMub2xkVXJsID0gb2xkVXJsO1xuXHR9XG59O1xuLyoqXG4qIFJldHVybnMgYW4gZXZlbnQgbmFtZSB1bmlxdWUgdG8gdGhlIGV4dGVuc2lvbiBhbmQgY29udGVudCBzY3JpcHQgdGhhdCdzXG4qIHJ1bm5pbmcuXG4qL1xuZnVuY3Rpb24gZ2V0VW5pcXVlRXZlbnROYW1lKGV2ZW50TmFtZSkge1xuXHRyZXR1cm4gYCR7YnJvd3Nlcj8ucnVudGltZT8uaWR9OiR7aW1wb3J0Lm1ldGEuZW52LkVOVFJZUE9JTlR9OiR7ZXZlbnROYW1lfWA7XG59XG4vLyNlbmRyZWdpb25cbmV4cG9ydCB7IFd4dExvY2F0aW9uQ2hhbmdlRXZlbnQsIGdldFVuaXF1ZUV2ZW50TmFtZSB9O1xuIiwiaW1wb3J0IHsgV3h0TG9jYXRpb25DaGFuZ2VFdmVudCB9IGZyb20gXCIuL2N1c3RvbS1ldmVudHMubWpzXCI7XG4vLyNyZWdpb24gc3JjL3V0aWxzL2ludGVybmFsL2xvY2F0aW9uLXdhdGNoZXIudHNcbmNvbnN0IHN1cHBvcnRzTmF2aWdhdGlvbkFwaSA9IHR5cGVvZiBnbG9iYWxUaGlzLm5hdmlnYXRpb24/LmFkZEV2ZW50TGlzdGVuZXIgPT09IFwiZnVuY3Rpb25cIjtcbi8qKlxuKiBDcmVhdGUgYSB1dGlsIHRoYXQgd2F0Y2hlcyBmb3IgVVJMIGNoYW5nZXMsIGRpc3BhdGNoaW5nIHRoZSBjdXN0b20gZXZlbnQgd2hlblxuKiBkZXRlY3RlZC4gU3RvcHMgd2F0Y2hpbmcgd2hlbiBjb250ZW50IHNjcmlwdCBpcyBpbnZhbGlkYXRlZC4gVXNlcyBOYXZpZ2F0aW9uXG4qIEFQSSB3aGVuIGF2YWlsYWJsZSwgb3RoZXJ3aXNlIGZhbGxzIGJhY2sgdG8gcG9sbGluZy5cbiovXG5mdW5jdGlvbiBjcmVhdGVMb2NhdGlvbldhdGNoZXIoY3R4KSB7XG5cdGxldCBsYXN0VXJsO1xuXHRsZXQgd2F0Y2hpbmcgPSBmYWxzZTtcblx0cmV0dXJuIHsgcnVuKCkge1xuXHRcdGlmICh3YXRjaGluZykgcmV0dXJuO1xuXHRcdHdhdGNoaW5nID0gdHJ1ZTtcblx0XHRsYXN0VXJsID0gbmV3IFVSTChsb2NhdGlvbi5ocmVmKTtcblx0XHRpZiAoc3VwcG9ydHNOYXZpZ2F0aW9uQXBpKSBnbG9iYWxUaGlzLm5hdmlnYXRpb24uYWRkRXZlbnRMaXN0ZW5lcihcIm5hdmlnYXRlXCIsIChldmVudCkgPT4ge1xuXHRcdFx0Y29uc3QgbmV3VXJsID0gbmV3IFVSTChldmVudC5kZXN0aW5hdGlvbi51cmwpO1xuXHRcdFx0aWYgKG5ld1VybC5ocmVmID09PSBsYXN0VXJsLmhyZWYpIHJldHVybjtcblx0XHRcdHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBXeHRMb2NhdGlvbkNoYW5nZUV2ZW50KG5ld1VybCwgbGFzdFVybCkpO1xuXHRcdFx0bGFzdFVybCA9IG5ld1VybDtcblx0XHR9LCB7IHNpZ25hbDogY3R4LnNpZ25hbCB9KTtcblx0XHRlbHNlIGN0eC5zZXRJbnRlcnZhbCgoKSA9PiB7XG5cdFx0XHRjb25zdCBuZXdVcmwgPSBuZXcgVVJMKGxvY2F0aW9uLmhyZWYpO1xuXHRcdFx0aWYgKG5ld1VybC5ocmVmICE9PSBsYXN0VXJsLmhyZWYpIHtcblx0XHRcdFx0d2luZG93LmRpc3BhdGNoRXZlbnQobmV3IFd4dExvY2F0aW9uQ2hhbmdlRXZlbnQobmV3VXJsLCBsYXN0VXJsKSk7XG5cdFx0XHRcdGxhc3RVcmwgPSBuZXdVcmw7XG5cdFx0XHR9XG5cdFx0fSwgMWUzKTtcblx0fSB9O1xufVxuLy8jZW5kcmVnaW9uXG5leHBvcnQgeyBjcmVhdGVMb2NhdGlvbldhdGNoZXIgfTtcbiIsImltcG9ydCB7IGxvZ2dlciB9IGZyb20gXCIuL2ludGVybmFsL2xvZ2dlci5tanNcIjtcbmltcG9ydCB7IGdldFVuaXF1ZUV2ZW50TmFtZSB9IGZyb20gXCIuL2ludGVybmFsL2N1c3RvbS1ldmVudHMubWpzXCI7XG5pbXBvcnQgeyBjcmVhdGVMb2NhdGlvbldhdGNoZXIgfSBmcm9tIFwiLi9pbnRlcm5hbC9sb2NhdGlvbi13YXRjaGVyLm1qc1wiO1xuaW1wb3J0IHsgYnJvd3NlciB9IGZyb20gXCJ3eHQvYnJvd3NlclwiO1xuLy8jcmVnaW9uIHNyYy91dGlscy9jb250ZW50LXNjcmlwdC1jb250ZXh0LnRzXG4vKipcbiogSW1wbGVtZW50c1xuKiBbYEFib3J0Q29udHJvbGxlcmBdKGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0FQSS9BYm9ydENvbnRyb2xsZXIpLlxuKiBVc2VkIHRvIGRldGVjdCBhbmQgc3RvcCBjb250ZW50IHNjcmlwdCBjb2RlIHdoZW4gdGhlIHNjcmlwdCBpcyBpbnZhbGlkYXRlZC5cbipcbiogSXQgYWxzbyBwcm92aWRlcyBzZXZlcmFsIHV0aWxpdGllcyBsaWtlIGBjdHguc2V0VGltZW91dGAgYW5kXG4qIGBjdHguc2V0SW50ZXJ2YWxgIHRoYXQgc2hvdWxkIGJlIHVzZWQgaW4gY29udGVudCBzY3JpcHRzIGluc3RlYWQgb2ZcbiogYHdpbmRvdy5zZXRUaW1lb3V0YCBvciBgd2luZG93LnNldEludGVydmFsYC5cbipcbiogVG8gY3JlYXRlIGNvbnRleHQgZm9yIHRlc3RpbmcsIHlvdSBjYW4gdXNlIHRoZSBjbGFzcydzIGNvbnN0cnVjdG9yOlxuKlxuKiBgYGB0c1xuKiBpbXBvcnQgeyBDb250ZW50U2NyaXB0Q29udGV4dCB9IGZyb20gJ3d4dC91dGlscy9jb250ZW50LXNjcmlwdHMtY29udGV4dCc7XG4qXG4qIHRlc3QoJ3N0b3JhZ2UgbGlzdGVuZXIgc2hvdWxkIGJlIHJlbW92ZWQgd2hlbiBjb250ZXh0IGlzIGludmFsaWRhdGVkJywgKCkgPT4ge1xuKiAgIGNvbnN0IGN0eCA9IG5ldyBDb250ZW50U2NyaXB0Q29udGV4dCgndGVzdCcpO1xuKiAgIGNvbnN0IGl0ZW0gPSBzdG9yYWdlLmRlZmluZUl0ZW0oJ2xvY2FsOmNvdW50JywgeyBkZWZhdWx0VmFsdWU6IDAgfSk7XG4qICAgY29uc3Qgd2F0Y2hlciA9IHZpLmZuKCk7XG4qXG4qICAgY29uc3QgdW53YXRjaCA9IGl0ZW0ud2F0Y2god2F0Y2hlcik7XG4qICAgY3R4Lm9uSW52YWxpZGF0ZWQodW53YXRjaCk7IC8vIExpc3RlbiBmb3IgaW52YWxpZGF0ZSBoZXJlXG4qXG4qICAgYXdhaXQgaXRlbS5zZXRWYWx1ZSgxKTtcbiogICBleHBlY3Qod2F0Y2hlcikudG9CZUNhbGxlZFRpbWVzKDEpO1xuKiAgIGV4cGVjdCh3YXRjaGVyKS50b0JlQ2FsbGVkV2l0aCgxLCAwKTtcbipcbiogICBjdHgubm90aWZ5SW52YWxpZGF0ZWQoKTsgLy8gVXNlIHRoaXMgZnVuY3Rpb24gdG8gaW52YWxpZGF0ZSB0aGUgY29udGV4dFxuKiAgIGF3YWl0IGl0ZW0uc2V0VmFsdWUoMik7XG4qICAgZXhwZWN0KHdhdGNoZXIpLnRvQmVDYWxsZWRUaW1lcygxKTtcbiogfSk7XG4qIGBgYFxuKi9cbnZhciBDb250ZW50U2NyaXB0Q29udGV4dCA9IGNsYXNzIENvbnRlbnRTY3JpcHRDb250ZXh0IHtcblx0c3RhdGljIFNDUklQVF9TVEFSVEVEX01FU1NBR0VfVFlQRSA9IGdldFVuaXF1ZUV2ZW50TmFtZShcInd4dDpjb250ZW50LXNjcmlwdC1zdGFydGVkXCIpO1xuXHRpZDtcblx0YWJvcnRDb250cm9sbGVyO1xuXHRsb2NhdGlvbldhdGNoZXIgPSBjcmVhdGVMb2NhdGlvbldhdGNoZXIodGhpcyk7XG5cdGNvbnN0cnVjdG9yKGNvbnRlbnRTY3JpcHROYW1lLCBvcHRpb25zKSB7XG5cdFx0dGhpcy5jb250ZW50U2NyaXB0TmFtZSA9IGNvbnRlbnRTY3JpcHROYW1lO1xuXHRcdHRoaXMub3B0aW9ucyA9IG9wdGlvbnM7XG5cdFx0dGhpcy5pZCA9IE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIpO1xuXHRcdHRoaXMuYWJvcnRDb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpO1xuXHRcdHRoaXMuc3RvcE9sZFNjcmlwdHMoKTtcblx0XHR0aGlzLmxpc3RlbkZvck5ld2VyU2NyaXB0cygpO1xuXHR9XG5cdGdldCBzaWduYWwoKSB7XG5cdFx0cmV0dXJuIHRoaXMuYWJvcnRDb250cm9sbGVyLnNpZ25hbDtcblx0fVxuXHRhYm9ydChyZWFzb24pIHtcblx0XHRyZXR1cm4gdGhpcy5hYm9ydENvbnRyb2xsZXIuYWJvcnQocmVhc29uKTtcblx0fVxuXHRnZXQgaXNJbnZhbGlkKCkge1xuXHRcdGlmIChicm93c2VyLnJ1bnRpbWU/LmlkID09IG51bGwpIHRoaXMubm90aWZ5SW52YWxpZGF0ZWQoKTtcblx0XHRyZXR1cm4gdGhpcy5zaWduYWwuYWJvcnRlZDtcblx0fVxuXHRnZXQgaXNWYWxpZCgpIHtcblx0XHRyZXR1cm4gIXRoaXMuaXNJbnZhbGlkO1xuXHR9XG5cdC8qKlxuXHQqIEFkZCBhIGxpc3RlbmVyIHRoYXQgaXMgY2FsbGVkIHdoZW4gdGhlIGNvbnRlbnQgc2NyaXB0J3MgY29udGV4dCBpc1xuXHQqIGludmFsaWRhdGVkLlxuXHQqXG5cdCogQGV4YW1wbGVcblx0KiAgIGJyb3dzZXIucnVudGltZS5vbk1lc3NhZ2UuYWRkTGlzdGVuZXIoY2IpO1xuXHQqICAgY29uc3QgcmVtb3ZlSW52YWxpZGF0ZWRMaXN0ZW5lciA9IGN0eC5vbkludmFsaWRhdGVkKCgpID0+IHtcblx0KiAgICAgYnJvd3Nlci5ydW50aW1lLm9uTWVzc2FnZS5yZW1vdmVMaXN0ZW5lcihjYik7XG5cdCogICB9KTtcblx0KiAgIC8vIC4uLlxuXHQqICAgcmVtb3ZlSW52YWxpZGF0ZWRMaXN0ZW5lcigpO1xuXHQqXG5cdCogQHJldHVybnMgQSBmdW5jdGlvbiB0byByZW1vdmUgdGhlIGxpc3RlbmVyLlxuXHQqL1xuXHRvbkludmFsaWRhdGVkKGNiKSB7XG5cdFx0dGhpcy5zaWduYWwuYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGNiKTtcblx0XHRyZXR1cm4gKCkgPT4gdGhpcy5zaWduYWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGNiKTtcblx0fVxuXHQvKipcblx0KiBSZXR1cm4gYSBwcm9taXNlIHRoYXQgbmV2ZXIgcmVzb2x2ZXMuIFVzZWZ1bCBpZiB5b3UgaGF2ZSBhbiBhc3luYyBmdW5jdGlvblxuXHQqIHRoYXQgc2hvdWxkbid0IHJ1biBhZnRlciB0aGUgY29udGV4dCBpcyBleHBpcmVkLlxuXHQqXG5cdCogQGV4YW1wbGVcblx0KiAgIGNvbnN0IGdldFZhbHVlRnJvbVN0b3JhZ2UgPSBhc3luYyAoKSA9PiB7XG5cdCogICAgIGlmIChjdHguaXNJbnZhbGlkKSByZXR1cm4gY3R4LmJsb2NrKCk7XG5cdCpcblx0KiAgICAgLy8gLi4uXG5cdCogICB9O1xuXHQqL1xuXHRibG9jaygpIHtcblx0XHRyZXR1cm4gbmV3IFByb21pc2UoKCkgPT4ge30pO1xuXHR9XG5cdC8qKlxuXHQqIFdyYXBwZXIgYXJvdW5kIGB3aW5kb3cuc2V0SW50ZXJ2YWxgIHRoYXQgYXV0b21hdGljYWxseSBjbGVhcnMgdGhlIGludGVydmFsXG5cdCogd2hlbiBpbnZhbGlkYXRlZC5cblx0KlxuXHQqIEludGVydmFscyBjYW4gYmUgY2xlYXJlZCBieSBjYWxsaW5nIHRoZSBub3JtYWwgYGNsZWFySW50ZXJ2YWxgIGZ1bmN0aW9uLlxuXHQqL1xuXHRzZXRJbnRlcnZhbChoYW5kbGVyLCB0aW1lb3V0KSB7XG5cdFx0Y29uc3QgaWQgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG5cdFx0XHRpZiAodGhpcy5pc1ZhbGlkKSBoYW5kbGVyKCk7XG5cdFx0fSwgdGltZW91dCk7XG5cdFx0dGhpcy5vbkludmFsaWRhdGVkKCgpID0+IGNsZWFySW50ZXJ2YWwoaWQpKTtcblx0XHRyZXR1cm4gaWQ7XG5cdH1cblx0LyoqXG5cdCogV3JhcHBlciBhcm91bmQgYHdpbmRvdy5zZXRUaW1lb3V0YCB0aGF0IGF1dG9tYXRpY2FsbHkgY2xlYXJzIHRoZSBpbnRlcnZhbFxuXHQqIHdoZW4gaW52YWxpZGF0ZWQuXG5cdCpcblx0KiBUaW1lb3V0cyBjYW4gYmUgY2xlYXJlZCBieSBjYWxsaW5nIHRoZSBub3JtYWwgYHNldFRpbWVvdXRgIGZ1bmN0aW9uLlxuXHQqL1xuXHRzZXRUaW1lb3V0KGhhbmRsZXIsIHRpbWVvdXQpIHtcblx0XHRjb25zdCBpZCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuXHRcdFx0aWYgKHRoaXMuaXNWYWxpZCkgaGFuZGxlcigpO1xuXHRcdH0sIHRpbWVvdXQpO1xuXHRcdHRoaXMub25JbnZhbGlkYXRlZCgoKSA9PiBjbGVhclRpbWVvdXQoaWQpKTtcblx0XHRyZXR1cm4gaWQ7XG5cdH1cblx0LyoqXG5cdCogV3JhcHBlciBhcm91bmQgYHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWVgIHRoYXQgYXV0b21hdGljYWxseSBjYW5jZWxzXG5cdCogdGhlIHJlcXVlc3Qgd2hlbiBpbnZhbGlkYXRlZC5cblx0KlxuXHQqIENhbGxiYWNrcyBjYW4gYmUgY2FuY2VsZWQgYnkgY2FsbGluZyB0aGUgbm9ybWFsIGBjYW5jZWxBbmltYXRpb25GcmFtZWBcblx0KiBmdW5jdGlvbi5cblx0Ki9cblx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKGNhbGxiYWNrKSB7XG5cdFx0Y29uc3QgaWQgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoKC4uLmFyZ3MpID0+IHtcblx0XHRcdGlmICh0aGlzLmlzVmFsaWQpIGNhbGxiYWNrKC4uLmFyZ3MpO1xuXHRcdH0pO1xuXHRcdHRoaXMub25JbnZhbGlkYXRlZCgoKSA9PiBjYW5jZWxBbmltYXRpb25GcmFtZShpZCkpO1xuXHRcdHJldHVybiBpZDtcblx0fVxuXHQvKipcblx0KiBXcmFwcGVyIGFyb3VuZCBgd2luZG93LnJlcXVlc3RJZGxlQ2FsbGJhY2tgIHRoYXQgYXV0b21hdGljYWxseSBjYW5jZWxzIHRoZVxuXHQqIHJlcXVlc3Qgd2hlbiBpbnZhbGlkYXRlZC5cblx0KlxuXHQqIENhbGxiYWNrcyBjYW4gYmUgY2FuY2VsZWQgYnkgY2FsbGluZyB0aGUgbm9ybWFsIGBjYW5jZWxJZGxlQ2FsbGJhY2tgXG5cdCogZnVuY3Rpb24uXG5cdCovXG5cdHJlcXVlc3RJZGxlQ2FsbGJhY2soY2FsbGJhY2ssIG9wdGlvbnMpIHtcblx0XHRjb25zdCBpZCA9IHJlcXVlc3RJZGxlQ2FsbGJhY2soKC4uLmFyZ3MpID0+IHtcblx0XHRcdGlmICghdGhpcy5zaWduYWwuYWJvcnRlZCkgY2FsbGJhY2soLi4uYXJncyk7XG5cdFx0fSwgb3B0aW9ucyk7XG5cdFx0dGhpcy5vbkludmFsaWRhdGVkKCgpID0+IGNhbmNlbElkbGVDYWxsYmFjayhpZCkpO1xuXHRcdHJldHVybiBpZDtcblx0fVxuXHRhZGRFdmVudExpc3RlbmVyKHRhcmdldCwgdHlwZSwgaGFuZGxlciwgb3B0aW9ucykge1xuXHRcdGlmICh0eXBlID09PSBcInd4dDpsb2NhdGlvbmNoYW5nZVwiKSB7XG5cdFx0XHRpZiAodGhpcy5pc1ZhbGlkKSB0aGlzLmxvY2F0aW9uV2F0Y2hlci5ydW4oKTtcblx0XHR9XG5cdFx0dGFyZ2V0LmFkZEV2ZW50TGlzdGVuZXI/Lih0eXBlLnN0YXJ0c1dpdGgoXCJ3eHQ6XCIpID8gZ2V0VW5pcXVlRXZlbnROYW1lKHR5cGUpIDogdHlwZSwgaGFuZGxlciwge1xuXHRcdFx0Li4ub3B0aW9ucyxcblx0XHRcdHNpZ25hbDogdGhpcy5zaWduYWxcblx0XHR9KTtcblx0fVxuXHQvKipcblx0KiBAaW50ZXJuYWxcblx0KiBBYm9ydCB0aGUgYWJvcnQgY29udHJvbGxlciBhbmQgZXhlY3V0ZSBhbGwgYG9uSW52YWxpZGF0ZWRgIGxpc3RlbmVycy5cblx0Ki9cblx0bm90aWZ5SW52YWxpZGF0ZWQoKSB7XG5cdFx0dGhpcy5hYm9ydChcIkNvbnRlbnQgc2NyaXB0IGNvbnRleHQgaW52YWxpZGF0ZWRcIik7XG5cdFx0bG9nZ2VyLmRlYnVnKGBDb250ZW50IHNjcmlwdCBcIiR7dGhpcy5jb250ZW50U2NyaXB0TmFtZX1cIiBjb250ZXh0IGludmFsaWRhdGVkYCk7XG5cdH1cblx0c3RvcE9sZFNjcmlwdHMoKSB7XG5cdFx0ZG9jdW1lbnQuZGlzcGF0Y2hFdmVudChuZXcgQ3VzdG9tRXZlbnQoQ29udGVudFNjcmlwdENvbnRleHQuU0NSSVBUX1NUQVJURURfTUVTU0FHRV9UWVBFLCB7IGRldGFpbDoge1xuXHRcdFx0Y29udGVudFNjcmlwdE5hbWU6IHRoaXMuY29udGVudFNjcmlwdE5hbWUsXG5cdFx0XHRtZXNzYWdlSWQ6IHRoaXMuaWRcblx0XHR9IH0pKTtcblx0XHRpZiAoIXRoaXMub3B0aW9ucz8ubm9TY3JpcHRTdGFydGVkUG9zdE1lc3NhZ2UpIHdpbmRvdy5wb3N0TWVzc2FnZSh7XG5cdFx0XHR0eXBlOiBDb250ZW50U2NyaXB0Q29udGV4dC5TQ1JJUFRfU1RBUlRFRF9NRVNTQUdFX1RZUEUsXG5cdFx0XHRjb250ZW50U2NyaXB0TmFtZTogdGhpcy5jb250ZW50U2NyaXB0TmFtZSxcblx0XHRcdG1lc3NhZ2VJZDogdGhpcy5pZFxuXHRcdH0sIFwiKlwiKTtcblx0fVxuXHR2ZXJpZnlTY3JpcHRTdGFydGVkRXZlbnQoZXZlbnQpIHtcblx0XHRjb25zdCBpc1NhbWVDb250ZW50U2NyaXB0ID0gZXZlbnQuZGV0YWlsPy5jb250ZW50U2NyaXB0TmFtZSA9PT0gdGhpcy5jb250ZW50U2NyaXB0TmFtZTtcblx0XHRjb25zdCBpc0Zyb21TZWxmID0gZXZlbnQuZGV0YWlsPy5tZXNzYWdlSWQgPT09IHRoaXMuaWQ7XG5cdFx0cmV0dXJuIGlzU2FtZUNvbnRlbnRTY3JpcHQgJiYgIWlzRnJvbVNlbGY7XG5cdH1cblx0bGlzdGVuRm9yTmV3ZXJTY3JpcHRzKCkge1xuXHRcdGNvbnN0IGNiID0gKGV2ZW50KSA9PiB7XG5cdFx0XHRpZiAoIShldmVudCBpbnN0YW5jZW9mIEN1c3RvbUV2ZW50KSB8fCAhdGhpcy52ZXJpZnlTY3JpcHRTdGFydGVkRXZlbnQoZXZlbnQpKSByZXR1cm47XG5cdFx0XHR0aGlzLm5vdGlmeUludmFsaWRhdGVkKCk7XG5cdFx0fTtcblx0XHRkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKENvbnRlbnRTY3JpcHRDb250ZXh0LlNDUklQVF9TVEFSVEVEX01FU1NBR0VfVFlQRSwgY2IpO1xuXHRcdHRoaXMub25JbnZhbGlkYXRlZCgoKSA9PiBkb2N1bWVudC5yZW1vdmVFdmVudExpc3RlbmVyKENvbnRlbnRTY3JpcHRDb250ZXh0LlNDUklQVF9TVEFSVEVEX01FU1NBR0VfVFlQRSwgY2IpKTtcblx0fVxufTtcbi8vI2VuZHJlZ2lvblxuZXhwb3J0IHsgQ29udGVudFNjcmlwdENvbnRleHQgfTtcbiJdLCJ4X2dvb2dsZV9pZ25vcmVMaXN0IjpbMCwxLDIsNiw3LDgsOV0sIm1hcHBpbmdzIjoiOztDQUNBLFNBQVMsb0JBQW9CLFlBQVk7RUFDeEMsT0FBTztDQUNSOzs7Ozs7Ozs7Ozs7Ozs7OztDRWFBLElBQU0sVURmaUIsV0FBVyxTQUFTLFNBQVMsS0FDaEQsV0FBVyxVQUNYLFdBQVc7Ozs7Ozs7Ozs7Ozs7O0NFU2YsU0FBZ0IsZ0JBQWdCLE1BQXVCO0VBQ3JELElBQUksTUFBTTtFQUNWLEtBQUssTUFBTSxTQUFTLEtBQUssWUFBWSxPQUFPLFVBQVUsS0FBSztFQUMzRCxPQUFPO0NBQ1Q7Q0FFQSxTQUFTLFVBQVUsTUFBb0I7RUFDckMsSUFBSSxLQUFLLGFBQWEsS0FBSyxXQUN6QixPQUFPLFdBQVcsS0FBSyxlQUFlLEVBQUU7RUFFMUMsSUFBSSxLQUFLLGFBQWEsS0FBSyxjQUFjLE9BQU87RUFDaEQsTUFBTSxLQUFLO0VBQ1gsTUFBTSxpQkFBaUI7R0FDckIsSUFBSSxJQUFJO0dBQ1IsS0FBSyxNQUFNLFNBQVMsR0FBRyxZQUFZLEtBQUssVUFBVSxLQUFLO0dBQ3ZELE9BQU87RUFDVDtFQUVBLFFBQVEsR0FBRyxRQUFRLFlBQVksR0FBL0I7R0FDRSxLQUFLLE1BQ0gsT0FBTztHQUVULEtBQUs7R0FDTCxLQUFLLEtBQ0gsT0FBTyxXQUFXLFNBQVMsRUFBRTtHQUUvQixLQUFLO0dBQ0wsS0FBSyxLQUNILE9BQU8sT0FBTyxTQUFTLEVBQUU7R0FFM0IsS0FBSztHQUNMLEtBQUs7R0FDTCxL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