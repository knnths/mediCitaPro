(function(){
'use strict';

/* ---------- utilidades ---------- */
var mem={};
var store={
  get:function(k,d){ if(k in mem) return mem[k]; try{var v=localStorage.getItem('mcp.'+k); if(v!==null){var p=JSON.parse(v); mem[k]=p; return p;}}catch(e){} return d; },
  set:function(k,v){ mem[k]=v; try{localStorage.setItem('mcp.'+k,JSON.stringify(v));}catch(e){} }
};
var sess={
  get:function(){ try{var v=sessionStorage.getItem('mcp.s'); return v?JSON.parse(v):(mem.__s||null);}catch(e){return mem.__s||null;} },
  set:function(v){ mem.__s=v; try{ if(v) sessionStorage.setItem('mcp.s',JSON.stringify(v)); else sessionStorage.removeItem('mcp.s'); }catch(e){} }
};
var $=function(s,r){return (r||document).querySelector(s);};
var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
var p2=function(n){return String(n).padStart(2,'0');};
var iso=function(d){return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());};
var addDays=function(d,n){var x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()+n);return x;};
var parse=function(f){return new Date(f+'T00:00:00');};
var fmtDate=function(f){return parse(f).toLocaleDateString('es-SV',{weekday:'short',day:'numeric',month:'short'}).replace('.','');};
var uid=function(){return Math.random().toString(36).slice(2,10);};

async function hash(pw,salt){
  var data=new TextEncoder().encode(salt+':'+pw);
  try{
    if(window.crypto&&crypto.subtle){
      var b=await crypto.subtle.digest('SHA-256',data);
      return Array.from(new Uint8Array(b)).map(function(x){return p2(x.toString(16));}).join('');
    }
  }catch(e){}
  var h=5381,s=salt+pw; for(var i=0;i<s.length;i++){h=((h<<5)+h+s.charCodeAt(i))>>>0;} return 'f'+h.toString(16);
}

/* ---------- constantes ---------- */
var ROLES={admin:'Administración',medico:'Médico',paciente:'Paciente'};
var ESTADOS=['Pendiente','Confirmada','Atendida','Cancelada'];
var PILL={Pendiente:'warn',Confirmada:'info',Atendida:'ok',Cancelada:'bad'};
var BARC={Pendiente:'c-warn',Confirmada:'c-info',Atendida:'c-ok',Cancelada:'c-bad'};
var PERMS={admin:['panel','citas','reportes','usuarios','proyecto'],medico:['panel','citas','reportes','proyecto'],paciente:['panel','citas','proyecto']};
var NAV={panel:'Panel',citas:'Citas',reportes:'Reportes',usuarios:'Usuarios',proyecto:'Proyecto'};
var SLOTS=[]; for(var h=8;h<18;h++){SLOTS.push(p2(h)+':00');SLOTS.push(p2(h)+':30');}
var IDLE=30*60*1000, PAGE=8;

/* ---------- estado ---------- */
var db={users:[],citas:[]};
var me=null, view='panel', authMode='login';
var flt={q:'',estado:'',medico:'',desde:'',hasta:'',page:1};
var rep={periodo:'todo'}, uq='';

var user=function(id){return db.users.find(function(u){return u.id===id;});};
var nm=function(id){var u=user(id);return u?u.nombre:'Usuario eliminado';};
var api=function(path,opts){opts=opts||{};opts.credentials='same-origin';opts.headers=Object.assign({'Content-Type':'application/json'},opts.headers||{});return fetch('/api'+path,opts).then(async function(r){var j=await r.json().catch(function(){return {};});if(!r.ok)throw new Error(j.error||'Error de conexión con el servidor');return j;});};
var save=function(){store.set('db',db);api('/state',{method:'PUT',body:JSON.stringify(db)}).then(function(j){if(j&&j.state)db=j.state;}).catch(function(e){toast('No se pudo guardar en la base de datos: '+e.message,'bad');});};
var cmp=function(a,b){return (a.fecha+a.hora).localeCompare(b.fecha+b.hora);};
var mine=function(){return db.citas.filter(function(c){return me.rol==='admin'||(me.rol==='medico'&&c.medicoId===me.id)||(me.rol==='paciente'&&c.pacienteId===me.id);});};

/* ---------- datos de ejemplo ---------- */
async function seed(){
  async function mk(id,nombre,email,pw,rol,esp){var salt=uid();return {id:id,nombre:nombre,email:email,salt:salt,hash:await hash(pw,salt),rol:rol,esp:esp||''};}
  var users=await Promise.all([
    mk('u1','Administración MediCita','admin@medicita.sv','Admin123','admin'),
    mk('m1','Dra. Camila Rivas','dra.rivas@medicita.sv','Medico123','medico','Medicina general'),
    mk('m2','Dr. Mauricio Henríquez','dr.henriquez@medicita.sv','Medico123','medico','Pediatría'),
    mk('m3','Dra. Lucía Alvarenga','dra.alvarenga@medicita.sv','Medico123','medico','Ginecología'),
    mk('m4','Dr. Óscar Menjívar','dr.menjivar@medicita.sv','Medico123','medico','Cardiología'),
    mk('p1','Paciente Demo','paciente@medicita.sv','Paciente123','paciente'),
    mk('p2','Ana Martínez','ana.martinez@correo.sv','Paciente123','paciente'),
    mk('p3','Carlos Portillo','carlos.portillo@correo.sv','Paciente123','paciente'),
    mk('p4','Rosa Guzmán','rosa.guzman@correo.sv','Paciente123','paciente'),
    mk('p5','Jorge Cruz','jorge.cruz@correo.sv','Paciente123','paciente')
  ]);
  var rows=[
    [-21,'08:30','p1','m1','Control de presión arterial','Atendida'],
    [-19,'10:00','p2','m2','Vacunación de refuerzo','Atendida'],
    [-17,'14:00','p3','m4','Dolor en el pecho al esfuerzo','Atendida'],
    [-15,'09:30','p4','m3','Control prenatal, semana 20','Atendida'],
    [-13,'11:00','p5','m1','Chequeo general anual','Atendida'],
    [-12,'15:30','p1','m4','Electrocardiograma de control','Cancelada'],
    [-10,'08:00','p2','m2','Fiebre persistente en niño de 4 años','Atendida'],
    [-9,'13:30','p3','m1','Resultados de laboratorio','Atendida'],
    [-7,'10:30','p4','m3','Control prenatal, semana 22','Atendida'],
    [-6,'16:00','p5','m4','Palpitaciones ocasionales','Atendida'],
    [-4,'09:00','p1','m1','Renovación de receta','Atendida'],
    [-3,'11:30','p2','m2','Control de crecimiento','Cancelada'],
    [-2,'14:30','p3','m3','Consulta ginecológica de rutina','Atendida'],
    [-1,'08:30','p5','m1','Dolor de espalda baja','Atendida'],
    [0,'09:00','p1','m1','Seguimiento de presión arterial','Confirmada'],
    [0,'10:30','p4','m3','Control prenatal, semana 24','Confirmada'],
    [0,'15:00','p3','m4','Revisión de ecocardiograma','Pendiente'],
    [1,'08:30','p2','m2','Control de peso y talla','Confirmada'],
    [2,'11:00','p5','m1','Chequeo de azúcar en sangre','Pendiente'],
    [3,'14:00','p1','m4','Prueba de esfuerzo','Pendiente'],
    [5,'09:30','p4','m3','Ultrasonido obstétrico','Confirmada'],
    [6,'10:00','p3','m1','Certificado médico laboral','Pendiente'],
    [8,'16:30','p2','m2','Vacuna contra influenza','Pendiente'],
    [10,'08:00','p5','m4','Control de colesterol','Pendiente']
  ];
  var t=new Date(), citas=rows.map(function(r,i){
    var d=addDays(t,r[0]); if(d.getDay()===0) d=addDays(d,1);
    return {id:'c'+(i+1),fecha:iso(d),hora:r[1],pacienteId:r[2],medicoId:r[3],motivo:r[4],estado:r[5]};
  });
  return {users:users,citas:citas};
}

/* ---------- avisos y modal ---------- */
function toast(msg,type){
  var el=document.createElement('div'); el.className='toast'+(type==='bad'?' bad':''); el.textContent=msg;
  $('#toasts').appendChild(el); setTimeout(function(){el.remove();},3200);
}
function openModal(html){
  var m=$('#modal'); m.innerHTML='<div class="overlay" data-act="overlay"><div class="dialog" role="dialog" aria-modal="true">'+html+'</div></div>'; m.hidden=false;
  var f=m.querySelector('input,select,textarea,button'); if(f) f.focus();
}
function closeModal(){var m=$('#modal'); m.hidden=true; m.innerHTML='';}

/* ---------- sesión y seguridad ---------- */
function touch(){var s=sess.get(); if(s){s.exp=Date.now()+IDLE; sess.set(s);}}
function guard(){
  var s=sess.get();
  if(!s||s.exp<Date.now()){ if(me){me=null; sess.set(null); render(); toast('Tu sesión se cerró por inactividad.','bad');} return false; }
  return true;
}
var can=function(v){return !!me&&PERMS[me.rol].indexOf(v)>-1;};
function go(v){
  if(!guard()) return;
  if(!can(v)){toast('No tienes acceso a esa sección.','bad'); v='panel';}
  view=v; touch(); render(); window.scrollTo(0,0);
}

async function doLogin(email,pw){
  try { var j=await api('/login',{method:'POST',body:JSON.stringify({email:email.trim().toLowerCase(),password:pw})}); db=j.state; me=j.user; sess.set({uid:me.id,exp:Date.now()+IDLE}); view='panel'; return ''; }
  catch(e){return e.message;}
}
async function doRegister(f){
  try { var j=await api('/register',{method:'POST',body:JSON.stringify({nombre:f.nombre,email:f.email,pw:f.pw,pw2:f.pw2})}); db=j.state;me=j.user;sess.set({uid:me.id,exp:Date.now()+IDLE});view='panel';return ''; }
  catch(e){return e.message;}
}

/* ---------- vistas: acceso ---------- */
var LOGO='<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--primary)"/><path d="M13 7h6v6h6v6h-6v6h-6v-6H7v-6h6z" fill="var(--primary-fg)"/><circle cx="26" cy="6" r="3" fill="var(--accent)"/></svg>';

function renderAuth(){
  var reg=authMode==='register';
  var form=reg?
    '<form id="f-reg" class="stack" novalidate>'+
      '<div class="field"><label for="r-nombre">Nombre completo</label><input id="r-nombre" autocomplete="name" required></div>'+
      '<div class="field"><label for="r-email">Correo</label><input id="r-email" type="email" autocomplete="email" required></div>'+
      '<div class="form-grid">'+
        '<div class="field"><label for="r-pw">Contraseña</label><input id="r-pw" type="password" autocomplete="new-password" required><span class="hint">Mínimo 8 caracteres, con letras y números.</span></div>'+
        '<div class="field"><label for="r-pw2">Repite la contraseña</label><input id="r-pw2" type="password" autocomplete="new-password" required></div>'+
      '</div>'+
      '<p class="hint muted" style="font-size:.82rem">Las cuentas nuevas son de paciente. Administración habilita las cuentas de médico.</p>'+
      '<div class="err" id="auth-err" role="alert"></div>'+
      '<button class="btn primary" type="submit">Crear cuenta</button>'+
    '</form>':
    '<form id="f-login" class="stack" novalidate>'+
      '<div class="field"><label for="l-email">Correo electrónico</label><input id="l-email" type="email" placeholder="nombre@correo.com" autocomplete="username" required></div>'+
      '<div class="field"><label for="l-pw">Contraseña</label><input id="l-pw" type="password" placeholder="Introduce tu contraseña" autocomplete="current-password" required></div>'+
      '<div class="err" id="auth-err" role="alert"></div>'+
      '<button class="btn primary" type="submit">Ingresar</button>'+
    '</form>'+
    '<p class="auth-security"><span class="security-mark">✓</span> Acceso privado · Tus datos se gestionan de forma segura</p>';
  $('#root').innerHTML=
    '<div class="auth">'+
      '<section class="brand-panel"><div class="logo">'+LOGO+'MediCita Pro</div>'+
        '<div><span class="brand-kicker">GESTIÓN CLÍNICA INTEGRAL</span><h1>La atención médica, mejor organizada.</h1><p class="lead">Coordina agendas, administra citas y ofrece a cada paciente una experiencia de atención clara y confiable.</p></div>'+
        '<ul class="facts">'+
          '<li><b>01</b><span>Agenda clínica organizada y fácil de consultar.</span></li>'+
          '<li><b>02</b><span>Espacios personalizados para personal médico y pacientes.</span></li>'+
          '<li><b>03</b><span>Control centralizado para gestionar cada cita.</span></li>'+
        '</ul>'+
        '<p class="school">MEDICITA PRO <span>·</span> Plataforma de gestión de citas</p>'+
      '</section>'+
      '<section class="form-panel">'+
        '<div class="form-heading"><span class="eyebrow">'+(reg?'NUEVA CUENTA':'PORTAL DE ACCESO')+'</span><h2>'+(reg?'Crea tu cuenta':'Inicia sesión')+'</h2><p class="muted">'+(reg?'Regístrate para consultar y gestionar tus citas.':'Introduce tus credenciales para continuar a tu espacio de trabajo.')+'</p></div>'+
        '<div class="tabs" role="tablist"><button role="tab" type="button" data-act="tab-login" aria-selected="'+(!reg)+'">Ingresar</button><button role="tab" type="button" data-act="tab-reg" aria-selected="'+reg+'">Crear cuenta</button></div>'+
        form+
      '</section>'+
    '</div>';
}

/* ---------- vistas: estructura de la app ---------- */
function render(){
  if(!me){renderAuth();return;}
  if(!can(view)) view='panel';
  var nav=PERMS[me.rol].map(function(v){return '<button type="button" data-act="nav" data-v="'+v+'"'+(v===view?' aria-current="page"':'')+'>'+NAV[v]+'</button>';}).join('');
  $('#root').innerHTML=
    '<div class="page"><header class="top"><div class="logo">'+LOGO+'MediCita Pro</div>'+
    '<nav class="nav" aria-label="Secciones">'+nav+'</nav>'+
    '<div class="who"><div class="n"><b>'+esc(me.nombre)+'</b><span>'+ROLES[me.rol]+'</span></div><button class="btn sm" type="button" data-act="logout">Salir</button></div></header>'+
    '<main id="view"></main>'+
    '<p class="foot">MediCita Pro · Instituto Nacional General Francisco Menéndez · Módulo 3.8, Desarrollo de la Aplicación Web</p></div>';
  ({panel:vPanel,citas:vCitas,reportes:vReportes,usuarios:vUsuarios,proyecto:vProyecto})[view]();
}

function who(c){
  if(me.rol==='paciente'){var m=user(c.medicoId);return 'Con '+nm(c.medicoId)+(m&&m.esp?' · '+m.esp:'');}
  if(me.rol==='medico') return 'Paciente: '+nm(c.pacienteId);
  return nm(c.pacienteId)+' con '+nm(c.medicoId);
}

/* ---------- panel ---------- */
function vPanel(){
  var cs=mine(), t=iso(new Date()), w=iso(addDays(new Date(),7));
  var hoy=cs.filter(function(c){return c.fecha===t&&c.estado!=='Cancelada';}).length;
  var prox=cs.filter(function(c){return c.fecha>t&&c.fecha<=w&&c.estado!=='Cancelada';}).length;
  var pend=cs.filter(function(c){return c.estado==='Pendiente'&&c.fecha>=t;}).length;
  var mes=cs.filter(function(c){return c.estado==='Atendida'&&c.fecha.slice(0,7)===t.slice(0,7);}).length;
  var up=cs.filter(function(c){return c.fecha>=t&&c.estado!=='Cancelada';}).sort(cmp).slice(0,6);
  var hr=new Date().getHours(), sal=hr<12?'Buenos días':hr<19?'Buenas tardes':'Buenas noches';
  var cnt={}; ESTADOS.forEach(function(e){cnt[e]=cs.filter(function(c){return c.estado===e;}).length;});
  var tot=Math.max(1,cs.length);
  var list=up.length?'<ul class="agenda">'+up.map(function(c){return '<li><div><div class="t">'+c.hora+'</div><div class="d">'+(c.fecha===t?'Hoy':fmtDate(c.fecha))+'</div></div><div class="m"><b>'+esc(c.motivo)+'</b><span>'+esc(who(c))+'</span></div><span class="pill '+PILL[c.estado]+'">'+c.estado+'</span></li>';}).join('')+'</ul>':'<div class="empty">No tienes citas próximas. Agenda una con el botón Nueva cita.</div>';
  $('#view').innerHTML=
    '<div class="head"><div><span class="eyebrow">'+ROLES[me.rol]+'</span><h1>'+sal+', '+esc(me.nombre)+'</h1></div><button class="btn primary" type="button" data-act="new-cita">Nueva cita</button></div>'+
    '<div class="kpis"><div class="kpi"><span class="eyebrow">Hoy</span><div class="v">'+hoy+'</div></div><div class="kpi"><span class="eyebrow">Próximos 7 días</span><div class="v">'+prox+'</div></div><div class="kpi"><span class="eyebrow">Por confirmar</span><div class="v">'+pend+'</div></div><div class="kpi"><span class="eyebrow">Atendidas este mes</span><div class="v">'+mes+'</div></div></div>'+
    '<div class="grid2"><section class="card"><h3>Próximas citas</h3>'+list+'<div class="pager"><span></span><button class="btn sm" type="button" data-act="nav" data-v="citas">Ver todas las citas</button></div></section>'+
    '<section class="card"><h3>Estado de las citas</h3><div class="stackbar">'+ESTADOS.map(function(e){return '<i class="'+BARC[e]+'" style="width:'+(cnt[e]/tot*100)+'%" title="'+e+'"></i>';}).join('')+'</div>'+
    '<ul class="legend">'+ESTADOS.map(function(e){return '<li><span class="dot '+BARC[e]+'"></span>'+e+'<span class="c">'+cnt[e]+'</span></li>';}).join('')+'</ul></section></div>';
}

/* ---------- citas (CRUD, búsqueda y filtros) ---------- */
function filtered(){
  var q=flt.q.trim().toLowerCase(), t=iso(new Date());
  return mine().filter(function(c){
    if(flt.estado&&c.estado!==flt.estado) return false;
    if(flt.medico&&c.medicoId!==flt.medico) return false;
    if(flt.desde&&c.fecha<flt.desde) return false;
    if(flt.hasta&&c.fecha>flt.hasta) return false;
    if(q){var m=user(c.medicoId)||{}; var s=(nm(c.pacienteId)+' '+nm(c.medicoId)+' '+c.motivo+' '+(m.esp||'')).toLowerCase(); if(s.indexOf(q)<0) return false;}
    return true;
  }).sort(function(a,b){
    var fa=a.fecha>=t, fb=b.fecha>=t;
    if(fa!==fb) return fa?-1:1;
    return fa?cmp(a,b):cmp(b,a);
  });
}
var canEdit=function(c){return me.rol==='admin'||(me.rol==='medico'&&c.medicoId===me.id)||(me.rol==='paciente'&&c.pacienteId===me.id&&(c.estado==='Pendiente'||c.estado==='Confirmada'));};
var canCancel=function(c){return (c.estado==='Pendiente'||c.estado==='Confirmada')&&(me.rol==='admin'||c.pacienteId===me.id||c.medicoId===me.id);};

function vCitas(){
  var meds=db.users.filter(function(u){return u.rol==='medico';});
  var medField=me.rol==='medico'?'':'<div class="field"><label for="f-medico">Médico</label><select id="f-medico" data-f="medico"><option value="">Todos</option>'+meds.map(function(m){return '<option value="'+m.id+'"'+(flt.medico===m.id?' selected':'')+'>'+esc(m.nombre)+'</option>';}).join('')+'</select></div>';
  $('#view').innerHTML=
    '<div class="head"><div><span class="eyebrow">Gestión</span><h2>Citas médicas</h2><p>Busca, filtra, crea, edita y cancela citas.</p></div><button class="btn primary" type="button" data-act="new-cita">Nueva cita</button></div>'+
    '<section class="card"><div class="toolbar">'+
      '<div class="field" style="grid-column:span 2"><label for="f-q">Buscar</label><input id="f-q" type="search" data-f="q" placeholder="Paciente, médico, motivo o especialidad" value="'+esc(flt.q)+'"></div>'+
      '<div class="field"><label for="f-estado">Estado</label><select id="f-estado" data-f="estado"><option value="">Todos</option>'+ESTADOS.map(function(e){return '<option'+(flt.estado===e?' selected':'')+'>'+e+'</option>';}).join('')+'</select></div>'+
      medField+
      '<div class="field"><label for="f-desde">Desde</label><input id="f-desde" type="date" data-f="desde" value="'+flt.desde+'"></div>'+
      '<div class="field"><label for="f-hasta">Hasta</label><input id="f-hasta" type="date" data-f="hasta" value="'+flt.hasta+'"></div>'+
      '<button class="btn" type="button" data-act="clear-f">Limpiar</button>'+
    '</div></section><section class="card" id="cres"></section>';
  rCitas();
}
function rCitas(){
  var list=filtered(), pages=Math.max(1,Math.ceil(list.length/PAGE));
  if(flt.page>pages) flt.page=pages;
  var rows=list.slice((flt.page-1)*PAGE,flt.page*PAGE);
  var body=rows.map(function(c){
    var m=user(c.medicoId)||{};
    var acts=(canEdit(c)?'<button class="btn sm" type="button" data-act="edit" data-id="'+c.id+'">Editar</button>':'')+
      (canCancel(c)?'<button class="btn sm" type="button" data-act="cancel" data-id="'+c.id+'">Cancelar</button>':'')+
      (me.rol==='admin'?'<button class="btn sm danger" type="button" data-act="del" data-id="'+c.id+'">Eliminar</button>':'');
    return '<tr><td data-label="Fecha"><b>'+fmtDate(c.fecha)+'</b><span class="sub mono">'+c.hora+'</span></td>'+
      '<td data-label="Paciente">'+esc(nm(c.pacienteId))+'</td>'+
      '<td data-label="Médico">'+esc(nm(c.medicoId))+'<span class="sub">'+esc(m.esp||'')+'</span></td>'+
      '<td data-label="Motivo">'+esc(c.motivo)+'</td>'+
      '<td data-label="Estado"><span class="pill '+PILL[c.estado]+'">'+c.estado+'</span></td>'+
      '<td class="act">'+acts+'</td></tr>';
  }).join('');
  $('#cres').innerHTML=list.length?
    '<div class="table-wrap"><table class="resp"><thead><tr><th>Fecha y hora</th><th>Paciente</th><th>Médico</th><th>Motivo</th><th>Estado</th><th></th></tr></thead><tbody>'+body+'</tbody></table></div>'+
    '<div class="pager"><span class="muted">'+list.length+(list.length===1?' cita':' citas')+' · página '+flt.page+' de '+pages+'</span><span><button class="btn sm" type="button" data-act="page" data-n="'+(flt.page-1)+'"'+(flt.page<=1?' disabled':'')+'>Anterior</button> <button class="btn sm" type="button" data-act="page" data-n="'+(flt.page+1)+'"'+(flt.page>=pages?' disabled':'')+'>Siguiente</button></span></div>':
    '<div class="empty">Ninguna cita coincide con los filtros. Prueba con otro texto o pulsa Limpiar.</div>';
}

function citaForm(id){
  var c=id?db.citas.find(function(x){return x.id===id;}):null;
  var meds=db.users.filter(function(u){return u.rol==='medico';}), pats=db.users.filter(function(u){return u.rol==='paciente';});
  var pac=me.rol==='paciente'?
    '<div class="field"><label>Paciente</label><input value="'+esc(me.nombre)+'" disabled></div>':
    '<div class="field"><label for="c-pac">Paciente</label><select id="c-pac">'+pats.map(function(p){return '<option value="'+p.id+'"'+(c&&c.pacienteId===p.id?' selected':'')+'>'+esc(p.nombre)+'</option>';}).join('')+'</select></div>';
  var med=me.rol==='medico'?
    '<div class="field"><label>Médico</label><input value="'+esc(me.nombre)+'" disabled></div>':
    '<div class="field"><label for="c-med">Médico</label><select id="c-med">'+meds.map(function(m){return '<option value="'+m.id+'"'+(c&&c.medicoId===m.id?' selected':'')+'>'+esc(m.nombre)+' · '+esc(m.esp)+'</option>';}).join('')+'</select></div>';
  var est=me.rol==='paciente'?'':'<div class="field"><label for="c-estado">Estado</label><select id="c-estado">'+ESTADOS.map(function(e){return '<option'+(c&&c.estado===e?' selected':'')+'>'+e+'</option>';}).join('')+'</select></div>';
  openModal('<h2>'+(c?'Editar cita':'Nueva cita')+'</h2>'+
    '<form id="f-cita" class="stack" data-id="'+(c?c.id:'')+'" novalidate><div class="form-grid">'+pac+med+
    '<div class="field"><label for="c-fecha">Fecha</label><input id="c-fecha" type="date" value="'+(c?c.fecha:'')+'"'+(c?'':' min="'+iso(new Date())+'"')+'></div>'+
    '<div class="field"><label for="c-hora">Hora</label><select id="c-hora">'+SLOTS.map(function(s){return '<option'+(c&&c.hora===s?' selected':'')+'>'+s+'</option>';}).join('')+'</select></div>'+
    est+'<div class="field full"><label for="c-motivo">Motivo de la consulta</label><textarea id="c-motivo" maxlength="200">'+esc(c?c.motivo:'')+'</textarea></div></div>'+
    '<div class="err" id="cita-err" role="alert"></div>'+
    '<div class="row"><button class="btn" type="button" data-act="close">Cerrar</button><button class="btn primary" type="submit">'+(c?'Guardar cambios':'Agendar cita')+'</button></div></form>');
}
function saveCita(id){
  if(!guard()) return;
  var old=id?db.citas.find(function(x){return x.id===id;}):null;
  var pId=me.rol==='paciente'?me.id:$('#c-pac').value, mId=me.rol==='medico'?me.id:$('#c-med').value;
  var fecha=$('#c-fecha').value, hora=$('#c-hora').value, motivo=$('#c-motivo').value.trim();
  var estado=me.rol==='paciente'?(old?old.estado:'Pendiente'):$('#c-estado').value, msg='';
  if(old&&!canEdit(old)) msg='No tienes permiso para editar esta cita.';
  else if(!fecha) msg='Elige la fecha de la cita.';
  else if(parse(fecha).getDay()===0) msg='No hay atención los domingos. Elige otro día.';
  else if((estado==='Pendiente'||estado==='Confirmada')&&fecha<iso(new Date())) msg='Una cita pendiente o confirmada no puede quedar en una fecha pasada.';
  else if(motivo.length<5) msg='Describe el motivo de la consulta con al menos 5 caracteres.';
  else if(estado!=='Cancelada'&&db.citas.some(function(c){return c.id!==id&&c.estado!=='Cancelada'&&c.fecha===fecha&&c.hora===hora&&(c.medicoId===mId||c.pacienteId===pId);})) msg='Ya hay una cita a esa hora para el médico o el paciente. Elige otro horario.';
  if(msg){$('#cita-err').textContent=msg;return;}
  if(old){old.pacienteId=pId;old.medicoId=mId;old.fecha=fecha;old.hora=hora;old.motivo=motivo;old.estado=estado;}
  else db.citas.push({id:'c'+uid(),fecha:fecha,hora:hora,pacienteId:pId,medicoId:mId,motivo:motivo,estado:estado});
  save(); touch(); closeModal(); toast(old?'Cita actualizada.':'Cita agendada.'); render();
}
function confirmBox(title,text,act,id,label,danger){
  openModal('<h2>'+title+'</h2><p class="muted">'+text+'</p><div class="row"><button class="btn" type="button" data-act="close">Volver</button><button class="btn '+(danger?'danger':'primary')+'" type="button" data-act="'+act+'" data-id="'+id+'">'+label+'</button></div>');
}

/* ---------- reportes ---------- */
function repList(){
  var t=iso(new Date()), d30=iso(addDays(new Date(),-29));
  return mine().filter(function(c){
    if(rep.periodo==='30') return c.fecha>=d30&&c.fecha<=t;
    if(rep.periodo==='mes') return c.fecha.slice(0,7)===t.slice(0,7);
    return true;
  });
}
function bars(rows){
  var max=Math.max.apply(null,rows.map(function(r){return r[1];}).concat([1]));
  return '<div class="bars">'+rows.map(function(r){return '<div class="bar-row"><span class="lbl">'+esc(r[0])+'</span><div class="track"><i style="width:'+(r[1]/max*100)+'%"></i></div><span class="val">'+r[1]+'</span></div>';}).join('')+'</div>';
}
function vReportes(){
  var cs=repList(), n=function(e){return cs.filter(function(c){return c.estado===e;}).length;};
  var at=n('Atendida'), ca=n('Cancelada'), por=n('Pendiente')+n('Confirmada');
  var asis=(at+ca)?Math.round(at/(at+ca)*100)+'%':'—';
  var group={}; cs.forEach(function(c){var k=me.rol==='admin'?nm(c.medicoId):nm(c.pacienteId); group[k]=(group[k]||0)+1;});
  var gRows=Object.keys(group).map(function(k){return [k,group[k]];}).sort(function(a,b){return b[1]-a[1];}).slice(0,6);
  var all=mine(), days=[], max=1, t=iso(new Date());
  for(var i=-7;i<=7;i++){var d=addDays(new Date(),i), f=iso(d); var v=all.filter(function(c){return c.fecha===f&&c.estado!=='Cancelada';}).length; max=Math.max(max,v); days.push({f:f,d:d,v:v});}
  var chart='<div class="cols-wrap"><div class="cols">'+days.map(function(x){return '<div class="col'+(x.f===t?' today':'')+'"><span class="v">'+(x.v||'')+'</span><div class="b" style="height:'+Math.round(x.v/max*130)+'px"></div><span>'+p2(x.d.getDate())+'</span><span class="wd">'+'DLMMJVS'[x.d.getDay()]+'</span></div>';}).join('')+'</div></div>';
  $('#view').innerHTML=
    '<div class="head"><div><span class="eyebrow">Estadísticas</span><h2>Reportes</h2><p>Resumen de la actividad de citas'+(me.rol==='admin'?' de toda la clínica.':me.rol==='medico'?' de tu agenda.':'.')+'</p></div>'+
    '<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap"><div class="field"><label for="r-per">Periodo</label><select id="r-per" data-rep="periodo"><option value="todo"'+(rep.periodo==='todo'?' selected':'')+'>Todas las citas</option><option value="30"'+(rep.periodo==='30'?' selected':'')+'>Últimos 30 días</option><option value="mes"'+(rep.periodo==='mes'?' selected':'')+'>Este mes</option></select></div><button class="btn" type="button" data-act="copy-csv">Copiar CSV</button></div></div>'+
    '<div class="kpis"><div class="kpi"><span class="eyebrow">Total</span><div class="v">'+cs.length+'</div></div><div class="kpi"><span class="eyebrow">Atendidas</span><div class="v">'+at+'</div></div><div class="kpi"><span class="eyebrow">Canceladas</span><div class="v">'+ca+'</div></div><div class="kpi"><span class="eyebrow">Por atender</span><div class="v">'+por+'</div></div><div class="kpi"><span class="eyebrow">Asistencia</span><div class="v">'+asis+'</div></div></div>'+
    '<div class="grid2"><section class="card"><h3>Citas por estado</h3>'+bars(ESTADOS.map(function(e){return [e,n(e)];}))+'</section>'+
    '<section class="card"><h3>'+(me.rol==='admin'?'Citas por médico':'Pacientes con más citas')+'</h3>'+(gRows.length?bars(gRows):'<div class="empty">Sin citas en este periodo.</div>')+'</section></div>'+
    '<section class="card"><h3>Citas activas por día, 7 días atrás y 7 adelante</h3>'+chart+'</section>';
}
function csvText(){
  var q=function(s){return '"'+String(s).replace(/"/g,'""')+'"';};
  return ['fecha,hora,paciente,medico,especialidad,motivo,estado'].concat(repList().sort(cmp).map(function(c){var m=user(c.medicoId)||{};return [c.fecha,c.hora,q(nm(c.pacienteId)),q(nm(c.medicoId)),q(m.esp||''),q(c.motivo),c.estado].join(',');})).join('\n');
}
function copyText(txt){
  var fallback=function(){openModal('<h2>Copia el CSV</h2><p class="muted">Tu navegador no permitió copiar de forma automática. Selecciona el texto y cópialo.</p><textarea id="csv-box" readonly style="min-height:200px;font-family:var(--f-mono);font-size:.8rem">'+esc(txt)+'</textarea><div class="row"><button class="btn primary" type="button" data-act="close">Listo</button></div>');var b=$('#csv-box');if(b){b.focus();b.select();}};
  try{navigator.clipboard.writeText(txt).then(function(){toast('CSV copiado al portapapeles.');},fallback);}catch(e){fallback();}
}

/* ---------- usuarios (solo administración) ---------- */
function vUsuarios(){
  $('#view').innerHTML='<div class="head"><div><span class="eyebrow">Administración</span><h2>Usuarios</h2><p>Cambia roles y elimina cuentas. Un médico nuevo se habilita aquí.</p></div></div>'+
    '<section class="card"><div class="field" style="max-width:360px;margin-bottom:14px"><label for="u-q">Buscar usuario</label><input id="u-q" type="search" data-uq placeholder="Nombre o correo" value="'+esc(uq)+'"></div><div id="ures"></div></section>';
  rUsers();
}
function rUsers(){
  var q=uq.trim().toLowerCase();
  var list=db.users.filter(function(u){return !q||(u.nombre+' '+u.email).toLowerCase().indexOf(q)>-1;});
  $('#ures').innerHTML=list.length?'<div class="table-wrap"><table class="resp"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Citas</th><th></th></tr></thead><tbody>'+list.map(function(u){
    var self=u.id===me.id, nC=db.citas.filter(function(c){return c.pacienteId===u.id||c.medicoId===u.id;}).length;
    var sel='<select data-role="'+u.id+'" aria-label="Rol de '+esc(u.nombre)+'"'+(self?' disabled':'')+'>'+Object.keys(ROLES).map(function(r){return '<option value="'+r+'"'+(u.rol===r?' selected':'')+'>'+ROLES[r]+'</option>';}).join('')+'</select>';
    return '<tr><td data-label="Nombre"><b>'+esc(u.nombre)+'</b>'+(self?' <span class="pill neutral">Tú</span>':'')+'<span class="sub">'+esc(u.esp||'')+'</span></td><td data-label="Correo" class="mono" style="font-size:.85rem;overflow-wrap:anywhere">'+esc(u.email)+'</td><td data-label="Rol">'+sel+'</td><td data-label="Citas" class="mono">'+nC+'</td><td class="act">'+(self?'':'<button class="btn sm danger" type="button" data-act="udel" data-id="'+u.id+'">Eliminar</button>')+'</td></tr>';
  }).join('')+'</tbody></table></div>':'<div class="empty">No hay usuarios con ese nombre o correo.</div>';
}

/* ---------- proyecto ---------- */
function vProyecto(){
  var rows=[
    ['Inicio de sesión','Contraseñas con hash y sal, bloqueo de 60 s tras 5 intentos fallidos, cierre por inactividad a los 30 min.'],
    ['Registro de usuarios','Validación de correo único, contraseña de 8 o más caracteres con letras y números, confirmación.'],
    ['Gestión de información (CRUD)','Crear, listar, editar, cancelar y eliminar citas, con control de choques de horario y domingos sin atención.'],
    ['Búsquedas o filtros','Texto libre, estado, médico y rango de fechas, con paginación de 8 citas.'],
    ['Reportes o estadísticas básicas','Totales, asistencia, citas por estado y por médico, agenda de 15 días y copia de datos en CSV.'],
    ['Diseño adaptable','Cuadrícula fluida, tabla que se convierte en tarjetas en el teléfono, modo claro y oscuro.'],
    ['Seguridad básica de acceso','Control por roles (administración, médico, paciente) y bloqueo de secciones no autorizadas.']
  ];
  var shots=[['Inicio de sesión','Pantalla de acceso con registro y cuentas de ejemplo.','Cerrar sesión para verla','logout'],['Panel principal','Resumen del día, próximas citas y estado general.','Abrir panel','nav:panel'],['Módulo de gestión','Tabla de citas con filtros, formulario y edición.','Abrir citas','nav:citas']];
  $('#view').innerHTML=
    '<div class="head"><div><span class="eyebrow">Módulo 3.8</span><h2>Desarrollo de la aplicación web</h2><p>MediCita Pro, plataforma integral de gestión y control de citas médicas.</p></div></div>'+
    '<div class="grid2"><section class="card"><h3>Equipo</h3><p>Kenneth Ubaldo Ramírez Osorio<br>Nathaly Elizabeth Herrera Arévalo<br>Ricardo José Ortiz Sambrano</p><p class="muted" style="margin-top:12px">Instituto Nacional General Francisco Menéndez · Técnico en Desarrollo de Software · Sección 3-2 · Módulos 3.7 y 3.8 · Entrega III</p></section>'+
    '<section class="card"><h3>Tecnología</h3><ul class="legend"><li>Front-End<span class="c">HTML5 · CSS3 · JavaScript</span></li><li>Back-End<span class="c">Node.js · Express</span></li><li>Base de datos<span class="c">SQLite persistente</span></li></ul></section></div>'+
    '<section class="card"><h3>Funcionalidades mínimas</h3><div class="table-wrap"><table class="check resp"><thead><tr><th>Funcionalidad</th><th>Estado</th><th>Qué incluye</th></tr></thead><tbody>'+
    rows.map(function(r){return '<tr><td data-label="Función">'+r[0]+'</td><td data-label="Estado"><span class="pill ok">Funcional</span></td><td data-label="Detalle">'+r[1]+'</td></tr>';}).join('')+'</tbody></table></div>'+
    '<div class="note" style="margin-top:16px">Sistema conectado a una API Node.js con sesiones del servidor y persistencia en SQLite. Los cambios de citas y usuarios se guardan en la base de datos.</div></section>'+
    '<section class="card"><h3>Pantallas del sistema</h3><div class="shots">'+shots.map(function(s){return '<div class="shot"><div><b>'+s[0]+'</b><p class="muted" style="font-size:.9rem;margin-top:4px">'+s[1]+'</p></div><button class="btn sm" type="button" data-act="'+(s[3]==='logout'?'logout':'nav')+'" data-v="'+s[3].replace('nav:','')+'">'+s[2]+'</button></div>';}).join('')+'</div></section>'+
    '<section class="card"><h3>Modelo de datos</h3><pre>CREATE TABLE usuarios (\n  id INT AUTO_INCREMENT PRIMARY KEY,\n  nombre VARCHAR(120) NOT NULL,\n  email VARCHAR(120) NOT NULL UNIQUE,\n  password_hash VARCHAR(255) NOT NULL,\n  rol ENUM(\'admin\',\'medico\',\'paciente\') NOT NULL,\n  especialidad VARCHAR(80) NULL\n);\n\nCREATE TABLE citas (\n  id INT AUTO_INCREMENT PRIMARY KEY,\n  paciente_id INT NOT NULL REFERENCES usuarios(id),\n  medico_id INT NOT NULL REFERENCES usuarios(id),\n  fecha DATE NOT NULL,\n  hora TIME NOT NULL,\n  motivo VARCHAR(200) NOT NULL,\n  estado ENUM(\'Pendiente\',\'Confirmada\',\'Atendida\',\'Cancelada\') NOT NULL,\n  UNIQUE (medico_id, fecha, hora)\n);</pre>'+
    ''+'</section>';
}

/* ---------- eventos ---------- */
document.addEventListener('click',async function(e){
  var el=e.target.closest('[data-act]'); if(!el) return;
  var a=el.dataset.act, id=el.dataset.id;
  if(a==='overlay'){ if(e.target===el) closeModal(); return; }
  if(a==='tab-login'){authMode='login';renderAuth();return;}
  if(a==='tab-reg'){authMode='register';renderAuth();return;}
  if(a==='demo'){$('#l-email').value=el.dataset.email;$('#l-pw').value=el.dataset.pw;$('#l-pw').focus();return;}
  if(a==='close'){closeModal();return;}
  if(a==='logout'){api('/logout',{method:'POST',body:'{}'}).catch(function(){});me=null;sess.set(null);authMode='login';closeModal();render();return;}
  if(!guard()) return;
  touch();
  if(a==='nav'){closeModal();go(el.dataset.v);}
  else if(a==='new-cita') citaForm(null);
  else if(a==='edit'){var c=db.citas.find(function(x){return x.id===id;}); if(c&&canEdit(c)) citaForm(id); else toast('No tienes permiso para editar esta cita.','bad');}
  else if(a==='cancel'){var c2=db.citas.find(function(x){return x.id===id;}); if(c2) confirmBox('¿Cancelar esta cita?','La cita del '+fmtDate(c2.fecha)+' a las '+c2.hora+' pasará a estado Cancelada y el horario quedará libre.','do-cancel',id,'Cancelar cita',true);}
  else if(a==='do-cancel'){var c3=db.citas.find(function(x){return x.id===id;}); if(c3&&canCancel(c3)){c3.estado='Cancelada';save();closeModal();toast('Cita cancelada.');render();}}
  else if(a==='del'){if(me.rol==='admin') confirmBox('¿Eliminar esta cita?','Se borra de forma permanente. Para conservar el historial, mejor cancélala.','do-del',id,'Eliminar',true);}
  else if(a==='do-del'){if(me.rol==='admin'){db.citas=db.citas.filter(function(x){return x.id!==id;});save();closeModal();toast('Cita eliminada.');render();}}
  else if(a==='udel'){var u=user(id); if(me.rol==='admin'&&u){var n=db.citas.filter(function(c){return c.pacienteId===id||c.medicoId===id;}).length; confirmBox('¿Eliminar a '+esc(u.nombre)+'?',n?'También se eliminarán sus '+n+' citas.':'Esta cuenta no tiene citas asociadas.','do-udel',id,'Eliminar usuario',true);}}
  else if(a==='do-udel'){if(me.rol==='admin'&&id!==me.id){var admins=db.users.filter(function(x){return x.rol==='admin';}); var tgt=user(id); if(tgt&&tgt.rol==='admin'&&admins.length<2){toast('Debe quedar al menos una cuenta de administración.','bad');return;} db.users=db.users.filter(function(x){return x.id!==id;}); db.citas=db.citas.filter(function(c){return c.pacienteId!==id&&c.medicoId!==id;}); save();closeModal();toast('Usuario eliminado.');render();}}
  else if(a==='page'){flt.page=parseInt(el.dataset.n,10)||1;rCitas();}
  else if(a==='clear-f'){flt={q:'',estado:'',medico:'',desde:'',hasta:'',page:1};vCitas();}
  else if(a==='copy-csv') copyText(csvText());

});
document.addEventListener('submit',async function(e){
  e.preventDefault(); var fid=e.target.id, err;
  if(fid==='f-login'){err=await doLogin($('#l-email').value,$('#l-pw').value); if(err) $('#auth-err').textContent=err; else render();}
  else if(fid==='f-reg'){err=await doRegister({nombre:$('#r-nombre').value,email:$('#r-email').value,pw:$('#r-pw').value,pw2:$('#r-pw2').value}); if(err) $('#auth-err').textContent=err; else{toast('Cuenta creada. Bienvenido a MediCita Pro.');render();}}
  else if(fid==='f-cita') saveCita(e.target.dataset.id||null);
});
document.addEventListener('input',function(e){
  var t=e.target;
  if(t.dataset&&t.dataset.f){flt[t.dataset.f]=t.value;flt.page=1;rCitas();}
  else if(t.hasAttribute&&t.hasAttribute('data-uq')){uq=t.value;rUsers();}
});
document.addEventListener('change',function(e){
  var t=e.target;
  if(t.dataset&&t.dataset.rep){rep[t.dataset.rep]=t.value;vReportes();}
  else if(t.dataset&&t.dataset.role&&me&&me.rol==='admin'&&guard()){
    var u=user(t.dataset.role); if(!u||u.id===me.id) return;
    if(u.rol==='admin'&&t.value!=='admin'&&db.users.filter(function(x){return x.rol==='admin';}).length<2){toast('Debe quedar al menos una cuenta de administración.','bad');rUsers();return;}
    u.rol=t.value; if(u.rol==='medico'&&!u.esp) u.esp='Medicina general'; save(); touch(); toast('Rol de '+u.nombre+' actualizado.'); rUsers();
  }
});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!$('#modal').hidden) closeModal();});

/* ---------- arranque ---------- */
(async function init(){
  try { var j=await api('/me'); if(j&&j.user){db=j.state;me=j.user;sess.set({uid:me.id,exp:Date.now()+IDLE});} else {me=null;sess.set(null);} }
  catch(e) { me=null; }
  render(); setInterval(guard,30000);
})();

})();
