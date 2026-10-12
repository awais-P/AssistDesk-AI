"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  BUILT_IN_LEAD_FIELDS,
  LEAD_FIELD_TYPES,
  LEAD_TRIGGERS,
  MAX_LEAD_FIELDS,
  MAX_SELECT_OPTIONS,
  type LeadFieldType,
  type LeadFormConfig,
  type LeadFormField,
  type LeadTrigger,
} from "@/src/lib/lead-form";

/**
 * Module 8 FE-1: the lead capture form builder shown in the chatbot settings, and a
 * static preview of the inline card the widget renders in the conversation.
 */

type BuiltInKey = (typeof BUILT_IN_LEAD_FIELDS)[number];

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
const MAX_OPTION_LENGTH = 60;

const fieldTypeLabels: Record<LeadFieldType, string> = {
  text: "Short text",
  textarea: "Long text",
  number: "Number",
  select: "Dropdown",
  email: "Email",
  phone: "Phone",
};

const builtInTemplates: Record<BuiltInKey, LeadFormField> = {
  name: { key: "name", label: "Name", type: "text", required: true, placeholder: "Your name" },
  email: { key: "email", label: "Email", type: "email", required: true, placeholder: "you@company.com" },
  phone: { key: "phone", label: "Phone", type: "phone", required: false, placeholder: "+92 300 1234567" },
  company: { key: "company", label: "Company", type: "text", required: false, placeholder: "Company name" },
};

const customTemplates: Array<{ type: LeadFieldType; menuLabel: string; label: string }> = [
  { type: "text", menuLabel: "Custom text", label: "Question" },
  { type: "textarea", menuLabel: "Long text", label: "Message" },
  { type: "number", menuLabel: "Number", label: "Quantity" },
  { type: "select", menuLabel: "Dropdown", label: "Choose one" },
];

const inputClass =
  "h-11 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-white disabled:cursor-not-allowed disabled:text-slate-500";

const smallButtonClass =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-[#111111] text-slate-300 transition hover:bg-[#171717] hover:text-white disabled:cursor-not-allowed disabled:opacity-40";

function isBuiltInKey(key: string): key is BuiltInKey {
  return (BUILT_IN_LEAD_FIELDS as readonly string[]).includes(key);
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28);
  return /^[a-z]/.test(slug) ? slug : `field_${slug}`.replace(/_+$/, "");
}

/** A key for a custom field that differs from the other fields' keys. */
function uniqueKey(label: string, takenKeys: string[]) {
  const base = slugify(label) || "field";
  let key = base;
  let suffix = 2;

  while (takenKeys.includes(key) || isBuiltInKey(key)) {
    key = `${base}_${suffix}`;
    suffix += 1;
  }

  return key;
}

function sanitizeKeyInput(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .slice(0, 32);
}

function isValidAfterMessages(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 20;
}

/** Problems that block saving. The server would otherwise drop the field silently. */
export function getLeadFormErrors(form: LeadFormConfig) {
  const errors: string[] = [];
  const seen = new Set<string>();

  form.fields.forEach((field, index) => {
    const name = field.label.trim() || `Field ${index + 1}`;

    if (!field.label.trim()) {
      errors.push(`Field ${index + 1} needs a label.`);
    }

    if (!KEY_PATTERN.test(field.key)) {
      errors.push(`${name}: the key must start with a letter and use only a–z, 0–9 and _.`);
    } else if (seen.has(field.key)) {
      errors.push(`${name}: the key "${field.key}" is used by another field. Keys must be unique.`);
    }

    seen.add(field.key);

    if (field.type === "select" && (field.options?.length ?? 0) < 2) {
      errors.push(`${name}: a dropdown needs at least 2 options.`);
    }
  });

  if (form.trigger === "AFTER_MESSAGES" && !isValidAfterMessages(form.afterMessages)) {
    errors.push("Lead form trigger: choose between 1 and 20 messages.");
  }

  return errors;
}

function SmallSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition ${
        checked ? "bg-emerald-400" : "bg-white/10"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-[#050505] transition ${
          checked ? "translate-x-5" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-2 block text-sm font-medium text-white">
      {children}
    </label>
  );
}

function OptionsEditor({
  id,
  options,
  onChange,
}: {
  id: string;
  options: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function addOptions(raw: string) {
    const additions = raw
      .split(",")
      .map((option) => option.trim().slice(0, MAX_OPTION_LENGTH))
      .filter(Boolean);

    if (additions.length === 0) {
      return;
    }

    onChange([...new Set([...options, ...additions])].slice(0, MAX_SELECT_OPTIONS));
    setDraft("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addOptions(draft);
    } else if (event.key === "Backspace" && !draft && options.length > 0) {
      onChange(options.slice(0, -1));
    }
  }

  const isFull = options.length >= MAX_SELECT_OPTIONS;

  return (
    <div>
      <FieldLabel htmlFor={id}>Options</FieldLabel>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#111111] px-3 py-2 focus-within:border-white">
        {options.map((option) => (
          <span
            key={option}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs text-slate-100"
          >
            {option}
            <button
              type="button"
              onClick={() => onChange(options.filter((item) => item !== option))}
              className="text-slate-400 transition hover:text-red-300"
              aria-label={`Remove option ${option}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          type="text"
          value={draft}
          disabled={isFull}
          maxLength={400}
          onChange={(event) => {
            const value = event.target.value;

            if (value.includes(",")) {
              addOptions(value);
            } else {
              setDraft(value);
            }
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => addOptions(draft)}
          placeholder={isFull ? `Maximum of ${MAX_SELECT_OPTIONS} options` : "Type an option and press Enter"}
          className="h-8 min-w-[180px] flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500 disabled:cursor-not-allowed"
        />
      </div>
      <p className={`mt-1.5 text-xs ${options.length < 2 ? "text-amber-200" : "text-slate-500"}`}>
        {options.length < 2
          ? "Add at least 2 options (separate several with commas)."
          : `${options.length}/${MAX_SELECT_OPTIONS} options.`}
      </p>
    </div>
  );
}

function AddFieldMenu({
  fields,
  onAdd,
}: {
  fields: LeadFormField[];
  onAdd: (field: LeadFormField) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isFull = fields.length >= MAX_LEAD_FIELDS;
  const usedKeys = fields.map((field) => field.key);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function choose(field: LeadFormField) {
    onAdd(field);
    setIsOpen(false);
  }

  const menuItemClass =
    "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-transparent";

  return (
    <div ref={menuRef} className="relative inline-block">
      <button
        type="button"
        disabled={isFull}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-[#111111] px-4 text-sm font-semibold text-white transition hover:bg-[#171717] disabled:opacity-50"
      >
        <span className="mr-2 text-lg leading-none">+</span>
        {isFull ? `Maximum of ${MAX_LEAD_FIELDS} fields` : "Add field"}
      </button>

      {isOpen ? (
        <div
          role="menu"
          className="absolute left-0 z-20 mt-2 w-64 rounded-xl border border-white/10 bg-[#0d0d0d] p-2 shadow-[0_20px_50px_rgba(0,0,0,0.6)]"
        >
          <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Contact details
          </p>
          {BUILT_IN_LEAD_FIELDS.map((key) => {
            const used = usedKeys.includes(key);

            return (
              <button
                key={key}
                type="button"
                role="menuitem"
                disabled={used}
                onClick={() => choose({ ...builtInTemplates[key] })}
                className={menuItemClass}
              >
                {builtInTemplates[key].label}
                {used ? <span className="text-xs">Added</span> : null}
              </button>
            );
          })}
          <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Custom question
          </p>
          {customTemplates.map((template) => (
            <button
              key={template.type}
              type="button"
              role="menuitem"
              onClick={() =>
                choose({
                  key: uniqueKey(template.label, usedKeys),
                  label: template.label,
                  type: template.type,
                  required: false,
                  ...(template.type === "select" ? { options: [] } : {}),
                })
              }
              className={menuItemClass}
            >
              {template.menuLabel}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FieldEditor({
  field,
  index,
  count,
  otherKeys,
  duplicateKey,
  onChange,
  onMove,
  onRemove,
}: {
  field: LeadFormField;
  index: number;
  count: number;
  otherKeys: string[];
  duplicateKey: boolean;
  onChange: (next: LeadFormField) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const builtIn = isBuiltInKey(field.key);
  const typeLocked = field.key === "email" || field.key === "phone";
  const idPrefix = `lead-field-${index}`;
  const keyInvalid = !KEY_PATTERN.test(field.key);

  function handleLabelChange(label: string) {
    const nextLabel = label.slice(0, 60);

    // Custom keys follow the label until the admin edits the key by hand.
    if (!builtIn && field.key === uniqueKey(field.label, otherKeys)) {
      onChange({ ...field, label: nextLabel, key: uniqueKey(nextLabel || "field", otherKeys) });
    } else {
      onChange({ ...field, label: nextLabel });
    }
  }

  function handleTypeChange(type: LeadFieldType) {
    const next: LeadFormField = { ...field, type };

    if (type === "select") {
      next.options = field.options ?? [];
    } else {
      delete next.options;
    }

    onChange(next);
  }

  return (
    <li className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-semibold text-white">
            {field.label.trim() || `Field ${index + 1}`}
          </span>
          <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] text-slate-400">
            {field.key || "—"}
          </span>
          {builtIn ? (
            <span className="rounded-md border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-200">
              Saved on the lead
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className={smallButtonClass}
            aria-label={`Move ${field.label || "field"} up`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m6 15 6-6 6 6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            className={smallButtonClass}
            aria-label={`Move ${field.label || "field"} down`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onRemove}
            className={`${smallButtonClass} hover:text-red-300`}
            aria-label={`Remove ${field.label || "field"}`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M5 7h14" />
              <path d="M9 7V5.5h6V7" />
              <path d="M8.5 7 9 19h6l.5-12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <FieldLabel htmlFor={`${idPrefix}-label`}>Label</FieldLabel>
          <input
            id={`${idPrefix}-label`}
            type="text"
            value={field.label}
            maxLength={60}
            onChange={(event) => handleLabelChange(event.target.value)}
            className={`${inputClass} ${field.label.trim() ? "" : "border-red-500/50"}`}
          />
        </div>

        <div>
          <FieldLabel htmlFor={`${idPrefix}-key`}>Key</FieldLabel>
          <input
            id={`${idPrefix}-key`}
            type="text"
            value={field.key}
            disabled={builtIn}
            maxLength={32}
            onChange={(event) => onChange({ ...field, key: sanitizeKeyInput(event.target.value) })}
            className={`${inputClass} font-mono ${keyInvalid || duplicateKey ? "border-red-500/50" : ""}`}
          />
          <p className={`mt-1.5 text-xs ${keyInvalid || duplicateKey ? "text-red-300" : "text-slate-500"}`}>
            {duplicateKey
              ? "Another field already uses this key."
              : keyInvalid
                ? "Start with a letter; use a–z, 0–9 and _."
                : builtIn
                  ? "Built-in: stored in the lead's own column."
                  : "Used in exports and webhooks."}
          </p>
        </div>

        <div>
          <FieldLabel htmlFor={`${idPrefix}-type`}>Type</FieldLabel>
          <select
            id={`${idPrefix}-type`}
            value={field.type}
            disabled={typeLocked}
            onChange={(event) => handleTypeChange(event.target.value as LeadFieldType)}
            className={`${inputClass} disabled:opacity-70`}
          >
            {LEAD_FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {fieldTypeLabels[type]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <FieldLabel htmlFor={`${idPrefix}-placeholder`}>Placeholder</FieldLabel>
          <input
            id={`${idPrefix}-placeholder`}
            type="text"
            value={field.placeholder ?? ""}
            maxLength={80}
            onChange={(event) => onChange({ ...field, placeholder: event.target.value })}
            placeholder={field.type === "select" ? "Choose an option" : "Optional"}
            className={inputClass}
          />
        </div>
      </div>

      {field.type === "select" ? (
        <div className="mt-4">
          <OptionsEditor
            id={`${idPrefix}-options`}
            options={field.options ?? []}
            onChange={(options) => onChange({ ...field, options })}
          />
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <SmallSwitch
          checked={field.required}
          onChange={(required) => onChange({ ...field, required })}
          label={`${field.label || "Field"} required`}
        />
        <span className="text-sm text-slate-300">Required</span>
      </div>
    </li>
  );
}

export function LeadFormBuilder({
  value,
  onChange,
  primaryColor,
}: {
  value: LeadFormConfig;
  onChange: (next: LeadFormConfig) => void;
  primaryColor: string;
}) {
  const [afterMessagesDraft, setAfterMessagesDraft] = useState(String(value.afterMessages));
  const hasContactField = value.fields.some((field) => field.key === "email" || field.key === "phone");
  const keyCounts = value.fields.reduce<Record<string, number>>((counts, field) => {
    counts[field.key] = (counts[field.key] ?? 0) + 1;
    return counts;
  }, {});
  const selectedTrigger = LEAD_TRIGGERS.find((trigger) => trigger.value === value.trigger);
  const afterMessagesInvalid = !isValidAfterMessages(value.afterMessages);

  function update(patch: Partial<LeadFormConfig>) {
    onChange({ ...value, ...patch });
  }

  function updateField(index: number, field: LeadFormField) {
    update({ fields: value.fields.map((item, itemIndex) => (itemIndex === index ? field : item)) });
  }

  function moveField(index: number, direction: -1 | 1) {
    const target = index + direction;

    if (target < 0 || target >= value.fields.length) {
      return;
    }

    const fields = [...value.fields];
    [fields[index], fields[target]] = [fields[target], fields[index]];
    update({ fields });
  }

  function handleAfterMessagesChange(raw: string) {
    setAfterMessagesDraft(raw);
    update({ afterMessages: raw.trim() ? Number(raw) : 0 });
  }

  return (
    <div className="space-y-5">
      <p className="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm leading-6 text-sky-100">
        When the trigger fires, the assistant pauses, shows this form in the chat, and
        answers the visitor&apos;s question after they submit or skip. If we already know
        everything the form asks for, the lead is captured without showing it.
      </p>

      <div className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-[#111111] px-4 py-4">
        <div>
          <p className="text-sm font-semibold text-white">Show a lead form in the conversation</p>
          <p className="mt-1 text-sm text-slate-400">
            Collect contact details from interested visitors as a lead for your sales team.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={value.enabled}
          aria-label="Show a lead form in the conversation"
          onClick={() => update({ enabled: !value.enabled })}
          className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition ${
            value.enabled ? "bg-emerald-400" : "bg-white/10"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-[#050505] transition ${
              value.enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      <div className={value.enabled ? "space-y-5" : "space-y-5 opacity-60"}>
        <div>
          <FieldLabel htmlFor="lead-form-trigger">When to show it</FieldLabel>
          <select
            id="lead-form-trigger"
            value={value.trigger}
            onChange={(event) => update({ trigger: event.target.value as LeadTrigger })}
            className="h-12 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none"
          >
            {LEAD_TRIGGERS.map((trigger) => (
              <option key={trigger.value} value={trigger.value}>
                {trigger.label}
              </option>
            ))}
          </select>
          {selectedTrigger ? (
            <p className="mt-2 text-sm text-slate-400">{selectedTrigger.description}</p>
          ) : null}

          {value.trigger === "AFTER_MESSAGES" ? (
            <div className="mt-3 flex items-center gap-3">
              <label htmlFor="lead-form-after-messages" className="text-sm text-slate-300">
                After
              </label>
              <input
                id="lead-form-after-messages"
                type="number"
                min={1}
                max={20}
                value={afterMessagesDraft}
                onChange={(event) => handleAfterMessagesChange(event.target.value)}
                className={`${inputClass} w-24 ${afterMessagesInvalid ? "border-red-500/50" : ""}`}
              />
              <span className="text-sm text-slate-300">messages (1–20)</span>
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <FieldLabel htmlFor="lead-form-title">Title</FieldLabel>
            <input
              id="lead-form-title"
              type="text"
              value={value.title}
              maxLength={80}
              onChange={(event) => update({ title: event.target.value })}
              className={inputClass}
            />
          </div>
          <div className="md:col-span-2">
            <FieldLabel htmlFor="lead-form-description">Description</FieldLabel>
            <textarea
              id="lead-form-description"
              value={value.description}
              maxLength={240}
              onChange={(event) => update({ description: event.target.value })}
              className="min-h-[88px] w-full rounded-2xl border border-white/10 bg-[#111111] px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-white"
            />
          </div>
          <div>
            <FieldLabel htmlFor="lead-form-submit">Submit button label</FieldLabel>
            <input
              id="lead-form-submit"
              type="text"
              value={value.submitLabel}
              maxLength={30}
              onChange={(event) => update({ submitLabel: event.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel htmlFor="lead-form-success">Success message</FieldLabel>
            <input
              id="lead-form-success"
              type="text"
              value={value.successMessage}
              maxLength={240}
              onChange={(event) => update({ successMessage: event.target.value })}
              className={inputClass}
            />
            <p className="mt-1.5 text-xs text-slate-500">
              {"{name}"} is replaced with the visitor&apos;s first name.
            </p>
          </div>
          <div className="md:col-span-2">
            <FieldLabel htmlFor="lead-form-consent">Marketing consent text</FieldLabel>
            <input
              id="lead-form-consent"
              type="text"
              value={value.consentText ?? ""}
              maxLength={160}
              onChange={(event) => update({ consentText: event.target.value })}
              placeholder="e.g. Send me offers and product updates"
              className={inputClass}
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Shown as an unticked checkbox. Leave empty to hide.
            </p>
          </div>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-[#111111] px-4 py-4">
          <div>
            <p className="text-sm font-semibold text-white">Allow visitors to skip</p>
            <p className="mt-1 text-sm text-slate-400">
              Shows a Skip button. The assistant carries on answering without the details.
            </p>
          </div>
          <SmallSwitch
            checked={value.allowSkip}
            onChange={(allowSkip) => update({ allowSkip })}
            label="Allow visitors to skip"
          />
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-white">Fields</p>
            <span className="text-xs text-slate-500">
              {value.fields.length}/{MAX_LEAD_FIELDS}
            </span>
          </div>

          {!hasContactField ? (
            <p className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              Add an Email or Phone field so your team can follow up. Without one, an
              Email field is added automatically when you save.
            </p>
          ) : null}

          {value.fields.length > 0 ? (
            <ul className="space-y-3">
              {value.fields.map((field, index) => (
                <FieldEditor
                  key={index}
                  field={field}
                  index={index}
                  count={value.fields.length}
                  otherKeys={value.fields.filter((_, itemIndex) => itemIndex !== index).map((item) => item.key)}
                  duplicateKey={(keyCounts[field.key] ?? 0) > 1}
                  onChange={(next) => updateField(index, next)}
                  onMove={(direction) => moveField(index, direction)}
                  onRemove={() => update({ fields: value.fields.filter((_, itemIndex) => itemIndex !== index) })}
                />
              ))}
            </ul>
          ) : (
            <p className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-500">
              No fields yet.
            </p>
          )}

          <div className="mt-3">
            <AddFieldMenu fields={value.fields} onAdd={(field) => update({ fields: [...value.fields, field] })} />
          </div>
        </div>

        <div>
          <p className="mb-3 text-sm font-medium text-white">Preview</p>
          <div className="rounded-[24px] bg-[linear-gradient(180deg,#0b0d13_0%,#090b10_100%)] p-5">
            <LeadFormPreview form={value} primaryColor={primaryColor} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Static rendering of the inline card the widget shows in the conversation. */
export function LeadFormPreview({ form, primaryColor }: { form: LeadFormConfig; primaryColor: string }) {
  const consentText = form.consentText?.trim();

  return (
    <div className="mx-auto w-full max-w-[340px] rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm" aria-label="Lead form preview">
      <p className="text-[15px] font-semibold text-slate-900">{form.title.trim() || "Can our team follow up with you?"}</p>
      {form.description.trim() ? (
        <p className="mt-1 text-sm leading-6 text-slate-500">{form.description}</p>
      ) : null}

      <div className="mt-4 space-y-3">
        {form.fields.map((field, index) => (
          <div key={`${index}-${field.key}`}>
            <p className="mb-1 text-xs font-medium text-slate-700">
              {field.label.trim() || `Field ${index + 1}`}
              {field.required ? <span className="text-red-500"> *</span> : null}
            </p>
            {field.type === "textarea" ? (
              <div className="h-16 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-400">
                {field.placeholder}
              </div>
            ) : field.type === "select" ? (
              <div className="flex h-9 items-center justify-between rounded-xl border border-slate-200 px-3 text-xs text-slate-400">
                <span className="truncate">{field.placeholder || field.options?.[0] || "Choose an option"}</span>
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </div>
            ) : (
              <div className="flex h-9 items-center rounded-xl border border-slate-200 px-3 text-xs text-slate-400">
                <span className="truncate">{field.placeholder}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {consentText ? (
        <div className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-600">
          <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border border-slate-300" />
          <span>{consentText}</span>
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        <span
          className="inline-flex h-9 flex-1 items-center justify-center rounded-xl text-sm font-semibold text-white"
          style={{ backgroundColor: primaryColor }}
        >
          {form.submitLabel.trim() || "Send"}
        </span>
        {form.allowSkip ? (
          <span className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-600">
            Skip
          </span>
        ) : null}
      </div>
    </div>
  );
}
