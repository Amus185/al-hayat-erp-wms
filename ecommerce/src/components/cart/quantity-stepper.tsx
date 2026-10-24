"use client";

// − [n] + control. The minus button never goes below 1: removing a line is a
// separate, explicit action.
export function QuantityStepper({
  value,
  onChange,
  max,
  label,
  size = "md",
}: {
  value: number;
  onChange: (n: number) => void;
  max: number;
  label: string;
  size?: "md" | "lg";
}) {
  const h = size === "lg" ? "h-[52px]" : "h-9";
  const w = size === "lg" ? "w-11" : "w-9";
  return (
    <div className={`flex ${h} items-center rounded-md border border-line bg-white`} role="group" aria-label={`Quantity of ${label}`}>
      <button
        type="button"
        onClick={() => onChange(Math.max(1, value - 1))}
        disabled={value <= 1}
        aria-label={`Decrease quantity of ${label}`}
        className={`${w} h-full text-lg text-ink hover:text-brand-dark disabled:text-line`}
      >
        −
      </button>
      <span className="min-w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite" aria-atomic="true">
        <span className="sr-only">Quantity </span>{value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={`Increase quantity of ${label}`}
        className={`${w} h-full text-lg text-ink hover:text-brand-dark disabled:text-line`}
      >
        +
      </button>
    </div>
  );
}
