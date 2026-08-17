/**
 * Service worker behavior tests (DEC-055, TASK-118).
 *
 * Classic service workers cannot import/export, so this loads public/sw.js
 * in a fake `self` scope and drives its registered event handlers directly:
 * push (payload parsing -> showNotification, malformed payloads degrade) and
 * notificationclick (focus the matching tab, else open the URL). The handler
 * registration itself is also the syntax check for the SW file.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

type EventHandler = (event: unknown) => void;

function loadServiceWorker() {
	// vitest transforms test files so import.meta.url is not a file:// URL;
	// resolve against the package root (vitest runs from frontend/aura).
	const source = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
	const handlers: Record<string, EventHandler> = {};
	const clients = {
		matchAll: vi.fn(),
		openWindow: vi.fn().mockResolvedValue(undefined),
		claim: vi.fn(),
	};
	const registration = { showNotification: vi.fn().mockResolvedValue(undefined) };
	const self = {
		addEventListener: (type: string, fn: EventHandler) => {
			handlers[type] = fn;
		},
		skipWaiting: vi.fn(),
		clients,
		registration,
	};
	// Evaluate the classic SW with `self` bound to the fake scope.
	new Function("self", source)(self);
	return { handlers, clients, registration };
}

// Capture the promise the handler hands to event.waitUntil so tests can await
// the async matchAll/… callback chain before asserting on it.
let lastWaitUntil: Promise<unknown> | undefined;
const waitUntil = (p: Promise<unknown> | undefined): Promise<unknown> | undefined => {
	lastWaitUntil = p;
	return p;
};
const flushWaitUntil = async () => {
	await lastWaitUntil;
	lastWaitUntil = undefined;
};

describe("service worker (public/sw.js)", () => {
	it("register() skips waiting and claims clients on activation", () => {
		const { handlers, clients } = loadServiceWorker();
		handlers.install?.({});
		handlers.activate?.({ waitUntil });
		expect(clients.claim).toHaveBeenCalled();
	});

	it("shows a notification from the push payload with a normalized click URL", () => {
		const { handlers, registration } = loadServiceWorker();
		const event = {
			data: {
				text: () => JSON.stringify({ title: "新文章", body: "快来看", url: "/posts/hello" }),
			},
			waitUntil,
		};
		handlers.push?.(event);
		expect(registration.showNotification).toHaveBeenCalledWith(
			"新文章",
			expect.objectContaining({
				body: "快来看",
				icon: "/logo.png",
				data: { url: "/posts/hello" },
			}),
		);
	});

	it("degrades an empty or malformed payload to a default notification", () => {
		const { handlers, registration } = loadServiceWorker();
		handlers.push?.({ data: { text: () => "not json" }, waitUntil });
		expect(registration.showNotification).toHaveBeenCalledWith(
			"X-Blog",
			expect.objectContaining({ body: "", data: { url: "/" } }),
		);
	});

	it("rejects a protocol-relative click target (falls back to /)", () => {
		const { handlers, registration } = loadServiceWorker();
		handlers.push?.({
			data: { text: () => JSON.stringify({ title: "x", url: "//evil.example.com" }) },
			waitUntil,
		});
		expect(registration.showNotification).toHaveBeenCalledWith(
			"x",
			expect.objectContaining({ data: { url: "/" } }),
		);
	});

	it("notificationclick focuses an already-open matching tab", async () => {
		const { handlers, clients } = loadServiceWorker();
		const focus = vi.fn().mockResolvedValue(undefined);
		clients.matchAll.mockResolvedValue([
			{ url: "https://blog.example.com/about" },
			{ url: "https://blog.example.com/posts/hello", focus },
		]);
		const event = {
			notification: { close: vi.fn(), data: { url: "/posts/hello" } },
			waitUntil,
		};
		handlers.notificationclick?.(event);
		await flushWaitUntil();
		expect(focus).toHaveBeenCalled();
		expect(clients.openWindow).not.toHaveBeenCalled();
	});

	it("notificationclick opens the URL when no tab matches", async () => {
		const { handlers, clients } = loadServiceWorker();
		clients.matchAll.mockResolvedValue([{ url: "https://blog.example.com/about" }]);
		const event = {
			notification: { close: vi.fn(), data: { url: "/posts/hello" } },
			waitUntil,
		};
		handlers.notificationclick?.(event);
		await flushWaitUntil();
		expect(clients.openWindow).toHaveBeenCalledWith("/posts/hello");
	});
});
