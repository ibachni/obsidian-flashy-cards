import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import { computePanelPosition, type PanelPosition } from "./combobox-position";

/**
 * Single-select combobox with free input — Topic field. Mirrors
 * `TagCombobox`'s trigger row + portaled dropdown layout (input on the
 * left, chevron button on the right) so the two fields read as visually
 * matching. Free input is the primary path; the dropdown is a
 * convenience for picking an existing topic.
 */
export function TopicCombobox({
	value,
	onChange,
	allTopics,
	placeholder,
}: {
	value: string;
	onChange: (v: string) => void;
	allTopics: string[];
	placeholder?: string;
}) {
	const [open, setOpen] = useState(false);
	const [highlighted, setHighlighted] = useState(0);
	const [isDark, setIsDark] = useState(false);
	const [panelStyle, setPanelStyle] = useState<PanelPosition>({
		top: 0,
		right: 0,
		maxHeight: 400,
	});

	const triggerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const chevronRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	const matches = useMemo(() => {
		const q = value.trim().toLowerCase();
		if (q === "") return allTopics;
		return allTopics.filter((t) => t.toLowerCase().includes(q));
	}, [value, allTopics]);

	useEffect(() => {
		if (highlighted >= matches.length) setHighlighted(0);
	}, [matches.length, highlighted]);

	useLayoutEffect(() => {
		if (!open) return;
		const chevron = chevronRef.current;
		if (!chevron) return;
		setPanelStyle(computePanelPosition(chevron));
		const root = chevron.closest(".learning-system-root");
		setIsDark(root?.classList.contains("dark") ?? false);
	}, [open]);

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

	const pick = (topic: string) => {
		onChange(topic);
		setOpen(false);
	};

	const handleKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setOpen(true);
			setHighlighted((h) =>
				matches.length === 0 ? 0 : (h + 1) % matches.length,
			);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setOpen(true);
			setHighlighted((h) =>
				matches.length === 0
					? 0
					: (h - 1 + matches.length) % matches.length,
			);
		} else if (e.key === "Enter") {
			if (open && matches.length > 0) {
				e.preventDefault();
				const t = matches[highlighted];
				if (t !== undefined) pick(t);
			}
		} else if (e.key === "Escape") {
			e.preventDefault();
			setOpen(false);
		}
	};

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
					value={value}
					placeholder={placeholder}
					onChange={(e) => {
						onChange(e.target.value);
						setOpen(true);
					}}
					onFocus={() => setOpen(true)}
					onKeyDown={handleKey}
					className="min-w-0 flex-1 rounded border! border-border! bg-transparent! shadow-none! px-2 py-1 text-sm text-fg-strong! outline-none"
				/>
				<button
					ref={chevronRef}
					type="button"
					className="shrink-0 flex items-center justify-center rounded border! border-border! bg-transparent! shadow-none! px-2! text-fg! transition-colors hover:bg-subtle!"
					onClick={(e) => {
						// stopPropagation: the trigger <div> has its own
						// onClick that refocuses the input. Without
						// stopping here, a click on the chevron bubbles
						// to the trigger, refocuses the input, and the
						// input's onFocus → setOpen(true) undoes our
						// close.
						e.stopPropagation();
						const willOpen = !open;
						setOpen(willOpen);
						if (willOpen) inputRef.current?.focus();
					}}
					aria-label="Toggle topic suggestions"
					aria-expanded={open}
				>
					<ChevronIcon open={open} />
				</button>
			</div>
			{open &&
				matches.length > 0 &&
				createPortal(
					<div
						ref={panelRef}
						style={{
							position: "fixed",
							top: panelStyle.top,
							bottom: panelStyle.bottom,
							right: panelStyle.right,
							maxHeight: panelStyle.maxHeight,
							zIndex: 1000,
							backgroundColor: "var(--ls-elevated)",
						}}
						className={`learning-system-root ${isDark ? "dark" : ""} w-fit min-w-45 overflow-y-auto rounded-md border border-border shadow-md`}
					>
						<ul className="m-0 list-none p-0">
							{matches.map((t, i) => (
								<li key={t}>
									<button
										type="button"
										className={`ls-tag-option flex w-full items-center px-3 py-1.5 text-left text-sm${
											i === highlighted ? " is-highlighted" : ""
										}`}
										onMouseEnter={() => setHighlighted(i)}
										onClick={() => pick(t)}
									>
										{t}
									</button>
								</li>
							))}
						</ul>
					</div>,
					document.body,
				)}
		</>
	);
}

function ChevronIcon({ open }: { open: boolean }) {
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
