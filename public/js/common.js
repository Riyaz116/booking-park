const $=(s,r=document)=>r.querySelector(s);
const api=async(u,o={})=>{const r=await fetch(u,{headers:{'Content-Type':'application/json'},...o,body:o.body?JSON.stringify(o.body):undefined});const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(d.error||'Ошибка запроса'),{status:r.status});return d};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rub=n=>Number(n).toLocaleString('ru-RU')+' ₽';
const when=iso=>new Date(iso).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});
const ymd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const CAT={extreme:'Экстрим',zoo:'Зоопарк',water:'Вода',cinema:'Кино'};
const NAV=[['/','Главная'],['/attractions.html','Развлечения'],['/my-bookings.html','Мои брони']];
async function init(){
  const user=await api('/api/auth/me').catch(()=>null);
  const p=location.pathname.replace(/index\.html$/,'');
  $('#top').innerHTML=`<div class="wrap"><a class="logo" href="/">Сказочная Лагуна</a><nav>${NAV.map(([h,t])=>`<a href="${h}"${h===p?' aria-current="page"':''}>${t}</a>`).join('')}${user?`<span>${esc(user.name)}</span><button class="link" id="out" style="color:#fff">Выйти</button>`:'<a href="/login.html">Войти</a>'}</nav></div>`;
  $('#out')?.addEventListener('click',async()=>{await api('/api/auth/logout',{method:'POST'});location.href='/'});
  $('#foot').textContent='© 2026 Парк «Сказочная Лагуна»';
  return user;
}
function needAuth(user){if(!user)location.href='/login.html?next='+encodeURIComponent(location.pathname+location.search);return !!user}
function authPage(register){
  const next=new URLSearchParams(location.search).get('next');
  const dest=next&&next.startsWith('/')&&!next.startsWith('//')?next:'/';
  init();
  $('form').addEventListener('submit',async e=>{
    e.preventDefault();const btn=$('button',e.target);btn.disabled=true;
    try{await api(register?'/api/auth/register':'/api/auth/login',{method:'POST',body:Object.fromEntries(new FormData(e.target))});location.href=dest}
    catch(err){$('#msg').textContent=err.message;btn.disabled=false}
  });
}
