import { computed, ref } from "vue";

export function useUpload() {
	// In-flight counter (not a boolean): two overlapping uploads (e.g. pasting
	// a fresh image while a drop upload is still running) share these refs, so
	// whichever call finishes FIRST must not clear the busy flag while the other
	// is still uploading — a shared boolean made the overlay/spinner vanish early
	// (round-300 deep-dive).
	const inFlight = ref(0);
	const error = ref<string | null>(null);
	const isUploading = computed(() => inFlight.value > 0);

	async function uploadImage(file: File): Promise<string | null> {
		try {
			// The increment is inside the try so the finally can never run without
			// its matching increment — a synchronous throw while preparing the
			// request (e.g. a bad runtime config resolving) would otherwise leave
			// inFlight forever ≥1 and isUploading true (round-300 review).
			inFlight.value += 1;
			error.value = null;

			const config = useRuntimeConfig();
			const apiUrl = config.public.apiUrl;
			// typeof window guards SSR (see useAdminAuth.hasLocalStorage)
			const token =
				typeof window !== "undefined" &&
				typeof localStorage !== "undefined" &&
				typeof localStorage.getItem === "function"
					? localStorage.getItem("admin_token")
					: null;

			const formData = new FormData();
			formData.append("file", file);

			const res = await fetch(`${apiUrl}/api/upload`, {
				method: "POST",
				headers: token ? { Authorization: `Bearer ${token}` } : {},
				body: formData,
			});

			if (!res.ok) {
				// Session-expired/revoked admin token: every other admin command
				// route 401 → /admin/login?next= through transport.ts's
				// flagAdminUnauthorized. A RAW fetch here skipped that, stranding
				// the operator on the editor with a generic "Upload failed (401)"
				// and no path back to re-auth (deep-dive finding).
				if (res.status === 401) {
					useAdminAuth().handleAdminUnauthorized(window.location.pathname);
				}
				const detail = await res.json().catch(() => ({}));
				throw new Error(detail?.detail || `Upload failed (${res.status})`);
			}

			const data = await res.json();
			return data.url;
		} catch (err) {
			error.value = err instanceof Error ? err.message : "Upload failed";
			return null;
		} finally {
			inFlight.value -= 1;
		}
	}

	return { uploadImage, isUploading, error };
}
