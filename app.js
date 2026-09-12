
const products=[
 {id:'cookie',name:'Lotusblütenkeks',desc:'Knuspriger Lotusblütenkeks',price:3000,img:'assets/lotusblueten-keks.png',cat:'food'},
 {id:'miso',name:'Lotus Miso Suppe',desc:'Warme Miso Suppe',price:5000,img:'assets/lotus-miso-suppe.png',cat:'food'},
 {id:'lemonade',name:'White Lotus Limonade',desc:'Erfrischende Limonade',price:4000,img:'assets/white-lotus-limonade.png',cat:'drink'},
 {id:'beer',name:'Bier',desc:'Kaltes Bier',price:1000,img:'assets/bier.png',cat:'drink'},
 {id:'wine',name:'Wein',desc:'Ausgewählter Wein',price:1500,img:'assets/wein.png',cat:'drink'},
 {id:'vodka',name:'Vodka E',desc:'Neon Lotus Vodka E',price:2000,img:'assets/vodka-e.png',cat:'drink'},
 {id:'tequila',name:'Tequila',desc:'Tequila Shot',price:2000,img:'assets/tequila.png',cat:'drink'}
];
const cart=Object.fromEntries(products.map(p=>[p.id,0]));
const money=n=>'$'+n.toLocaleString('de-DE');
function card(p){return `<article class="card"><div class="product-img"><img src="${p.img}" alt="${p.name}"></div><div class="product-info"><h3>${p.name}</h3><div class="desc">${p.desc}</div><div class="bottom"><div class="price">${money(p.price)}</div><div class="qty"><button onclick="change('${p.id}',-1)">−</button><span id="q-${p.id}">0</span><button onclick="change('${p.id}',1)">+</button></div></div></div></article>`}
document.querySelector('#food-grid').innerHTML=products.filter(p=>p.cat==='food').map(card).join('');
document.querySelector('#drink-grid').innerHTML=products.filter(p=>p.cat==='drink').map(card).join('');
function change(id,d){cart[id]=Math.max(0,Math.min(99,cart[id]+d));document.querySelector('#q-'+id).textContent=cart[id];renderCart()}
function renderCart(){
 const chosen=products.filter(p=>cart[p.id]>0), lines=document.querySelector('#cart-lines'), empty=document.querySelector('#cart-empty');
 empty.style.display=chosen.length?'none':'flex';
 lines.innerHTML=chosen.map(p=>`<div class="cart-line"><b>${cart[p.id]}× ${p.name}</b><span>${money(p.price)} / Stk.</span><strong>${money(p.price*cart[p.id])}</strong></div>`).join('');
 document.querySelector('#total').textContent=money(chosen.reduce((s,p)=>s+p.price*cart[p.id],0));
}
let method='pickup';
document.querySelectorAll('.method').forEach(b=>b.onclick=()=>{document.querySelectorAll('.method').forEach(x=>x.classList.remove('active'));b.classList.add('active');method=b.dataset.method;document.querySelector('#postal-wrap').classList.toggle('hidden',method!=='delivery')});
document.querySelector('#submit').onclick=async()=>{
 const chosen=products.filter(p=>cart[p.id]>0), name=document.querySelector('#customer').value.trim(), postal=document.querySelector('#postal').value.trim();
 const note=document.querySelector('#note').value.trim();
 const msg=document.querySelector('#message');
 if(!chosen.length){msg.style.color='#ff9ca8';msg.textContent='Bitte wähle mindestens ein Produkt aus.';return}
 if(!name){msg.style.color='#ff9ca8';msg.textContent='Bitte gib einen Namen / Ansprechpartner an.';return}
 if(method==='delivery'&&!postal){msg.style.color='#ff9ca8';msg.textContent='Bitte gib für die Lieferung eine PLZ an.';return}

 const payload={
   customer:name,
   method,
   postalCode: method==='delivery' ? postal : null,
   note: note || null,
   items: chosen.map(p=>({
     id:p.id,
     name:p.name,
     quantity:cart[p.id],
     unitPrice:p.price
   }))
 };

 const submit=document.querySelector('#submit');
 submit.disabled=true;
 submit.style.opacity='.7';
 msg.style.color='#bfb5bd';
 msg.textContent='Bestellung wird übermittelt …';

 try{
   const response=await fetch('https://neon-lotus-bot-production.up.railway.app/api/orders',{
     method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify(payload)
   });
   const data=await response.json();
   if(!response.ok) throw new Error(data.error || 'Bestellung konnte nicht übermittelt werden.');
   msg.style.color='#9be1b7';
   msg.innerHTML=`✓ Bestellung <b>${data.orderId}</b> wurde erfolgreich übermittelt.`;
   Object.keys(cart).forEach(k=>cart[k]=0);
   products.forEach(p=>document.querySelector('#q-'+p.id).textContent='0');
   renderCart();
   document.querySelector('#note').value='';
 }catch(err){
   msg.style.color='#ff9ca8';
   msg.textContent=err.message;
 }finally{
   submit.disabled=false;
   submit.style.opacity='1';
 }
};
