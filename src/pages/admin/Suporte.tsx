import React, { useCallback, useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Badge, Button, Card, Empty, Input, PageHeader, cx } from '../../components/ui';
import { fmtDateTime } from '../../lib/utils';

type Ticket = { id: string; company_id: string | null; subject: string; message: string; status: string; created_at: string; attachment_url: string | null };
type Reply = { id: string; body: string; is_admin: boolean; created_at: string };

export default function AdminSuporte() {
  const { session, toast } = useApp();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [open, setOpen] = useState<Ticket | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('support_tickets').select('*').order('created_at', { ascending: false });
    setTickets((data ?? []) as Ticket[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const openTicket = async (t: Ticket) => {
    setOpen(t);
    const { data } = await supabase.from('support_replies').select('*').eq('ticket_id', t.id).order('created_at');
    setReplies((data ?? []) as Reply[]);
  };

  const send = async () => {
    if (!reply.trim() || !open) return;
    setBusy(true);
    const { error } = await supabase.from('support_replies').insert({ ticket_id: open.id, user_id: session!.user.id, is_admin: true, body: reply });
    if (!error) {
      await supabase.from('support_tickets').update({ status: 'respondido' }).eq('id', open.id);
    }
    setBusy(false);
    if (error) { toast('error', 'Erro: ' + error.message); return; }
    setReply('');
    openTicket({ ...open, status: 'respondido' });
    load();
  };

  const resolve = async () => {
    if (!open) return;
    await supabase.from('support_tickets').update({ status: 'resolvido' }).eq('id', open.id);
    toast('success', 'Chamado resolvido.');
    setOpen(null);
    load();
  };

  return (
    <div className="fade-up">
      <PageHeader title="Suporte" subtitle="Chamados abertos pelos clientes" />

      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 space-y-2">
          {tickets.length === 0 ? (
            <Empty title="Nenhum chamado" />
          ) : (
            tickets.map((t) => (
              <button key={t.id} onClick={() => openTicket(t)} className="w-full text-left">
                <Card className={cx('p-4 hover:shadow-md transition', open?.id === t.id && 'ring-2 ring-brand-400')}>
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-ink text-sm truncate flex-1">{t.subject}</p>
                    <Badge className={cx(t.status === 'aberto' ? 'bg-amber-50 text-amber-700' : t.status === 'respondido' ? 'bg-blue-50 text-blue-700' : 'bg-brand-50 text-brand-700')}>{t.status}</Badge>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{fmtDateTime(t.created_at)}</p>
                </Card>
              </button>
            ))
          )}
        </div>
        <div className="lg:col-span-3">
          {open ? (
            <Card className="p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-extrabold text-ink">{open.subject}</h2>
                <Button size="sm" variant="secondary" onClick={resolve}>Marcar resolvido</Button>
              </div>
              <p className="text-sm text-sub mt-2">{open.message}</p>
              {open.attachment_url && <a href={open.attachment_url} target="_blank" rel="noreferrer" className="text-xs font-bold text-brand-600 underline mt-2 inline-block">Ver anexo</a>}
              <div className="mt-5 space-y-3 max-h-72 overflow-y-auto">
                {replies.map((r) => (
                  <div key={r.id} className={cx('rounded-2xl px-4 py-3 text-sm', r.is_admin ? 'bg-brand-50 text-brand-900 ml-8' : 'bg-slate-100 text-slate-700 mr-8')}>
                    <p>{r.body}</p>
                    <p className="text-[10px] font-bold text-slate-400 mt-1">{r.is_admin ? 'Equipe' : 'Cliente'} · {fmtDateTime(r.created_at)}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex gap-2">
                <Input placeholder="Responder ao cliente..." value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
                <Button loading={busy} onClick={send}><Send size={16} /></Button>
              </div>
            </Card>
          ) : (
            <Empty title="Selecione um chamado" />
          )}
        </div>
      </div>
    </div>
  );
}
