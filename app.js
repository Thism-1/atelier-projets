/* Atelier Projets V3.2 — authentification et sauvegardes non destructives. Aucune donnee de V2 migree. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const cfg = window.ATELIER_CONFIG || {};
  const statuses = {idea:'À venir',planned:'Planifié',active:'En cours',paused:'En pause',completed:'Terminé',abandoned:'Abandonné'};
  let db = null, user = null, projects = [], notes = [], stages = [], actionsData = [], selected = null, busy = false;
  let lastFingerprint = '';
  let timer = null;
  let toastTimer = null;
  let pendingBackup = null;
  let restoreBusy = false;

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
      const password=$('login-password').value;
      const {error}=await db.auth.signInWithPassword({email,password});
      if(error)throw error;
      $('login-password').value='';
      notify('Connexion réussie.');
    } catch(e) {notify('Connexion : '+safeErr(e),true);} finally {button.disabled=false;}
  }
  async function sendMagicLink(){
    const email=$('email').value.trim();
    if(!email || !$('email').checkValidity()){notify('Saisis une adresse e-mail valide.',true);return;}
    $('magic-login').disabled=true;
    try{
      const {error}=await db.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname,shouldCreateUser:false}});
      if(error)throw error;
      notify('Lien envoyé. Attention au quota horaire de Supabase.');
    }catch(e){notify('E-mail : '+safeErr(e),true);}
    finally{$('magic-login').disabled=false;}
  }
  async function changePassword(event){
    event.preventDefault();
    const pass=$('new-password').value,confirm=$('confirm-password').value;
    if(pass.length<12){notify('12 caractères minimum.',true);return;}
    if(pass!==confirm){notify('Les mots de passe ne correspondent pas.',true);return;}
    const button=event.submitter;button.disabled=true;
    try{
      const {error}=await db.auth.updateUser({password:pass});
      if(error)throw error;
      $('password-form').reset();$('account-dialog').close();notify('Mot de passe enregistré.');
    }catch(e){notify('Mot de passe : '+safeErr(e),true);}finally{button.disabled=false;}
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
  // Snapshot JSON: export explicite, sans pièces jointes, sans jetons de connexion.
  const snapshotCollections = [
    ['projects','ap_projects',['id','title','objective','status','interest','importance','created_at','updated_at']],
    ['notes','ap_notes',['id','project_id','content','created_at','updated_at']],
    ['stages','ap_stages',['id','project_id','title','weight','sort_order','approved','created_at','updated_at']],
    ['actions','ap_actions',['id','stage_id','title','weight','sort_order','completed','created_at','updated_at']]
  ];
  async function fetchAll(table,fields){
    let records=[];
    // Supabase peut plafonner la taille des réponses; paginer plutôt que tronquer silencieusement.
    for(let offset=0;offset<100000;offset+=500){
      const {data,error}=await db.from(table).select(fields.join(',')).order('id').range(offset,offset+499);
      if(error)throw error;
      records.push(...data);
      if(data.length<500)return records;
    }
    throw Error('Export trop volumineux : limite de sécurité atteinte.');
  }
  async function exportSnapshot(){
    if(!user || !navigator.onLine){notify('Connexion nécessaire pour une sauvegarde complète.',true);return;}
    const button=$('backup-export');button.disabled=true;
    try{
      syncState('Préparation de la sauvegarde…');
      const contents={};
      for(const [name,table,fields] of snapshotCollections) contents[name]=await fetchAll(table,fields);
      const exportTime=new Date().toISOString();
      const snapshot={format:'atelier-projets-v3.2',version:3,exported_at:exportTime,source_user_id:user.id,contents};
      const json=JSON.stringify(snapshot,null,2);
      const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='Atelier_Projets_'+exportTime.replace(/[:.]/g,'-')+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      try{localStorage.setItem('atelier_last_backup',exportTime);}catch(_){}
      showBackupDate();
      notify('Téléchargement demandé. Vérifie que le fichier existe sur ton PC.');
    }catch(e){notify('Sauvegarde impossible : '+safeErr(e),true);}
    finally{button.disabled=false;await refresh(true);}
  }
  function showBackupDate(){
    let value=null;try{value=localStorage.getItem('atelier_last_backup');}catch(_){}
    $('backup-last').textContent=value?'Dernier téléchargement demandé depuis ce navigateur : '+fmt(value)+' (présence du fichier non vérifiée).':'Aucune sauvegarde demandée depuis ce navigateur.';
  }
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const validDate=v=>typeof v==='string'&&!Number.isNaN(Date.parse(v));
  function validateBackup(value){
    if(!value||value.format!=='atelier-projets-v3.2'||value.version!==3||!value.contents)throw Error('Format non reconnu. Utilise une sauvegarde V3.2.');
    if(value.source_user_id!==user.id)throw Error('Cette sauvegarde appartient à un autre compte. Import refusé.');
    const {projects:pr,notes:no,stages:st,actions:ac}=value.contents;
    if(![pr,no,st,ac].every(Array.isArray))throw Error('Sauvegarde incomplète.');
    const limits={projects:2000,notes:30000,stages:30000,actions:100000};
    const data={projects:pr,notes:no,stages:st,actions:ac};
    for(const [key,rows] of Object.entries(data)){
      if(rows.length>limits[key])throw Error('Le fichier dépasse les limites de sécurité.');
      const seen=new Set();
      for(const r of rows){
        if(!r||!uuid.test(r.id)||seen.has(r.id))throw Error('Identifiant invalide ou dupliqué dans '+key);
        seen.add(r.id);
        if(!validDate(r.created_at))throw Error('Date invalide : '+key);
      }
    }
    const projectIds=new Set(pr.map(r=>r.id)),stageIds=new Set(st.map(r=>r.id));
    for(const r of pr){
      if(typeof r.title!=='string'||!r.title.trim()||r.title.length>160||typeof r.objective!=='string'||!statuses[r.status]||![1,2,3,4,5].includes(r.interest)||![1,2,3,4,5].includes(r.importance))throw Error('Projet invalide.');
    }
    for(const r of no){if(!projectIds.has(r.project_id)||typeof r.content!=='string'||r.content.length>12000||!r.content.trim())throw Error('Note invalide ou projet manquant.');}
    for(const r of st){if(!projectIds.has(r.project_id)||typeof r.title!=='string'||!r.title.trim()||r.title.length>160||!(r.weight>=1&&r.weight<=5)||typeof r.approved!=='boolean'||!Number.isInteger(r.sort_order))throw Error('Étape invalide.');}
    for(const r of ac){if(!stageIds.has(r.stage_id)||typeof r.title!=='string'||!r.title.trim()||r.title.length>220||!(r.weight>=1&&r.weight<=5)||typeof r.completed!=='boolean'||!Number.isInteger(r.sort_order))throw Error('Action invalide.');}
    return data;
  }
  async function previewBackup(event){
    pendingBackup=null;$('backup-restore').disabled=true;
    const box=$('backup-preview');clear(box);show('backup-preview',false);
    const file=event.target.files?.[0];if(!file)return;
    try{
      if(file.size>25*1024*1024)throw Error('Fichier trop volumineux (25 Mo maximum).');
      const parsed=JSON.parse(await file.text());
      const data=validateBackup(parsed);
      pendingBackup=data;
      box.append(el('strong','','Fichier vérifié : '+file.name));
      box.append(el('p','',`${data.projects.length} projets · ${data.notes.length} notes · ${data.stages.length} étapes · ${data.actions.length} actions`));
      box.append(el('p','','Import non destructif : seuls les identifiants absents seront ajoutés. Les projets déjà présents restent inchangés. Les projets actifs récupérés seront placés en « Planifié » pour respecter la limite de 5.'));
      box.append(el('p','','Aucun document ni fichier joint dans cette sauvegarde.'));
      show('backup-preview',true);$('backup-restore').disabled=false;
    }catch(e){notify('Archive refusée : '+safeErr(e),true);}
  }
  async function restoreBackup(){
    if(!pendingBackup||restoreBusy||!user||!navigator.onLine){notify('Restauration impossible hors connexion.',true);return;}
    if(!confirm('Ajouter uniquement les éléments manquants de cette sauvegarde à ton compte Supabase ? Aucune donnée existante ne sera écrasée.'))return;
    restoreBusy=true;$('backup-restore').disabled=true;
    const counts={projects:0,notes:0,stages:0,actions:0};
    try{
      syncState('Restauration en cours…');
      // Retrouver les identifiants déjà présents. En cas de conflit concurrent,
      // PostgREST ignoreDuplicates évite de modifier l'existant.
      for(const [name,table,fields] of snapshotCollections){
        const existing=new Set((await fetchAll(table,['id'])).map(x=>x.id));
        const missing=pendingBackup[name].filter(row=>!existing.has(row.id));
        // Ne jamais restaurer le propriétaire exporté ni forcer un avancement d'étape
        // avant que toutes les actions aient été réinsérées.
        for(let i=0;i<missing.length;i+=100){
          const chunk=missing.slice(i,i+100).map(row=>{
            const x={};for(const field of fields)if(field!=='updated_at'&&field!=='created_at')x[field]=row[field];
            if(name==='projects'&&x.status==='active')x.status='planned';
            if(name==='stages')x.approved=false;
            return x;
          });
          const {error}=await db.from(table).upsert(chunk,{onConflict:'id',ignoreDuplicates:true});
          if(error)throw new Error(name+' : '+error.message);
          counts[name]+=chunk.length;
        }
      }
      // Les validations rétablies uniquement si le serveur confirme que toutes
      // les actions de l’étape sont déjà présentes et terminées.
      for(const stage of pendingBackup.stages.filter(st=>st.approved)){
        const original=stages.find(x=>x.id===stage.id);
        // Ne modifier aucune etape qui existait deja avant l'import.
        if(original)continue;
        const {data,error}=await db.from('ap_stages').update({approved:true}).eq('id',stage.id).eq('approved',false).select('id');
        // La validation peut échouer si la structure d’origine a changé: ne pas
        // compromettre la restauration globale; laisser l’étape à vérifier.
        if(error)continue;
      }
      notify(`Restauration terminée : ${counts.projects} projets, ${counts.notes} notes, ${counts.stages} étapes, ${counts.actions} actions examinés pour ajout.`);
      await refresh(true);
      $('backup-dialog').close();
    }catch(e){notify('Restauration partielle possible. '+safeErr(e),true);await refresh(true);}
    finally{restoreBusy=false;$('backup-restore').disabled=false;}
  }
  async function init(){
    initTheme();
    $('login-form').addEventListener('submit',login);
    $('magic-login').addEventListener('click',sendMagicLink);
    $('account-open').addEventListener('click',()=>{$('account-dialog').showModal();});
    $('account-close').addEventListener('click',()=>$('account-dialog').close());
    $('password-form').addEventListener('submit',changePassword);
    const openBackup=()=>{showBackupDate();$('backup-dialog').showModal();};
    $('backup-open').addEventListener('click',openBackup);
    $('backup-close').addEventListener('click',()=>$('backup-dialog').close());
    $('backup-export').addEventListener('click',exportSnapshot);
    $('backup-file').addEventListener('change',previewBackup);
    $('backup-restore').addEventListener('click',restoreBackup);
    $('logout').addEventListener('click',async()=>{if(db){await db.auth.signOut();renderAuth(null);notify('Déconnecté.');}});
    $('new-project').addEventListener('click',openProjectDialog);
    $('close-dialog').addEventListener('click',()=>$('project-dialog').close());
    $('cancel-dialog').addEventListener('click',()=>$('project-dialog').close());
    $('project-form').addEventListener('submit',createProject);
    $('refresh').addEventListener('click',()=>refresh(true));
    $('nav-save').addEventListener('click',()=>{if(user)openBackup();else notify('Connecte-toi pour ouvrir les sauvegardes.',true);});
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
