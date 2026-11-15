# AssistDesk: Non-Functional Requirements (NFR) Specification

**Project:** AssistDesk — AI-Native Omnichannel Customer Support & Ticketing Platform  
**Team:** Muhammad Awais (SP23-BSE-031) · Ahmad Mujtaba Shahid (SP23-BSE-003) · Supervisor: Amir Shabir Parre  
**Document version:** 1.1 · **Updated:** 15 Nov 2026  
**Companion documents:** [ROADMAP.md](ROADMAP.md) · [VERIFICATION_REPORT.md](VERIFICATION_REPORT.md) · [TESTING_INSTRUCTIONS.md](TESTING_INSTRUCTIONS.md)

---

## 1. Executive Summary & Quality Model

Non-Functional Requirements (NFRs) specify the operational criteria, behavioral quality, performance boundaries, and systemic constraints of AssistDesk. The requirement taxonomy follows ISO/IEC 25010 software product quality standards and the AssistDesk Software Requirements Specification (SRS).

### NFR Category Overview

| Category Prefix | Quality Dimension | Focus Area | Status |
|---|---|---|---|
| **REL** | Reliability & Fault Tolerance | High availability, recovery, LLM graceful degradation, backups | Active |
| **PER** | Backend Performance & Latency | p95 query times, context sync, indexing delays, vector search | Active |
| **LOD** *(New)* | **Loading Speed & Web Performance** | Core Web Vitals (FCP, LCP, CLS, INP), widget bundle footprint, asset caching | **Active (New)** |
| **SEO** *(New)* | **Search Engine Optimization & Discoverability** | Metadata, Open Graph, sitemaps, robots.txt, structured data, canonical URLs | **Active (New)** |
| **SEC** | Security & Privacy | RBAC, tenant isolation, encryption at rest, SSRF guards, rate limits | Active |
| **USE** | Usability & Human Factors | Time-to-deploy, inline validation, accessibility, actionable errors | Active |
| **CI / SI** | System & Communication Interfaces | Server-Sent Events, webhooks, omnichannel transports | Active |
| **CON** | Architectural & Tech Stack Constraints | Next.js 15, Prisma ORM, PostgreSQL, LangGraph, Pinecone | Active |

---

## 2. Category: Loading Speed & Web Performance (LOD)

This category defines client-side and edge performance requirements ensuring sub-second visual responsiveness, minimal host-site embed footprint, and compliance with Google Core Web Vitals thresholds.

### LOD Requirements Register

| ID | Requirement Name | Threshold / Metric | Implementation & Enforcement | Verification Method |
|---|---|---|---|---|
| **LOD-1** | **Core Web Vitals — FCP & LCP Budget** | • First Contentful Paint (FCP) **≤ 1.2 s**<br>• Largest Contentful Paint (LCP) **≤ 2.5 s** on 4G networks | Route-level streaming via React Server Components (RSC), Next.js App Router, pre-rendered marketing shell, font preloading via `next/font`. | Lighthouse CI audit & Chrome DevTools Performance profile. |
| **LOD-2** | **Lightweight Non-Blocking Widget Embed** | • Initial embed loader script **≤ 25 KB** (gzipped)<br>• Total widget JS footprint **≤ 75 KB** (gzipped)<br>• **Zero render-blocking** impact on host sites | Asynchronous execution via `async` / `defer` tag (`assistdesk-widget.js`), lazy-loaded chat modal iframe/shadow-dom on user interaction, isolated style scoping. | Bundle analyzer (`next/bundle-analyzer`) and Network transfer measurements. |
| **LOD-3** | **Time to First Byte (TTFB) & Edge Caching** | • Static marketing routes TTFB **≤ 200 ms**<br>• Dynamic SSR / authenticated dashboard TTFB **≤ 500 ms** | Static generation (`output: "standalone"` / ISR), pre-warmed connection pools in Prisma, database query index optimization (`workspaceId`, `sessionId`, `ticketId`). | HTTP benchmark using `curl -w "%{time_starttransfer}\n"` or Playwright network timings. |
| **LOD-4** | **Layout Stability (CLS) & Interaction Speed (INP)** | • Cumulative Layout Shift (CLS) **≤ 0.1**<br>• Interaction to Next Paint (INP) **≤ 200 ms** | Explicit aspect ratios on avatar and branding images, reserved dimension containers, CSS skeleton loaders during data fetch, debounced user inputs. | Automated Playwright layout shift metrics across viewport dimensions. |
| **LOD-5** | **Asset Optimization & Immutable Caching** | • Static assets compressed via **Brotli / Gzip**<br>• Hashed asset cache TTL **≥ 1 year** (`max-age=31536000, immutable`)<br>• Self-hosted web fonts | Next.js asset pipeline with automatic content-hashing, WebP/AVIF image formats, zero external CDN font blocking (`next/font/google`). | HTTP response header verification (`Cache-Control`, `Content-Encoding`). |
| **LOD-6** | **Code Splitting & Heavy Dependency Budgets** | • Main initial JS chunk **≤ 150 KB** (gzipped)<br>• Heavy libraries dynamically imported on demand | Lazy dynamic imports (`next/dynamic` / dynamic `import()`) for PDF parsing (`unpdf`), Word parsing (`mammoth`), and markdown rendering (`react-markdown`). | Build output analyzer (`npm run build` route size tables). |

---

## 3. Category: Search Engine Optimization & Discoverability (SEO)

This category defines search engine indexation, social sharing graph, crawl efficiency, and structured semantic data requirements for all public customer-facing routes.

### SEO Requirements Register

| ID | Requirement Name | Scope / Target | Technical Specification | Verification Method |
|---|---|---|---|---|
| **SEO-1** | **Dynamic Metadata & Social Graph Tags** | Public landing page, auth pages, and public docs | Comprehensive Next.js `Metadata` export implementing Open Graph (`og:title`, `og:description`, `og:image`, `og:type`) and Twitter Cards (`twitter:card`, `twitter:site`, `twitter:creator`). Title template format: `%s \| AssistDesk`. | OpenGraph validator, automated unit test inspecting rendered `<meta>` tags. |
| **SEO-2** | **Automated Search Engine Directives (`robots.txt`)** | All routes | Next.js dynamic `app/robots.ts` defining crawl rules: allow public pages (`/`, `/login`, `/signup`, `/verify-email`), strictly disallow private tenant paths (`/dashboard/*`, `/api/*`, `/setup/*`, `/widget/*`). Points directly to sitemap. | Direct HTTP GET `/robots.txt` verification and status code assertion (200 OK). |
| **SEO-3** | **Dynamic XML Sitemap Generation (`sitemap.xml`)** | Public routes | Next.js dynamic `app/sitemap.ts` generating standards-compliant XML sitemap with canonical URLs, change frequencies (`daily`, `weekly`), and priority rankings (`1.0` for landing, `0.8` for auth). | Direct HTTP GET `/sitemap.xml` validation against XML schema. |
| **SEO-4** | **Structured Data Markup (JSON-LD)** | Landing page and public documentation | Embedded `application/ld+json` schema for `SoftwareApplication`, `Organization`, and `FAQPage` rich snippets specifying category, description, and operating systems. | Google Rich Results Test & schema validator. |
| **SEO-5** | **Semantic HTML Hierarchy & Crawlability** | All pages | Strict HTML5 semantic structure: single primary `<h1>` per page, hierarchical `<h2>`–`<h6>`, landmark tags (`<header>`, `<main>`, `<nav>`, `<footer>`), descriptive anchor texts, and mandatory `alt` text on all images and brand graphics. | Axe accessibility / HTML validator scan in Playwright test suite. |
| **SEO-6** | **Canonical URLs & Redirection Consistency** | All public URLs | Strict canonical link tags (`<link rel="canonical" href="...">`), trailing slash normalization, HTTP to HTTPS enforcement, and permanent 301 redirects for legacy or aliased routes to prevent duplicate content penalties. | Automated integration test checking canonical URL headers and redirects. |

---

## 4. Existing NFR Categories (Baseline Reference)

For completeness and full cross-referencing with `VERIFICATION_REPORT.md` and the SRS:

### Reliability (REL)
- **REL-1:** 99.9% application uptime across standard monthly operating windows.
- **REL-2:** Daily automated PostgreSQL database snapshots retained for a minimum of 14 days.
- **REL-3:** Pinecone vector database high availability with graceful in-memory/Postgres hybrid fallback.
- **REL-4:** Upstream LLM provider failure, rate limit, or timeout detected and gracefully handled within ≤ 3.0 s.

### Performance & Latency (PER)
- **PER-1:** Voice pipeline round-trip latency under 500 ms (M3 / Voice scope).
- **PER-2:** Web application API p95 response time ≤ 2.0 s.
- **PER-3:** Omnichannel context synchronization across devices/channels ≤ 1.0 s (delivered via Server-Sent Events).
- **PER-4:** Knowledge base document indexing and vector ingestion initiates within ≤ 10.0 s of upload.

### Security & Privacy (SEC)
- **SEC-1:** Mandatory TLS 1.3 in production with Secure/HttpOnly/SameSite session cookies.
- **SEC-2:** Role-Based Access Control (RBAC) enforced on all mutating workspace actions (`OWNER`, `ADMIN`, `MANAGER`, `AGENT`).
- **SEC-3:** PCI-DSS compliance by delegating payment and card processing entirely to Stripe hosted elements.
- **SEC-4:** Strict multi-tenant isolation via mandatory workspace scoping on all database queries and vector namespaces.

### Usability (USE)
- **USE-1:** Rapid deployment: workspace onboarding and first assistant creation achievable in ≤ 5 minutes.
- **USE-2:** Inline validation feedback provided on form interactions within ≤ 500 ms.
- **USE-3:** Self-explanatory dashboard requiring zero technical onboarding for support agents.
- **USE-4:** Actionable, human-readable error messages for all failed API and user operations.

### Constraints & Interfaces (CI / CON)
- **CI-1:** Real-time bi-directional streaming using Server-Sent Events (SSE) and HTTP fallbacks.
- **CI-3:** Signed inbound webhook authentication for third-party integrations (Slack, WhatsApp, Stripe).
- **CON-1 to CON-4:** Core runtime architecture constrained to Next.js 15, Prisma ORM, PostgreSQL, and LangGraph.

---

## 5. Verification & Compliance Matrix

| Requirement ID | Target Criterion | Verification Suite / Tool | Current Status |
|---|---|---|---|
| **LOD-1** | FCP ≤ 1.2s, LCP ≤ 2.5s | Chrome DevTools / Lighthouse | ✅ Baseline met on desktop; monitored via production builds |
| **LOD-2** | Widget embed ≤ 25 KB gzip | `public/assistdesk-widget.js` bundle check | ✅ Embed script is ~5.4 KB raw (~1.8 KB gzipped) |
| **LOD-3** | TTFB ≤ 500 ms | Route timing tests & Next.js SSR benchmarks | ✅ Pre-warmed SQLite/Postgres connections |
| **LOD-4** | CLS ≤ 0.1, INP ≤ 200 ms | Playwright UI suite | ✅ Clean component skeletons and fixed layout dimensions |
| **LOD-5** | Immutable caching & Brotli | Next.js build pipeline | ✅ Handled by Next.js static asset optimizations |
| **LOD-6** | Dynamic chunk imports | Webpack/Turbopack chunk analysis | ✅ Dynamic imports utilized for mammoth/unpdf |
| **SEO-1** | OpenGraph & Twitter tags | `app/layout.tsx` metadata test | ✅ Configured with title template, description, and social tags |
| **SEO-2** | `robots.txt` directives | HTTP GET `/robots.txt` / `app/robots.ts` | ✅ Configured to permit marketing and block private dashboards |
| **SEO-3** | `sitemap.xml` dynamic index | HTTP GET `/sitemap.xml` / `app/sitemap.ts` | ✅ Configured for all public discovery routes |
| **SEO-4** | JSON-LD Structured Data | Google Rich Results / Playwright test | ✅ Configured with `SoftwareApplication` schema on landing page |
| **SEO-5** | Semantic HTML5 structure | Playwright accessibility test | ✅ Standard semantic landmark tags enforced |
| **SEO-6** | Canonical URLs & redirects | Integration tests & metadata headers | ✅ Canonical tags defined on root metadata |
