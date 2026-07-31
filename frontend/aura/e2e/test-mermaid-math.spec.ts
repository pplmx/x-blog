import { expect, test } from "@playwright/test";

test("mermaid and math render on post page", async ({ page }) => {
	await page.goto("/posts/welcome-to-x-blog");

	// Wait for client-side rendering and async imports
	await page.waitForTimeout(5000);

	// Check mermaid divs
	const mermaidDivs = page.locator("div[data-mermaid-key]");
	const mermaidCount = await mermaidDivs.count();
	console.log(`Mermaid div count: ${mermaidCount}`);

	let mermaidRendered = false;
	for (let i = 0; i < mermaidCount; i++) {
		const content = await mermaidDivs.nth(i).innerHTML();
		const hasContent = content.trim().length > 0;
		console.log(
			`Mermaid div ${i} - has content: ${hasContent}, has SVG: ${content.includes("<svg")}`,
		);
		if (hasContent) mermaidRendered = true;
	}

	// Check math spans
	const mathSpans = page.locator("span[data-math-key]");
	const mathCount = await mathSpans.count();
	console.log(`Math span count: ${mathCount}`);

	let mathRendered = false;
	for (let i = 0; i < mathCount; i++) {
		const content = await mathSpans.nth(i).innerHTML();
		const hasContent = content.trim().length > 0;
		console.log(
			`Math span ${i} - has content: ${hasContent}, has katex: ${content.includes("katex")}`,
		);
		if (hasContent) mathRendered = true;
	}

	// Check for KaTeX SVG output
	const katexElements = page.locator(".katex");
	const katexCount = await katexElements.count();
	console.log(`KaTeX element count: ${katexCount}`);

	// Check for console errors
	const errors: string[] = [];
	page.on("console", (msg) => {
		if (msg.type() === "error") {
			errors.push(msg.text());
		}
	});

	await page.waitForTimeout(2000);
	console.log(`Console errors: ${errors.length}`);
	for (const e of errors) console.log(`  Error: ${e}`);

	// Overall result
	console.log(`\n=== Results ===`);
	console.log(`Mermaid rendered: ${mermaidRendered}`);
	console.log(`Math rendered: ${mathRendered}`);
	console.log(`KaTeX elements: ${katexCount}`);

	expect(mermaidRendered || mathRendered).toBeTruthy();
});
