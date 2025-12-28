/* Sistema Facturador (Demo local)
   - Datos en localStorage
   - PDFs con jsPDF
   - Excel import/export con SheetJS
   - Envío SUNAT/validación: requiere backend (ver server/)
*/
const LS_KEY = "sf_demo_v1";

const TABS = ["config","proveedores","compras","inventario","clientes","ventas","reportes"];

const defaultState = {
  settings: {
    rucEmisor: "20123456789",
    razonEmisor: "MI EMPRESA S.A.C.",
    logoDataUrl: null,
    series: { "01":"F001", "03":"B001", "NP":"NP01" },
    counters: { "01": 1, "03": 1, "NP": 1 }
  },
  users: [
    { username:"admin", password:"admin123", role:"admin", access:TABS }
  ],
  session: { username:null },
  proveedores: [],
  compras: [], // {id, fecha, proveedorId, items:[{qty, name, code, pu, total}]}
  inventario: [], // {id, name, code, qty, buyPrice, marginPct}
  clientes: [], // {id, docType, docNum, razon, phone}
  ventas: [], // historial ventas (reportes). Cada venta guarda pdfBase64 y xmlText fijos.
};

function loadState(){
  const raw = localStorage.getItem(LS_KEY);
  if(!raw){
    localStorage.setItem(LS_KEY, JSON.stringify(defaultState));
    return structuredClone(defaultState);
  }
  try{
    const s = JSON.parse(raw);
    return { ...structuredClone(defaultState), ...s };
  }catch{
    localStorage.setItem(LS_KEY, JSON.stringify(defaultState));
    return structuredClone(defaultState);
  }
}
function saveState(){
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}
let state = loadState();

function fmt2(n){ return (Math.round((Number(n)||0)*100)/100).toFixed(2); }
function uid(){ return Math.random().toString(36).slice(2,10) + "-" + Date.now().toString(36); }

function el(id){ return document.getElementById(id); }
function qs(sel){ return document.querySelector(sel); }
function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }

function setTab(tab){
  // autorización por rol
  const u = currentUser();
  if(!u) return;
  if(u.role !== "admin" && !u.access.includes(tab)){
    alert("No tienes acceso a esta pestaña.");
    return;
  }

  qsa(".tabBtn").forEach(b => b.classList.toggle("active", b.dataset.tab===tab));
  TABS.forEach(t => el("tab-"+t).classList.toggle("hidden", t!==tab));
}

function currentUser(){
  const uname = state.session.username;
  if(!uname) return null;
  return state.users.find(u => u.username===uname) || null;
}

function renderLogin(){
  const u = currentUser();
  el("loginCard").classList.toggle("hidden", !!u);
  el("btnLogout").disabled = !u;
  el("loginStatus").textContent = u ? `Sesión: ${u.username} (${u.role})` : "No autenticado";

  // bloquear sidebar si no hay sesión
  qsa(".tabBtn").forEach(b => b.disabled = !u);

  if(u){
    // seleccionar primer tab permitido
    const first = (u.role==="admin") ? "config" : u.access[0] || "config";
    setTab(first);
  }
}

function initLogin(){
  el("btnLogin").addEventListener("click", ()=>{
    const user = el("loginUser").value.trim();
    const pass = el("loginPass").value.trim();
    const found = state.users.find(u => u.username===user && u.password===pass);
    if(!found){ alert("Usuario/contraseña incorrectos."); return; }
    state.session.username = found.username;
    saveState();
    renderAll();
  });
  el("btnLogout").addEventListener("click", ()=>{
    state.session.username = null;
    saveState();
    renderAll();
  });
}

/* CONFIG */
let configEditing = false;

function initConfig(){
  const setCfgDisabled = (disabled)=>{
    qsa(".cfg").forEach(i => i.disabled = disabled);
    el("btnSaveConfig").disabled = disabled;
  };

  el("btnEditConfig").addEventListener("click", ()=>{
    if(currentUser()?.role!=="admin"){ alert("Solo admin puede editar configuración."); return; }
    configEditing = true;
    setCfgDisabled(false);
  });

  el("btnSaveConfig").addEventListener("click", async ()=>{
    const ruc = el("cfgRuc").value.trim();
    const razon = el("cfgRazon").value.trim();
    const sf = el("cfgSerieFactura").value.trim().toUpperCase();
    const sb = el("cfgSerieBoleta").value.trim().toUpperCase();
    const sn = el("cfgSerieNota").value.trim().toUpperCase();
    if(!/^\d{11}$/.test(ruc)){ alert("RUC debe tener 11 dígitos."); return; }
    if(!razon){ alert("Razón social requerida."); return; }
    if(sf.length!==4 || !sf.startsWith("F")){ alert("Serie factura: 4 caracteres y debe iniciar con F (Ej: F001)."); return; }
    if(sb.length!==4 || !sb.startsWith("B")){ alert("Serie boleta: 4 caracteres y debe iniciar con B (Ej: B001)."); return; }

    state.settings.rucEmisor = ruc;
    state.settings.razonEmisor = razon;
    state.settings.series["01"] = sf;
    state.settings.series["03"] = sb;
    state.settings.series["NP"] = sn || "NP01";

    const f = el("cfgLogo").files?.[0];
    if(f){
      state.settings.logoDataUrl = await fileToDataUrl(f);
      // marca
      el("brandLogoBox").style.backgroundImage = `url(${state.settings.logoDataUrl})`;
      el("brandLogoBox").textContent = "";
    }

    saveState();
    configEditing = false;
    setCfgDisabled(true);
    renderAll();
    alert("Configuración guardada.");
  });

  el("btnNewUser").addEventListener("click", ()=>{
    if(currentUser()?.role!=="admin"){ alert("Solo admin puede crear usuarios."); return; }
    openUserModal(null);
  });
}

function renderConfig(){
  el("cfgRuc").value = state.settings.rucEmisor;
  el("cfgRazon").value = state.settings.razonEmisor;
  el("cfgSerieFactura").value = state.settings.series["01"] || "F001";
  el("cfgSerieBoleta").value = state.settings.series["03"] || "B001";
  el("cfgSerieNota").value = state.settings.series["NP"] || "NP01";

  // logo marca
  if(state.settings.logoDataUrl){
    el("brandLogoBox").style.backgroundImage = `url(${state.settings.logoDataUrl})`;
    el("brandLogoBox").style.backgroundSize = "cover";
    el("brandLogoBox").style.backgroundPosition = "center";
    el("brandLogoBox").textContent = "";
  }
  renderUsersTable();
}

/* USERS */
let editingUser = null;
function openUserModal(username){
  editingUser = username;
  const modal = el("modalUser");
  const u = username ? state.users.find(x=>x.username===username) : null;
  el("usrName").value = u?.username || "";
  el("usrPass").value = u?.password || "";
  el("usrRole").value = u?.role || "user";
  // access
  const sel = el("usrAccess");
  Array.from(sel.options).forEach(o => o.selected = u ? u.access.includes(o.value) : ["proveedores","compras","inventario","clientes","ventas","reportes"].includes(o.value));
  modal.classList.remove("hidden");
}
function closeUserModal(){ el("modalUser").classList.add("hidden"); editingUser = null; }

function initUsers(){
  el("btnCloseUser").addEventListener("click", closeUserModal);
  el("btnSaveUser").addEventListener("click", ()=>{
    const uname = el("usrName").value.trim();
    const pass = el("usrPass").value.trim();
    const role = el("usrRole").value;
    const access = Array.from(el("usrAccess").selectedOptions).map(o=>o.value);
    if(!uname){ alert("Usuario requerido."); return; }
    if(!pass){ alert("Contraseña requerida."); return; }
    if(role==="user" && access.length===0){ alert("Selecciona al menos un acceso."); return; }

    if(editingUser){
      const idx = state.users.findIndex(x=>x.username===editingUser);
      if(idx<0) return;
      // evita renombrar al admin base si está en sesión
      if(editingUser==="admin" && uname!=="admin"){ alert("No puedes renombrar el usuario admin base en la demo."); return; }
      state.users[idx] = { username:uname, password:pass, role, access: role==="admin"?TABS:access };
    } else {
      if(state.users.some(x=>x.username===uname)){ alert("Ese usuario ya existe."); return; }
      state.users.push({ username:uname, password:pass, role, access: role==="admin"?TABS:access });
    }
    saveState();
    closeUserModal();
    renderUsersTable();
  });
}

function renderUsersTable(){
  const tb = el("tblUsers").querySelector("tbody");
  tb.innerHTML = "";
  state.users.forEach(u=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(u.username)}</td>
      <td>${esc(u.role)}</td>
      <td>${u.role==="admin" ? "Todo" : esc(u.access.join(", "))}</td>
      <td>
        <button class="btn" data-act="edit">Editar</button>
        ${u.username!=="admin" ? `<button class="btn" data-act="del">Eliminar</button>` : ""}
      </td>`;
    tr.querySelector('[data-act="edit"]').addEventListener("click", ()=>openUserModal(u.username));
    const del = tr.querySelector('[data-act="del"]');
    if(del) del.addEventListener("click", ()=>{
      if(!confirm("¿Eliminar usuario?")) return;
      state.users = state.users.filter(x=>x.username!==u.username);
      saveState(); renderUsersTable();
    });
    tb.appendChild(tr);
  });
}

/* PROVEEDORES */
function initProveedores(){
  el("btnAddProveedor").addEventListener("click", ()=>{
    const tipo = prompt("Tipo comprobante (ej: Factura/Boleta/Nota):","Factura")?.trim() || "";
    if(!tipo) return;
    const doc = prompt("N° documento:","")?.trim() || "";
    const razon = prompt("Razón social:","")?.trim() || "";
    if(!doc || !razon){ alert("Documento y razón social son obligatorios."); return; }
    state.proveedores.push({ id:uid(), tipo, doc, razon });
    saveState(); renderProveedores();
    renderCompraProveedorSelect();
  });

  el("btnDownloadTplProv").addEventListener("click", ()=>{
    downloadTemplateXlsx("plantilla_proveedores.xlsx", [
      ["tipo_comprobante","n_documento","razon_social"],
      ["Factura","20123456789","PROVEEDOR EJEMPLO S.A.C."]
    ]);
  });

  el("fileProv").addEventListener("change", async (ev)=>{
    const file = ev.target.files?.[0]; if(!file) return;
    const rows = await readXlsxRows(file);
    // espera encabezado tipo_comprobante,n_documento,razon_social
    const data = rows.slice(1).filter(r=>r.some(x=>String(x||"").trim()!==""));
    let added=0;
    data.forEach(r=>{
      const [tipo, doc, razon] = r;
      if(!tipo || !doc || !razon) return;
      state.proveedores.push({ id:uid(), tipo:String(tipo), doc:String(doc), razon:String(razon) });
      added++;
    });
    saveState(); renderProveedores(); renderCompraProveedorSelect();
    alert(`Importados: ${added}`);
    ev.target.value = "";
  });
}

function renderProveedores(){
  const tb = el("tblProveedores").querySelector("tbody");
  tb.innerHTML = "";
  state.proveedores.forEach(p=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(p.tipo)}</td>
      <td>${esc(p.doc)}</td>
      <td>${esc(p.razon)}</td>
      <td><button class="btn">Eliminar</button></td>
    `;
    tr.querySelector("button").addEventListener("click", ()=>{
      if(!confirm("¿Eliminar proveedor?")) return;
      state.proveedores = state.proveedores.filter(x=>x.id!==p.id);
      saveState(); renderProveedores(); renderCompraProveedorSelect();
    });
    tb.appendChild(tr);
  });
}

/* COMPRAS */
let compraTmp = { fecha:null, proveedorId:null, items:[] };

function initCompras(){
  el("btnAddCompra").addEventListener("click", ()=>{
    compraTmp = { fecha: new Date().toISOString().slice(0,10), proveedorId:null, items:[] };
    el("cmpFecha").value = compraTmp.fecha;
    renderCompraProveedorSelect();
    renderCompraItems();
    el("modalCompra").classList.remove("hidden");
  });
  el("btnCloseCompra").addEventListener("click", ()=> el("modalCompra").classList.add("hidden"));

  el("btnAddItemCompra").addEventListener("click", ()=>{
    compraTmp.items.push({ qty:1, name:"", code:"", pu:0, total:0 });
    renderCompraItems();
  });

  el("btnSaveCompra").addEventListener("click", ()=>{
    compraTmp.fecha = el("cmpFecha").value;
    compraTmp.proveedorId = el("cmpProveedor").value || null;

    if(!compraTmp.fecha){ alert("Fecha requerida."); return; }
    if(compraTmp.items.length===0){ alert("Agrega al menos 1 ítem."); return; }
    for(const it of compraTmp.items){
      if(!it.name || (Number(it.qty)||0)<=0){ alert("Completa producto y cantidad."); return; }
      it.pu = Number(it.pu)||0;
      it.total = (Number(it.qty)||0) * it.pu;
    }
    const rec = { id:uid(), ...compraTmp };
    state.compras.push(rec);

    // Actualiza inventario (suma cantidades; precio compra promedio simple)
    rec.items.forEach(it=>{
      const codeKey = (it.code||"").trim();
      const inv = state.inventario.find(x => (codeKey && x.code===codeKey) || (!codeKey && x.name.toLowerCase()===it.name.toLowerCase()));
      const qty = Number(it.qty)||0;
      const pu = Number(it.pu)||0;

      if(inv){
        const oldQty = Number(inv.qty)||0;
        const newQty = oldQty + qty;
        // promedio ponderado
        const oldVal = oldQty * (Number(inv.buyPrice)||0);
        const newVal = qty * pu;
        inv.buyPrice = newQty>0 ? (oldVal+newVal)/newQty : pu;
        inv.qty = newQty;
      }else{
        state.inventario.push({
          id:uid(),
          name: it.name,
          code: codeKey || "",
          qty,
          buyPrice: pu,
          marginPct: 0.3000, // 30.0000%
        });
      }
    });

    saveState();
    el("modalCompra").classList.add("hidden");
    renderComprasResumen();
    renderInventario();
    renderVentaProductsDropdown();
  });

  el("btnDownloadTplCompras").addEventListener("click", ()=>{
    downloadTemplateXlsx("plantilla_compras.xlsx", [
      ["fecha(YYYY-MM-DD)","cantidad","producto","codigo(opcional)","precio_unitario"],
      ["2025-12-24", "2", "Jabón líquido 1L", "JB001", "12.50"]
    ]);
  });

  el("fileCompras").addEventListener("change", async (ev)=>{
    const file = ev.target.files?.[0]; if(!file) return;
    const rows = await readXlsxRows(file);
    const data = rows.slice(1).filter(r=>r.some(x=>String(x||"").trim()!==""));
    // agrupar por fecha
    const byFecha = new Map();
    data.forEach(r=>{
      const [fecha, cantidad, producto, codigo, pu] = r;
      if(!fecha || !cantidad || !producto || !pu) return;
      const f = String(fecha).slice(0,10);
      const it = { qty:Number(cantidad), name:String(producto), code: String(codigo||""), pu:Number(pu), total:Number(cantidad)*Number(pu) };
      if(!byFecha.has(f)) byFecha.set(f, []);
      byFecha.get(f).push(it);
    });
    let comprasAdded = 0;
    for(const [f, items] of byFecha.entries()){
      const rec = { id:uid(), fecha:f, proveedorId:null, items };
      state.compras.push(rec);
      comprasAdded++;
      // update inventory
      rec.items.forEach(it=>{
        const codeKey = (it.code||"").trim();
        const inv = state.inventario.find(x => (codeKey && x.code===codeKey) || (!codeKey && x.name.toLowerCase()===it.name.toLowerCase()));
        const qty = Number(it.qty)||0;
        const price = Number(it.pu)||0;
        if(inv){
          const oldQty = Number(inv.qty)||0;
          const newQty = oldQty + qty;
          const oldVal = oldQty * (Number(inv.buyPrice)||0);
          const newVal = qty * price;
          inv.buyPrice = newQty>0 ? (oldVal+newVal)/newQty : price;
          inv.qty = newQty;
        } else {
          state.inventario.push({ id:uid(), name:it.name, code:codeKey||"", qty, buyPrice:price, marginPct:0.3000 });
        }
      });
    }
    saveState();
    renderComprasResumen();
    renderInventario();
    renderVentaProductsDropdown();
    alert(`Compras importadas (resúmenes): ${comprasAdded}`);
    ev.target.value = "";
  });
}

function renderCompraProveedorSelect(){
  const sel = el("cmpProveedor");
  sel.innerHTML = `<option value="">(Sin proveedor)</option>` + state.proveedores.map(p=>`<option value="${p.id}">${esc(p.razon)}</option>`).join("");
  sel.value = compraTmp.proveedorId || "";
}

function renderCompraItems(){
  const tb = el("tblCompraItems").querySelector("tbody");
  tb.innerHTML = "";
  compraTmp.items.forEach((it, idx)=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input class="input inputAlt" type="number" min="0" step="1" value="${it.qty}"/></td>
      <td><input class="input inputAlt" value="${escAttr(it.name)}" placeholder="Nombre"/></td>
      <td><input class="input inputAlt" value="${escAttr(it.code)}" placeholder="Código"/></td>
      <td><input class="input inputAlt" type="number" min="0" step="0.01" value="${it.pu}"/></td>
      <td>${fmt2((Number(it.qty)||0)*(Number(it.pu)||0))}</td>
      <td><button class="btn">X</button></td>
    `;
    const [qInp, nInp, cInp, pInp] = tr.querySelectorAll("input");
    qInp.addEventListener("input", ()=>{ it.qty = Number(qInp.value)||0; renderCompraItems(); });
    nInp.addEventListener("input", ()=>{ it.name = nInp.value; });
    cInp.addEventListener("input", ()=>{ it.code = cInp.value; });
    pInp.addEventListener("input", ()=>{ it.pu = Number(pInp.value)||0; renderCompraItems(); });
    tr.querySelector("button").addEventListener("click", ()=>{
      compraTmp.items.splice(idx,1); renderCompraItems();
    });

    tb.appendChild(tr);
  });
  const total = compraTmp.items.reduce((a,it)=>a+(Number(it.qty)||0)*(Number(it.pu)||0),0);
  el("cmpTotal").textContent = fmt2(total);
}

function renderComprasResumen(){
  const tb = el("tblComprasResumen").querySelector("tbody");
  tb.innerHTML = "";
  state.compras.slice().reverse().forEach(c=>{
    const total = c.items.reduce((a,it)=>a+(Number(it.qty)||0)*(Number(it.pu)||0),0);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(c.fecha)}</td>
      <td>${c.items.length}</td>
      <td>${fmt2(total)}</td>
      <td><button class="btn">Ver detalle</button></td>
    `;
    tr.querySelector("button").addEventListener("click", ()=>{
      // reusar modal (solo lectura)
      compraTmp = structuredClone(c);
      el("cmpFecha").value = compraTmp.fecha;
      renderCompraProveedorSelect();
      renderCompraItemsReadonly();
      el("btnSaveCompra").classList.add("hidden");
      el("btnAddItemCompra").classList.add("hidden");
      el("modalCompra").classList.remove("hidden");
    });
    tb.appendChild(tr);
  });

  // restaurar modal para crear
  el("modalCompra").addEventListener("click", (e)=>{
    if(e.target.id==="modalCompra"){
      el("modalCompra").classList.add("hidden");
    }
  });
  el("btnCloseCompra").addEventListener("click", ()=>{
    el("btnSaveCompra").classList.remove("hidden");
    el("btnAddItemCompra").classList.remove("hidden");
  });
}

function renderCompraItemsReadonly(){
  const tb = el("tblCompraItems").querySelector("tbody");
  tb.innerHTML = "";
  compraTmp.items.forEach((it)=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(it.qty)}</td>
      <td>${esc(it.name)}</td>
      <td>${esc(it.code||"")}</td>
      <td>${fmt2(it.pu)}</td>
      <td>${fmt2((Number(it.qty)||0)*(Number(it.pu)||0))}</td>
      <td></td>
    `;
    tb.appendChild(tr);
  });
  const total = compraTmp.items.reduce((a,it)=>a+(Number(it.qty)||0)*(Number(it.pu)||0),0);
  el("cmpTotal").textContent = fmt2(total);
}

/* INVENTARIO */
function initInventario(){
  el("btnExportInv").addEventListener("click", ()=>{
    const rows = [
      ["cantidad","producto","codigo","precio_compra","margen_pct","precio_venta"],
      ...state.inventario.map(p=>{
        const sell = calcSellPrice(p.buyPrice, p.marginPct);
        return [p.qty, p.name, p.code, Number(p.buyPrice||0), Number(p.marginPct||0), sell];
      })
    ];
    exportXlsx("inventario.xlsx", rows);
  });
}

function calcSellPrice(buy, marginPct){
  const b = Number(buy)||0;
  const m = Number(marginPct)||0;
  return Math.round((b * (1 + m))*100)/100;
}

function renderInventario(){
  const tb = el("tblInventario").querySelector("tbody");
  tb.innerHTML = "";
  state.inventario.forEach(p=>{
    const tr = document.createElement("tr");
    const sell = calcSellPrice(p.buyPrice, p.marginPct);
    tr.innerHTML = `
      <td><input class="input inputAlt" type="number" step="1" value="${p.qty}"/></td>
      <td>${esc(p.name)}</td>
      <td>${esc(p.code||"")}</td>
      <td>${fmt2(p.buyPrice)}</td>
      <td><input class="input inputAlt" type="number" step="0.0001" value="${Number(p.marginPct||0).toFixed(4)}"/></td>
      <td>${fmt2(sell)}</td>
      <td><button class="btn">Eliminar</button></td>
    `;
    const qtyInp = tr.querySelectorAll("input")[0];
    const mInp = tr.querySelectorAll("input")[1];
    qtyInp.addEventListener("input", ()=>{
      p.qty = Math.max(0, Math.floor(Number(qtyInp.value)||0));
      saveState(); renderInventario(); renderVentaProductsDropdown();
    });
    mInp.addEventListener("input", ()=>{
      const v = Number(mInp.value);
      p.marginPct = isFinite(v) ? Math.max(0, v) : 0;
      saveState(); renderInventario(); renderVentaProductsDropdown();
    });
    tr.querySelector("button").addEventListener("click", ()=>{
      if(!confirm("¿Eliminar producto del inventario?")) return;
      state.inventario = state.inventario.filter(x=>x.id!==p.id);
      saveState(); renderInventario(); renderVentaProductsDropdown();
    });
    tb.appendChild(tr);
  });
}

/* CLIENTES */
function initClientes(){
  el("btnAddCliente").addEventListener("click", ()=>{
    const docType = prompt("Tipo doc (RUC/DNI):","RUC")?.trim().toUpperCase() || "RUC";
    const docNum = prompt("N° doc:","")?.trim() || "";
    if(!validDoc(docType, docNum)){ alert("Documento inválido (RUC 11, DNI 8)."); return; }
    const razon = prompt("Razón social / Nombre:","")?.trim() || "";
    const phone = prompt("Teléfono/WhatsApp (opcional):","")?.trim() || "";
    if(!razon){ alert("Nombre/razón requerida."); return; }
    state.clientes.push({ id:uid(), docType, docNum, razon, phone });
    saveState(); renderClientes(); renderVentaClientesDropdown();
  });
}

function validDoc(type, num){
  if(type==="RUC") return /^\d{11}$/.test(num);
  if(type==="DNI") return /^\d{8}$/.test(num);
  return false;
}

function renderClientes(){
  const tb = el("tblClientes").querySelector("tbody");
  tb.innerHTML = "";
  state.clientes.forEach(c=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(c.docType)}</td>
      <td>${esc(c.docNum)}</td>
      <td>${esc(c.razon)}</td>
      <td>${esc(c.phone||"")}</td>
      <td><button class="btn">Eliminar</button></td>
    `;
    tr.querySelector("button").addEventListener("click", ()=>{
      if(!confirm("¿Eliminar cliente?")) return;
      state.clientes = state.clientes.filter(x=>x.id!==c.id);
      saveState(); renderClientes(); renderVentaClientesDropdown();
    });
    tb.appendChild(tr);
  });
}

/* VENTAS */
let ventaTmp = { tipo:"01", fecha: new Date().toISOString().slice(0,10), items:[], buyer:{docType:"RUC", docNum:"", razon:""} };

function initVentas(){
  el("venFecha").value = ventaTmp.fecha;

  el("venTipo").addEventListener("change", ()=>{ ventaTmp.tipo = el("venTipo").value; });
  el("venFecha").addEventListener("change", ()=>{ ventaTmp.fecha = el("venFecha").value; });
  el("buyTipo").addEventListener("change", ()=>{ ventaTmp.buyer.docType = el("buyTipo").value; });
  el("buyNum").addEventListener("input", ()=>{ ventaTmp.buyer.docNum = el("buyNum").value.trim(); });
  el("buyRazon").addEventListener("input", ()=>{ ventaTmp.buyer.razon = el("buyRazon").value; });

  el("venCliente").addEventListener("change", ()=>{
    const id = el("venCliente").value;
    const c = state.clientes.find(x=>x.id===id);
    if(c){
      el("buyTipo").value = c.docType;
      el("buyNum").value = c.docNum;
      el("buyRazon").value = c.razon;
      ventaTmp.buyer = { docType:c.docType, docNum:c.docNum, razon:c.razon };
    }
  });

  el("btnAddVenItem").addEventListener("click", ()=>{
    if(state.inventario.length===0){ alert("No hay inventario. Registra compras primero."); return; }
    ventaTmp.items.push({ productId: state.inventario[0].id, qty:1, pu: calcSellPrice(state.inventario[0].buyPrice, state.inventario[0].marginPct), total:0 });
    renderVentaItems();
  });

  el("btnValidarDoc").addEventListener("click", async ()=>{
    const t = el("buyTipo").value;
    const n = el("buyNum").value.trim();
    if(!validDoc(t,n)){
      el("valMsg").textContent = "Formato inválido (RUC 11 / DNI 8).";
      return;
    }
    el("valMsg").textContent = "Consultando...";
    try{
      const resp = await fetch(`/api/validate/${t.toLowerCase()}/${n}`);
      if(!resp.ok) throw new Error("No disponible");
      const data = await resp.json();
      if(data?.ok && data?.razon){
        el("buyRazon").value = data.razon;
        ventaTmp.buyer.razon = data.razon;
        el("valMsg").textContent = "Validado.";
      }else{
        el("valMsg").textContent = "No encontrado: se permitirá continuar (no validado).";
      }
    }catch{
      el("valMsg").textContent = "Servicio de validación no configurado. Se permitirá continuar (no validado).";
    }
  });

  el("btnEmitir").addEventListener("click", async ()=>{
    const tipo = el("venTipo").value;
    const fecha = el("venFecha").value;
    const docT = el("buyTipo").value;
    const docN = el("buyNum").value.trim();
    const razon = el("buyRazon").value.trim();

    if(!fecha){ alert("Fecha requerida."); return; }
    if(!validDoc(docT, docN)){ alert("Documento inválido (RUC 11 / DNI 8)."); return; }
    if(!razon){ alert("Razón social / nombre requerido."); return; }
    if(ventaTmp.items.length===0){ alert("Agrega productos."); return; }

    // verificar stock
    for(const it of ventaTmp.items){
      const inv = state.inventario.find(x=>x.id===it.productId);
      if(!inv){ alert("Producto inválido en detalle."); return; }
      if((Number(inv.qty)||0) < (Number(it.qty)||0)){ alert(`Stock insuficiente: ${inv.name}`); return; }
    }

    const serie = state.settings.series[tipo] || (tipo==="01"?"F001": tipo==="03"?"B001":"NP01");
    const numero = state.settings.counters[tipo] || 1;

    // generar PDF
    const pdfBlob = await buildPdf({ tipo, serie, numero, fecha, buyer:{docType:docT, docNum:docN, razon}, items: ventaTmp.items });
    const pdfBase64 = await blobToBase64(pdfBlob);

    // generar XML (DEMO: estructura mínima; para SUNAT real debe ser UBL 2.1 firmado)
    const xmlText = buildXmlStub({ tipo, serie, numero, fecha, buyer:{docType:docT, docNum:docN, razon}, items: ventaTmp.items });

    // nombre archivo (según convención que indicaste; para Nota de pedido usamos TT=07 solo como demo)
    const rucEmisor = state.settings.rucEmisor;
    const tt = tipo; // 01,03,NP
    const ttForName = (tt==="NP") ? "07" : tt; // para demo
    const corr = String(numero).padStart(8,"0");
    const fileName = `${rucEmisor}-${ttForName}-${serie}-${corr}.XML`;

    // descontar inventario
    ventaTmp.items.forEach(it=>{
      const inv = state.inventario.find(x=>x.id===it.productId);
      inv.qty = Math.max(0, (Number(inv.qty)||0) - (Number(it.qty)||0));
    });

    // guardar venta inmutable (pdf/xml congelados)
    const total = ventaTmp.items.reduce((a,it)=>a+(Number(it.qty)||0)*(Number(it.pu)||0),0);
    const saved = {
      id:uid(),
      fecha, tipo, serie, numero, buyer:{docType:docT, docNum:docN, razon},
      items: structuredClone(ventaTmp.items),
      total: Math.round(total*100)/100,
      pdfBase64,
      xmlText,
      fileName,
      sunatStatus: null,
      createdAt: new Date().toISOString(),
    };
    state.ventas.push(saved);
    state.settings.counters[tipo] = numero + 1;

    // reset ventaTmp
    ventaTmp.items = [];
    renderVentaItems();
    renderInventario();
    renderReportes();
    renderKpis();

    saveState();
    downloadBlob(pdfBlob, `${serie}-${numero}.pdf`);
    downloadText(xmlText, fileName);

    alert("Comprobante emitido (PDF + XML) y guardado en Reportes.");
  });

  el("btnEnviarSunat").addEventListener("click", async ()=>{
    const last = state.ventas[state.ventas.length-1];
    if(!last){ alert("No hay comprobantes emitidos."); return; }
    el("sunatResp").textContent = "Enviando a SUNAT (beta)...";
    try{
      const resp = await fetch("/api/sunat/send", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ fileName: last.fileName, xmlText: last.xmlText })
      });
      const data = await resp.json();
      last.sunatStatus = data;
      saveState();
      el("sunatResp").textContent = JSON.stringify(data, null, 2);
      renderReportes();
    }catch(e){
      el("sunatResp").textContent = "No se pudo enviar. Verifica que el backend esté levantado (server/) y configurado.";
    }
  });

  el("btnEnviarWhats").addEventListener("click", ()=>{
    const last = state.ventas[state.ventas.length-1];
    if(!last){ alert("No hay comprobantes."); return; }
    const phone = state.clientes.find(c => c.docNum===last.buyer.docNum)?.phone;
    if(!phone){ alert("El cliente no tiene teléfono/WhatsApp registrado."); return; }
    const msg = encodeURIComponent(`Hola, ${last.buyer.razon}. Adjuntamos su comprobante ${last.serie}-${last.numero}. Gracias por su preferencia.`);
    // WhatsApp web (no adjunta archivo automáticamente; es un atajo)
    window.open(`https://wa.me/${phone.replace(/\D/g,"")}?text=${msg}`, "_blank");
  });
}

function renderVentaClientesDropdown(){
  const sel = el("venCliente");
  sel.innerHTML = `<option value="">(Seleccionar)</option>` + state.clientes.map(c=>`<option value="${c.id}">${esc(c.razon)} - ${esc(c.docType)} ${esc(c.docNum)}</option>`).join("");
}

function renderVentaProductsDropdown(){
  // no existe dropdown global; se renderiza por fila
  renderVentaItems();
}

function renderVentaItems(){
  const tb = el("tblVentaItems").querySelector("tbody");
  tb.innerHTML = "";
  ventaTmp.items.forEach((it, idx)=>{
    const invList = state.inventario;
    const inv = invList.find(x=>x.id===it.productId) || invList[0];
    if(inv){
      it.productId = inv.id;
      it.pu = calcSellPrice(inv.buyPrice, inv.marginPct);
    }
    const tr = document.createElement("tr");
    const total = (Number(it.qty)||0)*(Number(it.pu)||0);
    tr.innerHTML = `
      <td>
        <select class="input inputAlt"></select>
        <div class="hint">Stock: ${inv ? inv.qty : 0}</div>
      </td>
      <td><input class="input inputAlt" type="number" min="1" step="1" value="${it.qty}"/></td>
      <td>${fmt2(it.pu)}</td>
      <td>${fmt2(total)}</td>
      <td><button class="btn">X</button></td>
    `;
    const sel = tr.querySelector("select");
    sel.innerHTML = invList.map(p=>{
      const sell = calcSellPrice(p.buyPrice, p.marginPct);
      return `<option value="${p.id}">${esc(p.name)} (${esc(p.code||"")}) - S/ ${fmt2(sell)}</option>`;
    }).join("");
    sel.value = it.productId;

    sel.addEventListener("change", ()=>{
      it.productId = sel.value;
      const p = state.inventario.find(x=>x.id===it.productId);
      if(p) it.pu = calcSellPrice(p.buyPrice, p.marginPct);
      renderVentaItems();
    });

    const qtyInp = tr.querySelectorAll("input")[0];
    qtyInp.addEventListener("input", ()=>{
      it.qty = Math.max(1, Math.floor(Number(qtyInp.value)||1));
      renderVentaItems();
    });

    tr.querySelector("button").addEventListener("click", ()=>{
      ventaTmp.items.splice(idx,1); renderVentaItems();
    });
    tb.appendChild(tr);
  });
  const grand = ventaTmp.items.reduce((a,it)=>a+(Number(it.qty)||0)*(Number(it.pu)||0),0);
  el("venTotal").textContent = fmt2(grand);
}

/* REPORTES */
function initReportes(){
  el("btnExportVentas").addEventListener("click", ()=>{
    const d1 = el("repDesde").value;
    const d2 = el("repHasta").value;
    const rows = [["fecha","tipo","serie","numero","doc_cliente","razon_cliente","total"]];
    state.ventas
      .filter(v => (!d1 || v.fecha>=d1) && (!d2 || v.fecha<=d2))
      .forEach(v=>{
        rows.push([v.fecha, v.tipo, v.serie, v.numero, v.buyer.docNum, v.buyer.razon, v.total]);
      });
    exportXlsx("ventas.xlsx", rows);
  });
}

function renderReportes(){
  const tb = el("tblReportes").querySelector("tbody");
  tb.innerHTML = "";
  state.ventas.slice().reverse().forEach(v=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(v.fecha)}</td>
      <td>${esc(v.tipo)}</td>
      <td>${esc(v.serie)}</td>
      <td>${esc(String(v.numero))}</td>
      <td>${esc(v.buyer.razon)}</td>
      <td>${fmt2(v.total)}</td>
      <td><button class="btn">Descargar</button></td>
      <td><button class="btn">Descargar</button></td>
      <td><button class="btn">Eliminar</button></td>
    `;
    const [bPdf, bXml, bDel] = tr.querySelectorAll("button");
    bPdf.addEventListener("click", async ()=>{
      const blob = base64ToBlob(v.pdfBase64, "application/pdf");
      downloadBlob(blob, `${v.serie}-${v.numero}.pdf`);
    });
    bXml.addEventListener("click", ()=>{
      downloadText(v.xmlText, v.fileName || `${v.serie}-${v.numero}.XML`);
    });
    bDel.addEventListener("click", ()=>{
      if(!confirm("¿Eliminar comprobante del reporte? (No revertirá stock)")) return;
      state.ventas = state.ventas.filter(x=>x.id!==v.id);
      saveState(); renderReportes(); renderKpis();
    });
    tb.appendChild(tr);
  });
}

function renderKpis(){
  // rentabilidad: margen bruto aproximado ( (pu - buyPrice)*qty vendido )
  const profit = new Map();
  const rotation = new Map();
  state.ventas.forEach(v=>{
    v.items.forEach(it=>{
      const p = state.inventario.find(x=>x.id===it.productId);
      // si ya no existe, usa buyPrice=0
      const buy = p ? Number(p.buyPrice)||0 : 0;
      const pu = Number(it.pu)||0;
      const qty = Number(it.qty)||0;
      const key = p ? p.name : (it.productId||"Producto");
      profit.set(key, (profit.get(key)||0) + (pu - buy)*qty);
      rotation.set(key, (rotation.get(key)||0) + qty);
    });
  });

  const topProfit = Array.from(profit.entries()).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const topRot = Array.from(rotation.entries()).sort((a,b)=>b[1]-a[1]).slice(0,10);

  el("lstRent").innerHTML = topProfit.map(([k,v])=>`<li>${esc(k)} — S/ ${fmt2(v)}</li>`).join("") || "<li>(sin datos)</li>";
  el("lstRot").innerHTML = topRot.map(([k,v])=>`<li>${esc(k)} — ${v}</li>`).join("") || "<li>(sin datos)</li>";
}

/* PDF & XML */
async function buildPdf({tipo, serie, numero, fecha, buyer, items}){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"pt", format:"a4" });

  const em = state.settings;
  const title = (tipo==="01") ? "FACTURA" : (tipo==="03") ? "BOLETA DE VENTA" : "NOTA DE PEDIDO";

  let y = 50;
  // logo opcional
  if(em.logoDataUrl){
    try{
      doc.addImage(em.logoDataUrl, "PNG", 40, y, 60, 60);
    }catch{}
  }
  doc.setFont("helvetica","bold"); doc.setFontSize(16);
  doc.text(em.razonEmisor, 120, y+20);
  doc.setFont("helvetica","normal"); doc.setFontSize(11);
  doc.text(`RUC: ${em.rucEmisor}`, 120, y+40);

  doc.setFont("helvetica","bold"); doc.setFontSize(14);
  doc.text(title, 420, y+20);
  doc.setFont("helvetica","normal"); doc.setFontSize(11);
  doc.text(`${serie}-${numero}`, 420, y+40);

  y += 90;
  doc.setFont("helvetica","bold"); doc.text("Datos del comprador", 40, y);
  y += 14;
  doc.setFont("helvetica","normal");
  doc.text(`${buyer.docType}: ${buyer.docNum}`, 40, y);
  y += 14;
  doc.text(`Razón social / Nombre: ${buyer.razon}`, 40, y);
  y += 14;
  doc.text(`Fecha: ${fecha}`, 40, y);
  y += 22;

  doc.setFont("helvetica","bold");
  doc.text("Detalle", 40, y); y += 14;

  // table header
  doc.setFontSize(10);
  doc.text("Producto", 40, y);
  doc.text("Cant.", 320, y);
  doc.text("P. Unit", 380, y);
  doc.text("Total", 470, y);
  y += 10;
  doc.line(40, y, 555, y);
  y += 14;

  doc.setFont("helvetica","normal");
  let total = 0;
  items.forEach(it=>{
    const p = state.inventario.find(x=>x.id===it.productId);
    const name = p ? p.name : "Producto";
    const qty = Number(it.qty)||0;
    const pu = Number(it.pu)||0;
    const t = qty*pu;
    total += t;

    doc.text(name, 40, y);
    doc.text(String(qty), 330, y, {align:"right"});
    doc.text(fmt2(pu), 430, y, {align:"right"});
    doc.text(fmt2(t), 540, y, {align:"right"});
    y += 14;
    if(y>740){ doc.addPage(); y=50; }
  });

  y += 8;
  doc.line(40, y, 555, y); y += 16;
  doc.setFont("helvetica","bold");
  doc.text("TOTAL:", 420, y);
  doc.text(`S/ ${fmt2(total)}`, 540, y, {align:"right"});
  y += 40;
  doc.setFont("helvetica","normal");
  doc.text("Gracias por su preferencia", 40, y);

  return doc.output("blob");
}

function buildXmlStub({tipo, serie, numero, fecha, buyer, items}){
  // IMPORTANTE: esto es un XML de DEMO. Para SUNAT real se debe generar UBL 2.1 (Invoice/CreditNote/DebitNote)
  const em = state.settings;
  const total = items.reduce((a,it)=>a+(Number(it.qty)||0)*(Number(it.pu)||0),0);

  const lines = items.map((it,i)=>{
    const p = state.inventario.find(x=>x.id===it.productId);
    const name = p ? p.name : "Producto";
    const qty = Number(it.qty)||0;
    const pu = Number(it.pu)||0;
    return `  <Line>
    <ID>${i+1}</ID>
    <Description>${xmlEsc(name)}</Description>
    <Quantity>${qty}</Quantity>
    <UnitPrice>${fmt2(pu)}</UnitPrice>
    <LineTotal>${fmt2(qty*pu)}</LineTotal>
  </Line>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<DocumentStub>
  <Emisor>
    <RUC>${xmlEsc(em.rucEmisor)}</RUC>
    <RazonSocial>${xmlEsc(em.razonEmisor)}</RazonSocial>
  </Emisor>
  <Comprobante>
    <Tipo>${xmlEsc(tipo)}</Tipo>
    <Serie>${xmlEsc(serie)}</Serie>
    <Numero>${xmlEsc(String(numero))}</Numero>
    <Fecha>${xmlEsc(fecha)}</Fecha>
  </Comprobante>
  <Comprador>
    <TipoDocumento>${xmlEsc(buyer.docType)}</TipoDocumento>
    <NumeroDocumento>${xmlEsc(buyer.docNum)}</NumeroDocumento>
    <RazonSocial>${xmlEsc(buyer.razon)}</RazonSocial>
  </Comprador>
  <Detalle>
${lines}
  </Detalle>
  <Total>${fmt2(total)}</Total>
</DocumentStub>`;
}

/* SUNAT response display is handled by backend */

/* EXCEL helpers (SheetJS) */
async function readXlsxRows(file){
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type:"array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header:1, raw:false });
}
function exportXlsx(filename, rows){
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, filename);
}
function downloadTemplateXlsx(filename, rows){
  exportXlsx(filename, rows);
}

/* misc helpers */
function esc(s){ return String(s??"").replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" }[c])); }
function escAttr(s){ return String(s??"").replace(/"/g,"&quot;"); }
function xmlEsc(s){ return String(s??"").replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" }[c])); }

function downloadText(text, filename){
  const blob = new Blob([text], { type:"application/octet-stream" });
  downloadBlob(blob, filename);
}
function downloadBlob(blob, filename){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}
function fileToDataUrl(file){
  return new Promise((res,rej)=>{
    const r = new FileReader();
    r.onload = ()=>res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function blobToBase64(blob){
  return new Promise((res,rej)=>{
    const r = new FileReader();
    r.onload = ()=>res(String(r.result).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}
function base64ToBlob(b64, mime){
  const bin = atob(b64);
  const len = bin.length;
  const arr = new Uint8Array(len);
  for(let i=0;i<len;i++) arr[i]=bin.charCodeAt(i);
  return new Blob([arr], { type:mime });
}

/* TAB wiring */
function initTabs(){
  qsa(".tabBtn").forEach(b=>{
    b.addEventListener("click", ()=> setTab(b.dataset.tab));
  });
}

function renderAll(){
  renderLogin();
  renderConfig();
  renderProveedores();
  renderComprasResumen();
  renderInventario();
  renderClientes();
  renderVentaClientesDropdown();
  renderVentaItems();
  renderReportes();
  renderKpis();
  renderCompraProveedorSelect();
}

/* init */
window.addEventListener("DOMContentLoaded", ()=>{
  initTabs();
  initLogin();
  initConfig();
  initUsers();
  initProveedores();
  initCompras();
  initInventario();
  initClientes();
  initVentas();
  initReportes();
  renderAll();
});
