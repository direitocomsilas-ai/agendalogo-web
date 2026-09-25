import React, { useCallback, useEffect, useState } from 'react';
import { Plus, MessageSquare } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Textarea, cx } from '../../components/ui';
import { fmtDateTime } from '../../lib/utils';

type Ticket = { id: string; subject: string; message: string; status: string; created_at: string; attachment_url: string | null };
type Reply = { id: string; body: string; is_admin: boolean; created_at: string };

export default function Suporte() {
  const { company, session, toast } = useApp();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [open, setOpen] = useState<Ticket | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ subject: '', message: '', attachment_url: '' });
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!company) return;
    const { data } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('company_id', company.id)
      .order('created_at', { ascending: false });
    setTickets((data ?? []) as Ticket[]);
  }, [company]);
  useEffect(() => { load(); }, [load]);

  const openTicket = async (t: Ticket) => {
    setOpen(t);
    const { data } = await supabase.from('support_replies').select('*').eq('ticket_id', t.id).order('created_at');
    setReplies((data ?? []) as Reply[]);
  };

  const createTicket = async () => {
    if (!form.subject.trim()) { toast('error', 'Informe o assunto.'); return; }
    setBusy(true);
    const { error } = await supabase.from('support_tickets').insert({
      company_id: company!.id,
      user_id: session!.user.id,
      subject: form.subject,
      message: form.message,
      attachment_url: form.attachment_url || null,
    });
    setBusy(false);
    if (error) { toast('error', 'Erro: ' + error.message); return; }
    toast('success', 'Chamado criado! Responderemos em breve.');
    setModal(false);
    setForm({ subject: '', message: '', attachment_url: '' });
    load();
  };

  const sendReply = async () => {
    if (!reply.trim() || !open) return;
    setBusy(true);
    const { error } = await supabase.from('support_replies').insert({ ticket_id: open.id, user_id: session!.user.id, body: reply });
    setBusy(false);
    if (error) { toast('error', 'Erro: ' + error.message); return; }
    setReply('');
    openTicket(open);
  };

  return (
    <div className="fade-up max-w-3xl">
      <PageHeader
        title="Pedir ajuda"
        subtitle="Abra um chamado e acompanhe a resposta"
        right={<Button onClick={() => setModal(true)}><Plus size={18} /> Novo chamado</Button>}
      />

      {tickets.length === 0 ? (
        <Empty icon={<MessageSquare size={28} />} title="Nenhum chamado" subtitle="Está com dúvidas ou encontrou um problema? Abra um chamado." action={<Button onClick={() => setModal(true)}>Abrir chamado</Button>} />
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => (
            <button key={t.id} onClick={() => openTicket(t)} className="w-full text-left">
              <Card className="p-5 hover:shadow-md transition">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-ink truncate">{t.subject}</p>
                    <p className="text-xs text-sub mt-0.5">{fmtDateTime(t.created_at)}</p>
                  </div>
                  <Badge className={cx(t.status === 'aberto' ? 'bg-amber-50 text-amber-700' : t.status === 'respondido' ? 'bg-blue-50 text-blue-700' : 'bg-brand-50 text-brand-700')}>
                    {t.status}
                  </Badge>
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title="Novo chamado">
        <div className="space-y-4">
          <Field label="Assunto"><Input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} /></Field>
          <Field label="Mensagem"><Textarea value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} placeholder="Descreva sua dúvida ou problema..." /></Field>
          <Field label="Imagem anexada (URL)" hint="Cole o link de uma imagem, se precisar."><Input value={form.attachment_url} onChange={(e) => setForm((f) => ({ ...f, attachment_url: e.target.value }))} /></Field>
          <Button className="w-full" loading={busy} onClick={createTicket}>Enviar chamado</Button>
        </div>
      </Modal>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.subject} wide>
        {open && (
          <div>
            <p className="text-sm text-sub">{open.message}</p>
            <div className="mt-5 space-y-3 max-h-72 overflow-y-auto">
              {replies.map((r) => (
                <div key={r.id} className={cx('rounded-2xl px-4 py-3 text-sm', r.is_admin ? 'bg-brand-50 text-brand-900 ml-8' : 'bg-slate-100 text-slate-700 mr-8')}>
                  <p>{r.body}</p>
                  <p className="text-[10px] font-bold text-slate-400 mt-1">{r.is_admin ? 'Equipe Agenda Logo' : 'Você'} · {fmtDateTime(r.created_at)}</p>
                </div>
              ))}
            </div>
            {open.status !== 'resolvido' && (
              <div className="mt-5 flex gap-2">
                <Input placeholder="Escreva uma resposta..." value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendReply()} />
                <Button loading={busy} onClick={sendReply}>Enviar</Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
