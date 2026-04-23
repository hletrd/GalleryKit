# Verifier Review

I reviewed the repository inventory and the requested top-level docs/manifests, then inspected the relevant application codepaths, tests, and cross-file interactions in `apps/web`. I also verified the current implementation with:

- `npm test --workspace=apps/web` ✅
- `npm run lint --workspace=apps/web` ✅
- `npm run build --workspace=apps/web` ✅

## Findings

### 1) Upload UI collapses distinct files that share the same metadata-derived ID
- **File / region:** `apps/web/src/components/upload-dropzone.tsx:39-40, 47-71, 116-129, 200-209, 281-345`
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed logic defect (conditional failure when two distinct `File` objects share the same name/size/mtime)

**Why this is a problem**
The component uses `getFileId(file) => `${file.name}-${file.size}-${file.lastModified}`` as the identity for:
- preview object URLs (`previewUrlsRef` Map keys)
- per-file tag state (`perFileTags` object keys)
- React list keys (`<Card key={fileId}>`)
- tag lookup during upload (`perFileTagsRef.current[fileId]`)
- removal cleanup (`delete newTags[id]`)

That identifier is not actually unique for distinct files. Two separate files with the same filename, size, and last-modified timestamp will be treated as the same upload item.

**Concrete failure scenario**
A user drags in two copies of the same photo, or two different files that happen to share those metadata fields. The UI will:
- reuse one preview URL for both cards,
- merge or overwrite per-file tags,
- render duplicate React keys, causing unstable card updates,
- and remove the wrong tag state when either card is deleted.
During upload, both files will be serialized with the same per-file tag bucket, so one file can inherit the other file’s intended tags.

**Suggested fix**
Assign a true per-item ID when files are accepted into component state instead of deriving identity from file metadata. For example:
- store `{ id: crypto.randomUUID(), file }` items in state, or
- keep a `WeakMap<File, string>`/side table that generates a stable unique ID per `File` instance on drop.
Then use that generated ID consistently for preview URLs, React keys, per-file tags, and removal logic.

---

## Missed-issues sweep

I rechecked the rest of the inspected repository surface after the main review, including the app actions, storage/process pipeline, public routes, and the test coverage around auth, validation, data access, lightbox behavior, pagination, and EXIF parsing. I did not find additional correctness defects with the same level of evidence. The main residual risk is that some UI-only paths outside the inspected file set may still lack explicit regression tests, but no further concrete breakage was confirmed.
