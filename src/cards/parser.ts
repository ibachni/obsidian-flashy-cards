import { App, TFile } from "obsidian";
import { CardFrontmatter, CardFrontmatterT } from "../schema/card";

export interface ParsedCard {
	path: string;
	fm: CardFrontmatterT;
	question: string;
	answer: string;
}

export type ParseOutcome =
	| { kind: "parsed"; card: ParsedCard }
	| { kind: "invalid"; path: string; error: string }
	| { kind: "skipped"; path: string };

export interface ScanResult {
	parsed: ParsedCard[];
	invalid: { path: string; error: string }[];
	skipped: number;
}

function stripFrontmatter(content: string): string {
	return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/**
 * Split a card body on H1 headings into a record of `heading → content`.
 * Naive splitter — does not handle H1s appearing inside code blocks.
 * The risk register notes this as a known edge case (P1 risks table).
 *
 * Exported for unit-testing.
 */
export function parseBodySections(body: string): Record<string, string> {
	const parts = body.split(/^# (.+)$/m);
	// parts[0] is preamble (before first H1); parts[2k-1] is heading k, parts[2k] is content.
	const sections: Record<string, string> = {};
	for (let i = 1; i + 1 < parts.length; i += 2) {
		const heading = parts[i];
		const content = parts[i + 1];
		if (heading === undefined || content === undefined) continue;
		sections[heading.trim()] = content.trim();
	}
	return sections;
}

export async function parseCardFile(
	app: App,
	file: TFile,
): Promise<ParseOutcome> {
	const cache = app.metadataCache.getFileCache(file);
	const fm = cache?.frontmatter;

	if (!fm || fm.type !== "flashcard") {
		return { kind: "skipped", path: file.path };
	}

	const result = CardFrontmatter.safeParse(fm);
	if (!result.success) {
		const error = result.error.issues
			.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
			.join("; ");
		return { kind: "invalid", path: file.path, error };
	}

	const content = await app.vault.cachedRead(file);
	const body = stripFrontmatter(content);
	const sections = parseBodySections(body);
	const question = sections["Question"];
	const answer = sections["Answer"];

	if (!question || !answer) {
		const missing = [
			!question ? "# Question" : null,
			!answer ? "# Answer" : null,
		]
			.filter(Boolean)
			.join(" and ");
		return {
			kind: "invalid",
			path: file.path,
			error: `body missing ${missing}`,
		};
	}

	return {
		kind: "parsed",
		card: {
			path: file.path,
			fm: result.data,
			question,
			answer,
		},
	};
}

export async function scanCards(
	app: App,
	cardsRoot: string,
): Promise<ScanResult> {
	const parsed: ParsedCard[] = [];
	const invalid: { path: string; error: string }[] = [];
	let skipped = 0;

	const root = cardsRoot.endsWith("/") ? cardsRoot : cardsRoot + "/";

	for (const file of app.vault.getMarkdownFiles()) {
		if (!file.path.startsWith(root)) continue;
		const outcome = await parseCardFile(app, file);
		switch (outcome.kind) {
			case "parsed":
				parsed.push(outcome.card);
				break;
			case "invalid":
				invalid.push({ path: outcome.path, error: outcome.error });
				break;
			case "skipped":
				skipped++;
				break;
		}
	}

	return { parsed, invalid, skipped };
}
