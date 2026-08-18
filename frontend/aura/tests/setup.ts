// Test setup - any global test configuration

import { vi } from "vitest";

// i18n: the site defaults to zh and auto-detects from the browser language.
// Tests assert deterministic Chinese UI text, so pin the detect source to
// zh-CN (happy-dom otherwise reports en-US and pages render English).
Object.defineProperty(window.navigator, "language", {
	value: "zh-CN",
	configurable: true,
});

// happy-dom (vitest 4.x) has historically differed on localStorage: some
// versions expose the object but leave getItem/setItem/clear unimplemented,
// newer 20.x builds do not define it at all (undefined on both globalThis and
// window — RIL TASK-120). Install one in-memory mock unconditionally so every
// test sees the same deterministic storage regardless of the happy-dom
// version the lockfile resolves to.
const store: Record<string, string> = {};
const storageMock: Storage = {
	getItem: (key: string) => (key in store ? store[key] : null),
	setItem: (key: string, value: string) => {
		store[key] = value;
	},
	removeItem: (key: string) => {
		delete store[key];
	},
	clear: () => {
		for (const key of Object.keys(store)) {
			delete store[key];
		}
	},
	key: (index: number) => Object.keys(store)[index] ?? null,
	get length() {
		return Object.keys(store).length;
	},
};
Object.defineProperty(globalThis, "localStorage", {
	value: storageMock,
	writable: true,
	configurable: true,
});
// Wire it onto window too (same object under happy-dom, but harmless to pin
// down for environments where they differ).
if (typeof window !== "undefined" && !("localStorage" in window)) {
	Object.defineProperty(window, "localStorage", {
		value: storageMock,
		writable: true,
		configurable: true,
	});
}

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
