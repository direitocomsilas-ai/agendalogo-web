import React, { useRef, useState } from 'react';
import { Upload, X, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, cx } from './ui';

type Props = {
  value: string | null;
  onChange: (url: string | null) => void;
  folder: string;
  className?: string;
  aspect?: 'square' | 'wide' | 'auto';
  placeholder?: string;
};

export function ImageUpload({ value, onChange, folder, className, aspect = 'auto', placeholder = 'Clique para enviar imagem' }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setUploading(true);
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: upErr } = await supabase.storage.from('media').upload(path, file, { contentType: file.type });
    if (upErr) {
      setUploading(false);
      // eslint-disable-next-line no-console
      console.error('upload error:', upErr.message);
      return;
    }
    const { data: pub } = supabase.storage.from('media').getPublicUrl(path);
    setUploading(false);
    onChange(pub.publicUrl);
  };

  const boxCls = cx(
    'relative rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-center overflow-hidden transition hover:border-brand-300 hover:bg-brand-50/30',
    aspect === 'square' ? 'w-full aspect-square' : aspect === 'wide' ? 'w-full h-40' : 'w-full min-h-[120px] py-6',
    className,
  );

  return (
    <div className={boxCls}>
      {value ? (
        <>
          <img src={value} alt="Preview" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition" />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute top-2 right-2 p-1.5 rounded-full bg-white/90 text-rose-500 shadow-sm hover:bg-white"
          >
            <X size={14} />
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={() => ref.current?.click()}
          className="flex flex-col items-center justify-center gap-2 text-slate-400 w-full h-full px-4"
        >
          {uploading ? <Loader2 size={22} className="animate-spin text-brand-500" /> : <Upload size={22} />}
          <span className="text-xs font-semibold">{uploading ? 'Enviando...' : placeholder}</span>
        </button>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
      />
      {value && <Button type="button" size="sm" variant="secondary" className="absolute bottom-2 right-2" onClick={() => ref.current?.click()}>{uploading ? <Loader2 size={14} className="animate-spin" /> : 'Trocar'}</Button>}
    </div>
  );
}
