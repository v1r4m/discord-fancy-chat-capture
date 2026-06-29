var background = (function() {
	//#region node_modules/wxt/dist/utils/define-background.mjs
	function defineBackground(arg) {
		if (arg == null || typeof arg === "function") return { main: arg };
		return arg;
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
	//#region utils/types.ts
	/** `browser.storage.local` key the editor reads its capture from. */
	var STORAGE_KEY = "pending-capture";
	//#endregion
	//#region entrypoints/background.ts
	var background_default = defineBackground(() => {
		browser.action.onClicked.addListener(async (tab) => {
			if (tab.id == null) return;
			try {
				await browser.tabs.sendMessage(tab.id, { type: "TOGGLE_CAPTURE" });
			} catch {
				console.warn("[DFCC] No Discord content script in this tab — open discord.com and reload it.");
			}
		});
		browser.runtime.onMessage.addListener((message) => {
			if (message.type === "CAPTURE_RESULT") openEditor(message.capture);
		});
	});
	async function openEditor(capture) {
		const inlined = await inlineImages(capture);
		await browser.storage.local.set({ [STORAGE_KEY]: inlined });
		await browser.tabs.create({ url: browser.runtime.getURL("/editor.html") });
	}
	/**
	* Fetch every remote image referenced by the capture and replace its URL with a
	* data URL. Done here (not in the editor) because the background worker holds
	* the host permissions — so the editor stays free of cross-origin requests and
	* `html-to-image` can export a clean, untainted canvas.
	*/
	async function inlineImages(capture) {
		const urls = /* @__PURE__ */ new Set();
		for (const m of capture.messages) {
			if (m.author.avatarUrl) urls.add(m.author.avatarUrl);
			for (const r of m.reactions) if (r.emojiUrl) urls.add(r.emojiUrl);
			for (const a of m.attachments) urls.add(a.url);
			for (const url of extractImgSrcs(m.contentHtml)) urls.add(url);
		}
		const map = /* @__PURE__ */ new Map();
		await Promise.all([...urls].map(async (url) => {
			try {
				const blob = await (await fetch(url)).blob();
				map.set(url, await blobToDataUrl(blob));
			} catch {}
		}));
		const sub = (url) => map.get(url) ?? url;
		const subHtml = (html) => {
			let out = html;
			for (const [original, dataUrl] of map) if (out.includes(original)) out = out.replaceAll(original, dataUrl);
			return out;
		};
		return {
			...capture,
			messages: capture.messages.map((m) => ({
				...m,
				author: {
					...m.author,
					avatarUrl: sub(m.author.avatarUrl)
				},
				reactions: m.reactions.map((r) => ({
					...r,
					emojiUrl: r.emojiUrl ? sub(r.emojiUrl) : null
				})),
				attachments: m.attachments.map((a) => ({
					...a,
					url: sub(a.url)
				})),
				contentHtml: subHtml(m.contentHtml)
			}))
		};
	}
	/** Pull the `src` of every `<img>` out of sanitized content HTML. */
	function extractImgSrcs(html) {
		const out = [];
		const re = /<img\s+src="([^"]+)"/g;
		let match;
		while ((match = re.exec(html)) !== null) out.push(match[1]);
		return out;
	}
	function blobToDataUrl(blob) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result);
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(blob);
		});
	}
	//#endregion
	//#region node_modules/@webext-core/match-patterns/lib/index.js
	var _MatchPattern = class {
		constructor(matchPattern) {
			if (matchPattern === "<all_urls>") {
				this.isAllUrls = true;
				this.protocolMatches = [..._MatchPattern.PROTOCOLS];
				this.hostnameMatch = "*";
				this.pathnameMatch = "*";
			} else {
				const groups = /(.*):\/\/(.*?)(\/.*)/.exec(matchPattern);
				if (groups == null) throw new InvalidMatchPattern(matchPattern, "Incorrect format");
				const [_, protocol, hostname, pathname] = groups;
				validateProtocol(matchPattern, protocol);
				validateHostname(matchPattern, hostname);
				this.protocolMatches = protocol === "*" ? ["http", "https"] : [protocol];
				this.hostnameMatch = hostname;
				this.pathnameMatch = pathname;
			}
		}
		includes(url) {
			if (this.isAllUrls) return true;
			const u = typeof url === "string" ? new URL(url) : url instanceof Location ? new URL(url.href) : url;
			return !!this.protocolMatches.find((protocol) => {
				if (protocol === "http") return this.isHttpMatch(u);
				if (protocol === "https") return this.isHttpsMatch(u);
				if (protocol === "file") return this.isFileMatch(u);
				if (protocol === "ftp") return this.isFtpMatch(u);
				if (protocol === "urn") return this.isUrnMatch(u);
			});
		}
		isHttpMatch(url) {
			return url.protocol === "http:" && this.isHostPathMatch(url);
		}
		isHttpsMatch(url) {
			return url.protocol === "https:" && this.isHostPathMatch(url);
		}
		isHostPathMatch(url) {
			if (!this.hostnameMatch || !this.pathnameMatch) return false;
			const hostnameMatchRegexs = [this.convertPatternToRegex(this.hostnameMatch), this.convertPatternToRegex(this.hostnameMatch.replace(/^\*\./, ""))];
			const pathnameMatchRegex = this.convertPatternToRegex(this.pathnameMatch);
			return !!hostnameMatchRegexs.find((regex) => regex.test(url.hostname)) && pathnameMatchRegex.test(url.pathname);
		}
		isFileMatch(url) {
			throw Error("Not implemented: file:// pattern matching. Open a PR to add support");
		}
		isFtpMatch(url) {
			throw Error("Not implemented: ftp:// pattern matching. Open a PR to add support");
		}
		isUrnMatch(url) {
			throw Error("Not implemented: urn:// pattern matching. Open a PR to add support");
		}
		convertPatternToRegex(pattern) {
			const starsReplaced = this.escapeForRegex(pattern).replace(/\\\*/g, ".*");
			return RegExp(`^${starsReplaced}$`);
		}
		escapeForRegex(string) {
			return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
	};
	var MatchPattern = _MatchPattern;
	MatchPattern.PROTOCOLS = [
		"http",
		"https",
		"file",
		"ftp",
		"urn"
	];
	var InvalidMatchPattern = class extends Error {
		constructor(matchPattern, reason) {
			super(`Invalid match pattern "${matchPattern}": ${reason}`);
		}
	};
	function validateProtocol(matchPattern, protocol) {
		if (!MatchPattern.PROTOCOLS.includes(protocol) && protocol !== "*") throw new InvalidMatchPattern(matchPattern, `${protocol} not a valid protocol (${MatchPattern.PROTOCOLS.join(", ")})`);
	}
	function validateHostname(matchPattern, hostname) {
		if (hostname.includes(":")) throw new InvalidMatchPattern(matchPattern, `Hostname cannot include a port`);
		if (hostname.includes("*") && hostname.length > 1 && !hostname.startsWith("*.")) throw new InvalidMatchPattern(matchPattern, `If using a wildcard (*), it must go at the start of the hostname`);
	}
	//#endregion
	//#region \0virtual:wxt-background-entrypoint?/Users/ad1225/Documents/viram/discord-fancy-chat-capture/entrypoints/background.ts
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
	var ws;
	/** Connect to the websocket and listen for messages. */
	function getDevServerWebSocket() {
		if (ws == null) {
			const serverUrl = "ws://localhost:3000";
			logger.debug("Connecting to dev server @", serverUrl);
			ws = new WebSocket(serverUrl, "vite-hmr");
			ws.addWxtEventListener = ws.addEventListener.bind(ws);
			ws.sendCustom = (event, payload) => ws?.send(JSON.stringify({
				type: "custom",
				event,
				payload
			}));
			ws.addEventListener("open", () => {
				logger.debug("Connected to dev server");
			});
			ws.addEventListener("close", () => {
				logger.debug("Disconnected from dev server");
			});
			ws.addEventListener("error", (event) => {
				logger.error("Failed to connect to dev server", event);
			});
			ws.addEventListener("message", (e) => {
				try {
					const message = JSON.parse(e.data);
					if (message.type === "custom") ws?.dispatchEvent(new CustomEvent(message.event, { detail: message.data }));
				} catch (err) {
					logger.error("Failed to handle message", err);
				}
			});
		}
		return ws;
	}
	/** https://developer.chrome.com/blog/longer-esw-lifetimes/ */
	function keepServiceWorkerAlive() {
		setInterval(async () => {
			await browser.runtime.getPlatformInfo();
		}, 5e3);
	}
	function reloadContentScript(payload) {
		if (browser.runtime.getManifest().manifest_version == 2) reloadContentScriptMv2(payload);
		else reloadContentScriptMv3(payload);
	}
	async function reloadContentScriptMv3({ registration, contentScript }) {
		if (registration === "runtime") await reloadRuntimeContentScriptMv3(contentScript);
		else await reloadManifestContentScriptMv3(contentScript);
	}
	async function reloadManifestContentScriptMv3(contentScript) {
		const id = `wxt:${contentScript.js[0]}`;
		logger.log("Reloading content script:", contentScript);
		const registered = await browser.scripting.getRegisteredContentScripts();
		logger.debug("Existing scripts:", registered);
		const existing = registered.find((cs) => cs.id === id);
		if (existing) {
			logger.debug("Updating content script", existing);
			await browser.scripting.updateContentScripts([{
				...contentScript,
				id,
				css: contentScript.css ?? []
			}]);
		} else {
			logger.debug("Registering new content script...");
			await browser.scripting.registerContentScripts([{
				...contentScript,
				id,
				css: contentScript.css ?? []
			}]);
		}
		await reloadTabsForContentScript(contentScript);
	}
	async function reloadRuntimeContentScriptMv3(contentScript) {
		logger.log("Reloading content script:", contentScript);
		const registered = await browser.scripting.getRegisteredContentScripts();
		logger.debug("Existing scripts:", registered);
		const matches = registered.filter((cs) => {
			const hasJs = contentScript.js?.find((js) => cs.js?.includes(js));
			const hasCss = contentScript.css?.find((css) => cs.css?.includes(css));
			return hasJs || hasCss;
		});
		if (matches.length === 0) {
			logger.log("Content script is not registered yet, nothing to reload", contentScript);
			return;
		}
		await browser.scripting.updateContentScripts(matches);
		await reloadTabsForContentScript(contentScript);
	}
	async function reloadTabsForContentScript(contentScript) {
		const allTabs = await browser.tabs.query({});
		const matchPatterns = contentScript.matches.map((match) => new MatchPattern(match));
		const matchingTabs = allTabs.filter((tab) => {
			const url = tab.url;
			if (!url) return false;
			return !!matchPatterns.find((pattern) => pattern.includes(url));
		});
		await Promise.all(matchingTabs.map(async (tab) => {
			try {
				await browser.tabs.reload(tab.id);
			} catch (err) {
				logger.warn("Failed to reload tab:", err);
			}
		}));
	}
	async function reloadContentScriptMv2(_payload) {
		throw Error("TODO: reloadContentScriptMv2");
	}
	try {
		const ws = getDevServerWebSocket();
		ws.addWxtEventListener("wxt:reload-extension", () => {
			browser.runtime.reload();
		});
		ws.addWxtEventListener("wxt:reload-content-script", (event) => {
			reloadContentScript(event.detail);
		});
		ws.addEventListener("open", () => ws.sendCustom("wxt:background-initialized"));
		keepServiceWorkerAlive();
	} catch (err) {
		logger.error("Failed to setup web socket connection with dev server", err);
	}
	browser.commands.onCommand.addListener((command) => {
		if (command === "wxt:reload-extension") browser.runtime.reload();
	});
	var result;
	try {
		result = background_default.main();
		if (result instanceof Promise) console.warn("The background's main() function return a promise, but it must be synchronous");
	} catch (err) {
		logger.error("The background crashed on startup!");
		throw err;
	}
	//#endregion
	return result;
})();

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFja2dyb3VuZC5qcyIsIm5hbWVzIjpbImJyb3dzZXIiXSwic291cmNlcyI6WyIuLi8uLi9ub2RlX21vZHVsZXMvd3h0L2Rpc3QvdXRpbHMvZGVmaW5lLWJhY2tncm91bmQubWpzIiwiLi4vLi4vbm9kZV9tb2R1bGVzL0B3eHQtZGV2L2Jyb3dzZXIvc3JjL2luZGV4Lm1qcyIsIi4uLy4uL25vZGVfbW9kdWxlcy93eHQvZGlzdC9icm93c2VyLm1qcyIsIi4uLy4uL3V0aWxzL3R5cGVzLnRzIiwiLi4vLi4vZW50cnlwb2ludHMvYmFja2dyb3VuZC50cyIsIi4uLy4uL25vZGVfbW9kdWxlcy9Ad2ViZXh0LWNvcmUvbWF0Y2gtcGF0dGVybnMvbGliL2luZGV4LmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vI3JlZ2lvbiBzcmMvdXRpbHMvZGVmaW5lLWJhY2tncm91bmQudHNcbmZ1bmN0aW9uIGRlZmluZUJhY2tncm91bmQoYXJnKSB7XG5cdGlmIChhcmcgPT0gbnVsbCB8fCB0eXBlb2YgYXJnID09PSBcImZ1bmN0aW9uXCIpIHJldHVybiB7IG1haW46IGFyZyB9O1xuXHRyZXR1cm4gYXJnO1xufVxuLy8jZW5kcmVnaW9uXG5leHBvcnQgeyBkZWZpbmVCYWNrZ3JvdW5kIH07XG4iLCIvLyAjcmVnaW9uIHNuaXBwZXRcbmV4cG9ydCBjb25zdCBicm93c2VyID0gZ2xvYmFsVGhpcy5icm93c2VyPy5ydW50aW1lPy5pZFxuICA/IGdsb2JhbFRoaXMuYnJvd3NlclxuICA6IGdsb2JhbFRoaXMuY2hyb21lO1xuLy8gI2VuZHJlZ2lvbiBzbmlwcGV0XG4iLCJpbXBvcnQgeyBicm93c2VyIGFzIGJyb3dzZXIkMSB9IGZyb20gXCJAd3h0LWRldi9icm93c2VyXCI7XG4vLyNyZWdpb24gc3JjL2Jyb3dzZXIudHNcbi8qKlxuKiBDb250YWlucyB0aGUgYGJyb3dzZXJgIGV4cG9ydCB3aGljaCB5b3Ugc2hvdWxkIHVzZSB0byBhY2Nlc3MgdGhlIGV4dGVuc2lvblxuKiBBUElzIGluIHlvdXIgcHJvamVjdDpcbipcbiogYGBgdHNcbiogaW1wb3J0IHsgYnJvd3NlciB9IGZyb20gJ3d4dC9icm93c2VyJztcbipcbiogYnJvd3Nlci5ydW50aW1lLm9uSW5zdGFsbGVkLmFkZExpc3RlbmVyKCgpID0+IHtcbiogICAvLyAuLi5cbiogfSk7XG4qIGBgYFxuKlxuKiBAbW9kdWxlIHd4dC9icm93c2VyXG4qL1xuY29uc3QgYnJvd3NlciA9IGJyb3dzZXIkMTtcbi8vI2VuZHJlZ2lvblxuZXhwb3J0IHsgYnJvd3NlciB9O1xuIiwiLyoqXG4gKiBTaGFyZWQgZGF0YSBjb250cmFjdCBiZXR3ZWVuIHRoZSB0aHJlZSBtb3ZpbmcgcGFydHM6XG4gKiAgIGNvbnRlbnQgc2NyaXB0ICDihpIgc2NyYXBlcyB0aGVzZSBzdHJ1Y3R1cmVzIGZyb20gdGhlIERpc2NvcmQgRE9NXG4gKiAgIGJhY2tncm91bmQgICAgICDihpIgaW5saW5lcyByZW1vdGUgaW1hZ2VzIGludG8gdGhlbVxuICogICBlZGl0b3IgcGFnZSAgICAg4oaSIHJlbmRlcnMgdGhlbVxuICovXG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2FwdHVyZWRBdXRob3Ige1xuICBuYW1lOiBzdHJpbmc7XG4gIC8qKiBBdmF0YXIgVVJMIOKAlCBhIHJlbW90ZSBDRE4gVVJMIHdoZW4gc2NyYXBlZCwgYSBkYXRhIFVSTCBhZnRlciBpbmxpbmluZy4gKi9cbiAgYXZhdGFyVXJsOiBzdHJpbmc7XG4gIC8qKiBJbmxpbmUgcm9sZSBjb2xvciAoaGV4L3JnYikgaWYgRGlzY29yZCBhcHBsaWVkIG9uZSwgZWxzZSBudWxsLiAqL1xuICByb2xlQ29sb3I6IHN0cmluZyB8IG51bGw7XG4gIGJvdDogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBDYXB0dXJlZFJlYWN0aW9uIHtcbiAgLyoqIFVuaWNvZGUgY2hhcmFjdGVyIG9yIGA6bmFtZTpgIGZvciBjdXN0b20gZW1vamkuICovXG4gIGVtb2ppOiBzdHJpbmc7XG4gIGVtb2ppVXJsOiBzdHJpbmcgfCBudWxsO1xuICBjb3VudDogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIENhcHR1cmVkQXR0YWNobWVudCB7XG4gIHVybDogc3RyaW5nO1xuICB3aWR0aDogbnVtYmVyIHwgbnVsbDtcbiAgaGVpZ2h0OiBudW1iZXIgfCBudWxsO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIENhcHR1cmVkUmVwbHkge1xuICBhdXRob3JOYW1lOiBzdHJpbmc7XG4gIGNvbnRlbnQ6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBDYXB0dXJlZE1lc3NhZ2Uge1xuICBpZDogc3RyaW5nO1xuICBhdXRob3I6IENhcHR1cmVkQXV0aG9yO1xuICAvKiogSVNPIDg2MDEgdGltZXN0YW1wLiAqL1xuICB0aW1lc3RhbXA6IHN0cmluZztcbiAgLyoqIEh1bWFuIGxhYmVsIERpc2NvcmQgc2hvd2VkLCBlLmcuIFwiVG9kYXkgYXQgNDoyMSBQTVwiLiAqL1xuICB0aW1lc3RhbXBMYWJlbDogc3RyaW5nO1xuICAvKipcbiAgICogU2FuaXRpemVkIEhUTUwg4oCUIGJ1aWx0IGJ5IGBzYW5pdGl6ZUNvbnRlbnRgIGZyb20gRGlzY29yZCdzIGFscmVhZHktcmVuZGVyZWRcbiAgICogRE9NLCB3aXRoIGhhc2hlZCBjbGFzc2VzIHN0cmlwcGVkIGFuZCBhIGZpeGVkIGBkZmNjLSpgIGNsYXNzIHNldCBhcHBsaWVkLlxuICAgKiBBbnkgYDxpbWc+YCBgc3JjYCBoZXJlIGlzIGEgcmVtb3RlIFVSTCB3aGVuIGxlYXZpbmcgdGhlIHNjcmFwZXI7IHRoZVxuICAgKiBiYWNrZ3JvdW5kIHdvcmtlciByZXdyaXRlcyBpdCB0byBhIGRhdGEgVVJMIGJlZm9yZSB0aGUgZWRpdG9yIHJlYWRzIGl0LlxuICAgKi9cbiAgY29udGVudEh0bWw6IHN0cmluZztcbiAgZWRpdGVkOiBib29sZWFuO1xuICByZXBseTogQ2FwdHVyZWRSZXBseSB8IG51bGw7XG4gIHJlYWN0aW9uczogQ2FwdHVyZWRSZWFjdGlvbltdO1xuICBhdHRhY2htZW50czogQ2FwdHVyZWRBdHRhY2htZW50W107XG4gIC8qKiBGaXJzdCBtZXNzYWdlIG9mIGFuIGF1dGhvciBncm91cCDigJQgcmVuZGVyIHRoZSBhdmF0YXIgKyBoZWFkZXIuICovXG4gIGdyb3VwU3RhcnQ6IGJvb2xlYW47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2FwdHVyZSB7XG4gIC8qKiBDaGFubmVsIC8gRE0gbmFtZSwgYmVzdC1lZmZvcnQuICovXG4gIHNvdXJjZTogc3RyaW5nO1xuICBjYXB0dXJlZEF0OiBzdHJpbmc7XG4gIG1lc3NhZ2VzOiBDYXB0dXJlZE1lc3NhZ2VbXTtcbn1cblxuLyoqIE1lc3NhZ2VzIHBhc3NlZCBvdmVyIGBicm93c2VyLnJ1bnRpbWVgIGJldHdlZW4gdGhlIGV4dGVuc2lvbiBwYXJ0cy4gKi9cbmV4cG9ydCB0eXBlIFJ1bnRpbWVNZXNzYWdlID1cbiAgfCB7IHR5cGU6ICdUT0dHTEVfQ0FQVFVSRScgfVxuICB8IHsgdHlwZTogJ0NBUFRVUkVfUkVTVUxUJzsgY2FwdHVyZTogQ2FwdHVyZSB9O1xuXG4vKiogYGJyb3dzZXIuc3RvcmFnZS5sb2NhbGAga2V5IHRoZSBlZGl0b3IgcmVhZHMgaXRzIGNhcHR1cmUgZnJvbS4gKi9cbmV4cG9ydCBjb25zdCBTVE9SQUdFX0tFWSA9ICdwZW5kaW5nLWNhcHR1cmUnO1xuIiwiaW1wb3J0IHR5cGUgeyBDYXB0dXJlLCBSdW50aW1lTWVzc2FnZSB9IGZyb20gJ0AvdXRpbHMvdHlwZXMnO1xuaW1wb3J0IHsgU1RPUkFHRV9LRVkgfSBmcm9tICdAL3V0aWxzL3R5cGVzJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQmFja2dyb3VuZCgoKSA9PiB7XG4gIC8vIFRvb2xiYXIgYnV0dG9uIHRvZ2dsZXMgY2FwdHVyZSBtb2RlIGluIHRoZSBhY3RpdmUgRGlzY29yZCB0YWIuXG4gIGJyb3dzZXIuYWN0aW9uLm9uQ2xpY2tlZC5hZGRMaXN0ZW5lcihhc3luYyAodGFiKSA9PiB7XG4gICAgaWYgKHRhYi5pZCA9PSBudWxsKSByZXR1cm47XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGJyb3dzZXIudGFicy5zZW5kTWVzc2FnZSh0YWIuaWQsIHsgdHlwZTogJ1RPR0dMRV9DQVBUVVJFJyB9IHNhdGlzZmllcyBSdW50aW1lTWVzc2FnZSk7XG4gICAgfSBjYXRjaCB7XG4gICAgICBjb25zb2xlLndhcm4oJ1tERkNDXSBObyBEaXNjb3JkIGNvbnRlbnQgc2NyaXB0IGluIHRoaXMgdGFiIOKAlCBvcGVuIGRpc2NvcmQuY29tIGFuZCByZWxvYWQgaXQuJyk7XG4gICAgfVxuICB9KTtcblxuICAvLyBBIGZpbmlzaGVkIGNhcHR1cmUgYXJyaXZlcyBmcm9tIHRoZSBjb250ZW50IHNjcmlwdC5cbiAgYnJvd3Nlci5ydW50aW1lLm9uTWVzc2FnZS5hZGRMaXN0ZW5lcigobWVzc2FnZTogUnVudGltZU1lc3NhZ2UpID0+IHtcbiAgICBpZiAobWVzc2FnZS50eXBlID09PSAnQ0FQVFVSRV9SRVNVTFQnKSB2b2lkIG9wZW5FZGl0b3IobWVzc2FnZS5jYXB0dXJlKTtcbiAgfSk7XG59KTtcblxuYXN5bmMgZnVuY3Rpb24gb3BlbkVkaXRvcihjYXB0dXJlOiBDYXB0dXJlKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IGlubGluZWQgPSBhd2FpdCBpbmxpbmVJbWFnZXMoY2FwdHVyZSk7XG4gIGF3YWl0IGJyb3dzZXIuc3RvcmFnZS5sb2NhbC5zZXQoeyBbU1RPUkFHRV9LRVldOiBpbmxpbmVkIH0pO1xuICBhd2FpdCBicm93c2VyLnRhYnMuY3JlYXRlKHsgdXJsOiBicm93c2VyLnJ1bnRpbWUuZ2V0VVJMKCcvZWRpdG9yLmh0bWwnKSB9KTtcbn1cblxuLyoqXG4gKiBGZXRjaCBldmVyeSByZW1vdGUgaW1hZ2UgcmVmZXJlbmNlZCBieSB0aGUgY2FwdHVyZSBhbmQgcmVwbGFjZSBpdHMgVVJMIHdpdGggYVxuICogZGF0YSBVUkwuIERvbmUgaGVyZSAobm90IGluIHRoZSBlZGl0b3IpIGJlY2F1c2UgdGhlIGJhY2tncm91bmQgd29ya2VyIGhvbGRzXG4gKiB0aGUgaG9zdCBwZXJtaXNzaW9ucyDigJQgc28gdGhlIGVkaXRvciBzdGF5cyBmcmVlIG9mIGNyb3NzLW9yaWdpbiByZXF1ZXN0cyBhbmRcbiAqIGBodG1sLXRvLWltYWdlYCBjYW4gZXhwb3J0IGEgY2xlYW4sIHVudGFpbnRlZCBjYW52YXMuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGlubGluZUltYWdlcyhjYXB0dXJlOiBDYXB0dXJlKTogUHJvbWlzZTxDYXB0dXJlPiB7XG4gIGNvbnN0IHVybHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCBtIG9mIGNhcHR1cmUubWVzc2FnZXMpIHtcbiAgICBpZiAobS5hdXRob3IuYXZhdGFyVXJsKSB1cmxzLmFkZChtLmF1dGhvci5hdmF0YXJVcmwpO1xuICAgIGZvciAoY29uc3QgciBvZiBtLnJlYWN0aW9ucykgaWYgKHIuZW1vamlVcmwpIHVybHMuYWRkKHIuZW1vamlVcmwpO1xuICAgIGZvciAoY29uc3QgYSBvZiBtLmF0dGFjaG1lbnRzKSB1cmxzLmFkZChhLnVybCk7XG4gICAgZm9yIChjb25zdCB1cmwgb2YgZXh0cmFjdEltZ1NyY3MobS5jb250ZW50SHRtbCkpIHVybHMuYWRkKHVybCk7XG4gIH1cblxuICBjb25zdCBtYXAgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpO1xuICBhd2FpdCBQcm9taXNlLmFsbChcbiAgICBbLi4udXJsc10ubWFwKGFzeW5jICh1cmwpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGJsb2IgPSBhd2FpdCAoYXdhaXQgZmV0Y2godXJsKSkuYmxvYigpO1xuICAgICAgICBtYXAuc2V0KHVybCwgYXdhaXQgYmxvYlRvRGF0YVVybChibG9iKSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gTGVhdmUgdGhlIG9yaWdpbmFsIFVSTCBpbiBwbGFjZSDigJQgYmVzdCBlZmZvcnQuXG4gICAgICB9XG4gICAgfSksXG4gICk7XG5cbiAgY29uc3Qgc3ViID0gKHVybDogc3RyaW5nKSA9PiBtYXAuZ2V0KHVybCkgPz8gdXJsO1xuICBjb25zdCBzdWJIdG1sID0gKGh0bWw6IHN0cmluZykgPT4ge1xuICAgIGxldCBvdXQgPSBodG1sO1xuICAgIGZvciAoY29uc3QgW29yaWdpbmFsLCBkYXRhVXJsXSBvZiBtYXApIHtcbiAgICAgIGlmIChvdXQuaW5jbHVkZXMob3JpZ2luYWwpKSBvdXQgPSBvdXQucmVwbGFjZUFsbChvcmlnaW5hbCwgZGF0YVVybCk7XG4gICAgfVxuICAgIHJldHVybiBvdXQ7XG4gIH07XG5cbiAgcmV0dXJuIHtcbiAgICAuLi5jYXB0dXJlLFxuICAgIG1lc3NhZ2VzOiBjYXB0dXJlLm1lc3NhZ2VzLm1hcCgobSkgPT4gKHtcbiAgICAgIC4uLm0sXG4gICAgICBhdXRob3I6IHsgLi4ubS5hdXRob3IsIGF2YXRhclVybDogc3ViKG0uYXV0aG9yLmF2YXRhclVybCkgfSxcbiAgICAgIHJlYWN0aW9uczogbS5yZWFjdGlvbnMubWFwKChyKSA9PiAoe1xuICAgICAgICAuLi5yLFxuICAgICAgICBlbW9qaVVybDogci5lbW9qaVVybCA/IHN1YihyLmVtb2ppVXJsKSA6IG51bGwsXG4gICAgICB9KSksXG4gICAgICBhdHRhY2htZW50czogbS5hdHRhY2htZW50cy5tYXAoKGEpID0+ICh7IC4uLmEsIHVybDogc3ViKGEudXJsKSB9KSksXG4gICAgICBjb250ZW50SHRtbDogc3ViSHRtbChtLmNvbnRlbnRIdG1sKSxcbiAgICB9KSksXG4gIH07XG59XG5cbi8qKiBQdWxsIHRoZSBgc3JjYCBvZiBldmVyeSBgPGltZz5gIG91dCBvZiBzYW5pdGl6ZWQgY29udGVudCBIVE1MLiAqL1xuZnVuY3Rpb24gZXh0cmFjdEltZ1NyY3MoaHRtbDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IHJlID0gLzxpbWdcXHMrc3JjPVwiKFteXCJdKylcIi9nO1xuICBsZXQgbWF0Y2g6IFJlZ0V4cEV4ZWNBcnJheSB8IG51bGw7XG4gIHdoaWxlICgobWF0Y2ggPSByZS5leGVjKGh0bWwpKSAhPT0gbnVsbCkgb3V0LnB1c2gobWF0Y2hbMV0pO1xuICByZXR1cm4gb3V0O1xufVxuXG5mdW5jdGlvbiBibG9iVG9EYXRhVXJsKGJsb2I6IEJsb2IpOiBQcm9taXNlPHN0cmluZz4ge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGNvbnN0IHJlYWRlciA9IG5ldyBGaWxlUmVhZGVyKCk7XG4gICAgcmVhZGVyLm9ubG9hZCA9ICgpID0+IHJlc29sdmUocmVhZGVyLnJlc3VsdCBhcyBzdHJpbmcpO1xuICAgIHJlYWRlci5vbmVycm9yID0gKCkgPT4gcmVqZWN0KHJlYWRlci5lcnJvcik7XG4gICAgcmVhZGVyLnJlYWRBc0RhdGFVUkwoYmxvYik7XG4gIH0pO1xufVxuIiwiLy8gc3JjL2luZGV4LnRzXG52YXIgX01hdGNoUGF0dGVybiA9IGNsYXNzIHtcbiAgY29uc3RydWN0b3IobWF0Y2hQYXR0ZXJuKSB7XG4gICAgaWYgKG1hdGNoUGF0dGVybiA9PT0gXCI8YWxsX3VybHM+XCIpIHtcbiAgICAgIHRoaXMuaXNBbGxVcmxzID0gdHJ1ZTtcbiAgICAgIHRoaXMucHJvdG9jb2xNYXRjaGVzID0gWy4uLl9NYXRjaFBhdHRlcm4uUFJPVE9DT0xTXTtcbiAgICAgIHRoaXMuaG9zdG5hbWVNYXRjaCA9IFwiKlwiO1xuICAgICAgdGhpcy5wYXRobmFtZU1hdGNoID0gXCIqXCI7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGdyb3VwcyA9IC8oLiopOlxcL1xcLyguKj8pKFxcLy4qKS8uZXhlYyhtYXRjaFBhdHRlcm4pO1xuICAgICAgaWYgKGdyb3VwcyA9PSBudWxsKVxuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZE1hdGNoUGF0dGVybihtYXRjaFBhdHRlcm4sIFwiSW5jb3JyZWN0IGZvcm1hdFwiKTtcbiAgICAgIGNvbnN0IFtfLCBwcm90b2NvbCwgaG9zdG5hbWUsIHBhdGhuYW1lXSA9IGdyb3VwcztcbiAgICAgIHZhbGlkYXRlUHJvdG9jb2wobWF0Y2hQYXR0ZXJuLCBwcm90b2NvbCk7XG4gICAgICB2YWxpZGF0ZUhvc3RuYW1lKG1hdGNoUGF0dGVybiwgaG9zdG5hbWUpO1xuICAgICAgdmFsaWRhdGVQYXRobmFtZShtYXRjaFBhdHRlcm4sIHBhdGhuYW1lKTtcbiAgICAgIHRoaXMucHJvdG9jb2xNYXRjaGVzID0gcHJvdG9jb2wgPT09IFwiKlwiID8gW1wiaHR0cFwiLCBcImh0dHBzXCJdIDogW3Byb3RvY29sXTtcbiAgICAgIHRoaXMuaG9zdG5hbWVNYXRjaCA9IGhvc3RuYW1lO1xuICAgICAgdGhpcy5wYXRobmFtZU1hdGNoID0gcGF0aG5hbWU7XG4gICAgfVxuICB9XG4gIGluY2x1ZGVzKHVybCkge1xuICAgIGlmICh0aGlzLmlzQWxsVXJscylcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIGNvbnN0IHUgPSB0eXBlb2YgdXJsID09PSBcInN0cmluZ1wiID8gbmV3IFVSTCh1cmwpIDogdXJsIGluc3RhbmNlb2YgTG9jYXRpb24gPyBuZXcgVVJMKHVybC5ocmVmKSA6IHVybDtcbiAgICByZXR1cm4gISF0aGlzLnByb3RvY29sTWF0Y2hlcy5maW5kKChwcm90b2NvbCkgPT4ge1xuICAgICAgaWYgKHByb3RvY29sID09PSBcImh0dHBcIilcbiAgICAgICAgcmV0dXJuIHRoaXMuaXNIdHRwTWF0Y2godSk7XG4gICAgICBpZiAocHJvdG9jb2wgPT09IFwiaHR0cHNcIilcbiAgICAgICAgcmV0dXJuIHRoaXMuaXNIdHRwc01hdGNoKHUpO1xuICAgICAgaWYgKHByb3RvY29sID09PSBcImZpbGVcIilcbiAgICAgICAgcmV0dXJuIHRoaXMuaXNGaWxlTWF0Y2godSk7XG4gICAgICBpZiAocHJvdG9jb2wgPT09IFwiZnRwXCIpXG4gICAgICAgIHJldHVybiB0aGlzLmlzRnRwTWF0Y2godSk7XG4gICAgICBpZiAocHJvdG9jb2wgPT09IFwidXJuXCIpXG4gICAgICAgIHJldHVybiB0aGlzLmlzVXJuTWF0Y2godSk7XG4gICAgfSk7XG4gIH1cbiAgaXNIdHRwTWF0Y2godXJsKSB7XG4gICAgcmV0dXJuIHVybC5wcm90b2NvbCA9PT0gXCJodHRwOlwiICYmIHRoaXMuaXNIb3N0UGF0aE1hdGNoKHVybCk7XG4gIH1cbiAgaXNIdHRwc01hdGNoKHVybCkge1xuICAgIHJldHVybiB1cmwucHJvdG9jb2wgPT09IFwiaHR0cHM6XCIgJiYgdGhpcy5pc0hvc3RQYXRoTWF0Y2godXJsKTtcbiAgfVxuICBpc0hvc3RQYXRoTWF0Y2godXJsKSB7XG4gICAgaWYgKCF0aGlzLmhvc3RuYW1lTWF0Y2ggfHwgIXRoaXMucGF0aG5hbWVNYXRjaClcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICBjb25zdCBob3N0bmFtZU1hdGNoUmVnZXhzID0gW1xuICAgICAgdGhpcy5jb252ZXJ0UGF0dGVyblRvUmVnZXgodGhpcy5ob3N0bmFtZU1hdGNoKSxcbiAgICAgIHRoaXMuY29udmVydFBhdHRlcm5Ub1JlZ2V4KHRoaXMuaG9zdG5hbWVNYXRjaC5yZXBsYWNlKC9eXFwqXFwuLywgXCJcIikpXG4gICAgXTtcbiAgICBjb25zdCBwYXRobmFtZU1hdGNoUmVnZXggPSB0aGlzLmNvbnZlcnRQYXR0ZXJuVG9SZWdleCh0aGlzLnBhdGhuYW1lTWF0Y2gpO1xuICAgIHJldHVybiAhIWhvc3RuYW1lTWF0Y2hSZWdleHMuZmluZCgocmVnZXgpID0+IHJlZ2V4LnRlc3QodXJsLmhvc3RuYW1lKSkgJiYgcGF0aG5hbWVNYXRjaFJlZ2V4LnRlc3QodXJsLnBhdGhuYW1lKTtcbiAgfVxuICBpc0ZpbGVNYXRjaCh1cmwpIHtcbiAgICB0aHJvdyBFcnJvcihcIk5vdCBpbXBsZW1lbnRlZDogZmlsZTovLyBwYXR0ZXJuIG1hdGNoaW5nLiBPcGVuIGEgUFIgdG8gYWRkIHN1cHBvcnRcIik7XG4gIH1cbiAgaXNGdHBNYXRjaCh1cmwpIHtcbiAgICB0aHJvdyBFcnJvcihcIk5vdCBpbXBsZW1lbnRlZDogZnRwOi8vIHBhdHRlcm4gbWF0Y2hpbmcuIE9wZW4gYSBQUiB0byBhZGQgc3VwcG9ydFwiKTtcbiAgfVxuICBpc1Vybk1hdGNoKHVybCkge1xuICAgIHRocm93IEVycm9yKFwiTm90IGltcGxlbWVudGVkOiB1cm46Ly8gcGF0dGVybiBtYXRjaGluZy4gT3BlbiBhIFBSIHRvIGFkZCBzdXBwb3J0XCIpO1xuICB9XG4gIGNvbnZlcnRQYXR0ZXJuVG9SZWdleChwYXR0ZXJuKSB7XG4gICAgY29uc3QgZXNjYXBlZCA9IHRoaXMuZXNjYXBlRm9yUmVnZXgocGF0dGVybik7XG4gICAgY29uc3Qgc3RhcnNSZXBsYWNlZCA9IGVzY2FwZWQucmVwbGFjZSgvXFxcXFxcKi9nLCBcIi4qXCIpO1xuICAgIHJldHVybiBSZWdFeHAoYF4ke3N0YXJzUmVwbGFjZWR9JGApO1xuICB9XG4gIGVzY2FwZUZvclJlZ2V4KHN0cmluZykge1xuICAgIHJldHVybiBzdHJpbmcucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csIFwiXFxcXCQmXCIpO1xuICB9XG59O1xudmFyIE1hdGNoUGF0dGVybiA9IF9NYXRjaFBhdHRlcm47XG5NYXRjaFBhdHRlcm4uUFJPVE9DT0xTID0gW1wiaHR0cFwiLCBcImh0dHBzXCIsIFwiZmlsZVwiLCBcImZ0cFwiLCBcInVyblwiXTtcbnZhciBJbnZhbGlkTWF0Y2hQYXR0ZXJuID0gY2xhc3MgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1hdGNoUGF0dGVybiwgcmVhc29uKSB7XG4gICAgc3VwZXIoYEludmFsaWQgbWF0Y2ggcGF0dGVybiBcIiR7bWF0Y2hQYXR0ZXJufVwiOiAke3JlYXNvbn1gKTtcbiAgfVxufTtcbmZ1bmN0aW9uIHZhbGlkYXRlUHJvdG9jb2wobWF0Y2hQYXR0ZXJuLCBwcm90b2NvbCkge1xuICBpZiAoIU1hdGNoUGF0dGVybi5QUk9UT0NPTFMuaW5jbHVkZXMocHJvdG9jb2wpICYmIHByb3RvY29sICE9PSBcIipcIilcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1hdGNoUGF0dGVybihcbiAgICAgIG1hdGNoUGF0dGVybixcbiAgICAgIGAke3Byb3RvY29sfSBub3QgYSB2YWxpZCBwcm90b2NvbCAoJHtNYXRjaFBhdHRlcm4uUFJPVE9DT0xTLmpvaW4oXCIsIFwiKX0pYFxuICAgICk7XG59XG5mdW5jdGlvbiB2YWxpZGF0ZUhvc3RuYW1lKG1hdGNoUGF0dGVybiwgaG9zdG5hbWUpIHtcbiAgaWYgKGhvc3RuYW1lLmluY2x1ZGVzKFwiOlwiKSlcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1hdGNoUGF0dGVybihtYXRjaFBhdHRlcm4sIGBIb3N0bmFtZSBjYW5ub3QgaW5jbHVkZSBhIHBvcnRgKTtcbiAgaWYgKGhvc3RuYW1lLmluY2x1ZGVzKFwiKlwiKSAmJiBob3N0bmFtZS5sZW5ndGggPiAxICYmICFob3N0bmFtZS5zdGFydHNXaXRoKFwiKi5cIikpXG4gICAgdGhyb3cgbmV3IEludmFsaWRNYXRjaFBhdHRlcm4oXG4gICAgICBtYXRjaFBhdHRlcm4sXG4gICAgICBgSWYgdXNpbmcgYSB3aWxkY2FyZCAoKiksIGl0IG11c3QgZ28gYXQgdGhlIHN0YXJ0IG9mIHRoZSBob3N0bmFtZWBcbiAgICApO1xufVxuZnVuY3Rpb24gdmFsaWRhdGVQYXRobmFtZShtYXRjaFBhdHRlcm4sIHBhdGhuYW1lKSB7XG4gIHJldHVybjtcbn1cbmV4cG9ydCB7XG4gIEludmFsaWRNYXRjaFBhdHRlcm4sXG4gIE1hdGNoUGF0dGVyblxufTtcbiJdLCJ4X2dvb2dsZV9pZ25vcmVMaXN0IjpbMCwxLDIsNV0sIm1hcHBpbmdzIjoiOztDQUNBLFNBQVMsaUJBQWlCLEtBQUs7RUFDOUIsSUFBSSxPQUFPLFFBQVEsT0FBTyxRQUFRLFlBQVksT0FBTyxFQUFFLE1BQU0sSUFBSTtFQUNqRSxPQUFPO0NBQ1I7Ozs7Ozs7Ozs7Ozs7Ozs7O0NFWUEsSUFBTSxVRGZpQixXQUFXLFNBQVMsU0FBUyxLQUNoRCxXQUFXLFVBQ1gsV0FBVzs7OztDRWtFZixJQUFhLGNBQWM7OztDQ2xFM0IsSUFBQSxxQkFBQSx1QkFBQTs7Ozs7Ozs7Ozs7O0NBZUEsQ0FBQTtDQUVBLGVBQUEsV0FBQSxTQUFB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