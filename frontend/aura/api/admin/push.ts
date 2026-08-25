import { adminAuthHeaders } from "../auth";
import { command } from "../transport";

/** Push notification body accepted by POST /api/push/notify (DEC-055). */
export interface PushNotifyPayload {
	title: string;
	body: string;
	url: string;
}

/** Broadcast a notification to every push subscriber (superuser only). */
export function notifyPushSubscribers(payload: PushNotifyPayload): Promise<{
	total: number;
	sent: number;
	failed: number;
	removed: number;
}> {
	return command("/api/push/notify", {
		method: "POST",
		headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
		body: payload,
	});
}
