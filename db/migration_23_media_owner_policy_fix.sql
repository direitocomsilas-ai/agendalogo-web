-- MIGRATION 23 — Corrige políticas de upload do dono (name ambíguo)
-- Na migration 22, "name" dentro do EXISTS resolvia para companies.name
-- (nome da empresa) e não para o caminho do objeto; recria qualificado.
DROP POLICY IF EXISTS "media owner write" ON storage.objects;
DROP POLICY IF EXISTS "media owner delete" ON storage.objects;

CREATE POLICY "media owner write" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'media'
  AND (storage.foldername(storage.objects.name))[1] = 'company'
  AND EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.owner_id = auth.uid()
      AND c.id::text = (storage.foldername(storage.objects.name))[2]
  )
);

CREATE POLICY "media owner delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'media'
  AND (storage.foldername(storage.objects.name))[1] = 'company'
  AND EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.owner_id = auth.uid()
      AND c.id::text = (storage.foldername(storage.objects.name))[2]
  )
);
