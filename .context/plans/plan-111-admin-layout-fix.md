# Plan 111 — Admin Dashboard Layout Overflow Fix (USER TODO #1)

**Created:** 2026-04-19
**Status:** PENDING
**Review findings:** UX-5-01 (finding #5)
**Priority:** HIGH

---

## Problem

The admin dashboard layout overflows its container. When content exceeds the viewport, the entire page scrolls (including the header), making navigation inconvenient. The image list uses a fixed `max-h-[600px]` that doesn't adapt to screen height.

## Files to Modify

1. `apps/web/src/app/[locale]/admin/layout.tsx` — Fix layout containment
2. `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx` — Responsive image list height

## Implementation Steps

### Step 1: Fix admin layout containment

Change the outer div from `min-h-screen` to `h-screen overflow-hidden`, and add `overflow-auto` to the main content area:

```tsx
// Before:
<div className="flex flex-col min-h-screen">
    <AdminHeader />
    <main id="admin-content" className="flex-1 w-full py-6 px-4">

// After:
<div className="flex flex-col h-screen overflow-hidden">
    <AdminHeader />
    <main id="admin-content" className="flex-1 w-full py-6 px-4 overflow-auto">
```

### Step 2: Fix dashboard image list height

Change from fixed `max-h-[600px]` to responsive `max-h-[calc(100vh-16rem)]`:

```tsx
// Before:
<div className="max-h-[600px] overflow-auto">

// After:
<div className="max-h-[calc(100vh-16rem)] overflow-auto">
```

## Verification

- Admin dashboard should show header always visible while content scrolls independently
- Image list should adapt to screen height on both small and large screens
- Navigation links should remain accessible at all times
- No horizontal overflow on any admin page
