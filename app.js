/* Atelier Projets V3 — jalon pilote synchronisation. Aucune donnee de V2 migree. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const cfg = window.ATELIER_CONFIG || {};
  const statuses = {idea:'À venir',planned:'Planifié',active:'En cours',paused:'En pause',completed:'Terminé',abandoned:'Abandonné'};
  let db = null, user = null, projects = [], notes = [], selected = null, busy = false;
  let lastFingerprint = '';
  let timer = null;
  let toastTimer = null;

  const el = (tag, className, content) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  };
  const clear = node => { while (node.firstChild) node.removeChild(node.firstChild); };
  const show = (id, visible) => $(id).classList.toggle('hidden', !visible);
  const fmt = value => new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  const notify = (message, error=false) => {
    const t = $('toast'); t.textContent = message; t.style.background = error ? 'var(--danger)' : 'var(--text)';
    show('toast', true); clearTimeout(toastTimer); toastTimer=setTimeout(()=>show('toast',false),5100);
  };
  const syncState = (label, kind='') => {
    $('sync-label').textContent = label;
    $('sync-dot').className = 'sync-dot '+kind;
  };
  const safeErr = err => {
    const message = err && err.message ? err.message : String(err);
    if (message.includes('Maximum de 5')) return 'Limite atteinte : cinq projets en cours maximum.';
    if (message.includes('JWT') || message.includes('session')) return 'Session expirée. Reconnecte-toi.';
    return message;
  };
  function initTheme() {
    let saved; try { saved=localStorage.getItem('atelier_theme'); } catch(_) { saved=null; }
    if (!['light','dark'].includes(saved)) saved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark':'light';
    document.documentElement.dataset.theme=saved;
    $('theme-toggle').addEventListener('click',()=>{
      const next=document.documentElement.dataset.theme==='dark'?'light':'dark';
      document.documentElement.dataset.theme=next;
      try {localStorage.setItem('atelier_theme', next);} catch(_) {}
    });
  }
  const configured = () => typeof cfg.SUPABASE_URL === 'string'
    && /^https:\/\/[\w-]+\.supabase\.co\/?$/.test(cfg.SUPABASE_URL)
    && !cfg.SUPABASE_URL.includes('REMPLACER')
    && typeof cfg.SUPABASE_PUBLISHABLE_KEY === 'string'
    && (cfg.SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_') || cfg.SUPABASE_PUBLISHABLE_KEY.startsWith('eyJ'))
    && !cfg.SUPABASE_PUBLISHABLE_KEY.includes('REMPLACER');
  function renderAuth(session) {
    user = session?.user || null;
    show('auth-panel', !user); show('app-panel', !!user); show('logout', !!user);
    if (user) { syncState('Connexion active','ok'); startPolling(); refresh(true); }
    else { stopPolling(); projects=[]; notes=[]; selected=null; syncState('Non connecté'); }
  }
  async function login(event) {
    event.preventDefault();
    const button=event.submitter || $('login-form').querySelector('button');
    button.disabled=true;
    try {
      const email=$('email').value.trim();
      const {error}=await db.auth.signInWithOtp({email,options:{emailRedirectTo: location.origin+location.pathname}});
      if (error) throw error;
      notify('Lien envoyé. Vérifie ta boîte e-mail et ouvre le lien depuis ton appareil.');
    } catch(e) {notify('Connexion : '+safeErr(e),true);} finally {button.disabled=false;}
  }
  async function refresh(force=false) {
    if (!user || busy || !navigator.onLine) {
      if(!navigator.onLine) syncState('Hors ligne : pas de modifications','fail');
      return;
    }
    busy=true;
    if(force) syncState('Synchronisation…');
    try {
      const [pr,no] = await Promise.all([
        db.from('ap_projects').select('id,title,objective,status,interest,importance,created_at,updated_at').order('updated_at',{ascending:false}),
        db.from('ap_notes').select('id,project_id,content,created_at,updated_at').order('created_at',{ascending:false})
      ]);
      if(pr.error) throw pr.error;
      if(no.error) throw no.error;
      const fingerprint=JSON.stringify([pr.data,no.data]);
      projects=pr.data || []; notes=no.data || [];
      if(fingerprint!==lastFingerprint || force) {lastFingerprint=fingerprint; render();}
      syncState('À jour · '+new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}),'ok');
    } catch(e){syncState('Erreur de synchronisation','fail'); if(force) notify('Lecture : '+safeErr(e),true);}
    finally{busy=false;}
  }
  function startPolling(){ stopPolling(); timer=setInterval(()=>refresh(),12000); }
  function stopPolling(){ if(timer) clearInterval(timer); timer=null; }
  function render(){
    $('stat-total').textContent=projects.length;
    $('stat-active').textContent=projects.filter(p=>p.status==='active').length+' / 5';
    $('stat-notes').textContent=notes.length;
    const container=$('projects'); clear(container);
    if(!projects.length) container.append(el('p','empty','Aucun projet. Crée un premier projet de test.'));
    for(const p of projects){
      const b=el('button','project'+(selected===p.id?' selected':'')); b.type='button';
      const info=el('span'); info.append(el('strong','',p.title),el('small','',p.objective.slice(0,88) || 'Objectif à compléter'));
      b.append(info,el('span','chip',statuses[p.status] || p.status));
      b.addEventListener('click',()=>{selected=p.id;render();}); container.append(b);
    }
    if(selected && !projects.some(p=>p.id===selected)) selected=null;
    renderDetail();
  }
  function renderDetail(){
    const area=$('project-detail'); clear(area);
    const p=projects.find(project=>project.id===selected);
    if(!p){
      const place=el('div','placeholder');place.append(el('div','empty-icon','✎'),el('h2','', 'Sélectionne un projet'),el('p','','Ajoute une note et retrouve-la sur ton autre appareil.'));
      area.append(place);return;
    }
    const top=el('div','detail-head'); const info=el('div'); info.append(el('div','eyebrow','FICHE PROJET'),el('h2','',p.title));
    const actions=el('div','detail-actions'); const label=el('label','', 'Statut'); label.setAttribute('for','status-change');
    const select=el('select','project-select'); select.id='status-change';
    for (const [value,text] of Object.entries(statuses)) {
      const opt=el('option','',text);opt.value=value;opt.selected=value===p.status;select.append(opt);
    }
    select.addEventListener('change',async()=>{
      const status=select.value; select.disabled=true;
      try {
        const {data,error}=await db.from('ap_projects').update({status}).eq('id',p.id).select('id');
        if(error)throw error;
        if(!data?.length)throw new Error('Modification refusée.');
        notify('Statut enregistré sur Supabase.');await refresh(true);
      } catch(e){notify(safeErr(e),true); select.value=p.status;} finally{select.disabled=false;}
    });
    actions.append(label,select);top.append(info,actions);area.append(top);
    area.append(el('p','detail-objective',p.objective || 'Aucun objectif renseigné.'));
    area.append(el('div','inline-note','Données enregistrées dans ton compte Supabase.'));
    area.append(el('hr','divider'));
    area.append(el('h3','detail-heading','Notes du projet'));
    const form=el('form','note-compose');const text=el('textarea');text.required=true;text.maxLength=12000;text.placeholder='Une idée, une référence technique, un lien, une information à garder…';text.setAttribute('aria-label','Nouvelle note');
    const submit=el('button','primary','+ Ajouter une note');submit.type='submit';form.append(text,submit);
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      const content=text.value.trim();if(!content)return;
      if(!navigator.onLine){notify('Hors ligne : note non envoyée. Conserve-la pour la saisir après reconnexion.',true);return;}
      submit.disabled=true;
      try{
        const {error}=await db.from('ap_notes').insert({project_id:p.id,content});
        if(error) throw error;
        text.value='';notify('Note synchronisée.');await refresh(true);
      }catch(e){notify('Note non enregistrée : '+safeErr(e),true);}finally{submit.disabled=false;}
    });
    area.append(form);
    const group=el('div','notes');const related=notes.filter(n=>n.project_id===p.id);
    if(!related.length)group.append(el('p','empty','Pas encore de note sur ce projet.'));
    for(const n of related){const box=el('article','note');box.append(el('div','date',fmt(n.created_at)),el('p','note-content',n.content));group.append(box);}
    area.append(group);
  }
  function openProjectDialog(){ $('project-form').reset(); $('project-dialog').showModal(); $('project-title').focus(); }
  async function createProject(event){
    event.preventDefault();
    const b=$('project-submit');b.disabled=true;
    try {
      if(!navigator.onLine) throw new Error('Connexion Internet requise pour créer ce projet dans le pilote.');
      const title=$('project-title').value.trim();const objective=$('project-objective').value.trim();const status=$('project-status').value;
      if(!title) return;
      const {data,error}=await db.from('ap_projects').insert({title,objective,status}).select('id').single();
      if(error)throw error;
      selected=data.id; $('project-dialog').close();notify('Projet créé et synchronisé.');await refresh(true);
    }catch(e){notify('Projet non créé : '+safeErr(e),true);}finally{b.disabled=false;}
  }
  function exportSnapshot(){
    if(!user){notify('Connecte-toi pour exporter.',true);return;}
    const snapshot={format:'atelier-v3-pilote-snapshot',version:1,exported_at:new Date().toISOString(),projects,notes};
    const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='Atelier_Projets_V3_test_'+new Date().toISOString().slice(0,10)+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
    notify('Copie de lecture téléchargée (JSON). Ce n’est pas encore une sauvegarde ZIP restaurable.');
  }
  async function init(){
    initTheme();
    $('login-form').addEventListener('submit',login);
    $('logout').addEventListener('click',async()=>{if(db){await db.auth.signOut();renderAuth(null);notify('Déconnecté.');}});
    $('new-project').addEventListener('click',openProjectDialog);
    $('close-dialog').addEventListener('click',()=>$('project-dialog').close());
    $('cancel-dialog').addEventListener('click',()=>$('project-dialog').close());
    $('project-form').addEventListener('submit',createProject);
    $('refresh').addEventListener('click',()=>refresh(true));
    $('nav-save').addEventListener('click',exportSnapshot);
    window.addEventListener('online',()=>refresh(true));
    window.addEventListener('offline',()=>syncState('Hors ligne : lecture seule','fail'));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);});
    if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
    if(!configured()){show('setup',true);syncState('Configuration requise','fail');return;}
    if(!window.supabase?.createClient){
      show('setup',true);$('setup').querySelector('h2').textContent='Bibliothèque de connexion indisponible';
      $('setup').querySelector('p').textContent='Vérifie la connexion Internet et le chargement du SDK Supabase depuis jsDelivr. Le pilote doit être connecté pour démarrer.';
      syncState('SDK indisponible','fail');return;
    }
    db=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    db.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_IN' || event==='SIGNED_OUT' || event==='INITIAL_SESSION') renderAuth(session);
    });
    const {data,error}=await db.auth.getSession();
    if(error)notify('Session : '+safeErr(error),true);
    renderAuth(data?.session || null);
  }
  init().catch(e=>{syncState('Erreur au démarrage','fail');notify(safeErr(e),true);});
})();
