/**
 * App-wide service-worker registration for offline reading (round 384).
 *
 * The push path (usePushSubscription) only registers /sw.js after a reader
 * opts into web push — so visitors who never touched that button had no
 * service worker and, with it, no offline story. Register the same classic
 * SW on every app boot in the PRODUCTION build only (in dev, HMR churns the
 * chunk URLs and there is nothing to serve offline anyway). The SW's network-
 * first fetch handler is harmless while online (cache is only an offline
 * fallback), and a failed registration is not worth erroring the page for.
 */
export default defineNuxtPlugin(() => {
	// import.meta.env.PROD (Vite) is replaced at build time; Nuxt's
	// import.meta.prod alias is not replaced in client-side bundles here.
	if (!import.meta.env.PROD) return;
	if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
	if (
		typeof window !== "undefined" &&
		!window.isSecureContext &&
		window.location.hostname !== "localhost" &&
		window.location.hostname !== "127.0.0.1"
	) {
		return;
	}
	void navigator.serviceWorker.register("/sw.js").catch(() => {
		// Best-effort offline enhancement — a failed registration must not
		// break the page (e.g. unsupported storage / browser policy).
	});
});
