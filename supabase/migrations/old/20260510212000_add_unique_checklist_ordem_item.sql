-- Required by /api/ordens/[id]/checklist upsert(onConflict: "ordemservicoid,item").
-- Keep the newest checklist row per OS/item and move existing inspection images to it
-- before enforcing uniqueness.

WITH duplicates AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY ordemservicoid, item
      ORDER BY createdat DESC NULLS LAST, id DESC
    ) AS keep_id
  FROM public.checklist
),
to_merge AS (
  SELECT id, keep_id
  FROM duplicates
  WHERE id <> keep_id
)
UPDATE public.imagemvistoria img
SET checklistid = to_merge.keep_id
FROM to_merge
WHERE img.checklistid = to_merge.id;

WITH duplicates AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY ordemservicoid, item
      ORDER BY createdat DESC NULLS LAST, id DESC
    ) AS keep_id
  FROM public.checklist
),
to_delete AS (
  SELECT id
  FROM duplicates
  WHERE id <> keep_id
)
DELETE FROM public.checklist c
USING to_delete
WHERE c.id = to_delete.id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'checklist_ordemservicoid_item_key'
      AND conrelid = 'public.checklist'::regclass
  ) THEN
    ALTER TABLE public.checklist
      ADD CONSTRAINT checklist_ordemservicoid_item_key UNIQUE (ordemservicoid, item);
  END IF;
END $$;
