import { adminAuthHeaders } from "../auth";
import { command, withQuery } from "../transport";

/** One post on the editorial calendar, bucketed to a grid day by the backend. */
export interface CalendarPost {
	id: number;
	title: string;
	slug: string;
	type: "published" | "scheduled" | "draft";
	date?: string | null;
	published: boolean;
	publish_at?: string | null;
	category?: string | null;
}

export interface AdminCalendarResponse {
	month: string;
	items: CalendarPost[];
	unscheduled: CalendarPost[];
}

/** Month-bucketed posts for the admin editorial calendar (auth required). */
export function getAdminCalendar(month: string): Promise<AdminCalendarResponse> {
	return command<AdminCalendarResponse>(withQuery("/api/admin/calendar", { month }), {
		headers: adminAuthHeaders(),
	});
}
