# Notebook Retry and Regeneration Implementation Plan

> **For Hermes:** Implement task-by-task with strict scope. Do not sweep unrelated WIP into commits.

**Goal:** Improve Notebook failure recovery and iteration by adding a real source indexing retry入口 first, then adding Studio artifact regeneration controls.

**Architecture:** Reuse the existing `FileService` embedding job worker rather than inventing a second queue. Notebook API verifies notebook/file ownership, resets embedding state for parsed files, creates a new `FileEmbeddingJob`, and returns the updated file state. Frontend source rows show a lightweight retry action only for actionable indexing states.

**Tech Stack:** Go + Gin + GORM backend, Next.js/React/TypeScript frontend, existing Notebook detail page and `FileService` embedding worker.

---

## Scope and sequencing

1. **Phase 1 — Source indexing retry:** implement backend `POST /notebooks/:id/files/:file_id/reindex`, frontend retry button, tests, build verification.
2. **Phase 2 — Studio regeneration:** add per-artifact “重新生成” using existing generation endpoint and artifact source ids. Do this only after Phase 1 is verified.
3. Do not modify Seedream, creative layout, unrelated locale WIP, or unrelated generated `frontend/out` files.

---

## Task 1: Backend reindex service seam

**Objective:** Add a reusable `FileService.RequeueEmbedding(fileID, userID)` method that safely retries indexing for an already parsed file.

**Files:**
- Modify: `backend/internal/services/file_service.go`
- Test: `backend/internal/api/notebook_test.go` or service-level test if an existing service test file exists.

**Behavior:**
- File must belong to `userID`.
- File must have `parse_status == "done"`.
- Delete old `file_embeddings` and old `file_embedding_jobs` for that file.
- Reset chunks for that file to `embedding_status=pending`.
- If no embedder is configured, set file `embedding_status=skipped` and return updated file.
- If no chunks exist, set file `embedding_status=skipped` and return updated file.
- Otherwise set file `embedding_status=pending` and create one `FileEmbeddingJob{Status:"pending"}`.

**Verification command:**

```bash
cd backend && go test ./internal/api -run Reindex
```

Expected: tests pass.

---

## Task 2: Backend Notebook reindex route

**Objective:** Add Notebook-scoped API route for retrying indexing from the source list.

**Files:**
- Modify: `backend/internal/api/router.go`
- Modify: `backend/internal/api/notebook.go`
- Test: `backend/internal/api/notebook_test.go`

**Route:**

```txt
POST /notebooks/:id/files/:file_id/reindex
```

**Handler rules:**
- Auth required through existing authorized router group.
- Verify the file is linked to the notebook and owned by current user.
- Call `h.fileService.RequeueEmbedding(fileID, userID)`.
- Return `NotebookFileItem` compatible JSON so frontend can replace that source row.

**Error responses:**
- `404`: notebook/file relation not found.
- `400`: file is not parsed yet or parse failed.
- `500`: database/job creation failure.

**Verification command:**

```bash
cd backend && go test ./internal/api
```

Expected: package passes.

---

## Task 3: Frontend API helper and source retry button

**Objective:** Show an actionable retry button on Notebook source rows when indexing failed/skipped, and call the new API.

**Files:**
- Modify: `frontend/lib/notebookApi.ts` or current Notebook API wrapper file.
- Modify: `frontend/app/(chat-shell)/notebooks/detail/page.tsx`
- Modify: `frontend/locales/en.ts`
- Modify: `frontend/locales/zh-CN.ts`
- Modify: `frontend/locales/zh-TW.ts` only if the same Notebook key section already exists there.

**UI rules:**
- Show retry only when `file.parse_status === "done"` and `embedding_status` is `error` or `skipped`.
- Button text:
  - `重新索引` for `error`
  - `开始索引` for `skipped`
- Button is disabled while the request is in flight.
- On success, replace the matching `NotebookFile` in state with response data.
- Do not block source preview/opening.

**Verification command:**

```bash
cd frontend && npx tsc --noEmit --pretty false
```

Expected: no type errors.

---

## Task 4: Full verification

**Objective:** Prove backend and frontend remain healthy.

**Commands:**

```bash
cd backend && go test ./internal/api
cd frontend && npx tsc --noEmit --pretty false
cd frontend && NEXT_PRIVATE_BUILD_WORKER=1 npm run build
```

Expected: all pass. Existing Tailwind ambiguity warnings may appear but must not be new fatal errors.

---

## Phase 2: Studio regeneration

Implemented scope:

1. Add “重新生成” action in Studio artifact menu.
2. Use artifact `type` and persisted `sourceFileIds` to call the existing generation endpoint.
3. Save the new artifact as a new version/list item instead of overwriting the old one.
4. Preserve old artifact for comparison.
5. Preserve type-specific options such as report format and infographic orientation/style/detail/prompt.

---

## Phase 3: Lightweight artifact grouping and versions

Implemented scope:

1. Group Studio outputs by artifact type in the frontend output list.
2. Keep newest artifacts first inside each type group.
3. Show derived version labels (`vN` ... `v1`) without changing backend schema.
4. Preserve all row actions, source popovers, viewer affordances, and regeneration behavior.

---

## Phase 4: Export enhancements

Next implementation scope:

1. Report artifacts:
   - Keep existing Markdown download.
   - Add a browser print/export action for PDF handoff (`window.print()` from a focused report view).
   - Do not add server PDF generation yet.
2. Data-table artifacts:
   - Keep existing CSV download.
   - Add “复制 Markdown 表格” action that copies the table as Markdown.
   - Preserve the source/citation column in export output.
3. Infographic artifacts:
   - Keep current PNG/HTML behavior; defer further work unless Phase 4 report/table actions are verified.

Verification commands:

```bash
cd backend && go test ./internal/services && go test ./internal/api
cd frontend && npx tsc --noEmit --pretty false
cd frontend && NEXT_PRIVATE_BUILD_WORKER=1 npm run build
```

---

## Phase 5: Citation-aware export quality

Next implementation scope:

1. Report Markdown export:
   - Preserve structured section/subsection citation markers when present.
   - Append a “Sources / 引用来源” block per cited section with file id, page, chunk index, and quote when available.
   - Keep old artifacts without structured citations exporting normally.
2. Data-table CSV and Markdown export:
   - Add a structured citation column separate from the display source text.
   - Include citation marker, file id, page, chunk index, and quote when present.
   - Preserve the existing source/display column.
3. Print/PDF export:
   - Keep current clean print view for now; do not overload it with raw metadata until visual design is reviewed.

Verification commands remain the same as Phase 4.
