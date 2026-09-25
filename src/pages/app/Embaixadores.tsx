import React, { useCallback, useEffect, useState } from 'react';
import {
  Copy, Check, Share2, Users, DollarSign, Gift, PartyPopper, Award, QrCode,
  Wallet, TrendingUp, Lock, Network, Target, Sparkles, MessageCircle, Trophy,
  UserRound, UserRoundCheck,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Stat, cx } from '../../components/ui';
import { brl, fmtDate, fmtDateTime } from '../../lib/utils';

type AmbData = {
  is_ambassador: boolean;
  status?: string;
  flag?: string;
  config: { enabled: boolean; company_pct: number; level_pcts: number[]; safety_days: number; min_withdrawal: number };
  stats: { direct_referrals: number; paying_clients: number; active_clients: number };
  level: { label: string; next: { label: string; min: number } | null };
  wallet: { pendente: number; disponivel: number; pago_total: number; estornado_total: number };
  commissions: { id: string; amount: number; level: number; status: string; created_at: string; available_at: string }[];
  wallet_tx: { id: string; kind: string; amount: number; detail: string; created_at: string }[];
  withdrawals: { id: string; amount: number; status: string; note: string; created_at: string; decided_at: string }[];
  sponsor: { id: string; name: string; whatsapp: string | null } | null;
  tree: { level: number; nodes: { id: string; name: string; whatsapp?: string | null; paying: boolean }[] }[];
  rewards: { id: string; min: number; label: string; achieved: boolean }[];
};

const statusLabel: Record<string, { text: string; cls: string }> = {
  pendente: { text: 'Pendente', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  disponivel: { text: 'Disponível', cls: 'bg-brand-50 text-brand-700 border-brand-200' },
  estornada: { text: 'Estornada', cls: 'bg-rose-50 text-rose-600 border-rose-200' },
  solicitado: { text: 'Solicitado', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  em_analise: { text: 'Em análise', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  aprovado: { text: 'Aprovado', cls: 'bg-brand-50 text-brand-700 border-brand-200' },
  pago: { text: 'Pago', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  recusado: { text: 'Recusado', cls: 'bg-rose-50 text-rose-600 border-rose-200' },
};

export default function Embaixadores() {
  const { profile, toast } = useApp();
  const [data, setData] = useState<AmbData | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [joining, setJoining] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [msg, setMsg] = useState('Estou usando uma nova plataforma para organizar minha rotina profissional. Se quiser testar, entre pelo meu link:');
  const [wdAmount, setWdAmount] = useState('');
  const [wdding, setWdding] = useState(false);
  const [wdPix, setWdPix] = useState({ type: 'cpf', key: '', holder: '' });

  const load = useCallback(async () => {
    const { data: d, error } = await supabase.rpc('amb_me');
    if (!error && d) setData(d as unknown as AmbData);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const code = profile?.referral_code ?? '';
  const inviteLink = `${window.location.origin}/?ref=${code}`;

  const join = async () => {
    if (!accepted) return toast('error', 'É preciso aceitar os termos do programa.');
    setJoining(true);
    const { error } = await supabase.rpc('amb_join_program');
    setJoining(false);
    if (error) return toast('error', 'Erro: ' + error.message);
    toast('success', 'Bem-vindo ao programa de embaixadores!');
    load();
  };

  const copy = async (text: string, which: 'link' | 'msg') => {
    await navigator.clipboard.writeText(text);
    if (which === 'link') { setCopied(true); setTimeout(() => setCopied(false), 1500); }
    else { setCopiedMsg(true); setTimeout(() => setCopiedMsg(false), 1500); }
    toast('success', 'Copiado!');
  };

  const shareWpp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(`${msg}\n${inviteLink}`)}`, '_blank');
  };

  const shareNative = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'Agenda Logo', text: msg, url: inviteLink }); } catch { /* cancelado */ }
    } else copy(`${msg}\n${inviteLink}`, 'msg');
  };

  const requestWithdraw = async () => {
    const v = Number(wdAmount.replace(',', '.'));
    if (!v || v <= 0) return toast('error', 'Informe o valor do saque.');
    if (!wdPix.key.trim()) return toast('error', 'Informe sua chave PIX para receber o repasse.');
    if (!wdPix.holder.trim()) return toast('error', 'Informe o nome do titular da chave PIX.');
    setWdding(true);
    const { error } = await supabase.rpc('amb_withdraw', {
      p_amount: v,
      p_pix_key: wdPix.key.trim(),
      p_pix_key_type: wdPix.type,
      p_pix_holder: wdPix.holder.trim(),
    });
    setWdding(false);
    if (error) return toast('error', 'Erro: ' + error.message);
    setWdAmount('');
    toast('success', 'Saque solicitado! O repasse será feito via PIX para a chave informada.');
    load();
  };

  if (loading) return <div className="p-6"><Empty title="Carregando..." /></div>;
  if (!data) return <div className="p-6"><Empty title="Não foi possível carregar os dados." /></div>;

  const levelPcts = data.config.level_pcts ?? [30, 20, 10];
  const pct1 = levelPcts[0] ?? 0;
  const goal = data.rewards?.[0] ?? null;
  const goalProgress = goal ? Math.min(100, Math.round((data.stats.paying_clients / goal.min) * 100)) : 0;
  const suggestions: string[] = [];
  if (data.level.next) suggestions.push(`Você está a ${Math.max(1, data.level.next.min - data.stats.paying_clients)} clientes pagantes do nível ${data.level.next.label}.`);
  if (data.stats.direct_referrals === 0) suggestions.push('Compartilhe seu link para conquistar sua primeira indicação.');
  if (data.stats.paying_clients > 0) suggestions.push(`Você possui ${data.stats.paying_clients} cliente${data.stats.paying_clients > 1 ? 's' : ''} pagante${data.stats.paying_clients > 1 ? 's' : ''}. Continue compartilhando!`);
  if (data.wallet.disponivel >= data.config.min_withdrawal) suggestions.push('Seu saldo já pode ser sacado — solicite seu saque.');

  return (
    <div className="max-w-3xl mx-auto pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <PageHeader
        title="Central do Embaixador"
        subtitle="Indique o produto que você usa e seja recompensado por clientes reais."
      />

      {/* ---------- Ainda não é embaixador ---------- */}
      {!data.is_ambassador ? (
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 grid place-items-center text-white">
              <Award size={22} />
            </div>
            <div>
              <h2 className="font-extrabold text-ink">Programa de Embaixadores</h2>
              <p className="text-xs text-sub">Ganhe comissão recorrente indicando o Agenda Logo</p>
            </div>
          </div>
          <ul className="text-sm text-slate-600 space-y-2 mb-4">
            <li className="flex gap-2"><Sparkles size={16} className="text-amber-500 shrink-0 mt-0.5" /> Ganhe <b>{pct1}%</b> das assinaturas dos clientes que você indicar (1º nível).</li>
            <li className="flex gap-2"><Network size={16} className="text-amber-500 shrink-0 mt-0.5" /> Ganhe também das indicações dos seus indicados — a rede soma até <b>{levelPcts.length} níveis</b> de profundidade.</li>
            <li className="flex gap-2"><TrendingUp size={16} className="text-amber-500 shrink-0 mt-0.5" /> Comissão <b>recorrente</b>: enquanto seu indicado pagar, você recebe.</li>
            <li className="flex gap-2"><Wallet size={16} className="text-amber-500 shrink-0 mt-0.5" /> Comissões ficam pendentes por {data.config.safety_days} dias (segurança contra estorno) e depois ficam disponíveis para saque.</li>
          </ul>
          {levelPcts.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {levelPcts.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                  {i + 1}º nível: {p}%
                </span>
              ))}
            </div>
          )}
          <label className="flex items-start gap-2 text-xs text-slate-600 mb-4 cursor-pointer">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 accent-emerald-600" />
            <span>Concordo com os termos do programa: comissões são geradas apenas sobre pagamentos efetivamente confirmados, podem ser estornadas em caso de reembolso e o saque segue análise do administrador. Não é permitido autoindicação nem criação artificial de contas.</span>
          </label>
          <Button onClick={join} loading={joining} disabled={!accepted}>
            <Award size={18} className="mr-2" /> Quero ser Embaixador
          </Button>
        </Card>
      ) : (
        <>
          {/* ---------- Nível + status ---------- */}
          <Card className="p-5 mb-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 grid place-items-center text-white shrink-0">
                  <Trophy size={22} />
                </div>
                <div>
                  <p className="font-extrabold text-ink">{data.level.label}</p>
                  {data.level.next && (
                    <p className="text-xs text-sub">
                      Próximo nível: {data.level.next.label} ({data.level.next.min} clientes pagantes)
                    </p>
                  )}
                </div>
              </div>
              <Badge className={cx(
                data.status === 'ativo' && data.flag === 'normal' && 'bg-brand-50 text-brand-700 border-brand-200',
                data.flag === 'atencao' && 'bg-amber-50 text-amber-700 border-amber-200',
                (data.flag === 'bloqueado' || data.status !== 'ativo') && 'bg-rose-50 text-rose-600 border-rose-200',
              )}>
                {data.status === 'ativo' ? (data.flag === 'normal' ? 'Embaixador ativo' : 'Em revisão') : 'Suspenso'}
              </Badge>
            </div>
            {goal && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-sub mb-1">
                  <span className="flex items-center gap-1"><Target size={13} /> Meta: {goal.label}</span>
                  <span>{data.stats.paying_clients}/{goal.min} clientes</span>
                </div>
                <div className="h-2.5 rounded-full bg-amber-100 overflow-hidden">
                  <div className={cx('h-full rounded-full transition-all duration-700', goal.achieved ? 'bg-gradient-to-r from-amber-400 to-amber-500' : 'bg-gradient-to-r from-brand-400 to-brand-600')} style={{ width: `${Math.max(4, goalProgress)}%` }} />
                </div>
                {goal.achieved && <p className="text-xs text-amber-600 font-bold mt-1">🏆 Meta conquistada!</p>}
              </div>
            )}
          </Card>

          {/* ---------- Carteira ---------- */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Stat label="Saldo pendente" value={brl(data.wallet.pendente)} icon={<ClockIcon />} />
            <Stat label="Disponível" value={brl(data.wallet.disponivel)} icon={<Wallet size={20} />} />
            <Stat label="Já pago" value={brl(data.wallet.pago_total)} icon={<Check size={20} />} />
            <Stat label="Estornado" value={brl(data.wallet.estornado_total)} icon={<TrendingUp size={20} className="rotate-180" />} />
          </div>

          {/* ---------- Central do Embaixador (sugestões) ---------- */}
          {suggestions.length > 0 && (
            <Card className="p-5 mb-5 bg-gradient-to-br from-brand-50/60 to-white">
              <h3 className="font-extrabold text-ink text-sm mb-2 flex items-center gap-2"><Sparkles size={16} className="text-brand-600" /> Dicas para você crescer</h3>
              <ul className="space-y-1.5">
                {suggestions.map((s, i) => <li key={i} className="text-sm text-slate-600 flex gap-2"><span className="text-brand-500">•</span> {s}</li>)}
              </ul>
            </Card>
          )}

          {/* ---------- Link de indicação ---------- */}
          <Card className="p-5 mb-5">
            <h3 className="font-extrabold text-ink text-sm mb-1 flex items-center gap-2"><Gift size={16} className="text-brand-600" /> Seu link de indicação</h3>
            <p className="text-xs text-sub mb-3">Compartilhe e ganhe {pct1}% das assinaturas dos seus indicados.</p>
            <div className="flex items-center gap-2 mb-3">
              <Input readOnly value={inviteLink} className="text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button size="sm" variant="secondary" onClick={() => copy(inviteLink, 'link')}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={shareWpp}><MessageCircle size={16} className="mr-1" /> WhatsApp</Button>
              <Button size="sm" variant="secondary" onClick={shareNative}><Share2 size={16} className="mr-1" /> Compartilhar</Button>
              <a
                href={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(inviteLink)}`}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 h-9 px-4 rounded-xl border border-slate-200 text-sm font-bold text-ink hover:bg-slate-50"
              >
                <QrCode size={16} /> QR Code
              </a>
            </div>
            <div className="mt-4">
              <p className="text-xs font-bold text-ink mb-1">Mensagem de compartilhamento (editável):</p>
              <textarea
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
              <Button size="sm" variant="ghost" onClick={() => copy(`${msg}\n${inviteLink}`, 'msg')} className="mt-1">
                {copiedMsg ? <Check size={14} className="mr-1" /> : <Copy size={14} className="mr-1" />} Copiar mensagem + link
              </Button>
            </div>
          </Card>

          {/* ---------- Métricas ---------- */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Stat label="Indicados diretos" value={String(data.stats.direct_referrals)} icon={<Users size={20} />} />
            <Stat label="Clientes pagantes" value={String(data.stats.paying_clients)} icon={<DollarSign size={20} />} />
            <Stat label="Clientes ativos" value={String(data.stats.active_clients)} icon={<PartyPopper size={20} />} />
          </div>

          {/* ---------- Saque ---------- */}
          <Card className="p-5 mb-5">
            <h3 className="font-extrabold text-ink text-sm mb-1 flex items-center gap-2"><Wallet size={16} className="text-brand-600" /> Solicitar saque</h3>
            <p className="text-xs text-sub mb-3">Saldo disponível: <b className="text-ink">{brl(data.wallet.disponivel)}</b> · Valor mínimo: {brl(data.config.min_withdrawal)}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <Field label="Tipo de chave PIX">
                <select
                  value={wdPix.type}
                  onChange={(e) => setWdPix((s) => ({ ...s, type: e.target.value }))}
                  className="w-full h-11 rounded-xl border border-slate-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                >
                  <option value="cpf">CPF</option>
                  <option value="cnpj">CNPJ</option>
                  <option value="email">E-mail</option>
                  <option value="telefone">Telefone (celular)</option>
                  <option value="aleatoria">Chave aleatória</option>
                </select>
              </Field>
              <Field label="Titular da chave" hint="Como está na conta do banco">
                <Input
                  value={wdPix.holder}
                  onChange={(e) => setWdPix((s) => ({ ...s, holder: e.target.value }))}
                  placeholder="Ex.: MARIA SOUZA"
                />
              </Field>
            </div>
            <Field
              label="Sua chave PIX"
              hint={wdPix.type === 'telefone'
                ? 'DDD + número, ex.: 61999999999'
                : wdPix.type === 'email' ? 'Seu e-mail cadastrado no banco'
                : wdPix.type === 'aleatoria' ? 'A chave aleatória gerada pelo seu banco'
                : `Somente os ${wdPix.type === 'cnpj' ? '14' : '11'} dígitos do ${wdPix.type.toUpperCase()}`}
            >
              <Input
                value={wdPix.key}
                onChange={(e) => setWdPix((s) => ({ ...s, key: e.target.value }))}
                placeholder={wdPix.type === 'telefone' ? '61999999999' : wdPix.type === 'email' ? 'voce@email.com' : wdPix.type === 'cnpj' ? '00000000000000' : wdPix.type === 'aleatoria' ? 'xxxxxxxx-xxxx-xxxx' : '00000000000'}
                inputMode={wdPix.type === 'telefone' || wdPix.type === 'cpf' || wdPix.type === 'cnpj' ? 'numeric' : 'text'}
              />
            </Field>
            <div className="flex gap-2 mt-3">
              <Input
                type="text" inputMode="decimal" placeholder="0,00" value={wdAmount}
                onChange={(e) => setWdAmount(e.target.value.replace(/[^\d.,]/g, ''))}
                className="max-w-[160px]" disabled={data.wallet.disponivel < data.config.min_withdrawal}
              />
              <Button size="md" onClick={requestWithdraw} loading={wdding} disabled={data.wallet.disponivel < data.config.min_withdrawal}>
                Solicitar
              </Button>
            </div>
            {data.wallet.disponivel < data.config.min_withdrawal && (
              <p className="text-xs text-sub mt-2 flex items-center gap-1"><Lock size={12} /> Disponibilize {brl(data.config.min_withdrawal)} em comissões para sacar.</p>
            )}
            {data.withdrawals.length > 0 && (
              <div className="mt-4 space-y-2">
                {data.withdrawals.slice(0, 8).map((w) => (
                  <div key={w.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                    <div>
                      <p className="text-sm font-bold text-ink">{brl(w.amount)}</p>
                      <p className="text-[11px] text-sub">{fmtDateTime(w.created_at)}</p>
                    </div>
                    <Badge className={statusLabel[w.status]?.cls}>{statusLabel[w.status]?.text ?? w.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* ---------- Repasse: quem está acima ---------- */}
          <Card className="p-5 mb-5">
            <h3 className="font-extrabold text-ink text-sm mb-1 flex items-center gap-2"><UserRoundCheck size={16} className="text-brand-600" /> Quem faz o repasse para você</h3>
            {data.sponsor ? (
              <div className="mt-3 flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center font-extrabold shrink-0">
                  {(data.sponsor.name || '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-ink truncate">{data.sponsor.name || '—'}</p>
                  <p className="text-xs text-sub">Seu padrinho na rede — é ele quem repassa suas comissões.</p>
                </div>
                {data.sponsor.whatsapp && (
                  <a
                    href={`https://wa.me/${data.sponsor.whatsapp.replace(/\D/g, '')}`}
                    target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-brand-50 text-brand-700 text-sm font-bold shrink-0"
                  >
                    <MessageCircle size={16} /> WhatsApp
                  </a>
                )}
              </div>
            ) : (
              <p className="text-sm text-sub mt-2">
                Você entrou direto pela plataforma — suas comissões são repassadas pelo <b className="text-ink">Agenda Logo</b> (equipe oficial), pelos saques aprovados no seu painel.
              </p>
            )}
          </Card>

          {/* ---------- Repasse: seus indicados diretos ---------- */}
          <Card className="p-5 mb-5">
            <h3 className="font-extrabold text-ink text-sm mb-1 flex items-center gap-2"><UserRound size={16} className="text-brand-600" /> Para quem você repassa</h3>
            <p className="text-xs text-sub mb-3">Apenas seus indicados diretos — cada um cuida da própria rede abaixo.</p>
            {(data.tree[0]?.nodes ?? []).length === 0 ? (
              <p className="text-sm text-sub">Você ainda não tem indicados diretos. Compartilhe seu link!</p>
            ) : (
              <div className="space-y-2">
                {data.tree[0].nodes.map((n) => (
                  <div key={n.id} className="flex items-center gap-3 border border-slate-100 rounded-2xl px-3 py-2.5">
                    <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center font-extrabold text-sm shrink-0">
                      {(n.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ink truncate">{n.name || '—'}</p>
                      {n.paying && <p className="text-[11px] font-bold text-brand-600">Cliente pagante — comissões ativas</p>}
                    </div>
                    {n.whatsapp && (
                      <a
                        href={`https://wa.me/${n.whatsapp.replace(/\D/g, '')}`}
                        target="_blank" rel="noreferrer"
                        className="p-2 rounded-xl bg-brand-50 text-brand-700 shrink-0"
                        aria-label={`WhatsApp de ${n.name}`}
                      >
                        <MessageCircle size={16} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* ---------- Histórico ---------- */}
          <Card className="p-5">
            <h3 className="font-extrabold text-ink text-sm mb-3">Histórico de comissões</h3>
            {data.commissions.length === 0 && data.wallet_tx.length === 0 ? (
              <p className="text-sm text-sub">Nenhuma movimentação ainda.</p>
            ) : (
              <div className="space-y-2">
                {data.commissions.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                    <div>
                      <p className="text-sm font-bold text-ink">
                        {brl(c.amount)} <span className="text-[11px] font-normal text-sub">· {c.level}º nível</span>
                      </p>
                      <p className="text-[11px] text-sub">
                        {fmtDate(c.created_at)}
                        {c.available_at && c.status === 'pendente' && ` · libera em ${fmtDate(c.available_at)}`}
                      </p>
                    </div>
                    <Badge className={statusLabel[c.status]?.cls}>{statusLabel[c.status]?.text ?? c.status}</Badge>
                  </div>
                ))}
                {data.wallet_tx.map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2 bg-slate-50/60">
                    <div>
                      <p className={cx('text-sm font-bold', t.amount < 0 ? 'text-rose-600' : 'text-ink')}>
                        {t.amount < 0 ? '−' : '+'}{brl(Math.abs(t.amount))}
                      </p>
                      <p className="text-[11px] text-sub">{t.detail} · {fmtDateTime(t.created_at)}</p>
                    </div>
                    <Badge className="bg-slate-100 text-slate-600 border-slate-200">{t.kind === 'saque' ? 'Saque' : 'Ajuste'}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function ClockIcon() {
  return <ClockSmall />;
}

function ClockSmall() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>;
}
