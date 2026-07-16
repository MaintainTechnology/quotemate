-- 173 — Roofing interactive 3D model (Track B: visual only).
--
-- Cache columns for the tradie-initiated "Generate 3D model" feature on
-- /m/[token]: four Cesium captures of the Google Photorealistic 3D view are
-- enhanced (Gemini nano-banana) and reconstructed into a GLB by Tripo3D.
-- The GLB is re-hosted in the intake-photos bucket (Tripo output URLs expire
-- after 5 minutes) and served via a signed URL.
--
-- Purely additive; the 3D model never feeds measurements or pricing —
-- ridge/hip/valley numbers stay on the measured-geometry path (Track A).

alter table roofing_measurements
  add column if not exists model3d_status   text,   -- null | generating | ready | failed
  add column if not exists model3d_task_id  text,   -- Tripo task id while generating
  add column if not exists model3d_glb_path text,   -- storage path in intake-photos
  add column if not exists model3d_error    text;   -- last failure, for the tradie UI
