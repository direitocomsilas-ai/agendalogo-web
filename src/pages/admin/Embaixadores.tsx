import React, { useCallback, useEffect, useState } from 'react';
import { Award, DollarSign, Gift, TrendingUp, Users, Wallet, AlertTriangle, ShieldCheck, ClipboardList, Save } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Badge, Button, Card, Confirm, Empty, Field, Input, PageHeader, Stat, Toggle, cx } from '../../components/ui';
import { brl, fmtDateTime } from '../../lib/utils';

type Overview = {
  ambassadors: number; new_ambassadors_30d: number; referred_companies: number; indicated_revenue: number;
  commissions_total: number; commissions_pending: number; commissions_available: number; commissions_paid: number;
  referrals_total: number; top: { name: string; paying: number; earned: number }[];
};
type Config = {
  enabled: boolean; company_pct: number; level_pcts: number[]; safety_days: number;
  min_withdrawal: number; amb_levels: { min: number; label: string }[];
  rewards: { id: string; min_paying_clients: number; label: string; active: boolean }[];
};
type Ambassador = {
  user_id: string; name: string; email: string; status: string; flag: string; created_at: string;
  direct: number; paying: number; earned: number; available: number; chargebacks: number;
};
type Withdrawal = { id: string; user_id: string; name: string; email: string; amount: number; status: string; note: string; pix_key?: string | null; pix_key_type?: string | null; pix_holder?: string | null; created_at: string; decided_at: string };
type Commission = { id: string; amount: number; level: number; status: string; created_at: string; available_at: string; mp_payment_id: string; beneficiary: string; source: string };
type Audit = { id: number; action: string; detail: unknown; created_at: string };

const TABS = ['Visão geral', 'Configurações', 'Embaixadores', 'Saques', 'Comissões', 'Auditoria'] as const;
const wdLabel: Record<string, string> = { solicitado: 'Solicitado', em_analise: 'Em análise', aprovado: 'Aprovado', pago: 'Pago', recusado: 'Recusado' };
const wdCls: Record<string, string> = {
  solicitado: 'bg-amber-50 text-amber-700 border-amber-200',
  em_analise: 'bg-blue-50 text-blue-700 border-blue-200',
  aprovado: 'bg-brand-50 text-brand-700 border-brand-200',
  pago: 'bg-slate-100 text-slate-600 border-slate-200',
  recusado: 'bg-rose-50 text-rose-600 border-rose-200',
};
const comCls: Record<string, string> = {
  pendente: 'bg-amber-50 text-amber-700 border-amber-200',
  disponivel: 'bg-brand-50 text-brand-700 border-brand-200',
  estornada: 'bg-rose-50 text-rose-600 border-rose-200',
};

export default function AdminEmbaixadores() {
  const { toast } = useApp();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Visão geral');
  const [loading, setLoading] = useState(true);
  const [ov, setOv] = useState<Overview | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [savingCfg, setSavingCfg] = useState(false);
  const [ambassadors, setAmbassadors] = useState<Ambassador[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [confirmWd, setConfirmWd] = useState<{ id: string; decision: string } | null>(null);
  const [newReward, setNewReward] = useState({ min: '', label: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const [o, c, a, w, cm, au] = await Promise.all([
      supabase.rpc('amb_admin_overview'),
      supabase.rpc('amb_admin_config'),
      supabase.rpc('amb_admin_ambassadors'),
      supabase.rpc('amb_admin_withdrawals'),
      supabase.rpc('amb_admin_commissions'),
      supabase.rpc('amb_admin_audit'),
    ]);
    if (o.data) setOv(o.data as Overview);
    if (c.data) setCfg(c.data as Config);
    setAmbassadors((a.data ?? []) as unknown as Ambassador[]);
    setWithdrawals((w.data ?? []) as unknown as Withdrawal[]);
    setCommissions((cm.data ?? []) as unknown as Commission[]);
    setAudit((au.data ?? []) as unknown as Audit[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveCfg = async () => {
    if (!cfg) return;
    const pcts = cfg.level_pcts.map((p) => Number(p) || 0);
    if (Number(cfg.company_pct) + pcts.reduce((s, p) => s + p, 0) !== 100) {
      return toast('error', 'A soma dos percentuais (empresa + 3 níveis) deve ser 100.');
    }
    setSavingCfg(true);
    const { error } = await supabase.rpc('amb_admin_save_config', {
      p_enabled: cfg.enabled,
      p_company_pct: Number(cfg.company_pct),
      p_level_pcts: JSON.stringify(pcts),
      p_safety_days: Number(cfg.safety_days) || 0,
      p_min_withdrawal: Number(cfg.min_withdrawal) || 0,
      p_amb_levels: JSON.stringify(cfg.amb_levels ?? []),
    });
    setSavingCfg(false);
    if (error) return toast('error', 'Erro: ' + error.message);
    toast('success', 'Configurações salvas!');
    load();
  };

  const saveRewards = async (rewards: Config['rewards']) => {
    const { error } = await supabase.rpc('amb_admin_save_rewards', { p_rewards: JSON.stringify(rewards) });
    if (error) return toast('error', 'Erro: ' + error.message);
    toast('success', 'Recompensas salvas!');
    load();
  };

  const decide = async (id: string, decision: string) => {
    const { error } = await supabase.rpc('amb_admin_decide_withdrawal', { p_id: id, p_decision: decision });
    if (error) return toast('error', 'Erro: ' + error.message);
    toast('success', 'Saque atualizado!');
    setConfirmWd(null);
    load();
  };

  const setFlag = async (user: string, status: string, flag: string) => {
    const { error } = await supabase.rpc('amb_admin_set_flag', { p_user: user, p_status: status, p_flag: flag });
    if (error) return toast('error', 'Erro: ' + error.message);
    toast('success', 'Embaixador atualizado!');
    load();
  };

  if (loading) return <div className="p-6"><Empty title="Carregando..." /></div>;

  return (
    <div className="max-w-5xl mx-auto pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <PageHeader title="Embaixadores" subtitle="Programa de indicações, comissões recorrentes e saques." />

      {/* Abas */}
      <div className="flex gap-1 overflow-x-auto mb-5 bg-slate-100 rounded-2xl p-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cx(
              'px-3.5 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-colors',
              tab === t ? 'bg-white text-ink shadow-sm' : 'text-sub hover:text-ink',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ---------- VISÃO GERAL ---------- */}
      {tab === 'Visão geral' && ov && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Stat label="Embaixadores" value={String(ov.ambassadors)} icon={<Award size={20} />} />
            <Stat label="Novos (30 dias)" value={String(ov.new_ambassadors_30d)} icon={<TrendingUp size={20} />} />
            <Stat label="Clientes via indicação" value={String(ov.referred_companies)} icon={<Users size={20} />} />
            <Stat label="Receita de indicações" value={brl(Number(ov.indicated_revenue))} icon={<DollarSign size={20} />} />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Stat label="Comissões geradas" value={brl(Number(ov.commissions_total))} icon={<Gift size={20} />} />
            <Stat label="Pendentes" value={brl(Number(ov.commissions_pending))} icon={<Wallet size={20} />} />
            <Stat label="Disponíveis" value={brl(Number(ov.commissions_available))} icon={<Wallet size={20} />} />
            <Stat label="Pagas (saques)" value={brl(Number(ov.commissions_paid))} icon={<ShieldCheck size={20} />} />
          </div>
          <Card className="p-5">
            <h3 className="font-extrabold text-ink text-sm mb-3">Top embaixadores</h3>
            {ov.top.length === 0 ? (
              <p className="text-sm text-sub">Nenhuma comissão registrada ainda.</p>
            ) : (
              <div className="space-y-2">
                {ov.top.map((t, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-amber-50 text-amber-600 grid place-items-center text-xs font-extrabold">{i + 1}</span>
                      <div>
                        <p className="text-sm font-bold text-ink">{t.name || '—'}</p>
                        <p className="text-[11px] text-sub">{t.paying} cliente(s) pagante(s)</p>
                      </div>
                    </div>
                    <span className="text-sm font-extrabold text-ink">{brl(Number(t.earned))}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {/* ---------- CONFIGURAÇÕES ---------- */}
      {tab === 'Configurações' && cfg && (
        <>
          <Card className="p-5 mb-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-extrabold text-ink text-sm flex items-center gap-2"><Award size={16} className="text-amber-500" /> Programa</h3>
              <div className="flex items-center gap-2">
                <span className="text-sm text-sub">{cfg.enabled ? 'Ativo' : 'Desativado'}</span>
                <Toggle checked={cfg.enabled} onChange={(v) => setCfg({ ...cfg, enabled: v })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Percentual da empresa (%)">
                <Input type="number" value={cfg.company_pct} onChange={(e) => setCfg({ ...cfg, company_pct: Number(e.target.value) })} />
              </Field>
              <div />
              {(cfg.level_pcts ?? []).map((p, i) => (
                <Field key={i} label={`Comissão ${i + 1}º nível (%)`}>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={p}
                      onChange={(e) => {
                        const arr = [...cfg.level_pcts]; arr[i] = Number(e.target.value); setCfg({ ...cfg, level_pcts: arr });
                      }}
                    />
                    {(cfg.level_pcts.length ?? 0) > 1 && (
                      <Button variant="danger" size="sm" onClick={() => setCfg({ ...cfg, level_pcts: cfg.level_pcts.filter((_, j) => j !== i) })}>✕</Button>
                    )}
                  </div>
                </Field>
              ))}
              {(cfg.level_pcts.length ?? 0) < 10 && (
                <Button variant="secondary" size="sm" onClick={() => setCfg({ ...cfg, level_pcts: [...cfg.level_pcts, 0] })}>
                  + Adicionar nível ({cfg.level_pcts.length + 1}º)
                </Button>
              )}
              <Field label="Prazo de segurança (dias)">
                <Input type="number" value={cfg.safety_days} onChange={(e) => setCfg({ ...cfg, safety_days: Number(e.target.value) })} />
              </Field>
              <Field label="Valor mínimo para saque (R$)">
                <Input type="number" value={cfg.min_withdrawal} onChange={(e) => setCfg({ ...cfg, min_withdrawal: Number(e.target.value) })} />
              </Field>
            </div>
            <p className={cx('text-xs mt-3 font-bold', Number(cfg.company_pct) + cfg.level_pcts.reduce((s, p) => s + Number(p) || 0, 0) === 100 ? 'text-brand-600' : 'text-rose-500')}>
              Total distribuído: {Number(cfg.company_pct) + cfg.level_pcts.reduce((s, p) => s + Number(p) || 0, 0)}% (deve ser 100)
            </p>
            <Button className="mt-4" onClick={saveCfg} loading={savingCfg}><Save size={16} className="mr-2" /> Salvar configurações</Button>
          </Card>

          <Card className="p-5">
            <h3 className="font-extrabold text-ink text-sm mb-3 flex items-center gap-2"><Gift size={16} className="text-amber-500" /> Metas e recompensas (clientes pagantes)</h3>
            <div className="space-y-2 mb-4">
              {(cfg.rewards ?? []).map((r, i) => (
                <div key={r.id ?? i} className="flex items-center gap-2">
                  <Input
                    type="number" className="max-w-[110px]" placeholder="Nº clientes"
                    value={r.min_paying_clients}
                    onChange={(e) => {
                      const arr = [...cfg.rewards]; arr[i] = { ...r, min_paying_clients: Number(e.target.value) }; setCfg({ ...cfg, rewards: arr });
                    }}
                  />
                  <Input
                    className="flex-1" placeholder="Recompensa (ex: 1 mês grátis)"
                    value={r.label}
                    onChange={(e) => {
                      const arr = [...cfg.rewards]; arr[i] = { ...r, label: e.target.value }; setCfg({ ...cfg, rewards: arr });
                    }}
                  />
                  <Button variant="danger" size="sm" onClick={() => setCfg({ ...cfg, rewards: cfg.rewards.filter((_, j) => j !== i) })}>✕</Button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mb-4">
              <Input type="number" className="max-w-[110px]" placeholder="Nº" value={newReward.min} onChange={(e) => setNewReward({ ...newReward, min: e.target.value })} />
              <Input className="flex-1" placeholder="Recompensa" value={newReward.label} onChange={(e) => setNewReward({ ...newReward, label: e.target.value })} />
              <Button
                variant="secondary" size="sm"
                onClick={() => {
                  if (!newReward.min || !newReward.label.trim()) return toast('error', 'Preencha o número e a recompensa.');
                  const arr = [...(cfg.rewards ?? []), { id: crypto.randomUUID(), min_paying_clients: Number(newReward.min), label: newReward.label.trim(), active: true }];
                  setCfg({ ...cfg, rewards: arr });
                  setNewReward({ min: '', label: '' });
                }}
              >
                Adicionar
              </Button>
            </div>
            <Button onClick={() => saveRewards(cfg.rewards ?? [])}><Save size={16} className="mr-2" /> Salvar recompensas</Button>
          </Card>
        </>
      )}

      {/* ---------- EMBAIXADORES ---------- */}
      {tab === 'Embaixadores' && (
        <Card className="p-5">
          {ambassadors.length === 0 ? (
            <Empty title="Nenhum embaixador ainda" subtitle="Os profissionais que aderirem ao programa aparecerão aqui." />
          ) : (
            <div className="space-y-2">
              {ambassadors.map((a) => (
                <div key={a.user_id} className="rounded-2xl border border-slate-100 p-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <p className="text-sm font-bold text-ink flex items-center gap-2">
                        {a.name || '—'}
                        {a.flag !== 'normal' && <Badge className={a.flag === 'bloqueado' ? 'bg-rose-50 text-rose-600 border-rose-200' : 'bg-amber-50 text-amber-700 border-amber-200'}>{a.flag === 'bloqueado' ? 'Bloqueado' : 'Atenção'}</Badge>}
                        {a.chargebacks > 0 && <span className="text-[11px] text-rose-500 flex items-center gap-1"><AlertTriangle size={12} /> {a.chargebacks} estorno(s)</span>}
                      </p>
                      <p className="text-[11px] text-sub">{a.email} · desde {fmtDateTime(a.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-sub">{a.direct} indicados</span>
                      <span className="font-bold text-ink">{a.paying} pagantes</span>
                      <span className="font-bold text-brand-600">{brl(a.available)} disponível</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {a.status === 'ativo' ? (
                      <Button size="sm" variant="secondary" onClick={() => setFlag(a.user_id, 'suspenso', a.flag)}>Suspender</Button>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => setFlag(a.user_id, 'ativo', a.flag)}>Reativar</Button>
                    )}
                    {a.flag !== 'bloqueado' ? (
                      <Button size="sm" variant="danger" onClick={() => setFlag(a.user_id, 'bloqueado', 'bloqueado')}>Bloquear</Button>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => setFlag(a.user_id, 'ativo', 'normal')}>Desbloquear</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ---------- SAQUES ---------- */}
      {tab === 'Saques' && (
        <Card className="p-5">
          <div className="rounded-2xl bg-brand-50/60 border border-brand-100 px-4 py-3 mb-4">
            <p className="text-xs font-semibold text-brand-700">
              Você repassa apenas para os embaixadores do seu 1º nível (indicados diretos). Cada embaixador repassa pessoalmente para a sua própria rede abaixo — os níveis mais profundos não passam por você.
            </p>
          </div>
          {withdrawals.length === 0 ? (
            <Empty title="Nenhum saque solicitado" />
          ) : (
            <div className="space-y-2">
              {withdrawals.map((w) => (
                <div key={w.id} className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-3 flex-wrap gap-2">
                  <div>
                    <p className="text-sm font-bold text-ink">{w.name || w.email}</p>
                    <p className="text-[11px] text-sub">{fmtDateTime(w.created_at)} · {brl(w.amount)}</p>
                    {w.pix_key && (
                      <p className="text-[11px] text-brand-700 font-bold mt-0.5">
                        PIX ({w.pix_key_type ?? 'chave'}): {w.pix_key}{w.pix_holder ? ` — ${w.pix_holder}` : ''}
                      </p>
                    )}
                    <Badge className={wdCls[w.status]}>{wdLabel[w.status] ?? w.status}</Badge>
                  </div>
                  <div className="flex gap-2">
                    {w.status === 'solicitado' && (
                      <Button size="sm" variant="secondary" onClick={() => decide(w.id, 'em_analise')}>Marcar em análise</Button>
                    )}
                    {w.status !== 'pago' && w.status !== 'recusado' && (
                      <>
                        <Button size="sm" variant="danger" onClick={() => decide(w.id, 'recusado')}>Recusar</Button>
                        <Button size="sm" onClick={() => setConfirmWd({ id: w.id, decision: 'pago' })}>Marcar como pago</Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ---------- COMISSÕES ---------- */}
      {tab === 'Comissões' && (
        <Card className="p-5">
          {commissions.length === 0 ? (
            <Empty title="Nenhuma comissão registrada" subtitle="Comissões surgem automaticamente quando um pagamento de indicado é aprovado." />
          ) : (
            <div className="space-y-2">
              {commissions.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                  <div>
                    <p className="text-sm font-bold text-ink">{brl(c.amount)} <span className="text-[11px] font-normal text-sub">· {c.level}º nível</span></p>
                    <p className="text-[11px] text-sub">
                      {c.beneficiary || '—'} ← indicado: {c.source || '—'} · {fmtDateTime(c.created_at)}
                      {c.mp_payment_id ? ` · MP ${c.mp_payment_id}` : ''}
                    </p>
                  </div>
                  <Badge className={comCls[c.status]}>{c.status.charAt(0).toUpperCase() + c.status.slice(1)}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ---------- AUDITORIA ---------- */}
      {tab === 'Auditoria' && (
        <Card className="p-5">
          <h3 className="font-extrabold text-ink text-sm mb-3 flex items-center gap-2"><ClipboardList size={16} /> Registro de ações</h3>
          {audit.length === 0 ? (
            <Empty title="Nenhum registro" />
          ) : (
            <div className="space-y-2">
              {audit.map((l) => (
                <div key={l.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                  <p className="text-sm text-slate-600">{l.action}</p>
                  <p className="text-[11px] text-sub">{fmtDateTime(l.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Confirm
        open={confirmWd !== null}
        title="Confirmar pagamento do saque?"
        message="Isso registrará a saída na carteira do embaixador."
        onClose={() => setConfirmWd(null)}
        onConfirm={() => { if (confirmWd) decide(confirmWd.id, confirmWd.decision); }}
      />
    </div>
  );
}
