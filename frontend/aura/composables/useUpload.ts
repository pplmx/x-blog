import { ref } from "vue";

export function useUpload() {
	const isUploading = ref(false);
	const error = ref<string | null>(null);

	async function uploadImage(file: File): Promise<string | null> {
		isUploading.value = true;
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

		try {
			const res = await fetch(`${apiUrl}/api/upload`, {
				method: "POST",
				headers: token ? { Authorization: `Bearer ${token}` } : {},
				body: formData,
			});

			if (!res.ok) {
				const detail = await res.json().catch(() => ({}));
				throw new Error(detail?.detail || `Upload failed (${res.status})`);
			}

			const data = await res.json();
			return data.url;
		} catch (err) {
			error.value = err instanceof Error ? err.message : "Upload failed";
			return null;
		} finally {
			isUploading.value = false;
		}
	}

	return { uploadImage, isUploading, error };
}
