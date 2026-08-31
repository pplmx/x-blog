/**
 * Admin Web Push composable for comment-moderation alerts (DEC-080, TASK-152).
 *
 * The blog moderates every comment, so an admin opts a browser in here to get
 * a push the moment a new comment awaits approval (deep-links to
 * /admin/comments). This mirrors usePushSubscription's browser flow — VAPID
 * public-key fetch, /sw.js registration (reused, never duplicated; a browser
 * holds ONE push subscription per registration), pushManager.subscribe — but
 * persists through the ADMIN-scoped /api/admin/push endpoints with the admin
 * JWT, into the separate admin_push_subscriptions table.
 *
 * Two deliberate differences from the reader composable:
 *   - "subscribed" is decided by querying the BACKEND for this browser's
 *     endpoint (GET /api/admin/push/subscriptions), not by the browser's push
 *     subscription alone — the same browser subscription may also back reader
 *     notifications, so its existence doesn't imply a moderation opt-in.
 *   - unsubscribe removes ONLY the backend admin row; it never destroys the
 *     shared browser subscription, so turning off moderation alerts cannot
 *     silently kill the reader's new-post/reply notifications.
 *
 * SSR-safe: every navigator/window access is behind a guard, so the initial
 * state is `unsupported` on the server and the toggle stays hidden.
 */

import { ref } from "vue";
import { fetchBackendPublicKey, isSupported, urlBase64ToUint8Array } from "./usePushSubscription";

export type AdminPushStatus =
	| "unsupported"
	| "unconfigured"
	| "idle"
	| "denied"
	| "subscribed"
	| "subscribing"
	| "unsubscribing";

// Singleton state shared by every consumer of the admin moderation toggle.
const status = ref<AdminPushStatus>("unsupported");

// Transient subscribe/unsubscribe failures are surfaced here (status reverts to
// a retryable state; consumers flash this as a message). Mirrors the reader
// composable — a failed admin opt-in used to silently do nothing (ISS-215).
const error = ref(false);

function apiBase(): string {
	return useRuntimeConfig().public.apiUrl || "";
}

function adminHeaders(): Record<string, string> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (typeof localStorage?.getItem === "function") {
		const token = localStorage.getItem("admin_token");
		if (token) headers.Authorization = `Bearer ${token}`;
	}
	return headers;
}

/** Serialize a browser PushSubscription into the admin backend's wire shape. */
function subscriptionToBody(sub: PushSubscription): {
	endpoint: string;
	keys: { p256dh: string; auth: string };
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
	};
}

async function activeSubscription(): Promise<PushSubscription | null> {
	const registration = await navigator.serviceWorker.getRegistration("/sw.js");
	if (!registration) return null;
	return registration.pushManager.getSubscription();
}

/** This admin's registered moderation endpoints from the backend ([] on error). */
async function fetchAdminSubscriptions(): Promise<string[]> {
	try {
		const res = await fetch(`${apiBase()}/api/admin/push/subscriptions`, {
			headers: adminHeaders(),
		});
		if (!res.ok) return [];
		const data = await res.json().catch(() => null);
		const items: Array<{ endpoint: string }> = Array.isArray(data?.items) ? data.items : [];
		return items.map((item) => item.endpoint);
	} catch {
		return [];
	}
}

async function syncBackend(
	sub: PushSubscription,
	path: "subscribe" | "unsubscribe",
): Promise<void> {
	const res = await fetch(`${apiBase()}/api/admin/push/${path}`, {
		method: "POST",
		headers: adminHeaders(),
		body: JSON.stringify(subscriptionToBody(sub)),
	});
	if (!res.ok) throw new Error(`admin push ${path} failed (${res.status})`);
}

/**
 * (Re)sync with the backend on mount: reloading a previously-opted-in admin
 * keeps the toggle in the "subscribed" state even though the browser push
 * subscription may also back reader notifications.
 */
async function init(): Promise<void> {
	error.value = false;
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
	const browserSub = await activeSubscription();
	const registered = await fetchAdminSubscriptions();
	status.value = browserSub && registered.includes(browserSub.endpoint) ? "subscribed" : "idle";
}

/** Opt this browser into moderation alerts (reuses an existing push subscription). */
async function subscribe(): Promise<void> {
	error.value = false;
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
		status.value = "idle"; // transient failure; the toggle retries on click
		error.value = true;
	}
}

/** Opt this browser out. Removes ONLY the backend admin row — never destroys
 * the shared browser subscription, so the reader's notifications survive. */
async function unsubscribe(): Promise<void> {
	error.value = false;
	if (!isSupported()) return;
	status.value = "unsubscribing";
	try {
		const sub = await activeSubscription();
		if (sub) {
			// Best-effort backend removal (the endpoint may already be gone).
			await syncBackend(sub, "unsubscribe").catch(() => {});
		}
		status.value = "idle";
	} catch {
		status.value = "subscribed";
		error.value = true;
	}
}

export function useAdminPushSubscription() {
	return { status, error, init, subscribe, unsubscribe };
}
