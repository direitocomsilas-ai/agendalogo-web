import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, Clock, Wallet, Ticket, UserX, Download, UserPlus, FileText, MousePointerClick } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Button, Card, Empty, PageHeader, Select, Stat, cx } from '../../components/ui';
import { brl, fmtDate, fmtDateTime } from '../../lib/utils';
import { PdfDoc, PDF_COLORS, brlPdf, downloadPdf } from '../../lib/pdf';

type Appt = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  price: number;
  client_id: string | null;
  professional_id: string | null;
  service_id: string | null;
  clients: { name: string } | null;
  services: { name: string } | null;
  professionals: { name: string } | null;
};

const PERIODS = [
  { id: '7d', label: 'Últimos 7 dias' },
  { id: '30d', label: 'Últimos 30 dias' },
  { id: 'mes', label: 'Este mês' },
  { id: 'mes_passado', label: 'Mês passado' },
  { id: '90d', label: 'Últimos 90 dias' },
  { id: 'ano', label: 'Este ano' },
];

function periodRange(id: string): { from: Date; to: Date; label: string } {
  const now = new Date();
  const d0 = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  switch (id) {
    case '7d': {
      const from = d0(now); from.setDate(from.getDate() - 6);
      return { from, to: new Date(from.getTime() + 7 * 864e5), label: 'Últimos 7 dias' };
    }
    case '30d': {
      const from = d0(now); from.setDate(from.getDate() - 29);
      return { from, to: new Date(from.getTime() + 30 * 864e5), label: 'Últimos 30 dias' };
    }
    case 'mes_passado':
      return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 1), label: 'Mês passado' };
    case '90d': {
      const from = d0(now); from.setDate(from.getDate() - 89);
      return { from, to: new Date(from.getTime() + 90 * 864e5), label: 'Últimos 90 dias' };
    }
    case 'ano':
      return { from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear() + 1, 0, 1), label: 'Este ano' };
    default:
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 1), label: 'Este mês' };
  }
}

export default function Relatorios() {
  const { company } = useApp();
  const [period, setPeriod] = useState('30d');
  const [loading, setLoading] = useState(true);
  const [appts, setAppts] = useState<Appt[]>([]);
  const [newClients, setNewClients] = useState(0);
  const [linkClicks, setLinkClicks] = useState(0);

  const { from, to, label } = useMemo(() => periodRange(period), [period]);

  useEffect(() => {
    if (!company) return;
    (async () => {
      setLoading(true);
      const [apptsRes, clientsRes, clicksRes] = await Promise.all([
        supabase
          .from('appointments')
          .select('id, starts_at, ends_at, status, price, client_id, professional_id, service_id, clients ( name ), services ( name ), professionals ( name )')
          .eq('company_id', company.id)
          .gte('starts_at', from.toISOString())
          .lt('starts_at', to.toISOString())
          .order('starts_at'),
        supabase.from('clients').select('id, created_at').eq('company_id', company.id).gte('created_at', from.toISOString()).lt('created_at', to.toISOString()),
        supabase.from('link_clicks').select('id', { count: 'exact', head: true }).eq('company_id', company.id).gte('created_at', from.toISOString()).lt('created_at', to.toISOString()),
      ]);
      setAppts((apptsRes.data ?? []) as unknown as Appt[]);
      setNewClients(clientsRes.data?.length ?? 0);
      setLinkClicks(clicksRes.count ?? 0);
      setLoading(false);
    })();
  }, [company?.id, period]);

  const stats = useMemo(() => {
    const done = appts.filter((a) => a.status === 'concluido');
    const revenue = done.reduce((s, a) => s + Number(a.price || 0), 0);
    const hours = done.reduce((s, a) => s + Math.max(0, (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 3600000), 0);
    const lost = appts.filter((a) => a.status === 'cancelado' || a.status === 'faltou').length;
    const lossRate = appts.length > 0 ? (lost / appts.length) * 100 : 0;
    const ticket = done.length > 0 ? revenue / done.length : 0;
    return { done, revenue, hours, lost, lossRate, ticket };
  }, [appts]);

  const topServices = useMemo(() => {
    const map = new Map<string, { name: string; count: number; revenue: number }>();
    for (const a of stats.done) {
      const key = a.service_id ?? '—';
      const e = map.get(key) ?? { name: a.services?.name ?? 'Sem serviço', count: 0, revenue: 0 };
      e.count += 1;
      e.revenue += Number(a.price || 0);
      map.set(key, e);
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [stats]);

  const topClients = useMemo(() => {
    const map = new Map<string, { name: string; count: number; revenue: number }>();
    for (const a of stats.done) {
      const key = a.client_id ?? '—';
      const e = map.get(key) ?? { name: a.clients?.name ?? 'Cliente', count: 0, revenue: 0 };
      e.count += 1;
      e.revenue += Number(a.price || 0);
      map.set(key, e);
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [stats]);

  const byProfessional = useMemo(() => {
    const map = new Map<string, { name: string; count: number; revenue: number }>();
    for (const a of stats.done) {
      const key = a.professional_id ?? '—';
      const e = map.get(key) ?? { name: a.professionals?.name ?? 'Sem profissional', count: 0, revenue: 0 };
      e.count += 1;
      e.revenue += Number(a.price || 0);
      map.set(key, e);
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue);
  }, [stats]);

  const fmtHours = (h: number) => {
    const total = Math.round(h * 60);
    const hh = Math.floor(total / 60);
    const mm = total % 60;
    return hh > 0 ? `${hh}h${mm > 0 ? ` ${String(mm).padStart(2, '0')}min` : ''}` : `${mm}min`;
  };

  const exportCsv = () => {
    const rows = [
      ['Data', 'Hora', 'Cliente', 'Serviço', 'Profissional', 'Status', 'Valor'],
      ...appts.map((a) => [
        fmtDate(a.starts_at),
        new Date(a.starts_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        a.clients?.name ?? '',
        a.services?.name ?? '',
        a.professionals?.name ?? '',
        a.status,
        String(Number(a.price || 0).toFixed(2)).replace('.', ','),
      ]),
    ];
    const csv = '\uFEFF' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-atendimentos-${period}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const maxServiceRevenue = topServices[0]?.revenue ?? 1;

  const exportPdf = () => {
    const C = PDF_COLORS;
    const M = 46; // margem
    const W = 595.28;
    const doc = new PdfDoc();
    const companyLabel = company?.name ?? 'Meu negócio';

    const header = () => {
      // Logo Agenda Logo em vetor: quadrado verde arredondado + calendário branco
      const lx = M, ly = 34, ls = 22;
      doc.roundRect(lx, ly, ls, ls, 5.5, C.brand);
      // alças superiores do calendário
      doc.roundRect(lx + ls * 0.26, ly + 1.5, 2.6, 6, 1.2, '#FFFFFF');
      doc.roundRect(lx + ls * 0.62, ly + 1.5, 2.6, 6, 1.2, '#FFFFFF');
      // corpo do calendário
      doc.roundRect(lx + 3.2, ly + 6.2, ls - 6.4, ls - 9.4, 2.2, '#FFFFFF');
      // faixa e pontinhos (dias) em verde
      doc.rect(lx + 3.2, ly + 10.6, ls - 6.4, 0.9, C.brand);
      const dotY = ly + 14.4;
      const d3 = 2.2;
      const gap = (ls - 6.4 - 2.5 - d3 * 3) / 2;
      doc.rect(lx + 4.85, dotY, d3, d3, C.brand);
      doc.rect(lx + 4.85 + d3 + gap, dotY, d3, d3, C.brand);
      doc.rect(lx + 4.85 + (d3 + gap) * 2, dotY, d3, d3, C.brand);
      doc.text(M + 32, 45, 13, companyLabel, { bold: true, color: C.ink });
      doc.text(M + 32, 60, 9, `Relatório de desempenho  ·  ${label}`, { color: C.sub });
      doc.text(W - M, 60, 8, `Gerado em ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`, { color: C.sub, align: 'right' });
      doc.rect(M, 72, W - M * 2, 1.5, C.brand);
      doc.y = 98;
    };
    header();

    // ---- Resumo (2 linhas x 3 colunas) ----
    const cw = (W - M * 2 - 20) / 3;
    const chh = 52;
    const cards: { label: string; value: string; color: string }[] = [
      { label: 'CLIQUES NO LINK', value: String(linkClicks), color: C.blue },
      { label: 'ATENDIMENTOS CONCLUÍDOS', value: String(stats.done.length), color: C.brand },
      { label: 'HORAS ATENDIDAS', value: fmtHours(stats.hours), color: C.blue },
      { label: 'RECEITA', value: brlPdf(stats.revenue), color: C.brand },
      { label: 'TICKET MÉDIO', value: brlPdf(stats.ticket), color: C.amber },
      { label: 'CANCELADOS / FALTAS', value: `${stats.lost} (${stats.lossRate.toFixed(0)}%)`, color: C.rose },
      { label: 'NOVOS CLIENTES', value: String(newClients), color: C.blue },
    ];
    const pdfRows = Math.ceil(cards.length / 3);
    cards.forEach((card, i) => {
      const colI = i % 3;
      const rowI = Math.floor(i / 3);
      if (rowI > 0) doc.ensure(chh + 10, header);
      const x = M + colI * (cw + 10);
      const y = doc.y + rowI * (chh + 10);
      doc.rect(x, y, cw, chh, C.bg);
      doc.rect(x, y, 2.5, chh, card.color);
      doc.text(x + 12, y + 19, 6.5, card.label, { color: C.sub });
      doc.text(x + 12, y + 39, 14, card.value, { bold: true, color: card.color });
    });
    doc.y += pdfRows * chh + (pdfRows - 1) * 10 + 24;

    const sectionTitle = (t: string) => {
      doc.ensure(46, header);
      doc.rect(M, doc.y - 8, 3, 11, C.brand);
      doc.text(M + 10, doc.y, 11, t, { bold: true, color: C.ink });
      doc.y += 16;
    };

    // ---- Top serviços ----
    if (topServices.length > 0) {
      sectionTitle('Top serviços');
      const barW = W - M * 2 - 150;
      topServices.forEach((s) => {
        doc.ensure(24, header);
        doc.text(M + 10, doc.y, 9.5, s.name, { bold: true, color: C.ink });
        doc.text(W - M, doc.y, 8.5, `${s.count}x  ·  ${brlPdf(s.revenue)}`, { color: C.sub, align: 'right' });
        doc.rect(M + 10, doc.y + 5, barW, 4, C.bg);
        doc.rect(M + 10, doc.y + 5, Math.max(6, (s.revenue / maxServiceRevenue) * barW), 4, C.brand);
        doc.y += 18;
      });
      doc.y += 10;
    }

    // ---- Top clientes ----
    if (topClients.length > 0) {
      sectionTitle('Top clientes');
      topClients.forEach((c, i) => {
        doc.ensure(16, header);
        doc.text(M + 10, doc.y, 8.5, `${i + 1}.`, { bold: true, color: C.brand });
        doc.text(M + 26, doc.y, 9.5, c.name, { bold: true, color: C.ink });
        doc.text(W - M, doc.y, 8.5, `${c.count}x   ${brlPdf(c.revenue)}`, { color: C.sub, align: 'right' });
        doc.line(M + 10, doc.y + 6, W - M, doc.y + 6, C.line, 0.5);
        doc.y += 16;
      });
      doc.y += 10;
    }

    // ---- Por profissional ----
    if (byProfessional.length > 0) {
      sectionTitle('Por profissional');
      byProfessional.forEach((p) => {
        doc.ensure(16, header);
        doc.text(M + 10, doc.y, 9.5, p.name, { bold: true, color: C.ink });
        doc.text(W - M, doc.y, 8.5, `${p.count} atendimentos   ${brlPdf(p.revenue)}`, { color: C.sub, align: 'right' });
        doc.line(M + 10, doc.y + 6, W - M, doc.y + 6, C.line, 0.5);
        doc.y += 16;
      });
    }

    // ---- Rodapé ----
    doc.ensure(30);
    doc.y += 8;
    doc.rect(M, doc.y, W - M * 2, 0.75, C.line);
    doc.text(W / 2, doc.y + 14, 7.5, 'Agenda Logo  ·  relatório gerado automaticamente pelo sistema', { color: C.sub, align: 'center' });

    downloadPdf(doc.build(), `relatorio-${period}.pdf`);
  };

  return (
    <div className="fade-up max-w-4xl">
      <PageHeader title="Relatórios" subtitle={`Desempenho do negócio — ${label}`} />
      <div className="flex items-center justify-between gap-3 mb-4">
        <Select value={period} onChange={(e) => setPeriod(e.target.value)} className="w-52">
          {PERIODS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </Select>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={exportPdf} disabled={appts.length === 0}>
            <FileText size={16} /> PDF
          </Button>
          <Button variant="secondary" onClick={exportCsv} disabled={appts.length === 0}>
            <Download size={16} /> CSV
          </Button>
        </div>
      </div>

      {loading ? (
        <Card className="p-10 text-center text-sub text-sm">Carregando relatório...</Card>
      ) : appts.length === 0 && linkClicks === 0 ? (
        <Empty icon={<BarChart3 size={26} />} title="Sem dados no período" subtitle="Não houve agendamentos nem cliques no link neste período." />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
            <Stat icon={<MousePointerClick size={18} />} label="Cliques no link" value={String(linkClicks)} accent="text-violet-600 bg-violet-50" />
            <Stat icon={<CheckCircle2 size={18} />} label="Concluídos" value={String(stats.done.length)} />
            <Stat icon={<Clock size={18} />} label="Horas atendidas" value={fmtHours(stats.hours)} accent="text-blue-600 bg-blue-50" />
            <Stat icon={<Wallet size={18} />} label="Receita" value={brl(stats.revenue)} />
            <Stat icon={<Ticket size={18} />} label="Ticket médio" value={brl(stats.ticket)} accent="text-amber-600 bg-amber-50" />
            <Stat icon={<UserX size={18} />} label="Cancelados/Faltas" value={`${stats.lost} (${stats.lossRate.toFixed(0)}%)`} accent="text-rose-600 bg-rose-50" />
            <Stat icon={<UserPlus size={18} />} label="Novos clientes" value={String(newClients)} accent="text-blue-600 bg-blue-50" />
          </div>
          {appts.length === 0 && (
            <Card className="p-5 mb-5 text-sm text-sub">Nenhum agendamento neste período — mas {linkClicks} pessoa{linkClicks === 1 ? '' : 's'} abriram seu link.</Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2 mb-5">
            <Card className="p-5">
              <p className="font-bold text-ink mb-3">Top serviços</p>
              {topServices.length === 0 ? (
                <p className="text-sm text-sub">Nenhum atendimento concluído no período.</p>
              ) : (
                <div className="space-y-3">
                  {topServices.map((s) => (
                    <div key={s.name}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-bold text-ink truncate">{s.name}</span>
                        <span className="text-sub shrink-0 ml-2">{s.count}x · {brl(s.revenue)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(6, (s.revenue / maxServiceRevenue) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-5">
              <p className="font-bold text-ink mb-3">Top clientes</p>
              {topClients.length === 0 ? (
                <p className="text-sm text-sub">Nenhum atendimento concluído no período.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {topClients.map((c, i) => (
                    <div key={c.name + i} className="py-2 flex items-center gap-3">
                      <span className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 grid place-items-center text-xs font-extrabold shrink-0">{i + 1}</span>
                      <p className="text-sm font-bold text-ink truncate flex-1">{c.name}</p>
                      <span className="text-xs text-sub shrink-0">{c.count}x</span>
                      <span className="text-sm font-extrabold text-ink shrink-0">{brl(c.revenue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {byProfessional.length > 0 && (
            <Card className="p-5">
              <p className="font-bold text-ink mb-3">Por profissional</p>
              <div className="divide-y divide-slate-100">
                {byProfessional.map((p) => (
                  <div key={p.name} className="py-2.5 flex items-center gap-3">
                    <p className="text-sm font-bold text-ink truncate flex-1">{p.name}</p>
                    <span className="text-xs text-sub shrink-0">{p.count} atendimentos</span>
                    <span className="text-sm font-extrabold text-ink shrink-0">{brl(p.revenue)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
