'use strict';
(() => {
  const endpoint='https://api.inaturalist.org/v1/observations?project_id=168313&per_page=6&order_by=observed_on&order=desc&locale=en-GB';
  const licences=new Map([
    ['cc0','CC0'],['cc-by','CC BY'],['cc-by-sa','CC BY-SA'],
    ['cc-by-nc','CC BY-NC'],['cc-by-nc-sa','CC BY-NC-SA'],
    ['cc-by-nd','CC BY-ND'],['cc-by-nc-nd','CC BY-NC-ND']
  ]);
  const photoHosts=new Set(['inaturalist-open-data.s3.amazonaws.com','static.inaturalist.org']);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const observedDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value));
  const dateLabel=value=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
  let request;
  function photoURL(photo){
    if(!photo||photo.hidden||!licences.has(photo.license_code)||!photo.attribution||!Number.isSafeInteger(photo.id)||photo.id<1)return '';
    if(Array.isArray(photo.flags)&&photo.flags.length)return '';
    try{
      const url=new URL(photo.url);
      if(url.protocol!=='https:'||!photoHosts.has(url.hostname)||!/^\/photos\/\d+\//.test(url.pathname))return '';
      url.pathname=url.pathname.replace(/\/square\.(jpg|jpeg|png)$/i,'/medium.$1');
      return url.href;
    }catch{return '';}
  }
  function recordCard(record){
    const href='https://www.inaturalist.org/observations/'+record.id;
    const scientific=record.taxon?.name||'';
    const common=record.taxon?.preferred_common_name||'';
    const title=common||scientific||'Identification pending';
    const photo=Array.isArray(record.photos)?record.photos.find(p=>photoURL(p)):null;
    const visual=photo?`<figure><a class="biodiversity-photo" href="${href}" target="_blank" rel="noopener noreferrer"><img src="${escape(photoURL(photo))}" alt="${escape(title)} — observation photograph" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a><figcaption class="biodiversity-credit">${escape(photo.attribution)} · <a href="https://www.inaturalist.org/photos/${photo.id}" target="_blank" rel="noopener noreferrer">Photo &amp; licence (${licences.get(photo.license_code)})</a></figcaption></figure>`:`<a class="biodiversity-photo-placeholder" href="${href}" target="_blank" rel="noopener noreferrer">View this record on iNaturalist<br>Photograph preview unavailable</a>`;
    const date=observedDate(record.observed_on)?`Observed <time datetime="${record.observed_on}">${dateLabel(record.observed_on)}</time>`:'Observation date unavailable';
    const observer=record.user?.login?`<br>Recorded by ${escape(record.user.login)}`:'';
    const grade=new Map([['research','Research grade'],['needs_id','Needs ID'],['casual','Casual']]).get(record.quality_grade);
    return `<article class="biodiversity-record">${visual}<div class="biodiversity-record-body"><h3><a href="${href}" target="_blank" rel="noopener noreferrer">${escape(title)}</a></h3>${common&&scientific?`<p class="biodiversity-scientific"><i>${escape(scientific)}</i></p>`:''}<p class="biodiversity-record-meta">${date}${observer}</p>${grade?`<p class="biodiversity-grade">${grade}</p>`:''}<br><a class="biodiversity-record-link" href="${href}" target="_blank" rel="noopener noreferrer">View record <span aria-hidden="true">↗</span></a></div></article>`;
  }
  function fetchRecords(){
    if(!request)request=(async()=>{
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),12000);
      try{
        const response=await fetch(endpoint,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
        if(!response.ok)throw Error('Records unavailable');
        const data=await response.json();
        if(!Array.isArray(data.results))throw Error('Invalid records');
        return data.results.filter(record=>record&&Number.isSafeInteger(record.id)&&record.id>0).slice(0,6);
      }finally{clearTimeout(timeout);}
    })().catch(error=>{request=null;throw error;});
    return request;
  }
  async function fillPreview(section){
    const status=section.querySelector('[data-biodiversity-status]');
    const grid=section.querySelector('[data-biodiversity-records]');
    const retry=section.querySelector('[data-biodiversity-retry]');
    retry.hidden=true;status.textContent='Loading recent records from iNaturalist…';
    grid.setAttribute('aria-busy','true');
    try{
      const records=(await fetchRecords()).slice(0,Number(section.dataset.limit)||3);
      grid.innerHTML=records.map(recordCard).join('');
      status.textContent=records.length?`${records.length} recent records · newest observation dates first`:'No public records are currently available in this preview. Visit the project for more information.';
      // A deleted or unavailable photo must not leave a broken image.
      grid.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{
        const link=img.parentElement;link.className='biodiversity-photo-placeholder';link.textContent='Photograph unavailable · view record on iNaturalist';
      },{once:true}));
    }catch{
      status.textContent='Recent records could not load. You can still explore the project using the link above.';
      retry.hidden=false;
    }finally{grid.setAttribute('aria-busy','false');}
  }
  const sections=[...document.querySelectorAll('[data-biodiversity]')];
  for(const section of sections)section.querySelector('[data-biodiversity-retry]').addEventListener('click',()=>fillPreview(section));
  if('IntersectionObserver' in window){
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);fillPreview(entry.target);}
    },{rootMargin:'200px'});
    sections.forEach(section=>observer.observe(section));
  }else sections.forEach(fillPreview);
})();
