import { Children, isValidElement, useId } from "react";
import AnchoredTooltip from "./AnchoredTooltip.jsx";
import { inputClass } from "../lib/formClasses.js";
import { useCloseDetailsOnOutsideClick } from "../hooks/useCloseDetailsOnOutsideClick.js";

function normalizeNumericText(value) {
  if (value === null || value === undefined || value === "") return "";
  return String(value);
}

function sanitizeNumericText(value) {
  return String(value || "")
    .replace(/[^\d]/g, "")
    .replace(/^0+(?=\d)/, "");
}

export function HelpTooltip({ text }) {
  if (!text) return null;
  return (
    <AnchoredTooltip
      width={320}
      trigger={
        <button
          type="button"
          className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-neutral-600 bg-transparent text-[10px] font-bold leading-none text-neutral-400 outline-none transition hover:border-accent hover:text-accent focus:border-accent focus:text-accent"
          aria-label={text}
        >
          ?
        </button>
      }
      panelClassName="rounded-lg border border-line bg-neutral-950 p-3 text-xs font-normal leading-5 text-neutral-200"
    >
        {text}
    </AnchoredTooltip>
  );
}

export function SelectionChips({ values, emptyText }) {
  const items = Array.isArray(values)
    ? values.map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  if (items.length === 0) {
    return <span className="block min-w-0 flex-1 truncate">{emptyText}</span>;
  }

  return (
    <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
      {items.map((value) => (
        <span
          key={value}
          className="max-w-full truncate rounded-full bg-neutral-600/70 px-2.5 py-1 text-xs font-semibold text-neutral-100"
          title={value}
        >
          {value}
        </span>
      ))}
    </span>
  );
}

export function Field({ label, hint, help, children, className = "", error }) {
  return (
    <label
      className={`block rounded-lg ${
        error ? "-m-2 p-2 outline outline-1 outline-red-700/80" : ""
      } ${className}`}
    >
      <span
        className={`inline-flex items-center gap-1.5 text-sm font-medium ${
          error ? "text-red-200" : "text-neutral-200"
        }`}
      >
        {label}
        <HelpTooltip text={help || hint} />
      </span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-300">{error}</span>}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
  className = "",
  ...inputProps
}) {
  return (
    <input
      className={`${inputClass} ${className}`}
      type={type}
      value={value ?? ""}
      placeholder={placeholder}
      autoComplete={autoComplete}
      {...inputProps}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  minimum = 0,
  placeholder,
  className = "",
  emptyValue = "",
}) {
  return (
    <input
      className={`${inputClass} ${className}`}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      min={minimum}
      value={normalizeNumericText(value)}
      placeholder={placeholder}
      onFocus={(event) => event.target.select()}
      onMouseUp={(event) => event.preventDefault()}
      onChange={(event) => {
        const next = sanitizeNumericText(event.target.value);
        onChange(next === "" ? emptyValue : Number(next));
      }}
    />
  );
}

export function OptionalNumberInput({
  value,
  onChange,
  minimum = 0,
  placeholder,
  className = "",
}) {
  return (
    <NumberInput
      value={value}
      minimum={minimum}
      placeholder={placeholder}
      className={className}
      emptyValue={null}
      onChange={onChange}
    />
  );
}

function optionItemsFromChildren(children) {
  return Children.toArray(children)
    .filter((child) => isValidElement(child))
    .map((child) => ({
      value: String(child.props.value ?? child.props.children ?? ""),
      label: child.props.children,
      disabled: child.props.disabled === true,
    }));
}

export function SelectInput({ value, onChange, children, className = "" }) {
  const detailsRef = useCloseDetailsOnOutsideClick();
  const options = optionItemsFromChildren(children);
  const selected =
    options.find((option) => String(option.value) === String(value)) || options[0];

  return (
    <details ref={detailsRef} className={`group relative mt-1.5 min-w-0 ${className}`}>
      <summary className="flex min-h-11 w-full min-w-0 cursor-pointer list-none items-center justify-between gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm text-white outline-none transition hover:border-neutral-500 group-open:border-accent">
        <span className="block min-w-0 flex-1 truncate">
          {selected?.label || "Select"}
        </span>
        <span className="text-neutral-300" aria-hidden="true">
          v
        </span>
      </summary>
      <div className="absolute z-40 mt-2 w-full overflow-hidden rounded-lg border border-line bg-neutral-950 py-1 shadow-2xl">
        {options.map((option) => {
          const active = String(option.value) === String(value);
          return (
            <button
              key={option.value}
              type="button"
              disabled={option.disabled}
              onClick={() => {
                onChange(option.value);
                if (detailsRef.current) detailsRef.current.open = false;
              }}
              className={`block w-full px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                active
                  ? "bg-transparent font-semibold text-neutral-100 hover:bg-accent hover:text-neutral-950 focus:bg-accent focus:text-neutral-950"
                  : "text-neutral-100 hover:bg-accent hover:text-neutral-950 focus:bg-accent focus:text-neutral-950"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </details>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  warning,
  help,
  tone = "default",
  disabled = false,
  className = "",
  error,
}) {
  const id = useId();
  const danger = tone === "danger";
  return (
    <div
      className={`flex items-start justify-between gap-5 rounded-lg border p-3 ${
        error
          ? "border-red-800/80 bg-red-950/25"
          : disabled
            ? "border-line bg-canvas/30 opacity-75"
            : danger
              ? "border-red-800/80 bg-red-950/30"
              : "border-line bg-canvas/60"
      } ${className}`}
    >
      <span>
        <span
          className={`inline-flex items-center gap-1.5 text-sm font-medium ${
            error ? "text-red-200" : "text-neutral-200"
          }`}
        >
          <label htmlFor={id} className="cursor-pointer">
            {label}
          </label>
          <HelpTooltip text={help} />
        </span>
        {error && <span className="mt-1 block text-xs text-red-300">{error}</span>}
        {warning && (
          <span
            className={`mt-1 block text-xs ${
              danger ? "font-medium text-red-300" : "text-amber-300"
            }`}
          >
            {warning}
          </span>
        )}
      </span>
      <input
        id={id}
        className={`mt-1 h-4 w-4 ${danger ? "accent-red-500" : "accent-yellow-400"}`}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </div>
  );
}
