/**
 * Emit a nonce-based Content-Security-Policy on every SSR HTML response and
 * attach the per-request nonce to each inline `<script>` Nuxt renders so the
 * policy never blocks the page it applies to (RIL DEC-057 / TASK-126).
 *
 * Nuxt 4 has no `csp` config option, so this plugs into the render lifecycle:
 * the `render:html` hook fires with the fragment arrays before they are
 * assembled into the final document (renderer.mjs -> renderHTMLDocument), which
 * is the safe place to both rewrite inline scripts and set the header. The
 * streamed-SSR path is covered by the `render:html:chunk` hook, and Nuxt's own
 * bootstrap/inline-iife scripts are patched because they live in the `head` /
 * `bodyPrepend` fragments patched here.
 */
import { randomBytes } from "node:crypto";

import { addNonceToInlineScripts, buildCspPolicy, HTML_SECURITY_HEADERS } from "../utils/csp";

function makeNonce(): string {
	return randomBytes(18).toString("base64url");
}

// NuxtRenderHTMLContext is a map of fragment-string arrays; any of them may
// contain inline scripts (head: importmap/theme bootstrap/JSON-LD/payload;
// body: teleported or streamed inline scripts).
const FRAGMENT_KEYS = ["head", "bodyPrepend", "body", "bodyAppend"] as const;

export default defineNitroPlugin((nitroApp) => {
	nitroApp.hooks.hook("render:html", (htmlContext, { event }) => {
		const nonce = makeNonce();
		event.context.cspNonce = nonce;

		for (const key of FRAGMENT_KEYS) {
			htmlContext[key] = htmlContext[key].map((fragment) =>
				addNonceToInlineScripts(fragment, nonce),
			);
		}

		const { public: pub } = useRuntimeConfig(event);
		setResponseHeader(
			event,
			"Content-Security-Policy",
			buildCspPolicy(nonce, { apiUrl: pub.apiUrl, dev: import.meta.dev }),
		);
		for (const [name, value] of Object.entries(HTML_SECURITY_HEADERS)) {
			setResponseHeader(event, name, value);
		}
	});

	// Streaming SSR: patch each chunk so inline scripts that stream down in the
	// body after the shell also carry the same nonce.
	nitroApp.hooks.hook("render:html:chunk", (chunkContext, { event }) => {
		const nonce = (event.context.cspNonce ?? makeNonce()) as string;
		event.context.cspNonce = nonce;
		const text = Buffer.from(chunkContext.chunk).toString("utf8");
		const updated = addNonceToInlineScripts(text, nonce);
		if (updated !== text) chunkContext.chunk = Buffer.from(updated);
	});
});
