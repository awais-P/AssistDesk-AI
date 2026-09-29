"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  channelBadgeClass,
  channelLabels,
  contactDisplayName,
  labelFrom,
} from "@/src/lib/contact-labels";
import type { ContactListItem } from "@/src/lib/contact-list";
import { RelativeTime } from "./notifications-bell";

type ContactsWorkspaceProps = {
  initialContacts: ContactListItem[];
  initialTotal: number;
};

const SEARCH_DELAY_MS = 300;
const channelOrder = ["WEB_WIDGET", "WHATSAPP", "SLACK", "EMAIL", "VOICE"];

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}

/** Channels the customer has used, plus the ones we can recognise them on. */
function contactChannels(contact: ContactListItem) {
  const channels = new Set(contact.channels);

  if (contact.identifiers.webVisitor) channels.add("WEB_WIDGET");
  if (contact.identifiers.whatsapp) channels.add("WHATSAPP");
  if (contact.identifiers.slack) channels.add("SLACK");
  if (contact.email) channels.add("EMAIL");

  return channelOrder.filter((channel) => channels.has(channel));
}

export function ContactsWorkspace({ initialContacts, initialTotal }: ContactsWorkspaceProps) {
  const [contacts, setContacts] = useState(initialContacts);
  const [total, setTotal] = useState(initialTotal);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  // The query whose results are on screen (the server rendered the empty search).
  const lastQuery = useRef("");

  // Debounced live search.
  useEffect(() => {
    const query = search.trim();

    if (query === lastQuery.current) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      setError("");

      try {
        const params = new URLSearchParams({ take: "100" });

        if (query) {
          params.set("q", query);
        }

        const response = await fetch(`/api/contacts?${params.toString()}`, {
          signal: controller.signal,
        });
        const data = await readJson<{
          error?: string;
          total?: number;
          contacts?: ContactListItem[];
        }>(response);

        if (!response.ok) {
          setError(data.error ?? "Unable to load customers right now.");
          return;
        }

        lastQuery.current = query;
        setContacts(data.contacts ?? []);
        setTotal(data.total ?? 0);
      } catch (fetchError) {
        if ((fetchError as Error).name !== "AbortError") {
          setError("Something went wrong while searching customers.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, SEARCH_DELAY_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
      setIsLoading(false);
    };
  }, [search]);

  const hasQuery = Boolean(search.trim());

  return (
    <div className="px-5 py-4 md:px-6">
      <div>
        <h1 className="heading-font text-[2rem] font-bold leading-none text-white">
          Contacts
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-400">
          Customers are recognised across Website, WhatsApp, Slack and Email; AssistDesk keeps
          one memory per customer, so a conversation can continue on any channel and the
          assistant remembers what was said before.
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-2">
        <label htmlFor="contacts-search" className="text-sm font-medium text-white">
          Search
        </label>
        <div className="inline-flex h-11 w-full max-w-xl items-center rounded-lg border border-white/10 bg-[#111111] px-3">
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 shrink-0 text-slate-400"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3-3" />
          </svg>
          <input
            id="contacts-search"
            type="search"
            value={search}
            maxLength={120}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, email or phone number"
            className="ml-3 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
          />
          {isLoading ? (
            <span role="status" className="ml-3 text-xs text-slate-500">
              Searching...
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </p>
      ) : null}

      <p className="mt-5 text-sm text-slate-400" aria-live="polite">
        {total === 1 ? "1 customer" : `${total.toLocaleString("en-US")} customers`}
        {hasQuery ? " match your search" : ""}
        {contacts.length < total ? ` · showing the ${contacts.length} most recent` : ""}
      </p>

      <div
        aria-busy={isLoading}
        className={`mt-3 rounded-[22px] border border-white/10 bg-[#0a0a0a] transition-opacity ${
          isLoading ? "opacity-60" : ""
        }`}
      >
        {contacts.length === 0 ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center px-6 py-16 text-center">
            <svg
              viewBox="0 0 24 24"
              className="h-10 w-10 text-slate-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <rect x="4" y="3.5" width="16" height="17" rx="2" />
              <circle cx="12" cy="10" r="2.75" />
              <path d="M7.5 17a4.5 4.5 0 0 1 9 0" />
            </svg>
            <p className="mt-4 text-xl text-slate-300">
              {hasQuery ? "No customers match this search" : "No customers yet"}
            </p>
            <p className="mt-2 max-w-md text-sm text-slate-500">
              {hasQuery
                ? "Try a different name, email address or phone number."
                : "Customers appear here as soon as they chat on your website, message you on WhatsApp or Slack, or email your inbox."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white">
                  <th scope="col" className="px-4 py-5 font-semibold">Customer</th>
                  <th scope="col" className="px-4 py-5 font-semibold">Email</th>
                  <th scope="col" className="px-4 py-5 font-semibold">Phone</th>
                  <th scope="col" className="px-4 py-5 font-semibold">Channels</th>
                  <th scope="col" className="px-4 py-5 text-right font-semibold">Conversations</th>
                  <th scope="col" className="px-4 py-5 text-right font-semibold">Tickets</th>
                  <th scope="col" className="px-4 py-5 font-semibold">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => {
                  const displayName = contactDisplayName(contact);

                  return (
                    <tr
                      key={contact.id}
                      className="relative border-b border-white/10 text-white transition last:border-b-0 hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-4">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <Link
                            href={`/dashboard/contacts/${contact.id}`}
                            className={`font-semibold after:absolute after:inset-0 after:content-[''] focus-visible:underline ${
                              contact.name || contact.email || contact.phone
                                ? "text-white"
                                : "italic text-slate-300"
                            }`}
                          >
                            {displayName}
                          </Link>
                          {contact.openSessions > 0 ? (
                            <span className="inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">
                              {contact.openSessions} open
                            </span>
                          ) : null}
                          {contact.hasMemory ? (
                            <span
                              title="The assistant has a memory profile for this customer"
                              className="inline-flex rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-semibold text-violet-200"
                            >
                              Memory
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="max-w-[240px] truncate px-4 py-4 text-slate-300">
                        {contact.email ?? <span className="text-slate-500">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-300">
                        {contact.phone ?? <span className="text-slate-500">—</span>}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {contactChannels(contact).map((channel) => (
                            <span key={channel} className={channelBadgeClass(channel)}>
                              {labelFrom(channelLabels, channel)}
                            </span>
                          ))}
                          {contactChannels(contact).length === 0 ? (
                            <span className="text-slate-500">—</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums">
                        {contact.sessionCount}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums">
                        {contact.ticketCount}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-300">
                        <RelativeTime value={contact.lastSeenAt} />
                        {contact.lastChannel ? (
                          <span className="text-slate-500">
                            {" "}
                            · {labelFrom(channelLabels, contact.lastChannel)}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
