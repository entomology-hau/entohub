'use strict';
const AREAS = ['Insect biology & behaviour','Crop protection & IPM','Biological control','Ecology & conservation','Pollination & beneficial insects','Taxonomy & biodiversity recording','Vectors & veterinary entomology','Monitoring & environmental risk'];
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL = value => {try {const u=new URL(value); return ['http:','https:'].includes(u.protocol)?u.href:'';} catch {return '';}};
const validDate = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && Number.isFinite(Date.parse(value));
const dateText = value => validDate(value)?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/London'}).format(new Date(value.length===10?value+'T12:00:00Z':value)):'Date unavailable';
const validItem = item => item && typeof item.id==='string' && typeof item.title==='string' && safeURL(item.url) && ['news','research'].includes(item.kind) && validDate(item.published) && item.published.slice(0,10)<=new Date().toISOString().slice(0,10) && Array.isArray(item.areas);
let database=null,kind='all',currentPage=1,saved=new Map(),sourceConfig=[],activeSection='highlights';
const SECTIONS=['highlights','courses','learn','sources','research'];
function initTheme(){
  let theme='light';try{theme=localStorage.getItem('entomology-theme')==='dark'?'dark':'light';}catch{}
  function apply(value){document.documentElement.dataset.theme=value;const dark=value==='dark';$('theme-toggle').setAttribute('aria-pressed',String(dark));$('theme-toggle').setAttribute('aria-label',`Switch to ${dark?'light':'dark'} mode`);$('theme-label').textContent=dark?'Light mode':'Dark mode';document.querySelector('meta[name="theme-color"]').content=dark?'#253750':'#eaf1fa';}
  apply(theme);$('theme-toggle').addEventListener('click',()=>{theme=document.documentElement.dataset.theme==='dark'?'light':'dark';apply(theme);try{localStorage.setItem('entomology-theme',theme);}catch{}});
}
function loadSaved(){try{const items=JSON.parse(localStorage.getItem('entomology-hub-saved')||'[]');if(Array.isArray(items))saved=new Map(items.filter(validItem).slice(0,300).map(item=>[item.id,item]));}catch{saved=new Map();}}
function announcement(text,visible=false){$('save-notice').textContent=text;$('save-notice').className=visible?'storage-notice':'sr-only';if(visible)setTimeout(()=>{$('save-notice').className='sr-only';},6500);}
function toggleSaved(id){
  const item=database?.items.find(x=>x.id===id)||saved.get(id);if(!item)return;
  const wasSaved=saved.has(id);if(wasSaved)saved.delete(id);else if(saved.size<300)saved.set(id,item);else{announcement('Your reading list has 300 items. Remove one before saving another.',true);return;}
  let persistent=true;try{localStorage.setItem('entomology-hub-saved',JSON.stringify([...saved.values()]));}catch{persistent=false;}
  render();const button=[...document.querySelectorAll('[data-save]')].find(x=>x.dataset.save===id);if(button)button.focus({preventScroll:true});else document.querySelector('[data-kind="saved"]').focus({preventScroll:true});
  announcement(persistent?(wasSaved?'Removed from your reading list.':'Saved to your reading list on this device.'):'This browser cannot save your reading list permanently. Changes will last for this page session only.',!persistent);
}
function state(){return {q:$('search').value.trim().toLowerCase(),area:$('area').value,region:$('region').value,selection:$('selection').value,sort:$('sort').value,pageSize:Number($('page-size').value)};}
function matches(item,filter){const haystack=[item.title,item.summary,item.why,item.source,...item.areas].join(' ').toLowerCase();return (!filter.q||filter.q.split(/\s+/).every(word=>haystack.includes(word)))&&(!filter.area||item.areas.includes(filter.area))&&(!filter.region||item.region===filter.region)&&(!filter.selection||(filter.selection==='curated'?item.curated===true:item.curated!==true));}
function card(item){const isSaved=saved.has(item.id),research=item.kind==='research';return `<article class="article-card ${research?'research':'news'}"><div class="article-meta"><span class="kind">${research?'RESEARCH':'IN THE NEWS'}</span><span class="region">${item.region==='uk'?'UK FOCUS':'GLOBAL'}</span></div><h3><a href="${escapeHTML(safeURL(item.url))}" target="_blank" rel="noopener noreferrer">${escapeHTML(item.title)}</a></h3><p class="byline">${escapeHTML(item.source)}<br><time datetime="${escapeHTML(item.published)}">${escapeHTML(dateText(item.published))}</time></p>${item.summary?`<p class="article-summary">${escapeHTML(item.summary)}</p>`:''}${item.why?`<p class="why"><strong>A CLOSER LOOK</strong>${escapeHTML(item.why)}</p>`:''}<div class="tags">${item.areas.slice(0,3).map(area=>`<span>${escapeHTML(area)}</span>`).join('')}</div><div class="card-footer"><a class="read-link" href="${escapeHTML(safeURL(item.url))}" target="_blank" rel="noopener noreferrer" aria-label="Read ${research?'paper':'article'}: ${escapeHTML(item.title)} (opens in a new tab)">${research?'Read the paper':'Read the article'} <span aria-hidden="true">↗</span></a><button type="button" class="save-button" data-save="${escapeHTML(item.id)}" aria-pressed="${isSaved}" aria-label="${isSaved?'Remove from saved':'Save'}: ${escapeHTML(item.title)}">${isSaved?'✓ Saved':'+ Save'}</button></div><p class="selection-label">${item.curated?'Selected highlight':'From the feeds · automatic match'}</p></article>`;}
function syncURL(filter){const p=new URLSearchParams();if(activeSection!=='highlights')p.set('section',activeSection);if(kind!=='all')p.set('view',kind);for(const name of ['q','area','region','selection'])if(filter[name])p.set(name,filter[name]);if(filter.sort!=='newest')p.set('sort',filter.sort);if(filter.pageSize!==9)p.set('size',filter.pageSize);if(currentPage>1)p.set('page',currentPage);try{history.replaceState(null,'',location.pathname+(p.size?'?'+p:'')+location.hash);}catch{}}
function render(){
  if(!database)return;const filter=state();let items=(kind==='saved'?[...saved.values()]:database.items.filter(item=>kind==='all'||item.kind===kind)).filter(item=>matches(item,filter));items.sort((a,b)=>filter.sort==='title'?a.title.localeCompare(b.title):filter.sort==='oldest'?a.published.localeCompare(b.published)||a.title.localeCompare(b.title):b.published.localeCompare(a.published)||(Number(b.curated)-Number(a.curated))||a.title.localeCompare(b.title));
  const pages=Math.max(1,Math.ceil(items.length/filter.pageSize));currentPage=Math.min(Math.max(1,currentPage),pages);const start=(currentPage-1)*filter.pageSize,visible=items.slice(start,start+filter.pageSize);
  $('cards').innerHTML=visible.map(card).join('');$('empty').hidden=items.length>0;$('empty-description').textContent=kind==='saved'&&!saved.size?'Use “Save” on an article to build a reading list on this device.':'Try a wider subject or clear your filters.';
  $('result-count').textContent=items.length?`Showing ${start+1}–${start+visible.length} of ${items.length} ${kind==='saved'?'saved ':''}highlights`:'No matching highlights';$('saved-count').textContent=saved.size;$('pagination').hidden=pages<=1;$('previous').disabled=currentPage===1;$('next').disabled=currentPage===pages;$('page-info').textContent=`Page ${currentPage} of ${pages}`;
  document.querySelectorAll('[data-kind]').forEach(button=>{const active=button.dataset.kind===kind;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});syncURL(filter);
}
function filterChanged(){currentPage=1;render();}
function reset(){kind='all';for(const id of ['search','area','region','selection'])$(id).value='';$('sort').value='newest';filterChanged();}
function restore(){for(const id of ['search','area','region','selection'])$(id).value='';$('sort').value='newest';$('page-size').value='9';kind='all';currentPage=1;const p=new URLSearchParams(location.search);activeSection=SECTIONS.includes(p.get('section'))?p.get('section'):'highlights';if(['all','news','research','saved'].includes(p.get('view')))kind=p.get('view');$('search').value=p.get('q')||'';for(const id of ['area','region','selection','sort'])if([...$(id).options].some(o=>o.value===p.get(id)))$(id).value=p.get(id);if(['9','18','36'].includes(p.get('size')))$('page-size').value=p.get('size');const page=Number(p.get('page'));if(Number.isSafeInteger(page)&&page>0)currentPage=page;}
function renderSources(){
  const status=Array.isArray(database.sources)?database.sources:[];const lastAttempt=database.updatedAt;const good=status.filter(s=>s.status==='ok');const stale=!validDate(lastAttempt)||Date.now()-Date.parse(lastAttempt)>48*60*60*1000;
  $('feed-status').textContent=(validDate(lastAttempt)?`Last source check: ${dateText(lastAttempt)}.`:'Source-check date unavailable.')+(status.length?` ${good.length} of ${status.length} sources responded.`:'')+(stale?' Checks are over 48 hours old or unavailable; browse the original sources for newer items.':good.length<status.length?' Some sources are unavailable; previously collected items remain available.':'') ;$('feed-status').classList.toggle('warning',stale||good.length<status.length);
  if(status.length)$('source-health').innerHTML=`<table><caption class="sr-only">Status of automatic news and research sources</caption><thead><tr><th scope="col">Source</th><th scope="col">Last check</th><th scope="col">Status</th><th scope="col">Last successful check</th></tr></thead><tbody>${status.map(s=>`<tr><th scope="row">${escapeHTML(s.name||s.id)}</th><td>${escapeHTML(dateText(s.lastAttempt||lastAttempt))}</td><td>${s.status==='ok'?'Available':s.status==='cached'?'Unavailable · cached items retained':'Unavailable · no cached items'}</td><td>${escapeHTML(dateText(s.lastSuccess))}</td></tr>`).join('')}</tbody></table>`;
  if(sourceConfig.length)$('source-links').innerHTML=sourceConfig.map(s=>`<a href="${escapeHTML(safeURL(s.homepage||s.website||s.url))}" target="_blank" rel="noopener noreferrer">${escapeHTML(s.name)} <span aria-hidden="true">↗</span></a>`).join('');
}

function showSection(name,{push=false,focus=false,clearHash=false}={}){
  activeSection=SECTIONS.includes(name)?name:'highlights';
  for(const panel of document.querySelectorAll('[data-panel]'))panel.hidden=panel.dataset.panel!==activeSection;
  for(const tab of document.querySelectorAll('[data-section]')){
    const selected=tab.dataset.section===activeSection;
    tab.setAttribute('aria-selected',String(selected));tab.classList.toggle('active',selected);tab.tabIndex=selected?0:-1;
  }
  if(push){
    const url=new URL(location.href);if(activeSection==='highlights')url.searchParams.delete('section');else url.searchParams.set('section',activeSection);
    if(clearHash)url.hash='';
    try{history.pushState(null,'',url.pathname+url.search+url.hash);}catch{}
  }
  if(focus)$('panel-'+activeSection).focus({preventScroll:true});
}
function revealFragment(){
  let id;try{id=decodeURIComponent(location.hash.slice(1));}catch{return;}
  if(!id)return;
  const target=$(id),panel=target?.closest('[data-panel]');
  if(panel){
    showSection(panel.dataset.panel);
    let ancestor=target.parentElement;while(ancestor){if(ancestor.tagName==='DETAILS')ancestor.open=true;ancestor=ancestor.parentElement;}
    target.scrollIntoView({block:'start'});
  }
}
function initNavigation(){
  showSection(activeSection);revealFragment();
  const tabs=[...document.querySelectorAll('[data-section]')];
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>showSection(tab.dataset.section,{push:true,clearHash:true}));
    tab.addEventListener('keydown',event=>{
      let next;
      if(event.key==='ArrowRight')next=(index+1)%tabs.length;
      else if(event.key==='ArrowLeft')next=(index-1+tabs.length)%tabs.length;
      else if(event.key==='Home')next=0;
      else if(event.key==='End')next=tabs.length-1;
      else return;
      event.preventDefault();tabs[next].focus();showSection(tabs[next].dataset.section,{push:true,clearHash:true});
    });
  });
  document.addEventListener('click',event=>{
    const link=event.target.closest('a[href^="#"]');if(!link)return;
    let id;try{id=decodeURIComponent(link.getAttribute('href').slice(1));}catch{return;}
    const target=$(id),panel=target?.closest('[data-panel]');
    if(panel)showSection(panel.dataset.panel);
  });
  window.addEventListener('hashchange',()=>{revealFragment();syncURL(state());});
}

async function load(){
 initTheme();loadSaved();for(const area of AREAS)$('area').add(new Option(area,area));restore();initNavigation();
 $('filters').addEventListener('submit',e=>e.preventDefault());$('search').addEventListener('input',filterChanged);for(const id of ['area','region','selection','sort','page-size'])$(id).addEventListener('change',filterChanged);document.querySelectorAll('[data-kind]').forEach(button=>button.addEventListener('click',()=>{kind=button.dataset.kind;filterChanged();}));$('reset').addEventListener('click',reset);$('empty-reset').addEventListener('click',reset);$('cards').addEventListener('click',event=>{const button=event.target.closest('[data-save]');if(button)toggleSaved(button.dataset.save);});for(const [id,delta] of [['previous',-1],['next',1]])$(id).addEventListener('click',()=>{currentPage+=delta;render();$('feed-heading').setAttribute('tabindex','-1');$('feed-heading').focus({preventScroll:true});$('highlights').scrollIntoView({block:'start'});});window.addEventListener('popstate',()=>{restore();showSection(activeSection);revealFragment();render();});window.addEventListener('storage',event=>{if(event.key==='entomology-hub-saved'){loadSaved();render();}});
 try{const response=await fetch('data/feed.json');if(!response.ok)throw Error('Feed unavailable');database=await response.json();if(!Array.isArray(database.items))throw Error('Invalid feed');database.items=database.items.filter(validItem);render();renderSources();}catch{ $('feed-error').hidden=false;$('result-count').textContent='Highlights unavailable';if(saved.size){database={items:[],sources:[]};kind='saved';render();}}
 try{const response=await fetch('data/sources.json');if(response.ok){const config=await response.json();sourceConfig=Array.isArray(config)?config:config.sources||[];if(database)renderSources();}}catch{}

}
load();
