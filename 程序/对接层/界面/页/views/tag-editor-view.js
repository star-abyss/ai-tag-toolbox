'use strict';

(function install(root, factory) {
  const helpers = typeof module === 'object' && module.exports ? require('./tag-location-view') : root.AppViews?.tagLocation;
  const api = factory(helpers);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AppViews = root.AppViews || {};
  root.AppViews.tagEditor = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function factory(helpers) {
  const FIELDS = ['kind', 'content', 'displayName', 'aliases', 'note', 'adult', 'searchable'];
  const PATCH_FIELDS = [...FIELDS, 'categoryId', 'subcategoryId', 'memberTagIds'];
  const defaults = () => ({ kind:'tag', content:'', displayName:'', aliases:[], note:'', adult:false, searchable:true });
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  let operations = 0;
  function prefill(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !PATCH_FIELDS.includes(key))) return null;
    for (const [key,v] of Object.entries(value)) {
      if (key==='aliases') { if (!Array.isArray(v) || v.length>64 || v.some(x=>typeof x!=='string'||!x.trim()||x.length>256||x.includes('\0')) || new Set(v).size!==v.length) return null; }
      else if (key==='kind') { if (!['tag','bundle'].includes(v)) return null; }
      else if (['adult','searchable'].includes(key)) { if (typeof v!=='boolean') return null; }
      else if (key==='memberTagIds') { if (!Array.isArray(v) || v.length>200000 || v.some(id=>typeof id!=='string'||!id.trim()||id.length>1024)) return null; }
      else if (typeof v!=='string' || v.includes('\0') || v.length>({content:32768,note:4096,categoryId:1024,subcategoryId:1024}[key]||256)) return null;
    }
    return clone(value);
  }
  function createTagEditorView({ document, catalog, notify = () => {}, getLocale = () => 'zh-CN', localize, confirmDiscard, locationView, onChange = () => {} } = {}) {
    const { createDialogTools, createTagLocationView, element, button, translator } = helpers;
    const t = translator('tagEditor',getLocale,localize);
    let disposed=false, opened=false, session=0, opening=0, origin=null, record=null, draft=null, baseline=null, placement=null, initialPlacement=null, editorMode='tag';
    let revision=0, pending=null, retry=null, independent=false, childOpen=false, guardPending=null, composing=false, discardResolve=null, deleteResolve=null;
    const dialog=createDialogTools(document,'editor',keydown);
    const picker=locationView || createTagLocationView({document,catalog,getLocale,localize});
    const discardDialog=createDialogTools(document,'discard',event=>{if(event.key==='Escape'&&!event.isComposing){event.preventDefault();event.stopImmediatePropagation();finishDecision('stay');}});
    const discardText=element(document,'p'); discardDialog.panel.append(discardText);
    const discardButtons={}; for(const key of ['save','discard','stay']) { const node=button(document,'',`data-tag-${key==='save'?'confirm-save':key}`,()=>finishDecision(key)); discardButtons[key]=node; discardDialog.panel.append(node); }
    const deleteDialog=createDialogTools(document,'delete',event=>{if(event.key==='Escape'&&!event.isComposing){event.preventDefault();event.stopImmediatePropagation();finishDelete(false);}});
    const deleteText=element(document,'p'); deleteText.dataset.tagDeleteText=''; deleteDialog.panel.append(deleteText);
    const deleteCancel=button(document,'','data-tag-delete-cancel',()=>finishDelete(false)); const deleteConfirm=button(document,'','data-tag-delete-confirm',()=>finishDelete(true)); deleteDialog.panel.append(deleteCancel,deleteConfirm);
    const header=element(document,'div'); header.className='tag-editor-header'; dialog.panel.insertBefore(header,dialog.title); header.append(dialog.title);
    const deleteButton=button(document,'','data-tag-delete',()=>removeTag()); deleteButton.className='tag-editor-delete btn btn-icon btn-danger'; deleteButton.hidden=true; header.append(deleteButton);
    const form=element(document,'form'); form.className='tag-editor-form'; dialog.panel.append(form);
    const identitySection=element(document,'section'); identitySection.className='tag-editor-section tag-editor-section--identity';
    const metadataSection=element(document,'section'); metadataSection.className='tag-editor-section tag-editor-section--metadata';
    const groupSection=element(document,'section'); groupSection.className='tag-editor-section tag-editor-section--group';
    const placementSection=element(document,'section'); placementSection.className='tag-editor-section tag-editor-section--placement';
    const sectionHeadings={ identity:element(document,'h3','基本信息'), metadata:element(document,'h3','显示与搜索'), group:element(document,'h3','组成员'), placement:element(document,'h3','位置与收藏') };
    identitySection.append(sectionHeadings.identity); metadataSection.append(sectionHeadings.metadata); groupSection.append(sectionHeadings.group); placementSection.append(sectionHeadings.placement);
    form.append(identitySection,metadataSection,groupSection,placementSection);
    const fields={}, captions={};
    for(const name of FIELDS) {
      const label=element(document,'label'); label.className='tag-editor-field'; label.dataset.tagFieldWrap=name;
      const caption=element(document,'span'); captions[name]=caption; const node=element(document,name==='kind'?'select':['content','aliases','note'].includes(name)?'textarea':'input');
      if(['adult','searchable'].includes(name)) node.type='checkbox';
      node.dataset.tagField=name; node.name=name; fields[name]=node; label.append(caption,node); (['kind','content','displayName'].includes(name)?identitySection:metadataSection).append(label);
      for(const event of ['input','change']) node.addEventListener(event,()=>readField(name));
      node.addEventListener('compositionstart',()=>{composing=true;}); node.addEventListener('compositionend',()=>{composing=false;readField(name);});
    }
    for(const value of ['tag','bundle']) {const option=element(document,'option');option.value=value;fields.kind.append(option);}
    const memberLabel=element(document,'label'); memberLabel.className='tag-editor-field'; memberLabel.dataset.tagFieldWrap='memberTagIds';
    const memberCaption=element(document,'span'); memberCaption.textContent='组成员 ID（每行一个）'; const memberNode=element(document,'textarea'); memberNode.dataset.tagField='memberTagIds'; memberNode.name='memberTagIds'; fields.memberTagIds=memberNode; memberLabel.append(memberCaption,memberNode); groupSection.append(memberLabel);
    memberNode.addEventListener('input',()=>readField('memberTagIds'));
    const taxonomySummary=element(document,'p'); taxonomySummary.dataset.tagTaxonomySummary=''; placementSection.append(taxonomySummary);
    const membershipLabel=element(document,'label'), membershipCaption=element(document,'span'), membershipSelect=element(document,'select');
    membershipSelect.dataset.tagMembership=''; membershipLabel.append(membershipCaption,membershipSelect); placementSection.append(membershipLabel);
    const locationSummary=element(document,'p'); locationSummary.dataset.tagLocationSummary=''; placementSection.append(locationSummary);
    const chooseButton=button(document,'','data-tag-location',()=>chooseLocation());
    const taxonomyButton=button(document,'','data-tag-taxonomy',()=>chooseLocation('taxonomy'));
    const shared=element(document,'p');shared.dataset.tagShared=''; placementSection.append(chooseButton,taxonomyButton,shared);
    const error=element(document,'p');error.dataset.tagError='';error.setAttribute('role','alert');error.tabIndex=-1;error.id=dialog.title.id+'-error'; form.append(error);
    const duplicates=element(document,'div');duplicates.dataset.tagDuplicates='';form.append(duplicates);
    const actions=element(document,'div');actions.className='tag-editor-actions';form.append(actions);
    const restoreButton=button(document,'','data-tag-restore',restore);
    const reloadButton=button(document,'','data-tag-reload',reload);reloadButton.hidden=true;
    const saveButton=button(document,'','data-tag-save',()=>save());
    const closeButton=button(document,'','data-tag-close',()=>requestClose());actions.append(error,restoreButton,reloadButton,saveButton,closeButton);
    form.addEventListener('submit',event=>{event.preventDefault();if(!composing)save();});
    function notifySafe(message) {try {notify(message);} catch { /* Notification must not change a committed result. */ }}
    function busy() {return !!pending || childOpen || !!guardPending || !!deleteResolve;}
    function isDirty() {return opened && (!equal(draft,baseline)||!equal(placement,initialPlacement));}
    function clearError() {error.textContent='';duplicates.replaceChildren();reloadButton.hidden=true;for(const node of Object.values(fields)){node.removeAttribute('aria-invalid');node.removeAttribute('aria-describedby');}}
    function readField(name) {
      if(!opened||pending)return;
      const node=fields[name]; draft[name]=['adult','searchable'].includes(name)?node.checked:name==='aliases'?(node.value===''?[]:node.value.split(/\r?\n/).filter(value=>value.trim())):name==='memberTagIds'?(node.value===''?[]:node.value.split(/[\r\n,]+/).map(value=>value.trim()).filter(Boolean)):node.value;
      independent=false; clearError();
    }
    function freeze(value) {for(const node of form.querySelectorAll('input,textarea,select,button')) node.disabled=value;form.setAttribute('aria-busy',String(value));}
    function labelPlacement(value) {
      if(!value)return t('unclassified');
      const taxonomy=value.kind==='taxonomy', p=taxonomy?value.category:value.page, c=taxonomy?value.subcategory:value.group;
      const parents=taxonomy?catalog.getCategories():catalog.getFavoritePages();
      const children=p?.id?(taxonomy?catalog.getSubcategories(p.id):catalog.getFavoriteGroups(p.id)):[];
      return `${p?.create?.name || parents.find(row=>row.id===p?.id)?.name || t('unclassified')} / ${c?.create?.name || children.find(row=>row.id===c?.id)?.name || t('unclassified')}`;
    }
    function taxonomyPlacement() {return draft?.categoryId && draft?.subcategoryId?{kind:'taxonomy',category:{id:draft.categoryId},subcategory:{id:draft.subcategoryId}}:null;}
    function memberships() {return record?catalog.getTag(record.id)?.favoriteLocations || []:[];}
    function fromMembership(id, hint) {const row=memberships().find(row=>row.membershipId===id&&(!hint||(row.pageId===String(hint.page?.id)&&row.groupId===String(hint.group?.id))));return row?{kind:'favorite',page:{id:row.pageId},group:{id:row.groupId},membershipId:row.membershipId}:null;}
    function summaries() {
      taxonomySummary.textContent=`${t('taxonomy')}: ${labelPlacement(placement?.kind==='taxonomy'?placement:taxonomyPlacement())}`;
      locationSummary.textContent=placement?`${t(placement.kind==='favorite'?'favorite':'taxonomy')}: ${labelPlacement(placement)}`:(editorMode==='group'?'组位置：未选择':t('membership'));
    }
    membershipSelect.addEventListener('change',()=>{placement=fromMembership(membershipSelect.value);clearError();summaries();});
    function render() {
      const groupMode = editorMode === 'group' || draft.kind === 'bundle';
      const favoriteMode = editorMode === 'favorite' && Boolean(record);
      dialog.title.textContent=t(record?'title':'create');
      const english=getLocale?.()==='en-US';
      sectionHeadings.identity.textContent=english?'Identity':'基本信息'; sectionHeadings.metadata.textContent=english?'Display and search':'显示与搜索'; sectionHeadings.group.textContent=english?'Group members':'组成员'; sectionHeadings.placement.textContent=favoriteMode?(english?'Favorite location':'收藏位置'):(english?'Home location':'主页位置');
      deleteDialog.title.textContent=english?'Confirm action':'确认操作';
      const canDelete=Boolean(!favoriteMode&&record);
      deleteButton.hidden=!canDelete;
      deleteButton.title=record?.source?.kind==='custom'?(english?'Delete this custom tag':'删除此自建标签'):(english?'Hide this tag':'隐藏此标签');
      deleteButton.setAttribute('aria-label',deleteButton.title);
      deleteButton.replaceChildren();
      const trash=document.createElementNS('http://www.w3.org/2000/svg','svg'); trash.classList.add('tag-editor-delete-icon'); trash.setAttribute('viewBox','0 0 24 24'); trash.setAttribute('aria-hidden','true');
      for(const d of ['M3 6h18','M8 6V4h8v2','M19 6l-1 14H6L5 6','M10 11v6','M14 11v6']) { const path=document.createElementNS('http://www.w3.org/2000/svg','path'); path.setAttribute('d',d); trash.append(path); } deleteButton.append(trash);
      for(const name of FIELDS) {
        const node=fields[name];captions[name].textContent=t(name);
        if(['adult','searchable'].includes(name))node.checked=draft[name];else node.value=name==='aliases'?(draft.aliases||[]).join('\n'):(draft[name]||'');
        const visible = favoriteMode ? false : (['content','displayName','note'].includes(name) || (groupMode && name==='kind'));
        const wrap=node.closest?.(`[data-tag-field-wrap="${name}"]`);
        if(wrap){if(visible)wrap.removeAttribute('hidden');else wrap.setAttribute('hidden','');}
      }
      const showGroup = !favoriteMode && groupMode;
      identitySection.hidden=favoriteMode; metadataSection.hidden=favoriteMode; memberLabel.hidden=!showGroup; groupSection.hidden=favoriteMode||!showGroup; placementSection.hidden=false; taxonomySummary.hidden=groupMode || favoriteMode; memberNode.value=Array.isArray(draft.memberTagIds)?draft.memberTagIds.join('\n'):'';
      fields.kind.closest('[data-tag-field-wrap="kind"]')?.setAttribute('hidden', '');
      chooseButton.hidden=false;
      taxonomyButton.hidden=true;
      for(const option of fields.kind.options)option.textContent=t(option.value);
      chooseButton.textContent=groupMode?'选择组位置':(english?(favoriteMode?'Move favorite':'Move home tag'):(favoriteMode?'调整收藏位置':'调整主页位置'));taxonomyButton.textContent=t('taxonomy');restoreButton.textContent=t('restore');reloadButton.textContent=t('reload');saveButton.textContent=t('save');closeButton.textContent=t('close');
      restoreButton.hidden=favoriteMode||record?.source?.kind!=='bundled'; reloadButton.hidden=favoriteMode;
      const rows=favoriteMode?memberships():[];membershipLabel.hidden=true;membershipCaption.textContent=t('membership');membershipSelect.replaceChildren();
      const empty=element(document,'option',t('membership'));empty.value='';membershipSelect.append(empty);
      for(const row of rows){const option=element(document,'option',`${row.pageName} / ${row.groupName}`);option.value=row.membershipId;membershipSelect.append(option);}membershipSelect.value=placement?.membershipId || '';
      shared.textContent=!favoriteMode&&record?t('shared',{count:catalog.references(record.id).length}):'';
      deleteText.textContent=record?.source?.kind==='custom'?(english?'Delete this custom tag?':'确认删除这个自建标签？'):(english?'Hide this tag? It can be restored from Hidden tags.':'确认隐藏这个标签？可在“已隐藏标签”里恢复。'); deleteCancel.textContent=english?'Cancel':'取消'; deleteConfirm.textContent=english?(record?.source?.kind==='custom'?'Delete':'Hide'):(record?.source?.kind==='custom'?'删除':'隐藏');
      clearError();freeze(false);summaries();
    }
    function fail(code, field) {showError({code,fields:field?[field]:[]});return {ok:false,error:{code,fields:field?[field]:[]}};}
    function showError(value) {
      const key={REVISION_CONFLICT:'conflict',DUPLICATE_CONTENT:'duplicate',DUPLICATE_MEMBERSHIP:'duplicateMembership',TAG_IN_USE:'inUse',INVALID_FIELD:'invalid',INVALID_PARENT:'invalid',DUPLICATE_NAME:'invalid'}[value.code] || 'failed';
      error.textContent=t(key);reloadButton.hidden=value.code!=='REVISION_CONFLICT';
      const name=value.fields?.map(path=>path.split('.').at(-1)).find(name=>fields[name]);
      if(name){fields[name].setAttribute('aria-invalid','true');fields[name].setAttribute('aria-describedby',error.id);fields[name].focus();}
      else if(value.code==='REVISION_CONFLICT')reloadButton.focus();else error.focus();
    }
    function close() {opened=false;session++;dialog.close();origin=null;}
    function operation(command) {
      const fingerprint=JSON.stringify(command);
      if(!retry||retry.fingerprint!==fingerprint||retry.revision!==revision)retry={fingerprint,revision,id:`tag-editor:${Date.now()}:${++operations}`};
      return retry.id;
    }
    function commit(command) {
      if(pending)return pending;
      const token=session, operationId=operation(command); freeze(true);clearError();
      const frozen=clone(command);
      const promise=Promise.resolve().then(()=>catalog.execute(frozen,{operationId,expectedRevision:revision})).catch(()=>({ok:false,error:{code:'STORAGE_WRITE_FAILED'}})).then(result=>{
        if(disposed||token!==session)return result;
        freeze(false);pending=null;
        if(result.ok){notifySafe(t('saved'));close();try{onChange(result.data)}catch{} }
        else {showError(result.error);if(result.error.code==='DUPLICATE_CONTENT')duplicateActions(result.error,token);}
        return result;
      });pending=promise;return promise;
    }
    function save() {
      if(pending)return pending;
      if(!opened||disposed||childOpen)return Promise.resolve({ok:false,error:{code:'BUSY'}});
      const favoriteMode=editorMode==='favorite'&&Boolean(record);
      if(!favoriteMode&&!draft.content.trim()){const result=fail('INVALID_FIELD','content');error.textContent=t('required');return Promise.resolve(result);}
      if(favoriteMode&&(!placement||placement.kind!=='favorite'||!initialPlacement?.membershipId)){error.textContent=t('membership');return Promise.resolve({ok:false,error:{code:'INVALID_PARENT'}});}
      if(!favoriteMode&&placement?.kind==='favorite'){membershipSelect.focus();error.textContent=t('membership');return Promise.resolve({ok:false,error:{code:'INVALID_PARENT'}});}
      if (editorMode === 'group') draft.kind = 'bundle';
      const patch={};if(!favoriteMode)for(const key of PATCH_FIELDS)if(Object.hasOwn(draft,key)&&(!record||!equal(draft[key],baseline[key])))patch[key]=clone(draft[key]);
      const target=clone(placement);
      if(record&&target)target.originalPlacement=clone(initialPlacement);
      return commit({type:'saveTag',...(record?{tagId:record.id}:{}),patch,...(target?{placement:target}:{}),...(independent?{allowIndependent:true}:{})});
    }
    function removeTag() {
      if(!opened||busy()||!record)return Promise.resolve({ok:false,error:{code:'BUSY'}});
      const type=record.source?.kind==='custom'?'deleteTag':'hideTag';
      const token=session;
      deleteDialog.open();
      return new Promise(resolve=>{deleteResolve=resolve; deleteDialog._tagDeleteToken=token; deleteDialog._tagDeleteCommand={type,tagId:record.id};});
    }
    function finishDelete(accepted) {
      if(!deleteResolve)return;
      const resolve=deleteResolve; deleteResolve=null; const token=deleteDialog._tagDeleteToken; const command=deleteDialog._tagDeleteCommand; deleteDialog._tagDeleteToken=null; deleteDialog._tagDeleteCommand=null; deleteDialog.close();
      if(!accepted||disposed||token!==session){resolve({ok:false,error:{code:'CANCELLED'}});return;}
      Promise.resolve(commit(command)).then(resolve);
    }
    function duplicateActions(value,token) {
      duplicates.replaceChildren();
      for(const known of (value.existingTagIds||[]).slice(0,8)) {
        const row=catalog.getTag(known);if(!row)continue;
        const summary=element(document,'p',`${row.displayName || row.content}\n${row.content}\n${row.note}`);duplicates.append(summary);
        const inspect=button(document,t('inspect'),null,()=>{if(token===session&&!busy())open({tagId:known});});inspect.dataset.tagInspect=known;duplicates.append(inspect);
        if(!record&&placement?.kind==='favorite') {
          const reference=button(document,t('reference'),null,()=>{if(token!==session||busy())return;commit({type:'favoriteTag',tagId:known,placement:clone(placement)});});reference.dataset.tagReference=known;duplicates.append(reference);
        }
      }
      duplicates.append(button(document,t('independent'),'data-tag-independent',()=>{if(token!==session||busy())return;independent=true;save();}));
    }
    function finishDecision(value) {if(!discardResolve)return;const resolve=discardResolve;discardResolve=null;discardDialog.close();resolve(value);}
    function askDecision(reason) {
      if(confirmDiscard)return Promise.resolve().then(()=>confirmDiscard({reason,tagId:record?.id||null})).catch(()=> 'stay');
      discardDialog.title.textContent=t('unsaved');discardText.textContent=t('unsavedText');for(const key of Object.keys(discardButtons))discardButtons[key].textContent=t(key);
      const promise=new Promise(resolve=>{discardResolve=resolve;});discardDialog.open();return promise;
    }
    async function protect(reason) {
      if(!isDirty())return 'discard';
      if(guardPending)return 'stay';
      const token=session;guardPending=askDecision(reason);const choice=await guardPending;guardPending=null;
      if(disposed||token!==session)return 'stay';
      return ['save','discard'].includes(choice)?choice:'stay';
    }
    async function requestClose() {
      if(!opened)return true;if(busy())return false;
      const token=session,choice=await protect('close');if(disposed||token!==session)return false;
      if(choice==='save')return Boolean((await save()).ok);if(choice==='discard'){close();return true;}return false;
    }
    async function open(input={}) {
      if(disposed||busy())return false;
      const attempt=++opening;
      if(opened&&!(await requestClose()))return false;
      if(disposed||attempt!==opening)return false;
      const source=input.tagId?catalog.getTag(input.tagId):null;
      if(input.tagId&&!source){notifySafe(t('invalid'));return false;}
      const initial=input.tagId?{}:prefill(input.initialValues||{});if(!initial){notifySafe(t('invalid'));return false;}
      record=source;draft=source?Object.fromEntries(PATCH_FIELDS.map(key=>[key,clone(source[key])])):{...defaults(),...initial};editorMode=input.mode || (input.membershipId?'favorite':source?.kind === 'bundle' || initial?.kind === 'bundle' ? 'group' : 'taxonomy'); if(editorMode === 'group') draft.kind='bundle'; baseline=clone(draft);
      placement=clone(input.placement)||null;
      const membershipId=input.membershipId || placement?.membershipId;
      const rows=editorMode==='favorite'?[]:memberships();
      if(editorMode==='favorite'&&record){const current=fromMembership(membershipId,placement);if(!current){notifySafe(t('invalid'));return false;}placement=current;}
      else if(record&&editorMode==='taxonomy')placement=placement?.kind==='taxonomy'?placement:taxonomyPlacement();
      else if(membershipId){const current=fromMembership(membershipId);if(!current){notifySafe(t('invalid'));return false;}placement=placement?.kind==='taxonomy'?placement:placement?.kind==='favorite'?{...placement,membershipId}:current;}
      else if(placement?.kind==='favorite'&&rows.length===1)placement={...placement,membershipId:rows[0].membershipId};
      if(!placement&&editorMode==='taxonomy')placement=taxonomyPlacement();
      initialPlacement=clone(placement);revision=catalog.revision();retry=null;independent=false;composing=false;session++;origin=document.activeElement;opened=true;render();dialog.open();fields.content.focus();return true;
    }
    async function chooseLocation(kind) {
      if(!opened||busy())return;
      const mode=editorMode==='group'||editorMode==='favorite'?'favorite':(kind||'taxonomy');
      if(mode==='favorite'&&editorMode!=='favorite'&&memberships().length>1&&!membershipSelect.value){error.textContent=t('membership');membershipSelect.focus();return;}
      const current=mode==='taxonomy'?(placement?.kind==='taxonomy'?placement:taxonomyPlacement()):placement;
      const token=session;childOpen=true;chooseButton.focus();
      try {const value=await picker.choose({kind:mode,current:clone(current),draft:clone(current)});if(disposed||token!==session)return;if(value){placement=clone(value);clearError();summaries();}}
      finally {childOpen=false;if(!disposed&&token===session&&opened)chooseButton.focus();}
    }
    async function reload() {
      if(!opened||busy())return;const token=session;const input=record?{tagId:record.id,membershipId:initialPlacement?.membershipId,placement:clone(initialPlacement),mode:editorMode}:{initialValues:clone(baseline),placement:clone(initialPlacement),mode:editorMode};
      const choice=await protect('reload');if(disposed||token!==session)return;
      if(choice==='save'){await save();return;}if(choice==='discard'){close();await open(input);}
    }
    async function restore() {
      if(!opened||busy()||record?.source?.kind!=='bundled')return;const token=session;const choice=await protect('restore');if(disposed||token!==session)return;
      if(choice==='save'){await save();return;}if(choice==='discard')await commit({type:'restoreTag',tagId:record.id});
    }
    function keydown(event) {
      if(!opened||childOpen||guardPending||event.isComposing||composing)return;
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();requestClose();}
      else if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();save();}
    }
    function dispose() {if(disposed)return;disposed=true;session++;opening++;opened=false;finishDecision('stay');finishDelete(false);deleteDialog.dispose();discardDialog.dispose();if(!locationView)picker.dispose();dialog.dispose();}
    return {open,save,requestClose,isDirty,dispose,locationView:picker};
  }
  return {createTagEditorView};
});
