import React, { useCallback, useEffect, useState } from 'react';
import { Users, BadgeCheck, DollarSign, CheckCircle2, Gift, PartyPopper, Phone } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Badge, Button, Card, Empty, Field, PageHeader, Select, Stat, Toggle, cx } from '../../components/ui';
import { brl, fmtDate, fmtDateTime } from '../../lib/utils';

type Referral = { id: string; referrer_id: string; invited_id: string; status: string; created_at: string };
type Commission = { id: string; referral_id: string; user_id: string; amount: number; type: string; status: string; created_at: string; paid_at: string | null };
type Settings = { referral_type: string; referral_value: number; referral_first_only: boolean };
type GoalClaim = {
  id: string; user_id: string; referral_count: number; reward_amount: number; status: string; created_at: string; paid_at: string | null;
  profiles: { name: string } | null;
};

export default function AdminIndicacoes() {
  const { toast } = useApp();
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [goalCfg, setGoalCfg] = useState({ referral_goal_count: 10, referral_goal_amount: 100, master_whatsapp: '' });
  const [claims, setClaims] = useState<GoalClaim[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [r, c, s] = await Promise.all([
      supabase.from('referrals').select('*').order('created_at', { ascending: false }),
      supabase.from('referral_commissions').select('*').order('created_at', { ascending: false }),
      supabase.from('app_settings').select('*').eq('id', 1).single(),
    ]);
    setReferrals((r.data ?? []) as Referral[]);
    setCommissions((c.data ?? []) as Commission[]);
    if (s.data) {
      setSettings({ referral_type: s.data.referral_type, referral_value: Number(s.data.referral_value), referral_first_only: s.data.referral_first_only });
      setGoalCfg({
        referral_goal_count: s.data.referral_goal_count ?? 10,
        referral_goal_amount: Number(s.data.referral_goal_amount) || 100,
        master_whatsapp: s.data.master_whatsapp ?? '',
      });
    }
    await loadClaims();
    setLoading(false);
  }, []);

  const loadClaims = useCallback(async () => {
    const { data } = await supabase
      .from('referral_goal_claims')
      .select('*, profiles(name)')
      .order('created_at', { ascending: false });
    setClaims((data ?? []) as unknown as GoalClaim[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const refCounts = referrals.reduce<Record<string, number>>((acc, r) => {
    acc[r.referrer_id] = (acc[r.referrer_id] ?? 0) + 1;
    return acc;
  }, {});
  const reachedIds = Object.entries(refCounts).filter(([, n]) => n >= (goalCfg.referral_goal_count || 10)).map(([id]) => id);
  const claimedIds = new Set(claims.map((c) => c.user_id));
  const reachedNoClaim = reachedIds.filter((id) => !claimedIds.has(id));

  const markGoalPaid = async (c: GoalClaim) => {
    const { error } = await supabase
      .from('referral_goal_claims')
      .update({ status: 'pago', paid_at: new Date().toISOString() })
      .eq('id', c.id);
    if (error) toast('error', 'Erro: ' + error.message);
    else { toast('success', 'Prêmio marcado como pago!'); loadClaims(); }
  };

  const saveGoal = async () => {
    const { error } = await supabase.from('app_settings').update({
      referral_goal_count: goalCfg.referral_goal_count || 10,
      referral_goal_amount: goalCfg.referral_goal_amount || 100,
      master_whatsapp: goalCfg.master_whatsapp.trim() || null,
    }).eq('id', 1);
    if (error) toast('error', 'Erro: ' + error.message);
    else toast('success', 'Meta salva!');
  };

  const markPaid = async (c: Commission) => {
    const { error } = await supabase.from('referral_commissions').update({ status: 'paga', paid_at: new Date().toISOString() }).eq('id', c.id);
    if (error) toast('error', 'Erro: ' + error.message);
    else { toast('success', 'Comissão marcada como paga!'); load(); }
  };

  const saveSettings = async () => {
    if (!settings) return;
    const { error } = await supabase.from('app_settings').update(settings).eq('id', 1);
    if (error) toast('error', 'Erro: ' + error.message);
    else toast('success', 'Configuração de indicação salva!');
  };

  const gerada = commissions.reduce((s, c) => s + Number(c.amount), 0);
  const disponivel = commissions.filter((c) => c.status === 'disponivel').reduce((s, c) => s + Number(c.amount), 0);
  const paga = commissions.filter((c) => c.status === 'paga').reduce((s, c) => s + Number(c.amount), 0);

  return (
    <div className="fade-up">
      <PageHeader title="Indicações" subtitle="Programa Indique e Ganhe" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat icon={<Users size={19} />} label="Indicações" value={referrals.length} />
        <Stat icon={<BadgeCheck size={19} />} label="Convertidas" value={referrals.filter((r) => r.status === 'convertido').length} accent="text-brand-600 bg-brand-50" />
        <Stat icon={<DollarSign size={19} />} label="Comissões geradas" value={brl(gerada)} accent="text-amber-600 bg-amber-50" />
        <Stat icon={<CheckCircle2 size={19} />} label="Pagas" value={brl(paga)} accent="text-blue-600 bg-blue-50" />
      </div>

      {settings && (
        <Card className="p-6 mb-6">
          <h2 className="font-extrabold text-ink mb-4">Regras de comissão</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Tipo">
              <Select value={settings.referral_type} onChange={(e) => setSettings({ ...settings, referral_type: e.target.value })}>
                <option value="fixed">Valor fixo (R$)</option>
                <option value="percent">Percentual (%)</option>
              </Select>
            </Field>
            <Field label={settings.referral_type === 'fixed' ? 'Valor (R$)' : 'Percentual (%)'}>
              <input type="number" step="0.01" value={settings.referral_value} onChange={(e) => setSettings({ ...settings, referral_value: Number(e.target.value) })}
                className="w-full h-12 px-4 rounded-2xl border border-slate-200 text-[15px] focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
            </Field>
            <div className="flex items-end gap-3 pb-1">
              <Toggle checked={settings.referral_first_only} onChange={(v) => setSettings({ ...settings, referral_first_only: v })} />
              <span className="text-sm font-semibold text-slate-700">Apenas no primeiro pagamento</span>
            </div>
          </div>
          <Button className="mt-4" onClick={saveSettings}>Salvar regras</Button>
        </Card>
      )}

      {/* ---- Meta de indicações ---- */}
      <Card className="p-6 mb-6 border-amber-200 bg-amber-50/40">
        <h2 className="font-extrabold text-ink mb-1 flex items-center gap-2"><Gift size={18} className="text-amber-500" /> Meta de indicações</h2>
        <p className="text-xs text-sub mb-4">Quando o profissional atingir a meta, ele solicita o prêmio e você paga via PIX (até 7 dias).</p>
        <div className="grid sm:grid-cols-3 gap-4 mb-4">
          <Field label="Indicações para bater a meta">
            <input type="number" min="1" value={goalCfg.referral_goal_count}
              onChange={(e) => setGoalCfg({ ...goalCfg, referral_goal_count: Number(e.target.value) })}
              className="w-full h-12 px-4 rounded-2xl border border-slate-200 text-[15px] focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
          </Field>
          <Field label="Prêmio (R$)">
            <input type="number" step="0.01" min="0" value={goalCfg.referral_goal_amount}
              onChange={(e) => setGoalCfg({ ...goalCfg, referral_goal_amount: Number(e.target.value) })}
              className="w-full h-12 px-4 rounded-2xl border border-slate-200 text-[15px] focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
          </Field>
          <Field label="Seu WhatsApp (recebe o pedido de PIX)">
            <input type="tel" value={goalCfg.master_whatsapp} placeholder="61 99999-9999"
              onChange={(e) => setGoalCfg({ ...goalCfg, master_whatsapp: e.target.value })}
              className="w-full h-12 px-4 rounded-2xl border border-slate-200 text-[15px] focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
          </Field>
        </div>
        <Button onClick={saveGoal}>Salvar meta</Button>

        {/* Solicitações de PIX */}
        {claims.length > 0 && (
          <div className="mt-6">
            <h3 className="font-extrabold text-ink mb-3 flex items-center gap-2"><PartyPopper size={16} className="text-amber-500" /> Solicitações de prêmio</h3>
            <div className="space-y-2">
              {claims.map((c) => (
                <Card key={c.id} className="p-4 flex items-center gap-3 bg-white">
                  <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-600 grid place-items-center font-extrabold text-xs shrink-0">
                    {(c.profiles?.name ?? '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-ink truncate">{c.profiles?.name ?? c.user_id.slice(0, 8)}</p>
                    <p className="text-xs text-slate-400">
                      {c.referral_count} indicações · {brl(Number(c.reward_amount))} · {fmtDateTime(c.created_at)}
                    </p>
                  </div>
                  {c.status === 'pago' ? (
                    <Badge className="bg-brand-50 text-brand-700">Pago {c.paid_at ? `· ${fmtDate(c.paid_at)}` : ''}</Badge>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => markGoalPaid(c)}>Marcar como pago</Button>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Bateram a meta e ainda não pediram */}
        {reachedNoClaim.length > 0 && (
          <div className="mt-5">
            <h3 className="font-extrabold text-ink mb-3">Bateram a meta · aguardando solicitação</h3>
            <div className="flex flex-wrap gap-2">
              {reachedNoClaim.map((id) => (
                <span key={id} className="inline-flex items-center gap-1.5 rounded-full bg-white border border-amber-200 px-3 py-1.5 text-xs font-bold text-ink">
                  <Phone size={12} className="text-amber-500" />
                  {id.slice(0, 8)} · {refCounts[id]} indicações
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h2 className="font-extrabold text-ink mb-3">Indicações ({referrals.length})</h2>
          {loading ? <p className="text-sm text-sub">Carregando...</p> : referrals.length === 0 ? (
            <Empty title="Nenhuma indicação" />
          ) : (
            <div className="space-y-2">
              {referrals.map((r) => (
                <Card key={r.id} className="p-4 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-ink truncate">{r.referrer_id.slice(0, 8)} → {r.invited_id.slice(0, 8)}</p>
                    <p className="text-xs text-slate-400">{fmtDate(r.created_at)}</p>
                  </div>
                  <Badge className={cx(r.status === 'convertido' ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-700')}>
                    {r.status === 'convertido' ? 'Convertida' : 'Pendente'}
                  </Badge>
                </Card>
              ))}
            </div>
          )}
        </div>
        <div>
          <h2 className="font-extrabold text-ink mb-3">Comissões ({commissions.length}) · disponível {brl(disponivel)}</h2>
          {commissions.length === 0 ? (
            <Empty title="Nenhuma comissão" />
          ) : (
            <div className="space-y-2">
              {commissions.map((c) => (
                <Card key={c.id} className="p-4 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-ink">{brl(c.amount)}</p>
                    <p className="text-xs text-slate-400">{fmtDate(c.created_at)} · {c.type}</p>
                  </div>
                  {c.status === 'disponivel' ? (
                    <Button size="sm" variant="secondary" onClick={() => markPaid(c)}>Marcar paga</Button>
                  ) : (
                    <Badge className={cx(c.status === 'paga' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500')}>{c.status}</Badge>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
