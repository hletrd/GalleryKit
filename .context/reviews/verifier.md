# Verifier — Cycle 9

## Verification of Prior Cycle Fixes

### C8-MED-01: `pruneUploadTracker` collect-then-delete pattern
**File**: `apps/web/src/lib/upload-tracker-state.ts:24-53`
**Status**: VERIFIED. Both the expired-key pruning and hard-cap eviction now use collect-then-delete arrays.

### C8-MED-02: GROUP BY maintenance comment above searchFields
**File**: `apps/web/src/lib/data.ts:1055-1060`
**Status**: VERIFIED. Comment is present and references both GROUP BY clauses.

### C8-MED-03: `navigate` callback currentImageId verification guard
**File**: `apps/web/src/components/photo-viewer.tsx:148`
**Status**: VERIFIED. Guard `if (images[currentIndex]?.id !== currentImageId) return;` is present.

### C7-MED-01: BoundedMap.prune() collect-then-delete
**File**: `apps/web/src/lib/bounded-map.ts:97-128`
**Status**: VERIFIED. Both expired-key and hard-cap eviction use collect-then-delete.

### C7-HIGH-01: Admin-delete advisory lock scoped to target user ID
**File**: `apps/web/src/app/actions/admin-users.ts:209`
**Status**: VERIFIED. Lock name includes `:${id}`.

### C5F-01: Photo navigation at dated/undated boundary
**File**: `apps/web/src/lib/data.ts:754-801`
**Status**: VERIFIED. Both dated and undated branches include `isNotNull(capture_date)` guards.

## New Findings

### C9-VF-01 (Medium): `viewCountRetryCount` hard-cap eviction uses iteration-during-deletion
**File+line**: `apps/web/src/lib/data.ts:155-159`
Same issue as C9-CR-01. Inconsistent with project's collect-then-delete convention.

### C9-VF-02 (Low): `pruneRetryMaps` iteration-during-deletion
**File+line**: `apps/web/src/lib/image-queue.ts:84-95`
Same pattern inconsistency.
