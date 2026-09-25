-- MIGRATION 22 — Dono de empresa pode subir foto de perfil no bucket media
-- Caminho reservado: media/company/<company_id>/...
CREATE POLICY "media owner write" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'media'
  AND (storage.foldername(name))[1] = 'company'
  AND EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.owner_id = auth.uid()
      AND (storage.foldername(name))[2] = c.id::text
  )
);

CREATE POLICY "media owner delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'media'
  AND (storage.foldername(name))[1] = 'company'
  AND EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.owner_id = auth.uid()
      AND (storage.foldername(name))[2] = c.id::text
  )
);
