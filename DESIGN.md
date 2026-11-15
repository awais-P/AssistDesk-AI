# AssistDesk: Design System & Complete UI/UX Revamp Specification

**Project:** AssistDesk — AI-Native Omnichannel Customer Support & Ticketing Platform  
**Document Version:** 1.0 · **Date:** 15 Nov 2026  
**Companion Documents:** [ROADMAP.md](ROADMAP.md) · [NON_FUNCTIONAL_REQUIREMENTS.md](NON_FUNCTIONAL_REQUIREMENTS.md) · [VERIFICATION_REPORT.md](VERIFICATION_REPORT.md)

---

## 1. Executive Summary & Design Vision

AssistDesk is evolving into a high-density, enterprise-grade AI customer support platform. The objective of this design revamp is to replace fragmented styling with a cohesive, sleek, dark-mode first design system that maximizes agent productivity, minimizes visual noise, and delivers sub-second perceptual responsiveness.

### Core Design Principles
1. **AI-Native Clarity:** AI actions, tool executions, confidence scores, and automated responses must be immediately visually distinguishable from human actions.
2. **High Information Density with Zero Clutter:** Clean typography, consistent hierarchy, and standardized compact layouts allow support agents to process tickets and chats without endless scrolling.
3. **Instant Perceptual Speed:** 0ms optimistic tab highlights, subtle skeleton loaders, and smooth 150ms micro-interactions ensure the interface feels instantaneous.
4. **Accessible Dark Aesthetics:** True black and deep obsidian surfaces with high-contrast text (WCAG 2.1 AA compliant ≥ 4.5:1), subtle translucent borders, and focused ambient glowing accents.

---

## 2. Foundational Design Tokens

### 2.1 Color Palette

#### Neutral / Surface Hierarchy
| Token Name | Hex Code | Purpose / Usage |
|---|---|---|
| `bg-canvas` | `#020202` | Root page background, deep viewport canvas |
| `surface-base` | `#080808` | Primary container background (cards, sidebars, tables) |
| `surface-elevated` | `#111111` | Secondary elevated surface (dropdowns, tooltips, modals) |
| `surface-overlay` | `#181818` | Hover states, active row selections, active tabs |
| `border-subtle` | `rgba(255, 255, 255, 0.08)` | Standard card, divider, and table row borders |
| `border-medium` | `rgba(255, 255, 255, 0.16)` | Input borders, hover borders, active card outlines |
| `border-focus` | `rgba(255, 255, 255, 0.35)` | Keyboard focus rings (`focus-visible:ring-2`) |

#### Text & Typography Colors
| Token Name | Hex Code | Contrast on `#080808` | Usage |
|---|---|---|---|
| `text-primary` | `#F8FAFC` | 17.5:1 (AAA) | Page headings, primary values, active ticket titles |
| `text-secondary` | `#94A3B8` | 7.8:1 (AAA) | Subheadings, table headers, descriptions |
| `text-muted` | `#64748B` | 4.6:1 (AA) | Timestamps, metadata labels, placeholder text |
| `text-disabled` | `#475569` | 3.2:1 | Disabled button labels, inactive toggles |

#### Semantic Status & Accent Colors
| Category | Token | Value | Applied To |
|---|---|---|---|
| **Primary Accent** | `brand-accent` | `#3B82F6` | Primary action buttons, active navigation markers |
| **Success / Live** | `status-success` | `#10B981` | Online agents, SYNCED documents, resolved tickets |
| **Warning / Pending** | `status-warning` | `#F59E0B` | PENDING documents, awaiting customer reply, SLA warning |
| **Danger / Escalated** | `status-danger` | `#EF4444` | ESCALATED chats, URGENT tickets, failed API calls |
| **Info / Bot** | `status-info` | `#8B5CF6` | AI agent badges, automated logs, tool executions |

---

### 2.2 Typography System

* **Primary Font Family:** System Modern UI Stack (`Inter`, `Segoe UI`, `-apple-system`, `BlinkMacSystemFont`, `sans-serif`)
* **Monospace Stack:** `JetBrains Mono`, `Consolas`, `Courier New`, `monospace` (used for IDs, tokens, JSON metadata, code)

| Level | Size | Weight | Line Height | Letter Spacing | Usage |
|---|---|---|---|---|---|
| **Display** | 28px (`1.75rem`) | 700 (Bold) | 36px | `-0.025em` | Page Titles (e.g. Overview, AI Agents) |
| **Heading 1** | 20px (`1.25rem`) | 600 (Semibold) | 28px | `-0.015em` | Modal titles, section headers |
| **Heading 2** | 16px (`1.0rem`) | 600 (Semibold) | 24px | `-0.01em` | Card titles, drawer headers |
| **Body Standard** | 14px (`0.875rem`) | 400 (Regular) | 20px | `0` | Primary table cells, chat message text |
| **Body Medium** | 14px (`0.875rem`) | 500 (Medium) | 20px | `0` | Button labels, navigation links, form labels |
| **Small / Meta** | 12px (`0.75rem`) | 400 / 500 | 16px | `+0.01em` | Timestamps, badge tags, SLA timers |
| **Micro / Code** | 11px (`0.6875rem`) | 600 / Mono | 14px | `+0.02em` | Ticket numbers (`#1042`), pill chips |

---

### 2.3 Radiuses, Shadows & Elevation

* **Subtle Radius (`rounded-lg`):** `8px` — Inner input elements, buttons, tag pills, dropdown items.
* **Standard Card Radius (`rounded-xl`):** `12px` — Modular dashboard cards, table containers, popovers.
* **Large Modal Radius (`rounded-2xl`):** `16px` — Slide-over drawers, modals, onboarding wizard containers.
* **Elevation & Glows:**
  * Base Card: `box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05)`
  * Floating Modal: `box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.8), 0 8px 10px -6px rgba(0, 0, 0, 0.8)`
  * Active Glowing Accent: `box-shadow: 0 0 15px -3px rgba(59, 130, 246, 0.3)`

---

## 3. Core Layout & Shell Architecture

### 3.1 Unified App Shell Layout

```
+------------------------------------------------------------------------------------+
|  [Logo] AssistDesk   | Workspace: [Acme Corp v] | Search [Ctrl+K] | [Bell] [Avatar]|
+------------------------------------------------------------------------------------+
| SIDEBAR (240px)      | MAIN CONTENT VIEWPORT (flex-1, p-6 to p-8)                  |
|                      |                                                             |
| - Overview           | Breadcrumb: Dashboard > Tickets                             |
| - Omnichannel Chats  | Page Title & Action Bar: [Filters] [Search] [+ New Ticket]  |
| - Tickets (Queue)    +-------------------------------------------------------------+
| - AI Agents Studio   |                                                             |
| - Chatbots           | DATA GRID / WORKSPACE CONTENT                               |
| - Knowledge Base     |                                                             |
| - Leads & CRM        |                                                             |
| - Analytics & Reports|                                                             |
|                      |                                                             |
| [Settings] [Profile] |                                                             |
+------------------------------------------------------------------------------------+
```

#### Shell Specifications:
1. **Collapsible High-Density Sidebar:**
   * Default width: `240px`; collapsed width: `64px` (icon-only mode with instant tooltip hovers).
   * Active tab styling: Left border accent line (`h-4 w-1 bg-blue-500 rounded-r`), high-contrast text, subtle glowing background (`bg-white/5`).
   * Dynamic Badge Counters: Real-time counter pills for active incoming chats and open escalated tickets.
2. **Universal Top Bar:**
   * Global search trigger (`⌘K` / `Ctrl+K` Command Palette).
   * Workspace switcher dropdown with active organization badge.
   * Notifications drawer with animated unread indicator.
   * Agent online status toggle (`Online` / `Busy` / `Away`).

---

## 4. Key Workspaces Revamp Specification

### 4.1 Tickets Workspace (`/dashboard/tickets`)
* **Toolbar:** Search bar with instant debounced input, multi-select filters (Status, Priority, Assignee, Channel Inbox, Tags), and view presets (`My Tickets`, `Unassigned`, `Escalated`).
* **Table Design:**
  * Checkbox column for batch operations (Assign, Resolve, Change Priority).
  * Column headers with sort arrows and column width resizing.
  * Status chips with distinct icon prefixes:
    * `OPEN`: Solid amber dot with subtle badge background.
    * `IN_PROGRESS`: Blue pulsing dot.
    * `RESOLVED`: Emerald checkmark badge.
    * `CLOSED`: Muted slate badge.
  * Preview drawer: Hover or click expands a side-drawer showing ticket thread without leaving the table.

### 4.2 3-Pane Omnichannel Live Chats (`/dashboard/chats`)
* **Pane 1 — Active Queue (300px):** Filter by channel (`Web`, `Email`, `WhatsApp`, `Slack`), search customer name, shows last message preview and unread count.
* **Pane 2 — Active Thread (flex-1):**
  * Message bubbles: Human customer (left, dark gray), AI assistant (right, subtle purple border with bot badge), human agent (right, blue accent).
  * Collapsible AI reasoning steps / tool call logs inside AI messages.
  * Rich message composer: Canned responses auto-complete (`/macro`), internal agent private notes toggle, file attachments, and one-click "Takeover from AI" button.
* **Pane 3 — Customer 360 Context Drawer (320px):**
  * Customer contact card, known emails, phone numbers, channel links.
  * Unified Cross-Channel Memory Buffer (AI auto-summarized customer facts).
  * Past tickets & past chat history accordion.

### 4.3 AI Agents Studio (`/dashboard/ai-agents`)
* **Agent Cards Overview:**
  * Grid layout (3 columns on desktop, 2 on tablet, 1 on mobile).
  * Card header with provider icon (`OpenAI`, `Groq`, `Anthropic`), model name, and toggle switch (`Active` / `Draft`).
  * Real-time metrics bar: Total automated replies, token spend, average latency ms, fallback rate.
* **Agent Editor (`/dashboard/ai-agents/[id]`):**
  * Split-screen layout: Configuration panels on left (System prompt editor with syntax highlighting, temperature & token sliders, tool assignment switches), live interactive testing simulator on right.

### 4.4 Analytics & Intelligence (`/dashboard/analytics`)
* **KPI Metric Cards:** 4-column top row with current metric, trend arrow (`+14.2% vs last 7d`), and micro sparkline graph.
* **Visualizations:** Clean dark-mode line charts and stacked bar charts for conversation volume, response latency distribution, and sentiment scores.

---

## 5. UI Micro-Interactions & Form Controls

1. **Button States:**
   * Primary: Solid white or brand blue with dark text (`bg-white text-black hover:bg-slate-200 active:scale-[0.98]`).
   * Secondary: Obsidian border with white text (`bg-white/5 border border-white/10 hover:bg-white/10`).
   * Danger: Subtle red surface (`bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20`).
2. **Form Inputs & Textareas:**
   * High-contrast border (`border-white/10 focus:border-blue-500 focus:ring-1 focus:ring-blue-500`).
   * Clear error message helper with red status icon.
   * Autofill style normalization: strict `-webkit-autofill` dark background overrides.
3. **Skeleton Loaders:**
   * Shimmer animation matching the exact geometry of the resolved cards and tables, preventing any layout shift (CLS ≤ 0.05).

---

## 6. Implementation & Revamp Roadmap

| Phase | Milestone | Primary Deliverables | Target Scope |
|---|---|---|---|
| **Phase 1** | **Design System Tokens & Foundation** | Color variables, typography tokens in `globals.css`, button/input/badge primitives in `@/src/components/ui/` | Global foundation |
| **Phase 2** | **App Shell & Universal Navigation** | Collapsible sidebar, unified top bar with workspace switcher and breadcrumbs, command palette | Navigation & layout |
| **Phase 3** | **Tickets & Data Tables Revamp** | High-density tables, multi-filter toolbar, slide-out ticket detail view | Core support queue |
| **Phase 4** | **3-Pane Live Chat & Customer 360** | Queue column, conversational transcript with AI tool chips, customer context drawer | Omnichannel chat |
| **Phase 5** | **AI Studio & Analytics Polish** | Split-screen agent editor, interactive sandbox test drawer, KPI sparkline cards | Automation & metrics |
| **Phase 6** | **Auth & Public Landing Modernization** | Updated login/signup/reset forms, landing page hero, and dark theme consistency | Customer-facing routes |
