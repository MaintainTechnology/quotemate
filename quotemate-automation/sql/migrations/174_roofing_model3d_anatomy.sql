-- 174 — Roofing 3D model: roof-anatomy annotation overlays (auto mode).
--
-- On the automated flyover path, each enhanced capture also gets a Gemini
-- annotation pass drawing colour-coded roof lines (ridge/hip/valley/eave)
-- for visual identification — displayed to the tradie, NEVER fed to Tripo
-- (painted lines would bake into the 3D model's textures).
--
-- model3d_anatomy: jsonb map of view -> storage path in roof-models,
-- e.g. {"front": "roofing/<id>/anatomy-front.jpg"}. Best-effort; null when
-- annotation was skipped or failed.

alter table roofing_measurements
  add column if not exists model3d_anatomy jsonb;
