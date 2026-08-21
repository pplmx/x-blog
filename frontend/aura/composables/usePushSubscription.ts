/**
 * Browser Web Push subscription composable (DEC-055, TASK-118).
 *
 * Coordinates the reader opt-in flow with the backend /api/push endpoints:
 *   - fetches the VAPID public key (the pushManager.subscribe
 *     applicationServerKey) from the backend, so the key is never hardcoded;
 *   - registers /sw.js (see public/sw.js) on first subscribe;
 *   - persists the browser subscription (endpoint + p256dh/auth) to the
 *     backend, which uses it for the publish-time broadcast;
 *   - exposes the single source of truth as a `status` state machine:
 *     unsupported | unconfigured | idle | denied | subscribed |
 *     subscribing | unsubscribing.
 *
 * SSR-safe: every navigator/window access is behind a guard, so the initial
 * state is `unsupported` on the server and the button stays hidden.
 */

import { ref } from "vue";

export type PushStatus =
	| "unsupported"
	| "unconfigured"
	| "idle"
	| "denied"
	| "subscribed"
	| "subscribing"
	| "unsubscribing";

// Singleton state shared by every consumer (header button etc.) — mirrors the
// useBookmarks module-scoped-state pattern.
const status = ref<PushStatus>("unsupported");

// New-post notification preference for THIS browser (DEC-076/TASK-147): whether
// it wants new-post pushes and, if so, whether narrowed to one followed
// category (null = all new posts). Kept in module scope so the category-page
// follow button and later subscribes share one source of truth.
export interface NewPostPrefs {
	want: boolean;
	categoryId: number | null;
}

const newPostPrefs = ref<NewPostPrefs>({ want: false, categoryId: null });

/** Decode the base64url VAPID public key into the bytes pushManager expects. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
	const padding = "=".repeat((4 - (base64.length % 4)) % 4);
	const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
	const raw = window.atob(normalized);
	// new Uint8Array(new ArrayBuffer(n)) — TS 6 generic-typed arrays: a bare
	// `new Uint8Array(n)` is Uint8Array<ArrayBufferLike>, which PushManager's
	// applicationServerKey (BufferSource = ArrayBufferView<ArrayBuffer>) rejects.
	const bytes = new Uint8Array(new ArrayBuffer(raw.length));
	for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
	return bytes;
}

function isSupported(): boolean {
	return (
		typeof window !== "undefined" &&
		"serviceWorker" in navigator &&
		"PushManager" in window &&
		"Notification" in window
	);
}

function apiBase(): string {
	return useRuntimeConfig().public.apiUrl || "";
}

async function fetchBackendPublicKey(): Promise<string | null> {
	try {
		const res = await fetch(`${apiBase()}/api/push/vapid-public-key`);
		if (!res.ok) return null;
		const data = await res.json().catch(() => null);
		return typeof data?.public_key === "string" ? data.public_key : null;
	} catch {
		return null;
	}
}

/** Serialize a browser PushSubscription into the backend's wire shape. */
function subscriptionToBody(
	sub: PushSubscription,
	prefs: NewPostPrefs = newPostPrefs.value,
): {
	endpoint: string;
	keys: { p256dh: string; auth: string };
	want_new_posts: boolean;
	new_post_category_id: number | null;
} {
	const b64url = (buffer: ArrayBuffer | null): string => {
		const bytes = new Uint8Array(buffer ?? new ArrayBuffer(0));
		let binary = "";
		bytes.forEach((byte) => {
			binary += String.fromCharCode(byte);
		});
		return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
	};
	return {
		endpoint: sub.endpoint,
		keys: { p256dh: b64url(sub.getKey("p256dh")), auth: b64url(sub.getKey("auth")) },
		// New-post notification prefs on this browser (DEC-076/TASK-147).
		want_new_posts: prefs.want,
		new_post_category_id: prefs.categoryId,
	};
}

async function activeSubscription(): Promise<PushSubscription | null> {
	const registration = await navigator.serviceWorker.getRegistration("/sw.js");
	if (!registration) return null;
	return registration.pushManager.getSubscription();
}

async function syncBackend(
	sub: PushSubscription,
	path: "subscribe" | "unsubscribe",
	prefs?: NewPostPrefs,
): Promise<void> {
	// Send the reader JWT when present so the backend binds this subscription
	// to the reader account (targeted reply notifications, DEC-064/TASK-137).
	// Anonymous browsers subscribe without it and only receive broadcasts.
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (typeof localStorage?.getItem === "function") {
		const token = localStorage.getItem("reader_token");
		if (token) headers.Authorization = `Bearer ${token}`;
	}
	const res = await fetch(`${apiBase()}/api/push/${path}`, {
		method: "POST",
		headers,
		// On unsubscribe the backend only needs the endpoint; prefs ride along
		// on subscribe (and resubscribe-with-prefs) to upsert the opt-in.
		body: JSON.stringify(
			subscriptionToBody(sub, path === "subscribe" ? prefs : newPostPrefs.value),
		),
	});
	if (!res.ok) throw new Error(`push ${path} failed (${res.status})`);
}

/**
 * (Re)sync state with the browser on mount: re-detects an existing push
 * subscription so reloading a previously-opted-in visitor keeps the button in
 * the "subscribed" state without an extra backend round-trip.
 */
async function init(): Promise<void> {
	if (!isSupported()) {
		status.value = "unsupported";
		return;
	}
	if (!(await fetchBackendPublicKey())) {
		status.value = "unconfigured";
		return;
	}
	if (Notification.permission === "denied") {
		status.value = "denied";
		return;
	}
	status.value = (await activeSubscription()) ? "subscribed" : "idle";
}

/** Opt this browser in: register the SW, request permission once, subscribe. */
async function subscribe(prefs?: NewPostPrefs): Promise<void> {
	if (prefs) newPostPrefs.value = prefs;
	if (!isSupported() || status.value === "denied") return;
	const publicKey = await fetchBackendPublicKey();
	if (!publicKey) {
		status.value = "unconfigured";
		return;
	}
	status.value = "subscribing";
	try {
		const registration = await navigator.serviceWorker.register("/sw.js");
		await navigator.serviceWorker.ready;
		if (Notification.permission !== "granted") {
			const permission = await Notification.requestPermission();
			if (permission !== "granted") {
				status.value = "denied";
				return;
			}
		}
		let sub = await registration.pushManager.getSubscription();
		if (!sub) {
			sub = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(publicKey),
			});
		}
		await syncBackend(sub, "subscribe");
		status.value = "subscribed";
	} catch {
		status.value = "idle"; // transient failure; the button retries on click
	}
}

/** Opt this browser out: forget it on the backend, then unsubscribe locally. */
async function unsubscribe(): Promise<void> {
	if (!isSupported()) return;
	status.value = "unsubscribing";
	try {
		const sub = await activeSubscription();
		if (sub) {
			// Best-effort backend removal (the endpoint may already be gone).
			await syncBackend(sub, "unsubscribe").catch(() => {});
			await sub.unsubscribe();
		}
		status.value = "idle";
	} catch {
		status.value = "subscribed";
	}
}

/**
 * Re-stamp the reader on an existing subscription after an auth change (e.g.
 * he just signed in). A browser that subscribed while anonymous stays
 * anonymous-bound until this runs; reply notifications (DEC-064) are only
 * delivered to reader-bound subscriptions. Anonymous re-stamp is a no-op on
 * the backend (reader_id preserved), matching the conservative opt-in model.
 */
async function syncReaderBinding(): Promise<void> {
	if (!isSupported() || status.value !== "subscribed") return;
	const sub = await activeSubscription();
	if (sub) await syncBackend(sub, "subscribe").catch(() => {});
}

/**
 * Set this browser's new-post notification prefs (DEC-076/TASK-147). When
 * already subscribed the prefs are upserted on the backend immediately
 * (subscribe is an endpoint-keyed upsert); otherwise they are remembered so
 * the next subscribe carries them.
 */
async function setNewPostPrefs(prefs: NewPostPrefs): Promise<void> {
	newPostPrefs.value = prefs;
	if (!isSupported() || status.value !== "subscribed") return;
	const sub = await activeSubscription();
	if (sub) await syncBackend(sub, "subscribe", prefs);
}

export function usePushSubscription() {
	return { status, init, subscribe, unsubscribe, syncReaderBinding, setNewPostPrefs, newPostPrefs };
}
