import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Check, Share2, Users, Clock, BadgeCheck, DollarSign, Gift, PartyPopper, Send } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Badge, Button, Card, Empty, PageHeader, Stat, cx } from '../../components/ui';
import { waIntlDigits } from '../../components/PhoneInput';
import { brl, fmtDate, fmtDateTime } from '../../lib/utils';

type Referral = { id: string; status: string; created_at: string; invited_id: string; profiles: { name: string } | null };
type Commission = { id: string; amount: number; type: string; status: string; created_at: string; paid_at: string | null };
type GoalClaim = { id: string; referral_count: number; reward_amount: number; status: string; created_at: string; paid_at: string | null };
type AppSettings = { referral_goal_count: number; referral_goal_amount: number; master_whatsapp: string | null };

export default function Indicacoes() {
  const { profile, session, toast } = useApp();
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [goalClaim, setGoalClaim] = useState<GoalClaim | null>(null);
  const [goalCfg, setGoalCfg] = useState<AppSettings>({ referral_goal_count: 10, referral_goal_amount: 100, master_whatsapp: null });
  const [requesting, setRequesting] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    const [r, c, g, s] = await Promise.all([
      supabase.from('referrals').select('*, profiles!referrals_invited_id_fkey(name)').eq('referrer_id', profile.id).order('created_at', { ascending: false }),
      supabase.from('referral_commissions').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }),
      supabase.from('referral_goal_claims').select('*').eq('user_id', profile.id).maybeSingle(),
      supabase.from('app_settings').select('referral_goal_count, referral_goal_amount, master_whatsapp').eq('id', 1).single(),
    ]);
    setReferrals((r.data ?? []) as Referral[]);
    setCommissions((c.data ?? []) as Commission[]);
    setGoalClaim((g.data as GoalClaim) ?? null);
    if (s.data) setGoalCfg(s.data as unknown as AppSettings);
  }, [profile]);
  useEffect(() => { load(); }, [load]);

  const link = profile ? `${window.location.origin}/?ref=${profile.referral_code}` : '';
  const shareText = encodeURIComponent(`Conheça o Agenda Logo — o sistema que organiza a sua agenda e o seu negócio! ${link}`);

  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    toast('success', 'Link copiado!');
    setTimeout(() => setCopied(false), 2000);
  };

  const converted = referrals.filter((r) => r.status === 'convertido').length;
  const gerada = commissions.reduce((s, c) => s + c.amount, 0);
  const disponivel = commissions.filter((c) => c.status === 'disponivel').reduce((s, c) => s + c.amount, 0);
  const paga = commissions.filter((c) => c.status === 'paga').reduce((s, c) => s + c.amount, 0);

  // ---- Meta de indicações ----
  const goal = goalCfg.referral_goal_count || 10;
  const reward = Number(goalCfg.referral_goal_amount) || 100;
  const goalPct = Math.min(100, Math.round((referrals.length / goal) * 100));
  const goalReached = referrals.length >= goal;

  const requestPix = async () => {
    if (!goalReached || goalClaim) return;
    setRequesting(true);
    const { data, error } = await supabase
      .from('referral_goal_claims')
      .insert({ user_id: profile!.id, referral_count: referrals.length, reward_amount: reward })
      .select('id')
      .single();
    setRequesting(false);
    if (error) { toast('error', 'Erro ao registrar: ' + error.message); return; }
    toast('success', 'Solicitação registrada! PIX liberado em até 7 dias.');
    load();
    const num = goalCfg.master_whatsapp ? waIntlDigits(goalCfg.master_whatsapp) : '';
    const msg = encodeURIComponent(
      `Olá! Bati a meta de indicações no Agenda Logo (${referrals.length} indicações) e quero solicitar meu PIX de ${brl(reward)}.\nNome: ${profile?.name ?? '-'}\nE-mail: ${session?.user?.email ?? '-'}`,
    );
    if (num) window.open(`https://wa.me/${num}?text=${msg}`, '_blank');
  };

  return (
    <div className="fade-up max-w-3xl">
      <PageHeader title="Indique e ganhe" subtitle="Convide profissionais e ganhe comissões" />

      <Card className="p-6 mb-5 bg-gradient-to-br from-brand-600 to-brand-700 text-white border-0">
        <p className="text-sm font-bold text-brand-100 uppercase tracking-wide">Seu link exclusivo</p>
        <div className="mt-3 flex items-center gap-2 bg-white/15 rounded-2xl px-4 py-3">
          <span className="text-sm font-bold truncate flex-1">{link}</span>
          <button onClick={copy} className="p-2 rounded-xl hover:bg-white/20 transition">
            {copied ? <Check size={17} /> : <Copy size={17} />}
          </button>
        </div>
        <a href={`https://wa.me/?text=${shareText}`} target="_blank" rel="noreferrer" className="mt-3 inline-flex">
          <Button variant="secondary" className="!bg-white !text-brand-700 hover:!bg-brand-50">
            <Share2 size={16} /> Compartilhar no WhatsApp
          </Button>
        </a>
        <p className="text-xs text-brand-100 mt-4">
          Quando alguém se cadastrar pelo seu link e assinar um plano, você ganha comissão automaticamente.
        </p>
      </Card>

      {/* ---- Barra da meta: X indicações = R$ Y ---- */}
      <Card className={cx('p-5 mb-5 border', goalReached ? 'bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200' : 'bg-white')}>
        <div className="flex items-center gap-3 mb-3">
          <div className={cx('w-10 h-10 rounded-2xl grid place-items-center shrink-0', goalReached ? 'bg-amber-400 text-white' : 'bg-amber-50 text-amber-600')}>
            {goalReached ? <PartyPopper size={20} /> : <Gift size={20} />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-ink text-sm">Meta: {goal} indicações = {brl(reward)} no PIX</p>
            <p className="text-xs text-sub -mt-0.5">
              {goalReached
                ? 'Você bateu a meta!'
                : goal - referrals.length === 1
                  ? 'Falta 1 indicação'
                  : `Faltam ${goal - referrals.length} indicações`}
            </p>
          </div>
          <span className="text-lg font-extrabold text-amber-600 shrink-0">{referrals.length}/{goal}</span>
        </div>
        <div className="h-3 rounded-full bg-amber-100 overflow-hidden mb-3">
          <div
            className={cx('h-full rounded-full transition-all duration-700', goalReached ? 'bg-gradient-to-r from-amber-400 to-amber-500' : 'bg-gradient-to-r from-brand-400 to-brand-600')}
            style={{ width: `${Math.max(4, goalPct)}%` }}
          />
        </div>
        {goalClaim ? (
          <div className="flex items-center justify-between rounded-2xl bg-white/80 border border-amber-200 px-4 py-3">
            <div>
              <p className="text-sm font-bold text-ink">
                {goalClaim.status === 'pago' ? 'Prêmio pago!' : 'Solicitação enviada'}
              </p>
              <p className="text-xs text-sub">
                {goalClaim.status === 'pago'
                  ? `Pago em ${fmtDate(goalClaim.paid_at ?? '')}`
                  : `PIX de ${brl(Number(goalClaim.reward_amount))} liberado em até 7 dias · solicitado em ${fmtDateTime(goalClaim.created_at)}`}
              </p>
            </div>
            <Badge className={goalClaim.status === 'pago' ? 'bg-brand-100 text-brand-700' : 'bg-amber-100 text-amber-700'}>
              {goalClaim.status === 'pago' ? 'Pago' : 'Em até 7 dias'}
            </Badge>
          </div>
        ) : goalReached ? (
          <Button className="w-full !bg-amber-500 hover:!bg-amber-600" loading={requesting} onClick={requestPix}>
            <Send size={16} /> Entrar em contato e pedir meu PIX
          </Button>
        ) : (
          <p className="text-xs text-sub">Continue compartilhando seu link para bater a meta e receber {brl(reward)} via PIX.</p>
        )}
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat icon={<Users size={19} />} label="Indicações" value={referrals.length} />
        <Stat icon={<BadgeCheck size={19} />} label="Convertidas" value={converted} accent="text-brand-600 bg-brand-50" />
        <Stat icon={<DollarSign size={19} />} label="Comissão gerada" value={brl(gerada)} accent="text-amber-600 bg-amber-50" />
        <Stat icon={<Clock size={19} />} label="Disponível" value={brl(disponivel)} accent="text-blue-600 bg-blue-50" />
      </div>

      {referrals.length === 0 && commissions.length === 0 ? (
        <Empty icon={<Share2 size={28} />} title="Nenhuma indicação ainda" subtitle="Compartilhe seu link e comece a ganhar." />
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          <div>
            <h3 className="font-extrabold text-ink mb-3">Indicações</h3>
            <div className="space-y-2">
              {referrals.map((r) => (
                <Card key={r.id} className="p-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center font-extrabold text-slate-500 text-sm">
                    {(r.profiles?.name ?? '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-ink truncate">{r.profiles?.name ?? 'Usuário'}</p>
                    <p className="text-xs text-slate-400">{fmtDate(r.created_at)}</p>
                  </div>
                  <Badge className={r.status === 'convertido' ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-700'}>
                    {r.status === 'convertido' ? 'Convertida' : 'Pendente'}
                  </Badge>
                </Card>
              ))}
            </div>
          </div>
          <div>
            <h3 className="font-extrabold text-ink mb-3">Comissões</h3>
            <div className="space-y-2">
              {commissions.map((c) => (
                <Card key={c.id} className="p-4 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-ink">{brl(c.amount)}</p>
                    <p className="text-xs text-slate-400">{fmtDate(c.created_at)} · {c.type === 'primeira' ? 'primeiro pagamento' : 'recorrente'}</p>
                  </div>
                  <Badge className={cx(c.status === 'paga' ? 'bg-brand-50 text-brand-700' : c.status === 'disponivel' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500')}>
                    {c.status === 'paga' ? 'Paga' : c.status === 'disponivel' ? 'Disponível' : 'Pendente'}
                  </Badge>
                </Card>
              ))}
              {commissions.length === 0 && <p className="text-sm text-slate-400">Nenhuma comissão gerada ainda.</p>}
              {paga > 0 && <p className="text-xs text-slate-400 font-bold pt-2">Total já pago: {brl(paga)}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
