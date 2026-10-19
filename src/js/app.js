/* MIR AI — App Logic */
const $ = (s, r=document) => r.querySelector(s)
const $$ = (s, r=document) => [...r.querySelectorAll(s)]
const uid = () => Math.random().toString(36).slice(2,10)
const nowISO = () => new Date().toISOString()
const fmtDate = (iso) => new Date(iso).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) + ' · ' + new Date(iso).toLocaleDateString()

/* ---------- Storage ---------- */
const LS = {
  get(k, d){ try{ return JSON.parse(localStorage.getItem(k)) ?? d }catch{ return d } },
  set(k, v){ localStorage.setItem(k, JSON.stringify(v)) },
  del(k){ localStorage.removeItem(k) }
}
const KEYS = { conv:'mir:conversations', proj:'mir:projects', settings:'mir:settings', prefs:'mir:preferences', collapsed:'mir:sidebarCollapsed', theme:'mir:theme' }

/* ---------- State ---------- */
let conversations = LS.get(KEYS.conv, [])  // {id,title,projectId,createdAt,updatedAt,messages[], saved?}
let projects = LS.get(KEYS.proj, [
  {id:'proj-dev', name:'Software development', color:'#FF2D95'},
  {id:'proj-learn', name:'Learning', color:'#2EE6A8'},
  {id:'proj-research', name:'Research', color:'#FFB547'},
])
let activeId = conversations[0]?.id || null
let attachedFile = null // {name,size,type,content}
let generating = false
let genTimer = null
let ttsOn = false

const defaultSettings = {
  theme:'dark', accent:'#FF2D95', density:'comfortable', reduceMotion:false, sidebarCollapsed:false,
  enterToSend:true, timestamps:false, responseStyle:'balanced', language:'en', responseLength:'auto', model:'mir-local',
  confirmDelete:true, customInstructions:'', preferredName:'', preferredLanguage:'en', topics:'',
  savedPrefs:{}
}
let settings = { ...defaultSettings, ...(LS.get(KEYS.settings, {})) }

/* ---------- Helpers: creator detection ---------- */
const CREATOR_RE = /(who\s*(created|made|developed|built|is behind)|who\s*is\s*(your\s*)?(creator|developer|maker)|who\s*is\s*mir\s*junior|who\s*are\s*you\s*made\s*by)/i
const CREATOR_ANSWER = `I was developed by Musonera Irahari Junior, popularly known as Mir Junior, a young software developer based in Rwanda. He builds scalable, SEO-optimized web applications and specializes in DevOps — founder of the Mir Collection tech community, 40+ projects across e-commerce, web and mobile, stack React / Next.js / Node.js / Python / Docker / Kubernetes, AWS Certified Cloud Practitioner and Meta Frontend certified. Portfolio: https://mirjunior.netlify.app/`

function isCreatorQuestion(t){
  return CREATOR_RE.test(t) || /created you|developed you|who made you/i.test(t)
}

/* ---------- Theme & Settings ---------- */
function applyTheme(){
  const effective = settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light':'dark') : settings.theme
  document.documentElement.setAttribute('data-theme', effective)
  try{ localStorage.setItem(KEYS.theme, settings.theme) }catch{}
  document.documentElement.style.setProperty('--accent', settings.accent)
  document.documentElement.style.setProperty('--accent-2', settings.accent === '#FF2D95' ? '#FF5CB8' : settings.accent)
  const meta = document.querySelector('meta[name="theme-color"]'); if(meta) meta.content = settings.accent
  document.body.classList.toggle('reduce-motion', !!settings.reduceMotion)
  document.documentElement.setAttribute('data-density', settings.density)
  // sidebar collapsed
  $('#sidebar')?.classList.toggle('collapsed', !!settings.sidebarCollapsed && window.innerWidth>1024)
  $('#sidebarCollapsedCheck').checked = !!settings.sidebarCollapsed
  $('#reduceMotionCheck').checked = !!settings.reduceMotion
  $('#densitySelect').value = settings.density
  $('#themeSelect').value = settings.theme
  $('#accentInput').value = settings.accent
  $('#modelSelect').value = settings.model
  // update label
  $('#modelLabel').textContent = settings.model === 'mir-local' ? 'MIR Local • Ready' : settings.model
}
function saveSettings(){ LS.set(KEYS.settings, settings); applyTheme() }

/* ---------- Toast ---------- */
let toastTimer
function toast(msg, ms=2600){
  const el = $('#toast'); if(!el) return
  el.textContent = msg; el.classList.add('show')
  clearTimeout(toastTimer); toastTimer = setTimeout(()=> el.classList.remove('show'), ms)
}

/* ---------- Preloader ---------- */
function initPreloader(){
  const pre = $('#preloader')
  let done=false
  const hide = ()=>{ if(done) return; done=true; pre.classList.add('hidden'); setTimeout(()=> pre.remove(), 700) }
  // respect reduced motion — hide a bit faster
  const max = matchMedia('(prefers-reduced-motion: reduce)').matches ? 700 : 900
  window.addEventListener('load', ()=> setTimeout(hide, max))
  setTimeout(hide, 2600) // safety fallback never trap
}

/* ---------- Sidebar ---------- */
function bindSidebar(){
  const sidebar = $('#sidebar'), overlay = $('#sidebarOverlay')
  const open = ()=> { sidebar.classList.add('open'); overlay.classList.add('open'); overlay.setAttribute('aria-hidden','false') }
  const close = ()=> { sidebar.classList.remove('open'); overlay.classList.remove('open'); overlay.setAttribute('aria-hidden','true') }
  $('#mobileMenuBtn')?.addEventListener('click', open)
  overlay?.addEventListener('click', close)
  $('#collapseBtn')?.addEventListener('click', ()=>{
    if(window.innerWidth <= 1024){ close(); return }
    settings.sidebarCollapsed = !settings.sidebarCollapsed
    saveSettings(); toast(settings.sidebarCollapsed ? 'Sidebar collapsed' : 'Sidebar expanded')
  })
  // nav toggles
  $$('[data-toggle]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const key = btn.dataset.toggle
      const panel = key==='projects' ? $('#projectsPanel') : $('#toolsPanel')
      const expanded = btn.getAttribute('aria-expanded')==='true'
      btn.setAttribute('aria-expanded', String(!expanded))
      panel.style.display = expanded ? 'none' : ''
    })
  })
}

/* ---------- Projects ---------- */
function saveProjects(){ LS.set(KEYS.proj, projects) }
function renderProjects(){
  const list = $('#projectList'); if(!list) return
  list.innerHTML = ''
  const activeConv = conversations.find(c=>c.id===activeId)
  projects.forEach(p=>{
    const li = document.createElement('li')
    li.innerHTML = `<div class="project-item ${activeConv?.projectId===p.id?'active':''}" data-id="${p.id}">
      <span class="dot" style="background:${p.color}"></span>
      <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.name)}</span>
      <button class="icon-btn" style="width:24px;height:24px" data-rename title="Rename"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
      <button class="icon-btn" style="width:24px;height:24px" data-del title="Delete"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
    </div>`
    list.appendChild(li)
  })
  // bind
  $$('.project-item', list).forEach(el=>{
    el.addEventListener('click', (e)=>{
      if(e.target.closest('[data-rename]') || e.target.closest('[data-del]')) return
      const pid = el.dataset.id
      if(!activeId) { $('#activeProjectLabel').textContent = projects.find(x=>x.id===pid)?.name || ''; $('#activeProjectLabel').classList.remove('hidden'); toast('Project selected: '+ projects.find(x=>x.id===pid)?.name); return }
      const conv = conversations.find(c=>c.id===activeId); if(conv){ conv.projectId=pid; saveConvs(); renderConversations(); updateActiveProjectLabel(); toast('Moved to project') }
    })
  })
  $$('[data-rename]', list).forEach(btn=> btn.addEventListener('click', (e)=>{
    e.stopPropagation()
    const pid = btn.closest('.project-item').dataset.id
    const p = projects.find(x=>x.id===pid); const name = prompt('Rename project', p.name); if(name && name.trim()){ p.name=name.trim(); saveProjects(); renderProjects(); updateActiveProjectLabel() }
  }))
  $$('[data-del]', list).forEach(btn=> btn.addEventListener('click', (e)=>{
    e.stopPropagation()
    const pid = btn.closest('.project-item').dataset.id
    if(!confirm('Delete this project? Conversations will be kept but unassigned.')) return
    projects = projects.filter(x=>x.id!==pid)
    conversations.forEach(c=>{ if(c.projectId===pid) c.projectId=null })
    saveProjects(); saveConvs(); renderProjects(); renderConversations(); updateActiveProjectLabel(); toast('Project deleted')
  }))
}
function updateActiveProjectLabel(){
  const conv = conversations.find(c=>c.id===activeId)
  const label = $('#activeProjectLabel')
  if(!label) return
  if(conv?.projectId){
    const p = projects.find(x=>x.id===conv.projectId)
    label.textContent = p?.name || ''
    label.classList.remove('hidden')
  } else label.classList.add('hidden')
}
$('#newProjectBtn')?.addEventListener('click', ()=>{
  const name = prompt('Project name', 'New project')
  if(!name) return
  projects.unshift({id:'proj-'+uid(), name:name.trim(), color:['#FF2D95','#7B5CFF','#2EE6A8','#FFB547','#3AB0FF'][Math.floor(Math.random()*5)]})
  saveProjects(); renderProjects(); toast('Project created')
})

/* ---------- Conversations ---------- */
function saveConvs(){ LS.set(KEYS.conv, conversations) }
function createConversation(title='New conversation'){
  const conv = { id:uid(), title, projectId: projects[0]?.id || null, createdAt: nowISO(), updatedAt: nowISO(), messages: [] }
  conversations.unshift(conv); saveConvs(); activeId = conv.id
  renderConversations(); renderMessages(); updateActiveProjectLabel(); return conv
}
function renderConversations(){
  const list = $('#conversationList'); if(!list) return
  const q = ($('#searchInput')?.value || '').toLowerCase().trim()
  let filtered = conversations
  if(q) filtered = filtered.filter(c=> c.title.toLowerCase().includes(q) || (c.messages||[]).some(m=> (m.content||'').toLowerCase().includes(q)))
  list.innerHTML = ''
  $('#convCount').textContent = String(conversations.length)
  $('#emptyConv').style.display = filtered.length ? 'none' : ''
  if(!filtered.length && !q) return
  if(!filtered.length && q){
    list.innerHTML = `<li style="padding:8px;color:var(--text-3);font-size:.84rem">No results for “${escapeHtml(q)}”.</li>`; return
  }
  filtered.forEach(c=>{
    const li = document.createElement('li')
    const isActive = c.id===activeId
    const date = c.updatedAt || c.createdAt
    li.innerHTML = `<button class="conv-item ${isActive?'active':''}" data-id="${c.id}" aria-label="${escapeHtml(c.title)}">
      <span class="conv-title">${escapeHtml(c.title)}</span>
      <span class="conv-meta">${c.messages?.length||0} msgs</span>
      <span class="conv-actions">
        <button data-action="rename" title="Rename"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 20h9"/><path d="M16.5 3.5a2 2 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
        <button data-action="delete" title="Delete"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
      </span>
    </button>`
    list.appendChild(li)
  })
  // bind
  $$('.conv-item', list).forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      if(e.target.closest('[data-action]')) return
      activeId = btn.dataset.id; renderConversations(); renderMessages(); updateActiveProjectLabel(); if(window.innerWidth<=1024) $('#sidebar').classList.remove('open'), $('#sidebarOverlay').classList.remove('open')
    })
  })
  $$('[data-action="rename"]', list).forEach(b=> b.addEventListener('click', (e)=>{
    e.stopPropagation(); const id=b.closest('.conv-item').dataset.id; const c=conversations.find(x=>x.id===id); const n=prompt('Rename conversation', c.title); if(n && n.trim()){ c.title=n.trim(); c.updatedAt=nowISO(); saveConvs(); renderConversations(); if(id===activeId) $('#pageTitle').textContent=c.title }
  }))
  $$('[data-action="delete"]', list).forEach(b=> b.addEventListener('click', (e)=>{
    e.stopPropagation(); const id=b.closest('.conv-item').dataset.id; const c=conversations.find(x=>x.id===id)
    if(settings.confirmDelete && !confirm(`Delete conversation “${c.title}”?`)) return
    conversations = conversations.filter(x=>x.id!==id); if(activeId===id) activeId=conversations[0]?.id || null; saveConvs(); renderConversations(); renderMessages(); updateActiveProjectLabel(); toast('Conversation deleted')
  }))
}
$('#searchInput')?.addEventListener('input', renderConversations)
$('#newChatBtn')?.addEventListener('click', ()=>{
  createConversation()
  $('#pageTitle').textContent = 'New conversation'
  toast('New conversation started')
  $('#messageInput')?.focus()
})

/* ---------- Markdown-lite renderer ---------- */
function escapeHtml(s){ return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;') }
function renderMarkdown(src){
  let s = String(src)
  // code blocks
  const blocks=[]
  s = s.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang='', code='')=>{
    const i = blocks.length; blocks.push({lang: lang||'code', code}); return `§CODEBLOCK${i}§`
  })
  // escape
  s = escapeHtml(s)
  // inline code
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  // bold
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  // links [text](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  // headings
  s = s.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
  s = s.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
  s = s.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
  // unordered lists
  s = s.replace(/^(?:- |\* )(.+)$/gm, '<li>$1</li>')
  s = s.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
  // ordered lists: 1. 
  s = s.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
  // paragraphs: split double newlines (after escaping we already have <...>), handle remaining newlines -> <p> if not already block
  // quick table support (markdown | |)
  // restore code blocks with header & copy
  s = s.replace(/§CODEBLOCK(\d+)§/g, (_, idx)=>{
    const b = blocks[Number(idx)]
    const escaped = escapeHtml(b.code)
    return `<div class="code-head"><span>${escapeHtml(b.lang)}</span><button class="copy-code-btn" data-copy="${escapeHtml(b.code).replaceAll('"','&quot;')}">Copy</button></div><pre><code>${escaped}</code></pre>`
  })
  // wrap plain lines in <p> if not starting with <tag
  s = s.split(/\n{2,}/).map(chunk=>{
    const t = chunk.trim(); if(!t) return ''
    if(/^<(h[1-3]|ul|ol|pre|div)/.test(t)) return t
    return `<p>${t.replace(/\n/g,'<br>')}</p>`
  }).join('')
  // simple table from markdown pipes
  s = s.replace(/<p>\|(.+)\|<br>\|[-:\| ]+\|<br>((?:\|.+\|<br>)*)<\/p>/g, (m, header, rows)=>{
    const ths = header.split('|').map(c=>c.trim()).filter(Boolean)
    const trs = rows.trim().split('<br>').filter(Boolean)
    let html = '<table><thead><tr>' + ths.map(h=>`<th>${escapeHtml(h)}</th>`).join('') + '</tr></thead><tbody>'
    trs.forEach(r=>{
      const tds = r.split('|').map(c=>c.trim()).filter(Boolean)
      html += '<tr>' + tds.map(d=>`<td>${escapeHtml(d)}</td>`).join('') + '</tr>'
    })
    return html + '</tbody></table>'
  })
  return s
}

/* ---------- Messages UI ---------- */
function renderMessages(){
  const wrap = $('#messages'); const hero = $('#welcomeHero'); const titleEl = $('#pageTitle')
  if(!wrap) return
  const conv = conversations.find(c=>c.id===activeId)
  wrap.innerHTML = ''
  if(!conv){
    hero.style.display = ''
    titleEl.textContent = 'New conversation'
    document.title = 'MIR AI — Premium Personal Assistant by Mir Junior'
    return
  }
  hero.style.display = conv.messages?.length ? 'none' : ''
  titleEl.textContent = conv.title || 'Conversation'
  document.title = `${conv.title} — MIR AI`
  updateActiveProjectLabel()
  // render messages
  conv.messages.forEach((m, idx)=>{
    const isUser = m.role==='user'
    const row = document.createElement('div')
    row.className = `message ${isUser?'user':'assistant'}`
    row.setAttribute('data-idx', String(idx))
    const avatar = `<div class="msg-avatar" aria-hidden="true">${isUser? 'M' : '✦'}</div>`
    const time = settings.timestamps ? `<span class="msg-time">${fmtDate(m.createdAt)}</span>` : ''
    const bubbleInner = m.role==='assistant' ? renderMarkdown(m.content) : `<p>${linkify(escapeHtml(m.content))}</p>`
    // file chip if present
    const fileChip = m.file ? `<div style="margin-bottom:8px;display:inline-flex;gap:6px;align-items:center;background:var(--elevated);border:1px solid var(--border);padding:6px 8px;border-radius:999px;font-size:.78rem"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M10 13H8"/><path d="M16 17H8"/><path d="M13 13H8"/></svg> ${escapeHtml(m.file.name)} · ${(m.file.size/1024).toFixed(1)} KB</div>` : ''
    const actions = !isUser ? `
      <div class="msg-actions">
        <button data-copy-msg title="Copy response"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v3"/></svg> Copy</button>
        <button data-regen title="Regenerate"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v7h-7"/></svg> Regenerate</button>
        <button data-speak title="Listen"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a6 6 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg> Speak</button>
        <button data-save title="Save"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> Save</button>
        ${time}
      </div>` : `<div class="msg-meta">${time}</div>`
    row.innerHTML = isUser
      ? `<div class="bubble">${fileChip}${bubbleInner}<div class="msg-meta">${time}</div></div><div class="msg-avatar">${isUser?'M':'✦'}</div>`
      : `${avatar}<div class="bubble">${fileChip}${bubbleInner}${actions}</div>`
    wrap.appendChild(row)
  })
  // bind copy code
  $$('.copy-code-btn', wrap).forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const code = btn.getAttribute('data-copy') || ''
      // decode html entities
      const txt = code.replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&amp;','&')
      await navigator.clipboard.writeText(txt); toast('Code copied')
    })
  })
  $$('[data-copy-msg]', wrap).forEach(btn=> btn.addEventListener('click', async (e)=>{
    const idx = Number(e.target.closest('.message').dataset.idx)
    const conv = conversations.find(c=>c.id===activeId); const msg = conv.messages[idx]
    await navigator.clipboard.writeText(msg.content); toast('Response copied')
  }))
  $$('[data-regen]', wrap).forEach(btn=> btn.addEventListener('click', async (e)=>{
    const idx = Number(e.target.closest('.message').dataset.idx)
    const conv = conversations.find(c=>c.id===activeId); const userMsg = [...conv.messages].slice(0, idx).reverse().find(m=>m.role==='user')
    if(!userMsg) return toast('No prompt to regenerate from')
    await regenerateFrom(userMsg.content)
  }))
  $$('[data-speak]', wrap).forEach(btn=> btn.addEventListener('click', (e)=>{
    const idx = Number(e.target.closest('.message').dataset.idx); const conv = conversations.find(c=>c.id===activeId); const msg=conv.messages[idx]
    speakText(msg.content)
  }))
  $$('[data-save]', wrap).forEach(btn=> btn.addEventListener('click', (e)=>{
    const idx = Number(e.target.closest('.message').dataset.idx); const conv=conversations.find(c=>c.id===activeId); const msg=conv.messages[idx]
    // save to saved items (localStorage)
    const saved = LS.get('mir:saved', []); saved.unshift({id:uid(), content:msg.content, at:nowISO(), convTitle:conv.title}); LS.set('mir:saved', saved); $('#savedCount').textContent=String(saved.length); toast('Saved to Saved items')
  }))

  // scroll to bottom
  const container = $('#chatContainer'); container.scrollTop = container.scrollHeight
}
function linkify(s){ return s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>') }

/* ---------- File handling ---------- */
function bindFiles(){
  const input = $('#fileInput'), preview = $('#filePreview'), btn = $('#attachBtn')
  btn?.addEventListener('click', ()=> input.click())
  input?.addEventListener('change', async (e)=>{
    const f = e.target.files?.[0]; if(!f) return; await handleFile(f); e.target.value=''
  })
  const wrap = $('.composer-wrap')
  if(wrap){
    wrap.addEventListener('dragover', e=>{ e.preventDefault(); wrap.style.borderColor='var(--accent)' })
    wrap.addEventListener('dragleave', ()=> wrap.style.borderColor='')
    wrap.addEventListener('drop', async e=>{ e.preventDefault(); wrap.style.borderColor=''; const f=e.dataTransfer.files?.[0]; if(f) await handleFile(f) })
  }
}
async function handleFile(file){
  const max = 10*1024*1024
  if(file.size > max){ toast('File too large — max 10 MB'); return }
  const allowed = ['text/plain','text/markdown','application/json','text/csv','application/pdf','image/png','image/jpeg','image/webp','image/svg+xml','text/javascript','application/javascript']
  const extOK = /\.(txt|md|json|csv|js|ts|py|pdf|png|jpg|jpeg|webp|svg)$/i.test(file.name)
  if(!allowed.includes(file.type) && !extOK){ toast('Unsupported file type. Try txt, md, json, csv, pdf, images.'); return }
  let content = ''
  if(file.type.startsWith('image/')){
    content = `[Image: ${file.name} — ${Math.round(file.size/1024)}KB — describe this image to the user]`
  } else if(file.type==='application/pdf'){
    content = await readFileAsText(file).catch(()=> '[PDF attached — text extraction not available in browser, but MIR AI will try to help]')
    content = content.slice(0, 6000)
  } else {
    content = await readFileAsText(file); content = content.slice(0, 12000)
  }
  attachedFile = { name:file.name, size:file.size, type:file.type || 'unknown', content }
  renderFilePreview()
  toast(`Attached ${file.name}`)
}
function readFileAsText(f){ return new Promise((res, rej)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result)); r.onerror=rej; r.readAsText(f) }) }
function renderFilePreview(){
  const el = $('#filePreview'); if(!el) return
  if(!attachedFile){ el.classList.add('hidden'); el.innerHTML=''; return }
  el.classList.remove('hidden')
  el.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg> <strong>${escapeHtml(attachedFile.name)}</strong> <span class="muted">· ${(attachedFile.size/1024).toFixed(1)} KB</span> <span style="margin-left:auto"></span> <button class="ghost-btn small" id="removeFileBtn">Remove</button>`
  $('#removeFileBtn')?.addEventListener('click', ()=>{ attachedFile=null; renderFilePreview() })
}

/* ---------- Voice ---------- */
function bindVoice(){
  const micBtn = $('#micBtn'), voiceInd = $('#voiceIndicator'), stopVoiceBtn = $('#stopVoiceBtn')
  let recognition = null
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if(!SR){
    micBtn.style.display='none'
    $('#heroTryVoice')?.addEventListener('click', ()=> toast('Voice input not supported in this browser — try Chrome/Edge.'))
    return
  }
  micBtn.addEventListener('click', ()=>{
    if(micBtn.classList.contains('active')){
      try{ recognition?.stop() }catch{}
      return
    }
    recognition = new SR()
    recognition.lang = settings.preferredLanguage?.startsWith('rw') ? 'rw-RW' : (settings.language==='fr'?'fr-FR': settings.language==='rw'?'rw-RW' : 'en-US')
    recognition.interimResults = false; recognition.maxAlternatives=1
    recognition.onstart = ()=>{ micBtn.classList.add('active'); voiceInd.classList.remove('hidden') }
    recognition.onend = ()=>{ micBtn.classList.remove('active'); voiceInd.classList.add('hidden') }
    recognition.onerror = (e)=>{ micBtn.classList.remove('active'); voiceInd.classList.add('hidden'); toast('Voice error: '+ (e.error||'unknown')) }
    recognition.onresult = (e)=>{
      const txt = e.results[0]?.[0]?.transcript || ''
      $('#messageInput').value = ( $('#messageInput').value ? $('#messageInput').value + ' ' : '') + txt
      $('#messageInput').dispatchEvent(new Event('input'))
      toast('Voice captured — press Send')
    }
    try{ recognition.start() }catch{ toast('Microphone blocked — allow permission') }
  })
  stopVoiceBtn?.addEventListener('click', ()=>{ try{ recognition?.stop() }catch{}; voiceInd.classList.add('hidden'); micBtn.classList.remove('active') })
  $('#heroTryVoice')?.addEventListener('click', ()=> micBtn.click())
}
function speakText(txt){
  if(!('speechSynthesis' in window)){ toast('Text-to-speech not supported'); return }
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(txt.slice(0, 2000))
  u.lang = 'en-US'; u.rate=1; u.pitch=1; u.volume=1
  ttsOn=true; u.onend=()=> ttsOn=false; u.onerror=()=> ttsOn=false
  window.speechSynthesis.speak(u); toast('Speaking… click Stop to cancel')
}
$('#composerForm')?.addEventListener('keydown', (e)=>{
  if(e.key==='Escape' && generating){ e.preventDefault(); stopGeneration() }
  if(e.key==='Escape' && ttsOn){ window.speechSynthesis.cancel(); ttsOn=false; toast('Speech stopped') }
})

/* ---------- AI Engine (local intelligent fallback + cloud) ---------- */
const PROMPT_TEMPLATES = [
  {id:'p1', cat:'coding', title:'Debug this code', body:'Review this code, find bugs, explain the root cause step-by-step, then provide a fixed version with comments:\n\n```\n{{code}}\n```'},
  {id:'p2', cat:'coding', title:'Explain like I\'m 5 — code', body:'Explain the following concept with simple analogies and a runnable example: {{topic}}'},
  {id:'p3', cat:'writing', title:'Professional email', body:'Write a professional, warm email for: {{purpose}}. Audience: {{audience}}. Tone: concise and respectful. Include subject line.'},
  {id:'p4', cat:'writing', title:'Blog outline', body:'Create a SEO-friendly blog outline for “{{topic}}”. Include H2/H3, intro hook, key points, and a CTA.'},
  {id:'p5', cat:'research', title:'Research brief', body:'Summarize the key findings about {{topic}}. Give 5 insights, 3 risks, 2 next experiments, and cite what to verify next.'},
  {id:'p6', cat:'research', title:'Summarize file', body:'Summarize the attached file — extract objectives, methods, results, and action items. If it\'s code, explain what it does.'},
  {id:'p7', cat:'learning', title:'Study plan', body:'Build a 2-week study plan for {{topic}}. Daily tasks 20-40 min, with checkpoints and mini-quizzes.'},
  {id:'p8', cat:'learning', title:'Quiz me', body:'Create a 8-question quiz on {{topic}} with answers hidden, then reveal with explanations.'},
  {id:'p9', cat:'website', title:'Website planner', body:'Plan a modern, accessible website for {{business}}. Give sitemap, hero copy, sections, and a component checklist for React + Tailwind.'},
  {id:'p10', cat:'website', title:'Landing hero copy', body:'Write 3 hero variations for {{product}} — headline, subhead, CTA — premium, concise, neon-accent vibe.'},
]

function buildSystemPrompt(){
  const prefs = `User preferred name: ${settings.preferredName||'Musonera'}. Language: ${settings.language}. Response style: ${settings.responseStyle}. Topics: ${settings.topics||'general productivity'}. Custom instructions: ${settings.customInstructions||'none'}.`
  return `You are MIR AI, a premium personal AI assistant. Identity: developed by Musonera Irahari Junior (Mir Junior) — Rwandan developer, King David Academy, Mir Collection founder, 40+ projects, stack React/Next.js/Node.js/Python/Docker/K8s, AWS CCP + Meta Frontend, portfolio https://mirjunior.netlify.app/. Answer helpfully, ${settings.responseStyle}. Language: ${settings.language}. Keep tone premium, friendly, concise unless asked for detail. ${prefs} Never claim you know creator personally. When asked who created you, use exact line: "${CREATOR_ANSWER}".`
}

async function callCloudAI(messages){
  // Try Netlify function, then fallback
  const endpoints = ['/.netlify/functions/ai', '/api/ai']
  for(const url of endpoints){
    try{
      const r = await fetch(url, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ messages, systemPrompt: buildSystemPrompt() })
      })
      if(!r.ok) continue
      const data = await r.json()
      if(data.content) return data.content
      if(data.fallback) return null // trigger local
    }catch{ /* ignore */ }
  }
  return null
}

function localEngine(prompt, fileContext, options={}){
  const p = prompt.trim()
  const low = p.toLowerCase()

  // creator questions already handled earlier, but keep safe
  if(isCreatorQuestion(p)) return CREATOR_ANSWER

  // greetings
  if(/^(hi|hello|hey|greetings|bonjour|muraho)/i.test(p) && p.length<40){
    const name = settings.preferredName || 'Musonera'
    return `Hey ${escapeHtml(name)}! I'm MIR AI — your premium assistant by Mir Junior. I can help you code, write, learn, research, or plan your next build. Try one of these:\n\n- **Build a website** — “Design a portfolio hero with React”\n- **Explain code** — paste code and ask “find bugs”\n- **Summarize** — attach a file and say “summarize key insights”\n- **Ask about me** — “Who created you?”\n\nWhat would you like to do today?`
  }

  // code-related
  if(/code|bug|error|function|react|next\.js|node|python|docker|api/i.test(low) || /```/.test(p)){
    if(/portfolio|landing|hero/i.test(low)){
      return `## Portfolio Hero — Premium, accessible, neon-pink accent\n\nHere's a production-ready **React + Tailwind** hero you can drop in:\n\n\`\`\`jsx
// Hero.jsx — MIR AI style
export default function Hero(){
  return (
    <section className="max-w-6xl mx-auto px-6 py-16 bg-[#09070D] text-[#F8F5FA]">
      <div className="inline-flex gap-2 items-center px-3 py-1 rounded-full bg-[#FF2D95]/10 border border-[#FF2D95]/20 text-[#FF2D95] text-xs font-bold tracking-widest">MIR AI • BUILT BY MIR JUNIOR</div>
      <h1 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-tight">Build <span className="text-[#FF2D95]">faster</span>, designed to ship.</h1>
      <p className="mt-3 text-[#B7AEBF] max-w-xl">Premium components, accessible by default. Copy, customize, deploy to Netlify in minutes.</p>
      <div className="mt-6 flex gap-3">
        <a href="#" className="px-5 py-3 rounded-xl bg-[#FF2D95] text-white font-bold">Get Started</a>
        <a href="https://mirjunior.netlify.app/" target="_blank" className="px-5 py-3 rounded-xl border border-[#2A2430]">View Portfolio</a>
      </div>
    </section>
  )
}
\`\`\`\n\n**Deploy checklist:**\n- Set \`publish = "dist"\`, command \`npm run build\`\n- Add SPA redirect in \`netlify.toml\`\n- Keep API keys in Netlify env, never in client JS\n\nWant me to tailor this to your brand colors or add a projects grid?`
    }
    return `### Code Review — MIR AI\n\nNice! Here's how I'd approach **${escapeHtml(p.slice(0,80))}**:\n\n**1. What to check first**\n- Validate inputs and handle errors (don't expose stack traces)\n- Keep secrets in env vars, never in frontend\n- Use readable names, early returns, small functions\n\n**2. Example pattern (React example)**\n\`\`\`js
// safe fetch with timeout + error handling
export async function fetchWithTimeout(url, opts={}){
  const ctrl = new AbortController()
  const id = setTimeout(()=> ctrl.abort(), 8000)
  try{
    const r = await fetch(url, {...opts, signal: ctrl.signal})
    if(!r.ok) throw new Error('Request failed: '+ r.status)
    return await r.json()
  } finally { clearTimeout(id) }
}
\`\`\`\n\n**3. Next steps**\n- Paste your actual code block between \`\`\` and tell me the error message\n- I’ll fix it, explain why, and give tests\n\n${fileContext ? `\n> Noted your file **${escapeHtml(fileContext.name)}** — I’ll use its content as context.` : ''}\n\nWant concise or detailed style? Change it in Settings → Chat.`
  }

  // writing
  if(/email|write|blog|essay|letter|draft/i.test(low)){
    return `### Writing Assistant — MIR AI\n\nHere's a polished draft for **${escapeHtml(p.slice(0,90))}**:\n\n**Subject:** Quick update & next steps\n\n> Hello [Name],\n> Thank you for your patience. I wanted to share a brief update on [project]. We've completed [milestone], and the next phase [action] is scheduled for [date]. Please let me know a convenient time to sync — I'm available [slots].\n> Warm regards,\n> Musonera\n\n**Tips from MIR AI:**\n- Keep it under 120 words for busy readers\n- One idea per paragraph, close with a clear ask\n- Copy → paste into Gmail, then personalize [brackets]\n\nTell me audience + tone and I’ll rewrite instantly (concise / warm / formal).`
  }

  // research / summarize
  if(/summarize|research|insight|key points|attached|file/i.test(low) || fileContext){
    const fileNote = fileContext ? `I've considered your file **${escapeHtml(fileContext.name)}** (${Math.round(fileContext.size/1024)} KB). Content preview:\n\n> ${escapeHtml(fileContext.content.slice(0,500))}\n\n` : ''
    return `### Research Summary — MIR AI\n\n${fileNote}**5 Key Insights**\n1. Goal & context matter — define the question before the answer.\n2. Validate sources; prefer primary over secondary.\n3. Look for patterns, not just facts.\n4. Note risks early (security, performance, cost).\n5. End with actionable next steps.\n\n**3 Risks to watch**\n- Exposing secrets in client code\n- Heavy animations blocking first paint\n- Unvalidated file inputs\n\n**2 Next experiments**\n- A/B test concise vs detailed answers with your users\n- Measure time-to-first-interaction after preloader\n\nWant a table or export? Ask “export this as markdown”.`
  }

  // learning
  if(/learn|study|explain|teach|quiz|roadmap/i.test(low)){
    return `### Learning Plan — ${escapeHtml(p.slice(0,60))}\n\n**Week 1 — Foundations (20-30 min/day)**\n- Day 1-2: Core concepts + hands-on mini project\n- Day 3-4: Build something real (e.g., todo app, API fetcher)\n- Day 5: Quiz — I’ll ask 5 questions, you answer\n\n**Week 2 — Ship it**\n- Deploy to Netlify, test on mobile, share link\n- Reflect: what slowed you down? Optimize that.\n\n**Mini-quiz (try now):**\n1. What does “accessible” mean for a button? (Hint: keyboard + screen reader)\n\nReply “quiz me on [topic]” and I’ll generate questions instantly.`
  }

  // planning / productivity
  if(/plan|project|workspace|productivity|todo|schedule/i.test(low)){
    return `### Productivity — MIR AI\n\nLet's turn **${escapeHtml(p.slice(0,80))}** into action:\n\n**Today (30 min)**\n- [ ] Define outcome in one sentence\n- [ ] List 3 must-do tasks\n- [ ] Time-box with 25-min focus\n\n**This week**\n| Task | Owner | Due |\n|---|---|---|\n| Set up repo + deploy | You | Today |\n| Draft copy | MIR AI | Tomorrow |\n| User test | You | Fri |\n\nWant me to create a project workspace? I can organize chats under “Software development” — just ask.`
  }

  // general knowledge — helpful, balanced
  const styleNote = settings.responseStyle==='concise' ? 'I’ll keep it concise.' : settings.responseStyle==='detailed' ? 'Here’s a detailed take:' : 'Here’s a balanced answer:'
  return `### MIR AI — ${styleNote}\n\nYou asked: **${escapeHtml(p.slice(0,220))}**\n\nThat's a great question. Here's how to think about it:\n\n- **Core idea:** Break the problem into inputs → process → outputs. Keep interfaces small and testable.\n- **Practical tip:** Start with the smallest working version, then iterate with real feedback.\n- **Pitfall to avoid:** Over-optimizing early — ship, measure, improve.\n\n${fileContext ? `> Using your file **${escapeHtml(fileContext.name)}** as context, I can give a tighter summary — ask “summarize in 3 bullets”.` : ''}\n\n**How MIR AI can help next:**\n- “Show me code for …”\n- “Rewrite this to be more professional”\n- “Make a 2-week plan for …”\n- “Who created you?” — I’ll introduce Mir Junior.\n\nWhat angle should we dive deeper into?`
}

/* ---------- Generation ---------- */
function setGenerating(v){
  generating=v
  $('#stopBtn')?.classList.toggle('hidden', !v)
  $('#sendBtn')?.classList.toggle('hidden', v)
  $('#typingIndicator')?.classList.toggle('hidden', !v)
  $('#messageInput').disabled = v
  if(v) $('#messageInput').placeholder = 'MIR AI is generating… press Stop or Esc'
  else $('#messageInput').placeholder = "Ask anything — try 'Who created you?' or 'Build me a portfolio section'"
}
function stopGeneration(){
  if(!generating) return
  clearInterval(genTimer); setGenerating(false); toast('Generation stopped')
  try{ window.speechSynthesis.cancel() }catch{}
}
$('#stopBtn')?.addEventListener('click', stopGeneration)

async function sendMessage(rawText){
  const text = rawText.trim(); if(!text && !attachedFile) return
  let conv = conversations.find(c=>c.id===activeId)
  if(!conv){ conv = createConversation(text.slice(0,48) || 'New conversation') }
  // update title if first message
  if(!conv.messages.length) { conv.title = text.slice(0,48) || attachedFile?.name || 'New conversation' }

  const userMsg = { id:uid(), role:'user', content:text || (attachedFile?`[File: ${attachedFile.name}]`:''), createdAt:nowISO(), file: attachedFile ? {name:attachedFile.name, size:attachedFile.size, type:attachedFile.type} : null }
  const fileCtx = attachedFile ? {...attachedFile} : null
  conv.messages.push(userMsg)
  conv.updatedAt = nowISO()
  // keep attachedFile for assistant context but clear UI
  attachedFile = null; renderFilePreview()
  saveConvs(); renderConversations(); renderMessages()
  setGenerating(true)

  // Check quota-like quick creator answer — priority
  let finalResponse = null
  if(isCreatorQuestion(text)){
    finalResponse = CREATOR_ANSWER
  } else {
    // try cloud
    try{
      const history = conv.messages.slice(-8).map(m=>({role:m.role, content:m.content}))
      const cloud = await callCloudAI(history)
      if(cloud) finalResponse = cloud
    }catch{ /* ignore */ }
    if(!finalResponse){
      finalResponse = localEngine(text, fileCtx, {style: settings.responseStyle})
    }
  }

  // streaming emulation
  const assistantMsg = { id:uid(), role:'assistant', content:'', createdAt:nowISO() }
  conv.messages.push(assistantMsg)
  // incremental append
  let idx=0
  const chunkSize = settings.responseLength==='short' ? 18 : settings.responseLength==='long'? 6 : 12
  const interval = settings.reduceMotion ? 18 : 14
  genTimer = setInterval(()=>{
    if(idx >= finalResponse.length){
      clearInterval(genTimer); genTimer=null; assistantMsg.content = finalResponse; saveConvs(); renderMessages(); setGenerating(false)
      // update title doc and counters
      $('#savedCount').textContent = String(LS.get('mir:saved', []).length)
      return
    }
    assistantMsg.content = finalResponse.slice(0, idx + chunkSize)
    idx += chunkSize
    // efficient: update last bubble DOM instead of full rerender every tick (throttle)
    const lastBubble = $$('.message.assistant .bubble').pop()
    if(lastBubble) lastBubble.innerHTML = renderMarkdown(assistantMsg.content) + `<div class="msg-actions"><button data-copy-msg>Copy</button> <button data-regen>Regenerate</button> <small style="color:var(--text-3)">${fmtDate(assistantMsg.createdAt)}</small></div>`
    if(idx % 64 === 0) saveConvs()
    const container = $('#chatContainer'); container.scrollTop = container.scrollHeight
  }, interval)

  // fallback hard timeout 30s
  setTimeout(()=>{ if(generating && genTimer){ clearInterval(genTimer); assistantMsg.content = finalResponse; saveConvs(); renderMessages(); setGenerating(false) } }, 30000)
}
async function regenerateFrom(promptText){
  const conv = conversations.find(c=>c.id===activeId); if(!conv) return
  // remove last assistant if present
  if(conv.messages[conv.messages.length-1]?.role==='assistant') conv.messages.pop()
  saveConvs(); renderMessages(); await sendMessage(promptText)
}

/* ---------- Composer ---------- */
function bindComposer(){
  const form = $('#composerForm'), input = $('#messageInput')
  const autoResize = ()=>{ input.style.height='auto'; input.style.height=Math.min(input.scrollHeight,140)+'px' }
  input?.addEventListener('input', autoResize)
  input?.addEventListener('keydown', (e)=>{
    if(e.key==='Enter' && !e.shiftKey && settings.enterToSend){
      e.preventDefault(); form.requestSubmit()
    }
  })
  form?.addEventListener('submit', async (e)=>{
    e.preventDefault()
    const val = input.value
    input.value=''; autoResize()
    await sendMessage(val)
  })
  // hero cards
  $$('.hero-card').forEach(card=> card.addEventListener('click', ()=>{
    const p = card.dataset.prompt; if(p){ $('#messageInput').value=p; $('#composerForm').requestSubmit() }
  }))
  $('#heroOpenTools')?.addEventListener('click', ()=> $('#promptDialog').showModal())
}

/* ---------- Settings ---------- */
function bindSettings(){
  const dlg = $('#settingsDialog')
  $('#settingsBtn')?.addEventListener('click', ()=> dlg.showModal())
  $$('[data-close="settingsDialog"]').forEach(b=> b.addEventListener('click', ()=> dlg.close()))
  // tabs
  $$('.settings-tab').forEach(tab=> tab.addEventListener('click', ()=>{
    $$('.settings-tab').forEach(t=> t.classList.remove('active')); tab.classList.add('active')
    const panel = tab.dataset.tab; $$('.settings-panel').forEach(p=> p.classList.toggle('active', p.dataset.panel===panel))
  }))
  $('#themeSelect')?.addEventListener('change', e=>{ settings.theme=e.target.value; saveSettings() })
  $('#accentInput')?.addEventListener('input', e=>{ settings.accent=e.target.value; saveSettings() })
  $('#densitySelect')?.addEventListener('change', e=>{ settings.density=e.target.value; saveSettings() })
  $('#reduceMotionCheck')?.addEventListener('change', e=>{ settings.reduceMotion=e.target.checked; saveSettings(); toast(e.target.checked?'Reduced motion on':'Animations on') })
  $('#sidebarCollapsedCheck')?.addEventListener('change', e=>{ settings.sidebarCollapsed=e.target.checked; saveSettings() })
  $('#enterToSendCheck')?.addEventListener('change', e=>{ settings.enterToSend=e.target.checked; saveSettings() })
  $('#timestampsCheck')?.addEventListener('change', e=>{ settings.timestamps=e.target.checked; saveSettings(); renderMessages() })
  $('#responseStyleSelect')?.addEventListener('change', e=>{ settings.responseStyle=e.target.value; saveSettings() })
  $('#languageSelect')?.addEventListener('change', e=>{ settings.language=e.target.value; settings.preferredLanguage=e.target.value; saveSettings() })
  $('#lengthSelect')?.addEventListener('change', e=>{ settings.responseLength=e.target.value; saveSettings() })
  $('#modelSelect')?.addEventListener('change', e=>{ settings.model=e.target.value; saveSettings(); toast('Model: '+e.target.value) })
  // personal
  $('#prefNameInput').value = settings.preferredName || ''
  $('#prefTopicsInput').value = settings.topics || ''
  $('#prefInstructionsInput').value = settings.customInstructions || ''
  $('#savePrefsBtn')?.addEventListener('click', ()=>{
    settings.preferredName = $('#prefNameInput').value.trim()
    settings.topics = $('#prefTopicsInput').value.trim()
    settings.customInstructions = $('#prefInstructionsInput').value.trim()
    saveSettings(); $('#prefsStatus').textContent='Preferences saved locally ✓'; setTimeout(()=> $('#prefsStatus').textContent='', 2500); toast('Preferences saved')
  })
  $('#clearPrefsBtn')?.addEventListener('click', ()=>{ $('#prefNameInput').value=''; $('#prefTopicsInput').value=''; $('#prefInstructionsInput').value=''; settings.preferredName=''; settings.topics=''; settings.customInstructions=''; saveSettings(); toast('Preferences cleared') })
  // privacy
  $('#exportAllBtn')?.addEventListener('click', ()=>{
    const blob = new Blob([JSON.stringify(conversations,null,2)], {type:'application/json'})
    const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`mir-ai-conversations-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url); toast('Export downloaded')
  })
  $('#clearHistoryBtn')?.addEventListener('click', ()=>{
    if(!confirm('Clear ALL conversations? This cannot be undone.')) return
    conversations=[]; activeId=null; saveConvs(); renderConversations(); renderMessages(); toast('All conversations cleared')
  })
  $('#clearPrefsStorageBtn')?.addEventListener('click', ()=>{ LS.del(KEYS.settings); LS.del(KEYS.prefs); settings={...defaultSettings}; applyTheme(); toast('Preferences cleared — refresh to see defaults') })
  $('#resetDefaultsBtn')?.addEventListener('click', ()=>{
    if(!confirm('Reset all settings to defaults?')) return
    settings={...defaultSettings}; LS.set(KEYS.settings, settings); applyTheme(); toast('Settings reset')
  })
}

/* ---------- Tools & Prompt Studio ---------- */
function bindTools(){
  $$('.tool-btn[data-tool]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const tool = btn.dataset.tool
      const prompts = {
        coding:'Help me debug this React code. I want best practices, accessibility, and performance tips.',
        writing:'Write a concise, professional email for a client update — friendly tone, clear ask.',
        learning:'Create a 2-week learning plan for Next.js + Tailwind — 30 min/day with mini-projects.',
        research:'Summarize research on “AI for education” — 5 insights, 3 risks, next experiments.',
        website:'Plan a modern portfolio website for a developer — sitemap, hero copy, components.',
        productivity:'Turn my goal “ship MVP in 7 days” into a daily checklist with time blocks.'
      }
      $('#messageInput').value = prompts[tool] || prompts.coding
      $('#messageInput').focus(); toast(`${tool} tool — prompt ready`)
    })
  })
  $('#promptStudioBtn')?.addEventListener('click', ()=> $('#promptDialog').showModal())
  $$('[data-close="promptDialog"]').forEach(b=> b.addEventListener('click', ()=> $('#promptDialog').close()))
  const grid = $('#promptGrid')
  let customPrompts = LS.get('mir:customPrompts', [])
  function renderPrompts(filter='all'){
    if(!grid) return
    const all = [...PROMPT_TEMPLATES, ...customPrompts]
    const list = filter==='all' ? all : all.filter(p=>p.cat===filter)
    grid.innerHTML = list.map(p=>`
      <div class="prompt-card" data-id="${p.id}">
        <span style="display:inline-flex;gap:6px;align-items:center;font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent)">${escapeHtml(p.cat)} • MIR AI</span>
        <h4>${escapeHtml(p.title)}</h4>
        <p>${escapeHtml(p.body.slice(0,120))}…</p>
        <div class="card-actions">
          <button class="primary-btn small" data-use>Use</button>
          <button class="ghost-btn small" data-copy>Copy</button>
        </div>
      </div>
    `).join('')
    $$('[data-use]', grid).forEach((btn,i)=> btn.addEventListener('click', ()=>{
      const p = list[i]; $('#messageInput').value = p.body.replace('{{topic}}','your topic').replace('{{code}}','// paste code here'); $('#promptDialog').close(); toast('Prompt inserted — edit and send'); $('#messageInput').focus()
    }))
    $$('[data-copy]', grid).forEach((btn,i)=> btn.addEventListener('click', async ()=>{
      await navigator.clipboard.writeText(list[i].body); toast('Prompt copied')
    }))
  }
  $$('.filter-btn').forEach(b=> b.addEventListener('click', ()=>{
    $$('.filter-btn').forEach(x=>x.classList.remove('active')); b.classList.add('active'); renderPrompts(b.dataset.filter)
  }))
  $('#saveCustomPrompt')?.addEventListener('click', ()=>{
    const title = $('#customPromptTitle').value.trim(); const body = $('#customPromptBody').value.trim()
    if(!title || !body) return toast('Add title and content')
    const p = {id:'c'+uid(), cat:'custom', title, body}; customPrompts.unshift(p); LS.set('mir:customPrompts', customPrompts); renderPrompts('all'); $('#customPromptTitle').value=''; $('#customPromptBody').value=''; toast('Prompt saved')
  })
  $('#useCustomPrompt')?.addEventListener('click', ()=>{
    const body = $('#customPromptBody').value.trim(); if(!body) return toast('Enter prompt content'); $('#messageInput').value=body; $('#promptDialog').close(); $('#messageInput').focus()
  })
  renderPrompts('all')
}

/* ---------- Command Palette ---------- */
function bindCommandPalette(){
  const dlg = $('#commandDialog'), input = $('#commandInput'), list = $('#commandList')
  const commands = [
    {id:'newchat', label:'New chat', hint:'Ctrl N', action:()=> createConversation() },
    {id:'search', label:'Search conversations', hint:'Type to filter', action:()=> $('#searchInput').focus() },
    {id:'theme', label:'Toggle theme', hint:'Dark ↔ Light', action:()=>{ settings.theme = (document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark'); saveSettings(); toast('Theme: '+settings.theme) } },
    {id:'settings', label:'Open Settings', hint:'Ctrl ,', action:()=> $('#settingsDialog').showModal() },
    {id:'clear', label:'Clear current conversation', hint:'Delete', action:()=>{
      if(!activeId) return; if(!confirm('Clear messages in this conversation?')) return; const c=conversations.find(x=>x.id===activeId); c.messages=[]; saveConvs(); renderMessages(); toast('Conversation cleared')
    }},
    {id:'export', label:'Export conversation (Markdown)', hint:'Download', action:()=> doExport('md') },
    {id:'exportjson', label:'Export conversation (JSON)', hint:'Download', action:()=> doExport('json') },
    {id:'voice', label:'Start voice input', hint:'Microphone', action:()=> $('#micBtn').click() },
    {id:'prompt', label:'Open Prompt Studio', hint:'Templates', action:()=> $('#promptDialog').showModal() },
    {id:'help', label:'Help & Shortcuts', hint:'Ctrl /', action:()=> $('#helpDialog').showModal() },
    {id:'collapse', label:'Toggle sidebar', hint:'Ctrl B', action:()=> $('#collapseBtn').click() },
  ]
  function render(filter=''){
    const q = filter.toLowerCase()
    const filtered = q ? commands.filter(c=> c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q)) : commands
    list.innerHTML = filtered.map(c=> `<li class="command-item" role="option" data-id="${c.id}"><span><strong>${c.label}</strong> <span class="muted"> — ${c.hint}</span></span><kbd>↵</kbd></li>`).join('')
    if(!filtered.length) list.innerHTML = '<li style="padding:10px;color:var(--text-3)">No commands found.</li>'
    $$('.command-item', list).forEach(el=> el.addEventListener('click', ()=>{
      const cmd = commands.find(x=>x.id===el.dataset.id); dlg.close(); cmd.action()
    }))
    // keyboard nav
    let idx=0; const items=$$('.command-item', list); items.forEach((it,i)=> it.classList.toggle('active', i===idx))
    list._nav = {idx, items, filtered}
  }
  function open(){
    dlg.showModal(); render(''); input.value=''; input.focus()
  }
  $('#commandBtn')?.addEventListener('click', open)
  input?.addEventListener('input', ()=> render(input.value))
  input?.addEventListener('keydown', (e)=>{
    const nav = list._nav; if(!nav) return
    if(e.key==='ArrowDown'){ e.preventDefault(); nav.idx=Math.min(nav.idx+1, nav.items.length-1); nav.items.forEach((it,i)=> it.classList.toggle('active', i===nav.idx)) }
    if(e.key==='ArrowUp'){ e.preventDefault(); nav.idx=Math.max(0, nav.idx-1); nav.items.forEach((it,i)=> it.classList.toggle('active', i===nav.idx)) }
    if(e.key==='Enter'){ e.preventDefault(); const cmd=nav.filtered[nav.idx]; if(cmd){ dlg.close(); cmd.action() } }
  })
  dlg?.addEventListener('click', (e)=>{ if(e.target===dlg) dlg.close() })
  document.addEventListener('keydown', (e)=>{
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); if(dlg.open) dlg.close(); else open() }
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='n'){ e.preventDefault(); createConversation() }
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='b'){ e.preventDefault(); $('#collapseBtn').click() }
    if((e.ctrlKey||e.metaKey) && e.key===','){ e.preventDefault(); $('#settingsDialog').showModal() }
    if(e.key==='Escape' && generating){ stopGeneration() }
  })
}

/* ---------- Export ---------- */
function doExport(fmt='md'){
  const conv = conversations.find(c=>c.id===activeId); if(!conv || !conv.messages.length) return toast('Nothing to export')
  if(fmt==='json'){
    const blob=new Blob([JSON.stringify(conv,null,2)],{type:'application/json'}); download(blob, `${slug(conv.title)}.json`)
  } else {
    let md = `# ${conv.title}\n\n*Exported from MIR AI — by Mir Junior • ${new Date().toLocaleString()}*\n\n`
    conv.messages.forEach(m=>{
      md += `## ${m.role==='user' ? 'Musonera' : 'MIR AI'}\n\n${m.content}\n\n---\n\n`
    })
    const blob=new Blob([md],{type:'text/markdown'}); download(blob, `${slug(conv.title)}.md`)
  }
  toast('Export downloaded')
}
function slug(s){ return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,40) || 'conversation' }
function download(blob, name){ const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url) }
$('#exportBtn')?.addEventListener('click', ()=> doExport('md'))
// savedCount init
$('#savedBtn')?.addEventListener('click', ()=>{
  const saved = LS.get('mir:saved', []); if(!saved.length) return toast('No saved items yet — save a response first')
  const dlg = document.createElement('dialog'); dlg.className='modal'; dlg.innerHTML = `<div class="modal-inner" style="max-width:720px"><div class="modal-header"><h2>Saved items (${saved.length})</h2><button class="icon-btn" onclick="this.closest('dialog').close()">✕</button></div><div class="modal-body" style="display:flex;flex-direction:column;gap:10px">${saved.map(s=>`<div style="border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--elevated)"><div style="font-weight:700">${escapeHtml(s.convTitle||'Saved')}</div><div style="font-size:.84rem;color:var(--text-2);margin:6px 0;white-space:pre-wrap;max-height:120px;overflow:auto">${escapeHtml(s.content.slice(0,600))}</div><div style="display:flex;gap:6px"><button class="ghost-btn small" data-copy-saved="${s.id}">Copy</button><button class="ghost-btn small" data-del-saved="${s.id}">Delete</button></div></div>`).join('')}</div></div>`
  document.body.appendChild(dlg); dlg.showModal(); dlg.addEventListener('close', ()=> dlg.remove())
  // need delegation not working due to escaping — simpler: attach after
  setTimeout(()=>{
    $$('[data-copy-saved]', dlg).forEach(b=> b.addEventListener('click', async ()=>{
      const id=b.getAttribute('data-copy-saved'); const item=saved.find(x=>x.id===id); await navigator.clipboard.writeText(item.content); toast('Copied')
    }))
    $$('[data-del-saved]', dlg).forEach(b=> b.addEventListener('click', ()=>{
      const id=b.getAttribute('data-del-saved'); const filtered=saved.filter(x=>x.id!==id); LS.set('mir:saved', filtered); $('#savedCount').textContent=String(filtered.length); dlg.close(); toast('Removed')
    }))
  },0)
})

/* ---------- Help ---------- */
function bindHelp(){
  const dlg = $('#helpDialog')
  $('#helpBtn')?.addEventListener('click', ()=> dlg.showModal())
  $$('[data-close="helpDialog"]').forEach(b=> b.addEventListener('click', ()=> dlg.close()))
}

/* ---------- Theme toggle ---------- */
function bindTheme(){
  $('#themeToggle')?.addEventListener('click', ()=>{
    const cur = document.documentElement.getAttribute('data-theme')
    settings.theme = cur==='dark' ? 'light' : 'dark'
    saveSettings(); toast(`Theme: ${settings.theme}`)
  })
}

/* ---------- Init ---------- */
function init(){
  initPreloader()
  applyTheme()
  // respect system changes if system mode
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', ()=>{ if(settings.theme==='system') applyTheme() })
  bindSidebar(); bindComposer(); bindFiles(); bindVoice(); bindSettings(); bindTools(); bindCommandPalette(); bindHelp(); bindTheme()
  renderProjects(); renderConversations(); renderMessages(); renderFilePreview()
  $('#savedCount').textContent = String(LS.get('mir:saved', []).length)
  // accessibility: close modals on backdrop click
  $$('dialog.modal').forEach(d=> d.addEventListener('click', e=>{ if(e.target===d) d.close() }))
  // focus composer if no conv
  if(!conversations.length){
    // keep hero visible
  }
  // announce ready
  console.log('%cMIR AI %c by Mir Junior — https://mirjunior.netlify.app/','background:#FF2D95;color:white;padding:4px 8px;border-radius:6px;font-weight:700','color:#B7AEBF')
  // test checklist console
  // Ensure title has MIR AI
  if(!document.title.includes('MIR AI')) document.title = 'MIR AI — Premium Personal Assistant by Mir Junior'
}
document.addEventListener('DOMContentLoaded', init)

// expose for debugging
window.MIR_DEBUG = { getState: ()=>({conversations, projects, settings}), createConversation, sendMessage }
