import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

interface Props {
	allTags: string[];
	selected: Set<string>;
	onChange: (next: Set<string>) => void;
	placeholder?: string;
	/**
	 * When true, a `Create "<query>"` row appears at the bottom of the
	 * dropdown whenever the trimmed query doesn't match any existing or
	 * already-selected tag (case-insensitive). Selecting it adds the
	 * trimmed query verbatim to the selection. Default false preserves
	 * the Browse pane's filter-only behavior.
	 */
	allowCreate?: boolean;
}


/**
 * Multi-select combobox: chips for selected tags inline with a text
 * input + a chevron trigger. The dropdown is portaled to document.body
 * to escape Obsidian's right-pane overflow clipping.
 *
 * The dropdown is anchored to the chevron trigger (not the full
 * trigger row) and right-aligned to it, so it visually drops out of
 * the indicator the user clicked rather than spanning the whole row.
 *
 * Keyboard model:
 *  - Type to filter the dropdown.
 *  - ArrowDown/Up moves the highlighted suggestion (wraps).
 *  - Enter toggles the highlighted tag in the selection (panel stays open).
 *    With `allowCreate`, Enter on the Create row adds the trimmed query.
 *  - Escape closes the panel and returns focus to the input.
 *  - Backspace on empty input removes the last selected chip.
 */
export function TagCombobox({
	allTags,
	selected,
	onChange,
	placeholder = "Filter by tag…",
	allowCreate = false,
}: Props) {
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const [highlighted, setHighlighted] = useState(0);
	const [isDark, setIsDark] = useState(false);

	const triggerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const chevronRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	// Anchor by `right` rather than `left + width` so the panel can
	// auto-size to its content (w-fit) without us having to measure it.
	const [panelStyle, setPanelStyle] = useState<{
		top: number;
		right: number;
	}>({ top: 0, right: 0 });

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (q === "") return allTags;
		return allTags.filter((t) => t.toLowerCase().includes(q));
	}, [allTags, query]);

	const trimmedQuery = query.trim();
	// The Create row appears when allowCreate is on and the trimmed query
	// is non-empty and doesn't match (case-insensitively) any tag the user
	// already knows about — including ones they've just created this
	// session, which live in `selected` but may not be in `allTags` yet.
	const showCreateRow = useMemo(() => {
		if (!allowCreate || trimmedQuery.length === 0) return false;
		const lower = trimmedQuery.toLowerCase();
		for (const t of allTags) if (t.toLowerCase() === lower) return false;
		for (const t of selected) if (t.toLowerCase() === lower) return false;
		return true;
	}, [allowCreate, trimmedQuery, allTags, selected]);

	const totalItems = filtered.length + (showCreateRow ? 1 : 0);

	// Clamp highlighted into the visible range whenever the list shrinks.
	useEffect(() => {
		if (highlighted >= totalItems) {
			setHighlighted(0);
		}
	}, [totalItems, highlighted]);

	// Position the portal panel under the chevron and snapshot the
	// current theme. Portaled elements are outside .learning-system-root,
	// so we copy the dark class state from the nearest wrapper ancestor.
	useLayoutEffect(() => {
		if (!open) return;
		const chevron = chevronRef.current;
		if (!chevron) return;
		const rect = chevron.getBoundingClientRect();
		setPanelStyle({
			top: rect.bottom + 4,
			right: window.innerWidth - rect.right,
		});
		const root = chevron.closest(".learning-system-root");
		setIsDark(root?.classList.contains("dark") ?? false);
	}, [open]);

	// Outside-click closer. mousedown rather than click so a click inside
	// the panel doesn't bubble through and close the panel before the
	// suggestion's onClick has a chance to fire.
	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			const target = e.target;
			if (!(target instanceof Node)) return;
			if (triggerRef.current?.contains(target)) return;
			if (panelRef.current?.contains(target)) return;
			setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [open]);

	const toggle = (tag: string) => {
		const next = new Set(selected);
		if (next.has(tag)) next.delete(tag);
		else next.add(tag);
		onChange(next);
	};

	const createTag = (tag: string) => {
		const next = new Set(selected);
		next.add(tag);
		onChange(next);
		// Clear so the next keystroke is a fresh query and the dropdown
		// resets to the full tag list. Reset highlight so it can't be
		// pointing past the (now larger) item list.
		setQuery("");
		setHighlighted(0);
	};

	const removeChip = (tag: string) => {
		const next = new Set(selected);
		next.delete(tag);
		onChange(next);
	};

	const handleKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setOpen(true);
			setHighlighted((h) =>
				totalItems === 0 ? 0 : (h + 1) % totalItems,
			);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setOpen(true);
			setHighlighted((h) =>
				totalItems === 0 ? 0 : (h - 1 + totalItems) % totalItems,
			);
		} else if (e.key === "Enter") {
			e.preventDefault();
			if (!open) {
				setOpen(true);
			} else if (showCreateRow && highlighted === filtered.length) {
				createTag(trimmedQuery);
			} else if (filtered.length > 0 && highlighted < filtered.length) {
				const tag = filtered[highlighted];
				if (tag !== undefined) toggle(tag);
			}
		} else if (e.key === "Escape") {
			e.preventDefault();
			setOpen(false);
			inputRef.current?.focus();
		} else if (e.key === "Backspace" && query === "" && selected.size > 0) {
			e.preventDefault();
			const last = Array.from(selected).pop();
			if (last !== undefined) removeChip(last);
		}
	};

	const selectedArr = Array.from(selected);

	return (
		<>
			<div
				ref={triggerRef}
				className="flex items-stretch gap-1"
				onClick={() => inputRef.current?.focus()}
			>
				<input
					ref={inputRef}
					type="text"
					className="min-w-0 flex-1 rounded border! border-border! bg-transparent! shadow-none! px-2 py-1 text-sm text-fg-strong! outline-none"
					placeholder={placeholder}
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						setOpen(true);
					}}
					onFocus={() => setOpen(true)}
					onKeyDown={handleKey}
				/>
				<button
					ref={chevronRef}
					type="button"
					className="shrink-0 flex items-center justify-center rounded border! border-border! bg-transparent! shadow-none! px-2! text-fg! transition-colors hover:bg-subtle!"
					onClick={(e) => {
						// stopPropagation: the trigger <div> has its own
						// onClick that refocuses the input ("click row → focus
						// input" affordance). Without stopping here, a click
						// on the chevron bubbles to the trigger, refocuses the
						// input, and the input's onFocus → setOpen(true)
						// undoes our close.
						e.stopPropagation();
						// Only refocus the input when *opening* — refocusing
						// on close would also re-trigger the input's onFocus
						// → setOpen(true) and re-open the dropdown.
						const willOpen = !open;
						setOpen(willOpen);
						if (willOpen) inputRef.current?.focus();
					}}
					aria-label="Toggle tag suggestions"
					aria-expanded={open}
				>
					<ChevronDown open={open} />
				</button>
			</div>
			{selectedArr.length > 0 && (
				<div className="flex flex-wrap gap-1 px-2 pt-1">
					{selectedArr.map((tag) => (
						<Chip key={tag} label={tag} onRemove={() => removeChip(tag)} />
					))}
				</div>
			)}
			{open &&
				createPortal(
					<div
						ref={panelRef}
						style={{
							position: "fixed",
							top: panelStyle.top,
							right: panelStyle.right,
							zIndex: 1000,
							// Inline bg (not the `bg-elevated` utility) because the
							// panel is portaled to document.body, where Tailwind's
							// layered utility lost the cascade to Obsidian's
							// unlayered surface defaults in at least one user
							// setup, exposing cards behind. Inline style wins
							// regardless of source order.
							backgroundColor: "var(--ls-elevated)",
						}}
						className={`learning-system-root ${isDark ? "dark" : ""} w-fit min-w-[180px] max-h-[60vh] overflow-y-auto rounded-md border border-border shadow-md`}
					>
						<div className="sticky top-0 z-10 flex items-center justify-end bg-elevated! px-1 py-0.5">
							<button
								type="button"
								className="ls-flat rounded p-1 text-muted! transition-colors hover:bg-subtle! hover:text-fg-strong!"
								onClick={() => setOpen(false)}
								aria-label="Close suggestions"
							>
								<CloseIcon />
							</button>
						</div>
						{totalItems === 0 ? (
							<div className="px-3 py-2 text-sm text-muted">
								No tags found.
							</div>
						) : (
							<ul className="m-0 list-none p-0">
								{filtered.map((tag, i) => (
									<li key={tag}>
										<button
											type="button"
											className={`ls-tag-option flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm${
												i === highlighted ? " is-highlighted" : ""
											}`}
											onMouseEnter={() => setHighlighted(i)}
											onClick={() => toggle(tag)}
										>
											<span className="flex-1">{tag}</span>
											{selected.has(tag) && (
												<span className="shrink-0 text-xs text-accent">
													✓
												</span>
											)}
										</button>
									</li>
								))}
								{showCreateRow && (
									<li>
										<button
											type="button"
											className={`ls-tag-option flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm${
												highlighted === filtered.length
													? " is-highlighted"
													: ""
											}`}
											onMouseEnter={() => setHighlighted(filtered.length)}
											onClick={() => createTag(trimmedQuery)}
										>
											<span className="flex-1 text-muted">
												Create "<span className="text-fg">{trimmedQuery}</span>"
											</span>
										</button>
									</li>
								)}
							</ul>
						)}
					</div>,
					document.body,
				)}
		</>
	);
}

function Chip({
	label,
	onRemove,
}: {
	label: string;
	onRemove: () => void;
}) {
	// Subtle shadcn-like "secondary" badge: 10% foreground tint adapts
	// to either theme without needing a dedicated color token.
	return (
		<span className="inline-flex items-center gap-1 rounded-md bg-fg/10 px-2 py-0.5 text-xs text-fg">
			{label}
			<span
				role="button"
				tabIndex={0}
				className="cursor-pointer text-xs leading-none text-muted transition-colors hover:text-fg-strong!"
				onClick={onRemove}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						onRemove();
					}
				}}
				aria-label={`Remove ${label}`}
			>
				×
			</span>
		</span>
	);
}

function ChevronDown({ open }: { open: boolean }) {
	// 180° rotation when open so the same SVG reads as a chevron-up.
	// Transitioned for a soft flip rather than an instant snap.
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
		>
			<polyline points="6 9 12 15 18 9" />
		</svg>
	);
}

function CloseIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</svg>
	);
}
