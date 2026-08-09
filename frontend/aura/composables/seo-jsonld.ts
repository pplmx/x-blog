/**
 * Pure JSON-LD structured-data builders.
 *
 * No Nuxt imports here on purpose: nuxt.config.ts loads this module at build
 * time in the node context, where Nuxt's auto-import globals (useHead,
 * useRuntimeConfig, ...) are not in scope and would break `nuxt typecheck`.
 * Keeping the structured-data helpers free of Nuxt built-ins lets the config
 * import them safely while the app-facing composables in `useSeo.ts` handle
 * the meta/head side.
 */

/**
 * Build WebSite JSON-LD structured data for the site (global, site-wide).
 */
export function buildSiteJsonLd(options: {
	url: string;
	siteName: string;
	description: string;
}): Record<string, unknown> {
	return {
		"@context": "https://schema.org",
		"@type": "WebSite",
		name: options.siteName,
		description: options.description,
		url: options.url,
		publisher: {
			"@type": "Organization",
			name: options.siteName,
		},
	};
}
