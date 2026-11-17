import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Bell, Box, Crown, Gift, Heart, HelpCircle, Home, Package, Search, ShieldCheck, ShoppingBag, Star, User, Wallet } from 'lucide-react';

declare global { interface Window { Telegram?: { WebApp?: any } } }
const API = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
type Listing = { id:number; category:string; title:string; description:string; price_day:number|null; price_week:number|null; price_month:number|null; fixed_price:number|null; currency:string; is_featured:number; media:string[]; public_identifier?:string };
const cats = [{id:'all',name:'Все',icon:'✦'},{id:'gifts',name:'NFT Gifts',icon:'🎁'},{id:'usernames',name:'Юзернеймы',icon:'👤'},{id:'numbers',name:'Номера',icon:'📱'},{id:'stars',name:'Stars',icon:'⭐'},{id:'premium',name:'Premium',icon:'💎'}];
const money = (v:number|null|undefined,c='XTR') => v == null ? 'По запросу' : `${v} ${c}`;
function initData(){ return window.Telegram?.WebApp?.initData || ''; }
async function api(path:string, options:RequestInit={}) {
  const r=await fetch(`${API}${path}`,{...options,headers:{'Content-Type':'application/json','X-Telegram-Init-Data':initData(),...(options.headers||{})}});
  const d=await r.json(); if(!r.ok) throw new Error(d.error||'Ошибка запроса'); return d;
}
export default function App(){
  const [list,setList]=useState<Listing[]>([]),[category,setCategory]=useState('all'),[query,setQuery]=useState(''),[tab,setTab]=useState('market'),[orders,setOrders]=useState<any[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const tg=window.Telegram?.WebApp;
  useEffect(()=>{tg?.ready();tg?.expand(); if(tg?.themeParams) document.documentElement.style.setProperty('--tg-bg',tg.themeParams.bg_color||'#0B0D14');},[]);
  async function load(){try{setError('');const d=await api(`/api/listings${category==='all'?'':`?category=${category}`}`);setList(d.listings||[]);}catch(e:any){setError(e.message);}}
  useEffect(()=>{load();},[category]);
  const shown=useMemo(()=>list.filter(x=>!query||x.title.toLowerCase().includes(query.toLowerCase())),[list,query]);
  async function createOrder(item:Listing){
    if(busy)return;setBusy(true);
    try{
      const days=['gifts','usernames','numbers'].includes(item.category)?30:null;
      const d=await api('/api/orders',{method:'POST',body:JSON.stringify({listingId:item.id,termDays:days,idempotencyKey:crypto.randomUUID()})});
      if(d.paymentUrl) tg?.openLink(d.paymentUrl); else tg?.showAlert?.('Заявка создана. Администратор свяжется с вами.');
    }catch(e:any){tg?.showAlert?.(e.message);setError(e.message);}finally{setBusy(false);}
  }
  async function loadOrders(){try{const d=await api('/api/orders');setOrders(d.orders||[]);}catch(e:any){setError(e.message);}}
  useEffect(()=>{if(tab==='orders')loadOrders();},[tab]);
  return <div className="app">
    <header><div className="brand"><div className="logo">P</div><div><b>PRESTIGE</b><small>MARKET</small></div></div><button className="iconbtn" onClick={()=>tg?.showAlert?.('Уведомления Prestige Market')}><Bell size={19}/></button></header>
    {tab==='market'&&<>
      <section className="hero"><div className="eyebrow">PRIVATE DIGITAL MARKETPLACE</div><h1>Коллекционное.<br/><span>Особенное.</span></h1><p>Подарки, юзернеймы и цифровые предложения в одном месте.</p><button className="primary" onClick={()=>document.getElementById('catalog')?.scrollIntoView({behavior:'smooth'})}>Открыть маркет <ArrowRight size={17}/></button><div className="orb orb1"/><div className="orb orb2"/></section>
      <div className="sectionhead"><div><small>DISCOVER</small><h2>Категории</h2></div></div>
      <div className="categories">{cats.map(c=><button key={c.id} className={category===c.id?'cat active':'cat'} onClick={()=>setCategory(c.id)}><span>{c.icon}</span>{c.name}</button>)}</div>
      <div id="catalog" className="sectionhead"><div><small>CURATED COLLECTION</small><h2>Каталог</h2></div><span className="count">{shown.length} позиций</span></div>
      <div className="search"><Search size={17}/><input placeholder="Поиск товаров" value={query} onChange={e=>setQuery(e.target.value)}/></div>
      {error&&<div className="error">{error}<button onClick={load}>Повторить</button></div>}
      <div className="products">{shown.map(item=><article className="product" key={item.id}><div className="productart"><span className="articon">{item.category==='gifts'?'🎁':item.category==='stars'?'⭐':item.category==='premium'?'💎':item.category==='numbers'?'📱':'✦'}</span>{item.is_featured===1&&<label>FEATURED</label>}</div><div className="productbody"><small>{cats.find(c=>c.id===item.category)?.name}</small><h3>{item.title}</h3><p>{item.description}</p><div className="productfoot"><b>{money(item.fixed_price,item.currency)}</b><button onClick={()=>createOrder(item)} disabled={busy}>Выбрать <ArrowRight size={14}/></button></div></div></article>)}</div>
      {!shown.length&&!error&&<div className="empty">В этой категории пока нет товаров.</div>}
    </>}
    {tab==='orders'&&<section className="page"><small>YOUR ACTIVITY</small><h2>Мои заказы</h2>{orders.map(o=><div className="order" key={o.id}><b>{o.listing_title}</b><span>{o.public_id}</span><strong>{o.status}</strong><span>{o.amount} {o.currency}</span></div>)}{!orders.length&&<div className="empty">Пока заказов нет</div>}</section>}
    {tab==='profile'&&<section className="page"><small>ACCOUNT</small><h2>Профиль</h2><div className="profilecard"><User/><div><b>{tg?.initDataUnsafe?.user?.first_name||'Пользователь'}</b><span>Telegram ID: {tg?.initDataUnsafe?.user?.id||'Откройте через Telegram'}</span></div></div><div className="info"><ShieldCheck/> Ваши пароли и коды подтверждения нам не нужны. Никогда не передавайте их.</div></section>}
    {tab==='support'&&<section className="page"><small>WE ARE HERE</small><h2>Поддержка</h2><div className="info"><HelpCircle/> По вопросам заказов обратитесь к администратору через Telegram-бота.</div></section>}
    <nav>{[{id:'market',icon:Home,label:'Маркет'},{id:'orders',icon:Package,label:'Заказы'},{id:'profile',icon:User,label:'Профиль'},{id:'support',icon:HelpCircle,label:'Помощь'}].map(x=><button className={tab===x.id?'selected':''} onClick={()=>setTab(x.id)} key={x.id}><x.icon size={19}/><span>{x.label}</span></button>)}</nav>
  </div>
}
