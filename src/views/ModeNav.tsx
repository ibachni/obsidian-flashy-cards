export type Mode = "review" | "browse" | "create";

const ORDER: { mode: Mode; label: string }[] = [
	{ mode: "review", label: "Review" },
	{ mode: "browse", label: "Browse" },
	{ mode: "create", label: "Create" },
];

interface Props {
	active: Mode;
	onChange: (mode: Mode) => void;
}

/**
 * Centered three-mode nav for the unified pane. Active mode is
 * underlined; inactive modes go bold on hover (note: font-weight change
 * causes a small horizontal reflow — acceptable for v1; mitigations in
 * docs/features/unified-pane.md if it proves jarring).
 */
export function ModeNav({ active, onChange }: Props) {
	return (
		<nav
			aria-label="View mode"
			className="flex items-center justify-center gap-6"
		>
			{ORDER.map(({ mode, label }) => (
				<ModeButton
					key={mode}
					label={label}
					isActive={mode === active}
					onClick={() => onChange(mode)}
				/>
			))}
		</nav>
	);
}

function ModeButton({
	label,
	isActive,
	onClick,
}: {
	label: string;
	isActive: boolean;
	onClick: () => void;
}) {
	// `.ls-flat` strips Obsidian's default button chrome; everything else
	// is text styling. Active = underlined + fg ink + medium weight.
	// Inactive = muted text that goes bold + fg on hover.
	const base = "ls-flat px-0! text-base! transition-colors";
	const styles = isActive
		? "text-fg-strong! font-medium! underline underline-offset-4 cursor-default"
		: "text-muted! hover:text-fg-strong! hover:font-bold";
	return (
		<button
			type="button"
			className={`${base} ${styles}`}
			aria-current={isActive ? "page" : undefined}
			onClick={isActive ? undefined : onClick}
		>
			{label}
		</button>
	);
}
