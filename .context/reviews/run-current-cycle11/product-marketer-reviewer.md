# Cycle 11 Product Marketer Reviewer

Date: 2026-07-18 KST  
Reviewed HEAD: `7e40e95c`  
Lane: product-marketer-reviewer

## Inventory and coverage

Reviewed the complete tracked inventory through the product lens, with direct coverage of public routes/navigation, search/discovery, about/privacy content, EN/KO messages, site/SEO config, OG/feed/sitemap surfaces, share pages, mobile/desktop presentation, photographer-fidelity positioning, operator-enabled feature caveats, current plans/reviews, and live deployed behavior. Cross-checked claims against current source rather than historical marketing/review prose.

## PMR-C11-01 — Search discovery spends resources on destinations the visitor did not choose

- Severity: **Medium**
- Confidence: **High**
- Validation: **Confirmed live behavior**
- Regions: `apps/web/src/components/search.tsx:77-85`; result UX `apps/web/src/components/search.tsx:498-513`; current search E2E `apps/web/e2e/public.spec.ts:21-69`.

Search is a core discovery surface for a photography gallery. One ordinary query displayed 20 results but also initiated 16 detail-page RSC fetches for 10 unique photos, including duplicates, without any visitor selection. That hidden cost works against the product's high-performance/self-hosted positioning, especially for photographers serving from a small single-writer host and visitors on mobile data.

Concrete failure: a prospective user evaluates a large gallery, refines several searches, and experiences slower thumbnails or server response while GalleryKit renders unused photo pages in the background. The product looks less efficient at exactly the moment it should demonstrate fast discovery.

Fix: disable automatic prefetch on result rows and, if desired, prefetch only the explicitly active/hovered result. Product copy need not explain this implementation detail; the experience should simply avoid the cost.

## Final missed-issue sweep

Public positioning remains honest about self-hosting, semantic-search activation, local-only storage, smart-collection authoring limitations, HDR delivery, and the finished-photo boundary. EN/KO navigation, privacy, SEO/OG/feed identity, share discovery, and configurable Timeline/Map visibility produced no fresh message/feature mismatch. Prior template-branding and distribution concerns were not repeated because their exit criteria remain unmet.
