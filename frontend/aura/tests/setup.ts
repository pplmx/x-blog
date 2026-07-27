// Test setup - any global test configuration

import { vi } from "vitest";

// DOMPurify doesn't work properly in happy-dom (test environment) —
// its sanitize method fails to strip <script> tags even though
// isSupported is true. Mock it with a simple regex-based sanitizer
// so tests can verify that sanitizeHtml actually strips XSS payloads.
// In production (real browser), the real DOMPurify is used.
vi.mock("dompurify", async () => {
	const sanitize = (html: string): string => {
		if (!html) return "";
		return html
			.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
			.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
			.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
			.replace(/<(script|style|iframe|object|embed|form)[^>]*>.*?<\/\1>/gi, "");
	};

	const DomPurify = {
		sanitize,
		isSupported: true,
		version: "3.4.12",
		addHook: vi.fn(),
		removeHook: vi.fn(),
		removeHooks: vi.fn(),
		removeAllHooks: vi.fn(),
		setConfig: vi.fn(),
		clearConfig: vi.fn(),
		isValidAttribute: vi.fn(),
	};

	// DOMPurify's default export is a factory function that also has properties
	const factory = Object.assign(() => DomPurify, DomPurify);

	return {
		default: factory,
		...factory,
	};
});
