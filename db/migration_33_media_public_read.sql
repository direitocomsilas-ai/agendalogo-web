-- Migration 33: leitura pública do bucket media para capas/fotos de produtos
DROP POLICY IF EXISTS "media public read" ON storage.objects;
CREATE POLICY "media public read" ON storage.objects FOR SELECT TO public USING (bucket_id = 'media');
