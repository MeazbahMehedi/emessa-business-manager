import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleHelp, Clock3, Database, ExternalLink, FileText, Grid2X2, LayoutDashboard, List, LockKeyhole, LogOut, Menu, Package, PlugZap, RefreshCw, Search, ShieldCheck, ShoppingBag, Sparkles, Wallet, X } from 'lucide-react';
import type { Bootstrap, ConnectionData, Invoice, Product, SessionView, WorkspaceData } from '../shared/types';
import { overview, statusClass } from '../shared/types';
import { api, ApiError } from './api';
import {InventoryManager} from './InventoryManager';
import type {InventoryConnection} from '../shared/inventory-api';

const currency = (value:number|null,whole=false) => value===null?'—':new Intl.NumberFormat('en-BD',{style:'currency',currency:'BDT',maximumFractionDigits:whole?0:3}).format(value);
const count = (value:number) => new Intl.NumberFormat('en').format(value);
const shortDate = (date:string) => date?new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short'}):'—';
function useRoute(){
  const [url,setUrl]=useState(()=>new URL(window.location.href));
  useEffect(()=>{const pop=()=>setUrl(new URL(window.location.href));window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
  const navigate=useCallback((path:string)=>{window.history.pushState(null,'',path);setUrl(new URL(window.location.href));window.scrollTo({top:0});},[]);
  return {url,navigate};
}
type Navigate=(path:string)=>void;
function NavLink({to,navigate,children,className=''}:{to:string;navigate:Navigate;children:ReactNode;className?:string}){
  return <a href={to} className={className} onClick={e=>{if(!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&e.button===0){e.preventDefault();navigate(to);}}}>{children}</a>;
}
function Mark({light=false}:{light?:boolean}){return <div className={'brand '+(light?'brand-light':'')}><span className="brand-symbol" aria-hidden="true">e</span><span>emessa<span className="brand-dot">.</span></span></div>;}
function Badge({children,status}:{children:ReactNode;status?:string}){return <span className={'badge '+statusClass(status||String(children))}><span className="badge-dot"/>{children}</span>;}
function Empty({title,detail,action}:{title:string;detail:string;action?:ReactNode}){return <div className="empty-state"><div className="empty-icon"><Database size={24}/></div><h3>{title}</h3><p>{detail}</p>{action}</div>;}
function Alert({children}:{children:ReactNode}){return <div className="alert" role="alert"><CircleAlert size={18}/><div>{children}</div></div>;}
function Spinner({label='Loading workspace'}:{label?:string}){return <div className="loading-state" role="status"><RefreshCw className="spin" size={23}/><span>{label}</span></div>;}

export default function App(){
  const route=useRoute();
  const [bootstrap,setBootstrap]=useState<Bootstrap|null>(null);
  const [user,setUser]=useState<SessionView|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  const initialize=useCallback(async()=>{
    setLoading(true);setError('');
    const [boot,session]=await Promise.allSettled([api<Bootstrap>('/auth/bootstrap'),api<SessionView>('/api/v1/me')]);
    if(boot.status==='fulfilled')setBootstrap(boot.value);else setError(boot.reason.message||'The workspace could not be reached.');
    if(session.status==='fulfilled')setUser(session.value);
    else{setUser(null);if(!(session.reason instanceof ApiError && session.reason.status===401))setError(session.reason.message||'Could not check your session.');}
    setLoading(false);
  },[]);
  useEffect(()=>{void initialize();},[initialize]);
  if(loading)return <div className="boot-screen"><Mark/><Spinner/></div>;
  if(!user)return <Login bootstrap={bootstrap} error={error|| (route.url.searchParams.has('error')?'Sign-in could not be completed. Use your authorized admin account and try again.':'')} onLogin={initialize} onRetry={initialize}/>;
  return <Workspace key={user.email||'sample'} user={user} route={route} onUnauthorized={()=>{setUser(null);route.navigate('/login');}}/>;
}

function Login({bootstrap,error,onLogin,onRetry}:{bootstrap:Bootstrap|null;error:string;onLogin:()=>Promise<void>;onRetry:()=>Promise<void>}){
  const [busy,setBusy]=useState(false),[localError,setLocalError]=useState('');
  async function preview(){setBusy(true);setLocalError('');try{await api('/auth/local-preview',{method:'POST',headers:{'x-emessa-preview':'1'}});window.history.replaceState(null,'','/overview');await onLogin();}catch(e){setLocalError((e as Error).message);}finally{setBusy(false);}}
  return <div className="login-layout">
    <section className="login-story"><Mark light/><div className="login-story-copy"><span className="eyebrow light">A LITTLE CLARITY, EVERY DAY</span><h1>Your business.<br/>One clear view.</h1><p>A private place for your products, orders, and the numbers behind them. Connected to the Sheets you already use.</p>
      <div className="login-illustration" aria-hidden="true"><div className="illustration-top"><span className="mini-square"/><span>Business overview</span><span className="mini-status">Private</span></div><div className="illustration-body"><div><span className="mini-label">EVERYTHING IN ITS PLACE</span><strong>Room to grow.</strong><div className="mini-lines"><i/><i/><i/><i/><i/><i/><i/><i/><i/></div></div><div className="mini-summary"><Package/><span>Products & stock</span><FileText/><span>Orders & invoices</span><Database/><span>Your Google Sheets</span></div></div></div>
    </div><div className="login-story-footer"><ShieldCheck size={16}/><span>Private workspace. Familiar records.</span></div></section>
    <main className="login-main"><span className="login-top-note">EMESSA BUSINESS MANAGER</span><div className="login-card"><div className="login-lock"><LockKeyhole size={25}/></div><span className="eyebrow">ADMIN ACCESS</span><h2>Welcome to your<br/>workspace.</h2><p>Sign in with the Google account authorized to manage your business.</p>
      {(error||localError)&&<Alert>{localError||error}</Alert>}
      <a className={'button button-dark google-button '+(!bootstrap?.googleLoginAvailable?'disabled':'')} href={bootstrap?.googleLoginAvailable?'/auth/start':undefined} aria-disabled={!bootstrap?.googleLoginAvailable}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.3ZM12 22c2.7 0 5-.9 6.6-2.5l-3.2-2.5c-.9.6-2 .9-3.4.9-2.6 0-4.8-1.8-5.6-4.2H3.1v2.6A10 10 0 0 0 12 22ZM6.4 13.7a6 6 0 0 1 0-3.4V7.7H3.1a10 10 0 0 0 0 8.6l3.3-2.6ZM12 6.1c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.5 9.5 0 0 0 12 2a10 10 0 0 0-8.9 5.7l3.3 2.6A6 6 0 0 1 12 6.1Z"/></svg>
        Continue with Google<ArrowRight size={17}/></a>
      {!bootstrap?.googleLoginAvailable&&<p className="setup-note">Google sign-in is waiting for your admin account setup.</p>}
      {bootstrap?.localPreviewAvailable&&<><div className="or-divider"><span>OR TAKE A LOOK AROUND</span></div><button className="button button-outline preview-button" onClick={preview} disabled={busy}>{busy?<RefreshCw size={17} className="spin"/>:<Sparkles size={17}/>}Explore sample workspace<ArrowUpRight size={17}/></button><p className="sample-caption">Local preview · Synthetic data · Read-only</p></>}
      {!bootstrap&&<button className="text-button" onClick={()=>void onRetry()}>Try connecting again</button>}
      <div className="login-privacy"><ShieldCheck size={17}/><span>Access is restricted to your designated admin account.</span></div>
    </div><footer>Made for the way you work.</footer></main>
  </div>;
}

function Workspace({user,route,onUnauthorized}:{user:SessionView;route:ReturnType<typeof useRoute>;onUnauthorized:()=>void}){
  const [data,setData]=useState<WorkspaceData|null>(null),[health,setHealth]=useState<ConnectionData|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[menu,setMenu]=useState(false);
  const [inventory,setInventory]=useState<InventoryConnection|null>(null);
  const [search,setSearch]=useState('');
  const [selectedProduct,setSelectedProduct]=useState<Product|null>(null),[selectedInvoice,setSelectedInvoice]=useState<Invoice|null>(null);
  const lastRefresh=useRef(0),active=useRef(true);
  const section=route.url.pathname.split('/')[1]||'overview';
  const current=['overview','products','invoices','connection'].includes(section)?section:'overview';
  const titles:Record<string,string>={overview:'Overview',products:'Products & inventory',invoices:'Invoices',connection:'Connection'};
  const refresh=useCallback(async()=>{
    setBusy(true);setError('');
    const [workspace,connection,inventoryResult]=await Promise.allSettled([api<WorkspaceData>('/api/v1/workspace'),api<ConnectionData>('/api/v1/health'),api<InventoryConnection>('/api/v1/inventory')]);
    if(!active.current)return;
    if(workspace.status==='fulfilled')setData(workspace.value);
    else if(workspace.reason instanceof ApiError&&workspace.reason.status===401){onUnauthorized();return;}
    else setError(workspace.reason.message||'Records could not be loaded.');
    if(connection.status==='fulfilled')setHealth(connection.value);
    else if(connection.reason instanceof ApiError&&connection.reason.status===401){onUnauthorized();return;}
    else setHealth({state:'attention',checkedAt:new Date().toISOString(),readOnly:true,checks:[{label:'Connection check',status:'failed',detail:connection.reason.message||'The connection check failed.'}]});
    if(inventoryResult.status==='fulfilled')setInventory(inventoryResult.value);
    else {setInventory(null);if(!(inventoryResult.reason instanceof ApiError&&inventoryResult.reason.status===401))setError(inventoryResult.reason.message||'Inventory could not be loaded.');}
    setBusy(false);setLoading(false);lastRefresh.current=Date.now();
  },[onUnauthorized]);
  // One initial read, and a bounded focus refresh. No background full-sheet polling.
  useEffect(()=>{active.current=true;void refresh();return()=>{active.current=false;};},[]);
  useEffect(()=>{const focus=()=>{if(document.visibilityState==='visible'&&Date.now()-lastRefresh.current>30000&&!busy)void refresh();};window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[refresh,busy]);
  const navigate=(path:string)=>{route.navigate(path);setMenu(false);};
  async function logout(){try{await api('/auth/logout',{method:'POST',headers:{'x-csrf-token':user.csrfToken}});onUnauthorized();}catch(e){if(e instanceof ApiError&&e.status===401)onUnauthorized();else setError((e as Error).message);}}
  function globalSearch(e:FormEvent){e.preventDefault();navigate('/products?q='+encodeURIComponent(search.trim()));}
  return <div className="app-layout">
    {menu&&<button className="sidebar-backdrop" aria-label="Close navigation" onClick={()=>setMenu(false)}/>}
    <aside className={'sidebar '+(menu?'sidebar-open':'')}><div className="sidebar-brand"><Mark light/><button className="icon-button mobile-close" aria-label="Close navigation" onClick={()=>setMenu(false)}><X size={20}/></button></div>
      <div className="workspace-label"><span className="workspace-dot"/>BUSINESS WORKSPACE</div><span className="nav-caption">MANAGE</span>
      <nav aria-label="Main navigation">{[{key:'overview',label:'Overview',icon:LayoutDashboard},{key:'products',label:'Products & inventory',icon:Package},{key:'invoices',label:'Invoices',icon:FileText},{key:'connection',label:'Connection',icon:PlugZap}].map(({key,label,icon:Icon})=><NavLink key={key} to={'/'+key} navigate={navigate} className={'nav-link '+(current===key?'active':'')}><Icon size={19}/><span>{label}</span>{current===key&&<span className="nav-active-dot"/>}</NavLink>)}</nav>
      <div className="sidebar-bottom"><NavLink to="/connection" navigate={navigate} className="source-card"><div className="source-icon"><Database size={20}/></div><div><strong>{user.mode==='sample'?'Sample workspace':'Google Sheets'}</strong><span><i className={health?.state==='connected'?'dot-connected':'dot-preview'}/>{user.mode==='sample'?'Read-only preview':health?.state==='connected'?'Connected · Read-only':'Connection setup'}</span></div><ChevronRight size={16}/></NavLink>
      <div className="sidebar-private"><ShieldCheck size={15}/><span>{user.mode==='sample'?'Synthetic data only':'Private admin access'}</span><button className="icon-button" aria-label="View connection details" onClick={()=>navigate('/connection')}><CircleHelp size={17}/></button></div></div>
    </aside>
    <div className="app-body"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={()=>setMenu(true)}><Menu size={21}/></button><span>Workspace</span><ChevronRight size={14}/><strong>{titles[current]}</strong></div><div className="topbar-actions"><form className="global-search" onSubmit={globalSearch}><Search size={17}/><input aria-label="Search products" placeholder="Search products..." value={search} onChange={e=>setSearch(e.target.value)}/><kbd>↵</kbd></form><span className="topbar-divider"/><div className="user-avatar">{user.mode==='sample'?'LP':user.name.slice(0,2).toUpperCase()}</div><div className="user-label"><strong>{user.mode==='sample'?'Local preview':user.name}</strong><span>{user.mode==='sample'?'Sample workspace':'Admin'}</span></div><button className="icon-button logout" aria-label="Sign out" title="Sign out" onClick={()=>void logout()}><LogOut size={17}/></button></div></header>
    {user.mode==='sample'&&<div className="sample-banner"><Sparkles size={14}/><span><strong>Sample workspace</strong><span className="banner-separator">·</span>Read-only synthetic records. Your Google Sheets are not accessed.</span><NavLink to="/connection" navigate={navigate}>Connection details<ArrowUpRight size={13}/></NavLink></div>}
    <main className="main-content"><div className="page-heading"><div><span className="eyebrow">{current==='overview'?'YOUR BUSINESS, AT A GLANCE':current==='connection'?'YOUR RECORDS, SAFELY CONNECTED':'YOUR BUSINESS RECORDS'}</span><h1>{titles[current]}<span className="heading-dot">.</span></h1><p>{current==='overview'?'A clear view of what’s in stock and what’s moving.':current==='products'?'Your catalog, stock levels, and prices in one place.':current==='invoices'?'Follow your orders from invoice to bank receipt.':'Manage access and check your private Google Sheets connection.'}</p></div><div className="heading-actions"><span className="read-only"><LockKeyhole size={13}/>{current==='products'&&inventory?.configured&&inventory.enabled?'Inventory enabled':'Read-only'}</span><button className="button button-white refresh-button" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={15} className={busy?'spin':''}/>{busy?'Refreshing':'Refresh'}</button></div></div>
      {error&&<Alert>{error} {data&&<span>The records below are from the last successful read.</span>} <button className="text-button" onClick={()=>navigate('/connection')}>View connection</button></Alert>}
      {data?.warnings.map(w=><Alert key={w}>{w}</Alert>)}
      {loading?<Spinner label="Reading workspace records"/>:current==='connection'?<Connection health={health} user={user} inventory={inventory} busy={busy} refresh={refresh}/>:!data?<Empty title="Connect your business records" detail="Once your private Google Sheets are authorized, your products and invoices will appear here." action={<button className="button button-dark" onClick={()=>navigate('/connection')}>View connection<ArrowRight size={16}/></button>}/>:current==='overview'?<Overview data={data} health={health} navigate={navigate} onInvoice={setSelectedInvoice} onProduct={setSelectedProduct}/>:current==='products'?<InventoryManager connection={inventory} user={user} initialSearch={route.url.searchParams.get('q')||''} refresh={refresh} fallback={<Products data={data} initialSearch={route.url.searchParams.get('q')||''} onProduct={setSelectedProduct}/>}/>:<Invoices data={data} onInvoice={setSelectedInvoice}/>}
      <footer className="workspace-footer"><span><ShieldCheck size={13}/>{user.mode==='sample'?'Local sample records':'Private Google Sheets records'}</span><span>{data?'Last read '+new Date(data.asOf).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:data.timezone})+' · '+data.timezone:'Your records stay in your Google account.'}</span></footer>
    </main></div>
    {selectedProduct&&<DetailDialog title={selectedProduct.name} onClose={()=>setSelectedProduct(null)}><div className="detail-product-icon"><ShoppingBag size={34}/></div><dl className="detail-list"><dt>SKU</dt><dd>{selectedProduct.sku}</dd><dt>Category</dt><dd>{selectedProduct.category||'Uncategorized'}</dd><dt>Current stock</dt><dd>{selectedProduct.stock??'—'} units</dd><dt>Opening stock</dt><dd>{selectedProduct.openingStock??'—'} units</dd><dt>Selling price</dt><dd>{currency(selectedProduct.price)}</dd><dt>Cost per unit</dt><dd>{currency(selectedProduct.cost)}</dd></dl><p className="detail-note"><LockKeyhole size={14}/>Source values are shown read-only.</p></DetailDialog>}
    {selectedInvoice&&<DetailDialog title={selectedInvoice.number} onClose={()=>setSelectedInvoice(null)}><div className="invoice-detail-amount"><span>Invoice total</span><strong>{currency(selectedInvoice.total)}</strong></div><dl className="detail-list"><dt>Customer</dt><dd>{selectedInvoice.customer||'—'}</dd><dt>Date</dt><dd>{shortDate(selectedInvoice.date)}</dd><dt>Delivery</dt><dd><Badge>{selectedInvoice.deliveryStatus||'Unknown'}</Badge></dd><dt>Payment</dt><dd><Badge>{selectedInvoice.paymentStatus||'Unknown'}</Badge></dd><dt>Tracking</dt><dd>{selectedInvoice.tracking||'—'}</dd><dt>Expected bank credit</dt><dd>{currency(selectedInvoice.expectedCredit)}</dd><dt>Actual bank credit</dt><dd>{currency(selectedInvoice.actualCredit)}</dd></dl><p className="detail-note"><LockKeyhole size={14}/>Viewing does not change this invoice.</p></DetailDialog>}
  </div>;
}

function Overview({data,health,navigate,onInvoice,onProduct}:{data:WorkspaceData;health:ConnectionData|null;navigate:Navigate;onInvoice:(i:Invoice)=>void;onProduct:(p:Product)=>void}){
  const [days,setDays]=useState(30);const metrics=overview(data,days);
  const low=data.products.filter(p=>p.stock!==null&&p.stock<=10).sort((a,b)=>(a.stock||0)-(b.stock||0));
  return <>
    <div className="stat-grid">
      <Stat label="Stock on hand" icon={<Package size={19}/>} value={count(metrics.stock)} suffix="units" detail={data.products.length+' products in your catalog'} color="green"/>
      <Stat label="Invoice value" icon={<FileText size={19}/>} value={currency(metrics.value,true)} detail={metrics.invoices+' active invoices · last '+days+' days'} color="blue"/>
      <Stat label="Courier outstanding" icon={<Wallet size={19}/>} value={currency(metrics.receivable,true)} detail="Expected credit less bank receipts" color="sand"/>
      <Stat label="Stock needs attention" icon={<CircleAlert size={19}/>} value={String(metrics.low)} suffix="products" detail="At or below 10 units in stock" color="rose"/>
    </div>
    <div className="overview-chart-row"><section className="panel chart-panel"><div className="panel-heading"><div><h2>Invoice activity</h2><p>Active invoice value over time</p></div><div className="segment-control" aria-label="Chart period">{[7,30].map(n=><button key={n} className={days===n?'selected':''} aria-pressed={days===n} onClick={()=>setDays(n)}>{n} days</button>)}</div></div><ActivityChart series={metrics.series}/><div className="chart-caption"><span><i/>Invoice value</span><span>Excludes returned, cancelled, and voided invoices</span></div></section>
      <section className="panel connection-summary"><div className="connection-summary-top"><div className="sheets-symbol"><Database size={25}/></div><span className="mini-tag">SOURCE OF RECORD</span></div><h2>{data.mode==='sample'?'A preview of your workspace.':'Connected to your Sheets.'}</h2><p>{data.mode==='sample'?'Explore the interface with sample products and invoices. Your business records stay untouched.':'Read your existing records in one clear interface. Your Sheets remain the source of record.'}</p><div className="connection-summary-state"><span className={'status-ring '+(health?.state==='connected'?'ring-green':'')}/><div><strong>{data.mode==='sample'?'Sample data only':health?.state==='connected'?'Read connection verified':'Check source connection'}</strong><span>{data.mode==='sample'?'Google connection pending':'Read-only access'}</span></div></div><button className="button button-outline" onClick={()=>navigate('/connection')}>View connection<ArrowUpRight size={15}/></button></section>
    </div>
    <div className="overview-bottom-row"><section className="panel recent-panel"><div className="panel-heading"><div><h2>Recent invoices</h2><p>Your latest orders, in one view</p></div><button className="text-button" onClick={()=>navigate('/invoices')}>View all<ArrowRight size={14}/></button></div><InvoiceTable invoices={data.invoices.slice(0,5)} compact onInvoice={onInvoice}/></section>
      <section className="panel low-stock-panel"><div className="panel-heading"><div><h2>Keep an eye on stock</h2><p>{low.length} products need attention</p></div><span className="count-bubble">{low.length}</span></div>{low.length?<div className="low-stock-list">{low.slice(0,4).map((p,i)=><button key={p.id+'-'+i} onClick={()=>onProduct(p)}><ProductIcon index={i}/><span><strong>{p.name||p.sku}</strong><small>{p.sku}</small></span><span className={'stock-quantity '+(p.stock===0?'zero':'')}>{p.stock}<small>left</small></span></button>)}</div>:<div className="small-empty"><CheckCircle2 size={25}/><p>No low-stock products in the current source.</p></div>}<button className="low-stock-footer text-button" onClick={()=>navigate('/products')}>Review inventory<ArrowRight size={15}/></button></section>
    </div>
  </>;
}
function Stat({label,icon,value,suffix,detail,color}:{label:string;icon:ReactNode;value:string;suffix?:string;detail:string;color:string}){return <section className="stat-card"><div className="stat-card-top"><span>{label}</span><div className={'stat-icon '+color}>{icon}</div></div><div className="stat-value">{value}{suffix&&<span>{suffix}</span>}</div><p>{detail}</p></section>;}
function ActivityChart({series}:{series:{date:string;value:number}[]}){
  if(!series.length)return <div className="chart-empty"><FileText size={28}/><p>No invoice activity in this period.</p></div>;
  const w=650,h=205,l=55,r=12,t=20,b=30,max=Math.max(...series.map(s=>s.value),1)*1.2;
  const times=series.map(s=>Date.parse(s.date+'T12:00:00Z')),first=Math.min(...times),span=Math.max(...times)-first;
  const points=series.map((s,i)=>({x:l+(span?(times[i]-first)/span:0.5)*(w-l-r),y:t+(1-s.value/max)*(h-t-b),...s}));
  const line=points.map(p=>p.x+','+p.y).join(' ');
  return <figure className="activity-chart"><svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={'Invoice value across '+series.length+' activity dates'}><defs><linearGradient id="activity-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#8ebf9b" stopOpacity=".3"/><stop offset="100%" stopColor="#d8eadb" stopOpacity="0"/></linearGradient></defs>{[0,1,2,3].map(i=>{const y=t+i*(h-t-b)/3;return <g key={i}><line x1={l} y1={y} x2={w-r} y2={y} stroke="#edf0ec" strokeDasharray="4 5"/><text x={l-13} y={y+4} textAnchor="end" className="axis-label">{Math.round(max*(1-i/3))>=1000?(max*(1-i/3)/1000).toFixed(1)+'k':Math.round(max*(1-i/3))}</text></g>;})}<polygon points={`${l},${h-b} ${line} ${points.at(-1)!.x},${h-b}`} fill="url(#activity-fill)"/><polyline points={line} fill="none" stroke="#2b6b50" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round"/>{points.map((p,i)=><g key={p.date}><circle cx={p.x} cy={p.y} r="4" fill="white" stroke="#2b6b50" strokeWidth="2"><title>{shortDate(p.date)+': '+currency(p.value)}</title></circle>{(series.length<=7||i%Math.ceil(series.length/7)===0)&&<text x={p.x} y={h-5} textAnchor="middle" className="axis-label">{shortDate(p.date)}</text>}</g>)}</svg><figcaption className="sr-only">{series.map(s=>shortDate(s.date)+': '+currency(s.value)).join('; ')}</figcaption></figure>;
}
function ProductIcon({index=0}:{index?:number}){return <div className={'product-icon tone-'+index%5}><ShoppingBag size={21}/></div>;}

function Products({data,initialSearch,onProduct}:{data:WorkspaceData;initialSearch:string;onProduct:(p:Product)=>void}){
  const [q,setQ]=useState(initialSearch),[category,setCategory]=useState(''),[page,setPage]=useState(0),[grid,setGrid]=useState(false);
  useEffect(()=>{setQ(initialSearch);setPage(0);},[initialSearch]);
  const categories=[...new Set(data.products.map(p=>p.category).filter(Boolean))];
  const filtered=useMemo(()=>data.products.filter(p=>(!category||p.category===category)&&[p.name,p.sku,p.category].some(x=>x.toLowerCase().includes(q.toLowerCase()))),[data,category,q]);
  const pageCount=Math.max(1,Math.ceil(filtered.length/8)),safePage=Math.min(page,pageCount-1),rows=filtered.slice(safePage*8,safePage*8+8);
  const stockStatus=(p:Product)=>p.stock===null?'Unknown':p.stock<0?'Oversold':p.stock===0?'Out of stock':p.stock<=10?'Low stock':'In stock';
  return <section className="panel products-panel"><div className="catalog-toolbar"><div className="local-search"><Search size={17}/><input aria-label="Filter products" placeholder="Search by name or SKU..." value={q} onChange={e=>{setQ(e.target.value);setPage(0);}}/>{q&&<button className="icon-button" aria-label="Clear product search" onClick={()=>setQ('')}><X size={15}/></button>}</div><div className="view-toggle"><button className={!grid?'selected':''} aria-label="Table view" aria-pressed={!grid} onClick={()=>setGrid(false)}><List size={18}/></button><button className={grid?'selected':''} aria-label="Grid view" aria-pressed={grid} onClick={()=>setGrid(true)}><Grid2X2 size={17}/></button></div></div><div className="category-tabs"><button className={!category?'active':''} onClick={()=>{setCategory('');setPage(0);}}>All products<span>{data.products.length}</span></button>{categories.map(c=><button className={category===c?'active':''} key={c} onClick={()=>{setCategory(c);setPage(0);}}>{c}</button>)}</div>
    {!filtered.length?<Empty title="No products found" detail="Try another name, SKU, or category."/>:grid?<div className="product-grid">{rows.map((p,i)=><button className="product-grid-card" key={p.id+'-'+i} onClick={()=>onProduct(p)}><div className={'product-grid-art tone-'+i%5}><ShoppingBag size={44}/><span>{p.category||'Product'}</span></div><div className="product-grid-body"><span className="sku">{p.sku}</span><h3>{p.name||p.sku}</h3><div><strong>{currency(p.price)}</strong><Badge status={stockStatus(p)}>{p.stock??'—'} in stock</Badge></div></div></button>)}</div>:<div className="table-scroll"><table className="data-table product-table"><thead><tr><th>Product</th><th>Category</th><th>Stock</th><th>Status</th><th className="number-column">Selling price</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{rows.map((p,i)=><tr key={p.id+'-'+i}><td><button className="product-name-cell" onClick={()=>onProduct(p)}><ProductIcon index={i}/><span><strong>{p.name||p.sku}</strong><small>{p.sku}</small></span></button></td><td><span className="category-text">{p.category||'—'}</span></td><td><strong className="stock-table-number">{p.stock??'—'}</strong><span className="muted"> units</span></td><td><Badge status={stockStatus(p)}>{stockStatus(p)}</Badge></td><td className="number-column money">{currency(p.price)}</td><td><button className="icon-button" aria-label={'View '+(p.name||p.sku)} onClick={()=>onProduct(p)}><ChevronRight size={18}/></button></td></tr>)}</tbody></table></div>}
    <div className="table-footer"><span>{filtered.length?`Showing ${safePage*8+1}–${Math.min(safePage*8+8,filtered.length)} of ${filtered.length} products`:'0 products'}</span><div className="pagination"><button aria-label="Previous products page" disabled={safePage===0} onClick={()=>setPage(safePage-1)}><ChevronLeft size={16}/></button><span>{safePage+1} / {pageCount}</span><button aria-label="Next products page" disabled={safePage>=pageCount-1} onClick={()=>setPage(safePage+1)}><ChevronRight size={16}/></button></div></div>
  </section>;
}
function InvoiceTable({invoices,compact=false,onInvoice}:{invoices:Invoice[];compact?:boolean;onInvoice:(i:Invoice)=>void}){
  if(!invoices.length)return <Empty title="No invoices to show" detail="Invoices from your source will appear here."/>;
  return <div className="table-scroll"><table className="data-table invoice-table"><thead><tr><th>Invoice</th><th>Customer</th>{!compact&&<th>Date</th>}<th>Delivery</th><th className="number-column">Amount</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{invoices.map((i,n)=><tr key={i.id+'-'+n}><td><button className="invoice-link" onClick={()=>onInvoice(i)}>{i.number}</button>{compact&&<small className="cell-subline">{shortDate(i.date)}</small>}</td><td><span className="customer-name">{i.customer||'—'}</span></td>{!compact&&<td>{shortDate(i.date)}</td>}<td><Badge>{i.deliveryStatus||'Unknown'}</Badge></td><td className="number-column money">{currency(i.total)}</td><td><button className="icon-button" aria-label={'View invoice '+i.number} onClick={()=>onInvoice(i)}><ChevronRight size={16}/></button></td></tr>)}</tbody></table></div>;
}
function Invoices({data,onInvoice}:{data:WorkspaceData;onInvoice:(i:Invoice)=>void}){
  const [q,setQ]=useState(''),[status,setStatus]=useState('');
  const statuses=[...new Set(data.invoices.map(i=>i.deliveryStatus).filter(Boolean))];
  const rows=data.invoices.filter(i=>(!status||i.deliveryStatus===status)&&[i.number,i.customer,i.tracking].some(x=>x.toLowerCase().includes(q.toLowerCase())));
  return <section className="panel"><div className="catalog-toolbar"><div className="local-search"><Search size={17}/><input aria-label="Filter invoices" placeholder="Search invoice, customer, or tracking..." value={q} onChange={e=>setQ(e.target.value)}/></div><label className="status-select"><span className="sr-only">Delivery status</span><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All delivery statuses</option>{statuses.map(s=><option key={s}>{s}</option>)}</select><ChevronDown size={15}/></label></div><InvoiceTable invoices={rows} onInvoice={onInvoice}/><div className="table-footer"><span>{rows.length} invoices shown</span><span className="muted">Payment and delivery are tracked separately</span></div></section>;
}
function Connection({health,user,inventory,busy,refresh}:{health:ConnectionData|null;user:SessionView;inventory:InventoryConnection|null;busy:boolean;refresh:()=>Promise<void>}){
  return <div className="connection-page"><section className="panel connection-main"><div className="connection-page-heading"><div className="sheets-symbol"><PlugZap size={24}/></div><div><h2>{health?.state==='connected'?'Your read connection is ready':user.mode==='sample'?'Connect your business records':'Google Sheets connection'}</h2><p>{user.mode==='sample'?'Preview is working. Google account access has not been configured or tested.':'Check your authorized account and source Sheets before using the workspace.'}</p></div></div><div className="connection-checks">{health?.checks.map((check,i)=><div className="connection-check" key={i}><div className={'check-symbol '+check.status}>{check.status==='passed'?<Check size={17}/>:check.status==='failed'?<CircleAlert size={17}/>:<Clock3 size={17}/>}</div><div><strong>{check.label}</strong><p>{check.detail}</p></div><span className={'check-label '+check.status}>{check.status==='passed'?'Verified':check.status==='failed'?'Needs attention':check.status==='needs_setup'?'Setup needed':'Not tested'}</span></div>)||<Spinner label="Checking connection"/>}</div><div className="connection-action"><span><LockKeyhole size={14}/>This workspace does not change source records.</span><button className="button button-dark" onClick={()=>void refresh()} disabled={busy}><RefreshCw size={15} className={busy?'spin':''}/>{busy?'Checking':'Check connection'}</button></div></section><aside className="connection-notes"><section className="panel"><div className="note-icon"><Package size={22}/></div><h3>Inventory management</h3><p>{inventory?.configured?(inventory.mode==='staging'?'Connected to your staging inventory.':'Connected to your business inventory.')+(inventory.enabled?' Product changes are enabled.':' Changes are paused by the owner.'):'Product management needs its owner-authorized save connection. Follow the Phase 3 setup guide included with this project.'}</p></section><section className="panel"><div className="note-icon"><ShieldCheck size={22}/></div><h3>Your account. Your records.</h3><p>Business data stays in your Google Sheets. Access to this workspace is restricted to the designated admin account.</p><ul><li><Check size={14}/>Private sign-in</li><li><Check size={14}/>Read-only connection</li><li><Check size={14}/>No public sheet sharing</li></ul></section><section className="panel setup-list"><h3>To connect your Sheets</h3><p>The setup guide in the project ZIP walks through these steps.</p><ol><li>Choose the admin Google account.</li><li>Configure the private source Sheet IDs.</li><li>Authorize the owner’s read access.</li><li>Run the connection check.</li></ol><div className="read-limits"><strong>Current source ranges</strong><span>Up to 200 products and 1,000 invoices. Expanding these ranges requires a reviewed schema update.</span></div></section></aside></div>;
}
function DetailDialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ref.current?.showModal();return()=>{ref.current?.close();};},[]);
  return <dialog ref={ref} className="detail-dialog" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===ref.current)onClose();}} aria-labelledby="detail-title"><div className="detail-dialog-inner"><div className="detail-heading"><h2 id="detail-title">{title}</h2><button className="icon-button" aria-label="Close details" onClick={onClose}><X size={20}/></button></div>{children}</div></dialog>;
}
