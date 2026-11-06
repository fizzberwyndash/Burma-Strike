import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Coins, Crosshair, Heart, LockKeyhole, RotateCcw, Shield, ShoppingBag, X } from 'lucide-react';
import { SHOP_ITEMS } from '../game/catalog';
import type { ShopItemId } from '../game/catalog';
import type { EconomySnapshot } from '../game/economy';
import { WEAPONS } from '../game/weapons';
import type { WeaponId } from '../game/weapons';
import WeaponPreview from './WeaponPreview';
import { useI18n } from '../i18n';

interface BuyMenuProps {
  active?: boolean;
  objectiveMode?: boolean;
  objectiveStatus?: string;
  snapshot: EconomySnapshot | null;
  onClose: () => void;
  onBuy: (id: string) => void;
  onSell: (id: string) => void;
  onEquip: (id: WeaponId) => void;
  onStartDrill: () => void;
  onStartRound: () => void;
  onFinishRound: (outcome: 'win' | 'loss') => void;
  onNewRound: () => void;
  onTestDamage: () => void;
}
const categories = ['All', 'Pistols', 'SMGs', 'Rifles', 'Snipers', 'Armor'] as const;
const credits = (amount: number) => new Intl.NumberFormat('en-US').format(amount);

/** Presentation only: all purchase, credit and armor changes go through the practice authority. */
export default function BuyMenu({ snapshot, onClose, onBuy, onSell, onEquip, onStartDrill, onStartRound, onFinishRound, onNewRound, onTestDamage, objectiveMode = false, objectiveStatus, active = true }: BuyMenuProps) {
  const { t } = useI18n();
  const [category, setCategory] = useState<(typeof categories)[number]>('All');
  const [selectedId, setSelectedId] = useState<ShopItemId>('pistol');
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;
  useEffect(() => {
    if (!active) return;
    closeRef.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCallback.current(); }
      if (event.code === 'Tab') {
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.buy-menu button:not([disabled])'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (buttons.length) { event.preventDefault(); buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [active]);
  const selected = SHOP_ITEMS.find(item => item.id === selectedId) ?? SHOP_ITEMS[0];
  const weapon = selected.weaponId ? WEAPONS[selected.weaponId] : null;
  const selectedOwned = !!snapshot && (selected.weaponId ? snapshot.ownedWeapons.includes(selected.weaponId) : snapshot.armor >= (selected.armorPoints ?? 0));
  const selectedEquipped = selected.weaponId ? snapshot?.equipped === selected.weaponId : snapshot?.armorType === selected.id && snapshot.armor > 0;
  const refundable = snapshot?.refundable.includes(selected.id) ?? false;
  const armorReceiptConflict = !!snapshot && !selected.weaponId && snapshot.refundable.some(id => id === 'light-armor' || id === 'heavy-armor') && !snapshot.refundable.includes(selected.id);
  const canBuy = !!snapshot && snapshot.phase === 'buy' && !selectedOwned && !armorReceiptConflict && snapshot.credits >= selected.price;
  const visible = SHOP_ITEMS.filter(item => category === 'All' || item.category === category);
  const phaseLabel = snapshot ? snapshot.phase === 'buy' ? 'BUY PHASE' : snapshot.phase === 'live' ? 'ROUND LIVE' : 'ROUND COMPLETE' : 'FREE RANGE CATALOG';

  function chooseCategory(next: (typeof categories)[number]) {
    setCategory(next);
    const first = SHOP_ITEMS.find(item => next === 'All' || item.category === next);
    if (first) setSelectedId(first.id);
  }

  return <div className="buy-overlay">
    <section className="buy-menu" role="dialog" aria-modal="true" aria-labelledby="shop-title">
      <header className="buy-header">
        <div className="buy-title-block"><span className="shop-monogram"><ShoppingBag size={23} strokeWidth={1.3} /></span><div><span className="shop-eyebrow">{t('BAGAN OLD CITY / QUARTERMASTER')}</span><h2 id="shop-title">{t('THE ARMORY')}<span>.</span></h2></div></div>
        <div className="shop-wallet"><Coins size={18} /><div><small>{t('AVAILABLE CREDITS')}</small><strong>{snapshot ? credits(snapshot.credits) : '—'}<span>/ 9,000</span></strong></div></div>
        <button ref={closeRef} className="shop-close" aria-label={t('Close shop')} onClick={onClose}><X size={21} /><kbd>ESC</kbd></button>
      </header>
      <div className={`shop-phase ${snapshot?.phase ?? 'catalog'}`}><span><i />{t(objectiveMode ? objectiveStatus ?? phaseLabel : phaseLabel)}{snapshot && <b>{t('ROUND {round}', { round: String(snapshot.round).padStart(2,'0') })}</b>}</span><small>{t(objectiveMode ? 'ROYAL SIGNAL CORE · LOCAL OBJECTIVE SANDBOX' : snapshot ? 'LOCAL ECONOMY DRILL · NO MULTIPLAYER SERVER' : 'FREE ARSENAL · START A LOCAL DRILL TO TEST PURCHASES')}</small></div>
      <nav className="shop-categories" aria-label={t('Shop categories')}>{categories.map((name, index) => <button key={name} className={category === name ? 'active' : ''} aria-pressed={category === name} onClick={() => chooseCategory(name)}><span>0{index + 1}</span>{t(name)}</button>)}</nav>
      <div className="shop-body">
        <section className="shop-catalog" aria-label={t('{category} equipment', { category: t(category) })}>
          <div className="shop-section-label"><span>{t('FIELD EQUIPMENT')}</span><small>{t('{count} ITEMS AVAILABLE', { count: visible.length })}</small></div>
          <div className="shop-grid">{visible.map(item => {
            const gun = item.weaponId ? WEAPONS[item.weaponId] : null;
            const owned = snapshot ? item.weaponId ? snapshot.ownedWeapons.includes(item.weaponId) : snapshot.armorType === item.id && snapshot.armor > 0 : true;
            const equipped = item.weaponId ? snapshot?.equipped === item.weaponId : snapshot?.armorType === item.id && snapshot.armor > 0;
            return <button type="button" key={item.id} className={`shop-card ${selected.id === item.id ? 'selected' : ''} ${owned ? 'owned' : ''}`} aria-label={t('Select {item}', { item: t(item.name) })} aria-pressed={selected.id === item.id} onClick={() => setSelectedId(item.id)}>
              <div className="shop-card-top"><span>{t(item.category)}</span><strong><Coins size={10} />{credits(item.price)}</strong></div>
              <WeaponPreview kind={gun?.kind ?? 'armor'} armorPoints={item.armorPoints} className="shop-card-preview" />
              <div className="shop-card-name"><strong>{t(item.name)}</strong>{owned && <Check size={13} />}</div>
              <div className="shop-card-bottom"><span>{t(equipped ? 'EQUIPPED' : owned ? snapshot ? 'OWNED' : 'FREE RANGE' : 'NOT OWNED')}</span><small>{gun ? t('{damage} DMG · {rounds} RDS', { damage: gun.damage, rounds: gun.magazineSize }) : t('{points} ARMOR POINTS', { points: item.armorPoints ?? 0 })}</small></div>
            </button>;
          })}</div>
          <div className="shop-catalog-note"><Shield size={14} /><span>{t('Permanent kit: LOTUS EDGE tactical knife. Credits and gear changes belong to this local Practice session.')}</span></div>
        </section>
        <aside className="shop-detail" aria-label={t('Selected equipment details')}>
          <div className="shop-detail-eyebrow"><span>{t(selected.category)}</span><span>{!snapshot ? t('FREE RANGE') : selectedEquipped ? `● ${t('EQUIPPED')}` : selectedOwned ? `✓ ${t('OWNED')}` : t('FIELD READY')}</span></div>
          <div className="shop-feature-preview"><WeaponPreview kind={weapon?.kind ?? 'armor'} armorPoints={selected.armorPoints} /><span className="shop-preview-label">{t('ORIGINAL FIELD EQUIPMENT')}</span></div>
          <h3>{t(selected.name)}</h3><p>{t(selected.description)}</p>
          {weapon ? <dl className="shop-stats"><div><dt>{t('DAMAGE')} <small>{t('BODY / HEAD')}</small></dt><dd>{weapon.damage} <span>/ {weapon.headDamage}</span></dd></div><div><dt>{t('FIRE RATE')}</dt><dd>{Math.round(60 / weapon.fireInterval)} <span>{t('RPM')}</span></dd></div><div><dt>{t('MAGAZINE')}</dt><dd>{weapon.magazineSize} <span>{t('ROUNDS')}</span></dd></div><div><dt>{t('RANGE')}</dt><dd>{weapon.range} <span>{t('METERS')}</span></dd></div></dl> : <dl className="shop-stats"><div><dt>{t('ARMOR CAPACITY')}</dt><dd>{selected.armorPoints} <span>{t('POINTS')}</span></dd></div><div><dt>{t('DAMAGE ABSORPTION')}</dt><dd>60<span>{t('% UNTIL DEPLETED')}</span></dd></div><div><dt>{t('PROTECTION')}</dt><dd><span>{t('HP DAMAGE EXCEEDS ABSORPTION')}</span></dd></div></dl>}
          <div className="shop-purchase">
            <div className="shop-price"><span>{t('REQUISITION COST')}</span><strong><Coins size={17} />{credits(selected.price)}</strong></div>
            {snapshot ? <>
              <button className="shop-buy-button" disabled={!canBuy} onClick={() => onBuy(selected.id)}>{selectedOwned ? <Check size={17} /> : snapshot.phase !== 'buy' ? <LockKeyhole size={16} /> : <ShoppingBag size={16} />}<span>{snapshot.phase !== 'buy' ? t('BUY PHASE ONLY') : armorReceiptConflict ? t('REFUND CURRENT ARMOR FIRST') : selectedOwned ? t('ALREADY OWNED') : snapshot.credits < selected.price ? t('NEED {amount} MORE CREDITS', { amount: credits(selected.price - snapshot.credits) }) : t('PURCHASE & EQUIP')}</span>{canBuy && <ArrowRight size={17} />}</button>
              <div className="shop-item-actions"><button disabled={!refundable || snapshot.phase !== 'buy'} onClick={() => onSell(selected.id)}><RotateCcw size={13} />{refundable ? t('REFUND {amount}', { amount: credits(selected.price) }) : t('NO REFUND AVAILABLE')}</button>{selected.weaponId && snapshot.ownedWeapons.includes(selected.weaponId) && <button disabled={selectedEquipped} onClick={() => onEquip(selected.weaponId!)}><Crosshair size={13} />{t(selectedEquipped ? 'EQUIPPED' : 'EQUIP OWNED')}</button>}</div>
              <small className="shop-refund-note">{t('Full refunds apply only to purchases made in this buy phase. Starting the round locks them.')}</small>
            </> : <button className="shop-buy-button" onClick={onStartDrill}><ShoppingBag size={16} /><span>{t('START ECONOMY DRILL')}</span><ArrowRight size={17} /></button>}
          </div>
        </aside>
      </div>
      <footer className="shop-footer">
        <div className="shop-live-status" role="status" aria-live="polite"><span className="shop-status-dot" /><div><strong>{t(snapshot?.lastMessage || (snapshot ? 'Build your kit. Start the round when ready.' : 'Catalog preview. Your free Practice arsenal is unchanged.'))}</strong><small>{t(snapshot ? 'WIN +3,000 · LOSS +1,900 · ELIMINATION +200' : 'LOCAL TESTING ONLY · NO ONLINE TRANSACTIONS')}</small></div></div>
        {snapshot && <div className="shop-round-controls"><span className="shop-health-status" aria-label={t('Health {health}, armor {armor}', { health: Math.ceil(snapshot.health), armor: Math.ceil(snapshot.armor) })}><Heart size={12} />{Math.ceil(snapshot.health)}<Shield size={12} />{Math.ceil(snapshot.armor)}</span>{objectiveMode ? <span className="shop-objective-clock">{t(objectiveStatus ?? '')}</span> : snapshot.phase === 'buy' ? <button className="shop-round-primary" onClick={onStartRound}>{t('START ROUND')} <ArrowRight size={16} /></button> : snapshot.phase === 'live' ? <><button className="shop-damage-test" onClick={onTestDamage}>{t('TEST 40 DAMAGE')}</button><button onClick={() => onFinishRound('loss')}>{t('SIMULATE LOSS')}</button><button className="shop-round-primary" onClick={() => onFinishRound('win')}>{t('SIMULATE WIN')}</button></> : <button className="shop-round-primary" onClick={onNewRound}>{t('NEXT ROUND')} <ArrowRight size={16} /></button>}</div>}
      </footer>
    </section>
  </div>;
}
