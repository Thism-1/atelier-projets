/* Atelier Projets V3.1 — étapes et actions synchronisées. Aucune donnee de V2 migree. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const cfg = window.ATELIER_CONFIG || {};
  const statuses = {idea:'À venir',planned:'Planifié',active:'En cours',paused:'En pause',completed:'Terminé',abandoned:'Abandonné'};
  let db = null, user = null, projects = [], notes = [], stages = [], actionsData = [], selected = null, busy = false;
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
    else { stopPolling(); projects=[]; notes=[]; stages=[]; actionsData=[]; selected=null; syncState('Non connecté'); }
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
      const [pr,no,st,ac] = await Promise.all([
        db.from('ap_projects').select('id,title,objective,status,interest,importance,created_at,updated_at').order('updated_at',{ascending:false}),
        db.from('ap_notes').select('id,project_id,content,created_at,updated_at').order('created_at',{ascending:false}),
        db.from('ap_stages').select('id,project_id,title,weight,sort_order,approved,created_at,updated_at').order('sort_order',{ascending:true}).order('created_at',{ascending:true}),
        db.from('ap_actions').select('id,stage_id,title,weight,sort_order,completed,created_at,updated_at').order('sort_order',{ascending:true}).order('created_at',{ascending:true})
      ]);
      if(pr.error) throw pr.error;
      if(no.error) throw no.error;
      if(st.error) throw st.error;
      if(ac.error) throw ac.error;
      const fingerprint=JSON.stringify([pr.data,no.data,st.data,ac.data]);
      projects=pr.data || []; notes=no.data || []; stages=st.data || []; actionsData=ac.data || [];
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
      const sm=projectProgress(p.id);
      info.append(el('small','',sm.count ? `Avancement validé : ${sm.pct}% · ${sm.next || 'Étapes terminées'}` : 'Étapes à définir'));
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
    renderWorkflow(area,p);
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
  function projectProgress(projectId){
    const current=stages.filter(s=>s.project_id===projectId);
    const sum=current.reduce((n,s)=>n+s.weight,0);
    const approved=current.reduce((n,s)=>n+(s.approved?s.weight:0),0);
    let next='';
    for(const stage of current){
      if(stage.approved)continue;
      const action=actionsData.find(a=>a.stage_id===stage.id && !a.completed);
      next=action?`À faire : ${action.title}`:`À valider : ${stage.title}`;
      break;
    }
    return {pct:sum?Math.round(approved*100/sum):0,count:current.length,next};
  }
  async function updateRow(table,id,data,success){
    try{
      if(!navigator.onLine)throw Error('Connexion nécessaire pour enregistrer cette modification.');
      const {data:rows,error}=await db.from(table).update(data).eq('id',id).select('id');
      if(error)throw error;
      if(!rows?.length)throw Error('Modification refusée.');
      if(success)notify(success);
      await refresh(true);
    }catch(e){notify(safeErr(e),true); await refresh(true);}
  }
  async function insertRow(table,data,done){
    if(!navigator.onLine){notify('Connexion nécessaire pour ajouter cet élément.',true);return;}
    try{
      const {error}=await db.from(table).insert(data);
      if(error)throw error;
      done?.();await refresh(true);
    }catch(e){notify(safeErr(e),true);}
  }
  function renderWorkflow(area,project){
    const heading=el('div','workflow-heading');
    const left=el('div');left.append(el('h3','detail-heading','Étapes et actions'));
    const progress=projectProgress(project.id);
    left.append(el('p','inline-note',progress.count?`${progress.pct}% validé · ${progress.count} étape(s)`:'Aucune étape pour ce projet.'));
    heading.append(left);
    area.append(heading);
    if(progress.count){
      const track=el('div','progress-track');const bar=el('div','progress-fill');bar.style.width=progress.pct+'%';track.append(bar);area.append(track);
      area.append(el('p','next-action',progress.next||'Toutes les étapes sont validées.'));
    }
    const list=el('div','stage-list');
    for(const stage of stages.filter(s=>s.project_id===project.id)){
      const wrap=el('section','stage-card');
      const top=el('div','stage-head');
      const title=el('strong','',stage.title);top.append(title,el('span','chip',`Poids ${stage.weight}/5`));wrap.append(top);
      const tasks=actionsData.filter(a=>a.stage_id===stage.id);
      const actionList=el('div','action-list');
      for(const action of tasks){
        const row=el('label','action-item');
        const cb=el('input');cb.type='checkbox';cb.checked=action.completed;
        cb.addEventListener('change',()=>updateRow('ap_actions',action.id,{completed:cb.checked}));
        row.append(cb,el('span',action.completed?'action-done':'',action.title),el('small','',`Poids ${action.weight}`));
        actionList.append(row);
      }
      if(!tasks.length) actionList.append(el('p','empty','Aucune action pour cette étape.'));
      wrap.append(actionList);
      const toolrow=el('div','stage-tools');
      const checkLabel=el('label','approved-toggle');
      const approved=el('input'); approved.type='checkbox';approved.checked=stage.approved;
      const allowed=tasks.length>0 && tasks.every(a=>a.completed);
      approved.disabled=!allowed && !stage.approved;
      approved.title=allowed?'Valider ou rouvrir cette étape':'Termine toutes les actions avant validation.';
      approved.addEventListener('change',()=>updateRow('ap_stages',stage.id,{approved:approved.checked}));
      checkLabel.append(approved,el('span','','Étape validée'));toolrow.append(checkLabel);
      const addAction=el('button','small-button','+ Action');addAction.type='button';
      addAction.addEventListener('click',()=>{
        const title=window.prompt('Intitulé de la nouvelle action :');if(!title?.trim())return;
        if(title.trim().length>220){notify('220 caractères maximum.',true);return;}
        insertRow('ap_actions',{stage_id:stage.id,title:title.trim(),sort_order:tasks.length},()=>notify('Action créée.'));
      });
      toolrow.append(addAction);wrap.append(toolrow);list.append(wrap);
    }
    area.append(list);
    const form=el('form','stage-form');
    const input=el('input');input.placeholder='Nouvelle étape : ex. Préparation de la matière';input.required=true;input.maxLength=160;input.setAttribute('aria-label','Nouvelle étape');
    const weight=el('select');weight.setAttribute('aria-label','Importance de l’étape');
    for(let n=1;n<=5;n++){const opt=el('option','',`Poids ${n}`);opt.value=String(n);opt.selected=n===3;weight.append(opt);}
    const button=el('button','outline small-button','+ Ajouter une étape');button.type='submit';
    form.append(input,weight,button);
    form.addEventListener('submit',async e=>{e.preventDefault();button.disabled=true;
      await insertRow('ap_stages',{project_id:project.id,title:input.value.trim(),weight:Number(weight.value),sort_order:stages.filter(s=>s.project_id===project.id).length},()=>notify('Étape créée.'));
      button.disabled=false;
    });area.append(form);
    area.append(el('p','inline-note','Une étape compte dans l’avancement uniquement après validation. Les actions peuvent être cochées au fur et à mesure.'));
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
    const snapshot={format:'atelier-v3-1-pilote-snapshot',version:2,exported_at:new Date().toISOString(),projects,notes,stages,actions:actionsData};
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
